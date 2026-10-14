// gen_treemap.mjs — đọc mô tả THẢM THỰC VẬT của 551 pano thật (audit/audit_enriched.json, trường `vegetation` + `area`)
// → js/treemap.js: mỗi pano 1 dòng số nguyên nhỏ cho bộ trồng cây (js/trees.js) tra "loài nào, cắt cụt bao nhiêu,
// dày/thưa" quanh điểm trồng. Chạy từ GỐC repo: node tools/gen_treemap.mjs
//
// Định dạng PANO_VEG (phẳng, 21 số/pano): X, Z (×10, nguyên), rồi:
//   [2..8]  wXacu, wBang, wPhuong, wSau, wBangLang, wCau, wDa  — trọng số loài (0 = không nhắc tới)
//   [9]     pollard (0..9 → tỉ lệ cây cắt cụt; = max(polS, polP) — giữ cho tương thích)
//   [10]    young (cây non chống cọc), [11] density (0 không cây … 3 rợp),
//   [12]    wash (gốc quét vôi 0..9), [13] shade (1 = có nhắc cây bóng mát/hàng cây chung chung),
//   [14]    thin (1 = tán THƯA/trụi lá/trơ cành — pano 10/2024 sau bão Yagi; trees.js giảm độ kín tán từng cây)
//   ---- W3-G (Đợt 3 wave 3, AUDIT3 FP-7): bằng chứng THEO NGỮ CẢNH + cờ mới ----
//   [15]    polS — mức cắt cụt của cây VỈA HÈ/ven phố (câu không nói dải phân cách/công viên…)
//   [16]    polP — mức cắt cụt của cây DẢI PHÂN CÁCH / CÔNG VIÊN / VƯỜN HOA / QUẢNG TRƯỜNG / ĐẢO (pano_001: "cây bàng/xà
//           cừ lớn tán rộng ven phố; dải phân cách/công viên trung tâm trồng hàng cây đã cắt trụi cành" → polS 0, polP 7)
//   [17]    tunnel — VÒM CÂY (hàng cây tán lớn rợp/che kín phố: Lê Lợi, Phan Bội Châu, Ký Con…) → tán to, mép tán thấp, dày
//   [18]    topiary — cây cảnh CẮT TỈA TRÒN / cây thế trên ĐẢO GIAO THÔNG / dải phân cách (pano_304) → không cây cổ thụ ở đó
//   [19]    palm — 0 không rõ, 1 = mô tả cây KHÔNG nhắc cau/cọ (→ không trồng cau theo mặc định quanh đây),
//           2 = CHỈ cau/cọ (hàng cau đầu cầu pano_074, không nêu loài cây gỗ nào và không nêu cây bóng mát ở bất kỳ vế nào),
//           3 = CAU DẪN ĐẦU (vế đầu chỉ cau/cọ, "cây bóng mát/tán rộng" nêu ở vế sau — Hồ Sen 320/322, HVT 217/218/220)
//   [20]    lean — cây "nghiêng" (ven hồ pano_033: "tán rộng nghiêng theo gió")
// Heuristic từ khoá tiếng Việt — đếm kiểm ở cuối (in ra console), không hoàn hảo nhưng TẤT ĐỊNH.
import fs from 'fs';

const src = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const has = (s, re) => re.test(s);
const out = [];
const cnt = { n: 0, none: 0, sparse: 0, dense: 0, pollard: 0, young: 0, wash: 0, sp: [0, 0, 0, 0, 0, 0, 0], generic: 0, thin: 0,
  polS: 0, polP: 0, tunnel: 0, topiary: 0, palmNo: 0, palmOnly: 0, palmLead: 0, lean: 0 };
// từ khoá cắt cụt (sau bão Yagi 9/2024 rất phổ biến trên pano 10/2024)
const CUT_RX = /cắt cụt|cắt trụi|trụi cành|đốn tỉa|trơ cành|cắt tỉa|chỉ còn thân|cụt ngọn|trơ thân|thân trơ|cắt ngọn|cắt tán|khô trơ|cưa cụt|tỉa cụt|trụi lá|cành gãy|thân trụi|cắt cành|đốn/;
// ngữ cảnh DẢI PHÂN CÁCH / CÔNG VIÊN của 1 câu (cây trong đó khác cây vỉa hè: pano_001/152/056/428)
// ("khuôn viên" KHÔNG tính — sân cơ quan sau tường rào, pano_515 "hàng cây lớn vừa bị cắt trụi … cây cọ trong khuôn viên")
const PARK_RX = /dải phân cách|công viên|vườn hoa|vườn cây|quảng trường|đảo giao thông|đảo cây|vòng xuyến|bùng binh|dải cây xanh|dải vườn/;
const STREET_RX = /ven phố|vỉa hè|dọc phố|ven đường|hai bên phố|dọc vỉa hè|trên hè/;
// mức cắt cụt của 1 câu: "hàng cây/nhiều cây/toàn bộ … cắt" 7, "một số/vài/một cây" 3, còn lại 5
// (W3-G: + "đốn tỉa MẠNH", "cây cổ thụ bị cắt", "cây … lớn … cắt trụi/trơ" — pano_019 "cây xà cừ/cây bàng lớn bị cắt cụt ngọn
// (đốn tỉa mạnh)" từng ra 3 vì "vài cây phượng" ở câu khác)
const cutLevel = (s) => has(s, /một cây|một gốc|(một số|vài) (cây|gốc)[^;,.]{0,25}(cắt|đốn|trụi)/) ? 3 : has(s, /nhiều cây[^;,.]*(cắt|đốn|trụi)|hàng cây[^;,.]*(cắt|đốn|trụi)|toàn bộ|đều bị|(cắt|đốn)[^;.]*hai bên|cây cổ thụ[^;,.]*(cắt|đốn|trụi)|(cắt|đốn|tỉa)[^;,.]*mạnh|cây[^;,.]* lớn[^;,.]*(cắt trụi|trơ|chỉ còn thân)/) ? 7
  : has(s, /một số|vài/) ? 3 : 5;
// (phiên 3: "hàng cây cổ thụ … (một số cây bị cắt trụi cành)" — pano_262 — từng ra 7 qua nhánh "hàng cây…cắt": "một số/vài cây … cắt" xét TRƯỚC)
// cau/cọ: "cọ" KHÔNG được khớp "cọc" (cọc chống cây non!) — bug v1: mọi pano "chống cọc" thành có cau (w=3)
const PALM_RX = /cau(?![a-zà-ỹđ])|cọ(?![a-zà-ỹđ])|palm|dừa/;
// phố có VÒM CÂY thật (AUDIT3 FP-7: Lê Lợi, Hạ Lý, Phan Bội Châu, Lý Thường Kiệt, Ký Con) — chỉ nâng pano ĐÃ nói có hàng cây
// (review W3-G: chỉ TÊN PHỐ ở ĐẦU area — "phường Hạ Lý" (Phạm Phú Thứ 098/100), "Ngõ 80 phố Hạ Lý" (530-549) từng bị tính)
const TUNNEL_STREETS = /^((Đầu|Cuối|Góc) )?([Pp]hố |Đường |P\. )?(Lê Lợi|Hạ Lý|Phan Bội Châu|Lý Thường Kiệt|Ký Con)(?!\p{L})/u;
for (const e of src) {
  if (typeof e.X !== 'number' || typeof e.Z !== 'number') continue;
  const v = (e.vegetation || '').toLowerCase(), area = e.area || '';
  // --- loài: nhắc tên = 1 đơn vị; "hàng/nhiều/rất nhiều" ngay trước tên → nặng hơn ---
  const w = [0, 0, 0, 0, 0, 0, 0];
  if (has(v, /xà cừ|muồng|me lớn|me\b/)) w[0] = has(v, /hàng (cây )?xà cừ|xà cừ cổ thụ|cổ thụ/) ? 9 : 6;
  if (has(v, /bàng/)) w[1] = has(v, /hàng (cây )?bàng/) ? 8 : 5;
  if (has(v, /phượng/)) w[2] = has(v, /hàng (cây )?phượng|phượng (vĩ|đỏ)/) ? 8 : 5;
  if (has(v, /sấu/)) w[3] = 6;
  if (has(v, /bằng lăng/)) w[4] = 6;
  // cau vua / cọ: thường "ở xa" hoặc "trong chậu" (cây cảnh) — chỉ tính đậm khi là HÀNG cau/nhiều cau
  if (has(v, PALM_RX)) {
    if (has(v, /hàng (cây )?(cau|cọ)|nhiều (cây )?(cau|cọ)|hai hàng cau|rất nhiều cau|cau vua (cao|rất)/)) w[5] = 7;
    else if (has(v, /chậu (cây )?(cau|cọ)|(cau|cọ) cảnh|cau\/cọ cảnh/)) w[5] = 0;
    else if (has(v, /(cau|cọ)[^;,.]*ở xa/)) w[5] = 1;
    else w[5] = 3;
  }
  if (has(v, /cây đa|đa\/si|đa cổ thụ|cây si|rễ phụ|rủ rễ/)) w[6] = 4;
  const anySp = w.some((x) => x > 0);
  // --- cắt cụt: bỏ cụm "cây cảnh/bụi/bồn/hàng rào … cắt tỉa" (topiary, hàng rào xén) trước khi dò ---
  const vp = v.replace(/(cây cảnh|bụi( cây)?|bồn( cây)?( bụi)?|hàng rào( cây)?( xanh)?|cây bụi|cây thế|cây tùng|bonsai|topiary|vườn cảnh|đảo cây cảnh|khóm cây)[^;,.]*?(cắt tỉa|tỉa xén|xén)/g, '');
  let pollard = 0, polS = 0, polP = 0;
  if (has(vp, CUT_RX)) {
    pollard = cutLevel(vp);
    // W3-G: theo CÂU — câu nói dải phân cách/công viên → polP, còn lại → polS. Câu có cả hai (vd "hàng cây dọc dải phân
    // cách/quảng trường … cắt") → cả hai cùng mức.
    // ngữ cảnh theo CÂU (; .): câu chỉ nói công viên/dải phân cách → cả câu là "park" (pano_038 "dải công viên trung tâm cỏ
    // xanh, nhiều cây bóng mát bị cắt trụi cành"); câu nói cả hai → theo từng vế (,), vế không nêu gì thừa hưởng ngữ cảnh
    // nêu TRƯỚC trong câu
    for (const sen of vp.split(/[;.]/)) {
      if (!has(sen, CUT_RX)) continue;
      const sP = has(sen, PARK_RX), sS = has(sen, STREET_RX);
      let ctx = sP && !sS ? 'P' : 'S';
      if (sP && sS) ctx = sen.search(PARK_RX) < sen.search(STREET_RX) ? 'P' : 'S';
      for (const cl of sen.split(',')) {
        if (has(cl, PARK_RX)) ctx = 'P'; else if (has(cl, STREET_RX)) ctx = 'S';
        if (!has(cl, CUT_RX)) continue;
        const lv = cutLevel(cl);
        if (ctx === 'P') polP = Math.max(polP, lv); else polS = Math.max(polS, lv);
      }
    }
    if (!polS && !polP) polS = pollard;
    pollard = Math.max(polS, polP);
  }
  const young = has(v, /cây non|mới trồng|cọc chống|chống cọc|giàn chống|cọc gỗ/) ? (has(v, /hàng cây non|hàng cây mới/) ? 6 : 3) : 0;
  // --- mật độ ---
  let density = 2;
  if (has(v, /hầu như không có cây|gần như không có cây|không có cây thật|rất ít cây|không có cây xanh|không thấy cây/)) density = 0;
  // W3-G: + "một số cây", "lác đác", "ít cây lớn" (pano_147 Cát Cụt "một số cây thân gỗ vừa…" từng ra mật độ thường)
  // (không tính khi câu khác nói "hàng cây/nhiều cây/rợp…": "một cây đa cổ thụ" ở pano_400 là điểm nhấn, không phải thưa)
  else if (has(v, /^ít cây|ít cây (lớn|xanh|đường phố|trên)|ít cây;|ít cây,|ít cây\.|ít cây$|rải rác|thưa|một cây|vài cây|một số cây|lác đác|lưa thưa/) && !has(v, /hàng cây|nhiều (cây|cau|cọ|xà cừ|bàng|phượng|sấu)|rợp|dày đặc|xanh um|hai bên/)) density = 1;
  else if (has(v, /hàng cây|rợp|hai bên|dọc (hai|2) bên|tán (rất )?rộng|cổ thụ|nhiều cây|dày đặc|xanh um/)) density = 3;
  const generic = has(v, /cây bóng mát|hàng cây|cây xanh|cây lớn|cây thân|cổ thụ|cây tán/) ? 1 : 0;
  if (!anySp && !generic && density > 1) density = 1;   // chỉ nói cây cảnh/cỏ → thưa
  const wash = has(v, /quét vôi|vôi trắng|sơn trắng|thân trắng/) ? 9 : 0;
  // tán thưa (KHÔNG tính "cành khô chất ven đường" — chỉ cụm nói về TÁN/LÁ của cây đứng)
  const thin = has(v, /tán thưa|thưa lá|lá thưa|tán mỏng|trụi lá|tán không đều|lá khô|trơ cành|lưa thưa|xơ xác/) ? 1 : 0;
  // --- W3-G: VÒM CÂY: hàng cây tán lớn rợp / che kín phố (không tính khi pano nói cây thưa/cắt trụi hàng loạt) ---
  // (review W3-G: không tính "cây xanh lớn RẢI RÁC, tán rợp" — pano_130 Phan Bội Châu thật thưa, vòm cây làm tán quá dày;
  // KHÔNG chặn "vài cây"/"một cây": 551 "…rợp bóng hai bên, vài cây cọ trong sân", 123 "một cây bị cắt cụt ngọn" vẫn là vòm)
  let tunnel = density === 3 && has(v, /rợp|vòm|tán giao|che kín|phủ kín|che phủ|che rợp|che phố|tán dày|bóng dày|bóng râm dày|che bóng gần kín|tán rậm/) && !has(v, /rải rác|lác đác|lưa thưa/) ? 1 : 0;
  if (!tunnel && density >= 2 && TUNNEL_STREETS.test(area) && has(v, /hàng cây|cây (bóng mát|xanh|thân gỗ) (lớn|tán)|tán (lớn|rộng)/) && !has(v, /rải rác|vài cây|một cây/)) tunnel = 1;
  if (polS >= 7 || thin) tunnel = 0;
  // --- W3-G: cây cảnh cắt tỉa tròn / cây thế trên ĐẢO GIAO THÔNG / dải phân cách (pano_304 nút HVT, 349, 440, 312…) ---
  // (không tính khi cùng mô tả có hàng cây LỚN — pano_421 "hàng cây xà cừ cổ thụ … dải phân cách, nhiều cây cảnh cắt tỉa")
  const topiary = has(v, /topiary|cắt tỉa tròn|tỉa tròn|cây thế|bonsai|cây xén|xén tròn|cắt tỉa hình|cây tùng/) && has(v, /đảo giao thông|đảo cây|dải phân cách|nút giao|vòng xuyến|giao lộ/)
    && !has(v, /cổ thụ|tán (rất )?(rộng|lớn)|cây (bóng mát|xanh) (lớn|tán)|hàng cây (xà cừ|bàng|phượng|sấu|lớn|bóng mát|xanh lớn)/) ? 1 : 0;
  // --- W3-G: cau/cọ theo BẰNG CHỨNG: 1 = mô tả có cây mà không có cau/cọ/dừa; 2 = chỉ cau/cọ (không loài gỗ nào) ---
  const treeTalk = anySp || generic || has(v, /cây (bàng|phượng|xà cừ|sấu|bóng mát|tán)/);
  // "chỉ cau/cọ" = câu ĐẦU nói cau/cọ (đối tượng chính của khung), không loài gỗ nào được nêu — pano_074 "nhiều cây cọ/cau vua
  // cao dọc đầu cầu, …"; KHÔNG pano_225 "hàng cây tán rộng (…) và cọ/cau vua cao dọc dải phân cách"
  const first = v.split(/[;.,]/)[0];
  // (review W3-G: cây bóng mát nêu ở BẤT KỲ vế nào → không "chỉ cau" — 062/183/217/218/220/320/322/547/549 có "…, cây bóng
  // mát/tán rộng" sau vế cau; từng ra 100% cau trên cả tuyến, Hồ Sen 320 thành đại lộ cau) → 3 = "CAU DẪN ĐẦU": vế đầu chỉ
  // cau, cây bóng mát nêu SAU (trees.js: cây chung nặng 0,5 × cau thay vì 1 × ⇒ cau ~45% thay vì ~30% / 100%)
  const palmLead = has(v, PALM_RX) && w[5] >= 7 && has(first, PALM_RX) && !has(first, /hàng cây|cây (bóng mát|xanh|lớn|tán)|tán rộng/) && !w[0] && !w[1] && !w[2] && !w[3] && !w[4];
  const palm = has(v, PALM_RX) ? (palmLead ? (has(v, /cây bóng mát|cây tán rộng|tán rộng|cây (xanh|thân gỗ) lớn|hàng cây (bóng|tán|lớn)/) ? 3 : 2) : 0) : treeTalk && density > 0 ? 1 : 0;
  const lean = has(v, /nghiêng/) ? 1 : 0;
  out.push([Math.round(e.X * 10), Math.round(e.Z * 10), ...w, pollard, young, density, wash, generic, thin, polS, polP, tunnel, topiary, palm, lean]);
  cnt.n++; if (density === 0) cnt.none++; if (density === 1) cnt.sparse++; if (density === 3) cnt.dense++;
  if (pollard) cnt.pollard++; if (young) cnt.young++; if (wash) cnt.wash++; if (generic) cnt.generic++; if (thin) cnt.thin++;
  if (polS) cnt.polS++; if (polP) cnt.polP++; if (tunnel) cnt.tunnel++; if (topiary) cnt.topiary++; if (palm === 1) cnt.palmNo++; if (palm === 2) cnt.palmOnly++; if (palm === 3) cnt.palmLead++; if (lean) cnt.lean++;
  w.forEach((x, i) => { if (x) cnt.sp[i]++; });
}
const flat = out.flat();
const txt = '// SINH TỰ ĐỘNG bởi tools/gen_treemap.mjs từ audit/audit_enriched.json — ĐỪNG SỬA TAY.\n'
  + '// Thảm cây quanh 551 pano thật: 21 số/pano = X·10, Z·10, wXacu, wBang, wPhuong, wSau, wBangLang, wCau, wDa,\n'
  + '// pollard, young, density(0..3), wash, generic, thin, polS, polP, tunnel, topiary, palm, lean — xem đầu tools/gen_treemap.mjs.\n'
  + 'export const PANO_VEG_STRIDE = 21;\n'
  + 'export const PANO_VEG = [' + flat.join(',') + '];\n';
fs.writeFileSync('js/treemap.js', txt);
console.log('js/treemap.js', txt.length, 'byte', JSON.stringify(cnt));
