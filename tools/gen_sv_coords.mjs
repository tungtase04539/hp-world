// Sinh danh sách tọa độ (lat,lng) bám ĐƯỜNG THẬT dải trung tâm Hải Phòng cho
// extension chụp Street View (tools/streetview-capture/coords.js).
// Lấy ngược phép chiếu của dự án: XZ (mét) -> lon/lat.
//   toXZ:  x=(lon-LON0)*UX,  z=-(lat-LAT0)*UZ   (xem tools/process_osm.mjs)
//   invert: lon=LON0+x/UX,   lat=LAT0 - z/UZ
// Chạy:  node tools/gen_sv_coords.mjs [radius_m] [spacing_m]
import { ROADS_DT } from '../js/mapdata.js';
import { writeFileSync } from 'node:fs';

const LON0 = 106.68182, LAT0 = 20.85750;
const UX = 111320 * Math.cos(LAT0 * Math.PI / 180), UZ = 110574;
const inv = (x, z) => [+(LAT0 - z / UZ).toFixed(6), +(LON0 + x / UX).toFixed(6)];

const R = +(process.argv[2] || 1100);       // bán kính quanh trung tâm (m)
const STEP = +(process.argv[3] || 40);       // khoảng cách lấy mẫu dọc đường (m)
const DEDUP = STEP;                           // gộp điểm gần nhau

const raw = [];
for (const r of ROADS_DT) {
  if (!['p', 's', 't'].includes(r.c)) continue;   // phố chính (bỏ ngõ nhỏ r/w)
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    for (let s = 0; s < len; s += STEP) {
      const t = s / len, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      if (Math.hypot(x, z) <= R) raw.push([x, z]);
    }
  }
}
const kept = [];
for (const [x, z] of raw) if (!kept.some(([kx, kz]) => Math.hypot(kx - x, kz - z) < DEDUP)) kept.push([x, z]);
const coords = kept.map(([x, z]) => { const [lat, lng] = inv(x, z); return { lat, lng }; });

writeFileSync(new URL('./streetview-capture/coords.js', import.meta.url),
  `// Tọa độ dải trung tâm Hải Phòng (bám đường thật OSM của dự án, cách ~${STEP}m).\n` +
  `// Sinh tự động từ js/mapdata.js bằng tools/gen_sv_coords.mjs (radius=${R}m).\n` +
  `export const WAYPOINTS = ${JSON.stringify(coords)};\n`);
console.log(`Đã ghi ${coords.length} tọa độ vào tools/streetview-capture/coords.js (R=${R}m, step=${STEP}m).`);
