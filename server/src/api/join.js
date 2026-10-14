// api/join.js — OWNER: S2. POST /v1/join {accessToken, proto, tier, worldVersion?}
//   → 200 {wsUrl, ticket, ticketExpiresIn: 60, spawnHint: {x, z, yaw, id}, proto, serverTime}
//   → 200 {queue: {position, etaS, retryAfterS}}   when the server is at capacity (or degrade L4): poll again later
//   → 409 {error: 'proto_mismatch', serverProto} · 401 unauthorized · 403 banned · 429 rate_limited
// The ticket (HMAC, 60 s, single use — game/tickets.js) goes in the FIRST WebSocket message (HELLO), never in the URL.
// A ticket reserves a capacity slot until it is used or expires. An account that already has a live or resumable
// session always gets a ticket (the new connection replaces the old one: one session per account).
//
// Service 'tickets': the ticketer {issue, verify, consume, sweep} used by game/gateway.js.
import { PROTO_VERSION, API_ERR } from '../../../js/shared/protocol.js';
import { httpError } from '../http/router.js';
import { createTicketer } from '../game/tickets.js';
import { chooseSpawn } from '../game/spawn.js';
import { AUTH_ERR } from './auth.js';

export function register(app) {
  const tickets = createTicketer({ key: app.config.secrets.ticketHmacKey });
  app.provide('tickets', tickets);
  const m = app.metrics.counter('join_total', 'POST /v1/join results');
  const rl = () => app.get('ratelimit');

  app.http.post('/v1/join', async (req) => {
    const b = req.json && typeof req.json === 'object' ? req.json : {};
    if (b.proto !== PROTO_VERSION) {
      m.inc(1, { r: 'proto' });
      throw httpError(409, API_ERR.PROTO_MISMATCH, { serverProto: PROTO_VERSION });
    }
    const claims = await app.get('auth').verifyAccess(b.accessToken);
    if (!claims) { m.inc(1, { r: 'unauthorized' }); throw httpError(401, API_ERR.UNAUTHORIZED); }
    const accountId = claims.sub;
    const lim = rl().checkHttp('joinAccount', accountId);
    if (lim) { m.inc(1, { r: 'rate' }); throw httpError(429, API_ERR.RATE_LIMITED, { retryAfterS: lim.retryAfterS }); }
    const row = await app.db.one(`SELECT a.status, c.pos_x, c.pos_z, c.yaw FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
        WHERE a.id = $1`, [accountId]);
    if (!row) { m.inc(1, { r: 'unauthorized' }); throw httpError(401, API_ERR.UNAUTHORIZED); }
    if (row.status !== 'active') { m.inc(1, { r: 'banned' }); throw httpError(403, AUTH_ERR.BANNED); }

    const sessions = app.get('sessions');
    const live = sessions.get(accountId);
    const q = app.get('queue').request(accountId, { hasSession: !!live });
    if (!q.ok) {
      m.inc(1, { r: 'queued' });
      return { queue: { position: q.position, etaS: q.etaS, retryAfterS: q.retryAfterS } };
    }
    const tier = Number.isInteger(b.tier) && b.tier >= 0 && b.tier <= 255 ? b.tier : 0;
    const t = tickets.issue(accountId, tier);
    if (!live) app.get('queue').reserve(t.nonce, accountId, t.exp);
    const sp = live
      ? { x: live.entity.x, z: live.entity.z, yaw: live.entity.yaw, id: 'resume' }
      : chooseSpawn(sessions.world, row.pos_x == null ? null : { x: row.pos_x, z: row.pos_z, yaw: row.yaw });
    m.inc(1, { r: 'ticket' });
    return {
      wsUrl: app.config.publicWsUrl,
      ticket: t.ticket,
      ticketExpiresIn: tickets.ttlS,
      spawnHint: { x: Math.round(sp.x * 100) / 100, z: Math.round(sp.z * 100) / 100, yaw: Math.round(sp.yaw * 1000) / 1000, id: sp.id },
      proto: PROTO_VERSION,
      serverTime: app.nowMs(),
    };
  }, { rateLimit: (req) => rl().checkHttp('joinIp', req.ip, { ip: true }) });

  app.bus.on('start', () => { app.timers.every(10000, 'tickets_sweep', () => tickets.sweep()); });
}
