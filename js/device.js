// ============ NHẬN DIỆN THIẾT BỊ ============
// Module RIÊNG (không phụ thuộc gì) để world.js và assets.js cùng dùng mà KHÔNG tạo vòng lặp import.
// LITE = cấu hình tiết kiệm: texture nhỏ, thảm nhà thưa, tầm nhìn gần, DPR 1.0.
// Ép tay để test/chọn: ?quality=full hoặc ?quality=lite trên URL.

export const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));   // iPad iOS13+ giả dạng macOS

export const LITE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'full') return false;
    if (q === 'lite') return true;
    if (IS_MOBILE) return true;
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return true;   // tablet/laptop cảm ứng
    if ((navigator.hardwareConcurrency || 8) <= 4) return true;                  // CPU yếu
    if ((navigator.deviceMemory || 8) <= 4) return true;                         // RAM ≤4GB
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const rs = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|Intel\(R\)? (HD|UHD|Iris)|Mali-[T4-7]|Adreno [1-5]\d\d/i.test(rs)) return true;
  } catch (e) { }
  return false;
})();
