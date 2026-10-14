// Xử lý dữ liệu OSM Hải Phòng -> js/mapdata.js
// Phép chiếu: 1:1 MÉT THẬT — không thu nhỏ, không kính lúp (yêu cầu 2026-07-05)
import fs from 'fs';

const LON0 = 106.68182, LAT0 = 20.85750; // Nhà hát lớn THẬT (OSM way/242055606) = gốc
const UX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const UZ = 110574;

// ---- Warp xuyên tâm: r' = ∫ s(r) dr, s = 1 + (k-1)(1 - smoothstep(a,b,r)) ----
const K = 2.2, WA = 260, WB = 1000;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TABLE_STEP = 2, TABLE_MAX = 7000;
const rTable = [0];
for (let r = TABLE_STEP; r <= TABLE_MAX; r += TABLE_STEP) {
  const s = 1 + (K - 1) * (1 - sm(WA, WB, r - TABLE_STEP / 2));
  rTable.push(rTable[rTable.length - 1] + s * TABLE_STEP);
}
function warpR(r) {
  const i = Math.min(rTable.length - 2, r / TABLE_STEP);
  const i0 = Math.floor(i);
  return rTable[i0] + (rTable[i0 + 1] - rTable[i0]) * (i - i0);
}
function toXZ(lon, lat) {
  // 1:1 — không warp
  return [(lon - LON0) * UX, -(lat - LAT0) * UZ];
}
// chia nhỏ đoạn dài trước khi warp (warp làm cong đường thẳng)
function subdiv(geo, step = 50) {
  const out = [];
  for (let i = 0; i < geo.length; i++) {
    out.push([geo[i].lon, geo[i].lat]);
    if (i < geo.length - 1) {
      const dx = (geo[i + 1].lon - geo[i].lon) * UX, dz = (geo[i + 1].lat - geo[i].lat) * UZ;
      const n = Math.floor(Math.hypot(dx, dz) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([geo[i].lon + (geo[i + 1].lon - geo[i].lon) * t, geo[i].lat + (geo[i + 1].lat - geo[i].lat) * t]);
      }
    }
  }
  return out.map(([lon, lat]) => toXZ(lon, lat));
}

// Biên thế giới phải nằm TRONG vùng dữ liệu bờ biển đã warp (tránh flood lách qua rìa không có tường)
const WORLD = { minX: -6900, maxX: 48000, minZ: -6800, maxZ: 24800 };
const CELL = 40;
const MW = Math.ceil((WORLD.maxX - WORLD.minX) / CELL);
const MH = Math.ceil((WORLD.maxZ - WORLD.minZ) / CELL);

const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).elements;

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, z1] = pts[a], [x2, z2] = pts[b];
    const dx = x2 - x1, dz = z2 - z1, len2 = dx * dx + dz * dz;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - x1, pz - z1);
      else {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
        d = Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const rnd = (pts) => pts.map(([x, z]) => [Math.round(x), Math.round(z)]);
const plLen = (pts) => { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; };

// ---------- 1. Lưới đất/biển ----------
const coast = load('osm_coast.json');
const cellOf = (x, z) => {
  const cx = Math.floor((x - WORLD.minX) / CELL), cz = Math.floor((z - WORLD.minZ) / CELL);
  return (cx >= 0 && cx < MW && cz >= 0 && cz < MH) ? cz * MW + cx : -1;
};
// Gom mọi đoạn bờ biển (đã warp, chia nhỏ ~20u) vào lưới bucket 96u
const segs = []; // [ax, az, bx, bz]
for (const w of coast) {
  if (!w.geometry) continue;
  const pts = subdiv(w.geometry, 100);
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
}
const BK = 900;
const BW = Math.ceil((WORLD.maxX - WORLD.minX) / BK), BH = Math.ceil((WORLD.maxZ - WORLD.minZ) / BK);
const buckets = Array.from({ length: BW * BH }, () => []);
for (let si = 0; si < segs.length; si++) {
  const [ax, az, bx, bz] = segs[si];
  const cx1 = Math.max(0, Math.floor((Math.min(ax, bx) - WORLD.minX) / BK));
  const cx2 = Math.min(BW - 1, Math.floor((Math.max(ax, bx) - WORLD.minX) / BK));
  const cz1 = Math.max(0, Math.floor((Math.min(az, bz) - WORLD.minZ) / BK));
  const cz2 = Math.min(BH - 1, Math.floor((Math.max(az, bz) - WORLD.minZ) / BK));
  for (let cz = cz1; cz <= cz2; cz++) for (let cx = cx1; cx <= cx2; cx++) buckets[cz * BW + cx].push(si);
}
// Phân loại từng ô bằng RAY CASTING chẵn/lẻ: bắn tia tới điểm chắc chắn là BIỂN
// (góc đông nam xa), đếm số lần cắt bờ biển. Lẻ = đất. Không phụ thuộc hướng vẽ OSM.
const segStamp = new Int32Array(segs.length).fill(-1);
let queryId = 0;
function countCrossings(px, pz, tx, tz) {
  queryId++;
  let crossings = 0;
  // DDA qua lưới bucket dọc theo tia
  const dirX = tx - px, dirZ = tz - pz;
  const steps = Math.ceil(Math.hypot(dirX, dirZ) / (BK * 0.5));
  let pbx = -9, pbz = -9;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = px + dirX * t, z = pz + dirZ * t;
    const bx = Math.floor((x - WORLD.minX) / BK), bz = Math.floor((z - WORLD.minZ) / BK);
    if (bx === pbx && bz === pbz) continue;
    pbx = bx; pbz = bz;
    // xét bucket này + 8 lân cận (an toàn với đoạn nằm sát mép bucket)
    for (let dz2 = -1; dz2 <= 1; dz2++) {
      for (let dx2 = -1; dx2 <= 1; dx2++) {
        const nbx = bx + dx2, nbz = bz + dz2;
        if (nbx < 0 || nbx >= BW || nbz < 0 || nbz >= BH) continue;
        for (const si of buckets[nbz * BW + nbx]) {
          if (segStamp[si] === queryId) continue;
          segStamp[si] = queryId;
          const [ax, az, bx3, bz3] = segs[si];
          // giao điểm đoạn (a,b) với tia (p -> t)
          const d1x = bx3 - ax, d1z = bz3 - az;
          const denom = d1x * dirZ - d1z * dirX;
          if (Math.abs(denom) < 1e-12) continue;
          const u = ((px - ax) * dirZ - (pz - az) * dirX) / denom;   // dọc đoạn bờ
          const v = ((px - ax) * d1z - (pz - az) * d1x) / denom;     // dọc tia
          if (u >= 0 && u < 1 && v > 0 && v <= 1) crossings++;
        }
      }
    }
  }
  return crossings;
}
const SEA_TX = WORLD.maxX + 9000, SEA_TZ = WORLD.maxZ + 7000; // ngoài khơi đông nam
const land = new Uint8Array(MW * MH);
for (let cz = 0; cz < MH; cz++) {
  for (let cx = 0; cx < MW; cx++) {
    const px = WORLD.minX + (cx + 0.5) * CELL, pz = WORLD.minZ + (cz + 0.5) * CELL;
    // lắc nhẹ đích tia theo ô để tránh đi trúng khớp nối đoạn
    const j = ((cx * 7 + cz * 13) % 11 - 5) * 300;
    land[cz * MW + cx] = countCrossings(px, pz, SEA_TX + j, SEA_TZ - j) % 2;
  }
}
// lọc đa số 3x3 (khử nhiễu lẻ ô do tia sượt khớp nối)
const land2 = new Uint8Array(land);
for (let cz = 1; cz < MH - 1; cz++) {
  for (let cx = 1; cx < MW - 1; cx++) {
    let sum = 0;
    for (let dz2 = -1; dz2 <= 1; dz2++) for (let dx2 = -1; dx2 <= 1; dx2++) sum += land[(cz + dz2) * MW + cx + dx2];
    land2[cz * MW + cx] = sum >= 5 ? 1 : 0;
  }
}
land.set(land2);
const grid = land.map((v) => (v ? 3 : 0)); // cho ảnh debug
// vá đảo Hòn Dấu (đảo nhỏ, tường bờ có thể hở ở lưới thô)
function stampLand(lon, lat, radius) {
  const [x0, z0] = toXZ(lon, lat);
  for (let dx = -radius; dx <= radius; dx += CELL / 2) {
    for (let dz = -radius; dz <= radius; dz += CELL / 2) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const id = cellOf(x0 + dx, z0 + dz);
      if (id >= 0) land[id] = 1;
    }
  }
}
stampLand(106.8125, 20.6667, 300);
const check = (lon, lat, want, name) => {
  const [x, z] = toXZ(lon, lat).map(Math.round);
  const v = land[cellOf(x, z)];
  console.log(`check ${name}: (${x},${z}) land=${v} ${v === want ? 'OK' : '*** SAI ***'}`);
};
check(106.6835, 20.8608, 1, 'Nhà hát lớn');
check(107.048, 20.727, 1, 'Cát Bà town');
check(107.02, 20.78, 0, 'vịnh (bắc Cát Bà)');
check(107.09, 20.72, 0, 'vịnh Lan Hạ');
check(106.813, 20.667, 1, 'Hòn Dấu');
check(106.782, 20.708, 1, 'Đồ Sơn');
check(106.90, 20.75, 0, 'biển nam Đình Vũ');
check(107.03, 20.72, 1, 'đảo Cát Bà giữa');
// ảnh debug
{
  const { writePNG } = await import('./debugmask.mjs');
  const rgb = Buffer.alloc(MW * MH * 3);
  for (let i = 0; i < grid.length; i++) {
    const o = i * 3;
    if (grid[i] === 2) { rgb[o] = 220; rgb[o + 1] = 40; rgb[o + 2] = 40; }
    else if (grid[i] === 3) { rgb[o] = 60; rgb[o + 1] = 170; rgb[o + 2] = 70; }
    else { rgb[o] = 40; rgb[o + 1] = 90; rgb[o + 2] = 180; }
  }
  writePNG('mask_debug.png', MW, MH, rgb);
}
const packed = new Uint8Array(Math.ceil(MW * MH / 8));
for (let i = 0; i < land.length; i++) if (land[i]) packed[i >> 3] |= 1 << (i & 7);
const maskB64 = Buffer.from(packed).toString('base64');
console.log(`mask: ${MW}x${MH} (${(maskB64.length / 1024).toFixed(0)}KB b64), land=${(land.reduce((a, b) => a + b, 0) / land.length * 100).toFixed(0)}%`);

// ---------- 2. Sông ----------
const riverWays = load('osm_rivers.json');
const RIVERS = [];
for (const w of riverWays) {
  const name = (w.tags && (w.tags.name || '')) || '';
  let width = 0;
  if (/Cấm/i.test(name)) width = 620;
  else if (/Tam Bạc/i.test(name)) width = 55;
  else if (/Lạch Tray/i.test(name)) width = 300;
  else continue;
  if (!w.geometry) continue;
  const sim = rnd(simplify(subdiv(w.geometry, 300), 30)).filter(([x, z]) =>
    x > WORLD.minX && x < WORLD.maxX && z > WORLD.minZ && z < WORLD.maxZ);
  if (sim.length >= 2) RIVERS.push({ w: width, pts: sim });
}
console.log(`rivers: ${RIVERS.length} đoạn`);

// ---------- 3. Phố trung tâm ----------
const CLS = { trunk: 'p', primary: 'p', secondary: 's', tertiary: 't', residential: 'r', living_street: 'r', unclassified: 'r', pedestrian: 'w' };
// Lõi trung tâm: GIỮ mọi phố nhỏ (kể cả residential ngắn) để không thiếu đường ngang sau các công trình.
const isCentralRoad = (pts) => pts.some(([x, z]) => Math.hypot(x, z - 9) < 1600);
const dtRoads = load('osm_roads_dt.json');
const ROADS_DT = [];
// ROADS_LEGACY = hình học CŨ (simplify 6 m) CHỈ để tính mặt tiền địa danh LM_FACE (nearestRoadFace) — giữ hướng địa danh
// đã căn tay không đổi khi ROADS_DT được làm mịn + dịch tim (Đợt 3 W3-A). Cùng bộ lọc → cùng thứ tự/chỉ số.
const ROADS_LEGACY = [];
for (const w of dtRoads) {
  const c = CLS[w.tags?.highway];
  if (!c || !w.geometry) continue;
  const pts0 = rnd(simplify(subdiv(w.geometry, 150), 6));
  if (pts0.length < 2) continue;
  const len = plLen(pts0);
  if (c === 'r' && len < 260 && !isCentralRoad(pts0)) continue;   // giữ phố nhỏ trong lõi
  if (c === 'w' && len < 150) continue;
  // Đợt 3 W3-A: simplify 6 → 3 m (phố cong như Tam Bạc/Bến Bính lệch tới 5 m khỏi OSM gốc; +18% đỉnh). Bộ lọc độ dài
  // vẫn tính trên bản 6 m ở trên → TẬP way + THỨ TỰ ROADS_DT giữ nguyên (SIDEWALK_BY_ROAD… khoá theo chỉ số).
  const pts = rnd(simplify(subdiv(w.geometry, 150), 3));
  ROADS_DT.push({ c, pts, name: w.tags?.name || '', id: w.id, tags: w.tags || {} });   // id/tags: chỉ dùng nội bộ (BRIDGE_WAYS, bờ kè, street_fit) — KHÔNG xuất
  ROADS_LEGACY.push({ c, pts: pts0, name: w.tags?.name || '' });
}
console.log(`roads downtown: ${ROADS_DT.length}`);

// ---------- 3b. NGÕ/HẺM lõi (osm_alleys.json: highway=service/alley/footway/track/path) ----------
// Class 'h': render mảnh 3m + chia block cho thảm nhà ống (fetch riêng — query roads_dt cũ lọc mất).
try {
  const alleyWays = load('osm_alleys.json');
  let nH = 0;
  for (const w of alleyWays) {
    if (!w.tags?.highway || !w.geometry) continue;
    if (w.tags.highway === 'footway' || w.tags.highway === 'path') continue;  // lối công viên — nhiều điểm, ít giá trị block
    const pts = rnd(simplify(subdiv(w.geometry, 150), 5));
    if (pts.length < 2) continue;
    if (!isCentralRoad(pts)) continue;          // giai đoạn trung tâm: chỉ giữ hẻm trong lõi
    if (plLen(pts) < 28) continue;              // mẩu vụn (lối rẽ vào 1 nhà) bỏ
    ROADS_DT.push({ c: 'h', pts, name: '', id: w.id, tags: w.tags || {} });
    ROADS_LEGACY.push({ c: 'h', pts, name: '' });
    nH++;
  }
  console.log(`ngõ/hẻm lõi (h): ${nH}`);
} catch (e) { console.log('(không có osm_alleys.json — bỏ qua hẻm)'); }

// ---------- 3b2. TÁCH WAY theo mặt cắt thật (Đ3-W5-D sửa phản biện) ----------
// Bề rộng street_fit là MỘT giá trị mỗi way. Way 962470755 'Phố Tam Bạc' chạy từ ngõ ven sông 5,5 m (331-520) tới tận
// đầu nút 221 (Nguyễn Tri Phương, lòng thật ~7 m + dải dạo lát + lan can — ảnh 221 h0/h180): ghi đè ngõ 5,5 m kéo tới nút
// → mép lòng cắt chéo dải dạo, lan can lùi xa (review 221 h180). Tách tại z = −590 (cùng ranh 'dải bờ tự phát'/'prom' của
// §6b3): phần BẮC giữ chỉ số cũ, khúc NAM nối vào CUỐI ROADS_DT (sau ngõ h) ⇒ chỉ số mọi way cũ KHÔNG đổi (SIDEWALK_BY_ROAD…
// khoá theo chỉ số); khúc nam theo bề rộng thường (Overture/cấp — như dot3) vì 221 không nằm trong ghi đè ngõ hẹp.
// 2026-10-15 (sửa hồi quy 382): way 1208204466 — nửa một chiều KHÔNG TÊN 'secondary' chạy từ ngõ Tam Bạc (383/384, nút −536,
// −904) SONG SONG Bến Bính tới x −228 — là way gần nhất của camera 383/384 nên nhận NGUYÊN ghi đè ngõ 5,5 m (street_fit
// WIDTH_OVERRIDES `panos`) cả đoạn Bến Bính ⇒ 382 lộ vỉa hè gạch + hàng cây giữa 2 đường nơi ảnh là bãi đất. Tách theo HOÀNH ĐỘ
// x −401 (ngay đông nút 576/588 ở (−412, −950)): đoạn ĐÔNG (Bến Bính, đầu way) giữ chỉ số cũ ri 447 + bề rộng cấp như dot3; đoạn
// TÂY (ngõ 383/384) nối cuối ROADS_DT (ri 1426, sau khúc nam 962470755) và vẫn là way gần nhất của 383/384 ⇒ giữ ngõ 5,5 m.
// { id, z } cắt theo tung độ, { id, x } theo hoành độ; phần ĐẦU way (P[0]…) giữ chỉ số, phần sau nối cuối (mang `sp` = chỉ số
// way gốc, xuất ra mapdata — roadnet gộp NHÃN VẠCH ảnh của 2 nửa: 382 Bến Bính mất nhãn 'không vạch tim' của 384 khi tách →
// vạch mép trắng trên bãi đất). THỨ TỰ mảng = thứ tự chỉ số nối thêm — chỉ được THÊM ở cuối.
const SPLIT_WAYS = [{ id: 962470755, z: -590 }, { id: 1208204466, x: -401 }];
for (const S of SPLIT_WAYS) {
  const ri = ROADS_DT.findIndex((r) => r.id === S.id); if (ri < 0) { console.log(`  tách way ${S.id}: không thấy`); continue; }
  const r = ROADS_DT[ri], P = r.pts, ax = S.x != null ? 0 : 1, v = S.x != null ? S.x : S.z;
  const k = P.findIndex((p, i) => i > 0 && (P[i - 1][ax] - v) * (p[ax] - v) <= 0);
  if (k < 1) { console.log(`  tách way ${S.id}: không cắt ${ax ? 'z' : 'x'} ${v}`); continue; }
  const a = P[k - 1], b = P[k], t = (v - a[ax]) / (b[ax] - a[ax] || 1);
  const m = rnd([ax ? [a[0] + (b[0] - a[0]) * t, v] : [v, a[1] + (b[1] - a[1]) * t]])[0];
  const head = [...P.slice(0, k), m], tail = [m, ...P.slice(k)];
  if (Math.hypot(head[head.length - 1][0] - head[head.length - 2][0], head[head.length - 1][1] - head[head.length - 2][1]) < 0.5) head.splice(head.length - 2, 1);
  if (Math.hypot(tail[1][0] - tail[0][0], tail[1][1] - tail[0][1]) < 0.5) tail.splice(1, 1);
  r.pts = head;
  ROADS_DT.push({ c: r.c, pts: tail, name: r.name, id: `${S.id}:s`, tags: r.tags, sp: ri });   // sp = chỉ số way gốc (xuất ra mapdata: roadnet dùng chung NHÃN VẠCH ảnh của 2 nửa như trước khi tách)
  console.log(`  tách way ${S.id} (ri ${ri}) tại ${ax ? 'z' : 'x'} ${v}: đầu ${head.length} đỉnh, sau → ri ${ROADS_DT.length - 1} (${tail.length} đỉnh)`);
}

// ---------- 3c. MẶT CẮT PHỐ THẬT + TIM KHỚP VẾT XE PANO (Đợt 3 W3-A, tools/street_fit.mjs) ----------
// Bề rộng lòng/vỉa MỖI WAY (ghi đè pano → tag width → tường Overture 2 bên → gộp theo tên → mặc định cấp) và dịch tim
// theo 551 camera pano (camera phải nằm TRONG lòng). Cần tools/ov_buildings.csv (gitignore; thiếu → chỉ dịch tim, bề rộng
// theo ghi đè/cấp). Log: `node process_osm.mjs --fitlog <file.json>`.
{
  const { loadOverture, measureWalls, chooseWidths, fitToPanos, capWidths } = await import('./street_fit.mjs');
  const { LM_POLY } = await import('../js/landmark_polys.js');
  const t0 = Date.now();
  const ov = loadOverture(new URL('./ov_buildings.csv', import.meta.url));
  if (!ov) console.log('  (không có ov_buildings.csv — bề rộng phố chỉ theo ghi đè pano/cấp)');
  const panos = JSON.parse(fs.readFileSync(new URL('./pano_loop/list_full_551.json', import.meta.url), 'utf8')).map((e) => [e.X, e.Z, e.id]);
  const walls0 = measureWalls(ROADS_DT, ov);
  const W0 = chooseWidths(ROADS_DT, walls0, panos);
  const argv = process.argv.slice(2), fitlog = argv.includes('--fitlog') ? argv[argv.indexOf('--fitlog') + 1] : null;
  const fit = fitToPanos(ROADS_DT, panos, W0, walls0, { log: fitlog });
  // đo lại tường trên tim ĐÃ dịch (way từng chạy xuyên nhà thiếu trạm hợp lệ) rồi chốt bề rộng
  const walls1 = measureWalls(ROADS_DT, ov);
  const WD = chooseWidths(ROADS_DT, walls1, panos);
  // không để lòng HẸP hơn lúc khớp tim (mỏ neo pano đã tính "camera trong lòng" theo W0) → lấy bề rộng lớn hơn của 2 lượt
  WD.forEach((o, ri) => { if (W0[ri].w > o.w && o.w > 0) { o.w = W0[ri].w; if (W0[ri].sw >= 0) o.sw = W0[ri].sw; } else if (!(o.w > 0) && W0[ri].w > 0) Object.assign(o, W0[ri]); });
  const cap = capWidths(ROADS_DT, WD, walls1, Object.values(LM_POLY), panos);
  ROADS_DT.forEach((r, ri) => { if (WD[ri].w > 0) { r.w = WD[ri].w; if (WD[ri].sw >= 0) r.sw = WD[ri].sw; } });
  console.log(`  kẹp bề rộng: tường Overture ${cap.wall} way, mặt tiền ≤ tường gần ${cap.fl} way, vỉa ≤ cấp+1 ${cap.sw || 0} way, địa danh LM_POLY ${cap.lm} way`);
  const src = {}; WD.forEach((o) => { src[o.src] = (src[o.src] || 0) + 1; });
  console.log(`mặt cắt phố: ${Date.now() - t0} ms; overture ${ov ? ov.n : 0} nhà; nguồn bề rộng ${JSON.stringify(src)}`);
  console.log(`tim theo pano + tường: mỏ neo pano ${fit.anchors} (dịch ≠ 0: ${fit.active}), mỏ neo tường ${fit.wallAnchors}; bỏ ${JSON.stringify(fit.skipped)}; way dời ${fit.moved}:`,
    fit.perWay.slice(0, 16).map((o) => `${o.ri}${o.c} ${o.name || '-'} ${o.maxD}`).join(' | '));
}
// in vài phố lớn để đặt tuyến xe máy
const named = {};
for (const r of ROADS_DT) if (r.name && (r.c === 's' || r.c === 'p' || r.c === 't')) {
  named[r.name] = (named[r.name] || 0) + plLen(r.pts);
}
console.log('phố chính:', Object.entries(named).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, l]) => `${n}(${l | 0})`).join(', '));

// ---------- 4. Trục vùng rộng ----------
const regRoads = load('osm_roads_region.json');
// hộp trung tâm: warp 4 góc + trung điểm cạnh của bbox thô rồi lấy min/max
const dtCorners = [];
for (const lon of [106.652, 106.682, 106.712]) for (const lat of [20.845, 20.864, 20.884]) dtCorners.push(toXZ(lon, lat));
const dtBox = {
  x1: Math.min(...dtCorners.map(p => p[0])), x2: Math.max(...dtCorners.map(p => p[0])),
  z1: Math.min(...dtCorners.map(p => p[1])), z2: Math.max(...dtCorners.map(p => p[1])),
};
console.log('dtBox:', JSON.stringify(dtBox));
const inDT = ([x, z]) => x > dtBox.x1 && x < dtBox.x2 && z > dtBox.z1 && z < dtBox.z2;
const ROADS_REGION = [];
for (const w of regRoads) {
  if (!w.geometry) continue;
  const pts = rnd(simplify(subdiv(w.geometry, 300), 50)).filter(([x, z]) =>
    x > WORLD.minX && x < WORLD.maxX && z > WORLD.minZ && z < WORLD.maxZ);
  if (pts.length < 2 || plLen(pts) < 900) continue;
  // cắt bỏ phần nằm trong hộp trung tâm
  let cur = [];
  const parts = [];
  for (const p of pts) {
    if (inDT(p)) { if (cur.length >= 2) parts.push(cur); cur = []; }
    else cur.push(p);
  }
  if (cur.length >= 2) parts.push(cur);
  for (const part of parts) if (plLen(part) > 1100) ROADS_REGION.push({ pts: part });
}
console.log(`roads region: ${ROADS_REGION.length}`);

// ---------- 4b. Footprint TỪNG TÒA NHÀ THẬT (trung tâm) ----------
const bldWays = load('osm_buildings.json');
const BUILDINGS = [];
for (const w of bldWays) {
  if (!w.geometry || w.geometry.length < 4) continue;
  let pts = w.geometry.map((g) => toXZ(g.lon, g.lat));
  // bỏ điểm cuối trùng điểm đầu (polygon đóng)
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 2) pts = pts.slice(0, -1);
  pts = simplify(pts, 1.5);
  if (pts.length < 3) continue;
  // diện tích (shoelace) + tâm
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    area += x1 * z2 - x2 * z1;
    cx += x1; cz += z1;
  }
  area = Math.abs(area) / 2;
  cx /= pts.length; cz /= pts.length;
  if (area < 30 || area > 250000) continue;
  if (cx < dtBox.x1 || cx > dtBox.x2 || cz < dtBox.z1 || cz > dtBox.z2) continue;
  // 1:1 — footprint giữ NGUYÊN kích thước thật, không phóng
  // chiều cao: tag height / building:levels, thiếu thì để 0 (game tự ước lượng)
  let lv = 0;
  const tags = w.tags || {};
  if (tags.height) lv = parseFloat(tags.height) / 3.2 || 0;
  else if (tags['building:levels']) lv = parseFloat(tags['building:levels']) || 0;
  BUILDINGS.push({ p: rnd(pts), a: Math.round(area), l: Math.round(lv * 10) / 10 });
}
console.log(`buildings giữ lại: ${BUILDINGS.length}`);

// ---------- 5. Địa danh THẬT từ OSM (tọa độ + hướng mặt tiền) ----------
const lmGeom = {};
for (const e of load('osm_lm_geom.json')) lmGeom[e.id] = e;

function centroidOf(way) {
  const pts = way.geometry.map((g) => toXZ(g.lon, g.lat));
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  return [cx / pts.length, cz / pts.length, pts];
}
// hướng cạnh dài nhất của footprint (đơn vị)
function longEdgeDir(pts) {
  let best = [1, 0], bl = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz);
    if (l > bl) { bl = l; best = [dx / l, dz / l]; }
  }
  return best;
}
const LM = {}, LM_DIR = {}, LM_FACE = {}, EXTRAS = {}, LM_SIZE = {};
function addWay(key, id, faceTarget) {
  const [cx, cz, pts] = centroidOf(lmGeom[id]);
  LM[key] = [Math.round(cx), Math.round(cz)];
  const dir = longEdgeDir(pts);
  LM_DIR[key] = dir.map((v) => Math.round(v * 1000) / 1000);
  // kích thước THẬT của footprint: extent dọc trục dài + trục vuông góc (mét)
  let mnA = 1e9, mxA = -1e9, mnB = 1e9, mxB = -1e9;
  for (const [x, z] of pts) {
    const a = x * dir[0] + z * dir[1], b = -x * dir[1] + z * dir[0];
    mnA = Math.min(mnA, a); mxA = Math.max(mxA, a);
    mnB = Math.min(mnB, b); mxB = Math.max(mxB, b);
  }
  LM_SIZE[key] = [Math.round(mxA - mnA), Math.round(mxB - mnB)];
  if (faceTarget) {
    const f = [faceTarget[0] - cx, faceTarget[1] - cz];
    const l = Math.hypot(...f) || 1;
    LM_FACE[key] = [Math.round(f[0] / l * 1000) / 1000, Math.round(f[1] / l * 1000) / 1000];
  }
}
function addNode(key, lon, lat) { LM[key] = toXZ(lon, lat).map(Math.round); }

const squareC = centroidOf(lmGeom[242169920]);
EXTRAS.square = [Math.round(squareC[0]), Math.round(squareC[1])];
addNode('fountain_sq', 106.68198, 20.85646);
EXTRAS.fountain = LM.fountain_sq; delete LM.fountain_sq;

addWay('opera', 242055606, EXTRAS.square);
addWay('quanhoa', 242169916, EXTRAS.square);
addWay('cathedral', 174683856, null);
addWay('postoffice', 242226546, null);
addWay('museum', 1049831208, null);
addWay('market', 1175766946, null);
addNode('lechan', 106.67957, 20.85600);
addNode('station', 106.68752, 20.85602);   // ga Hải Phòng THẬT lat 20.856 (hack dời bắc 20.8585 đã bỏ — nearGa 700 đủ giữ rail yard, hack làm TOÀ GA lệch 275m)
// LM.lake: tính từ polygon hồ thật (phần 6b)
addNode('baodai', 106.79297, 20.68766);
EXTRAS.baodai = LM.baodai; delete LM.baodai;
addNode('catba', 107.04830, 20.72290);
addNode('port', 106.69300, 20.86700);

// bãi tắm Đồ Sơn khu 1 (way thật) làm mỏ neo bãi biển
const beach1 = centroidOf(lmGeom[693082800]);
LM.doson = [Math.round(beach1[0]), Math.round(beach1[1])];

// hải đăng Hòn Dấu (tâm footprint thật)
const hd = centroidOf(lmGeom[967471570]);
LM.hondau = [Math.round(hd[0]), Math.round(hd[1])];

// hai cầu: tâm + nửa nhịp + góc trục (từ 2 đầu way thật)
function bridgeDef(id) {
  const pts = lmGeom[id].geometry.map((g) => toXZ(g.lon, g.lat));
  const a = pts[0], b = pts[pts.length - 1];
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]); // trục dọc cầu so với +z
  return { x: Math.round(cx), zc: Math.round(cz), half: Math.round(half + 40), ang: Math.round(ang * 1000) / 1000 };
}
EXTRAS.bridges = [
  { ...bridgeDef(738297304), rise: 25 },   // Hoàng Văn Thụ (tĩnh không thật ~25m)
  { ...bridgeDef(1002961725), rise: 25 },  // Bính (tĩnh không 25m)
];
LM.bridge_hvt = [EXTRAS.bridges[0].x, EXTRAS.bridges[0].zc + EXTRAS.bridges[0].half + 40];
LM.bridge_binh = [EXTRAS.bridges[1].x, EXTRAS.bridges[1].zc + EXTRAS.bridges[1].half + 40];

// mặt tiền các tòa chưa có mục tiêu: pháp tuyến của ĐOẠN phố gần nhất (chiếu tâm lên đoạn), phía về phố.
// KHÔNG lấy đỉnh way gần nhất: sau subdiv(150)+simplify(6) phố thẳng chỉ còn 2 đỉnh = 2 ngã tư
// → nhà góc phố (bảo tàng, Đền Nghè) từng nhận mặt tiền CHÉO về ngã tư (audit 2026-09).
// streetName: chỉ xét phố mang tên đó (mọi cấp, kể cả ngõ r); mặc định phố lớn p/s/t.
function nearestRoadFace(cx, cz, streetName) {
  let best = null, bd = 1e18;
  for (const r of ROADS_LEGACY) {   // hình học cũ — hướng địa danh không đổi theo W3-A
    if (streetName ? r.name !== streetName : (r.c !== 'p' && r.c !== 's' && r.c !== 't')) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
      const t = L ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L)) : 0;
      const px = ax + dx * t, pz = az + dz * t;
      const d = (px - cx) ** 2 + (pz - cz) ** 2;
      if (d < bd) { bd = d; best = [px, pz, dx, dz]; }
    }
  }
  if (!best) throw new Error(`nearestRoadFace: không thấy phố ${streetName || 'p/s/t'} gần (${cx},${cz})`);
  const [px, pz, dx, dz] = best;
  const l = Math.hypot(dx, dz) || 1;
  const s = (-dz * (px - cx) + dx * (pz - cz)) < 0 ? -1 : 1;   // chọn phía pháp tuyến hướng về phố
  return [s * -dz / l, s * dx / l];
}
// Mặt tiền chỉ định tay (nhà góc phố 2 phố cách đều, mặt tiền ở đầu hồi, hoặc phố lớn gần nhất sai phía):
// giá trị = TÊN PHỐ (pháp tuyến đoạn phố đó) hoặc vector đơn vị [fx,fz]. Mỗi dòng ghi bằng chứng.
const LM_FACE_OVERRIDE = {
  museum: 'Phố Điện Biên Phủ',                   // 66 Điện Biên Phủ; ĐBP và Đinh Tiên Hoàng cùng cách 34m → chọn phố địa chỉ (pano_161)
  rap78: 'Phố Đinh Tiên Hoàng',                  // pano_052 "trước Nhà hát Tháng 8" trên ĐTH; footprint 59×19 dọc đông-tây → mặt tiền ĐẦU HỒI tây
  cathedral: 'Phố Trần Quang Khải',              // tháp chuông ở ĐẦU NAM gian giữa (pano_255 nhìn tây từ 31 HVT thấy tháp ngang z≈-330)
  dinhhk: [0, 1],                                // đình quay NAM ra ao đình; phố lớn gần nhất (Hàng Kênh 132m) ở phía đông — sai
  dennghe: 'Phố Lê Chân',                        // node OSM = cổng đền trên vỉa hè Lê Chân (9m), không phải Mê Linh (35m)
  station_bldg: 'Phố Lương Khánh Thiện (Phố Ga)', // mặt tiền ga quay ra quảng trường ga / LKT (tây-bắc), ray ở sau lưng
  viettiep: 'Phố Lạch Tray',                     // 53 Lạch Tray — quảng trường phía trước, Lạch Tray cách 135m (đúng thực địa)
};
// Mặt tiền nằm ở ĐẦU HỒI (pháp tuyến ∥ LM_DIR) → world.js dùng orientFace(LM_FACE) thay orientLong.
// museum: OSM cạnh đơn dài nhất là hông tây 29m nhưng mặt tiền thật là cạnh nam 36m ra Điện Biên Phủ.
const FACADE_SHORT_SIDE = ['cathedral', 'rap78', 'dinhhk', 'museum'];
// 3 trường học (way OSM thật, file osm_school_geom.json)
for (const e of load('osm_school_geom.json')) lmGeom[e.id] = e;
// đợt địa danh 2: UBND TP, rạp Tháng Tám, đình Hàng Kênh, chùa Dư Hàng, đền Tam Kỳ
for (const e of load('osm_lm2_geom.json')) lmGeom[e.id] = e;
addWay('ubnd', 1124706318, null);
addWay('rap78', 868234608, null);
addWay('dinhhk', 240394078, null);
addWay('chuahang', 236830096, null);
addWay('dentamky', 961921403, null);
addWay('nhnn', 242192606, null);       // Ngân hàng Nhà nước CN Hải Phòng
addNode('dennghe', 106.68041, 20.85466);   // Đền Nghè (node OSM 6380148018)
addNode('nhaken', 106.68639, 20.85888);    // Nhà Kèn THẬT trong vườn hoa Nguyễn Du (OSM node 6369498380)
addWay('thptnq', 242169921, null);   // THPT Ngô Quyền (trường Bonnal)
addWay('thcsnq', 240463141, null);   // THCS Ngô Quyền
addWay('thcstp', 1120513525, null);  // THCS Trần Phú
// đợt địa danh 3 (audit 2026-09): toà ga + Trung tâm Triển lãm có sẵn trong osm_buildings.json;
// Cung Việt Tiệp là relation → way ngoài (osm_lm3_geom.json, fetch_osm.sh mục 7c)
for (const e of bldWays) if (e.id === 241081956 || e.id === 240463140) lmGeom[e.id] = e;
for (const e of load('osm_lm3_geom.json')) lmGeom[e.id] = e;
addWay('station_bldg', 241081956, null);   // toà Ga Hải Phòng (building=train_station, dải 118×21m dọc ray, trục 225°)
addWay('trienlam', 240463140, LM.lechan);  // TT Triển lãm & Mỹ thuật (1 Nguyễn Đức Cảnh) — mặt dài quay ĐÔNG ra tượng Lê Chân (pano_037)
addWay('viettiep', 961958396, null);       // Cung VH Lao động Hữu nghị Việt Tiệp (way ngoài relation 19780771)

for (const key of ['cathedral', 'postoffice', 'museum', 'market', 'thptnq', 'thcsnq', 'thcstp', 'ubnd', 'rap78', 'dinhhk', 'chuahang', 'dentamky', 'dennghe', 'nhaken', 'nhnn', 'station_bldg', 'viettiep']) {
  const [cx, cz] = LM[key];
  const ov = LM_FACE_OVERRIDE[key];
  const f = Array.isArray(ov) ? ov : nearestRoadFace(cx, cz, ov);
  LM_FACE[key] = [Math.round(f[0] * 1000) / 1000, Math.round(f[1] * 1000) / 1000];
}
// sống đồi Đồ Sơn + rìa bến Bính
EXTRAS.dsRidge = [...toXZ(106.7770, 20.7160).map(Math.round), ...toXZ(106.7930, 20.6990).map(Math.round)];
EXTRAS.catbaTown = LM.catba;

// ---------- 6. CÂY THẬT (node natural=tree) & CÔNG VIÊN/THẢM CỎ THẬT ----------
const TREES = [];
for (const n of load('osm_trees.json')) {
  if (n.type !== 'node') continue;
  const [x, z] = toXZ(n.lon, n.lat).map((v) => Math.round(v * 10) / 10);
  if (x > dtBox.x1 - 300 && x < dtBox.x2 + 300 && z > dtBox.z1 - 300 && z < dtBox.z2 + 300) TREES.push([x, z]);
}
console.log(`trees thật: ${TREES.length}`);
const PARKS = [];
for (const w of load('osm_parks.json')) {
  if (!w.geometry || w.geometry.length < 4) continue;
  let pts = rnd(simplify(w.geometry.map((g) => toXZ(g.lon, g.lat)), 5));
  if (pts.length < 3) continue;
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    area += x1 * z2 - x2 * z1; cx += x1; cz += z1;
  }
  area = Math.abs(area) / 2; cx /= pts.length; cz /= pts.length;
  if (area < 600) continue;
  if (cx < dtBox.x1 || cx > dtBox.x2 || cz < dtBox.z1 || cz > dtBox.z2) continue;
  PARKS.push(pts);
}
console.log(`parks thật: ${PARKS.length}`);

// ---------- 6b. HỒ TAM BẠC: trục + bề rộng từ polygon nước thật (way 236743184) ----------
{
  const wd = load('osm_water_dt.json');
  const lakeWay = wd.find((e) => e.id === 236743184);
  const pts = lakeWay.geometry.map((g) => toXZ(g.lon, g.lat));
  let dir = [1, 0], bl = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i+1][0] - pts[i][0], dz = pts[i+1][1] - pts[i][1], l = Math.hypot(dx, dz);
    if (l > bl) { bl = l; dir = [dx / l, dz / l]; }
  }
  let mnA = 1e9, mxA = -1e9, mnB = 1e9, mxB = -1e9, cx = 0, cz = 0;
  for (const [x, z] of pts) {
    const a = x * dir[0] + z * dir[1], b = -x * dir[1] + z * dir[0];
    mnA = Math.min(mnA, a); mxA = Math.max(mxA, a);
    mnB = Math.min(mnB, b); mxB = Math.max(mxB, b);
    cx += x; cz += z;
  }
  cx /= pts.length; cz /= pts.length;
  const cb = (mnB + mxB) / 2;
  const line = [];
  for (const t of [0.06, 0.5, 0.94]) {
    const a = mnA + (mxA - mnA) * t;
    line.push([Math.round(a * dir[0] - cb * dir[1]), Math.round(a * dir[1] + cb * dir[0])]);
  }
  EXTRAS.lake = { w: Math.round(mxB - mnB), pts: line };
  LM.lake = [Math.round(cx), Math.round(cz)];
  console.log('hồ Tam Bạc:', JSON.stringify(EXTRAS.lake), 'tâm', LM.lake);
}

// ---------- 6b2. NƯỚC POLYGON THẬT (natural=water / water=*) quanh trung tâm ----------
// terrain.js dùng khoảng cách có dấu tới tập polygon này (waterSD) để đào sông/hồ TRONG THÀNH PHỐ
// (bán kính R_POLY=1750 quanh Nhà hát) thay cho polyline bề rộng hằng (Cấm 620 m vs thật 201 m ở Bến Bính,
// Tam Bạc/Hạ Lý là chữ Y mà 1 trục không bám được, Hồ Tiên Nga/Hồ Sen không có trục nào).
// Giữ NGUYÊN polygon (không cắt) nếu có đỉnh nào cách gốc < R_POLY+600; simplify 1.5 m; bỏ ao < 200 m².
// Relation multipolygon (sông có đảo): ghép các way outer theo đầu-cuối. File 2026-09 CHƯA có relation
// (fetch cũ chỉ lấy way) — fetch_osm.sh mục 11 đã thêm rel[natural=water] cho lần tải sau.
const WATER = [];
{
  const WR = 1750 + 600;
  const isWaterTag = (t) => !!t && (t.natural === 'water' || !!t.water);
  const samePt = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  const rings = [];   // { n, geo:[{lon,lat},...] } vòng kín (điểm cuối = điểm đầu)
  let nRel = 0;
  for (const e of load('osm_water_dt.json')) {
    if (!isWaterTag(e.tags)) continue;
    const name = e.tags.name || '';
    if (e.type === 'way') {
      const g = e.geometry;
      if (g && g.length >= 4 && samePt(g[0], g[g.length - 1])) rings.push({ n: name, geo: g });
    } else if (e.type === 'relation' && e.members) {
      nRel++;
      const pool = e.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry.slice());
      while (pool.length) {
        let ring = pool.pop(), grew = true;
        while (grew && !samePt(ring[0], ring[ring.length - 1])) {
          grew = false;
          for (let i = 0; i < pool.length; i++) {
            const s = pool[i], end = ring[ring.length - 1];
            if (samePt(s[0], end)) { ring = ring.concat(s.slice(1)); pool.splice(i, 1); grew = true; break; }
            if (samePt(s[s.length - 1], end)) { ring = ring.concat(s.slice(0, -1).reverse()); pool.splice(i, 1); grew = true; break; }
          }
        }
        if (ring.length >= 4 && samePt(ring[0], ring[ring.length - 1])) rings.push({ n: name, geo: ring });
        else console.log(`  water relation ${e.id} "${name}": vòng outer hở (${ring.length} điểm) — bỏ`);
      }
    }
  }
  for (const { n, geo } of rings) {
    let pts = geo.map((g) => toXZ(g.lon, g.lat));
    if (!pts.some(([x, z]) => Math.hypot(x, z) < WR)) continue;
    pts = simplify(pts, 1.5).slice(0, -1);   // giữ vòng kín khi simplify rồi bỏ điểm cuối trùng điểm đầu
    if (pts.length < 3) continue;
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; area += x1 * z2 - x2 * z1; }
    if (Math.abs(area) / 2 < 200) continue;
    WATER.push({ n, pts: pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) });
  }
  console.log(`water polygon: ${WATER.length} (relation: ${nRel}), đỉnh ${WATER.reduce((s, w) => s + w.pts.length, 0)}:`,
    WATER.filter((w) => w.n).map((w) => w.n + '(' + w.pts.length + ')').join(', '));
}

// ---------- 6b3. BỜ SÔNG LÙI KHỎI PHỐ VEN SÔNG (Đợt 3 W3-F, AUDIT3 FP-6) ----------
// Polygon nước OSM (natural=water) vẽ từ ảnh cũ: mép sông Tam Bạc/Cấm chạy ĐÈ lên lòng phố ven sông (tim phố Tam Bạc
// cách mép nước 2-6 m ở đoạn cong pano_197-203, 221, 519) → trong game nước sát chân camera, không có vỉa hè/kè.
// Thật (ảnh pano_203/221): tim phố → lòng (hw) → bó vỉa → vỉa hè/dải dạo lát caro ~4,5-5 m → lan can trên gờ kè →
// mặt nước thấp hơn 1,5-2 m. Quy tắc: mép SÔNG phải cách tim mọi phố p/s/t/r CHẠY DỌC bờ (góc ≤ 40°, không phải cầu)
// ít nhất KE_CLEAR(c) = hw + vỉa hè + 2,5 m (t 9,5 · s 11 · p 12,6 · r 7); cách lối đi ven sông OSM (footway=sidewalk,
// đúng tuyến dải dạo) ≥ 3 m. Đỉnh vi phạm bị ĐẨY ra xa theo pháp tuyến phố về phía nước (polygon được chia ≤ 3 m trước).
// Chỉ polygon SÔNG/KÊNH (hồ giữ nguyên: dải kè hồ Tam Bạc bám LAKE_POLY), chỉ trong |x|,|z| < 2000.
// Kiểm: scratchpad dot3/W3-F/cmpwater.py (polygon vs ảnh vệ tinh), plot.py.
{
  // tích hợp W3 (W3-A × W3-F): khoảng kè theo bề rộng RIÊNG từng way (ROADS_DT[i].w/.sw của §3c street_fit; thiếu → cấp) —
  // cùng công thức với world.js keClear (riverbank) → mép nước khớp mép vỉa/dải dạo roadnet vẽ
  const { roadHW, sidewalkW } = await import('../js/xsection.js');
  const PROM = 2.5, FOOT_CLEAR = 3.0, CITY = 2000;
  const clearOf = (r) => Math.max(7, roadHW(r) + sidewalkW(r) + PROM);
  const isRiver = (n) => /^(Sông|Kênh)/.test(n || '');
  // phố ứng viên: p/s/t/r không phải cầu + lối đi lát ven sông OSM (footway=sidewalk)
  const segs = [];   // [ax, az, bx, bz, clear]
  for (const r of ROADS_DT) {
    if (!['p', 's', 't', 'r'].includes(r.c)) continue;
    if (r.tags && r.tags.bridge && r.tags.bridge !== 'no') continue;
    for (let i = 0; i < r.pts.length - 1; i++) segs.push([...r.pts[i], ...r.pts[i + 1], clearOf(r)]);
  }
  try {
    for (const w of load('osm_alleys.json')) {
      const t = w.tags || {};
      if (t.highway !== 'footway' || t.footway !== 'sidewalk' || !w.geometry || (t.bridge && t.bridge !== 'no')) continue;
      const pts = w.geometry.map((g) => toXZ(g.lon, g.lat));
      if (!pts.some(([x, z]) => Math.abs(x) < CITY && Math.abs(z) < CITY)) continue;
      for (let i = 0; i < pts.length - 1; i++) segs.push([...pts[i], ...pts[i + 1], FOOT_CLEAR]);
    }
  } catch (e) { /* không có osm_alleys.json */ }
  const G = new Map(), GC = 32, gk = (i, j) => i * 100003 + j;
  segs.forEach((s, si) => {
    const r = s[4] + 2;
    for (let i = Math.floor((Math.min(s[0], s[2]) - r) / GC); i <= Math.floor((Math.max(s[0], s[2]) + r) / GC); i++)
      for (let j = Math.floor((Math.min(s[1], s[3]) - r) / GC); j <= Math.floor((Math.max(s[1], s[3]) + r) / GC); j++) {
        const k = gk(i, j); let a = G.get(k); if (!a) G.set(k, a = []); a.push(si);
      }
  });
  const inPolyRaw = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  let moved = 0, maxPush = 0;
  // r4 (phản biện 331/519/336 "nước ngay sau lan can"): Tam Bạc đoạn BẮC (dải bờ TỰ PHÁT — riverbank 'strip'): pano 2022-23
  // 336/337/520 cho dải lán + cổ thụ ~8-10 m giữa lan can mép vỉa hè và mặt nước (tim phố → nước 18-19 m trong game), riêng
  // quanh 519 polygon OSM chỉ cách tim 10,5 m (dải 2 m — không chỗ lán; ảnh 519 h180/h270 lán bạt + cây ngay sau lan can)
  // → mép nước ≥ clearOf + STRIP_W ở z −620…−800, vuốt 0 → đủ trong z −590…−620 (không bậc mới gần 221) và −800…−830 (chân
  // bãi bồi §6b3b: đường bờ bãi bắt đầu ĐÚNG trên mép cũ (−519,5, −830) — đẩy tới đó sinh khấc)
  const STRIP_W = 7;
  const stripExtra = (n, x, z) => (/Tam Bạc/.test(n) && x < -250 && z < -590 && z > -830 ? STRIP_W * Math.min(1, (-590 - z) / 30, (z + 830) / 30) : 0);
  for (const W of WATER) {
    if (!isRiver(W.n)) continue;
    const P0 = W.pts;
    if (!P0.some(([x, z]) => Math.abs(x) < CITY && Math.abs(z) < CITY)) continue;
    // chia nhỏ cạnh ≤ 3 m trong vùng thành phố
    const P = [];
    for (let i = 0; i < P0.length; i++) {
      const a = P0[i], b = P0[(i + 1) % P0.length];
      P.push([a[0], a[1]]);
      if (Math.abs(a[0]) > CITY + 50 || Math.abs(a[1]) > CITY + 50) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 3);
      for (let k = 1; k <= n; k++) P.push([a[0] + (b[0] - a[0]) * k / (n + 1), a[1] + (b[1] - a[1]) * k / (n + 1)]);
    }
    const Q = P.map((p) => p.slice());
    let touched = false;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      if (Math.abs(x) > CITY || Math.abs(z) > CITY) continue;
      const pa = P[(i + P.length - 1) % P.length], pb = P[(i + 1) % P.length];
      let tx = pb[0] - pa[0], tz = pb[1] - pa[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const cell = G.get(gk(Math.floor(x / GC), Math.floor(z / GC))); if (!cell) continue;
      let best = null;
      const xtra = stripExtra(W.n, x, z);
      for (const si of cell) {
        const [ax, az, bx, bz, need0] = segs[si];
        const need = need0 + (need0 > FOOT_CLEAR ? xtra : 0);
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) continue;
        const ux = dx / L, uz = dz / L;
        if (Math.abs(ux * tx + uz * tz) < Math.cos(40 * Math.PI / 180)) continue;          // không chạy dọc bờ
        const t = (x - ax) * ux + (z - az) * uz; if (t < -1 || t > L + 1) continue;
        const px = ax + ux * Math.max(0, Math.min(L, t)), pz = az + uz * Math.max(0, Math.min(L, t));
        const nx = -uz, nz = ux;
        // phía NƯỚC của phố: phía có nước ở khoảng need+8 m (polygon gốc); 2 phía đều nước / đều đất → bỏ (cầu, đảo)
        const wa = inPolyRaw(px + nx * (need + 8), pz + nz * (need + 8), P0), wb = inPolyRaw(px - nx * (need + 8), pz - nz * (need + 8), P0);
        if (wa === wb) continue;
        const sg = wa ? 1 : -1, s = ((x - px) * nx + (z - pz) * nz) * sg;   // khoảng cách có dấu về phía nước
        if (s >= need) continue;
        const push = need - s;
        if (!best || push > best.push) best = { push, x: px + nx * sg * need + (x - px - nx * ((x - px) * nx + (z - pz) * nz)), z: pz + nz * sg * need + (z - pz - nz * ((x - px) * nx + (z - pz) * nz)) };
      }
      if (best) { Q[i] = [best.x, best.z]; moved++; maxPush = Math.max(maxPush, best.push); touched = true; }
    }
    if (!touched) continue;
    const S = simplify(Q.concat([Q[0]]), 1.0).slice(0, -1);
    W.pts = S.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
  }
  console.log(`bờ sông lùi khỏi phố ven sông: ${moved} đỉnh đẩy, đẩy tối đa ${maxPush.toFixed(1)} m`);
}

// ---------- 6b3b. BÃI BỒI CỬA SÔNG TAM BẠC (Đợt 3 W3-F, AUDIT3 FP-6 "331 (−525, −905)") ----------
// Polygon OSM sông Tam Bạc (242027154) phủ CẢ bãi cát + cây giữa lòng lạch và kè phố Tam Bạc ở cửa ra sông Cấm (pano_331/332,
// 383/384). Ảnh vệ tinh tile 7 (georef tự động, xem W3-F KNOWLEDGE): lạch nước thật chỉ rộng ~36 m sát bờ TÂY (tim = way
// waterway 680814260), phía đông là bãi bồi cát RỘNG 25-60 m có lùm cây lớn; ảnh pano 2022-23 từ phố: hàng rào + cây rậm, KHÔNG
// thấy nước (game cũ: mặt sông mở 15 m trước camera pano_331). → thay ĐOẠN mép đông của polygon (từ chân bãi z ≈ −830 tới cạnh
// chung với polygon sông Cấm) bằng đường bờ bãi BEACH_SHORE (đo trên ảnh tile 7; z < −965 ngoài ảnh: tim lạch + 19 m, khớp đoạn
// đo được) — đầu nam nằm trên mép cũ (kè), đầu bắc nằm trên cạnh chung Tam Bạc/Cấm. Đoạn ghép = mọi đỉnh (đã chia ≤ 3 m) nằm
// PHÍA ĐÔNG đường bờ trong hộp bãi — 1 dải liên tục trên polygon. Xuất `BEACHES [[[x,z],…]]` = đa giác ĐẤT bãi (đường bờ + mép
// cũ) cho js/riverbank.js: bờ bãi là dốc cát tự nhiên (không tường kè) + cây lớn rải theo lùm, dải sát phố như 'strip'.
const BEACHES = [];
{
  const BEACH_SHORE = [[-519.5, -830], [-544.1, -839.6], [-564.2, -853.0], [-575.4, -864.2], [-584.3, -879.8], [-593.2, -897.7],
    [-598.8, -920.0], [-604.4, -942.4], [-611.1, -964.7], [-608.5, -997], [-597.5, -1030]];
  const BOX = [-625, -470, -1060, -828];   // x0 x1 z0 z1
  const W = WATER.find((w) => w.n === 'Sông Tam Bạc' && w.pts.some(([x, z]) => x > BOX[0] && x < BOX[1] && z > BOX[2] && z < BOX[3]));
  // phía của điểm so với đường bờ (đoạn gần nhất): > 0 = phía ĐÔNG (bãi), theo chiều nam → bắc
  const side = ([x, z]) => {
    let bd = Infinity, sg = 0;
    for (let i = 0; i < BEACH_SHORE.length - 1; i++) {
      const [ax, az] = BEACH_SHORE[i], [bx, bz] = BEACH_SHORE[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < bd) { bd = d; sg = dx * (z - az) - dz * (x - ax); }
    }
    return sg;   // đường bờ đi nam → bắc: tích chéo > 0 ⇔ phía ĐÔNG (bãi)
  };
  if (W) {
    const P = [];
    for (let i = 0; i < W.pts.length; i++) {
      const a = W.pts[i], b = W.pts[(i + 1) % W.pts.length];
      P.push([a[0], a[1], 1]);   // [x, z, đỉnh gốc?]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 3);
      if (Math.max(a[0], b[0]) < BOX[0] || Math.min(a[0], b[0]) > BOX[1] || Math.max(a[1], b[1]) < BOX[2] || Math.min(a[1], b[1]) > BOX[3]) continue;
      for (let k = 1; k <= n; k++) P.push([a[0] + (b[0] - a[0]) * k / (n + 1), a[1] + (b[1] - a[1]) * k / (n + 1), 0]);
    }
    const inB = P.map(([x, z]) => x > BOX[0] && x < BOX[1] && z > BOX[2] && z < BOX[3] && side([x, z]) > 0);
    const idx = inB.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    // dải phải LIÊN TỤC (không vòng qua đỉnh 0): i0..i1
    const i0 = idx[0], i1 = idx[idx.length - 1];
    if (idx.length > 3 && i1 - i0 + 1 === idx.length) {
      // chiều polygon dọc mép đông: P[i0] gần đầu NAM hay đầu BẮC của đường bờ?
      const dS = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      const shore = dS(P[i0], BEACH_SHORE[0]) < dS(P[i0], BEACH_SHORE[BEACH_SHORE.length - 1]) ? BEACH_SHORE : BEACH_SHORE.slice().reverse();
      // giữ đỉnh GỐC ngoài dải (điểm chia thêm nằm trên cạnh gốc → bỏ, polygon ngoài dải y hệt cũ) + đường bờ
      const Q = P.slice(0, i0).filter((p) => p[2]).concat(shore.map((p) => [p[0], p[1], 1]), P.slice(i1 + 1).filter((p) => p[2]));
      W.pts = Q.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      const land = simplify(P.slice(i0, i1 + 1).reverse().map(([x, z]) => [x, z]), 1.0);   // mép cũ bắc → nam (điểm chia bỏ bớt)
      BEACHES.push(shore.concat(land).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]));
      console.log(`bãi bồi cửa Tam Bạc: thay ${i1 - i0 + 1} đỉnh mép đông bằng ${BEACH_SHORE.length} đỉnh đường bờ`);
    } else console.log('bãi bồi cửa Tam Bạc: KHÔNG tìm được dải mép liên tục', idx.length, i0, i1);
  }
}

// ---------- 6b4. CẦU THEO WAY OSM (Đợt 3 W3-F): BRIDGE_WAYS = mặt cầu có cao độ cho js/bridges.js ----------
// Cầu Hoàng Văn Thụ THẬT = 2 làn một chiều (bắc 738297304 x≈−48, nam 930885732 x≈−59, layer 2) chạy thẳng z −930 → −1880
// + HAI NÚT XOẮN ỐC phía Hải Phòng (đông 1022715416 tâm (17,−930), tây 1022715417 tâm (−133,−932), r ≈ 63 m, layer 1)
// + dốc dẫn mặt đất 743181389/743181388 (cùng tên, không gắn bridge). Mô hình cũ = 1 đoạn thẳng nối 2 đầu way bắc
// (75,−898)→(−45,−1883) ⇒ vòm lệch ~110 m về đông pano_285 và tâm vòm ở z −1391 (trên đất Thủy Nguyên).
// Cao độ: XÍCH đi theo chiều xe (way nối đuôi → đầu ≤ 3 m), quãng s từ đầu dốc mặt đất (y = LAND_H) tới đỉnh xoắn
// (đỉnh đầu tiên của đoạn thẳng dài ≥ 200 m) dốc ĐỀU → HVT_TOP; nhịp chính y theo z (HVT_SPAN, ease) — 2 làn cùng z
// cùng cao độ. Dốc đều 1,9 %: vòng dưới (layer 1) và nửa vòng trên (layer 2) cách nhau 1 vòng ≈ 404 m ⇒ ~7,8 m (tĩnh
// không ~6,4 m — ảnh pano_304 h90: dốc dưới ~6 m, mặt trên ~14 m).
// Cầu phẳng (Lạc Long, Tam Kỳ, Tam Bạc…): kind 'flat' — mặt đường do roadnet vẽ ở LAND_H, bridges.js chỉ thêm lan can/
// dầm biên/trụ. ri = chỉ số ROADS_DT của way (roadnet bỏ dải mặt đất của cầu nâng; traffic/props tra cao độ mặt cầu).
const BRIDGE_WAYS = [];
{
  const LAND_H = 2, HVT_TOP = 15, CITY = 2100;
  const HVT_SPAN = [[-930, 15], [-1020, 19.4], [-1110, 20.6], [-1200, 19.4], [-1880, 2.0]];   // (z, y) nhịp chính
  const spanY = (z) => {
    const K = HVT_SPAN;
    if (z >= K[0][0]) return K[0][1];
    for (let i = 0; i < K.length - 1; i++) {
      const [z0, y0] = K[i], [z1, y1] = K[i + 1];
      if (z <= z0 && z >= z1) { const t = (z0 - z) / (z0 - z1), e = (1 - Math.cos(Math.PI * t)) / 2; return y0 + (y1 - y0) * e; }
    }
    return K[K.length - 1][1];
  };
  const riOf = new Map();
  ROADS_DT.forEach((r, i) => { if (r.id == null) return; let a = riOf.get(r.id); if (!a) riOf.set(r.id, a = []); a.push(i); });
  const resample = (pts, step) => {
    const out = [pts[0].slice()];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    return out;
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  const widthOf = (t, c) => {
    const w = parseFloat(t.width); if (w > 3) return w;
    const ln = parseInt(t.lanes, 10);
    if (ln > 0) return ln * 3.5 + (t.oneway === 'yes' ? 3.5 : 2.5);
    return { p: 13, s: 10, t: 8, r: 6 }[c] + (t.oneway === 'yes' ? 0 : 3);
  };
  const raw = load('osm_roads_dt.json').filter((w) => w.geometry && w.tags && CLS[w.tags.highway]);
  const isBr = (t) => t.bridge && t.bridge !== 'no';
  // --- HVT: xích theo chiều xe ---
  const HVT = raw.filter((w) => w.tags.name === 'Cầu Hoàng Văn Thụ').map((w) => ({ w, pts: w.geometry.map((g) => toXZ(g.lon, g.lat)) }));
  const used = new Set();
  const nextOf = (a) => {
    const e = a.pts[a.pts.length - 1]; let best = null, bd = 3;
    for (const b of HVT) { if (b === a || used.has(b)) continue; const d = Math.hypot(b.pts[0][0] - e[0], b.pts[0][1] - e[1]); if (d < bd) { bd = d; best = b; } }
    return best;
  };
  const starts = HVT.filter((a) => !HVT.some((b) => b !== a && Math.hypot(b.pts[b.pts.length - 1][0] - a.pts[0][0], b.pts[b.pts.length - 1][1] - a.pts[0][1]) < 3));
  for (const st of starts) {
    const chain = []; let cur = st;
    while (cur && !used.has(cur)) { used.add(cur); chain.push(cur); cur = nextOf(cur); }
    // quãng s dọc xích; điểm nối nhịp chính = đầu (hoặc cuối) đoạn thẳng dài ≥ 200 m
    const segs = [];
    for (const c of chain) segs.push(resample(c.pts, 3));
    const all = []; segs.forEach((S, k) => S.forEach((p, i) => { if (k && !i) return; all.push(p); }));
    const cum = [0]; for (let i = 1; i < all.length; i++) cum.push(cum[i - 1] + Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]));
    // đoạn nhịp chính = các cạnh GỐC dài ≥ 200 m (vòng xoắn chia cạnh ~10-15 m) → chỉ số trong all qua toạ độ đỉnh gốc
    let jStart = -1, jEnd = -1;
    const idxOf = (p) => { let bi = -1, bd = 0.01; for (let i = 0; i < all.length; i++) { const d = Math.abs(all[i][0] - p[0]) + Math.abs(all[i][1] - p[1]); if (d < bd) { bd = d; bi = i; } } return bi; };
    for (const c of chain) for (let i = 0; i < c.pts.length - 1; i++) {
      if (Math.hypot(c.pts[i + 1][0] - c.pts[i][0], c.pts[i + 1][1] - c.pts[i][1]) < 200) continue;
      const a = idxOf(c.pts[i]), b = idxOf(c.pts[i + 1]);
      if (jStart < 0 || a < jStart) jStart = a;
      if (b > jEnd) jEnd = b;
    }
    const groundAtStart = all[0][1] > -1000;      // xích bắt đầu ở phía Hải Phòng (dốc lên) hay từ bờ bắc (dốc xuống)
    const ys = all.map((p, i) => {
      if (i >= jStart && i <= jEnd) return spanY(p[1]);
      if (groundAtStart) return LAND_H + (HVT_TOP - LAND_H) * Math.min(1, cum[i] / cum[jStart]);
      return LAND_H + (HVT_TOP - LAND_H) * Math.min(1, (cum[cum.length - 1] - cum[i]) / (cum[cum.length - 1] - cum[jEnd]));
    });
    // tách lại theo way (mỗi way 1 bản ghi: hình + cao độ + ri)
    let off = 0;
    segs.forEach((S, k) => {
      const c = chain[k], n = S.length - (k ? 1 : 0), i0 = k ? off - 1 : 0;
      const pts = [];
      for (let i = i0; i < off + n; i++) pts.push([r2(all[i][0]), r2(all[i][1]), r2(ys[i])]);
      off += n;
      const kind = isBr(c.w.tags) ? (c.w.tags.layer === '2' ? 'span' : 'ramp') : 'ramp';
      BRIDGE_WAYS.push({ id: c.w.id, n: 'Cầu Hoàng Văn Thụ', c: CLS[c.w.tags.highway], kind, w: kind === 'span' ? 11 : 10.5, ri: riOf.get(c.w.id) || [], pts });
    });
  }
  // --- cầu phố NÂNG NHẸ (kind 'deck'): mặt cầu cao hơn phố 2 bờ — ảnh pano_074 (Cầu Lạc Long): mặt cầu cao ~2 m trên
  //     ngã ba Bạch Đằng ngay dưới (h180), lan can con tiện trắng hoa văn ô van, bó vỉa sơn sọc đỏ-trắng, vỉa hè gạch đỏ.
  //     Hồ sơ (way OSM dài 232 m, gồm cả đoạn trên đất — ảnh vệ tinh tile 7: đường dẫn phía TÂY là NỀN ĐẮP cao giữa 2 phố
  //     gom 51 (bắc) / 222 (nam) mặt đất; pano_074 h270 lan can chạy suốt về tây): phẳng 6 m ở đầu TÂY (nối thẳng phố 187)
  //     rồi dốc êm (cos) 64 m lên +h; đầu ĐÔNG phẳng mặt đất 44 m (nút giao phố ven bờ đông ri 200 ở quãng ~200 m: miệng
  //     nút ±11,5 m phải ở MẶT ĐẤT — bản cũ phẳng 32 m ⇒ lan can chắn ngang nút) rồi dốc 35 m.
  //     i0/i1 = khoảng mặt cầu THẬT SỰ nâng (y > mặt đất): bridges.js chỉ dựng mặt cầu/lan can ở [i0,i1]; roadnet vẽ dải
  //     mặt đất phần còn lại (nút 2 đầu nguyên vẹn); traffic theo hồ sơ cao độ cả way.
  const DECK_RISE = { 'Cầu Lạc Long': { h: 2.0, west0: 6, west: 64, eastFlat: 44, east: 35 } };
  for (const w of raw) {
    if (!isBr(w.tags) || !(w.tags.name in DECK_RISE)) continue;
    let pts = resample(w.geometry.map((g) => toXZ(g.lon, g.lat)), 3);
    if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.reverse();       // đi từ TÂY sang ĐÔNG
    const c = CLS[w.tags.highway], P = DECK_RISE[w.tags.name];
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const ease = (t) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2;
    const P3 = pts.map(([x, z], i) => { const y = LAND_H + P.h * Math.min(ease((cum[i] - P.west0) / P.west), ease((L - cum[i] - P.eastFlat) / P.east)); return [r2(x), r2(z), r2(y)]; });
    let i0 = 0, i1 = P3.length - 1;
    while (i0 < P3.length - 1 && P3[i0 + 1][2] <= LAND_H) i0++;
    while (i1 > i0 && P3[i1 - 1][2] <= LAND_H) i1--;
    BRIDGE_WAYS.push({ id: w.id, n: w.tags.name, c, kind: 'deck', w: r2(widthOf(w.tags, c)), ri: riOf.get(w.id) || [], i0, i1, pts: P3 });
  }
  // --- cầu phẳng khác trong thành phố ---
  for (const w of raw) {
    if (!isBr(w.tags) || w.tags.name === 'Cầu Hoàng Văn Thụ' || (w.tags.name in DECK_RISE)) continue;
    const pts = w.geometry.map((g) => toXZ(g.lon, g.lat));
    if (!pts.some(([x, z]) => Math.hypot(x, z) < CITY)) continue;
    const c = CLS[w.tags.highway];
    BRIDGE_WAYS.push({ id: w.id, n: w.tags.name || '', c, kind: 'flat', w: r2(widthOf(w.tags, c)), ri: riOf.get(w.id) || [],
      pts: resample(pts, 3).map(([x, z]) => [r2(x), r2(z), LAND_H]) });
  }
  console.log('BRIDGE_WAYS:', BRIDGE_WAYS.map((b) => `${b.id}:${b.kind}/${b.pts.length}p/ri${b.ri.join('.')}/y${Math.min(...b.pts.map((p) => p[2])).toFixed(1)}-${Math.max(...b.pts.map((p) => p[2])).toFixed(1)}`).join(' '));
}

// ---------- 6c. ĐƯỜNG SẮT THẬT (tuyến chính Hà Nội - Hải Phòng vào ga) ----------
const RAIL = [];
for (const w of load('osm_rail.json')) {
  const t = w.tags || {};
  if (!w.geometry) continue;
  const pts = rnd(simplify(subdiv(w.geometry, 200), 15)).filter(([x, z]) =>
    x > WORLD.minX && x < WORLD.maxX && z > WORLD.minZ && z < WORLD.maxZ);
  if (pts.length < 2) continue;
  const isMain = t.usage === 'main' || !t.service;
  if (isMain) { if (plLen(pts) > 500) RAIL.push({ pts }); continue; }
  // ray yard/spur: chỉ giữ trong khu cảng hoặc sân ga (thêm không khí đường sắt thật)
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const nearPort = Math.hypot(cx - LM.port[0], cz - LM.port[1]) < 1500;
  const nearGa = Math.hypot(cx - LM.station[0], cz - LM.station[1]) < 700;   // nới 350→700: giữ cả sân ga/rail yard (t3), không chỉ tuyến chính
  if ((nearPort || nearGa) && plLen(pts) > 200) RAIL.push({ pts });
}
console.log(`rail: ${RAIL.length} đoạn`);

// ---------- Biển tên phố + giao lộ lớn + dải phân cách (nội thất đường phố) ----------
// STREETS: mỗi phố có tên (p/s/t, tổng dài >60) → điểm giữa đoạn dài nhất + hướng
const streetAgg = {};
for (const r of ROADS_DT) if (r.name && ['p', 's', 't'].includes(r.c)) {
  const L = plLen(r.pts);
  const a = (streetAgg[r.name] = streetAgg[r.name] || { len: 0, best: null, bl: 0 });
  a.len += L;
  if (L > a.bl) { a.bl = L; a.best = r.pts; }
}
function plMid(pts) { // điểm giữa theo chiều dài + hướng đơn vị tại đó
  const total = plLen(pts); let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + seg >= total / 2) {
      const t = (total / 2 - acc) / seg;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      const d = [(pts[i + 1][0] - pts[i][0]) / seg, (pts[i + 1][1] - pts[i][1]) / seg];
      return [Math.round(x), Math.round(z), [+d[0].toFixed(3), +d[1].toFixed(3)]];
    }
    acc += seg;
  }
  return [pts[0][0], pts[0][1], [1, 0]];
}
const STREETS = Object.entries(streetAgg)
  .filter(([, a]) => a.len > 400)
  .sort((x, y) => y[1].len - x[1].len).slice(0, 26)
  .map(([n, a]) => { const [x, z, d] = plMid(a.best); return { n, x, z, d }; });
console.log('STREETS:', STREETS.length);

// INTERSECTIONS: điểm ≥3 tuyến p/s đi qua (lưới 3 đơn vị), trong bán kính 300, cách nhau ≥45
const cellCnt = new Map();
for (const r of ROADS_DT) if (r.c === 'p' || r.c === 's') {
  const seen = new Set();
  for (const [x, z] of r.pts) {
    const k = Math.round(x / 12) + ',' + Math.round(z / 12);
    if (!seen.has(k)) { seen.add(k); cellCnt.set(k, (cellCnt.get(k) || 0) + 1); }
  }
}
const INTERSECTIONS = [];
for (const [k, c] of [...cellCnt.entries()].sort((a, b) => b[1] - a[1])) {
  if (c < 3) continue;
  const [gx, gz] = k.split(',').map(Number);
  const x = gx * 12, z = gz * 12;
  if (x * x + z * z > 1500 * 1500) continue;
  if (INTERSECTIONS.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 180 * 180)) continue;
  INTERSECTIONS.push([x, z]);
  if (INTERSECTIONS.length >= 20) break;
}
console.log('INTERSECTIONS:', INTERSECTIONS.length);

// MEDIANS: tuyến dài nhất của các đại lộ có dải phân cách thật
const MEDIANS = [];
// Đợt 3 W3-A (AUDIT3 XSEC/CAMOBS): tuyến dài nhất mang tên 'Trần Hưng Đạo' là đoạn BẮC-NAM x≈650-670 dọc tường mỏ neo
// Hải quân (z −880…−450) — ảnh thật pano_222/223/224/225/226/227 đều là MỘT lòng + tim vàng, KHÔNG dải phân cách; bồn/cây
// dải giả đứng 1,5-3 m trước camera (QA clearance). Tên nào ở đây → không xuất dải phân cách.
const NO_MEDIAN = ['Trần Hưng Đạo'];
for (const nm of ['Trần Hưng Đạo', 'Trần Phú', 'Điện Biên Phủ']) {
  if (NO_MEDIAN.includes(nm)) continue;
  const key = Object.keys(streetAgg).find((k) => k.includes(nm));
  if (key) MEDIANS.push(streetAgg[key].best.map(([x, z]) => [Math.round(x), Math.round(z)]));
}
console.log('MEDIANS:', MEDIANS.map((m) => m.length));

// ---------- Dải VƯỜN HOA trung tâm (chuỗi vườn hoa đặc trưng Hải Phòng) ----------
// Snap mỗi vườn vào POLYGON CÔNG VIÊN THẬT gần nhất (OSM) để phủ ĐÚNG cả ô (vị trí + kích thước
// thật), thay vì rectangle đặt tay bé/lệch. Dùng bbox của polygon.
function parkBBoxNear(gx, gz, maxD = 130) {
  let best = null, bd = maxD;
  for (const pts of PARKS) {
    let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
    for (const [x, z] of pts) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, d = Math.hypot(cx - gx, cz - gz);
    if (d < bd) { bd = d; best = { x: Math.round(cx), z: Math.round(cz), w: Math.round(x2 - x1), d: Math.round(z2 - z1) }; }
  }
  return best;
}
const GARDENS = [
  { n: 'An Biên', lon: 106.68060, lat: 20.85622, w: 58, d: 42 },
  { n: 'Nguyễn Văn Trỗi', lon: 106.68309, lat: 20.85687, w: 54, d: 40 },
  { n: 'Nguyễn Bỉnh Khiêm', lon: 106.68481, lat: 20.85772, w: 60, d: 44 },
  { n: 'Nguyễn Du', lon: 106.68645, lat: 20.85890, w: 70, d: 50 },
  { n: 'Kim Đồng', lon: 106.68794, lat: 20.86053, w: 58, d: 44 },
  { n: 'Tố Hữu', lon: 106.68862, lat: 20.86356, w: 54, d: 40 },
].map((g) => {
  const [gx, gz] = toXZ(g.lon, g.lat);
  const bb = parkBBoxNear(gx, gz);
  if (bb) return { n: g.n, x: bb.x, z: bb.z, w: bb.w, d: bb.d };   // dùng polygon công viên thật
  return { n: g.n, x: Math.round(gx), z: Math.round(gz), w: g.w, d: g.d };
});
console.log('GARDENS:', JSON.stringify(GARDENS.map((g) => g.n + '[' + g.x + ',' + g.z + ']')));
console.log('LM_SIZE:', JSON.stringify(LM_SIZE));
console.log('LM:', JSON.stringify(LM));
console.log('LM_DIR:', JSON.stringify(LM_DIR));
console.log('EXTRAS:', JSON.stringify(EXTRAS));

// ---------- Ghi file ----------
const out = `// SINH TỰ ĐỘNG từ dữ liệu OpenStreetMap (ODbL) — bản đồ Hải Phòng thật
// Tỉ lệ 1:1 MÉT THẬT — không phóng đại
// © OpenStreetMap contributors — https://www.openstreetmap.org/copyright
export const WORLD = ${JSON.stringify(WORLD)};
export const DT_BOX = ${JSON.stringify(dtBox)};
export const MASK = { w: ${MW}, h: ${MH}, cell: ${CELL}, b64: '${maskB64}' };
export const RIVERS = ${JSON.stringify(RIVERS)};
export const ROADS_DT = ${JSON.stringify(ROADS_DT.map(({ c, pts, w, sw, sp }) => ({ ...(w > 0 ? (sw >= 0 ? { c, pts, w, sw } : { c, pts, w }) : { c, pts }), ...(sp >= 0 ? { sp } : {}) })))};
export const ROADS_REGION = ${JSON.stringify(ROADS_REGION.map(({ pts }) => ({ pts })))};
export const LM = ${JSON.stringify(LM)};
export const LM_DIR = ${JSON.stringify(LM_DIR)};
export const LM_SIZE = ${JSON.stringify(LM_SIZE)};
export const LM_FACE = ${JSON.stringify(LM_FACE)};
export const FACADE_SHORT_SIDE = ${JSON.stringify(FACADE_SHORT_SIDE)};
export const EXTRAS = ${JSON.stringify(EXTRAS)};
export const TREES = ${JSON.stringify(TREES)};
export const RAIL = ${JSON.stringify(RAIL)};
export const PARKS = ${JSON.stringify(PARKS)};
export const STREETS = ${JSON.stringify(STREETS)};
export const INTERSECTIONS = ${JSON.stringify(INTERSECTIONS)};
export const MEDIANS = ${JSON.stringify(MEDIANS)};
export const GARDENS = ${JSON.stringify(GARDENS)};
export const BUILDINGS = ${JSON.stringify(BUILDINGS)};
export const WATER = ${JSON.stringify(WATER)};
export const BRIDGE_WAYS = ${JSON.stringify(BRIDGE_WAYS)};
export const BEACHES = ${JSON.stringify(BEACHES)};
`;
fs.writeFileSync(new URL('../js/mapdata.js', import.meta.url), out);   // relative (portable Win/Linux)
console.log(`mapdata.js: ${(out.length / 1024).toFixed(0)}KB`);
