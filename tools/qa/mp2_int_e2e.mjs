// tools/qa/mp2_int_e2e.mjs — KIỂM ĐẦU-CUỐI MP-2 SAU TÍCH HỢP (C1 mạng/phiên/giao diện + C2 hình người chơi khác THẬT):
// máy chủ THẬT chế độ test + 30–96 bot S4 (server/bots/lib/bot.mjs, cùng mã với server/bots/run.mjs) dồn quanh điểm xuất
// hiện của trình duyệt + MỘT Chrome dưới khoá GPU (launch.mjs openGame giữ khoá tới close(); bot chạy trong CÙNG tiến trình
// nên tải bot cũng nằm dưới khoá).
//
//   python -m http.server 8813   (gốc worktree)
//   PW_PATH=<playwright-core/index.mjs> node tools/qa/mp2_int_e2e.mjs --port 8813 --game 9230 --bots 96 \
//        --out C:/Users/Admin/hp-world-work/mp2/int/e2e
//   --docker : máy chủ đã chạy sẵn (server/ops/mo-may-chu.ps1 -TestMode, cổng --game/--game+1) → KHÔNG tự bật/tắt máy chủ,
//              chạy bản rút gọn (vào thành phố qua portal Docker, bot, thấy nhau, chat 2 chiều, CORRECT), không có trình duyệt 2.
//   --uncapped 1 (mặc định): Chrome --disable-gpu-vsync --disable-frame-rate-limit → fps thật, không kẹp 60.
// Máy chủ native: HPMP_TEST=1, cổng --game/--game+1, PGlite ở <out>/../data_e2e — KHÔNG đụng máy chủ thật 9100.
// Bước (report.json + ảnh): tiêu đề → tài khoản (biệt danh có dấu + mã mời) → mã khôi phục → vào thành phố → bot tới (ảnh xe
// máy khi họ đang chạy tới) → người chơi khác vẽ bằng remote_avatars THẬT (vòng sáng + bảng tên tiếng Việt, ≤ 6 draw call, đo
// A/B bật/tắt mô-đun cùng khung) → chat 2 chiều → tin bị lọc → báo cáo + chặn → bot gian lận tốc độ bị kéo về (trình duyệt
// không thấy nó nhảy) → trình duyệt __hp.teleport bị CORRECT → RESUME → ngày/đêm → tắt máy chủ (Khám phá) → bật lại (tự nối
// lại) → trình duyệt 2 TIER 1 (lite, lấy lại tài khoản bằng mã khôi phục): trần 40 người + đo A/B + cùng giờ ngày/đêm.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { args, openGame } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const PORT = +A.get('port', 8813);
const GAME = +A.get('game', 9230);
const DOCKER = A.has('docker');
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2/int/' + (DOCKER ? 'docker' : 'e2e')));
const DATA = path.resolve(A.get('data', path.join(OUT, '..', 'data_e2e')));
const NBOTS = +A.get('bots', DOCKER ? 16 : 96);
const UNCAPPED = A.get('uncapped', '1') !== '0';
const PERFONLY = A.has('perfonly');   // chỉ: vào + bot + đo A/B TIER 3 (thăm dò hiệu năng nhanh), bỏ các bước còn lại
const CHROME_ARGS = UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
fs.mkdirSync(OUT, { recursive: true });
if (!DOCKER) fs.mkdirSync(DATA, { recursive: true });
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), port: PORT, game: GAME, docker: DOCKER, nbots: NBOTS, uncapped: UNCAPPED, steps: [], errors: [] };
const logLines = [];
const T0 = Date.now();
const L = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ` + a.join(' '); console.log(s); logLines.push(s); };
function step(name, ok, data = {}) { report.steps.push({ name, ok: !!ok, ...data }); L(ok ? 'ĐẠT ' : 'TRƯỢT', name, JSON.stringify(data).slice(0, 500)); save(); }
function save() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, 'e2e.log'), logLines.join('\n'));
}

// ---------------------------------------------------------------------------------------------------------------------
// máy chủ game native (chế độ test, cổng riêng)
let srv = null;
function startServer(tag) {
  if (DOCKER) return null;
  const log = fs.openSync(path.join(OUT, `server_${tag}.log`), 'a');
  srv = spawn(process.execPath, ['src/main.js'], {
    cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
    env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'),
      DATA_DIR: DATA, LOG_LEVEL: 'info' },
  });
  srv.on('exit', (c, s) => L('máy chủ thoát', c, s || ''));
  return srv;
}
async function waitHealth(ms = 40000) {
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
    body: JSON.stringify({ count: 1, uses, days: 2, note: 'mp2-int e2e' }) });
  const j = await r.json();
  return (j.codes || [])[0];
}
async function guest(nickname, invite, deviceId) {
  const r = await fetch(HTTP + '/v1/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, inviteCode: invite, deviceId }) });
  return { status: r.status, body: await r.json() };
}

// ---------------------------------------------------------------------------------------------------------------------
// bot trong tiến trình (đúng mã bot của S4: server/bots/lib/bot.mjs — run.mjs dùng chính lớp này)
let bots = [], botTimer = null;
const NAMES = ['Nguyễn Thị Hường', 'Đặng Quốc Việt', 'Trần Ngọc Ánh', 'Lê Thị Thuỷ', 'Phạm Đức Hưởng', 'Vũ Hoàng Yến', 'Bùi Thế Lữ',
  'Hoàng Ngọc Ngà', 'Đỗ Quỳnh Hương', 'Nguyễn Văn Đức', 'Trịnh Thị Ửng', 'Lý Thường Kiệt'];
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
  // MỌI bot có biệt danh tiếng Việt có dấu (tạo trước bằng API, bot dùng refresh token) — kiểm dấu trên chat/bảng tên
  for (let i = 0; i < n; i++) {
    const dev = `mp2intbot-${String(i).padStart(4, '0')}-${Date.now() % 100000}`;
    let creds = null;
    const g = await guest(NAMES[i % NAMES.length], invite, dev);
    if (g.status === 200) creds = { refreshToken: g.body.refreshToken };
    else L('tạo bot lỗi', g.status, JSON.stringify(g.body));
    const wide = i % 4 === 3;
    const spec = { idx: i, behavior: 'plaza', target: { x: target.x + (Math.random() - 0.5) * 6, z: target.z + (Math.random() - 0.5) * 6, r: wide ? 26 : 13 },
      travelMode: 4 /* MODE.MOTO */, chat: false, dropPerMin: 0, mode: 'full', httpUrl: HTTP, wsUrl: HTTP.replace('http', 'ws') + '/play',
      invite, origin: null, tier: 2, deviceId: dev, creds };
    const b = new Bot(spec, ctx);
    b.recv = [];
    bots.push(b);
    b.start();
    await sleep(40);
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
const shot = async (pg, name, clip) => { const f = path.join(OUT, name); await pg.screenshot({ path: f, clip }); report.shots = report.shots || []; report.shots.push(f); return f; };

// camera nhìn QUA người chơi về phía điểm (bx, bz) — KHÔNG dời người chơi (teleport tại chỗ chỉ đặt cam.yaw/pitch/dist)
async function lookToward(pg, bx, bz, dist, pitch, hideSelf = true) {
  return pg.evaluate(([bx, bz, dist, pitch, hide]) => {
    const h = window.__hp, p = h.pState.pos;
    const yaw = Math.atan2(p.x - bx, p.z - bz);
    if (h.camOcclusion) h.camOcclusion(false);   // góc QA giữ đúng khoảng cách (cần boom chống xuyên tường tắt — như shoot.mjs)
    h.teleport(p.x, p.z, yaw, pitch, dist);
    h.player.group.visible = !hide;
    return { x: p.x, z: p.z, yaw };
  }, [bx, bz, dist, pitch, hideSelf]);
}
const showSelf = (pg) => pg.evaluate(() => { window.__hp.player.group.visible = true; });

// đo trong trang: draw call / tam giác / thời gian khung (median trên cửa sổ ms) + draw call của RIÊNG mesh mp_* (bọc
// renderBufferDirect 10 khung — chính xác, không nhiễu bóng/AO như hiệu số tổng)
async function measure(pg, ms = 4000) {
  return pg.evaluate(async (ms) => {
    const h = window.__hp, R = h.renderer;
    const calls = [], tris = [], dts = [];
    const ra0 = h.net && h.net.avatars && h.net.avatars();
    const up0 = ra0 ? ra0.stats().tagAtlas.uploads : 0, sub0 = ra0 ? ra0.stats().tagAtlas.subUploads || 0 : 0;
    const prev = R.info.autoReset; R.info.autoReset = false; R.info.reset();
    let last = performance.now(); const end = last + ms;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const n = performance.now();
      calls.push(R.info.render.calls); tris.push(R.info.render.triangles); dts.push(n - last); last = n; R.info.reset();
    }
    R.info.autoReset = prev;
    calls.shift(); tris.shift(); dts.shift();
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const sd = dts.slice().sort((a, b) => a - b), sum = dts.reduce((a, b) => a + b, 0);
    const m50 = med(dts), longFrames = dts.filter((x) => x > m50 * 1.8).length;
    const tagUploads = ra0 ? ra0.stats().tagAtlas.uploads - up0 : 0, tagSubUploads = ra0 ? (ra0.stats().tagAtlas.subUploads || 0) - sub0 : 0;
    // draw call theo mesh mp_*
    const orig = R.renderBufferDirect, per = {};
    let nF = 0, total = 0;
    R.renderBufferDirect = function (camera, scene, geometry, material, object) {
      total++;
      if (object && object.name && object.name.startsWith('mp_')) per[object.name] = (per[object.name] || 0) + 1;
      return orig.apply(this, arguments);
    };
    await new Promise((r) => { const f = () => (++nF >= 10 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    R.renderBufferDirect = orig;
    let mp = 0; const byMesh = {};
    for (const k in per) { byMesh[k] = +(per[k] / 10).toFixed(2); mp += per[k]; }
    const ra = h.net && h.net.avatars && h.net.avatars();
    return { frames: dts.length, fps: +(1000 * dts.length / sum).toFixed(1), p50ms: +med(dts).toFixed(2), p95ms: +(sd[Math.floor(sd.length * 0.95)] || 0).toFixed(2),
      callsMedian: med(calls), trisMedian: med(tris), programs: R.info.programs.length, longFrames, tagUploads, tagSubUploads, meanMs: +(sum / dts.length).toFixed(3),
      mpCallsPerFrame: +(mp / 10).toFixed(2), mpByMesh: byMesh, ra: ra ? (({ count, drawn, drawCalls, peds, bikes, bikesFar, tags, rings, cap, ms }) => ({ count, drawn, drawCalls, peds, bikes, bikesFar, tags, rings, cap, ms }))(ra.stats()) : null };
  }, ms);
}
const setRA = (pg, on) => pg.evaluate((on) => { const ra = window.__hp.net.avatars(); if (ra) ra.setEnabled(on); return !!ra; }, on);
// A/B CÙNG KHUNG NHÌN: mô-đun bật ↔ tắt (setEnabled false = không vẽ, không nội suy), xen kẽ `rounds` lượt
async function abToggle(pg, rounds = 3, ms = 4000) {
  const on = [], off = [];
  for (let r = 0; r < rounds; r++) {
    await setRA(pg, true); await sleep(800); on.push(await measure(pg, ms));
    await setRA(pg, false); await sleep(800); off.push(await measure(pg, ms));
  }
  await setRA(pg, true);
  const med = (a, k) => { const s = a.map((x) => x[k]).sort((x, y) => x - y); return s[s.length >> 1]; };
  const sum = {};
  for (const k of ['fps', 'meanMs', 'p50ms', 'p95ms', 'callsMedian', 'trisMedian', 'longFrames', 'tagUploads', 'tagSubUploads']) sum[k] = { on: med(on, k), off: med(off, k), delta: +(med(on, k) - med(off, k)).toFixed(2) };
  sum.mpCallsPerFrame = med(on, 'mpCallsPerFrame');
  sum.mpByMesh = on[on.length - 1].mpByMesh;
  sum.ra = on[on.length - 1].ra;
  sum.programs = { on: med(on, 'programs'), off: med(off, 'programs') };
  return { summary: sum, on, off };
}

// ảnh PHÓNG TO bảng tên của 1 người (chiếu vị trí đầu lên màn hình rồi cắt khung)
async function tagZoom(pg, netId, file, w = 460, hgt = 150) {
  const c = await pg.evaluate((id) => {
    const h = window.__hp, ra = h.net.avatars(), d = ra && ra.debug(id);
    if (!d) return null;
    const v = new h.THREE.Vector3(d.x, d.y + 1.95, d.z).project(h.camera);
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    return { sx, sy, vis: v.z < 1 && sx >= 0 && sx <= innerWidth && sy >= 0 && sy <= innerHeight, W: innerWidth, H: innerHeight };
  }, netId);
  if (!c || !c.vis) return null;
  const x = Math.max(0, Math.min(c.W - w, Math.round(c.sx - w / 2))), y = Math.max(0, Math.min(c.H - hgt, Math.round(c.sy - hgt * 0.6)));
  await shot(pg, file, { x, y, width: w, height: hgt });
  return { x, y, sx: Math.round(c.sx), sy: Math.round(c.sy) };
}

// ---------------------------------------------------------------------------------------------------------------------
async function main() {
  // 0) máy chủ
  if (!DOCKER) startServer('a');
  const h = await waitHealth(DOCKER ? 10000 : 40000);
  L('máy chủ:', JSON.stringify(h));
  report.health = h;
  const invite = await makeInvite(NBOTS + 20);
  report.inviteMade = !!invite;

  // 1) trình duyệt #1 (TIER 3, full) — màn tiêu đề
  const NICK = DOCKER ? 'Đặng Quốc Việt' : 'Nguyễn Thị Hường';
  const g = await openGame({ port: PORT, quality: 'full', start: false, extra: `&server=ws://127.0.0.1:${GAME}`, chromeArgs: CHROME_ARGS });
  const pg = g.pg;
  report.tier = g.tier; report.gpu = g.gpu; report.hpReadyMs = g.hpReadyMs;
  const netLog = [];
  pg.on('console', (m) => { const s = m.text(); if (s.startsWith('[net]') || s.startsWith('[remote_avatars]')) netLog.push(s); });
  let code = { v: null };
  try {
    await pg.waitForSelector('#mpPanel', { timeout: 20000 });
    await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
    await shot(pg, '01_title.png');
    step('màn tiêu đề có ô biệt danh + mã mời + 2 nút', await pg.evaluate(() => !!(document.getElementById('mpNick') && document.getElementById('mpInvite') && document.getElementById('mpSolo')
      && /Vào thành phố/.test(document.getElementById('startBtn').textContent))));

    await pg.fill('#mpNick', NICK);
    if (!DOCKER) {
      // lỗi tiếng Việt: mã mời sai
      await pg.fill('#mpInvite', 'AAAAA-BBBBB');
      await pg.click('#startBtn');
      const e1 = await waitFor(pg, () => { const t = document.getElementById('mpErr').textContent; return /Mã mời/.test(t) ? t : null; }, null, 10000, 'lỗi mã mời');
      step('mã mời sai → lời báo tiếng Việt', !!e1.v, { text: e1.v });
      await shot(pg, '02_invite_error.png');
    }
    // tạo tài khoản → mã khôi phục hiện 1 lần
    await pg.fill('#mpInvite', invite);
    const tJoin0 = Date.now();
    await pg.click('#startBtn');
    code = await waitFor(pg, () => { const el = document.querySelector('#mpCode .mpCodeVal'); return el ? el.textContent : null; }, null, 15000, 'mã khôi phục');
    step('tạo tài khoản → mã khôi phục 12 ký tự hiện một lần', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.v || ''), { code: code.v ? code.v.slice(0, 4) + '-****-****' : null });
    await shot(pg, '03_recovery_code.png');
    await pg.click('#mpCode .mpOk');
    const live = await waitFor(pg, () => { const s = window.__hp.net.status(); return s.conn === 'live' && s.started ? s : null; }, null, 30000, 'vào thành phố');
    step('vào thành phố (WELCOME + READY)', !!live.v, { ms: Date.now() - tJoin0, netId: live.v && live.v.netId, account: live.v && live.v.account });
    await waitFor(pg, () => (!document.getElementById('dialogue').classList.contains('hidden') ? 1 : null), null, 4000, 'hội thoại hướng dẫn');
    for (let i = 0; i < 3; i++) { await pg.keyboard.press('Escape'); await sleep(200); }
    await pg.evaluate(() => window.__hp.pinQuality && window.__hp.pinQuality(true));
    await pg.evaluate(() => window.__hp.setTime && window.__hp.setTime(0.42));   // giữa buổi sáng: ảnh rõ (ngày/đêm chung nắn lại sau ~1 s → đo ngày/đêm ở bước sau)
    const me = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    report.browserSpawn = me;
    L('trình duyệt đứng ở', JSON.stringify(me));
    report.programsBeforeAvatars = await pg.evaluate(() => window.__hp.renderer.info.programs.map((p) => p.name || p.cacheKey.slice(0, 60)));

    // 2) bot tới quanh người chơi — trong lúc họ chạy xe máy tới: chụp người lái xe
    const W = await startBots(NBOTS, me, invite);
    const need = Math.floor(NBOTS * (DOCKER ? 0.6 : 0.85));
    const tB = Date.now();
    let riderShots = 0, near = null;
    report.riders = [];
    while (Date.now() - tB < 360000) {
      const s = await pg.evaluate(() => {
        const h = window.__hp, p = h.pState.pos, ps = h.net.players();
        const d = (q) => Math.hypot(q.x - p.x, q.z - p.z);
        const bikes = ps.filter((q) => (q.state & 7) === 4 && q.drawn && d(q) > 5 && d(q) < 22).map((q) => ({ ...q, d: d(q) })).sort((a, b) => a.d - b.d);
        return { near: ps.filter((q) => d(q) < 60).length, count: ps.length, bikes: bikes.slice(0, 4), stats: h.net.status().ra };
      });
      if (riderShots < 4 && s.bikes.length && Date.now() - (report._lastRider || 0) > 5000) {
        const b = s.bikes[0];
        // lượt chẵn: chụp khi đang chạy; lượt lẻ: bảo bot DỪNG XE (vẫn ngồi trên xe, idleUntil) rồi chụp cận cảnh
        const bo = bots.find((x) => x.r.netId === b.netId);
        if (riderShots % 2 === 1 && bo) {
          bo.idleUntil = performance.now() + 9000;
          await sleep(2500);
          const q = await pg.evaluate((id) => window.__hp.net.players().find((x) => x.netId === id) || null, b.netId);
          if (q) await lookToward(pg, q.x, q.z, 3.2, 0.12);
          await sleep(900);
        } else await lookToward(pg, b.x, b.z, 4, 0.14);
        await shot(pg, `04_rider_${riderShots}.png`);
        const dbg = await pg.evaluate((id) => window.__hp.net.avatars().debug(id), b.netId);
        report.riders.push({ netId: b.netId, name: b.name, d: +b.d.toFixed(1), nBikes: s.bikes.length, debug: dbg, stats: s.stats });
        report._lastRider = Date.now();
        riderShots++;
      }
      if (s.near >= need) { near = { ...s, waitMs: Date.now() - tB }; break; }
      await sleep(900);
    }
    await showSelf(pg);
    step('thấy người chơi khác quanh mình (bot S4 dồn tới)', !!near, near ? { near: near.near, count: near.count, need, waitMs: near.waitMs } : { need });
    step('người chơi khác ĐI XE MÁY vẽ bằng mô hình xe + người lái (ảnh lúc bot chạy tới)', report.riders.length > 0
      && report.riders.some((r) => r.debug && r.debug.mode === 4), { riders: report.riders.map((r) => ({ netId: r.netId, name: r.name, d: r.d, mode: r.debug && r.debug.mode, far: r.debug && r.debug.far, lean: r.debug && +r.debug.lean.toFixed(3) })) });
    await sleep(DOCKER ? 3000 : 12000);   // để bot cuối xuống xe + tản ra quanh người chơi

    // 3) mô-đun người chơi khác THẬT: vòng sáng + bảng tên + draw call cố định
    const crowd = await pg.evaluate(() => {
      const h = window.__hp, p = h.pState.pos, ps = h.net.players();
      let cx = 0, cz = 0, n = 0;
      for (const q of ps) if (Math.hypot(q.x - p.x, q.z - p.z) < 40) { cx += q.x; cz += q.z; n++; }
      return n ? { x: cx / n, z: cz / n, n } : null;
    });
    // camera trên cao nhìn cả đám đông (đứng phía đối diện tâm đám đông)
    const pPos = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    const awayX = crowd ? 2 * pPos.x - crowd.x : pPos.x, awayZ = crowd ? 2 * pPos.z - crowd.z : pPos.z + 1;
    await lookToward(pg, crowd ? crowd.x : pPos.x, crowd ? crowd.z : pPos.z - 1, 30, 0.42, false);
    await sleep(2500);
    await shot(pg, '05_crowd.png');
    const s5 = await pg.evaluate(() => window.__hp.net.status().ra);
    await lookToward(pg, crowd ? crowd.x : pPos.x, crowd ? crowd.z : pPos.z - 1, 70, 0.85, false);
    await sleep(2500);
    await shot(pg, '05_crowd_high.png');
    const perfCam = { crowd, awayX, awayZ };
    report.crowdStats = s5;
    // A/B cùng khung: bật ↔ tắt mô-đun (TIER 3)
    await lookToward(pg, crowd ? crowd.x : pPos.x, crowd ? crowd.z : pPos.z - 1, 30, 0.42, false);
    await sleep(1500);
    const ab3 = await abToggle(pg, DOCKER ? 1 : 3, 4000);
    report.perfTier3 = ab3;
    report.programsWithAvatars = await pg.evaluate(() => window.__hp.renderer.info.programs.map((p) => p.name || p.cacheKey.slice(0, 60)));
    const newProgs = report.programsWithAvatars.filter((p) => !report.programsBeforeAvatars.includes(p));
    report.newPrograms = newProgs;
    const S = ab3.summary;
    step('vẽ bằng remote_avatars THẬT: vòng sáng + bảng tên, draw call mô-đun ≤ 6 (đếm theo mesh mp_*)',
      S.ra && S.ra.drawn >= Math.min(need, 40) && S.ra.rings > 0 && S.ra.tags > 0 && S.mpCallsPerFrame <= 6 && S.ra.drawCalls <= 6,
      { ra: S.ra, mpCallsPerFrame: S.mpCallsPerFrame, mpByMesh: S.mpByMesh, callsDelta: S.callsMedian, fps: S.fps, newPrograms: newProgs });

    if (PERFONLY) { await g.close(); return; }
    // bảng tên cận cảnh: dấu tiếng Việt khó
    const hard = await pg.evaluate(() => {
      const h = window.__hp, p = h.pState.pos;
      // người mang tên khó, cách người chơi 2,5–8 m, ÍT người khác quanh (bảng tên không chồng nhau) — 1 Hường + 1 Việt
      const all = h.net.players();
      const c = all.filter((q) => /Nguyễn Thị Hường|Đặng Quốc Việt/.test(q.name) && q.drawn)
        .map((q) => ({ ...q, d: Math.hypot(q.x - p.x, q.z - p.z), crowd: all.filter((o) => o !== q && Math.hypot(o.x - q.x, o.z - q.z) < 2.5).length }))
        .filter((q) => q.d > 2.5 && q.d < 8).sort((a, b) => a.crowd - b.crowd || a.d - b.d);
      const out = [];
      for (const re of [/Nguyễn Thị Hường/, /Đặng Quốc Việt/]) { const q = c.find((x) => re.test(x.name)); if (q) out.push(q); }
      return out;
    });
    report.hardNames = hard;
    const zooms = [];
    for (const q0 of hard.slice(0, 2)) {
      // bảo bot ĐỨNG YÊN (plaza.pauseUntil) để khung hình không trôi, rồi ngắm theo vị trí đang vẽ
      const bo = bots.find((x) => x.r.netId === q0.netId);
      if (bo && bo.plaza) { bo.plaza.pauseUntil = performance.now() + 20000; bo.vTarget = 0; }
      await sleep(1500);
      const q = { ...q0, ...(await pg.evaluate((id) => window.__hp.net.players().find((x) => x.netId === id) || null, q0.netId) || {}) };
      await lookToward(pg, q.x, q.z, 1.6, 0.05);
      await sleep(1500);
      const nm = q.name.startsWith('Nguyễn') ? 'huong' : 'viet';
      await shot(pg, `06_tags_close_${nm}.png`);
      const z = await tagZoom(pg, q.netId, `06_tag_zoom_${nm}.png`, 520, 170);
      zooms.push({ netId: q.netId, name: q.name, d: +q.d.toFixed(1), crowd: q.crowd, zoom: z });
    }
    const atlas = await pg.evaluate(() => { const ra = window.__hp.net.avatars(); return ra && ra.tags && ra.tags.canvas ? ra.tags.canvas.toDataURL('image/png') : null; });
    if (atlas) fs.writeFileSync(path.join(OUT, '06_tag_atlas.png'), Buffer.from(atlas.split(',')[1], 'base64'));
    await showSelf(pg);
    step('bảng tên có dấu tiếng Việt khó ("Nguyễn Thị Hường", "Đặng Quốc Việt") — ảnh phóng to + atlas', zooms.some((z) => z.zoom) && !!atlas, { zooms });

    // 4) chat 2 chiều có dấu (người nói = bot GẦN NHẤT trong 25 m)
    await lookToward(pg, crowd ? crowd.x : pPos.x, crowd ? crowd.z : pPos.z - 1, 12, 0.3, false);
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
    const BROWSER_SAYS = 'Xin chào cả nhà! Mình đang ở đây nè, thấy mọi người rồi 🌺';
    await pg.keyboard.type(BROWSER_SAYS, { delay: 5 });
    await pg.keyboard.press('Enter');
    const echo = await waitFor(pg, (txt) => window.__hp.net.chatLines().some((l) => l.kind === 'self' && l.text.includes(txt)) || null, BROWSER_SAYS, 8000, 'tin vọng lại');
    await sleep(800);
    const botsGot = bots.filter((b) => (b.recv || []).some(([, t]) => t === BROWSER_SAYS)).length;
    step('trình duyệt nói → bot trong 40 m nhận đúng nguyên văn', !!echo.v && botsGot > 0, { botsGot, ofBots: bots.length });
    await shot(pg, '07_chat_roundtrip.png');

    if (!DOCKER) {
      // 5) tin bị lọc → lời từ chối tiếng Việt
      await sleep(5600);   // tài khoản mới: slow mode 1 tin / 5 s
      await pg.keyboard.press('KeyT');
      await pg.keyboard.type('Gọi mình số 0912 345 678 nhé', { delay: 5 });
      await pg.keyboard.press('Enter');
      const rej = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => x.kind === 'error').pop(); return l && /không được gửi/.test(l.text) ? l.text : null; }, null, 8000, 'từ chối');
      const leaked = bots.some((b) => (b.recv || []).some(([, t]) => /0912/.test(t)));
      step('tin có số điện thoại bị chặn, lời từ chối tiếng Việt, không lọt tới bot', !!rej.v && !leaked, { text: rej.v, leaked });
      await shot(pg, '08_chat_rejected.png');

      // 6) báo cáo + chặn từ menu chat
      await pg.keyboard.press('KeyT');
      await sleep(200);
      await pg.locator('.chatLine.say', { hasText: 'bánh đa cua' }).last().locator('.chatName').click();
      await sleep(300);
      await shot(pg, '09_chat_menu.png');
      await pg.click('#chatMenuMain button.warn');
      await sleep(200);
      await shot(pg, '10_report_reasons.png');
      await pg.locator('#chatMenuReasons button').nth(1).click();   // Quấy rối, đe doạ
      const rep = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => /báo cáo/.test(x.text)).pop(); return l ? l.text : null; }, null, 8000, 'kết quả báo cáo');
      step('báo cáo từ menu chat → máy chủ xác nhận (tiếng Việt)', !!rep.v && /Đã gửi báo cáo/.test(rep.v), { text: rep.v });
      await pg.keyboard.press('KeyT');
      await sleep(150);
      await pg.locator('.chatLine.say', { hasText: 'bánh đa cua' }).last().locator('.chatName').click().catch(() => {});
      await sleep(200);
      await pg.click('#chatMenuMain button.danger');
      const blk = await waitFor(pg, () => { const l = window.__hp.net.chatLines().filter((x) => /Đã chặn/.test(x.text)).pop(); return l ? l.text : null; }, null, 8000, 'kết quả chặn');
      await sleep(2500);
      const AFTER_BLOCK = 'Tin này sau khi bị chặn — không được hiện';
      talker.sendChat(AFTER_BLOCK);
      await sleep(2500);
      const seen = await pg.evaluate((t) => window.__hp.net.chatLines().some((l) => l.text.includes(t)), AFTER_BLOCK);
      const blockedStillDrawn = await pg.evaluate((id) => window.__hp.net.players().some((q) => q.netId === id), talker.r.netId);
      step('chặn từ menu chat → máy chủ ngừng giao tin của người bị chặn', !!blk.v && !seen, { text: blk.v, seenAfterBlock: seen, blockedAvatarStillListed: blockedStillDrawn });
      await shot(pg, '11_blocked.png');
      await pg.evaluate(() => { const b = document.getElementById('chatBox'); b.style.zoom = '2.2'; b.style.width = '560px'; });
      await sleep(300);
      await pg.locator('#chatLog').screenshot({ path: path.join(OUT, '12_vn_diacritics_chat_zoom.png') });
      await pg.evaluate(() => { const b = document.getElementById('chatBox'); b.style.zoom = ''; b.style.width = ''; });
      await pg.keyboard.press('Escape');
      await pg.evaluate(() => window.__hp.net.closeChat());
    }

    // 7) bot GIAN LẬN tốc độ (nhảy 150 m trong 1 STATE) → máy chủ CORRECT bot; trình duyệt KHÔNG thấy nó nhảy đi
    const cheatInfo = await pg.evaluate((tid) => { const p = window.__hp.pState.pos; return window.__hp.net.players().filter((q) => q.netId !== tid)
      .map((q) => ({ ...q, d: Math.hypot(q.x - p.x, q.z - p.z) })).filter((q) => q.d < 30).sort((a, b) => a.d - b.d)[0] || null; }, talker.r.netId);
    if (cheatInfo) {
      const cb = bots.find((b) => b.r.netId === cheatInfo.netId);
      const c0 = cb.r.corrects;
      const track = [];
      cb.x += 150; cb.z += 40;   // STATE kế tiếp mang vị trí nhảy 155 m (tốc độ ~2 km/s)
      for (let i = 0; i < 16; i++) {
        await sleep(150);
        const q = await pg.evaluate((id) => window.__hp.net.players().find((x) => x.netId === id) || null, cheatInfo.netId);
        if (q) track.push(Math.hypot(q.x - cheatInfo.x, q.z - cheatInfo.z));
      }
      const maxDev = track.length ? Math.max(...track) : null;
      step('bot gian lận tốc độ → máy chủ CORRECT bot, trình duyệt không thấy nó nhảy (lệch tối đa ≤ 8 m)', cb.r.corrects > c0 && maxDev != null && maxDev <= 8,
        { botNetId: cheatInfo.netId, correctsBefore: c0, correctsAfter: cb.r.corrects, maxDevSeenInBrowser: maxDev && +maxDev.toFixed(2), samples: track.length });
    } else step('bot gian lận tốc độ → máy chủ CORRECT bot (không có bot trong 30 m)', false, {});

    // 8) CORRECT sau __hp.teleport (máy chủ kéo trình duyệt về)
    const c0 = await st(pg);
    const p0 = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
    await pg.evaluate((p) => window.__hp.teleport(p.x + 300, p.z + 120, 0, 0.35, 14), p0);
    const back = await waitFor(pg, (o) => { const p = window.__hp.pState.pos; const s = window.__hp.net.status(); return s.correct.count > o.n && Math.hypot(p.x - o.x, p.z - o.z) < 8 ? { d: Math.hypot(p.x - o.x, p.z - o.z), correct: s.correct } : null; },
      { x: p0.x, z: p0.z, n: c0.correct.count }, 6000, 'CORRECT kéo về');
    step('__hp.teleport 325 m → máy chủ CORRECT, trình duyệt về vị trí hợp lệ', !!back.v, { ...back.v, ms: back.ms });
    await sleep(1000);

    if (!DOCKER) {
      // 9) RESUME: rớt socket giả → nối lại cùng netId (≤ 60 s); người khác không nhấp nháy
      const r0 = await st(pg);
      const n0 = r0.ra.count;
      await pg.evaluate(() => window.__hp.net.drop());
      const lost = await waitFor(pg, () => (window.__hp.net.status().conn !== 'live' ? window.__hp.net.status().conn : null), null, 3000, 'rớt');
      const minDuring = { v: n0 };
      const res = await waitFor(pg, (o) => { const s = window.__hp.net.status(); return s.conn === 'live' && s.tel.resumes > o.r ? s : null; }, { r: r0.tel.resumes }, 15000, 'resume');
      await sleep(1500);
      const r1 = await st(pg);
      step('rớt socket → RESUME giữ netId, người khác vẫn hiện', !!res.v && res.v.netId === r0.netId && r1.ra.count >= Math.floor(n0 * 0.8),
        { lostState: lost.v, ms: res.ms, netIdBefore: r0.netId, netIdAfter: res.v && res.v.netId, countBefore: n0, countAfter: r1.ra.count, minDuring: minDuring.v });

      // 10) ngày/đêm: client vs máy chủ
      await sleep(2500);
      const d1 = await st(pg);
      const dd = Math.abs(((d1.dayT - d1.serverDayT + 1.5) % 1) - 0.5);
      step('ngày/đêm khớp giờ máy chủ', dd < 0.002, { dayT: d1.dayT, serverDayT: d1.serverDayT, diffGameMin: +(dd * 1440).toFixed(2) });

      // 11) tắt máy chủ → Khám phá + HUD; người chơi vẫn đi được; bật lại → tự nối lại
      const k0 = Date.now();
      await killServer();
      const ex = await waitFor(pg, () => { const s = window.__hp.net.status(); const pill = document.getElementById('netStatus'); return (s.conn === 'lost' || s.conn === 'closed') && s.visible === 0 && s.ra && s.ra.count === 0 ? { conn: s.conn, pill: pill.textContent, visible: s.visible, raCount: s.ra.count } : null; }, null, 15000, 'Khám phá');
      step('tắt máy chủ → chế độ Khám phá + trạng thái HUD, người khác biến mất', !!ex.v && /Khám phá/.test(ex.v.pill), { ...ex.v, ms: ex.ms });
      const pa = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
      await pg.keyboard.down('KeyW'); await sleep(1500); await pg.keyboard.up('KeyW');
      const pb = await pg.evaluate(() => ({ x: window.__hp.pState.pos.x, z: window.__hp.pState.pos.z }));
      const moved = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      step('Khám phá: vẫn điều khiển nhân vật bình thường', moved > 2, { moved: +moved.toFixed(2) });
      await shot(pg, '13_explore_mode.png');
      await sleep(3000);
      startServer('b');
      await waitHealth();
      const up = Date.now();
      const re = await waitFor(pg, () => { const s = window.__hp.net.status(); return s.conn === 'live' ? s : null; }, null, 60000, 'nối lại sau khởi động');
      step('bật lại máy chủ → tự nối lại (vé mới, không cần thao tác)', !!re.v, { msAfterServerUp: Date.now() - up, downMs: up - k0, rejoins: re.v && re.v.tel.rejoins });
      const back2 = await waitFor(pg, (n) => { const s = window.__hp.net.status(); return s.ra && s.ra.count >= n ? s.ra : null; }, Math.floor(NBOTS * 0.5), 60000, 'thấy lại bot');
      step('sau khi nối lại thấy lại người chơi khác', !!back2.v, back2.v || {});
      await sleep(800);
      await shot(pg, '14_reconnected.png');
    }
    const fin = await st(pg);
    report.final1 = fin;
    report.errorsBrowser1 = g.errors.slice();
    report.netLog1 = netLog.slice(-60);
    report.day1b = { at: Date.now(), dayT: fin.dayT, serverDayT: fin.serverDayT };
    await g.close();

    if (!DOCKER) {
      // 12) trình duyệt #2 (tuần tự) TIER 1 (lite): lấy lại tài khoản bằng mã khôi phục, trần 40 người, đo A/B, ngày/đêm
      const g2 = await openGame({ port: PORT, quality: 'lite', start: false, extra: `&server=ws://127.0.0.1:${GAME}`, chromeArgs: CHROME_ARGS });
      try {
        const p2 = g2.pg;
        report.tier2 = g2.tier;
        await p2.waitForSelector('#mpPanel', { timeout: 20000 });
        await p2.click('#mpRecLink');
        await p2.fill('#mpRecCode', code.v.toLowerCase().replace(/-/g, ' '));
        await p2.click('#mpRecBtn');
        const rec = await waitFor(p2, () => { const w = document.getElementById('mpWho'); return w && !w.classList.contains('hidden') ? w.textContent : null; }, null, 10000, 'lấy lại tài khoản');
        step('trình duyệt mới: "Có mã khôi phục?" → lấy lại đúng tài khoản', !!rec.v && rec.v.includes(NICK), { who: rec.v });
        await shot(p2, '15_recovered_title.png');
        await p2.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
        await p2.click('#startBtn');
        const l2 = await waitFor(p2, () => { const s = window.__hp.net.status(); return s.conn === 'live' && s.started ? s : null; }, null, 30000, 'vào lần 2');
        await sleep(2500);
        const d2 = await p2.evaluate(() => window.__hp.net.status());
        const now2 = Date.now();
        const day1b = report.day1b;
        const expect = (day1b.serverDayT + (now2 - day1b.at) / 1000 / 1440) % 1;
        const diff2 = Math.abs(((d2.dayT - expect + 1.5) % 1) - 0.5);
        step('2 trình duyệt tuần tự: cùng giờ ngày/đêm (lệch < 2 phút game)', !!l2.v && diff2 * 1440 < 2, { dayT2: d2.dayT, expectFromBrowser1: +expect.toFixed(5), diffGameMin: +(diff2 * 1440).toFixed(2), gapS: Math.round((now2 - day1b.at) / 1000) });
        for (let i = 0; i < 3; i++) { await p2.keyboard.press('Escape'); await sleep(200); }
        await p2.evaluate(() => { window.__hp.pinQuality && window.__hp.pinQuality(true); window.__hp.setTime && window.__hp.setTime(0.42); });
        const many = await waitFor(p2, () => { const s = window.__hp.net.status(); return s.ra && s.ra.count >= 45 ? s.ra : null; }, null, 60000, 'lite ≥ 45 người');
        await sleep(2000);
        const c2 = await p2.evaluate(() => {
          const h = window.__hp, p = h.pState.pos, ps = h.net.players();
          let cx = 0, cz = 0, n = 0;
          for (const q of ps) if (Math.hypot(q.x - p.x, q.z - p.z) < 40) { cx += q.x; cz += q.z; n++; }
          return n ? { x: cx / n, z: cz / n, n } : { x: p.x, z: p.z - 1, n: 0 };
        });
        await lookToward(p2, c2.x, c2.z, 30, 0.42, false);
        await sleep(2000);
        await shot(p2, '16_lite_crowd.png');
        const ab1 = await abToggle(p2, 3, 4000);
        report.perfTier1 = ab1;
        const S1 = ab1.summary;
        step('TIER 1 (lite): trần 40 người được vẽ, draw call mô-đun ≤ 6', g2.tier <= 1 && S1.ra && S1.ra.cap === 40 && S1.ra.drawn <= 40 && S1.ra.drawn >= Math.min(40, (many.v && many.v.count) || 0) - 2 && S1.mpCallsPerFrame <= 6,
          { tier: g2.tier, ra: S1.ra, mpCallsPerFrame: S1.mpCallsPerFrame, mpByMesh: S1.mpByMesh, fps: S1.fps, calls: S1.callsMedian });
        await lookToward(p2, c2.x, c2.z, 70, 0.85, false);
        await sleep(2000);
        await shot(p2, '16_lite_crowd_high.png');
        report.errorsBrowser2 = g2.errors.slice();
      } finally { await g2.close(); }
    }
    report.bots = { n: bots.length, live: bots.filter((b) => b.state === 'live').length, corrects: bots.reduce((s, b) => s + b.r.corrects, 0),
      correctReasons: W.correctReasons, decodeErrors: bots.reduce((s, b) => s + b.r.decodeErrors, 0), chatRecv: W.c.chatRecv };
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
