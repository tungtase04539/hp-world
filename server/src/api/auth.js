// api/auth.js — OWNER: S2. Guest accounts with invite codes, refresh-token rotation, recovery codes (SPEC §3.1).
//   POST /v1/auth/guest   {nickname, deviceId, inviteCode, appearance?} → 200 {accessToken, accessExpiresIn,
//                         refreshToken, refreshExpiresAt, recoveryCode, account}
//   POST /v1/auth/refresh {refreshToken}                    → 200 {accessToken, accessExpiresIn, refreshToken, refreshExpiresAt, account}
//   POST /v1/auth/recover {code, deviceId}                  → 200 {accessToken, accessExpiresIn, refreshToken, refreshExpiresAt, account}
//   account = {id, kind, nickname, discriminator, displayName}      displayName = "Nick#1234"
// Errors: JSON {error: code}: 400 bad_request | device_invalid | nickname_invalid {reason} ; 403 invite_required |
//   invite_invalid | banned ; 401 unauthorized | refresh_reused | recovery_invalid ; 409 refresh_race | nickname_taken ;
//   429 rate_limited {retryAfterS}.
//
// Tokens
// - Access: JWT EdDSA (Ed25519 key config.secrets.jwtPrivateKey, header kid = jwtKid), 15 min, iss 'hp-world',
//   aud 'hp-world-play', sub = account id, claims dn (display name), k (kind).
// - Refresh: 256-bit random (base64url, 43 chars), only sha256 stored, rotated on every use (rotated_from chain),
//   180 days. Re-using a rotated token revokes every refresh token of the account (theft signal), except within
//   REFRESH_RACE_S of the rotation (double-submit) → 409 refresh_race.
// - Recovery code: 12 chars from an unambiguous alphabet (no I L O 0 1), shown ONCE as XXXX-XXXX-XXXX, only
//   HMAC-SHA256(RECOVERY_PEPPER, normalised code) stored (accounts.recovery_hash, recovery_hash_v = 2). The pepper is a
//   secret in server/.env, never in the DB, so a leaked dump alone cannot be brute-forced offline (fixer round 1,
//   SEC-5). Legacy v1 rows (plain sha256) are upgraded on their next successful recovery. It stays valid (it is the key
//   to the account on a new device).
// - Invite codes (closed test): sha256 of the normalised code in invites.code_hash; each use decrements uses_left
//   atomically inside the account-creation transaction. Helpers for the admin page (S3): generateInviteCode,
//   normalizeCode, hashCode, createInviteBatch.
// Google link = GĐ2: identities.provider 'google' is ready; linkIdentity() is the "link, never merge" extension point
// (no route yet).
//
// Service 'auth': { issueAccess(account) → Promise<string>, verifyAccess(token) → Promise<claims | null>,
//                   publicJwk() → JWK of the verification key, createInviteBatch(opts) }
import crypto from 'node:crypto';
import { SignJWT, jwtVerify, exportJWK } from 'jose';
import { API_ERR } from '../../../js/shared/protocol.js';
import { normalize as normalizeText, checkNickname } from '../../../js/shared/textfilter.js';
import { httpError } from '../http/router.js';

export const AUTH = Object.freeze({
  ISS: 'hp-world',
  AUD: 'hp-world-play',
  ACCESS_S: 15 * 60,
  REFRESH_DAYS: 180,
  REFRESH_RACE_S: 30,
  CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  RECOVERY_LEN: 12,
  INVITE_LEN: 10,
});
export const AUTH_ERR = Object.freeze({
  DEVICE_INVALID: 'device_invalid', BANNED: 'banned', REFRESH_REUSED: 'refresh_reused', REFRESH_RACE: 'refresh_race',
  RECOVERY_INVALID: 'recovery_invalid', NICK_TAKEN: 'nickname_taken',
});

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

export function randomCode(len, alphabet = AUTH.CODE_ALPHABET) {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
// uppercase, drop everything but letters/digits (spaces, dashes, dots typed by people)
export function normalizeCode(code) {
  return String(code ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export const hashCode = (code) => sha256(normalizeCode(code));
export const formatCode = (c, group = 4) => c.match(new RegExp(`.{1,${group}}`, 'g')).join('-');
export const generateInviteCode = () => formatCode(randomCode(AUTH.INVITE_LEN), 5);
export const generateRecoveryCode = () => formatCode(randomCode(AUTH.RECOVERY_LEN), 4);
export const hashToken = (t) => sha256(String(t));
// peppered recovery-code hash (v2)
export const recoveryHasher = (pepper) => (code) => crypto.createHmac('sha256', String(pepper)).update(normalizeCode(code)).digest();

// Create `count` invite codes. Returns the PLAIN codes (show once; only hashes are stored).
export async function createInviteBatch(db, { count = 1, uses = 1, expiresAt = null, batch = null, note = null, createdBy = 'admin' } = {}) {
  const n = Math.max(1, Math.min(1000, count | 0));
  const u = Math.max(1, Math.min(100000, uses | 0));
  const codes = [];
  for (let i = 0; i < n; i++) codes.push(generateInviteCode());
  await db.tx(async (q) => {
    for (const c of codes) {
      await q.query(`INSERT INTO invites (code_hash, batch, uses_left, uses_total, expires_at, created_by, note) VALUES ($1, $2, $3, $3, $4, $5, $6)`,
        [hashCode(c), batch, u, expiresAt, createdBy, note]);
    }
  });
  return codes;
}

// GĐ2 extension point ("link, never merge"): attach provider/subject to accountId. Returns {ok} or {ok: false,
// conflictAccountId} when the identity already belongs to another account (the UI asks which progress to keep).
export async function linkIdentity(db, accountId, provider, subject, email = null) {
  const cur = await db.one('SELECT account_id FROM identities WHERE provider = $1 AND subject = $2', [provider, subject]);
  if (cur && cur.account_id !== accountId) return { ok: false, conflictAccountId: cur.account_id };
  if (!cur) await db.query('INSERT INTO identities (provider, subject, account_id, email) VALUES ($1, $2, $3, $4)', [provider, subject, accountId, email]);
  return { ok: true };
}

function accountJson(r) {
  return { id: r.id, kind: r.kind, nickname: r.nickname, discriminator: r.discriminator, displayName: r.display_name };
}

export function createAuth({ config, db }) {
  const priv = crypto.createPrivateKey({ key: Buffer.from(config.secrets.jwtPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv);
  const kid = config.secrets.jwtKid;

  const issueAccess = (acc) => new SignJWT({ dn: acc.displayName || acc.display_name || '', k: acc.kind || 'guest' })
    .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
    .setSubject(acc.id).setIssuer(AUTH.ISS).setAudience(AUTH.AUD)
    .setIssuedAt().setExpirationTime(`${AUTH.ACCESS_S}s`)
    .sign(priv);
  const verifyAccess = async (token) => {
    if (typeof token !== 'string' || token.length > 2048) return null;
    try {
      const { payload, protectedHeader } = await jwtVerify(token, pub, { issuer: AUTH.ISS, audience: AUTH.AUD, algorithms: ['EdDSA'] });
      if (protectedHeader.kid !== kid || typeof payload.sub !== 'string') return null;
      return payload;
    } catch { return null; }
  };
  // new refresh token for an account (inside a transaction q or on db)
  const newRefresh = async (q, accountId, deviceId, rotatedFrom = null) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const exp = new Date(Date.now() + AUTH.REFRESH_DAYS * 86400 * 1000);
    await q.query(`INSERT INTO refresh_tokens (account_id, token_hash, device_id, expires_at, rotated_from) VALUES ($1, $2, $3, $4, $5)`,
      [accountId, hashToken(token), deviceId, exp, rotatedFrom]);
    return { refreshToken: token, refreshExpiresAt: exp.toISOString() };
  };
  const session = async (acc, refresh) => ({
    accessToken: await issueAccess(acc), accessExpiresIn: AUTH.ACCESS_S, ...refresh, account: accountJson(acc),
  });
  return { issueAccess, verifyAccess, newRefresh, session, pub, kid, publicJwk: async () => ({ ...(await exportJWK(pub)), kid, alg: 'EdDSA', use: 'sig' }) };
}

export function register(app) {
  const log = app.log.child({ mod: 'auth' });
  const { config, db } = app;
  const auth = createAuth({ config, db });
  const m = app.metrics.counter('auth_total', 'auth API results');
  const rl = () => app.get('ratelimit');
  app.provide('auth', { issueAccess: auth.issueAccess, verifyAccess: auth.verifyAccess, publicJwk: auth.publicJwk, createInviteBatch: (o) => createInviteBatch(db, o) });

  const ipLimit = (name) => (req) => rl().checkHttp(name, req.ip, { ip: true });
  const limit = (name, key) => {
    const r = rl().checkHttp(name, key);
    if (r) throw httpError(429, API_ERR.RATE_LIMITED, { retryAfterS: r.retryAfterS });
  };
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const newRefresh = auth.newRefresh;
  const recoveryHash = recoveryHasher(config.secrets.recoveryPepper);

  // ---- POST /v1/auth/guest ----------------------------------------------------------------------------------------
  app.http.post('/v1/auth/guest', async (req) => {
    const b = req.json && typeof req.json === 'object' ? req.json : {};
    const nickRaw = str(b.nickname, 64);
    const deviceId = str(b.deviceId, 64);
    const invite = b.inviteCode == null ? '' : str(b.inviteCode, 64);
    if (nickRaw === null || invite === null) { m.inc(1, { r: 'guest_bad' }); throw httpError(400, API_ERR.BAD_REQUEST); }
    if (!deviceId || !DEVICE_RE.test(deviceId)) { m.inc(1, { r: 'guest_bad' }); throw httpError(400, AUTH_ERR.DEVICE_INVALID); }
    limit('guestDevice', deviceId);
    const nickname = normalizeText(nickRaw);
    const chat = app.has('chat') ? app.get('chat') : null;
    const nc = chat ? chat.nicknameCheck(nickname) : checkNickname(nickname);
    if (!nc || !nc.ok) { m.inc(1, { r: 'guest_nick' }); throw httpError(400, API_ERR.NICK_INVALID, { reason: nc?.reason || 'invalid' }); }
    let appearance = null;
    if (typeof b.appearance === 'string' && /^[0-9a-fA-F]{16}$/.test(b.appearance)) appearance = Buffer.from(b.appearance, 'hex');
    if (!appearance) appearance = crypto.randomBytes(8);
    const code = normalizeCode(invite);
    if (config.inviteRequired && !code) { m.inc(1, { r: 'guest_noinvite' }); throw httpError(403, API_ERR.INVITE_REQUIRED); }
    const recovery = generateRecoveryCode();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const out = await db.tx(async (q) => {
          let inviteId = null;
          if (code) {
            const inv = await q.one(`UPDATE invites SET uses_left = uses_left - 1
                WHERE code_hash = $1 AND uses_left > 0 AND (expires_at IS NULL OR expires_at > now()) RETURNING id`, [hashCode(code)]);
            if (!inv) throw httpError(403, API_ERR.INVITE_INVALID);
            inviteId = inv.id;
          }
          const acc = await q.one(`INSERT INTO accounts (kind, invite_id, recovery_hash, recovery_hash_v, last_seen) VALUES ('guest', $1, $2, 2, now())
              RETURNING id, kind`, [inviteId, recoveryHash(recovery)]);
          await q.query(`INSERT INTO identities (provider, subject, account_id) VALUES ('device', $1, $2) ON CONFLICT DO NOTHING`, [deviceId, acc.id]);
          const taken = await q.query('SELECT discriminator FROM characters WHERE lower(nickname) = lower($1)', [nickname]);
          if (taken.rows.length >= 10000) throw httpError(409, AUTH_ERR.NICK_TAKEN);
          const used = new Set(taken.rows.map((r) => r.discriminator));
          let d;
          do { d = crypto.randomInt(10000); } while (used.has(d));
          const dn = `${nickname}#${String(d).padStart(4, '0')}`;
          await q.query(`INSERT INTO characters (account_id, nickname, discriminator, display_name, appearance) VALUES ($1, $2, $3, $4, $5)`,
            [acc.id, nickname, d, dn, appearance]);
          const refresh = await newRefresh(q, acc.id, deviceId);
          return { acc: { id: acc.id, kind: acc.kind, nickname, discriminator: d, display_name: dn, displayName: dn }, refresh };
        });
        m.inc(1, { r: 'guest_ok' });
        log.info('guest account created', { account: out.acc.id, name: out.acc.display_name });
        return { ...(await auth.session(out.acc, out.refresh)), recoveryCode: recovery };
      } catch (e) {
        if (e && e.status) { m.inc(1, { r: 'guest_' + e.code }); throw e; }
        if (e && e.code === '23505' && attempt < 4) continue;    // unique race (name#discriminator) → retry
        throw e;
      }
    }
    throw httpError(409, AUTH_ERR.NICK_TAKEN);
  }, { rateLimit: ipLimit('guestIp') });

  // ---- POST /v1/auth/refresh --------------------------------------------------------------------------------------
  app.http.post('/v1/auth/refresh', async (req) => {
    const tok = str(req.json?.refreshToken, 128);
    if (!tok) throw httpError(400, API_ERR.BAD_REQUEST);
    const h = hashToken(tok);
    limit('refreshToken', h.toString('hex'));
    const row = await db.one(`SELECT rt.id, rt.account_id, rt.device_id, rt.expires_at, rt.revoked_at, a.status, a.kind,
          c.nickname, c.discriminator, c.display_name,
          EXISTS (SELECT 1 FROM refresh_tokens x WHERE x.rotated_from = rt.id) AS rotated
        FROM refresh_tokens rt JOIN accounts a ON a.id = rt.account_id LEFT JOIN characters c ON c.account_id = a.id
        WHERE rt.token_hash = $1`, [h]);
    if (!row) { m.inc(1, { r: 'refresh_unknown' }); throw httpError(401, API_ERR.UNAUTHORIZED); }
    if (row.revoked_at && !row.rotated) { m.inc(1, { r: 'refresh_revoked' }); throw httpError(401, API_ERR.UNAUTHORIZED); }
    if (row.revoked_at) {
      if (Date.now() - new Date(row.revoked_at).getTime() < AUTH.REFRESH_RACE_S * 1000) { m.inc(1, { r: 'refresh_race' }); throw httpError(409, AUTH_ERR.REFRESH_RACE); }
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [row.account_id]);
      m.inc(1, { r: 'refresh_reused' });
      log.warn('refresh token reuse: all sessions of the account revoked', { account: row.account_id });
      throw httpError(401, AUTH_ERR.REFRESH_REUSED);
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) { m.inc(1, { r: 'refresh_expired' }); throw httpError(401, API_ERR.UNAUTHORIZED); }
    if (row.status !== 'active') { m.inc(1, { r: 'refresh_banned' }); throw httpError(403, AUTH_ERR.BANNED); }
    const refresh = await db.tx(async (q) => {
      const upd = await q.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [row.id]);
      if (!upd.rows.length) throw httpError(409, AUTH_ERR.REFRESH_RACE);
      return newRefresh(q, row.account_id, row.device_id, row.id);
    });
    await db.query('UPDATE accounts SET last_seen = now() WHERE id = $1', [row.account_id]);
    m.inc(1, { r: 'refresh_ok' });
    return auth.session({ id: row.account_id, kind: row.kind, nickname: row.nickname, discriminator: row.discriminator, display_name: row.display_name, displayName: row.display_name }, refresh);
  }, { rateLimit: ipLimit('refreshIp') });

  // ---- POST /v1/auth/recover --------------------------------------------------------------------------------------
  app.http.post('/v1/auth/recover', async (req) => {
    const code = normalizeCode(str(req.json?.code, 64) || '');
    const deviceId = str(req.json?.deviceId, 64);
    if (!deviceId || !DEVICE_RE.test(deviceId)) throw httpError(400, AUTH_ERR.DEVICE_INVALID);
    // malformed codes are refused before any accounting; the server-wide counter only ALERTS (fixer round 1, SEC-4: a
    // refusing global bucket let ~10 addresses lock every player out of recovery). Per IP (/48) + per device hold.
    if (code.length !== AUTH.RECOVERY_LEN || /[^A-Z0-9]/.test(code)) { m.inc(1, { r: 'recover_bad' }); throw httpError(401, AUTH_ERR.RECOVERY_INVALID); }
    limit('recoverDevice', deviceId);
    if (rl().checkHttp('recoverGlobal', 'all')) {
      m.inc(1, { r: 'recover_flood' });
      if (app.has('alerts')) app.get('alerts').send('recover_flood', 'Có rất nhiều lần thử mã khôi phục sai trong giờ qua (có thể bị dò mã). Máy chủ vẫn chạy bình thường.').catch(() => {});
    }
    const hv2 = recoveryHash(code), hv1 = hashCode(code);
    const row = await db.one(`SELECT a.id, a.kind, a.status, a.recovery_hash_v, c.nickname, c.discriminator, c.display_name
        FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
        WHERE a.recovery_hash = $1 OR (a.recovery_hash = $2 AND a.recovery_hash_v = 1)`, [hv2, hv1]);
    if (!row) { m.inc(1, { r: 'recover_bad' }); throw httpError(401, AUTH_ERR.RECOVERY_INVALID); }
    // legacy unpeppered hash → upgrade on the first successful use
    if (row.recovery_hash_v === 1) await db.query('UPDATE accounts SET recovery_hash = $2, recovery_hash_v = 2 WHERE id = $1', [row.id, hv2]);
    delete row.recovery_hash_v;
    if (row.status !== 'active') throw httpError(403, AUTH_ERR.BANNED);
    const refresh = await db.tx(async (q) => {
      await q.query(`INSERT INTO identities (provider, subject, account_id) VALUES ('device', $1, $2) ON CONFLICT DO NOTHING`, [deviceId, row.id]);
      await q.query('UPDATE accounts SET last_seen = now() WHERE id = $1', [row.id]);
      return newRefresh(q, row.id, deviceId);
    });
    m.inc(1, { r: 'recover_ok' });
    log.info('account recovered with recovery code', { account: row.id });
    return auth.session({ ...row, displayName: row.display_name }, refresh);
  }, { rateLimit: ipLimit('recoverIp') });

  // housekeeping: expired refresh tokens (kept 7 days after expiry for the reuse signal)
  app.bus.on('start', () => {
    app.timers.every(3600 * 1000, 'refresh_purge', async () => {
      await db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    });
  });
}
