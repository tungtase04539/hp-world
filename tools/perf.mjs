import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.click('#startBtn');
await page.waitForTimeout(1500);
// tuyến thuyền Bến Bính -> cửa sông -> Cát Bà: độ sâu dọc đường
const route = await page.evaluate(() => {
  const wp = [[-24, -165], [200, -195], [500, -170], [900, -140], [1400, 250], [2000, 700], [2600, 1100], [3300, 1400], [4000, 1650], [4500, 1800]];
  const out = [];
  for (let i = 0; i < wp.length - 1; i++) {
    for (let t = 0; t < 1; t += 0.25) {
      const x = wp[i][0] + (wp[i + 1][0] - wp[i][0]) * t;
      const z = wp[i][1] + (wp[i + 1][1] - wp[i][1]) * t;
      const h = window.__hp.gh(x, z);
      if (h > -0.8) out.push(`CẠN tại (${x | 0},${z | 0}): h=${h.toFixed(1)}`);
    }
  }
  return out;
});
console.log(route.length ? route.join('\n') : 'Tuyến thuyền Bến Bính -> Cát Bà: THÔNG SUỐT');
// đo FPS 3 giây tại trung tâm (nặng nhất)
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res((n / 3).toFixed(0)); };
  requestAnimationFrame(loop);
}));
console.log('FPS trung tâm:', fps);
console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
await browser.close();
