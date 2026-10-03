// gen_landmark_polys.mjs — xuất ĐA GIÁC footprint OSM THẬT của các địa danh (LM_POLY) + tâm diện tích (LM_CENTROID)
// → js/landmark_polys.js. Bổ trợ mapdata.js (LM là trung bình đỉnh, lệch tới 22 m) mà KHÔNG chạm 21 export cũ.
// Chạy: node tools/gen_landmark_polys.mjs  (cần tools/osm_lm_geom.json, osm_lm2_geom.json, osm_lm3_geom.json,
// osm_school_geom.json, osm_buildings.json — tải bằng bash tools/fetch_osm.sh)
import fs from 'fs';
const LON0 = 106.68182, LAT0 = 20.85750, UX = 111320 * Math.cos((LAT0 * Math.PI) / 180), UZ = 110574;
const toXZ = (lon, lat) => [(lon - LON0) * UX, -(lat - LAT0) * UZ];
const load = (f) => { const j = JSON.parse(fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8')); return j.elements || j; };
const geom = {};
for (const f of ['osm_lm_geom.json', 'osm_lm2_geom.json', 'osm_lm3_geom.json', 'osm_school_geom.json']) for (const e of load(f)) if (e.geometry) geom[e.id] = e;
for (const e of load('osm_buildings.json')) if (e.id === 241081956 || e.id === 240463140) geom[e.id] = e;
const KEYS = { opera: 242055606, quanhoa: 242169916, square: 242169920, cathedral: 174683856, postoffice: 242226546, museum: 1049831208,
  market: 1175766946, ubnd: 1124706318, rap78: 868234608, dinhhk: 240394078, chuahang: 236830096, dentamky: 961921403, nhnn: 242192606,
  thptnq: 242169921, thcsnq: 240463141, thcstp: 1120513525, station_bldg: 241081956, trienlam: 240463140, viettiep: 961958396 };
const POLY = {}, CEN = {};
for (const [k, id] of Object.entries(KEYS)) {
  const e = geom[id]; if (!e) { console.warn('thiếu', k, id); continue; }
  const pts = e.geometry.map((g) => toXZ(g.lon, g.lat).map((v) => Math.round(v * 10) / 10));
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  let A = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; const c = x1 * z2 - x2 * z1; A += c; cx += (x1 + x2) * c; cz += (z1 + z2) * c; }
  A /= 2; POLY[k] = pts; CEN[k] = [Math.round((cx / (6 * A)) * 10) / 10, Math.round((cz / (6 * A)) * 10) / 10];
}
fs.writeFileSync(new URL('../js/landmark_polys.js', import.meta.url),
  '// SINH TỰ ĐỘNG bởi tools/gen_landmark_polys.mjs — ĐỪNG SỬA TAY. Footprint OSM thật của địa danh (toạ độ game, mét).\n' +
  '// LM_CENTROID = tâm DIỆN TÍCH (mapdata.LM là trung bình đỉnh, lệch tới 22 m — giữ LM cũ cho mọi thứ đã hiệu chỉnh theo nó).\n' +
  `export const LM_POLY = ${JSON.stringify(POLY)};\nexport const LM_CENTROID = ${JSON.stringify(CEN)};\n`);
console.log(Object.keys(POLY).length, 'polys', JSON.stringify(CEN));
