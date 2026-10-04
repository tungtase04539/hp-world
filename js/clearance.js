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
  const ghC = new Map();
  const gh0 = ctx.groundHeight || (() => ctx.LAND_H ?? 2);
  const gh = (x, z) => { const k = Math.floor(x) * 100003 + Math.floor(z); let v = ghC.get(k); if (v === undefined) { v = gh0(Math.floor(x) + 0.5, Math.floor(z) + 0.5); ghC.set(k, v); } return v; };
  _st = { surf: ctx.surfaceAt || null, nearJ: ctx.nearJunction || null, segs, grid, gh, landH: ctx.LAND_H ?? 2 };
  return api;
}
export const clearanceReady = () => !!_st;

// ---------- tra cứu ----------
// trên LÒNG (nhựa/bê tông ngõ, khe đường đôi, nút giao) — theo world.roadNet.surfaceAt (0 ngoài, ~0,11-0,13 lòng, 0,25 vỉa)
export function onCarriage(x, z) {
  if (!_st || !_st.surf) return false;
  const s = _st.surf(x, z);
  return s > 0.05 && s < 0.2;
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
// đĩa (x,z,r) sạch: không chạm lòng đường, mép đĩa cách camera pano ≥ PANO_R
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
// LẤN HÀNH LANG PHỐ: độ sâu lớn nhất (m) điểm nằm TRONG mặt tiền (phố có vỉa: facadeLine − d − FACADE_TOL; ngõ h/w:
// nửa lòng − d − ALLEY_TOL) + pháp tuyến đẩy ra; null nếu ngoài mọi hành lang
export function corridorPen(x, z) {
  if (!_st) return null;
  const ci = Math.floor(x / SC), cj = Math.floor(z / SC);
  const a = _st.grid.get(ci * 100003 + cj); if (!a) return null;
  let best = null;
  for (const id of a) {
    const s = _st.segs[id], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
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
// mẫu 1 bao lồi XZ: chỉ VIỀN mỗi 0,5 m (đủ: dải đường/ngõ nào cắt qua khối thì cũng cắt viền; lưới trong tốn ×5)
function sampleHull(H, out) {
  for (let i = 0; i < H.length; i++) {
    const [ax, az] = H[i], [bx, bz] = H[(i + 1) % H.length], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
  }
}
// có đoạn phố nào trong ô lưới phủ hộp (x0..x1,z0..z1) nới pad? (lọc nhanh vật thể xa mọi phố)
export function nearAnyRoad(x0, z0, x1, z1, pad = 0) {
  if (!_st) return false;
  for (let i = Math.floor((x0 - pad) / SC); i <= Math.floor((x1 + pad) / SC); i++) for (let j = Math.floor((z0 - pad) / SC); j <= Math.floor((z1 + pad) / SC); j++) if (_st.grid.has(i * 100003 + j)) return true;
  return false;
}
const isSkipMat = (q) => !q || (q.transparent && q.opacity < 0.35) || q.colorWrite === false;
// Lấy mẫu vật thể đã dựng (đã updateMatrixWorld): bao bbox từng mesh (InstancedMesh: từng instance).
//   base: [x,z,…] điểm chân (mesh có đáy ≤ nền + BASE_Y)   body: [{H, y0, y1}] bao thân giao tầm 0,3-2,6 m
//   opts.meshFilter(m) → false = bỏ mesh; opts.maxArea: mesh có bbox phủ > maxArea m² bị bỏ (nền/mặt sân rộng)
export function sampleObject(o, opts = {}) {
  const gh = _st ? _st.gh : () => 2;
  const base = [], body = [];
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, massive = 0, nMesh = 0;
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
    if (my1 - my0 < 0.12 && my1 < gh((hx0 + hx1) / 2, (hz0 + hz1) / 2) + 0.4) return;   // mảng phẳng sát nền (lát/sân/vạch)
    nMesh++;
    const g0 = gh((hx0 + hx1) / 2, (hz0 + hz1) / 2);
    if (my0 < y0) y0 = my0; if (my1 > y1) y1 = my1;
    if (hx0 < x0) x0 = hx0; if (hx1 > x1) x1 = hx1; if (hz0 < z0) z0 = hz0; if (hz1 > z1) z1 = hz1;
    if (my0 <= g0 + CLEAR.BASE_Y) sampleHull(H, base);
    if (my1 > g0 + CLEAR.BODY_Y0 && my0 < g0 + CLEAR.BODY_Y1) body.push({ H, y0: my0 - g0, y1: my1 - g0 });
    if (my1 - my0 >= 2.5 && (hx1 - hx0) * (hz1 - hz0) >= 4) massive += (hx1 - hx0) * (hz1 - hz0);
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
  return { base, body, y0, y1, x0, x1, z0, z1, massive, nMesh, height: y1 - y0 };
}
// vi phạm khi dời (dx,dz): {n (số mẫu chân trên lòng), pen (lấn hành lang lớn nhất), pano (thiếu bao nhiêu m so với
// PANO_R), push:[px,pz] vector đẩy đề xuất}. mode 'bldg' xét hành lang facadeLine; 'small' xét lòng đường.
export function evalShift(S, dx, dz, mode, quick = false) {
  let n = 0, best = 0, push = null, pen = 0, pano = 0;
  // lọc nhanh: hộp vật thể không chạm ô lưới nào có phố và không camera nào trong tầm → sạch
  if (S.x0 !== undefined && !nearAnyRoad(S.x0 + dx, S.z0 + dz, S.x1 + dx, S.z1 + dz)
    && !nearestPano((S.x0 + S.x1) / 2 + dx, (S.z0 + S.z1) / 2 + dz, Math.hypot(S.x1 - S.x0, S.z1 - S.z0) / 2 + CLEAR.PANO_R)) return { n, pen, pano, push, bad: false };
  const B = S.base;
  for (let i = 0; i < B.length; i += 2) {
    const x = B[i] + dx, z = B[i + 1] + dz;
    if (mode === 'bldg') {
      const c = corridorPen(x, z);
      if (c && c.pen > 0.02) { if (quick) return { bad: true }; n++; if (c.pen > pen) pen = c.pen; if (c.pen + 0.05 > best) { best = c.pen + 0.05; push = [c.nx * best, c.nz * best]; } continue; }
    }
    if (onCarriage(x, z)) {
      if (quick) return { bad: true };
      n++;
      const r = nearestRoad(x, z);
      const need = r ? Math.max(0.3, r.hw - r.d + 0.3) : 0.5;
      if (need > best) { best = need; push = r ? [r.nx * need, r.nz * need] : null; }
    }
  }
  for (const b of S.body) {
    let cx = 0, cz = 0; for (const [x, z] of b.H) { cx += x; cz += z; } cx = cx / b.H.length + dx; cz = cz / b.H.length + dz;
    let rad = 0; for (const [x, z] of b.H) rad = Math.max(rad, Math.hypot(x + dx - cx, z + dz - cz));
    const cam = nearestPano(cx, cz, rad + CLEAR.PANO_R);
    if (!cam) continue;
    const Hs = dx || dz ? b.H.map(([x, z]) => [x + dx, z + dz]) : b.H;
    const d = hullDist(Hs, cam.x, cam.z);
    if (d < CLEAR.PANO_R && mode === 'bldg' && d > 0.05) {
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
        const r = nearestRoad(cx, cz);
        if (r && r.d > 0.5 && (r.nx * vx + r.nz * vz) > 0.2) { vx = r.nx; vz = r.nz; }
        best = need + (d === 0 ? rad : 0); push = [vx * best, vz * best];
      }
    }
  }
  return { n, pen, pano, push, bad: n > 0 || pano > 0 };
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
  if (S.base.length > 800) { const st = Math.ceil(S.base.length / 800); const b = []; for (let i = 0; i < S.base.length; i += 2 * st) b.push(S.base[i], S.base[i + 1]); Sq = { base: b, body: S.body }; }
  for (let s = 0.5; s <= maxShift + 1e-6; s += 0.5) {
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, ddx = Math.cos(a) * s, ddz = Math.sin(a) * s;
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
  for (const o of objs) {
    if (!o || !o.parent) continue;
    const nm = o.name || '';
    if (opts.keep && opts.keep(nm, o)) continue;
    o.updateMatrixWorld(true);
    const me = o.matrixWorld.elements;
    const ident = Math.abs(me[0] - 1) < 1e-6 && Math.abs(me[5] - 1) < 1e-6 && Math.abs(me[10] - 1) < 1e-6 && Math.abs(me[12]) < 1e-6 && Math.abs(me[14]) < 1e-6 && Math.abs(me[13]) < 1e-6;
    if (o.isMesh && !o.isInstancedMesh && ident && o.children.length === 0) {
      // mesh gộp (toạ độ thế giới nướng sẵn) → từng thành phần liên thông
      const mt = Array.isArray(o.material) ? o.material : [o.material];
      if (mt.every(isSkipMat)) continue;
      const pos = o.geometry.attributes.position;
      for (const vs of components(o.geometry)) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const i of vs) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const g0 = gh((x0 + x1) / 2, (z0 + z1) / 2);
        if (y1 - y0 < 0.12 && y1 < g0 + 0.4) continue;                       // lát/vạch phẳng
        if ((x1 - x0) * (z1 - z0) > 2500) continue;                          // mảng nền rộng
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
  rep.pieces = pieces.length;
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
  rep.assemblies = asm.size;
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
  for (const A of asm.values()) {
    const S = { base: [], body: [] };
    let massive = 0, h = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of A) {
      x0 = Math.min(x0, p.x0); x1 = Math.max(x1, p.x1); z0 = Math.min(z0, p.z0); z1 = Math.max(z1, p.z1);
      if (p.kind === 'obj') { for (const v of p.S.base) S.base.push(v); for (const b of p.S.body) S.body.push(b); massive += p.S.massive; h = Math.max(h, p.S.height); continue; }
      const H = p.H || hull2(p.kind === 'comp' ? (() => { const pos = p.o.geometry.attributes.position; const P = []; const st = Math.max(1, Math.floor(p.vs.length / 64)); for (let q = 0; q < p.vs.length; q += st) P.push([pos.getX(p.vs[q]), pos.getZ(p.vs[q])]); P.push([p.x0, p.z0], [p.x1, p.z1]); return P; })() : []);
      p.H = H;
      if (p.y0 <= p.g0 + CLEAR.BASE_Y) sampleHull(H, S.base);
      if (p.y1 > p.g0 + CLEAR.BODY_Y0 && p.y0 < p.g0 + CLEAR.BODY_Y1) S.body.push({ H, y0: p.y0 - p.g0, y1: p.y1 - p.g0 });
      h = Math.max(h, p.y1 - p.g0);
      if (p.y1 - p.y0 >= 2.5) massive += (p.x1 - p.x0) * (p.z1 - p.z0);
    }
    const mode = h >= 1.8 && massive >= 12 ? 'bldg' : 'small';
    const e0 = evalShift(S, 0, 0, mode);
    if (!e0.bad) { rep.kept++; continue; }
    const name = A[0].name || A[0].o.name || '?';
    const where = [+((x0 + x1) / 2).toFixed(1), +((z0 + z1) / 2).toFixed(1)];
    const sol = solveShift(S, mode, mode === 'bldg' ? (h >= 15 ? CLEAR.MAX_SHIFT_TOWER : CLEAR.MAX_SHIFT_BLDG) : CLEAR.MAX_SHIFT_SMALL);
    const myCols = colsOf(A);
    for (const c of myCols) c.__clr = 1;
    if (sol) {
      for (const p of A) moveMesh(p, sol.dx, sol.dz);
      for (const c of myCols) { c.x += sol.dx; c.z += sol.dz; rep.colMoved++; }
      for (const f of fc) if (inAsm(A, f[0], f[1])) { f[0] += sol.dx; f[1] += sol.dz; rep.fcMoved++; }
      rep.moved.push([name, where, +sol.dx.toFixed(2), +sol.dz.toFixed(2), mode]);
    } else {
      for (const p of A) dropMesh(p);
      for (const c of myCols) { c.x = 1e7; c.z = 1e7; rep.colOff++; }   // tách khỏi bản đồ (cùng object trong colIdx nếu đã dựng)
      rep.removed.push([name, where, mode, e0.n, +e0.pen.toFixed(2), +e0.pano.toFixed(2)]);
    }
  }
  for (const c of cols) delete c.__clr;
  rep.ms = +(((typeof performance !== 'undefined' ? performance : Date).now()) - t0).toFixed(1);
  return rep;
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
  const pos = p.o.geometry.attributes.position, v0 = p.vs[0], X = pos.getX(v0), Y = pos.getY(v0), Z = pos.getZ(v0);
  for (const i of p.vs) pos.setXYZ(i, X, Y, Z);   // tam giác suy biến (không vẽ, không bóng)
  pos.needsUpdate = true; _dirty.add(p.o.geometry);
}
// sau sweep: cầu/hộp bao của geometry đã sửa
export function flushClearance() {
  for (const g of _dirty) { g.computeBoundingBox(); g.computeBoundingSphere(); }
  _dirty.clear();
}
const api = { onCarriage, onCarriageDisc, nearestPano, nearPano, clearDisc, nearestRoad, corridorPen, nudgeDisc, sampleObject, evalShift, solveShift, sweepAssemblies, flushClearance };
