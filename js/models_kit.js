// models_kit.js — BỘ MÔ HÌNH THỦ TỤC DÙNG CHUNG cho NGƯỜI & XE (Đợt 3 wave 2, W2-C).
// Một nguồn hình học + một vật liệu cho: giao thông (traffic.js), xe/người đỗ-đứng trên vỉa hè (props.js) và nhân vật
// chơi/NPC (character.js makeHumanoid → SkinnedMesh). Trước: 3 bộ dựng riêng, người chibi hộp, ô tô hộp bánh "nửa đĩa".
//
// QUY ƯỚC: mét, local +Z = mũi xe / mặt người, +Y lên, +X = bên TRÁI của người/xe (nhìn theo +Z), bánh/chân chạm y = 0.
// MỖI ĐỈNH mang: position · normal · color (albedo tuyến tính) · aKit = (kênh màu, cổng phụ kiện, chi, nhám+2·kim loại).
//  - KÊNH (CH.*): màu cuối = color × màu kênh. Kênh lấy màu từ instance (sơn = instanceColor, áo A/B = aShirt/aShirt2)
//    hoặc từ BẢNG MÀU BĂM theo hạt giống instance (da, tóc, mũ bảo hiểm, quần, khẩu trang, giày, túi, hàng chở) —
//    vì vậy MỘT draw call vẫn ra hàng trăm người/xe khác màu.
//  - CỔNG (gate): +k = chỉ hiện khi bit (k−1) của aOpt bật, −k = chỉ hiện khi bit đó TẮT; đỉnh bị tắt thu về 0
//    (tam giác suy biến). aOpt = bit tuỳ chọn (0..12) + 8192 × hạt giống (0..255) — hạt giống CỐ ĐỊNH theo tác tử
//    (không băm theo vị trí: xe chạy thì vị trí đổi → màu nhấp nháy).
//  - CHI (limb): 1/2 đùi T/P, 3/4 cẳng chân, 5/6 cánh tay, 7/8 cẳng tay, 9 thân trên, 10 đầu-cổ, 0 hông/khác.
//    Vertex shader xoay chi quanh khớp (hông/gối/vai/khuỷu) theo pha bước → đi bộ có gập gối, tay đánh ngược chân;
//    bit SIT → tư thế ngồi ghế nhựa (đùi gập 109°, cẳng chân thẳng đứng). Không xương, không CPU mỗi khung.
//  - Người lái/người ngồi sau xe máy: tư thế NƯỚNG SẴN bằng IK 2 khớp (hông→gối→bàn chân trên sàn/gác chân,
//    vai→khuỷu→tay nắm ghi-đông) khi dựng — chi là ống elip nối khớp, nên dáng ngồi khớp từng loại xe.
// Tỉ lệ người: cao 1,70 m (instance scale 0,9-1,06), đầu 0,227 m = 1/7,5 chiều cao (KHÔNG chibi), vai 0,37-0,40 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------------------------------
// 0. KÊNH MÀU, BIT TUỲ CHỌN, BẢNG MÀU
// ---------------------------------------------------------------------------------------------------------------------
export const CH = {
  FIX: 0, PAINT: 1, TOP: 2, HELM: 3, TOP2: 4, HEAD: 5, TAIL: 6, SKIN: 7, HAIR: 8, BOT: 9, HELM2: 10, BOT2: 11,
  MASK: 12, SKIN2: 13, HAIR2: 14, CARGO: 15, SIGN: 16, SHOE: 17, LOWLEG: 18, FOREARM: 19, BAG: 20, FOREARM2: 21,
  LOWLEG2: 22, AMBER: 23, SHOE2: 24,
};
// bit 0/1/4 theo loại; 2-3, 5-11 là của NGƯỜI A/B (dùng chung số bit cho người đi bộ và người lái)
export const OPT = {
  PILLION: 0, CARGO: 1, BASKET: 4, TOPBOX: 1,            // xe máy chạy (TOPBOX dùng cho xe ĐỖ — không chở hàng)
  MIRRORHELM: 0,                                          // xe máy đỗ: mũ bảo hiểm treo gương
  NONLA: 0, CAP: 1, BAG: 4, SIT: 7,                       // người đi bộ
  TAXI: 0, RACK: 1,                                       // ô tô
  MASK_A: 2, HAIR_A: 3, SLEEVE_A: 5, SHORTS_A: 6, MASK_B: 8, HAIR_B: 9, SLEEVE_B: 10, SHORTS_B: 11,
  PARKED: 12,
};
// bit 12 = PARKED (xe đỗ: đèn KHÔNG sáng đêm) → xe chạy & xe đỗ dùng CHUNG 1 vật liệu/1 chương trình shader
export const optWord = (bits, seed) => { let v = 0; for (const b of new Set(bits)) v += 1 << b; return v + 8192 * (seed & 255); };

const P = (a) => a.map((h) => new THREE.Color(h));
// bảng màu (sRGB hex → tuyến tính qua THREE.Color) — theo ảnh pano HP tháng 10
export const PAL = {
  skin: [0xe0b08a, 0xd6a27a, 0xc8906a, 0xeac0a0, 0xbf8660, 0xd9a983],
  hair: [0x141210, 0x1d1714, 0x2a1e17, 0x3b2a1e],
  helm: [0xf0efea, 0xf0efea, 0x18181a, 0x18181a, 0x9a1c1c, 0x1f3e86, 0xe2b81c, 0x8a8f96, 0xd27aa0, 0x2d7a46],
  bot: [0x1f2a3e, 0x1c1c1f, 0x343b48, 0x5c5246, 0x2c3e5e, 0x6a6e74, 0x4a3c30, 0x8a96a6],
  mask: [0x9cc7e6, 0x1c1c1e, 0xf2f2f0, 0xe7a2b8],
  shoe: [0x1c1c1e, 0xe8e6e0, 0x5a4434, 0x2a2a30],
  bag: [0x1c1c1e, 0x6a4a32, 0xb53a3a, 0x2c4f8a, 0xd8cdb8, 0x3a3a40],
  cargo: [0xb08a5a, 0xd9d6cc, 0x2f6aa8, 0x3c7a4a, 0x9a3a2a, 0x6a6f74],   // thùng các-tông / xốp / bạt xanh / bạt lục
};
// sơn xe & áo (CPU chọn, ghi vào instanceColor / aShirt) — tần suất theo pano: xe máy đen/trắng/đỏ/xanh/bạc;
// ô tô trắng/bạc/đen chiếm ~70%; áo trơn sáng, sơ-mi, áo chống nắng hồng/xanh nhạt
export const BIKE_PAINT = [0x18181a, 0x18181a, 0xe8e7e2, 0xe8e7e2, 0x8f1c1c, 0x1d3d7a, 0x9ea3a8, 0x5a3b2a, 0x2c6a3e, 0xc9a24a, 0x7a1f3a, 0x30343a];
export const CAR_PAINT = [0xeeeeea, 0xeeeeea, 0xeeeeea, 0xb4b7ba, 0xb4b7ba, 0x16171a, 0x16171a, 0x7a1414, 0x1e3f73, 0x5e625a, 0x8a8f94, 0x3a2a24];
export const TAXI_PAINT = [0x2e8b57, 0x2e8b57, 0xf2f2ee, 0xf2f2ee, 0xe9c43a, 0x2f6fb5];
export const SHIRT = [0xeceae4, 0xeceae4, 0x2b4f8a, 0x7a2b2b, 0x3d6b4a, 0xd2b48c, 0x8fa9c9, 0x222225, 0xe0c64a, 0xc27aa0, 0x5f6b78, 0xf6f6f2, 0x8a5a3a, 0xd96b2b, 0x9a7ab8];
export const JACKET = [0xe7a2b8, 0x9cc7e6, 0xf0e8d8, 0xb8a0d0, 0x8fb8a0, 0xe8d0a0, 0x6a6f78];

// ---------------------------------------------------------------------------------------------------------------------
// 1. BỘ DỰNG HÌNH
// ---------------------------------------------------------------------------------------------------------------------
const _c = new THREE.Color();
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
// gắn thuộc tính kit cho 1 mảnh: c = hex (sRGB) | [r,g,b] tuyến tính; shade = hệ số nhân màu (tối viền, AO giả)
function tag(geo, o = {}) {
  const g = geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  // giữ CHỈ SỐ (mảnh mượt đã chia sẻ đỉnh khi dựng; mảnh phẳng có đỉnh riêng mỗi mặt) → gộp thẳng, KHÔNG cần
  // mergeVertices (đo node: 2-5 ms/mô hình × ~25 mô hình lúc khởi động)
  if (!g.index) { const n = g.attributes.position.count, ix = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  g.clearGroups();
  const n = g.attributes.position.count;
  const kit = new Float32Array(n * 4);
  const r = o.r ?? 0.8, m = o.m ?? 0;
  for (let i = 0; i < n; i++) { kit[i * 4] = o.ch || 0; kit[i * 4 + 1] = o.gate || 0; kit[i * 4 + 2] = o.limb || 0; kit[i * 4 + 3] = r + 2 * m; }
  if (!g.attributes.color) {
    const col = new Float32Array(n * 3);
    if (Array.isArray(o.c)) _c.setRGB(o.c[0], o.c[1], o.c[2]); else _c.setHex(o.c ?? 0xffffff);
    const s = o.shade ?? 1;
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r * s; col[i * 3 + 1] = _c.g * s; col[i * 3 + 2] = _c.b * s; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setAttribute('aKit', new THREE.BufferAttribute(kit, 4));
  return g;
}
export class Kit {
  constructor() { this.parts = []; }
  add(geo, o) { this.parts.push(tag(geo, o)); return this; }
  // gộp các mảnh (đều có chỉ số) thành 1 hình
  build() {
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose()); this.parts = [];
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
// cache: mỗi mô hình dựng 1 lần; mỗi InstancedMesh cần geometry RIÊNG (attribute instance gắn vào geometry) →
// trả bản NÔNG dùng chung index/position/normal/color/aKit (không nhân bộ nhớ đỉnh, không dựng lại ~5-20 ms/mô hình)
const _geoCache = new Map();
export function shared(key, make) {
  let g = _geoCache.get(key);
  if (!g) { g = make(); _geoCache.set(key, g); }
  const c = new THREE.BufferGeometry();
  c.setIndex(g.index);
  for (const k in g.attributes) c.setAttribute(k, g.attributes[k]);
  c.boundingSphere = g.boundingSphere; c.boundingBox = g.boundingBox;
  c.userData = { ...g.userData };
  return c;
}

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3();
function frameOf(dir, ref) {
  _r.set(ref[0], ref[1], ref[2]);
  if (Math.abs(dir.dot(_r)) > 0.97 * _r.length()) _r.set(0, 1, 0).cross(dir).lengthSq() > 1e-6 ? _r.set(0, 1, 0) : _r.set(1, 0, 0);
  _u.crossVectors(dir, _r).normalize();
  _v.crossVectors(_u, dir).normalize();
}
// ỐNG qua các vòng elip: rings = [{p:[x,y,z], rx, rz, ox?, oz?}] (rx theo trục ngang u, rz theo v ≈ ref), n cạnh,
// nắp 2 đầu (fan, đỉnh nắp lồi theo 'bulge'). Pháp tuyến MƯỢT (tay chân, thân, đầu, lốp).
// fixed: dùng MỘT khung cho mọi vòng (trục = vòng cuối − vòng đầu) — bắt buộc với mặt cắt KHÔNG đơn điệu theo trục
// (lốp: hông lốp đi ngược trục rồi xuôi; khung từng vòng sẽ lật → xoắn).
export function tube(rings, n = 6, { capA = true, capB = true, ref = [0, 0, 1], bulgeA = 0, bulgeB = 0, rot = 0, fixed = false } = {}) {
  const pos = [], idx = [];
  const R = rings.length;
  for (let i = 0; i < R; i++) {
    const a = v3(rings[fixed ? 0 : Math.max(0, i - 1)].p), b = v3(rings[fixed ? R - 1 : Math.min(R - 1, i + 1)].p);
    _d.subVectors(b, a); if (_d.lengthSq() < 1e-12) _d.set(0, 1, 0); _d.normalize();
    frameOf(_d, ref);
    const rg = rings[i], c = rg.p, ox = rg.ox || 0, oz = rg.oz || 0;
    for (let s = 0; s < n; s++) {
      const t = (s / n) * Math.PI * 2 + rot, cu = Math.cos(t) * rg.rx + ox, sv = Math.sin(t) * rg.rz + oz;
      pos.push(c[0] + _u.x * cu + _v.x * sv, c[1] + _u.y * cu + _v.y * sv, c[2] + _u.z * cu + _v.z * sv);
    }
  }
  for (let i = 0; i < R - 1; i++) for (let s = 0; s < n; s++) {
    const a0 = i * n + s, a1 = i * n + ((s + 1) % n), b0 = a0 + n, b1 = a1 + n;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const cap = (ring, sgn, bulge) => {
    const c = rings[ring].p, nb = fixed ? (ring === 0 ? R - 1 : 0) : (ring === 0 ? 1 : R - 2);
    _d.set(c[0] - rings[nb].p[0], c[1] - rings[nb].p[1], c[2] - rings[nb].p[2]).normalize();
    const ci = pos.length / 3; pos.push(c[0] + _d.x * bulge, c[1] + _d.y * bulge, c[2] + _d.z * bulge);
    for (let s = 0; s < n; s++) {
      const a0 = ring * n + s, a1 = ring * n + ((s + 1) % n);
      if (sgn < 0) idx.push(ci, a0, a1); else idx.push(ci, a1, a0);
    }
  };
  if (capA && R > 1) cap(0, -1, bulgeA);
  if (capB && R > 1) cap(R - 1, 1, bulgeB);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// ống 2 đầu a→b (chi người, khung xe, càng, ống xả)
export const seg = (a, b, ra, rb, n = 6, o = {}) => tube([{ p: a, rx: ra, rz: o.rza ?? ra }, { p: b, rx: rb, rz: o.rzb ?? rb }], n, o);
// elip khối (đầu, bàn tay, mũ): SphereGeometry tách vùng (phiLen/thetaLen) cho tóc, mũ
export function ell(c, rx, ry, rz, ws = 8, hs = 6, th0 = 0, thL = Math.PI) {
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, th0, thL);
  g.scale(rx, ry, rz).translate(c[0], c[1], c[2]);
  return g;
}
export function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return g.translate(x, y, z);
}
// hộp nối 2 điểm (thanh, trụ kính, gương)
export function beam(a, b, w, h) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-3;
  const g = new THREE.BoxGeometry(w, L, h);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
// LOFT các mặt cắt khép kín (cùng số điểm, đi CÙNG chiều) — thân ô tô/xe máy, kính. caps: nắp fan 2 đầu.
// shade[k] (tuỳ chọn) = hệ số màu theo chỉ số điểm trong vòng (gầm tối dần → AO giả)
export function loft(sections, { capA = true, capB = true, flip = false, shade = null, c = 0xffffff } = {}) {
  const n = sections[0].length, S = sections.length;
  const pos = [], idx = [], col = [];
  _c.setHex(c);
  for (const sec of sections) for (let k = 0; k < n; k++) {
    pos.push(sec[k][0], sec[k][1], sec[k][2]);
    const s = shade ? shade[k] : 1; col.push(_c.r * s, _c.g * s, _c.b * s);
  }
  const push = (a, b, cc) => (flip ? idx.push(a, cc, b) : idx.push(a, b, cc));
  for (let i = 0; i < S - 1; i++) for (let k = 0; k < n; k++) {
    const a0 = i * n + k, a1 = i * n + ((k + 1) % n), b0 = a0 + n, b1 = a1 + n;
    push(a0, b0, a1); push(a1, b0, b1);
  }
  const cap = (i, sgn) => {
    let cx = 0, cy = 0, cz = 0; for (const p of sections[i]) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const ci = pos.length / 3; pos.push(cx / n, cy / n, cz / n);
    const s = shade ? shade.reduce((a, b) => a + b, 0) / n : 1; col.push(_c.r * s, _c.g * s, _c.b * s);
    for (let k = 0; k < n; k++) { const a0 = i * n + k, a1 = i * n + ((k + 1) % n); if (sgn < 0) push(ci, a0, a1); else push(ci, a1, a0); }
  };
  if (capA) cap(0, -1);
  if (capB) cap(S - 1, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// mảnh phẳng tứ giác (kính, trụ) — 4 điểm theo thứ tự CCW nhìn từ phía mặt
export function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.computeVertexNormals();
  return g;
}
// profile ngang (z,y) đùn theo X, vát mép (bevel) → yếm/thân/yên xe máy bo tròn
// taper(x,y,z) (tuỳ chọn) = hệ số co bề ngang X theo vị trí — TUYẾN TÍNH theo y hoặc z thì mặt hông vẫn phẳng
// (yếm xe hẹp dưới rộng trên, đuôi xe thon dần)
export function slab(pts, w, x0 = 0, bev = 0.02, bevSeg = 1, taper = null) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.005, w - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: bevSeg, curveSegments: 2, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate((w - 2 * bev) / 2, 0, 0);
  g.deleteAttribute('uv');
  if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getX(i), p.getY(i), p.getZ(i))); }
  if (x0) g.translate(x0, 0, 0);
  g.computeVertexNormals();   // non-indexed → pháp tuyến theo mặt (mặt phẳng giữ phẳng, mép vát thành vát)
  return g;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------------------------------------------------
// 2. NGƯỜI — khung xương nghỉ (đứng, nhìn +Z), cao 1,70 m, 7,5 đầu. Hằng này CHUNG với vertex shader (dáng đi/ngồi)
//    và SkinnedMesh của character.js → đổi ở đây là đổi mọi nơi.
// ---------------------------------------------------------------------------------------------------------------------
export const SK = {
  hipX: 0.09, hipY: 0.9, knX: 0.096, knY: 0.49, knZ: 0.012, anX: 0.1, anY: 0.085, anZ: -0.02,
  shX: 0.182, shY: 1.4, shZ: -0.015, elX: 0.205, elY: 1.115, elZ: -0.04, wrX: 0.212, wrY: 0.868, wrZ: -0.005,
  waistY: 1.03, chestY: 1.27, neckY: 1.45, headY: 1.585, headZ: 0.012,
};
export function restJoints() {
  const s = SK, J = {
    pelvis: [0, 0.93, 0], waist: [0, s.waistY, 0], chest: [0, s.chestY, 0.005], neck: [0, s.neckY, -0.005], head: [0, s.headY, s.headZ],
    up: [0, 1, 0], fwd: [0, 0, 1],
  };
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    J['hip' + sd] = [sx * s.hipX, s.hipY, 0];
    J['kn' + sd] = [sx * s.knX, s.knY, s.knZ];
    J['an' + sd] = [sx * s.anX, s.anY, s.anZ];
    J['toe' + sd] = [sx * (s.anX + 0.008), 0.03, s.anZ + 0.19];
    J['sh' + sd] = [sx * s.shX, s.shY, s.shZ];
    J['el' + sd] = [sx * s.elX, s.elY, s.elZ];
    J['wr' + sd] = [sx * s.wrX, s.wrY, s.wrZ];
  }
  return J;
}
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// IK 2 khớp: gốc a, đích t, độ dài l1/l2, 'bend' = hướng gập ưu tiên của khớp giữa → vị trí khớp giữa
export function ik2(a, t, l1, l2, bend) {
  let d = sub3(t, a); let L = len3(d);
  const Lm = Math.min(L, (l1 + l2) * 0.999); d = nrm3(d);
  const x = (l1 * l1 - l2 * l2 + Lm * Lm) / (2 * Lm), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let b = sub3(bend, d.map((v) => v * dot3(bend, d))); b = nrm3(b);
  return add3(add3(a, d, x), b, h);
}
// tư thế NGỒI XE MÁY: seat=[y,z] mặt yên (hông ngay trên), grip=[x,y,z] tay nắm trái (+X), foot=[x,y,z] gót trái,
// lean = độ chồm thân (rad). Trả khung khớp cùng tên với restJoints.
export function riderJoints({ seat, grip, foot, lean = 0.12, headUp = 0.1, handsOnLap = false }) {
  const s = SK, J = {};
  const py = seat[0] + 0.075, pz = seat[1];
  const up = [0, Math.cos(lean), Math.sin(lean)];
  J.pelvis = [0, py + 0.02, pz]; J.up = up; J.fwd = [0, -Math.sin(lean), Math.cos(lean)];
  J.waist = add3(J.pelvis, up, s.waistY - 0.93);
  J.chest = add3(J.pelvis, up, s.chestY - 0.93);
  J.neck = add3(J.pelvis, up, s.neckY - 0.93);
  const hu = [0, Math.cos(headUp), Math.sin(headUp)];
  J.head = add3(J.neck, hu, s.headY - s.neckY);
  J.head[2] += 0.01;
  const lTh = len3([s.knX - s.hipX, s.knY - s.hipY, s.knZ]), lSh = len3([s.anX - s.knX, s.anY - s.knY, s.anZ - s.knZ]);
  const lUa = len3([s.elX - s.shX, s.elY - s.shY, s.elZ - s.shZ]), lFa = len3([s.wrX - s.elX, s.wrY - s.elY, s.wrZ - s.elZ]) + 0.06;
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    J['hip' + sd] = [sx * s.hipX, py, pz];
    J['an' + sd] = [sx * foot[0], foot[1], foot[2]];
    J['kn' + sd] = ik2(J['hip' + sd], J['an' + sd], lTh, lSh, [sx * 0.25, 0.6, 1]);
    J['toe' + sd] = [sx * (foot[0] + 0.01), Math.max(0.02, foot[1] - 0.05), foot[2] + 0.19];
    J['sh' + sd] = add3(add3(J.pelvis, up, s.shY - 0.93), [sx * s.shX, 0, 0]);
    const hand = handsOnLap ? add3(J['kn' + sd], [sx * -0.02, 0.06, -0.12]) : [sx * grip[0], grip[1], grip[2]];
    J['wr' + sd] = add3(hand, nrm3(sub3(J['sh' + sd], hand)), 0.06);
    J['el' + sd] = ik2(J['sh' + sd], J['wr' + sd], lUa, lFa - 0.06, [sx * 0.8, -0.6, -0.2]);
  }
  return J;
}

// Dựng người từ khung khớp J. o: { who:'A'|'B', lo (ít đa giác: người lái/xa), limbs (gán id chi), helmet:
//  'gate'|'on'|false, nonla/cap/bag/hair/mask: giá trị cổng (0 = không có), skirt }
export function person(K, J, o = {}) {
  const B = o.who === 'B';
  const C = B
    ? { top: CH.TOP2, bot: CH.BOT2, skin: CH.SKIN2, hair: CH.HAIR2, helm: CH.HELM2, low: CH.LOWLEG2, fore: CH.FOREARM2, shoe: CH.SHOE2 }
    : { top: CH.TOP, bot: CH.BOT, skin: CH.SKIN, hair: CH.HAIR, helm: CH.HELM, low: CH.LOWLEG, fore: CH.FOREARM, shoe: CH.SHOE };
  const RD = !!o.rider;   // người trên xe: ít đa giác hơn (ngân sách xe+người ≤ 1,2k tam giác)
  const n = o.lo ? 5 : 6, nb = RD ? 6 : o.lo ? 7 : 8;
  const L = (id) => (o.limbs ? id : 0);
  const cloth = { r: 0.92 }, skin = { r: 0.62 };
  const up = J.up, fw = J.fwd;
  // --- hông/mông (quần) — vòng elip dọc trục thân
  const pr = (k, rx, rz, oz = 0) => ({ p: add3(add3(J.pelvis, up, k - 0.93), fw, oz), rx, rz });
  K.add(tube(RD ? [pr(0.83, 0.15, 0.1, -0.01), pr(0.95, 0.163, 0.105, -0.008), pr(1.04, 0.142, 0.092, 0)] : [pr(0.79, 0.12, 0.085, -0.005), pr(0.86, 0.158, 0.105, -0.01), pr(0.95, 0.163, 0.105, -0.008), pr(1.04, 0.142, 0.092, 0)], nb, { capA: true, capB: false, bulgeA: 0.02, ref: fw }), { ch: C.bot, limb: L(0), ...cloth });
  // --- thân trên (áo): eo → ngực → vai, khép ở chân cổ
  K.add(tube(RD ? [pr(1.02, 0.144, 0.094, 0), pr(1.26, 0.166, 0.106, 0.01), pr(1.38, 0.18, 0.094, -0.002), pr(1.46, 0.08, 0.06, -0.01)] : [pr(1.02, 0.144, 0.094, 0), pr(1.15, 0.152, 0.1, 0.004), pr(1.28, 0.168, 0.108, 0.01), pr(1.37, 0.182, 0.096, -0.002), pr(1.425, 0.15, 0.078, -0.012), pr(1.46, 0.07, 0.055, -0.01)], nb, { capA: false, capB: true, ref: fw }), { ch: C.top, limb: L(9), ...cloth });
  // --- váy (nữ, cổng) che đùi trên
  if (o.skirt) K.add(tube([pr(1.0, 0.15, 0.1), pr(0.78, 0.2, 0.15), pr(0.56, 0.23, 0.17)], nb, { capA: false, capB: false, ref: fw }), { ch: C.bot, gate: o.skirt, limb: L(0), ...cloth });
  // --- cổ + đầu (đầu: elip 0,078×0,112×0,095, cằm hẹp, mũi nhô) — chi 10
  K.add(seg(J.neck, add3(J.neck, nrm3(sub3(J.head, J.neck)), 0.1), 0.047, 0.044, n, { capA: false, capB: false, ref: fw }), { ch: C.skin, limb: L(10), ...skin });
  const hd = ell([0, 0, 0], 0.079, 0.113, 0.097, RD ? 6 : o.lo ? 7 : 8, RD ? 5 : o.lo ? 5 : 6);
  { // cằm/hàm hẹp + mặt hơi phẳng phía trước, đầu sau tròn
    const p = hd.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) { const k = -y / 0.113; x *= 1 - 0.3 * k; z = z > 0 ? z * (1 - 0.12 * k) : z * (1 - 0.25 * k); }
      if (z > 0.06) z = 0.06 + (z - 0.06) * 0.7;
      p.setXYZ(i, x, y, z);
    }
    hd.computeVertexNormals();
  }
  // khung đầu: x = trái, y = trục cổ→đầu, z = mặt (hệ phải: z = x × y)
  const hdUp = nrm3(sub3(J.head, J.neck));
  const hx = nrm3(cross3(hdUp, J.fwd)), hz = cross3(hx, hdUp);
  const hm = new THREE.Matrix4().makeBasis(v3(hx), v3(hdUp), v3(hz));
  const place = (g) => { g.applyMatrix4(hm); g.translate(J.head[0], J.head[1], J.head[2]); return g; };
  K.add(place(hd), { ch: C.skin, limb: L(10), ...skin });
  if (!o.lo) K.add(place(box(0.026, 0.045, 0.03, 0, -0.005, 0.098, -0.25)), { ch: C.skin, limb: L(10), ...skin });   // mũi
  // tóc ngắn: chỏm trên-sau đầu, chân tóc phía trán kéo lên (không trùm mặt)
  if (o.helmet !== 'on') {
    const hr = ell([0, 0.012, -0.01], 0.085, 0.118, 0.103, o.lo ? 7 : 9, 5, 0, Math.PI * 0.62);
    const p = hr.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), y = p.getY(i); if (z > -0.02) p.setY(i, Math.max(y, 0.035 + 0.35 * Math.max(0, z))); }
    hr.computeVertexNormals();
    K.add(place(hr), { ch: C.hair, limb: L(10), r: 0.7 });
  }
  // tóc dài (nữ, cổng): mảng tóc sau gáy xuống vai
  if (o.hair) K.add(place(ell([0, -0.1, -0.068], 0.07, 0.13, 0.04, RD ? 5 : 6, RD ? 3 : 4)), { ch: C.hair, gate: o.hair, limb: L(10), r: 0.7 });
  // mũ bảo hiểm nửa đầu (VN phổ biến): vỏ bán cầu + lưỡi trai nhỏ phía trước
  if (o.helmet) {
    const hg = o.helmet === 'gate' ? o.helmetGate : 0;
    K.add(place(ell([0, 0.025, -0.006], 0.106, 0.112, 0.124, RD ? 8 : o.lo ? 8 : 10, RD ? 3 : 4, 0, Math.PI * 0.55)), { ch: C.helm, gate: hg, limb: L(10), r: 0.3 });
    K.add(place(box(0.15, 0.012, 0.05, 0, 0.03, 0.118, 0.32)), { ch: C.helm, gate: hg, limb: L(10), r: 0.65, shade: 0.75 });   // lưỡi trai mũ (nhám: mặt phẳng bóng phản chiếu trời thành vệt trắng)
  }
  // khẩu trang (cổng)
  if (o.mask) K.add(place(box(0.11, 0.06, 0.03, 0, -0.045, 0.082)), { ch: CH.MASK, gate: o.mask, limb: L(10), r: 0.9 });
  // nón lá (cổng): nón chóp rộng 0,48 m cao 0,17, mặt hơi lõm, màu lá cọ
  if (o.nonla) K.add(place(tube([{ p: [0, 0.055, 0], rx: 0.235, rz: 0.235 }, { p: [0, 0.09, 0], rx: 0.17, rz: 0.17 }, { p: [0, 0.16, 0], rx: 0.06, rz: 0.06 }, { p: [0, 0.205, 0], rx: 0.004, rz: 0.004 }], o.lo ? 10 : 14, { ref: [1, 0, 0], capA: true, capB: false, fixed: true })), { c: 0xd8c48c, gate: o.nonla, limb: L(10), r: 0.85 });
  // mũ lưỡi trai (cổng)
  if (o.cap) {
    K.add(place(ell([0, 0.026, -0.006], 0.093, 0.125, 0.11, 8, 3, 0, Math.PI * 0.5)), { ch: CH.BAG, gate: o.cap, limb: L(10), r: 0.85 });   // chỏm mũ trùm hết tóc
    K.add(place(box(0.13, 0.01, 0.08, 0, 0.04, 0.115, 0.08)), { ch: CH.BAG, gate: o.cap, limb: L(10), r: 0.85, shade: 0.85 });
  }
  // --- tay: cánh tay (tay áo) + cẳng tay (da / tay áo dài) + bàn tay
  for (const [sd, sx, la, lf] of [['L', 1, 5, 7], ['R', -1, 6, 8]]) {
    const sh = J['sh' + sd], el = J['el' + sd], wr = J['wr' + sd];
    K.add(tube([{ p: add3(sh, [sx * -0.01, 0.025, 0]), rx: 0.052, rz: 0.05 }, { p: el, rx: 0.039, rz: 0.04 }], n, { bulgeA: 0.03, bulgeB: 0.01 }), { ch: C.top, limb: L(la), ...cloth });
    const hdir = nrm3(sub3(wr, el));
    if (RD) { K.add(tube([{ p: el, rx: 0.037, rz: 0.038 }, { p: add3(wr, hdir, 0.05), rx: 0.027, rz: 0.032 }], 5, { bulgeA: 0.01, bulgeB: 0.02 }), { ch: C.fore, ...skin }); continue; }
    K.add(tube([{ p: el, rx: 0.037, rz: 0.038 }, { p: add3(el, nrm3(sub3(wr, el)), 0.11), rx: 0.036, rz: 0.035 }, { p: wr, rx: 0.026, rz: 0.03 }], n, { bulgeA: 0.01, bulgeB: 0 }), { ch: C.fore, limb: L(lf), ...skin });
    K.add(seg(wr, add3(wr, hdir, 0.085), 0.026, 0.02, 5, { rza: 0.034, rzb: 0.028, bulgeB: 0.012 }), { ch: C.skin, limb: L(lf), ...skin });
  }
  // --- chân: đùi (quần) → cẳng (quần / da khi mặc quần đùi) → giày
  for (const [sd, sx, lt, ls] of [['L', 1, 1, 3], ['R', -1, 2, 4]]) {
    const hp = J['hip' + sd], kn = J['kn' + sd], an = J['an' + sd], toe = J['toe' + sd];
    const dk = nrm3(sub3(kn, hp));
    K.add(tube([{ p: add3(hp, dk, -0.04), rx: 0.083, rz: 0.088 }, { p: add3(hp, dk, 0.18), rx: 0.074, rz: 0.08 }, { p: kn, rx: 0.054, rz: 0.058 }], n, { capA: false, bulgeB: 0.02, ref: J.fwd }), { ch: C.bot, limb: L(lt), ...cloth });
    const ds = nrm3(sub3(an, kn));
    K.add(tube(RD ? [{ p: kn, rx: 0.053, rz: 0.057 }, { p: an, rx: 0.036, rz: 0.04 }] : [{ p: kn, rx: 0.052, rz: 0.055 }, { p: add3(kn, ds, 0.13), rx: 0.054, rz: 0.06, oz: -0.008 }, { p: an, rx: 0.034, rz: 0.038 }], n, { bulgeA: 0.01, bulgeB: 0.01, ref: J.fwd }), { ch: C.low, limb: L(ls), ...cloth });
    // giày/dép: nêm thấp từ gót tới mũi
    const heel = add3(an, nrm3(sub3(an, toe)), 0.045);
    K.add(tube(RD ? [{ p: [heel[0], heel[1] - 0.035, heel[2]], rx: 0.04, rz: 0.035 }, { p: [toe[0], toe[1], toe[2]], rx: 0.04, rz: 0.022 }] : [{ p: [heel[0], heel[1] - 0.035, heel[2]], rx: 0.038, rz: 0.03 }, { p: [an[0], an[1] - 0.045, an[2] + 0.04], rx: 0.044, rz: 0.04 }, { p: [toe[0], toe[1], toe[2]], rx: 0.04, rz: 0.022 }], RD ? 4 : 5, { ref: [0, 1, 0], bulgeB: 0.015 }), { ch: C.shoe, limb: L(ls), r: 0.6 });
  }
  // túi đeo chéo (cổng)
  if (o.bag) {
    K.add(box(0.06, 0.2, 0.25, -0.17, 0.94, 0.02, 0, 0, 0.06), { ch: CH.BAG, gate: o.bag, limb: L(0), r: 0.7 });
    K.add(beam([-0.17, 1.03, 0.0], [0.14, 1.41, 0.02], 0.025, 0.01), { ch: CH.BAG, gate: o.bag, limb: L(9), r: 0.7, shade: 0.8 });
  }
  return K;
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. XE MÁY — 3 kiểu phổ biến ở HP: 'scooter' (xe ga nhỏ bánh 14"), 'underbone' (xe số bánh 17"), 'bigscooter'
//    (xe ga lớn bánh 16"). Phụ kiện cổng: thùng sau, rổ trước, mũ treo gương. rider: 'none' (xe đỗ) | 'ride'
//    (người lái + người ngồi sau [cổng PILLION] + hàng chở [cổng CARGO]).
// ---------------------------------------------------------------------------------------------------------------------
const BK = {
  tyre: 0x161618, rim: 0x4a4d52, alloy: 0xa9adb3, chrome: 0xc4c8cc, black: 0x1a1a1c, dark: 0x2c2e32, seat: 0x1b1b1d,
  lens: 0xe8eef2, red: 0xb01818, amber: 0xd98a1c, plate: 0xe9e8de, engine: 0x55585d, floor: 0x26272a,
};
// bánh xe máy: lốp (ống quanh trục X, mặt cắt tròn) + vành 3 nan / đúc + đĩa phanh
// LỐP quanh trục X tâm (x,y,z): mặt cắt vành-trong → hông → gai → hông → vành-ngoài (khung CỐ ĐỊNH, xem tube)
function tyre(x, y, z, R, w, rr, n, side = 0.03) {
  if (n <= 12) return tube([{ p: [-w / 2, 0, 0], rx: rr, rz: rr }, { p: [-w * 0.42, 0, 0], rx: R - side * 0.3, rz: R - side * 0.3 }, { p: [w * 0.42, 0, 0], rx: R - side * 0.3, rz: R - side * 0.3 }, { p: [w / 2, 0, 0], rx: rr, rz: rr }], n,
    { capA: false, capB: false, ref: [0, 0, 1], fixed: true }).translate(x, y, z);
  return tube([{ p: [-w / 2, 0, 0], rx: rr, rz: rr }, { p: [-w / 2 - 0.006, 0, 0], rx: R - side, rz: R - side }, { p: [-w * 0.32, 0, 0], rx: R, rz: R },
    { p: [w * 0.32, 0, 0], rx: R, rz: R }, { p: [w / 2 + 0.006, 0, 0], rx: R - side, rz: R - side }, { p: [w / 2, 0, 0], rx: rr, rz: rr }], n,
  { capA: false, capB: false, ref: [0, 0, 1], fixed: true }).translate(x, y, z);
}
// ĐĨA phẳng quanh trục X ở mặt x, quay ra phía sx (±1): bán kính r1 (r0 > 0 → vành khuyên)
function disc(x, y, z, r1, sx, n, r0 = 0) {
  const g = r0 > 0 ? new THREE.RingGeometry(r0, r1, n, 1) : new THREE.CircleGeometry(r1, n);
  g.deleteAttribute('uv');
  g.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);   // pháp tuyến +Z → ±X
  return g.translate(x, y, z);
}
function bikeWheel(K, z, R, w, { spokes = false, det = 2 } = {}) {
  const n = det > 0 ? 12 : 8, rr = R * 0.66;
  K.add(tyre(0, R, z, R, w, rr + 0.01, n), { c: BK.tyre, r: 0.85 });
  // vành: 2 mặt đĩa (đúc: bạc; nan: tối + nan mảnh) + ổ trục
  for (const s of [-1, 1]) {
    K.add(disc(s * w * 0.42, R, z, rr + 0.012, s, n), { c: spokes ? BK.dark : BK.alloy, r: 0.35, m: spokes ? 0 : 1, shade: spokes ? 1 : 0.8 });
    if (det > 0) K.add(disc(s * w * 0.5, R, z, 0.05, s, 6), { c: BK.alloy, r: 0.3, m: 1 });
  }
  // nan: dải phẳng trên MẶT NGOÀI 2 bên (nan đúc: tối trên vành bạc; nan căm: bạc trên vành tối) — 2 tam giác/nan/bên
  if (det > 1) {
    const ns = spokes ? 8 : 5, hw = spokes ? 0.006 : 0.016;
    for (let k = 0; k < ns; k++) {
      const a = (k / ns) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cb = -sa, sb = ca;
      for (const s of [-1, 1]) {
        const x = s * (w * 0.42 + 0.002), r0 = 0.05, r1 = rr - 0.01;
        const P = (r, o) => [x, R + ca * r + cb * o, z + sa * r + sb * o];
        K.add(s > 0 ? quad(P(r0, -hw), P(r1, -hw), P(r1, hw), P(r0, hw)) : quad(P(r0, -hw), P(r0, hw), P(r1, hw), P(r1, -hw)),
          spokes ? { c: BK.chrome, r: 0.3, m: 1 } : { c: 0x2a2b2e, r: 0.5 });
      }
    }
  }
}
// gương + ghi-đông + tay nắm (grip ở ±gx): cần gương mảnh chếch ra ngoài, mặt gương chữ nhật bo (hình bầu dục dẹt)
function handlebar(K, hy, hz, gx, my, det) {
  K.add(beam([gx, hy, hz], [-gx, hy, hz], 0.028, 0.028), { c: BK.black, r: 0.5 });
  for (const s of [-1, 1]) {
    K.add(seg([s * (gx - 0.02), hy, hz], [s * (gx + 0.08), hy, hz - 0.01], 0.019, 0.019, det > 1 ? 6 : 4, { fixed: true }), { c: BK.black, r: 0.7 });
    K.add(beam([s * (gx - 0.1), hy + 0.02, hz - 0.01], [s * (gx - 0.03), my, hz + 0.03], 0.012, 0.012), { c: BK.black, r: 0.4 });
    K.add(box(0.12, 0.07, 0.015, s * (gx - 0.03), my + 0.03, hz + 0.04, -0.2, s * 0.3, 0), { c: BK.black, r: 0.25 });
  }
}
export const BIKE_TYPES = ['scooter', 'underbone', 'bigscooter'];
// tham số dáng ngồi theo kiểu xe (tay nắm trái, mặt yên, bàn chân) — dùng cho cả người lái lẫn ước lượng chỗ ngồi
const RIDE = {
  scooter: { seat: [0.8, -0.2], seat2: [0.83, -0.62], grip: [0.31, 1.06, 0.38], foot: [0.12, 0.32, 0.16], foot2: [0.2, 0.36, -0.42], lean: 0.08, hb: [1.06, 0.4, 0.27, 1.3] },
  underbone: { seat: [0.84, -0.2], seat2: [0.86, -0.62], grip: [0.32, 1.06, 0.37], foot: [0.17, 0.3, 0.02], foot2: [0.2, 0.33, -0.45], lean: 0.16, hb: [1.05, 0.39, 0.28, 1.29] },
  bigscooter: { seat: [0.87, -0.22], seat2: [0.91, -0.66], grip: [0.33, 1.12, 0.4], foot: [0.13, 0.4, 0.16], foot2: [0.2, 0.44, -0.46], lean: 0.06, hb: [1.12, 0.44, 0.29, 1.36] },
};
// det: 2 = xe đỗ gần (props, đủ chi tiết), 1 = xe chạy có người (giao thông gần), 0 = rút gọn
export function motorbikeGeometry(type = 'scooter', { rider = 'none', lo = false, det = rider === 'ride' ? 1 : 2 } = {}) {
  if (lo) det = 0;
  const K = new Kit();
  const paint = { ch: CH.PAINT, r: 0.28 };
  const bv = det > 1 ? 0.03 : 0;   // xe chạy: không vát mép (−40% tam giác thân)
  const R = RIDE[type];
  // ốp yếm: hẹp ở chân (sàn), rộng ở gối (bề ngang tuyến tính theo y)
  const apronT = (y0, y1, k0) => (x, y) => k0 + (1 - k0) * clamp01((y - y0) / (y1 - y0));
  // đuôi xe thon dần về sau (tuyến tính theo z)
  const tailT = (z0, z1, k1) => (x, y, z) => 1 - (1 - k1) * clamp01((z0 - z) / (z0 - z1));
  if (type === 'scooter') {
    bikeWheel(K, 0.62, 0.27, 0.095, { det }); bikeWheel(K, -0.6, 0.27, 0.105, { det });
    K.add(slab([[0.3, 0.3], [0.41, 0.31], [0.53, 0.62], [0.585, 0.98], [0.5, 1.02], [0.43, 0.93], [0.36, 0.6], [0.27, 0.42]], 0.42, 0, bv, 1, apronT(0.32, 0.8, 0.55)), paint);   // yếm trước
    K.add(slab([[0.3, 0.27], [-0.14, 0.27], [-0.14, 0.34], [0.3, 0.36]], 0.32, 0, 0.015), { c: BK.floor, r: 0.8 });                                // sàn để chân
    K.add(slab([[-0.08, 0.3], [-0.3, 0.3], [-0.42, 0.46], [-0.78, 0.52], [-0.95, 0.63], [-0.94, 0.73], [-0.6, 0.8], [-0.14, 0.8], [-0.06, 0.58]], 0.34, 0, bv, 1, tailT(-0.45, -0.95, 0.55)), paint);   // thân sau
    K.add(slab([[-0.95, 0.74], [-0.88, 0.835], [-0.45, 0.865], [-0.2, 0.86], [-0.12, 0.8], [-0.92, 0.72]], 0.3, 0, 0.03, 1, tailT(-0.5, -0.95, 0.6)), { c: BK.seat, r: 0.55 });   // yên
    K.add(slab([[0.43, 0.48], [0.56, 0.54], [0.74, 0.54], [0.86, 0.46], [0.84, 0.42], [0.72, 0.5], [0.56, 0.5], [0.45, 0.44]], 0.12, 0, 0.01), paint);   // chắn bùn
    K.add(box(0.13, 0.2, 0.48, 0.1, 0.3, -0.42), { c: BK.engine, r: 0.6 });                        // hộp số/động cơ (trái)
    K.add(seg([-0.12, 0.3, -0.38], [-0.13, 0.36, -0.82], 0.045, 0.04, det > 1 ? 6 : 5), { c: BK.chrome, r: 0.35, m: 1 });   // ống xả (phải)
    K.add(beam([0, 0.27, 0.62], [0, 0.94, 0.52], 0.055, 0.05), { c: BK.dark, r: 0.5 });          // phuộc
    K.add(slab([[0.36, 0.94], [0.58, 0.98], [0.62, 1.06], [0.52, 1.12], [0.36, 1.1]], 0.34, 0, 0.03), paint);   // ốp đầu
    K.add(box(0.2, 0.06, 0.04, 0, 1.02, 0.6, 0.15), { c: BK.lens, ch: CH.HEAD, r: 0.1 });         // đèn pha
    K.add(box(0.16, 0.05, 0.04, 0, 0.66, -0.93), { c: BK.red, ch: CH.TAIL, r: 0.2 });
    if (det > 0) for (const s of [-1, 1]) K.add(box(0.05, 0.03, 0.03, s * 0.12, 0.69, -0.91), { c: BK.amber, ch: CH.AMBER, r: 0.2 });
    K.add(box(0.3, 0.025, 0.16, 0, 0.83, -0.82), { c: BK.chrome, r: 0.3, m: 1 });                // tay dắt sau
    K.add(box(0.18, 0.12, 0.015, 0, 0.47, -0.9, 0.2), { c: BK.plate, r: 0.6 });                   // biển số
  } else if (type === 'underbone') {
    bikeWheel(K, 0.63, 0.3, 0.075, { spokes: true, det }); bikeWheel(K, -0.62, 0.3, 0.085, { spokes: true, det });
    K.add(slab([[0.26, 0.42], [0.36, 0.44], [0.5, 0.86], [0.46, 0.94], [0.4, 0.88], [0.23, 0.5]], 0.38, 0, bv, 1, apronT(0.45, 0.85, 0.6)), paint);   // ốp chân
    K.add(beam([0, 0.6, 0.44], [0, 0.46, 0.02], 0.09, 0.1), paint);                                // khung xương sống
    K.add(box(0.22, 0.22, 0.32, 0, 0.33, 0.06), { c: BK.engine, r: 0.5 });                        // lốc máy
    K.add(seg([0.12, 0.42, 0.24], [-0.12, 0.42, 0.24], 0.075, 0.075, det > 1 ? 8 : 6, { fixed: true }), { c: 0x8e9298, r: 0.4, m: 1 });   // xi-lanh
    K.add(slab([[0.05, 0.5], [-0.25, 0.52], [-0.7, 0.66], [-0.92, 0.74], [-0.9, 0.8], [-0.15, 0.8], [0.08, 0.66]], 0.28, 0, bv, 1, tailT(-0.5, -0.92, 0.6)), paint);   // ốp thân sau
    K.add(slab([[-0.93, 0.79], [-0.88, 0.89], [-0.3, 0.915], [0.06, 0.885], [0.1, 0.82], [-0.88, 0.77]], 0.27, 0, 0.03, 1, tailT(-0.55, -0.93, 0.65)), { c: BK.seat, r: 0.55 });
    K.add(box(0.24, 0.02, 0.3, 0, 0.84, -0.87), { c: BK.chrome, r: 0.35, m: 1 });                 // baga sau
    K.add(slab([[0.4, 0.58], [0.55, 0.64], [0.74, 0.64], [0.9, 0.52], [0.88, 0.48], [0.74, 0.6], [0.55, 0.6], [0.42, 0.54]], 0.1, 0, 0.01), paint);
    for (const s of [-1, 1]) K.add(seg([s * 0.07, 0.3, 0.63], [s * 0.07, 0.93, 0.5], 0.021, 0.021, 5), { c: BK.chrome, r: 0.25, m: 1 });   // phuộc
    K.add(slab([[0.36, 0.92], [0.56, 0.96], [0.6, 1.04], [0.48, 1.09], [0.36, 1.06]], 0.27, 0, 0.03), paint);
    K.add(box(0.15, 0.08, 0.04, 0, 0.99, 0.58, 0.15), { c: BK.lens, ch: CH.HEAD, r: 0.1 });
    K.add(box(0.05, 0.1, 0.6, 0.12, 0.36, -0.32), { c: BK.black, r: 0.6 });                       // hộp xích
    K.add(seg([-0.13, 0.28, -0.1], [-0.14, 0.33, -0.8], 0.042, 0.038, det > 1 ? 6 : 5), { c: BK.chrome, r: 0.3, m: 1 });
    for (const s of [-1, 1]) K.add(seg([s * 0.13, 0.3, -0.6], [s * 0.13, 0.78, -0.48], 0.024, 0.024, 4), { c: BK.black, r: 0.5 });
    K.add(box(0.14, 0.05, 0.05, 0, 0.77, -0.96), { c: BK.red, ch: CH.TAIL, r: 0.2 });
    if (det > 0) for (const s of [-1, 1]) K.add(box(0.05, 0.03, 0.03, s * 0.13, 0.77, -0.94), { c: BK.amber, ch: CH.AMBER, r: 0.2 });
    K.add(box(0.18, 0.12, 0.015, 0, 0.6, -0.95, 0.15), { c: BK.plate, r: 0.6 });
    K.add(beam([0.2, 0.3, 0.03], [-0.2, 0.3, 0.03], 0.02, 0.02), { c: BK.black, r: 0.5 });       // gác chân
    // rổ trước kiểu xe Cub (cổng BASKET — chỉ xe đỗ)
    if (rider === 'none') K.add(tube([{ p: [0, 0.8, 0.72], rx: 0.17, rz: 0.13 }, { p: [0, 1.0, 0.74], rx: 0.18, rz: 0.14 }], 8, { capA: true, capB: false }), { c: 0x2b2b2b, gate: OPT.BASKET + 1, r: 0.6 });
  } else {   // bigscooter
    bikeWheel(K, 0.68, 0.3, 0.1, { det }); bikeWheel(K, -0.65, 0.29, 0.115, { det });
    K.add(slab([[0.31, 0.36], [0.42, 0.38], [0.58, 0.8], [0.63, 1.05], [0.52, 1.09], [0.46, 0.98], [0.38, 0.66], [0.27, 0.46]], 0.44, 0, bv, 1, apronT(0.4, 0.85, 0.58)), paint);
    K.add(slab([[0.28, 0.33], [-0.15, 0.33], [-0.15, 0.4], [0.28, 0.42]], 0.34, 0, 0.015), { c: BK.floor, r: 0.8 });
    K.add(slab([[-0.1, 0.34], [-0.34, 0.36], [-0.48, 0.58], [-0.84, 0.63], [-1.02, 0.73], [-1.0, 0.81], [-0.64, 0.87], [-0.14, 0.87], [-0.08, 0.66]], 0.35, 0, bv, 1, tailT(-0.5, -1.0, 0.5)), paint);
    K.add(slab([[-1.0, 0.82], [-0.92, 0.91], [-0.5, 0.945], [-0.2, 0.935], [-0.13, 0.87], [-0.98, 0.79]], 0.31, 0, 0.03, 1, tailT(-0.55, -1.0, 0.55)), { c: BK.seat, r: 0.55 });
    K.add(slab([[0.46, 0.55], [0.6, 0.62], [0.78, 0.62], [0.94, 0.52], [0.92, 0.48], [0.78, 0.58], [0.6, 0.58], [0.48, 0.51]], 0.13, 0, 0.01), paint);
    K.add(box(0.14, 0.22, 0.52, 0.11, 0.36, -0.44), { c: BK.engine, r: 0.6 });
    K.add(seg([-0.13, 0.34, -0.4], [-0.14, 0.42, -0.9], 0.05, 0.045, det > 1 ? 6 : 5), { c: BK.chrome, r: 0.3, m: 1 });
    K.add(beam([0, 0.3, 0.68], [0, 1.0, 0.58], 0.065, 0.06), { c: BK.dark, r: 0.5 });
    K.add(slab([[0.4, 1.0], [0.62, 1.04], [0.66, 1.12], [0.55, 1.18], [0.4, 1.16]], 0.38, 0, 0.03), paint);
    K.add(box(0.26, 0.05, 0.04, 0, 1.08, 0.65, 0.2), { c: BK.lens, ch: CH.HEAD, r: 0.1 });
    K.add(box(0.3, 0.14, 0.012, 0, 1.24, 0.6, -0.45), { c: 0x2a3036, r: 0.08 });                   // kính chắn gió nhỏ
    K.add(box(0.2, 0.05, 0.04, 0, 0.74, -0.99), { c: BK.red, ch: CH.TAIL, r: 0.2 });
    if (det > 0) for (const s of [-1, 1]) K.add(box(0.05, 0.03, 0.03, s * 0.12, 0.76, -0.97), { c: BK.amber, ch: CH.AMBER, r: 0.2 });
    K.add(box(0.32, 0.025, 0.18, 0, 0.9, -0.86), { c: BK.chrome, r: 0.3, m: 1 });
    K.add(box(0.18, 0.12, 0.015, 0, 0.52, -0.97, 0.2), { c: BK.plate, r: 0.6 });
    // thùng sau (cổng TOPBOX — chỉ xe đỗ; xe chạy dùng bit này cho hàng chở)
    if (rider === 'none') K.add(slab([[-1.04, 0.95], [-0.68, 0.95], [-0.7, 1.2], [-0.82, 1.27], [-1.02, 1.24]], 0.42, 0, 0.04), { c: 0x2b2c2f, gate: OPT.TOPBOX + 1, r: 0.4 });
  }
  handlebar(K, R.hb[0], R.hb[1], R.hb[2], R.hb[3], det);
  // Mũ bảo hiểm treo gương (xe đỗ, cổng MIRRORHELM)
  if (rider === 'none') K.add(ell([R.grip[0] - 0.02, R.grip[1] - 0.12, R.grip[2] + 0.02], 0.125, 0.115, 0.145, 8, 4, 0, Math.PI * 0.6), { ch: CH.HELM, gate: OPT.MIRRORHELM + 1, r: 0.3 });
  if (rider === 'ride') {
    person(K, riderJoints({ seat: R.seat, grip: R.grip, foot: R.foot, lean: R.lean }), { who: 'A', lo: true, rider: true, helmet: 'on', mask: OPT.MASK_A + 1, hair: OPT.HAIR_A + 1 });
    const JB = riderJoints({ seat: R.seat2, grip: R.grip, foot: R.foot2, lean: 0.02, handsOnLap: true });
    // người ngồi sau: mọi mảnh có cổng PILLION — dựng vào Kit tạm rồi gắn cổng
    const KB = new Kit();
    person(KB, JB, { who: 'B', lo: true, rider: true, helmet: 'on', mask: 0, hair: OPT.HAIR_B + 1 });
    for (const g of KB.parts) { const a = g.attributes.aKit; for (let i = 0; i < a.count; i++) if (a.getY(i) === 0) a.setY(i, OPT.PILLION + 1); K.parts.push(g); }
    // hàng chở sau yên (cổng CARGO): thùng xốp/các-tông buộc dây
    K.add(box(0.56, 0.42, 0.5, 0, 1.1, -0.74), { ch: CH.CARGO, gate: OPT.CARGO + 1, r: 0.85 });
    K.add(box(0.58, 0.03, 0.52, 0, 1.2, -0.74), { c: 0x2c2c30, gate: OPT.CARGO + 1, r: 0.8 });
  }
  const g = K.build();
  g.userData.shadow = [0.42, 1.12, 0.5];
  return g;
}
// LOD XA xe máy (+người lái): bóng dáng ~150 tam giác
export function motorbikeFarGeometry({ rider = true } = {}) {
  const K = new Kit();
  for (const z of [0.63, -0.6]) for (const s of [-1, 1]) K.add(disc(s * 0.05, 0.28, z, 0.28, s, 7), { c: BK.tyre, r: 0.9 });
  K.add(slab([[0.85, 0.45], [0.6, 1.02], [0.45, 1.02], [0.35, 0.55], [-0.1, 0.42], [-0.95, 0.62], [-0.95, 0.78], [-0.2, 0.84], [0.1, 0.6], [0.4, 0.4]], 0.34, 0, 0), { ch: CH.PAINT, r: 0.4 });
  K.add(box(0.64, 0.04, 0.04, 0, 1.06, 0.42), { c: BK.black });
  if (!rider) { K.add(box(0.28, 0.08, 0.7, 0, 0.84, -0.45), { c: BK.seat, r: 0.6 }); const g = K.build(); g.userData.shadow = [0.42, 1.12, 0.5]; return g; }
  K.add(tube([{ p: [0, 0.86, -0.22], rx: 0.15, rz: 0.1 }, { p: [0, 1.15, -0.12], rx: 0.17, rz: 0.11 }, { p: [0, 1.38, -0.05], rx: 0.16, rz: 0.09 }], 6), { ch: CH.TOP, r: 0.9 });
  K.add(ell([0, 1.53, 0.0], 0.11, 0.13, 0.12, 5, 3), { ch: CH.HELM, r: 0.4 });
  K.add(tube([{ p: [0, 0.88, -0.6], rx: 0.15, rz: 0.1 }, { p: [0, 1.15, -0.55], rx: 0.16, rz: 0.1 }, { p: [0, 1.36, -0.52], rx: 0.15, rz: 0.09 }], 6), { ch: CH.TOP2, gate: OPT.PILLION + 1, r: 0.9 });
  K.add(ell([0, 1.5, -0.5], 0.11, 0.13, 0.12, 5, 3), { ch: CH.HELM2, gate: OPT.PILLION + 1, r: 0.4 });
  for (const s of [-1, 1]) {
    K.add(beam([s * 0.17, 1.33, -0.1], [s * 0.3, 1.06, 0.38], 0.07, 0.07), { ch: CH.TOP, r: 0.9 });
    K.add(beam([s * 0.12, 0.85, -0.15], [s * 0.15, 0.62, 0.25], 0.1, 0.11), { ch: CH.BOT, r: 0.9 });
    K.add(beam([s * 0.15, 0.62, 0.25], [s * 0.14, 0.32, 0.12], 0.08, 0.08), { ch: CH.LOWLEG, r: 0.9 });
  }
  K.add(box(0.5, 0.38, 0.45, 0, 1.08, -0.74), { ch: CH.CARGO, gate: OPT.CARGO + 1, r: 0.9 });
  const g = K.build(); g.userData.shadow = [0.42, 1.12, 0.5]; return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Ô TÔ — thân = LOFT các mặt cắt dọc trục Z (bo góc trên/dưới, hông phình, vai thu vào, hốc bánh khoét THẬT theo
//    cung tròn quanh bánh) + nhà kính (kính tối phản chiếu trời, trụ A/B/C) + lốp tròn có hông + mâm hợp kim nan +
//    đèn pha/hậu (kênh đèn → sáng về đêm) + cản, lưới tản nhiệt, biển số, gương. 6 kiểu (+ taxi = cổng TAXI trên
//    sedan/hatch: hộp đèn TAXI chữ chung chung, không thương hiệu).
// ---------------------------------------------------------------------------------------------------------------------
const CK = { tyre: 0x151517, alloy: 0xb2b6bb, dark: 0x1e1f22, trim: 0x232427, glass: 0x0b0e12, lens: 0xb9c3ca, red: 0x9c1010, plate: 0xecebe2, chrome: 0xc9ccd0 };
export const CAR_TYPES = ['sedan', 'hatch', 'suv', 'mpv', 'van', 'truck'];
// thông số thật (m): dài, rộng, bán kính bánh, trục trước/sau (z), gầm, mũi [đáy, đỉnh], nắp ca-pô ở chân kính,
// vai xe, đuôi [đáy, đỉnh], nhà kính: z chân kính trước/đỉnh, đỉnh kính sau/chân, nóc, vai kính
const CARS = {
  sedan: { L: 4.42, W: 1.73, R: 0.305, zf: 1.32, zr: -1.25, clr: 0.17, nose: [0.38, 0.77], hood: 0.9, belt: 0.95, tail: [0.42, 0.99], deckZ: -1.55,
    gh: { zA: 0.62, zAt: -0.18, zCt: -1.06, zC: -1.52, roof: 1.46, beltW: 0.8, roofW: 0.64, cPaint: true } },
  hatch: { L: 3.72, W: 1.66, R: 0.295, zf: 1.2, zr: -1.18, clr: 0.16, nose: [0.38, 0.77], hood: 0.9, belt: 0.96, tail: [0.44, 1.0], deckZ: -1.84,
    gh: { zA: 0.6, zAt: -0.12, zCt: -1.5, zC: -1.8, roof: 1.5, beltW: 0.77, roofW: 0.62, cPaint: false } },
  suv: { L: 4.6, W: 1.85, R: 0.36, zf: 1.38, zr: -1.33, clr: 0.22, nose: [0.48, 0.98], hood: 1.08, belt: 1.12, tail: [0.52, 1.14], deckZ: -2.25,
    gh: { zA: 0.72, zAt: 0.02, zCt: -2.06, zC: -2.24, roof: 1.72, beltW: 0.86, roofW: 0.74, cPaint: false } },
  mpv: { L: 4.65, W: 1.78, R: 0.325, zf: 1.42, zr: -1.33, clr: 0.18, nose: [0.42, 0.88], hood: 1.02, belt: 1.05, tail: [0.46, 1.08], deckZ: -2.28,
    gh: { zA: 0.95, zAt: 0.12, zCt: -2.08, zC: -2.27, roof: 1.74, beltW: 0.83, roofW: 0.73, cPaint: false } },
  van: { L: 5.4, W: 1.98, R: 0.345, zf: 1.88, zr: -1.42, clr: 0.18, nose: [0.42, 0.98], hood: 1.12, belt: 1.18, tail: [0.48, 1.16], deckZ: -2.68,
    gh: { zA: 2.15, zAt: 1.5, zCt: -2.62, zC: -2.68, roof: 2.22, beltW: 0.93, roofW: 0.86, cPaint: false } },
  truck: { L: 4.9, W: 1.74, R: 0.3, zf: 1.72, zr: -1.0, clr: 0.22, nose: [0.42, 1.1], hood: 1.12, belt: 1.18, tail: [0.6, 0.98], deckZ: 1.0 },
};
// mặt cắt thân (vòng 16 điểm, đi CÙNG chiều) tại trạm z: w nửa rộng, yb đáy, yt đỉnh, tum = thu vai, rt bo vai
function carSection(z, w, yb, yt, tum, rt, crown) {
  const rb = Math.min(0.07, (yt - yb) * 0.25), h = yt - yb;
  const half = [
    [w - rb, yb], [w * 0.99, yb + rb], [w, yb + h * 0.42],
    [w - tum * 0.45, yt - rt * 1.2], [w - tum - rt, yt],
  ];
  const pts = [[0, yb, z]];
  for (const [x, y] of half) pts.push([x, y, z]);
  pts.push([0, yt + crown, z]);
  for (let k = half.length - 1; k >= 0; k--) pts.push([-half[k][0], half[k][1], z]);
  return pts;   // 1 + 5 + 1 + 5 = 12
}
// hệ số tối dần về gầm theo chỉ số điểm (AO giả: gầm/hốc bánh gần đen, hông sáng)
const SEC_SHADE = [0.12, 0.25, 0.8, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.25];
const lerpK = (keys, z) => {   // keys [[z,y]...] z giảm dần
  if (z >= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [z0, y0] = keys[i], [z1, y1] = keys[i + 1];
    if (z <= z0 && z >= z1) { const t = (z0 - z) / (z0 - z1 || 1); const s = t * t * (3 - 2 * t); return y0 + (y1 - y0) * (0.35 * t + 0.65 * s); }
  }
  return keys[keys.length - 1][1];
};
function carBody(K, T, { lo = false, topKeys, rtK = 0.08, tumK = 0.05 } = {}) {
  const { L, W, R, zf, zr, clr } = T, hw = W / 2, rA = R + 0.055;
  const zs = new Set();
  const add = (z) => zs.add(Math.round(z * 1000) / 1000);
  add(L / 2); add(L / 2 - 0.06); add(L / 2 - 0.18); add(L / 2 - 0.4); add(-L / 2); add(-L / 2 + 0.06); add(-L / 2 + 0.18); add(-L / 2 + 0.4);
  const nA = lo ? 2 : 5;
  for (const zw of [zf, zr]) {
    add(zw + rA + 0.012); add(zw + rA - 0.002); add(zw - rA + 0.002); add(zw - rA - 0.012);
    for (let k = 1; k < nA; k++) add(zw + rA - (2 * rA * k) / nA);
  }
  const span = (zf - rA) - (zr + rA);
  const nm = lo ? 1 : 3;
  for (let k = 1; k < nm; k++) add(zr + rA + (span * k) / nm);
  for (const z of T.extraZ || []) add(z);
  const list = [...zs].filter((z) => z <= L / 2 && z >= -L / 2).sort((a, b) => b - a);
  const bot = (z) => {
    const e = Math.max(0, Math.abs(z) - (L / 2 - 0.5)) / 0.5;   // 0 giữa → 1 mũi/đuôi
    let y = clr + (z > 0 ? T.nose[0] - clr : T.tail[0] - clr) * e * e;
    for (const zw of [zf, zr]) {
      const d = Math.abs(z - zw);
      if (d < rA) y = Math.max(y, R + Math.sqrt(rA * rA - d * d) * 0.96);
      else if (d < rA + 0.005) y = Math.max(y, R);
    }
    return y;
  };
  const sections = list.map((z) => {
    const e = Math.max(0, Math.abs(z) - (L / 2 - 0.62)) / 0.62;
    const w = hw * (1 - 0.085 * e * e) - (Math.abs(z) > L / 2 - 0.01 ? 0.05 : 0);
    const yt = lerpK(topKeys, z), yb = bot(z);
    return carSection(z, w, Math.min(yb, yt - 0.08), yt, tumK * (yt > T.belt - 0.05 ? 1 : 0.6), rtK * (0.8 + e), 0.015);
  });
  K.add(loft(sections, { shade: SEC_SHADE }), { ch: CH.PAINT, r: 0.32 });
  // khung gầm tối chặn nhìn xuyên qua hốc bánh
  K.add(box(W - 0.62, R * 1.6, L - 1.1, 0, clr + R * 0.8, (zf + zr) / 2), { c: 0x101012, r: 0.95 });
}
// nhà kính: 4 trạm (chân kính trước, đỉnh kính trước, đỉnh kính sau, chân kính sau); 4 điểm nửa mặt cắt
function greenhouse(K, T, { lo = false } = {}) {
  const g = T.gh, belt = T.belt;
  const st = [
    { z: g.zA, y0: belt, w0: g.beltW * 0.97, top: belt + 0.015, wt: g.beltW * 0.9 },
    { z: g.zAt, y0: belt, w0: g.beltW, top: g.roof, wt: g.roofW },
    { z: g.zCt, y0: belt, w0: g.beltW, top: g.roof, wt: g.roofW * 0.98 },
    { z: g.zC, y0: belt, w0: g.beltW * 0.96, top: belt + 0.015, wt: g.beltW * 0.88 },
  ];
  const ptsOf = (s) => (s.top - s.y0 < 0.1
    ? [[s.w0, s.y0], [s.w0 * 0.99, s.y0 + 0.004], [s.wt, s.y0 + 0.008], [0, s.y0 + 0.012]]
    : [[s.w0, s.y0], [s.wt, s.top - 0.05], [s.wt - 0.05, s.top], [0, s.top + 0.012]]);
  const glass = { c: CK.glass, r: 0.05 }, paint = { ch: CH.PAINT, r: 0.32 };
  const P3 = (s, k, sx) => { const p = ptsOf(s)[k]; return [sx * p[0], p[1], s.z]; };
  for (let i = 0; i < 3; i++) {
    const a = st[i], b = st[i + 1];
    for (const sx of [1, -1]) {
      // mặt hông (kính hông / trụ C sơn ở sedan): điểm 0→1
      const side = (sx > 0) ? quad(P3(a, 0, sx), P3(b, 0, sx), P3(b, 1, sx), P3(a, 1, sx)) : quad(P3(a, 0, sx), P3(a, 1, sx), P3(b, 1, sx), P3(b, 0, sx));
      K.add(side, i === 2 && g.cPaint ? paint : glass);
      // máng mép nóc 1→2 (sơn)
      const gut = (sx > 0) ? quad(P3(a, 1, sx), P3(b, 1, sx), P3(b, 2, sx), P3(a, 2, sx)) : quad(P3(a, 1, sx), P3(a, 2, sx), P3(b, 2, sx), P3(b, 1, sx));
      K.add(gut, i === 1 ? paint : glass);
      // mặt trên 2→3: kính lái (i=0), nóc (i=1), kính sau (i=2)
      const top = (sx > 0) ? quad(P3(a, 2, sx), P3(b, 2, sx), P3(b, 3, sx), P3(a, 3, sx)) : quad(P3(a, 2, sx), P3(a, 3, sx), P3(b, 3, sx), P3(b, 2, sx));
      K.add(top, i === 1 ? paint : glass);
    }
  }
  // trụ A (sơn), trụ B (đen), trụ C hatch/SUV (sơn)
  for (const sx of [1, -1]) {
    const a0 = P3(st[0], 0, sx), a1 = P3(st[1], 1, sx);
    K.add(beam([a0[0] * 1.005, a0[1], a0[2]], [a1[0] * 1.01, a1[1] + 0.03, a1[2]], 0.05, 0.075), paint);
    const zB = g.zAt + (g.zCt - g.zAt) * (T === CARS.van ? 0.25 : 0.42);
    K.add(beam([sx * (g.beltW + 0.004), belt, zB], [sx * (g.roofW + 0.004), g.roof - 0.04, zB], 0.03, 0.09), { c: CK.trim, r: 0.4 });
    if (!g.cPaint) { const c0 = P3(st[3], 0, sx), c1 = P3(st[2], 1, sx); K.add(beam([c0[0] * 1.005, c0[1], c0[2] + 0.06], [c1[0] * 1.01, c1[1] + 0.02, c1[2] - 0.02], 0.05, 0.13), paint); }
    if (T === CARS.van || T === CARS.mpv) {
      for (const f of [0.62, 0.8]) { const zc = g.zAt + (g.zCt - g.zAt) * f; K.add(beam([sx * (g.beltW + 0.004), belt, zc], [sx * (g.roofW + 0.004), g.roof - 0.04, zc], 0.03, 0.07), { c: CK.trim, r: 0.4 }); }
    }
    // gioăng đen chân kính
    if (!lo) K.add(beam([sx * (g.beltW + 0.006), belt + 0.01, g.zA - 0.05], [sx * (g.beltW + 0.006), belt + 0.01, g.zC + 0.05], 0.018, 0.025), { c: CK.trim, r: 0.4 });
  }
}
// lốp ô tô (hông + gai) + mâm hợp kim 5-7 nan (mặt NGOÀI) — trục X, tâm (x, R, z)
function carWheel(K, x, z, R, wdt, sx, { lo = false } = {}) {
  const n = lo ? 8 : 12, rr = R * 0.64;
  K.add(lo ? tube([{ p: [-wdt / 2, 0, 0], rx: R, rz: R }, { p: [wdt / 2, 0, 0], rx: R, rz: R }], n, { capA: false, capB: false, ref: [0, 0, 1], fixed: true }).translate(x, R, z) : tyre(x, R, z, R, wdt, rr, 14, 0.045), { c: CK.tyre, r: 0.88 });
  // mâm hợp kim: vành ngoài bạc, 6 nan bạc trên nền hốc tối (lùi vào 5 cm), ổ trục — chỉ mặt NGOÀI (sx)
  const face = x + sx * (wdt / 2 - 0.025);
  if (!lo) {
    K.add(disc(face, R, z, rr, sx, n, rr - 0.035), { c: CK.alloy, r: 0.3, m: 1 });
    K.add(disc(face - sx * 0.05, R, z, rr - 0.03, sx, n), { c: 0x16171a, r: 0.7 });
    const ns = 6;
    for (let k = 0; k < ns; k++) {
      const a0 = (k / ns) * Math.PI * 2, a1 = a0 + (Math.PI / ns) * 0.5;
      const Pn = (a, r, d) => [face - sx * d, R + Math.cos(a) * r, z + Math.sin(a) * r];
      const q = sx > 0 ? quad(Pn(a0, 0.07, 0.01), Pn(a0, rr - 0.03, 0.02), Pn(a1, rr - 0.03, 0.02), Pn(a1, 0.07, 0.01))
        : quad(Pn(a0, 0.07, 0.01), Pn(a1, 0.07, 0.01), Pn(a1, rr - 0.03, 0.02), Pn(a0, rr - 0.03, 0.02));
      K.add(q, { c: CK.alloy, r: 0.3, m: 1 });
    }
    K.add(disc(face + sx * 0.004, R, z, 0.075, sx, 8), { c: CK.alloy, r: 0.3, m: 1, shade: 0.9 });
  } else {
    K.add(disc(face, R, z, rr, sx, n), { c: CK.alloy, r: 0.4, m: 1, shade: 0.75 });
  }
}
// MẶT TRƯỚC/SAU: cụm đèn pha ôm góc (kính trong, kênh HEAD → sáng đêm), lưới tản nhiệt tối + nẹp crôm, hốc gió
// cản dưới, biển số; đuôi: cụm đèn hậu đỏ 2 tầng, cản sau tối, biển số. wF/wR = nửa rộng mặt mũi/đuôi đang vẽ.
function carFace(K, T, { lo = false, wN, wT, yF, yR, hF = 0.14, hR = 0.15, grilleH = 0.12, tallRear = false }) {
  const zF = T.L / 2, zR = -T.L / 2;
  for (const s of [-1, 1]) {
    // đèn pha: khối thuôn ôm từ mặt trước sang hông (2 mảnh: mặt trước + phần vát góc)
    K.add(box(0.3, hF, 0.06, s * (wN - 0.2), yF, zF - 0.01, -0.12, s * 0.12, 0), { c: CK.lens, ch: CH.HEAD, r: 0.2 });
    K.add(box(0.04, hF * 0.85, 0.22, s * (wN - 0.035), yF, zF - 0.14, -0.1, 0, 0), { c: CK.lens, ch: CH.HEAD, r: 0.2 });
    if (!lo) K.add(box(0.07, 0.035, 0.05, s * (wN - 0.08), yF - hF * 0.5 - 0.03, zF - 0.02), { c: 0xd08a28, ch: CH.AMBER, r: 0.2 });
    // đèn hậu
    K.add(box(0.32, hR, 0.06, s * (wT - 0.18), yR, zR + 0.01, 0, -s * 0.1, 0), { c: CK.red, ch: CH.TAIL, r: 0.15 });
    K.add(box(0.04, hR * 0.9, 0.16, s * (wT - 0.025), yR, zR + 0.1), { c: CK.red, ch: CH.TAIL, r: 0.15 });
    if (tallRear) K.add(box(0.12, 0.3, 0.05, s * (wT - 0.08), yR - 0.02, zR + 0.012), { c: CK.red, ch: CH.TAIL, r: 0.15 });   // đèn hậu dựng đứng (xe 16 chỗ)
  }
  // lưới tản nhiệt + nẹp
  K.add(box((wN - 0.36) * 2, grilleH, 0.05, 0, yF - 0.01, zF + 0.0), { c: 0x141518, r: 0.55 });
  if (!lo) K.add(box((wN - 0.36) * 2, 0.025, 0.06, 0, yF + grilleH * 0.5 - 0.005, zF + 0.002), { c: CK.chrome, r: 0.25, m: 1 });
  // cản dưới: hốc gió tối + biển số
  K.add(box(wN * 1.25, 0.08, 0.05, 0, T.nose[0] + 0.07, zF - 0.01), { c: 0x141518, r: 0.6 });
  K.add(box(0.52, 0.12, 0.02, 0, T.nose[0] + 0.2, zF + 0.012), { c: CK.plate, r: 0.6 });
  K.add(box(wT * 1.7, 0.09, 0.05, 0, T.tail[0] + 0.06, zR + 0.01), { c: 0x1a1b1e, r: 0.6 });
  K.add(box(0.52, 0.12, 0.02, 0, T.tail[0] + 0.24, zR - 0.012), { c: CK.plate, r: 0.6 });
}
export function carGeometry(type = 'sedan', { lo = false } = {}) {
  const T = CARS[type], K = new Kit();
  const { L, W, R } = T, hw = W / 2;
  const wx = hw - 0.115, tw = type === 'van' || type === 'suv' ? 0.23 : 0.2;
  if (type === 'truck') return truckGeometry(T, lo);
  const topKeys = [[L / 2, T.nose[1]], [L / 2 - 0.14, T.nose[1] + 0.06], [L / 2 - 0.45, T.hood - 0.06], [T.gh.zA, T.hood], [T.gh.zA - 0.3, T.belt], [T.gh.zC, T.belt + 0.02], [T.deckZ, T.tail[1]], [-L / 2, T.tail[1] - 0.06]];
  if (type === 'van') topKeys.splice(2, 0, [L / 2 - 0.3, T.nose[1] + 0.1]);
  carBody(K, T, { lo, topKeys, rtK: type === 'van' ? 0.06 : 0.09, tumK: type === 'suv' || type === 'van' ? 0.03 : 0.05 });
  greenhouse(K, T, { lo });
  for (const z of [T.zf, T.zr]) for (const s of [-1, 1]) carWheel(K, s * wx, z, R, tw, s, { lo });
  // mặt trước/sau — nửa rộng mặt cắt mũi/đuôi đúng như thân loft (w·(1−0,085) − 0,05)
  const wTip = hw * 0.915 - 0.05;
  carFace(K, T, { lo, wN: wTip, wT: wTip, yF: T.nose[1] - 0.1, yR: T.tail[1] - 0.12, hF: type === 'van' ? 0.18 : 0.14, hR: 0.14, tallRear: type === 'van' });
  // gương chiếu hậu (sơn, mặt kính tối)
  for (const s of [-1, 1]) {
    const zM = T.gh.zA - 0.12, yM = T.belt + 0.1;
    K.add(beam([s * (hw - 0.06), yM - 0.03, zM], [s * (hw + 0.1), yM, zM - 0.04], 0.04, 0.05), { ch: CH.PAINT, r: 0.35 });
    K.add(box(0.12, 0.1, 0.05, s * (hw + 0.13), yM + 0.02, zM - 0.05), { ch: CH.PAINT, r: 0.35 });
  }
  // tay nắm cửa (nét tối) — gần mới thấy
  if (!lo) for (const s of [-1, 1]) for (const z of [T.gh.zAt - 0.25, (T.gh.zAt + T.gh.zCt) / 2 - 0.2]) K.add(box(0.02, 0.025, 0.14, s * (hw - 0.005), T.belt - 0.08, z), { c: CK.trim, r: 0.3 });
  // TAXI: hộp đèn trên nóc (cổng TAXI) — chữ chung, không thương hiệu
  if (type === 'sedan' || type === 'hatch') {
    const zR = (T.gh.zAt + T.gh.zCt) / 2;
    K.add(slab([[zR + 0.2, T.gh.roof + 0.01], [zR - 0.2, T.gh.roof + 0.01], [zR - 0.17, T.gh.roof + 0.15], [zR + 0.17, T.gh.roof + 0.15]], 0.48, 0, 0.02), { c: 0xfff1b8, ch: CH.SIGN, gate: OPT.TAXI + 1, r: 0.3 });
  }
  // giá nóc SUV/MPV (cổng RACK)
  if (type === 'suv' || type === 'mpv') for (const s of [-1, 1]) K.add(box(0.04, 0.05, (T.gh.zAt - T.gh.zCt) * 0.85, s * (T.gh.roofW - 0.1), T.gh.roof + 0.04, (T.gh.zAt + T.gh.zCt) / 2), { c: CK.trim, gate: OPT.RACK + 1, r: 0.4 });
  const g = K.build();
  g.userData.shadow = [hw + 0.18, L / 2 + 0.18, 0.6];
  g.userData.len = L;
  return g;
}
// XE TẢI NHỎ (tải 1-1,5 t, ca-bin bán đầu dài, thùng bạt) — ca-bin sơn, bạt = kênh CARGO (xanh/lục/xám)
function truckGeometry(T, lo) {
  const K = new Kit();
  const { L, W, R } = T, hw = W / 2, cabB = L / 2 - 1.55;
  // ca-bin: loft riêng (z L/2 → cabB)
  const cabTop = [[L / 2, 1.12], [L / 2 - 0.1, 1.2], [L / 2 - 0.42, 1.36], [L / 2 - 0.95, 1.96], [cabB, 1.98]];
  const zs = [L / 2, L / 2 - 0.05, L / 2 - 0.2, L / 2 - 0.42, L / 2 - 0.7, L / 2 - 0.95, L / 2 - 1.2, cabB + 0.02, cabB];
  const rA = R + 0.05;
  const secs = zs.map((z) => {
    let yb = 0.5; const d = Math.abs(z - T.zf);
    if (d < rA) yb = Math.max(yb, R + Math.sqrt(rA * rA - d * d) * 0.96);
    const e = Math.max(0, z - (L / 2 - 0.4)) / 0.4;
    return carSection(z, hw * (1 - 0.06 * e * e), yb, lerpK(cabTop, z), 0.04, 0.08, 0.01);
  });
  K.add(loft(secs, { shade: SEC_SHADE }), { ch: CH.PAINT, r: 0.35 });
  // kính lái + kính cửa
  const yW0 = 1.38, yW1 = 1.9, zW0 = L / 2 - 0.44, zW1 = L / 2 - 0.92;
  K.add(quad([hw - 0.1, yW0, zW0], [hw - 0.14, yW1, zW1], [-(hw - 0.14), yW1, zW1], [-(hw - 0.1), yW0, zW0]).translate(0, 0.008, 0.012), { c: CK.glass, r: 0.05 });
  for (const s of [-1, 1]) K.add((s > 0 ? quad([hw + 0.004, 1.3, zW0 - 0.05], [hw + 0.004, 1.3, cabB + 0.12], [hw - 0.02, 1.88, cabB + 0.12], [hw - 0.02, 1.88, zW1 - 0.02]) : quad([-hw - 0.004, 1.3, zW0 - 0.05], [-hw + 0.02, 1.88, zW1 - 0.02], [-hw + 0.02, 1.88, cabB + 0.12], [-hw - 0.004, 1.3, cabB + 0.12])), { c: CK.glass, r: 0.05 });
  // sàn thùng + bạt (mái vòm) + khung
  const bedF = cabB - 0.08, bedR = -L / 2 + 0.05, bedY = 0.82;
  K.add(box(W, 0.12, bedF - bedR, 0, bedY, (bedF + bedR) / 2), { c: CK.dark, r: 0.7 });
  K.add(box(W - 0.04, 0.42, bedF - bedR - 0.02, 0, bedY + 0.27, (bedF + bedR) / 2), { c: 0x8a8f94, r: 0.45, m: 1 });   // thành thùng nhôm
  // bạt mui vòm: vòng 10 điểm (đáy giữa → hông +X lên → đỉnh → hông −X xuống), loft trước → sau
  const half = [[hw - 0.04, bedY + 0.48], [hw - 0.02, 1.95], [hw - 0.12, 2.18], [hw * 0.5, 2.27]];
  const cv = [bedF - 0.02, bedR + 0.02].map((z) => [[0, bedY + 0.48, z], ...half.map(([x, y]) => [x, y, z]), [0, 2.3, z], ...half.slice().reverse().map(([x, y]) => [-x, y, z])]);
  K.add(loft(cv), { ch: CH.CARGO, r: 0.9 });
  for (const z of [T.zf]) for (const s of [-1, 1]) carWheel(K, s * (hw - 0.12), z, R, 0.19, s, { lo });
  for (const s of [-1, 1]) { carWheel(K, s * (hw - 0.17), T.zr, R, 0.18, s, { lo: true }); }
  K.add(box(W - 0.5, 0.3, L - 1.2, 0, 0.45, 0), { c: 0x101012, r: 0.95 });
  // chắn bùn sau
  for (const s of [-1, 1]) K.add(box(0.26, 0.06, 0.75, s * (hw - 0.15), R * 2 + 0.06, T.zr), { c: CK.dark, r: 0.7 });
  K.add(box(W * 0.9, 0.14, 0.12, 0, 0.5, L / 2 - 0.04), { c: CK.dark, r: 0.6 });   // cản trước thép
  carFace(K, T, { lo, wN: hw * 0.94 - 0.05, wT: hw - 0.02, yF: 0.98, yR: 0.72 });
  for (const s of [-1, 1]) {
    K.add(beam([s * hw, 1.5, L / 2 - 0.5], [s * (hw + 0.16), 1.55, L / 2 - 0.55], 0.03, 0.03), { c: CK.trim });
    K.add(box(0.06, 0.22, 0.12, s * (hw + 0.18), 1.5, L / 2 - 0.56), { c: CK.trim, r: 0.3 });
  }
  const g = K.build();
  g.userData.shadow = [hw + 0.18, L / 2 + 0.18, 0.62];
  g.userData.len = L;
  return g;
}
// LOD XA ô tô: thân loft thô + nhà kính + 4 bánh — CHUNG cho mọi kiểu (instance scale theo kích thước kiểu)
export function carFarGeometry() {
  const K = new Kit();
  const L = 4.4, hw = 0.88, R = 0.31;
  // thân: 7 trạm × mặt cắt 8 điểm (mũi thấp, ca-pô, thân, cốp), đáy cao tại 2 trục bánh (gợi hốc bánh)
  const st = [[2.2, 0.36, 0.7, 0.8], [1.9, 0.28, 0.84, 0.97], [1.32, 0.62, 0.88, 1], [0.6, 0.2, 0.92, 1], [-0.6, 0.2, 0.95, 1], [-1.28, 0.62, 0.96, 1], [-2.0, 0.3, 0.97, 0.97], [-2.2, 0.42, 0.92, 0.82]];
  const sec = ([z, yb, yt, k]) => { const w = hw * k; return [[0, yb, z], [w - 0.06, yb, z], [w, yb + 0.08, z], [w, yt - 0.12, z], [w - 0.07, yt, z], [0, yt + 0.01, z], [-w + 0.07, yt, z], [-w, yt - 0.12, z], [-w, yb + 0.08, z], [-w + 0.06, yb, z]]; };
  K.add(loft(st.map(sec), { shade: [0.15, 0.3, 0.8, 1, 1, 1, 1, 1, 0.8, 0.3] }), { ch: CH.PAINT, r: 0.35 });
  // nhà kính: khối thang (kính) + nóc sơn
  const gh = (z, y, w) => [[w, 0.92, z], [w * 0.82, y, z], [-w * 0.82, y, z], [-w, 0.92, z]];
  K.add(loft([gh(0.62, 0.93, 0.8), gh(-0.12, 1.46, 0.8), gh(-1.42, 1.46, 0.8), gh(-1.78, 0.97, 0.8)], { c: CK.glass }), { c: CK.glass, r: 0.08 });
  K.add(box(1.24, 0.03, 1.25, 0, 1.47, -0.77), { ch: CH.PAINT, r: 0.35 });
  for (const z of [1.32, -1.28]) for (const sx of [-1, 1]) K.add(disc(sx * (hw - 0.02), R, z, R, sx, 8), { c: CK.tyre, r: 0.9 });
  for (const s2 of [-1, 1]) { K.add(box(0.32, 0.1, 0.05, s2 * 0.55, 0.62, 2.19), { c: CK.lens, ch: CH.HEAD }); K.add(box(0.28, 0.12, 0.05, s2 * 0.6, 0.82, -2.19), { c: CK.red, ch: CH.TAIL }); }
  const g = K.build(); g.userData.shadow = [1.06, 2.38, 0.55]; return g;
}
// RẤT XA (> ~260 m, xe vài px): hộp thân + hộp kính — ~30 tam giác
export function carFar2Geometry() {
  const K = new Kit();
  K.add(box(1.74, 0.56, 4.36, 0, 0.6, 0), { ch: CH.PAINT, r: 0.4 });
  K.add(box(1.5, 0.52, 2.2, 0, 1.13, -0.4), { c: CK.glass, r: 0.1 });
  K.add(box(1.46, 0.03, 1.9, 0, 1.4, -0.45), { ch: CH.PAINT, r: 0.4 });
  const g = K.build(); g.userData.shadow = [1.06, 2.38, 0.55]; return g;
}
export const CAR_FAR_SCALE = { sedan: [1.0, 1.0, 1.0], hatch: [0.85, 1.02, 0.95], suv: [1.05, 1.16, 1.05], mpv: [1.06, 1.18, 1.01], van: [1.23, 1.5, 1.12], truck: [1.12, 1.55, 0.99] };

// ---------------------------------------------------------------------------------------------------------------------
// 5. NGƯỜI ĐI BỘ instanced (1 mô hình + cổng: nón lá, mũ lưỡi trai, tóc dài, khẩu trang, túi, váy; dáng đi/đứng/ngồi
//    do vertex shader) — chi gán id để xoay quanh khớp
// ---------------------------------------------------------------------------------------------------------------------
export function pedestrianFarGeometry() {
  const K = new Kit();
  const J = restJoints();
  K.add(tube([{ p: [0, 0.8, 0], rx: 0.14, rz: 0.1 }, { p: [0, 1.0, 0], rx: 0.15, rz: 0.1 }], 5, { capA: true, capB: false }), { ch: CH.BOT, r: 0.9 });
  K.add(tube([{ p: [0, 1.0, 0], rx: 0.15, rz: 0.1 }, { p: [0, 1.38, 0], rx: 0.18, rz: 0.1 }, { p: [0, 1.46, 0], rx: 0.07, rz: 0.06 }], 5, { capA: false, capB: true }), { ch: CH.TOP, limb: 9, r: 0.9 });
  K.add(ell([0, SK.headY, SK.headZ], 0.08, 0.115, 0.098, 6, 4), { ch: CH.SKIN, limb: 10, r: 0.7 });
  K.add(ell([0, SK.headY + 0.012, -0.01], 0.086, 0.118, 0.104, 6, 3, 0, Math.PI * 0.5), { ch: CH.HAIR, limb: 10, r: 0.7 });
  K.add(ell([0, SK.headY - 0.1, -0.07], 0.07, 0.13, 0.04, 4, 3), { ch: CH.HAIR, gate: OPT.HAIR_A + 1, limb: 10, r: 0.7 });
  K.add(tube([{ p: [0, SK.headY + 0.06, 0], rx: 0.235, rz: 0.235 }, { p: [0, SK.headY + 0.215, 0], rx: 0.005, rz: 0.005 }], 8, { capA: true, capB: false, ref: [1, 0, 0], fixed: true }), { c: 0xd8c48c, gate: OPT.NONLA + 1, limb: 10, r: 0.85 });
  K.add(ell([0, SK.headY + 0.035, 0.0], 0.092, 0.1, 0.106, 6, 2, 0, Math.PI * 0.5), { ch: CH.BAG, gate: OPT.CAP + 1, limb: 10, r: 0.85 });
  for (const [sd, sx, lt, la] of [['L', 1, 1, 5], ['R', -1, 2, 6]]) {
    K.add(tube([{ p: J['hip' + sd], rx: 0.075, rz: 0.08 }, { p: J['kn' + sd], rx: 0.055, rz: 0.06 }, { p: [sx * SK.anX, 0.03, 0.02], rx: 0.045, rz: 0.07 }], 4, { capA: false }), { ch: CH.LOWLEG, limb: lt, r: 0.9 });
    K.add(tube([{ p: J['sh' + sd], rx: 0.048, rz: 0.048 }, { p: J['el' + sd], rx: 0.038, rz: 0.038 }, { p: [sx * SK.wrX, SK.wrY - 0.08, SK.wrZ], rx: 0.03, rz: 0.03 }], 4, { capA: false }), { ch: CH.FOREARM, limb: la, r: 0.9 });
  }
  const g = K.build(); g.userData.shadow = [0.3, 0.26, 0.42]; return g;
}
export function pedestrianGeometry({ lo = false } = {}) {
  const K = new Kit();
  person(K, restJoints(), { who: 'A', lo, limbs: true, nonla: OPT.NONLA + 1, cap: OPT.CAP + 1, hair: OPT.HAIR_A + 1, mask: OPT.MASK_A + 1, bag: OPT.BAG + 1 });
  const g = K.build(); g.userData.shadow = [0.3, 0.26, 0.42]; return g;
}

// BÓNG TIẾP ĐẤT mềm (dùng chung giao thông): đĩa đơn vị, alpha theo đỉnh — instance scale (rx, 1, rz)
export function contactShadowGeometry(rx = 1, rz = 1, a = 1) {
  const g = mergeGeometries([new THREE.CircleGeometry(0.5, 18), new THREE.RingGeometry(0.5, 1, 18, 2)], false);
  const Pp = g.attributes.position, n = Pp.count, al = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(Pp.getX(i), Pp.getY(i));
    al[i] = r <= 0.501 ? a : a * Math.pow(Math.max(0, (1 - r) / 0.5), 1.3);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.setAttribute('aSA', new THREE.BufferAttribute(al, 1));
  g.rotateX(-Math.PI / 2).scale(rx, 1, rz).translate(0, 0.02, 0);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. VẬT LIỆU KIT: MeshStandard (TIER ≥ 2: sơn bóng + kính phản chiếu IBL trời của daynight) hoặc Lambert (LITE),
//    vertex colour × kênh, cổng, dáng đi/ngồi, đèn xe tự sáng theo uNight. Mọi InstancedMesh dùng kit chung chương trình.
//    Thuộc tính instance: instanceColor (sơn / áo người đi bộ), aShirt/aShirt2 (áo người A/B), aOpt (bit + hạt giống);
//    dáng đi: 'cpu' (giao thông: aPhase + aWalk = nhịp rad/s; CPU dời vị trí) | 'path' (props: aPath = [L, tốc độ,
//    pha, nghỉ] — đi qua-lại trên GPU, 0 CPU/khung).
// ---------------------------------------------------------------------------------------------------------------------
export const KIT_U = { uKitTime: { value: 0 }, uNight: { value: 0 } };
const PALU = Object.fromEntries(Object.entries(PAL).map(([k, a]) => ['uKit_' + k, { value: P(a) }]));
const f3 = (v) => v.toFixed(4);
const GL_HEAD = /* glsl */`
attribute vec4 aKit;
attribute float aOpt;
#ifdef KIT_SHIRTS
attribute vec3 aShirt;
attribute vec3 aShirt2;
#endif
#ifdef KIT_WALK_CPU
attribute float aPhase;
attribute float aWalk;
#endif
#ifdef KIT_WALK_PATH
attribute vec4 aPath;
#endif
uniform float uKitTime;
${Object.entries(PAL).map(([k, a]) => `uniform vec3 uKit_${k}[${a.length}];`).join('\n')}
varying vec2 vKitRM;
varying float vKitLamp;
float kitBit(float b) { return mod(floor(aOpt / exp2(b)) + 0.5, 2.0) > 1.0 ? 1.0 : 0.0; }
float kitH(float k) { float s = floor(aOpt / 8192.0); return fract(sin(s * 12.9898 + k * 78.233 + 0.5) * 43758.5453); }
#define KIT_PICK(arr, n, k) arr[int(min(kitH(k) * float(n), float(n) - 0.5))]
float kitGate() {
  float g = aKit.y;
  if (g > 0.5) return kitBit(g - 1.0);
  if (g < -0.5) return 1.0 - kitBit(-g - 1.0);
  return 1.0;
}
vec3 kitRot(vec3 p, vec3 piv, float a) {   // xoay quanh trục X qua khớp piv
  float c = cos(a), s = sin(a); vec3 q = p - piv;
  return piv + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
}
vec3 kitRotN(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c); }
// tư thế: ph pha bước (rad), amp 0..1 (0 = đứng), sit 0/1 — khớp từ SK (models_kit.js)
void kitPose(inout vec3 p, inout vec3 n, float ph, float amp, float sit) {
  float L = aKit.z;
  if (L < 0.5 && sit < 0.5 && amp < 0.001) return;
  float sn = sin(ph), cs = cos(ph);
  float hipL = -0.42 * amp * sn, hipR = 0.42 * amp * sn;
  float knL = amp * (0.06 + 0.62 * pow(max(0.0, cs), 1.5)), knR = amp * (0.06 + 0.62 * pow(max(0.0, -cs), 1.5));
  float shL = 0.34 * amp * sn, shR = -0.34 * amp * sn;
  float elL = -(0.16 + 0.32 * amp * max(0.0, -sn)), elR = -(0.16 + 0.32 * amp * max(0.0, sn));
  float lean = 0.04 * amp;
  if (sit > 0.5) { hipL = -1.9; hipR = -1.82; knL = 1.9; knR = 1.84; shL = -0.55; shR = -0.62; elL = -0.95; elR = -0.9; lean = 0.14; }
  const vec3 HL = vec3(${f3(SK.hipX)}, ${f3(SK.hipY)}, 0.0), HR = vec3(${f3(-SK.hipX)}, ${f3(SK.hipY)}, 0.0);
  const vec3 KL = vec3(${f3(SK.knX)}, ${f3(SK.knY)}, ${f3(SK.knZ)}), KR = vec3(${f3(-SK.knX)}, ${f3(SK.knY)}, ${f3(SK.knZ)});
  const vec3 SL = vec3(${f3(SK.shX)}, ${f3(SK.shY)}, ${f3(SK.shZ)}), SR = vec3(${f3(-SK.shX)}, ${f3(SK.shY)}, ${f3(SK.shZ)});
  const vec3 EL = vec3(${f3(SK.elX)}, ${f3(SK.elY)}, ${f3(SK.elZ)}), ER = vec3(${f3(-SK.elX)}, ${f3(SK.elY)}, ${f3(SK.elZ)});
  const vec3 WA = vec3(0.0, ${f3(SK.waistY)}, 0.0);
  if (L > 0.5 && L < 1.5) { p = kitRot(p, HL, hipL); n = kitRotN(n, hipL); }
  else if (L > 1.5 && L < 2.5) { p = kitRot(p, HR, hipR); n = kitRotN(n, hipR); }
  else if (L > 2.5 && L < 3.5) { p = kitRot(kitRot(p, KL, knL), HL, hipL); n = kitRotN(n, knL + hipL); }
  else if (L > 3.5 && L < 4.5) { p = kitRot(kitRot(p, KR, knR), HR, hipR); n = kitRotN(n, knR + hipR); }
  else if (L > 4.5 && L < 5.5) { p = kitRot(kitRot(p, SL, shL), WA, lean); n = kitRotN(n, shL + lean); }
  else if (L > 5.5 && L < 6.5) { p = kitRot(kitRot(p, SR, shR), WA, lean); n = kitRotN(n, shR + lean); }
  else if (L > 6.5 && L < 7.5) { p = kitRot(kitRot(kitRot(p, EL, elL), SL, shL), WA, lean); n = kitRotN(n, elL + shL + lean); }
  else if (L > 7.5 && L < 8.5) { p = kitRot(kitRot(kitRot(p, ER, elR), SR, shR), WA, lean); n = kitRotN(n, elR + shR + lean); }
  else if (L > 8.5) { p = kitRot(p, WA, lean); n = kitRotN(n, lean); }
  // chân trụ không nhấc khỏi đất khi đùi xoay: hạ cả người theo cos góc hông lớn nhất; ngồi: hạ hông xuống mặt ghế
  p.y -= sit > 0.5 ? 0.53 : 0.81 * (1.0 - cos(max(abs(hipL), abs(hipR))));
}
`;
const GL_COLOR = /* glsl */`
#if defined( USE_COLOR_ALPHA )
  vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
{
  float ch = aKit.x;
  vec3 t = vec3(1.0);
  vec3 iCol = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  iCol = instanceColor.xyz;
#endif
  vec3 sA = iCol, sB = iCol;
#ifdef KIT_SHIRTS
  sA = aShirt; sB = aShirt2;
#endif
  vec3 skinA = KIT_PICK(uKit_skin, ${PAL.skin.length}, 2.0), skinB = KIT_PICK(uKit_skin, ${PAL.skin.length}, 12.0);
  if (ch < 0.5) {}
  else if (ch < 1.5) t = iCol;
  else if (ch < 2.5) t = sA;
  else if (ch < 3.5) t = KIT_PICK(uKit_helm, ${PAL.helm.length}, 1.0);
  else if (ch < 4.5) t = sB;
  else if (ch < 6.5) {}
  else if (ch < 7.5) t = skinA;
  else if (ch < 8.5) t = KIT_PICK(uKit_hair, ${PAL.hair.length}, 3.0);
  else if (ch < 9.5) t = KIT_PICK(uKit_bot, ${PAL.bot.length}, 4.0);
  else if (ch < 10.5) t = KIT_PICK(uKit_helm, ${PAL.helm.length}, 11.0);
  else if (ch < 11.5) t = KIT_PICK(uKit_bot, ${PAL.bot.length}, 14.0);
  else if (ch < 12.5) t = KIT_PICK(uKit_mask, ${PAL.mask.length}, 7.0);
  else if (ch < 13.5) t = skinB;
  else if (ch < 14.5) t = KIT_PICK(uKit_hair, ${PAL.hair.length}, 13.0);
  else if (ch < 15.5) t = KIT_PICK(uKit_cargo, ${PAL.cargo.length}, 10.0);
  else if (ch < 16.5) {}
  else if (ch < 17.5) t = KIT_PICK(uKit_shoe, ${PAL.shoe.length}, 8.0);
  else if (ch < 18.5) t = kitBit(${OPT.SHORTS_A}.0) > 0.5 ? skinA : KIT_PICK(uKit_bot, ${PAL.bot.length}, 4.0);
  else if (ch < 19.5) t = kitBit(${OPT.SLEEVE_A}.0) > 0.5 ? sA : skinA;
  else if (ch < 20.5) t = KIT_PICK(uKit_bag, ${PAL.bag.length}, 9.0);
  else if (ch < 21.5) t = kitBit(${OPT.SLEEVE_B}.0) > 0.5 ? sB : skinB;
  else if (ch < 22.5) t = kitBit(${OPT.SHORTS_B}.0) > 0.5 ? skinB : KIT_PICK(uKit_bot, ${PAL.bot.length}, 14.0);
  else if (ch < 23.5) {}
  else t = KIT_PICK(uKit_shoe, ${PAL.shoe.length}, 18.0);
#ifdef USE_COLOR
  vColor.xyz = color * t;
#endif
  vKitLamp = kitBit(${OPT.PARKED}.0) > 0.5 ? 0.0 : (ch > 4.5 && ch < 6.5) ? ch - 4.0 : (ch > 15.5 && ch < 16.5) ? 3.0 : (ch > 22.5 && ch < 23.5) ? 4.0 : 0.0;
  float m = step(1.5, aKit.w);
  vKitRM = vec2(aKit.w - 2.0 * m, m);
}
`;
function walkCode(depth) {
  return /* glsl */`
#if defined(KIT_WALK_CPU) || defined(KIT_WALK_PATH)
  {
    float ph = 0.0, amp = 0.0, sit = kitBit(${OPT.SIT}.0);
    vec3 kp = vec3(position), kn = ${depth ? 'vec3(0.0, 1.0, 0.0)' : 'objectNormal'};
  #ifdef KIT_WALK_CPU
    amp = aWalk > 0.01 ? 1.0 : 0.0;
    ph = uKitTime * aWalk + aPhase;
    kitPose(kp, kn, ph, amp, sit);
  #else
    float Lw = aPath.x, spd = aPath.y, ph0 = aPath.z, pau = aPath.w, s = 0.0, dirv = 1.0;
    if (spd > 0.01 && Lw > 0.5 && sit < 0.5) {
      float tw = Lw / spd, Pp = 2.0 * (tw + pau), u = mod(uKitTime + ph0 * Pp, Pp);
      if (u < tw) { s = u * spd - 0.5 * Lw; amp = 1.0; }
      else if (u < tw + pau) { s = 0.5 * Lw; }
      else if (u < 2.0 * tw + pau) { s = 0.5 * Lw - (u - tw - pau) * spd; dirv = -1.0; amp = 1.0; }
      else { s = -0.5 * Lw; dirv = -1.0; }
    }
    ph = uKitTime * max(spd, 0.6) * 4.5 + ph0 * 6.2831;
    kitPose(kp, kn, ph, amp, sit);
    if (dirv < 0.0) { kp.xz = -kp.xz; kn.xz = -kn.xz; }
    kp.z += s;
  #endif
    kitP = kp;
    ${depth ? '' : 'objectNormal = kn;'}
  }
#endif
`;
}
function patchVS(vs, depth) {
  vs = vs.replace('#include <common>', '#include <common>\n' + GL_HEAD);
  if (!depth) {
    vs = vs.replace('#include <color_vertex>', GL_COLOR)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vec3 kitP = vec3(position);\n' + walkCode(false))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = kitP * kitGate();');
  } else {
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec3 kitP = vec3(position);\n' + walkCode(true) + '\n  transformed = kitP * kitGate();');
  }
  return vs;
}
const GL_FRAG_HEAD = 'uniform float uNight;\nvarying vec2 vKitRM;\nvarying float vKitLamp;\n';
// đèn: 1 pha (trắng ấm), 2 hậu (đỏ), 3 hộp đèn taxi (vàng ấm), 4 xi-nhan (hổ phách, tắt)
const GL_LAMP = /* glsl */`
  if (vKitLamp > 0.5) {
    vec3 le = vKitLamp < 1.5 ? vec3(2.6, 2.4, 2.0) : vKitLamp < 2.5 ? vec3(1.6, 0.05, 0.03) : vKitLamp < 3.5 ? vec3(1.7, 1.5, 0.7) : vec3(0.0);
    totalEmissiveRadiance += le * uNight;
  }
`;
const _mats = new Map();
// opts: { walk: 'none'|'cpu'|'path', shirts: bool, std: bool, name } — cùng tham số → CÙNG vật liệu (cache)
export function kitMaterial({ walk = 'none', shirts = false, std = true, name = 'kit' } = {}) {
  const key = [walk, shirts, std, name].join('|');
  if (_mats.has(key)) return _mats.get(key);
  const m = std ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.85 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.name = 'kit_' + name;
  m.defines = {};
  if (shirts) m.defines.KIT_SHIRTS = '';
  if (walk === 'cpu') m.defines.KIT_WALK_CPU = '';
  if (walk === 'path') m.defines.KIT_WALK_PATH = '';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uKitTime = KIT_U.uKitTime; sh.uniforms.uNight = KIT_U.uNight;
    Object.assign(sh.uniforms, PALU);
    sh.vertexShader = patchVS(sh.vertexShader, false);
    let fs = GL_FRAG_HEAD + sh.fragmentShader;
    if (std) {
      fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = max(0.04, vKitRM.x);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vKitRM.y;');
    }
    // đèn xe cộng TRƯỚC chunk emissivemap (post.js nhân HP_UNLIT_K ở cuối chunk → hiển thị theo màn hình, không loá ×4 đêm)
    fs = fs.replace('#include <emissivemap_fragment>', GL_LAMP + '\n#include <emissivemap_fragment>');
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'hp_kit_v1|' + key;
  // bóng đổ (props: xe đỗ/người — giao thông không đổ bóng): cùng cổng + dáng
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.defines = { ...m.defines };
  d.onBeforeCompile = (sh) => {
    sh.uniforms.uKitTime = KIT_U.uKitTime;
    Object.assign(sh.uniforms, PALU);
    sh.vertexShader = patchVS(sh.vertexShader, true);
  };
  d.customProgramCacheKey = () => 'hp_kit_depth_v1|' + key;
  m.userData.depth = d;
  _mats.set(key, m);
  return m;
}
// bóng tiếp đất trong suốt (giao thông) — alpha theo đỉnh × instanceColor.r (độ đậm theo loại)
export function kitShadowMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = KIT_U.uNight;
    sh.vertexShader = 'attribute float aSA;\nattribute float aShA;\nvarying float vSA;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSA = aSA * aShA;');
    sh.fragmentShader = 'uniform float uNight;\nvarying float vSA;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.a *= vSA * (1.0 - 0.45 * uNight);');
  };
  m.customProgramCacheKey = () => 'hp-kit-shadow';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. NHÂN VẬT CHƠI / NPC: người kit → SkinnedMesh (1 draw call/người, xương = khớp SK). Màu NƯỚNG theo scheme.
// ---------------------------------------------------------------------------------------------------------------------
// limb id → xương: 0 hông, 1/2 đùi, 3/4 cẳng chân, 5/6 cánh tay, 7/8 cẳng tay, 9 thân, 10 đầu
const _humCache = new Map();
function humanoidBase(hat, longHair, backpack) {
  const key = hat + '|' + !!longHair + '|' + !!backpack;
  if (_humCache.has(key)) return _humCache.get(key);
  const K = new Kit();
  person(K, restJoints(), { who: 'A', limbs: true, nonla: hat === 'nonla' ? 1 : 0, cap: hat === 'cap' ? 2 : 0, hair: longHair ? 3 : 0, bag: 0 });
  if (backpack) {
    K.add(tube([{ p: [0, 1.04, -0.15], rx: 0.15, rz: 0.08 }, { p: [0, 1.22, -0.17], rx: 0.16, rz: 0.09 }, { p: [0, 1.38, -0.15], rx: 0.14, rz: 0.07 }], 8, { ref: [0, 0, 1] }), { ch: CH.CARGO, limb: 9, r: 0.7 });
    for (const sx of [1, -1]) K.add(beam([sx * 0.12, 1.4, -0.06], [sx * 0.13, 1.12, 0.1], 0.03, 0.012), { c: 0x2a2a2e, limb: 9, r: 0.7 });
  }
  // gắn chỉ số xương theo chi (0 hông, 1/2 đùi, 3/4 cẳng, 5/6 cánh tay, 7/8 cẳng tay, 9 thân, 10 đầu → thứ tự xương character.js)
  const BONE = [0, 7, 8, 9, 10, 3, 4, 5, 6, 1, 2];
  for (const g of K.parts) {
    const kit = g.attributes.aKit, n = kit.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = BONE[Math.round(kit.getZ(i))] || 0; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  const g = K.build();
  _humCache.set(key, g);
  return g;
}
export function humanoidGeometry(scheme) {
  const s = scheme;
  const base = humanoidBase(s.hat, s.longHair, s.backpack);
  // nướng kênh → màu theo scheme (không instance): mỗi nhân vật 1 mảng màu riêng, còn lại dùng chung với bản gốc
  const pick = (ch) => {
    switch (ch) {
      case CH.TOP: return s.shirt;
      case CH.FOREARM: return s.longSleeve ? s.shirt : s.skin;
      case CH.BOT: return s.shorts;
      case CH.LOWLEG: return s.shortsLong === false ? s.skin : s.shorts;
      case CH.SKIN: return s.skin;
      case CH.HAIR: return s.hair;
      case CH.SHOE: return s.shoe ?? 0x2a2420;
      case CH.BAG: return s.cap;
      case CH.CARGO: return s.backpack;
      default: return null;
    }
  };
  const kit = base.attributes.aKit, col0 = base.attributes.color, n = kit.count, col = new Float32Array(n * 3);
  const C = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const hx = pick(Math.round(kit.getX(i)));
    let r = col0.getX(i), g = col0.getY(i), b = col0.getZ(i);
    if (hx != null) { C.setHex(hx); r *= C.r; g *= C.g; b *= C.b; }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(k, base.attributes[k]);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.boundingSphere = base.boundingSphere;
  return g;
}
