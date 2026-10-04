// gen_treemap.mjs — đọc mô tả THẢM THỰC VẬT của 551 pano thật (audit/audit_enriched.json, trường `vegetation`)
// → js/treemap.js: mỗi pano 1 dòng số nguyên nhỏ cho bộ trồng cây (js/trees.js) tra "loài nào, cắt cụt bao nhiêu,
// dày/thưa" trong bán kính 60 m quanh điểm trồng. Chạy từ GỐC repo: node tools/gen_treemap.mjs
//
// Định dạng PANO_VEG (phẳng, 15 số/pano): X, Z (×10, nguyên), rồi:
//   wXacu, wBang, wPhuong, wSau, wBangLang, wCau, wDa  — trọng số loài (0 = không nhắc tới)
//   pollard (0..9 → 0..0.9 tỉ lệ cây cắt cụt), young (cây non chống cọc), density (0 không cây … 3 rợp),
//   wash (gốc quét vôi 0..9), shade (1 = có nhắc cây bóng mát/hàng cây chung chung),
//   thin (1 = tán THƯA/trụi lá/trơ cành — pano 10/2024 sau bão Yagi; trees.js giảm độ kín tán từng cây)
// Heuristic từ khoá tiếng Việt — đếm kiểm ở cuối (in ra console), không hoàn hảo nhưng TẤT ĐỊNH.
import fs from 'fs';

const src = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const has = (s, re) => re.test(s);
const out = [];
const cnt = { n: 0, none: 0, sparse: 0, dense: 0, pollard: 0, young: 0, wash: 0, sp: [0, 0, 0, 0, 0, 0, 0], generic: 0, thin: 0 };
for (const e of src) {
  if (typeof e.X !== 'number' || typeof e.Z !== 'number') continue;
  const v = (e.vegetation || '').toLowerCase();
  // --- loài: nhắc tên = 1 đơn vị; "hàng/nhiều/rất nhiều" ngay trước tên → nặng hơn ---
  const w = [0, 0, 0, 0, 0, 0, 0];
  if (has(v, /xà cừ|muồng|me lớn|me\b/)) w[0] = has(v, /hàng (cây )?xà cừ|xà cừ cổ thụ|cổ thụ/) ? 9 : 6;
  if (has(v, /bàng/)) w[1] = has(v, /hàng (cây )?bàng/) ? 8 : 5;
  if (has(v, /phượng/)) w[2] = has(v, /hàng (cây )?phượng|phượng (vĩ|đỏ)/) ? 8 : 5;
  if (has(v, /sấu/)) w[3] = 6;
  if (has(v, /bằng lăng/)) w[4] = 6;
  // cau vua / cọ: thường "ở xa" hoặc "trong chậu" (cây cảnh) — chỉ tính đậm khi là HÀNG cau/nhiều cau
  if (has(v, /cau|cọ|palm/)) {
    if (has(v, /hàng (cây )?(cau|cọ)|nhiều (cây )?(cau|cọ)|hai hàng cau|rất nhiều cau|cau vua (cao|rất)/)) w[5] = 7;
    else if (has(v, /chậu (cây )?(cau|cọ)|(cau|cọ) cảnh|cau\/cọ cảnh/)) w[5] = 0;
    else if (has(v, /(cau|cọ)[^;,.]*ở xa/)) w[5] = 1;
    else w[5] = 3;
  }
  if (has(v, /cây đa|đa\/si|đa cổ thụ|cây si|rễ phụ|rủ rễ/)) w[6] = 4;
  const anySp = w.some((x) => x > 0);
  // --- cắt cụt (sau bão Yagi 9/2024 rất phổ biến trên pano 10/2024) ---
  let pollard = 0;
  // bỏ cụm "cây cảnh/bụi/bồn/hàng rào … cắt tỉa" (topiary, hàng rào xén) trước khi dò cây CẮT CỤT
  const vp = v.replace(/(cây cảnh|bụi( cây)?|bồn( cây)?( bụi)?|hàng rào( cây)?( xanh)?|cây bụi|cây thế|cây tùng|bonsai|topiary|vườn cảnh|đảo cây cảnh)[^;,.]*?(cắt tỉa|tỉa xén|xén)/g, '');
  if (has(vp, /cắt cụt|cắt trụi|trụi cành|đốn tỉa|trơ cành|cắt tỉa|chỉ còn thân|cụt ngọn|trơ thân|thân trơ|cắt ngọn|cắt tán|khô trơ|cưa cụt|tỉa cụt|trụi lá|cành gãy|thân trụi|cắt cành/)) {
    pollard = has(vp, /nhiều cây[^;.]*(cắt|đốn|trụi)|hàng cây[^;.]*(cắt|đốn|trụi)|toàn bộ|đều bị|(cắt|đốn)[^;.]*hai bên/) ? 7 : has(vp, /một số|vài|một cây/) ? 3 : 5;
  }
  const young = has(v, /cây non|mới trồng|cọc chống|chống cọc|giàn chống|cọc gỗ/) ? (has(v, /hàng cây non|hàng cây mới/) ? 6 : 3) : 0;
  // --- mật độ ---
  let density = 2;
  if (has(v, /hầu như không có cây|gần như không có cây|không có cây thật|rất ít cây|không có cây xanh|không thấy cây/)) density = 0;
  else if (has(v, /^ít cây|ít cây (lớn|xanh|đường phố|trên)|ít cây;|ít cây,|ít cây\.|ít cây$|rải rác|thưa|một cây|vài cây/) && !has(v, /hàng cây/)) density = 1;
  else if (has(v, /hàng cây|rợp|hai bên|dọc (hai|2) bên|tán (rất )?rộng|cổ thụ|nhiều cây/)) density = 3;
  const generic = has(v, /cây bóng mát|hàng cây|cây xanh|cây lớn|cây thân/) ? 1 : 0;
  if (!anySp && !generic && density > 1) density = 1;   // chỉ nói cây cảnh/cỏ → thưa
  const wash = has(v, /quét vôi|vôi trắng|sơn trắng|thân trắng/) ? 9 : 0;
  // tán thưa (KHÔNG tính "cành khô chất ven đường" — chỉ cụm nói về TÁN/LÁ của cây đứng)
  const thin = has(v, /tán thưa|thưa lá|lá thưa|tán mỏng|trụi lá|tán không đều|lá khô|trơ cành|lưa thưa|xơ xác/) ? 1 : 0;
  out.push([Math.round(e.X * 10), Math.round(e.Z * 10), ...w, pollard, young, density, wash, generic, thin]);
  cnt.n++; if (density === 0) cnt.none++; if (density === 1) cnt.sparse++; if (density === 3) cnt.dense++;
  if (pollard) cnt.pollard++; if (young) cnt.young++; if (wash) cnt.wash++; if (generic) cnt.generic++; if (thin) cnt.thin++;
  w.forEach((x, i) => { if (x) cnt.sp[i]++; });
}
const flat = out.flat();
const txt = '// SINH TỰ ĐỘNG bởi tools/gen_treemap.mjs từ audit/audit_enriched.json — ĐỪNG SỬA TAY.\n'
  + '// Thảm cây quanh 551 pano thật: 15 số/pano = X·10, Z·10, wXacu, wBang, wPhuong, wSau, wBangLang, wCau, wDa,\n'
  + '// pollard, young, density(0..3), wash, generic, thin — xem đầu tools/gen_treemap.mjs.\n'
  + 'export const PANO_VEG_STRIDE = 15;\n'
  + 'export const PANO_VEG = [' + flat.join(',') + '];\n';
fs.writeFileSync('js/treemap.js', txt);
console.log('js/treemap.js', txt.length, 'byte', JSON.stringify(cnt));
