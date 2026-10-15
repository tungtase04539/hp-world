// tools/qa/mp_mobile_hud.mjs — HUD điện thoại khi ONLINE không tự đè lên nhau (vòng sửa 1 MP-2b, MOBILE-PORTRAIT-HUD).
// MỘT Chrome (khoá GPU, launch.mjs; cảm ứng giả lập, DPR 2) + máy chủ game THỬ (HPMP_TEST=1, cổng riêng, PGlite trong --out).
// (Máy chủ là ws://127.0.0.1 — tin cậy sẵn; ws:// tới tên lạ bị config.js từ chối, nên lớp "Máy chủ lạ" ở bước 1 được dựng
// bằng ĐÚNG id/class của net.js để kiểm luật CSS xếp lớp.)
// Kiểm, cho màn DỌC 375×812 rồi NGANG 812×375:
//   1. dọc: hộp "Máy chủ lạ" (#mpTrust) nằm TRÊN lời gợi ý xoay ngang (điểm giữa nút "tin" thuộc #mpTrust)
//   2. trong game: bảng nhiệm vụ không giao thanh trên (#topRight: chấm kết nối, đồng hồ, nút) và không giao bản đồ nhỏ
//   3. chat mở (gõ + gửi): ô nhập / nút Gửi / dòng chat không giao bản đồ nhỏ đang HIỆN, nằm trong màn hình
//   4. 0 lỗi JS (pageerror)
// Ảnh: <out>/{doc,ngang}_*.png để xem bằng mắt.
//   node tools/qa/mp_mobile_hud.mjs --port 8826 --game 9360 --out C:/Users/Admin/hp-world-work/mp2b/fix1/hud
// (cần server tĩnh `python -m http.server <port>` ở gốc repo/worktree)
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { args, openGame } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const PORT = +A.get('port', 8826), GAME = +A.get('game', 9360);
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2b/hud'));
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], startedAt: new Date().toISOString() };
const step = (name, ok, data = {}) => { report.steps.push({ name, ok: !!ok, ...data }); console.log(ok ? 'ĐẠT ' : 'TRƯỢT', name, JSON.stringify(data).slice(0, 400)); };

// hộp hiện (display/visibility) của các phần HUD, trong toạ độ CSS px
const boxes = (pg, sels) => pg.evaluate((sels) => {
  const out = {};
  for (const s of sels) {
    const e = document.querySelector(s);
    if (!e) continue;
    const cs = getComputedStyle(e);
    let vis = cs.display !== 'none' && cs.visibility !== 'hidden' && !e.classList.contains('hidden');
    for (let p = e.parentElement; p && vis; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') vis = false; }
    const r = e.getBoundingClientRect();
    if (vis && r.width > 0 && r.height > 0) out[s] = { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
  }
  return out;
}, sels);
const hit = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
function overlaps(bx, groupA, groupB) {
  const out = [];
  for (const a of groupA) for (const b of groupB) if (a !== b && hit(bx[a], bx[b])) out.push(`${a} × ${b}`);
  return out;
}

const log = fs.openSync(path.join(OUT, 'server.log'), 'a');
const srv = spawn(process.execPath, ['src/main.js'], { cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
  env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'), DATA_DIR: DATA, LOG_LEVEL: 'info' } });
let g = null;
try {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(HTTP + '/healthz')).ok) break; } catch { /* chưa lên */ } await sleep(300); }
  const tok = fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)[1].trim();
  const codes = ((await (await fetch(ADMIN + '/admin/api/invites', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: JSON.stringify({ count: 2, uses: 1, days: 1, note: 'mobile-hud' }) })).json()).codes || []);
  g = await openGame({ port: PORT, quality: '', viewport: { width: 375, height: 812 }, mobile: true, start: false, qa: true,
    extra: `&server=ws://127.0.0.1:${GAME}` });
  const br = g.br;
  for (const [w, h, tag, nick, code, ctxPage] of [[375, 812, 'doc', 'Lan Lê Chân', codes[0], g.pg], [812, 375, 'ngang', 'Minh Đồ Sơn', codes[1], null]]) {
    let pg = ctxPage, ctx = null;
    const errs = [];
    if (!pg) {
      ctx = await br.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      pg = await ctx.newPage();
      pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await pg.goto(`http://127.0.0.1:${PORT}/index.html?qa=1&server=ws://127.0.0.1:${GAME}`, { waitUntil: 'domcontentloaded' });
    }
    const shot = (n) => pg.screenshot({ path: path.join(OUT, `${tag}_${n}.png`) });
    await pg.waitForFunction(() => !!document.getElementById('mpPanel'), null, { timeout: 200000 });
    const rotateShown = await pg.evaluate(() => !document.getElementById('rotateHint').classList.contains('hidden'));
    const trustTop = await pg.evaluate(() => {
      const ov = document.createElement('div'); ov.id = 'mpTrust';
      ov.innerHTML = '<div class="mpCodeCard"><h3>⚠️ Máy chủ lạ</h3><div class="mpTrustHost">ab-cd-ef.trycloudflare.com</div><div class="mpCodeBtns"><button class="mpOk">Tôi tin máy chủ này — vào</button></div></div>';
      document.body.appendChild(ov);
      const b = ov.querySelector('.mpOk'); const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !!e && !!e.closest('#mpTrust'), top: e ? (e.id || String(e.className) || e.tagName) : null };
    });
    await sleep(300);
    await shot('01_may_chu_la');
    await pg.evaluate(() => document.getElementById('mpTrust').remove());
    step(`${tag} ${w}×${h}: hộp "Máy chủ lạ" nằm trên cùng (gợi ý xoay ngang ${rotateShown ? 'đang hiện' : 'không hiện'} không che)`, trustTop.ok, { ...trustTop, rotateShown });
    await sleep(300);
    if (await pg.evaluate(() => !document.getElementById('rotateHint').classList.contains('hidden'))) await pg.tap('#rotateDismiss').catch(() => {});
    await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 200000 });
    await pg.fill('#mpNick', nick);
    await pg.fill('#mpInvite', code);
    await pg.tap('#startBtn');
    await pg.waitForSelector('#mpCode .mpOk', { timeout: 30000 });
    await pg.tap('#mpCode .mpOk');
    await pg.waitForFunction(() => { const s = window.__hp.net && window.__hp.net.status(); return s && s.conn === 'live' && s.started; }, null, { timeout: 40000 });
    await sleep(1500);
    for (let i = 0; i < 5; i++) {
      if (!(await pg.evaluate(() => !document.getElementById('dialogue').classList.contains('hidden')))) break;
      await pg.tap('#dialogue').catch(() => {}); await sleep(350);
    }
    await pg.evaluate(() => { window.__hp.setTime && window.__hp.setTime(0.42); });
    await sleep(1200);
    await shot('02_trong_game');
    const TOP = ['#netStatus', '#clock', '#btnChat', '#btnMoto', '#btnLang', '#btnSound', '#btnHelp'];
    const bx = await boxes(pg, ['#questPanel', '#minimap', ...TOP, '#chatBox', '#chatLog']);
    const o1 = overlaps(bx, ['#questPanel'], [...TOP, '#minimap']);
    const inside = Object.entries(bx).filter(([, r]) => r.x < 0 || r.r > w || r.y < 0 || r.b > h).map(([k]) => k);
    step(`${tag} ${w}×${h}: trong game — bảng nhiệm vụ không đè thanh trên / bản đồ nhỏ, mọi phần trong màn hình`, o1.length === 0 && inside.length === 0 && !!bx['#questPanel'] && !!bx['#netStatus'],
      { overlaps: o1, outside: inside, boxes: bx });
    // chat cảm ứng: mở → gõ → gửi; giữ khung mở để đo
    await pg.tap('#btnChat'); await sleep(500);
    await pg.tap('#chatInput').catch(() => {});
    await pg.keyboard.type('Chào cả nhà, mình vào bằng điện thoại', { delay: 5 });
    await pg.tap('#chatSendBtn'); await sleep(900);
    if (!(await pg.evaluate(() => document.getElementById('chatBox').classList.contains('open')))) { await pg.tap('#btnChat'); await sleep(500); }
    await shot('03_chat_mo');
    const CH = ['#chatInput', '#chatSendBtn', '#chatPeopleBtn', '#chatLog'];
    const bc = await boxes(pg, ['#questPanel', '#minimap', ...CH, ...TOP]);
    const o2 = overlaps(bc, CH, ['#minimap', '#questPanel', ...TOP]);
    const out2 = CH.filter((k) => bc[k] && (bc[k].x < 0 || bc[k].r > w || bc[k].b > h));
    step(`${tag} ${w}×${h}: chat mở — ô nhập / Gửi / dòng chat không đè bản đồ nhỏ / bảng nhiệm vụ / thanh trên, trong màn hình`, o2.length === 0 && out2.length === 0 && !!bc['#chatInput'] && !!bc['#chatSendBtn'],
      { overlaps: o2, outside: out2, boxes: bc });
    await pg.evaluate(() => window.__hp.net.closeChat());
    await sleep(600);
    await shot('04_chat_dong');
    const bd = await boxes(pg, ['#minimap', '#chatLog', '#questPanel']);
    const o3 = overlaps(bd, ['#chatLog'], ['#minimap', '#questPanel']);
    step(`${tag} ${w}×${h}: chat đóng — dòng chat còn hiện không đè bản đồ nhỏ / bảng nhiệm vụ`, o3.length === 0, { overlaps: o3, boxes: bd });
    const all = ctx ? errs : g.errors;
    step(`${tag}: 0 lỗi JS (pageerror)`, !all.some((e) => e.startsWith('pageerror')), { sample: all.slice(0, 5) });
    if (ctx) await ctx.close();
  }
} catch (e) {
  report.error = String(e && e.stack || e); console.log('LỖI', report.error);
  try { if (g) await g.pg.screenshot({ path: path.join(OUT, 'zz_loi.png') }); } catch { /* */ }
} finally {
  if (g) await g.close().catch(() => {});
  await new Promise((res) => { if (srv.exitCode != null) return res(); srv.once('exit', res); srv.kill(); });
  report.pass = !report.error && report.steps.length === 10 && report.steps.every((s) => s.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(report.pass ? 'ĐẠT' : 'TRƯỢT');
  process.exit(report.pass ? 0 : 1);
}
