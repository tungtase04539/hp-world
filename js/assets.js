import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { IS_MOBILE, LITE, TIER } from './device.js';
export { IS_MOBILE };   // re-export: traffic.js/world.js đang import từ đây

// ============================================================
// Bộ nạp công trình GLB chất lượng cao — tải thông minh:
//  - TẢI NGẦM TRONG WORKER ngay khi đăng ký (chạy song song với buildWorld ~30 s đồng bộ — trước đây
//    mạng rảnh đúng lúc CPU bận nhất, preload chỉ bắt đầu sau khi dựng xong thế giới)
//  - PRELOAD cụm trung tâm ở màn chờ; STREAMING công trình xa khi lại gần (1 cái/lúc)
//  - HIỆN MODEL KHÔNG KHỰNG: model mới đặt ở layer ẩn → renderer.compileAsync (shader) → initTexture
//    rải 1 texture/khung → mới đưa về layer 0. Trước đây khung đầu tiên nhìn thấy model phải biên dịch
//    shader (~45 ms/chương trình) + upload mọi texture 4096² (35-45 ms/tấm) cùng lúc → khựng 100-330 ms.
//  - CDN jsDelivr ghim SHA (immutable, edge toàn cầu); bản LITE ở assets_lite/ (chỉ tier ≤ 1)
//  - báo tiến trình % để hiển thị trên màn chờ
// ============================================================

if (MeshoptDecoder.useWorkers) MeshoptDecoder.useWorkers(2);   // decode hình học ở WORKER (đã kiểm chứng r160)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const REGISTRY = [];
let toastFn = null;
let progressFn = null;
let _renderer = null, _camera = null, _scene = null;

// File GLB nặng nằm ở nhánh assets-storage. Trên web dùng CDN jsDelivr (cache immutable + edge toàn cầu)
// thay cho raw.githubusercontent (không phải CDN, cache ngắn → "tải lại" mỗi lần vào).
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// Ghim theo COMMIT SHA (không dùng tên nhánh) → jsDelivr cache IMMUTABLE + đồng nhất trên mọi edge.
// PHẢI cập nhật SHA này mỗi khi đổi asset (= HEAD nhánh assets-storage). Kiểm: tools/check_assets.mjs.
const ASSETS_SHA = '8b8e42c';
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/tungtase04539/hp-world@' + ASSETS_SHA + '/';
const RAWGH = 'https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/';
// jsDelivr GIỚI HẠN 20MB/file → 3 công trình bản gốc >20MB dùng raw.githubusercontent (không giới hạn).
const OVERSIZE = new Set(['assets/baotang.glb', 'assets/quanhoa.glb', 'assets/lechan.glb']);
// BỘ ASSET NHẸ cho máy yếu/điện thoại (assets_lite/, sinh bằng tools/make_lite_assets.sh, ĐÃ ĐẨY lên
// assets-storage 2026-09-05 — trước đó chưa bao giờ được đẩy nên mọi máy LITE gặp 404 rồi tải lại bản gốc).
// LITE giờ = TIER ≤ 1 (device.js) — laptop cảm ứng KHÔNG còn bị đưa vào đây. Lite lỗi → forceFull thử lại NGAY.
export const assetURL = (url, forceFull) => {
  const u = (LITE && !forceFull) ? url.replace(/^assets\//, 'assets_lite/') : url;
  if (IS_LOCAL) return u;
  return (OVERSIZE.has(u) ? RAWGH : JSDELIVR) + u;   // chỉ bản gốc quá khổ (>20MB) mới cần raw.githubusercontent
};

// Cụm trung tâm (quanh gốc toạ độ) tải NGAY ở màn chờ; công trình xa để streaming.
const PRELOAD_RADIUS = IS_MOBILE ? 320 : 950;   // m — mobile chỉ preload cụm sát điểm xuất phát
const PRELOAD_PARALLEL = IS_MOBILE ? 1 : 4;     // số model PARSE song song (parse là việc main thread)
const STREAM_PARALLEL = 1;                      // trong game: 1 cái/lúc để không giật khung hình khi parse
const FETCH_PARALLEL = IS_MOBILE ? 1 : 4;       // số file TẢI song song trong worker
const MOBILE_TEX_MAX = 512;                     // px — trần texture GLB khi tier ≤ 1 (điện thoại/máy yếu)
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
const HIDE_LAYER = 31;                          // layer camera không vẽ: giấu model trong lúc biên dịch/upload

// ---------- Tải ngầm trong Worker (mạng chạy khi main thread đang bận buildWorld) ----------
const fetchWorker = (() => {
  try {
    const src = 'const q=[];let active=0;const MAX=' + FETCH_PARALLEL + ';'
      + 'function next(){while(active<MAX&&q.length){const j=q.shift();active++;const t0=Date.now();'
      + 'fetch(j.url).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.arrayBuffer();})'
      + '.then(b=>{self.postMessage({id:j.id,buf:b,t0,t1:Date.now()},[b]);})'
      + '.catch(e=>{self.postMessage({id:j.id,error:String(e&&e.message||e),t0,t1:Date.now()});})'
      + '.finally(()=>{active--;next();});}}'
      + 'self.onmessage=e=>{if(e.data.ping){self.postMessage({pong:1});return;}q.push(e.data);next();};';
    return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (e) { return null; }
})();
const _pending = new Map();
let _fid = 0;
const _fetchLog = [];   // chẩn đoán: {url, started, done, bytes|error} — mốc Date.now() (worker chạy song song buildWorld)
export function assetFetchLog() { return _fetchLog; }
// Worker chỉ KHỞI ĐỘNG được khi luồng chính nhả nhịp; buildWorld chạy đồng bộ 30-45 s ngay sau các import →
// main.js `await workerReady()` TRƯỚC buildWorld (đo 2026-09-05: không chờ thì mọi fetch bắt đầu SAU khi dựng xong).
let _readyResolve = null;
const _readyP = new Promise((r) => { _readyResolve = r; });
export function workerReady(timeoutMs = 800) {
  if (!fetchWorker) return Promise.resolve(false);
  return Promise.race([_readyP, new Promise((r) => setTimeout(() => r(false), timeoutMs))]);
}
if (fetchWorker) {
  fetchWorker.postMessage({ ping: 1 });
  fetchWorker.onmessage = (e) => {
    if (e.data.pong) { if (_readyResolve) _readyResolve(true); return; }
    const p = _pending.get(e.data.id);
    if (!p) return;
    _pending.delete(e.data.id);
    _fetchLog.push({ url: p.url, started: e.data.t0, done: e.data.t1, bytes: e.data.buf ? e.data.buf.byteLength : 0, error: e.data.error || null });
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.buf);
  };
}
function fetchBuffer(url) {
  const abs = new URL(url, location.href).href;   // worker Blob có base URL blob: → URL tương đối KHÔNG resolve được
  if (!fetchWorker) {
    return fetch(abs).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
  }
  return new Promise((resolve, reject) => {
    const id = ++_fid;
    _pending.set(id, { resolve, reject, url });
    fetchWorker.postMessage({ id, url: abs });
  });
}

// Hạ cỡ texture cho máy yếu NGAY sau khi load (canvas downscale) + giải phóng ảnh gốc khỏi RAM.
// TIER ≥ 2 (desktop/iGPU hiện đại): GIỮ NGUYÊN 100% texture gốc theo yêu cầu chủ dự án — chân dung
// ở Nhà hát lớn (emissive 4096²) từng bị thu về 512² trên chính máy chủ dự án vì tier sai.
export function shrinkTexturesForMobile(root) {
  if (TIER >= 2) return;
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const slot of TEX_SLOTS) {
        const t = m[slot];
        if (!t) continue;
        // Bỏ hẳn normal/roughness/metalness (chi tiết bề mặt vô hình ở cự ly chơi trên máy yếu, mỗi tấm tốn
        // ngang map). Kiểm slot TRƯỚC "seen": roughness và metalness thường DÙNG CHUNG 1 texture — bản cũ
        // đánh dấu seen ở roughness rồi bỏ qua metalness → giữ nguyên tấm metallicRoughness 1024².
        if (slot === 'normalMap' || slot === 'roughnessMap' || slot === 'metalnessMap') {
          m[slot] = null; m.needsUpdate = true; continue;
        }
        if (!t.image || seen.has(t)) continue;
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

// GỢI Ý TẢI SỚM: registerModel chỉ chạy ở CUỐI buildWorld (đo: giây ~40 của 53 s dựng) — cụm trung tâm biết
// trước thì bấm tải ngay lúc nạp module, worker bắt đầu từ giây ~1 (sau `await workerReady()` của main.js).
// Đổi danh sách công trình preload → cập nhật ở đây (tools/check_assets.mjs kiểm URL tồn tại trên CDN).
const PRELOAD_HINT = ['assets/nhahat.glb', 'assets/quanhoa.glb', 'assets/lechan.glb', 'assets/nhatho.glb', 'assets/buudien.glb',
  'assets/baotang.glb', 'assets/ga.glb', 'assets/thptnq.glb', 'assets/dennghe.glb', 'assets/nhnn.glb'];
const _hinted = new Map();
for (const u of (IS_MOBILE ? PRELOAD_HINT.slice(0, 3) : PRELOAD_HINT)) {
  const p = fetchBuffer(assetURL(u, false));
  p.catch(() => { });
  _hinted.set(u, p);
}

// main.js gọi sau khi tạo renderer/camera/scene (TRƯỚC buildWorld) — cần cho compileAsync/initTexture.
export function attachRenderer(renderer, camera, scene) { _renderer = renderer; _camera = camera; _scene = scene; }

// def: { url, name, x, z, radius, preload, place(gltfScene) }
export function registerModel(def) {
  const isCentral = (def.x * def.x + def.z * def.z) < PRELOAD_RADIUS * PRELOAD_RADIUS;
  const d = { ...def, state: 'idle', preload: def.preload || isCentral, buf: null };
  if (d.preload) {                 // bấm nút tải NGAY (worker) — buildWorld đang bận nhưng mạng thì rảnh
    d.buf = _hinted.get(d.url) || fetchBuffer(assetURL(d.url, false));
    _hinted.delete(d.url);
    d.buf.catch(() => { });        // lỗi xử lý ở start() (404 lite → thử bản gốc)
  }
  REGISTRY.push(d);
}

let loadingCount = 0;
const _reveal = [];   // hàng đợi hiện model: { roots, textures, compiled }

function start(d) {
  if (d.state !== 'idle') return;
  d.state = 'loading';
  loadingCount++;
  if (toastFn && d.name && !d.forceFull) toastFn(`⏳ Đang tải ${d.name}…`);
  const p = (d.buf && !d.forceFull) ? d.buf : fetchBuffer(assetURL(d.url, d.forceFull));
  d.buf = null;
  p.then((buf) => new Promise((res, rej) => loader.parse(buf, '', res, rej)))
    .then((gltf) => onLoaded(d, gltf))
    .catch((err) => onFail(d, err));
}

function onFail(d, err) {
  loadingCount--;
  d.state = 'idle';
  if (LITE && !d.forceFull) {
    d.forceFull = true;            // bản lite hỏng/thiếu → bản GỐC, thử lại NGAY (không đợi tick 0.4 s)
    console.warn('[asset] lite lỗi, chuyển bản gốc:', d.url, err && err.message);
    start(d);
    return;
  }
  console.error('asset load', d.url, err);
  report();
  pump();
}

function onLoaded(d, gltf) {
  d.state = 'done';
  loadingCount--;
  try {
    shrinkTexturesForMobile(gltf.scene);
    const before = _scene ? new Set(_scene.children) : null;
    d.place(gltf.scene);
    if (toastFn && d.name) toastFn(`✓ ${d.name} sẵn sàng`);
    if (_renderer && before) {
      // Mọi object mới đặt vào scene (kể cả bản clone — Quán hoa ×5) → giấu ở layer ẩn cho tới khi
      // shader đã biên dịch (compileAsync = KHR_parallel_shader_compile, không chặn) và texture đã upload.
      const roots = _scene.children.filter((o) => !before.has(o));
      if (roots.length) {
        const texs = new Set();
        for (const r of roots) {
          r.traverse((o) => {
            if (!o.isMesh) return;
            o.layers.set(HIDE_LAYER);
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              if (!m) continue;
              for (const s of TEX_SLOTS) if (m[s] && m[s].image) texs.add(m[s]);
            }
          });
        }
        const item = { roots, textures: [...texs], compiled: false };
        _reveal.push(item);
        // compile() duyệt traverseVisible → object phải visible; layer ẩn không ảnh hưởng.
        Promise.all(roots.map((r) => _renderer.compileAsync(r, _camera, _scene)))
          .catch(() => { })
          .then(() => { item.compiled = true; });
      }
    }
  } catch (e) {
    console.error('place', d.url, e);
  }
  report();
  pump();
}

// Gọi MỖI KHUNG từ main.js: upload đúng 1 texture (2048² ≈ 8-13 ms, 4096² ≈ 35-45 ms) rồi hiện model
// ở khung kế tiếp. Không còn khung 100-330 ms khi công trình đầu tiên lọt vào tầm nhìn.
export function pumpAssetUploads() {
  const it = _reveal[0];
  if (!it || !it.compiled) return;
  const t = it.textures.shift();
  if (t) { try { _renderer.initTexture(t); } catch (e) { } return; }
  for (const r of it.roots) r.traverse((o) => { if (o.isMesh) o.layers.set(0); });
  _reveal.shift();
}
// autoQuality bỏ qua các cửa sổ đo trong lúc còn tải/hiện model (khựng streaming từng làm máy mạnh bị hạ cấp).
export function assetsBusy() { return loadingCount > 0 || _reveal.length > 0; }

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
