// node tools/qa/gpulock.mjs run -- node server/scripts/admin_smoke.mjs --out <dir> [--game 9120 --admin 9121]
// Admin page smoke test in ONE headless Chrome (software rendering, --disable-gpu) driven over the DevTools protocol
// through --remote-debugging-pipe (no extra port, no extra npm dependency). Boots a throw-away server (PGlite in
// memory, fresh random secrets), seeds demo players / chat / reports / invites / netprobe rows, logs in through the
// real login form, visits every tab, saves screenshots, and fails on any page error, console error or CSP violation.
// Always run it under the GPU lock (SPEC §1.5). CHROME_PATH overrides the Chrome location.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/main.js';
import { loadConfig } from '../src/config.js';
import { nullLogger } from '../src/log.js';
import { CHANNEL, REPORT_REASON } from '../../js/shared/protocol.js';
import { ROADS_DT } from '../../js/mapdata.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'hp-admin-smoke')));
const GAME = Number(arg('game', 9120)), ADMIN = Number(arg('admin', 9121));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server + demo data ---------------------------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-admin-smoke-data-'));
const config = loadConfig({ env: {}, envFile: null, overrides: { NODE_ENV: 'test', PGLITE_DIR: 'memory', LOG_LEVEL: 'silent', GAME_HOST: '127.0.0.1', ADMIN_HOST: '127.0.0.1', DATA_DIR: dataDir, TRANSPORT: 'ws' } });
const app = await startServer({ config, log: nullLogger, ports: { game: GAME, admin: ADMIN } });
const db = app.db, chat = app.get('chat');
const NAMES = ['Tùng', 'Linh', 'Hải', 'Mai', 'Đức', 'Lan', 'Minh', 'Hoa', 'Nam', 'Thảo', 'Quân', 'Hương', 'Bình', 'Ngọc', 'Phúc', 'Trang', 'Khoa', 'Yến', 'Sơn', 'Vy',
  'An', 'Huy', 'My', 'Long', 'Tâm', 'Hà', 'Việt', 'Chi', 'Dũng', 'Thu'];
const sessions = [];
let rnd = 12345;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) >>> 0) / 0x100000000);
for (let i = 0; i < NAMES.length; i++) {
  const a = await db.one('INSERT INTO accounts (kind, play_seconds, last_seen) VALUES ($1, $2, now()) RETURNING id', ['guest', 600 + i * 300]);
  const disp = `${NAMES[i]}#${String(1000 + i * 37).slice(-4)}`;
  await db.query('INSERT INTO characters (account_id, nickname, discriminator, display_name) VALUES ($1,$2,$3,$4)', [a.id, NAMES[i], 1000 + i * 37, disp]);
  const road = ROADS_DT[Math.floor(rand() * ROADS_DT.length)];
  const p = road.pts[Math.floor(rand() * road.pts.length)];
  const s = { accountId: a.id, netId: i + 1, displayName: disp, playSeconds: 3600, x: p[0], z: p[1], mode: i % 4 };
  sessions.push(s);
  app.bus.emit('player:join', { session: s });
}
// a cluster at the Opera square-ish centre so the map shows a crowd
for (let i = 0; i < 8; i++) { sessions[i].x = -30 + i * 6; sessions[i].z = 40 + (i % 3) * 5; }
const LINES = [[0, 'xin chào cả nhà'], [1, 'ai ra Nhà hát lớn không'], [2, 'đi ăn bánh đa cua đi'], [3, 'đẹp vl luôn'], [4, 'tối nay trời đẹp quá'],
  [5, 'mình mới vào game, chỉ mình với'], [6, 'đ.m thằng kia'], [7, 'em bao nhiêu tuổi'], [8, 'add zalo mình nhé 0912 345 678'], [9, 'haha vui ghê'],
  [10, 'chợ Sắt đông người ghê'], [11, 'mình muốn tự tử'], [12, 'ĐI ĐÂU THẾ MỌI NGƯỜI ƠIIIIII'], [6, 'mày ăn cac à'], [13, 'hẹn gặp lại nhé']];
const refs = [];
for (const [i, t] of LINES) { const r = await chat.handle(sessions[i], CHANNEL.SAY, t); refs.push(r.ref); }
for (const r of [1, 2, 3]) await chat.report(sessions[r], sessions[6].accountId, REPORT_REASON.CHAT_ABUSE, refs[6]);
await chat.report(sessions[4], sessions[8].accountId, REPORT_REASON.SPAM, refs[8]);
chat.systemLine('Chào mừng tới thử nghiệm kín Hải Phòng 3D!', 'owner');
await db.query(`INSERT INTO invites (code_hash, batch, uses_left, uses_total, expires_at, note) SELECT decode(md5(g::text), 'hex'), 'lo-demo', 1, 1, now() + interval '30 days', 'nhóm bạn' FROM generate_series(1, 12) g`);
await db.exec(`CREATE TABLE netprobe_results (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), carrier text, net text, median_ms real, p95_ms real, jitter_ms real, loss_pct real)`);
await db.query(`INSERT INTO netprobe_results (carrier, net, median_ms, p95_ms, jitter_ms, loss_pct) VALUES
  ('Nhà mạng A', '4G', 38, 61, 6, 0.5), ('Nhà mạng A', 'Wi-Fi', 21, 33, 3, 0), ('Nhà mạng B', '4G', 44, 80, 9, 1.2), ('Nhà mạng C', 'Wi-Fi', 18, 26, 2, 0), ('Khác', '5G', 29, 41, 4, 0)`);
await chat.flush();
// keep players moving a little so the live map changes
const mover = setInterval(() => { for (const s of sessions) { s.x += (rand() - 0.5) * 4; s.z += (rand() - 0.5) * 4; } }, 500);

// ---- Chrome over the DevTools pipe ------------------------------------------------------------------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-admin-smoke-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--remote-debugging-pipe', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const pipeW = chrome.stdio[3], pipeR = chrome.stdio[4];
let buf = '', nextId = 1;
const waiting = new Map(), listeners = [];
pipeR.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
    else for (const l of listeners) l(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, { resolve, reject });
  pipeW.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});

const problems = [];
const shots = [];
let sid;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true }));
  const S = (m, p) => send(m, p, sid);
  listeners.push((m) => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    // the deliberate wrong-password attempt answers 401: expected
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !(String(m.params.entry.url || '').endsWith('/admin/api/login') && /401/.test(m.params.entry.text))) problems.push(`log ${m.params.entry.source}: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  });
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  const viewport = async (width, height, mobile = false) => S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evaluate(expression).catch(() => false)) return true; await sleep(150); }
    throw new Error('timeout waiting for: ' + expression);
  };
  const shot = async (name) => {
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    shots.push(f);
  };
  const tab = async (name, ready) => { await evaluate(`document.querySelector('#tabs button[data-tab="${name}"]').click()`); await waitFor(ready); await sleep(400); };

  await viewport(1440, 900);
  await S('Page.navigate', { url: `http://127.0.0.1:${ADMIN}/admin` });
  await waitFor(`!document.getElementById('login').hidden`);
  await shot('01_dang_nhap');
  // log in through the real form (local test server, ephemeral token generated for this run)
  await evaluate(`(() => { const i = document.getElementById('tokenInput'); i.value = 'sai-ma-quan-tri-0000000000000'; document.getElementById('loginForm').requestSubmit(); })()`);
  await waitFor(`document.getElementById('loginMsg').textContent.length > 0`);
  await evaluate(`(() => { const i = document.getElementById('tokenInput'); i.value = ${JSON.stringify(config.secrets.adminToken)}; document.getElementById('loginForm').requestSubmit(); })()`);
  await waitFor(`!document.getElementById('app').hidden && document.querySelectorAll('#feed .line').length >= 10 && document.querySelectorAll('#chips .chip').length >= 6`);
  await sleep(3500);
  await shot('02_tong_quan');
  // zoom the map on the crowd
  await evaluate(`(() => { const c = document.getElementById('map'); const r = c.getBoundingClientRect(); for (let i = 0; i < 9; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); })()`);
  await sleep(1800);
  await shot('03_ban_do_phong_to');
  await tab('reports', `document.querySelectorAll('#reportList .report').length >= 2`);
  await shot('04_bao_cao');
  await tab('players', `document.querySelectorAll('#playerList .prow').length >= 5`);
  await evaluate(`[...document.querySelectorAll('#playerList .prow')].find((r) => r.textContent.includes('Minh'))?.click()`);
  await waitFor(`document.querySelector('#playerDetail h2') && document.querySelector('#playerDetail h2').textContent.includes('Minh')`);
  await sleep(300);
  await shot('05_nguoi_choi');
  await tab('invites', `document.querySelectorAll('#inviteBatches tr').length >= 2`);
  await evaluate(`document.getElementById('inviteForm').requestSubmit()`);
  await waitFor(`!document.getElementById('inviteOut').hidden && document.getElementById('inviteCodes').value.split('\\n').length === 10`);
  await shot('06_ma_moi');
  await tab('notify', `document.getElementById('alertsBox').childElementCount > 0`);
  await shot('07_thong_bao');
  await tab('filter', `document.getElementById('listText').value.length > 50`);
  await evaluate(`(() => { document.getElementById('filterTestInput').value = 'đẹp vl luôn'; document.getElementById('filterTest').requestSubmit(); })()`);
  await waitFor(`document.getElementById('filterTestOut').textContent.includes('che')`);
  await shot('08_bo_loc');
  await tab('net', `document.querySelectorAll('#netBox tr').length >= 4`);
  await shot('09_mang');
  await tab('audit', `document.querySelectorAll('#auditBox tr').length >= 3`);
  await shot('10_nhat_ky');
  // phone width: no horizontal scroll
  await viewport(390, 844, true);
  await tab('overview', `document.querySelectorAll('#feed .line').length >= 10`);
  await sleep(1500);
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  if (overflow > 1) problems.push(`horizontal scroll at 390 px: ${overflow}px`);
  await shot('11_dien_thoai');
  await tab('reports', `document.querySelectorAll('#reportList .report').length >= 2`);
  await shot('12_dien_thoai_bao_cao');
  // XSS probe: a chat line with markup must render as text
  await chat.handle(sessions[14], CHANNEL.SAY, '<img src=x onerror=alert(1)> <b>đậm</b>');
  await viewport(1440, 900);
  await tab('overview', `[...document.querySelectorAll('#feed .line .x')].some((e) => e.textContent.includes('<img src=x'))`);
  const injected = await evaluate(`document.querySelectorAll('#feed img, #feed b').length`);
  if (injected) problems.push('chat markup was rendered as HTML');
} catch (e) {
  problems.push('smoke step failed: ' + e.message);
  try { const { data } = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(path.join(OUT, 'zz_loi.png'), Buffer.from(data, 'base64')); } catch { /* ignore */ }
} finally {
  clearInterval(mover);
  try { await send('Browser.close'); } catch { /* ignore */ }
  await new Promise((r) => { if (chrome.exitCode != null) r(); else { chrome.once('exit', r); setTimeout(() => { try { chrome.kill(); } catch { /* */ } r(); }, 5000); } });
  await app.stop('smoke');
  for (const d of [profile, dataDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* chrome may hold files a moment */ } }
}
const report = { ok: problems.length === 0, problems, screenshots: shots.map((f) => path.basename(f)), out: OUT };
fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
