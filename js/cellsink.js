// cellsink.js — "BỒN CHỨA" cho khối ô dựng tay (world.js "cells", ~1.230 nhà đặt tay theo pano 2026-07..09).
// Khối ô thêm vật thể qua scene.add / addCollider / FEATURED_CLEAR.push / makeTex. Ở cửa vào khối, world.js che 4 thứ
// đó bằng bản ghi của sink (biến cùng tên khai báo lại trong khối); ở cửa ra `commit()` phân loại TỪNG vật thể cấp cao
// nhất và hoà giải với footprint nhà THẬT (js/buildings_real.js, RB01):
//   • NHÀ "chung chung" (dãy phố, shop, nhà ống, tháp/khối không danh tính) → GỠ khi nhà thật đè ≥30% khối đặc của nó
//     hoặc nằm trong ~5 m; gỡ kèm collider + vòng FEATURED_CLEAR + biển/mái hiên treo trên mặt tiền của nó. Thuộc tính
//     (chữ biển, màu tường, số tầng, vị trí, hướng, footprint thật khớp nhất) xuất ra `world.cellShops` cho lớp mặt tiền.
//   • CÔNG TRÌNH CÓ DANH TÍNH (UBND/công sở/trường/chùa/đình/chợ/bệnh viện/khách sạn/ngân hàng/khuôn viên + cao ốc
//     ≥22 m + nhà DI SẢN Pháp/biệt thự/arcade ≥100 m²) → GIỮ + đăng ký hộp giữ chỗ claims.js kind 'cell' → lớp nhà
//     thật (WP2) bỏ footprint nằm dưới.
//   • Cặp nhà TRÙNG nhau (nhiều đợt agent vẽ cùng 1 toà) → giữ 1.
//   • Cây, đồ phố, tường/rào, mặt sân, và các HỆ THỐNG nhúng (cell_road rd_*, cell_tree tr_*, cell_dens de_*,
//     cell_curb street_curbs, cloverleaf) → không đụng.
//   • Texture canvas của khối ô vẽ LƯỜI (chỉ vẽ cái còn hiện ra sau commit) + xếp atlas cho vật thể giữ lại.
// Không import three (nhận THREE qua tham số). Chạy 1 lần lúc buildWorld: commit ~300-470 ms trên 890M (máy đang tải),
// nhưng tiết kiệm hơn thế nhờ ~1.100 canvas không vẽ + ~2.600 mesh ít hơn cho freezeStatic.
import { decodeRB, makeFootprintGrid, FLAG } from './buildings_data.js';
import { RB_B64 } from './buildings_real.js';
import { claimBox } from './claims.js';
import { BRAND_MAP, debrand } from './brands.js';
import { PARKS } from './mapdata.js';

const _q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
// ?cellsink=off → chỉ ghi (không gỡ, không claim) để A/B; =debug → như 'on' + giữ hình chiếu cho overlay QA;
// =dump → như 'off' + ghi dòng nguồn (stack) mỗi scene.add để phân tích offline.
export const CELLSINK_MODE = _q.get('cellsink') || 'on';

export const CELLSINK_PARAMS = {
  OVERLAP: 0.30,    // nhà ô có ≥30% khối đặc nằm trong footprint thật → gỡ
  NEAR: 5,          // hoặc footprint thật cách khối đặc ≤5 m → gỡ
  MIN_CELLS: 20,    // "dạng nhà": khối đặc ≥20 ô 1 m²
  MIN_H: 3,         //            và cao ≥3 m
  TOWER_H: 22,      // ≥22 m (~6-7 tầng): cao ốc quan sát từ pano → giữ như công trình danh tính
  HERIT_MIN: 100,   // nhà Pháp/biệt thự/arcade (tên HERIT_RE) có khối đặc ≥100 ô 1 m² → GIỮ như di sản (dáng riêng
                    // dựng theo pano: vòm, mansard, tháp góc, cửa chớp — fabric chung không tái tạo được); nhỏ hơn → nhà
  DUP_MIN: 0.5,     // trùng lặp: giao ≥50% diện tích nhà nhỏ hơn
  DUP_MAX: 0.25,    //            và ≥25% nhà lớn hơn
  DUP_HR: 2,        //            và tỉ lệ chiều cao ≤2 (tháp trên khối đế KHÔNG phải trùng)
  PARK_FRAC: 0.3,   // nhà dãy sinh tự động không có nhà thật gần, ≥30% khối đặc trong polygon công viên OSM → gỡ
};

// polygon công viên/vườn hoa OSM (mapdata PARKS) + bbox lọc nhanh
let _parks = null;
function inPark(x, z) {
  if (!_parks) _parks = (PARKS || []).map((pts) => {
    let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
    for (const [px, pz] of pts) { if (px < x1) x1 = px; if (px > x2) x2 = px; if (pz < z1) z1 = pz; if (pz > z2) z2 = pz; }
    return { pts, x1, x2, z1, z2 };
  });
  for (const p of _parks) {
    if (x < p.x1 || x > p.x2 || z < p.z1 || z > p.z2) continue;
    let ins = false; const P = p.pts;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, zi] = P[i], [xj, zj] = P[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
    }
    if (ins) return true;
  }
  return false;
}

// ---------- footprint nhà thật dùng chung (giải mã 1 lần cho cả trang — WP2/WP8 dùng lại, đừng giải mã lần 2) ----------
let _RB = null;
export function realBuildings() {
  if (!_RB) { const D = decodeRB(RB_B64); _RB = { D, G: makeFootprintGrid(D) }; }
  return _RB;
}

let _report = null;
export function cellSinkReport() { return _report; }

// ---------- lưới an toàn thương hiệu: 1 regex gộp kiểm nhanh, chỉ khi khớp mới chạy debrand đầy đủ ----------
const _brandQuick = new RegExp(BRAND_MAP.map(([re]) => '(?:' + re.source + ')').join('|'), 'i');
function guardText(t, stats) {
  if (typeof t !== 'string' || !_brandQuick.test(t)) return t;
  const d = debrand(t.toUpperCase());
  if (d === t.toUpperCase().trim()) return t;
  stats.brandHits.push([t, d]);
  return d;
}

// ngữ cảnh 2D GIẢ chỉ ghi lại trạng thái (không raster): đủ cho các hàm vẽ biển/mặt tiền của khối ô (fillStyle/font/
// fillRect/fillText/path/gradient/save/restore...) — dùng để lấy chữ biển + màu nền mà KHÔNG tạo pixel.
function recorderCtx(W, H) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const st = { canvas: { width: W, height: H }, fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif',
    globalAlpha: 1, lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over' };
  return new Proxy(st, {
    get(o, p) {
      if (p in o) return o[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createConicGradient' || p === 'createPattern') return () => grad;
      if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (p === 'getImageData' || p === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
      if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return noop;
    },
    set(o, p, v) { o[p] = v; return true; },
    deleteProperty(o, p) { delete o[p]; return true; },
  });
}

export function makeCellSink(THREE, realScene, realAddCollider, realFC, colliders, outerMakeTex) {
  const recs = [], cols = [], fcs = [];
  const stats = { t0: performance.now(), texCalls: 0, texNew: 0, texHit: 0, texDrawn: 0, texSkipped: 0, texMs: 0, memoHit: 0, memoMiss: 0, brandHits: [] };
  const createdTex = new Set();
  let seq = 0;
  const DUMP = CELLSINK_MODE === 'dump';
  const srcLines = () => {
    const st = new Error().stack || ''; const out = [];
    for (const ln of st.split('\n')) { const m = /world\.js:(\d+):\d+/.exec(ln); if (m) { out.push(+m[1]); if (out.length >= 4) break; } }
    return out;
  };
  const scene = {
    add(...objs) {
      for (const o of objs) { const r = { o, seq: seq++ }; if (DUMP) r.src = srcLines(); recs.push(r); }
      realScene.add(...objs);
      return scene;
    },
  };
  const addCollider = (x, z, r) => {
    const n0 = colliders.length;
    realAddCollider(x, z, r);
    for (let i = n0; i < colliders.length; i++) cols.push({ c: colliders[i], seq: seq++ });
  };
  // FEATURED_CLEAR: push phải tới mảng THẬT ngay (rowP/cnRow/ln/T6 đọc nó trong lúc dựng) → Proxy chỉ chặn push
  const fc = new Proxy(realFC, {
    get(t, p) {
      if (p === 'push') return (...es) => { for (const e of es) fcs.push({ e, seq: seq++ }); return t.push(...es); };
      return Reflect.get(t, p, t);
    },
  });
  // makeTex LƯỜI: khối ô tạo ~1.560 canvas biển/mặt tiền nhưng ~70% thuộc nhà sẽ bị gỡ ở commit → chỉ tạo texture +
  // canvas TRỐNG (qua makeTex gốc với hàm vẽ rỗng: đúng TEXQ/colorSpace/anisotropy, ngữ cảnh đã scale), giữ hàm vẽ;
  // commit() mới VẼ những texture còn được cảnh dùng (materialize), texture chỉ nhà-bị-gỡ dùng thì KHÔNG BAO GIỜ vẽ
  // (chữ biển của chúng vẫn lấy được bằng ngữ cảnh GHI CHÉP giả — recorderCtx). Đo: vẽ canvas = ~38% thời gian khối ô.
  // key: cache RIÊNG của sink (không đẩy vào cache toàn cục world.js → code ngoài khối không thể nhận texture chưa vẽ).
  let committed = false;         // sau commit: makeTex vẽ NGAY (không còn ai materialize)
  const lazy = new Map();        // texture → { w, h, draw }
  const keyed = new Map();       // 'WxH|key' → texture
  const makeTex = outerMakeTex && ((w, h, draw, key) => {
    stats.texCalls++;
    let ck;
    if (key !== undefined) { ck = w + 'x' + h + '|' + key; const hit = keyed.get(ck); if (hit) { stats.texHit++; return hit; } }
    const noop = () => {};
    noop.toString = () => draw.toString();   // giữ chẩn đoán texCacheStats().topUncached theo chỗ gọi gốc
    const t = outerMakeTex(w, h, noop);
    lazy.set(t, { w, h, draw });
    createdTex.add(t); stats.texNew++;
    if (ck) keyed.set(ck, t);
    if (committed) materialize(t);
    return t;
  });
  // chạy hàm vẽ gốc trên ngữ cảnh g: chặn thương hiệu (fillText/strokeText) + ghi chữ biển & màu nền phủ kín
  const runDraw = (t, L, g) => {
    let texts = null, base = null;
    const ft = g.fillText, st = g.strokeText, fr = g.fillRect, W = L.w, H = L.h;
    g.fillText = function (s0, ...a) { const s = guardText(s0, stats); (texts || (texts = [])).push(String(s)); return ft.call(this, s, ...a); };
    g.strokeText = function (s0, ...a) { return st.call(this, guardText(s0, stats), ...a); };
    g.fillRect = function (x, y, ww, hh) { if (base === null && x <= 0 && y <= 0 && ww >= W && hh >= H) base = String(this.fillStyle); return fr.call(this, x, y, ww, hh); };
    try { L.draw(g, W, H); } finally { delete g.fillText; delete g.strokeText; delete g.fillRect; }
    if (texts) t.userData.signTexts = texts;
    if (base) t.userData.base = base;
  };
  // vẽ thật 1 texture lười (canvas của nó đã có ngữ cảnh scale TEXQ từ makeTex gốc)
  const materialize = (t) => {
    const L = lazy.get(t); if (!L) return;
    lazy.delete(t);
    const tq = performance.now();
    runDraw(t, L, t.image.getContext('2d'));
    t.needsUpdate = true;
    stats.texDrawn++; stats.texMs += performance.now() - tq;
  };
  // chỉ lấy chữ biển/màu nền (không raster) — cho texture không bao giờ vẽ của nhà bị gỡ (xuất cellShops)
  const recordTexts = (t) => {
    const L = lazy.get(t); if (!L || L.rec) return;
    L.rec = true;
    try { runDraw(t, L, recorderCtx(L.w, L.h)); } catch (e) { /* hàm vẽ lạ → bỏ qua chữ */ }
  };
  // memo(name, fn): helper biển/mặt tiền thuần (tham số nguyên thuỷ → material) chỉ tạo 1 material/texture cho mỗi bộ
  // tham số (trước: mỗi lần gọi 1 canvas + 1 material → 1.693 texture). Tham số object/hàm → không cache (an toàn).
  const memoCaches = [];
  const memo = (name, fn) => {
    const cache = new Map(); memoCaches.push(cache);
    return (...args) => {
      for (const a of args) if (a !== null && (typeof a === 'object' || typeof a === 'function')) return fn(...args);
      const k = JSON.stringify(args);
      let v = cache.get(k);
      if (v === undefined) { v = fn(...args); cache.set(k, v); stats.memoMiss++; } else stats.memoHit++;
      return v;
    };
  };
  // cuối commit: vẽ MỌI texture lười còn có thể hiện ra; chỉ bỏ những texture mà MỌI tham chiếu nằm trong vật thể bị gỡ
  // (so theo Source: texture.clone() dùng chung canvas — vd cbWallMat). deadObjs = vật thể vừa gỡ khỏi cảnh.
  const settleTextures = (deadObjs) => {
    if (!lazy.size) return;
    const deadSrc = new Set(), liveSrc = new Set();
    const scan = (root, into) => root.traverse((m) => {
      const ms = m.material; if (!ms) return;
      for (const q of (Array.isArray(ms) ? ms : [ms])) if (q) for (const k in q) { const v = q[k]; if (v && v.isTexture) into.add(v.source); }
    });
    for (const o of deadObjs) scan(o, deadSrc);
    if (deadSrc.size) scan(realScene, liveSrc);
    for (const t of [...lazy.keys()]) {
      if (deadSrc.has(t.source) && !liveSrc.has(t.source)) { stats.texSkipped++; continue; }
      materialize(t);
    }
  };
  const sink = { scene, addCollider, fc, makeTex, memo, recs, cols, fcs, stats, createdTex, lazy, settleTextures, recordTexts };
  // nhả tham chiếu tới vật thể/texture đã gỡ (closure trong khối ô có thể giữ ngữ cảnh sink sống suốt phiên)
  sink.release = () => { committed = true; recs.length = 0; cols.length = 0; fcs.length = 0; lazy.clear(); keyed.clear(); createdTex.clear(); for (const c of memoCaches) c.clear(); };
  sink.commit = (opts = {}) => commitSink(sink, THREE, realScene, realFC, colliders, opts);
  return sink;
}

// ---------- trích hình chiếu XZ của 1 vật thể cấp cao nhất ----------
const _v = { x: 0, y: 0, z: 0 };
function xformPt(e, x, y, z) {   // e = matrixWorld.elements (cột chính)
  _v.x = e[0] * x + e[4] * y + e[8] * z + e[12];
  _v.y = e[1] * x + e[5] * y + e[9] * z + e[13];
  _v.z = e[2] * x + e[6] * y + e[10] * z + e[14];
  return _v;
}
// hình "không phải thân nhà": tán cây cầu/khối đa diện, nón (mái nón/ô dù), xuyến...
const SOFT_GEO = new Set(['SphereGeometry', 'IcosahedronGeometry', 'DodecahedronGeometry', 'OctahedronGeometry',
  'TetrahedronGeometry', 'ConeGeometry', 'TorusGeometry', 'TorusKnotGeometry', 'CapsuleGeometry', 'LatheGeometry']);
const _hsl = { h: 0, s: 0, l: 0 };
function isGreen(m) { if (!m || !m.color || m.map) return false; m.color.getHSL(_hsl); return _hsl.h > 0.17 && _hsl.h < 0.48 && _hsl.s > 0.15 && _hsl.l < 0.75; }
export function extractShape(o, foliage) {
  o.updateMatrixWorld(true);
  const meshes = [];
  let tris = 0, y0 = 1e9, y1 = -1e9;
  o.traverse((m) => {
    const g = m.geometry; if (!g || !g.attributes || !g.attributes.position) return;
    let bb;
    if (m.isInstancedMesh) { if (!m.boundingBox) m.computeBoundingBox(); bb = m.boundingBox; }
    else { if (!g.boundingBox) g.computeBoundingBox(); bb = g.boundingBox; }
    if (!bb || !isFinite(bb.min.x)) return;
    const e = m.matrixWorld.elements, P = [];
    let my0 = 1e9, my1 = -1e9;
    for (let k = 0; k < 8; k++) {
      const p = xformPt(e, k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z);
      P.push([p.x, p.z]); if (p.y < my0) my0 = p.y; if (p.y > my1) my1 = p.y;
    }
    const nt = (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);
    tris += nt; if (my0 < y0) y0 = my0; if (my1 > y1) y1 = my1;
    const mt = Array.isArray(m.material) ? m.material : [m.material];
    const h = hull(P);
    const leafy = mt.some((q) => q && (foliage && foliage.has(q))) || (g.type === 'BufferGeometry' && mt.every(isGreen));
    const transp = mt.every((q) => q && q.transparent && q.opacity < 0.9);
    const r = h.length >= 3 ? minRect(h) : null;
    const massive = !!m.isMesh && !m.isInstancedMesh && !SOFT_GEO.has(g.type) && !leafy && !transp && r &&
      my1 - my0 >= 2.5 && Math.min(r.hx, r.hz) * 2 >= 1.2 && r.area >= 4;
    meshes.push({ m, h, y0: my0, y1: my1, tris: nt, inst: !!m.isInstancedMesh, tex: mt.some((q) => q && q.map), line: !m.isMesh, massive, area: r ? r.area : 0, leafy, green: mt.every(isGreen) });
  });
  return { meshes, tris, y0, y1 };
}

// ---------- hình học 2D ----------
function hull(pts) {   // pts: [[x,z],...] → bao lồi (monotone chain)
  if (pts.length < 3) return pts.slice();
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// hộp chữ nhật diện tích nhỏ nhất bao bao lồi → {cx,cz,hx,hz,rot} theo quy ước world.js/claims.js
// (local X → (cosθ, −sinθ), local Z → (sinθ, cosθ))
export function minRect(H) {
  if (!H.length) return null;
  if (H.length < 3) { const [x, z] = H[0]; return { cx: x, cz: z, hx: 0.5, hz: 0.5, rot: 0, area: 1 }; }
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;   // trục cạnh
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of H) { const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) { const [x, z] = H[0]; return { cx: x, cz: z, hx: 0.5, hz: 0.5, rot: 0, area: 1 }; }
  const { ux, uz, u0, u1, v0, v1 } = best;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  // trục u = (ux,uz) là local X: (cosθ, −sinθ) = (ux, uz) → θ = atan2(−uz, ux)
  return { cx: uc * ux - vc * uz, cz: uc * uz + vc * ux, hx: (u1 - u0) / 2, hz: (v1 - v0) / 2, rot: Math.atan2(-uz, ux), area: best.area };
}
function inConvex(H, x, z) {   // H lồi CCW hoặc CW: cùng dấu tích chéo
  let s = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) { if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false; }
  }
  return true;
}
function segD2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ez = az + dz * t - pz; return ex * ex + ez * ez;
}
const KEY = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const KX = (k) => Math.floor(k / 65536) - 32768, KZ = (k) => (k % 65536) - 32768;

// ô 1 m bị khối đặc che (bao lồi từng mesh; mesh gộp lớn → raster tam giác hướng lên của chính nó)
function massCells(shape) {
  const S = new Set();
  let base = 1e9, top = -1e9;
  for (const q of shape.meshes) {
    if (!q.massive) continue;
    if (q.y0 < base) base = q.y0; if (q.y1 > top) top = q.y1;
    if (q.area <= 900) {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (const [x, z] of q.h) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      let n = 0;
      for (let ix = Math.floor(x0); ix <= Math.floor(x1); ix++) for (let iz = Math.floor(z0); iz <= Math.floor(z1); iz++)
        if (inConvex(q.h, ix + 0.5, iz + 0.5)) { S.add(KEY(ix, iz)); n++; }
      if (!n) S.add(KEY(Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2)));
    } else rasterUp(q.m, q.y0 + 1.5, S);
  }
  return { S, base, top };
}
function rasterUp(m, yMin, S) {
  const g = m.geometry, pos = g.attributes.position, idx = g.index, e = m.matrixWorld.elements;
  const n = idx ? idx.count : pos.count;
  const P = new Float32Array(9);
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t + k) : t + k;
      const p = xformPt(e, pos.getX(vi), pos.getY(vi), pos.getZ(vi)); P[k * 3] = p.x; P[k * 3 + 1] = p.y; P[k * 3 + 2] = p.z;
    }
    if (Math.min(P[1], P[4], P[7]) < yMin) continue;
    const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.abs(ny) < 0.5 * Math.hypot(nx, ny, nz)) continue;   // chỉ mặt nằm (mái/đỉnh)
    const H = [[P[0], P[2]], [P[3], P[5]], [P[6], P[8]]];
    const x0 = Math.min(P[0], P[3], P[6]), x1 = Math.max(P[0], P[3], P[6]), z0 = Math.min(P[2], P[5], P[8]), z1 = Math.max(P[2], P[5], P[8]);
    let any = false;
    for (let ix = Math.floor(x0); ix <= Math.floor(x1); ix++) for (let iz = Math.floor(z0); iz <= Math.floor(z1); iz++)
      if (inConvex(H, ix + 0.5, iz + 0.5)) { S.add(KEY(ix, iz)); any = true; }
    if (!any) S.add(KEY(Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2)));
  }
}

// ---------- phân loại theo tên ----------
const SYS_RE = /^(rd_|tr_hptrees|de_|street_curbs|cloverleaf)/;
const TREE_RE = /tree|palm|trunk|leaf|canopy|banyan|xacu|foliage|hedge|bougain|cay_|_cay\b|stake/;
// Tên KHÔNG-PHẢI-NHÀ loại MẠNH (đồ phố/kết cấu nhẹ): không bao giờ là nhà dù khối to — đài phun cb_dbp_fountain_nan
// 96 ô/6.1 m, giàn hoa cb_garden_pergola 64 ô/4.9 m, giàn giáo w5_summo_scaffold 8 m, dãy cột đèn w3_199_lamppost 94 ô.
const PROP_RE = /pergola|fountain|fence|pillar|lancan|kerb|curb|promenade|lamppost|globe|stall|kiosk|umbrella|tarp|scaffold|dirt|sanbong/;
// Tên KHÔNG-PHẢI-NHÀ loại YẾU (không gian mở/tường): các từ này CŨNG nằm trong tên nhà thật — 'TƯỜNG TÂY' (tiệm cưới),
// 'tường hông', 'curtainwall', 'shpplaza', 'lienke' (liền kề), 'AnAn' — nên chỉ phủ quyết khi khối THẤP/MỎNG/THƯA
// (openVeto); 'ke'/'nan' neo theo token (ke_/nan\b cũ khớp nhầm 'lienke_'/'anan ').
const OPEN_RE = /garden|park|plaza|rail|wall|rao|tuong|caro|walk|(^|[_\s])(ke|nan)([_\s]|$)/;
const OPEN_VETO = { H: 4, CELLS: 30, THIN: 3.5, FILL: 0.3 };
// token (đã bỏ số đuôi) → công trình danh tính. Khớp ĐÚNG token; tiền tố dài khớp startsWith.
const CIVIC_EXACT = new Set(['ubnd', 'ub', 'nvh', 'cdc', 'hcdc', 'bv', 'bvps', 'cho', 'den', 'dinh', 'chua', 'yte', 'svd',
  'bidv', 'msb', 'acb', 'vib', 'scb', 'vab', 'vcb', 'baoviet', 'gate', 'cong', 'tt', 'thuvien', 'school', 'truong', 'cdkt']);
const CIVIC_PREFIX = ['congso', 'conso', 'coquan', 'truso', 'chicucthue', 'sotuphap', 'thanhdoan', 'danguy', 'banchqs',
  'vanhoa', 'nhahoi', 'hoitruong', 'congvu', 'dienluc', 'tramyte', 'ytehongbang', 'benhvien', 'truongcong', 'mamnon', 'thpt',
  'thcs', 'nhatho', 'chocon', 'market', 'bazaar', 'khachsan', 'nhakhach', 'haiquan', 'hanghai', 'cangvu', 'beboi',
  'khandai', 'newschool', 'skyline', 'legend',
  'congthu', 'dinhphap', 'congty'];   // công thự / dinh thự Pháp (công sở thời Pháp) + khuôn viên công ty có cổng-cờ
// cao ốc văn phòng/kính có tên (5-7 tầng, thấp hơn TOWER_H) — dáng riêng nhìn từ pano → giữ như tháp
const TOWER_PREFIX = ['caooc', 'toakinh'];
const CIVIC_INCL = ['hotel', 'bank', 'school', 'tower', 'hospital'];
// nhà DI SẢN thời Pháp (biệt thự, nhà Pháp cổ, dãy arcade, mansard, tháp góc) — đối chiếu pano_089/070/160/255/504:
// mô hình ô (tường vàng/kem, cửa vòm, cửa chớp xanh, mái ngói đỏ) giống ảnh thật hơn hẳn fabric chung → giữ nếu đủ lớn
const HERIT_RE = /phap|bietthu|biethu|villa|colonial|arcade|mansard|manoir|turret/;
// ghi đè tay theo tên đầy đủ (đối chiếu pano: công trình đứng riêng có danh tính / nhà nhầm token)
const NAME_KIND = {
  nhahang_bocong_hd: 'civic',     // nhà hàng bo cong đứng giữa bãi giải toả Hoàng Diệu (pano_015-021)
  x46_gate: 'civic', tambac_phothuyen: 'house', cb_lam_block: 'house',
  tt_vanhoa: 'civic', samnec: 'house', pico_bachdang: 'house',
  tb_tapthe_cho: 'house', w4_maytinh_hanghai: 'house',   // 'cho'/'hanghai' ở đây là tên phố/tiệm, không phải chợ/cơ quan
  tb_goldstar: 'civic', tb_goldstar_thap: 'civic',       // bệnh viện quốc tế (pano_537-540)
  // CÁNH PHỤ của khuôn viên giữ lại (phản biện WP3: tách khuôn viên → cánh bị gỡ, ô trống lấp fabric chung)
  dl_hxh_wing: 'heritage',                                // cánh 1T vàng mái ngói đỏ cạnh biệt thự dl_hxh_villa_* (pano_504_h090)
  tb_fiin_wing: 'civic', tb_antra_wing: 'civic',          // cánh VP sau cổng tb_fiin_cong / tb_antra_cong
  // nhà RIÊNG dựng đúng ảnh (không phải dãy sinh tự động) — fabric chung không tái tạo được
  w5_cafe_gach_dth: 'bespoke',                            // quán cà phê tường gạch hoa thông gió (pano_048_h090)
  v2_haithanh_bld: 'civic',                               // khối VP 5T sau cổng 3 cột cờ (cùng khuôn viên v2_cong_haithanh)
  w5_phonglan_bld: 'tower',                               // cao ốc kính 6T có tên (pano_048)
};
// token bỏ số nhà đuôi (kể cả '17a', '246b'): 'w5_cdc17a' → ['w', 'cdc']
function tokens(name) { return name.toLowerCase().split(/[_\s\-.,·—]+/).map((t) => t.replace(/\d+[a-z]?$/, '')).filter(Boolean); }
export function nameKind(name) {
  const n = (name || '').toLowerCase();
  if (!n) return '';
  if (NAME_KIND[n]) return NAME_KIND[n];
  if (SYS_RE.test(n)) return 'sys';
  if (TREE_RE.test(n)) return 'tree';
  for (const t of tokens(n)) {
    if (CIVIC_EXACT.has(t)) return 'civic';
    for (const p of CIVIC_PREFIX) if (t.startsWith(p)) return 'civic';
    for (const p of CIVIC_INCL) if (t.includes(p)) return 'civic';
  }
  for (const t of tokens(n)) for (const p of TOWER_PREFIX) if (t.startsWith(p)) return 'tower';
  if (PROP_RE.test(n)) return 'propn';
  if (OPEN_RE.test(n)) return 'open';
  if (HERIT_RE.test(n)) return 'heritage';
  return '';
}
// tên 'open' (yếu) chỉ phủ quyết khi khối thấp / ít ô / mỏng (tường, rào, bậc) / thưa (vườn có chòi rải rác)
function openVeto(S, height) {
  const V = OPEN_VETO;
  if (height < V.H || S.size < V.CELLS) return true;
  const r = minRect(hull([...S].map((k) => [KX(k) + 0.5, KZ(k) + 0.5])));
  return 2 * Math.min(r.hx, r.hz) + 1 < V.THIN || S.size < V.FILL * (2 * r.hx + 1) * (2 * r.hz + 1);
}
// cánh/nhà phụ cùng khuôn viên: tên có token wing/annex/canh + chung 2 token đầu với công trình giữ lại ≤45 m → cùng loại
const WING_RE = /(^|[_\s])(wing|annex|canh)([_\s]|$)/;
const prefix2 = (name) => tokens(name).slice(0, 2).join('_');
// trùng lặp: bản ưu tiên (vẽ lại theo audit mới hơn) thắng bất kể điểm hạng
const DUP_PREFER = new Set(['s4_biethu_tp']);   // biển 'CHO THUÊ NHÀ' + cổng sắt xanh đúng audit pano_398_h180
function styleHint(name) {
  const n = (name || '').toLowerCase();
  if (/phap|bietthu|biethu|villa|colonial|arcade|mansard|manoir|turret|marble/.test(n)) return 'villa';
  if (/kinh|glass|curtainwall|toakinh|caooc|office/.test(n)) return 'glass';
  if (/tapthe|ktt|apt|chungcu/.test(n)) return 'ktt';
  if (/kho|xuong|shed|warehouse|garage|gara|cap4|ton\b/.test(n)) return 'shed';
  if (/oldrow|phoco|nhaco|cu\b|ruin|catcut|lanong|hangkenh|tambac/.test(n)) return 'old';
  return 'tube';
}

// ---------- COMMIT (cửa ra khối ô) ----------
function commitSink(sink, THREE, realScene, realFC, colliders, opts) {
  const t0 = performance.now();
  const PR = CELLSINK_PARAMS;
  const { recs, cols, fcs, stats } = sink;
  const foliage = new Set(opts.foliage || []);
  const MODE = CELLSINK_MODE;
  const DBG = MODE === 'debug' || MODE === 'dump';

  // 1) hình chiếu + phân loại thô
  const items = recs.map((r, i) => {
    const name = r.o.name || '';
    const tag = r.o.userData && r.o.userData.kind || '';
    const nk = nameKind(name);
    const it = { i, seq: r.seq, src: r.src, o: r.o, name, tag, nk, kind: '', bldg: false, removed: '' };
    if (tag === 'sys' || nk === 'sys') { it.kind = 'sys'; return it; }
    it.shape = extractShape(r.o, foliage);
    const pts = []; for (const q of it.shape.meshes) for (const p of q.h) pts.push(p);
    it.hull = hull(pts);
    const mc = massCells(it.shape);
    it.S = mc.S; it.height = mc.top - mc.base; it.base = mc.base;
    // HÌNH HỌC quyết trước (≥MIN_CELLS ô đặc, cao ≥MIN_H); tên chỉ phủ quyết khi: thẻ prop/tree/open đặt tay, tên cây/
    // đồ phố (mạnh), hoặc tên không gian mở/tường (yếu) VÀ khối thấp/mỏng/thưa (openVeto).
    const massive = mc.S.size >= PR.MIN_CELLS && it.height >= PR.MIN_H;
    const veto = tag === 'prop' || tag === 'tree' || tag === 'open' || nk === 'tree' || nk === 'propn' ||
      (nk === 'open' && massive && openVeto(mc.S, it.height));
    it.bldg = massive && !veto;
    if (!it.bldg) { it.kind = tag || (nk === 'tree' ? 'tree' : nk === 'open' || nk === 'propn' ? 'open' : 'prop'); return it; }
    it.kind = tag || (nk === 'civic' || nk === 'house' || nk === 'tower' || nk === 'bespoke' ? nk
      : nk === 'heritage' && (mc.S.size >= PR.HERIT_MIN || NAME_KIND[name.toLowerCase()]) ? 'heritage'   // ghi đè tay: bỏ ngưỡng
      : it.height >= PR.TOWER_H ? 'tower' : 'house');
    return it;
  });
  const tShape = performance.now();

  if (MODE === 'dump') {
    sink.settleTextures([]);
    _report = dumpReport(items, cols, fcs, stats, performance.now() - t0);
    sink.release();
    return _report;
  }

  // 2) đối chiếu nhà thật
  const { D, G } = realBuildings();
  // nhà SINH (FLAG.SYNTH, RB v1: phỏng đoán lấp chỗ trống) KHÔNG làm bằng chứng gỡ nhà tay — hợp đồng WP1 v1
  // (buildings_data.js FLAG.SYNTH); nhà sinh dưới nhà tay giữ lại sẽ bị WP2 bỏ qua claim 'cell'.
  const SYN = FLAG && FLAG.SYNTH ? FLAG.SYNTH : 0;
  const realB = (b) => b >= 0 && !(D.flags[b] & SYN);
  const bl = items.filter((it) => it.bldg);
  for (const it of bl) {
    const keys = [...it.S]; it.keys = keys;
    const n = keys.length, step = Math.max(1, Math.ceil(n / 150));
    let hit = 0, tot = 0; const per = new Map();
    let sx = 0, sz = 0;
    for (const k of keys) { sx += KX(k) + 0.5; sz += KZ(k) + 0.5; }
    it.cx = sx / n; it.cz = sz / n;
    for (let j = 0; j < n; j += step) {
      tot++; const b = G.at(KX(keys[j]) + 0.5, KZ(keys[j]) + 0.5);
      if (realB(b)) { hit++; per.set(b, (per.get(b) || 0) + 1); }
    }
    it.frac = tot ? hit / tot : 0;
    let bb = -1, bn = 0; for (const [b, c] of per) if (c > bn) { bn = c; bb = b; }
    it.realB = bb;
    const H = hull(keys.map((k) => [KX(k) + 0.5, KZ(k) + 0.5]));
    it.H = H;
    it.dReal = it.frac > 0 ? 0 : Infinity;
    // chỉ NHÀ chưa bị gỡ vì đè mới cần khoảng cách tới footprint thật gần nhất (≤ NEAR+1 m)
    if (it.kind !== 'house' || it.frac >= PR.OVERLAP || it.frac > 0) continue;
    let rad = 0; for (const [x, z] of H) rad = Math.max(rad, Math.hypot(x - it.cx, z - it.cz));
    let dmin = Infinity, dB = -1;
    G.near(it.cx, it.cz, rad + PR.NEAR + 1, (b) => {
      if (dmin <= PR.NEAR || !realB(b)) return;   // đủ để quyết định / bỏ nhà sinh
      const d = polyHullDist(D, G, b, H);
      if (d < dmin) { dmin = d; dB = b; }
    });
    it.dReal = dmin; if (it.realB < 0 && dmin <= PR.NEAR) it.realB = dB;
  }
  const tReal = performance.now();

  // 2b) cánh phụ khuôn viên: 'xx_yy_wing' cạnh công trình giữ lại cùng tiền tố 'xx_yy' (≤45 m) → cùng loại (không tách)
  for (const it of bl) {
    if (it.kind !== 'house' || it.tag || !WING_RE.test(it.name.toLowerCase())) continue;
    const pf = prefix2(it.name);
    for (const o of bl) if (o !== it && o.kind !== 'house' && prefix2(o.name) === pf && Math.hypot(o.cx - it.cx, o.cz - it.cz) <= 45) { it.kind = o.kind; it.wingOf = o.name; break; }
  }

  // 3) quyết định gỡ (chỉ NHÀ chung chung)
  const live = MODE !== 'off';
  for (const it of bl) {
    if (it.kind !== 'house') continue;
    if (it.frac >= PR.OVERLAP) it.removed = 'overlap';
    else if (it.dReal <= PR.NEAR) it.removed = 'near';
  }
  // 3b) nhà DÃY SINH TỰ ĐỘNG (thẻ 'house' của rowP/cnRow/…) không có nhà thật gần mà đứng ≥PARK_FRAC trong polygon công
  //     viên/vườn hoa OSM → gỡ (vd ~10 ln_row trên thảm cỏ vườn hoa An Biên, cam_high_center) — KHÔNG claim chỗ cỏ.
  for (const it of bl) {
    if (it.removed || it.kind !== 'house' || it.tag !== 'house') continue;
    let inP = 0;
    for (const k of it.keys) if (inPark(KX(k) + 0.5, KZ(k) + 0.5)) inP++;
    if (inP >= PR.PARK_FRAC * it.keys.length) { it.removed = 'park'; it.parkFrac = +(inP / it.keys.length).toFixed(2); }
  }
  // 4) trùng lặp giữa các nhà còn lại (ưu tiên: danh tính > nhà; khớp nhà thật hơn; chi tiết hơn; vẽ trước)
  const surv = bl.filter((it) => !it.removed);
  const cellOwner = new Map();
  for (const it of surv) for (const k of it.keys) { const a = cellOwner.get(k); if (a) a.push(it); else cellOwner.set(k, [it]); }
  const pairs = new Map();
  for (const it of surv) for (const k of it.keys) {
    const a = cellOwner.get(k); if (a.length < 2) continue;
    for (const o of a) if (o.i > it.i) { const pk = it.i * 100000 + o.i; pairs.set(pk, (pairs.get(pk) || 0) + 1); }
  }
  const byI = new Map(items.map((it) => [it.i, it]));
  const rank = (it) => (it.kind === 'house' ? 0 : 4) + it.frac * 2 + Math.min(1, it.shape.tris / 3000);
  const dups = [];
  for (const [pk, inter] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
    const A = byI.get(Math.floor(pk / 100000)), B = byI.get(pk % 100000);
    if (A.removed || B.removed) continue;
    const sa = A.keys.length, sb = B.keys.length;
    const small = sa <= sb ? A : B, big = small === A ? B : A;
    // (a) NẰM TRỌN: nhà nhỏ ≥90% bên trong nhà lớn không thấp hơn → bản vẽ lại (chợ Con ×2…)
    const contained = inter >= 0.9 * small.keys.length && big.height >= small.height - 1;
    if (!contained) {
      if (inter < PR.DUP_MIN * Math.min(sa, sb) || inter < PR.DUP_MAX * Math.max(sa, sb)) continue;
      const hr = Math.max(A.height, B.height) / Math.max(0.1, Math.min(A.height, B.height));
      if (hr > PR.DUP_HR) continue;   // tháp trên khối đế KHÔNG phải trùng
    }
    const pref = DUP_PREFER.has(A.name) ? A : DUP_PREFER.has(B.name) ? B : null;
    const loser = pref ? (pref === A ? B : A) : contained ? small : rank(A) >= rank(B) ? B : A, winner = loser === A ? B : A;
    loser.removed = 'dup'; loser.dupOf = winner.name; dups.push([winner.name || '#' + winner.i, loser.name || '#' + loser.i]);
  }

  // 5) biển/mái hiên/điều hoà… treo trên mặt tiền nhà bị gỡ (vật thể RỜI cấp cao nhất)
  const remCell = new Map();
  for (const it of bl) if (it.removed) for (const k of it.keys) remCell.set(k, it);
  let propsRemoved = 0;
  for (const it of items) {
    if (it.bldg || it.kind === 'sys' || it.kind === 'tree' || !it.shape || !it.hull.length) continue;
    if (it.shape.meshes.every((q) => q.leafy || q.green)) continue;   // tán cây rời (cầu xanh) — không phải đồ treo
    let x = 0, z = 0; for (const [px, pz] of it.hull) { x += px; z += pz; } x /= it.hull.length; z /= it.hull.length;
    const ix = Math.floor(x), iz = Math.floor(z);
    let host = remCell.get(KEY(ix, iz));
    if (!host && it.shape.y0 >= (LAND_Y + 1.2)) {   // treo cao (không đứng trên vỉa hè) trong vành 1 m quanh nhà bị gỡ
      for (let dx = -1; dx <= 1 && !host; dx++) for (let dz = -1; dz <= 1 && !host; dz++) host = remCell.get(KEY(ix + dx, iz + dz));
    }
    if (host) { it.removed = 'attached'; it.host = host.name; propsRemoved++; }
  }

  // 6) collider + vòng FEATURED_CLEAR: chủ = vật thể chứa tâm (ô khối đặc ±1 / bbox vật nhỏ), gần nhất theo thứ tự tạo
  const owners = new Map();   // ô 8 m → items (vật nhỏ theo bbox)
  const OB = 8;
  for (const it of items) {
    if (it.kind === 'sys' || it.bldg || !it.hull || !it.hull.length) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const [x, z] of it.hull) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if ((x1 - x0) * (z1 - z0) > 4e4) continue;   // vật trải dài (hàng cây gộp…) không làm chủ
    it.bb = [x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5];
    for (let i = Math.floor(it.bb[0] / OB); i <= Math.floor(it.bb[2] / OB); i++) for (let j = Math.floor(it.bb[1] / OB); j <= Math.floor(it.bb[3] / OB); j++) {
      const k = KEY(i, j); const a = owners.get(k); if (a) a.push(it); else owners.set(k, [it]);
    }
  }
  const bldCell = new Map();
  for (const it of bl) for (const k of it.keys) { const a = bldCell.get(k); if (a) a.push(it); else bldCell.set(k, [it]); }
  const ownerOf = (x, z, sq) => {
    let best = null, bd = Infinity;
    const ix = Math.floor(x), iz = Math.floor(z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = bldCell.get(KEY(ix + dx, iz + dz)); if (!a) continue;
      for (const it of a) { const d = Math.abs(it.seq - sq); if (d < bd) { bd = d; best = it; } }
    }
    const a = owners.get(KEY(Math.floor(x / OB), Math.floor(z / OB)));
    if (a) for (const it of a) {
      if (x < it.bb[0] || x > it.bb[2] || z < it.bb[1] || z > it.bb[3]) continue;
      const d = Math.abs(it.seq - sq); if (d < bd) { bd = d; best = it; }
    }
    return best;
  };
  const deadCol = new Set(), deadFC = new Set();
  if (live) {
    for (const { c, seq } of cols) { const o = ownerOf(c.x, c.z, seq); if (o && o.removed) deadCol.add(c); }
    for (const { e, seq } of fcs) { const o = ownerOf(e[0], e[1], seq); if (o && o.removed) deadFC.add(e); }
  }

  // 7) áp dụng: gỡ khỏi cảnh, nén mảng collider (colIdx còn null tới lần resolveCollisions đầu) + FEATURED_CLEAR
  const shops = [];
  let nRem = 0;
  const dead = new Set();
  if (live) {
    // gỡ HÀNG LOẠT: nén scene.children 1 lượt (remove() từng cái = indexOf+splice O(n²) trên ~3.300 con)
    for (const it of items) if (it.removed && it.o.parent === realScene) dead.add(it.o);
    const ch = realScene.children; let w = 0;
    for (let r = 0; r < ch.length; r++) { const o = ch[r]; if (dead.has(o)) { o.parent = null; o.dispatchEvent({ type: 'removed' }); } else ch[w++] = o; }
    ch.length = w; nRem = dead.size;
    if (deadCol.size) { let w = 0; for (let r = 0; r < colliders.length; r++) if (!deadCol.has(colliders[r])) colliders[w++] = colliders[r]; colliders.length = w; }
    if (deadFC.size) { let w = 0; for (let r = 0; r < realFC.length; r++) if (!deadFC.has(realFC[r])) realFC[w++] = realFC[r]; realFC.length = w; }
  }
  // 7a) vẽ texture lười còn hiện ra (texture CHỈ nhà bị gỡ dùng → không bao giờ vẽ)
  const tTex0 = performance.now();
  sink.settleTextures(dead);
  const msTex = performance.now() - tTex0;
  // xuất thuộc tính nhà bị gỡ (trừ bản trùng — bản thắng vẫn đứng đó); chữ biển texture chưa vẽ lấy qua ngữ cảnh ghi chép
  if (live) for (const it of bl) if (it.removed === 'overlap' || it.removed === 'near') shops.push(shopAttrs(it, sink.recordTexts));

  // 7b) ATLAS biển/mặt tiền của vật thể GIỮ LẠI: mỗi canvas "thường" (không lặp/lệch UV) → 1 ô trong vài trang 2048²,
  //     material dùng chung theo (loại, mặt, trang) → freezeStatic lượt 2 gộp theo material → ít draw call + ít upload.
  let atlas = null;
  const tA0 = performance.now();
  if (live && opts.atlas !== false) atlas = atlasKept(items.filter((it) => !it.removed && it.kind !== 'sys'), sink.createdTex, THREE);
  if (atlas) atlas.ms = +(performance.now() - tA0).toFixed(1);
  const tApply = performance.now();
  // 8) claim cho mọi nhà/công trình GIỮ LẠI
  let nClaims = 0;
  const claimsDbg = [];
  if (live) for (const it of bl) {
    if (it.removed) continue;
    for (const r of claimRects(it)) {
      claimBox(r.cx, r.cz, r.hx + 0.5, r.hz + 0.5, r.rot, 'cell', it.name || '#' + it.i); nClaims++;
      if (DBG) claimsDbg.push([+r.cx.toFixed(1), +r.cz.toFixed(1), +(r.hx + 0.5).toFixed(1), +(r.hz + 0.5).toFixed(1), +r.rot.toFixed(4)]);
    }
  }

  // 9) báo cáo
  const cnt = (f) => items.filter(f).length;
  const bySec = {};
  for (const it of bl) {
    const s = (it.name.split('_')[0] || '(vô danh)'); const o = bySec[s] || (bySec[s] = { kept: 0, removed: 0 });
    if (it.removed) o.removed++; else o.kept++;
  }
  const keptTex = new Set(), keptMat = new Set();
  for (const it of items) if (!it.removed && it.kind !== 'sys') it.o.traverse((m) => {
    if (!m.material) return; for (const q of (Array.isArray(m.material) ? m.material : [m.material])) { keptMat.add(q); if (q.map && (sink.createdTex.has(q.map) || q.name === 'cellAtlas')) keptTex.add(q.map); }
  });
  _report = {
    mode: MODE, blockMs: +(t0 - stats.t0).toFixed(1), ms: +(performance.now() - t0).toFixed(1), msShape: +(tShape - t0).toFixed(1), msReal: +(tReal - tShape).toFixed(1), msApply: +(tApply - tReal).toFixed(1),
    objects: items.length, buildings: bl.length,
    // kinds = TỔNG nhà theo loại (kể cả bản trùng bị gỡ); keptKinds = chỉ nhà GIỮ LẠI (có claim)
    kinds: { civic: cnt((it) => it.bldg && it.kind === 'civic'), tower: cnt((it) => it.bldg && it.kind === 'tower'), heritage: cnt((it) => it.bldg && it.kind === 'heritage'), bespoke: cnt((it) => it.bldg && it.kind === 'bespoke'), house: cnt((it) => it.bldg && it.kind === 'house'),
      tree: cnt((it) => it.kind === 'tree'), open: cnt((it) => it.kind === 'open'), prop: cnt((it) => it.kind === 'prop'), sys: cnt((it) => it.kind === 'sys') },
    removed: { total: nRem, overlap: cnt((it) => it.removed === 'overlap'), near: cnt((it) => it.removed === 'near'), park: cnt((it) => it.removed === 'park'), dup: cnt((it) => it.removed === 'dup'), attached: propsRemoved },
    keptBuildings: bl.filter((it) => !it.removed).length,
    keptKinds: bl.filter((it) => !it.removed).reduce((o, it) => { o[it.kind] = (o[it.kind] || 0) + 1; return o; }, {}),
    wings: bl.filter((it) => it.wingOf).map((it) => [it.name, it.wingOf, it.kind]),
    colliders: { cells: cols.length, removed: deadCol.size }, featuredClear: { cells: fcs.length, removed: deadFC.size },
    claims: nClaims, dups, bySection: bySec,
    tex: { calls: stats.texCalls, created: stats.texNew, keyHit: stats.texHit, drawn: stats.texDrawn, neverDrawn: stats.texSkipped, drawMs: +stats.texMs.toFixed(1), settleMs: +msTex.toFixed(1), kept: keptTex.size, keptBySize: [...keptTex].reduce((o, t) => { const k = t.name || (t.image ? t.image.width + "x" + t.image.height : "?"); o[k] = (o[k] || 0) + 1; return o; }, {}) }, materialsKept: keptMat.size,
    memo: { hit: stats.memoHit, miss: stats.memoMiss }, atlas, brandHits: stats.brandHits,
    shops,
    // nhà ô GIỮ LẠI + bao lồi ô khối đặc (để WP2 CẮT footprint thật theo đa giác thay vì bỏ/giữ cả footprint)
    kept: live ? bl.filter((it) => !it.removed).map((it) => ({ name: it.name, kind: it.kind, cx: +it.cx.toFixed(1), cz: +it.cz.toFixed(1), h: +it.height.toFixed(1), hull: it.H.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]) })) : [],
  };
  if (DBG) _report.debug = {
    items: bl.map((it) => ({ n: it.name, k: it.kind, r: it.removed, f: +it.frac.toFixed(2), d: isFinite(it.dReal) ? +it.dReal.toFixed(1) : -1, h: +it.height.toFixed(1), H: it.H.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]) })),
    claims: claimsDbg,
    attached: items.filter((it) => it.removed === 'attached').map((it) => [it.name || it.o.type, it.host, +it.shape.y0.toFixed(1), it.shape.meshes.length]),
  };
  sink.release();
  if (typeof console !== 'undefined') console.log(`[cellsink] ${MODE}: ${bl.length} nhà ô → giữ ${_report.keptBuildings}, gỡ ${nRem} (đè ${_report.removed.overlap}, gần ${_report.removed.near}, cỏ ${_report.removed.park}, trùng ${_report.removed.dup}, đồ treo ${propsRemoved}); collider −${deadCol.size}, FC −${deadFC.size}; claim ${nClaims}; ${_report.ms} ms`);
  return _report;
}
const LAND_Y = 2;   // = LAND_H world.js (nền phố phẳng)

// ---------- atlas texture cho vật thể ô giữ lại ----------
// Điều kiện "thường": material Lambert/Basic một-mảng, map ∈ texture do khối ô tạo, repeat 1/offset 0/rotation 0,
// không trong suốt/alphaTest/vertexColors/màu nhuộm (color trắng), không emissive/map phụ, onBeforeCompile mặc định,
// và UV của geometry nằm trong [0,1]. Ô atlas = kích thước canvas gốc (ảnh lùi vào G px mỗi bên, viền kéo giãn chống
// loang mip). Mỗi mesh nhận geometry CLONE (UV đổi sang ô atlas) + material atlas dùng chung.
// Viền G px NẰM NGOÀI ảnh theo trục ngắn (<512: ô = n+2G, ảnh 1:1 không co) — G=8 an toàn tới mip 3 (phản biện: G=4 co
// ảnh vào trong → mờ chữ + biển kề nhau loang ở mip xa). Trục ≥512 giữ ô = cỡ gốc, ảnh co 2G (≤3%): nếu nới thì ảnh rộng
// 1024 thành 1040 → 1 ảnh/kệ 2048, trang 7 → 9.
const AT_PAGE = 2048, AT_G = 8;
// viền theo cỡ ảnh: ≥128 px → 8 (an toàn tới mip 3); ảnh nhỏ (64/32 px — ở mip 3 đã là đốm 4-8 texel) → 4/2, đỡ phình trang
const atG = (w, h) => Math.max(2, Math.min(AT_G, Math.floor(Math.min(w, h) / 16)));
function atlasKept(kept, createdTex, THREE) {
  const plain = (q) => q && !Array.isArray(q) && (q.isMeshLambertMaterial || q.isMeshBasicMaterial) && q.map && createdTex.has(q.map) &&
    !q.transparent && !q.alphaTest && !q.vertexColors && q.color && q.color.getHex() === 0xffffff &&
    (!q.emissive || q.emissive.getHex() === 0) && !q.emissiveMap && !q.alphaMap && !q.aoMap && !q.lightMap && !q.bumpMap && !q.normalMap &&
    q.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    q.map.repeat.x === 1 && q.map.repeat.y === 1 && q.map.offset.x === 0 && q.map.offset.y === 0 && q.map.rotation === 0 &&
    q.map.flipY === true && q.map.image && q.map.image.width <= 512 && q.map.image.height <= 512;
  const uvOK = new WeakMap();
  const uvIn01 = (g) => {
    if (uvOK.has(g)) return uvOK.get(g);
    const uv = g.attributes && g.attributes.uv; let ok = !!uv && uv.itemSize === 2;
    if (ok) for (let i = 0; i < uv.count && ok; i++) { const u = uv.getX(i), v = uv.getY(i); if (u < -1e-3 || u > 1.001 || v < -1e-3 || v > 1.001) ok = false; }
    uvOK.set(g, ok); return ok;
  };
  const meshes = [], texs = new Map();   // tex → ô
  for (const it of kept) it.o.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || !plain(m.material) || !m.geometry || !uvIn01(m.geometry)) return;
    meshes.push(m); if (!texs.has(m.material.map)) texs.set(m.material.map, null);
  });
  if (texs.size < 8) return { pages: 0, textures: 0, meshes: 0 };
  // xếp kệ (shelf) theo chiều cao giảm dần
  const list = [...texs.keys()].sort((a, b) => b.image.height - a.image.height || b.image.width - a.image.width);
  const pages = []; let pg = null, x = 0, y = 0, rowH = 0;
  for (const t of list) {
    const G = atG(t.image.width, t.image.height);
    const ax = (n) => (n >= 512 ? n : n + 2 * G);
    const w = ax(t.image.width), h = ax(t.image.height);   // ô gồm viền
    if (!pg || x + w > AT_PAGE) { x = 0; y += rowH; rowH = 0; }
    if (!pg || y + h > AT_PAGE) { pg = { items: [] }; pages.push(pg); x = 0; y = 0; rowH = 0; }
    texs.set(t, { pg: pages.length - 1, x, y, w, h, G }); pg.items.push(t);
    x += w; rowH = Math.max(rowH, h);
  }
  const ref = list[0];
  const pageTex = pages.map((p, k) => {
    let H = 0; for (const t of p.items) { const c = texs.get(t); H = Math.max(H, c.y + c.h); }
    H = Math.min(AT_PAGE, 1 << Math.ceil(Math.log2(Math.max(64, H))));
    const cv = document.createElement('canvas'); cv.width = AT_PAGE; cv.height = H; p.H = H;
    const g = cv.getContext('2d');
    for (const t of p.items) {
      const c = texs.get(t);
      g.drawImage(t.image, c.x, c.y, c.w, c.h);                                     // nền ô = ảnh kéo giãn ra viền (chống loang)
      g.drawImage(t.image, c.x + c.G, c.y + c.G, c.w - 2 * c.G, c.h - 2 * c.G);  // ảnh thật 1:1 ở giữa (c.w-2G = w gốc)
    }
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = ref.colorSpace; tx.anisotropy = ref.anisotropy; tx.name = 'cellAtlas' + k;
    return tx;
  });
  const mats = new Map(), geoCache = new Map();
  for (const m of meshes) {
    const q = m.material, c = texs.get(q.map), P = pages[c.pg];
    const mk = (q.isMeshBasicMaterial ? 'B' : 'L') + '|' + q.side + '|' + c.pg + '|' + q.flatShading + '|' + q.depthWrite + '|' + q.polygonOffset + '|' + q.polygonOffsetFactor + '|' + q.polygonOffsetUnits;
    let am = mats.get(mk);
    if (!am) {
      am = q.isMeshBasicMaterial ? new THREE.MeshBasicMaterial({ map: pageTex[c.pg] }) : new THREE.MeshLambertMaterial({ map: pageTex[c.pg] });
      am.side = q.side; am.flatShading = q.flatShading; am.depthWrite = q.depthWrite;
      am.polygonOffset = q.polygonOffset; am.polygonOffsetFactor = q.polygonOffsetFactor; am.polygonOffsetUnits = q.polygonOffsetUnits;
      am.name = 'cellAtlas'; mats.set(mk, am);
    }
    const gk = m.geometry.uuid + '|' + q.map.uuid;
    let ng = geoCache.get(gk);
    if (!ng) {
      ng = m.geometry.clone(); const uv = ng.attributes.uv;
      const u0 = (c.x + c.G) / AT_PAGE, us = (c.w - 2 * c.G) / AT_PAGE;
      const v0 = 1 - (c.y + c.h - c.G) / P.H, vs = (c.h - 2 * c.G) / P.H;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * us, v0 + uv.getY(i) * vs);
      uv.needsUpdate = true; geoCache.set(gk, ng);
    }
    m.geometry = ng; m.material = am;
  }
  const sizes = {}; for (const t of list) { const k = t.image.width + 'x' + t.image.height; sizes[k] = (sizes[k] || 0) + 1; }
  return { pages: pages.length, textures: list.length, meshes: meshes.length, materials: mats.size, pageH: pages.map((p) => p.H), sizes };
}

// khoảng cách footprint thật b ↔ bao lồi H (0 nếu giao)
function polyHullDist(D, G, b, H) {
  const s = D.vStart[b], e = D.vStart[b + 1];
  for (const [x, z] of H) if (G.inside(b, x, z)) return 0;
  for (let v = s; v < e; v++) if (inConvex(H, D.x[v], D.z[v])) return 0;
  let d2 = Infinity;
  for (const [x, z] of H) for (let v = s, w = e - 1; v < e; w = v++) { const q = segD2(x, z, D.x[w], D.z[w], D.x[v], D.z[v]); if (q < d2) d2 = q; }
  for (let v = s; v < e; v++) for (let i = 0; i < H.length; i++) { const a = H[i], c = H[(i + 1) % H.length]; const q = segD2(D.x[v], D.z[v], a[0], a[1], c[0], c[1]); if (q < d2) d2 = q; }
  return Math.sqrt(d2);
}
// hộp claim: 1 hộp bao (nếu đặc) hoặc theo từng cụm ô liền (khuôn viên/dãy rời rạc)
function claimRects(it) {
  const r = minRect(it.H);
  if (!(r.area > 2.5 * it.keys.length && it.keys.length > 150)) return [r];
  const out = [], seen = new Set();
  for (const k0 of it.keys) {
    if (seen.has(k0)) continue;
    const comp = [], st = [k0]; seen.add(k0);
    while (st.length) {
      const k = st.pop(); comp.push(k); const x = KX(k), z = KZ(k);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const kk = KEY(x + dx, z + dz); if (it.S.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } }
    }
    if (comp.length < 12) continue;
    out.push(minRect(hull(comp.map((k) => [KX(k) + 0.5, KZ(k) + 0.5]))));
  }
  return out.length ? out : [r];
}
// thuộc tính nhà ô bị gỡ → world.cellShops (để WP2/lớp mặt tiền tô lại footprint thật: chữ biển, màu, tầng, kiểu)
function shopAttrs(it, recordTexts) {
  const signs = new Set(); let wall = null, wallA = 0, roof = null;
  it.o.traverse((m) => {
    if (!m.material) return;
    for (const q of (Array.isArray(m.material) ? m.material : [m.material])) {
      if (q && q.map && recordTexts) recordTexts(q.map);
      if (q.map && q.map.userData && q.map.userData.signTexts) for (const t of q.map.userData.signTexts) if (t && t.trim()) signs.add(t.trim());
    }
  });
  const colOf = (q) => {
    const mm = Array.isArray(q.m.material) ? q.m.material[0] : q.m.material;
    if (!mm) return null;
    return mm.map && mm.map.userData && mm.map.userData.base ? mm.map.userData.base
      : (mm.color && !mm.vertexColors ? '#' + mm.color.getHexString() : null);
  };
  for (const q of it.shape.meshes) if (q.massive && q.area > wallA) { const c = colOf(q); if (c) { wallA = q.area; wall = c; } }
  // mái = mặt phủ cao nhất (≥25% diện tích thân, không phải tán cây/kính mờ)
  let roofY = -1e9;
  for (const q of it.shape.meshes) {
    if (q.leafy || q.line || q.inst || q.area < 0.25 * wallA || q.y1 <= roofY) continue;
    const c = colOf(q); if (c) { roofY = q.y1; roof = c; }
  }
  const r = minRect(it.H);
  const ry = it.o.rotation ? it.o.rotation.y : 0;
  return {
    name: it.name, x: +it.cx.toFixed(1), z: +it.cz.toFixed(1), ry: +ry.toFixed(3),
    w: +(2 * Math.max(r.hx, r.hz) + 1).toFixed(1), d: +(2 * Math.min(r.hx, r.hz) + 1).toFixed(1),
    h: +it.height.toFixed(1), floors: Math.max(1, Math.round((it.height - 0.6) / 3.3)),
    wall, roof, signs: [...signs].slice(0, 6), style: styleHint(it.name), realB: it.realB, frac: +it.frac.toFixed(2), why: it.removed,
  };
}
function dumpReport(items, cols, fcs, stats, ms) {
  return {
    mode: 'dump', ms,
    items: items.map((it) => ({
      i: it.i, seq: it.seq, src: it.src, name: it.name, type: it.o.type, kind: it.kind, bldg: it.bldg,
      tris: it.shape ? Math.round(it.shape.tris) : 0,
      y0: it.shape ? +it.shape.y0.toFixed(2) : 0, y1: it.shape ? +it.shape.y1.toFixed(2) : 0,
      cells: it.S ? it.S.size : 0, height: it.height ? +it.height.toFixed(1) : 0,
      kids: [...new Set(collectNames(it.o))].slice(0, 12),
      meshes: it.shape ? it.shape.meshes.map((q) => ({ n: q.m.name || '', h: q.h.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]), y0: +q.y0.toFixed(2), y1: +q.y1.toFixed(2), t: Math.round(q.tris), i: q.inst ? 1 : 0, x: q.tex ? 1 : 0, l: q.line ? 1 : 0, ms: q.massive ? 1 : 0 })) : [],
    })),
    cols: cols.map(({ c, seq }) => [seq, +c.x.toFixed(2), +c.z.toFixed(2), +c.r.toFixed(2)]),
    fcs: fcs.map(({ e, seq }) => [seq, +e[0].toFixed(2), +e[1].toFixed(2), +e[2].toFixed(2)]),
    stats,
  };
}
function collectNames(o) { const out = []; o.traverse((c) => { if (c !== o && c.name) out.push(c.name); }); return out; }
