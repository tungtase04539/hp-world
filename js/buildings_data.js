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
//   u8 floors[nB] | u8 style[nB] | u8 wall[nB] (chỉ số WALL_PALETTE) | u8 roof[nB] (4 bit thấp = ROOF.*, 4 bit cao = ROOF_PALETTE)
//   u8 flags[nB] (FLAG.*) | u8 reserved[nB] | u16 seed[nB]
export const RB_MAGIC = 0x31304252;

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
export const FLAG = { SYNTH: 1, OSM: 2, GOOGLE: 4, MS: 8, PANO: 16, BIG: 32, LOT: 64 };

// Màu tường (sRGB hex) — hiệu chỉnh theo pano Hải Phòng: vàng kem "vàng Hải Phòng", trắng ngà, xám nhạt, hồng nhạt,
// xanh ngọc nhạt, be... Chỉ số ổn định (dữ liệu nhị phân lưu chỉ số) — CHỈ THÊM vào cuối, không đổi thứ tự.
export const WALL_PALETTE = [
  0xf2e3b3, 0xf5f1e6, 0xe9e4d8, 0xd9d6cf, 0xf0d9a0, 0xe8c98a, 0xf3ead2, 0xdfe6e3,
  0xe7d3c3, 0xf2d4cc, 0xd8e3d0, 0xcfdde6, 0xe9dfc9, 0xc9c4b8, 0xf1e8bf, 0xe2b98a,
  0xd7c7a8, 0xfaf7f0, 0xbfc2c0, 0xe6e9ec, 0xf0c9a8, 0xd2b48c, 0xa9b8a8, 0xe4d6a4,
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
  if (typeof atob === 'function') {
    const s = atob(b64); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));   // node
}

// Giải mã → {nB, nV, vStart, x, z (Float32 mét), edge, edgeCover, floors, style, wall, roof, flags, seed, dead}
export function decodeRB(bytesOrB64) {
  const u8 = typeof bytesOrB64 === 'string' ? b64ToBytes(bytesOrB64) : bytesOrB64;
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== RB_MAGIC) throw new Error('buildings_real: sai magic');
  const nB = dv.getUint32(4, true), nV = dv.getUint32(8, true);
  let off = 16;
  const al = (n) => (n + 3) & ~3;
  const vStart = new Uint32Array(buf, off, nB + 1); off += 4 * (nB + 1);
  const ix = new Int16Array(buf, off, nV); off += al(2 * nV);
  const iz = new Int16Array(buf, off, nV); off += al(2 * nV);
  const edge = new Uint8Array(buf, off, nV); off += al(nV);
  const edgeCover = new Uint8Array(buf, off, nV); off += al(nV);
  const floors = new Uint8Array(buf, off, nB); off += al(nB);
  const style = new Uint8Array(buf, off, nB); off += al(nB);
  const wall = new Uint8Array(buf, off, nB); off += al(nB);
  const roof = new Uint8Array(buf, off, nB); off += al(nB);
  const flags = new Uint8Array(buf, off, nB); off += al(nB);
  off += al(nB);   // reserved
  const seed = new Uint16Array(buf, off, nB); off += al(2 * nB);
  const x = new Float32Array(nV), z = new Float32Array(nV);
  for (let i = 0; i < nV; i++) { x[i] = ix[i] / 10; z[i] = iz[i] / 10; }
  return { nB, nV, vStart, x, z, edge, edgeCover, floors, style, wall, roof, flags, seed, dead: new Uint8Array(nB) };
}

// Mã hoá (dùng trong tools/process_buildings.mjs). B = [{pts:[[x,z],...] (thứ tự tường-ra-ngoài), edge:[], cover:[],
// floors, style, wall, roofType, roofColor, flags, seed}]
export function encodeRB(B) {
  const nB = B.length; let nV = 0; for (const b of B) nV += b.pts.length;
  const al = (n) => (n + 3) & ~3;
  const size = 16 + 4 * (nB + 1) + 2 * al(2 * nV) + 2 * al(nV) + 6 * al(nB) + al(2 * nB);
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  dv.setUint32(0, RB_MAGIC, true); dv.setUint32(4, nB, true); dv.setUint32(8, nV, true);
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
      edge[v] = b.edge ? b.edge[k] | 0 : 0; cover[v] = b.cover ? b.cover[k] | 0 : 0; v++;
    });
    arrs[0][i] = b.floors; arrs[1][i] = b.style; arrs[2][i] = b.wall;
    arrs[3][i] = (b.roofType & 15) | ((b.roofColor & 15) << 4); arrs[4][i] = b.flags | 0; arrs[5][i] = 0;
    seed[i] = b.seed & 0xffff;
  });
  vStart[nB] = v;
  return new Uint8Array(buf);
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
