// KIỂM TRA RÒ RỈ BỘ NHỚ — chơi lâu có phình RAM/GPU không?
// Chưa từng đo trước đây. Rủi ro thật với game này: stream GLB liên tục khi đi lại + tạo/huỷ
// geometry mỗi lần cull → nếu quên dispose thì sau 10-20 phút điện thoại hết RAM và tab bị kill.
//
//   PW_PATH=<...>/playwright-core/index.mjs node tools/memleak.mjs [port] [full|lite] [số_vòng]
//
// Cách làm: dịch chuyển người chơi vòng quanh lõi nhiều lần (ép stream vào/ra liên tục), đo
// geometries/textures/programs + JS heap sau mỗi vòng. Số CHỈ ĐƯỢC PHÉP ổn định, không tăng dần.
const PW = process.env.PW_PATH || 'playwright-core';
const { chromium } = await import(PW);

const PORT = process.argv[2] || '8179';
const MODE = process.argv[3] || 'lite';
const LAPS = +(process.argv[4] || 4);

const br = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--js-flags=--expose-gc'],
});
const pg = await br.newPage({ viewport: { width: 640, height: 420 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));

await pg.goto(`http://127.0.0.1:${PORT}/?quality=${MODE}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
for (let i = 0; i < 200; i++) {
  const done = await pg.evaluate(() => {
    const b = document.getElementById('startBtn'), t = document.getElementById('titleScreen');
    if (b && t && !t.classList.contains('hidden')) b.click();
    return t && t.classList.contains('hidden');
  }).catch(() => false);
  if (done) break;
  await pg.waitForTimeout(1000);
}
for (let i = 0; i < 200; i++) {
  if (await pg.evaluate(() => !!(window.__hp && window.__hp.teleport)).catch(() => false)) break;
  await pg.waitForTimeout(1000);
}
await pg.waitForTimeout(8000);

const snap = () => pg.evaluate(() => {
  if (window.gc) window.gc();
  const m = window.__hp.renderer.info.memory;
  const p = window.__hp.renderer.info.programs;
  return {
    geo: m.geometries, tex: m.textures, prog: p ? p.length : 0,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1,
  };
});

// 4 góc quanh lõi — ép asset stream vào/ra liên tục
const TOUR = [[0, 9], [900, -600], [-1100, 300], [300, 1100], [-600, -900]];
const rows = [];
rows.push(['khởi đầu', await snap()]);
for (let lap = 1; lap <= LAPS; lap++) {
  for (const [x, z] of TOUR) {
    await pg.evaluate(([x, z]) => window.__hp.teleport(x, z, 0, 0.15, 20), [x, z]);
    await pg.waitForTimeout(3500);
  }
  rows.push(['vòng ' + lap, await snap()]);
}

console.log(`\n=== RÒ RỈ BỘ NHỚ — ${MODE.toUpperCase()}, ${LAPS} vòng × ${TOUR.length} điểm ===`);
console.log('mốc'.padEnd(10), 'geometry'.padStart(9), 'texture'.padStart(8), 'program'.padStart(8), 'JS heap MB'.padStart(11));
for (const [name, s] of rows) {
  console.log(name.padEnd(10), String(s.geo).padStart(9), String(s.tex).padStart(8), String(s.prog).padStart(8), String(s.heapMB).padStart(11));
}
const a = rows[0][1], b = rows[rows.length - 1][1];
const grow = (k) => b[k] - a[k];
const verdict = [];
if (grow('geo') > 400) verdict.push(`geometry +${grow('geo')}`);
if (grow('tex') > 120) verdict.push(`texture +${grow('tex')}`);
if (grow('prog') > 25) verdict.push(`program +${grow('prog')}`);
if (a.heapMB > 0 && grow('heapMB') > 260) verdict.push(`JS heap +${grow('heapMB').toFixed(0)}MB`);
console.log(`\nJS error: ${errs.length ? errs.slice(0, 2).join(' ; ') : 'KHÔNG'}`);
console.log(verdict.length ? `==> NGHI RÒ RỈ: ${verdict.join(', ')}\n` : '==> KHÔNG THẤY RÒ RỈ (số ổn định qua các vòng)\n');

await br.close();
process.exit(verdict.length || errs.length ? 1 : 0);
