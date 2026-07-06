// Service Worker — cache "cache-first" cho các file NẶNG & BẤT BIẾN (GLB, HDR, bin).
// Mục tiêu: lần đầu tải xong lưu vĩnh viễn trong máy → các lần vào sau hiện đủ NGAY,
// không tải lại (kể cả khi mạng chập chờn / offline). KHÔNG cache HTML/JS/CSS để
// bản cập nhật app vẫn deploy bình thường (tránh kẹt phiên bản cũ).
const CACHE = 'hpworld-heavy-v1';
const HEAVY = /\.(glb|hdr|bin|ktx2)(\?|$)/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // dọn cache phiên bản cũ nếu có
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('hpworld-')) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !HEAVY.test(req.url)) return; // để mặc định cho phần còn lại
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;                       // đã có trong máy → trả ngay, 0 mạng
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const fallback = await cache.match(req);
      if (fallback) return fallback;
      throw err;
    }
  })());
});
