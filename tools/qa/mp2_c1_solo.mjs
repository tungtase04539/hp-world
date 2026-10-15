// tools/qa/mp2_c1_solo.mjs — có cấu hình máy chủ nhưng người chơi bấm "Chơi một mình": không mở kết nối, không HUD mạng,
// game chạy bình thường. 1 Chrome dưới khoá GPU (openGame). Máy chủ KHÔNG cần chạy (địa chỉ trỏ cổng không ai nghe).
//   node tools/qa/mp2_c1_solo.mjs --port 8811 [--out <thư mục>]
import fs from 'fs';
import path from 'path';
import { args, openGame } from './launch.mjs';

const A = args();
const OUT = A.get('out', 'C:/Users/Admin/hp-world-work/mp2/c1/solo');
fs.mkdirSync(OUT, { recursive: true });
const g = await openGame({ port: +A.get('port', 8811), quality: 'full', start: false, extra: '&server=ws://127.0.0.1:9299' });
const res = {};
try {
  const pg = g.pg;
  await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
  await pg.click('#mpSolo');
  await pg.waitForFunction(() => document.getElementById('titleScreen').classList.contains('hidden'), null, { timeout: 30000 });
  await pg.waitForTimeout(4000);
  Object.assign(res, await pg.evaluate(() => {
    const s = window.__hp.net.status();
    return { mode: s.mode, conn: s.conn, welcomes: s.tel.welcomes, pillHidden: document.getElementById('netStatus').classList.contains('hidden'),
      chatBox: !!document.getElementById('chatBox'), started: s.started };
  }));
  await pg.screenshot({ path: path.join(OUT, 'solo_with_server_cfg.png') });
  res.errors = g.errors.slice();
} finally { await g.close(); }
res.ok = res.mode === 'solo' && res.conn === 'off' && res.welcomes === 0 && res.pillHidden && !res.chatBox && res.started && !res.errors.length;
fs.writeFileSync(path.join(OUT, 'solo.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
