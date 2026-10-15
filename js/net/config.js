// js/net/config.js — địa chỉ máy chủ multiplayer (MP-2 C1). Không import gì, không chạm mạng.
//
// Thứ tự: `?server=<địa chỉ>` trên URL (được NHỚ vào localStorage `hp3d.server`) > localStorage > DEFAULT_SERVER.
// `?server=off` (hoặc `?server=` rỗng) xoá địa chỉ đã nhớ → chơi một mình.
// Địa chỉ nhận: `wss://tên-miền[/play]`, `https://tên-miền` (suy ra wss), `ws://`/`http://` CHỈ cho localhost/127.0.0.1
// (trang https không được mở ws:// — trình duyệt chặn mixed content). IP trần công khai bị từ chối (luôn qua tunnel/tên miền).
// HTTP API suy từ cùng gốc: https://tên-miền/v1/… ; WebSocket: wss://tên-miền/play.
//
// QUAN TRỌNG: main.js KHÔNG import file này khi không có cấu hình (0 request mới ở chế độ một mình — MP2 SPEC §1.3);
// nó kiểm nhanh URL/localStorage + hằng `NET_DEFAULT_ON` của chính nó. Điền DEFAULT_SERVER thì PHẢI đặt
// `NET_DEFAULT_ON = true` trong js/main.js (tools/qa/mp2_c1_unit.mjs báo đỏ khi hai chỗ lệch nhau).
export const DEFAULT_SERVER = '';            // chủ dự án điền khi có tên miền, ví dụ 'wss://hp.ten-mien.vn'
export const STORE_KEY = 'hp3d.server';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Chuẩn hoá một địa chỉ → { ws, http, origin, label } hoặc null (không hợp lệ).
export function parseServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = (/^(localhost|127\.0\.0\.1)(:|$)/i.test(s) ? 'ws://' : 'wss://') + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const local = LOCAL_HOSTS.has(u.hostname);
  let proto = u.protocol;
  if (proto === 'https:') proto = 'wss:';
  if (proto === 'http:') proto = 'ws:';
  if (proto !== 'wss:' && proto !== 'ws:') return null;
  if (proto === 'ws:' && !local) return null;                       // ws:// chỉ cho máy này
  if (!local && /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null; // IP trần công khai: không
  if (u.username || u.password) return null;
  const host = u.host;
  const httpProto = proto === 'wss:' ? 'https:' : 'http:';
  return {
    ws: `${proto}//${host}/play`,
    http: `${httpProto}//${host}`,
    origin: `${httpProto}//${host}`,
    label: host,
    local,
  };
}

// Đọc cấu hình hiện hành (ghi nhớ ?server= vào localStorage). Trả null = không có máy chủ → chơi một mình.
export function resolveServer(loc = (typeof location !== 'undefined' ? location : null)) {
  let fromUrl = null, hasParam = false;
  try {
    const q = new URLSearchParams(loc ? loc.search : '');
    if (q.has('server')) { hasParam = true; fromUrl = q.get('server'); }
  } catch (e) { /* bỏ qua */ }
  if (hasParam) {
    const v = String(fromUrl || '').trim();
    if (!v || v === 'off' || v === '0') { try { localStorage.removeItem(STORE_KEY); } catch (e) { } return null; }
    const p = parseServer(v);
    if (p) { try { localStorage.setItem(STORE_KEY, v); } catch (e) { } return p; }
    return null;
  }
  try { const v = localStorage.getItem(STORE_KEY); if (v) { const p = parseServer(v); if (p) return p; } } catch (e) { }
  return parseServer(DEFAULT_SERVER);
}
