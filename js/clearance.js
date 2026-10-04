// clearance.js — KHOẢNG TRỐNG PHỐ (Đợt 3 W2-A): không vật tĩnh nào được đứng trên LÒNG ĐƯỜNG (nhựa/bê tông ngõ đã vẽ,
// kể cả khe đường đôi phủ nhựa + đa giác nút giao), lấn HÀNH LANG PHỐ (nhà/tường quá mặt tiền xsection.facadeLine), hay
// đứng cách CAMERA PANO (js/panoclear.js, 551 điểm chụp thật) < 3 m ở tầm thân người (0,3-2,6 m trên nền).
//
// SINGLETON như claims.js: world.js gọi initClearance(...) MỘT lần ngay sau khi dựng mạng đường (world.roadNet);
// props.js/trees.js/cellsink.js import các hàm tra cứu — chưa init (node harness) thì mọi hàm trả "không chặn".
// Không import three (nhận THREE gián tiếp qua object truyền vào): chạy được trong node cho phần tra cứu.
//
// Hai cách dùng:
//   (1) ĐẶT MỚI (props/trees/hàm đặt tay trong world.js): clearDisc(x,z,r) / onCarriage(x,z) / nearPano(x,z,r) /
//       nudgeDisc(x,z,r,maxD) → chọn chỗ khác hoặc bỏ.
//   (2) VẬT ĐÃ DỰNG (khối ô qua cellsink, khối phố 966-1827 qua sweepAssemblies): sampleObject() lấy mẫu chân + thân
//       (bao bbox từng mesh — rẻ, hơi dư) → solveShift() đẩy LÙI (theo pháp tuyến phố / ra xa camera) tối đa maxShift m;
//       không được thì gỡ.
import { PANO_CAM } from './panoclear.js';
import { ROAD_HW, SIDEWALK_W } from './xsection.js';

export const CLEAR = {
  PANO_R: 3.0,        // bán kính trống quanh camera pano (m, ngang) ở tầm thân người
  BODY_Y0: 0.3,       // tầm thân: từ 0,3 m …
  BODY_Y1: 2.6,       // … tới 2,6 m trên nền (camera QA ở nền + 2,2 m)
  BASE_Y: 0.6,        // "chân" = phần hình ≤ nền + 0,6 m
  FACADE_TOL: 0.3,    // hợp đồng WP1: footprint thật được lấn facadeLine ≤ 0,3 m
  ALLEY_TOL: 0.4,     // nhà sát ngõ h/w: được lấn mép ngõ ≤ 0,4 m (mái hiên/bậc)
  MAX_SHIFT_BLDG: 8,  // đẩy lùi nhà/tường tối đa
  MAX_SHIFT_SMALL: 6, // dời đồ nhỏ tối đa
  MAX_SHIFT_TOWER: 14, // cao ốc ≥ 15 m có danh tính (pano): dời xa hơn thay vì gỡ
  // TẤM MỎNG (rào tôn/tranh tường/hàng rào dày < 1 m, cao ≥ 1,8 m) của khối ô: luật CHỮ spec — tự nó không được lấp > 40%
  // khung nhìn (FOV dọc 60°, 16:9, mắt 2,2 m — y hệt tools/qa/clearance_page.js) trong 6 m ở 1 trong 8 hướng (phản biện:
  // rào tôn pano_109 chỉ bị đẩy tới đúng 3 m, vẫn lấp 60% khung)
  FILL_D: 6, FILL_MAX: 0.4, EYE: 2.2, THIN: 1.0,
  THIN_SHIFT: 3,       // tấm mỏng chỉ nhích ≤ 3 m; xa hơn → cắt đoạn vi phạm (trimThinWall)
  STREET_ON_MAX: 0.12, // công trình danh tính kẹt: gỡ chỉ khi ≥ 12% ô khối CHÍNH nằm trên lòng phố p/s/t/r (ngõ h/w không tính)
};

let _st = null;   // { surf, nearJ, segs, grid, gh, landH }
const SC = 16;
const PG = new Map(), PC = 8;
for (const [x, z] of PANO_CAM) { const k = Math.floor(x / PC) * 100003 + Math.floor(z / PC); let a = PG.get(k); if (!a) PG.set(k, (a = [])); a.push(x, z); }

// ctx: { ROADS_DT, surfaceAt (world.roadNet.surfaceAt — biết khe nhựa đường đôi), nearJunction?, groundHeight, LAND_H }
export function initClearance(ctx) {
  const segs = [], grid = new Map();
  (ctx.ROADS_DT || []).forEach((rd, ri) => {
    const c = rd.c, hw = ROAD_HW[c] ?? 1.5, sw = SIDEWALK_W[c] ?? 0;
    const street = sw > 0;
    for (let i = 0; i + 1 < rd.pts.length; i++) {
      const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
      const id = segs.length;
      segs.push({ ax, az, bx, bz, c, hw, fl: street ? hw + sw : hw, street, ri });
      const pad = hw + sw + 4;
      for (let gi = Math.floor((Math.min(ax, bx) - pad) / SC); gi <= Math.floor((Math.max(ax, bx) + pad) / SC); gi++)
        for (let gj = Math.floor((Math.min(az, bz) - pad) / SC); gj <= Math.floor((Math.max(az, bz) + pad) / SC); gj++) {
          const k = gi * 100003 + gj; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(id);
        }
    }
  });
  // nền tại ĐÚNG điểm (trước: đệm ô 1 m lấy tâm ô → mép mặt cầu Lạc Long tâm ô rơi xuống nước, cột lan can trên mặt cầu
  // "không chạm nền" nên không bị xét chân — phản biện: 1 mẩu bs_laclong_rail còn trên nhựa)
  const gh = ctx.groundHeight || (() => ctx.LAND_H ?? 2);
  _st = { surf: ctx.surfaceAt || null, nearJ: ctx.nearJunction || null, water: ctx.isWater || null, segs, grid, gh, landH: ctx.LAND_H ?? 2 };
  _released = false;
  return api;
}
// NHẢ bộ nhớ đệm (gọi 1 lần sau props/cây, trước freezeStatic — phản biện: lưới đệm lòng đường _cc ≤ 6 MB giữ suốt phiên,
// heap +6 MB): sau đó tra cứu vẫn đúng nhưng KHÔNG đệm (tính thẳng surfaceAt) — chỉ còn lưới đoạn phố nhỏ.
let _released = false;
export function releaseClearance() {
  _cc.clear(); _deadV.clear(); _deadM.clear(); _dirty.clear();
  _released = true;
}
export const clearanceReady = () => !!_st;

// ---------- tra cứu ----------
// trên LÒNG (nhựa/bê tông ngõ, khe đường đôi, nút giao) — theo world.roadNet.surfaceAt (0 ngoài, ~0,11-0,13 lòng, 0,25 vỉa)
// Bộ nhớ đệm ô 0,5 m (lười, theo mảnh 16 m): props/cây/quét gọi hàng trăm nghìn lần quanh cùng các vỉa hè — đo hồ sơ CPU:
// surfaceAt chiếm ~0,3 s lúc dựng nếu gọi thẳng. Sai số ≤ 0,35 m (tâm ô) — các luật đều có lề ≥ 0,3 m.
const _cc = new Map();
// CHÍNH XÁC (props/cây/đặt tay): gọi thẳng surfaceAt
export function onCarriage(x, z) {
  if (!_st || !_st.surf) return false;
  const s = _st.surf(x, z);
  return s > 0.05 && s < 0.2;
}
// NHANH (quét vật đã dựng — hàng trăm lần thử dời mỗi vật): đệm theo LƯỚI ĐỈNH 0,5 m (mỗi đỉnh 1 lần surfaceAt, dùng chung
// giữa 4 ô); 4 đỉnh ô chứa điểm cùng kết quả → trả luôn, khác nhau (ô MÉP lòng) → tính CHÍNH XÁC tại điểm. Trước: giá trị tâm
// ô (sai ±0,35 m ở mép) → phản biện thấy bàn/đèn dời "hợp lệ" mà chân vẫn chạm mép nhựa đã vẽ.
const _lat = (ix, iz) => {
  const tk = (ix >> 5) * 100003 + (iz >> 5);
  let t = _cc.get(tk); if (!t) { if (_cc.size > 6000) _cc.clear(); _cc.set(tk, (t = new Uint8Array(1024))); }   // trần ~6 MB
  const ci = ((ix & 31) << 5) | (iz & 31);
  let v = t[ci];
  if (!v) { const s = _st.surf(ix / 2, iz / 2); v = s > 0.05 && s < 0.2 ? 2 : 1; t[ci] = v; }
  return v;
};
export function onCarriageFast(x, z) {
  if (!_st || !_st.surf) return false;
  if (_released) return onCarriage(x, z);
  const ix = Math.floor(x * 2), iz = Math.floor(z * 2);
  const a = _lat(ix, iz);
  if (_lat(ix + 1, iz) === a && _lat(ix, iz + 1) === a && _lat(ix + 1, iz + 1) === a) return a === 2;
  return onCarriage(x, z);
}
// đĩa bán kính r chạm lòng đường? (tâm + 8 điểm vành)
export function onCarriageDisc(x, z, r = 0) {
  if (onCarriage(x, z)) return true;
  if (r <= 0) return false;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (onCarriage(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true; }
  return false;
}
// camera pano gần nhất trong bán kính r → {d, x, z} | null
export function nearestPano(x, z, r = CLEAR.PANO_R) {
  const ci = Math.floor(x / PC), cj = Math.floor(z / PC), n = Math.ceil(r / PC);
  let best = null, bd = r * r;
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
    const a = PG.get(i * 100003 + j); if (!a) continue;
    for (let q = 0; q < a.length; q += 2) { const d2 = (a[q] - x) ** 2 + (a[q + 1] - z) ** 2; if (d2 < bd) { bd = d2; best = { d: Math.sqrt(d2), x: a[q], z: a[q + 1] }; } }
  }
  return best;
}
export const nearPano = (x, z, r = CLEAR.PANO_R) => !!nearestPano(x, z, r);
// mọi camera pano trong bán kính r → [[x,z,d],…]
export function panosNear(x, z, r) {
  const ci = Math.floor(x / PC), cj = Math.floor(z / PC), n = Math.ceil(r / PC), out = [];
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
    const a = PG.get(i * 100003 + j); if (!a) continue;
    for (let q = 0; q < a.length; q += 2) { const d = Math.hypot(a[q] - x, a[q + 1] - z); if (d < r) out.push([a[q], a[q + 1], d]); }
  }
  return out;
}
// trên LÒNG PHỐ có vỉa (p/s/t/r, kể cả nút giao/khe nhựa trong hành lang phố) — nhựa NGÕ h/w không tính
export const onStreetCarriage = (x, z) => onCarriage(x, z) && !!corridorPen(x, z, true);
// tỉ lệ ô 1 m (tâm ô) của các bao lồi KHỐI CHÍNH nằm trên lòng phố có vỉa → {n, tot}
export function massOnStreet(hulls) {
  const seen = new Set(); let n = 0, tot = 0;
  for (const H of hulls) {
    if (!H || H.length < 3) continue;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of H) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    for (let ix = Math.floor(x0); ix <= Math.floor(x1); ix++) for (let iz = Math.floor(z0); iz <= Math.floor(z1); iz++) {
      const k = ix * 100003 + iz; if (seen.has(k)) continue;
      if (!inHull(H, ix + 0.5, iz + 0.5)) continue;
      seen.add(k); tot++; if (onStreetCarriage(ix + 0.5, iz + 0.5)) n++;
    }
  }
  return { n, tot, frac: tot ? n / tot : 0 };
}
// LẤP KHUNG: phần (0..1) khung nhìn 64×36 của 1 camera (mắt nền+2,2 m, FOV dọc 60°, 16:9 — như kiểm toán) bị các LĂNG TRỤ
// đứng (bao lồi H dời dx,dz; y0..y1 so với nền) che trong FILL_D m, lớn nhất trên 8 hướng 0..315°. Raster 2,5D theo cột.
// (lưới 32×18 — cùng tỉ lệ khung kiểm toán 64×36, rẻ hơn 4 lần; stop > 0: dừng sớm khi 1 hướng vượt ngưỡng)
const _rows = new Uint8Array(18);
export function prismFill(body, dx, dz, cx, cz, stop = 0) {
  const W = 32, Hh = 18, tanV = Math.tan(Math.PI / 6), tanH = tanV * 16 / 9, EYE = CLEAR.EYE, FD = CLEAR.FILL_D;
  const P = [];
  for (const b of body) {
    if (!b.H || b.H.length < 2 || b.y1 === undefined) continue;
    const Hs = b.H.map(([x, z]) => [x + dx - cx, z + dz - cz]);   // toạ độ so với camera
    let near = Infinity; for (const [x, z] of Hs) near = Math.min(near, Math.hypot(x, z));
    if (near > FD + 30) continue;
    P.push({ H: Hs, y0: b.y0, y1: b.y1, inside: Hs.length >= 3 && inHull(Hs, 0, 0) });
  }
  if (!P.length) return 0;
  let worst = 0;
  for (let h = 0; h < 8; h++) {
    const hr = h * Math.PI / 4, fx = Math.sin(hr), fz = -Math.cos(hr), rx = -fz, rz = fx;
    let cov = 0;
    for (let i = 0; i < W; i++) {
      const xn = (i + 0.5) / W * 2 - 1, vx = fx + rx * xn * tanH, vz = fz + rz * xn * tanH;   // tia: p = s·v (s = độ sâu)
      _rows.fill(0); let any = false;
      for (const p of P) {
        // độ sâu vào lăng trụ: nhỏ nhất s ≥ 0,3 cắt cạnh bao (camera trong bao → 0,3)
        let sIn = p.inside ? 0.3 : Infinity;
        const H = p.H, n = H.length;
        if (!p.inside) for (let k = 0; k < n; k++) {
          const [ax, az] = H[k], [bx, bz] = H[(k + 1) % n], ex = bx - ax, ez = bz - az;
          const den = vx * ez - vz * ex; if (Math.abs(den) < 1e-9) continue;
          const s = (ax * ez - az * ex) / den, t = (ax * vz - az * vx) / den;
          if (t >= 0 && t <= 1 && s >= 0.3 && s < sIn) sIn = s;
        }
        if (sIn > FD) continue;
        for (let j = 0; j < Hh; j++) {
          const yn = 1 - (j + 0.5) / Hh * 2, y = EYE + yn * tanV * sIn;
          if (y >= p.y0 && y <= p.y1) { _rows[j] = 1; any = true; }
        }
      }
      if (any) for (let j = 0; j < Hh; j++) cov += _rows[j];
    }
    const f = cov / (W * Hh); if (f > worst) worst = f;
    if (stop && worst > stop) return worst;
  }
  return worst;
}
// đĩa (x,z,r) sạch: không chạm lòng đường, mép đĩa cách camera pano ≥ PANO_R
// bản rẻ cho đồ đặt trên ô vỉa hè đã kiểm: chỉ TÂM không trên lòng + mép đĩa ≥ PANO_R camera (1 lần surfaceAt có đệm)
export function clearPt(x, z, r = 0, panoR = CLEAR.PANO_R) { return !nearPano(x, z, panoR + r) && !onCarriage(x, z); }
export function clearDisc(x, z, r = 0, panoR = CLEAR.PANO_R) {
  return !onCarriageDisc(x, z, r) && !nearPano(x, z, panoR + r);
}
// đoạn phố gần nhất (mọi cấp) → {d, nx, nz (tim → điểm), c, hw, fl}
export function nearestRoad(x, z, reach = 30) {
  if (!_st) return null;
  let best = null;
  const n = Math.ceil(reach / SC), ci = Math.floor(x / SC), cj = Math.floor(z / SC);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
    const a = _st.grid.get(i * 100003 + j); if (!a) continue;
    for (const id of a) {
      const s = _st.segs[id], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + dx * t, qz = s.az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) {
        let nx = x - qx, nz = z - qz; const l = Math.hypot(nx, nz);
        if (l > 1e-6) { nx /= l; nz /= l; } else { const L = Math.sqrt(l2); nx = -dz / L; nz = dx / L; }
        best = { d, nx, nz, c: s.c, hw: s.hw, fl: s.fl, street: s.street };
      }
    }
  }
  return best;
}
// đoạn phố CÓ VỈA gần nhất (bỏ ngõ h/w) — hướng đẩy khi ngõ "mềm"
export function nearestStreet(x, z, reach = 30) {
  if (!_st) return null;
  let best = null;
  const n = Math.ceil(reach / SC), ci = Math.floor(x / SC), cj = Math.floor(z / SC);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
    const a = _st.grid.get(i * 100003 + j); if (!a) continue;
    for (const id of a) {
      const s = _st.segs[id]; if (!s.street) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + dx * t, qz = s.az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d) {
        let nx = x - qx, nz = z - qz; const l = Math.hypot(nx, nz);
        if (l > 1e-6) { nx /= l; nz /= l; } else { const L = Math.sqrt(l2); nx = -dz / L; nz = dx / L; }
        best = { d, nx, nz, c: s.c, hw: s.hw, fl: s.fl, street: true };
      }
    }
  }
  return best;
}
// LẤN HÀNH LANG PHỐ: độ sâu lớn nhất (m) điểm nằm TRONG mặt tiền (phố có vỉa: facadeLine − d − FACADE_TOL; ngõ h/w:
// nửa lòng − d − ALLEY_TOL) + pháp tuyến đẩy ra; null nếu ngoài mọi hành lang
// streetsOnly: chỉ phố CÓ VỈA (p/s/t/r) — ngõ h/w là "mềm" với công trình danh tính (phản biện W2-A: ngõ dịch vụ chạy qua
// khuôn viên/tháp dựng theo pano — beboi_haly, cn_shpplaza, svd_khandai — từng làm gỡ cả công trình)
export function corridorPen(x, z, streetsOnly = false) {
  if (!_st) return null;
  const ci = Math.floor(x / SC), cj = Math.floor(z / SC);
  const a = _st.grid.get(ci * 100003 + cj); if (!a) return null;
  let best = null;
  for (const id of a) {
    const s = _st.segs[id]; if (streetsOnly && !s.street) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s.ax + dx * t, qz = s.az + dz * t, d = Math.hypot(x - qx, z - qz);
    const pen = s.street ? s.fl - d - CLEAR.FACADE_TOL : s.hw - d - CLEAR.ALLEY_TOL;
    if (pen > 0 && (!best || pen > best.pen)) {
      let nx = x - qx, nz = z - qz; const l = Math.hypot(nx, nz);
      if (l > 1e-6) { nx /= l; nz /= l; } else { const L = Math.sqrt(l2); nx = -dz / L; nz = dx / L; }
      best = { pen, nx, nz, c: s.c };
    }
  }
  return best;
}
// chỗ sạch gần nhất cho đĩa r trong maxD m (vòng xoắn 0,5 m, 16 hướng) — ưu tiên đẩy RA khỏi lòng theo pháp tuyến
export function nudgeDisc(x, z, r = 0.3, maxD = CLEAR.MAX_SHIFT_SMALL, ok = null) {
  const good = (px, pz) => clearDisc(px, pz, r) && (!ok || ok(px, pz));
  if (good(x, z)) return [x, z];
  const nr = nearestRoad(x, z);
  if (nr) for (let s = 0.5; s <= maxD; s += 0.5) { const px = x + nr.nx * s, pz = z + nr.nz * s; if (good(px, pz)) return [px, pz]; }
  for (let s = 0.5; s <= maxD; s += 0.5) for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8; const px = x + Math.cos(a) * s, pz = z + Math.sin(a) * s;
    if (good(px, pz)) return [px, pz];
  }
  return null;
}

// =====================================================================================================================
// VẬT ĐÃ DỰNG: lấy mẫu + giải dời
// =====================================================================================================================
const _e = new Float32Array(16);
function mulM(a, b, out) { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return out; }
function hull2(pts) {
  if (pts.length < 3) return pts.slice();
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function inHull(H, x, z) {
  let s = 0;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c !== 0) { if (!s) s = Math.sign(c); else if (Math.sign(c) !== s) return false; } }
  return true;
}
function hullDist(H, x, z) {   // khoảng cách điểm → bao lồi (0 nếu trong)
  if (H.length >= 3 && inHull(H, x, z)) return 0;
  let b = Infinity;
  for (let i = 0; i < H.length; i++) {
    const [ax, az] = H[i], [bx, bz] = H[(i + 1) % H.length], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t); if (d < b) b = d;
  }
  return b;
}
function hullClosest(H, x, z) {   // điểm gần nhất trên viền bao lồi
  let b = Infinity, bx = x, bz = z;
  for (let i = 0; i < H.length; i++) {
    const [ax, az] = H[i], [cx, cz] = H[(i + 1) % H.length], dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz); if (d < b) { b = d; bx = px; bz = pz; }
  }
  return [bx, bz];
}
// mẫu 1 bao lồi XZ: chỉ VIỀN mỗi 0,75 m (đỉnh luôn có) (đủ: dải đường/ngõ nào cắt qua khối thì cũng cắt viền; lưới trong tốn ×5)
function sampleHull(H, out) {
  for (let i = 0; i < H.length; i++) {
    const [ax, az] = H[i], [bx, bz] = H[(i + 1) % H.length], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.75));
    for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
  }
}
// có đoạn phố nào trong ô lưới phủ hộp (x0..x1,z0..z1) nới pad? (lọc nhanh vật thể xa mọi phố)
// Có THỂ vi phạm đường không? (lọc nhanh bảo thủ, theo hình tròn bao hộp): 'bldg' — hành lang facadeLine/mép ngõ;
// 'small' — lòng đường (nửa lòng + 2,8 m phủ cả khe nhựa đường đôi ≤ 2,5 m) hoặc gần nút giao (đa giác góc bo).
export function nearAnyRoad(x0, z0, x1, z1, mode = 'bldg') {
  if (!_st) return false;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rad = Math.hypot(x1 - x0, z1 - z0) / 2;
  const n = Math.ceil((rad + 12) / SC), ci = Math.floor(cx / SC), cj = Math.floor(cz / SC);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
    const a = _st.grid.get(i * 100003 + j); if (!a) continue;
    for (const id of a) {
      const s = _st.segs[id], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      let t = ((cx - s.ax) * dx + (cz - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const need = mode === 'bldg' ? s.fl + 0.1 : s.hw + (s.street ? 2.8 : 0.4);
      if (Math.hypot(cx - s.ax - dx * t, cz - s.az - dz * t) - rad <= need) return true;
    }
  }
  if (mode !== 'bldg' && _st.nearJ && _st.nearJ(cx, cz, rad + 2)) return true;
  return false;
}
const isSkipMat = (q) => !q || (q.transparent && q.opacity < 0.35) || q.colorWrite === false;
// Lấy mẫu vật thể đã dựng (đã updateMatrixWorld): bao bbox từng mesh (InstancedMesh: từng instance).
//   base: [x,z,…] điểm chân (mesh có đáy ≤ nền + BASE_Y)   body: [{H, y0, y1}] bao thân giao tầm 0,3-2,6 m
//   opts.meshFilter(m) → false = bỏ mesh; opts.maxArea: mesh có bbox phủ > maxArea m² bị bỏ (nền/mặt sân rộng)
export function sampleObject(o, opts = {}) {
  const gh = _st ? _st.gh : () => 2;
  const base = [], body = [], mass = [];
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, massive = 0, nMesh = 0, thick = false;
  const one = (m, me) => {
    const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox; if (!isFinite(bb.min.x)) return;
    const P = []; let my0 = 1e9, my1 = -1e9;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? bb.max.x : bb.min.x, y = k & 2 ? bb.max.y : bb.min.y, z = k & 4 ? bb.max.z : bb.min.z;
      const X = me[0] * x + me[4] * y + me[8] * z + me[12], Y = me[1] * x + me[5] * y + me[9] * z + me[13], Z = me[2] * x + me[6] * y + me[10] * z + me[14];
      P.push([X, Z]); if (Y < my0) my0 = Y; if (Y > my1) my1 = Y;
    }
    const H = hull2(P);
    let hx0 = 1e9, hx1 = -1e9, hz0 = 1e9, hz1 = -1e9;
    for (const [x, z] of H) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (z < hz0) hz0 = z; if (z > hz1) hz1 = z; }
    if (opts.maxArea && (hx1 - hx0) * (hz1 - hz0) > opts.maxArea) return;
    if (my1 - my0 < 0.12 && my1 < gh((hx0 + hx1) / 2, (hz0 + hz1) / 2) + 0.3) return;   // mảng phẳng sát nền (lát/sân/vạch)
    nMesh++;
    const g0 = gh((hx0 + hx1) / 2, (hz0 + hz1) / 2);
    if (my0 < y0) y0 = my0; if (my1 > y1) y1 = my1;
    if (hx0 < x0) x0 = hx0; if (hx1 > x1) x1 = hx1; if (hz0 < z0) z0 = hz0; if (hz1 > z1) z1 = hz1;
    if (my0 <= g0 + CLEAR.BASE_Y) sampleHull(H, base);
    if (my1 > g0 + CLEAR.BODY_Y0 && my0 < g0 + CLEAR.BODY_Y1) body.push({ H, y0: my0 - g0, y1: my1 - g0 });
    if (my1 - my0 >= 2.5 && (hx1 - hx0) * (hz1 - hz0) >= 4) { massive += (hx1 - hx0) * (hz1 - hz0); mass.push(H); }
    if (my1 - my0 >= 1.8 && my0 <= g0 + CLEAR.BASE_Y && minWidth(H) >= CLEAR.THIN) thick = true;
  };
  o.updateMatrixWorld(true);
  o.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
    for (let p = m; p && p !== o.parent; p = p.parent) if (p.visible === false) return;
    const mt = Array.isArray(m.material) ? m.material : [m.material];
    if (mt.every(isSkipMat)) return;
    if (opts.meshFilter && !opts.meshFilter(m)) return;
    if (m.isInstancedMesh) {
      const im = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) one(m, mulM(m.matrixWorld.elements, im.subarray(i * 16, i * 16 + 16), _e));
    } else one(m, m.matrixWorld.elements);
  });
  return { base, body, mass, thick, y0, y1, x0, x1, z0, z1, massive, nMesh, height: y1 - y0 };
}
// bề rộng nhỏ nhất của bao lồi (calipers xoay theo cạnh) — tấm mỏng < CLEAR.THIN
export function minWidth(H) {
  if (!H || H.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    let lo = Infinity, hi = -Infinity; for (const p of H) { const v = (p[0] - a[0]) * nx + (p[1] - a[1]) * nz; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < best) best = hi - lo;
  }
  return best;
}
// Mẫu GỌN từ bao lồi từng mesh đã có (cellsink.extractShape: [{h, y0, y1, massive, area}]): chân = viền BAO LỒI CHUNG của
// các mesh có đáy sát nền; thân = bao lồi chung các mesh giao tầm 0,3-2,6 m. Rẻ hơn sampleObject nhiều lần (không duyệt
// lại cây, không lấy mẫu từng mesh) — đủ cho nhà/vật ≤ 20 m (vật trải dài dùng sweepAssemblies theo mảnh).
export function samplesFromHulls(list) {
  const gh = _st ? _st.gh : () => 2;
  const base = [], body = [], seen = new Set();
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, massive = 0, n = 0;
  const tmp = [];
  for (const q of list) {
    if (!q.h || !q.h.length) continue;
    let hx0 = 1e9, hx1 = -1e9, hz0 = 1e9, hz1 = -1e9;
    for (const [x, z] of q.h) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (z < hz0) hz0 = z; if (z > hz1) hz1 = z; }
    const g0 = gh((hx0 + hx1) / 2, (hz0 + hz1) / 2);
    if (q.y1 - q.y0 < 0.12 && q.y1 < g0 + 0.3) continue;   // mảng phẳng SÁT nền (vạch/tấm nổi ≥ 0,3 m vẫn xét)
    n++;
    if (q.y0 < y0) y0 = q.y0; if (q.y1 > y1) y1 = q.y1;
    if (hx0 < x0) x0 = hx0; if (hx1 > x1) x1 = hx1; if (hz0 < z0) z0 = hz0; if (hz1 > z1) z1 = hz1;
    // chân: viền TỪNG mesh sát nền (hợp các bao — không lấy bao lồi chung: khuôn viên chữ L/ôm góc phố sẽ trùm cả vỉa
    // hè/lòng ở góc), khử trùng theo ô 0,5 m
    if (q.y0 <= g0 + CLEAR.BASE_Y) {
      tmp.length = 0; sampleHull(q.h, tmp);
      for (let i = 0; i < tmp.length; i += 2) { const k = Math.round(tmp[i] * 2) * 100003 + Math.round(tmp[i + 1] * 2); if (seen.has(k)) continue; seen.add(k); base.push(tmp[i], tmp[i + 1]); }
    }
    if (q.y1 > g0 + CLEAR.BODY_Y0 && q.y0 < g0 + CLEAR.BODY_Y1) body.push({ H: q.h, y0: q.y0 - g0, y1: q.y1 - g0 });
    if (q.massive) massive += q.area || 0;
  }
  return { base, body, y0, y1, x0, x1, z0, z1, massive, nMesh: n, height: y1 - y0 };
}
// vi phạm khi dời (dx,dz): {n (số mẫu chân trên lòng), pen (lấn hành lang lớn nhất), pano (thiếu bao nhiêu m so với
// PANO_R), push:[px,pz] vector đẩy đề xuất}. mode 'bldg' xét hành lang facadeLine; 'small' xét lòng đường.
export function corrCount(S, dx, dz) { let k = 0; const B = S.base; for (let i = 0; i < B.length; i += 2) if (corridorPen(B[i] + dx, B[i + 1] + dz, true)) k++; return k; }
// S.softAlley: ngõ h/w không tính (công trình danh tính); S.occ(dx,dz) → true = dời vào lô đã có nhà ô GIỮ khác (chỉ xét khi
// dời ≠ 0, sau luật đường/camera); S.thin: tấm mỏng — thêm luật lấp khung ≤ FILL_MAX trong FILL_D (prismFill).
export function evalShift(S, dx, dz, mode, quick = false) {
  let n = 0, best = 0, push = null, pen = 0, pano = 0, fill = 0;
  const soft = !!S.softAlley;
  const rad0 = S.x0 !== undefined ? Math.hypot(S.x1 - S.x0, S.z1 - S.z0) / 2 : 0;
  // đồ nhỏ dời: không được LẤN SÂU HƠN vào hành lang phố có vỉa (số mẫu chân trong hành lang ≤ S.corrCap) — đồ đang trên nhựa
  // vẫn ra vỉa hè được, còn tường/hộp ngoài hành lang không bị đẩy RA vỉa hè trước camera (pano_473)
  const occBad = () => !!((S.occ && (dx || dz) && S.occ(dx, dz)) || (S.corrCap !== undefined && (dx || dz) && corrCount(S, dx, dz) > S.corrCap));
  // lọc nhanh: hộp vật thể không chạm ô lưới nào có phố và không camera nào trong tầm → sạch
  if (S.x0 !== undefined && !nearAnyRoad(S.x0 + dx, S.z0 + dz, S.x1 + dx, S.z1 + dz, mode)
    && !nearestPano((S.x0 + S.x1) / 2 + dx, (S.z0 + S.z1) / 2 + dz, rad0 + (S.thin ? CLEAR.FILL_D : CLEAR.PANO_R))) {
    const ob = occBad(); return { n, pen, pano, push, fill, occ: ob, bad: ob };
  }
  const B = S.base, NB = B.length;
  // kiểm nhanh (dò dời): bắt đầu từ mẫu vi phạm lần trước → phần lớn ứng viên hỏng bị loại sau 1-2 mẫu
  const i0 = quick && S.lastBad ? S.lastBad : 0;
  for (let jj = 0; jj < NB; jj += 2) {
    const i = (i0 + jj) % NB;
    const x = B[i] + dx, z = B[i + 1] + dz;
    if ((dx || dz) && _st && _st.water && _st.water(x, z)) { if (quick) { S.lastBad = i; return { bad: true }; } n++; continue; }   // dời không được xuống nước
    if (mode === 'bldg') {
      const c = corridorPen(x, z, soft);
      if (c && c.pen > 0.02) { if (quick) { S.lastBad = i; return { bad: true }; } n++; if (c.pen > pen) pen = c.pen; if (c.pen + 0.05 > best) { best = c.pen + 0.05; push = [c.nx * best, c.nz * best]; } continue; }
      if (!c) continue;   // ngoài MỌI hành lang → không thể trên lòng (lòng/nút giao/khe nhựa đều nằm trong hành lang) — bỏ tra surfaceAt
    } else if (soft && !corridorPen(x, z, true)) continue;   // ngoài hành lang phố có vỉa → nhựa (nếu có) là ngõ h/w: mềm
    if (onCarriageFast(x, z)) {
      if (quick) { S.lastBad = i; return { bad: true }; }
      n++;
      const r = soft ? nearestStreet(x, z, 10) : nearestRoad(x, z, 10);   // tầm 10 m (1 ô lưới ± 1): đủ cho điểm đang nằm TRÊN lòng
      const need = r ? Math.max(0.3, r.hw - r.d + 0.3) : 0.5;
      if (need > best) { best = need; push = r ? [r.nx * need, r.nz * need] : null; }
    }
  }
  // TẤM MỎNG: lấp khung camera trong FILL_D (luật chữ spec, KHÔNG miễn mặt tiền) → đẩy ra xa camera tới FILL_D
  if (S.thin && S.x0 !== undefined && !(quick && n)) {
    const mx = (S.x0 + S.x1) / 2 + dx, mz = (S.z0 + S.z1) / 2 + dz;
    for (const [qx, qz] of panosNear(mx, mz, rad0 + CLEAR.FILL_D)) {
      let d = Infinity; for (const b of S.body) { const Hs = dx || dz ? b.H.map(([x, z]) => [x + dx, z + dz]) : b.H; d = Math.min(d, hullDist(Hs, qx, qz)); }
      if (d >= CLEAR.FILL_D) continue;
      const f = prismFill(S.body, dx, dz, qx, qz, CLEAR.FILL_MAX);
      if (f > fill) fill = f;
      if (f <= CLEAR.FILL_MAX) continue;
      if (quick) return { bad: true };
      const need = CLEAR.FILL_D - d + 0.1;
      if (need > best) {
        let vx = mx - qx, vz = mz - qz; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
        const r = nearestRoad(mx, mz, 16);
        if (r && r.d > 0.5 && (r.nx * vx + r.nz * vz) > 0.2) { vx = r.nx; vz = r.nz; }
        best = need; push = [vx * need, vz * need];
      }
    }
  }
  const anyCam = S.x0 === undefined || !!nearestPano((S.x0 + S.x1) / 2 + dx, (S.z0 + S.z1) / 2 + dz, rad0 + CLEAR.PANO_R);
  // MỌI camera trong tầm (trước: chỉ camera gần TÂM bao nhất — tường tranh 24 m beboi_haly cách pano_533 2,3 m lọt luật vì
  // tâm tường gần pano_548 hơn sau khi dời)
  if (anyCam) for (const b of S.body) {
    let cx = 0, cz = 0; for (const [x, z] of b.H) { cx += x; cz += z; } cx = cx / b.H.length + dx; cz = cz / b.H.length + dz;
    let rad = 0; for (const [x, z] of b.H) rad = Math.max(rad, Math.hypot(x + dx - cx, z + dz - cz));
    const Hs = dx || dz ? b.H.map(([x, z]) => [x + dx, z + dz]) : b.H;
    for (const [camx, camz] of panosNear(cx, cz, rad + CLEAR.PANO_R)) {
    const cam = { x: camx, z: camz };
    const d = hullDist(Hs, cam.x, cam.z);
    if (d < CLEAR.PANO_R && mode === 'bldg' && S.facadeExempt && d > 0.05) {
      // NHÀ: camera (đứng trong hành lang phố) gần MẶT TIỀN đã lùi đúng facadeLine = lệch dữ liệu camera/đường (camera
      // trên vỉa hè phố hẹp) — không đẩy nhà lùi thêm; chỉ tính khi điểm gần nhất (lùi sâu 0,3 m) còn trong hành lang
      if (corridorPen(cam.x, cam.z) || onCarriage(cam.x, cam.z)) {
        const q = hullClosest(Hs, cam.x, cam.z), ux = (q[0] - cam.x) / d, uz = (q[1] - cam.z) / d;
        if (!corridorPen(q[0] + ux * 0.3, q[1] + uz * 0.3)) continue;
      }
    }
    if (d < CLEAR.PANO_R) {
      if (quick) return { bad: true };
      const need = CLEAR.PANO_R - d + 0.05; if (need > pano) pano = need;
      if (need > best) {
        let vx = cx - cam.x, vz = cz - cam.z; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
        // camera trong hành lang phố → đẩy theo pháp tuyến phố (ra mặt tiền) thay vì xuyên tâm
        const r = nearestRoad(cx, cz, 16);
        if (r && r.d > 0.5 && (r.nx * vx + r.nz * vz) > 0.2) { vx = r.nx; vz = r.nz; }
        best = need + (d === 0 ? rad : 0); push = [vx * best, vz * best];
      }
    }
    }
  }
  const bad0 = n > 0 || pano > 0 || fill > CLEAR.FILL_MAX;
  if (bad0) return { n, pen, pano, push, fill, bad: true };
  const ob = occBad();
  return { n, pen, pano, push, fill, occ: ob, bad: ob };
}
// tìm (dx,dz) |d| ≤ maxShift để hết vi phạm; null nếu không được. Lặp theo vector đẩy lớn nhất (góc phố → 2 pháp tuyến).
export function solveShift(S, mode, maxShift) {
  let dx = 0, dz = 0;
  for (let it = 0; it < 10; it++) {
    const e = evalShift(S, dx, dz, mode);
    if (!e.bad) return { dx, dz, it };
    if (!e.push) break;
    dx += e.push[0]; dz += e.push[1];
    if (Math.hypot(dx, dz) > maxShift) break;
  }
  // lặp theo vector đẩy có thể dao động (nhà góc phố kẹp giữa 2 hành lang) → dò lưới cực: 24 hướng × bước 0,5 m,
  // lấy dời NGẮN nhất hết vi phạm (kiểm nhanh: dừng ở vi phạm đầu tiên; mẫu chân thưa ≤ 400 điểm)
  let Sq = S;
  if (S.base.length > 800) { const st = Math.ceil(S.base.length / 800); const b = []; for (let i = 0; i < S.base.length; i += 2 * st) b.push(S.base[i], S.base[i + 1]); Sq = { ...S, base: b, lastBad: 0 }; }
  // lưới dò thưa (đo: dò 16 hướng × bước 0,5 m chiếm ~2/3 thời gian quét khoảng trống lúc dựng thế giới)
  const ND = mode === 'bldg' ? 12 : 8;
  for (const s of [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 14]) {
    if (s > maxShift + 1e-6) break;
    for (let k = 0; k < ND; k++) {
      const a = k * 2 * Math.PI / ND, ddx = Math.cos(a) * s, ddz = Math.sin(a) * s;
      if (evalShift(Sq, ddx, ddz, mode, true).bad) continue;
      if (Sq !== S && evalShift(S, ddx, ddz, mode, true).bad) continue;
      return { dx: ddx, dz: ddz, it: -1 };
    }
  }
  return null;
}

// =====================================================================================================================
// KHỐI PHỐ (world.js 966-1827): mesh GỘP nhiều nơi (addMerged: hòn non bộ, đài phun, lan can, bonsai…) → tách thành
// THÀNH PHẦN LIÊN THÔNG (chỉ số đỉnh chung / trùng vị trí) → gom các mảnh chồng nhau trên mặt bằng (từ mọi mesh: chậu
// + tán + kiềng của 1 bonsai) thành CỤM; nhóm (Group) là 1 mảnh cứng. Cụm vi phạm → dời (dịch đỉnh / position) hoặc gỡ
// (thu đỉnh về 1 điểm / tháo nhóm) + dời/vô hiệu collider + vòng FEATURED_CLEAR nằm trong cụm.
// =====================================================================================================================
function components(g) {
  const pos = g.attributes.position, n = pos.count, idx = g.index;
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  if (idx) { for (let t = 0; t + 2 < idx.count; t += 3) { uni(idx.getX(t), idx.getX(t + 1)); uni(idx.getX(t), idx.getX(t + 2)); } }
  else for (let t = 0; t + 2 < n; t += 3) { uni(t, t + 1); uni(t, t + 2); }
  // HÀN theo vị trí (2 mm): BoxGeometry/Cylinder có đỉnh RIÊNG cho từng mặt/nắp → không hàn thì 1 hộp = 6 mảnh
  const key = new Map();
  for (let i = 0; i < n; i++) { const k = Math.round(pos.getX(i) * 500) * 73856093 ^ Math.round(pos.getY(i) * 500) * 19349663 ^ Math.round(pos.getZ(i) * 500) * 83492791; const j = key.get(k); if (j === undefined) key.set(k, i); else if (Math.abs(pos.getX(j) - pos.getX(i)) < 0.003 && Math.abs(pos.getY(j) - pos.getY(i)) < 0.003 && Math.abs(pos.getZ(j) - pos.getZ(i)) < 0.003) uni(i, j); }
  const comp = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let a = comp.get(r); if (!a) comp.set(r, (a = [])); a.push(i); }
  return [...comp.values()];
}
// objs: đối tượng cấp cao nhất do khối phố thêm; cols: collider khối phố thêm ({x,z,r}); fc: vòng FEATURED_CLEAR khối
// phố thêm ([x,z,r]); opts.keep(name) → true = không đụng (dải phân cách, đường ray, cầu…). Trả báo cáo.
export function sweepAssemblies(objs, cols, fc, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  if (!_st) return { skipped: true };
  const gh = _st.gh;
  const pieces = [];
  const rep = { pieces: 0, assemblies: 0, moved: [], removed: [], kept: 0, colMoved: 0, colOff: 0, fcMoved: 0 };
  // geometry DÙNG CHUNG giữa nhiều mesh (vd 1 hình đã translate dùng cho 2 material) → không sửa đỉnh (sẽ dời/xoá cả mesh kia)
  const geoUse = new Map(); for (const o of objs) if (o && o.isMesh && o.geometry) geoUse.set(o.geometry, (geoUse.get(o.geometry) || 0) + 1);
  for (const o of objs) {
    if (!o || !o.parent) continue;
    const nm = o.name || '';
    if (opts.keep && opts.keep(nm, o)) continue;
    o.updateMatrixWorld(true);
    const me = o.matrixWorld.elements;
    const ident = Math.abs(me[0] - 1) < 1e-6 && Math.abs(me[5] - 1) < 1e-6 && Math.abs(me[10] - 1) < 1e-6 && Math.abs(me[12]) < 1e-6 && Math.abs(me[14]) < 1e-6 && Math.abs(me[13]) < 1e-6;
    if (o.isMesh && !o.isInstancedMesh && ident && o.children.length === 0 && geoUse.get(o.geometry) === 1) {
      // mesh gộp (toạ độ thế giới nướng sẵn) → từng thành phần liên thông
      const mt = Array.isArray(o.material) ? o.material : [o.material];
      if (mt.every(isSkipMat)) continue;
      const pos = o.geometry.attributes.position;
      for (const vs of components(o.geometry)) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const i of vs) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const g0 = gh((x0 + x1) / 2, (z0 + z1) / 2);
        if (y1 - y0 < 0.12 && y1 < g0 + 0.3) continue;                       // lát/vạch phẳng
        if ((x1 - x0) * (z1 - z0) > 2500 && y1 - y0 < 0.25) continue;      // mảng nền rộng (đảo cỏ nổi 0,3 m vẫn xét)
        pieces.push({ kind: 'comp', o, vs, x0, x1, z0, z1, y0, y1, g0, name: nm });
      }
    } else if (o.isInstancedMesh) {
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const im = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        mulM(me, im.subarray(i * 16, i * 16 + 16), _e);
        const S = { base: [], body: [] };
        // bbox instance
        const bb = g.boundingBox; const P = []; let y0 = 1e9, y1 = -1e9;
        for (let k = 0; k < 8; k++) { const x = k & 1 ? bb.max.x : bb.min.x, y = k & 2 ? bb.max.y : bb.min.y, z = k & 4 ? bb.max.z : bb.min.z; P.push([_e[0] * x + _e[4] * y + _e[8] * z + _e[12], _e[2] * x + _e[6] * y + _e[10] * z + _e[14]]); const Y = _e[1] * x + _e[5] * y + _e[9] * z + _e[13]; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        pieces.push({ kind: 'inst', o, i, x0, x1, z0, z1, y0, y1, g0: gh((x0 + x1) / 2, (z0 + z1) / 2), H: hull2(P), name: nm });
        void S;
      }
    } else {
      const S = sampleObject(o, { maxArea: 2500 });
      if (!S.nMesh) continue;
      pieces.push({ kind: 'obj', o, S, x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1, y0: S.y0, y1: S.y1, g0: gh((S.x0 + S.x1) / 2, (S.z0 + S.z1) / 2), name: nm });
    }
  }
  rep.pieces = pieces.length; rep.tPieces = +(((typeof performance !== "undefined" ? performance : Date).now()) - t0).toFixed(1);
  // ---- gom cụm: mảnh mesh-gộp/instance chồng nhau trên mặt bằng (dung sai 0,25 m) ----
  const par = pieces.map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const G = new Map(), GC = 8;
  pieces.forEach((p, i) => {
    if (p.kind === 'obj' && !p.o.isMesh) return;  // Group (nhà/công trình dựng sẵn): mảnh cứng riêng; mesh lẻ (cột, núm, cờ…) thì gom
    for (let gi = Math.floor((p.x0 - 0.25) / GC); gi <= Math.floor((p.x1 + 0.25) / GC); gi++)
      for (let gj = Math.floor((p.z0 - 0.25) / GC); gj <= Math.floor((p.z1 + 0.25) / GC); gj++) {
        const k = gi * 100003 + gj; let a = G.get(k); if (!a) G.set(k, (a = []));
        for (const j of a) {
          const q = pieces[j];
          if (p.x0 - 0.25 > q.x1 || q.x0 - 0.25 > p.x1 || p.z0 - 0.25 > q.z1 || q.z0 - 0.25 > p.z1) continue;
          // không nối 2 mảnh DÀI (thanh lan can, dây) chỉ vì chạm đầu — cần chồng ≥ 30% cạnh ngắn của mảnh nhỏ
          const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), oz = Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0);
          const sp = Math.min(p.x1 - p.x0, p.z1 - p.z0, q.x1 - q.x0, q.z1 - q.z0);
          if (Math.min(ox, oz) < -0.25 || (Math.max(p.x1 - p.x0, p.z1 - p.z0) > 6 && Math.max(q.x1 - q.x0, q.z1 - q.z0) > 6 && Math.min(ox, oz) < 0.3 * sp)) continue;
          const ra = find(i), rb = find(j); if (ra !== rb) par[ra] = rb;
        }
        a.push(i);
      }
  });
  const asm = new Map();
  pieces.forEach((p, i) => { const r = find(i); let a = asm.get(r); if (!a) asm.set(r, (a = [])); a.push(p); });
  rep.assemblies = asm.size; rep.tLink = +(((typeof performance !== "undefined" ? performance : Date).now()) - t0).toFixed(1);
  // collider / FC: lưới tra nhanh
  const CG = new Map();
  for (const c of cols) { const k = Math.floor(c.x / 8) * 100003 + Math.floor(c.z / 8); let a = CG.get(k); if (!a) CG.set(k, (a = [])); a.push(c); }
  const inAsm = (A, x, z) => A.some((p) => x >= p.x0 - 0.3 && x <= p.x1 + 0.3 && z >= p.z0 - 0.3 && z <= p.z1 + 0.3);
  const colsOf = (A) => {
    const out = []; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of A) { x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1); }
    for (let gi = Math.floor(x0 / 8) - 1; gi <= Math.floor(x1 / 8) + 1; gi++) for (let gj = Math.floor(z0 / 8) - 1; gj <= Math.floor(z1 / 8) + 1; gj++) {
      const a = CG.get(gi * 100003 + gj); if (!a) continue;
      for (const c of a) if (!c.__clr && inAsm(A, c.x, c.z)) out.push(c);
    }
    return out;
  };
  // ---- mỗi cụm: mẫu chân/thân → giải dời ----
  // collider/FC bị gỡ: đánh dấu (rep.colDead/fcDead) để người gọi NÉN mảng (trước: đỗ ở 1e7 → 266 collider chết + vòng FC
  // r 38 m của KS đã gỡ vẫn chặn props); collider đã dời/gỡ → rep.colTouched (cellsink bước 6 không xử lý lại)
  rep.colDead = new Set(); rep.fcDead = new Set(); rep.colTouched = new Set(); rep.fcTouched = new Set();
  const killCol = (c) => { c.x = 1e7; c.z = 1e7; rep.colDead.add(c); rep.colTouched.add(c); rep.colOff++; };
  const killFC = (A) => { for (const f of fc) if (!rep.fcDead.has(f) && inAsm(A, f[0], f[1])) { rep.fcDead.add(f); rep.fcTouched.add(f); } };
  // chỗ đã có NHÀ (opts.occAt(x,z,mode) → true: ô khối nhà ô GIỮ / footprint thật): số mẫu chân rơi vào chỗ có nhà sau khi dời
  // không được nhiều hơn tại chỗ (+1) → không dời đồ/tường/công trình xuyên vào nhà khác (phản biện: c_lkt_pair)
  const occCount = (S, dx, dz, mode) => { let k = 0; const B = S.base; for (let i = 0; i < B.length; i += 2) if (opts.occAt(B[i] + dx, B[i + 1] + dz, mode)) k++; return k; };
  for (const A of asm.values()) {
    const S = { base: [], body: [] };
    let massive = 0, h = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, wallLike = false, thick = false;
    const mass = [];
    for (const p of A) {
      x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1);
      if (p.kind === 'obj') {
        for (const v of p.S.base) S.base.push(v); for (const b of p.S.body) S.body.push(b); massive += p.S.massive; h = Math.max(h, p.S.height);
        for (const H of p.S.mass) mass.push(H); if (p.S.thick) thick = true;
        if (p.S.base.length && p.S.height >= 1.8 && Math.max(p.S.x1 - p.S.x0, p.S.z1 - p.S.z0) >= 3) wallLike = true;
        continue;
      }
      // mảnh nhỏ (< 1,5 m): hộp trục là đủ (hàng nghìn cột/thanh/chậu — bao lồi từng mảnh từng tốn ~40 ms)
      const small = Math.max(p.x1 - p.x0, p.z1 - p.z0) < 1.5;
      const H = p.H || (small ? [[p.x0, p.z0], [p.x1, p.z0], [p.x1, p.z1], [p.x0, p.z1]] : hull2(p.kind === 'comp' ? (() => { const pos = p.o.geometry.attributes.position; const P = []; const st = Math.max(1, Math.floor(p.vs.length / 64)); for (let q = 0; q < p.vs.length; q += st) P.push([pos.getX(p.vs[q]), pos.getZ(p.vs[q])]); P.push([p.x0, p.z0], [p.x1, p.z1]); return P; })() : []));
      p.H = H;
      if (p.y0 <= p.g0 + CLEAR.BASE_Y) sampleHull(H, S.base);
      if (p.y1 > p.g0 + CLEAR.BODY_Y0 && p.y0 < p.g0 + CLEAR.BODY_Y1) S.body.push({ H, y0: p.y0 - p.g0, y1: p.y1 - p.g0 });
      h = Math.max(h, p.y1 - p.g0);
      if (p.y1 - p.y0 >= 2.5) { massive += (p.x1 - p.x0) * (p.z1 - p.z0); mass.push(H); }
      // tấm tường/cổng/rào cao ≥ 1,8 m dài ≥ 3 m chạm nền → đứng ở ranh đất như nhà (luật hành lang)
      if (p.y0 <= p.g0 + CLEAR.BASE_Y && p.y1 - p.y0 >= 1.8 && Math.max(p.x1 - p.x0, p.z1 - p.z0) >= 3) wallLike = true;
      if (p.y0 <= p.g0 + CLEAR.BASE_Y && p.y1 - p.y0 >= 1.8 && minWidth(H) >= CLEAR.THIN) thick = true;
    }
    S.x0 = x0; S.x1 = x1; S.z0 = z0; S.z1 = z1;   // hộp cụm → evalShift lọc nhanh cụm xa phố/camera
    // TẤM MỎNG (khối ô: rào tôn, tranh tường, hàng rào/cổng song sắt — mọi phần cao ≥ 1,8 m dày < 1 m): luật lấp khung
    // chữ spec, KHÔNG miễn mặt tiền (phản biện: pano_109/146 rào tôn đẩy đúng tới 3 m vẫn lấp 55-60% khung)
    S.thin = !!opts.wallLike && wallLike && !thick;
    S.facadeExempt = !S.thin && h >= 1.8 && massive >= 12;   // chỉ NHÀ khối được miễn luật camera khi mặt tiền đã ở facadeLine
    let mode = (h >= 1.8 && massive >= 12) || (wallLike && opts.wallLike) ? 'bldg' : 'small';   // tường/cổng: chỉ khối ô (opts.wallLike)
    // nhà DÃY CHUNG CHUNG đặt tay (vd showroom Hoàng Diệu) chồng lên footprint THẬT (lớp phố WP2 đã dựng nhà đó) → bản
    // trùng: gỡ (như luật cellsink 'overlap'); opts.realDup(tên) bật luật, opts.realAt(x,z) = điểm trong nhà thật không SYNTH
    if (opts.realDup && opts.realAt && A.length === 1 && A[0].kind === 'obj' && opts.realDup(A[0].name)) {
      let hit = 0, tot = 0;
      for (let x = x0 + 0.5; x < x1; x += 1) for (let z = z0 + 0.5; z < z1; z += 1) {
        if (!A[0].S.body.some((b) => b.H.length >= 3 && inHull(b.H, x, z))) continue;
        tot++; if (opts.realAt(x, z)) hit++;
      }
      if (tot && hit >= 0.3 * tot) {
        for (const p of A) dropMesh(p);
        for (const c of colsOf(A)) killCol(c);
        killFC(A);
        rep.removed.push([A[0].name, [+((x0 + x1) / 2).toFixed(1), +((z0 + z1) / 2).toFixed(1)], 'realDup', +(hit / tot).toFixed(2)]);
        continue;
      }
    }
    const name = A[0].name || A[0].o.name || '?';
    // công trình DANH TÍNH (nhóm có tên dựng theo pano): ngõ h/w "mềm" — chỉ phố có vỉa + camera
    const isIdent = mode === 'bldg' && !!opts.identity && opts.identity(name, A);
    if (isIdent) S.softAlley = true;
    const e0 = evalShift(S, 0, 0, mode);
    if (!e0.bad) { rep.kept++; continue; }
    const where = [+((x0 + x1) / 2).toFixed(1), +((z0 + z1) / 2).toFixed(1)];
    // (danh tính phố: không — footprint thật CỦA CHÍNH nó nằm dưới, vd KS Harbour View)
    if (opts.occAt && !isIdent) { const md = mode, k0 = occCount(S, 0, 0, md); S.occ = (dx, dz) => occCount(S, dx, dz, md) > k0 + 1; }
    if (mode === 'small') S.corrCap = corrCount(S, 0, 0) + 1;
    // tấm mỏng: chỉ NHÍCH ≤ THIN_SHIFT m (rào tôn dời 8 m dọc phố từng "hợp lệ") — không được thì CẮT đoạn vi phạm (trimThin)
    const maxS = S.thin ? CLEAR.THIN_SHIFT : mode === 'bldg' ? (h >= 15 ? CLEAR.MAX_SHIFT_TOWER : CLEAR.MAX_SHIFT_BLDG) : CLEAR.MAX_SHIFT_SMALL;
    let sol = solveShift(S, mode, maxS);
    // công trình danh tính không lùi nổi ra sau facadeLine → ít nhất ra khỏi LÒNG PHỐ (+ camera)
    if (!sol && isIdent) { sol = solveShift(S, 'small', maxS); if (sol) mode = 'bldg/partial'; }
    const myCols = colsOf(A);
    for (const c of myCols) c.__clr = 1;
    if (sol) {
      for (const p of A) moveMesh(p, sol.dx, sol.dz);
      for (const c of myCols) { c.x += sol.dx; c.z += sol.dz; rep.colMoved++; rep.colTouched.add(c); }
      for (const f of fc) if (inAsm(A, f[0], f[1])) { f[0] += sol.dx; f[1] += sol.dz; rep.fcMoved++; rep.fcTouched.add(f); }
      rep.moved.push([name, where, +sol.dx.toFixed(2), +sol.dz.toFixed(2), mode + (S.thin ? '/thin' : '')]);
      // công trình danh tính đã dời: giữ chỗ (claims.js) bao lồi khối chính CŨ ∪ MỚI → lớp nhà thật (WP2) bỏ footprint
      // nằm dưới — footprint thật trước đây khuất TRONG mô hình (KS Harbour View: kho tôn 4 m trước camera pano_041)
      if (isIdent && mass.length) { const P = []; for (const H of mass) for (const [x, z] of H) P.push([x, z], [x + sol.dx, z + sol.dz]); (rep.claims || (rep.claims = [])).push([name, hull2(P)]); }
    } else if (isIdent) {
      // danh tính không dời nổi: GỠ chỉ khi KHỐI CHÍNH (mesh cao ≥ 2,5 m) nằm trên lòng phố có vỉa ≥ STREET_ON_MAX;
      // không thì GIỮ tại chỗ (như dot3) + bỏ các mảnh PHỤ (con trực tiếp không phải khối chính) tự vi phạm
      const ms = massOnStreet(mass);
      if (ms.frac >= CLEAR.STREET_ON_MAX) {
        for (const p of A) dropMesh(p);
        for (const c of myCols) killCol(c);
        killFC(A);
        rep.removed.push([name, where, mode + '/street', +ms.frac.toFixed(2)]);
      } else {
        for (const c of myCols) delete c.__clr;
        const nd = A.length === 1 && A[0].kind === 'obj' ? dropBadChildren(A[0].o, rep) : 0;
        (rep.stuck || (rep.stuck = [])).push([name, where, e0.n, +e0.pen.toFixed(2), +e0.pano.toFixed(2), +ms.frac.toFixed(2), nd]);
      }
    } else if (S.thin && A.every((p) => p.kind === 'obj' && thinMeshOf(p.o))) {
      // tấm mỏng 1 mesh hộp/mặt phẳng (rào tôn, tranh tường): CẮT bỏ đoạn vi phạm dọc trục dài, giữ các đoạn còn lại ≥ 2 m
      let segs = 0, cut = 0;
      for (const p of A) {
        const r = trimThinWall(p.o, mode);
        if (!r) continue;
        segs += r.segs; cut += r.cut;
        for (const c of myCols) { if (r.deadAt(c.x, c.z)) killCol(c); else rep.colTouched.add(c); }   // (touched: cellsink bước 6 không xử lý lại)
        for (const f of fc) if (inAsm(A, f[0], f[1])) { rep.fcTouched.add(f); if (r.deadAt(f[0], f[1])) rep.fcDead.add(f); }
        (rep.replaced || (rep.replaced = new Map())).set(p.o, r.clones);
      }
      rep.removed.push([name, where, mode + '/thin-trim', segs, +cut.toFixed(1)]);
      (rep.trimmed || (rep.trimmed = [])).push([name, where, segs, +cut.toFixed(1)]);
    } else if (A.length > 1 && Math.max(x1 - x0, z1 - z0) > 12) {
      // cụm TRẢI DÀI (dãy lan can/rào: cột + thanh nối thành 1 cụm) không dời nổi → chỉ gỡ MẢNH tự vi phạm (đoạn lan can
      // cắt qua lòng/nút giao / đoạn rào tôn lấp khung camera), giữ phần còn lại của dãy
      let nd = 0;
      for (const p of A) {
        const Sp = { base: [], body: [], thin: S.thin };
        if (p.kind === 'obj') { Sp.base = p.S.base; Sp.body = p.S.body; Sp.x0 = p.S.x0; Sp.x1 = p.S.x1; Sp.z0 = p.S.z0; Sp.z1 = p.S.z1; }
        else { if (p.y0 <= p.g0 + CLEAR.BASE_Y) sampleHull(p.H, Sp.base); if (p.y1 > p.g0 + CLEAR.BODY_Y0 && p.y0 < p.g0 + CLEAR.BODY_Y1) Sp.body.push({ H: p.H, y0: p.y0 - p.g0, y1: p.y1 - p.g0 }); Sp.x0 = p.x0; Sp.x1 = p.x1; Sp.z0 = p.z0; Sp.z1 = p.z1; }
        if (!evalShift(Sp, 0, 0, 'small', true).bad) continue;
        dropMesh(p); nd++;
        for (const c of myCols) if (c.x >= p.x0 - 0.3 && c.x <= p.x1 + 0.3 && c.z >= p.z0 - 0.3 && c.z <= p.z1 + 0.3) killCol(c);
        killFC([p]);
      }
      rep.removed.push([name, where, mode + '/pieces', nd, A.length]);
    } else {
      for (const p of A) dropMesh(p);
      for (const c of myCols) killCol(c);   // tách khỏi bản đồ (người gọi nén mảng theo rep.colDead)
      killFC(A);
      rep.removed.push([name, where, mode + (S.thin ? '/thin' : ''), e0.n, +e0.pen.toFixed(2), +e0.pano.toFixed(2), +(e0.fill || 0).toFixed(2)]);
    }
  }
  for (const c of cols) delete c.__clr;
  rep.ms = +(((typeof performance !== 'undefined' ? performance : Date).now()) - t0).toFixed(1);
  return rep;
}
// TẤM MỎNG 1 mesh: BoxGeometry/PlaneGeometry chưa biến dạng, không con, trục dài ≥ 3 m, dày < THIN, cao ≥ 1,2 m
export function thinMeshOf(m) {
  if (!m || !m.isMesh || m.isInstancedMesh || m.children.length) return null;
  const g = m.geometry, P = g && g.parameters; if (!P) return null;
  const sx = Math.hypot(m.matrixWorld.elements[0], m.matrixWorld.elements[1], m.matrixWorld.elements[2]);
  const sz = Math.hypot(m.matrixWorld.elements[8], m.matrixWorld.elements[9], m.matrixWorld.elements[10]);
  if (g.type === 'BoxGeometry') {
    const ax = P.width * sx >= P.depth * sz ? 'x' : 'z', L = ax === 'x' ? P.width * sx : P.depth * sz, T = ax === 'x' ? P.depth * sz : P.width * sx;
    if (L < 3 || T >= CLEAR.THIN || P.height < 1.2) return null;
    return { ax, L: ax === 'x' ? P.width : P.depth };
  }
  if (g.type === 'PlaneGeometry') { if (P.width * sx < 3 || P.height < 1.2) return null; return { ax: 'x', L: P.width }; }
  return null;
}
// CẮT tấm mỏng dọc trục dài: mẫu 0,25 m dọc trục; đoạn XẤU = (mode 'bldg') lấn hành lang phố có vỉa / trên lòng phố, hoặc
// trong FILL_D m quanh camera mà phần còn lại vẫn vi phạm (gần < 3 m hoặc lấp > FILL_MAX) — xử lý camera tệ nhất trước, lặp.
// Giữ các đoạn tốt ≥ 2 m: mỗi đoạn = 1 bản sao mesh, geometry cắt tại chỗ (UV cắt theo, chữ/ảnh không bị ép). Trả
// {segs, cut (m), deadAt(x,z)} hoặc null (không phải tấm mỏng 1 mesh).
export function trimThinWall(m, mode = 'bldg') {
  const tw = thinMeshOf(m); if (!tw || !m.parent) return null;
  m.updateMatrixWorld(true);
  const e = m.matrixWorld.elements, L = tw.L, N = Math.max(2, Math.ceil(L / 0.25));
  const P = [];   // điểm trục (thế giới) theo f ∈ [0,1]
  for (let i = 0; i <= N; i++) { const c = -L / 2 + L * i / N, lx = tw.ax === 'x' ? c : 0, lz = tw.ax === 'z' ? c : 0; P.push([e[0] * lx + e[8] * lz + e[12], e[2] * lx + e[10] * lz + e[14]]); }
  const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
  const gh = _st ? _st.gh : () => 2;
  const y0 = e[13] + g.boundingBox.min.y - gh(P[N >> 1][0], P[N >> 1][1]), y1 = y0 + (g.boundingBox.max.y - g.boundingBox.min.y);
  const bad = new Uint8Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const [x, z] = P[i];
    if (mode === 'bldg') { const c = corridorPen(x, z, true); if (c && c.pen > 0.02) bad[i] = 1; }
    if (onStreetCarriage(x, z)) bad[i] = 1;
  }
  const bodyOf = () => {   // các đoạn tốt hiện tại → lăng trụ mỏng (bao 4 góc dày 0,3 m) cho near/fill
    const out = []; let a = -1;
    for (let i = 0; i <= N + 1; i++) {
      if (i <= N && !bad[i]) { if (a < 0) a = i; continue; }
      if (a >= 0) { const [ax, az] = P[a], [bx, bz] = P[i - 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.15, nz = dx / l * 0.15; out.push({ H: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], y0, y1 }); a = -1; }
    }
    return out;
  };
  let mx = 0, mz = 0; for (const [x, z] of P) { mx += x; mz += z; } mx /= P.length; mz /= P.length;
  for (let it = 0; it < 6; it++) {
    const body = bodyOf(); if (!body.length) break;
    let worst = null, wv = 0;
    for (const [cx, cz] of panosNear(mx, mz, L / 2 + CLEAR.FILL_D)) {
      let d = Infinity; for (const b of body) d = Math.min(d, hullDist(b.H, cx, cz));
      if (d >= CLEAR.FILL_D) continue;
      const f = d < CLEAR.PANO_R ? 2 : prismFill(body, 0, 0, cx, cz);
      if (f > CLEAR.FILL_MAX && f > wv) { wv = f; worst = [cx, cz]; }
    }
    if (!worst) break;
    for (let i = 0; i <= N; i++) if (Math.hypot(P[i][0] - worst[0], P[i][1] - worst[1]) < CLEAR.FILL_D) bad[i] = 1;
  }
  // đoạn tốt ≥ 2 m
  const segs = []; let a = -1;
  for (let i = 0; i <= N + 1; i++) {
    if (i <= N && !bad[i]) { if (a < 0) a = i; continue; }
    if (a >= 0) { if ((i - 1 - a) / N * L >= 2) segs.push([a / N, (i - 1) / N]); a = -1; }
  }
  const keptLen = segs.reduce((s2, [p, q]) => s2 + (q - p) * L, 0);
  const deadAt = (x, z) => { let bi = 0, bd = Infinity; for (let i = 0; i <= N; i++) { const d = Math.hypot(P[i][0] - x, P[i][1] - z); if (d < bd) { bd = d; bi = i; } } if (bd > 1.2) return false; const f = bi / N; return !segs.some(([p, q]) => f >= p - 0.02 && f <= q + 0.02); };
  if (segs.length === 1 && segs[0][0] === 0 && segs[0][1] === 1) return { segs: 1, cut: 0, deadAt, clones: [m] };
  const parent = m.parent, clones = [];
  for (const [ta, tb] of segs) {
    const c = m.clone(); c.geometry = cropAxis(g, tw.ax, L, ta, tb); parent.add(c); clones.push(c);
  }
  parent.remove(m);
  return { segs: segs.length, cut: L - keptLen, deadAt, clones };
}
// cắt geometry hộp/mặt phẳng dọc trục ax (local) giữ phần f ∈ [ta, tb] (f = 0 ở −L/2) — đỉnh dịch vào trong, UV cắt theo
// từng mặt (mặt dọc trục: u tuyến tính theo f, hệ số ±1 suy từ 2 đỉnh khác f; mặt đầu: giữ u)
function cropAxis(g0, ax, L, ta, tb) {
  const g = g0.clone(), pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
  const n = pos.count, get = ax === 'x' ? (i) => pos.getX(i) : (i) => pos.getZ(i), set = ax === 'x' ? (i, v) => pos.setX(i, v) : (i, v) => pos.setZ(i, v);
  const f0 = new Float32Array(n); for (let i = 0; i < n; i++) f0[i] = (get(i) + L / 2) / L;
  if (uv) {
    // đỉnh theo mặt: BoxGeometry/PlaneGeometry 1 đoạn → mỗi mặt 4 đỉnh liên tiếp
    for (let q = 0; q + 3 < n + 1 && q < n; q += 4) {
      let beta = 0;
      for (let a = q; a < q + 4 && a < n && !beta; a++) for (let b = a + 1; b < q + 4 && b < n; b++) if (Math.abs(f0[a] - f0[b]) > 0.5) { beta = (uv.getX(b) - uv.getX(a)) / (f0[b] - f0[a]); break; }
      for (let a = q; a < q + 4 && a < n; a++) { const f1 = ta + f0[a] * (tb - ta); if (beta) uv.setX(a, uv.getX(a) + beta * (f1 - f0[a])); }
    }
    uv.needsUpdate = true;
  }
  for (let i = 0; i < n; i++) set(i, -L / 2 + (ta + f0[i] * (tb - ta)) * L);
  pos.needsUpdate = true; void idx;
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
// công trình danh tính GIỮ TẠI CHỖ (kẹt): bỏ con TRỰC TIẾP không phải khối chính (cổng/rào/tranh/chòi/cây chậu…) mà tự nó
// đứng trên lòng phố có vỉa hoặc sát camera < 3 m (ngõ h/w mềm). Khối chính (mesh cao ≥ 2,5 m, ≥ 4 m²) giữ nguyên.
function dropBadChildren(o, rep) {
  let nd = 0;
  for (const ch of o.children.slice()) {
    const S = sampleObject(ch);
    if (!S.nMesh || S.massive >= 12) continue;
    S.softAlley = true;
    if (!evalShift(S, 0, 0, 'small').bad) continue;
    o.remove(ch); nd++;
    (rep.dropped || (rep.dropped = [])).push([o.name, ch.name || ch.type, +((S.x0 + S.x1) / 2).toFixed(1), +((S.z0 + S.z1) / 2).toFixed(1)]);
  }
  return nd;
}
const _dirty = new Set();
function moveMesh(p, dx, dz) {
  if (p.kind === 'obj') { p.o.position.x += dx; p.o.position.z += dz; p.o.updateMatrixWorld(true); return; }
  if (p.kind === 'inst') {
    const a = p.o.instanceMatrix.array; a[p.i * 16 + 12] += dx; a[p.i * 16 + 14] += dz; p.o.instanceMatrix.needsUpdate = true;
    if (p.o.boundingSphere) p.o.boundingSphere = null; if (p.o.boundingBox) p.o.boundingBox = null;
    return;
  }
  const pos = p.o.geometry.attributes.position;
  for (const i of p.vs) { pos.setX(i, pos.getX(i) + dx); pos.setZ(i, pos.getZ(i) + dz); }
  pos.needsUpdate = true; _dirty.add(p.o.geometry);
}
function dropMesh(p) {
  if (p.kind === 'obj') { if (p.o.parent) p.o.parent.remove(p.o); return; }
  if (p.kind === 'inst') {
    const a = p.o.instanceMatrix.array; for (let k = 0; k < 16; k++) a[p.i * 16 + k] = 0;   // ma trận 0 = instance suy biến
    p.o.instanceMatrix.needsUpdate = true; return;
  }
  // đánh dấu đỉnh chết; flushClearance() dựng lại chỉ số (hoặc nén thuộc tính nếu không chỉ số) bỏ tam giác của chúng
  const g = p.o.geometry, n = g.attributes.position.count;
  let dead = _deadV.get(g); if (!dead) _deadV.set(g, (dead = new Uint8Array(n)));
  let ms = _deadM.get(g); if (!ms) _deadM.set(g, (ms = new Set())); ms.add(p.o);
  for (const i of p.vs) dead[i] = 1;
  _dirty.add(g);
}
const _deadV = new Map(), _deadM = new Map();   // geometry → đỉnh chết / các mesh dùng nó
// sau sweep: bỏ tam giác của mảnh đã gỡ (dựng lại index / nén thuộc tính) + cầu/hộp bao của geometry đã sửa
export function flushClearance() {
  for (const g of _dirty) {
    const dead = _deadV.get(g); let empty = false;
    if (dead) {
      const idx = g.index;
      if (idx) {
        const keep = [];
        for (let t = 0; t + 2 < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (!dead[a] && !dead[b] && !dead[c]) keep.push(a, b, c); }
        g.setIndex(keep);   // mảng thường → three tự chọn Uint16/Uint32
        if (!keep.length) empty = true;
      } else {
        const n = g.attributes.position.count, live = [];
        for (let t = 0; t + 2 < n; t += 3) if (!dead[t] && !dead[t + 1] && !dead[t + 2]) live.push(t);
        if (!live.length) empty = true;
        for (const k of Object.keys(g.attributes)) {
          const a = g.attributes[k], s = a.itemSize, src = a.array, dst = new src.constructor(live.length * 3 * s);
          let w = 0; for (const t of live) for (let q = 0; q < 3 * s; q++) dst[w++] = src[t * s + q];
          g.setAttribute(k, new a.constructor(dst, s, a.normalized));
        }
      }
      // gỡ HẾT mảnh → bỏ hẳn mesh (geometry rỗng làm hỏng splitGeometryByTile/mergeGeometries ở freezeStatic)
      if (empty) for (const m of _deadM.get(g) || []) if (m.parent) m.parent.remove(m);
      _deadV.delete(g); _deadM.delete(g);
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
  }
  _dirty.clear();
}
const api = { onCarriage, onCarriageDisc, nearestPano, nearPano, clearDisc, nearestRoad, corridorPen, nudgeDisc, sampleObject, evalShift, solveShift, sweepAssemblies, flushClearance };
