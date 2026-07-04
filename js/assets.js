import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Bộ nạp công trình GLB chất lượng cao — tải thông minh:
//  - preload: tải ngầm ngay từ màn hình chờ (công trình gần điểm xuất phát)
//  - radius: công trình xa chỉ tải khi người chơi lại gần (streaming)
//  - báo tiến trình tải trên HUD
// ============================================================

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const REGISTRY = [];
let toastFn = null;

// File GLB nặng nằm ở nhánh assets-storage (GitHub Pages giới hạn dung lượng build);
// chạy local thì dùng bản trong thư mục assets/
const ASSET_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/';

// def: { url, name, x, z, radius, preload, place(gltfScene) }
export function registerModel(def) {
  REGISTRY.push({ ...def, state: 'idle' });
}

function start(d) {
  if (d.state !== 'idle') return;
  d.state = 'loading';
  if (toastFn && d.name) toastFn(`⏳ Đang tải ${d.name}…`);
  loader.load(
    ASSET_BASE + d.url,
    (gltf) => {
      d.state = 'done';
      try {
        d.place(gltf.scene);
        if (toastFn && d.name) toastFn(`✓ ${d.name} sẵn sàng`);
      } catch (e) {
        console.error('place', d.url, e);
      }
    },
    undefined,
    (err) => {
      d.state = 'idle'; // cho phép thử lại khi lại gần lần nữa
      console.error('asset load', d.url, err);
    }
  );
}

export function initAssets(toast) {
  toastFn = toast;
  for (const d of REGISTRY) if (d.preload) start(d);
}

let acc = 0;
export function updateAssets(dt, playerPos) {
  acc += dt;
  if (acc < 1) return;
  acc = 0;
  // tải TUẦN TỰ: nhiều GLB nặng parse cùng lúc sẽ nghẽn luồng chính gây giật
  if (REGISTRY.some((d) => d.state === 'loading')) return;
  // ưu tiên model GẦN người chơi nhất trong bán kính
  let best = null, bd = Infinity;
  for (const d of REGISTRY) {
    if (d.state !== 'idle') continue;
    const r = d.radius || 500;
    const dist2 = (playerPos.x - d.x) ** 2 + (playerPos.z - d.z) ** 2;
    if (dist2 < r * r && dist2 < bd) { bd = dist2; best = d; }
  }
  if (best) start(best);
}
