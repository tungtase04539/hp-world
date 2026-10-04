// tools/qa/launch.mjs — khởi động game trong Chrome headless HỆ THỐNG (GPU thật qua ANGLE d3d11) cho các tool kiểm thử
// (diag/tour/perf/mobile). Cùng quy ước với tools/qa/shoot.mjs: server tĩnh `python -m http.server <port>` ở gốc
// repo/worktree, playwright-core nạp từ PW_PATH (mặc định: bản cài ở scratchpad phiên 04e77d80 — đổi nếu bị dọn).
// Dùng: const g = await openGame({ port, quality, viewport, mobile, pin }); … await g.close();   (pin: khoá autoQuality, mặc định bật)
// openGame tự giữ KHOÁ GPU toàn máy tới g.close() — LUÔN gọi g.close() (kể cả khi lỗi) để nhả khoá sớm.
//   g.pg (Page) · g.errors (lỗi JS) · g.hpReadyMs (window.__hp có) · g.startReadyMs (nút Bắt đầu mở, js/boot.js)
import os from 'os';
import path from 'path';
const PW = process.env.PW_PATH || 'file:///C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-hp-world/04e77d80-6633-4919-bfa9-5d86fbe6ae69/scratchpad/node_modules/playwright-core/index.mjs';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export function args(argv = process.argv.slice(2)) {
  const get = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  return { get, has: (k) => argv.includes('--' + k) };
}
export const defaultOut = (name) => path.join(os.tmpdir(), 'hp-qa', name);

export async function openGame({ port = 8177, host = '127.0.0.1', quality = 'full', viewport = { width: 1280, height: 720 },
  mobile = false, start = true, extra = '', pin = true } = {}) {
  const { chromium } = await import(PW);
  // KHOÁ GPU TOÀN MÁY (tools/qa/gpulock.mjs — SPEC Đợt 3 §2.0: nhiều Chrome GPU song song từng làm máy BSOD 0x133).
  // Giữ tới g.close() (hoặc tới khi tiến trình thoát). Chạy dưới `gpulock.mjs run --` thì tái nhập, không chờ.
  const { acquireGpu } = await import('./gpulock.mjs');
  const releaseGpu = await acquireGpu(`launch :${port} ${quality || ''}${mobile ? ' mobile' : ''}`);
  const br = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const ctx = await br.newContext(mobile
    ? { viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  const q = quality ? `?quality=${quality}` : '?';
  await pg.goto(`http://${host}:${port}/index.html${q}${extra}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let hpReadyMs = 0, startReadyMs = 0;
  for (let i = 0; i < 600; i++) {
    if (await pg.evaluate(() => !!(window.__hp && window.__hp.teleport)).catch(() => false)) { hpReadyMs = Date.now() - t0; break; }
    if (i > 4 && errors.some((e) => e.startsWith('pageerror'))) break;   // lỗi khi dựng thế giới → khỏi chờ 300 s giữ khoá GPU
    await pg.waitForTimeout(500);
  }
  if (!hpReadyMs) errors.push('TIMEOUT: window.__hp không xuất hiện sau 300 s');
  if (start && hpReadyMs) {
    await pg.evaluate(() => { const b = document.getElementById('startBtn'); if (b) b.click(); }).catch(() => {});
    for (let i = 0; i < 400; i++) {
      const ok = await pg.evaluate(() => { const b = document.getElementById('startBtn'); return !b || !b.classList.contains('loading'); }).catch(() => false);
      if (ok) { startReadyMs = Date.now() - t0; break; }
      await pg.waitForTimeout(250);
    }
  }
  // khoá autoQuality (như shoot.mjs): máy bận làm fps headless tụt → nấc 3 sương gần → ảnh/số đo không so được
  if (pin && hpReadyMs) await pg.evaluate(() => window.__hp.pinQuality && window.__hp.pinQuality(true)).catch(() => {});
  const info = hpReadyMs ? await pg.evaluate(() => ({ tier: window.__hp.tier, gpu: window.__hp.gpu })).catch(() => ({})) : {};
  return {
    br, ctx, pg, errors, t0, hpReadyMs, startReadyMs, ...info,
    // ẩn HUD/hội thoại/toast để ảnh sạch (giống shoot.mjs)
    async cleanUI() {
      await pg.evaluate(() => {
        for (const id of ['titleScreen', 'hud', 'dialogue', 'prompt', 'toast', 'banner', 'touchControls']) {
          const el = document.getElementById(id); if (el) el.style.display = 'none';
        }
      }).catch(() => {});
    },
    close: async () => { try { await br.close(); } finally { releaseGpu(); } },
  };
}

// Đọc mapdata.js trong node (LM/LM_FACE/EXTRAS…) — toạ độ địa danh THẬT thay cho bảng số 1:10 cũ đã lỗi thời.
export async function mapdata() {
  const url = new URL('../../js/mapdata.js', import.meta.url);
  return import(url.href);
}
