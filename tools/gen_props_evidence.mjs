// tools/gen_props_evidence.mjs — SINH js/props_evidence.js từ mô tả 551 pano thật (audit/audit_enriched.json).
// Mỗi pano → 1 dòng số nguyên gọn để js/props.js tra "đồ đạc phố" theo pano GẦN NHẤT (≤ 60 m):
//   [X, Z, bike, car, pole, lamp, clutter, market, spill, deco]
//   bike    0 = không nhắc xe máy đỗ · 1 = rải rác/vài chiếc · 2 = có đỗ · 3 = dày/kín/san sát/hàng dài
//   car     0 = không nhắc ô tô đỗ · 1 = có đỗ ven đường · 2 = đỗ dày/hai bên
//   pole    0 = không thấy cột điện · 1 = cột điện + dây · 2 = búi dây/chằng chịt/rối
//   lamp    bit 1 = đèn cao áp cần vươn/đèn đường · bit 2 = đèn trang trí cổ điển (kiểu Pháp, chùm)
//   clutter bit 1 = bàn ghế nhựa/quán vỉa hè · 2 = xe đẩy/hàng rong/gánh · 4 = thùng rác · 8 = biển đứng/standee
//           · 16 = tủ điện/trạm biến áp · 32 = trụ cứu hoả
//   --- Đợt 3 W3-E (STREET LIFE, AUDIT3 FP-5) ---
//   market  0 = không · 1 = hàng rong/ô dù bán lẻ · 2 = có sạp/quầy chợ/hàng bày · 3 = CHỢ DÂN SINH/phố chợ/sạp kín hè
//   spill   bit 1 ô dù bán hàng · 2 bạt/lều bạt · 4 hàng hoá bày lấn hè · 8 dù/bàn ghế quán cà phê · 16 xe máy trưng bày
//           · 32 nội thất/đồ thờ/két · 64 đồ chơi · 128 trái cây/rau/mẹt rổ · 256 giá treo quần áo/ma-nơ-canh
//           · 512 chậu cây cảnh · 1024 hoa tươi
//   deco    bit 1 cờ treo nhà/dãy cờ · 2 băng rôn căng ngang phố · 4 cổng chào · 8 lan can/hàng rào trắng con tiện
//           · 16 hàng rào sắt · 32 xe khách đỗ thành dãy · 64 ô tô phủ bạt · 128 xe ba gác · 256 xe đạp dựng
//           · 512 trạm biến áp/tủ điện lớn dưới đất
// Chợ theo OSM (amenity=marketplace, osm_landuse.json — Overpass mục 12 của fetch_osm.sh) NHÚNG SẴN dưới đây
// (OSM_MARKETS, toạ độ game, làm tròn 0,1 m) để bộ sinh tự đủ (tools/osm_*.json bị gitignore, máy khác có thể thiếu).
// Làm mới danh sách: node tools/gen_props_evidence.mjs --osm tools/osm_landuse.json  (in ra mảng mới để dán vào đây).
// Chạy (từ gốc repo): node tools/gen_props_evidence.mjs   → ghi js/props_evidence.js
import fs from 'fs';

const SRC = 'audit/audit_enriched.json';
const OUT = 'js/props_evidence.js';

// ---- chợ OSM (đa giác thật, nhiều chợ vẽ DỌC PHỐ: Chợ Ga, Lương Văn Can) — chỉ trong ±2,6 km ----
const OSM_MARKETS = [
  ['Chợ Ga', [[40.8, 237.1], [60.8, 255.5], [148.3, 233.6], [185.4, 224.3], [214.4, 294.7], [270.2, 339.9], [370.4, 247.5], [248.8, 78.9], [231.3, 87.2], [286.4, 171.6], [40.8, 237.1]]],
  ['Chợ Trần Quang Khải', [[-150.5, -258.4], [-63.3, -260.8], [-64.3, -195.2], [-153.6, -196.2], [-150.5, -258.4]]],
  ['Chợ Con', [[247.2, 756.7], [287, 755], [289.5, 809.2], [248.3, 810.9], [247.2, 756.7]]],
  ['Chợ An Dương', [[-1235.2, 862.5], [-1223.6, 912.7], [-1155.8, 897.3], [-1167.4, 847.1], [-1235.2, 862.5]]],
  ['Chợ Đông Khê', [[1981.1, 1065], [1978.3, 1072.1], [2016.8, 1091.3], [2018.7, 1084], [1981.1, 1065]]],
  ['Chợ Lương Văn Can', [[1103.5, -246.2], [1103.7, -193.1], [1177.3, -258.9], [1218.3, -220.3], [1241.4, -246.1], [1207.2, -276.5], [1262.1, -306.8], [1289, -287.3], [1309.5, -306.4], [1277.1, -337], [1278.3, -433.2], [1251, -433.7], [1247.3, -342.9], [1160.2, -300.4], [1103.5, -246.2]]],
];
const osmArg = process.argv.indexOf('--osm');
if (osmArg > 0) {
  const LON0 = 106.68182, LAT0 = 20.85750, UX = 111320 * Math.cos(LAT0 * Math.PI / 180), UZ = 110574;
  const J = JSON.parse(fs.readFileSync(process.argv[osmArg + 1], 'utf8'));
  const out = [];
  for (const e of J.elements || []) {
    const t = e.tags || {};
    if (t.amenity !== 'marketplace' || !e.geometry) continue;
    const g = e.geometry.map((p) => [+((p.lon - LON0) * UX).toFixed(1), +(-(p.lat - LAT0) * UZ).toFixed(1)]);
    if (Math.hypot(g[0][0], g[0][1]) > 2600) continue;
    out.push([t.name || 'chợ', g]);
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const low = (s) => (s || '').toString().toLowerCase();
const rows = [];
const stat = { bike: [0, 0, 0, 0], car: [0, 0, 0], pole: [0, 0, 0], lamp: [0, 0, 0, 0], clutter: {}, market: [0, 0, 0, 0], spill: {}, deco: {} };
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
  // ---- W3-E: CHỢ / HÀNG HOÁ / TRANG TRÍ (mô tả vỉa hè + đồ phố + đặc biệt + tóm tắt; KHÔNG dùng banners = chữ biển hiệu:
  //      "KIM THANH - Ô - Dù - Bạt" là tên cửa hàng, không phải ô dù thật). Tên riêng có chữ "chợ" bị xoá trước khi so:
  //      phố/ngõ Chợ Con (455-457: phố vật liệu xây dựng), Chợ Sắt (đang xây), "ghép lệch ... chợ tam bạc" (464: ghi chú
  //      độ tin cậy, không phải chợ thật).
  const mk = all.replace(/(phố|ngõ( \d+)?|đường) chợ con/g, 'phố cc').replace(/chợ sắt/g, 'tttm').replace(/ghép lệch[^.;|]*/g, '');
  let market = 0;
  if (/chợ dân sinh|chợ cóc|chợ tạm|chợ (rau|cá|hoa|hải sản|quần áo|vải|kim khí|thực phẩm|họp)|phố chợ|khu chợ|dãy chợ|sân chợ|đầu chợ|nhà chợ|ngõ chợ|cổng chợ|cửa ngõ chợ|biến thành chợ|rừng ô|dãy ô\/?dù|kín (các )?sạp|sạp[^.;|]{0,30}(kín|tràn|chiếm|dày|san sát|hai bên)|(sạp|ô\/?dù|bạt)[^.;|]{0,24}(che|phủ) (kín|gần như)|chợ[^.;|]{0,12}họp|họp chợ/.test(mk)) market = 3;
  else if (/sạp(?! báo| sách| truyện| hàng rong)|quầy chợ|ô\/?dù chợ|dù chợ|giá treo quần áo|bày (hàng|sạp)|hàng ho[áa][^.;|]{0,12}bày|bày[^.;|]{0,12}hàng ho[áa]|lều bạt|quầy (hàng|hoa quả|trái cây)/.test(mk)) market = 2;
  else if (/hàng rong|gánh hàng|xe đẩy (bánh|hàng)|ô\/?dù bán hàng|dù bán hàng|ô dù (lớn|bán)|sạp báo/.test(mk)) market = 1;
  let sp = 0;
  if (/ô\s?\/\s?dù|dù\s?\/\s?ô|ô dù|dù (che|chợ|bán|đỏ|lớn|màu|xanh|trắng|tím|cam|hồng|cầu vồng|nhiều|quán)/.test(mk)) sp |= 1;
  if (/bạt (che|xanh|sọc|cam|đỏ)|lều bạt|mái bạt|mái hiên bạt|che bạt|lưới che/.test(mk)) sp |= 2;
  if (/hàng ho[áa]|bày hàng|thùng carton|bao tải|thùng xốp|hàng (kim khí|nhựa)|lấn chiếm/.test(mk)) sp |= 4;
  // ('ô' trần = "ô tô" → chỉ nhận ô/dù, dù (không "mặc dù"), ô che/lớn/đỏ/trắng)
  if (/(quán|cà phê|cafe|café|trà|bia)[^.;|]{0,40}(ô\/?dù|(?<!mặc )dù|ô (che|lớn|đỏ|trắng))|(ô\/?dù|(?<!mặc )dù)[^.;|]{0,30}(quán|cà phê|cafe|café|trà|bia)|bàn ghế[^.;|]{0,24}dù|dù[^.;|]{0,24}bàn ghế|sân vườn/.test(mk)) sp |= 8;
  if (/xe (máy|điện)[^.;|]{0,30}trưng bày|trưng bày[^.;|]{0,30}xe (máy|điện)|cửa hàng xe (máy|điện)|đại lý xe|showroom xe (máy|điện)|sạp xe máy điện/.test(mk)) sp |= 16;
  if (/nội thất|đồ gỗ|đồ thờ|thờ cúng|két sắt|bàn ghế gỗ|sofa|giường/.test(mk)) sp |= 32;
  if (/đồ chơi|thú bông/.test(mk)) sp |= 64;
  if (/trái cây|hoa quả|rau( củ|,| quả| xanh)|củ quả|mẹt|rổ/.test(mk)) sp |= 128;
  if (/giá treo|quần áo[^.;|]{0,20}(treo|bày)|ma-?nơ-?canh|manơcanh|mannequin/.test(mk)) sp |= 256;
  if (/chậu cây|cây cảnh|chậu hoa|cây chậu/.test(mk)) sp |= 512;
  if (/hoa tươi|chợ hoa|sạp hoa|hoa cưới/.test(mk)) sp |= 1024;
  let deco = 0;
  if (/cờ đỏ sao vàng|cờ tổ quốc|treo cờ|dãy cờ|cờ treo|cờ (đỏ|búa liềm|hội)/.test(all)) deco |= 1;
  if (/(băng rôn|băng-rôn|khẩu hiệu|pano)[^.;|]{0,40}(ngang|căng|qua phố|qua đường)|căng ngang/.test(all)) deco |= 2;
  // cổng chào NGÕ/khu dân cư (097/113/277/366/495/505) — không tính cổng trường/công viên (050/324/355: cổng khuôn viên)
  if (/cổng chào[^.;|]{0,60}(ngõ|khu dân cư|lối vào|văn ho[áa]|khung sắt|băng rôn)/.test(all) && !/cổng chào\)?[^.;|]{0,40}(trường|công viên|mầm non)/.test(all)) deco |= 4;
  if (/(lan can|hàng rào|rào)[^.;|]{0,16}(trắng|con tiện)|con tiện trắng|balustrade/.test(all)) deco |= 8;
  if (/hàng rào sắt|rào sắt|hàng rào song sắt/.test(all)) deco |= 16;
  if (/xe khách[^.;]*(đỗ|đậu|nối)|(đỗ|đậu)[^.;]*xe khách|bến (xe|đỗ) xe khách/.test(all)) deco |= 32;
  if (/(ô tô|xe con|xe hơi)[^.;|]{0,24}phủ bạt|bạt phủ (ô tô|xe)/.test(all)) deco |= 64;
  if (/ba gác|xe kéo tay|xe cải tiến/.test(all)) deco |= 128;
  if (/xe đạp[^.;|]{0,24}(dựng|đỗ)|(dựng|đỗ)[^.;|]{0,16}xe đạp/.test(all)) deco |= 256;
  if (/trạm biến áp[^.;|]{0,30}(vỉa hè|promenade|mặt đất|kiốt|kiosk|hộp)|(tủ điện|trạm điện)[^.;|]{0,12}lớn|(hai|2) (tủ|trạm)/.test(all)) deco |= 512;
  rows.push([Math.round(e.X * 10) / 10, Math.round(e.Z * 10) / 10, bike, car, pole, lamp, cl, market, sp, deco]);
  stat.bike[bike]++; stat.car[car]++; stat.pole[pole]++; stat.lamp[lamp]++; stat.market[market]++;
  for (let b = 0; b < 6; b++) if (cl & (1 << b)) stat.clutter[1 << b] = (stat.clutter[1 << b] || 0) + 1;
  for (let b = 0; b < 11; b++) if (sp & (1 << b)) stat.spill[1 << b] = (stat.spill[1 << b] || 0) + 1;
  for (let b = 0; b < 10; b++) if (deco & (1 << b)) stat.deco[1 << b] = (stat.deco[1 << b] || 0) + 1;
}
const head = `// SINH TỰ ĐỘNG bởi tools/gen_props_evidence.mjs từ ${SRC} — ĐỪNG SỬA TAY.\n` +
  `// [X, Z, bike 0-3, car 0-2, pole 0-2, lamp bits (1 cao áp, 2 cổ điển), clutter bits (1 ghế nhựa, 2 xe đẩy, 4 thùng rác,\n` +
  `//  8 biển đứng, 16 tủ điện/biến áp, 32 trụ cứu hoả), market 0-3, spill bits, deco bits] — xem tools/gen_props_evidence.mjs\n`;
const body = 'export const PROPS_EVIDENCE = [\n' + rows.map((r) => '[' + r.join(',') + ']').join(',\n') + '\n];\n';
const mkt = '// chợ OSM amenity=marketplace (đa giác, toạ độ game) — nhúng trong bộ sinh\n' +
  'export const PROPS_MARKETS = ' + JSON.stringify(OSM_MARKETS.map(([n, g]) => ({ name: n, poly: g }))) + ';\n';
fs.writeFileSync(OUT, head + body + mkt);
console.log(OUT, rows.length, 'pano', JSON.stringify(stat));
