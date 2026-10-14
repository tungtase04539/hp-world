// parcels.js — TƯỜNG RÀO / HÀNG RÀO SẮT / RÀO TÔN / TƯỜNG LÔ + CỔNG mặt phố (Đợt 3 wave 3 W3-B "PARCELS").
// Dữ liệu: RB_PARCELS trong js/buildings_real.js (SINH bởi tools/process_buildings.mjs bước 7 + tools/parcels_ev.mjs):
//   walls: [kind, màu, x0, z0, x1, z1, …] — polyline ở facadeLine + 0,3 m (mép sau vỉa hè), SÂN/LÔ ở bên TRÁI hướng polyline
//          (pháp tuyến vào trong = (−uz, ux)); kind: 0 tường rào xây trát, 1 hàng rào sắt trên tường lửng, 2 rào tôn,
//          3 tường lô đất trống (bê tông/gạch)
//   gates: [x, z, góc, bề rộng, kind, chòi gác 0/1, theo tia pano 0/1] — cổng sắt 2 trụ (tường bị cắt khe đúng chỗ cổng)
// Ô đất kiểu (b) KHUÔN VIÊN / (c) ĐẤT TRỐNG của KNOWLEDGE §8b: generator không còn bịa nhà ống vào đó → ở đây dựng mặt
// phố thật của chúng. Lúc chạy cắt bỏ đoạn tường rơi vào nhà THẬT còn sống (rbGrid — claims/cell sink có thể đổi), bao
// nhà ô dựng tay giữ lại (world.cellKept) hoặc nước.
// HIỆU NĂNG: 2 material (tường đặc: vertex colour × texture hàng (plaster/tôn/bê tông/gạch); song sắt/cổng: alphaTest) →
// 2 mesh cho cả thành phố (+ lượt bóng tường đặc). userData.noMerge (freezeStatic không gộp — gộp làm mất uv).
// Va chạm: lưới đoạn 24 m → collide(p, r) đẩy điểm ra khỏi tường (world.resolveCollisions bọc thêm ở world.js).
// Xác định: mọi biến thể theo hash toạ độ.
import * as THREE from 'three';
// namespace import: thiếu export RB_PARCELS (buildings_real.js của nhánh khác / chưa sinh lại khi gộp) → undefined, không phải
// SyntaxError lúc liên kết làm trắng cả trang (review lượt 4)
import * as RBM from './buildings_real.js';
import { claimAt } from './claims.js';

export const PWALL = { MASONRY: 0, FENCE: 1, HOARD: 2, LOTWALL: 3 };
const OPEN_CLAIMS = ['plaza', 'park'];
// màu (sRGB): 0 vàng Hải Phòng, 1 trắng kem, 2 xám bê tông, 3 xanh nhạt, 4 gạch đỏ, 5 tôn xanh dương, 6 tôn xanh lá,
// 7 tôn đỏ, 8 tôn kẽm xám gỉ
const COLS = [0xe2c682, 0xe9e5d8, 0xc6c2b8, 0xb3c4ab, 0xb06b55, 0x6a95bf, 0x72a07b, 0xb35444, 0xcfd2cf];
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

// ---------- texture: 4 HÀNG (v) lặp theo u — 0 vữa trát, 1 tôn sóng, 2 bê tông tấm, 3 gạch/tường cũ ----------
const ROWS = 4;
function solidTexture() {
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const RH = H / ROWS;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // nền gần TRẮNG (màu thật = vertex colour × texture; texture chỉ mang hạt/vệt — trung bình ≈ 0,93 sRGB. Bản đầu nền e8 + hạt
  // 200-250 → tường lô xám trong bóng chỉ 38/255, tối hơn hẳn mặt tiền nhà cùng hướng 70-115: ánh sáng vật lý, bóng chỉ có trời)
  g.fillStyle = '#f3f3f3'; g.fillRect(0, 0, W, H);
  // 0 VỮA TRÁT: hạt + vệt nước mưa chảy từ đỉnh + chân tường ố bẩn
  { const y0 = 0;
    for (let i = 0; i < 2500; i++) { const v = 218 + rnd() * 37; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * W, y0 + rnd() * RH, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 14; i++) { const x = rnd() * W, w = 3 + rnd() * 9, h = RH * (0.15 + rnd() * 0.45); const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, 'rgba(70,65,55,0.32)'); gr.addColorStop(1, 'rgba(70,65,55,0)'); g.fillStyle = gr; g.fillRect(x, y0 + 4, w, h); }
    const gb = g.createLinearGradient(0, y0 + RH * 0.7, 0, y0 + RH); gb.addColorStop(0, 'rgba(60,55,45,0)'); gb.addColorStop(1, 'rgba(60,55,45,0.45)'); g.fillStyle = gb; g.fillRect(0, y0 + RH * 0.7, W, RH * 0.3);
    g.fillStyle = 'rgba(40,40,40,0.25)'; g.fillRect(0, y0, W, 3); }
  // 1 TÔN SÓNG: gân dọc (bước 16 px = 1/16 ô), sáng/tối theo sóng + vệt gỉ chảy từ đinh vít
  { const y0 = RH;
    for (let x = 0; x < W; x++) { const s = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 16); const v = Math.round(196 + 58 * s); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y0, 1, RH); }
    for (let i = 0; i < 18; i++) { const x = rnd() * W, h = RH * (0.2 + rnd() * 0.6), y = y0 + rnd() * RH * 0.3; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(120,60,25,0.45)'); gr.addColorStop(1, 'rgba(120,60,25,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rnd() * 4, h); }
    g.fillStyle = 'rgba(30,30,30,0.35)'; for (const yy of [0.06, 0.94]) g.fillRect(0, y0 + RH * yy, W, 2);
    const gb = g.createLinearGradient(0, y0 + RH * 0.8, 0, y0 + RH); gb.addColorStop(0, 'rgba(70,60,45,0)'); gb.addColorStop(1, 'rgba(70,60,45,0.4)'); g.fillStyle = gb; g.fillRect(0, y0 + RH * 0.8, W, RH * 0.2); }
  // 2 BÊ TÔNG TẤM: mạch ngang/dọc + mảng ố loang + rêu chân
  { const y0 = 2 * RH;
    for (let i = 0; i < 3000; i++) { const v = 212 + rnd() * 40; g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(rnd() * W, y0 + rnd() * RH, 1 + rnd() * 3, 1 + rnd() * 2); }
    for (let i = 0; i < 10; i++) { const r = 10 + rnd() * 40; const x = rnd() * W, y = y0 + rnd() * RH; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,62,55,0.18)'); gr.addColorStop(1, 'rgba(60,62,55,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    g.fillStyle = 'rgba(50,50,50,0.4)'; g.fillRect(0, y0 + RH * 0.5, W, 2); g.fillRect(W / 2, y0, 2, RH); g.fillRect(0, y0, 2, RH);
    const gb = g.createLinearGradient(0, y0 + RH * 0.75, 0, y0 + RH); gb.addColorStop(0, 'rgba(50,70,40,0)'); gb.addColorStop(1, 'rgba(50,70,40,0.5)'); g.fillStyle = gb; g.fillRect(0, y0 + RH * 0.75, W, RH * 0.25); }
  // 3 GẠCH / tường cũ: hàng gạch 8 px + mảng vữa bong
  { const y0 = 3 * RH;
    for (let r = 0; r < RH / 8; r++) for (let k = -1; k < W / 24 + 1; k++) { const v = 200 + rnd() * 50; g.fillStyle = `rgb(${v},${v - 8},${v - 14})`; g.fillRect(k * 24 + (r % 2) * 12 + 1, y0 + r * 8 + 1, 22, 6); }
    for (let i = 0; i < 8; i++) { const x = rnd() * W, y = y0 + rnd() * RH, w = 20 + rnd() * 50, h = 10 + rnd() * 30; g.fillStyle = 'rgba(225,222,212,0.8)'; g.fillRect(x, y, w, h); } }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.name = 'parcel_solid';
  return t;
}
// song sắt (hàng 0) + cánh cổng (hàng 1): alpha; u lặp
function railTexture() {
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  // hàng 0 (v 0..0.5): 4 thanh đứng / ô (ô = 0,6 m) + 2 đố ngang + mũi giáo
  { const RH = H / 2;
    for (let i = 0; i < 4; i++) { const x = i * 32 + 14; g.fillRect(x, 10, 4, RH - 14); g.beginPath(); g.moveTo(x - 3, 12); g.lineTo(x + 2, 2); g.lineTo(x + 7, 12); g.fill(); }
    g.fillRect(0, 22, W, 5); g.fillRect(0, RH - 14, W, 5); }
  // hàng 1 (v 0.5..1): cánh cổng — khung + song dày + tấm dưới đặc + hoa văn tròn
  { const y0 = H / 2, RH = H / 2;
    g.fillRect(0, y0 + 4, W, 6); g.fillRect(0, y0 + RH - 8, W, 6); g.fillRect(0, y0 + RH * 0.62, W, 5);
    for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 6, y0 + 4, 3, RH - 8);
    g.fillRect(0, y0 + RH * 0.66, W, RH * 0.3);
    g.lineWidth = 3; g.strokeStyle = '#ffffff';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i * 32 + 16, y0 + 30, 9, 0, Math.PI * 2); g.stroke(); } }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace; t.name = 'parcel_rail';
  return t;
}

// ---------- bộ dựng hình học ----------
class GB {
  // mảng ĐỊNH KIỂU tự nới ×2 (không tạo hàng trăm nghìn mảng nhỏ): pos f32×3, normal i8n×3, uv f32×2, color u8n×3 (TUYẾN TÍNH)
  constructor() { this.nv = 0; this.ni = 0; this.alloc(4096, 6144); }
  alloc(nv, ni) {
    const P = new Float32Array(nv * 3), N = new Int8Array(nv * 3), U = new Float32Array(nv * 2), C = new Uint8Array(nv * 3), I = new Uint32Array(ni);
    if (this.P) { P.set(this.P.subarray(0, this.nv * 3)); N.set(this.N.subarray(0, this.nv * 3)); U.set(this.U.subarray(0, this.nv * 2)); C.set(this.C.subarray(0, this.nv * 3)); I.set(this.I.subarray(0, this.ni)); }
    Object.assign(this, { P, N, U, C, I, cv: nv, ci: ni });
  }
  get count() { return this.nv; }
  // tứ giác a,b,c,d (vòng quanh mép); thứ tự tam giác tự chọn để MẶT TRƯỚC (CCW) quay theo pháp tuyến nrm
  quad(a, b, c, d, nrm, uvs, col) {
    if (this.nv + 4 > this.cv || this.ni + 6 > this.ci) this.alloc(this.cv * 2, this.ci * 2);
    const o = this.nv, P = this.P, N = this.N, U = this.U, C = this.C;
    const cr = Math.round(Math.min(1, col.r) * 255), cg = Math.round(Math.min(1, col.g) * 255), cb = Math.round(Math.min(1, col.b) * 255);
    const nx = Math.round(nrm[0] * 127), ny = Math.round(nrm[1] * 127), nz = Math.round(nrm[2] * 127);
    const V = [a, b, c, d];
    for (let k = 0; k < 4; k++) {
      const v = V[k], j = (o + k) * 3;
      P[j] = v[0]; P[j + 1] = v[1]; P[j + 2] = v[2];
      N[j] = nx; N[j + 1] = ny; N[j + 2] = nz;
      C[j] = cr; C[j + 1] = cg; C[j + 2] = cb;
      U[(o + k) * 2] = uvs[k][0]; U[(o + k) * 2 + 1] = uvs[k][1];
    }
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const I = this.I, i = this.ni;
    if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] >= 0) { I[i] = o; I[i + 1] = o + 1; I[i + 2] = o + 2; I[i + 3] = o; I[i + 4] = o + 2; I[i + 5] = o + 3; }
    else { I[i] = o; I[i + 1] = o + 2; I[i + 2] = o + 1; I[i + 3] = o; I[i + 4] = o + 3; I[i + 5] = o + 2; }
    this.nv += 4; this.ni += 6;
  }
  // hộp định hướng: tâm chân (cx, y0, cz), trục u = (ux,uz), dài L, dày T, cao từ y0 tới y1; faces: bỏ đáy
  box(cx, cz, ux, uz, L, T, y0, y1, col, row, uScale = 1, skipEnds = false) {
    const vx = -uz, vz = ux, hl = L / 2, ht = T / 2;
    const P = (s, t, y) => [cx + ux * s + vx * t, y, cz + uz * s + vz * t];
    const v0 = rowV(row, 0), v1 = rowV(row, 1), hU = L / uScale, tU = T / uScale;
    // mặt +v (trong) và −v (ngoài phố)
    this.quad(P(hl, ht, y0), P(-hl, ht, y0), P(-hl, ht, y1), P(hl, ht, y1), [vx, 0, vz], [[0, v0], [hU, v0], [hU, v1], [0, v1]], col);
    this.quad(P(-hl, -ht, y0), P(hl, -ht, y0), P(hl, -ht, y1), P(-hl, -ht, y1), [-vx, 0, -vz], [[0, v0], [hU, v0], [hU, v1], [0, v1]], col);
    // nóc
    const vt0 = rowV(row, 0.02), vt1 = rowV(row, 0.04);
    this.quad(P(-hl, -ht, y1), P(hl, -ht, y1), P(hl, ht, y1), P(-hl, ht, y1), [0, 1, 0], [[0, vt0], [hU, vt0], [hU, vt1], [0, vt1]], col);
    if (!skipEnds) {
      this.quad(P(hl, -ht, y0), P(hl, ht, y0), P(hl, ht, y1), P(hl, -ht, y1), [ux, 0, uz], [[0, v0], [tU, v0], [tU, v1], [0, v1]], col);
      this.quad(P(-hl, ht, y0), P(-hl, -ht, y0), P(-hl, -ht, y1), P(-hl, ht, y1), [-ux, 0, -uz], [[0, v0], [tU, v0], [tU, v1], [0, v1]], col);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, this.nv * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, this.nv * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, this.nv * 3), 3, true));
    g.setIndex(new THREE.BufferAttribute(this.I.slice(0, this.ni), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
// v trong hàng texture (lề 2% chống loang mip giữa các hàng); f: 0 = chân, 1 = đỉnh
const rowV = (row, f) => 1 - (row + 0.03 + 0.94 * (1 - f)) / ROWS;   // CanvasTexture flipY: hàng 0 ở TRÊN ảnh = v cao
const railV = (row, f) => 1 - (row + 0.02 + 0.96 * (1 - f)) / 2;

const lin = (hex, k = 1) => { const c = new THREE.Color(hex).convertSRGBToLinear(); c.r *= k; c.g *= k; c.b *= k; return c; };

export function buildParcels(scene, ctx = {}) {
  const t0 = performance.now();
  const P = RBM.RB_PARCELS || { walls: [], gates: [] };
  const gh = ctx.groundHeightNoDeck || (() => ctx.landH || 2);
  const D = ctx.D, G = ctx.grid;
  // lưới ô 16 m dùng chung (chỉ mục bbox → danh sách)
  const GCS = 16, gkey = (i, j) => i * 100003 + j;
  const gridAdd = (M, x0, z0, x1, z1, id) => { for (let i = Math.floor(x0 / GCS); i <= Math.floor(x1 / GCS); i++) for (let j = Math.floor(z0 / GCS); j <= Math.floor(z1 / GCS); j++) { const k = gkey(i, j); let a = M.get(k); if (!a) M.set(k, (a = [])); a.push(id); } };
  const gridGet = (M, x, z) => M.get(gkey(Math.floor(x / GCS), Math.floor(z / GCS)));
  const kept = (ctx.cellKept || []).filter((k) => k.hull && k.hull.length >= 3).map((k) => {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of k.hull) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { hull: k.hull, x0, z0, x1, z1 };
  });
  const keptGrid = new Map(); kept.forEach((k, i) => gridAdd(keptGrid, k.x0, k.z0, k.x1, k.z1, i));
  const pip = (R, x, z) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const st = { runs: 0, gates: 0, booths: 0, len: [0, 0, 0, 0], cutLive: 0, cutCell: 0, cutWater: 0, cutThin: 0, cutClaim: 0, cutRoad: 0, thin: 0, tris: 0 };
  const surf = ctx.surfaceAt || null;
  // ô 16 m có tường dữ liệu đi qua (lọc nhanh khi quét cảnh)
  const wallCells = new Set();
  for (const w of P.walls || []) for (let i = 2; i + 1 < w.length; i += 2) {
    const x = w[i], z = w[i + 1];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) wallCells.add(gkey(Math.floor(x / GCS) + di, Math.floor(z / GCS) + dj));
    if (i + 3 < w.length) { const L = Math.hypot(w[i + 2] - x, w[i + 3] - z), n = Math.ceil(L / 8); for (let k = 1; k < n; k++) { const xx = x + (w[i + 2] - x) * k / n, zz = z + (w[i + 3] - z) * k / n; wallCells.add(gkey(Math.floor(xx / GCS), Math.floor(zz / GCS))); } }
  }
  // TƯỜNG/RÀO/CỔNG DỰNG TAY đã có (ô cells, khối địa danh W2-E…): mọi mesh MỎNG (bề hẹp ≤ 1,2 m), DÀI (≥ 2,5 m), THẤP (≤ 5 m)
  // chân sát đất — theo HÌNH HỌC, không theo tên (cb_wall_ltt tường mỏ neo pano_515…) → không dựng tường đôi. CHỈ thấy mesh đã
  // có trong scene lúc gọi (world.js ngay sau fabric): rào dựng SAU đó (vd lm_ubnd_fence ~world.js 20.5k) không được quét
  const thin = [], tgrid = new Map();
  const t1 = performance.now();
  if (ctx.scene !== false && wallCells.size) {
    const v = new THREE.Vector3();
    scene.updateMatrixWorld(true);   // 1 lượt O(n) thay vì updateWorldMatrix(cha…) từng mesh
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.parcels) return;
      if (/^(roads|sidewalk|ground|water|fab_|dashes|paths|aerial|night_|curb|median|tree|veg)/.test(o.name)) return;
      const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere; if (!bs || !isFinite(bs.radius)) return;
      v.copy(bs.center).applyMatrix4(o.matrixWorld);
      const sc = o.matrixWorld.getMaxScaleOnAxis(), rad = bs.radius * sc;
      if (rad > 60) return;   // mesh lớn (gộp/khối) — không phải tấm tường lẻ
      let near = false;
      for (let i = Math.floor((v.x - rad) / GCS); i <= Math.floor((v.x + rad) / GCS) && !near; i++) for (let j = Math.floor((v.z - rad) / GCS); j <= Math.floor((v.z + rad) / GCS); j++) if (wallCells.has(gkey(i, j))) { near = true; break; }
      if (!near) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox; if (!isFinite(bb.min.x)) return;
      const cs = [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z], [bb.min.x, bb.max.z]].map(([x, z]) => { v.set(x, bb.min.y, z).applyMatrix4(o.matrixWorld); return [v.x, v.z, v.y]; });
      v.set(bb.min.x, bb.max.y, bb.min.z).applyMatrix4(o.matrixWorld);
      const hgt = v.y - cs[0][2];
      const e1 = Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]), e2 = Math.hypot(cs[2][0] - cs[1][0], cs[2][1] - cs[1][1]);
      if (Math.min(e1, e2) > 1.2 || Math.max(e1, e2) < 2.5 || hgt > 5 || hgt < 0.4) return;
      if (cs[0][2] > gh(cs[0][0], cs[0][1]) + 1.2) return;   // không chạm đất (biển, mái hiên)
      const q = cs.map((c) => [c[0], c[1]]);
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      thin.push(q);
      gridAdd(tgrid, x0 - 1.5, z0 - 1.5, x1 + 1.5, z1 + 1.5, thin.length - 1);
    });
    st.thin = thin.length;
  }
  st.msThin = Math.round((performance.now() - t1) * 10) / 10;
  const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9; let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
  function nearThin(x, z, r) {
    const a = gridGet(tgrid, x, z); if (!a) return false;
    for (const k of a) { const q = thin[k]; if (pip(q, x, z)) return true; for (let i = 0; i < 4; i++) if (segD(x, z, q[i][0], q[i][1], q[(i + 1) % 4][0], q[(i + 1) % 4][1]) < r) return true; }
    return false;
  }
  // điểm tường bị chặn: nhà thật còn sống, nhà ô giữ lại, nước/đất trũng, ngoài bán kính dựng
  const LAND = ctx.landH ?? 2, maxR = ctx.maxR || 1e9;
  function blocked(x, z) {
    if (x * x + z * z > maxR * maxR) return 1;
    if (G && D) { const b = G.at(x, z); if (b >= 0 && !(D.dead && D.dead[b])) { st.cutLive++; return 2; } }
    const ka = gridGet(keptGrid, x, z);
    if (ka) for (const i of ka) { const k = kept[i]; if (x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1 && pip(k.hull, x, z)) { st.cutCell++; return 3; } }
    const g = gh(x, z); if (!(Math.abs(g - LAND) < 1.6)) { st.cutWater++; return 4; }
    if (thin.length && nearThin(x, z, 1.4)) { st.cutThin++; return 5; }
    // vùng giữ chỗ QUẢNG TRƯỜNG / CÔNG VIÊN lúc chạy (claims.js — bãi Cầu Đất, Lê Chân, road#9, Bến Bính…; generator không
    // biết) → để thoáng (review lượt 4: rào + cổng dọc bãi đỗ Cầu Đất pano_420)
    if (claimAt(x, z, OPEN_CLAIMS)) { st.cutClaim++; return 6; }
    // mặt đường / vỉa hè (đường W3-A đổi sau khi sinh dữ liệu) → bỏ mẫu
    if (surf && surf(x, z) > 0.12) { st.cutRoad++; return 7; }
    return 0;
  }
  // cổng theo dãy (khe trong tường)
  const gateList = (P.gates || []).map((a) => ({ x: a[0], z: a[1], ang: a[2], w: a[3], kind: a[4], booth: a[5], ev: a[6], col: a[7] | 0 }));
  const solid = new GB(), rail = new GB();
  const segs = [];   // va chạm [ax, az, bx, bz, halfT]
  const gateGrid = new Map(); gateList.forEach((g, i) => gridAdd(gateGrid, g.x - g.w, g.z - g.w, g.x + g.w, g.z + g.w, i));
  const gateHit = (x, z) => { const a = gridGet(gateGrid, x, z); if (a) for (const i of a) { const g = gateList[i]; if (Math.hypot(x - g.x, z - g.z) < g.w / 2 + 0.55) return g; } return null; };
  const t2 = performance.now();
  for (const w of P.walls || []) {
    const kind = w[0], col = w[1], pts = [];
    for (let i = 2; i + 1 < w.length; i += 2) pts.push([w[i], w[i + 1]]);
    // LẤY MẪU ~0,8 m dọc polyline → đoạn liên tục không bị chặn, không trùng khe cổng
    const pieces = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, n = Math.max(1, Math.ceil(L / 0.8));
      // điểm thử lùi vào trong 0,15 m (tường đứng trên mép sau vỉa hè; nhà thật sát vạch thì cạnh nhà ở phía trong)
      const badAt = (s) => { const x = ax + ux * s, z = az + uz * s; return blocked(x - uz * 0.15, z + ux * 0.15) || gateHit(x, z); };
      // ranh tốt/xấu giữa 2 mẫu → chia đôi 4 lần (±5 cm): tường áp sát trụ cổng / tường nhà, không hở khe tới 0,8 m
      const edge = (good, bad) => { for (let it = 0; it < 4; it++) { const m = (good + bad) / 2; if (badAt(m)) bad = m; else good = m; } return good; };
      let cur = null, prevS = 0, prevBad = false;
      for (let k = 0; k <= n; k++) {
        const s = (L * k) / n;
        const bad = badAt(s);
        if (bad) { if (cur) { cur.s1 = edge(cur.s1, s); pieces.push(cur); cur = null; } prevBad = true; prevS = s; continue; }
        if (!cur) cur = { ax, az, ux, uz, s0: k > 0 && prevBad ? edge(s, prevS) : s, s1: s }; else cur.s1 = s;
        prevBad = false; prevS = s;
      }
      if (cur) pieces.push(cur);
    }
    let any = false;
    for (const pc of pieces) {
      const L = pc.s1 - pc.s0; if (L < 1.2) continue;
      any = true; st.len[kind] += L;
      emitWall(kind, col, pc.ax + pc.ux * pc.s0, pc.az + pc.uz * pc.s0, pc.ux, pc.uz, L);
    }
    if (any) st.runs++;
  }
  for (const g of gateList) {
    // cổng: 2 trụ + 2 cánh — chỉ khi 2 trụ không bị chặn
    const ux = Math.cos(g.ang), uz = Math.sin(g.ang);
    const pa = [g.x - ux * (g.w / 2 + 0.28), g.z - uz * (g.w / 2 + 0.28)], pb = [g.x + ux * (g.w / 2 + 0.28), g.z + uz * (g.w / 2 + 0.28)];
    if (blocked(pa[0] - uz * 0.15, pa[1] + ux * 0.15) || blocked(pb[0] - uz * 0.15, pb[1] + ux * 0.15) || blocked(g.x - uz * 0.15, g.z + ux * 0.15)) continue;
    emitGate(g, ux, uz);
    st.gates++;
  }

  function emitWall(kind, colCode, ax, az, ux, uz, L) {
    const h = hash(ax * 0.37, az * 0.53);
    const col = colCode & 15, railCol = colCode >> 4;   // màu tường/trụ | màu song sắt << 4 (tools/parcels_ev.mjs)
    const C = lin(COLS[col] ?? COLS[0], 0.92 + 0.12 * h), Cd = lin(COLS[col] ?? COLS[0], 0.72), Cg = lin(0x8d8a82, 0.85);
    const at = (s) => [ax + ux * s, az + uz * s];
    const y = (x, z) => gh(x, z);
    if (kind === PWALL.MASONRY || kind === PWALL.LOTWALL) {
      const H = kind === PWALL.MASONRY ? 2.1 + 0.4 * h : 2.4 + 0.4 * h, T = kind === PWALL.MASONRY ? 0.22 : 0.2;
      const row = kind === PWALL.MASONRY ? 0 : (h < 0.6 ? 2 : 3), CC = kind === PWALL.LOTWALL ? lin(COLS[col] ?? COLS[2], 0.94 + 0.1 * h) : C;
      const bay = kind === PWALL.MASONRY ? 3.2 : 3.6, nb = Math.max(1, Math.round(L / bay)), bw = L / nb;
      for (let k = 0; k < nb; k++) {
        const [cx, cz] = at((k + 0.5) * bw), g0 = y(cx, cz);
        solid.box(cx, cz, ux, uz, bw, T, g0 - 0.3, g0 + H, CC, row, 3.0, true);
        if (kind === PWALL.MASONRY) solid.box(cx, cz, ux, uz, bw, T + 0.1, g0 + H, g0 + H + 0.08, Cd, 0, 3.0, true);   // gờ mũ tường
        segs.push([cx - ux * bw / 2, cz - uz * bw / 2, cx + ux * bw / 2, cz + uz * bw / 2, T / 2]);
      }
      for (let k = 0; k <= nb; k++) {   // trụ
        const [px, pz] = at(k * bw), g0 = y(px, pz), pw = kind === PWALL.MASONRY ? 0.42 : 0.3;
        solid.box(px, pz, ux, uz, pw, pw, g0 - 0.3, g0 + H + (kind === PWALL.MASONRY ? 0.22 : 0.05), kind === PWALL.MASONRY ? C : CC, row, 3.0);
        if (kind === PWALL.MASONRY) solid.box(px, pz, ux, uz, pw + 0.12, pw + 0.12, g0 + H + 0.22, g0 + H + 0.32, Cd, 0, 3.0);
      }
    } else if (kind === PWALL.FENCE) {
      const H0 = 0.55 + 0.15 * h, H1 = 1.85 + 0.25 * h, T = 0.26;
      const bay = 2.6, nb = Math.max(1, Math.round(L / bay)), bw = L / nb;
      const railC = railCol === 1 ? lin(0xe6e6df) : railCol === 2 ? lin(0x3f6a45) : h < 0.5 ? lin(0x1f2622) : lin(0x2c3a30);
      for (let k = 0; k < nb; k++) {
        const [cx, cz] = at((k + 0.5) * bw), g0 = y(cx, cz);
        solid.box(cx, cz, ux, uz, bw, T, g0 - 0.3, g0 + H0, C, 0, 3.0, true);                       // tường lửng
        solid.box(cx, cz, ux, uz, bw, T + 0.08, g0 + H0, g0 + H0 + 0.06, Cd, 0, 3.0, true);           // gờ
        // song sắt: 1 tấm 2 mặt (DoubleSide) ở giữa bề dày tường
        const vx = -uz, vz = ux, hl = bw / 2;
        const A = [cx - ux * hl, g0 + H0 + 0.06, cz - uz * hl], B2 = [cx + ux * hl, g0 + H0 + 0.06, cz + uz * hl];
        const Ct = [cx + ux * hl, g0 + H1, cz + uz * hl], Dd = [cx - ux * hl, g0 + H1, cz - uz * hl];
        const uU = bw / 0.6;
        rail.quad(A, B2, Ct, Dd, [-vx, 0, -vz], [[0, railV(0, 0)], [uU, railV(0, 0)], [uU, railV(0, 1)], [0, railV(0, 1)]], railC);
        segs.push([cx - ux * hl, cz - uz * hl, cx + ux * hl, cz + uz * hl, T / 2]);
      }
      for (let k = 0; k <= nb; k++) {
        const [px, pz] = at(k * bw), g0 = y(px, pz);
        solid.box(px, pz, ux, uz, 0.36, 0.36, g0 - 0.3, g0 + H1 + 0.1, C, 0, 3.0);
        solid.box(px, pz, ux, uz, 0.46, 0.46, g0 + H1 + 0.1, g0 + H1 + 0.2, Cd, 0, 3.0);
      }
    } else {   // RÀO TÔN
      const H = 2.3 + 0.4 * h, T = 0.06, bay = 2.4, nb = Math.max(1, Math.round(L / bay)), bw = L / nb;
      for (let k = 0; k < nb; k++) {
        const [cx, cz] = at((k + 0.5) * bw), g0 = y(cx, cz);
        const Ck = lin(COLS[col] ?? COLS[8], 0.92 + 0.16 * hash(cx, cz));
        solid.box(cx, cz, ux, uz, bw, T, g0 - 0.2, g0 + H, Ck, 1, 1.6, true);
        segs.push([cx - ux * bw / 2, cz - uz * bw / 2, cx + ux * bw / 2, cz + uz * bw / 2, 0.08]);
      }
      for (let k = 0; k <= nb; k++) {   // cột thép hộp phía trong
        const [px, pz] = at(k * bw), g0 = y(px, pz);
        solid.box(px - uz * 0.08, pz + ux * 0.08, ux, uz, 0.08, 0.08, g0 - 0.2, g0 + H + 0.05, Cg, 2, 3.0);
      }
    }
  }
  function emitGate(g, ux, uz) {
    const h = hash(g.x, g.z), wc = COLS[g.col & 15] ?? COLS[0], C = lin(wc, 0.95), Cd = lin(wc, 0.72);
    const g0 = gh(g.x, g.z), PH = 2.7 + 0.3 * h, hw = g.w / 2;
    for (const sd of [-1, 1]) {
      const px = g.x + ux * sd * (hw + 0.28), pz = g.z + uz * sd * (hw + 0.28);
      solid.box(px, pz, ux, uz, 0.56, 0.56, g0 - 0.3, g0 + PH, C, 0, 3.0);
      solid.box(px, pz, ux, uz, 0.7, 0.7, g0 + PH, g0 + PH + 0.12, Cd, 0, 3.0);
      solid.box(px, pz, ux, uz, 0.36, 0.36, g0 + PH + 0.12, g0 + PH + 0.42, C, 0, 3.0);   // chóp trụ
      segs.push([px - ux * 0.28, pz - uz * 0.28, px + ux * 0.28, pz + uz * 0.28, 0.28]);
    }
    // 2 cánh cổng sắt (khép), lùi vào 0,1 m
    const rcg = g.col >> 4, vx = -uz, vz = ux;
    const gc = rcg === 1 ? lin(0xdedfd8) : rcg === 2 ? lin(0x3f6a45) : h < 0.4 ? lin(0x23302a) : h < 0.7 ? lin(0x2a2a2c) : lin(0x41633f);
    const ox = g.x + vx * 0.1, oz = g.z + vz * 0.1, GH = 2.1;
    const A = [ox - ux * hw, g0, oz - uz * hw], B2 = [ox + ux * hw, g0, oz + uz * hw], Ct = [ox + ux * hw, g0 + GH, oz + uz * hw], Dd = [ox - ux * hw, g0 + GH, oz - uz * hw];
    const uU = g.w / 1.2;
    rail.quad(A, B2, Ct, Dd, [-vx, 0, -vz], [[0, railV(1, 0)], [uU, railV(1, 0)], [uU, railV(1, 1)], [0, railV(1, 1)]], gc);
    segs.push([ox - ux * hw, oz - uz * hw, ox + ux * hw, oz + uz * hw, 0.06]);
    if (g.booth) {   // chòi gác vàng bên trong cạnh cổng
      const bx = g.x + ux * (hw + 2.0) + vx * 1.6, bz = g.z + uz * (hw + 2.0) + vz * 1.6, gb = gh(bx, bz);
      solid.box(bx, bz, ux, uz, 1.8, 1.8, gb - 0.2, gb + 2.5, lin(0xe2c070), 0, 3.0);
      solid.box(bx, bz, ux, uz, 2.3, 2.3, gb + 2.5, gb + 2.65, lin(0x8b4a36), 0, 3.0);
      st.booths++;
    }
  }

  st.msWalls = Math.round((performance.now() - t2) * 10) / 10;
  const out = { meshes: [], stats: st, segs };
  if (solid.count) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: solidTexture() });
    mat.name = 'parcel_solid';
    const m = new THREE.Mesh(solid.geometry(), mat);
    m.name = 'parcel_walls'; m.castShadow = true; m.receiveShadow = true; m.userData.noMerge = true; m.userData.parcels = 1;
    scene.add(m); out.meshes.push(m);
    st.tris += solid.ni / 3;
  }
  if (rail.count) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: railTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    mat.name = 'parcel_rail';
    const m = new THREE.Mesh(rail.geometry(), mat);
    m.name = 'parcel_rails'; m.castShadow = false; m.receiveShadow = true; m.userData.noMerge = true; m.userData.parcels = 1;
    scene.add(m); out.meshes.push(m);
    st.tris += rail.ni / 3;
  }
  // ---- va chạm: lưới 24 m trên đoạn ----
  const CS = 24, grid = new Map(), key = (i, j) => i * 100003 + j;
  segs.forEach((s, k) => {
    const pad = s[4] + 1;
    for (let i = Math.floor((Math.min(s[0], s[2]) - pad) / CS); i <= Math.floor((Math.max(s[0], s[2]) + pad) / CS); i++)
      for (let j = Math.floor((Math.min(s[1], s[3]) - pad) / CS); j <= Math.floor((Math.max(s[1], s[3]) + pad) / CS); j++) {
        const kk = key(i, j); let a = grid.get(kk); if (!a) grid.set(kk, (a = [])); a.push(k);
      }
  });
  // đoạn đăng ký với lề nửa dày + 1 m → 1 ô đủ cho bán kính ≤ 1 m (người/xe máy); bán kính lớn hơn (thuyền 1,6…) quét
  // các ô chạm đĩa p ± (pr + 0,1) (review lượt 3: trước chỉ tra ô của tâm → sót đoạn bên kia biên ô)
  const _seen = new Set();
  const cellSegs = (p, pr) => {
    if (pr <= 1) return grid.get(key(Math.floor(p.x / CS), Math.floor(p.z / CS)));
    const r = pr + 0.1, i0 = Math.floor((p.x - r) / CS), i1 = Math.floor((p.x + r) / CS), j0 = Math.floor((p.z - r) / CS), j1 = Math.floor((p.z + r) / CS);
    if (i0 === i1 && j0 === j1) return grid.get(key(i0, j0));
    _seen.clear(); const L = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = grid.get(key(i, j)); if (a) for (const k of a) if (!_seen.has(k)) { _seen.add(k); L.push(k); } }
    return L;
  };
  out.collide = (p, pr = 0.45) => {
    const a = cellSegs(p, pr); if (!a || !a.length) return false;
    let hit = false;
    for (const k of a) {
      const s = segs[k], dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
      let t = ((p.x - s[0]) * dx + (p.z - s[1]) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s[0] + dx * t, qz = s[1] + dz * t, ex = p.x - qx, ez = p.z - qz, d = Math.hypot(ex, ez), min = s[4] + pr;
      if (d < min) {
        if (d > 1e-4) { p.x = qx + (ex / d) * min; p.z = qz + (ez / d) * min; }
        else { const nl = Math.sqrt(L2); p.x = qx - (dz / nl) * min; p.z = qz + (dx / nl) * min; }
        hit = true;
      }
    }
    return hit;
  };
  st.len = st.len.map((v) => Math.round(v));
  st.ms = Math.round((performance.now() - t0) * 10) / 10;
  return out;
}
