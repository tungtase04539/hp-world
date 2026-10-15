// tools/qa/mp_riders.mjs — NGƯỜI CHƠI THẬT KHÔNG BỊ KÉO VỀ OAN (riders fixer 15/10/2026).
// MỘT Chrome (dưới khoá GPU — launch.mjs openGame) chơi như người thật trên máy chủ THẬT chế độ test (HPMP_TEST=1, cổng riêng):
//   A. đi bộ / chạy (Shift) / nhảy (Space) bằng phím thật;
//   B. lên–xuống xe dồn dập (nút 🏍️ gọi xe + phím E, khoảng cách 60–400 ms);
//   C. xe máy riêng GA HẾT CỠ ≥ 3 phút do "tài xế tự động" trong trang bấm W/A/D/S (KeyboardEvent → input.js → main.js →
//      vehicles.js → net.js — đúng đường code người chơi): đường thẳng dài, góc phố, dốc xoắn + mặt cầu Hoàng Văn Thụ (lên dốc,
//      chạy trên nhịp cầu tới mép vùng chơi, quay đầu, xuống), cầu Lạc Long;
//   D. trên mặt cầu: xuống xe, đi/chạy/nhảy, lên–xuống dồn dập, lên xe chạy tiếp.
// ĐẠT khi: 0 CORRECT ở trình duyệt (__hp.net.status().correct.count) VÀ 0 dòng "correct" trong log máy chủ VÀ (mặc định)
// 0 vi phạm (hp_violations_total). Máy chủ chạy LOG_LEVEL=debug → mọi STATE bị từ chối đều có dòng "violation" kèm cửa sổ.
//
//   python -m http.server 8821   (gốc worktree)
//   node tools/qa/mp_riders.mjs --port 8821 --game 9310 --out C:/Users/Admin/hp-world-work/mp2b/<tag>/riders [--driveS 200]
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { args, openGame } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const PORT = +A.get('port', 8821);
const GAME = +A.get('game', 9310);
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2b/riders'));
const DATA = path.resolve(A.get('data', path.join(OUT, 'data')));
const DRIVE_MIN_S = +A.get('driveS', 200);        // tối thiểu giây lái xe ga hết cỡ (yêu cầu ≥ 180)
const DRIVE_MAX_S = +A.get('driveMaxS', 720);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const logLines = [];
const L = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ` + a.join(' '); console.log(s); logLines.push(s); };
const report = { startedAt: new Date().toISOString(), port: PORT, game: GAME, steps: [], phases: {}, shots: [], errors: [] };
function save() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'riders.log'), logLines.join('\n'));
}
function step(name, ok, data = {}) { report.steps.push({ name, ok: !!ok, ...data }); L(ok ? 'ĐẠT ' : 'TRƯỢT', name, JSON.stringify(data).slice(0, 600)); save(); }

// ---- máy chủ test ----------------------------------------------------------------------------------------------------
let srv = null;
const SERVER_LOG = path.join(OUT, 'server.log');
function startServer() {
  const log = fs.openSync(SERVER_LOG, 'a');
  srv = spawn(process.execPath, ['src/main.js'], {
    cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
    env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'),
      DATA_DIR: DATA, LOG_LEVEL: 'debug' },
  });
  srv.on('exit', (c, s) => L('máy chủ thoát', c, s || ''));
}
async function waitHealth(ms = 40000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const r = await fetch(HTTP + '/healthz'); if (r.ok) return await r.json(); } catch { /* chưa lên */ } await sleep(300); }
  throw new Error('máy chủ không lên');
}
const killServer = () => new Promise((res) => { if (!srv || srv.exitCode != null) return res(); srv.once('exit', () => res()); srv.kill(); });
const adminToken = () => (fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m) || [])[1].trim();
async function makeInvite() {
  const r = await fetch(ADMIN + '/admin/api/invites', { method: 'POST', headers: { authorization: 'Bearer ' + adminToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ count: 1, uses: 3, days: 1, note: 'mp riders' }) });
  return ((await r.json()).codes || [])[0];
}
async function metricsViol() {
  try {
    const r = await fetch(ADMIN + '/metrics', { headers: { authorization: 'Bearer ' + adminToken() } });
    const txt = await r.text();
    const out = {};
    for (const m of txt.matchAll(/^hp_(violations_total|corrections_total)\{reason="([^"]+)"\}\s+([0-9.e+]+)/gm)) out[m[1] + ':' + m[2]] = +m[3];
    return out;
  } catch (e) { return { err: String(e) }; }
}
function serverLines(msg) {
  try {
    return fs.readFileSync(SERVER_LOG, 'utf8').split('\n').filter((l) => l.includes(`"msg":"${msg}"`)).map((l) => { try { return JSON.parse(l); } catch { return l; } });
  } catch { return []; }
}

// ---- lộ trình (đồ thị phố thật của bot + đường cầu nâng ROADS_DT) ------------------------------------------------------
async function buildRoute(from) {
  const { buildRoadGraph } = await import(pathToFileURL(path.join(ROOT, 'server/bots/lib/roadgraph.mjs')).href);
  const T = await import(pathToFileURL(path.join(ROOT, 'js/terrain.js')).href);
  const g = buildRoadGraph();
  const viaGraph = (a, b) => {
    const na = g.nearestDry(a[0], a[1]), nb = g.nearest(b[0], b[1]);
    const p = g.path(na, nb) || [na];
    return p.map((i) => [g.x[i], g.z[i]]);
  };
  // làm dày 2 m TRƯỚC khi cắt theo bán kính (nhịp 242 chỉ có 8 điểm: đoạn cuối dài 965 m vượt mép vùng chơi)
  const dense = (pts) => { const o = [pts[0]]; for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2)); for (let k = 1; k <= n; k++) o.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); } return o; };
  const way = (ri) => dense(T.ROADS_DT[ri].pts.map((p) => [p[0], p[1]]));
  const inside = (pts, r) => { const o = []; for (const p of pts) { if (Math.hypot(p[0], p[1]) > r) break; o.push(p); } return o; };
  // Hoàng Văn Thụ: dốc 248 → dốc xoắn 349 → nhịp 242 (tới r 1555 — mép vùng chơi 1588), quay đầu, chạy ngược xuống
  const hvtUp = [...way(248), ...way(349).slice(1), ...inside(way(242).slice(1), 1500)];
  const hvtDown = hvtUp.slice().reverse();
  const lacLong = way(20);   // (-268,-525) → (-495,-479)
  const seg = [];
  const add = (pts, tag) => { for (const p of pts) seg.push([p[0], p[1], tag]); };
  add([[from.x, from.z]], 'start');
  add(viaGraph([from.x, from.z], hvtUp[0]), 'street');
  add(hvtUp, 'hvt_up');
  add(hvtDown, 'hvt_down');
  add(viaGraph(hvtDown[hvtDown.length - 1], lacLong[0]), 'street2');
  add(lacLong, 'laclong');
  // làm dày 2 m
  const out = [];
  for (let i = 0; i < seg.length; i++) {
    const [x, z, tag] = seg[i];
    if (!out.length) { out.push([x, z, tag]); continue; }
    const [px, pz] = out[out.length - 1];
    const d = Math.hypot(x - px, z - pz);
    if (d < 0.5) continue;
    const n = Math.ceil(d / 2);
    for (let k = 1; k <= n; k++) out.push([px + (x - px) * k / n, pz + (z - pz) * k / n, tag]);
  }
  let len = 0; for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  const tags = {}; for (const p of out) tags[p[2]] = (tags[p[2]] || 0) + 1;
  return { pts: out, lenM: Math.round(len), tags, hvtMidIdx: out.findIndex((p) => p[2] === 'hvt_down') - 30 };
}

// ---- tài xế tự động trong trang (KeyboardEvent thật vào window — cùng đường input.js như người bấm phím) --------------
function installDriver(pg, route) {
  return pg.evaluate((route) => {
    const st = window.__rp = { pts: route.pts, i: 0, done: false, paused: false, pauseAt: route.pauseAt, keys: {}, maxV: 0, maxY: 0, stuck: 0, reverses: 0,
      distM: 0, t0: performance.now(), lastX: NaN, lastZ: NaN, lastY: NaN, falls: [], skips: 0, tagNow: '', tagsSeen: {}, mountedMs: 0, lastT: performance.now() };
    const key = (code, down) => {
      if (!!st.keys[code] === down) return;
      st.keys[code] = down;
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'KeyW' ? 'w' : code, bubbles: true }));
    };
    st.release = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) key(k, false); };
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    let revUntil = 0, chkT = performance.now(), chkX = NaN, chkZ = NaN, chkI = 0, stuckN = 0;
    function tick() {
      if (st.done) { st.release(); return; }
      requestAnimationFrame(tick);
      const now = performance.now();
      const v = window.__hp.pState.mounted;
      if (st.paused || !v) { st.release(); st.lastT = now; return; }
      st.mountedMs += now - st.lastT; st.lastT = now;
      const P = st.pts, x = v.pos.x, z = v.pos.z;
      if (Number.isFinite(st.lastX)) st.distM += Math.hypot(x - st.lastX, z - st.lastZ);
      st.lastX = x; st.lastZ = z;
      st.maxV = Math.max(st.maxV, v.vel); st.maxY = Math.max(st.maxY, v.pos.y);
      // tiến chỉ số: điểm gần nhất trong 60 điểm tới
      let bi = st.i, bd = Infinity;
      for (let k = st.i; k < Math.min(P.length, st.i + 60); k++) { const d = Math.hypot(P[k][0] - x, P[k][1] - z); if (d < bd) { bd = d; bi = k; } }
      st.i = bi;
      st.tagNow = P[bi][2];
      if (bd < 12 && Math.abs(v.vel) > 3) st.tagsSeen[st.tagNow] = (st.tagsSeen[st.tagNow] || 0) + 1;   // khung THẬT đang chạy trên đoạn đó
      if (Number.isFinite(st.lastY) && v.pos.y < st.lastY - 3) st.falls.push([+x.toFixed(1), +z.toFixed(1), +st.lastY.toFixed(1), +v.pos.y.toFixed(1)]);
      st.lastY = v.pos.y;
      if (st.pauseAt >= 0 && st.i >= st.pauseAt) { st.pauseAt = -1; st.paused = true; st.release(); return; }
      if (st.i >= P.length - 3) { st.done = true; st.release(); return; }
      // điểm nhìn trước
      const La = 6 + 0.55 * Math.abs(v.vel);
      let j = st.i; while (j < P.length - 1 && Math.hypot(P[j][0] - x, P[j][1] - z) < La) j++;
      const hd = Math.atan2(P[j][0] - x, P[j][1] - z);
      const err = wrap(hd - v.heading);
      // tốc độ đích theo độ cong 40 m tới
      let turn = 0;
      for (let k = st.i + 2; k < Math.min(P.length - 1, st.i + 20); k++) {
        const a1 = Math.atan2(P[k][0] - P[k - 2][0], P[k][1] - P[k - 2][1]), a2 = Math.atan2(P[k + 1][0] - P[k - 1][0], P[k + 1][1] - P[k - 1][1]);
        turn += Math.abs(wrap(a2 - a1));
      }
      turn /= 2;
      let vt = turn > 1.3 ? 4.5 : turn > 0.8 ? 7 : turn > 0.45 ? 10 : turn > 0.25 ? 13 : 16;
      if (Math.abs(err) > 1.0) vt = Math.min(vt, 4);
      // kẹt (đâm cột/tường/xe): lùi 1,2 s rồi đi tiếp
      // quay đầu (đích ở SAU lưng, xe gần đứng): lùi đánh lái ngược 1 s = quay đầu 3 điểm, không húc tường/lan can
      if (Math.abs(err) > 2.3 && Math.abs(v.vel) < 2.5 && now > revUntil + 1500) { revUntil = now + 1000; st.uturns = (st.uturns || 0) + 1; }
      if (now < revUntil) { key('KeyW', false); key('KeyS', true); key('KeyA', err < 0); key('KeyD', err > 0); return; }
      // kẹt = trong 2 s đi được < 2 m (đâm cột/tường/xe, trườn sát tường với vel*0,4 mỗi khung): lùi 1,2 s; kẹt lặp lại ở
      // cùng đoạn → nhắm xa hơn (bỏ qua góc cắt của đồ thị phố)
      if (now - chkT > 2000) {
        const moved = Number.isFinite(chkX) ? Math.hypot(x - chkX, z - chkZ) : 99;
        if (moved < 2) {
          stuckN = st.i - chkI < 5 ? stuckN + 1 : 1;
          revUntil = now + 1200; st.reverses++;
          if (stuckN >= 3) { st.i = Math.min(P.length - 4, st.i + 8); st.skips++; }
        } else stuckN = 0;
        chkT = now; chkX = x; chkZ = z; chkI = st.i;
      }
      key('KeyD', err < -0.05); key('KeyA', err > 0.05);
      if (v.vel < vt - 0.4) { key('KeyS', false); key('KeyW', true); }
      else if (v.vel > vt + 2.5) { key('KeyW', false); key('KeyS', true); }
      else { key('KeyW', false); key('KeyS', false); }
    }
    requestAnimationFrame(tick);
    return { n: st.pts.length };
  }, route);
}
const rp = (pg) => pg.evaluate(() => { const s = window.__rp, h = window.__hp, v = h.pState.mounted, p = v ? v.pos : h.pState.pos;
  return { i: s.i, n: s.pts.length, done: s.done, paused: s.paused, tag: s.tagNow, maxV: +s.maxV.toFixed(2), maxY: +s.maxY.toFixed(1), distM: Math.round(s.distM),
    mountedS: +(s.mountedMs / 1000).toFixed(1), reverses: s.reverses, skips: s.skips, falls: s.falls.length, x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(1), vel: v ? +v.vel.toFixed(2) : null,
    mounted: !!v, corr: h.net.status().correct, conn: h.net.status().conn }; });
const status = (pg) => pg.evaluate(() => { const s = window.__hp.net.status(); return { conn: s.conn, netId: s.netId, correct: s.correct, stateSent: s.tel && s.tel.stateSent }; });
async function shot(pg, name) { const f = path.join(OUT, name); await pg.screenshot({ path: f }); report.shots.push(f); return f; }
const mounted = (pg) => pg.evaluate(() => !!window.__hp.pState.mounted);
const clickMoto = (pg) => pg.evaluate(() => document.getElementById('btnMoto').click());

// đi / chạy / nhảy bằng phím thật (page.keyboard = sự kiện tin cậy)
// safe: trên mặt cầu — chỉ đi dọc hướng nhìn (không chéo/rẽ: mặt cầu 11 m, rơi khỏi mép = bài khác)
async function footRoutine(pg, label, safe = false) {
  const kb = pg.keyboard;
  const seq = [];
  const hold = async (keys, ms) => { for (const k of keys) await kb.down(k); await sleep(ms); for (const k of keys.slice().reverse()) await kb.up(k); };
  await hold(['KeyW'], 2500); seq.push('walk 2.5s');
  if (!safe) { await hold(['KeyW', 'KeyD'], 1200); seq.push('walk diag'); }
  await kb.down('ShiftLeft'); await hold(['KeyW'], 3000); seq.push('run 3s');
  await kb.down('KeyW');
  for (let k = 0; k < 6; k++) { await kb.press('Space'); await sleep(450 + (k % 3) * 120); }   // nhảy liên tục khi chạy
  seq.push('run+jump x6');
  await kb.up('KeyW'); await kb.up('ShiftLeft');
  if (!safe) { await hold(['KeyA', 'KeyW'], 1500); seq.push('walk turn'); } else { await hold(['KeyS'], 1500); seq.push('walk back'); }
  for (let k = 0; k < 4; k++) { await kb.press('Space'); await sleep(300); }  seq.push('jump in place x4');
  // nhả/bấm Shift liên tục khi đang chạy (đổi chế độ đi↔chạy giữa 2 STATE)
  await kb.down('KeyW');
  for (let k = 0; k < 10; k++) { await kb.down('ShiftLeft'); await sleep(90 + k * 13); await kb.up('ShiftLeft'); await sleep(70 + k * 9); }
  await kb.up('KeyW'); seq.push('shift toggle x10');
  report.phases[label] = { seq };
}
// lên–xuống dồn dập: nút 🏍️ (gọi/xuống) + E (xuống), khoảng 60–400 ms
async function mountSpam(pg, label, n = 24) {
  const gaps = [];
  for (let k = 0; k < n; k++) {
    const gap = [60, 90, 120, 160, 220, 300, 400][k % 7];
    if (k % 3 === 2 && await mounted(pg)) await pg.keyboard.press('KeyE'); else await clickMoto(pg);
    gaps.push(gap);
    await sleep(gap);
    if (k % 5 === 4) { await pg.keyboard.down('KeyW'); await sleep(350); await pg.keyboard.up('KeyW'); }   // nhích xe/người giữa các lần
  }
  report.phases[label] = { n, gaps };
}

async function main() {
  startServer();
  const h = await waitHealth();
  L('máy chủ:', JSON.stringify(h));
  const invite = await makeInvite();
  const g = await openGame({ port: PORT, quality: 'full', start: false, extra: `&server=ws://127.0.0.1:${GAME}` });
  const pg = g.pg;
  report.tier = g.tier; report.gpu = g.gpu;
  try {
    await pg.waitForSelector('#mpPanel', { timeout: 20000 });
    await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
    await pg.fill('#mpNick', 'Người Lái Xe');
    await pg.fill('#mpInvite', invite);
    await pg.click('#startBtn');
    await pg.waitForSelector('#mpCode .mpOk', { timeout: 20000 });
    await pg.click('#mpCode .mpOk');
    await pg.waitForFunction(() => { const s = window.__hp.net && window.__hp.net.status(); return s && s.conn === 'live' && s.started; }, null, { timeout: 30000 });
    await pg.waitForFunction(() => !document.getElementById('dialogue').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 3; i++) { await pg.keyboard.press('Escape'); await sleep(200); }
    await pg.evaluate(() => { window.__hp.pinQuality(true); });
    const s0 = await status(pg);
    report.netId = s0.netId;
    step('vào thành phố (máy chủ test)', s0.conn === 'live', s0);
    const me = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z, tier: window.__hp.tier, gpu: window.__hp.gpu }));
    report.spawn = me; report.tier = me.tier; report.gpu = me.gpu;
    // __hp.net có (localhost + ?qa=1)
    step('__hp.net QA có trên localhost/?qa=1', await pg.evaluate(() => !!window.__hp.net && typeof window.__hp.net.drop === 'function'));

    // A. đi / chạy / nhảy
    await shot(pg, '01_foot.png');
    await footRoutine(pg, 'A_foot');
    let s = await status(pg);
    step('A. đi/chạy/nhảy/đổi Shift → 0 CORRECT', s.correct.count === 0, { correct: s.correct, stateSent: s.stateSent });

    // B. lên–xuống dồn dập
    await mountSpam(pg, 'B_mountspam', 28);
    if (!await mounted(pg)) await clickMoto(pg);
    await sleep(600);
    s = await status(pg);
    step('B. lên/xuống xe dồn dập (nút 🏍️ + E, 60–400 ms) → 0 CORRECT', s.correct.count === 0, { correct: s.correct });
    await shot(pg, '02_mounted.png');

    // C. lái xe máy ga hết cỡ theo lộ trình
    const from = await pg.evaluate(() => { const v = window.__hp.pState.mounted; return { x: v.pos.x, z: v.pos.z }; });
    const route = await buildRoute(from);
    route.pauseAt = route.hvtMidIdx;   // dừng trên nhịp cầu HVT gần mép vùng chơi: bài D
    report.route = { lenM: route.lenM, tags: route.tags, n: route.pts.length, pauseAt: route.pauseAt };
    L('lộ trình', JSON.stringify(report.route));
    await installDriver(pg, route);
    const tDrive = Date.now();
    const track = [];
    let shotTags = new Set(), didDeck = false;
    while (true) {
      await sleep(1000);
      const r = await rp(pg);
      track.push({ t: Math.round((Date.now() - tDrive) / 1000), ...r, corr: r.corr.count });
      if (!shotTags.has(r.tag) && r.mounted && r.vel > 6) { shotTags.add(r.tag); await shot(pg, `03_drive_${r.tag}.png`); }
      if (track.length % 15 === 0) L('lái', JSON.stringify(r));
      if (r.paused && !didDeck) {
        didDeck = true;
        L('D. trên mặt cầu HVT', JSON.stringify(r));
        await shot(pg, '04_hvt_deck_mounted.png');
        // xuống xe (E), đi/chạy/nhảy trên mặt cầu, lên xuống dồn dập, rồi lên xe chạy tiếp
        await pg.keyboard.press('KeyE'); await sleep(500);
        await footRoutine(pg, 'D_deck_foot', true);
        await shot(pg, '05_hvt_deck_foot.png');
        await mountSpam(pg, 'D_deck_mountspam', 21);
        if (!await mounted(pg)) await clickMoto(pg);
        await sleep(500);
        const dd = await status(pg);
        report.phases.D = { pos: await rp(pg), correct: dd.correct };
        await pg.evaluate(() => { window.__rp.paused = false; });
      }
      if (!r.mounted && !r.paused && !r.done) { await clickMoto(pg); }   // (lỡ rơi khỏi xe) gọi lại
      const el = (Date.now() - tDrive) / 1000;
      if ((r.done && el >= DRIVE_MIN_S) || el > DRIVE_MAX_S) break;
      if (r.done && el < DRIVE_MIN_S) {   // hết lộ trình mà chưa đủ 3 phút: chạy vòng lại từ đầu phần phố
        L('hết lộ trình trước', DRIVE_MIN_S, 's — chạy thêm');
        const back = await pg.evaluate(() => { const v = window.__hp.pState.mounted; return v ? { x: v.pos.x, z: v.pos.z } : null; });
        if (back) { const r2 = await buildRoute(back); r2.pauseAt = -1; await installDriver(pg, r2); }
      }
    }
    await pg.evaluate(() => { window.__rp.done = true; });
    const fin = await rp(pg);
    report.drive = { seconds: Math.round((Date.now() - tDrive) / 1000), ...fin, tagsSeen: await pg.evaluate(() => window.__rp.tagsSeen), fallList: await pg.evaluate(() => window.__rp.falls) };
    fs.writeFileSync(path.join(OUT, 'track.json'), JSON.stringify(track));
    await shot(pg, '06_end.png');
    s = await status(pg);
    const tags = report.drive.tagsSeen || {};
    step('C. xe máy ga hết cỡ ≥ 3 phút (phố + dốc xoắn + nhịp cầu HVT + cầu Lạc Long) → 0 CORRECT',
      s.correct.count === 0 && report.drive.mountedS >= 180 && (tags.hvt_up || 0) > 300 && (tags.hvt_down || 0) > 300, { correct: s.correct, mountedS: report.drive.mountedS, distM: report.drive.distM, maxV: report.drive.maxV, maxY: report.drive.maxY,
        hvtUp: tags.hvt_up || 0, hvtDown: tags.hvt_down || 0, lacLong: tags.laclong || 0, reverses: report.drive.reverses });
    step('không rơi khỏi mặt cầu khi đang lái (độ cao tụt > 3 m trong 1 khung)', (report.drive.fallList || []).length === 0, { falls: report.drive.fallList });
    step('D. trên mặt cầu: xuống xe, đi/chạy/nhảy, lên–xuống dồn dập → 0 CORRECT', didDeck && report.phases.D && report.phases.D.correct.count === 0, report.phases.D || {});

    // tổng kết phía máy chủ
    await sleep(1500);
    const corrLines = serverLines('correct'), violLines = serverLines('violation');
    const met = await metricsViol();
    report.server = { correctLines: corrLines.length, violationLines: violLines.length, metrics: met, sampleViolations: violLines.slice(0, 20) };
    fs.writeFileSync(path.join(OUT, 'validator_log.jsonl'), [...corrLines, ...violLines].map((l) => JSON.stringify(l)).join('\n'));
    const violTotal = Object.entries(met).filter(([k]) => k.startsWith('violations_total')).reduce((a, [, v]) => a + v, 0);
    step('máy chủ: 0 dòng "correct" + 0 vi phạm trong log trình kiểm', corrLines.length === 0 && violTotal === 0, { correctLines: corrLines.length, violationLines: violLines.length, metrics: met });
    report.errorsBrowser = g.errors.slice(0, 20);
    step('0 lỗi JS', g.errors.length === 0, { errors: g.errors.slice(0, 5) });
  } catch (e) {
    report.errors.push(String(e && e.stack || e));
    L('LỖI', e && e.stack || e);
    try { await shot(pg, 'zz_error.png'); } catch { /* ignore */ }
  } finally {
    try { await g.close(); } catch { /* ignore */ }
    await killServer();
    report.finishedAt = new Date().toISOString();
    report.passed = report.steps.filter((x) => x.ok).length;
    report.failed = report.steps.filter((x) => !x.ok).map((x) => x.name);
    save();
    L(`XONG: ${report.passed}/${report.steps.length} bước đạt`, report.failed.length ? 'TRƯỢT: ' + report.failed.join(' | ') : '');
    process.exit(report.failed.length || report.errors.length ? 1 : 0);
  }
}
main();
