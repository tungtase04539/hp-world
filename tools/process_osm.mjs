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
for (const w of dtRoads) {
  const c = CLS[w.tags?.highway];
  if (!c || !w.geometry) continue;
  const pts = rnd(simplify(subdiv(w.geometry, 150), 6));
  if (pts.length < 2) continue;
  const len = plLen(pts);
  if (c === 'r' && len < 260 && !isCentralRoad(pts)) continue;   // giữ phố nhỏ trong lõi
  if (c === 'w' && len < 150) continue;
  ROADS_DT.push({ c, pts, name: w.tags?.name || '' });
}
console.log(`roads downtown: ${ROADS_DT.length}`);
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
addNode('station', 106.68752, 20.85602);
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

// mặt tiền các tòa chưa có mục tiêu: quay về phố gần nhất
function nearestRoadPoint(cx, cz) {
  let best = null, bd = 1e18;
  for (const r of ROADS_DT) {
    if (r.c === 'r' || r.c === 'w') continue; // mặt tiền quay ra phố lớn, không ngõ nhỏ
    for (const [px, pz] of r.pts) {
      const d = (px - cx) ** 2 + (pz - cz) ** 2;
      if (d < bd) { bd = d; best = [px, pz]; }
    }
  }
  return best;
}
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

for (const key of ['cathedral', 'postoffice', 'museum', 'market', 'thptnq', 'thcsnq', 'thcstp', 'ubnd', 'rap78', 'dinhhk', 'chuahang', 'dentamky', 'dennghe', 'nhaken', 'nhnn']) {
  const [cx, cz] = LM[key];
  const rp = nearestRoadPoint(cx, cz);
  const f = [rp[0] - cx, rp[1] - cz];
  const l = Math.hypot(...f) || 1;
  LM_FACE[key] = [Math.round(f[0] / l * 1000) / 1000, Math.round(f[1] / l * 1000) / 1000];
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
  const nearGa = Math.hypot(cx - LM.station[0], cz - LM.station[1]) < 350;
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
for (const nm of ['Trần Hưng Đạo', 'Trần Phú', 'Điện Biên Phủ']) {
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
export const ROADS_DT = ${JSON.stringify(ROADS_DT.map(({ c, pts }) => ({ c, pts })))};
export const ROADS_REGION = ${JSON.stringify(ROADS_REGION.map(({ pts }) => ({ pts })))};
export const LM = ${JSON.stringify(LM)};
export const LM_DIR = ${JSON.stringify(LM_DIR)};
export const LM_SIZE = ${JSON.stringify(LM_SIZE)};
export const LM_FACE = ${JSON.stringify(LM_FACE)};
export const EXTRAS = ${JSON.stringify(EXTRAS)};
export const TREES = ${JSON.stringify(TREES)};
export const RAIL = ${JSON.stringify(RAIL)};
export const PARKS = ${JSON.stringify(PARKS)};
export const STREETS = ${JSON.stringify(STREETS)};
export const INTERSECTIONS = ${JSON.stringify(INTERSECTIONS)};
export const MEDIANS = ${JSON.stringify(MEDIANS)};
export const GARDENS = ${JSON.stringify(GARDENS)};
export const BUILDINGS = ${JSON.stringify(BUILDINGS)};
`;
fs.writeFileSync(new URL('../js/mapdata.js', import.meta.url), out);   // relative (portable Win/Linux)
console.log(`mapdata.js: ${(out.length / 1024).toFixed(0)}KB`);
