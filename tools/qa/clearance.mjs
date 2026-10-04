// tools/qa/clearance.mjs — KIỂM TOÁN KHOẢNG TRỐNG (Đợt 3 W2-A): 551 camera pano + vật tĩnh trên lòng đường/vỉa hè.
// usage: node tools/qa/clearance.mjs --port 8401 --out <file.json> [--gpu] [--all] [--road A|AC]
//   Server tĩnh ở gốc repo/worktree (python -m http.server <port>). Mặc định SwiftShader (CPU — kiểm toán KHÔNG vẽ:
//   chạy trước freezeStatic rồi giữ trang), vẫn xin khoá GPU toàn máy (tools/qa/gpulock.mjs) cho chắc.
//   Vá TẠM main.js qua page.route (chỉ trong phiên QA này): gọi window.__hpPreFreeze(scene, world) ngay trước
//   world.freezeStatic → tools/qa/clearance_page.js đọc cảnh còn nguyên tên + geometry (xem đầu file đó).
// In tóm tắt + ghi JSON đầy đủ: {stats, cams:[cam vi phạm/sát ngưỡng], onRoad:[…], sidewalk:[…], worstAll:[…]}.
const PW = process.env.PW_PATH || 'file:///C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-hp-world/04e77d80-6633-4919-bfa9-5d86fbe6ae69/scratchpad/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const PORT = arg('port', '8401');
const OUT = arg('out', 'clearance.json');
const HOST = arg('host', '127.0.0.1');
const GPU = A.includes('--gpu');
const here = path.dirname(fileURLToPath(import.meta.url));
const ids = JSON.parse(fs.readFileSync(path.join(here, '../pano_loop/list_full_551.json'), 'utf8')).map((e) => e.id);
const cfg = { ids, hold: true, allCams: A.includes('--all'), roadCls: arg('road', 'A'), near: +arg('near', '3'), fillD: +arg('filld', '6'), fillMax: +arg('fillmax', '0.4'), fillCorr: +arg('fillcorr', '0.2'), probe: arg('probe', '') ? JSON.parse(fs.readFileSync(arg('probe'), 'utf8')) : [] };
const pageJs = fs.readFileSync(path.join(here, 'clearance_page.js'), 'utf8');
const { acquireGpu } = await import('./gpulock.mjs');
const release = await acquireGpu('clearance ' + OUT);
const br = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [...(GPU ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const t0 = Date.now();
try {
  const pg = await br.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push('console: ' + t.slice(0, 300)); if (/^\[(clear|cellsink|clearance)\]/.test(t)) console.log(t.slice(0, 400)); });
  await pg.route('**/js/main.js', async (route) => {
    const r = await route.fetch(); let body = await r.text();
    const needle = 'world.freezeStatic(renderer.shadowMap.enabled);';
    if (!body.includes(needle)) throw new Error('clearance: không tìm thấy lời gọi freezeStatic trong main.js');
    body = body.replace(needle, 'if (window.__hpPreFreeze) await window.__hpPreFreeze(scene, world);\n' + needle);
    await route.fulfill({ response: r, body, headers: { ...r.headers(), 'content-type': 'application/javascript', 'cache-control': 'no-store' } });
  });
  // --src: gắn dòng nguồn world.js cho MỌI scene.add (vá TẠM world.js trong phiên QA) → vật thể vô danh có '@L<dòng>'
  if (A.includes('--src')) await pg.route('**/js/world.js', async (route) => {
    const r = await route.fetch(); let body = await r.text();
    const needle = 'export async function buildWorld(scene, prog = () => {}) {';
    if (!body.includes(needle)) throw new Error('clearance --src: không thấy chữ ký buildWorld');
    const hl = body.slice(0, body.indexOf(needle)).split('\n').length;   // dòng của chính móc (bỏ qua trong stack)
    const hook = ' { const __a = scene.add.bind(scene); scene.add = (...o) => { const st = new Error().stack || ""; let ln = 0;'
      + ' for (const l of st.split("\\n")) { const m = /world\\.js:(\\d+):/.exec(l); if (m && +m[1] !== ' + hl + ') { ln = +m[1]; break; } }'
      + ' for (const x of o) if (x && x.userData) x.userData.__src = ln; return __a(...o); }; }';
    body = body.replace(needle, needle + hook);
    await route.fulfill({ response: r, body, headers: { ...r.headers(), 'content-type': 'application/javascript', 'cache-control': 'no-store' } });
  });
  await pg.addInitScript({ content: 'window.__clearCfg = ' + JSON.stringify(cfg) + ';\n' + pageJs });
  await pg.goto(`http://${HOST}:${PORT}/index.html?quality=full&fabfree=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let res = null;
  for (let i = 0; i < 900 && !res; i++) {
    await pg.waitForTimeout(1000);
    res = await pg.evaluate(() => window.__clearResult || null).catch(() => null);
    if (errors.some((e) => /pageerror/.test(e))) break;
  }
  if (!res) { console.error('clearance: không có kết quả', errors.slice(0, 10)); process.exitCode = 1; }
  else {
    res.errors = errors; res.wallMs = Date.now() - t0;
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    const bad = res.cams.filter((c) => c.bad);
    console.log(JSON.stringify({ stats: res.stats, errors: errors.slice(0, 5), wallMs: res.wallMs }));
    console.log('cam vi phạm:', bad.length, bad.slice(0, 40).map((c) => `${c.id}(${c.near.length ? 'gần ' + c.near[0][0] + ' ' + c.near[0][2] + 'm' : ''}${c.worstC > cfg.fillCorr ? ' lấn ' + c.worstC : ''})`).join(' | '));
    console.log('trên lòng đường:', res.onRoad.length, '· lấn vỉa hè:', res.sidewalk.length, '(chặn kín', res.sidewalk.filter((s) => s.block).length + ')');
  }
} finally {
  await br.close();
  release();
}
