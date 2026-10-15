// api/moderation.js — OWNER: S3. Player-facing moderation HTTP on the game port. The in-game REPORT op and the
// BLOCK_PLAYER / UNBLOCK_PLAYER actions go through the gateway (S2) to the 'chat' service; these endpoints cover what a
// settings page needs.
//
//   GET  /v1/chat/rules                     public: chat limits + filter version (the client shows the rules)
//   GET  /v1/chat/filter                    public: the active word lists → client calls textfilter.setLists() so its
//                                           preview filters exactly like the server (cached 5 min, rate-limited)
//   GET  /v1/moderation/me                  auth: my sanctions {mute, shadow:false always, ban} (until ms | null = forever)
//   GET  /v1/moderation/blocks              auth: my mute / block list
//   POST /v1/moderation/blocks              auth: {targetAccountId, kind: 'mute'|'block', on: true|false}
//
// auth = `Authorization: Bearer <access JWT>` (EdDSA, issued by S2's /v1/auth/*). Verified with S2's service
// 'auth'.verifyAccess(token) → {accountId} when present, else with jose against the server's own Ed25519 key
// (claim `sub` = account id). A shadow-muted player is never told (me.shadow is always false).
import { createKeyedLimiter, ipKey, isExemptIp } from '../game/ratelimit.js';
import crypto from 'node:crypto';
import { jwtVerify } from 'jose';
import { CHAT, NICK } from '../../../js/shared/constants.js';
import { FILTER_VERSION } from '../../../js/shared/textfilter.js';
import { API_ERR } from '../../../js/shared/protocol.js';
import { httpError } from '../http/router.js';
import { isUuid } from '../chat/util.js';

export function register(app) {
  let pub = null;
  const publicKey = () => {
    if (!pub) {
      const priv = crypto.createPrivateKey({ key: Buffer.from(app.config.secrets.jwtPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
      pub = crypto.createPublicKey(priv);
    }
    return pub;
  };
  async function accountOf(req) {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!tok || tok.length > 4096) throw httpError(401, API_ERR.UNAUTHORIZED);
    if (app.has('auth') && typeof app.get('auth').verifyAccess === 'function') {
      const r = await app.get('auth').verifyAccess(tok).catch(() => null);
      const id = r?.accountId || r?.sub;
      if (!isUuid(id)) throw httpError(401, API_ERR.UNAUTHORIZED);
      return id;
    }
    try {
      const { payload } = await jwtVerify(tok, publicKey(), { algorithms: ['EdDSA'] });
      if (!isUuid(payload.sub)) throw new Error('sub');
      return payload.sub;
    } catch { throw httpError(401, API_ERR.UNAUTHORIZED); }
  }

  // per-IP limiter (lenient: VN 4G CGNAT puts many players behind one address). Keyed token buckets with bounded
  // memory (oldest key evicted) — the old Map was CLEARED above 50k keys, so many IPv6 addresses reset everyone's
  // limits (fixer round 1). IPv6 grouped per /64; loopback / private addresses exempt like the other limiters.
  const limiters = new Map();
  const limit = (perMin) => {
    const l = createKeyedLimiter({ rate: perMin / 60, burst: perMin, max: 50_000 });
    limiters.set(perMin, l);
    return (req) => {
      if (isExemptIp(req.ip)) return null;
      const k = ipKey(req.ip, 64);
      if (l.take(k)) return null;
      return { retryAfterS: Math.max(1, l.retryAfterS(k)) };
    };
  };
  app.bus.on('start', () => { app.timers.every(60_000, 'moderation_rl_sweep', () => { for (const l of limiters.values()) l.sweep(); }); });
  const chat = () => app.get('chat');

  app.http.get('/v1/chat/rules', () => ({
    radiusM: CHAT.RADIUS, maxChars: CHAT.MAX_CHARS, ratePerS: CHAT.RATE_PER_S, burst: CHAT.BURST,
    slowModePlayS: CHAT.SLOW_MODE_PLAY_S, slowRatePerS: CHAT.SLOW_RATE_PER_S, dupWindowS: CHAT.DUP_WINDOW_S,
    nickMin: NICK.MIN, nickMax: NICK.MAX, filterVersion: FILTER_VERSION, listsVersion: chat().listsVersion(),
  }), { rateLimit: limit(120) });

  app.http.get('/v1/chat/filter', (req, res) => {
    res.json({ version: chat().listsVersion(), lists: chat().getLists() }, 200, { 'cache-control': 'public, max-age=300' });
  }, { rateLimit: limit(30) });

  app.http.get('/v1/moderation/me', async (req) => {
    const id = await accountOf(req);
    const s = chat().sanctionOf(id);
    const v = (u) => (u === 0 ? 0 : u);   // null = permanent
    return { mute: v(s.mute), ban: v(s.ban), shadow: false };
  }, { rateLimit: limit(60) });

  app.http.get('/v1/moderation/blocks', async (req) => ({ blocks: await chat().listBlocks(await accountOf(req)) }), { rateLimit: limit(60) });

  app.http.post('/v1/moderation/blocks', async (req) => {
    const id = await accountOf(req);
    const b = req.json || {};
    if (!isUuid(b.targetAccountId)) throw httpError(400, API_ERR.BAD_REQUEST);
    const kind = b.kind === 'mute' ? 'mute' : 'block';
    const out = await chat().setBlock(id, b.targetAccountId, b.on !== false, kind);
    if (!out.ok) throw httpError(400, API_ERR.BAD_REQUEST);
    return { ok: true };
  }, { rateLimit: limit(30) });
}
