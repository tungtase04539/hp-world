// hedges.js — Đợt 3 W3-D: HÀNG RÀO CÂY CẮT TỈA / BỤI DẢI PHÂN CÁCH "lổn nhổn" thay cho HỘP xanh phẳng (AUDIT3 PARK:
// "median hedges as flat boxes" pano_216/478, vườn hoa không có viền bụi pano_065/400). Ảnh thật (225/230/235/340/400
// h090-h270, 216/478 h000): bụi ô rô/chuỗi ngọc cắt tỉa cao 0,5-0,9 m, mặt trên bo tròn, cạnh hơi phồng, màu xanh sẫm
// dưới chân → xanh tươi hơn ở đỉnh nắng, lá mịn.
// Hình học: quét MẶT CẮT 7 điểm (đáy phẳng · hông phồng · vai vát · đỉnh) dọc đa tuyến, vòng cách ~0,8 m, mỗi đỉnh vòng
// lệch theo nhiễu hash TẤT ĐỊNH (vị trí) → 12 tam giác/vòng (~15 tam giác/m), pháp tuyến mượt, 2 nắp đầu.
// Màu: thuộc tính `color` (tối chân/sáng đỉnh × nhiễu lá) + texture lá mịn dùng chung (uv: u dọc m, v theo chu vi) →
// gần nhìn ra lá, xa vẫn rẻ. 1 geometry gộp cho cả tập đường → 1 draw call/nhóm.
import * as THREE from 'three';

const fr = (v) => v - Math.floor(v);
const h2 = (x, z, s) => fr(Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453);

let _leafTex = null;
// texture lá mịn (DataTexture tất định, sRGB): đốm sáng/tối nhỏ trên nền trung tính — nhân với màu đỉnh
export function hedgeLeafTexture() {
  if (_leafTex) return _leafTex;
  const S = 128, d = new Uint8Array(S * S * 4);
  let a = 1234567;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // nền ≈ 240 (texture sRGB → nhân TUYẾN TÍNH: 196 từng làm tối ×0,55 → bụi gần như đen trên ảnh 216/225)
  for (let i = 0; i < S * S; i++) { const v = 238 + (rnd() - 0.5) * 22; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  // cụm lá: chấm sáng (lá hứng nắng) + chấm tối (kẽ lá)
  for (let k = 0; k < 900; k++) {
    const cx = rnd() * S, cy = rnd() * S, r = 1 + rnd() * 2.2, add = rnd() < 0.5 ? 18 + rnd() * 20 : -(55 + rnd() * 55);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dd = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r); if (dd > 1) continue;
      const o = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4, w = 1 - dd;
      for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, Math.min(255, d[o + c] + add * w));
    }
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.needsUpdate = true;
  _leafTex = t;
  return t;
}

// paths: [[[x,z],...], ...]; gy(x,z) → cao độ đáy; opt: {h, w, seg, rough (lệch hông/đỉnh m), top (lồi đỉnh m), seed,
//   base [r,g,b] 0..1 sRGB màu đỉnh, foot (hệ số tối chân 0..1), wild (0 cắt tỉa phẳng … 1 bụi tự nhiên),
//   maxHalf (kẹp nửa bề ngang m — bụi dải phân cách không phồng ra ngoài bó vỉa)}
export function hedgeGeometry(paths, gy, opt = {}) {
  const H = opt.h ?? 0.7, W = opt.w ?? 0.7, SEG = opt.seg ?? 0.8, R = opt.rough ?? 0.05, TOP = opt.top ?? 0.06, seed = opt.seed ?? 1;
  const wild = opt.wild ?? 0, base = opt.base ?? [0.24, 0.36, 0.17], foot = opt.foot ?? 0.55, MH = opt.maxHalf ?? Infinity;
  // mặt cắt (ngang, cao) theo tỉ lệ: 0 đáy trái … 6 đáy phải
  const PROF = [[-0.5, 0], [-0.54, 0.5], [-0.44, 0.9], [0, 1.0], [0.44, 0.9], [0.54, 0.5], [0.5, 0]];
  const NP = PROF.length;
  const pos = [], col = [], uv = [], idx = [];
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));   // màu đỉnh: sRGB → tuyến tính
  for (const path of paths) {
    if (!path || path.length < 2) continue;
    // lấy mẫu đều theo SEG
    const P = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / SEG));
      for (let s = 0; s < n; s++) P.push([ax + (bx - ax) * s / n, az + (bz - az) * s / n]);
    }
    P.push(path[path.length - 1]);
    if (P.length < 2) continue;
    const base0 = pos.length / 3;
    let u = 0;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      if (i > 0) u += Math.hypot(x - P[i - 1][0], z - P[i - 1][1]);
      const y0 = gy(x, z);
      const hh = H * (1 + (h2(x, z, seed) - 0.5) * (0.12 + 0.5 * wild));
      const ww = W * (1 + (h2(z, x, seed + 3) - 0.5) * (0.1 + 0.4 * wild));
      const tone = 0.86 + 0.26 * h2(x * 0.37, z * 0.37, seed + 7);   // mảng sáng/tối dọc hàng
      for (let k = 0; k < NP; k++) {
        const [px, py] = PROF[k];
        const top = py > 0.8, side = py > 0.2 && py < 0.8;
        const jl = (h2(x + k * 1.7, z, seed + 11) - 0.5) * 2 * R * (side ? 1 : 0.5) * (1 + wild);
        const jv = top ? (h2(x, z + k * 2.3, seed + 13) - 0.5) * 2 * R * (1 + 2 * wild) + (k === 3 ? TOP : 0) : 0;
        const lat = Math.max(-MH, Math.min(MH, px * ww + Math.sign(px) * jl)), yy = y0 + py * hh + jv;
        pos.push(x + nx * lat, yy, z + nz * lat);
        const shade = (foot + (1 - foot) * Math.min(1, py * 1.15)) * tone * (0.92 + 0.16 * h2(x * 3.1 + k, z * 2.9, seed + 17));
        col.push(lin(Math.min(1, base[0] * shade)), lin(Math.min(1, base[1] * shade)), lin(Math.min(1, base[2] * shade)));
        uv.push(u / 0.9, k / (NP - 1) * (hh + ww) / 0.9);
      }
      if (i > 0) {
        const r0 = base0 + (i - 1) * NP, r1 = base0 + i * NP;
        for (let k = 0; k < NP - 1; k++) { idx.push(r0 + k, r1 + k + 1, r1 + k, r0 + k, r0 + k + 1, r1 + k + 1); }   // mặt hướng RA ngoài
      }
    }
    // 2 nắp đầu (quạt quanh đỉnh giữa vòng)
    const nR = P.length;
    for (const [ri, flip] of [[0, true], [nR - 1, false]]) {
      const r = base0 + ri * NP;
      for (let k = 1; k < NP - 1; k++) { if (flip) idx.push(r, r + k + 1, r + k); else idx.push(r, r + k, r + k + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// vật liệu bụi dùng chung: Lambert + màu đỉnh + texture lá (không gộp lượt 1 của freezeStatic vì có map — giữ uv)
let _hedgeMat = null;
export function hedgeMaterial() {
  if (_hedgeMat) return _hedgeMat;
  _hedgeMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: hedgeLeafTexture() });
  _hedgeMat.name = 'hedge_leaf';
  return _hedgeMat;
}
