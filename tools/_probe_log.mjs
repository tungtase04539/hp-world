// scratch probe (not committed): collect info logs
const PW = 'file:///C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-hp-world/04e77d80-6633-4919-bfa9-5d86fbe6ae69/scratchpad/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);
const q = process.argv[2] || 'full';
const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await br.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [], errs = [];
pg.on('console', (m) => { const t = m.text(); if (/\[(traffic|footprints|boot)\]/.test(t)) logs.push(t); if (m.type() === 'error') errs.push(t.slice(0, 200)); });
pg.on('pageerror', (e) => errs.push('pageerror ' + e.message));
const t0 = Date.now();
await pg.goto(`http://127.0.0.1:8308/index.html?quality=${q}`);
const shots = [];
for (let i = 0; i < 200; i++) {
  const st = await pg.evaluate(() => ({ txt: (document.getElementById('bootTxt') || {}).textContent, btn: document.getElementById('startBtn').textContent })).catch(() => null);
  if (st && (!shots.length || shots[shots.length - 1][1] !== st.txt)) shots.push([Date.now() - t0, st.txt, st.btn]);
  if (await pg.evaluate(() => { const b = document.getElementById('startBtn'); return b && !b.classList.contains('loading'); }).catch(() => false)) break;
  await pg.waitForTimeout(300);
}
console.log('ready at', Date.now() - t0);
console.log(shots.map((s) => s.join(' | ')).join('\n'));
await pg.click('#startBtn');
await pg.waitForTimeout(4000);
console.log(logs.join('\n'));
console.log('errors', errs);
await br.close();
