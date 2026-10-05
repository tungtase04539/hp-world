// tools/gen_roadmarks.mjs — BẰNG CHỨNG vạch kẻ đường / zebra / đèn tín hiệu → js/roadmarks.js (SINH TỰ ĐỘNG, đừng sửa tay).
// Chạy từ gốc repo: `node tools/gen_roadmarks.mjs`. 3 nguồn:
//  (1) ROAD_MARK_EVIDENCE — mô tả chữ 551 pano (audit/audit_enriched.json): tim vàng/đôi/trắng, có zebra, có đèn tín hiệu.
//  (2) ROAD_MARK_LABELS (Đợt 3 W3-D) — nhãn NHÌN ẢNH pano thật theo trục đường (tools/pano_loop/mark_labels.json):
//      Y tim vàng đứt | D vàng đôi | W vạch trắng (không vàng) | N KHÔNG vạch tim → bằng chứng ÂM (mặc định theo cấp đường
//      từng vẽ tim vàng cả phố ngõ hẹp Hạ Lý/Dư Hàng/Mê Linh… — AUDIT3 MARK).
//  (3) OSM_SIGNALS / OSM_CROSSINGS (Đợt 3 W3-D) — node highway=traffic_signals, highway=crossing/crossing=*, way
//      footway=crossing (tools/osm_crossings.json, fetch_osm.sh mục 13; gitignored). Thiếu file thô → GIỮ mảng OSM của
//      js/roadmarks.js hiện có (tất định, không mất dữ liệu khi chạy lại ở máy chưa tải OSM).
// js/roadnet.js: tim đường theo (2) > (1) > mặc định cấp; zebra/đèn ở nút giao CHỈ khi có (3) hoặc bằng chứng pano (1).
import fs from 'fs';

const A = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const FIELDS = ['summary', 'area', 'sidewalk', 'vehicles', 'street_furniture', 'street_furniture_note', 'special', 'banners'];
const F = { YELLOW: 1, DOUBLE_YELLOW: 2, WHITE_CENTER: 4, ZEBRA: 8, SIGNAL: 16 };
const out = [];
const cnt = { y: 0, dy: 0, w: 0, z: 0, s: 0 };
for (const p of A) {
  if (!Number.isFinite(p.X) || !Number.isFinite(p.Z)) continue;
  const txt = FIELDS.map((k) => (typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k] || ''))).join(' | ').toLowerCase();
  let f = 0;
  if (/vàng đôi|đôi vàng|tim vàng đôi|vạch vàng đôi/.test(txt)) { f |= F.DOUBLE_YELLOW; cnt.dy++; }
  else if (/tim (đường )?(kẻ |sơn )?vàng|vạch (kẻ |sơn )?(tim )?(đường )?vàng|kẻ vàng|vạch tim vàng|hai chiều vạch vàng/.test(txt)) { f |= F.YELLOW; cnt.y++; }
  else if (/tim (đường )?(kẻ |sơn )?trắng|vạch tim trắng|vạch phân làn/.test(txt)) { f |= F.WHITE_CENTER; cnt.w++; }
  if (/vạch (sang|qua) đường|zebra|vạch dành cho người đi bộ|vạch người đi bộ/.test(txt)) { f |= F.ZEBRA; cnt.z++; }
  if (/đèn tín hiệu|đèn giao thông|đèn đếm ngược|đồng hồ đếm ngược/.test(txt)) { f |= F.SIGNAL; cnt.s++; }
  if (f) out.push([Math.round(p.X * 10) / 10, Math.round(p.Z * 10) / 10, f]);
}

// ---- (1b) VẬT LIỆU VỈA HÈ theo chữ mô tả pano (audit_enriched.sidewalk) → lớp texture roadtex.js:
// 2 gạch/bê tông xám · 3 caro đỏ-xám (gạch đỏ xen xám — dạng phổ biến nhất ở lõi: Hồng Bàng, Thế Lữ, Trần Hưng Đạo…)
// · 4 gạch đỏ liền · 5 gạch tự chèn/lục giác XÁM. Mệnh đề ĐẦU TIÊN có vật liệu thắng (thường là phía chính của ảnh);
// bỏ mệnh đề bó vỉa/viền/bồn cây ("bó vỉa gạch đỏ" không phải mặt lát). AUDIT3 PAVE: SIDEWALK_BY_ROAD (khoá theo index
// way, không có generator) lệch chữ mô tả ở ~45% pano (111 pano "caro đỏ-xám" đang vẽ gạch xám, Mê Linh/Tô Hiệu/Hồ Sen
// xám đang vẽ đỏ) → roadnet.js lấy bằng chứng gần nhất trên CÙNG way (≤ 120 m), SIDEWALK_BY_ROAD chỉ còn là dự phòng.
function paveClass(t0) {
  let t = (t0 || '').toLowerCase();
  t = t.replace(/(bó vỉa|viền|bồn cây|bồn gốc)[^,.;()]*/g, ' ');
  for (const s of t.split(/[;.]/).map((q) => q.trim()).filter(Boolean)) {
    const red = /đỏ|terracotta|hồng|đất nung|nâu/.test(s), grey = /xám|ghi/.test(s), conc = /bê tông|xi măng|đá tấm|granite/.test(s);
    const mix = /caro|ô cờ|bàn cờ|kẻ ô|xen kẽ|xen|pha|phối/.test(s), hex = /lục giác|con sâu|tự chèn|block/.test(s);
    if (red && (grey || mix)) return 3;
    if (red) return 4;
    if (hex) return 5;
    if (grey || conc) return 2;
  }
  return 0;
}
const pave = [];
const pc = { 2: 0, 3: 0, 4: 0, 5: 0 };
for (const p of A) {
  if (!Number.isFinite(p.X) || !Number.isFinite(p.Z)) continue;
  const c = paveClass(p.sidewalk); if (!c) continue;
  pave.push([Math.round(p.X * 10) / 10, Math.round(p.Z * 10) / 10, c]); pc[c]++;
}

// ---- (2) nhãn nhìn ảnh ----
const LBL = { Y: 1, D: 2, W: 4, N: 32 };
const POS = Object.fromEntries(JSON.parse(fs.readFileSync('tools/pano_loop/list_full_551.json', 'utf8')).map((e) => [e.id, [e.X, e.Z]]));
const ML = JSON.parse(fs.readFileSync('tools/pano_loop/mark_labels.json', 'utf8')).labels;
const labels = [];
const lc = { Y: 0, D: 0, W: 0, N: 0 };
for (const id of Object.keys(ML).sort()) {
  const p = POS[id], code = LBL[ML[id]];
  if (!p || !code) { console.warn('bỏ nhãn', id, ML[id]); continue; }
  labels.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, code]); lc[ML[id]]++;
}

// ---- (3) OSM tín hiệu / vạch qua đường ----
const LON0 = 106.68182, LAT0 = 20.85750;   // = tools/process_osm.mjs (gốc Nhà hát lớn)
const UX = 111320 * Math.cos(LAT0 * Math.PI / 180), UZ = 110540;
const toXZ = (lon, lat) => [(lon - LON0) * UX, -(lat - LAT0) * UZ];
const r1 = (v) => Math.round(v * 10) / 10;
let osmSig = null, osmX = null;
if (fs.existsSync('tools/osm_crossings.json')) {
  const E = JSON.parse(fs.readFileSync('tools/osm_crossings.json', 'utf8')).elements;
  const sig = [], xs = [];
  const near = (L, p, r) => L.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r);
  // thứ tự tất định: theo id OSM
  for (const e of E.slice().sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id))) {
    const t = e.tags || {};
    if (e.type === 'node') {
      const p = toXZ(e.lon, e.lat).map(r1);
      if (t.highway === 'traffic_signals' || t.crossing === 'traffic_signals') { if (!near(sig, p, 3)) sig.push(p); }
      if (t.highway === 'crossing' || (t.crossing && t.crossing !== 'no' && t.crossing !== 'unmarked')) { if (!near(xs, p, 2)) xs.push(p); }
    } else if (e.type === 'way' && e.geometry && e.geometry.length >= 2 && t.crossing !== 'unmarked') {
      // way footway=crossing: vạch nằm giữa 2 đầu (băng qua lòng đường)
      const a = toXZ(e.geometry[0].lon, e.geometry[0].lat), b = toXZ(e.geometry[e.geometry.length - 1].lon, e.geometry[e.geometry.length - 1].lat);
      const p = [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)];
      if (!near(xs, p, 2)) xs.push(p);
    }
  }
  const inR = (p) => Math.hypot(p[0], p[1]) < 2300;
  osmSig = sig.filter(inR).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  osmX = xs.filter(inR).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
} else {
  const old = fs.existsSync('js/roadmarks.js') ? fs.readFileSync('js/roadmarks.js', 'utf8') : '';
  const grab = (name) => { const m = old.match(new RegExp('export const ' + name + ' = (\\[.*\\]);')); return m ? JSON.parse(m[1]) : []; };
  osmSig = grab('OSM_SIGNALS'); osmX = grab('OSM_CROSSINGS');
  console.warn('THIẾU tools/osm_crossings.json (fetch_osm.sh mục 13) — giữ mảng OSM cũ:', osmSig.length, osmX.length);
}

const src = `// SINH TỰ ĐỘNG bởi tools/gen_roadmarks.mjs — ĐỪNG SỬA TAY.
// ROAD_MARK_EVIDENCE [X, Z, cờ] (chữ mô tả pano): 1 tim vàng đứt, 2 tim vàng đôi, 4 tim trắng, 8 có vạch qua đường, 16 có đèn tín hiệu.
export const ROAD_MARK_EVIDENCE = ${JSON.stringify(out)};
// ROAD_MARK_LABELS [X, Z, mã] (NHÌN ẢNH pano thật, tools/pano_loop/mark_labels.json): 1 tim vàng đứt, 2 vàng đôi, 4 vạch trắng, 32 KHÔNG vạch tim.
export const ROAD_MARK_LABELS = ${JSON.stringify(labels)};
// ROAD_PAVE_EVIDENCE [X, Z, lớp] vật liệu vỉa hè từ chữ pano: 2 gạch/bê tông xám, 3 caro đỏ-xám, 4 gạch đỏ, 5 tự chèn/lục giác xám.
export const ROAD_PAVE_EVIDENCE = ${JSON.stringify(pave)};
// OSM_SIGNALS [x, z] node đèn tín hiệu; OSM_CROSSINGS [x, z] vạch qua đường (node crossing / giữa way footway=crossing). Toạ độ game (m).
export const OSM_SIGNALS = ${JSON.stringify(osmSig)};
export const OSM_CROSSINGS = ${JSON.stringify(osmX)};
`;
fs.writeFileSync('js/roadmarks.js', src);
console.log('roadmarks:', out.length, 'pano có bằng chứng chữ', cnt, '| vỉa hè', pave.length, pc, '| nhãn ảnh', labels.length, lc, '| OSM tín hiệu', osmSig.length, 'vạch qua đường', osmX.length);
