// tools/qa/audit_views.mjs — sinh views JSON cho tools/qa/shoot.mjs --views: 4 hướng 0/90/180/270 mỗi pano, CÙNG quy ước camera
// với lượt chấm 480 pano (views_audit480): đứng ĐÚNG vị trí xe Street View (X, Z từ audit/pano_index.json + pano_index2.json), kind 'pano'
// (shoot.mjs: teleport(X, Z, −h·π/180, pitch 0,02, dist 0,1)), id `<pano>_h<HHH>` (khớp tên ảnh make_pairs3.py). Chụp ở
// --w 1280 --h 634 (khung ảnh Street View cắt, FOV dọc 60° ≈ ngang 98°).
// usage: node tools/qa/audit_views.mjs <out.json> <id …>   (id: 331 | pano_331 | 'ids.json' = mảng id)
//        → in số view; id không có trong 2 chỉ mục → lỗi.
import fs from 'fs';
const [out, ...rest] = process.argv.slice(2);
if (!out || !rest.length) { console.error('usage: node tools/qa/audit_views.mjs <out.json> <id …|ids.json>'); process.exit(1); }
const ids = rest.flatMap((a) => (a.endsWith('.json') ? JSON.parse(fs.readFileSync(a, 'utf8')) : [a]))
  .map((a) => (String(a).startsWith('pano_') ? String(a) : 'pano_' + String(a).padStart(3, '0')));
// 551 pano = audit/pano_index.json (420, đợt 1) + audit/pano_index2.json (131, đợt 2)
const IDX = new Map(['pano_index.json', 'pano_index2.json'].flatMap((f) => JSON.parse(fs.readFileSync(new URL('../../audit/' + f, import.meta.url), 'utf8'))).map((p) => [p.id, p]));
const V = [];
for (const id of ids) {
  const p = IDX.get(id); if (!p) { console.error('không có trong audit/pano_index*.json:', id); process.exit(1); }
  for (const h of [0, 90, 180, 270]) V.push({ id: `${id}_h${String(h).padStart(3, '0')}`, kind: 'pano', X: p.X, Z: p.Z, h });
}
fs.writeFileSync(out, JSON.stringify(V, null, 1));
fs.writeFileSync(out.replace(/\.json$/, '') + '_ids.json', JSON.stringify(ids));
console.log(`${V.length} view (${ids.length} pano) → ${out} (+ danh sách id cho make_pairs3: ${out.replace(/\.json$/, '')}_ids.json)`);
