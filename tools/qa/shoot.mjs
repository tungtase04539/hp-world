// tools/qa/shoot.mjs — chụp game headless Chrome (GPU thật d3d11 qua ANGLE) + đo perf + gom lỗi JS.
// Server tĩnh: python -m http.server <port> (chạy ở gốc repo/worktree). Mỗi agent dùng 1 cổng riêng.
// usage: node shoot.mjs --port 8177 --out <dir> --views <views.json> [--quality full] [--w 1280 --h 720] [--perf] [--swiftshader]
// Tự chờ khoá GPU toàn máy (có thể phải đợi agent khác chụp xong). Giữ mỗi lần chụp NGẮN (ít góc) để không chiếm khoá lâu.
// views.json = [{id, kind:'pano', X, Z, h, pitch?}, {id, kind:'aerial', x, z, half}, {id, kind:'cam', x, z, yaw, pitch, dist}]
// In ra JSON: {errors, buildMs, tier, gpu, perf:{...}, shots:[...]}
// PW_PATH = đường dẫn module playwright-core (mặc định: bản cài ở scratchpad phiên 04e77d80, đổi nếu bị dọn)
const PW = process.env.PW_PATH || 'file:///C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-hp-world/04e77d80-6633-4919-bfa9-5d86fbe6ae69/scratchpad/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);
import fs from 'fs';
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const PORT = arg('port', '8177');
const OUT = arg('out', 'shots');
const VIEWS = JSON.parse(fs.readFileSync(arg('views'), 'utf8'));
const Q = arg('quality', 'full');
const W = +arg('w', 1280), H = +arg('h', 720);
const PERF = A.includes('--perf');
const HOST = arg('host', '127.0.0.1');
fs.mkdirSync(OUT, { recursive: true });
// GPU THẬT + KHOÁ TOÀN MÁY (tools/qa/gpulock.mjs): 8 Chrome GPU song song từng làm máy BSOD 0x133 ba lần (2026-10-04)
// → mọi lần chụp xếp hàng, 1 Chrome GPU tại một thời điểm. --swiftshader = render CPU (rất chậm: >30 s/khung ở 1280×720,
// chỉ dùng độ phân giải nhỏ, perf vô nghĩa).
const USE_GPU = !A.includes('--swiftshader');
let releaseGpu = () => {};
if (USE_GPU) { const { acquireGpu } = await import('./gpulock.mjs'); releaseGpu = await acquireGpu('shoot ' + OUT); }
const br = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [...(USE_GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const pg = await br.newPage({ viewport: { width: W, height: H } });
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
const t0 = Date.now();
await pg.goto(`http://${HOST}:${PORT}/index.html?quality=${Q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
let hpAt = 0;
for (let i = 0; i < 400; i++) {
  const ok = await pg.evaluate(() => !!(window.__hp && window.__hp.teleport)).catch(() => false);
  if (ok) { hpAt = Date.now() - t0; break; }
  await pg.waitForTimeout(500);
}
await pg.evaluate(() => { const sb = document.getElementById('startBtn'); if (sb) sb.click(); }).catch(() => {});
// Đợt 3 (WP8): nút Bắt đầu khoá (class 'loading') tới khi thế giới dựng xong + khung đầu đã vẽ; cú bấm sớm được
// ghi nhận và game tự vào khi xong. startReadyMs = lúc nút mở (thời điểm người chơi thật vào được game).
let startAt = 0;
for (let i = 0; i < 240; i++) {
  const ok = await pg.evaluate(() => { const sb = document.getElementById('startBtn'); return !sb || !sb.classList.contains('loading'); }).catch(() => false);
  if (ok) { startAt = Date.now() - t0; break; }
  await pg.waitForTimeout(250);
}
const bootProfile = await pg.evaluate(() => window.__hp && window.__hp.bootProfile).catch(() => null);
// Khoá autoQuality (mặc định; --nopin để tắt): máy chạy nhiều agent làm fps headless tụt → autoQuality nhảy nấc 3
// (sương gần, không hoàn tác) → ảnh vệ tinh trắng xoá + số đo không so được giữa các lượt. Bản game chưa có
// __hp.pinQuality thì bỏ qua (null).
const pinned = A.includes('--nopin') ? null
  : await pg.evaluate(() => (window.__hp && window.__hp.pinQuality ? window.__hp.pinQuality(true) : null)).catch(() => null);
await pg.waitForTimeout(+arg('settle', '15000'));
const info = await pg.evaluate(() => ({ tier: window.__hp.tier, gpu: window.__hp.gpu }));
await pg.evaluate(() => {
  for (const id of ['titleScreen', 'hud', 'dialogue', 'prompt', 'toast', 'banner', 'touchControls', 'gpuWarn']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }
  document.querySelectorAll('.toast,.gpu-toast,.notice').forEach((e) => (e.style.display = 'none'));
  window.__hp.scene.traverse((o) => { if (o.isInstancedMesh && !o.frustumCulled && o.count >= 150 && o.count <= 220) o.count = 0; });
  window.__hp.setTime(0.35);
  window.__hp.player.group.visible = false;
});
const shots = [];
let first = true;
for (const v of VIEWS) {
  const f = `${OUT}/${v.id}.png`;
  await pg.evaluate((v) => {
    const hp = window.__hp;
    hp.setTime(v.time ?? 0.35);
    // cần boom chống xuyên tường (main.js, Đợt 3 WP8) là hành vi GAMEPLAY — góc QA giữ đúng toạ độ đã khai báo
    // (so sánh được với baseline), trừ khi view ghi "occlude": true
    if (hp.camOcclusion) hp.camOcclusion(!!v.occlude);
    if (v.kind === 'aerial') { hp.aerial(v.x, v.z, v.half || 400, v.alt || 1200); }
    else {
      hp.aerialOff();
      if (v.kind === 'pano') hp.teleport(v.X, v.Z, -v.h * Math.PI / 180, v.pitch ?? 0.02, 0.1);
      else hp.teleport(v.x, v.z, v.yaw ?? 0, v.pitch ?? 0.1, v.dist ?? 8);
    }
    hp.player.group.visible = false;
  }, v);
  await pg.waitForTimeout(first ? (USE_GPU ? 4000 : 9000) : +(v.wait || arg('wait', USE_GPU ? '1500' : '3500')));
  first = false;
  let perf = null;
  if (PERF) {
    perf = await pg.evaluate(async (NF) => {
      const r = window.__hp.renderer; const ts = [];
      let last = performance.now();
      for (let i = 0; i < NF; i++) { await new Promise((res) => requestAnimationFrame(res)); const n = performance.now(); ts.push(n - last); last = n; }
      ts.sort((a, b) => a - b);
      r.info.autoReset = false; r.info.reset();
      await new Promise((res) => requestAnimationFrame(res));
      const calls = r.info.render.calls, tris = r.info.render.triangles;
      r.info.autoReset = true;
      return { fps: +(1000 / (ts.reduce((a, b) => a + b, 0) / ts.length)).toFixed(1), p50: +ts[Math.floor(NF / 2)].toFixed(1), p95: +ts[Math.floor(NF * 0.95)].toFixed(1), calls, tris };
    }, USE_GPU ? 90 : 8);
  }
  await pg.screenshot({ path: f, timeout: USE_GPU ? 30000 : 240000 });
  shots.push({ id: v.id, file: f, perf });
}
const mem = await pg.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
const res = { errors, hpReadyMs: hpAt, startReadyMs: startAt, bootProfile, pinned, ...info, heapMB: mem, gpuMode: USE_GPU ? 'gpu' : 'swiftshader', shots };
fs.writeFileSync(`${OUT}/_result.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ errors: errors.slice(0, 20), hpReadyMs: hpAt, startReadyMs: startAt, bootProfile, ...info, heapMB: mem, n: shots.length, perf: shots.filter((s) => s.perf).map((s) => [s.id, s.perf]) }, null, 1));
await br.close();
releaseGpu();
