// tests/net/register.mjs — đăng ký loader.mjs + DOM tối thiểu (canvas 2D giả) cho test node của js/net.
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);

const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return (s) => ({ width: String(s).length * 14, actualBoundingBoxAscent: 26, actualBoundingBoxDescent: 7 });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d, toDataURL: () => '' }),
};
// node 21+ đã có navigator (chỉ đọc) — không cần giả
globalThis.window = globalThis.window || globalThis;
globalThis.location = globalThis.location || { search: '', hostname: 'localhost' };
