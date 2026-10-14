// Sinh js/shopsigns.js: biển hiệu TÊN THẬT từ catalog 551 pano (audit/audit_enriched.json)
// Vị trí = pano + 14m theo heading công trình; chữ lấy trong dấu nháy ở features.
// W3-C (AUDIT3 SIGNTXT): regex cũ /'([^']{2,26})'/g ghép NHẦM cặp nháy khi tên > 26 ký tự → 55/954 biển rác
// ("'; CỬA HÀNG XE ĐẠP'", "'(CHỮ'", "', MÁI HIÊN BẠT XANH'"...). Nay: cặp nháy CHẶT /'([^']*)'/g, bỏ dấu "..."/"…" (tên bị cắt
// trong mô tả), loại cụm MÔ TẢ (LOGO, BÊN CẠNH, BIỂN, MÁI HIÊN, CHỮ…) và TÊN PHỐ ("PHỐ …", "ĐƯỜNG …").
// W3-C vòng 2 (phản biện): KHÔNG cắt chữ giữa cụm nữa (390 tên cắt ở 24 ký tự để lại mảnh "CẢNG VỤ HÀNG HẢI HẢI") — tên tách
// thành ĐOẠN theo dấu phân cách (" - ", " – ", " / ", "|", "·"); bỏ đoạn ĐỊA CHỈ ("69 PHAN BỘI CHÂU", "ĐC: …", "SỐ 2A HỒ XUÂN
// HƯƠNG"), đoạn KHẨU HIỆU/KHUYẾN MÃI ("VÌ …", "TỰ HÀO", "KÍNH CHÀO", "TIẾT KIỆM", "GIẢM GIÁ"…); phần mô tả chữ thường sau tên in
// hoa ("CỬA HÀNG ĐÔNG THỦ chuyên cung cấp…") bị bỏ. Ghép đoạn khi tổng ≤ 24 ký tự; đoạn đầu dài tới 32 ký tự vẫn giữ (world.js
// fillText ép chữ vừa ô bằng maxWidth); dài hơn → bỏ cả tên (không còn tên cụt). Tự kiểm sau khi sinh (exit 1 nếu sai):
// định dạng (dấu câu đầu/cuối, " - - ", 2 dấu cách), thương hiệu theo BRAND_MAP (isBrand) VÀ theo BRAND_WATCH (danh sách
// thương hiệu nổi tiếng rộng hơn — tên nào lọt BRAND_MAP mà khớp WATCH thì phải thêm vào BRAND_MAP rồi chạy lại).
import fs from 'fs';
import { debrand, isBrand, brandWatchHit } from '../../js/brands.js';   // danh sách chặn thương hiệu DÙNG CHUNG
const arr = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const out = [], seen = new Set();
// ===== BRAND FILTER (cấm tên thương hiệu trên biển) — danh sách chặn DÙNG CHUNG ở js/brands.js =====
// (cùng nguồn với lưới an toàn vẽ biển của khối ô world.js / js/cellsink.js). Thêm thương hiệu mới vào ĐÓ, rồi chạy lại.
const MAXL = 32, JOINL = 24;
const DESCR = /(^|\s)(LOGO|BÊN CẠNH|BIỂN|MÁI HIÊN|MÁI CHE|CHỮ|DÒNG CHỮ|KHÔNG RÕ|KHÔNG ĐỌC|MỜ|TRÁI|PHẢI|PHÍA|TẦNG|SỐ NHÀ|ẢNH|HÌNH|BIỂU TƯỢNG)(\s|$)/i;
const STREET = /^(PHỐ|ĐƯỜNG|NGÕ|NGÁCH|HẺM|P\.|Đ\.)\s/i;
// khẩu hiệu / khuyến mãi / băng rôn (cả ĐOẠN bị bỏ)
const SLOGAN = /(^|\s)(VÌ|TỰ HÀO|CHÀO MỪNG|KÍNH CHÀO|MỪNG|MUÔN NĂM|ĐOÀN KẾT|CỘNG HÒA|CỘNG HOÀ|KỶ NIỆM|TIẾT KIỆM|GIẢM GIÁ|KHUYẾN MÃI|KHUYẾN MẠI|SALE|COMING SOON|HÀNG TỐT GIÁ|GIÁ HỜI|UY TÍN|NHẬN SHIP|SHIP ĐI|FREESHIP|MUA \d+ TẶNG|LÃI SUẤT)(\s|$)|^(OPEN|CLOSED|WELCOME)$/i;
// địa chỉ: tên phố lấy từ chính catalog ("Phố Quang Trung", "đường Lê Lợi" → tiền tố 2 từ "QUANG TRUNG", "LÊ LỢI")
const STOPW = new Set(['ĐOẠN', 'ĐANG', 'Ở', 'ĐÔNG', 'ĐI', 'ĐỐI', 'ĐƯỢC', 'GẦN', 'GÓC', 'NGÃ', 'HAI', 'HẢI']);
const STREETS = new Set();
for (const p of arr) for (const t of [p.area || '', p.summary || '']) for (const m of t.matchAll(/(?:^|[\s,(])(?:Phố|phố|Đường|đường|P\.|Đ\.)\s+([^\s,.;()]+)\s+([^\s,.;()]+)/gu)) {
  const w1 = m[1].toUpperCase(), w2 = m[2].toUpperCase();
  if (w1.length >= 2 && w2.length >= 2 && !STOPW.has(w2) && !/\d/.test(w1 + w2) && m[1][0] === m[1][0].toUpperCase()) STREETS.add(w1 + ' ' + w2);
}
STREETS.add('HAI BÀ'); STREETS.add('HẢI BÀ');   // "HAI BÀ TRƯNG" (từ 'HAI' nằm trong STOPW vì "Hải Phòng")
const startsStreet = (t) => { const w = t.split(/\s+/); return STREETS.has(w[0] + ' ' + (w[1] || '')); };
const ADDR_HEAD = /^((SỐ|LÔ|KIOT|KIOSK)\s*)?\d+[A-Z]?([/,.\-]\d+[A-Z]?)*\s+\S|%/;   // "69 PHAN BỘI CHÂU", "LÔ 32 KHU …", "SỐ 2A …", đoạn có '%' (khuyến mãi)
function clean(raw) {
  // thương hiệu khớp trên CẢ chuỗi gốc trước khi cắt phần chữ thường ("FPT Retail" → cắt còn "FPT" thì BRAND_MAP hết khớp)
  if (isBrand(String(raw).toUpperCase())) raw = debrand(String(raw).toUpperCase());
  // phần MÔ TẢ chữ thường sau tên IN HOA: "CỬA HÀNG ĐÔNG THỦ chuyên cung cấp…" → "CỬA HÀNG ĐÔNG THỦ"
  { const w = String(raw).split(/\s+/); let caps = 0, k = 0;
    for (; k < w.length; k++) { if (!/\p{L}/u.test(w[k])) continue; if (/^[^\p{L}]*\p{Ll}/u.test(w[k])) break; caps++; }   // từ VIẾT THƯỜNG đầu ("chuyên"); "OLD Karaoke" giữ
    if (caps >= 1 && k < w.length) raw = w.slice(0, k).join(' '); }   // tên viết thường/hoa-thường từ đầu ("Phúc") → caps 0, giữ
  const cutName = /\.{2,}|…/.test(raw);
  // SĐT/hotline THẬT trong mô tả biển → bỏ (có thể trùng thuê bao thật; biển chung dùng '0000.xxx.xxx')
  //   nhãn SĐT (chỉ khi theo sau là số hoặc hết chuỗi — "ĐT" giữa tên công ty = "đầu tư", giữ) + mọi dãy số bắt đầu bằng 0 ≥ 4 chữ số
  let s = String(raw).replace(/(?<![\p{L}])(S?ĐT|ĐIỆN THOẠI|HOTLINE|TEL|LH)(?![\p{L}])[:.]?\s*(?=[\d(+]|$)[\d .()+]*/giu, ' ')
    .replace(/(?<!\d)0\d{3,}[\d .]*/g, ' ').replace(/\d[\d .]{6,}\d/g, ' ');
  s = s.replace(/(^|[\s(\-–—,])(ĐC|Đ\/C|ĐỊA CHỈ)\s*[:.]?(?=\s|\d|$).*$/i, ' ');          // "… ĐC: SỐ 24 LÊ ĐẠI HÀNH" → bỏ đuôi
  s = s.replace(/\.{2,}|…/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[()[\]{};]/.test(s)) return null;               // mô tả lẫn ngoặc/chấm phẩy (vd "(CHỮ")
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(s)) return null;   // chữ Hán/khác hệ Latin ("北京美容院") — font biển không có
  if (cutName) s = s.replace(/[\s,]+\p{L}{1,2}$/u, '');   // từ cuối bị "..." cắt cụt ≤2 chữ ("KIM TRANG Ô...", "UBND QUẬN LÊ...")
  if (/^(50%|CHO THUÊ)/i.test(s)) return null;
  const U = s.toUpperCase();
  if (DESCR.test(U) || STREET.test(U)) return null;
  // tách ĐOẠN theo dấu phân cách có khoảng trắng hai bên / dấu chấm giữa / gạch đứng
  const segs = U.split(/\s+[-–—/|·•]+\s+|\s*[|·•]\s*|\s*[-–—]{2,}\s*/).map((t) => t.replace(/^[\s,;:\-–—.·/|&]+|[\s,;:\-–—.·/|&]+$/g, '').trim())
    .filter((t) => t && !SLOGAN.test(t) && !ADDR_HEAD.test(t) && !(STREET.test(t)) && !startsStreet(t) && t.replace(/[^\p{L}]/gu, '').length >= 2)
    .map((t) => {   // đuôi địa chỉ trong đoạn: "YẾN ĐỊNH 129 PHAN BỘI CHÂU" → "YẾN ĐỊNH"
      const m = t.match(/^(.*\S)\s+(SỐ\s+)?\d+[A-Z]?([/,]\d+)?\s+(.+)$/);
      return m && (startsStreet(m[4]) || /^(PHỐ|ĐƯỜNG|P\.)\s/.test(m[4])) ? m[1] : t;
    });
  if (!segs.length) return null;
  let name = segs[0];
  name = name.replace(/,\s*\p{L}{1,2}$/u, '');          // đuôi nhãn SĐT ", T: 0225…" (số đã bỏ) → bỏ ", T"
  if (name.length > MAXL) return null;                 // không cắt chữ giữa cụm (tên cụt) — bỏ
  for (let i = 1; i < segs.length; i++) { if (segs[i].replace(/[^\p{L}]/gu, '').length < 3) continue; const t = name + ' - ' + segs[i]; if (t.length > JOINL) break; name = t; }
  if (name.replace(/[^\p{L}\p{N}]/gu, '').length < (cutName ? 6 : 3)) return null;   // mảnh tên bị cắt ("GIA...") vô nghĩa
  if (!/\p{L}{2}/u.test(name)) return null;
  return name;
}
const norm = (t) => t.replace(/(\s*[-–—]\s*){2,}/g, ' - ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—·•|/,:]+|[\s\-–—·•|/,:&]+$/g, '').trim();

let raw = 0, dropped = 0;
for (const p of arr) {
  if (p.X === undefined) continue;
  for (const b of p.buildings || []) {
    if (typeof b.heading !== 'number' || !b.features) continue;
    const all = [...(b.features.matchAll(/'([^']*)'/g))].map((m) => m[1]); raw += all.length;
    const names = all.map(clean).filter(Boolean).slice(0, 2); dropped += Math.min(2, all.length) - names.length;
    for (const name of names) {
      const rad = b.heading * Math.PI / 180;
      const x = +(p.X + Math.sin(rad) * 14).toFixed(1), z = +(p.Z - Math.cos(rad) * 14).toFixed(1);
      const t = norm(debrand(name));
      if (t.replace(/[^\p{L}]/gu, '').length < 2) continue;
      const key = t + '|' + Math.round(x / 30) + '|' + Math.round(z / 30);
      if (seen.has(key)) continue;
      seen.add(key);
      // biển quay MẶT về phía pano (ngược heading): góc quay game cho pháp tuyến -heading
      out.push([x, z, +(-rad).toFixed(3), t]);
    }
  }
}
const bad = out.filter((e) => /^[\s,;:(.…\-–—&/]/.test(e[3]) || /[\s,;:(\-–—./&]$/.test(e[3]) || e[3].length < 2 || e[3].length > MAXL
  || / [-–—] [-–—] |\s{2,}|[-–—]\s*[-–—]/.test(e[3]));
if (bad.length) { console.error('gen_shopsigns: ' + bad.length + ' biển lỗi định dạng', bad.slice(0, 8)); process.exit(1); }
const brand = out.filter((e) => isBrand(e[3]) || brandWatchHit(e[3]));
if (brand.length) { console.error('gen_shopsigns: ' + brand.length + ' biển còn tên THƯƠNG HIỆU (thêm vào js/brands.js BRAND_MAP)', brand.map((e) => e[3] + ' ⇐ ' + (brandWatchHit(e[3]) || 'BRAND_MAP'))); process.exit(1); }
fs.writeFileSync('js/shopsigns.js', '// SINH TỰ ĐỘNG bởi tools/pano_loop/gen_shopsigns.mjs — ĐỪNG SỬA TAY\n'
  + 'export const SHOP_SIGNS = ' + JSON.stringify(out) + ';\n');
console.log('signs:', out.length, '(tên thô', raw + ', bỏ', dropped, '; kiểm định dạng + thương hiệu: 0 lỗi)');
