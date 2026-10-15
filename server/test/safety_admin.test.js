// S3 — admin port: security layers (IP / Host / Origin / token / session + CSRF / JSON-only / login lockout), every
// admin API used by the page, audit log, secrets never echoed; player-facing moderation API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { bootTestServer } from './helpers/client.mjs';
import { makeAccount, session, rawRequest } from './helpers/safety.mjs';
import { createIpAllow, createHostAllow, createSessions, normalizeIp } from '../src/admin/security.js';
import { hashInviteCode, normalizeInviteCode, generateInviteCode, INVITE_ALPHABET } from '../src/admin/invites.js';
import { CHANNEL, REPORT_REASON } from '../../js/shared/protocol.js';

let s, dataDir, token, base, host;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-s3-admin-'));
  s = await bootTestServer({ TRANSPORT: 'ws', ...(process.env.TEST_DB_URL ? { DB_URL: process.env.TEST_DB_URL } : {}), DATA_DIR: dataDir });
  token = s.config.secrets.adminToken;
  base = s.admin;
  host = `127.0.0.1:${s.app.ports.admin}`;
});
after(async () => { await s.app.stop('test'); fs.rmSync(dataDir, { recursive: true, force: true }); });

const bearer = () => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' });
const api = (method, p, body, headers = bearer()) => rawRequest(base + p, { method, headers, body });

test('security helpers: IP allow-list, Host allow-list, login lockout', () => {
  const ip = createIpAllow('');
  for (const ok of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '[::1]']) assert.equal(ip(ok), true, ok);
  for (const bad of ['172.18.0.1', '10.0.0.5', '192.168.1.10', '::ffff:10.0.0.1', 'fe80::1', '', 'garbage', '1.2.3.4']) assert.equal(ip(bad), false, bad);
  const ip2 = createIpAllow('172.30.0.1/32, fd00::/8');
  assert.equal(ip2('172.30.0.1'), true); assert.equal(ip2('172.30.0.2'), false); assert.equal(ip2('fd12::5'), true);
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  const h = createHostAllow('');
  for (const ok of ['127.0.0.1:9121', 'localhost:9121', 'LOCALHOST', '[::1]:9121', '127.0.0.1']) assert.equal(h(ok), true, ok);
  for (const bad of ['evil.example', 'evil.example:9121', '127.0.0.1.evil.example', 'xxx.trycloudflare.com', '']) assert.equal(h(bad), false, bad);
  // lockout: 5 failures / IP; 20 failures overall
  let t = 0;
  const ss = createSessions({ now: () => t });
  for (let i = 0; i < 5; i++) { assert.equal(ss.loginAllowed('a').ok, true); ss.loginFailed('a'); }
  assert.equal(ss.loginAllowed('a').ok, false);
  assert.equal(ss.loginAllowed('b').ok, true);
  t += 16 * 60_000;
  assert.equal(ss.loginAllowed('a').ok, true);
  for (let i = 0; i < 20; i++) ss.loginFailed('ip' + i);
  assert.equal(ss.loginAllowed('fresh').ok, false, 'global lock');
  // sessions expire when idle
  t = 0;
  const s2 = createSessions({ now: () => t, idleMs: 1000 });
  const sess = s2.create('x');
  assert.ok(s2.get(sess.sid));
  t += 1001;
  assert.equal(s2.get(sess.sid), null);
});

test('invite codes: unambiguous alphabet, normalisation, sha256 hash', () => {
  const c = generateInviteCode();
  assert.match(c, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  for (const ch of c.replace('-', '')) assert.ok(INVITE_ALPHABET.includes(ch));
  assert.equal(normalizeInviteCode(' abcde-fghjk '), 'ABCDEFGHJK');
  assert.deepEqual(hashInviteCode('abcde fghjk'), crypto.createHash('sha256').update('ABCDEFGHJK').digest());
});

test('admin page + static files + mapdata with security headers', async () => {
  const page = await rawRequest(base + '/admin');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.match(page.text, /Quản trị máy chủ/);
  assert.ok(!page.text.includes(token));
  assert.equal((await rawRequest(base + '/admin/static/admin.js')).status, 200);
  assert.equal((await rawRequest(base + '/admin/static/admin.css')).status, 200);
  assert.equal((await rawRequest(base + '/admin/static/index.html')).status, 404);
  assert.equal((await rawRequest(base + '/admin/static/..%2F..%2Fsrc%2Fconfig.js')).status, 404);
  const md = await rawRequest(base + '/admin/mapdata.js');
  assert.equal(md.status, 200); assert.match(md.text, /export const ROADS_DT/);
});

test('Host / Origin / content-type / token checks', async () => {
  assert.equal((await rawRequest(base + '/admin', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await rawRequest(base + '/admin/api/status', { headers: { ...bearer(), host: 'attacker.trycloudflare.com' } })).status, 403);
  assert.equal((await rawRequest(base + '/metrics', { headers: { host: 'attacker.trycloudflare.com' } })).status, 403);
  assert.equal((await rawRequest(base + '/metrics')).status, 200);
  assert.equal((await rawRequest(base + '/healthz')).status, 200);
  // cross-site request (even with the right token) → 403; same-origin → OK
  const cross = await api('POST', '/admin/api/broadcast', { text: 'x' }, { ...bearer(), origin: 'https://evil.example' });
  assert.equal(cross.status, 403); assert.equal(cross.json.error, 'origin_not_allowed');
  assert.equal((await api('POST', '/admin/api/broadcast', { text: 'x' }, { ...bearer(), origin: 'null' })).status, 403);
  const same = await api('POST', '/admin/api/filter/test', { text: 'đ.m' }, { ...bearer(), origin: `http://${host}` });
  assert.equal(same.status, 200); assert.equal(same.json.action, 'block');
  // JSON only for writes (no form posts)
  const form = await rawRequest(base + '/admin/api/filter/test', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/x-www-form-urlencoded' }, body: 'text=x' });
  assert.equal(form.status, 415);
  // token required
  assert.equal((await rawRequest(base + '/admin/api/live')).status, 401);
  assert.equal((await rawRequest(base + '/admin/api/live', { headers: { authorization: 'Bearer ' + token.slice(0, -1) + 'x' } })).status, 401);
  assert.equal((await api('GET', '/admin/api/live')).status, 200);
  // OPTIONS preflight from anywhere is refused
  assert.equal((await rawRequest(base + '/admin/api/live', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })).status, 403);
});

test('login session: cookie HttpOnly SameSite=Strict, CSRF header required for writes, logout', async () => {
  const bad = await rawRequest(base + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: { token: 'wrong-token-wrong-token-wrong' } });
  assert.equal(bad.status, 401);
  const ok = await rawRequest(base + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: { token } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers['set-cookie'][0];
  assert.match(cookie, /^hp_admin=[A-Za-z0-9_-]{40,};/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/admin/);
  assert.ok(!ok.text.includes(token));
  const sid = cookie.split(';')[0];
  const csrf = ok.json.csrf;
  const ck = { cookie: sid, 'content-type': 'application/json' };
  assert.equal((await rawRequest(base + '/admin/api/live', { headers: ck })).status, 200);
  assert.equal((await rawRequest(base + '/admin/api/session', { headers: ck })).json.csrf, csrf);
  assert.equal((await rawRequest(base + '/admin/api/filter/test', { method: 'POST', headers: ck, body: { text: 'a' } })).status, 401, 'no CSRF header');
  assert.equal((await rawRequest(base + '/admin/api/filter/test', { method: 'POST', headers: { ...ck, 'x-csrf-token': 'nope' }, body: { text: 'a' } })).status, 401);
  assert.equal((await rawRequest(base + '/admin/api/filter/test', { method: 'POST', headers: { ...ck, 'x-csrf-token': csrf }, body: { text: 'a' } })).status, 200);
  const out = await rawRequest(base + '/admin/api/logout', { method: 'POST', headers: { ...ck, 'x-csrf-token': csrf }, body: {} });
  assert.equal(out.status, 200);
  assert.equal((await rawRequest(base + '/admin/api/live', { headers: ck })).status, 401);
  const audit = (await s.app.db.query(`SELECT action FROM admin_audit WHERE action IN ('login','login_failed','logout') ORDER BY id`)).rows.map((r) => r.action);
  assert.deepEqual(audit, ['login_failed', 'login', 'logout']);
});

test('live: players from the bus, chat feed with seq, stats; broadcast + restart notice reach the bus', async () => {
  const chat = s.app.get('chat');
  const a = await makeAccount(s.app.db, 'Live#0001');
  const sess = session(a, 'Live#0001', { netId: 7, x: 12.5, z: -40 });
  s.app.bus.emit('player:join', { session: sess });
  await chat.handle(sess, CHANNEL.SAY, 'xin chào quản trị');
  const r = await api('GET', '/admin/api/live?since=0');
  assert.equal(r.status, 200);
  assert.ok(r.json.players.some((p) => p.accountId === a && p.x === 12.5 && p.z === -40 && p.netId === 7));
  assert.equal(r.json.stats.ccu >= 1, true);
  assert.ok(r.json.chat.some((l) => l.text === 'xin chào quản trị'));
  const seq = r.json.seq;
  const r2 = await api('GET', '/admin/api/live?since=' + seq);
  assert.equal(r2.json.chat.length, 0);
  const got = [];
  const off1 = s.app.bus.on('admin:broadcast', (p) => got.push(['b', p.text]));
  const off2 = s.app.bus.on('admin:restart', (p) => got.push(['r', p.seconds]));
  assert.equal((await api('POST', '/admin/api/broadcast', { text: '  Tối nay có pháo hoa!  ' })).status, 200);
  assert.equal((await api('POST', '/admin/api/restart', { seconds: 300 })).status, 200);
  off1(); off2();
  assert.deepEqual(got, [['b', 'Tối nay có pháo hoa!'], ['r', 300]]);
  const sys = (await api('GET', '/admin/api/live?since=' + seq)).json.chat;
  assert.ok(sys.some((l) => l.action === 'system' && l.text === 'Tối nay có pháo hoa!'));
  s.app.bus.emit('player:leave', { session: sess });
  assert.ok(!(await api('GET', '/admin/api/live')).json.players.some((p) => p.accountId === a));
});

test('report queue → one-click sanction closes all open reports on the player; player search / detail / revoke', async () => {
  const chat = s.app.get('chat');
  const db = s.app.db;
  const target = await makeAccount(db, 'Phaquay#0042');
  const T = session(target, 'Phaquay#0042', { x: 10, z: 10 });
  const r1 = await chat.handle(T, CHANNEL.SAY, 'mày ăn cac à');   // blocked, logged
  for (let i = 0; i < 2; i++) {
    const rep = await makeAccount(db, `Bao${i}#000${i}`);
    assert.equal((await chat.report(session(rep, `Bao${i}#000${i}`, { x: 12, z: 10 }), target, REPORT_REASON.CHAT_ABUSE, r1.ref)).ok, true);
  }
  const list = await api('GET', '/admin/api/reports?status=open');
  const mine = list.json.reports.filter((x) => x.target_id === target);
  assert.equal(mine.length, 2);
  assert.ok(mine[0].context.some((l) => l.mark && l.action === 'block'));
  assert.equal(mine[0].open_on_target, 2);
  const act = await api('POST', `/admin/api/reports/${mine[0].id}/action`, { action: 'mute1h', note: 'chửi' });
  assert.equal(act.status, 200); assert.equal(act.json.closed, 2); assert.equal(act.json.sanction.seconds, 3600);
  assert.equal(chat.isMuted(target), true);
  assert.equal((await api('GET', '/admin/api/reports?status=open')).json.reports.filter((x) => x.target_id === target).length, 0);
  assert.equal((await api('POST', `/admin/api/reports/${mine[0].id}/action`, { action: 'explode' })).status, 400);
  // dismiss path
  const other = await makeAccount(db, 'Khac#0043');
  await chat.report(session(await makeAccount(db, 'Bao9#0009'), 'Bao9#0009'), other, REPORT_REASON.SPAM, 0);
  const rid = (await api('GET', '/admin/api/reports')).json.reports.find((x) => x.target_id === other).id;
  assert.equal((await api('POST', `/admin/api/reports/${rid}/action`, { action: 'dismiss' })).status, 200);
  assert.equal((await db.one('SELECT status FROM reports WHERE id = $1', [rid])).status, 'dismissed');
  // search + detail
  const found = await api('GET', '/admin/api/players?q=' + encodeURIComponent('phaquay'));
  assert.equal(found.json.players[0].id, target);
  assert.ok(found.json.players[0].sanction.mute > Date.now());
  const det = await api('GET', '/admin/api/players/' + target);
  assert.equal(det.status, 200);
  assert.equal(det.json.account.recovery_hash, undefined);
  assert.ok(det.json.sanctions.some((x) => x.kind === 'mute'));
  assert.ok(det.json.reports.length >= 2);
  // revoke + ban with expiry + kick events
  const sid = det.json.sanctions.find((x) => x.kind === 'mute').id;
  assert.equal((await api('POST', `/admin/api/sanctions/${sid}/revoke`, {})).status, 200);
  assert.equal(chat.isMuted(target), false);
  const kicks = [];
  const off = s.app.bus.on('sanction', (e) => kicks.push(e.kind));
  assert.equal((await api('POST', `/admin/api/players/${target}/sanction`, { action: 'kick' })).status, 200);
  assert.equal((await api('POST', `/admin/api/players/${target}/sanction`, { action: 'ban', days: 3 })).status, 200);
  off();
  assert.deepEqual(kicks, ['kick', 'ban']);
  assert.equal(chat.isBanned(target), true);
  assert.equal((await api('GET', '/admin/api/players/not-a-uuid')).status, 400);
});

test('invites: batch generator stores only hashes, codes shown once, batches listed', async () => {
  const r = await api('POST', '/admin/api/invites', { count: 5, uses: 2, days: 7, note: 'lớp 12A' });
  assert.equal(r.status, 200);
  assert.equal(r.json.codes.length, 5);
  const rows = (await s.app.db.query('SELECT code_hash, uses_left, uses_total, expires_at, note FROM invites WHERE batch = $1', [r.json.batch])).rows;
  assert.equal(rows.length, 5);
  const hashes = new Set(rows.map((x) => Buffer.from(x.code_hash).toString('hex')));
  for (const c of r.json.codes) assert.ok(hashes.has(hashInviteCode(c).toString('hex')));
  assert.ok(rows.every((x) => x.uses_left === 2 && x.uses_total === 2 && x.expires_at && x.note === 'lớp 12A'));
  const dump = JSON.stringify((await s.app.db.query('SELECT * FROM invites')).rows);
  for (const c of r.json.codes) assert.ok(!dump.includes(c) && !dump.includes(normalizeInviteCode(c)));
  const list = await api('GET', '/admin/api/invites');
  assert.ok(list.json.batches.some((b) => b.batch === r.json.batch && b.codes === 5 && b.uses_left === 10));
  assert.equal((await api('POST', '/admin/api/invites', { count: 100000 })).json.codes.length, 500);
  const svc = s.app.get('invites');
  assert.deepEqual(svc.hash('abcde-fghjk'), hashInviteCode('ABCDEFGHJK'));
});

test('filter: view lists, test a sentence, save a list into the data dir, reload, audit', async () => {
  const g = await api('GET', '/admin/api/filter');
  assert.equal(g.status, 200);
  assert.ok(g.json.names.includes('profanity'));
  assert.ok(g.json.lists.mild.includes('vcl'));
  assert.ok(g.json.audit.length >= 1);
  const t1 = await api('POST', '/admin/api/filter/test', { text: 'bánh tráng trộn' });
  assert.equal(t1.json.action, 'pass');
  const saved = await api('PUT', '/admin/api/filter/mild', { text: g.json.lists.mild + '\nbánh tráng\n' });
  assert.equal(saved.status, 200);
  assert.ok(fs.readFileSync(path.join(dataDir, 'filter', 'mild.txt'), 'utf8').includes('bánh tráng'));
  assert.deepEqual(saved.json.changes.mild.added, ['bánh tráng']);
  assert.equal((await api('POST', '/admin/api/filter/test', { text: 'bánh tráng trộn' })).json.action, 'mask');
  assert.equal((await api('PUT', '/admin/api/filter/nope', { text: 'x' })).status, 404);
  assert.equal((await api('PUT', '/admin/api/filter/mild', { text: 42 })).status, 400);
  // restore (delete the override → reload falls back to the committed list)
  fs.rmSync(path.join(dataDir, 'filter', 'mild.txt'));
  const re = await api('POST', '/admin/api/filter/reload', {});
  assert.equal(re.status, 200); assert.deepEqual(re.json.changes.mild.removed, ['bánh tráng']);
  assert.equal((await api('POST', '/admin/api/filter/test', { text: 'bánh tráng trộn' })).json.action, 'pass');
  const audit = (await s.app.db.query(`SELECT action FROM filter_audit ORDER BY id`)).rows.map((x) => x.action);
  assert.deepEqual(audit.slice(-2), ['reload', 'reload']);
});

// integration: S5's migration 030 creates netprobe_results and its service feeds this route (the generic reader is
// the fallback without the service — covered below on a scratch table name)
test('netprobe panel: empty → no rows; S5 rows aggregated by carrier; generic reader tolerates odd tables', async () => {
  const none = await api('GET', '/admin/api/netprobe');
  assert.equal(none.status, 200); assert.equal(none.json.rows.length, 0);
  await s.app.db.query(`INSERT INTO netprobe_results (carrier, net_type, samples, lost, median_ms, p95_ms, jitter_ms, min_ms, max_ms) VALUES
    ('viettel', '4g', 30, 0, 40, 60, 5, 30, 70), ('viettel', '4g', 30, 1, 60, 90, 7, 40, 99), ('viettel', 'wifi', 30, 0, 20, 30, 2, 15, 35), ('fpt', '5g', 30, 0, 30, 45, 3, 20, 50)`);
  const r = await api('GET', '/admin/api/netprobe');
  assert.equal(r.json.available, true);
  const a4 = r.json.rows.find((x) => x.carrier === 'viettel' && x.net === '4g');
  assert.equal(a4.n, 2); assert.equal(a4.medianMs, 50); assert.ok(Math.abs(a4.lossPct - 1.67) < 0.01, String(a4.lossPct));
  assert.equal(r.json.rows.length, 3);
  assert.ok(r.json.summary.length === 3 && r.json.recent.length === 4);
  await s.app.db.exec('DELETE FROM netprobe_results');
  const { netprobeSummary } = await import('../src/admin/netprobe.js');
  const fake = { query: async (sql) => (/information_schema.tables/.test(sql) ? { rows: [] } : { rows: [] }) };
  assert.equal((await netprobeSummary(fake)).available, false);
});

test('audit log covers every action; no secret ever appears in admin responses or the audit table', async () => {
  const r = await api('GET', '/admin/api/audit?limit=500');
  const actions = new Set(r.json.rows.map((x) => x.action));
  for (const a of ['login', 'login_failed', 'logout', 'sanction', 'sanction_revoke', 'report_dismiss', 'invites_create', 'broadcast', 'restart_notice', 'filter_save', 'filter_reload']) assert.ok(actions.has(a), a);
  assert.ok(r.json.rows.every((x) => x.ip));
  const al = await api('POST', '/admin/api/alert', { kind: 'backup', text: 'Sao lưu lỗi (thử)' });
  assert.equal(al.status, 200); assert.equal(al.json.sent, false);
  const st = await api('GET', '/admin/api/status');
  const all = [JSON.stringify(st.json), JSON.stringify(r.json), JSON.stringify((await api('GET', '/admin/api/alerts')).json),
    JSON.stringify((await s.app.db.query('SELECT * FROM admin_audit')).rows), JSON.stringify((await api('GET', '/admin/api/filter')).json)].join('\n');
  for (const [k, v] of Object.entries(s.config.secrets)) if (v && v.length >= 8) assert.ok(!all.includes(v), 'secret leaked: ' + k);
});

test('player moderation API: rules + lists public; /me and blocks need a valid access JWT', async () => {
  const rules = await rawRequest(s.game + '/v1/chat/rules');
  assert.equal(rules.status, 200); assert.equal(rules.json.radiusM, 40); assert.equal(rules.json.maxChars, 140);
  const f = await rawRequest(s.game + '/v1/chat/filter');
  assert.equal(f.status, 200); assert.ok(f.json.lists.profanity.length > 100);
  assert.equal((await rawRequest(s.game + '/v1/moderation/me')).status, 401);
  assert.equal((await rawRequest(s.game + '/v1/moderation/me', { headers: { authorization: 'Bearer abc.def.ghi' } })).status, 401);
  const me = await makeAccount(s.app.db, 'Toi#0100');
  const other = await makeAccount(s.app.db, 'Ban#0101');
  // integration: S2's 'auth' service verifies (iss/aud/kid); a bare EdDSA token with the right key is NOT enough
  const key = crypto.createPrivateKey({ key: Buffer.from(s.config.secrets.jwtPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const bare = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setSubject(me).setIssuedAt().setExpirationTime('5m').sign(key);
  assert.equal((await rawRequest(s.game + '/v1/moderation/me', { headers: { authorization: 'Bearer ' + bare } })).status, 401);
  const jwt = await s.app.get('auth').issueAccess({ id: me, displayName: 'Toi#0100', kind: 'guest' });
  const wrongKey = crypto.generateKeyPairSync('ed25519').privateKey;
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setSubject(me).setExpirationTime('5m').sign(wrongKey);
  const auth = { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' };
  assert.equal((await rawRequest(s.game + '/v1/moderation/me', { headers: { authorization: 'Bearer ' + forged } })).status, 401);
  const m = await rawRequest(s.game + '/v1/moderation/me', { headers: auth });
  assert.equal(m.status, 200); assert.deepEqual(m.json, { mute: 0, ban: 0, shadow: false });
  assert.equal((await rawRequest(s.game + '/v1/moderation/blocks', { method: 'POST', headers: auth, body: { targetAccountId: other, kind: 'block' } })).status, 200);
  const bl = await rawRequest(s.game + '/v1/moderation/blocks', { headers: auth });
  assert.equal(bl.json.blocks[0].accountId, other); assert.equal(bl.json.blocks[0].name, 'Ban#0101');
  assert.equal((await rawRequest(s.game + '/v1/moderation/blocks', { method: 'POST', headers: auth, body: { targetAccountId: me } })).status, 400);
  // the admin API is not on the game port
  assert.equal((await rawRequest(s.game + '/admin/api/live', { headers: bearer() })).status, 404);
  assert.equal((await rawRequest(s.game + '/admin', {})).status, 404);
});
