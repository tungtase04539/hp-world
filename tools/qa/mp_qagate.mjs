// tools/qa/mp_qagate.mjs — tay cầm QA KHÔNG lộ cho người chơi thật (codebase_hooks §9 mục 17; js/qagate.js).
// MỘT Chrome (khoá GPU, launch.mjs) mở game từ một TÊN MÁY KHÔNG PHẢI localhost (`qa-off.example` → 127.0.0.1 qua
// --host-resolver-rules; navigator.webdriver = true như mọi Chrome tự động) KHÔNG có ?qa=1, vào máy chủ test, rồi kiểm:
//   __hp.net = null · __hp.teleport(…) từ chối khi online · __hp.pState/world/vehicles/mount/player = null khi online.
// Sau đó nạp lại CÙNG trang với ?qa=1 → __hp.net có lại (công cụ QA vẫn chạy được).
//   node tools/qa/mp_qagate.mjs --port 8821 --game 9310 --out <dir>
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { args, openGame } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const PORT = +A.get('port', 8821), GAME = +A.get('game', 9310);
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2b/qagate'));
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const HOST = 'qa-off.example';
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], startedAt: new Date().toISOString() };
const step = (name, ok, data = {}) => { report.steps.push({ name, ok: !!ok, ...data }); console.log(ok ? 'ĐẠT ' : 'TRƯỢT', name, JSON.stringify(data).slice(0, 300)); };

const log = fs.openSync(path.join(OUT, 'server.log'), 'a');
const srv = spawn(process.execPath, ['src/main.js'], { cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
  env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'), DATA_DIR: DATA, LOG_LEVEL: 'info',
    ALLOWED_ORIGINS: `http://${HOST}:${PORT},http://127.0.0.1:*,http://localhost:*` } });
let g = null;
try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(HTTP + '/healthz')).ok) break; } catch { /* chưa lên */ } await sleep(300); }
  const tok = fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)[1].trim();
  const invite = ((await (await fetch(ADMIN + '/admin/api/invites', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: JSON.stringify({ count: 1, uses: 2, days: 1, note: 'qagate' }) })).json()).codes || [])[0];
  g = await openGame({ port: PORT, host: HOST, quality: 'lite', start: false, qa: false, extra: `&server=ws://127.0.0.1:${GAME}`,
    chromeArgs: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
  const pg = g.pg;
  await pg.waitForSelector('#mpPanel', { timeout: 20000 });
  await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
  await pg.fill('#mpNick', 'Người Thử Cổng');
  await pg.fill('#mpInvite', invite);
  await pg.click('#startBtn');
  await pg.waitForSelector('#mpCode .mpOk', { timeout: 20000 });
  await pg.click('#mpCode .mpOk');
  // không có __hp.net → đợi trạng thái online qua HUD (#netStatus hiện) + máy chủ thấy 1 người
  let ccu = 0;
  for (let i = 0; i < 60 && ccu < 1; i++) { await sleep(500); try { ccu = (await (await fetch(HTTP + '/healthz')).json()).ccu; } catch { /* */ } }
  await sleep(1500);
  const r = await pg.evaluate(() => {
    const h = window.__hp;
    const before = { x: h.camera.position.x };
    const tp = h.teleport(100, 100);
    return { host: location.hostname, webdriver: navigator.webdriver, net: h.net === null ? null : typeof h.net, teleport: tp,
      pState: h.pState === null, world: h.world === null, vehicles: h.vehicles === null, mount: h.mount === null, player: h.player === null,
      pill: !document.getElementById('netStatus').classList.contains('hidden'), camMoved: Math.abs(h.camera.position.x - before.x) > 1 };
  });
  await pg.screenshot({ path: path.join(OUT, 'qa_off_online.png') });
  step('bản thật (host lạ, không ?qa=1, webdriver=true) đang ONLINE: __hp.net = null, teleport từ chối, pState/world/vehicles/mount/player = null',
    ccu >= 1 && r.net === null && r.teleport === false && r.pState && r.world && r.vehicles && r.mount && r.player && !r.camMoved, { ccu, ...r });
  // cùng trang + ?qa=1 → tay cầm QA có lại
  await pg.goto(`http://${HOST}:${PORT}/index.html?quality=lite&qa=1&server=ws://127.0.0.1:${GAME}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.__hp && window.__hp.teleport, null, { timeout: 300000 });
  const r2 = await pg.evaluate(() => ({ net: !!window.__hp.net, pState: !!window.__hp.pState }));
  step('?qa=1 → __hp.net + pState có (công cụ QA chạy được)', r2.net && r2.pState, r2);
  report.errors = g.errors.slice(0, 10);
} catch (e) {
  report.error = String(e && e.stack || e); console.log('LỖI', report.error);
} finally {
  if (g) await g.close().catch(() => {});
  await new Promise((res) => { if (srv.exitCode != null) return res(); srv.once('exit', res); srv.kill(); });
  report.pass = !report.error && report.steps.length === 2 && report.steps.every((s) => s.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(report.pass ? 'ĐẠT' : 'TRƯỢT');
  process.exit(report.pass ? 0 : 1);
}
