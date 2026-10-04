// boot.js — MÀN CHỜ KHỞI ĐỘNG (Đợt 3 WP8): thanh tiến trình dựng thế giới + nút Bắt đầu khoá tới khi sẵn sàng.
//
// Trước đây: buildWorld chạy ĐỒNG BỘ 17-35 s ngay khi nạp module, nút ngôn ngữ/chất lượng/thanh preload chỉ được
// gắn SAU khi dựng xong → màn chờ "đơ" hoàn toàn, người chơi tưởng treo máy (kiểm toán 2026-10-04 mục 2).
// Nay main.js dựng UI TRƯỚC, buildWorld là async và gọi `await prog('<bước>')` ở ~9 ranh giới khu vực (dòng 1
// lệnh, cấp 1 của hàm — xem KNOWLEDGE §10). Mỗi lần gọi:
//   1) đóng bước trước (ghi thời lượng), cập nhật chữ + % trên thanh;
//   2) nếu đã ≥ YIELD_MS kể từ lần vẽ trước → NHƯỜNG luồng chính tới khi trình duyệt VẼ xong 1 khung
//      (rAF → MessageChannel = chạy tiếp ngay sau bước paint), tab ẩn thì chỉ nhường 1 macrotask (rAF không chạy ở
//      tab nền; setTimeout bị bóp 1 s/1 phút — MessageChannel thì không).
// Trong lúc 1 khối đồng bộ dài đang chạy, vệt sáng trên thanh vẫn chạy nhờ animation `transform` (compositor
// thread — không cần luồng chính) → màn hình không bao giờ "chết đứng".
// Trọng số % từng bước: đo thật trên máy này ở lần khởi động trước (localStorage hp3d.bootProfile.v1), lần đầu
// dùng số mặc định đo trên Radeon 890M (TIER 3, 2026-10-04).
import { t, tx, onLangChange } from './i18n.js';

const STEPS = {
  code:      { vi: 'Biên dịch mã thế giới',        en: 'Compiling world code',      w: 3000 },
  ground:    { vi: 'Mặt đất, sông hồ',             en: 'Terrain & water',           w: 900 },
  street:    { vi: 'Đường phố, vỉa hè, cột đèn',   en: 'Streets & lamps',           w: 1500 },
  cells:     { vi: 'Công trình dựng tay',          en: 'Hand-built blocks',         w: 3500 },
  fabric:    { vi: 'Dãy nhà phố',                  en: 'City blocks',               w: 9000 },
  landmarks: { vi: 'Địa danh, cầu, cảng',          en: 'Landmarks, bridges, port',  w: 1500 },
  nature:    { vi: 'Cây xanh, vườn hoa',           en: 'Trees & gardens',           w: 1500 },
  furniture: { vi: 'Biển tên phố, đèn giao thông', en: 'Street furniture',          w: 600 },
  final:     { vi: 'Hoàn thiện thế giới',          en: 'Finishing the world',       w: 900 },
  freeze:    { vi: 'Gộp hình khối tĩnh',           en: 'Merging static geometry',   w: 1800 },
  actors:    { vi: 'Người, xe, giao thông',        en: 'People & traffic',          w: 400 },
  shaders:   { vi: 'Biên dịch shader',             en: 'Compiling shaders',         w: 4000 },
};
const ORDER = Object.keys(STEPS);
const PROFILE_KEY = 'hp3d.bootProfile.v1';
const YIELD_MS = 90;

function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); if (p && typeof p === 'object') return p; } catch (e) { }
  return null;
}

// Nhường luồng chính cho tới khi trình duyệt vẽ xong 1 khung (hoặc 1 macrotask khi tab ẩn).
const _mc = (typeof MessageChannel !== 'undefined') ? new MessageChannel() : null;
const _mcQ = [];
if (_mc) _mc.port1.onmessage = () => { const f = _mcQ.shift(); if (f) f(); };
function macrotask(fn) { if (_mc) { _mcQ.push(fn); _mc.port2.postMessage(0); } else setTimeout(fn, 0); }
export function yieldToPaint() {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    if (typeof document !== 'undefined' && !document.hidden && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => macrotask(fin));
      setTimeout(fin, 250);          // an toàn: tab vừa bị ẩn giữa chừng → rAF không bao giờ gọi
    } else macrotask(fin);
  });
}

export function createBoot() {
  const btn = document.getElementById('startBtn');
  const bar = document.getElementById('bootBar');
  const fill = document.getElementById('bootFill');
  const txt = document.getElementById('bootTxt');
  const prof = loadProfile();
  const weight = (k) => Math.max(30, (prof && prof[k] > 0 ? prof[k] : STEPS[k].w));
  const total = ORDER.reduce((s, k) => s + weight(k), 0);
  const durs = {};
  let cur = null, curAt = 0, doneW = 0, lastPaint = performance.now();
  let ready = false, pendingStart = false, onStart = null, t0 = performance.now();

  function render(frac) {
    const pct = Math.max(1, Math.min(99, Math.round(frac * 100)));
    if (fill) fill.style.width = pct + '%';
    const label = tx(cur ? STEPS[cur] : { vi: 'Đang tải mã', en: 'Loading code' });
    if (txt) txt.textContent = `${label}… ${pct}%`;
    if (btn && !ready) {
      btn.textContent = pendingStart
        ? tx({ vi: `⏳ Vào ngay khi xong… ${pct}%`, en: `⏳ Starting as soon as ready… ${pct}%` })
        : tx({ vi: `⏳ Đang dựng thành phố… ${pct}%`, en: `⏳ Building the city… ${pct}%` });
    }
  }
  function close(now) {
    if (!cur) return;
    durs[cur] = Math.round(now - curAt);
    doneW += weight(cur);
  }
  // Bước mới bắt đầu (bước trước kết thúc). Trả Promise: await để trình duyệt kịp vẽ thanh tiến trình.
  // force = luôn nhường (vd. ngay trước khối đồng bộ dài đầu tiên, khi màn chờ chưa được vẽ lần nào).
  function step(key, force = false) {
    const now = performance.now();
    close(now);
    if (!STEPS[key]) { cur = null; return undefined; }
    cur = key; curAt = now;
    render(doneW / total);
    if (!force && now - lastPaint < YIELD_MS) return undefined;
    lastPaint = now;
    return yieldToPaint().then(() => { lastPaint = performance.now(); });
  }
  function finish() {
    close(performance.now());
    cur = null;
    ready = true;
    const ms = Math.round(performance.now() - t0);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(durs)); } catch (e) { }
    console.info('[boot] sẵn sàng sau', ms, 'ms (từ lúc dựng UI) — từng bước:', JSON.stringify(durs));
    if (bar) bar.classList.add('ready');
    if (btn) {
      btn.classList.remove('loading');
      btn.removeAttribute('aria-disabled');
      btn.setAttribute('data-i18n', 'start');   // trả lại cho setLang
      btn.textContent = t('start');
    }
    if (pendingStart && onStart) onStart();
    return { ms, durs };
  }
  // Nút Bắt đầu: bấm sớm thì GHI NHẬN (vào ngay khi dựng xong) — harness/ người chơi không bao giờ bị "nuốt" cú bấm.
  function armStart(fn, onEarlyGesture) {
    onStart = fn;
    if (!btn) return;
    btn.classList.add('loading');
    btn.setAttribute('aria-disabled', 'true');
    btn.removeAttribute('data-i18n');           // setLang không được ghi đè chữ "Đang dựng…" khi còn tải
    onLangChange(() => { if (!ready) render(doneW / total); });
    btn.addEventListener('click', () => {
      if (onEarlyGesture) onEarlyGesture();   // AudioContext phải tạo TRONG cử chỉ người dùng
      if (ready) { onStart(); return; }
      pendingStart = true;
      render(doneW / total);
    });
  }
  render(0.01);
  return { step, finish, armStart, get ready() { return ready; }, durs, t0 };
}
