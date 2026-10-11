// anchorwalls.js — TƯỜNG RÀO MỎ NEO chữ U quanh siêu khối HẢI QUÂN/CẢNG (cb1: Lý Tự Trọng đông + Điện Biên Phủ bắc + Trần Hưng
// Đạo tây). NGUỒN DUY NHẤT cho: js/world.js (dựng tường, cbWallRun) và tools/process_buildings.mjs (nhà thật/sinh KHÔNG được
// đứng trước tường — review W3-A r2: giữ footprint Overture đúng chỗ làm khối nhà trong khuôn viên Hải quân nhô RA TRƯỚC tường
// đã đẩy lùi theo phố, pano_224 h270 dãy nhà ống che tường mỏ neo).
// Đã XEM ảnh: pano_516 h90 (LTT), pano_453 h90 (ĐBP), pano_223/225/227 (THĐ). Không import three (chạy được trong node).
import { facadeLine } from './xsection.js';

// polyline gốc (đặt tay theo mặt cắt CẤP cũ), mặt tường quay RA phố
export const CB_WALLS = {
  cb_wall_ltt: [[486.6, -468], [484, -540], [481, -620], [479.8, -672]],                    // LTT: bờ tây khối, quay TÂY
  cb_wall_dbp: [[500, -461], [572, -461], [644, -461]],                                      // ĐBP: mặt nam khối, quay NAM
  cb_wall_thd: [[646.4, -468], [655, -548], [661, -628], [657, -708], [653.7, -800]],        // THĐ: bờ đông khối, quay ĐÔNG
};
export const CB_WALL_TH = 0.4;   // bề dày bệ tường (m)

// phố p/s/t/r gần nhất (≤ 20 m quanh điểm): { d, qx, qz, r }
function nearestStreet(roads, x, z) {
  let best = null;
  for (const r of roads) {
    if (r.c !== 'p' && r.c !== 's' && r.c !== 't' && r.c !== 'r') continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      if (Math.min(ax, bx) > x + 20 || Math.max(ax, bx) < x - 20 || Math.min(az, bz) > z + 20 || Math.max(az, bz) < z - 20) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) best = { d, qx, qz, r };
    }
  }
  return best;
}

// W3-A: lòng + vỉa theo phố thật (xsection theo way) → polyline cũ có thể nằm TRONG vỉa (quét W2-A gỡ trọn đoạn). Chia ≤ 16 m
// rồi đẩy từng đỉnh ra SAU mặt tiền phố p/s/t/r gần nhất (facadeLine(way) + nửa bề dày bệ + 0,15); đỉnh đã đứng sau giữ nguyên.
export function cbFitFence(P, roads) {
  const Q = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 16));
    for (let k = 0; k < n; k++) Q.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  Q.push(P[P.length - 1].slice());
  return Q.map(([x, z]) => {
    const best = nearestStreet(roads, x, z);
    if (!best || best.d < 0.5 || best.d > 18) return [x, z];
    const need = facadeLine(best.r) + 0.35;
    if (best.d >= need) return [x, z];
    return [best.qx + (x - best.qx) * need / best.d, best.qz + (z - best.qz) * need / best.d];
  });
}

// các đoạn tường SAU khi khớp, kèm pháp tuyến n hướng VÀO khuôn viên (xa phố): [{ ax, az, bx, bz, L, ux, uz, nx, nz }]
export function cbWallSegments(roads) {
  const out = [];
  for (const P0 of Object.values(CB_WALLS)) {
    const P = cbFitFence(P0, roads);
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let nx = -uz, nz = ux;
      const st = nearestStreet(roads, mx, mz);
      if (st && (mx - st.qx) * nx + (mz - st.qz) * nz < 0) { nx = -nx; nz = -nz; }   // n: từ phố → khuôn viên
      out.push({ ax, az, bx, bz, L, ux, uz, nx, nz });
    }
  }
  return out;
}
