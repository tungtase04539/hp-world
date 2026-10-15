// tools/qa/mp2_c1_e2e.mjs — KIỂM ĐẦU-CUỐI phía game GĐ1 (MP-2 C1): máy chủ THẬT chế độ test + bot quanh người chơi +
// MỘT Chrome dưới khoá GPU (tools/qa/launch.mjs openGame giữ khoá tới close()).
//
// node tools/qa/mp2_c1_e2e.mjs --port 8811 --game 9210 --out C:/Users/Admin/hp-world-work/mp2/c1/e2e [--bots 30]
//   (cần: `python -m http.server 8811` ở gốc worktree; script TỰ chạy/tắt/khởi động lại máy chủ game ở --game/--game+1
//    với HPMP_TEST=1, PGlite trong <out>/../data — KHÔNG đụng máy chủ thật 9100.)
// Các bước (mỗi bước ghi vào report.json + ảnh): màn tiêu đề → tạo tài khoản (biệt danh có dấu + mã mời) → mã khôi
// phục hiện 1 lần → vào thành phố → bot tới quanh → thấy người khác → chat 2 chiều (có dấu) → tin bị lọc (lời từ chối
// tiếng Việt) → báo cáo + chặn từ menu chat → CORRECT sau __hp.teleport → RESUME (rớt socket) → tắt máy chủ (Khám phá +
// HUD) → bật lại (tự nối lại) → trình duyệt thứ 2 (lấy lại tài khoản bằng mã khôi phục) so ngày/đêm.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { args, openGame } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const PORT = +A.get('port', 8811);
const GAME = +A.get('game', 9210);
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2/c1/e2e'));
const DATA = path.resolve(A.get('data', path.join(OUT, '..', 'data')));
const NBOTS = +A.get('bots', 30);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), port: PORT, game: GAME, steps: [], errors: [] };
const logLines = [];
const L = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ` + a.join(' '); console.log(s); logLines.push(s); };
const T0 = Date.now();
function step(name, ok, data = {}) { report.steps.push({ name, ok: !!ok, ...data }); L(ok ? 'ĐẠT ' : 'TRƯỢT', name, JSON.stringify(data).slice(0, 400)); }
function save() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'e2e.log'), logLines.join('\n'));
}

// ---------------------------------------------------------------------------------------------------------------------
// máy chủ game (chế độ test, cổng riêng)
let srv = null;
function startServer(tag) {
  const log = fs.openSync(path.join(OUT, `server_${tag}.log`), 'a');
  srv = spawn(process.execPath, ['src/main.js'], {
    cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
    env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'),
      DATA_DIR: DATA, LOG_LEVEL: 'info' },
  });
  srv.on('exit', (c, s) => L('máy chủ thoát', c, s || ''));
  return srv;
}
async function waitHealth(ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(HTTP + '/healthz'); if (r.ok) return await r.json(); } catch { /* chưa lên */ }
    await sleep(300);
  }
  throw new Error('máy chủ không lên');
}
function killServer() { return new Promise((res) => { if (!srv || srv.exitCode != null) return res(); srv.once('exit', () => res()); srv.kill(); }); }
function adminToken() {
  const env = fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8');
  return (env.match(/^ADMIN_TOKEN=(.+)$/m) || [])[1].trim();
}
async function makeInvite(uses) {
  const r = await fetch(ADMIN + '/admin/api/invites', { method: 'POST', headers: { authorization: 'Bearer ' + adminToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ count: 1, uses, days: 2, note: 'mp2-c1 e2e' }) });
  const j = await r.json();
  return (j.codes || [])[0];
}
async function guest(nickname, invite, deviceId) {
  const r = await fetch(HTTP + '/v1/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, inviteCode: invite, deviceId }) });
  return { status: r.status, body: await r.json() };
}

// ---------------------------------------------------------------------------------------------------------------------
// bot trong tiến trình (đúng mã bot của S4: server/bots/lib/bot.mjs, chỉ dùng js/shared/codec.js)
let bots = [], botTimer = null;
async function startBots(n, target, invite) {
  const { Bot } = await import(pathToUrl(path.join(ROOT, 'server/bots/lib/bot.mjs')));
  const { buildRoadGraph } = await import(pathToUrl(path.join(ROOT, 'server/bots/lib/roadgraph.mjs')));
  const { LogHist, LinHist, rng } = await import(pathToUrl(path.join(ROOT, 'server/bots/lib/stats.mjs')));
  const W = { c: new Proxy({}, { get: (o, k) => o[k] || 0, set: (o, k, v) => { o[k] = v; return true; } }),
    rtt: new LogHist(), rttNetem: new LogHist(), connectMs: new LogHist(), authMs: new LogHist(), joinMs: new LogHist(), httpMs: new LogHist(),
    resumeMs: new LogHist(), resumeHsMs: new LogHist(), queuePos: new LinHist(100000), snapBytes: new LinHist(8192), snapRecords: new LinHist(512),
    opsIn: {}, http: {}, closes: {}, system: {}, correctReasons: {}, chatRejected: {}, decodeErr: {}, errors: {},
    bump(map, k, v = 1) { map[k] = (map[k] || 0) + v; }, err(k) { this.errors[k] = (this.errors[k] || 0) + 1; } };
  const ctx = { W, graph: buildRoadGraph(), pool: {}, rand: rng(7) };
  // 2 bot đầu có biệt danh tiếng Việt khó (tạo trước bằng API rồi bot dùng refresh token)
  // MỌI bot có biệt danh tiếng Việt có dấu (tạo trước bằng API, bot dùng refresh token) — kiểm dấu trên chat/bảng tên
  const special = ['Đặng Quốc Việt', 'Trần Ngọc Ánh', 'Lê Thị Thuỷ', 'Phạm Đức Hưởng', 'Vũ Hoàng Yến', 'Bùi Thế Lữ',
    'Hoàng Ngọc Ngà', 'Đỗ Quỳnh Hương', 'Nguyễn Văn Đức', 'Trịnh Thị Ửng'];
  for (let i = 0; i < n; i++) {
    const dev = `mp2c1bot-${String(i).padStart(4, '0')}-${Date.now() % 100000}`;
    let creds = null;
    {
      const g = await guest(special[i % special.length], invite, dev);
      if (g.status === 200) creds = { refreshToken: g.body.refreshToken };
      else L('tạo bot đặc biệt lỗi', g.status, JSON.stringify(g.body));
    }
    const rider = i % 4 === 3;
    const spec = { idx: i, behavior: 'plaza', target: { x: target.x + (Math.random() - 0.5) * 6, z: target.z + (Math.random() - 0.5) * 6, r: rider ? 30 : 14 },
      travelMode: 4 /* MODE.MOTO */, chat: false, dropPerMin: 0, mode: 'full', httpUrl: HTTP, wsUrl: HTTP.replace('http', 'ws') + '/play',
      invite, origin: null, tier: 2, deviceId: dev, creds };
    const b = new Bot(spec, ctx);
    b.recv = [];
    bots.push(b);
    b.start();
    await sleep(60);
  }
  botTimer = setInterval(() => { const now = performance.now(); for (const b of bots) { try { b.tick(now); } catch (e) { W.err('tick'); } } }, 20);
  return W;
}
function stopBots() { clearInterval(botTimer); for (const b of bots) { try { b.stop(); } catch { /* ignore */ } } }
function pathToUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }

// ---------------------------------------------------------------------------------------------------------------------
async function waitFor(pg, fn, arg, ms, label) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await pg.evaluate(fn, arg).catch((e) => ({ __err: String(e) }));
    if (v && !v.__err) return { v, ms: Date.now() - t };
    await sleep(250);
  }
  L('hết giờ chờ:', label);
  return { v: null, ms: Date.now() - t };
}
const st = (pg) => pg.evaluate(() => window.__hp.net && window.__hp.net.status());
const shot = async (pg, name) => { const f = path.join(OUT, name); await pg.screenshot({ path: f }); report.shots = report.shots || []; report.shots.push(f); return f; };

async function main() {
  // 0) máy chủ
  startServer('a');
  const h = await waitHealth();
  L('máy chủ:', JSON.stringify(h));
  const invite = await makeInvite(100);
  report.inviteMade = !!invite;

  // 1) trình duyệt #1 — màn tiêu đề
  const NICK = 'Nguyễn Thị Hường';
  const g = await openGame({ port: PORT, quality: 'full', start: false, extra: `&server=ws://127.0.0.1:${GAME}` });
  const pg = g.pg;
  report.tier = g.tier; report.gpu = g.gpu; report.hpReadyMs = g.hpReadyMs;
  const netLog = [];
  pg.on('console', (m) => { const s = m.text(); if (s.startsWith('[net]')) netLog.push(s); });
  try {
    await pg.waitForSelector('#mpPanel', { timeout: 20000 });
    await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
    await shot(pg, '01_title.png');
    step('màn tiêu đề có ô biệt danh + mã mời + 2 nút', await pg.evaluate(() => !!(document.getElementById('mpNick') && document.getElementById('mpInvite') && document.getElementById('mpSolo')
      && /Vào thành phố/.test(document.getElementById('startBtn').textContent))));

    // 1b) lỗi tiếng Việt: mã mời sai
    await pg.fill('#mpNick', NICK);
    await pg.fill('#mpInvite', 'AAAAA-BBBBB');
    await pg.click('#startBtn');
    const e1 = await waitFor(pg, () => { const t = document.getElementById('mpErr').textContent; return /Mã mời/.test(t) ? t : null; }, null, 10000, 'lỗi mã mời');
    step('mã mời sai → lời báo tiếng Việt', !!e1.v, { text: e1.v });
    await shot(pg, '02_invite_error.png');

    // 1c) tạo tài khoản → mã khôi phục hiện 1 lần
    await pg.fill('#mpInvite', invite);
    const tJoin0 = Date.now();
    await pg.click('#startBtn');
    const code = await waitFor(pg, () => { const el = document.querySelector('#mpCode .mpCodeVal'); return el ? el.textContent : null; }, null, 15000, 'mã khôi phục');
    step('tạo tài khoản → mã khôi phục 12 ký tự hiện một lần', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.v || ''), { code: code.v ? code.v.slice(0, 4) + '-****-****' : null });
    await shot(pg, '03_recovery_code.png');
    await pg.click('#mpCode .mpOk');
    const live = await waitFor(pg, () => { const s = window.__hp.net.status(); return s.conn === 'live' && s.started ? s : null; }, null, 30000, 'vào thành phố');
    step('vào thành phố (WELCOME + READY)', !!live.v, { ms: Date.now() - tJoin0, netId: live.v && live.v.netId, account: live.v && live.v.account });
    // đóng hội thoại hướng dẫn viên (mở 0,7 s sau khi vào)
    await waitFor(pg, () => (!document.getElementById('dialogue').classList.contains('hidden') ? 1 : null), null, 4000, 'hội thoại hướng dẫn');
    for (let i = 0; i < 3; i++) { await pg.keyboard.press('Escape'); await sleep(200); }
    await pg.evaluate(() => window.__hp.pinQuality && window.__hp.pinQuality(true));
    const me = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    report.browserSpawn = me;
    L('trình duyệt đứng ở', JSON.stringify(me));

    // 2) bot tới quanh người chơi
    const W = await startBots(NBOTS, me, invite);
    const near = await waitFor(pg, (o) => {
      const s = window.__hp.net.status();
      const p = window.__hp.pState.pos;
      const ps = window.__hp.net.players().filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60);
      return ps.length >= o.need ? { near: ps.length, count: s.ra.count, drawn: s.ra.drawn } : null;
    }, { need: Math.min(15, Math.floor(NBOTS / 2)) }, 240000, 'bot tới gần');
    step('thấy người chơi khác quanh mình', !!near.v, { ...near.v, waitMs: near.ms });
    // đứng nhìn về phía đám đông
    await pg.evaluate(() => { const h = window.__hp; const p = h.pState.pos; h.teleport && 0; });
    await sleep(1500);
    await shot(pg, '04_players_visible.png');
    const s4 = await st(pg);
    report.afterBots = { ra: s4.ra, tel: s4.tel, conn: s4.conn };

    // 3) chat 2 chiều có dấu
    // người nói = bot GẦN NHẤT (trong 25 m) lúc này
    const nearest = await waitFor(pg, () => { const p = window.__hp.pState.pos; const ps = window.__hp.net.players().map((q) => ({ ...q, d: Math.hypot(q.x - p.x, q.z - p.z) })).sort((a, b) => a.d - b.d); return ps[0] && ps[0].d < 25 ? ps[0] : null; }, null, 120000, 'bot gần');
    const talker = bots.find((b) => b.r.netId === (nearest.v && nearest.v.netId)) || bots[0];
    const talkerName = (nearest.v && nearest.v.name || '').split('#')[0] || 'Đặng Quốc Việt';
    L('người nói:', talker.r.netId, talkerName, nearest.v && nearest.v.d.toFixed(1) + ' m');
    const BOT_SAYS = 'Chào Hường! Đi ăn bánh đa cua ở chợ Sắt không? 🦀';
    talker.sendChat(BOT_SAYS);
    const got = await waitFor(pg, (txt) => window.__hp.net.chatLines().some((l) => l.kind === 'say' && l.text.includes(txt)) || null, BOT_SAYS, 8000, 'trình duyệt nhận tin bot');
    const lineB = await pg.evaluate(() => window.__hp.net.chatLines().filter((l) => l.kind === 'say').map((l) => l.text).slice(-3));
    step('bot nói → khung chat trình duyệt hiện (tên + tin có dấu)', !!got.v && lineB.some((t) => t.includes(talkerName)), { lines: lineB });
    await pg.keyboard.press('KeyT');
    await sleep(200);
    const BROWSER_SAYS = 'Xin chào cả nhà! Mình là Hường, đang ở quảng trường Nhà hát lớn nè 🌺';
    await pg.keyboard.type(BROWSER_SAYS, { delay: 5 });
    await pg.keyboard.press('Enter');
    const echo = await waitFor(pg, (txt) => window.__hp.net.chatLines().some((l) => l.kind === 'self' && l.text.includes(txt)) || null, BROWSER_SAYS, 8000, 'tin vọng lại');
    await sleep(800);
    const botsGot = bots.filter((b) => (b.recv || []).some(([, t]) => t === BROWSER_SAYS)).length;
    step('trình duyệt nói → bot trong 40 m nhận đúng nguyên văn', !!echo.v && botsGot > 0, { botsGot, ofBots: bots.length });
    await shot(pg, '05_chat_roundtrip.png');

    // 4) tin bị lọc → lời từ chối tiếng Việt
    await sleep(5600);   // tài khoản mới: slow mode 1 tin / 5 s
    await pg.keyboard.press('KeyT');
    await pg.keyboard.type('Gọi mình số 0912 345 678 nhé', { delay: 5 });
    await pg.keyboard.press('Enter');
    const rej = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => x.kind === 'error').pop(); return l && /không được gửi/.test(l.text) ? l.text : null; }, null, 8000, 'từ chối');
    const leaked = bots.some((b) => (b.recv || []).some(([, t]) => /0912/.test(t)));
    step('tin có số điện thoại bị chặn, lời từ chối tiếng Việt, không lọt tới bot', !!rej.v && !leaked, { text: rej.v, leaked });
    await shot(pg, '06_chat_rejected.png');

    // 5) báo cáo + chặn từ menu chat
    await pg.keyboard.press('KeyT');
    await sleep(200);
    await pg.locator('.chatLine.say', { hasText: 'bánh đa cua' }).last().locator('.chatName').click();
    await sleep(300);
    await shot(pg, '07_chat_menu.png');
    await pg.click('#chatMenuMain button.warn');
    await sleep(200);
    await shot(pg, '08_report_reasons.png');
    await pg.locator('#chatMenuReasons button').nth(1).click();   // Quấy rối, đe doạ
    const rep = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => /báo cáo/.test(x.text)).pop(); return l ? l.text : null; }, null, 8000, 'kết quả báo cáo');
    step('báo cáo từ menu chat → máy chủ xác nhận (tiếng Việt)', !!rep.v && /Đã gửi báo cáo/.test(rep.v), { text: rep.v });
    await pg.keyboard.press('KeyT');
    await sleep(150);
    await pg.locator('.chatLine.say', { hasText: talkerName }).last().locator('.chatName').click().catch(() => {});
    await sleep(200);
    await pg.click('#chatMenuMain button.danger');
    const blk = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => /Đã chặn/.test(x.text)).pop(); return l ? l.text : null; }, null, 8000, 'kết quả chặn');
    await sleep(2500);
    const AFTER_BLOCK = 'Tin này sau khi bị chặn — không được hiện';
    talker.sendChat(AFTER_BLOCK);
    await sleep(2500);
    const seen = await pg.evaluate((t) => window.__hp.net.chatLines().some((l) => l.text.includes(t)), AFTER_BLOCK);
    step('chặn từ menu chat → máy chủ ngừng giao tin của người bị chặn', !!blk.v && !seen, { text: blk.v, seenAfterBlock: seen });
    await shot(pg, '09_blocked.png');
    // ảnh PHÓNG TO khung chat: dấu tiếng Việt khó (Nguyễn Thị Hường, Đặng/Nguyễn Văn Đức…) không vỡ
    await pg.evaluate(() => { const b = document.getElementById('chatBox'); b.style.zoom = '2.2'; b.style.width = '560px'; });
    await sleep(300);
    await pg.locator('#chatLog').screenshot({ path: path.join(OUT, 'vn_diacritics_chat_zoom.png') });
    await pg.evaluate(() => { const b = document.getElementById('chatBox'); b.style.zoom = ''; b.style.width = ''; });
    await pg.keyboard.press('Escape');
    await pg.evaluate(() => window.__hp.net.closeChat());

    // 6) CORRECT sau __hp.teleport (máy chủ kéo về)
    const c0 = await st(pg);
    const p0 = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    await pg.evaluate((p) => window.__hp.teleport(p.x + 300, p.z + 120, 0, 0.35, 14), p0);
    const back = await waitFor(pg, (o) => { const p = window.__hp.pState.pos; const s = window.__hp.net.status(); return s.correct.count > o.n && Math.hypot(p.x - o.x, p.z - o.z) < 8 ? { d: Math.hypot(p.x - o.x, p.z - o.z), correct: s.correct } : null; },
      { x: p0.x, z: p0.z, n: c0.correct.count }, 6000, 'CORRECT kéo về');
    step('__hp.teleport 325 m → máy chủ CORRECT, nhảy về vị trí hợp lệ', !!back.v, { ...back.v, ms: back.ms });
    await sleep(1000);
    const c1 = await st(pg);
    report.afterCorrect = { corrEpoch: c1.corrEpoch, correct: c1.correct };

    // 7) RESUME: rớt socket giả → nối lại cùng netId (≤ 60 s)
    const r0 = await st(pg);
    await pg.evaluate(() => window.__hp.net.drop());
    const lost = await waitFor(pg, () => (window.__hp.net.status().conn !== 'live' ? window.__hp.net.status().conn : null), null, 3000, 'rớt');
    const res = await waitFor(pg, (o) => { const s = window.__hp.net.status(); return s.conn === 'live' && s.tel.resumes > o.r ? s : null; }, { r: r0.tel.resumes }, 15000, 'resume');
    step('rớt socket → RESUME giữ netId', !!res.v && res.v.netId === r0.netId, { lostState: lost.v, ms: res.ms, netIdBefore: r0.netId, netIdAfter: res.v && res.v.netId });

    // 8) ngày/đêm: client vs máy chủ
    await sleep(2500);
    const d1 = await st(pg);
    const dd = Math.abs(((d1.dayT - d1.serverDayT + 1.5) % 1) - 0.5);
    step('ngày/đêm khớp giờ máy chủ', dd < 0.002, { dayT: d1.dayT, serverDayT: d1.serverDayT, diffGameMin: +(dd * 1440).toFixed(2) });
    report.day1 = { at: Date.now(), dayT: d1.dayT, serverDayT: d1.serverDayT };

    // 9) tắt máy chủ → Khám phá + HUD; người chơi vẫn đi được; bật lại → tự nối lại
    const k0 = Date.now();
    await killServer();
    const ex = await waitFor(pg, () => { const s = window.__hp.net.status(); const pill = document.getElementById('netStatus'); return (s.conn === 'lost' || s.conn === 'closed') && s.visible === 0 ? { conn: s.conn, pill: pill.textContent, visible: s.visible } : null; }, null, 15000, 'Khám phá');
    step('tắt máy chủ → chế độ Khám phá + trạng thái HUD, người khác biến mất', !!ex.v && /Khám phá/.test(ex.v.pill) && ex.v.visible === 0, { ...ex.v, ms: ex.ms });
    const pa = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    await pg.keyboard.down('KeyW'); await sleep(1500); await pg.keyboard.up('KeyW');
    const pb = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    const moved = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    step('Khám phá: vẫn điều khiển nhân vật bình thường', moved > 2, { moved: +moved.toFixed(2) });
    await shot(pg, '10_explore_mode.png');
    await sleep(3000);
    startServer('b');
    await waitHealth();
    const up = Date.now();
    const re = await waitFor(pg, () => { const s = window.__hp.net.status(); return s.conn === 'live' ? s : null; }, null, 60000, 'nối lại sau khởi động');
    step('bật lại máy chủ → tự nối lại (vé mới, không cần thao tác)', !!re.v, { msAfterServerUp: Date.now() - up, downMs: up - k0, rejoins: re.v && re.v.tel.rejoins });
    const back2 = await waitFor(pg, () => { const s = window.__hp.net.status(); return s.ra.count >= 3 ? s.ra : null; }, null, 40000, 'thấy lại bot');
    step('sau khi nối lại thấy lại người chơi khác', !!back2.v, back2.v || {});
    await sleep(800);
    await shot(pg, '11_reconnected.png');
    const fin = await st(pg);
    report.final1 = fin;
    report.errorsBrowser1 = g.errors.slice();
    report.netLog1 = netLog.slice(-60);
    const day1b = { at: Date.now(), dayT: fin.dayT, serverDayT: fin.serverDayT };
    report.day1b = day1b;
    await g.close();

    // 10) trình duyệt #2 (tuần tự): lấy lại tài khoản bằng mã khôi phục, so ngày/đêm
    const g2 = await openGame({ port: PORT, quality: 'full', start: false, extra: `&server=ws://127.0.0.1:${GAME}` });
    try {
      const p2 = g2.pg;
      await p2.waitForSelector('#mpPanel', { timeout: 20000 });
      await p2.click('#mpRecLink');
      await p2.fill('#mpRecCode', code.v.toLowerCase().replace(/-/g, ' '));
      await p2.click('#mpRecBtn');
      const rec = await waitFor(p2, () => { const w = document.getElementById('mpWho'); return w && !w.classList.contains('hidden') ? w.textContent : null; }, null, 10000, 'lấy lại tài khoản');
      step('trình duyệt mới: "Có mã khôi phục?" → lấy lại đúng tài khoản', !!rec.v && rec.v.includes(NICK), { who: rec.v });
      await shot(p2, '12_recovered_title.png');
      await p2.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
      await p2.click('#startBtn');
      const l2 = await waitFor(p2, () => { const s = window.__hp.net.status(); return s.conn === 'live' && s.started ? s : null; }, null, 30000, 'vào lần 2');
      await sleep(2500);
      const d2 = await p2.evaluate(() => window.__hp.net.status());
      const now2 = Date.now();
      const expect = (day1b.serverDayT + (now2 - day1b.at) / 1000 / 1440) % 1;
      const diff2 = Math.abs(((d2.dayT - expect + 1.5) % 1) - 0.5);
      step('2 trình duyệt tuần tự: cùng giờ ngày/đêm (lệch < 2 phút game)', !!l2.v && diff2 * 1440 < 2, { dayT2: d2.dayT, expectFromBrowser1: +expect.toFixed(5), diffGameMin: +(diff2 * 1440).toFixed(2), gapS: Math.round((now2 - day1b.at) / 1000) });
      await p2.keyboard.press('Escape');
      await sleep(1000);
      await shot(p2, '13_browser2_online.png');
      report.errorsBrowser2 = g2.errors.slice();
    } finally { await g2.close(); }
    report.bots = { n: bots.length, live: bots.filter((b) => b.state === 'live').length, corrects: bots.reduce((s, b) => s + b.r.corrects, 0),
      decodeErrors: bots.reduce((s, b) => s + b.r.decodeErrors, 0), chatRecv: W.c.chatRecv };
  } catch (e) {
    report.errors.push(String(e && e.stack || e));
    L('LỖI', e && e.stack || e);
    try { await shot(pg, 'zz_error.png'); } catch { /* ignore */ }
    try { await g.close(); } catch { /* ignore */ }
  } finally {
    stopBots();
    await sleep(500);
    await killServer();
    report.finishedAt = new Date().toISOString();
    report.passed = report.steps.filter((s) => s.ok).length;
    report.failed = report.steps.filter((s) => !s.ok).map((s) => s.name);
    save();
    L(`XONG: ${report.passed}/${report.steps.length} bước đạt`, report.failed.length ? 'TRƯỢT: ' + report.failed.join(' | ') : '');
    process.exit(report.failed.length || report.errors.length ? 1 : 0);
  }
}
main();
