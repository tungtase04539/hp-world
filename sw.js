// Service Worker — file NẶNG & BẤT BIẾN (GLB, HDR, bin): tải nhanh + không tải lại,
// nhưng TỰ CẬP NHẬT khi asset đổi (stale-while-revalidate) để không kẹt bản cũ.
// Mục tiêu: lần đầu tải xong lưu trong máy → lần sau hiện đủ NGAY; nếu asset trên CDN
// đã đổi thì lần tải kế tiếp tự lấy bản mới ngầm. KHÔNG cache HTML/JS/CSS.
const CACHE = 'hpworld-heavy-v2';           // ĐỔI version này mỗi khi muốn xoá sạch cache cũ
const HEAVY = /\.(glb|hdr|bin|ktx2)(\?|$)/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('hpworld-')) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !HEAVY.test(req.url)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    // luôn thử lấy bản mới ngầm để tự cập nhật khi asset đổi
    const fetching = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    // có cache thì trả ngay (nhanh); đồng thời cập nhật ngầm cho lần sau
    if (hit) { e.waitUntil(fetching); return hit; }
    const res = await fetching;
    return res || Response.error();
  })());
});
