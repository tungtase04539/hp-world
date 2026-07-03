import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// dọc: phải hiện gợi ý xoay ngang
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p1 = await ctx1.newPage();
const errs = [];
p1.on('pageerror', (e) => errs.push(e.message));
await p1.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await p1.waitForTimeout(800);
await p1.screenshot({ path: 'mob-portrait.png' });
// bấm "vẫn chơi dọc" rồi bắt đầu
await p1.tap('#rotateDismiss');
await p1.tap('#startBtn');
await p1.waitForTimeout(1500);
await p1.screenshot({ path: 'mob-portrait-game.png' });
await ctx1.close();

// ngang: chơi bình thường, có joystick
const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errs.push(e.message));
await p2.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(600);
await p2.screenshot({ path: 'mob-land-title.png' });
await p2.tap('#startBtn');
await p2.waitForTimeout(1500);
// đóng hội thoại bằng chạm
for (let i = 0; i < 5; i++) { await p2.tap('#dialogue').catch(() => {}); await p2.waitForTimeout(150); }
await p2.screenshot({ path: 'mob-land-game.png' });
await ctx2.close();

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO JS ERRORS');
await browser.close();
