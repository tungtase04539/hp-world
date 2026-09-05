// ============ NHẬN DIỆN THIẾT BỊ & PHÂN TẦNG CHẤT LƯỢNG ============
// Module RIÊNG (không phụ thuộc gì) để world.js / assets.js / main.js cùng dùng mà KHÔNG tạo vòng lặp import.
//
// BÀI HỌC (kiểm toán 2026-09-05): CẢM ỨNG KHÔNG PHẢI DẤU HIỆU MÁY YẾU. Laptop RTX 4060 màn 4K cảm ứng
// từng bị xếp vào LITE chỉ vì maxTouchPoints > 0 → khoá 30 fps, render 1/4 độ phân giải, tắt bóng/AA/bloom,
// nạp model lite texture 512 px. Từ nay: cảm ứng CHỈ quyết định UI (HAS_TOUCH); chất lượng quyết định bằng TIER.
//
// TIER  0 = GPU phần mềm / rất yếu        1 = điện thoại hoặc máy yếu  (LITE)
//       2 = iGPU hiện đại / desktop thường  3 = GPU rời mạnh
// Ép tay: ?quality=full|lite|auto trên URL (ưu tiên nhất) hoặc nút chọn ở màn chờ (localStorage hp3d.quality).

export const HAS_TOUCH = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
export const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));   // iPad iOS13+ giả dạng macOS

// Chuỗi GPU đọc từ một canvas TẠM. KHÔNG bao giờ gọi getContext trên canvas game để "kiểm tra":
// canvas chỉ có 1 context, tạo sớm là WebGLRenderer tạo sau nhận lại context cũ và MẤT HẾT attribute
// (đo được: powerPreference 'default', antialias sai). Context tạm giải phóng ngay bằng WEBGL_lose_context.
export const GPU_NAME = (() => {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' })
      || c.getContext('webgl', { powerPreference: 'high-performance' });
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rs = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return rs;
  } catch (e) { return ''; }
})();

const CORES = navigator.hardwareConcurrency || 8;
const MEM = navigator.deviceMemory || 8;   // Chrome trần 8 — chỉ tin khi báo NHỎ

export const QUALITY_PREF = (() => {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'full' || q === 'lite' || q === 'auto') return q;
  try {
    const s = localStorage.getItem('hp3d.quality');
    if (s === 'full' || s === 'lite') return s;
  } catch (e) { }
  return 'auto';
})();
export function setQualityPref(v) {
  try {
    if (v === 'auto') localStorage.removeItem('hp3d.quality');
    else localStorage.setItem('hp3d.quality', v);
  } catch (e) { }
}

// GPU phần mềm (headless/máy ảo/driver hỏng) → TIER 0
const RE_SOFT = /SwiftShader|llvmpipe|Software|Basic Render|Microsoft Basic|Mesa OffScreen/i;
// GPU rời mạnh → TIER 3 (Radeon RX/Pro/VII là card rời; "Radeon(TM) 890M Graphics" là iGPU → KHÔNG khớp)
const RE_DGPU = /NVIDIA|GeForce|\bRTX\b|Radeon (RX|Pro|VII)|Radeon\(TM\) (RX|Pro)|Apple (M\d|GPU)|Arc\(TM\) [AB]\d{3}|Intel.*Arc/i;
// GPU di động/iGPU cũ thật sự yếu → TIER 1
const RE_WEAK = /Mali-[T4-7]\d*|Mali-G[1-5]\d\b|Adreno(\(TM\))? [1-5]\d\d\b|PowerVR|Intel\(R\) HD Graphics [2-5]\d{3}|\bGMA\b/i;

export const TIER = (() => {
  if (QUALITY_PREF === 'full') return 3;
  if (QUALITY_PREF === 'lite') return 1;
  if (RE_SOFT.test(GPU_NAME)) return 0;
  if (IS_MOBILE) return 1;                       // điện thoại: giữ LITE vì nhiệt/pin, kể cả GPU tốt
  if (RE_WEAK.test(GPU_NAME)) return 1;
  if (CORES <= 4 || MEM <= 4) return 1;
  if (RE_DGPU.test(GPU_NAME)) return 3;
  return 2;                                      // iGPU hiện đại (Radeon 8x0M, Iris Xe...) hoặc không rõ
})();
export const LITE = TIER <= 1;

// Chrome/Edge trên laptop 2 GPU bám adapter mà Windows gán (thường iGPU); WebGL powerPreference KHÔNG đổi
// được card trên Windows (đo 2026-09-05: RTX 4060 nằm không, WebGL chạy Radeon 890M). Khi thấy iGPU trên
// máy nhiều nhân → gợi ý người chơi chỉnh Windows Graphics Settings (main.js hiện toast 1 lần).
export const IGPU_ON_BIG_MACHINE = !IS_MOBILE && CORES >= 8 && !RE_DGPU.test(GPU_NAME)
  && /Radeon\(TM\) \d{3}M|Radeon\(TM\) Graphics|Intel.*(Iris|UHD|Xe|HD Graphics)/i.test(GPU_NAME);

try {
  console.info('[device] GPU:', GPU_NAME || '?', '| TIER', TIER, '| LITE', LITE, '| touch', HAS_TOUCH,
    '| mobile', IS_MOBILE, '| cores', CORES, '| pref', QUALITY_PREF);
} catch (e) { }
