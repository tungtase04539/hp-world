// tools/gen_props_evidence.mjs — SINH js/props_evidence.js từ mô tả 551 pano thật (audit/audit_enriched.json).
// Mỗi pano → 1 dòng số nguyên gọn để js/props.js tra "đồ đạc phố" theo pano GẦN NHẤT (≤ 60 m):
//   [X, Z, bike, car, pole, lamp, clutter]
//   bike    0 = không nhắc xe máy đỗ · 1 = rải rác/vài chiếc · 2 = có đỗ · 3 = dày/kín/san sát/hàng dài
//   car     0 = không nhắc ô tô đỗ · 1 = có đỗ ven đường · 2 = đỗ dày/hai bên
//   pole    0 = không thấy cột điện · 1 = cột điện + dây · 2 = búi dây/chằng chịt/rối
//   lamp    bit 1 = đèn cao áp cần vươn/đèn đường · bit 2 = đèn trang trí cổ điển (kiểu Pháp, chùm)
//   clutter bit 1 = bàn ghế nhựa/quán vỉa hè · 2 = xe đẩy/hàng rong/gánh · 4 = thùng rác · 8 = biển đứng/standee
//           · 16 = tủ điện/trạm biến áp · 32 = trụ cứu hoả
// Chạy (từ gốc repo): node tools/gen_props_evidence.mjs   → ghi js/props_evidence.js (~14 KB)
import fs from 'fs';

const SRC = 'audit/audit_enriched.json';
const OUT = 'js/props_evidence.js';
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const low = (s) => (s || '').toString().toLowerCase();
const rows = [];
const stat = { bike: [0, 0, 0, 0], car: [0, 0, 0], pole: [0, 0, 0], lamp: [0, 0, 0, 0], clutter: {} };
for (const e of j) {
  if (e.X == null || e.Z == null) continue;
  const veh = low(e.vehicles);
  const sf = low((e.street_furniture || []).join(' | '));
  const all = low([e.vehicles, e.sidewalk, (e.street_furniture || []).join(' | '), (e.special || []).join(' | '), e.summary].join(' | '));
  // ---- xe máy đỗ ----
  let bike = 0;
  const bikeParked = /xe máy[^.;]*(đỗ|dựng|phủ bạt)|(đỗ|dựng)[^.;]*xe máy|bãi (giữ|gửi) xe/.test(veh) || /xe máy[^.;]*(đỗ|dựng)|(đỗ|dựng)[^.;]*xe máy/.test(low(e.sidewalk));
  if (bikeParked) {
    if (/(rất )?dày|kín|san sát|hàng dài|rất nhiều xe máy|chật|thành hàng|nhiều xe máy đỗ|xe máy đỗ (đông|nhiều)/.test(veh)) bike = 3;
    else if (/rải rác|vài xe máy (đỗ|dựng)|lác đác|ít xe máy|một vài xe máy đỗ|vài chiếc/.test(veh)) bike = 1;
    else bike = 2;
  }
  // ---- ô tô đỗ ----
  let car = 0;
  if (/(ô tô|xe con|sedan|suv|hatchback|taxi|xe hơi)[^.;]*(đỗ|đậu)|(đỗ|đậu)[^.;]*(ô tô|xe con)/.test(veh)) {
    car = /dày|kín|san sát|hai bên|nhiều ô tô|thành hàng|hàng dài/.test(veh) ? 2 : 1;
  }
  // ---- cột điện / búi dây ----
  let pole = 0;
  if (/cột điện|dây điện|búi dây|dây cáp/.test(sf)) pole = /búi|chằng chịt|rối|cuộn|dày đặc|lớn|chi chít/.test(sf) ? 2 : 1;
  // ---- đèn ----
  let lamp = 0;
  if (/cao áp|cần vươn|đèn đường|đèn chiếu sáng|cột đèn(?! trang trí| cổ| kiểu)|đèn led/.test(sf)) lamp |= 1;
  if (/cổ điển|kiểu pháp|tân cổ|đèn chùm|nhiều bóng|3 bóng|ba bóng|đèn trang trí|gang/.test(sf)) lamp |= 2;
  // ---- đồ lặt vặt ----
  let cl = 0;
  if (/ghế nhựa|bàn ghế|quán vỉa hè|quán cóc|trà đá|ghế đẩu|bàn nhựa/.test(all)) cl |= 1;
  if (/xe đẩy|hàng rong|gánh hàng|xe bán (hàng|nước|bánh)|xe hàng/.test(all)) cl |= 2;
  if (/thùng rác/.test(all)) cl |= 4;
  if (/biển (quảng cáo )?đứng|standee|biển chữ a|biển chân|bảng đứng/.test(all)) cl |= 8;
  if (/tủ điện|biến áp|hộp điện|trạm điện/.test(all)) cl |= 16;
  if (/cứu hoả|cứu hỏa/.test(all)) cl |= 32;
  rows.push([Math.round(e.X * 10) / 10, Math.round(e.Z * 10) / 10, bike, car, pole, lamp, cl]);
  stat.bike[bike]++; stat.car[car]++; stat.pole[pole]++; stat.lamp[lamp]++;
  for (let b = 0; b < 6; b++) if (cl & (1 << b)) stat.clutter[1 << b] = (stat.clutter[1 << b] || 0) + 1;
}
const head = `// SINH TỰ ĐỘNG bởi tools/gen_props_evidence.mjs từ ${SRC} — ĐỪNG SỬA TAY.\n` +
  `// [X, Z, bike 0-3, car 0-2, pole 0-2, lamp bits (1 cao áp, 2 cổ điển), clutter bits (1 ghế nhựa, 2 xe đẩy, 4 thùng rác,\n` +
  `//  8 biển đứng, 16 tủ điện/biến áp, 32 trụ cứu hoả)] — xem tools/gen_props_evidence.mjs\n`;
const body = 'export const PROPS_EVIDENCE = [\n' + rows.map((r) => '[' + r.join(',') + ']').join(',\n') + '\n];\n';
fs.writeFileSync(OUT, head + body);
console.log(OUT, rows.length, 'pano', JSON.stringify(stat));
