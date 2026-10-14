// api/netprobe.js — OWNER: S5. Network probe for netprobe.html (SPEC §3.5):
//   WS /probe          answers PING with PONG only (no ticket, no session). Anything else → close 1008.
//                      Bounded: ≤ PROBE.MAX_CONNS sockets in total, ≤ PROBE.MAX_PER_IP per source address,
//                      ≤ PROBE.MAX_PINGS per socket, ≤ 10 PING/s per socket, socket closed after PROBE.MAX_LIFE_MS.
//   POST /v1/netprobe  {carrier, netType, device?, samples, lost, medianMs, p95Ms, jitterMs, minMs, maxMs}
//                      → stored in netprobe_results (migration 030). No personal data: no IP, no UA, no account.
//                      Rate limit: per source address 6 / 10 min, global 120 / min.
//   service 'netprobe' { summary({days}) → rows by carrier × netType, recent(limit), CARRIERS, NET_TYPES }
//   admin   GET /admin/api/netprobe?days=14 → {available, rows, days, summary, recent} — the route lives in
//           admin/index.js (S3 security layer) and reads this service
// Also installs the admin edge guard (admin_edge_guard.js): the admin port refuses tunnel / edge-network traffic.
import { Writer, decodeC2S, encodePong } from '../../../js/shared/codec.js';
import { C2S, CLOSE, API_ERR } from '../../../js/shared/protocol.js';
import { installAdminEdgeGuard, cameThroughCloudflare } from './admin_edge_guard.js';

export const CARRIERS = Object.freeze(['viettel', 'vnpt', 'fpt', 'mobifone', 'vinaphone', 'khac']);
export const NET_TYPES = Object.freeze(['wifi', '4g', '5g', 'khac']);
export const DEVICES = Object.freeze(['dienthoai', 'maytinh', 'khac']);
export const PROBE = Object.freeze({
  MAX_CONNS: 256,
  MAX_PER_IP: 8,          // lenient: 4G CGNAT puts many phones behind one address
  MAX_PINGS: 64,          // the page sends 30 (+ 3 warm-up)
  MIN_GAP_MS: 80,         // ≤ ~12 PING/s per socket
  MAX_LIFE_MS: 60_000,
  POST_PER_IP: 6, POST_PER_IP_WINDOW_MS: 10 * 60_000,
  POST_GLOBAL_PER_MIN: 120,
  RETENTION_DAYS: 90,
});

const MAX_MS = 60_000;

// Validate a POST body → clean record or null.
export function validateResult(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const carrier = String(b.carrier || '').toLowerCase();
  const netType = String(b.netType || '').toLowerCase();
  const device = String(b.device || 'khac').toLowerCase();
  if (!CARRIERS.includes(carrier) || !NET_TYPES.includes(netType) || !DEVICES.includes(device)) return null;
  const samples = b.samples, lost = b.lost;
  if (!Number.isInteger(samples) || samples < 1 || samples > 100) return null;
  if (!Number.isInteger(lost) || lost < 0 || lost > samples) return null;
  const nums = {};
  for (const k of ['medianMs', 'p95Ms', 'jitterMs', 'minMs', 'maxMs']) {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_MS) return null;
    nums[k] = Math.round(v * 100) / 100;
  }
  if (samples - lost > 0 && !(nums.minMs <= nums.medianMs && nums.medianMs <= nums.p95Ms + 1e-9 && nums.p95Ms <= nums.maxMs + 1e-9)) return null;
  return { carrier, netType, device, samples, lost, ...nums };
}

// Tiny fixed-window counters, bounded memory.
function makeLimiter(limit, windowMs, maxKeys = 50_000) {
  const m = new Map();
  return {
    hit(key, now) {
      let e = m.get(key);
      if (!e || now - e.t0 >= windowMs) {
        if (!e && m.size >= maxKeys) { for (const [k, v] of m) if (now - v.t0 >= windowMs) m.delete(k); if (m.size >= maxKeys) return { retryAfterS: windowMs / 1000 }; }
        e = { t0: now, n: 0 }; m.set(key, e);
      }
      if (e.n >= limit) return { retryAfterS: Math.max(1, Math.ceil((e.t0 + windowMs - now) / 1000)) };
      e.n++;
      return null;
    },
    sweep(now) { for (const [k, v] of m) if (now - v.t0 >= windowMs) m.delete(k); },
    get size() { return m.size; },
  };
}

export function register(app) {
  const log = app.log.child ? app.log.child({ mod: 'netprobe' }) : app.log;
  installAdminEdgeGuard(app);

  // ---- WS /probe -----------------------------------------------------------------------------------------------
  const w = new Writer(64);
  const pool = {};
  const perIp = new Map();
  let open = 0;
  const pings = app.metrics.counter('netprobe_pings_total', 'PINGs answered on /probe');
  app.metrics.gauge('netprobe_conns', 'Open /probe sockets', () => open);

  app.ws.guard(({ path, ip }) => {
    if (path !== '/probe') return null;
    if (open >= PROBE.MAX_CONNS) return { status: 503, reason: 'probe busy' };
    if ((perIp.get(ip) || 0) >= PROBE.MAX_PER_IP) return { status: 429, reason: 'probe: too many from this address' };
    return null;
  });

  app.ws.route('/probe', {
    open(conn) {
      open++;
      perIp.set(conn.ip, (perIp.get(conn.ip) || 0) + 1);
      const st = { n: 0, last: 0, timer: null, counted: true };
      conn.data = st;
      st.timer = app.timers.after(PROBE.MAX_LIFE_MS, () => { if (!conn.closed) conn.close(CLOSE.NORMAL, 'probe: done'); });
    },
    message(conn, bytes, isBinary) {
      const st = conn.data;
      const m = isBinary ? decodeC2S(bytes, pool) : null;
      if (!m || m.op !== C2S.PING) { conn.close(CLOSE.POLICY, 'probe: PING only'); return; }
      const now = app.nowMs();
      if (st) {
        if (++st.n > PROBE.MAX_PINGS) { conn.close(CLOSE.RATE, 'probe: limit'); return; }
        if (st.n > 1 && now - st.last < PROBE.MIN_GAP_MS) { conn.close(CLOSE.RATE, 'probe: too fast'); return; }
        st.last = now;
      }
      pings.inc();
      conn.send(encodePong(w, m.clientTime, now));
    },
    close(conn) {
      const st = conn.data;
      if (!st || !st.counted) return;
      st.counted = false;
      st.timer?.();
      open = Math.max(0, open - 1);
      const n = (perIp.get(conn.ip) || 1) - 1;
      if (n <= 0) perIp.delete(conn.ip); else perIp.set(conn.ip, n);
    },
  });

  // ---- POST /v1/netprobe ---------------------------------------------------------------------------------------
  const ipLim = makeLimiter(PROBE.POST_PER_IP, PROBE.POST_PER_IP_WINDOW_MS);
  const globalLim = makeLimiter(PROBE.POST_GLOBAL_PER_MIN, 60_000, 1);
  const stored = app.metrics.counter('netprobe_results_total', 'netprobe results stored');
  const rateLimit = (req) => globalLim.hit('*', Date.now()) || ipLim.hit(req.ip || '?', Date.now());

  app.http.post('/v1/netprobe', async (req, res) => {
    const r = validateResult(req.json);
    if (!r) return res.error(400, API_ERR.BAD_REQUEST);
    const via = cameThroughCloudflare(req.headers) ? 'tunnel' : 'local';
    const row = await app.db.one(
      `INSERT INTO netprobe_results (carrier, net_type, device, samples, lost, median_ms, p95_ms, jitter_ms, min_ms, max_ms, via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [r.carrier, r.netType, r.device, r.samples, r.lost, r.medianMs, r.p95Ms, r.jitterMs, r.minMs, r.maxMs, via]);
    stored.inc(1, { carrier: r.carrier });
    return { ok: true, id: row.id };
  }, { rateLimit, bodyLimit: 2048 });

  // ---- service + admin read API ---------------------------------------------------------------------------------
  async function summary({ days = 14 } = {}) {
    const d = Math.max(1, Math.min(365, Math.floor(Number(days) || 14)));
    const { rows } = await app.db.query(
      `SELECT carrier, net_type AS "netType", count(*)::int AS n,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY median_ms)::numeric, 1)::float8 AS "medianMs",
              round(percentile_cont(0.95) WITHIN GROUP (ORDER BY p95_ms)::numeric, 1)::float8 AS "p95Ms",
              round(avg(jitter_ms)::numeric, 1)::float8 AS "jitterMs",
              round((100.0 * sum(lost) / NULLIF(sum(samples), 0))::numeric, 2)::float8 AS "lossPct",
              max(created_at) AS "lastAt"
         FROM netprobe_results
        WHERE created_at > now() - make_interval(days => $1)
        GROUP BY carrier, net_type
        ORDER BY carrier, net_type`, [d]);
    return rows;
  }
  async function recent(limit = 50) {
    const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
    const { rows } = await app.db.query(
      `SELECT id, created_at AS "at", carrier, net_type AS "netType", device, samples, lost,
              median_ms AS "medianMs", p95_ms AS "p95Ms", jitter_ms AS "jitterMs", min_ms AS "minMs", max_ms AS "maxMs", via
         FROM netprobe_results ORDER BY id DESC LIMIT $1`, [n]);
    return rows;
  }
  async function purge(days = PROBE.RETENTION_DAYS) {
    const r = await app.db.query(`DELETE FROM netprobe_results WHERE created_at < now() - make_interval(days => $1)`, [days]);
    return r.rowCount;
  }
  app.provide('netprobe', { summary, recent, purge, CARRIERS, NET_TYPES, stats: () => ({ open, perIpKeys: perIp.size }) });

  // GET /admin/api/netprobe is served by the admin module (server/src/admin/index.js) from this service — one route,
  // behind the admin port's full security layer (integration 15/10/2026).

  app.bus.on('start', () => {
    app.timers.every(6 * 3600_000, 'netprobe_purge', async () => {
      try { const n = await purge(); if (n) log.info('netprobe purge', { deleted: n }); } catch (e) { log.warn('netprobe purge failed', { err: e }); }
      const now = Date.now(); ipLim.sweep(now);
    });
  });
}
