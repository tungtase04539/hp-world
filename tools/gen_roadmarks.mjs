// tools/gen_roadmarks.mjs — rút BẰNG CHỨNG vạch kẻ đường / đèn tín hiệu từ mô tả 551 pano thật (audit/audit_enriched.json)
// → js/roadmarks.js (SINH TỰ ĐỘNG, đừng sửa tay). Chạy từ gốc repo: `node tools/gen_roadmarks.mjs`.
// js/roadnet.js dùng bảng này để: chọn kiểu tim đường (vàng đứt / vàng đôi / trắng) cho đoạn phố gần pano (≤ 14 m),
// bật zebra / đèn tín hiệu ở nút giao gần pano có mô tả tương ứng (≤ 45 m). Không có bằng chứng → mặc định theo cấp đường.
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
const src = `// SINH TỰ ĐỘNG bởi tools/gen_roadmarks.mjs từ audit/audit_enriched.json — ĐỪNG SỬA TAY.
// Mỗi phần tử [X, Z, cờ]: 1 tim vàng đứt, 2 tim vàng đôi, 4 tim trắng, 8 có vạch qua đường, 16 có đèn tín hiệu.
export const ROAD_MARK_EVIDENCE = ${JSON.stringify(out)};
`;
fs.writeFileSync('js/roadmarks.js', src);
console.log('roadmarks:', out.length, 'pano có bằng chứng', cnt);
