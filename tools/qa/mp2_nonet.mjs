// tools/qa/mp2_nonet.mjs — CHƠI MỘT MÌNH KHÔNG CÓ MÁY CHỦ (MP2 SPEC §1.3): không ?server=, localStorage sạch → không nạp
// js/net/*, js/ui/chat.js, không WebSocket, không request tới API máy chủ; 0 lỗi JS. Một Chrome dưới khoá GPU.
//   node tools/qa/mp2_nonet.mjs --port 8811 [--quality full|lite] [--out <thư mục>]
import { PW_URL } from './pw.mjs';
import fs from 'fs';
import path from 'path';
import { args } from './launch.mjs';
import { acquireGpu } from './gpulock.mjs';

const A = args();
const PORT = +A.get('port', 8811);
const Q = A.get('quality', 'full');
const OUT = A.get('out', 'C:/Users/Admin/hp-world-work/mp2/c1/nonet');
fs.mkdirSync(OUT, { recursive: true });
const PW = PW_URL;
const { chromium } = await import(PW);
const rel = await acquireGpu(`mp2_nonet :${PORT} ${Q}`);
const br = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const res = { quality: Q, requests: 0, bad: [], websockets: [], workers: [], errors: [] };
try {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('request', (r) => {
    res.requests++;
    const u = new URL(r.url());
    const local = u.hostname === '127.0.0.1' && +u.port === PORT;
    // ngoài máy (CDN asset GLB của assets.js — có từ trước): chỉ ghi lại; cổng/host máy chủ game thì là lỗi
    if (!local && /^https?:/.test(u.protocol)) { (res.external = res.external || []).push(u.host); if (/:\d+$/.test(u.host) && !/:443$/.test(u.host)) res.bad.push(r.url()); }
    if (/\/js\/net\/|\/js\/ui\/|\/v1\/|\/play\b/.test(u.pathname)) res.bad.push(r.url());
  });
  pg.on('websocket', (w) => res.websockets.push(w.url()));
  pg.on('worker', (w) => res.workers.push(w.url().slice(0, 80)));
  pg.on('pageerror', (e) => res.errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') res.errors.push('console: ' + m.text().slice(0, 200)); });
  const t0 = Date.now();
  await pg.goto(`http://127.0.0.1:${PORT}/index.html?quality=${Q}`, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.__hp && window.__hp.teleport, null, { timeout: 300000 });
  await pg.waitForFunction(() => !document.getElementById('startBtn').classList.contains('loading'), null, { timeout: 120000 });
  res.startReadyMs = Date.now() - t0;
  res.panel = await pg.evaluate(() => !!document.getElementById('mpPanel') || !!document.getElementById('netStatus'));
  await pg.click('#startBtn');
  await pg.waitForTimeout(5000);
  res.net = await pg.evaluate(() => window.__hp.net);
  await pg.screenshot({ path: path.join(OUT, `nonet_${Q}.png`) });
  res.tier = await pg.evaluate(() => window.__hp.tier);
  res.gpu = await pg.evaluate(() => window.__hp.gpu);
} finally { await br.close(); rel(); }
res.external = [...new Set(res.external || [])];
res.ok = res.bad.length === 0 && res.websockets.length === 0 && res.errors.length === 0 && !res.panel && res.net === null;
fs.writeFileSync(path.join(OUT, `nonet_${Q}.json`), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ ok: res.ok, requests: res.requests, bad: res.bad.length, ws: res.websockets.length, errors: res.errors, panel: res.panel, net: res.net, startReadyMs: res.startReadyMs, tier: res.tier }));
process.exit(res.ok ? 0 : 1);
