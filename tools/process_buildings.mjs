// process_buildings.mjs — footprint THẬT (Overture: OSM + Google Open Buildings + Microsoft ML) → js/buildings_real.js
// (định dạng RB01, xem js/buildings_data.js). Chạy: node tools/process_buildings.mjs   (cần tools/ov_buildings.csv —
// tải bằng python tools/fetch_overture.py).
//
// v0 (2026-10-04, phiên dựng nền Đợt 3): dịch theo nguồn, lọc nước/lòng đường, gán loại cạnh (mặt phố/hông/sau),
// số tầng theo PHÂN BỐ PANO (không theo diện tích — R²=0.03), kiểu + màu theo seed. Các bước nâng cao (kéo mặt tiền
// sát vỉa hè, tách lô nhà ống, lấp khe mặt phố, tầng theo pano gần nhất, khử trùng lặp, claim địa danh) — xem
// KNOWLEDGE §7b khi đã làm.
import fs from 'fs';
import { ROADS_DT } from '../js/mapdata.js';
import { waterSD } from '../js/terrain.js';
import { ROAD_HW, facadeLine } from '../js/xsection.js';
import { encodeRB, signedArea, edgeNormal, STYLE, ROOF, FLAG, EDGE, WALL_PALETTE } from '../js/buildings_data.js';

const T0 = Date.now();
const R_MAX = 1750;                     // > PLAY_RADIUS 1588 + tầm nhìn mép
const LON0 = 106.68182, LAT0 = 20.85750;
const UX = 111320 * Math.cos((LAT0 * Math.PI) / 180), UZ = 110574;
const SHIFT = { 'Microsoft ML Buildings': [-1, -1], 'Google Open Buildings': [-1, -2.5], OpenStreetMap: [0, 0] };

// ---------- đọc CSV (WKT là cột cuối, có ngoặc kép) ----------
const csv = fs.readFileSync(new URL('./ov_buildings.csv', import.meta.url), 'utf8').split('\n');
const raw = [];
for (let li = 1; li < csv.length; li++) {
  const L = csv[li]; if (!L) continue;
  const w = L.search(/"?(MULTI)?POLYGON/); if (w < 0) continue;
  const pre = L.slice(0, w).split(',');
  const src = pre[11], id = pre[0], nfl = pre[3] ? +pre[3] : 0, hgt = pre[2] ? +pre[2] : 0, cls = pre[4] || '';
  // lấy MỌI vòng ngoài (MULTIPOLYGON: chọn vòng diện tích lớn nhất), bỏ lỗ
  const rings = [];
  for (const m of L.slice(w).matchAll(/\(\(([^()]*)\)/g)) {
    const r = m[1].split(',').map((s) => s.trim().split(/\s+/).map(Number))
      .map(([lo, la]) => [(lo - LON0) * UX, -(la - LAT0) * UZ]);
    r.pop(); rings.push(r);
  }
  if (!rings.length) continue;
  rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const sh = SHIFT[src] || [0, 0];
  raw.push({ id, src, nfl, hgt, cls, pts: rings[0].map(([x, z]) => [x + sh[0], z + sh[1]]) });
}

// ---------- lưới đoạn đường (lòng đường thật, gồm cả ngõ h) ----------
const SEGS = [];
for (const r of ROADS_DT) for (let i = 0; i + 1 < r.pts.length; i++) {
  const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
  SEGS.push({ ax, az, bx, bz, c: r.c, hw: ROAD_HW[r.c] ?? 2.75, fl: facadeLine(r.c) });
}
const SC = 40, sgrid = new Map();
const skey = (i, j) => i * 100003 + j;
SEGS.forEach((s, k) => {
  const pad = s.fl + 12;
  for (let i = Math.floor((Math.min(s.ax, s.bx) - pad) / SC); i <= Math.floor((Math.max(s.ax, s.bx) + pad) / SC); i++)
    for (let j = Math.floor((Math.min(s.az, s.bz) - pad) / SC); j <= Math.floor((Math.max(s.az, s.bz) + pad) / SC); j++) {
      const kk = skey(i, j); let a = sgrid.get(kk); if (!a) sgrid.set(kk, (a = [])); a.push(k);
    }
});
function segDist(px, pz, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
  let t = ((px - s.ax) * dx + (pz - s.az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - s.ax - t * dx, pz - s.az - t * dz);
}
// khoảng cách tới MÉP LÒNG (âm = trong lòng đường) của đoạn gần nhất
function roadEdgeDist(px, pz) {
  const a = sgrid.get(skey(Math.floor(px / SC), Math.floor(pz / SC))); let best = 1e9, bs = null;
  if (a) for (const k of a) { const s = SEGS[k]; const d = segDist(px, pz, s) - s.hw; if (d < best) { best = d; bs = s; } }
  return [best, bs];
}

// ---------- hash ổn định theo id ----------
function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; return (s >>> 0) / 4294967296; }; }
const pickW = (r, w) => { let t = r * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; } return w.length - 1; };

// Phân bố số tầng từ 1.133 quan sát pano (bản đồ dự án §2.9): 1:4.3% 2:29.7% 3:41% 4:16% 5:3.6% 6:2.2% 7+:3.2%
const FLOOR_W = [4.3, 29.7, 41, 16, 3.6, 2.2, 1.2, 0.8, 0.5, 0.4, 0.3];

// ---------- xử lý ----------
const stats = { raw: raw.length, far: 0, small: 0, water: 0, road: 0, kept: 0 };
const out = [];
for (const b of raw) {
  let pts = b.pts;
  let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
  if (Math.hypot(cx, cz) > R_MAX) { stats.far++; continue; }
  const area = Math.abs(signedArea(pts));
  if (area < 10 || pts.length < 3) { stats.small++; continue; }
  if (waterSD(cx, cz) < 0) { stats.water++; continue; }
  // > 1/2 số đỉnh hoặc tâm nằm trong lòng đường → bỏ (sà lan, nhà vẽ trùm đường)
  let inRoad = 0; for (const [x, z] of pts) if (roadEdgeDist(x, z)[0] < -0.3) inRoad++;
  if (roadEdgeDist(cx, cz)[0] < 0 || inRoad > pts.length / 2) { stats.road++; continue; }
  if (signedArea(pts) > 0) pts = pts.slice().reverse();   // về thứ tự tường-ra-ngoài
  const n = pts.length, R = rng(hash32(b.id));
  // loại cạnh: dò ra ngoài theo pháp tuyến tới mặt tiền chuẩn + 6 m — chạm lòng đường = MẶT PHỐ
  const edge = new Array(n).fill(EDGE.SIDE);
  let frontN = null, frontLen = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const L = Math.hypot(bx - ax, bz - az); if (L < 1.5) continue;
    const [nx, nz] = edgeNormal(ax, az, bx, bz);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    for (const t of [0.25, 0.5, 0.75]) {
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      let hit = false;
      for (let d = 0.5; d <= 13; d += 0.75) {
        const [dd, s] = roadEdgeDist(px + nx * d, pz + nz * d);
        if (dd < 0) { hit = d <= s.fl - s.hw + 6.5; break; }
      }
      if (hit) { edge[i] = EDGE.FRONT; if (L > frontLen) { frontLen = L; frontN = [nx, nz]; } break; }
    }
    void mx; void mz;
  }
  if (frontN) for (let i = 0; i < n; i++) {
    if (edge[i] !== EDGE.SIDE) continue;
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const [nx, nz] = edgeNormal(ax, az, bx, bz);
    if (nx * frontN[0] + nz * frontN[1] < -0.7) edge[i] = EDGE.BACK;
  }
  // số tầng
  let floors = b.nfl > 0 ? Math.round(b.nfl) : 1 + pickW(R(), FLOOR_W);
  if (!b.nfl && area < 25) floors = Math.min(floors, 2);
  if (!b.nfl && area > 1500) floors = Math.max(floors, 3 + Math.floor(R() * 4));
  if (b.hgt > 0) floors = Math.max(1, Math.round((b.hgt - 0.6) / 3.3));
  floors = Math.max(1, Math.min(30, floors));
  // kích thước đặc trưng: cạnh ngắn của hình chữ nhật bao theo trục cạnh dài nhất
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < n; i++) { const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n]; const L = Math.hypot(bx - ax, bz - az); if (L > best) { best = L; ux = (bx - ax) / L; uz = (bz - az) / L; } }
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, z] of pts) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const minSide = Math.min(u1 - u0, v1 - v0);
  // kiểu
  let style;
  if (area > 1200 && floors >= 5) style = R() < 0.55 ? STYLE.KTT : STYLE.GLASS;
  else if (area > 900 && floors <= 2) style = STYLE.SHED;
  else if (area > 500) style = [STYLE.CIVIC, STYLE.KTT, STYLE.TUBE, STYLE.VILLA][pickW(R(), [3, 3, 3, 1.5])];
  else if (minSide < 7.5) style = R() < 0.68 ? STYLE.TUBE : STYLE.OLD;
  else style = [STYLE.TUBE, STYLE.OLD, STYLE.VILLA][pickW(R(), [6, 3, 1])];
  // mái: nhà thấp/kho hay mái tôn dốc; biệt thự ngói; còn lại mái bằng có lan can
  let roofType = ROOF.FLAT_PARAPET;
  if (style === STYLE.SHED) roofType = R() < 0.7 ? ROOF.GABLE_TON : ROOF.SHED_TON;
  else if (style === STYLE.VILLA) roofType = R() < 0.7 ? ROOF.HIP_TILE : ROOF.FLAT_PARAPET;
  else if (floors <= 2 && R() < 0.4) roofType = R() < 0.6 ? ROOF.GABLE_TON : ROOF.HIP_TILE;
  else if (R() < 0.12) roofType = ROOF.FLAT;
  const roofColor = roofType === ROOF.FLAT_PARAPET || roofType === ROOF.FLAT ? [5, 6, 13, 9, 15][pickW(R(), [4, 3, 1, 1, 1])]
    : roofType === ROOF.HIP_TILE ? [2, 1, 14, 10][pickW(R(), [4, 2, 2, 1])]
      : [0, 1, 3, 4, 12, 8, 7][pickW(R(), [5, 3, 2, 2, 1, 1, 1])];
  const wall = Math.floor(R() * WALL_PALETTE.length);
  const flags = (b.src === 'OpenStreetMap' ? FLAG.OSM : b.src.startsWith('Google') ? FLAG.GOOGLE : FLAG.MS) | (area > 800 ? FLAG.BIG : 0);
  out.push({ pts, edge, cover: new Array(n).fill(0), floors, style, wall, roofType, roofColor, flags, seed: hash32(b.id + 's') & 0xffff });
  stats.kept++;
}

const bytes = encodeRB(out);
const b64 = Buffer.from(bytes).toString('base64');
const meta = { version: 1, generator: 'process_buildings.mjs v0', count: out.length, rMax: R_MAX, stats };
fs.writeFileSync(new URL('../js/buildings_real.js', import.meta.url),
  '// SINH TỰ ĐỘNG bởi tools/process_buildings.mjs — ĐỪNG SỬA TAY. Định dạng RB01: xem js/buildings_data.js.\n' +
  '// Nguồn: Overture Maps buildings (OpenStreetMap ODbL; Google Open Buildings CC BY 4.0/ODbL; Microsoft ML Buildings ODbL).\n' +
  `export const RB_META = ${JSON.stringify(meta)};\n` +
  `export const RB_B64 = "${b64}";\n`);
console.log(JSON.stringify(stats), 'bytes', bytes.length, 'b64', b64.length, ((Date.now() - T0) / 1000).toFixed(1) + 's');
