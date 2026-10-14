// admin/index.js — OWNER: S3. Localhost-only admin HTTP (port 9101) + static Vietnamese page server/admin/ (SPEC §3.3):
// live CCU / tick / bandwidth / degrade, live 2D map (js/mapdata.js ROADS_DT), chat feed with flagged lines, report
// queue with server-side context + one-click sanctions, player search, invite batches, broadcast, restart notice,
// filter lists (view / edit / reload / test), admin_audit log, netprobe results by carrier, alerts.
//
// Every /admin* request goes through admin/security.js (IP allow-list, Host check, same-origin, Bearer token or
// session cookie + CSRF header). API: see the route table below and docs/multiplayer/SERVER.md §3.
// Bus events emitted for S2: 'sanction' (via chat), 'admin:broadcast' {text}, 'admin:restart' {seconds, text}.
import fs from 'node:fs';
import path from 'node:path';
import { createRouter, httpError } from '../http/router.js';
import { publicConfig } from '../config.js';
import { analyzeChat } from '../../../js/shared/textfilter.js';
import { REPORT_REASON } from '../../../js/shared/protocol.js';
import { SEC_HEADERS, safeEqual, createIpAllow, createHostAllow, createSessions, cookieValue } from './security.js';
import { createInviteBatch, listInviteBatches, normalizeInviteCode, hashInviteCode, generateInviteCode } from './invites.js';
import { createLive } from './live.js';
import { netprobeSummary } from './netprobe.js';
import { isUuid, extraEnv } from '../chat/util.js';
import { LIST_FILES } from '../chat/lists.js';
import { fmtDur } from '../chat/index.js';

const STATIC = { 'index.html': 'text/html; charset=utf-8', 'admin.js': 'text/javascript; charset=utf-8', 'admin.css': 'text/css; charset=utf-8' };
const MIN = 60_000;
// one-click actions → sanction
const ACTIONS = {
  warn: { kind: 'warn', ms: null },
  mute10m: { kind: 'mute', ms: 10 * MIN },
  mute1h: { kind: 'mute', ms: 60 * MIN },
  mute24h: { kind: 'mute', ms: 24 * 60 * MIN },
  mute_forever: { kind: 'mute', ms: null },
  shadow: { kind: 'shadow', ms: 'days' },
  kick: { kind: 'kick', ms: null },
  ban: { kind: 'ban', ms: 'days' },
};

export function register(app) {
  const log = app.log.child({ mod: 'admin' });
  const ipOk = createIpAllow(extraEnv(app, 'ADMIN_ALLOW_IPS'));
  const hostOk = createHostAllow(extraEnv(app, 'ADMIN_ALLOW_HOSTS'));
  const sessions = createSessions();
  const live = createLive(app);
  const staticDir = path.join(app.config.serverRoot, 'admin');
  const mapdataPath = path.join(app.config.repoRoot, 'js', 'mapdata.js');
  const cache = new Map();
  const readStatic = (p) => {
    if (!cache.has(p)) cache.set(p, fs.readFileSync(p));
    return cache.get(p);
  };
  const chat = () => app.get('chat');

  app.provide('invites', { normalize: normalizeInviteCode, hash: hashInviteCode, generate: generateInviteCode,
    createBatch: (o) => createInviteBatch(app.db, o), listBatches: () => listInviteBatches(app.db) });

  // ---- auth for the inner router -----------------------------------------------------------------------------------
  const authFn = (req) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      if (safeEqual(h.slice(7).trim(), app.config.secrets.adminToken)) { req.admin = { actor: 'token', via: 'bearer' }; return true; }
      return false;
    }
    const s = sessions.get(cookieValue(req.headers.cookie, 'hp_admin'));
    if (!s) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD' && !safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) return false;
    req.admin = { actor: 'owner', via: 'session', sid: s.sid };
    return true;
  };
  const r = createRouter({ log, metrics: app.metrics, name: 'admin_ui', allowedOrigins: [], allowNoOrigin: true, bodyLimit: 64 * 1024, auth: { admin: authFn } });
  const A = { auth: 'admin' };

  // every /admin* request: IP → Host → same-origin → JSON-only writes → inner router (with security headers)
  // (IP + Host apply to the WHOLE admin port, /metrics and /healthz included: inside Docker it listens on the container
  // network, so a neighbour container must not reach it either)
  app.admin.use(async (req, res) => {
    const deny = (status, code) => { res.send(status, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ error: code })); return true; };
    if (!ipOk(req.ip)) { log.warn('admin port request from a non-allowed address', { ip: req.ip, path: req.path }); return deny(403, 'forbidden_ip'); }
    if (!hostOk(req.headers.host)) return deny(403, 'forbidden_host');
    if (req.path !== '/admin' && !req.path.startsWith('/admin/')) return false;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      if (origin.toLowerCase() !== `http://${String(req.headers.host).toLowerCase()}`) return deny(403, 'origin_not_allowed');
      delete req.headers.origin;   // same-origin: the inner router treats it like a no-Origin request
    } else if (origin === 'null') return deny(403, 'origin_not_allowed');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.startsWith('application/json')) return deny(415, 'json_required');
    }
    const wrapped = {
      get sent() { return res.sent; },
      get aborted() { return res.aborted; },
      send: (status, headers, body) => res.send(status, { ...SEC_HEADERS, ...(headers || {}) }, body),
    };
    await r.handle(req, wrapped);
    return true;
  });

  async function audit(req, action, target = null, detail = null) {
    try {
      await app.db.query('INSERT INTO admin_audit (actor, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5)',
        [req.admin?.actor || 'anonymous', action, target == null ? null : String(target).slice(0, 200), detail == null ? null : JSON.stringify(detail), req.ip || null]);
    } catch (e) { log.warn('admin_audit insert failed', { err: e.message }); }
  }
  const body = (req) => (req.json && typeof req.json === 'object' ? req.json : {});
  const str = (v, max = 200) => (v == null ? null : String(v).slice(0, max));
  const intParam = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

  // ---- static ------------------------------------------------------------------------------------------------------
  const sendStatic = (res, file) => res.send(200, { 'content-type': STATIC[file] }, readStatic(path.join(staticDir, file)));
  r.get('/admin', (req, res) => sendStatic(res, 'index.html'));
  r.get('/admin/static/:file', (req, res) => {
    const f = req.params.file;
    if (!Object.hasOwn(STATIC, f) || f === 'index.html') throw httpError(404, 'not_found');
    sendStatic(res, f);
  });
  // the city map, read-only: the page imports ROADS_DT from it (S5 copies js/mapdata.js into the image)
  r.get('/admin/mapdata.js', (req, res) => {
    if (!fs.existsSync(mapdataPath)) throw httpError(404, 'not_found');
    res.send(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=3600' }, readStatic(mapdataPath));
  });

  // ---- session -----------------------------------------------------------------------------------------------------
  r.post('/admin/api/login', async (req, res) => {
    const allowed = sessions.loginAllowed(req.ip);
    if (!allowed.ok) return res.json({ error: 'locked', retryAfterS: allowed.retryAfterS }, 429, { 'retry-after': String(allowed.retryAfterS) });
    const token = str(body(req).token, 512) || '';
    if (!safeEqual(token.trim(), app.config.secrets.adminToken)) {
      sessions.loginFailed(req.ip);
      await audit({ ip: req.ip, admin: { actor: 'anonymous' } }, 'login_failed');
      return res.error(401, 'bad_token');
    }
    const s = sessions.create(req.ip);
    await audit({ ip: req.ip, admin: { actor: 'owner' } }, 'login');
    res.json({ ok: true, csrf: s.csrf, ttlS: sessions.ttlMs / 1000 }, 200,
      { 'set-cookie': `hp_admin=${s.sid}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${sessions.ttlMs / 1000}` });
  });
  r.post('/admin/api/logout', async (req, res) => {
    if (req.admin?.sid) sessions.destroy(req.admin.sid);
    await audit(req, 'logout');
    res.json({ ok: true }, 200, { 'set-cookie': 'hp_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0' });
  }, A);
  r.get('/admin/api/session', (req) => {
    const s = sessions.get(cookieValue(req.headers.cookie, 'hp_admin'));
    return s ? { ok: true, csrf: s.csrf } : { ok: false };
  });

  // ---- live --------------------------------------------------------------------------------------------------------
  r.get('/admin/api/status', async () => ({
    health: await app.health(), sim: app.has('sim') ? app.get('sim').stats() : null, metrics: app.metrics.snapshot(),
    config: publicConfig(app.config), services: app.services(), chat: chat().stats(),
  }), A);

  let openCounts = { at: 0, v: null };
  r.get('/admin/api/live', async (req) => {
    const since = intParam(req.queryObj.since, 0, 0, Number.MAX_SAFE_INTEGER);
    if (Date.now() - openCounts.at > 3000) {
      const c = await app.db.one(`SELECT count(*) FILTER (WHERE source = 'player')::int AS reports, count(*) FILTER (WHERE source <> 'player')::int AS flags
        FROM reports WHERE status = 'open'`);
      openCounts = { at: Date.now(), v: c };
    }
    const lines = chat().recent({ since, limit: since ? 200 : 100 }).map(publicLine);
    return { stats: live.stats(), players: live.players(), chat: lines, seq: chat().seq, open: openCounts.v, alerts: app.has('alerts') ? app.get('alerts').enabled : false };
  }, A);
  const publicLine = (l) => ({ seq: l.seq, ref: l.ref, at: new Date(l.at).toISOString(), accountId: l.accountId, netId: l.netId, name: l.name,
    channel: l.channel, text: l.text, raw: l.raw || undefined, action: l.action, reasons: l.reasons, flagged: l.flagged, shadow: l.shadow, x: l.x, z: l.z });

  r.get('/admin/api/chat', async (req) => {
    const q = req.queryObj;
    const where = [], params = [];
    if (q.account) { if (!isUuid(q.account)) throw httpError(400, 'bad_request'); params.push(q.account); where.push(`account_id = $${params.length}`); }
    if (q.q) { params.push('%' + String(q.q).slice(0, 100).replace(/[%_\\]/g, '\\$&') + '%'); where.push(`(text ILIKE $${params.length} OR raw ILIKE $${params.length} OR name ILIKE $${params.length})`); }
    if (q.flagged === '1') where.push(`(flagged OR action = 'block')`);
    if (q.before) { params.push(intParam(q.before, 0, 0, Number.MAX_SAFE_INTEGER)); where.push(`id < $${params.length}`); }
    params.push(intParam(q.limit, 100, 1, 500));
    const rows = (await app.db.query(`SELECT id, ref, at, account_id, net_id, name, channel, text, raw, action, reasons, flagged, shadow, x, z FROM chat_log
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${params.length}`, params)).rows;
    return { lines: rows };
  }, A);

  // ---- reports -----------------------------------------------------------------------------------------------------
  r.get('/admin/api/reports', async (req) => {
    const st = req.queryObj.status || 'open';
    const params = [intParam(req.queryObj.limit, 50, 1, 200)];
    let where = '';
    if (st !== 'all') { if (!['open', 'actioned', 'dismissed'].includes(st)) throw httpError(400, 'bad_request'); params.push(st); where = 'WHERE r.status = $2'; }
    // child-safety flags (self-harm, personal-info probing) always sort first (SO-4)
    const rows = (await app.db.query(`SELECT r.*, (SELECT count(*)::int FROM reports x WHERE x.target_id = r.target_id AND x.status = 'open') AS open_on_target,
        (r.source = 'filter' AND (r.detail LIKE '%self_harm%' OR r.detail LIKE '%personal_info%')) AS safety
      FROM reports r ${where} ORDER BY (r.status = 'open' AND r.source = 'filter' AND (r.detail LIKE '%self_harm%' OR r.detail LIKE '%personal_info%')) DESC, r.at DESC LIMIT $1`, params)).rows;
    return { reports: rows.map((x) => ({ ...x, sanction: chat().sanctionOf(x.target_id) })) };
  }, A);

  async function applyAction(req, accountId, action, { days, note, reportId } = {}) {
    const a = ACTIONS[action];
    if (!a) throw httpError(400, 'bad_action');
    if (!isUuid(accountId)) throw httpError(400, 'bad_request');
    let ms = a.ms;
    // an explicit number of days is required: 0 = permanent; an emptied field used to silently mean a PERMANENT ban
    // (Number('') = 0) — fixer round 1
    if (ms === 'days') {
      if (days === '' || days == null || !Number.isFinite(Number(days)) || Number(days) < 0) throw httpError(400, 'days_required');
      const d = Number(days);
      ms = d > 0 ? Math.min(d, 3650) * 86400_000 : null;
    }
    const s = await chat().sanction({ accountId, kind: a.kind, ms, reason: str(note) || `quản trị: ${action}`, source: 'admin', reportId: reportId || null, actor: req.admin?.actor || 'owner' });
    await audit(req, 'sanction', accountId, { action, kind: a.kind, duration: fmtDur(ms), reportId: reportId || null, note: str(note) });
    return s;
  }

  r.post('/admin/api/reports/:id/action', async (req) => {
    const id = intParam(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
    const b = body(req);
    const rep = await app.db.one('SELECT id, target_id, status FROM reports WHERE id = $1', [id]);
    if (!rep) throw httpError(404, 'not_found');
    if (b.action === 'dismiss') {
      await app.db.query(`UPDATE reports SET status = 'dismissed', resolved_at = now(), resolved_by = $2, resolution = $3 WHERE id = $1`, [id, req.admin.actor, str(b.note) || 'bỏ qua']);
      // dismissing a report also lifts the automatic mute it triggered (a brigade must not outlive the owner's "no")
      const auto = (await app.db.query(`SELECT id FROM sanctions WHERE report_id = $1 AND source = 'auto_report' AND revoked_at IS NULL`, [id])).rows;
      for (const x of auto) await chat().revokeSanction(x.id, req.admin.actor || 'owner');
      await audit(req, 'report_dismiss', id, { note: str(b.note), revokedAuto: auto.map((x) => x.id) });
      return { ok: true, revoked: auto.length };
    }
    const s = await applyAction(req, rep.target_id, b.action, { days: b.days, note: b.note, reportId: id });
    // the same decision closes the other open PLAYER reports on that player; filter flags (self-harm, personal-info
    // probing, …) stay open — muting a child for swearing must not bury the child's self-harm flag (SO-4)
    const upd = await app.db.query(`UPDATE reports SET status = 'actioned', resolved_at = now(), resolved_by = $2, resolution = $3
      WHERE (id = $1 OR (target_id = $4 AND status = 'open' AND source = 'player'))`, [id, req.admin.actor, b.action, rep.target_id]);
    return { ok: true, sanction: s, closed: upd.rowCount };
  }, A);

  // ---- players -----------------------------------------------------------------------------------------------------
  r.get('/admin/api/players', async (req) => {
    const q = String(req.queryObj.q || '').trim().slice(0, 64);
    const online = new Map(live.players().map((p) => [p.accountId, p]));
    let rows;
    if (!q) {
      const ids = [...online.keys()].filter(isUuid).slice(0, 200);
      rows = (await app.db.query(`SELECT a.id, a.kind, a.status, a.created_at, a.last_seen, a.play_seconds, c.display_name, c.nickname
        FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
        WHERE a.id = ANY($1::uuid[]) OR a.last_seen > now() - interval '1 day' ORDER BY a.last_seen DESC NULLS LAST LIMIT 100`, [ids])).rows;
    } else {
      const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
      rows = (await app.db.query(`SELECT a.id, a.kind, a.status, a.created_at, a.last_seen, a.play_seconds, c.display_name, c.nickname
        FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
        WHERE c.display_name ILIKE $1 OR c.nickname ILIKE $1 OR a.id::text = $2 ORDER BY a.last_seen DESC NULLS LAST LIMIT 50`, [like, q.toLowerCase()])).rows;
    }
    return { players: rows.map((p) => ({ ...p, online: online.has(p.id), netId: online.get(p.id)?.netId ?? null, sanction: chat().sanctionOf(p.id) })) };
  }, A);

  r.get('/admin/api/players/:id', async (req) => {
    const id = req.params.id;
    if (!isUuid(id)) throw httpError(400, 'bad_request');
    const acc = await app.db.one(`SELECT a.*, c.display_name, c.nickname, c.pos_x, c.pos_z FROM accounts a LEFT JOIN characters c ON c.account_id = a.id WHERE a.id = $1`, [id]);
    if (!acc) throw httpError(404, 'not_found');
    delete acc.recovery_hash;
    const [sanctions, reports, lines, blocks] = await Promise.all([
      app.db.query('SELECT * FROM sanctions WHERE account_id = $1 ORDER BY starts_at DESC LIMIT 50', [id]),
      app.db.query(`SELECT id, at, source, reporter_name, reason, detail, status, resolution FROM reports WHERE target_id = $1 ORDER BY at DESC LIMIT 30`, [id]),
      app.db.query('SELECT id, ref, at, text, raw, action, reasons, flagged, shadow FROM chat_log WHERE account_id = $1 ORDER BY id DESC LIMIT 50', [id]),
      app.db.query(`SELECT (SELECT count(*)::int FROM social_blocks WHERE account_id = $1) AS blocking, (SELECT count(*)::int FROM social_blocks WHERE target_id = $1) AS blocked_by`, [id]),
    ]);
    const on = live.players().find((p) => p.accountId === id) || null;
    return { account: acc, online: on, sanction: chat().sanctionOf(id), sanctions: sanctions.rows, reports: reports.rows, chat: lines.rows, blocks: blocks.rows[0] };
  }, A);

  r.post('/admin/api/players/:id/sanction', async (req) => {
    const b = body(req);
    const s = await applyAction(req, req.params.id, b.action, { days: b.days, note: b.note });
    return { ok: true, sanction: s };
  }, A);

  r.post('/admin/api/sanctions/:id/revoke', async (req) => {
    const id = intParam(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
    const out = await chat().revokeSanction(id, req.admin.actor);
    if (!out) throw httpError(404, 'not_found');
    await audit(req, 'sanction_revoke', out.accountId, { id, kind: out.kind });
    return { ok: true, ...out };
  }, A);

  // ---- invites -----------------------------------------------------------------------------------------------------
  r.get('/admin/api/invites', async () => ({ batches: await listInviteBatches(app.db), inviteRequired: app.config.inviteRequired }), A);
  r.post('/admin/api/invites', async (req) => {
    const b = body(req);
    const out = await createInviteBatch(app.db, { count: b.count, uses: b.uses, days: b.days, note: b.note, batch: b.batch, actor: req.admin.actor });
    await audit(req, 'invites_create', out.batch, { count: out.codes.length, uses: out.uses, expiresAt: out.expiresAt, note: str(b.note) });
    return out;
  }, A);

  // ---- broadcast / restart -----------------------------------------------------------------------------------------
  r.post('/admin/api/broadcast', async (req) => {
    const text = String(body(req).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) throw httpError(400, 'empty');
    const line = chat().systemLine(text, 'owner');
    const n = app.bus.emit('admin:broadcast', { text, ref: line.ref });
    await audit(req, 'broadcast', null, { text });
    return { ok: true, listeners: n, ref: line.ref };
  }, A);
  r.post('/admin/api/restart', async (req) => {
    const b = body(req);
    const seconds = intParam(b.seconds, 300, 10, 24 * 3600);
    const text = str(b.text) || `Máy chủ sẽ khởi động lại sau ${fmtDur(seconds * 1000)}. Tiến trình của bạn được lưu tự động.`;
    chat().systemLine(text, 'owner');
    const n = app.bus.emit('admin:restart', { seconds, text });
    if (app.has('alerts')) app.get('alerts').send('restart', `Đã báo người chơi: khởi động lại sau ${fmtDur(seconds * 1000)}.`).catch(() => {});
    await audit(req, 'restart_notice', null, { seconds, text });
    return { ok: true, seconds, listeners: n };
  }, A);

  // ---- filter ------------------------------------------------------------------------------------------------------
  r.get('/admin/api/filter', async () => {
    const auditRows = (await app.db.query('SELECT id, at, actor, action, version, files, changes, ok, error FROM filter_audit ORDER BY id DESC LIMIT 20')).rows;
    return { version: chat().listsVersion(), lists: chat().getLists(), names: LIST_FILES, audit: auditRows };
  }, A);
  r.post('/admin/api/filter/reload', async (req) => {
    const out = await chat().reloadLists(req.admin.actor, 'reload');
    await audit(req, 'filter_reload', out.version, { changed: Object.keys(out.changes), missing: out.missing });
    return out;
  }, A);
  r.put('/admin/api/filter/:list', async (req) => {
    const name = req.params.list;
    if (!LIST_FILES.includes(name)) throw httpError(404, 'not_found');
    const text = body(req).text;
    if (typeof text !== 'string') throw httpError(400, 'bad_request');
    let out;
    try { out = await chat().saveList(name, text, req.admin.actor); } catch (e) { throw httpError(400, 'invalid_list', { detail: e.message }); }
    await audit(req, 'filter_save', name, { version: out.version, changes: out.changes[name] ? { nAdded: out.changes[name].nAdded, nRemoved: out.changes[name].nRemoved } : null });
    return out;
  }, A);
  r.post('/admin/api/filter/test', async (req) => {
    const text = String(body(req).text ?? '').slice(0, 500);
    const a = analyzeChat(text);
    return { action: a.action, ok: a.ok, text: a.text, reasons: a.reasons, flag: a.flag, support: a.support, hits: a.hits };
  }, A);

  // ---- audit / netprobe / alerts -----------------------------------------------------------------------------------
  r.get('/admin/api/audit', async (req) => ({
    rows: (await app.db.query('SELECT id, at, actor, action, target, detail, ip FROM admin_audit ORDER BY id DESC LIMIT $1', [intParam(req.queryObj.limit, 100, 1, 500)])).rows,
  }), A);
  // one route for both shapes: the page's {available, rows} (generic table reader) + S5's service {days, summary, recent}
  r.get('/admin/api/netprobe', async (req) => {
    // S5's service knows the real table (loss = lost / samples); the generic reader is the fallback without it
    const days = intParam(req.queryObj.days, 14, 1, 365);
    if (app.has('netprobe')) {
      const np = app.get('netprobe');
      try {
        const summary = await np.summary({ days });
        const recent = await np.recent(intParam(req.queryObj.limit, 50, 1, 500));
        const rows = summary.map((x) => ({ carrier: x.carrier, net: x.netType, n: x.n, medianMs: x.medianMs, p95Ms: x.p95Ms, jitterMs: x.jitterMs, lossPct: x.lossPct, lastAt: x.lastAt }));
        return { available: true, table: 'netprobe_results', days, rows, summary, recent };
      } catch (e) { app.log.warn('netprobe summary failed', { err: e.message }); }
    }
    return netprobeSummary(app.db, { days });
  }, A);
  r.get('/admin/api/alerts', () => {
    const al = app.has('alerts') ? app.get('alerts') : null;
    return { enabled: !!al?.enabled, recent: al?.recent ? al.recent() : [] };
  }, A);
  // ops scripts (backup failure, …) raise an owner alert through the admin API
  r.post('/admin/api/alert', async (req) => {
    const b = body(req);
    const kind = String(b.kind || 'ops').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'ops';
    const text = str(b.text, 500);
    if (!text) throw httpError(400, 'empty');
    const sent = app.has('alerts') ? await app.get('alerts').send(kind, text) : false;
    await audit(req, 'alert', kind, { text, sent });
    return { ok: true, sent };
  }, A);

  // reason labels for the page
  r.get('/admin/api/meta', () => ({ reportReasons: REPORT_REASON, actions: Object.keys(ACTIONS), version: app.config.version }), A);
}
