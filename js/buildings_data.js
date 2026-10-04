// buildings_data.js — GIẢI MÃ footprint nhà THẬT (js/buildings_real.js, sinh bởi tools/process_buildings.mjs) +
// bảng màu/kiểu dùng chung + lưới không gian. Không import three → chạy được trong node (tools) lẫn trình duyệt.
//
// ĐỊNH DẠNG NHỊ PHÂN RB01 (little-endian, mọi mảng căn 4 byte; độ dài mảng u8/i16 làm tròn lên bội 4 byte):
//   u32 magic 0x31304252 ('RB01') | u32 nB | u32 nV | u32 reserved
//   u32 vStart[nB+1]                         — đỉnh của nhà i: [vStart[i], vStart[i+1])
//   i16 vx[nV], i16 vz[nV]                   — toạ độ game ×10 (đơn vị 0,1 m), đa giác KHÔNG lặp điểm đầu,
//                                              thứ tự sao cho tường dựng (p_i → p_{i+1}, lên trên) có pháp tuyến RA NGOÀI
//                                              (= diện tích có dấu Σ(x_i·z_{i+1} − x_{i+1}·z_i) < 0, xem isOutwardOrder)
//   u8 edge[nV]                              — loại CẠNH i (đỉnh i → i+1): EDGE.*
//   u8 edgeCover[nV]                         — số tầng nhà bên cạnh che cạnh này (0 = lộ hoàn toàn) → chỉ dựng phần trên
//                                              (giết nhà qua D.dead → GỌI refreshPartyEdges(D) trước khi dựng, xem cuối file)
//   u8 floors[nB] | u8 style[nB] | u8 wall[nB] (chỉ số WALL_PALETTE) | u8 roof[nB] (4 bit thấp = ROOF.*, 4 bit cao = ROOF_PALETTE)
//   u8 flags[nB] (FLAG.*) | u8 info[nB] (INFO.*: cấp phố mặt tiền + góc phố + công năng tầng trệt; trước v1 = 0) | u16 seed[nB]
//
// MỞ RỘNG v1 (CỘNG THÊM, không đổi phần trên): u32 reserved ở byte 12 = rectOff = vị trí byte của MỤC NHÀ CHỮ NHẬT
// (0 = không có — file v0). Nhà hình chữ nhật (≈ 80% số nhà: lô chia, lô lấp khe, nhà lõi ô, footprint ML vuông góc)
// lưu gọn 19 byte thay vì 36 byte/nhà đa giác 4 đỉnh:
//   u32 magic 0x31524252 ('RBR1') | u32 nR
//   i16 x0[nR], i16 z0[nR]          — đỉnh 0 (×10, cùng lưới 0,1 m với đỉnh đa giác)
//   u16 ang[nR]                     — hướng cạnh 0: a = ang·2π/65536; e0 = (cos a, sin a), e1 = (sin a, −cos a)
//   u16 w[nR], u16 d[nR]            — dài cạnh 0 / cạnh 1 (×100, cm). Đỉnh: p1 = p0 + w·e0, p2 = p1 + d·e1, p3 = p0 + d·e1
//                                     (thứ tự này luôn là "tường ra ngoài", S < 0)
//   u8 ek[nR]                       — EDGE của cạnh k ở bit 2k..2k+1 (cạnh k: p_k → p_{k+1})
//   u16 cov[nR]                     — edgeCover cạnh k ở bit 4k..4k+3 (bão hoà 15 tầng)
//   u8 floors, style, wall, roof, flags, info [nR mỗi mảng] — như trên; seed suy từ (x0,z0,ang) lúc giải mã
// decodeRB() TRẢI các nhà chữ nhật thành đa giác 4 đỉnh nối SAU các nhà đa giác → người dùng D thấy 1 danh sách đồng nhất.
export const RB_MAGIC = 0x31304252;
export const RBR_MAGIC = 0x31524252;

export const EDGE = { SIDE: 0, FRONT: 1, BACK: 2, PARTY: 3 };
// Kiểu mặt tiền (shader atlas chọn bộ mô-đun theo kiểu)
export const STYLE = {
  TUBE: 0,      // nhà ống hiện đại 2000-2020: nhôm kính, ban công lan can, ốp gạch
  OLD: 1,       // nhà ống / phố cũ (thời Pháp - bao cấp): cửa chớp gỗ, vòm, tường vàng ố
  KTT: 2,       // khu tập thể / chung cư thấp tầng 4-5 tầng: ô cửa lặp, lô gia cơi nới
  GLASS: 3,     // văn phòng / khách sạn / ngân hàng: vách kính, khung nhôm
  VILLA: 4,     // biệt thự Pháp / công sở cổ: cửa chớp, vòm, mái ngói
  SHED: 5,      // kho / xưởng / lán tôn: tường trơn, mái tôn
  CIVIC: 6,     // trường / cơ quan / bệnh viện: dải cửa sổ đều, sơn vàng/kem
};
export const ROOF = { FLAT_PARAPET: 0, FLAT: 1, GABLE_TON: 2, HIP_TILE: 3, SHED_TON: 4 };
export const FLAG = { SYNTH: 1, OSM: 2, GOOGLE: 4, MS: 8, PANO: 16, BIG: 32, LOT: 64, EDIT: 128 };
// FLAG.EDIT (v1): hình học nhà THẬT đã bị generator sửa so với nguồn (cắt hành lang phố / kéo mặt tiền / chia lô, khối
// sau, ô lưới khối dính / kéo sâu / vuông hoá / nới / khép khe / cắt chồng lấn / chốt hành lang-camera). Nhà SINH
// (FLAG.SYNTH) không mang cờ này. Hợp đồng hình học (generator tự kiểm sau encode): mọi nhà là đa giác ĐƠN chặt (không
// cạnh cắt nhau, không gai, không đỉnh chạm cạnh khác), tường-ra-ngoài, ≥ 6 m², bề hẹp ≥ 1,2 m; không đỉnh nào lấn
// > 0,3 m vào facadeLine phố p/s/t/r; nhà SINH cách địa danh (LM_POLY) và camera pano ≥ 3 m.
// Người dùng có cell/nhà tay riêng (WP3 cellsink) nên BỎ QUA nhà FLAG.SYNTH khi quyết định xoá nhà tay (nhà sinh là phỏng
// đoán lấp chỗ trống, nhà tay mang danh tính/ảnh pano thật).
// INFO (byte thứ 6 mỗi nhà, v1): bit 0-2 = cấp phố mà mặt tiền chính nhìn ra (chỉ số ROADC: 0 không có, 1 p … 6 h),
// bit 3 = góc phố (mặt tiền nhìn ra ≥ 2 phố), bit 4-5 = công năng tầng trệt (USE_*), bit 6-7 dự trữ = 0.
export const ROADC = ['', 'p', 's', 't', 'r', 'w', 'h'];
export const INFO = { ROAD_MASK: 7, CORNER: 8, USE_SHIFT: 4, USE_MASK: 48, USE_HOME: 0, USE_SHOP: 1, USE_OFFICE: 2, USE_GATE: 3 };
export const infoRoad = (info) => ROADC[info & 7] || '';
export const infoUse = (info) => (info >> 4) & 3;

// Màu tường (sRGB hex) — hiệu chỉnh theo pano Hải Phòng: vàng kem "vàng Hải Phòng", trắng ngà, xám nhạt, hồng nhạt,
// xanh ngọc nhạt, be... Chỉ số ổn định (dữ liệu nhị phân lưu chỉ số) — CHỈ THÊM vào cuối, không đổi thứ tự.
export const WALL_PALETTE = [
  0xf2e3b3, 0xf5f1e6, 0xe9e4d8, 0xd9d6cf, 0xf0d9a0, 0xe8c98a, 0xf3ead2, 0xdfe6e3,
  0xe7d3c3, 0xf2d4cc, 0xd8e3d0, 0xcfdde6, 0xe9dfc9, 0xc9c4b8, 0xf1e8bf, 0xe2b98a,
  0xd7c7a8, 0xfaf7f0, 0xbfc2c0, 0xe6e9ec, 0xf0c9a8, 0xd2b48c, 0xa9b8a8, 0xe4d6a4,
  // v1 (process_buildings v1, theo chữ màu quan sát pano): 24 xanh dương sơn tường, 25 xanh ngọc/lá mạ, 26 hồng,
  // 27 cam, 28 nâu gạch đỏ, 29 xi măng thô xám
  0xa9c6d8, 0xb9d7bf, 0xe9b7b0, 0xe7a96f, 0xb46a50, 0x9fa7ad,
];
// Màu mái (sRGB) — vệ tinh: đỏ gỉ tôn / ngói nung chiếm đa số, xám bê tông, xanh tôn
export const ROOF_PALETTE = [
  0x8e3b2c, 0xa5533e, 0xb0603f, 0x6e3a2e, 0x46617f, 0x9b9890, 0xb8b4aa, 0x5f5f5c,
  0x4f6b55, 0xcfcac0, 0x7a4a3a, 0x9c7b62, 0x3d4f66, 0x8a8a84, 0xa86a4a, 0x6b6660,
];

export const GROUND_H = 3.9;     // tầng trệt cao (cửa cuốn + tum biển hiệu)
export const FLOOR_H = 3.3;      // tầng trên
export const PARAPET_H = 0.9;    // lan can mái bằng
export const heightOf = (floors) => GROUND_H + Math.max(0, floors - 1) * FLOOR_H;

function b64ToBytes(b64) {
  // Uint8Array.fromBase64 (Chrome 140+/Safari 18.2+/Firefox 133+, node 24): giải mã native, nhanh ~5× vòng atob
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  if (typeof atob === 'function') {
    const s = atob(b64); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));   // node
}

// Giải mã → {nB, nV, vStart, x, z (Float32 mét), edge, edgeCover, floors, style, wall, roof, flags, info, seed, dead, nPoly}
// (nPoly = số nhà đa giác; các nhà [nPoly, nB) đến từ mục chữ nhật)
export function decodeRB(bytesOrB64) {
  const u8 = typeof bytesOrB64 === 'string' ? b64ToBytes(bytesOrB64) : bytesOrB64;
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== RB_MAGIC) throw new Error('buildings_real: sai magic');
  const nP = dv.getUint32(4, true), nVP = dv.getUint32(8, true), rectOff = dv.getUint32(12, true);
  let off = 16;
  const al = (n) => (n + 3) & ~3;
  const vStartP = new Uint32Array(buf, off, nP + 1); off += 4 * (nP + 1);
  const ix = new Int16Array(buf, off, nVP); off += al(2 * nVP);
  const iz = new Int16Array(buf, off, nVP); off += al(2 * nVP);
  const edgeP = new Uint8Array(buf, off, nVP); off += al(nVP);
  const coverP = new Uint8Array(buf, off, nVP); off += al(nVP);
  const attrP = []; for (let k = 0; k < 6; k++) { attrP.push(new Uint8Array(buf, off, nP)); off += al(nP); }   // floors style wall roof flags info
  const seedP = new Uint16Array(buf, off, nP); off += al(2 * nP);
  let nR = 0, R = null;
  if (rectOff) {
    if (dv.getUint32(rectOff, true) !== RBR_MAGIC) throw new Error('buildings_real: sai magic mục chữ nhật');
    nR = dv.getUint32(rectOff + 4, true); let o = rectOff + 8;
    R = {};
    R.x0 = new Int16Array(buf, o, nR); o += al(2 * nR);
    R.z0 = new Int16Array(buf, o, nR); o += al(2 * nR);
    R.ang = new Uint16Array(buf, o, nR); o += al(2 * nR);
    R.w = new Uint16Array(buf, o, nR); o += al(2 * nR);
    R.d = new Uint16Array(buf, o, nR); o += al(2 * nR);
    R.ek = new Uint8Array(buf, o, nR); o += al(nR);
    R.cov = new Uint16Array(buf, o, nR); o += al(2 * nR);
    R.attr = []; for (let k = 0; k < 6; k++) { R.attr.push(new Uint8Array(buf, o, nR)); o += al(nR); }
  }
  const nB = nP + nR, nV = nVP + 4 * nR;
  const vStart = new Uint32Array(nB + 1); vStart.set(vStartP);
  const x = new Float32Array(nV), z = new Float32Array(nV);
  for (let i = 0; i < nVP; i++) { x[i] = ix[i] / 10; z[i] = iz[i] / 10; }
  const edge = new Uint8Array(nV); edge.set(edgeP);
  const edgeCover = new Uint8Array(nV); edgeCover.set(coverP);
  const A = []; for (let k = 0; k < 6; k++) { const a = new Uint8Array(nB); a.set(attrP[k]); A.push(a); }
  const seed = new Uint16Array(nB); seed.set(seedP);
  if (R) {
    const K = (2 * Math.PI) / 65536;
    for (let r = 0; r < nR; r++) {
      const b = nP + r, v = nVP + 4 * r;
      vStart[b] = v;
      const a = R.ang[r] * K, ca = Math.cos(a), sa = Math.sin(a), w = R.w[r] / 100, d = R.d[r] / 100;
      const px = R.x0[r] / 10, pz = R.z0[r] / 10;
      x[v] = px; z[v] = pz;
      x[v + 1] = px + w * ca; z[v + 1] = pz + w * sa;
      x[v + 2] = px + w * ca + d * sa; z[v + 2] = pz + w * sa - d * ca;
      x[v + 3] = px + d * sa; z[v + 3] = pz - d * ca;
      const ek = R.ek[r], cv = R.cov[r];
      for (let k = 0; k < 4; k++) { edge[v + k] = (ek >> (2 * k)) & 3; edgeCover[v + k] = (cv >> (4 * k)) & 15; }
      for (let k = 0; k < 6; k++) A[k][b] = R.attr[k][r];
      seed[b] = (Math.imul(R.x0[r], 73856093) ^ Math.imul(R.z0[r], 19349663) ^ Math.imul(R.ang[r], 83492791)) & 0xffff;
    }
    vStart[nB] = nV;
  }
  const [floors, style, wall, roof, flags, info] = A;
  return { nB, nV, vStart, x, z, edge, edgeCover, floors, style, wall, roof, flags, info, seed, dead: new Uint8Array(nB), nPoly: nP };
}

// Mã hoá (dùng trong tools/process_buildings.mjs). B = [{pts:[[x,z],...] (thứ tự tường-ra-ngoài), edge:[], cover:[],
// floors, style, wall, roofType, roofColor, flags, info?, seed, rect?}]. Nhà có `rect = {x0, z0, ang (rad), w, d}`
// (đỉnh 0, hướng cạnh 0, dài cạnh 0/1 — khớp quy ước mục RBR1 ở đầu file) đi vào mục chữ nhật; còn lại vào mục đa giác.
export function encodeRB(Ball) {
  const B = Ball.filter((b) => !b.rect), RB = Ball.filter((b) => b.rect);
  const nB = B.length; let nV = 0; for (const b of B) nV += b.pts.length;
  const nR = RB.length;
  const al = (n) => (n + 3) & ~3;
  const polySize = 16 + 4 * (nB + 1) + 2 * al(2 * nV) + 2 * al(nV) + 6 * al(nB) + al(2 * nB);
  const rectSize = nR ? 8 + 5 * al(2 * nR) + al(nR) + al(2 * nR) + 6 * al(nR) : 0;
  const buf = new ArrayBuffer(polySize + rectSize), dv = new DataView(buf);
  dv.setUint32(0, RB_MAGIC, true); dv.setUint32(4, nB, true); dv.setUint32(8, nV, true); dv.setUint32(12, nR ? polySize : 0, true);
  let off = 16;
  const vStart = new Uint32Array(buf, off, nB + 1); off += 4 * (nB + 1);
  const ix = new Int16Array(buf, off, nV); off += al(2 * nV);
  const iz = new Int16Array(buf, off, nV); off += al(2 * nV);
  const edge = new Uint8Array(buf, off, nV); off += al(nV);
  const cover = new Uint8Array(buf, off, nV); off += al(nV);
  const arrs = []; for (let k = 0; k < 6; k++) { arrs.push(new Uint8Array(buf, off, nB)); off += al(nB); }
  const seed = new Uint16Array(buf, off, nB);
  let v = 0;
  B.forEach((b, i) => {
    vStart[i] = v;
    b.pts.forEach(([px, pz], k) => {
      ix[v] = Math.round(px * 10); iz[v] = Math.round(pz * 10);
      edge[v] = b.edge ? b.edge[k] | 0 : 0; cover[v] = b.cover ? Math.min(255, b.cover[k] | 0) : 0; v++;
    });
    arrs[0][i] = b.floors; arrs[1][i] = b.style; arrs[2][i] = b.wall;
    arrs[3][i] = (b.roofType & 15) | ((b.roofColor & 15) << 4); arrs[4][i] = b.flags | 0; arrs[5][i] = b.info | 0;
    seed[i] = b.seed & 0xffff;
  });
  vStart[nB] = v;
  if (nR) {
    let o = polySize;
    dv.setUint32(o, RBR_MAGIC, true); dv.setUint32(o + 4, nR, true); o += 8;
    const x0 = new Int16Array(buf, o, nR); o += al(2 * nR);
    const z0 = new Int16Array(buf, o, nR); o += al(2 * nR);
    const ang = new Uint16Array(buf, o, nR); o += al(2 * nR);
    const w = new Uint16Array(buf, o, nR); o += al(2 * nR);
    const d = new Uint16Array(buf, o, nR); o += al(2 * nR);
    const ek = new Uint8Array(buf, o, nR); o += al(nR);
    const cov = new Uint16Array(buf, o, nR); o += al(2 * nR);
    const ra = []; for (let k = 0; k < 6; k++) { ra.push(new Uint8Array(buf, o, nR)); o += al(nR); }
    RB.forEach((b, i) => {
      const r = b.rect;
      x0[i] = Math.round(r.x0 * 10); z0[i] = Math.round(r.z0 * 10);
      let a = r.ang % (2 * Math.PI); if (a < 0) a += 2 * Math.PI;
      ang[i] = Math.round((a / (2 * Math.PI)) * 65536) & 0xffff;
      w[i] = Math.min(65535, Math.round(r.w * 100)); d[i] = Math.min(65535, Math.round(r.d * 100));
      let e = 0, c = 0;
      for (let k = 0; k < 4; k++) { e |= ((b.edge ? b.edge[k] : 0) & 3) << (2 * k); c |= Math.min(15, b.cover ? b.cover[k] | 0 : 0) << (4 * k); }
      ek[i] = e; cov[i] = c;
      ra[0][i] = b.floors; ra[1][i] = b.style; ra[2][i] = b.wall;
      ra[3][i] = (b.roofType & 15) | ((b.roofColor & 15) << 4); ra[4][i] = b.flags | 0; ra[5][i] = b.info | 0;
    });
  }
  return new Uint8Array(buf);
}

// Chữ nhật từ đa giác 4 đỉnh thứ tự tường-ra-ngoài nếu mọi góc lệch 90° ≤ tolDeg và cạnh đối dài bằng nhau (≤ tolM):
// trả {x0, z0, ang, w, d} theo quy ước mục RBR1 (đỉnh 0 giữ nguyên) hoặc null. maxM: trần sai lệch tuyệt đối (m).
export function rectOf(pts, tolDeg = 1.2, tolM = 0.06, maxM = Infinity) {
  if (pts.length !== 4 || signedArea(pts) >= 0) return null;
  const [p0, p1, , p3] = pts;
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  if (w < 0.2 || d < 0.2) return null;
  const a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const ca = Math.cos(a), sa = Math.sin(a);
  const q = [p0, [p0[0] + w * ca, p0[1] + w * sa], [p0[0] + w * ca + d * sa, p0[1] + w * sa - d * ca], [p0[0] + d * sa, p0[1] - d * ca]];
  const tol = Math.min(maxM, Math.max(tolM, Math.sin((tolDeg * Math.PI) / 180) * Math.max(w, d)));
  for (let k = 0; k < 4; k++) if (Math.hypot(q[k][0] - pts[k][0], q[k][1] - pts[k][1]) > tol) return null;
  return { x0: p0[0], z0: p0[1], ang: a, w, d };
}

// Thứ tự đỉnh chuẩn: tường dựng p_i→p_{i+1} (BufferGeometry 2 tam giác (a,b,b'),(a,b',a')) có pháp tuyến RA NGOÀI
// khi diện tích có dấu S = Σ(x_i·z_{i+1} − x_{i+1}·z_i) < 0 (trục x đông, z nam, nhìn từ trên xuống).
export function signedArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export const isOutwardOrder = (pts) => signedArea(pts) < 0;
// Pháp tuyến ngoài của cạnh (ax,az)→(bx,bz) theo quy ước trên: n = (−dz, dx)/L
export function edgeNormal(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; }

// ---------- Lưới không gian (ô 24 m) trên bbox từng nhà ----------
export function makeFootprintGrid(D, cell = 24) {
  const map = new Map();
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  const bb = new Float32Array(D.nB * 4);
  for (let b = 0; b < D.nB; b++) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) { const x = D.x[v], z = D.z[v]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    bb[b * 4] = x0; bb[b * 4 + 1] = z0; bb[b * 4 + 2] = x1; bb[b * 4 + 3] = z1;
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(b);
      }
  }
  const inside = (b, px, pz) => {
    let c = false; const s = D.vStart[b], e = D.vStart[b + 1];
    for (let v = s, w = e - 1; v < e; w = v++) {
      const xi = D.x[v], zi = D.z[v], xj = D.x[w], zj = D.z[w];
      if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  return {
    cell, bb,
    // gọi cb(b) cho mỗi nhà có bbox giao hình vuông (x±r, z±r); mỗi nhà đúng 1 lần
    near(x, z, r, cb) {
      const seen = new Set();
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
          const a = map.get(key(i, j)); if (!a) continue;
          for (const b of a) {
            if (seen.has(b) || D.dead[b]) continue; seen.add(b);
            if (bb[b * 4] > x + r || bb[b * 4 + 2] < x - r || bb[b * 4 + 1] > z + r || bb[b * 4 + 3] < z - r) continue;
            cb(b);
          }
        }
    },
    // chỉ số nhà chứa điểm (bỏ nhà dead) hoặc −1
    at(x, z) {
      const a = map.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (!a) return -1;
      for (const b of a) if (!D.dead[b] && x >= bb[b * 4] && x <= bb[b * 4 + 2] && z >= bb[b * 4 + 1] && z <= bb[b * 4 + 3] && inside(b, x, z)) return b;
      return -1;
    },
    inside,
  };
}

// ---------- Tường chung sau khi GIẾT nhà (D.dead) ----------
// EDGE.PARTY + edgeCover chỉ ghi SỐ TẦNG nhà láng giềng che cạnh, KHÔNG ghi láng giềng nào. Người dùng (WP2 claim địa
// danh/pano/vùng cấm, WP3 cell sink…) đặt D.dead[b] = 1 cho một số nhà → nhà còn sống kề nhà bị giết sẽ dựng thiếu chân
// tường (chỉ dựng phần trên heightOf(edgeCover)) = lỗ nhìn xuyên vào nhà rỗng. BẮT BUỘC gọi hàm này SAU khi đặt xong
// D.dead và TRƯỚC khi dựng mesh/va chạm: rà mọi cạnh PARTY của nhà còn sống — còn láng giềng SỐNG có cạnh song song
// ngược chiều sát (≤ 0,3 m) phủ ≥ L − 0,65 m → edgeCover = min(cũ, số tầng THẤP NHẤT của các láng giềng sống đó); không →
// hạ thành BACK (nếu quay lưng với mặt tiền) hoặc SIDE, edgeCover = 0 (dựng cả chân tường). Cùng ngưỡng với bước 12 của
// tools/process_buildings.mjs → gọi trên dữ liệu chưa giết nhà nào thì không đổi gì (kiểm: demoted = 0).
// grid: makeFootprintGrid(D) (tạo mới nếu bỏ trống). killed (tuỳ chọn): mảng chỉ số nhà vừa bị giết → chỉ rà nhà quanh
// chúng (nhanh, gọi lại được nhiều lần); bỏ trống = rà toàn bộ. Trả {checked, demoted, lowered}.
export function refreshPartyEdges(D, grid = null, killed = null) {
  const G = grid || makeFootprintGrid(D);
  let todo;
  if (killed) {
    const set = new Set();
    for (const k of killed) {
      const x0 = G.bb[k * 4], z0 = G.bb[k * 4 + 1], x1 = G.bb[k * 4 + 2], z1 = G.bb[k * 4 + 3];
      G.near((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2 + 1.5, (b) => set.add(b));
    }
    todo = set;
  } else { todo = []; for (let b = 0; b < D.nB; b++) todo.push(b); }
  let checked = 0, demoted = 0, lowered = 0;
  const iv = [];
  for (const b of todo) {
    if (D.dead[b]) continue;
    const s = D.vStart[b], e = D.vStart[b + 1], n = e - s;
    let any = false; for (let v = s; v < e; v++) if (D.edge[v] === EDGE.PARTY) { any = true; break; }
    if (!any) continue;
    // pháp tuyến ngoài của cạnh mặt tiền DÀI NHẤT (để phân BACK/SIDE khi hạ cạnh)
    let fnx = 0, fnz = 0, fL = 0;
    for (let k = 0; k < n; k++) {
      const v = s + k, w = k + 1 < n ? v + 1 : s; if (D.edge[v] !== EDGE.FRONT) continue;
      const L = Math.hypot(D.x[w] - D.x[v], D.z[w] - D.z[v]); if (L > fL) { fL = L; [fnx, fnz] = edgeNormal(D.x[v], D.z[v], D.x[w], D.z[w]); }
    }
    const x0 = G.bb[b * 4], z0 = G.bb[b * 4 + 1], x1 = G.bb[b * 4 + 2], z1 = G.bb[b * 4 + 3];
    const nbs = [];
    G.near((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2 + 1, (j) => { if (j !== b) nbs.push(j); });   // near() bỏ nhà dead
    for (let k = 0; k < n; k++) {
      const v = s + k; if (D.edge[v] !== EDGE.PARTY) continue;
      checked++;
      const w = k + 1 < n ? v + 1 : s, ax = D.x[v], az = D.z[v], L = Math.hypot(D.x[w] - ax, D.z[w] - az);
      if (L < 0.05) continue;
      const ex = (D.x[w] - ax) / L, ez = (D.z[w] - az) / L, nx = -ez, nz = ex;
      iv.length = 0; let minF = Infinity;
      for (const j of nbs) {
        const sj = D.vStart[j], ej = D.vStart[j + 1], m = ej - sj;
        for (let q = 0; q < m; q++) {
          const p0 = sj + q, p1 = q + 1 < m ? p0 + 1 : sj;
          const px = D.x[p0], pz = D.z[p0], qx = D.x[p1], qz = D.z[p1], Lq = Math.hypot(qx - px, qz - pz); if (Lq < 0.3) continue;
          if (((qx - px) * ex + (qz - pz) * ez) / Lq > -0.985) continue;   // song song NGƯỢC chiều
          const dp = (px - ax) * nx + (pz - az) * nz, dq = (qx - ax) * nx + (qz - az) * nz;
          if (dp < -0.3 || dq < -0.3 || dp > 0.2 || dq > 0.2) continue;
          let t0 = (px - ax) * ex + (pz - az) * ez, t1 = (qx - ax) * ex + (qz - az) * ez; if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
          t0 = Math.max(0, t0); t1 = Math.min(L, t1);
          if (t1 - t0 > 0.3) { iv.push([t0, t1]); if (D.floors[j] < minF) minF = D.floors[j]; }
        }
      }
      let cov = 0;
      if (iv.length) {
        iv.sort((p, q) => p[0] - q[0]); let c0 = iv[0][0], c1 = iv[0][1];
        for (let i = 1; i < iv.length; i++) { if (iv[i][0] > c1) { cov += c1 - c0; c0 = iv[i][0]; c1 = iv[i][1]; } else if (iv[i][1] > c1) c1 = iv[i][1]; }
        cov += c1 - c0;
      }
      if (iv.length && L - cov <= 0.65) {
        const c = Math.min(b >= D.nPoly ? 15 : 255, minF);   // mục chữ nhật bão hoà 15 tầng như lúc mã hoá
        if (c < D.edgeCover[v]) { D.edgeCover[v] = c; lowered++; }   // chỉ HẠ (an toàn: tường thừa nằm khuất trong nhà kề), không nâng
      } else {
        D.edge[v] = fL > 0 && -(nx * fnx + nz * fnz) > 0.7 ? EDGE.BACK : EDGE.SIDE;
        D.edgeCover[v] = 0; demoted++;
      }
    }
  }
  return { checked, demoted, lowered };
}
