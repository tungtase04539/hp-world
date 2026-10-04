// tools/gen_landuse.mjs — RASTER SỬ DỤNG ĐẤT ±2048 m, 2 m/điểm ảnh (2048²) → js/landuse_data.js (Đợt 3 wave 2 W2-D)
// Chạy ở gốc repo: node tools/gen_landuse.mjs [--png out.png]   (--png: ảnh xem nhanh, cần python+PIL? KHÔNG: tự ghi PPM)
// Nguồn (đều có sẵn hoặc tải được):
//   tools/osm_landuse.json  — Overpass (landuse/amenity/leisure/natural/place/...), xem lệnh tải trong fetch_osm.sh mục 12
//   js/mapdata.js PARKS     — công viên/vườn hoa OSM đã dùng trong game
//   js/landmark_polys.js    — footprint thật 19 địa danh (nhà) + sân trước (đệm quảng trường)
//   js/buildings_real.js    — footprint nhà thật RB01 (đúng bộ game vẽ) → lớp NHÀ + KHOẢNG CÁCH tới tường gần nhất
//   tools/osm_alleys.json   — lối đi footway/path TRONG công viên → lối lát gạch
// Ra: 2 mặt phẳng byte nén deflate-raw, base64:
//   CLS[i] = lớp (0..15, bảng LU_CLASS)          — tô đa giác theo THỨ TỰ ƯU TIÊN (sau đè trước)
//   DST[i] = min(255, round(d·8)), d = khoảng cách (m) tới điểm ảnh NHÀ gần nhất (EDT chính xác, Felzenszwalb)
//   cả 2 lọc "Up" (byte − byte hàng trên, mod 256) trước khi nén → mặt phẳng khoảng cách trơn nén ~10×.
// Toạ độ: điểm ảnh (i, j) phủ x ∈ [X0 + i·RES, X0 + (i+1)·RES), z tương tự; hàng j tăng theo +z (NAM).
import fs from 'fs';
import zlib from 'zlib';
import { PARKS } from '../js/mapdata.js';
import { LM_POLY } from '../js/landmark_polys.js';
import { decodeRB } from '../js/buildings_data.js';
import { RB_B64 } from '../js/buildings_real.js';

const N = 2048, RES = 2, X0 = -2048, Z0 = -2048;
const LU_GRID = { n: N, res: RES, x0: X0, z0: Z0 };
const LON0 = 106.68182, LAT0 = 20.85750;
const UX = 111320 * Math.cos(LAT0 * Math.PI / 180), UZ = 110574;
const toXZ = (lon, lat) => [(lon - LON0) * UX, -(lat - LAT0) * UZ];

// bảng lớp — CHỈ SỐ là hợp đồng với js/landuse.js (shader) — thêm lớp mới thì sửa cả 2
export const C = {
  NAT: 0,      // đất tự nhiên / không dữ liệu → màu đỉnh cũ (vertexHC)
  URB: 1,      // nền phố: sân bê tông, ngõ, khe nhà — shader đổi theo khoảng cách tới tường (sát tường: bê tông ố; xa: bãi trống)
  IND: 2,      // khu công nghiệp / cảng / xưởng / kho: bê tông tấm lớn ố dầu
  PLAZA: 3,    // quảng trường / phố đi bộ / sân trước công trình lớn: đá lát xám
  TEMPLE: 4,   // sân chùa / đền / nhà thờ: gạch đỏ (gạch Bát Tràng)
  CAMPUS: 5,   // sân trường / bệnh viện / cơ quan: bê tông sáng + gạch block
  PARK: 6,     // bãi đỗ xe: nhựa sẫm
  DIRT: 7,     // công trường / đất bỏ hoang / bãi cát: đất nện
  GRASS: 8,    // cỏ công viên / vườn hoa / thảm cỏ
  ROUGH: 9,    // cỏ dại / bụi / ruộng / đất ướt / nghĩa trang
  TURF: 10,    // sân bóng cỏ nhân tạo
  COURT: 11,   // sân tennis / bóng rổ (sơn acrylic)
  TRACK: 12,   // đường chạy (cao su đỏ)
  POOL: 13,    // bể bơi
  MARKET: 14,  // chợ: bê tông bẩn ẩm
  BLD: 15,     // trong footprint nhà (bị nhà che; chỉ để tính khoảng cách)
};

// ---------- tô đa giác (even-odd, tâm điểm ảnh) ----------
const cls = new Uint8Array(N * N);   // 0 = NAT
function fillRings(rings, val, mask = null) {
  // rings: [[[x,z],...], ...] — even-odd trên TẬP vòng (lỗ = vòng trong)
  let zmin = 1e9, zmax = -1e9;
  for (const r of rings) for (const p of r) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
  const j0 = Math.max(0, Math.ceil((zmin - Z0) / RES - 0.5)), j1 = Math.min(N - 1, Math.floor((zmax - Z0) / RES - 0.5));
  const xs = [];
  let n = 0;
  for (let j = j0; j <= j1; j++) {
    const z = Z0 + (j + 0.5) * RES;
    xs.length = 0;
    for (const r of rings) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, za] = r[a], [xb, zb] = r[b];
        if ((za > z) !== (zb > z)) xs.push(xa + (z - za) * (xb - xa) / (zb - za));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - X0) / RES - 0.5)), i1 = Math.min(N - 1, Math.floor((xs[k + 1] - X0) / RES - 0.5));
      for (let i = i0; i <= i1; i++) { const o = j * N + i; if (!mask || mask(cls[o])) { cls[o] = val; n++; } }
    }
  }
  return n;
}
// vẽ đoạn thẳng dày w (m) — lối đi trong công viên
function strokeLine(pts, w, val, mask) {
  const hw = w / 2;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01) continue;
    const nx = -dz / L * hw, nz = dx / L * hw;
    fillRings([[[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]], val, mask);
  }
}

// ---------- ghép vòng multipolygon (relation: các way outer/inner nối đầu-cuối) ----------
function assembleRings(ways) {
  const segs = ways.map((w) => w.slice()), rings = [];
  const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 1000) {
      const end = key(ring[ring.length - 1]);
      let k = segs.findIndex((s) => key(s[0]) === end);
      if (k >= 0) { ring = ring.concat(segs.splice(k, 1)[0].slice(1)); continue; }
      k = segs.findIndex((s) => key(s[s.length - 1]) === end);
      if (k >= 0) { ring = ring.concat(segs.splice(k, 1)[0].reverse().slice(1)); continue; }
      break;   // hở — vẫn dùng (even-odd tự khép)
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// ---------- phân lớp thẻ OSM → (lớp, ưu tiên) ; ưu tiên cao tô SAU ----------
function classify(t) {
  const lu = t.landuse, am = t.amenity, le = t.leisure, na = t.natural;
  if (le === 'swimming_pool' || (le === 'pitch' && t.sport === 'swimming')) return [C.POOL, 90];
  if (le === 'track') return [C.TRACK, 85];
  if (le === 'pitch') {
    if (t.building) return null;   // sân có mái (đã là nhà)
    if (t.sport === 'soccer' || t.surface === 'artificial_turf' || t.surface === 'grass') return [C.TURF, 84];
    return [C.COURT, 84];
  }
  if (le === 'stadium') return [C.TURF, 40];            // sân vận động: cỏ (khán đài là nhà → BLD đè)
  if (am === 'parking' && t.parking !== 'street_side' && t.parking !== 'underground' && t.parking !== 'multi-storey') return [C.PARK, 70];
  if (t.place === 'square' || (t.highway === 'pedestrian') || (t['area:highway'] && t['area:highway'] !== 'traffic_island')) return [C.PLAZA, 75];
  if (t.historic === 'monument' || t.historic === 'memorial') return [C.PLAZA, 74];
  if (le === 'playground') return [C.PLAZA, 72];
  if (am === 'place_of_worship' || lu === 'religious' || am === 'monastery') return [C.TEMPLE, 60];
  if (am === 'marketplace') return [C.MARKET, 58];
  if (le === 'park' || le === 'garden' || le === 'common' || le === 'recreation_ground' || le === 'golf_course' || le === 'miniature_golf' ||
      lu === 'grass' || lu === 'flowerbed' || lu === 'village_green' || lu === 'recreation_ground') return [C.GRASS, 50];
  if (['school', 'kindergarten', 'college', 'university', 'hospital', 'clinic', 'townhall', 'police', 'courthouse', 'library',
       'community_centre', 'arts_centre', 'theatre', 'cinema', 'fire_station', 'prison', 'bus_station'].includes(am) ||
      le === 'sports_centre' || le === 'fitness_centre' || le === 'sports_hall' || t.tourism === 'museum') return [C.CAMPUS, 45];
  if (am === 'fuel') return [C.PLAZA, 46];
  // công trường mang tên công viên/quảng trường (Tam Bạc, Hạ Lý, Nam Bính...) — ảnh vệ tinh 2026 đã là sân lát + cây
  if (lu === 'construction' && /^(Công viên|Quảng trường)/.test(t.name || '')) return [C.PLAZA, 31];
  if (lu === 'construction' || lu === 'brownfield' || lu === 'greenfield' || lu === 'landfill' || na === 'bare_ground' || na === 'sand') return [C.DIRT, 30];
  if (lu === 'farmland' || lu === 'orchard' || lu === 'allotments' || lu === 'meadow' || lu === 'plant_nursery' || lu === 'cemetery' ||
      lu === 'forest' || na === 'wood' || na === 'scrub' || na === 'grassland' || na === 'wetland' || na === 'heath') return [C.ROUGH, 25];
  if (lu === 'industrial' || lu === 'port' || lu === 'railway' || lu === 'garages' || lu === 'depot' || lu === 'military' || t.military ||
      t.man_made === 'works' || t.man_made === 'wastewater_plant' || t.man_made === 'pier') return [C.IND, 20];
  if (lu === 'residential' || lu === 'commercial' || lu === 'retail' || lu === 'office') return [C.URB, 10];
  return null;
}

const t0 = Date.now();
const stats = {};
// (0) nền: toàn ô = URB (thành phố liên tục; ngoài vùng có nhà shader vẫn ra "bãi trống" theo khoảng cách)
cls.fill(C.URB);

// (1) đa giác OSM theo ưu tiên
const osm = JSON.parse(fs.readFileSync('tools/osm_landuse.json', 'utf8'));
const polys = [];
for (const e of osm.elements) {
  const c = classify(e.tags || {});
  if (!c) continue;
  let rings = [];
  if (e.type === 'way' && e.geometry && e.geometry.length >= 3) rings = [e.geometry.map((g) => toXZ(g.lon, g.lat))];
  else if (e.type === 'relation' && e.members) {
    const outer = [], inner = [];
    for (const m of e.members) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? inner : outer).push(m.geometry.map((g) => toXZ(g.lon, g.lat)));
    rings = assembleRings(outer).concat(assembleRings(inner));
  }
  if (!rings.length) continue;
  polys.push({ cls: c[0], pri: c[1], rings, id: e.type[0] + e.id });
}
// ưu tiên tăng dần; cùng ưu tiên: đa giác LỚN tô trước (nhỏ nằm trong lớn thắng)
const areaOf = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(s / 2); };
for (const p of polys) p.area = p.rings.reduce((s, r) => s + areaOf(r), 0);
polys.sort((a, b) => a.pri - b.pri || b.area - a.area);
// (1b) PARKS của game (mapdata) = cỏ, ưu tiên như park OSM — chèn trước các lớp ưu tiên > 50
const gamePark = PARKS.map((pts) => ({ cls: C.GRASS, pri: 50, rings: [pts], id: 'PARKS', area: areaOf(pts) }));
const all = polys.concat(gamePark).sort((a, b) => a.pri - b.pri || b.area - a.area);
for (const p of all) { const n = fillRings(p.rings, p.cls); stats['poly_' + p.cls] = (stats['poly_' + p.cls] || 0) + n; }

// (2) lối đi lát trong công viên/quảng trường cỏ: footway/path/pedestrian của osm_alleys nằm trong vùng GRASS
try {
  const al = JSON.parse(fs.readFileSync('tools/osm_alleys.json', 'utf8'));
  let np = 0;
  for (const e of al.elements) {
    const t = e.tags || {};
    if (!e.geometry || !/^(footway|path|pedestrian)$/.test(t.highway || '')) continue;
    const pts = e.geometry.map((g) => toXZ(g.lon, g.lat));
    // chỉ đoạn có ≥ 60 % đỉnh trong cỏ (lối ngoài công viên do mạng đường WP6 vẽ)
    let inG = 0;
    for (const [x, z] of pts) { const i = Math.floor((x - X0) / RES), j = Math.floor((z - Z0) / RES); if (i >= 0 && j >= 0 && i < N && j < N && cls[j * N + i] === C.GRASS) inG++; }
    if (inG < pts.length * 0.6) continue;
    strokeLine(pts, t.highway === 'pedestrian' ? 4 : 2.4, C.PLAZA, (v) => v === C.GRASS);
    np++;
  }
  stats.parkPaths = np;
} catch (e) { stats.parkPaths = 'no osm_alleys.json'; }

// (3) sân trước địa danh: đệm 10 m quanh LM_POLY các công trình dân sự lớn = đá lát (nếu đang là nền phố URB)
const FORECOURT = ['opera', 'postoffice', 'museum', 'ubnd', 'nhnn', 'station', 'station_bldg', 'rap78', 'trienlam', 'viettiep', 'nhaken'];
for (const k of FORECOURT) {
  const P = LM_POLY[k]; if (!P) continue;
  let cx = 0, cz = 0; for (const [x, z] of P) { cx += x; cz += z; } cx /= P.length; cz /= P.length;
  // phóng đa giác ra ~10 m (theo tâm, đủ cho đa giác lồi gần chữ nhật)
  const R = Math.max(...P.map(([x, z]) => Math.hypot(x - cx, z - cz)));
  const s = (R + 10) / R;
  fillRings([P.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s])], C.PLAZA, (v) => v === C.URB);
}

// (4) ĐỊA DANH: footprint thật (LM_POLY) → BLD. Nhà THƯỜNG (RB) KHÔNG nướng ở đây: js/landuse.js tô footprint ĐANG SỐNG
// (world.rbData, đã trừ D.dead của claims/quảng trường/công viên) trong worker lúc chạy rồi mới tính khoảng cách → nhà bị
// giết lộ đúng lớp đất bên dưới (quảng trường/cỏ), không để "vết nhà" sẫm. File nhỏ hơn ~4× (khối nhà nén kém).
// Không phải mọi LM_POLY là NHÀ: 'square' = quảng trường Nhà hát (đá lát); 3 trường = KHUÔN VIÊN (osm amenity=school);
// chùa Hàng = cả khuôn viên chùa (sân gạch). Còn lại là thân công trình.
const LM_AREA = { square: C.PLAZA, thptnq: C.CAMPUS, thcsnq: C.CAMPUS, thcstp: C.CAMPUS, chuahang: C.TEMPLE };
let nb = 0;
for (const k of Object.keys(LM_POLY)) nb += fillRings([LM_POLY[k]], LM_AREA[k] ?? C.BLD);
stats.lmPx = nb;

// ---------- thống kê ----------
const hist = new Array(16).fill(0);
for (let i = 0; i < N * N; i++) hist[cls[i]]++;
const names = Object.keys(C);
const histS = Object.fromEntries(names.map((k) => [k, +(hist[C[k]] * RES * RES / 1e6).toFixed(3)]));   // km²

// ---------- nén ----------
function upFilter(a) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = (a[i] - (i >= N ? a[i - N] : 0)) & 255; return o; }
const zc = zlib.deflateRawSync(upFilter(cls), { level: 9 });
const meta = { v: 2, n: N, res: RES, x0: X0, z0: Z0, classes: C, clsBytes: zc.length, filter: 'up', stats, areaKm2: histS };
const out = `// GENERATED by tools/gen_landuse.mjs — KHÔNG sửa tay. Raster sử dụng đất ${N}² × ${RES} m quanh gốc (Nhà hát lớn).
// LU_CLS: deflate-raw + base64 của mặt phẳng LỚP (1 byte/điểm ảnh, lọc "Up" theo hàng). Xem js/landuse.js (giải mã + khoảng cách tới nhà).
// Nguồn: OpenStreetMap (ODbL) landuse/amenity/leisure + footprint nhà (Overture/OSM/Google/MS, xem README).
export const LU_META = ${JSON.stringify(meta)};
export const LU_CLS = '${zc.toString('base64')}';
`;
fs.writeFileSync('js/landuse_data.js', out);
console.log(JSON.stringify({ ms: Date.now() - t0, polys: polys.length, clsKB: (zc.length / 1024).toFixed(0), fileKB: (out.length / 1024).toFixed(0), stats, areaKm2: histS }, null, 1));

// ---------- ảnh xem nhanh (PPM): lớp + nhà RB + khoảng cách (cùng hàm luCompose của js/landuse.js) ----------
const pi = process.argv.indexOf('--ppm');
if (pi > 0) {
  const { luCompose } = await import('../js/landuse.js');
  const D = decodeRB(RB_B64);
  const t1 = Date.now();
  const rg = luCompose(cls.slice(), { x: D.x, z: D.z, vStart: D.vStart, dead: D.dead, nB: D.nB }, LU_GRID);
  console.log('luCompose ms', Date.now() - t1);
  const PAL = [[60, 110, 60], [150, 145, 135], [120, 115, 110], [200, 200, 195], [170, 80, 60], [190, 185, 160], [70, 70, 75], [170, 140, 100],
    [90, 160, 70], [110, 130, 80], [40, 140, 70], [60, 120, 160], [190, 60, 50], [60, 160, 220], [130, 110, 90], [40, 30, 30]];
  const img = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const c0 = rg[i * 2] & 15, c = PAL[c0];
    const k = c0 === C.URB ? 0.6 + 0.4 * Math.min(1, rg[i * 2 + 1] / 8 / 12) : 1;
    img[i * 3] = c[0] * k; img[i * 3 + 1] = c[1] * k; img[i * 3 + 2] = c[2] * k;
  }
  fs.writeFileSync(process.argv[pi + 1], Buffer.concat([Buffer.from(`P6
${N} ${N}
255
`), img]));
}
