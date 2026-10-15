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
export const TRUST_KEY = 'hp3d.serverTrust';   // JSON [host…] người chơi đã xác nhận (hộp hỏi "Máy chủ lạ" — net.js)

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

// Máy chủ TIN CẬY (fixer vòng 1 SAFE-1): DEFAULT_SERVER, localhost/127.0.0.1, hoặc máy người chơi đã xác nhận trong hộp
// "Máy chủ lạ". Link chia sẻ `?server=<tên miền bất kỳ>` KHÔNG còn được nhớ ngầm: cfg.untrusted = true → net.js hỏi
// (tên máy chủ chữ to) TRƯỚC mọi request; chỉ khi đồng ý mới nhớ (trustServer). Chặn đường lừa: link lạ → màn tạo tài
// khoản của máy chủ kẻ gian → ô "Có mã khôi phục?" gửi mã khôi phục THẬT cho họ → chiếm tài khoản.
function trustedHosts() {
  try { const a = JSON.parse(localStorage.getItem(TRUST_KEY) || '[]'); return Array.isArray(a) ? a.filter((h) => typeof h === 'string') : []; } catch (e) { return []; }
}
export function isTrusted(p) {
  if (!p) return false;
  if (p.local) return true;
  const d = parseServer(DEFAULT_SERVER);
  if (d && d.label === p.label) return true;
  return trustedHosts().includes(p.label);
}
// người chơi đồng ý vào máy chủ lạ: nhớ host + địa chỉ
export function trustServer(p) {
  if (!p) return;
  try {
    const a = trustedHosts();
    if (!a.includes(p.label)) { a.push(p.label); while (a.length > 8) a.shift(); localStorage.setItem(TRUST_KEY, JSON.stringify(a)); }
    if (p.raw) localStorage.setItem(STORE_KEY, p.raw);
  } catch (e) { }
}
// từ chối: quên địa chỉ đã nhớ (lần sau chơi một mình như bình thường)
export function forgetServer() { try { localStorage.removeItem(STORE_KEY); } catch (e) { } }

// Đọc cấu hình hiện hành. Trả null = không có máy chủ → chơi một mình. ?server= của máy TIN CẬY được nhớ ngay; máy lạ
// trả {…, untrusted: true} và KHÔNG nhớ (net.js hỏi trước).
export function resolveServer(loc = (typeof location !== 'undefined' ? location : null)) {
  let fromUrl = null, hasParam = false;
  try {
    const q = new URLSearchParams(loc ? loc.search : '');
    if (q.has('server')) { hasParam = true; fromUrl = q.get('server'); }
  } catch (e) { /* bỏ qua */ }
  if (hasParam) {
    const v = String(fromUrl || '').trim();
    if (!v || v === 'off' || v === '0') { forgetServer(); return null; }
    const p = parseServer(v);
    if (!p) return null;
    p.raw = v;
    if (isTrusted(p)) { try { localStorage.setItem(STORE_KEY, v); } catch (e) { } return p; }
    p.untrusted = true;
    return p;
  }
  try {
    const v = localStorage.getItem(STORE_KEY);
    // một địa chỉ TẠM đã nhớ (*.trycloudflare.com — chết khi chủ máy chủ tắt tunnel) không được đè máy chủ mặc định khi
    // đã có tên miền riêng (VAN_HANH §16.7; vòng sửa 1 MP-2b)
    const def = parseServer(DEFAULT_SERVER);
    if (v && def && /\.trycloudflare\.com$/i.test((parseServer(v) || {}).label || '')) { localStorage.removeItem(STORE_KEY); return def; }
    if (v) { const p = parseServer(v); if (p) { p.raw = v; if (!isTrusted(p)) p.untrusted = true; return p; } }   // (bản cũ nhớ mọi host)
  } catch (e) { }
  return parseServer(DEFAULT_SERVER);
}
