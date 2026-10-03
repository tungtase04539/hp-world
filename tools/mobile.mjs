// tools/mobile.mjs — KIỂM GIAO DIỆN ĐIỆN THOẠI (viewport + cảm ứng giả lập, Windows — tools/qa/launch.mjs).
// Dọc: phải hiện gợi ý xoay ngang → "vẫn chơi dọc" → vào game. Ngang: màn chờ (thanh dựng thế giới + nút khoá) →
// vào game, joystick + nút ✦/⤒ hiện, đóng hội thoại bằng chạm. Ảnh mob-*.png để XEM BẰNG MẮT.
// Lưu ý: isMobile ⇒ device.js xếp TIER 1 (LITE) — đúng như điện thoại thật; dựng thế giới lâu hơn máy bàn.
//   node tools/mobile.mjs [--port 8177] [--out <thư mục>]
import fs from 'fs';
import path from 'path';
import { openGame, args, defaultOut } from './qa/launch.mjs';
const A = args();
const OUT = A.get('out', defaultOut('mobile'));
fs.mkdirSync(OUT, { recursive: true });
const port = A.get('port', '8177');
const problems = [];

// --- dọc ---
{
  const g = await openGame({ port, quality: '', viewport: { width: 390, height: 844 }, mobile: true, start: false });
  await g.pg.waitForTimeout(800);
  await g.pg.screenshot({ path: path.join(OUT, 'mob-portrait-title.png') });
  const hint = await g.pg.evaluate(() => !document.getElementById('rotateHint').classList.contains('hidden'));
  if (!hint) problems.push('dọc: KHÔNG hiện gợi ý xoay ngang');
  await g.pg.tap('#rotateDismiss').catch(() => problems.push('dọc: không bấm được "vẫn chơi dọc"'));
  await g.pg.tap('#startBtn').catch(() => {});
  for (let i = 0; i < 400; i++) {
    if (await g.pg.evaluate(() => document.getElementById('titleScreen').classList.contains('hidden'))) break;
    await g.pg.waitForTimeout(250);
  }
  await g.pg.waitForTimeout(1500);
  await g.pg.screenshot({ path: path.join(OUT, 'mob-portrait-game.png') });
  problems.push(...g.errors.map((e) => 'dọc JS: ' + e));
  await g.close();
}
// --- ngang ---
{
  const g = await openGame({ port, quality: '', viewport: { width: 844, height: 390 }, mobile: true, start: false });
  await g.pg.waitForTimeout(600);
  await g.pg.screenshot({ path: path.join(OUT, 'mob-land-title.png') });
  await g.pg.tap('#startBtn').catch(() => {});
  for (let i = 0; i < 400; i++) {
    if (await g.pg.evaluate(() => document.getElementById('titleScreen').classList.contains('hidden'))) break;
    await g.pg.waitForTimeout(250);
  }
  await g.pg.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) { await g.pg.tap('#dialogue').catch(() => {}); await g.pg.waitForTimeout(150); }
  const ui = await g.pg.evaluate(() => ({
    joystick: !document.getElementById('touchControls').classList.contains('hidden'),
    dialogueOpen: !document.getElementById('dialogue').classList.contains('hidden'),
    tier: window.__hp && window.__hp.tier,
  }));
  if (!ui.joystick) problems.push('ngang: joystick KHÔNG hiện');
  if (ui.dialogueOpen) problems.push('ngang: chạm không đóng được hội thoại');
  await g.pg.screenshot({ path: path.join(OUT, 'mob-land-game.png') });
  console.log('ngang:', JSON.stringify(ui), `hpReady ${g.hpReadyMs} ms`);
  problems.push(...g.errors.map((e) => 'ngang JS: ' + e));
  await g.close();
}
console.log(`ảnh → ${OUT}`);
console.log(problems.length ? 'VẤN ĐỀ:\n' + problems.join('\n') : 'MOBILE OK — 0 lỗi JS');
process.exit(problems.length ? 1 : 0);
