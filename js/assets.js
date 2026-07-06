import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Bộ nạp công trình GLB chất lượng cao — tải thông minh:
//  - PRELOAD SONG SONG cả cụm trung tâm ngay từ màn hình chờ → vào là thấy đủ
//  - STREAMING công trình xa khi người chơi lại gần (1 cái/lúc, tránh giật)
//  - CDN jsDelivr (immutable, edge toàn cầu) → nhanh + KHÔNG tải lại giữa các lần vào
//  - báo tiến trình % để hiển thị trên màn chờ
// ============================================================

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const REGISTRY = [];
let toastFn = null;
let progressFn = null;

// File GLB nặng nằm ở nhánh assets-storage. Trên web dùng CDN jsDelivr
// (cache immutable + edge toàn cầu, băng thông không giới hạn) thay cho
// raw.githubusercontent (không phải CDN, cache ngắn → "tải lại" mỗi lần vào).
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const ASSET_BASE = IS_LOCAL
  ? ''
  : 'https://cdn.jsdelivr.net/gh/tungtase04539/hp-world@assets-storage/';

// Cụm trung tâm (quanh gốc toạ độ) tải NGAY ở màn chờ; công trình xa để streaming.
const PRELOAD_RADIUS = 950;      // m — bán kính preload quanh điểm xuất phát (dải trung tâm)
const PRELOAD_PARALLEL = 4;      // số GLB tải song song ở màn chờ (không sợ giật vì chưa chơi)
const STREAM_PARALLEL = 1;       // trong game: 1 cái/lúc để không giật khung hình khi parse

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
    ASSET_BASE + d.url,
    (gltf) => {
      d.state = 'done';
      loadingCount--;
      try {
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
