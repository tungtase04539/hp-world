import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Bộ nạp công trình GLB chất lượng cao — tải thông minh:
//  - PRELOAD SONG SONG cả cụm trung tâm ngay từ màn hình chờ → vào là thấy đủ
//  - STREAMING công trình xa khi người chơi lại gần (1 cái/lúc, tránh giật)
//  - CDN jsDelivr (immutable, edge toàn cầu) → nhanh + KHÔNG tải lại giữa các lần vào
//  - báo tiến trình % để hiển thị trên màn chờ
// ============================================================

if (MeshoptDecoder.useWorkers) MeshoptDecoder.useWorkers(2);   // decode GLB ở WORKER — hết khựng main thread khi stream model
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const REGISTRY = [];
let toastFn = null;
let progressFn = null;

// File GLB nặng nằm ở nhánh assets-storage. Trên web dùng CDN jsDelivr
// (cache immutable + edge toàn cầu, băng thông không giới hạn) thay cho
// raw.githubusercontent (không phải CDN, cache ngắn → "tải lại" mỗi lần vào).
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// Ghim theo COMMIT SHA (không dùng tên nhánh) → jsDelivr cache IMMUTABLE + đồng nhất
// trên mọi edge (tránh tình trạng edge trả bản cũ/bản mới lẫn lộn khi asset đổi).
// Cập nhật SHA này mỗi khi đổi asset (nhánh assets-storage HEAD).
const ASSETS_SHA = '7a54597';
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/tungtase04539/hp-world@' + ASSETS_SHA + '/';
const RAWGH = 'https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/';
// jsDelivr GIỚI HẠN 20MB/file → 3 công trình >20MB (giữ 100% chất lượng gốc, không nén)
// phải dùng raw.githubusercontent (không giới hạn). Còn lại dùng jsDelivr (CDN nhanh).
// Service Worker cache cả hai nên lần sau vào đều hiện ngay.
const OVERSIZE = new Set(['assets/baotang.glb', 'assets/quanhoa.glb', 'assets/lechan.glb']);
const assetURL = (url) => IS_LOCAL ? url : ((OVERSIZE.has(url) ? RAWGH : JSDELIVR) + url);

// MOBILE: RAM/VRAM hạn chế → tải tuần tự, bán kính hẹp, texture hạ về ≤1024px (desktop giữ 100% gốc).
export const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  || (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 4);

// Cụm trung tâm (quanh gốc toạ độ) tải NGAY ở màn chờ; công trình xa để streaming.
const PRELOAD_RADIUS = IS_MOBILE ? 320 : 950;   // m — mobile chỉ preload cụm sát điểm xuất phát
const PRELOAD_PARALLEL = IS_MOBILE ? 1 : 4;     // mobile: 1 GLB/lúc (tránh peak RAM decode song song)
const STREAM_PARALLEL = 1;       // trong game: 1 cái/lúc để không giật khung hình khi parse
const MOBILE_TEX_MAX = 1024;     // px — trần texture trên mobile (màn nhỏ, không nhìn ra khác biệt)

// Hạ cỡ texture cho mobile NGAY sau khi load (canvas downscale) + giải phóng ảnh gốc khỏi RAM.
// KHÔNG đụng file gốc — desktop vẫn 100% chất lượng theo yêu cầu chủ dự án.
export function shrinkTexturesForMobile(root) {
  if (!IS_MOBILE) return;
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        const t = m[slot];
        if (!t || !t.image || seen.has(t)) continue;
        seen.add(t);
        const img = t.image, w = img.width || 0, h = img.height || 0;
        if (w <= MOBILE_TEX_MAX && h <= MOBILE_TEX_MAX) continue;
        const s = MOBILE_TEX_MAX / Math.max(w, h);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
        try {
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          t.image = cv;
          if (img.close) img.close();           // ImageBitmap: giải phóng RAM ngay
          t.needsUpdate = true;
        } catch (e) { /* texture lạ → giữ nguyên */ }
      }
    }
  });
}

// def: { url, name, x, z, radius, preload, place(gltfScene) }
export function registerModel(def) {
  const isCentral = (def.x * def.x + def.z * def.z) < PRELOAD_RADIUS * PRELOAD_RADIUS;
  REGISTRY.push({ ...def, state: 'idle', preload: def.preload || isCentral });
}

let loadingCount = 0;
function start(d) {
  if (d.state !== 'idle') return;
  d.state = 'loading';
  loadingCount++;
  if (toastFn && d.name) toastFn(`⏳ Đang tải ${d.name}…`);
  loader.load(
    assetURL(d.url),
    (gltf) => {
      d.state = 'done';
      loadingCount--;
      try {
        shrinkTexturesForMobile(gltf.scene);
        d.place(gltf.scene);
        if (toastFn && d.name) toastFn(`✓ ${d.name} sẵn sàng`);
      } catch (e) {
        console.error('place', d.url, e);
      }
      report();
      pump();
    },
    undefined,
    (err) => {
      d.state = 'idle'; // cho phép thử lại khi lại gần lần nữa
      loadingCount--;
      console.error('asset load', d.url, err);
      report();
      pump();
    }
  );
}

function report() {
  if (!progressFn) return;
  const pre = REGISTRY.filter((d) => d.preload);
  const done = pre.filter((d) => d.state === 'done').length;
  progressFn(done, pre.length);
}

// Lấp đầy pool preload song song
function pump() {
  if (loadingCount >= PRELOAD_PARALLEL) return;
  const next = REGISTRY.find((d) => d.preload && d.state === 'idle');
  if (next) { start(next); pump(); }
}

// initAssets(toast, onProgress?) → khởi động preload cụm trung tâm song song.
// onProgress(done, total) để cập nhật thanh tiến trình màn chờ.
export function initAssets(toast, onProgress) {
  toastFn = toast;
  progressFn = onProgress || null;
  report();
  pump();
}

let acc = 0;
export function updateAssets(dt, playerPos) {
  acc += dt;
  if (acc < 0.4) return;
  acc = 0;
  // trong game: giới hạn số cái tải song song để parse không làm giật khung
  if (loadingCount >= STREAM_PARALLEL) return;
  // ưu tiên model GẦN người chơi nhất trong bán kính
  let best = null, bd = Infinity;
  for (const d of REGISTRY) {
    if (d.state !== 'idle') continue;
    const r = d.radius || 1500;
    const dist2 = (playerPos.x - d.x) ** 2 + (playerPos.z - d.z) ** 2;
    if (dist2 < r * r && dist2 < bd) { bd = dist2; best = d; }
  }
  if (best) start(best);
}
