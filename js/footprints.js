// footprints.js — CHỈ MỤC FOOTPRINT NHÀ THẬT cho gameplay (Đợt 3 WP8): camera chống xuyên tường, người đi bộ không
// đi xuyên nhà, chỗ xuống xe/gọi xe không nằm trong nhà. Không dựng hình — chỉ tra cứu 2D + chiều cao.
//
// Nguồn: js/buildings_real.js (RB01, js/buildings_data.js) + js/landmark_polys.js (19 địa danh OSM).
// HỢP ĐỒNG với WP2 (bộ dựng fabric): nếu world.js đặt `world.rbData` (kết quả decodeRB, có cờ dead[] của
// claims) và/hoặc `world.rbGrid` (makeFootprintGrid của chính dữ liệu đó) thì DÙNG LẠI — không giải mã lần 2 và
// tôn trọng các footprint đã bị claim gỡ (D.dead). Không có thì tự giải mã (~40-60 ms, 1 lần).
import { RB_B64 } from './buildings_real.js';
import { decodeRB, makeFootprintGrid, heightOf, PARAPET_H } from './buildings_data.js';
import { LM_POLY } from './landmark_polys.js';

const LAND_H = 2;   // nền phố phẳng (world.js LAND_H) — chân nhà thật đặt ở đây
// Chiều cao THÂN chính của địa danh (m, ước theo ảnh/pano; tháp chuông/vòm nhỏ không tính — chỉ dùng cho camera).
const LM_H = {
  opera: 20, quanhoa: 6, cathedral: 22, postoffice: 14, museum: 14, market: 16, ubnd: 16, rap78: 12, dinhhk: 9,
  chuahang: 9, dentamky: 8, nhnn: 14, thptnq: 12, thcsnq: 12, thcstp: 12, station_bldg: 12, trienlam: 12, viettiep: 14,
};

function pip(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function footprintIndex(world = {}) {
  const t0 = performance.now();
  const D = world.rbData || decodeRB(RB_B64);
  const grid = world.rbGrid || makeFootprintGrid(D);
  const lms = [];
  for (const k in LM_POLY) {
    if (!LM_H[k]) continue;
    const pts = LM_POLY[k];
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    lms.push({ k, pts, x0, z0, x1, z1, top: LAND_H + LM_H[k] });
  }
  const lmAt = (x, z) => {
    for (const l of lms) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1 && pip(l.pts, x, z)) return l;
    return null;
  };
  // Cao độ đỉnh vật cản tại (x,z) (m, toạ độ thế giới) hoặc −1. skipB/skipL: bỏ qua nhà/địa danh chứa điểm xuất phát
  // (nhân vật đứng trong footprint — dữ liệu lệch vài m, hiên nhà — không được làm camera co sát đầu).
  function topAt(x, z, skipB = -1, skipL = null) {
    const b = grid.at(x, z);
    if (b >= 0 && b !== skipB) return LAND_H + heightOf(D.floors[b] || 1) + PARAPET_H;
    const l = lmAt(x, z);
    if (l && l !== skipL) return l.top;
    return -1;
  }
  const idx = {
    D, grid, ms: 0,
    buildingAt: (x, z) => grid.at(x, z),
    landmarkAt: lmAt,
    topAt,
    // Điểm (x,z) có nằm trong nhà thật/địa danh không (cho chỗ xuống xe, người đi bộ).
    blocked(x, z) { return grid.at(x, z) >= 0 || !!lmAt(x, z); },
    // CẦN BOOM CAMERA: tia từ tâm nhìn T theo hướng đơn vị (dx,dy,dz) dài maxD — trả độ dài cho phép (≥ minD).
    // Raymarch 2D bước 0,45 m trên lưới footprint (đo: ~80 mẫu × vài nhà/ô ≈ 20-40 µs/khung).
    boom(tx, ty, tz, dx, dy, dz, maxD, minD = 1.2) {
      const startB = grid.at(tx, tz), startL = lmAt(tx, tz);
      for (let s = 0.45; s <= maxD; s += 0.45) {
        const x = tx + dx * s, z = tz + dz * s;
        const top = topAt(x, z, startB, startL);
        if (top < 0) continue;
        if (ty + dy * s < top + 0.3) return Math.max(minD, s - 0.6);
      }
      return maxD;
    },
  };
  idx.ms = Math.round(performance.now() - t0);
  console.info('[footprints]', D.nB, 'nhà thật +', lms.length, 'địa danh —', idx.ms, 'ms', world.rbData ? '(dùng lại world.rbData)' : '');
  return idx;
}
