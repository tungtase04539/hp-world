import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await page.click('#startBtn');
await page.waitForTimeout(1500);
const problems = await page.evaluate(() => window.__hp.diag());
console.log(problems.length ? 'VẤN ĐỀ:\n' + problems.join('\n') : 'TẤT CẢ THỰC THỂ OK');
// kiểm tra thuyền chạy được: teleport lên thuyền Bến Bính và xem nước xung quanh
const boatCheck = await page.evaluate(() => {
  const out = [];
  // tàu thủy trang trí & thuyền du lịch có ở trên cạn không — kiểm tra qua độ sâu vài điểm
  for (const [name, x, z] of [['ship-cửa-biển', 11000, -1200], ['seaShip-tâm', 2600, 1250],
    ['seaShip-mép1', 2920, 1450], ['seaShip-mép2', 2650, 1660], ['seaShip-mép3', 2380, 1450], ['seaShip-mép4', 2650, 1240],
    ['tourboat1', 4780, 1990], ['tourboat2', 4930, 1690], ['tourboat3', 2700, 1560]]) {
    out.push(`${name}: h=${window.__hp.gh(x, z).toFixed(1)}`);
  }
  return out;
});
console.log(boatCheck.join('\n'));
console.log(errors.length ? 'JS ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
await browser.close();
