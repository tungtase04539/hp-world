// tools/qa/glbsheets.mjs — chụp tools/qa/glbsheet.html (tờ ảnh 6 hình chiếu GLB GỐC) cho danh sách GLB, dưới KHOÁ GPU.
// usage: [OCC=0.12] node tools/qa/glbsheets.mjs <port> <outdir> nhahat,ga,...   (server tĩnh ở gốc repo; cần assets/ cục bộ)
// OCC → thêm <m>_occ.json (ảnh chiếu bằng + độ cao từng ô) cho tools/qa/lmfit.py. PW_PATH như shoot.mjs.
import fs from 'fs';
const PW = process.env.PW_PATH || 'file:///C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-hp-world/04e77d80-6633-4919-bfa9-5d86fbe6ae69/scratchpad/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);
const { acquireGpu } = await import('./gpulock.mjs');
const [port, out, list] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const rel = await acquireGpu('glbsheets');
const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const info = {};
try {
  const pg = await br.newPage({ viewport: { width: 1500, height: 1000 } });
  for (const m of list.split(',')) {
    await pg.goto(`http://127.0.0.1:${port}/tools/qa/glbsheet.html?m=${m}${process.env.OCC ? '&occ=' + process.env.OCC : ''}`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 240; i++) { if (await pg.evaluate(() => !!window.__done)) break; await pg.waitForTimeout(500); }
    info[m] = await pg.evaluate(() => window.__info || window.__err);
    if (process.env.OCC) fs.writeFileSync(`${out}/${m}_occ.json`, JSON.stringify(await pg.evaluate(() => window.__occ)));
    await pg.screenshot({ path: `${out}/${m}.png` });
  }
} finally { await br.close(); rel(); }
fs.writeFileSync(`${out}/_info.json`, JSON.stringify(info, null, 1));
console.log(JSON.stringify(info));
