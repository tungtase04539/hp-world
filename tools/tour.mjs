import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.click('#startBtn');
await page.waitForTimeout(1200);
// đóng hội thoại mở đầu
for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(120); }

const stops = [
  ['opera',     [-1, 42, 0, 0.22, 26],   0.45],
  ['quanhoa',   [-10, 48, 0, 0.2, 20],  0.45],
  ['lechan',    [-51, 62, 0.1, 0.2, 20], 0.45],
  ['cathedral', [-30, -50, 3.0, 0.22, 24], 0.45],
  ['lake',      [-133, 30, 0.3, 0.28, 26], 0.42],
  ['market',    [-251, 80, 0.05, 0.24, 26], 0.45],
  ['bridge',    [12, -200, -0.05, 0.2, 34], 0.74],
  ['binh',      [-390, -320, -0.4, 0.22, 40], 0.5],
  ['port',      [256, -180, 0.15, 0.3, 40], 0.5],
  ['station',   [130, 80, 3.1, 0.25, 30], 0.5],
  ['doson',     [1584, 2330, -1.2, 0.25, 28], 0.55],
  ['baodai',    [1553, 2560, 3.1, 0.28, 30], 0.5],
  ['hondau',    [1823, 2765, 0.05, 0.2, 24], 0.5],
  ['catba',     [4517, 1800, 0.1, 0.25, 32], 0.5],
  ['lanha',     [4840, 1850, -0.5, 0.22, 32], 0.6],
  ['night',     [-1, 42, 0, 0.22, 26],   0.88],
];

for (const [name, tp, timeOfDay] of stops) {
  await page.evaluate(([tpArgs, tod]) => {
    window.__hp.setTime(tod);
    window.__hp.teleport(...tpArgs);
  }, [tp, timeOfDay]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tour-${name}.png` });
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
await browser.close();
