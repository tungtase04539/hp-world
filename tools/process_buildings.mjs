// process_buildings.mjs v1 — footprint THẬT (Overture: OSM + Google Open Buildings + Microsoft ML) → js/buildings_real.js
// (định dạng RB01 + mục chữ nhật RBR1, xem js/buildings_data.js).
// Chạy (gốc repo): node tools/process_buildings.mjs [--dump <file.json>]   (~35-45 s máy rảnh, tới ~100 s khi máy bận;
// tất định: chạy lại ra byte y hệt; tự giải mã lại kết quả và DỪNG không ghi file nếu có footprint hỏng)
// Cần tools/ov_buildings.csv (python tools/fetch_overture.py) — gitignore, KHÔNG commit; tools/osm_roads_dt.json (tên phố
// cho vùng phố cũ; thiếu thì bỏ qua). Gỡ lỗi: DEBUG_PT=x,z (lý do kéo mặt tiền + bằng chứng lô khe quanh điểm),
// DEBUG_BLK=1; --dump ghi thêm *_gap.json (lý do từng lô khe), *_intdbg.json (bằng chứng hạt lõi ô), *_inv.json (bị bỏ ở 9d).
// Ngưỡng bằng chứng lõi ô (env): INT_NEAR_R/INT_NEAR_MIN, INT_R/INT_FRAC, OPEN_R/OPEN_A (xem bước 8b).
//
// Mục tiêu: đùn footprint lên phải RA ĐƯỢC "bức tường phố" thật (nhà ống liền mạch sát vỉa hè, mỗi lô 4-6 m một
// màu/tầng) và "thảm mái" vệ tinh (đo: ô phố ~66% mái, Overture gốc 42%). Các bước (thống kê in cuối + RB_META.stats):
//   1. đọc CSV + dịch theo nguồn (MS −1,−1; GG −1,−2,5) + lọc nước (tâm hoặc > 50% diện tích)/bãi giải toả Hoàng Diệu
//   2. khử trùng lặp MỌI nguồn (> 50% bỏ nhỏ; 10-50% cắt nhỏ theo cạnh nhà lớn) + bỏ "vỏ" OSM chứa nhà khác (> 60%)
//   3. CẮT phần lấn hành lang phố (ROADS_DT + js/xsection.js facadeLine; ngõ h/phố đi bộ w chỉ cắt nếu mất ≤ 35%)
//   4. KÉO MẶT TIỀN lùi ≤ 7 m ra đúng facadeLine của phố game vẽ — vùng quét không đè nhà khác/hành lang/vùng cấm
//   5. CHIA LÔ khối mặt phố > 9 m thành lô 3,8-6 m vuông góc phố; "khối dính" ML (> 400 m², dãy nhà bị máy gộp) cắt
//      dải trước sâu 14-20 m thành lô + phần sau chia lưới 4,5-7,5 × 10-16 m
//   6. KÉO SÂU + VUÔNG HOÁ lô mặt phố (ML nông 8-11 m → 13-20 m nếu phía sau trống; lô 4 đỉnh → chữ nhật)
//   7. LẤP KHE mặt phố ≥ 3,5 m bằng lô SINH. Bằng chứng: NHÀ DÂN thật phía sau (không tính công trình công cộng/khối lớn/
//      cao ốc/nhà trong địa danh) hoặc tia quan sát pano NHÀ ỐNG (không tia tả công trình/cao ốc, không tia chạm địa danh)
//      tựa vào nhà thật ≤ 8 m. Veto: ven nước/công viên, SÂN TRƯỚC (dải 25 m chạm địa danh + 12 m / công trình lớn), cảng
//      phía bắc Hoàng Diệu, pano "mặt thoáng"
//   8. LÕI Ô PHỐ trên lưới chiếm chỗ 0,5 m: NỚI nhà thật nông (không tốn byte) rồi MỌC nhà sinh 4,5-8 × 10-18 m tới COV_TARGET
//      — chỉ nơi có BẰNG CHỨNG CỤC BỘ (nhà thật trong ±10 m, tỉ lệ nhà thật ±16 m ≥ 30%, không thuộc "đất trống mở")
//   9. chữ nhật hoá (mã RBR1 19 byte/nhà), nở lấp khe mái, khép khe 3-80 cm giữa nhà kề, cắt chồng lấn còn sót,
//      CHỐT cuối: hành lang phố p/s/t/r (cả mũ khúc cua/chỗ nối way), camera pano (sinh 3 m / thật 1 m), địa danh (sinh
//      3 m); kiểm hợp lệ trên TOẠ ĐỘ ĐÃ LÀM TRÒN như file (đơn chặt, tường-ra-ngoài, ≥ 6 m², bề hẹp ≥ 1,2 m)
//  10. mặt tiền cuối + ghép quan sát pano (tầng/màu/kiểu: tia la bàn từ pano, nhà đầu tiên trong 26 m)
//  11. thuộc tính: kiểu (phố cũ thời Pháp, cảng, OSM class, chữ pano), tầng (OSM > pano > phân bố pano địa phương,
//      làm trơn ±2), mái + màu mái (hiệu chỉnh theo vệ tinh), màu tường (chữ màu pano → WALL_PALETTE), INFO (cấp phố,
//      góc phố, công năng tầng trệt)
//  12. loại cạnh: PARTY (+ edgeCover = tầng thấp nhất nhà che), FRONT, BACK, SIDE
// Toàn bộ ngẫu nhiên theo seed (hash id / toạ độ). Ngân sách: ≤ 1,8 MB base64, giải mã < 60 ms.
import fs from 'fs';
import { ROADS_DT, PARKS, RAIL, LM } from '../js/mapdata.js';
import { waterSD } from '../js/terrain.js';
import { ROAD_HW, facadeLine } from '../js/xsection.js';
import { LM_POLY } from '../js/landmark_polys.js';
import { PANO_CAM } from '../js/panoclear.js';
import { PANO_SIDES } from '../js/panosides.js';
import { encodeRB, decodeRB, rectOf, EDGE, STYLE, ROOF, FLAG, INFO, ROADC } from '../js/buildings_data.js';
import {
  signedArea, absArea, outward, centroid, bbox, pointInPoly, segDist, cleanPoly, isSimple, clipHalf, clipStrip,
  minRect, Grid, overlapArea, hash32, rng, pickW, polyEdgeDist,
} from './bgeom.mjs';

const T0 = Date.now();
const ARGV = process.argv.slice(2);
const DUMP = ARGV.includes('--dump') ? ARGV[ARGV.indexOf('--dump') + 1] : null;
const R_MAX = 1750;          // footprint thật: > PLAY_RADIUS 1588 + tầm nhìn mép
const R_SYN = 1640;          // nhà SINH (lấp khe/lõi) chỉ trong vùng chơi (+ chút mép) — giữ ngân sách byte
const LON0 = 106.68182, LAT0 = 20.85750;
const UX = 111320 * Math.cos((LAT0 * Math.PI) / 180), UZ = 110574;
const SHIFT = { 'Microsoft ML Buildings': [-1, -1], 'Google Open Buildings': [-1, -2.5], OpenStreetMap: [0, 0] };
const SRC = { 'Microsoft ML Buildings': 'MS', 'Google Open Buildings': 'GG', OpenStreetMap: 'OSM' };
const ST = {};   // thống kê
const stat = (k, v = 1) => { ST[k] = (ST[k] || 0) + v; };
const lap = (name) => { console.log(`  [${((Date.now() - T0) / 1000).toFixed(1)}s] ${name}`); };

// ======================================================================================================
// 0. ĐẦU VÀO PHỤ: phố (lưới đoạn), vùng cấm (nước/công viên/địa danh/bãi giải toả), pano
// ======================================================================================================
const SEGS = [];
ROADS_DT.forEach((r, ri) => {
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    SEGS.push({ ri, k: i, ax, az, bx, bz, L, ux, uz, nx: -uz, nz: ux, c: r.c, hw: ROAD_HW[r.c] ?? 2.75, fl: facadeLine(r.c) });
  }
});
const segGrid = new Grid(32);
SEGS.forEach((s, i) => { const p = s.fl + 2; segGrid.insert(i, [Math.min(s.ax, s.bx) - p, Math.min(s.az, s.bz) - p, Math.max(s.ax, s.bx) + p, Math.max(s.az, s.bz) + p]); });
// toạ độ cục bộ của điểm theo đoạn: t (0..1 dọc đoạn), v (lệch ngang có dấu, dương = phía pháp tuyến trái n)
const segLocal = (s, x, z) => [((x - s.ax) * s.ux + (z - s.az) * s.uz) / s.L, (x - s.ax) * s.nx + (z - s.az) * s.nz];
// điểm có nằm trong hành lang (lòng + vỉa hè, tới facadeLine − tol) của đoạn nào không; skipRi: bỏ qua phố này
function inCorridor(x, z, tol = 0, skip = null, classes = null) {
  let hit = null;
  segGrid.query([x, z, x, z], (i) => {
    if (hit) return; const s = SEGS[i];
    if (skip && skip(s)) return; if (classes && !classes.includes(s.c)) return;
    if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.fl - tol) hit = s;
  });
  return hit;
}

// Vùng cấm dựng nhà SINH + vùng loại nhà thật
const PARK_POLYS = PARKS.map((p) => ({ p, bb: bbox(p) }));
const LM_POLYS = Object.entries(LM_POLY).map(([k, p]) => ({ k, p, bb: bbox(p) }));
const inPolyList = (L, x, z, pad = 0) => L.some((o) => x >= o.bb[0] - pad && x <= o.bb[2] + pad && z >= o.bb[1] - pad && z <= o.bb[3] + pad &&
  (pointInPoly(o.p, x, z) || (pad > 0 && polyNear(o.p, x, z, pad))));
function polyNear(P, x, z, d) { for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (segDist(x, z, a[0], a[1], b[0], b[1]) < d) return true; } return false; }
// giao 2 đoạn (kể cả chạm) — cho polyDist
function segCross(a, b, c, d) {
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
// khoảng cách 2 đa giác (0 nếu chồng/cắt nhau)
function polyDist(P, Q) {
  for (const [x, z] of P) if (pointInPoly(Q, x, z)) return 0;
  for (const [x, z] of Q) if (pointInPoly(P, x, z)) return 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) if (segCross(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length])) return 0;
  let d = Infinity;
  for (const [x, z] of P) d = Math.min(d, polyEdgeDist(Q, x, z));
  for (const [x, z] of Q) d = Math.min(d, polyEdgeDist(P, x, z));
  return d;
}
// Đa giác đơn THEO NGHĨA CHẶT (renderer/tam giác hoá cần): isSimple (cạnh không kề không cắt nhau) + không "gai" (2 cạnh
// kề quay ngược nhau, góc < ~18°: isSimple không thấy vì chỉ xét cạnh không kề) + không đỉnh nào chạm (≤ 3 cm) cạnh
// không kề (vòng gập 8-10 cm sau làm tròn 0,1 m — review: 7 đa giác hỏng sau encode)
function strictSimple(P) {
  const n = P.length; if (n < 3 || !isSimple(P)) return false;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) return false;
    if ((ux * vx + uz * vz) / (lu * lv) < -0.95) return false;
    for (let j = 0; j < n; j++) {
      if (j === i || (j + 1) % n === i) continue;
      const p = P[j], q = P[(j + 1) % n];
      if (segDist(b[0], b[1], p[0], p[1], q[0], q[1]) < 0.03) return false;
    }
  }
  return true;
}
// bỏ đỉnh "gai" (2 cạnh kề quay ngược nhau > 162°) lặp tới khi hết; trả đa giác mới
function despike(P) {
  let Q = P.slice(), changed = true;
  while (changed && Q.length > 3) {
    changed = false;
    for (let i = 0; i < Q.length && Q.length > 3; i++) {
      const a = Q[(i + Q.length - 1) % Q.length], b = Q[i], c = Q[(i + 1) % Q.length];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 1e-6 || lv < 1e-6 || (ux * vx + uz * vz) / (lu * lv) < -0.95) { Q.splice(i, 1); i--; changed = true; }
    }
  }
  return Q;
}
// Bãi giải toả Hoàng Diệu (thực địa 10/2024: nhà cũ đã phá — world.js clearedZone): bỏ cả nhà thật lẫn nhà sinh
const HD_A = [315, -809.5], HD_U = [0.9795, -0.2012], HD_N = [-0.2012, -0.9795];
function clearedZone(x, z) {
  const dx = x - HD_A[0], dz = z - HD_A[1], along = dx * HD_U[0] + dz * HD_U[1], across = dx * HD_N[0] + dz * HD_N[1];
  if (along < -10 || along > 360 || across < 7 || across > 140) return false;
  if ((x - 326) ** 2 + (z + 826) ** 2 < 45 * 45) return false;
  if ((x - 636.5) ** 2 + (z + 894.7) ** 2 < 400) return false;
  return true;
}
// Siêu khối Hải quân/Cảng + nút giao cầu HVT: CHỈ cấm nhà SINH (nhà thật để WP2 claim quyết định)
const CB1 = [[487, -468], [648, -468], [653, -800], [560, -800], [560, -682], [486, -672]];
const noSynZone = (x, z) => clearedZone(x, z) || pointInPoly(CB1, x, z) || (x > -300 && x < 120 && z > -1045 && z < -845);
// camera pano: lưới 8 m
const camGrid = new Grid(8); PANO_CAM.forEach(([x, z], i) => camGrid.insert(i, [x, z, x, z]));
function nearCam(x, z, r) { let h = false; camGrid.query([x - r, z - r, x + r, z + r], (i) => { if (!h && Math.hypot(PANO_CAM[i][0] - x, PANO_CAM[i][1] - z) < r) h = true; }); return h; }
// Đường sắt: world.js dựng nền đá ballast rộng 42 m (sân ga: đoạn có tâm ≤ 230 m quanh LM.station, ~10 ray song song)
// hoặc 3 m (tuyến) dọc RAIL → nhà sinh/nở không được đè lên (vệ tinh real_3: bãi ray trống). Chia đoạn 30 m như world.js.
const RAILS = [];
for (const r of RAIL) for (let i = 0; i + 1 < r.pts.length; i++) {
  const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1); if (L < 1) continue;
  const nCh = Math.max(1, Math.ceil(L / 30));
  for (let c = 0; c < nCh; c++) {
    const ax = x1 + ((x2 - x1) * c) / nCh, az = z1 + ((z2 - z1) * c) / nCh, bx = x1 + ((x2 - x1) * (c + 1)) / nCh, bz = z1 + ((z2 - z1) * (c + 1)) / nCh;
    const yard = Math.hypot((ax + bx) / 2 - LM.station[0], (az + bz) / 2 - LM.station[1]) < 230;
    if (Math.hypot(ax, az) > R_MAX + 100 && Math.hypot(bx, bz) > R_MAX + 100) continue;
    RAILS.push([ax, az, bx, bz, yard ? 21.5 : 2.5]);
  }
}
const railGrid = new Grid(32); RAILS.forEach((r, i) => railGrid.insert(i, [Math.min(r[0], r[2]) - r[4], Math.min(r[1], r[3]) - r[4], Math.max(r[0], r[2]) + r[4], Math.max(r[1], r[3]) + r[4]]));
function nearRail(x, z) { let h = false; railGrid.query([x, z, x, z], (i) => { const r = RAILS[i]; if (!h && segDist(x, z, r[0], r[1], r[2], r[3]) < r[4]) h = true; }); return h; }
// Không được dựng nhà SINH tại điểm này
const synBlocked = (x, z) => waterSD(x, z) < 1.5 || inPolyList(PARK_POLYS, x, z) || inPolyList(LM_POLYS, x, z, 3) || noSynZone(x, z) || nearRail(x, z) ||
  nearCam(x, z, 3) || Math.hypot(x, z) > R_SYN;


// ======================================================================================================
// 1. ĐỌC CSV Overture
// ======================================================================================================
function parseCSVLine(L) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < L.length; i++) {
    const ch = L[i];
    if (q) { if (ch === '"') { if (L[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
const csvTxt = fs.readFileSync(new URL('./ov_buildings.csv', import.meta.url), 'utf8').split(/\r?\n/);
const HDR = parseCSVLine(csvTxt[0]);
const col = (n) => HDR.indexOf(n);
const C_ID = col('id'), C_NAME = col('name'), C_H = col('height'), C_NF = col('num_floors'), C_CLS = col('class'), C_SUB = col('subtype'), C_SRC = col('src'), C_WKT = col('wkt');
let B = [];   // mọi nhà: {id, src, cls, sub, name, nfl, hgt, pts, flags, ...}
for (let li = 1; li < csvTxt.length; li++) {
  if (!csvTxt[li]) continue;
  const F = parseCSVLine(csvTxt[li]);
  const wkt = F[C_WKT] || '';
  const rings = [];
  for (const m of wkt.matchAll(/\(\(([^()]*)\)/g)) {
    const r = m[1].split(',').map((s) => s.trim().split(/\s+/).map(Number)).map(([lo, la]) => [(lo - LON0) * UX, -(la - LAT0) * UZ]);
    r.pop(); if (r.length >= 3) rings.push(r);
  }
  if (!rings.length) continue;
  rings.sort((a, b) => absArea(b) - absArea(a));
  const srcName = F[C_SRC], sh = SHIFT[srcName] || [0, 0];
  const pts = rings[0].map(([x, z]) => [x + sh[0], z + sh[1]]);
  const [cx, cz] = centroid(pts);
  if (Math.hypot(cx, cz) > R_MAX) { stat('far'); continue; }
  B.push({ id: F[C_ID], src: SRC[srcName] || 'MS', cls: F[C_CLS] || '', sub: F[C_SUB] || '', name: F[C_NAME] || '',
    nfl: +F[C_NF] || 0, hgt: +F[C_H] || 0, pts: outward(cleanPoly(pts)) });
}
ST.read = B.length;
lap(`đọc ${B.length} footprint trong R${R_MAX}`);

// --- loại: quá nhỏ, nước, bãi giải toả, không đơn ---
function waterFrac(P) {
  const bb = bbox(P), A = absArea(P), step = Math.max(0.8, Math.sqrt(A / 40));
  let n = 0, w = 0;
  for (let x = bb[0] + step / 2; x < bb[2]; x += step) for (let z = bb[1] + step / 2; z < bb[3]; z += step) {
    if (!pointInPoly(P, x, z)) continue; n++; if (waterSD(x, z) < 0) w++;
  }
  return n ? w / n : 0;
}
B = B.filter((b) => {
  if (b.pts.length < 3 || absArea(b.pts) < 8) { stat('drop_small'); return false; }
  if (!isSimple(b.pts)) { stat('drop_nonsimple'); return false; }
  const [cx, cz] = centroid(b.pts);
  if (waterSD(cx, cz) < 0 || waterFrac(b.pts) > 0.5) { stat('drop_water'); return false; }
  if (clearedZone(cx, cz)) { stat('drop_cleared'); return false; }
  return true;
});
lap(`sau lọc nước/nhỏ: ${B.length}`);

// ======================================================================================================
// 2. KHỬ TRÙNG LẶP cùng nguồn + bỏ "vỏ" OSM chứa nhà khác
// ======================================================================================================
function rebuildGrid() { const g = new Grid(16); B.forEach((b, i) => { if (!b.dead) g.insert(i, (b.bb = bbox(b.pts))); }); return g; }
let grid = rebuildGrid();
for (const b of B) b.area = absArea(b.pts);
const RAW0 = B.map((b) => b.pts);   // footprint Overture gốc (đã dịch/lọc nước) — để đo "trước" (độ phủ, mặt phố)
console.log('  mặt phố có nhà (Overture gốc) %:', JSON.stringify(frontageStats('overture_raw')));
// vỏ OSM: > 60% diện tích bị nhà KHÁC (nhỏ hơn) phủ
for (let i = 0; i < B.length; i++) {
  const b = B[i]; if (b.src !== 'OSM' || b.area < 150) continue;
  let cov = 0;
  grid.query(b.bb, (j) => { if (j === i || B[j].area >= b.area) return; cov += overlapArea(b.pts, B[j].pts, 0.6); });
  if (cov > 0.6 * b.area) { b.dead = 'container'; stat('drop_container'); }
}
// cùng nguồn: >50% (theo nhà nhỏ) → bỏ nhỏ; 10-50% → cắt nhà nhỏ theo cạnh nhà lớn (nửa mặt phẳng), không được thì bỏ
for (let i = 0; i < B.length; i++) {
  const b = B[i]; if (b.dead) continue;
  grid.query(b.bb, (j) => {
    if (j <= i || b.dead) return; const o = B[j]; if (o.dead) return;   // mọi nguồn (Overture còn sót ~50 cặp ML↔OSM chồng)
    const [big, small] = b.area >= o.area ? [b, o] : [o, b];
    const ov = overlapArea(big.pts, small.pts, 0.3); if (ov < 0.5) return;
    const fr = ov / small.area;
    if (fr > 0.5) { small.dead = 'dup'; stat('drop_dup'); return; }
    // (chồng mép nhỏ < 10% cũng cắt luôn cho sạch) thử từng cạnh của nhà lớn: giữ phần nhà nhỏ PHÍA NGOÀI cạnh đó, chọn kết quả giữ nhiều diện tích nhất mà hết chồng
    let best = null;
    const P = big.pts;
    for (let k = 0; k < P.length; k++) {
      const a = P[k], c = P[(k + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1) continue;
      const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;   // pháp tuyến ngoài của nhà lớn
      const parts = clipHalf(small.pts, nx, nz, nx * a[0] + nz * a[1]);
      for (const q of parts) {
        const Q = outward(cleanPoly(q)); if (Q.length < 3) continue;
        const A = absArea(Q); if (A < 8 || (best && A <= best.A)) continue;
        if (overlapArea(big.pts, Q, 0.3) > 0.06 * A) continue;
        best = { Q, A };
      }
    }
    if (best && best.A > 0.35 * small.area) { small.pts = best.Q; small.area = best.A; small.cut = 1; stat('dedup_cut'); }
    else { small.dead = 'dup'; stat('drop_dup2'); }
  });
}
B = B.filter((b) => !b.dead);
grid = rebuildGrid();
lap(`sau khử trùng lặp: ${B.length}`);

// ======================================================================================================
// 3. CẮT phần lấn hành lang phố (tới facadeLine). Ngõ h / phố đi bộ w: chỉ cắt nếu mất ≤ 35% (hình học ROADS_DT
//    của ngõ lệch tới 5 m sau simplify — không xén nhà thật vì một ngõ vẽ sai)
// ======================================================================================================
function corridorClip(b, opts = {}) {
  const minKeep = opts.minKeep ?? 0.35;
  let P = b.pts; const A0 = absArea(P); const bb = bbox(P);
  const cand = [];
  segGrid.query([bb[0] - 11, bb[1] - 11, bb[2] + 11, bb[3] + 11], (i) => cand.push(i));
  cand.sort((i, j) => i - j);
  let changed = false;
  for (const i of cand) {
    const s = SEGS[i];
    if (opts.skipRi !== undefined && s.ri === opts.skipRi) continue;
    // đỉnh nào lấn (trong dải t∈[0,1] của đoạn, |v| < fl)?
    let intr = false, sv = 0;
    for (const [x, z] of P) { const [t, v] = segLocal(s, x, z); if (t >= 0 && t <= 1 && Math.abs(v) < s.fl - 0.05) intr = true; }
    // đoạn đâm xuyên nhà mà không đỉnh nào lấn: kiểm tâm đoạn ∩ đa giác
    if (!intr) {
      for (const t of [0.25, 0.5, 0.75]) { const x = s.ax + (s.bx - s.ax) * t, z = s.az + (s.bz - s.az) * t; if (pointInPoly(P, x, z)) intr = true; }
      if (!intr) continue;
    }
    const [cx, cz] = centroid(P); sv = segLocal(s, cx, cz)[1];
    const sg = sv >= 0 ? 1 : -1;
    const c0 = sg * (s.ax * s.nx + s.az * s.nz) + s.fl;
    const parts = clipHalf(P, sg * s.nx, sg * s.nz, c0).map((q) => outward(cleanPoly(q))).filter((q) => q.length >= 3);
    parts.sort((p, q) => absArea(q) - absArea(p));
    const keep = parts.length ? absArea(parts[0]) : 0;
    if (s.c === 'h' || s.c === 'w') { if (keep < 0.65 * absArea(P)) { stat('clip_skip_' + s.c); continue; } }
    if (!parts.length || keep < 1) return null;
    P = parts[0]; changed = true;
  }
  if (!changed) return b.pts;
  const A = absArea(P);
  if (A < 12 || A < minKeep * A0) return null;
  return P;
}
for (const b of B) {
  const P = corridorClip(b);
  if (P === null) { b.dead = 'road'; stat('drop_road'); continue; }
  if (P !== b.pts) { b.pts = P; b.area = absArea(P); b.clipped = 1; stat('clip_road'); }
}
B = B.filter((b) => !b.dead);
grid = rebuildGrid();
lap(`sau cắt hành lang phố: ${B.length}`);

// ======================================================================================================
// Phân loại công trình (trước khi kéo/chia): dân dụng nhà ống vs công trình lớn/công cộng
// ======================================================================================================
const CIVIC_CLS = new Set(['school', 'university', 'hospital', 'kindergarten', 'public', 'office', 'library', 'train_station', 'temple',
  'stadium', 'college', 'government', 'civic', 'church', 'religious', 'hotel', 'commercial', 'retail', 'industrial', 'warehouse', 'apartments']);
const CIVIC_SUB = new Set(['civic', 'education', 'medical', 'religious', 'entertainment', 'transportation', 'industrial', 'commercial']);
// Cảng/kho (phía bắc Hoàng Diệu tới sông Cấm; ven Bạch Đằng phía sông): khối lớn ở đây là KHO THẬT, không phải dãy nhà dính
const portZone = (x, z) => (z < -840 && x > 100 && x < 1300) || (z < -480 && x < -380 && waterSD(x, z) < 140);
const portGapZone = (x, z) => z < -840 && x > 100 && x < 1300 && (x - HD_A[0]) * HD_N[0] + (z - HD_A[1]) * HD_N[1] > 0;
function classify(b) {
  const mr = minRect(b.pts); b.mr = mr;
  b.civic = CIVIC_CLS.has(b.cls) || CIVIC_SUB.has(b.sub) || /trường|bệnh viện|uỷ ban|ubnd|chùa|đền|đình|nhà thờ|công ty|cung văn hoá|cung văn hóa|chợ|ga /i.test(b.name);
  // "khối dính": footprint ML/GG không phân loại > 400 m² ngoài vùng cảng = cả dãy nhà ống bị máy gộp làm một (ảnh vệ
  // tinh cho thấy từng mái riêng) → được kéo mặt tiền + chia lô + chia lưới phần sau như nhà thường
  const [cx, cz] = centroid(b.pts);
  b.mass = b.src !== 'OSM' && b.src !== 'SYN' && !b.cls && !b.name && b.area > 400 && b.area < 12000 && !portZone(cx, cz);
  // ...trừ khối GỌN (gần chữ nhật, cạnh dài/ngắn < 1,7: dáng cao ốc/khách sạn/chợ) hoặc pano thấy nhà ≥ 6 tầng ở đó
  if (b.mass && mr && b.area > 0.88 * mr.w * mr.d && mr.w / Math.max(1, mr.d) < 1.7 && b.pts.length <= 6) b.mass = false;
  if (b.tallObs) b.mass = false;
  b.big = !b.mass && (b.area > 1000 || (mr && mr.d > 30));
}
// Quan sát pano nhà CAO (≥ 6 tầng, tia tới 80 m) chạm footprint lớn (> 300 m²) → giữ nguyên khối (không chia lô) + số tầng đó
{
  const g0 = new Grid(16); B.forEach((b, i) => g0.insert(i, (b.bb = bbox(b.pts))));
  const A0 = JSON.parse(fs.readFileSync(new URL('../audit/audit_enriched.json', import.meta.url), 'utf8'));
  let n = 0;
  for (const p of A0) if (typeof p.X === 'number') for (const o of p.buildings || []) {
    const fl = +o.floors || 0; if (fl < 6 || fl > 45) continue;
    const h = ((+o.heading || 0) * Math.PI) / 180, dx = Math.sin(h), dz = -Math.cos(h);
    let hit = -1;
    for (let d = 3; d <= 80 && hit < 0; d += 0.7) {
      const x = p.X + dx * d, z = p.Z + dz * d;
      g0.query([x, z, x, z], (j) => { if (hit < 0 && pointInPoly(B[j].pts, x, z)) hit = j; });
      if (hit >= 0 && absArea(B[hit].pts) < 300) hit = -2;   // chạm nhà nhỏ trước → che mất cao ốc, thôi
    }
    if (hit >= 0) { B[hit].tallObs = Math.max(B[hit].tallObs || 0, fl); n++; }
  }
  ST.tall_obs_matched = n;
}
for (const b of B) classify(b);

// ======================================================================================================
// 4. MẶT PHỐ: tìm cạnh nhìn ra phố + KÉO mặt tiền ra facadeLine
// ======================================================================================================
// cạnh (a→b) có pháp tuyến ngoài n nhìn ra đoạn s? trả {s, sg, d (khoảng cách mặt tiền hiện tại tới facadeLine, >0 = lùi)}
function frontOf(P, k, self, maxBack = 7.2, dbg = null) {
  const a = P[k], c = P[(k + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1.2) return null;
  const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L, nx = -ez, nz = ex;
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let best = null;
  segGrid.query([mx - 22, mz - 22, mx + 22, mz + 22], (i) => {
    const s = SEGS[i];
    if (s.c === 'h') return;   // ngõ: không coi là mặt phố để kéo (vỉa = 0, hình học lệch)
    const [t, v] = segLocal(s, mx, mz);
    const sg = v >= 0 ? 1 : -1;
    const d = sg * v - s.fl;
    if (dbg && d < 12 && t > -0.2 && t < 1.2) dbg('  edge', k, 'L', L.toFixed(1), 'seg', s.ri, s.c, 'cos', Math.abs(ex * s.ux + ez * s.uz).toFixed(3), 't', t.toFixed(2), 'nrm', (nx * sg * s.nx + nz * sg * s.nz).toFixed(2), 'd', d.toFixed(2));
    if (Math.abs(ex * s.ux + ez * s.uz) < 0.906) return;   // song song ±25°
    if (t < -0.02 || t > 1.02) return;
    if (nx * sg * s.nx + nz * sg * s.nz > -0.9) return;   // pháp tuyến cạnh phải quay VỀ phía phố
    if (d < -0.6 || d > maxBack) return;
    if (!best || d < best.d) best = { s, sg, d };
  });
  if (!best) return null;
  // không bị nhà khác che giữa cạnh và phố (≥ 2/3 tia tự do)
  let free = 0;
  for (const t of [0.2, 0.5, 0.8]) {
    const px = a[0] + (c[0] - a[0]) * t, pz = a[1] + (c[1] - a[1]) * t;
    let blocked = false;
    for (let d = 0.6; d < best.d + 0.6 && !blocked; d += 0.8) {
      const qx = px + nx * d, qz = pz + nz * d;
      grid.query([qx, qz, qx, qz], (j) => { if (!blocked && j !== self && !B[j].dead && pointInPoly(B[j].pts, qx, qz)) blocked = true; });
    }
    if (!blocked) free++;
  }
  if (free < 2) { if (dbg) dbg('  edge', k, 'ray-blocked'); return null; }
  return best;
}
// vùng quét (đa giác) có chồng nhà khác / vào vùng cấm không? (lấy mẫu lưới 0,4 m, lõm vào 0,12 m)
function sweepFree(Q, self, opts = {}) {
  const bb = bbox(Q);
  const nb = [];
  grid.query([bb[0] - 0.5, bb[1] - 0.5, bb[2] + 0.5, bb[3] + 0.5], (j) => { if (j !== self && !B[j].dead && !(opts.ignore && opts.ignore.has(j))) nb.push(j); });
  const step = 0.4;
  for (let x = bb[0] + 0.12; x < bb[2]; x += step) for (let z = bb[1] + 0.12; z < bb[3]; z += step) {
    if (!pointInPoly(Q, x, z)) continue;
    // lõm 0,12 m khỏi biên Q
    let edge = false;
    for (let i = 0; i < Q.length && !edge; i++) { const a = Q[i], c = Q[(i + 1) % Q.length]; if (segDist(x, z, a[0], a[1], c[0], c[1]) < 0.12) edge = true; }
    if (edge) continue;
    for (const j of nb) if (pointInPoly(B[j].pts, x, z)) return false;
    if (opts.corr && inCorridor(x, z, 0.05)) return false;
    // vùng cấm: địa danh + 3 m (CẢ đa giác, không chỉ tâm), camera pano 3 m (hợp đồng SPEC §WP1.4)
    if (opts.zones && (waterSD(x, z) < 0.5 || inPolyList(PARK_POLYS, x, z) || inPolyList(LM_POLYS, x, z, 3) || nearCam(x, z, 3) || nearRail(x, z))) return false;
  }
  return true;
}
// kéo đỉnh i của P theo vector (dx,dz)·f, trả đa giác mới
function movePts(P, idx, vec, f) {
  return P.map((p, i) => (idx.has(i) ? [p[0] + vec.get(i)[0] * f, p[1] + vec.get(i)[1] * f] : p));
}

let nSnap = 0, nSnapPart = 0, snapDist = 0;
const DBG = process.env.DEBUG_PT ? process.env.DEBUG_PT.split(',').map(Number) : null;
const dbgNear = (b) => DBG && b.bb && b.bb[0] < DBG[0] + 12 && b.bb[2] > DBG[0] - 12 && b.bb[1] < DBG[1] + 12 && b.bb[3] > DBG[1] - 12;
function snapFront(bi) {
  const b = B[bi];
  const dbg = dbgNear(b) ? (...a) => console.log('   [dbg snap]', b.id.slice(0, 12), b.src, Math.round(b.area), ...a) : null;
  if (b.civic || b.big) { if (dbg) dbg('civic/big', b.civic, b.big); return; }
  const P = b.pts; const n = P.length;
  const fronts = [];
  for (let k = 0; k < n; k++) { const f = frontOf(P, k, bi, 7.2, dbg); if (f) fronts.push({ k, ...f }); }
  if (!fronts.length) { if (dbg) dbg('no front'); return; }
  b.hadFront = 1;
  // vector dời mỗi đỉnh: tới facadeLine của đoạn (đỉnh thuộc 2 cạnh mặt phố khác phố → giao 2 đường)
  const vec = new Map(), vsrc = new Map();
  for (const f of fronts) {
    if (f.d <= 0.08) continue;
    for (const vi of [f.k, (f.k + 1) % n]) {
      const [x, z] = P[vi]; const [, v] = segLocal(f.s, x, z); const dd = f.sg * v - f.s.fl;
      if (dd <= 0) continue;
      const mv = [-f.sg * f.s.nx * dd, -f.sg * f.s.nz * dd];
      if (vec.has(vi)) {
        // góc phố (2 mặt tiền nhìn ra 2 đoạn KHÁC NHAU lệch > 45°): cộng 2 dịch ≈ giao 2 đường. Cùng đoạn / 2 đoạn gần
        // song song (2 cạnh mặt tiền liền nhau của 1 nhà nhìn ra 1 phố): GIỮ dịch lớn hơn — cộng sẽ dời đỉnh 2 lần, quá
        // facadeLine vào lòng phố (review: mảnh khối ML ở (−687,826) lấn 4,5 m vào phố s)
        const o = vec.get(vi), os = vsrc.get(vi);
        if (os !== f.s && Math.abs(os.ux * f.s.ux + os.uz * f.s.uz) < 0.7) vec.set(vi, [o[0] + mv[0], o[1] + mv[1]]);
        else if (Math.hypot(mv[0], mv[1]) > Math.hypot(o[0], o[1])) { vec.set(vi, mv); vsrc.set(vi, f.s); }
      } else { vec.set(vi, mv); vsrc.set(vi, f.s); }
    }
  }
  if (!vec.size) return;
  const idx = new Set(vec.keys());
  // thử f = 1, nếu vướng thì chia đôi dần
  let lo = 0, hi = 1, ok = null;
  const test = (fr) => {
    const Q = movePts(P, idx, vec, fr);
    if (!isSimple(Q) || signedArea(Q) >= 0) return null;
    // vùng quét = Q trừ P ≈ kiểm từng tứ giác (cạnh cũ → cạnh mới) của các cạnh mặt phố
    for (const f of fronts) {
      const i0 = f.k, i1 = (f.k + 1) % n;
      if (!idx.has(i0) && !idx.has(i1)) continue;
      const quad = [P[i0], P[i1], Q[i1], Q[i0]];
      if (absArea(quad) < 0.05) continue;
      // hành lang của CHÍNH phố được kéo tới cũng kiểm (mẫu lõm 0,12 m nên mặt tiền đúng facadeLine vẫn qua; vượt quá thì
      // bị chặn — trước đây bỏ qua phố này nên đỉnh dời quá đà lọt vào lòng phố)
      if (!sweepFree(outward(quad), bi, { corr: true, zones: true })) return null;
    }
    return Q;
  };
  ok = test(1);
  if (!ok) {
    for (let it = 0; it < 5; it++) { const m = (lo + hi) / 2; const Q = test(m); if (Q) { lo = m; ok = Q; } else hi = m; }
    if (ok && lo < 0.25) ok = null;
    if (ok) nSnapPart++;
  }
  if (!ok) { if (dbg) dbg('sweep blocked', JSON.stringify(fronts.map((f) => [f.k, f.s.c, +f.d.toFixed(2)]))); return; }
  if (dbg) dbg('SNAP ok', JSON.stringify(fronts.map((f) => [f.k, f.s.c, +f.d.toFixed(2)])), 'frac', lo || 1);
  let md = 0; for (const v of vec.values()) md = Math.max(md, Math.hypot(v[0], v[1]));
  snapDist += md * (ok === null ? 0 : 1);
  b.pts = outward(cleanPoly(ok)); b.area = absArea(b.pts); b.snapped = 1; nSnap++;
  grid.update(bi, (b.bb = bbox(b.pts)));
}
// thứ tự: gần phố trước (ổn định theo id)
const order = B.map((b, i) => i).sort((i, j) => (B[i].id < B[j].id ? -1 : 1));
for (const i of order) snapFront(i);
ST.snap = nSnap; ST.snap_partial = nSnapPart; ST.snap_mean_m = +(snapDist / Math.max(1, nSnap)).toFixed(2);
lap(`kéo mặt tiền: ${nSnap} nhà (một phần ${nSnapPart})`);

// ======================================================================================================
// 5. CHIA LÔ khối mặt phố dài + cắt khối quá sâu
// ======================================================================================================
// cạnh mặt phố tốt nhất (dài nhất) của nhà (sau kéo, d ≈ 0)
function mainFront(bi, maxBack = 1.0) {
  const P = B[bi].pts; let best = null;
  for (let k = 0; k < P.length; k++) {
    const f = frontOf(P, k, bi, maxBack); if (!f) continue;
    const a = P[k], c = P[(k + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (!best || L > best.L) best = { k, L, ...f };
  }
  return best;
}
// Chia lưới 1 khối: dải dọc u rộng 4,5-7,5 m, mỗi dải cắt sâu (trục v) 10-16 m (vị trí cắt lệch theo từng dải)
function subdivide(P, ux, uz, seedStr) {
  const vx = -uz, vz = ux, R = rng(hash32(seedStr));
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of P) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cuts = (a, b, lo, hi) => { const c = [a]; let t = a; while (b - t > hi + 1) { t += lo + R() * (hi - lo); c.push(t); } c.push(b); return c; };
  const uc = cuts(u0, u1, 4.5, 7.5), out = [];
  for (let i = 0; i + 1 < uc.length; i++) {
    for (const q of clipStrip(P, ux, uz, uc[i], uc[i + 1])) {
      const vc = cuts(v0, v1, 10, 16);
      for (let k = 0; k + 1 < vc.length; k++) for (const r of clipStrip(q, vx, vz, vc[k], vc[k + 1])) {
        const Q = outward(cleanPoly(r)); if (Q.length >= 3 && absArea(Q) >= 8) out.push(Q);
      }
    }
  }
  return out;
}
const LOT_MIN = 3.8, LOT_MAX = 6.0;
const newB = [];
let nLotSrc = 0, nLots = 0, nRear = 0;
for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi]; if (b.dead || b.civic || b.big || b.tallObs) continue;
  if (!b.mass && b.area > 400 && b.src !== 'OSM') continue;   // khối gọn lớn (không phải dãy dính): giữ nguyên
  if (b.src === 'OSM' && b.cls && b.cls !== 'house' && b.cls !== 'terrace' && b.cls !== 'residential') continue;
  const f = mainFront(bi); if (!f) continue;
  const P = b.pts;
  const s = f.s; const sg = f.sg;
  // trục: u dọc phố, n = từ phố VÀO trong ô phố; độ sâu điểm p = n·p − fl0 (0 tại facadeLine)
  const ux = s.ux, uz = s.uz, nx = sg * s.nx, nz = sg * s.nz;
  let u0 = Infinity, u1 = -Infinity, dmax = 0;
  const fl0 = sg * (s.ax * s.nx + s.az * s.nz) + s.fl;   // n·p tại facadeLine
  for (const [x, z] of P) { const u = x * ux + z * uz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); dmax = Math.max(dmax, x * nx + z * nz - fl0); }
  const W = u1 - u0;
  const R = rng(hash32(b.id + 'lot'));
  const pieces = [];
  // khối quá sâu (> 22 m): cắt khối trước sâu D, phần sau thành nhà riêng
  let front = [P], rear = [];
  if (dmax > 22 && W < 220) {
    const D = 14 + R() * 6;
    front = clipHalf(P, -nx, -nz, -(fl0 + D)).map((q) => outward(cleanPoly(q))).filter((q) => q.length >= 3 && absArea(q) > 6);
    rear = clipHalf(P, nx, nz, fl0 + D).map((q) => outward(cleanPoly(q))).filter((q) => q.length >= 3 && absArea(q) > 6);
  }
  if (W > 9 && W < 220) {
    // bề rộng lô: 3,8-6 m, đỉnh ~4,5-5 m
    const cuts = [u0]; let u = u0;
    while (u1 - u > LOT_MAX + 0.5) {
      let w = 3.9 + R() * 1.4 + (R() < 0.25 ? R() * 0.8 : 0);
      if (u1 - (u + w) < LOT_MIN) w = (u1 - u) / 2;
      u += w; cuts.push(u);
    }
    cuts.push(u1);
    for (const F of front) for (let k = 0; k + 1 < cuts.length; k++) {
      const a = k === 0 ? -Infinity : cuts[k], c = k === cuts.length - 2 ? Infinity : cuts[k + 1];
      for (const q of clipStrip(F, ux, uz, a === -Infinity ? -1e9 : a, c === Infinity ? 1e9 : c)) {
        const Q = outward(cleanPoly(q)); if (Q.length < 3 || absArea(Q) < 6) continue;
        pieces.push({ pts: Q, lot: 1 });
      }
    }
  } else if (rear.length) for (const F of front) pieces.push({ pts: F, lot: 0 });
  if (!pieces.length) continue;
  for (const R2 of rear) {
    // phần sau của khối dính → lưới nhà (mái riêng từng nhà như ảnh vệ tinh); phần sau nhà thường → 1 khối
    if (b.mass && absArea(R2) > 150) { for (const q of subdivide(R2, ux, uz, b.id + 'rear')) { pieces.push({ pts: q, lot: 0, rear: 1, cell: 1 }); nRear++; } }
    else { pieces.push({ pts: R2, lot: 0, rear: 1 }); nRear++; }
  }
  nLotSrc++; b.dead = 'split';
  for (const p of pieces) {
    newB.push({ id: b.id + '#' + newB.length, src: b.src, cls: b.cls, sub: b.sub, name: '', nfl: b.nfl, hgt: b.hgt, pts: p.pts, area: absArea(p.pts),
      lot: p.lot, rear: p.rear, cell: p.cell, parent: b.id, snapped: b.snapped, clipped: b.clipped, civic: false, big: false });
    if (p.lot) nLots++;
  }
}
// khối dính KHÔNG có mặt phố (nằm trong lõi ô) → chia lưới theo trục dài
let nCells = 0;
for (const b of B) {
  if (b.dead || !b.mass) continue;
  const mr = b.mr; if (!mr) continue;
  const parts = subdivide(b.pts, mr.ux, mr.uz, b.id + 'cell');   // cắt dọc trục dài mỗi 4,5-7,5 m (bề ngang nhà), sâu 10-16 m
  if (parts.length < 2) continue;
  b.dead = 'cells';
  for (const q of parts) {
    newB.push({ id: b.id + '#c' + newB.length, src: b.src, cls: '', sub: '', name: '', nfl: 0, hgt: 0, pts: q, area: absArea(q), cell: 1, parent: b.id,
      snapped: b.snapped, clipped: b.clipped, civic: false, big: false });
    nCells++;
  }
}
ST.mass_cells = nCells;
B = B.filter((b) => !b.dead).concat(newB);
for (const b of B) if (!b.mr) classify(b);
for (const b of B) if (b.cell || b.parent) b.mass = false;
grid = rebuildGrid();
ST.lot_masses = nLotSrc; ST.lots = nLots; ST.rear_parts = nRear;
lap(`chia lô: ${nLotSrc} khối → ${nLots} lô (+${nRear} khối sau); tổng ${B.length}`);

// ======================================================================================================
// 6. KÉO SÂU + VUÔNG HOÁ lô mặt phố: ML/GG chỉ sâu 8-11 m (thật 15-25 m) → kéo mép sau tới 13-20 m nếu phía sau trống;
//    lô 4 đỉnh có 2 hông vuông góc phố → mép sau song song mặt tiền (hình chữ nhật: mã hoá gọn 19 byte, xem RBR1)
// ======================================================================================================
// toạ độ cục bộ theo mặt phố f: u dọc phố, d sâu vào trong ô (0 tại facadeLine)
function frontFrame(f) {
  const s = f.s, sg = f.sg, nx = sg * s.nx, nz = sg * s.nz;
  const fl0 = sg * (s.ax * s.nx + s.az * s.nz) + s.fl;
  return { ux: s.ux, uz: s.uz, nx, nz, fl0,
    loc: (x, z) => [x * s.ux + z * s.uz, x * nx + z * nz - fl0],
    world: (u, d) => [u * s.ux + (fl0 + d) * nx, u * s.uz + (fl0 + d) * nz] };
}
// hình chữ nhật [ua,ub]×[d0,d1] theo khung F, thứ tự tường-ra-ngoài
const frameRect = (F, ua, ub, d0, d1) => outward([F.world(ua, d0), F.world(ub, d0), F.world(ub, d1), F.world(ua, d1)]);
// 4 đỉnh của chữ nhật RBR1 (y hệt decodeRB) + gán chữ nhật/đa giác cho nhà sau một phép CẮT: chữ nhật chỉ khi Q đúng là
// chữ nhật (lệch ≤ 3 cm) và b.pts luôn = hình sẽ được ghi (trước đây rectOf dung sai tới ~0,4 m cho cạnh 20 m nhưng b.pts
// giữ đa giác cắt → file lệch so với hình đã kiểm: chồng lấn/lấn vỉa hè quay lại sau encode)
const rectPts = (r) => { const ca = Math.cos(r.ang), sa = Math.sin(r.ang); return [[r.x0, r.z0], [r.x0 + r.w * ca, r.z0 + r.w * sa], [r.x0 + r.w * ca + r.d * sa, r.z0 + r.w * sa - r.d * ca], [r.x0 + r.d * sa, r.z0 - r.d * ca]]; };
function setRectOrPoly(b, Q) { const r = rectOf(Q, 0.5, 0.03, 0.03); if (r) { b.rect = r; b.pts = rectPts(r); } else { b.rect = null; b.pts = Q; } b.area = absArea(b.pts); }
let nDeep = 0, deepGain = 0, nSquare = 0;
for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi]; if (b.civic || b.big || b.rear) continue;
  if (b.src === 'OSM' && !b.lot) continue;   // footprint OSM vẽ tay từ ảnh: giữ nguyên (trừ khi đã chia lô)
  const f = mainFront(bi); if (!f) continue;
  const F = frontFrame(f), P = b.pts, n = P.length;
  const L = P.map(([x, z]) => F.loc(x, z));
  const dmax = Math.max(...L.map((l) => l[1]));
  const R = rng(hash32(b.id + 'deep'));
  const Dt = 13 + R() * 7;
  // --- lô 4 đỉnh vuông góc phố: dựng lại thành chữ nhật [ua,ub]×[0,T] ---
  if (n === 4) {
    const fr = L.filter((l) => l[1] < 0.6), bk = L.filter((l) => l[1] >= 0.6);
    if (fr.length === 2 && bk.length === 2) {
      const fu = fr.map((l) => l[0]).sort((a, c) => a - c), bu = bk.map((l) => l[0]).sort((a, c) => a - c);
      if (Math.abs(fu[0] - bu[0]) < 0.35 && Math.abs(fu[1] - bu[1]) < 0.35 && fu[1] - fu[0] > 2) {
        const ua = Math.max(fu[0], bu[0]), ub = Math.min(fu[1], bu[1]);
        const dminB = Math.min(bk[0][1], bk[1][1]), dmaxB = Math.max(bk[0][1], bk[1][1]);
        let T = Math.max(dmaxB, b.src === 'OSM' ? 0 : Dt);
        const free = (t) => t <= dminB + 0.05 || sweepFree(frameRect(F, ua, ub, dminB - 0.05, t), bi, { corr: true, zones: true });
        if (!free(T)) {
          let lo = dminB, hi = T;
          for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (free(m)) lo = m; else hi = m; }
          T = lo;
        }
        const A0 = b.area;
        b.pts = frameRect(F, ua, ub, 0, T); b.area = absArea(b.pts); b.squared = 1; nSquare++;
        if (T > dmaxB + 1) { b.deep = 1; nDeep++; deepGain += b.area - A0; }
        grid.update(bi, (b.bb = bbox(b.pts)));
        continue;
      }
    }
  }
  // --- đa giác khác: dời các đỉnh sâu nhất thêm (Dt − dmax) nếu trống ---
  if (b.src === 'OSM' || dmax > Dt - 1.5) continue;
  const idx = new Set(); L.forEach((l, i) => { if (l[1] > dmax - 0.6) idx.add(i); });
  if (idx.size < 2 || idx.size > n - 2) continue;
  const vec = new Map(); for (const i of idx) vec.set(i, [F.nx * (Dt - dmax), F.nz * (Dt - dmax)]);
  let umin = Infinity, umax = -Infinity; for (const i of idx) { umin = Math.min(umin, L[i][0]); umax = Math.max(umax, L[i][0]); }
  const test = (fr) => {
    const Q = movePts(P, idx, vec, fr);
    if (!isSimple(Q) || signedArea(Q) >= 0) return null;
    if (!sweepFree(frameRect(F, umin, umax, dmax - 0.05, dmax + (Dt - dmax) * fr), bi, { corr: true, zones: true })) return null;
    return Q;
  };
  let ok = test(1), lo = 0, hi = 1;
  if (!ok) { for (let it = 0; it < 5; it++) { const m = (lo + hi) / 2; const Q = test(m); if (Q) { lo = m; ok = Q; } else hi = m; } if (lo * (Dt - dmax) < 1.5) ok = null; }
  if (!ok) continue;
  const A0 = b.area;
  b.pts = outward(cleanPoly(ok)); b.area = absArea(b.pts); b.deep = 1; nDeep++; deepGain += b.area - A0;
  grid.update(bi, (b.bb = bbox(b.pts)));
}
ST.deepened = nDeep; ST.deep_gain_m2 = Math.round(deepGain); ST.squared = nSquare;
lap(`kéo sâu: ${nDeep} lô (+${Math.round(deepGain)} m²), vuông hoá ${nSquare}`);

// ======================================================================================================
// 7. LẤP KHE MẶT PHỐ ≥ 3,5 m bằng lô nhà ống SINH (SYNTH|LOT)
//    Bằng chứng: (a) KHÔNG lấp mặt ven nước (nước trong 24 m phía sau → kè/đường dạo ven hồ-sông) hay ven công viên
//    (công viên trong 16 m phía sau → dải vườn hoa, quảng trường); (b) lấp khi ô phố phía sau (±14 m dọc phố, sâu 2-32 m)
//    có ≥ 120 m² nhà THẬT, HOẶC một tia quan sát pano (audit_enriched: hướng la bàn của nhà được tả) cắt lô ở 3-22 m.
//    KHÔNG dùng js/panosides.js làm bằng chứng âm: audit chỉ tả 2-4 nhà/pano nên bit tắt ≠ "không có nhà".
// ======================================================================================================
let nGapLots = 0;
const GAPDBG = [];   // gỡ lỗi (--dump): [x, z, lý do]
const INVDBG = [];   // gỡ lỗi (--dump): footprint bị bỏ ở 9d [id, nguồn, sinh?, đa giác đã làm tròn]
const INTDBG = [];   // gỡ lỗi (--dump): hạt nhà sinh lõi ô [x, z, ô nhà thật ±INT_NEAR_R, tỉ lệ thật ±INT_R]
function buildingAt(x, z) { let h = -1; grid.query([x, z, x, z], (j) => { if (h < 0 && !B[j].dead && pointInPoly(B[j].pts, x, z)) h = j; }); return h; }
function occupiedAt(x, z) { return buildingAt(x, z) >= 0; }
function sideSamples(s, sg) {
  const out = [];
  const off = s.fl + 1.2;
  for (let t = 0; t <= s.L; t += 0.5) {
    const x = s.ax + s.ux * t + sg * s.nx * off, z = s.az + s.uz * t + sg * s.nz * off;
    // nút giao: gần phố KHÁC (≠ phố này) trong facadeLine + 3 m (ngõ h: + 0,5 m)
    let junc = false;
    segGrid.query([x - 14, z - 14, x + 14, z + 14], (i) => {
      if (junc) return; const o = SEGS[i]; if (o.ri === s.ri) return;
      const m = o.c === 'h' ? 0.5 : 3;
      if (segDist(x, z, o.ax, o.az, o.bx, o.bz) < o.fl + m) junc = true;
    });
    out.push({ t, x, z, junc });
  }
  return out;
}
const FRONTDBG = [];
function waterfront(x, z, nx, nz) { for (const d of [0, 4, 9, 14, 19, 24]) if (waterSD(x + nx * d, z + nz * d) < 1) return true; return false; }
function frontageStats(tag) {
  const res = {};
  for (const c of ['p', 's', 't', 'r']) res[c] = [0, 0];
  for (const s of SEGS) {
    if (!(s.c in res)) continue; if (Math.hypot((s.ax + s.bx) / 2, (s.az + s.bz) / 2) > 1600) continue;
    for (const sg of [1, -1]) for (const p of sideSamples(s, sg)) {
      if (p.junc) continue;
      const occ = occupiedAt(p.x, p.z);
      // mẫu "mặt thoáng thật" không tính: ven nước/công viên phía sau, địa danh, bãi giải toả/siêu khối/nút cầu
      const nx = sg * s.nx, nz = sg * s.nz;
      if (!occ && (waterfront(p.x, p.z, nx, nz) || inPolyList(PARK_POLYS, p.x, p.z) || inPolyList(PARK_POLYS, p.x + nx * 8, p.z + nz * 8) ||
        inPolyList(LM_POLYS, p.x, p.z, 3) || noSynZone(p.x, p.z))) continue;
      res[s.c][1]++; if (occ) res[s.c][0]++;
      if (DUMP && tag === 'after_infill' && Math.round(p.t * 2) % 4 === 0) FRONTDBG.push([+p.x.toFixed(1), +p.z.toFixed(1), s.c, occ ? 1 : 0]);
    }
  }
  const o = {}; for (const c in res) o[c] = +(100 * res[c][0] / Math.max(1, res[c][1])).toFixed(1);
  ST['frontage_' + tag] = o;
  return o;
}
console.log('  mặt phố có nhà (trước lấp khe) %:', JSON.stringify(frontageStats('before_infill')));
// ô phố phía sau (±14 m dọc phố, sâu 2-32 m) có ≥ 120 m² NHÀ DÂN thật (không phải 1 ki-ốt lẻ trong vườn/quảng trường).
// Công trình công cộng / khối lớn (> 400 m²) / cao ốc / nhà trong đa giác địa danh KHÔNG là bằng chứng: khoảng trống
// trước chúng là sân/khuôn viên/quảng trường thật (review: Nhà hát lớn, Bảo tàng từng "chứng minh" dãy nhà ống trong sân)
const inLMc = (o) => (o.inLM ??= inPolyList(LM_POLYS, ...centroid(o.pts)) ? 1 : 0);
function builtEvidence(x, z, ux, uz, nx, nz) {
  let A = 0;
  const cx = x + nx * 17, cz = z + nz * 17;
  grid.query([cx - 22, cz - 22, cx + 22, cz + 22], (j) => {
    const o = B[j]; if (o.dead || o.synth || o.civic || o.big || o.tallObs || o.area > 400 || inLMc(o)) return;
    const [bx, bz] = centroid(o.pts); const a = (bx - x) * ux + (bz - z) * uz, d = (bx - x) * nx + (bz - z) * nz;
    if (Math.abs(a) <= 14 && d >= 2 && d <= 32) A += Math.min(o.area, 400);
  });
  return A >= 120;
}
// SÂN TRƯỚC / KHUÔN VIÊN: dải lô sâu 25 m phía sau mặt phố chạm (a) đa giác địa danh + 12 m hoặc (b) công trình công
// cộng > 250 m² / khối lớn / cao ốc / nhà > 1000 m² → khe đó là sân trước, bãi xe, lối vào của công trình (Bảo tàng HP,
// Nhà hát lớn, trường THPT Ngô Quyền, bưu điện…) — không bịa nhà ống vào
function forecourt(Q) {
  const bb = bbox(Q);
  for (const o of LM_POLYS) {
    if (o.bb[0] > bb[2] + 12 || o.bb[2] < bb[0] - 12 || o.bb[1] > bb[3] + 12 || o.bb[3] < bb[1] - 12) continue;
    if (polyDist(Q, o.p) < 12) return true;
  }
  let hit = false;
  grid.query(bb, (j) => {
    if (hit) return; const o = B[j]; if (o.dead || o.synth) return;
    if (!((o.civic && o.area > 250) || o.big || o.tallObs || o.area > 1000)) return;
    if (overlapArea(Q, o.pts, 0.5) > 2) hit = true;
  });
  return hit;
}
// mặt ven công viên/vườn hoa: công viên trong 16 m phía sau facadeLine → để thoáng (dải vườn hoa HP, quảng trường)
function parkfront(x, z, nx, nz) { for (const d of [2, 6, 10, 16]) if (inPolyList(PARK_POLYS, x + nx * d, z + nz * d)) return true; return false; }
// quan sát pano (audit) ỦNG HỘ lô: tia từ pano theo hướng quan sát cắt hình chữ nhật lô ở cự ly 3-22 m
const AUD0 = JSON.parse(fs.readFileSync(new URL('../audit/audit_enriched.json', import.meta.url), 'utf8'));
// Chỉ quan sát NHÀ ỐNG/NHÀ DÂN (≤ 6 tầng, chữ không tả công trình công cộng/cao ốc) và tia không chạm đa giác địa danh
// trong 80 m: review — pano_055/056 ven quảng trường Nhà hát Lớn tả "Nhà hát Pháp cổ" hướng 315 (cách ~60 m), tia đó
// xuyên quảng trường trống và từng "chứng minh" 6 lô nhà ống giữa quảng trường.
const OBS_CIVIC_RX = /nhà hát|văn hóa|văn hoá|công sở|cơ quan|bảo tàng|nhà thờ|chùa|đền|đình|trường|bưu điện|ủy ban|uỷ ban|ga |chợ|cao tầng|cao ốc|tòa nhà|toà nhà|khách sạn|ngân hàng|trung tâm|bệnh viện|tượng đài|công viên|quảng trường/;
const RAYS = [];
for (const p of AUD0) if (typeof p.X === 'number') for (const o of p.buildings || []) {
  if ((+o.floors || 0) > 6 || OBS_CIVIC_RX.test(String(o.style || '').toLowerCase())) { stat('obs_ray_skip_civic'); continue; }
  const h = ((+o.heading || 0) * Math.PI) / 180, dx = Math.sin(h), dz = -Math.cos(h);
  let lm = false; for (let d = 2; d <= 80 && !lm; d += 1) if (inPolyList(LM_POLYS, p.X + dx * d, p.Z + dz * d)) lm = true;
  if (lm) { stat('obs_ray_skip_lm'); continue; }
  RAYS.push([p.X, p.Z, dx, dz]);
}
const rayGrid = new Grid(40); RAYS.forEach((r, i) => rayGrid.insert(i, [r[0], r[1], r[0], r[1]]));
// Pano "MẶT THOÁNG": chữ tả khu vực (area/summary) có vườn hoa/quảng trường/hồ/sông/nút giao… VÀ hướng tới nhà
// không có nhà nào được tả (bit PANO_SIDES tắt) → nhà SINH không mọc trong 32 m theo hướng đó. Nhà sinh chắn tầm nhìn
// pano thật là lỗi nặng hơn thiếu 1 lô (vd pano_021 hướng 270: nút giao + vườn hoa, từng bị 1 lô sinh chắn trước mặt
// 6 m). Chỉ dùng làm bằng chứng âm khi có chữ "mặt thoáng" — pano thường chỉ tả 2-4 nhà nên bit tắt ≠ không có nhà.
const OPEN_RX = /vườn hoa|công viên|quảng trường|bờ hồ|ven hồ|mặt hồ|bờ sông|ven sông|kè |bãi đất|bãi trống|vòng xuyến|bùng binh|khuôn viên|sân vận động|đảo cây|bãi đỗ/;
const OPENP = [], PANOVETO = [];
for (const [x, z, mask] of PANO_SIDES) {
  const a = AUD0.find((p) => typeof p.X === 'number' && Math.abs(p.X - x) < 0.6 && Math.abs(p.Z - z) < 0.6);
  if (a && OPEN_RX.test(`${a.area || ''} ${a.summary || ''}`.toLowerCase())) OPENP.push([x, z, mask]);
}
ST.open_panos = OPENP.length;
const openGrid = new Grid(40); OPENP.forEach((p, i) => openGrid.insert(i, [p[0], p[1], p[0], p[1]]));
function panoOpenVeto(Q) {
  const [cx, cz] = centroid(Q); let v = false;
  openGrid.query([cx - 45, cz - 45, cx + 45, cz + 45], (i) => {
    if (v) return; const [px, pz, mask] = OPENP[i];
    let d = Infinity;
    for (let k = 0; k < Q.length; k++) { const a = Q[k], c = Q[(k + 1) % Q.length]; d = Math.min(d, segDist(px, pz, a[0], a[1], c[0], c[1])); }
    if (d > 28) return;
    const h = ((Math.atan2(cx - px, -(cz - pz)) * 180) / Math.PI + 360) % 360;   // la bàn: 0 bắc (−z), 90 đông (+x)
    // hướng lô và cả 2 hướng kề đều không có nhà được tả (cung thoáng ≥ 135°): ô 45° quá thô — phố chạy chéo qua 2 ô
    // có dãy nhà một bên vẫn hay bị tả ở ô kề (mẫu kiểm tay 10 lô: luật 1 ô chặn nhầm 1-3/10)
    const sc = Math.round(h / 45) % 8, off = (k) => !((mask >> ((k + 8) % 8)) & 1);
    if (off(sc) && off(sc - 1) && off(sc + 1)) { v = true; if (DUMP) PANOVETO.push([+cx.toFixed(1), +cz.toFixed(1), px, pz, Math.round(h), +d.toFixed(1)]); }
  });
  return v;
}
// nhà THẬT (không sinh) trong d m quanh đa giác Q — lô chỉ có bằng chứng tia pano phải nối tiếp/tựa vào dãy nhà thật
// (review: lô giữa quảng trường Nhà hát Lớn chỉ có tia pano, nhà thật gần nhất ở bên kia phố)
function realNear(Q, dmax) {
  const bb = bbox(Q); let hit = false;
  grid.query([bb[0] - dmax, bb[1] - dmax, bb[2] + dmax, bb[3] + dmax], (j) => { if (!hit && !B[j].dead && !B[j].synth && polyDist(Q, B[j].pts) < dmax) hit = true; });
  return hit;
}
function obsSupport(Q) {
  if (!realNear(Q, 8)) return false;
  const [cx, cz] = centroid(Q); let ok = false;
  rayGrid.query([cx - 30, cz - 30, cx + 30, cz + 30], (i) => {
    if (ok) return; const [px, pz, dx, dz] = RAYS[i];
    for (let d = 3; d <= 22 && !ok; d += 0.5) if (pointInPoly(Q, px + dx * d, pz + dz * d)) ok = true;
  });
  return ok;
}
function fillGap(s, sg, t0, t1) {
  const L = t1 - t0; if (L < 3.5) return;
  const R = rng(hash32(`gap${s.ri}_${s.k}_${sg}_${Math.round(t0 * 10)}`));
  const nl = Math.max(1, Math.round(L / (4.2 + R() * 0.9)));
  const ws = []; for (let i = 0; i < nl; i++) ws.push(0.85 + R() * 0.3);
  const sw = ws.reduce((a, c) => a + c, 0);
  let t = t0;
  const nx = sg * s.nx, nz = sg * s.nz;
  const F = frontFrame({ s, sg });
  const uBase = s.ax * s.ux + s.az * s.uz;
  for (let i = 0; i < nl; i++) {
    const w = (ws[i] / sw) * L; const ta = t + 0.02, tb = t + w - 0.02; t += w;
    const D = 12 + R() * 6;
    const mx = s.ax + s.ux * (ta + tb) / 2 + nx * s.fl, mz = s.az + s.uz * (ta + tb) / 2 + nz * s.fl;
    if (waterfront(mx, mz, nx, nz)) { stat('gap_veto_water'); GAPDBG.push([mx, mz, 'water']); continue; }
    if (parkfront(mx, mz, nx, nz)) { stat('gap_veto_park'); GAPDBG.push([mx, mz, 'park']); continue; }
    // cảng/kho phía BẮC Hoàng Diệu (bờ sông Cấm): mặt đường trước kho là bãi/cổng/tường rào, không phải dãy nhà ống
    // (review: lô sinh trước kho cảng x 1132-1244). Chỉ phía bắc tim Hoàng Diệu — phía nam là phố dân thật.
    if (portGapZone(mx, mz)) { stat('gap_veto_port'); GAPDBG.push([mx, mz, 'port']); continue; }
    if (forecourt(frameRect(F, uBase + ta, uBase + tb, 0, 25))) { stat('gap_veto_forecourt'); GAPDBG.push([mx, mz, 'forecourt']); continue; }
    if (panoOpenVeto(frameRect(F, uBase + ta, uBase + tb, 0, 12))) { stat('gap_veto_pano'); GAPDBG.push([mx, mz, 'noev']); continue; }
    if (DBG && Math.hypot(mx - DBG[0], mz - DBG[1]) < 8) console.log('   [dbg gap]', mx.toFixed(1), mz.toFixed(1), s.c, 'ev', builtEvidence(mx, mz, s.ux, s.uz, nx, nz), 'obs', obsSupport(frameRect(F, uBase + ta, uBase + tb, 0, 12)));
    if (!builtEvidence(mx, mz, s.ux, s.uz, nx, nz) && !obsSupport(frameRect(F, uBase + ta, uBase + tb, 0, 12))) { stat('gap_veto_noev'); GAPDBG.push([mx, mz, 'noev']); continue; }
    const rect = (d) => frameRect(F, uBase + ta, uBase + tb, 0, d);
    let lo = 0, hi = D;
    const okD = (d) => { const Q = rect(d); if (!sweepFree(Q, -1, { corr: true, zones: true })) return false;
      const [cx, cz] = centroid(Q); return !synBlocked(cx, cz); };
    if (okD(D)) lo = D; else { for (let it = 0; it < 6; it++) { const m = (lo + hi) / 2; if (okD(m)) lo = m; else hi = m; } }
    // lô NÔNG 3-6 m: nhà thật lùi 3-6 m sau vỉa mà không kéo ra được (lệch góc > 25°, vướng tia…) → khối "cơi nới"
    // mặt tiền tựa lưng vào nhà đó (rất phổ biến ở HP). Chỉ khi cái chặn phía sau là NHÀ DÂN nhỏ (không phải công
    // trình công cộng/khối lớn có sân trước thật) — kiểm 5 điểm dọc mép sau lô, cách thêm 0,6 m.
    let shallow = false;
    if (lo < 6) {
      let ok = lo >= 3, nHit = 0;
      for (let k = 0; k < 5 && ok; k++) {
        const u = uBase + ta + ((k + 0.5) / 5) * (tb - ta);
        const [x, z] = F.world(u, lo + 0.6);
        const j = buildingAt(x, z); if (j < 0) continue;
        nHit++; const o = B[j];
        if (o.civic || o.big || o.tallObs || o.area > 400) ok = false;
      }
      if (!ok || nHit < 2) { stat('gap_too_shallow'); GAPDBG.push([mx, mz, 'shallow']); continue; }
      shallow = true; stat('gap_shallow_lots');
    }
    GAPDBG.push([mx, mz, 'ok']);
    const Q = rect(lo);
    const nb = { id: `syn_gap_${s.ri}_${s.k}_${sg}_${Math.round(ta * 10)}`, src: 'SYN', cls: '', sub: '', name: '', nfl: 0, hgt: 0,
      pts: Q, area: absArea(Q), lot: 1, synth: 1, gap: 1, shallow };
    classify(nb);
    B.push(nb); grid.insert(B.length - 1, (nb.bb = bbox(Q))); nGapLots++;
  }
}
for (let si = 0; si < SEGS.length; si++) {
  const s = SEGS[si]; if (!['p', 's', 't', 'r'].includes(s.c)) continue;
  for (const sg of [1, -1]) {
    let run = [];
    const flush = () => { if (run.length * 0.5 >= 3.5) fillGap(s, sg, run[0].t, run[run.length - 1].t + 0.5); run = []; };
    for (const p of sideSamples(s, sg)) {
      const occ = occupiedAt(p.x, p.z), blk = !p.junc && !occ && synBlocked(p.x, p.z);
      const free = !p.junc && !occ && !blk;
      if (DUMP && (p.junc || blk) && Math.round(p.t * 2) % 4 === 0) GAPDBG.push([p.x, p.z, p.junc ? 'junc' : 'blocked']);
      if (free) run.push(p); else flush();
    }
    flush();
  }
}
ST.gap_lots = nGapLots;
console.log('  mặt phố có nhà (sau lấp khe) %:', JSON.stringify(frontageStats('after_infill')));
lap(`lấp khe mặt phố: +${nGapLots} lô`);

// ======================================================================================================
// 8. LẤP LÕI Ô PHỐ trên lưới chiếm chỗ 0,5 m (tới COV_TARGET mái/ô; nhà 4-8 × 7-17 m, trục sâu ⟂ phố gần nhất)
//    Giữ trống: ngõ h (+0,4 m), sân khuôn viên công trình công cộng/lớn (đệm 10 m), địa danh (+3 m), công viên, nước,
//    camera pano (3 m), ô phố gần như không có nhà thật (< 18%: công viên/bãi/khuôn viên chưa map)
// ======================================================================================================
const COV_TARGET = 0.77;
const RS = 0.5, RH = 1760, RN = Math.ceil((2 * RH) / RS);   // 7040² ô
const OCC = new Uint8Array(RN * RN);   // 0 trống, 1 nhà thật, 4 nhà sinh, 2 đường/hè (rào ô phố), 3 cấm
let ROADM = null;                      // bản sao OCC chỉ có đường (2) + vùng cấm (3), chụp trước khi tô nhà
const ri = (x) => Math.floor((x + RH) / RS);
function fillPoly(P, val, pad = 0, onlyFree = false) {
  const bb = bbox(P);
  const j0 = Math.max(0, ri(bb[1] - pad)), j1 = Math.min(RN - 1, ri(bb[3] + pad));
  for (let j = j0; j <= j1; j++) {
    const z = -RH + (j + 0.5) * RS;
    let xs = [];
    if (pad > 0) { // nới: lấy khoảng x của đa giác nới thô = bbox hàng của các điểm trong ±pad
      for (let dz = -pad; dz <= pad; dz += RS) {
        const zz = z + dz;
        for (let i = 0, n = P.length; i < n; i++) { const a = P[i], c = P[(i + 1) % n]; if ((a[1] > zz) !== (c[1] > zz)) xs.push(a[0] + ((zz - a[1]) * (c[0] - a[0])) / (c[1] - a[1])); }
      }
      if (xs.length < 2) continue;
      xs = [Math.min(...xs), Math.max(...xs)];
    } else {
      for (let i = 0, n = P.length; i < n; i++) { const a = P[i], c = P[(i + 1) % n]; if ((a[1] > z) !== (c[1] > z)) xs.push(a[0] + ((z - a[1]) * (c[0] - a[0])) / (c[1] - a[1])); }
      xs.sort((p, q) => p - q);
    }
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, ri(xs[k] - pad)), i1 = Math.min(RN - 1, ri(xs[k + 1] + pad));
      for (let i = i0; i <= i1; i++) { const o = j * RN + i; if (onlyFree) { if (OCC[o] === 0) OCC[o] = val; } else OCC[o] = val; }
    }
  }
}
function fillSeg(s, w, val) {
  const bb = [Math.min(s.ax, s.bx) - w, Math.min(s.az, s.bz) - w, Math.max(s.ax, s.bx) + w, Math.max(s.az, s.bz) + w];
  for (let j = Math.max(0, ri(bb[1])); j <= Math.min(RN - 1, ri(bb[3])); j++) for (let i = Math.max(0, ri(bb[0])); i <= Math.min(RN - 1, ri(bb[2])); i++) {
    const x = -RH + (i + 0.5) * RS, z = -RH + (j + 0.5) * RS;
    if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < w) OCC[j * RN + i] = val;
  }
}
{
  // vùng cấm thô (2 m) → 3
  for (let j = 0; j < RN; j += 4) for (let i = 0; i < RN; i += 4) {
    const x = -RH + (i + 2) * RS, z = -RH + (j + 2) * RS;
    let bl = Math.hypot(x, z) > R_SYN + 2 || waterSD(x, z) < 1 || noSynZone(x, z);
    if (!bl) bl = inPolyList(PARK_POLYS, x, z);
    if (bl) for (let jj = j; jj < Math.min(RN, j + 4); jj++) OCC.fill(3, jj * RN + i, jj * RN + Math.min(RN, i + 4));
  }
  for (const o of LM_POLYS) fillPoly(o.p, 3, 3);
  for (const [ax, az, bx, bz, w] of RAILS) fillSeg({ ax, az, bx, bz }, w, 3);
  for (const [x, z] of PANO_CAM) fillPoly([[x - 3, z - 3], [x + 3, z - 3], [x + 3, z + 3], [x - 3, z + 3]], 3);
  for (const s of SEGS) fillSeg(s, s.c === 'h' ? s.hw + 0.4 : s.fl, 2);
  ROADM = OCC.slice();   // bản sạch đường/hè/ngõ (2) + vùng cấm (3) TRƯỚC khi nhà (nới 0,3 m) ghi đè lên — dùng ở bước 9a
  for (const b of B) if (!b.dead) fillPoly(b.pts, b.synth ? 4 : 1, 0.3);   // nới 0,3 m: ô bị phủ MỘT PHẦN cũng tính là có nhà (nhà mới không lấn mép)
  // sân khuôn viên: đệm 10 m quanh công trình công cộng/lớn (chỉ ô đang trống)
  for (const b of B) if (!b.dead && !b.synth && (b.civic || b.area > 1500)) fillPoly(b.pts, 3, 10, true);
}
lap('raster chiếm chỗ');
// ô phố = thành phần liên thông 4-hướng của ô KHÔNG phải đường
const LAB = new Int32Array(RN * RN).fill(-1);
const blocks = [];
{
  const stack = new Int32Array(RN * RN);
  for (let o0 = 0; o0 < RN * RN; o0++) {
    if (LAB[o0] !== -1 || OCC[o0] === 2) continue;
    const id = blocks.length; let sp = 0; stack[sp++] = o0; LAB[o0] = id;
    let nReal = 0, nSyn = 0, nFree = 0;
    while (sp) {
      const o = stack[--sp];
      const v = OCC[o]; if (v === 1) nReal++; else if (v === 4) nSyn++; else if (v === 0) nFree++;
      const i = o % RN;
      if (i > 0 && LAB[o - 1] === -1 && OCC[o - 1] !== 2) { LAB[o - 1] = id; stack[sp++] = o - 1; }
      if (i < RN - 1 && LAB[o + 1] === -1 && OCC[o + 1] !== 2) { LAB[o + 1] = id; stack[sp++] = o + 1; }
      if (o >= RN && LAB[o - RN] === -1 && OCC[o - RN] !== 2) { LAB[o - RN] = id; stack[sp++] = o - RN; }
      if (o < RN * (RN - 1) && LAB[o + RN] === -1 && OCC[o + RN] !== 2) { LAB[o + RN] = id; stack[sp++] = o + RN; }
    }
    blocks.push({ nReal, nSyn, nFree });
  }
}
lap(`ô phố: ${blocks.length}`);
const blkCov = (k) => (k.nReal + k.nSyn) / Math.max(1, k.nReal + k.nSyn + k.nFree);
function coverage(tag) {
  let b = 0, f = 0, br = 0;
  for (const k of blocks) { if (k.nReal + k.nSyn + k.nFree < 400) continue; b += k.nReal + k.nSyn; br += k.nReal; f += k.nFree; }
  ST['coverage_' + tag] = +(100 * b / Math.max(1, b + f)).toFixed(1);
  ST['coverage_real_' + tag] = +(100 * br / Math.max(1, b + f)).toFixed(1);
  ST['buildable_km2'] = +((b + f) * RS * RS / 1e6).toFixed(2);
  return ST['coverage_' + tag];
}
console.log('  phủ mái ô phố (trước lấp lõi) %:', coverage('before_interior'));
let nInterior = 0;
{
  const R = rng(1234567);
  const cand = [];
  for (let j = 2; j < RN - 2; j += 5) for (let i = 2; i < RN - 2; i += 5) {   // lưới thưa 2,5 m
    const o = j * RN + i; if (OCC[o] !== 0) continue;
    const bl = blocks[LAB[o]]; if (!bl || bl.nReal + bl.nSyn + bl.nFree < 600) continue;
    if (bl.nReal / (bl.nReal + bl.nSyn + bl.nFree) < 0.18) continue;   // ô gần như trống nhà thật: không bịa
    cand.push(o);
  }
  for (let k = cand.length - 1; k > 0; k--) { const r = Math.floor(R() * (k + 1)); const t = cand[k]; cand[k] = cand[r]; cand[r] = t; }
  const nearestSeg = (x, z) => {
    let best = null, bd = 80;
    segGrid.query([x - 80, z - 80, x + 80, z + 80], (i) => { const s = SEGS[i]; const d = segDist(x, z, s.ax, s.az, s.bx, s.bz); if (d < bd) { bd = d; best = s; } });
    return best;
  };
  // Ô trong hình chữ nhật cục bộ [a0,a1]×[b0,b1] quanh (cx,cz) (trục a = (ux,uz), b = (−uz,ux)) đều trống; viền `gap`
  // quanh nó không được là đường/vùng cấm (nhà khác OK → nhà mới được áp tường chung vào nhà cũ như phố thật)
  let openTest = null;   // 8b: hàm (x,z) → đất trống mở (lõi nhà sinh không được mọc vào), gán sau khi tính OPEN
  const boxFree = (cx, cz, ux, uz, a0, a1, b0, b1, gap) => {
    const vx = -uz, vz = ux;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [a, b] of [[a0 - gap, b0 - gap], [a1 + gap, b0 - gap], [a1 + gap, b1 + gap], [a0 - gap, b1 + gap]]) {
      const x = cx + ux * a + vx * b, z = cz + uz * a + vz * b;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    for (let j = ri(z0); j <= ri(z1); j++) for (let i = ri(x0); i <= ri(x1); i++) {
      if (i < 0 || j < 0 || i >= RN || j >= RN) return false;
      const x = -RH + (i + 0.5) * RS - cx, z = -RH + (j + 0.5) * RS - cz;
      const a = x * ux + z * uz, b = x * vx + z * vz;
      if (a < a0 - gap || a > a1 + gap || b < b0 - gap || b > b1 + gap) continue;
      const v = OCC[j * RN + i];
      if (v === 0) { if (openTest && a >= a0 && a <= a1 && b >= b0 && b <= b1 && openTest(x + cx, z + cz)) return false; continue; }
      if (a >= a0 && a <= a1 && b >= b0 && b <= b1) return false;   // lõi: phải trống hẳn
      if (v === 2 || v === 3) return false;                            // viền: không sát đường/vùng cấm
    }
    return true;
  };
  // MỌC hình chữ nhật từ hạt 2×2 m: nới từng cạnh 0,5 m tới kích thước đích (sâu 9-16 m theo a, rộng 4-7,2 m theo b)
  // hoặc tới khi vướng → lấp khít khe giữa nhà thật như thảm nhà ống thật (không để lại dải trống 5-10 m)
  const STEP = 0.5, GAP = 0.6;
  // 8a. NỚI nhà THẬT trong lõi ô (footprint ML nông/vỡ — thật là nhà ống 4-8 × 10-18 m): mọc từng cạnh 0,5 m vào chỗ
  //     trống (không thêm nhà → không tốn byte), dừng khi vướng hoặc tới kích thước nhà ống / ô đạt COV_TARGET
  let nGrow = 0, growA = 0;
  {
    const R = rng(7654321);
    const ids = [];
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi]; if (b.dead || b.synth || b.civic || b.big || b.pts.length !== 4) continue;
      if (b.lot || mainFront(bi, 2)) continue;   // nhà mặt phố đã xử lý ở bước 4-6
      ids.push(bi);
    }
    for (let k = ids.length - 1; k > 0; k--) { const r = Math.floor(R() * (k + 1)); const t = ids[k]; ids[k] = ids[r]; ids[r] = t; }
    for (const bi of ids) {
      const b = B[bi];
      const mr = minRect(b.pts); if (!mr) continue;
      // chỉ nhà gần chữ nhật (diện tích ≥ 92% hình chữ nhật bao nhỏ nhất)
      if (b.area < 0.92 * mr.w * mr.d) continue;
      const [cx, cz] = centroid(b.pts);
      const o = ri(cz) * RN + ri(cx); const bl = blocks[LAB[o]]; if (!bl || blkCov(bl) >= COV_TARGET) continue;
      const ux = mr.ux, uz = mr.uz;   // a = trục dài
      const vx = -uz, vz = ux;
      // khung cục bộ quanh tâm hình chữ nhật bao
      const uc = (mr.u0 + mr.u1) / 2, vc = (mr.v0 + mr.v1) / 2;
      const ox = uc * ux + vc * vx, oz = uc * uz + vc * vz;
      let a0 = -mr.w / 2, a1 = mr.w / 2, b0 = -mr.d / 2, b1 = mr.d / 2;
      const r2 = rng(hash32(b.id + 'grow'));
      const Lt = Math.max(mr.w, 10 + r2() * 8), St = Math.max(mr.d, 4.2 + r2() * 3.3);
      const lim = [a1 + 6, a0 - 6, b1 + 4, b0 - 4];
      const grow = [true, true, true, true], first = [0.35, 0.35, 0.35, 0.35];   // bước đầu mỗi cạnh: bỏ qua dải nới 0,3 m của chính nhà này
      for (let it = 0; it < 80 && grow.some(Boolean); it++) {
        const k = it % 4; if (!grow[k]) continue;
        if ((k < 2 && a1 - a0 >= Lt) || (k >= 2 && b1 - b0 >= St)) { grow[k] = false; continue; }
        if ((k === 0 && a1 + STEP > lim[0]) || (k === 1 && a0 - STEP < lim[1]) || (k === 2 && b1 + STEP > lim[2]) || (k === 3 && b0 - STEP < lim[3])) { grow[k] = false; continue; }
        const f = first[k]; first[k] = 0;
        const ok = k === 0 ? boxFree(ox, oz, ux, uz, a1 + f, a1 + f + STEP, b0, b1, GAP) : k === 1 ? boxFree(ox, oz, ux, uz, a0 - f - STEP, a0 - f, b0, b1, GAP)
          : k === 2 ? boxFree(ox, oz, ux, uz, a0, a1, b1 + f, b1 + f + STEP, GAP) : boxFree(ox, oz, ux, uz, a0, a1, b0 - f - STEP, b0 - f, GAP);
        if (!ok) { grow[k] = false; continue; }
        if (k === 0) a1 += STEP; else if (k === 1) a0 -= STEP; else if (k === 2) b1 += STEP; else b0 -= STEP;
      }
      const W = (a, c) => [ox + ux * a + vx * c, oz + uz * a + vz * c];
      const P = outward([W(a0, b0), W(a0, b1), W(a1, b1), W(a1, b0)]);
      const A = absArea(P);
      if (A < b.area + 6) continue;
      const add = Math.round((A - b.area) / (RS * RS)); bl.nReal += add; bl.nFree -= add;
      growA += A - b.area;
      b.pts = P; b.area = A; b.grown = 1; nGrow++;
      fillPoly(P, 1, 0.3);
      grid.update(bi, (b.bb = bbox(P)));
    }
  }
  ST.grown = nGrow; ST.grown_m2 = Math.round(growA);
  lap(`nới nhà thật lõi ô: ${nGrow} (+${Math.round(growA)} m²) → phủ ${coverage('after_grow')}%`);
  // 8b. BẰNG CHỨNG CỤC BỘ cho nhà sinh lõi ô (review: dải đất giải toả đường sắt ~200 m không có footprint nào từng bị rải
  //     nhà sinh vì luật cũ chỉ xét CẢ ô phố ≥ 18% nhà thật): hạt phải (a) có nhà THẬT trong ô vuông ±INT_NEAR_R m và
  //     (b) tỉ lệ nhà thật / (thật + trống) trong ô vuông ±INT_R m quanh hạt ≥ INT_FRAC — khoảng trống lớn không có nhà thật
  //     xung quanh là bãi/sân/công trường thật, không phải nhà ML bỏ sót. Đo trên raster TRƯỚC khi mọc nhà sinh (ảnh tích
  //     phân lưới thô 2 m) → không phụ thuộc thứ tự mọc.
  const CS = 4, CN = Math.ceil(RN / CS), CW = CN + 1;
  const IR = new Int32Array(CW * CW), IFR = new Int32Array(CW * CW);
  {
    const cr = new Int32Array(CN * CN), cf = new Int32Array(CN * CN);
    for (let j = 0; j < RN; j++) { const rc = ((j / CS) | 0) * CN; for (let i = 0; i < RN; i++) { const v = OCC[j * RN + i]; if (v === 1) cr[rc + ((i / CS) | 0)]++; else if (v === 0) cf[rc + ((i / CS) | 0)]++; } }
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const o = (j + 1) * CW + i + 1;
      IR[o] = cr[j * CN + i] + IR[o - CW] + IR[o - 1] - IR[o - CW - 1];
      IFR[o] = cf[j * CN + i] + IFR[o - CW] + IFR[o - 1] - IFR[o - CW - 1];
    }
  }
  const boxSum = (I, x, z, r) => {
    const c = RS * CS, i0 = Math.max(0, Math.floor((x - r + RH) / c)), i1 = Math.min(CN - 1, Math.floor((x + r + RH) / c));
    const j0 = Math.max(0, Math.floor((z - r + RH) / c)), j1 = Math.min(CN - 1, Math.floor((z + r + RH) / c));
    return I[(j1 + 1) * CW + i1 + 1] - I[j0 * CW + i1 + 1] - I[(j1 + 1) * CW + i0] + I[j0 * CW + i0];
  };
  const INT_NEAR_R = +(process.env.INT_NEAR_R ?? 10), INT_NEAR_MIN = +(process.env.INT_NEAR_MIN ?? 8);   // ≥ 8 ô 0,5 m = 2 m² nhà thật
  const INT_R = +(process.env.INT_R ?? 16), INT_FRAC = +(process.env.INT_FRAC ?? 0.3);
  // (c) ĐẤT TRỐNG MỞ (phép "mở" hình thái trên lưới thô 2 m): lõi = ô trống cách mọi thứ không-trống (nhà, đường, vùng cấm)
  //     ≥ OPEN_R m (vừa 1 đĩa Ø 2·OPEN_R); thành phần lõi liên thông ≥ OPEN_A m² (≈ bãi trống > ~27×27 m) là đất trống
  //     thật → mọi ô trong OPEN_R + 1 m quanh lõi đó (cả mép, sát dãy nhà thật) cấm mọc nhà sinh. Một nhà/cụm nhà ML bỏ
  //     sót (≤ 20×20 m) không tạo lõi đủ lớn. (Review: mép dải giải toả đường sắt vẫn mọc 1 hàng nhà sau luật (a)(b).)
  const OPEN_R = +(process.env.OPEN_R ?? 5), OPEN_A = +(process.env.OPEN_A ?? 300);
  const OPEN = new Uint8Array(CN * CN);
  {
    const cs = RS * CS, INF = 1e9, dt = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const o = (j + 1) * CW + i + 1, f = IFR[o] - IFR[o - CW] - IFR[o - 1] + IFR[o - CW - 1];   // ô 0,5 m trống trong ô thô
      dt[j * CN + i] = f >= CS * CS - 2 ? INF : 0;
    }
    const chamfer = (d) => {
      const a = cs, b = cs * Math.SQRT2;
      for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
        const o = j * CN + i; let v = d[o]; if (v === 0) continue;
        if (i > 0) v = Math.min(v, d[o - 1] + a);
        if (j > 0) { v = Math.min(v, d[o - CN] + a); if (i > 0) v = Math.min(v, d[o - CN - 1] + b); if (i < CN - 1) v = Math.min(v, d[o - CN + 1] + b); }
        d[o] = v;
      }
      for (let j = CN - 1; j >= 0; j--) for (let i = CN - 1; i >= 0; i--) {
        const o = j * CN + i; let v = d[o]; if (v === 0) continue;
        if (i < CN - 1) v = Math.min(v, d[o + 1] + a);
        if (j < CN - 1) { v = Math.min(v, d[o + CN] + a); if (i < CN - 1) v = Math.min(v, d[o + CN + 1] + b); if (i > 0) v = Math.min(v, d[o + CN - 1] + b); }
        d[o] = v;
      }
    };
    chamfer(dt);
    // thành phần lõi (8 hướng) → lõi lớn
    const lab = new Int32Array(CN * CN).fill(-1), stack = new Int32Array(CN * CN), d2 = new Float32Array(CN * CN).fill(INF);
    let nComp = 0, nBig = 0;
    for (let o0 = 0; o0 < CN * CN; o0++) {
      if (lab[o0] !== -1 || dt[o0] < OPEN_R) continue;
      let sp = 0, n = 0; stack[sp++] = o0; lab[o0] = nComp; const mem = [];
      while (sp) {
        const o = stack[--sp]; n++; mem.push(o); const i = o % CN, j = (o - i) / CN;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= CN || jj >= CN) continue;
          const q = jj * CN + ii; if (lab[q] === -1 && dt[q] >= OPEN_R) { lab[q] = nComp; stack[sp++] = q; }
        }
      }
      if (n * cs * cs >= OPEN_A) { nBig++; for (const o of mem) d2[o] = 0; }
      nComp++;
    }
    chamfer(d2);
    let nOpen = 0; for (let o = 0; o < CN * CN; o++) if (d2[o] <= OPEN_R + 1) { OPEN[o] = 1; nOpen++; }
    ST.open_land_m2 = Math.round(nOpen * cs * cs); ST.open_cores = nBig;
  }
  const isOpen = (x, z) => { const c = RS * CS, i = Math.floor((x + RH) / c), j = Math.floor((z + RH) / c); return i >= 0 && j >= 0 && i < CN && j < CN && OPEN[j * CN + i] === 1; };
  openTest = isOpen;
  for (const o of cand) {
    if (OCC[o] !== 0) continue;
    const bl = blocks[LAB[o]];
    if (blkCov(bl) >= COV_TARGET) continue;
    const i = o % RN, j = (o - i) / RN;
    const cx = -RH + (i + 0.5) * RS, cz = -RH + (j + 0.5) * RS;
    const nearR = boxSum(IR, cx, cz, INT_NEAR_R), rr = boxSum(IR, cx, cz, INT_R), ff = boxSum(IFR, cx, cz, INT_R), fr = rr / Math.max(1, rr + ff);
    if (nearR < INT_NEAR_MIN) { stat('interior_veto_near'); continue; }
    if (fr < INT_FRAC) { stat('interior_veto_frac'); continue; }
    if (isOpen(cx, cz)) { stat('interior_veto_open'); continue; }
    const s = nearestSeg(cx, cz); if (!s) continue;
    const r2 = rng(o + 7);
    const par = r2() < 0.2;
    const ux = par ? s.ux : s.nx, uz = par ? s.uz : s.nz;   // a = trục SÂU (dài), vuông góc phố gần nhất như nhà ống
    let a0 = -1, a1 = 1, b0 = -1, b1 = 1;
    if (!boxFree(cx, cz, ux, uz, a0, a1, b0, b1, GAP)) continue;
    const Dt = 10 + r2() * 8, Wt = 4.5 + r2() * 3.5;
    const grow = [true, true, true, true];
    for (let it = 0; it < 80 && grow.some(Boolean); it++) {
      const k = it % 4; if (!grow[k]) continue;
      if ((k < 2 && a1 - a0 >= Dt) || (k >= 2 && b1 - b0 >= Wt)) { grow[k] = false; continue; }
      const ok = k === 0 ? boxFree(cx, cz, ux, uz, a1, a1 + STEP, b0, b1, GAP) : k === 1 ? boxFree(cx, cz, ux, uz, a0 - STEP, a0, b0, b1, GAP)
        : k === 2 ? boxFree(cx, cz, ux, uz, a0, a1, b1, b1 + STEP, GAP) : boxFree(cx, cz, ux, uz, a0, a1, b0 - STEP, b0, GAP);
      if (!ok) { grow[k] = false; continue; }
      if (k === 0) a1 += STEP; else if (k === 1) a0 -= STEP; else if (k === 2) b1 += STEP; else b0 -= STEP;
    }
    const D = a1 - a0, Wd = b1 - b0;
    if (Math.min(D, Wd) < 3.8 || Math.max(D, Wd) < 6 || D * Wd < 32) continue;   // không rải "mẩu" < 32 m² (tốn byte, không giống nhà)
    const vx = -uz, vz = ux;
    const W = (a, b) => [cx + ux * a + vx * b, cz + uz * a + vz * b];
    const P = outward([W(a0, b0), W(a0, b1), W(a1, b1), W(a1, b0)]);
    if (panoOpenVeto(P)) { stat('interior_veto_pano'); continue; }
    const nb = { id: `syn_in_${o}`, src: 'SYN', cls: '', sub: '', name: '', nfl: 0, hgt: 0, pts: P, area: absArea(P), synth: 1, interior: 1 };
    classify(nb);
    B.push(nb); grid.insert(B.length - 1, (nb.bb = bbox(P)));
    fillPoly(P, 4, 0.3);
    const add = Math.round(nb.area / (RS * RS)); bl.nSyn += add; bl.nFree -= add;
    nInterior++;
    if (DUMP) INTDBG.push([+cx.toFixed(1), +cz.toFixed(1), nearR, +fr.toFixed(3)]);
  }
}
ST.interior = nInterior;
if (process.env.DEBUG_BLK) {
  const agg = { small: [0, 0], lowreal: [0, 0], attarget: [0, 0], below: [0, 0] };
  for (const k of blocks) {
    const tot = k.nReal + k.nSyn + k.nFree; if (tot < 400) continue;
    const key = tot < 600 ? 'small' : k.nReal / tot < 0.18 ? 'lowreal' : blkCov(k) >= COV_TARGET - 0.01 ? 'attarget' : 'below';
    agg[key][0] += tot * RS * RS; agg[key][1] += k.nFree * RS * RS;
  }
  console.log('  [blk] (diện tích dựng được, trống) m²:', JSON.stringify(Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, v.map(Math.round)]))));
}
lap(`lấp lõi: +${nInterior} nhà`);
console.log('  phủ mái ô phố (sau lấp lõi) %:', coverage('after_interior'));

// ======================================================================================================
// 9. CHỮ NHẬT HOÁ (mã hoá gọn RBR1): đa giác 4 đỉnh lệch vuông ≤ 1,2° → đúng chữ nhật (giữ đỉnh 0)
// ======================================================================================================
B = B.filter((b) => !b.dead);
grid = rebuildGrid();
// đa giác 5-8 đỉnh gần chữ nhật (khấc ≤ 6% và ≤ 5 m²) → chữ nhật bao nhỏ nhất nếu không đè nhà khác
let nSq2 = 0;
for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi]; if (b.pts.length < 5 || b.pts.length > 8 || b.civic) continue;
  const mr = minRect(b.pts); if (!mr) continue;
  const A = mr.w * mr.d; if (A > 1.06 * b.area || A - b.area > 5) continue;
  const vx = -mr.uz, vz = mr.ux;
  const W = (u, v) => [u * mr.ux + v * vx, u * mr.uz + v * vz];
  const Q = outward([W(mr.u0, mr.v0), W(mr.u1, mr.v0), W(mr.u1, mr.v1), W(mr.u0, mr.v1)]);
  if (!sweepFree(Q, bi, { corr: true })) continue;
  b.pts = Q; b.area = absArea(Q); b.notch = 1; nSq2++;
  grid.update(bi, (b.bb = bbox(Q)));
}
ST.notch_squared = nSq2;
let nRect = 0;
for (const b of B) {
  const r = b.synth || b.lot || b.squared ? rectOf(b.pts) : rectOf(b.pts, 2.2, 0.1, 0.35);   // footprint thật: lệch ≤ 2,2° và ≤ 35 cm (sai số nguồn ~1 m)
  if (!r) continue;
  const ca = Math.cos(r.ang), sa = Math.sin(r.ang);
  b.pts = [[r.x0, r.z0], [r.x0 + r.w * ca, r.z0 + r.w * sa], [r.x0 + r.w * ca + r.d * sa, r.z0 + r.w * sa - r.d * ca], [r.x0 + r.d * sa, r.z0 - r.d * ca]];
  b.rect = r; nRect++;
}
grid = rebuildGrid();
ST.rects = nRect;
// ======================================================================================================
// 9a. NỞ nhà chữ nhật lấp khe 0,3-3 m còn lại giữa các mái (ảnh vệ tinh real_1..8: mái liền mái, chỉ ngõ/phố hở;
//     footprint ML/GG lại hụt ~1 m mỗi phía + nhà sinh đặt cách nhau ≥ 0,3 m) — KHÔNG thêm nhà → không tốn byte.
//     Mỗi vòng mỗi cạnh tiến ≤ 0,5 m tới điểm chạm CHÍNH XÁC của nhà láng giềng (cắt đa giác láng giềng vào dải quét)
//     hoặc ô raster đường/hè/ngõ (2) hay vùng cấm (3: nước, công viên, địa danh +3 m, camera pano, sân khuôn viên).
//     Cạnh mặt tiền đã nằm trên facadeLine nên tự đứng yên. Trần nở mỗi cạnh: nhà thật 1,5 m, nhà sinh 2,5 m.
// ======================================================================================================
function edgeReach(bi, k, maxE) {
  const P = B[bi].pts, n = P.length, a = P[k], c = P[(k + 1) % n];
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1) return 0;
  const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L, nx = -ez, nz = ex;
  const t0 = ex * a[0] + ez * a[1], s0 = nx * a[0] + nz * a[1];
  let best = maxE;
  // đường/hè/ngõ + vùng cấm trên raster (bước 0,25 m, mẫu dọc cạnh 0,4 m)
  for (let t = 0.15; t < L - 0.1 && best > 0; t += 0.4) {
    const px = a[0] + ex * t, pz = a[1] + ez * t;
    for (let s = 0.25; s <= best + 0.25; s += 0.25) {
      const x = px + nx * s, z = pz + nz * s, i = ri(x), j = ri(z);
      if (i < 0 || j < 0 || i >= RN || j >= RN) { best = Math.min(best, s - 0.25); break; }
      const o = j * RN + i, v = ROADM[o];
      if (v === 2 || v === 3 || OCC[o] === 3) { best = Math.min(best, s - 0.25); break; }
    }
  }
  if (best <= 0.05) return 0;
  // nhà láng giềng: điểm chạm chính xác trong dải t ∈ (t0, t0+L), s ∈ [s0, s0+best]
  const sw = [a, c, [c[0] + nx * best, c[1] + nz * best], [a[0] + nx * best, a[1] + nz * best]];
  grid.query(bbox(sw), (j) => {
    if (j === bi || best <= 0) return;
    for (const q1 of clipStrip(B[j].pts, ex, ez, t0 + 0.05, t0 + L - 0.05)) {
      for (const q2 of clipStrip(q1, nx, nz, s0 - 0.03, s0 + best)) for (const p of q2) best = Math.min(best, Math.max(0, nx * p[0] + nz * p[1] - s0));
    }
  });
  return best;
}
{
  let nGrowE = 0, growE = 0;
  const cap = (b) => (b.synth ? 2.5 : 1.5);
  const ids = []; B.forEach((b, i) => { if (b.rect && !b.civic && !b.big && !b.tallObs && b.area < 600) { ids.push(i); b.ext = [0, 0, 0, 0]; } });
  for (let round = 0; round < 5; round++) {
    for (const bi of ids) {
      const b = B[bi];
      for (let k = 0; k < 4; k++) {
        const room = cap(b) - b.ext[k]; if (room < 0.1) continue;
        const P = b.pts, a = P[k], c = P[(k + 1) % 4], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const W2 = Math.hypot(P[(k + 2) % 4][0] - c[0], P[(k + 2) % 4][1] - c[1]);   // bề đo theo hướng nở
        const dimCap = (L >= W2 ? 9 : 22) - W2;   // cạnh dài nở → bề ngắn ≤ 9 m; cạnh ngắn nở → bề dài ≤ 22 m
        const e = Math.min(0.5, room, dimCap, edgeReach(bi, k, Math.min(0.5, room, dimCap)) - 0.02);
        if (e < 0.1) continue;
        const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;
        const Q = P.map((p, i) => (i === k || i === (k + 1) % 4 ? [p[0] + nx * e, p[1] + nz * e] : p));
        const r = rectOf(Q); if (!r) continue;
        const A = absArea(Q); growE += A - b.area;
        b.pts = Q; b.area = A; b.rect = r; b.ext[k] += e; b.grown2 = 1;
        grid.update(bi, (b.bb = bbox(Q)));
      }
    }
  }
  for (const bi of ids) if (B[bi].grown2) nGrowE++;
  ST.expanded = nGrowE; ST.expanded_m2 = Math.round(growE);
  lap(`nở chữ nhật lấp khe: ${nGrowE} nhà (+${Math.round(growE)} m²)`);
}
// ======================================================================================================
// 9b. KHÉP KHE giữa 2 nhà kề (cạnh song song ngược chiều, cách 3-80 cm, chồng ≥ 60% cạnh): dời cạnh của nhà "mềm"
//     (nhà sinh > nhà đã nới/vuông hoá/chia lô > nhà nhỏ hơn) chạm hẳn nhà kia. Không khép → tường chung (PARTY,
//     chỉ dựng phần trên edgeCover) sẽ để lộ khe nhìn xuyên vào trong nhà; phố thật nhà ống liền tường.
// ======================================================================================================
let nClose = 0;
{
  const soft = (b) => (b.synth ? 3 : b.grown || b.squared || b.lot || b.cell ? 2 : 1);
  for (let bi = 0; bi < B.length; bi++) {
    const b = B[bi], P = b.pts, n = P.length;
    if (b.civic || b.big) continue;
    for (let k = 0; k < n; k++) {
      const a = P[k], c = P[(k + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1.5) continue;
      const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L, nx = -ez, nz = ex;
      let best = null;
      grid.query([Math.min(a[0], c[0]) - 1, Math.min(a[1], c[1]) - 1, Math.max(a[0], c[0]) + 1, Math.max(a[1], c[1]) + 1], (j) => {
        if (j === bi) return; const o = B[j], Q = o.pts;
        for (let m = 0; m < Q.length; m++) {
          const p = Q[m], q = Q[(m + 1) % Q.length], Lq = Math.hypot(q[0] - p[0], q[1] - p[1]); if (Lq < 1.5) continue;
          if (((q[0] - p[0]) * ex + (q[1] - p[1]) * ez) / Lq > -0.995) continue;
          const dp = (p[0] - a[0]) * nx + (p[1] - a[1]) * nz, dq = (q[0] - a[0]) * nx + (q[1] - a[1]) * nz;
          const g = (dp + dq) / 2; if (g < 0.03 || g > 0.8 || Math.abs(dp - dq) > 0.1) continue;
          let t0 = (p[0] - a[0]) * ex + (p[1] - a[1]) * ez, t1 = (q[0] - a[0]) * ex + (q[1] - a[1]) * ez; if (t0 > t1) [t0, t1] = [t1, t0];
          const ov = Math.min(L, t1) - Math.max(0, t0); if (ov < 0.6 * L) continue;
          if (!best || g < best.g) best = { j, g };
        }
      });
      if (!best) continue;
      const o = B[best.j];
      const mine = soft(b) > soft(o) || (soft(b) === soft(o) && (b.area < o.area || (b.area === o.area && bi > best.j)));
      if (!mine) continue;
      const g = best.g;
      const quad = outward([a, c, [c[0] + nx * g, c[1] + nz * g], [a[0] + nx * g, a[1] + nz * g]]);
      if (!sweepFree(quad, bi, { corr: true, zones: true, ignore: new Set([best.j]) })) continue;
      // khe mỏng (< 24 cm) lọt lưới lấy mẫu của sweepFree → dò thêm dọc đường giữa khe
      let third = false;
      for (let t = 0.1; t < L - 0.05 && !third; t += 0.25) {
        const qx = a[0] + ex * t + nx * g / 2, qz = a[1] + ez * t + nz * g / 2;
        grid.query([qx, qz, qx, qz], (j) => { if (!third && j !== bi && j !== best.j && pointInPoly(B[j].pts, qx, qz)) third = true; });
      }
      if (third) continue;
      const Q2 = P.map((p, i) => (i === k || i === (k + 1) % n ? [p[0] + nx * g, p[1] + nz * g] : p));
      if (!isSimple(Q2) || signedArea(Q2) >= 0) continue;
      b.pts = Q2; b.area = absArea(Q2); b.closed = 1; nClose++;
      grid.update(bi, (b.bb = bbox(Q2)));
      if (b.rect) { const r = rectOf(Q2); b.rect = r; }
    }
  }
}
ST.gaps_closed = nClose;
lap(`khép khe nhà kề: ${nClose}`);
lap(`chữ nhật: ${nRect}/${B.length}`);

// ======================================================================================================
// 9c. CHỒNG LẤN CÒN SÓT (> 1 m²: dữ liệu nguồn chồng, chữ nhật hoá ±35 cm…): cắt nhà "mềm" theo cạnh nhà kia;
//     nhà sinh không cắt sạch được thì bỏ. Mái 2 nhà chồng cùng độ cao sẽ nhấp nháy (z-fight) khi nhìn từ trên.
// ======================================================================================================
{
  let nFix = 0, nDrop = 0;
  const soft = (b) => (b.synth ? 3 : b.grown || b.squared || b.lot || b.cell ? 2 : 1);
  for (let bi = 0; bi < B.length; bi++) {
    const b = B[bi]; if (b.dead) continue;
    grid.query(b.bb, (j) => {
      if (j <= bi || b.dead) return; const o = B[j]; if (o.dead) return;
      const ov = overlapArea(b.pts, o.pts, 0.25); if (ov < 1) return;
      const [hard, sf, si] = soft(b) > soft(o) || (soft(b) === soft(o) && b.area < o.area) ? [o, b, bi] : [b, o, j];
      let best = null;
      const P = hard.pts;
      for (let k = 0; k < P.length; k++) {
        const a = P[k], c = P[(k + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.8) continue;
        const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;
        for (const q of clipHalf(sf.pts, nx, nz, nx * a[0] + nz * a[1])) {
          const Q = outward(cleanPoly(q)); if (Q.length < 3) continue;
          const A = absArea(Q); if (best && A <= best.A) continue;
          if (overlapArea(hard.pts, Q, 0.25) > 0.3) continue;
          best = { Q, A };
        }
      }
      if (best && (best.A > 0.6 * sf.area || !sf.synth)) {
        setRectOrPoly(sf, best.Q); sf.ovcut = 1; nFix++;
        grid.update(si, (sf.bb = bbox(sf.pts)));
      } else if (sf.synth) { sf.dead = 'overlap'; nDrop++; grid.remove(si); }
    });
  }
  B = B.filter((b) => !b.dead);
  grid = rebuildGrid();
  ST.overlap_fixed = nFix; ST.overlap_dropped = nDrop;
  lap(`chồng lấn: cắt ${nFix}, bỏ ${nDrop} nhà sinh`);
}
// ======================================================================================================
// 9d. KIỂM HỢP LỆ lần cuối (sau mọi phép cắt/nở/khép): đa giác đơn, tường-ra-ngoài, ≥ 6 m², bề hẹp nhất ≥ 1,2 m.
//     Hỏng thì làm sạch đỉnh (cleanPoly) rồi kiểm lại; vẫn hỏng → bỏ (thống kê drop_invalid). Renderer (WP2) và lưới
//     va chạm giả định mọi footprint hợp lệ — 1 đa giác răng cưa diện tích 0 từng lọt ra từ clipHalf.
// ======================================================================================================
// 9d-0. CHỐT HÀNH LANG PHỐ lần cuối: không nhà nào (thật hay sinh) được lấn > 0,3 m vào lòng + vỉa hè (facadeLine) của
//     phố p/s/t/r — tính cả "mũ tròn" ở đỉnh gãy GIỮA polyline (góc ngoài chỗ phố bẻ hướng; corridorClip bước 3 chỉ xét
//     dải t∈[0,1] nên sót footprint gốc ở khúc cua, vd GG (−70,581)) và ở chỗ nối 2 way. Đầu CỤT thật / đầu chạm ngang
//     phố khác không có mũ (game không vẽ vỉa vòng qua đầu phố; phố kia tự có hành lang). Lấn > 0,2 m (chừa 0,1 m làm tròn) → cắt nửa mặt phẳng tại facadeLine (tiếp tuyến mũ ở khúc
//     cua); còn lấn / mất > 50% → bỏ.
// đầu polyline NỐI TIẾP một phố khác (đầu mút trùng ≤ 1 m: OSM tách way tại nút) cũng là khúc gãy → có mũ
const ENDCAP = ROADS_DT.map((r, ri) => [0, r.pts.length - 1].map((e) => ROADS_DT.some((o, rj) => rj !== ri &&
  [o.pts[0], o.pts[o.pts.length - 1]].some((q) => Math.hypot(q[0] - r.pts[e][0], q[1] - r.pts[e][1]) < 1))));
function capDist(s, x, z) {
  const t = (x - s.ax) * s.ux + (z - s.az) * s.uz;
  if (t >= 0 && t <= s.L) return Math.abs((x - s.ax) * s.nx + (z - s.az) * s.nz);
  const nPts = ROADS_DT[s.ri].pts.length;
  if (t < 0) return s.k > 0 || ENDCAP[s.ri][0] ? Math.hypot(x - s.ax, z - s.az) : Infinity;
  return s.k + 2 < nPts || ENDCAP[s.ri][1] ? Math.hypot(x - s.bx, z - s.bz) : Infinity;
}
function streetIntrusion(P) {
  const bb = bbox(P); let worst = null;
  const S = [];
  for (let k = 0; k < P.length; k++) {
    const a = P[k], c = P[(k + 1) % P.length], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.5));
    for (let m = 0; m < n; m++) S.push([a[0] + ((c[0] - a[0]) * m) / n, a[1] + ((c[1] - a[1]) * m) / n]);
  }
  segGrid.query([bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1], (i) => {
    const s = SEGS[i]; if (!'pstr'.includes(s.c)) return;
    for (const [x, z] of S) { const pen = s.fl - capDist(s, x, z); if (pen > 0.2 && (!worst || pen > worst.pen)) worst = { s, x, z, pen }; }   // 0,2: chừa 0,1 m cho làm tròn
    // phố đâm xuyên giữa nhà (không mẫu biên nào gần): kiểm điểm giữa đoạn
    if (!worst && pointInPoly(P, (s.ax + s.bx) / 2, (s.az + s.bz) / 2)) worst = { s, x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2, pen: s.fl };
  });
  return worst;
}
function streetGuard(b) {
  const A0 = b.area;
  for (let pass = 0; pass < 4; pass++) {
    const w = streetIntrusion(b.pts); if (!w) return true;
    const s = w.s, P = b.pts, [cx, cz] = centroid(P);
    const t = (w.x - s.ax) * s.ux + (w.z - s.az) * s.uz;
    let nx, nz, qx, qz;
    if (t >= 0 && t <= s.L) { const sg = (cx - s.ax) * s.nx + (cz - s.az) * s.nz >= 0 ? 1 : -1; nx = sg * s.nx; nz = sg * s.nz; qx = s.ax; qz = s.az; }
    else {
      [qx, qz] = t < 0 ? [s.ax, s.az] : [s.bx, s.bz];
      let dx = w.x - qx, dz = w.z - qz, L = Math.hypot(dx, dz);
      if (L < 0.3) { dx = cx - qx; dz = cz - qz; L = Math.hypot(dx, dz) || 1; }
      nx = dx / L; nz = dz / L;
    }
    const parts = clipHalf(P, nx, nz, nx * qx + nz * qz + s.fl).map((q) => outward(cleanPoly(q))).filter((q) => q.length >= 3);
    parts.sort((p, q) => absArea(q) - absArea(p));
    if (!parts.length || absArea(parts[0]) < Math.max(8, 0.5 * A0)) return false;
    setRectOrPoly(b, parts[0]); b.guard = 1;
  }
  return !streetIntrusion(b.pts);
}
// Camera pano: nhà SINH cách ≥ 3 m (SPEC), nhà thật ≥ 1 m (nới/kéo/nở không được trùm lên camera; nhà thật GỐC chứa
// camera mà cắt mất > 50% thì giữ nguyên — WP2 deadPano xử lý). Cắt nửa mặt phẳng vuông góc hướng camera → nhà.
function nearestOnPoly(P, x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length], dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)), qx = a[0] + dx * t, qz = a[1] + dz * t, d = Math.hypot(qx - x, qz - z);
    if (d < bd) { bd = d; best = [qx, qz]; }
  }
  return best;
}
function camGuard(b) {
  const need = (b.synth ? 3 : 1) + 0.1, P0 = b.pts, A0 = b.area, R0 = b.rect;   // +0,1 m cho làm tròn toạ độ
  for (let pass = 0; pass < 3; pass++) {
    const P = b.pts, bb = bbox(P); let hit = null;
    camGrid.query([bb[0] - need, bb[1] - need, bb[2] + need, bb[3] + need], (i) => {
      const [x, z] = PANO_CAM[i], inside = pointInPoly(P, x, z), d = inside ? -1 : polyEdgeDist(P, x, z);
      if (d < need - 0.05 && (!hit || d < hit.d)) hit = { x, z, d, inside };
    });
    if (!hit) return true;
    let [tx, tz] = hit.inside ? centroid(P) : nearestOnPoly(P, hit.x, hit.z);
    let L = Math.hypot(tx - hit.x, tz - hit.z);
    if (L < 0.05) { [tx, tz] = centroid(P); L = Math.hypot(tx - hit.x, tz - hit.z) || 1; }
    const nx = (tx - hit.x) / L, nz = (tz - hit.z) / L;
    const parts = clipHalf(P, nx, nz, nx * hit.x + nz * hit.z + need).map((q) => outward(cleanPoly(q))).filter((q) => q.length >= 3);
    parts.sort((p, q) => absArea(q) - absArea(p));
    if (!parts.length || absArea(parts[0]) < Math.max(8, 0.5 * A0)) {
      if (b.synth) return false;
      b.pts = P0; b.area = A0; b.rect = R0; return true;
    }
    setRectOrPoly(b, parts[0]); b.guard = 1;
  }
  return true;
}
{
  let nG = 0, nGD = 0, nC = 0, nCD = 0;
  for (const b of B) {
    const was = b.guard;
    if (!streetGuard(b)) { b.dead = 'street'; nGD++; continue; }
    if (b.guard && !was) nG++;
    const P1 = b.pts;
    if (!camGuard(b)) { b.dead = 'cam'; nCD++; continue; }
    if (b.pts !== P1) nC++;
    // nhà SINH cách địa danh ≥ 3 m (lưới mẫu 0,4 m / raster 0,5 m ở các bước trước để lọt vài nhà 2,9 m) → bỏ
    if (b.synth) {
      const bb = bbox(b.pts);
      if (LM_POLYS.some((o) => !(o.bb[0] > bb[2] + 3.1 || o.bb[2] < bb[0] - 3.1 || o.bb[1] > bb[3] + 3.1 || o.bb[3] < bb[1] - 3.1) && polyDist(b.pts, o.p) < 3.1)) { b.dead = 'lm'; stat('lm_guard_drop'); continue; }
    }
  }
  B = B.filter((b) => !b.dead);
  grid = rebuildGrid();
  ST.street_guard_clip = nG; ST.street_guard_drop = nGD; ST.cam_guard_clip = nC; ST.cam_guard_drop = nCD;
  lap(`chốt hành lang phố: cắt ${nG}, bỏ ${nGD}; camera pano: cắt ${nC}, bỏ ${nCD}`);
}
// 9d. KIỂM HỢP LỆ trên TOẠ ĐỘ ĐÃ LÀM TRÒN như file (đa giác: lưới 0,1 m; chữ nhật: x0/z0 0,1 m, góc u16, w/d cm — y hệt
//     encodeRB/decodeRB): làm tròn → bỏ đỉnh gai (2 cạnh kề quay ngược > 162°) → cleanPoly → đơn CHẶT (strictSimple),
//     tường-ra-ngoài, ≥ 6 m², bề hẹp nhất ≥ 1,2 m; hỏng → bỏ (drop_invalid). Kiểm trên số thực rồi làm tròn ở encode từng
//     để lọt 7 đa giác tự cắt (gai 1,7 m, vòng gập 8-10 cm). Các bước 10-12 (mặt tiền, tường chung) chạy trên toạ độ này.
{
  let nInv = 0;
  const q10 = (v) => Math.round(v * 10) / 10, TAU = 2 * Math.PI;
  for (const b of B) {
    if (b.rect) {
      const r = b.rect;
      let a = r.ang % TAU; if (a < 0) a += TAU;
      const ang = ((Math.round((a / TAU) * 65536) & 0xffff) * TAU) / 65536;
      const x0 = q10(r.x0), z0 = q10(r.z0), w = Math.round(r.w * 100) / 100, d = Math.round(r.d * 100) / 100;
      if (Math.min(w, d) < 1.2 || w * d < 6) { b.dead = 'invalid'; nInv++; stat('inv_rect'); continue; }   // mảnh vụn / lát mỏng (vách 0,5 m)
      const ca = Math.cos(ang), sa = Math.sin(ang);
      b.rect = { x0, z0, ang, w, d };
      b.pts = [[x0, z0], [x0 + w * ca, z0 + w * sa], [x0 + w * ca + d * sa, z0 + w * sa - d * ca], [x0 + d * sa, z0 - d * ca]];
      b.area = w * d;
      continue;
    }
    const P = outward(cleanPoly(despike(cleanPoly(b.pts.map(([x, z]) => [q10(x), q10(z)]), 0.05, 0.02)), 0.05, 0.02));
    const mr = P.length >= 3 ? minRect(P) : null;
    if (P.length < 3 || !strictSimple(P) || signedArea(P) >= 0 || absArea(P) < 6 || !mr || mr.d < 1.2) {
      stat(P.length < 3 ? 'inv_few' : !strictSimple(P) ? (isSimple(P) ? 'inv_spike_touch' : 'inv_cross') : absArea(P) < 6 ? 'inv_small' : 'inv_thin' + (b.synth ? '_syn' : b.parent ? '_piece' : '_raw'));
      b.dead = 'invalid'; nInv++; if (DUMP) INVDBG.push([b.id, b.src, b.synth ? 1 : 0, P]); continue;
    }
    b.pts = P; b.area = absArea(P);
  }
  B = B.filter((b) => !b.dead);
  grid = rebuildGrid();
  ST.drop_invalid = nInv;
  lap(`kiểm hợp lệ (toạ độ làm tròn): bỏ ${nInv}`);
}
// độ phủ THẬT cuối cùng (raster không nới — số nới 0,3 m ở bước 8 chỉ để đặt nhà an toàn, phóng đại độ phủ)
function exactCoverage(onlyReal) {
  for (let o = 0; o < RN * RN; o++) if (OCC[o] === 1 || OCC[o] === 4) OCC[o] = 0;
  for (const b of B) if (!onlyReal || !b.synth) fillPoly(b.pts, b.synth ? 4 : 1);
  for (const k of blocks) { k.nReal = 0; k.nSyn = 0; k.nFree = 0; }
  for (let o = 0; o < RN * RN; o++) {
    const l = LAB[o]; if (l < 0) continue; const k = blocks[l], v = OCC[o];
    if (v === 1) k.nReal++; else if (v === 4) k.nSyn++; else if (v === 0) k.nFree++;
  }
}
{ // độ phủ của footprint Overture gốc trên cùng lưới ô phố
  for (let o = 0; o < RN * RN; o++) if (OCC[o] === 1 || OCC[o] === 4) OCC[o] = 0;
  for (const P of RAW0) fillPoly(P, 1);
  let nb = 0, nf = 0;
  for (let o = 0; o < RN * RN; o++) { const l = LAB[o]; if (l < 0) continue; const k = blocks[l]; if (k.nReal + k.nSyn + k.nFree < 400) continue; if (OCC[o] === 1) nb++; else if (OCC[o] === 0) nf++; }
  ST.coverage_overture_raw = +(100 * nb / Math.max(1, nb + nf)).toFixed(1);
  console.log('  phủ mái ô phố (Overture gốc) %:', ST.coverage_overture_raw);
}
exactCoverage(false);
console.log('  phủ mái ô phố THẬT (cuối) %:', coverage('final'), '— trong đó nhà thật', ST.coverage_real_final + '%');

// ======================================================================================================
// 10. MẶT TIỀN THẬT + PANO: cạnh mặt phố cuối, ghép quan sát pano (tầng/màu/kiểu) vào nhà
// ======================================================================================================
// cạnh mặt phố (p/s/t/r/w) cách facadeLine ≤ 1,5 m; cạnh nhìn ra ngõ h (≤ 2,5 m sau mép ngõ) cũng là mặt tiền
function frontOfAny(P, k, self) {
  const f = frontOf(P, k, self, 1.5); if (f) return f;
  const a = P[k], c = P[(k + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1.2) return null;
  const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L, nx = -ez, nz = ex, mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let best = null;
  segGrid.query([mx - 8, mz - 8, mx + 8, mz + 8], (i) => {
    const s = SEGS[i]; if (s.c !== 'h') return;
    if (Math.abs(ex * s.ux + ez * s.uz) < 0.85) return;
    const [t, v] = segLocal(s, mx, mz); if (t < -0.05 || t > 1.05) return;
    const sg = v >= 0 ? 1 : -1; if (nx * sg * s.nx + nz * sg * s.nz > -0.85) return;
    const d = sg * v - s.fl; if (d < -0.8 || d > 2.5) return;
    if (!best || d < best.d) best = { s, sg, d };
  });
  return best;
}
for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi], P = b.pts;
  b.fronts = [];
  for (let k = 0; k < P.length; k++) { const f = frontOfAny(P, k, bi); if (f) b.fronts.push({ k, ...f }); }
  b.fronts.sort((p, q) => { const lp = Math.hypot(P[(p.k + 1) % P.length][0] - P[p.k][0], P[(p.k + 1) % P.length][1] - P[p.k][1]);
    const lq = Math.hypot(P[(q.k + 1) % P.length][0] - P[q.k][0], P[(q.k + 1) % P.length][1] - P[q.k][1]);
    const cr = (f) => 'pstrwh'.indexOf(f.s.c); return cr(p) - cr(q) || lq - lp; });
}
lap('mặt tiền cuối');
// quan sát pano → nhà: tia từ pano theo hướng la bàn, nhà đầu tiên chạm trong 2-36 m
const AUD = AUD0;
const OBS = [];   // {x,z (điểm chạm), floors, fr:[a,b]?, color, style, features, width, bi}
for (const p of AUD) {
  if (typeof p.X !== 'number') continue;
  for (const o of p.buildings || []) {
    // nhà tả "phía xa / ở xa / nền" KHÔNG phải nhà sát pano mà tia chạm đầu tiên → bỏ (từng gán 10-15 tầng cho nhà ống)
    if (/phía xa|ở xa|xa xa|nền xa|phía sau xa|đằng xa|xa hơn/.test(String(o.style || '').toLowerCase())) { stat('obs_far_skipped'); continue; }
    const h = ((+o.heading || 0) * Math.PI) / 180, dx = Math.sin(h), dz = -Math.cos(h);
    let hit = -1, hx = 0, hz = 0;
    for (let d = 2; d <= 26 && hit < 0; d += 0.5) { hx = p.X + dx * d; hz = p.Z + dz * d; hit = buildingAt(hx, hz); }   // nhà quan sát ~10-16 m
    const fl = +o.floors || 0;
    const m = String(o.style || '').match(/(\d+)\s*[-–]\s*(\d+)\s*tầng/);
    OBS.push({ px: p.X, pz: p.Z, x: hx, z: hz, floors: fl, fr: m ? [+m[1], +m[2]] : null, color: String(o.color || ''), style: String(o.style || ''),
      features: String(o.features || ''), width: +o.width_m || 0, bi: hit });
  }
}
const obsGrid = new Grid(40); OBS.forEach((o, i) => obsGrid.insert(i, [o.px, o.pz, o.px, o.pz]));
let nObsHit = 0;
for (const o of OBS) {
  if (o.bi < 0 || !o.floors || o.floors > 40) continue;
  const b = B[o.bi];
  // cao ốc (≥ 7 tầng) chỉ khớp nhà có footprint đủ lớn — nhà ống 4×15 m không thể là "tòa văn phòng 12 tầng"
  if (o.floors >= 7 && b.area < 250) { stat('obs_tall_small_skipped'); continue; }
  nObsHit++;
  (b.obs = b.obs || []).push(o);
  // dãy nhà (bề rộng quan sát ≥ 12 m): lan sang lô mặt phố cùng phía trong ±width/2 dọc phố
  if (o.width >= 12 && o.floors <= 6 && b.fronts.length) {   // (cao ốc ≥ 7 tầng là 1 công trình riêng, không lan sang lô bên)
    const f0 = b.fronts[0]; const F = frontFrame(f0); const [u0] = F.loc(o.x, o.z);
    grid.query([o.x - o.width, o.z - o.width, o.x + o.width, o.z + o.width], (j) => {
      if (j === o.bi) return; const q = B[j]; if (!q.fronts || !q.fronts.length || q.fronts[0].s !== f0.s || q.fronts[0].sg !== f0.sg) return;
      const [cx, cz] = centroid(q.pts); const [u] = F.loc(cx, cz);
      if (Math.abs(u - u0) <= o.width / 2) (q.obsRow = q.obsRow || []).push(o);
    });
  }
}
ST.obs = OBS.length; ST.obs_hit = nObsHit;
lap(`quan sát pano ghép vào nhà: ${nObsHit}/${OBS.length}`);

// ======================================================================================================
// 11. THUỘC TÍNH: kiểu, tầng, mái, màu tường, công năng tầng trệt
// ======================================================================================================
// phố cũ thời Pháp (nhà ống cũ cửa chớp, biệt thự) — ven các phố lõi lịch sử
const OLD_STREETS = ['Điện Biên Phủ', 'Hoàng Văn Thụ', 'Minh Khai', 'Lý Tự Trọng', 'Trần Hưng Đạo', 'Lê Đại Hành', 'Hoàng Diệu', 'Đinh Tiên Hoàng',
  'Trần Phú', 'Phan Bội Châu', 'Tam Bạc', 'Lãn Ông', 'Quang Trung', 'Ký Con', 'Nguyễn Tri Phương', 'Hoàng Ngân', 'Phan Chu Trinh', 'Hồ Xuân Hương',
  'Phạm Hồng Thái', 'Nguyễn Thái Học', 'Lý Thường Kiệt', 'Tôn Thất Thuyết', 'Trạng Trình', 'Kỳ Đồng', 'Phạm Bá Trực', 'Thất Khê', 'Phù Đổng', 'Cù Chính Lan'];
const oldSegs = new Grid(40); const OLDS = [];
try {
  for (const w of JSON.parse(fs.readFileSync(new URL('./osm_roads_dt.json', import.meta.url), 'utf8')).elements) {
    const nm = w.tags && w.tags.name; if (!nm || !w.geometry || !OLD_STREETS.some((s) => nm.includes(s))) continue;
    const P = w.geometry.map((g) => [(g.lon - LON0) * UX, -(g.lat - LAT0) * UZ]);
    for (let i = 0; i + 1 < P.length; i++) { OLDS.push([...P[i], ...P[i + 1]]); const s = OLDS[OLDS.length - 1]; oldSegs.insert(OLDS.length - 1, [Math.min(s[0], s[2]) - 1, Math.min(s[1], s[3]) - 1, Math.max(s[0], s[2]) + 1, Math.max(s[1], s[3]) + 1]); }
  }
} catch { console.log('  (không có tools/osm_roads_dt.json — bỏ vùng phố cũ)'); }
const OLD_BOX = [-1250, -960, 900, 330];
function oldQuarter(x, z) {
  if (x < OLD_BOX[0] || x > OLD_BOX[2] || z < OLD_BOX[1] || z > OLD_BOX[3]) return false;
  let h = false; oldSegs.query([x - 40, z - 40, x + 40, z + 40], (i) => { const s = OLDS[i]; if (!h && segDist(x, z, s[0], s[1], s[2], s[3]) < 40) h = true; });
  return h;
}
const FLOOR_W = [4.3, 29.7, 41, 16, 3.6, 2.2, 1.2, 0.8, 0.5, 0.4, 0.3];   // phân bố 1.133 quan sát pano (1..11 tầng)
const FLOOR_W_IN = [8, 38, 37, 12, 3, 1.2, 0.5, 0.3];                   // lõi ô (trong ngõ): thấp hơn chút
// màu tường từ chữ mô tả (bỏ đoạn tả biển hiệu/mái/bạt/kính)
const COLW = [
  [/vàng ố|vàng cũ|vàng đất|ố vàng|loang|bạc màu|rêu/, [23, 16, 21]], [/vàng nhạt|vàng kem|kem/, [0, 14, 6]], [/vàng/, [4, 5, 0]],
  [/trắng ngà|trắng kem/, [6, 17]], [/trắng/, [1, 17, 19]], [/xám|bê tông|ghi|xi măng/, [3, 13, 18, 29]],
  [/xanh ngọc|xanh lá|xanh nhạt|xanh rêu|xanh lơ/, [10, 7, 25]], [/xanh/, [11, 24]], [/hồng/, [9, 8, 26]], [/cam/, [20, 15, 27]],
  [/nâu|gạch|đỏ/, [21, 28]], [/be|beige/, [12, 16]],
];
function wallFromWords(txt, r) {
  for (const seg of txt.toLowerCase().split(/[,;/+()]| và | - |–/)) {
    if (/biển|mái|bạt|kính|cửa|chữ|đèn|ô dù/.test(seg)) continue;
    for (const [re, ids] of COLW) if (re.test(seg)) return ids[Math.floor(r * ids.length)];
  }
  return -1;
}
const WALL_BY_STYLE = {
  [STYLE.TUBE]: [[0, 9], [1, 10], [17, 6], [14, 6], [4, 5], [6, 5], [2, 4], [12, 4], [11, 4], [24, 2], [7, 3], [10, 3], [9, 3], [26, 1.5], [20, 2], [27, 1], [29, 3], [3, 3], [25, 1.5], [8, 2]],
  [STYLE.OLD]: [[23, 9], [4, 8], [5, 6], [0, 6], [16, 5], [15, 3], [14, 3], [21, 2], [3, 2], [12, 2], [10, 1], [9, 1]],
  [STYLE.VILLA]: [[4, 8], [5, 6], [0, 5], [23, 4], [15, 3], [17, 3], [6, 2], [9, 1]],
  [STYLE.KTT]: [[3, 6], [13, 5], [18, 4], [12, 4], [29, 5], [0, 3], [23, 3], [16, 2], [11, 2], [9, 1]],
  [STYLE.GLASS]: [[19, 5], [18, 4], [2, 4], [1, 4], [3, 3], [11, 2]],
  [STYLE.CIVIC]: [[4, 8], [0, 5], [14, 4], [5, 4], [1, 3], [23, 2], [9, 1]],
  [STYLE.SHED]: [[18, 5], [29, 5], [3, 4], [13, 4], [11, 3], [1, 2], [24, 1]],
};
const pickPair = (r, L) => L[pickW(r, L.map((p) => p[1]))][0];
// mái: [loại, trọng số] theo kiểu nhà; màu theo loại mái (hiệu chỉnh theo ảnh vệ tinh real_1..8: "biển" tôn đỏ gỉ +
// ngói/gạch lá nem đỏ cam + bê tông xám; tôn xanh rải rác)
const ROOF_BY_STYLE = {
  [STYLE.TUBE]: [[ROOF.FLAT_PARAPET, 50], [ROOF.GABLE_TON, 22], [ROOF.SHED_TON, 20], [ROOF.FLAT, 4], [ROOF.HIP_TILE, 4]],
  [STYLE.OLD]: [[ROOF.HIP_TILE, 30], [ROOF.FLAT_PARAPET, 35], [ROOF.GABLE_TON, 20], [ROOF.SHED_TON, 15]],
  [STYLE.VILLA]: [[ROOF.HIP_TILE, 80], [ROOF.FLAT_PARAPET, 20]],
  [STYLE.KTT]: [[ROOF.FLAT_PARAPET, 70], [ROOF.GABLE_TON, 20], [ROOF.FLAT, 10]],
  [STYLE.GLASS]: [[ROOF.FLAT_PARAPET, 85], [ROOF.FLAT, 15]],
  [STYLE.CIVIC]: [[ROOF.HIP_TILE, 45], [ROOF.FLAT_PARAPET, 45], [ROOF.GABLE_TON, 10]],
  [STYLE.SHED]: [[ROOF.GABLE_TON, 55], [ROOF.SHED_TON, 30], [ROOF.FLAT, 15]],
};
// Hiệu chỉnh THEO TỪNG NHÀ (scratch roofbld.py: trung vị pixel vệ tinh trong 8.885 footprint thật 30-600 m² của
// real_1/3/5/6/8, cân trắng gray-world): vệ tinh đỏ/nâu đỏ 29% · xám bê tông 46% · xám xanh đá (tôn xanh/bê tông
// bóng râm) 18% · sáng/trắng 2%. Bộ trọng số cũ cho đỏ 55% · sáng 19% · xám 20% → quá đỏ-cam và quá nhiều mái trắng.
// Giữ đỏ cao hơn số đo (~42%: mù khí làm đỏ gỉ trên ảnh ngả xám), mái bằng chủ yếu xám, tôn dốc đỏ gỉ + xám + xanh đá.
// Lượt review: lớp "sáng" (bảng màu 5/6/9: v ≥ 0,6, s < 0,14) còn 11% vs vệ tinh 2% → hạ trọng số 5/6 sang xám 13/15/7.
const ROOFC = {
  [ROOF.FLAT_PARAPET]: [[13, 18], [15, 15], [7, 12], [5, 2], [6, 1], [9, 1], [0, 5], [3, 5], [10, 6], [2, 1], [14, 2], [1, 1], [11, 3], [4, 2], [12, 4]],
  [ROOF.FLAT]: [[5, 1], [13, 6], [15, 4], [9, 1], [7, 3]],
  [ROOF.GABLE_TON]: [[0, 12], [3, 11], [10, 9], [1, 2], [14, 2], [11, 3], [4, 4], [12, 7], [13, 12], [7, 7], [15, 7], [5, 2], [6, 1], [8, 2]],
  [ROOF.SHED_TON]: [[0, 12], [3, 11], [10, 9], [1, 2], [14, 2], [11, 3], [4, 4], [12, 7], [13, 12], [7, 7], [15, 7], [5, 2], [6, 1], [8, 2]],
  [ROOF.HIP_TILE]: [[2, 5], [1, 6], [0, 5], [10, 6], [3, 5], [14, 4]],
};
// mái lớn (> 800 m²: trường, chợ, kho, khách sạn) — ảnh vệ tinh: chủ yếu bê tông xám / tôn bạc, ít đỏ
const ROOFC_BIG = [[5, 12], [6, 10], [9, 6], [13, 10], [15, 6], [4, 4], [12, 3], [0, 5], [10, 3]];
const CIV_TALL = new Set(['hotel', 'office', 'apartments', 'commercial']);
for (const b of B) {
  const R = rng(hash32(b.id + 'attr'));
  const [cx, cz] = centroid(b.pts);
  const old = oldQuarter(cx, cz);
  const party0 = b.fronts.length > 0;
  const obs = b.obs || b.obsRow || null;
  const ob = obs ? obs[0] : null;
  const ostyle = obs ? obs.map((o) => o.style).join(' ').toLowerCase() : '';                       // kiểu: chỉ chữ "style"
  const ouse = obs ? obs.map((o) => o.style + ' ' + o.features).join(' ').toLowerCase() : '';     // công năng: style + features
  // --- kiểu ---
  let style;
  const mr = b.mr || minRect(b.pts);
  if (/industrial|warehouse/.test(b.cls) || /kho|xưởng/i.test(b.name) || (portZone(cx, cz) && b.area > 250 && !b.lot) || (b.area > 2500 && !b.civic)) style = STYLE.SHED;
  else if (b.civic && !CIV_TALL.has(b.cls)) style = STYLE.CIVIC;
  else if (/apartments/.test(b.cls) || /tập thể|chung cư/.test(ostyle)) style = STYLE.KTT;
  else if (CIV_TALL.has(b.cls) || /cao ốc|văn phòng|khách sạn|ngân hàng|tòa nhà|toà nhà|mặt kính|ốp kính|vách kính/.test(ostyle)) style = STYLE.GLASS;
  else if (/biệt thự|villa/.test(ostyle)) style = STYLE.VILLA;
  else if (/công sở|trụ sở|cơ quan|trường|ủy ban|uỷ ban/.test(ostyle) && b.area > 150) style = STYLE.CIVIC;
  else if (/kho|xưởng/.test(ostyle) && b.area > 120) style = STYLE.SHED;
  else if (/pháp|cũ|cổ|thuộc địa/.test(ostyle)) style = STYLE.OLD;
  else if (!b.lot && !b.interior && b.area > 350 && b.area < 2500 && mr && mr.w / Math.max(1, mr.d) > 2.2 && mr.d > 8 && mr.d < 17) style = R() < 0.6 ? STYLE.KTT : STYLE.TUBE;
  else if (old) {
    const villaOK = !b.lot && !b.interior && b.area > 90 && b.area < 450 && mr && mr.w / Math.max(1, mr.d) < 1.8;
    style = villaOK && R() < 0.4 ? STYLE.VILLA : R() < 0.45 ? STYLE.OLD : STYLE.TUBE;
  } else style = !b.lot && !b.interior && b.area > 120 && b.area < 400 && mr && mr.w / Math.max(1, mr.d) < 1.5 && R() < 0.05 ? STYLE.VILLA
    : R() < (b.interior ? 0.12 : 0.15) ? STYLE.OLD : STYLE.TUBE;
  // --- tầng ---
  let floors = 0, fixed = false;
  if (b.nfl > 0) { floors = Math.round(b.nfl); fixed = true; }
  else if (b.hgt > 0) { floors = Math.max(1, Math.round((b.hgt - 0.6) / 3.3)); fixed = true; }
  else if (b.tallObs) { floors = b.tallObs; fixed = true; b.pano = 1; }
  else if (b.obs) {
    const o = b.obs[0];
    floors = o.fr ? o.fr[0] + Math.floor(R() * (o.fr[1] - o.fr[0] + 1)) : Math.round(b.obs.reduce((a, q) => a + q.floors, 0) / b.obs.length);
    fixed = true; b.pano = 1;
  } else if (b.obsRow) {
    const o = b.obsRow[0];
    floors = o.fr ? o.fr[0] + Math.floor(R() * (o.fr[1] - o.fr[0] + 1)) : Math.max(1, o.floors + (R() < 0.3 ? (R() < 0.5 ? -1 : 1) : 0));
    b.pano = 1;
  }
  if (!floors) {
    if (style === STYLE.SHED) floors = 1 + (R() < 0.3 ? 1 : 0);
    else if (style === STYLE.CIVIC) floors = 2 + Math.floor(R() * 3);
    else if (style === STYLE.KTT) floors = 4 + Math.floor(R() * 2);
    else if (b.area > 1200) floors = 4 + Math.floor(R() * 6);
    else if (b.area > 400 && !b.parent && !b.mass && b.src !== 'SYN' && mr && mr.w / Math.max(1, mr.d) < 1.7) floors = 3 + Math.floor(R() * 5);   // khối gọn lớn
    else {
      // phân bố địa phương: quan sát pano trong 80 m (≥ 4 quan sát) trộn 55% với phân bố chung
      const loc = new Array(12).fill(0); let nl = 0;
      obsGrid.query([cx - 80, cz - 80, cx + 80, cz + 80], (i) => { const o = OBS[i]; if (o.floors >= 1 && o.floors <= 6 && Math.hypot(o.px - cx, o.pz - cz) < 80) { loc[o.floors - 1]++; nl++; } });
      const base = b.interior ? FLOOR_W_IN : FLOOR_W;
      const sb = base.reduce((a, c) => a + c, 0);
      const w = new Array(12).fill(0).map((_, i) => (base[i] || 0) / sb * (nl >= 4 ? 0.45 : 1) + (nl >= 4 ? 0.55 * loc[i] / nl : 0));
      floors = 1 + pickW(R(), w);
      if (b.area < 25) floors = Math.min(floors, 2);
      // không bằng chứng: nhà "kim" 7-11 tầng trên nền < 100 m² giữa ô phố là nhiễu (pano chỉ thấy loại này ở mặt phố
      // lớn — nhà nghỉ/khách sạn mini) → lõi ô/ngõ ≤ 6 tầng; lô mặt phố p/s giữ đuôi 7-8 tầng của phân bố
      const fc = b.fronts[0] ? b.fronts[0].s.c : '';
      floors = Math.min(floors, (fc === 'p' || fc === 's') && b.area >= 45 ? 8 : 6);
      // "đuôi" 6-8 tầng (nhà nghỉ/khách sạn mini, nhà ống xây mới) trên mặt phố p/s/t: GIỮ khi làm trơn (không kéo
      // xuống còn láng giềng+2) — không thì mặt phố mất hết điểm nhô cao (đo: lô mặt phố 6+ tầng 1,3% vs pano 5,4%)
      if (floors >= 6 && (fc === 'p' || fc === 's' || fc === 't')) b.spike = 1;
    }
  }
  if (style === STYLE.GLASS && floors < 4 && !fixed) floors = 4 + Math.floor(R() * 4);
  if (b.synth) floors = Math.min(floors, b.interior ? 5 : 7);   // nhà SINH không bao giờ là cao ốc (cao ốc thật có footprint thật)
  if (b.shallow) floors = Math.min(floors, 3);                   // khối cơi nới nông trước nhà lùi: 1-3 tầng
  if (style === STYLE.VILLA) floors = Math.min(floors, 3);
  b.floors = Math.max(1, Math.min(40, floors)); b.fixed = fixed; b.style = style;
  // --- mái ---
  let rt = ROOF_BY_STYLE[style][pickW(R(), ROOF_BY_STYLE[style].map((p) => p[1]))][0];
  if (b.floors >= 7 && rt !== ROOF.FLAT) rt = ROOF.FLAT_PARAPET;
  if ((rt === ROOF.GABLE_TON || rt === ROOF.HIP_TILE) && mr && mr.d > 28) rt = ROOF.FLAT_PARAPET;   // mái dốc nhịp quá lớn → bằng
  b.roofType = rt; b.roofColor = pickPair(R(), b.area > 800 && rt !== ROOF.HIP_TILE ? ROOFC_BIG : ROOFC[rt]);
  // --- màu tường ---
  let wall = ob ? wallFromWords(obs.map((o) => o.color).join(', '), R()) : -1;
  if (wall < 0) wall = pickPair(R(), WALL_BY_STYLE[style]);
  b.wall = wall;
  // --- công năng tầng trệt ---
  const f0 = b.fronts[0];
  let use = INFO.USE_HOME;
  if (style === STYLE.GLASS) use = INFO.USE_OFFICE;
  else if (style === STYLE.CIVIC || style === STYLE.SHED || (style === STYLE.VILLA && R() < 0.6)) use = INFO.USE_GATE;
  else if (/cửa hàng|shop|bán|quán|kinh doanh|biển|cửa cuốn|nhà hàng|cà phê|spa|showroom/.test(ouse)) use = INFO.USE_SHOP;
  else if (f0) use = R() < ({ p: 0.88, s: 0.82, t: 0.72, r: 0.5, w: 0.6, h: 0.15 }[f0.s.c] ?? 0.3) ? INFO.USE_SHOP : INFO.USE_HOME;
  const roads = new Set(b.fronts.filter((f) => f.s.c !== 'h').map((f) => f.s.ri));
  b.info = (f0 ? ROADC.indexOf(f0.s.c) : 0) | (roads.size >= 2 ? INFO.CORNER : 0) | (use << INFO.USE_SHIFT);
  b.party0 = party0;
}
// làm trơn ±2 tầng giữa nhà sát nhau (không đụng nhà có số tầng chắc chắn: OSM/pano trực tiếp)
for (let pass = 0; pass < 2; pass++) for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi]; if (b.fixed || b.shallow || b.style === STYLE.SHED || b.area > 1200) continue;
  let lo = -Infinity, hi = Infinity;
  grid.query([b.bb[0] - 0.8, b.bb[1] - 0.8, b.bb[2] + 0.8, b.bb[3] + 0.8], (j) => {
    if (j === bi) return; const o = B[j];
    // cao ốc/khối lớn cạnh dãy nhà ống không kéo dãy đó lên (từng sinh nhà "kim" 11 tầng sát khách sạn 13 tầng)
    if (o.area > 400 || o.floors >= 7 || o.spike || o.style === STYLE.SHED || o.style === STYLE.CIVIC || o.style === STYLE.GLASS) return;
    lo = Math.max(lo, o.floors - 2); hi = Math.min(hi, o.floors + 2);
  });
  if (lo > hi) continue;
  if (b.floors < lo) b.floors = lo; else if (b.floors > hi && !b.spike) b.floors = hi;
}
lap('thuộc tính');

// ======================================================================================================
// 12. LOẠI CẠNH: TƯỜNG CHUNG (song song, ≤ 0,8 m, phủ gần trọn cạnh) → PARTY + edgeCover = tầng thấp nhất của nhà che;
//     mặt phố → FRONT; ngược hướng mặt tiền chính → BACK; còn lại SIDE
// ======================================================================================================
let nParty = 0, nFrontE = 0, nBackE = 0, nSideE = 0;
for (let bi = 0; bi < B.length; bi++) {
  const b = B[bi], P = b.pts, n = P.length;
  b.edge = new Array(n).fill(EDGE.SIDE); b.cover = new Array(n).fill(0);
  const nbs = []; grid.query([b.bb[0] - 0.9, b.bb[1] - 0.9, b.bb[2] + 0.9, b.bb[3] + 0.9], (j) => { if (j !== bi) nbs.push(j); });
  const fset = new Map(b.fronts.map((f) => [f.k, f]));
  const fn = b.fronts[0] ? [b.fronts[0].sg * b.fronts[0].s.nx, b.fronts[0].sg * b.fronts[0].s.nz] : null;   // pháp tuyến VÀO ô của mặt tiền chính
  for (let k = 0; k < n; k++) {
    const a = P[k], c = P[(k + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.05) continue;
    const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L, nx = -ez, nz = ex;
    // khoảng phủ trên cạnh [0, L]
    const iv = []; let minF = Infinity;
    for (const j of nbs) {
      const Q = B[j].pts;
      for (let m = 0; m < Q.length; m++) {
        const p = Q[m], q = Q[(m + 1) % Q.length], Lq = Math.hypot(q[0] - p[0], q[1] - p[1]); if (Lq < 0.3) continue;
        const qx = (q[0] - p[0]) / Lq, qz = (q[1] - p[1]) / Lq;
        if (qx * ex + qz * ez > -0.985) continue;   // song song NGƯỢC chiều (2 nhà kề nhau)
        const dp = (p[0] - a[0]) * nx + (p[1] - a[1]) * nz, dq = (q[0] - a[0]) * nx + (q[1] - a[1]) * nz;
        if (dp < -0.25 || dq < -0.25 || dp > 0.15 || dq > 0.15) continue;   // cạnh láng giềng sát (đã khép khe ở 9b), cách ≤ 15 cm
        let t0 = (p[0] - a[0]) * ex + (p[1] - a[1]) * ez, t1 = (q[0] - a[0]) * ex + (q[1] - a[1]) * ez;
        if (t0 > t1) [t0, t1] = [t1, t0];
        t0 = Math.max(0, t0); t1 = Math.min(L, t1);
        if (t1 - t0 > 0.3) { iv.push([t0, t1]); minF = Math.min(minF, B[j].floors); }
      }
    }
    if (iv.length) {
      iv.sort((p, q) => p[0] - q[0]);
      let cov = 0, cur = null;
      for (const v of iv) { if (!cur || v[0] > cur[1]) { if (cur) cov += cur[1] - cur[0]; cur = v.slice(); } else cur[1] = Math.max(cur[1], v[1]); }
      if (cur) cov += cur[1] - cur[0];
      if (L - cov <= 0.6) { b.edge[k] = EDGE.PARTY; b.cover[k] = minF; nParty++; continue; }
    }
    if (fset.has(k)) { b.edge[k] = EDGE.FRONT; nFrontE++; continue; }
    if (fn && nx * fn[0] + nz * fn[1] > 0.7) { b.edge[k] = EDGE.BACK; nBackE++; continue; }   // ngoài-pháp-tuyến cùng chiều "vào ô" = mặt sau
    nSideE++;
  }
}
ST.edges = { party: nParty, front: nFrontE, back: nBackE, side: nSideE };
lap('loại cạnh');

// ======================================================================================================
// 13. GHI + THỐNG KÊ
// ======================================================================================================
const out = [];
for (const b of B) {
  const flags = (b.src === 'OSM' ? FLAG.OSM : b.src === 'GG' ? FLAG.GOOGLE : b.src === 'MS' ? FLAG.MS : 0) | (b.synth ? FLAG.SYNTH : 0) |
    (b.lot ? FLAG.LOT : 0) | (b.area > 800 ? FLAG.BIG : 0) | (b.pano ? FLAG.PANO : 0) |
    // EDIT: mọi mảnh tách từ footprint gốc (b.parent: lô, khối sau, ô lưới khối dính) cũng là hình học đã sửa
    (!b.synth && (b.parent || b.clipped || b.snapped || b.lot || b.deep || b.cut || b.squared || b.grown || b.grown2 || b.notch || b.closed || b.ovcut || b.guard) ? FLAG.EDIT : 0);
  out.push({ pts: b.pts, rect: b.rect || null, edge: b.edge, cover: b.cover, floors: b.floors, style: b.style, wall: b.wall,
    roofType: b.roofType, roofColor: b.roofColor, flags, info: b.info, seed: hash32(b.id + 's') & 0xffff });
}
// ổn định thứ tự: theo ô 64 m rồi id → nhà gần nhau nằm gần nhau trong mảng (WP2 dựng theo ô)
const key = (b) => { const [cx, cz] = centroid(b.pts); return (Math.floor((cz + 2000) / 64) * 100 + Math.floor((cx + 2000) / 64)); };
const order2 = out.map((o, i) => [key(o), B[i].id, i]).sort((p, q) => p[0] - q[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0)).map((p) => p[2]);
const outS = order2.map((i) => out[i]);
const bytes = encodeRB(outS);
const b64 = Buffer.from(bytes).toString('base64');
// KIỂM SAU ENCODE: giải mã lại đúng byte sẽ ghi → mọi nhà phải đơn chặt, tường-ra-ngoài, ≥ 5,9 m²; hỏng thì DỪNG, không ghi file
{
  const D = decodeRB(bytes), bad = [];
  for (let b = 0; b < D.nB; b++) {
    const P = []; for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) P.push([D.x[v], D.z[v]]);
    if (!strictSimple(P) || signedArea(P) >= 0 || absArea(P) < 5.9) bad.push([b, b < D.nPoly ? 'poly' : 'rect', JSON.stringify(P.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]))]);
  }
  if (bad.length) { console.error('LỖI: ' + bad.length + ' footprint hỏng sau encode/decode:'); for (const r of bad.slice(0, 20)) console.error('  ', ...r); process.exit(1); }
  ST.decode_check = 'ok ' + D.nB;
}
// thống kê
const cnt = (f) => { const m = {}; for (const o of outS) { const k = f(o); m[k] = (m[k] || 0) + 1; } return m; };
ST.count = outS.length; ST.rects = outS.filter((o) => o.rect).length;   // số cuối (sau các bước bỏ/cắt 9c-9d)
ST.by_src = cnt((o) => (o.flags & FLAG.SYNTH ? (o.flags & FLAG.LOT ? 'syn_gap' : 'syn_interior') : (o.flags & FLAG.OSM ? 'osm' : o.flags & FLAG.GOOGLE ? 'google' : 'ms') + (o.flags & FLAG.LOT ? '_lot' : '')));
ST.by_style = cnt((o) => Object.keys(STYLE).find((k) => STYLE[k] === o.style));
ST.by_floors = cnt((o) => (o.floors >= 7 ? '7+' : o.floors));
ST.by_roof = cnt((o) => Object.keys(ROOF).find((k) => ROOF[k] === o.roofType));
ST.by_use = cnt((o) => ['home', 'shop', 'office', 'gate'][(o.info >> 4) & 3]);
ST.pano_tagged = outS.filter((o) => o.flags & FLAG.PANO).length;
ST.mean_floors = +(outS.reduce((a, o) => a + o.floors, 0) / outS.length).toFixed(2);
const meta = { version: 2, generator: 'process_buildings.mjs v1', count: outS.length, rMax: R_MAX, rSyn: R_SYN, stats: ST };
fs.writeFileSync(new URL('../js/buildings_real.js', import.meta.url),
  '// SINH TỰ ĐỘNG bởi tools/process_buildings.mjs — ĐỪNG SỬA TAY. Định dạng RB01 (+ mục chữ nhật RBR1): xem js/buildings_data.js.\n' +
  '// Nguồn: Overture Maps buildings (OpenStreetMap ODbL; Google Open Buildings CC BY 4.0/ODbL; Microsoft ML Buildings ODbL)\n' +
  '// + nhà SINH (FLAG.SYNTH) lấp khe mặt phố / lõi ô phố theo bằng chứng footprint thật + pano.\n' +
  `export const RB_META = ${JSON.stringify(meta)};\n` +
  `export const RB_B64 = "${b64}";\n`);
if (DUMP) fs.writeFileSync(DUMP.replace(/\.json$/, '_gap.json'), JSON.stringify(GAPDBG));
if (DUMP) fs.writeFileSync(DUMP.replace(/\.json$/, '_front.json'), JSON.stringify(FRONTDBG));
if (DUMP) fs.writeFileSync(DUMP.replace(/\.json$/, '_panoveto.json'), JSON.stringify(PANOVETO));
if (DUMP) fs.writeFileSync(DUMP.replace(/\.json$/, '_intdbg.json'), JSON.stringify(INTDBG));
if (DUMP) fs.writeFileSync(DUMP.replace(/\.json$/, '_inv.json'), JSON.stringify(INVDBG));
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(outS.map((o) => ({ p: o.pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]), f: o.flags, rc: o.roofColor, rt: o.roofType,
  e: o.edge, fl: o.floors, st: o.style, w: o.wall, i: o.info }))));
console.log(JSON.stringify(ST));
console.log('nhà', outS.length, 'chữ nhật', outS.filter((o) => o.rect).length, 'bytes', bytes.length, 'b64', b64.length, ((Date.now() - T0) / 1000).toFixed(1) + 's');
