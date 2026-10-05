// Sinh js/shopsigns.js: biển hiệu TÊN THẬT từ catalog 551 pano (audit/audit_enriched.json)
// Vị trí = pano + 14m theo heading công trình; chữ lấy trong dấu nháy ở features.
// W3-C (AUDIT3 SIGNTXT): regex cũ /'([^']{2,26})'/g ghép NHẦM cặp nháy khi tên > 26 ký tự → 55/954 biển rác
// ("'; CỬA HÀNG XE ĐẠP'", "'(CHỮ'", "', MÁI HIÊN BẠT XANH'"...). Nay: cặp nháy CHẶT /'([^']*)'/g, bỏ dấu "..."/"…" (tên bị cắt
// trong mô tả), cắt ở RANH GIỚI TỪ ≤ 24 ký tự, loại chuỗi mở/kết bằng dấu câu, cụm MÔ TẢ (LOGO, BÊN CẠNH, BIỂN, MÁI HIÊN, CHỮ…)
// và TÊN PHỐ ("PHỐ …", "ĐƯỜNG …"). Tự kiểm sau khi sinh: 0 biển khớp /^[\s,;:(.…]/ hay kết bằng dấu câu.
import fs from 'fs';
import { debrand } from '../../js/brands.js';   // danh sách chặn thương hiệu DÙNG CHUNG
const arr = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const out = [], seen = new Set();
// ===== BRAND FILTER (cấm tên thương hiệu trên biển) — danh sách chặn DÙNG CHUNG ở js/brands.js =====
// (cùng nguồn với lưới an toàn vẽ biển của khối ô world.js / js/cellsink.js). Thêm thương hiệu mới vào ĐÓ, rồi chạy lại.
const MAXL = 24;
const DESCR = /(^|\s)(LOGO|BÊN CẠNH|BIỂN|MÁI HIÊN|MÁI CHE|CHỮ|DÒNG CHỮ|KHÔNG RÕ|KHÔNG ĐỌC|MỜ|TRÁI|PHẢI|PHÍA|TẦNG|SỐ NHÀ|ẢNH|HÌNH|BIỂU TƯỢNG)(\s|$)/i;
const STREET = /^(PHỐ|ĐƯỜNG|NGÕ|NGÁCH|HẺM|P\.|Đ\.)\s/i;
function clean(raw) {
  const cutName = /\.{2,}|…/.test(raw);
  // SĐT/hotline THẬT trong mô tả biển → bỏ (có thể trùng thuê bao thật; biển chung dùng '0000.xxx.xxx')
  //   nhãn SĐT (chỉ khi theo sau là số hoặc hết chuỗi — "ĐT" giữa tên công ty = "đầu tư", giữ) + mọi dãy số bắt đầu bằng 0 ≥ 4 chữ số
  let s = String(raw).replace(/(?<![\p{L}])(S?ĐT|ĐIỆN THOẠI|HOTLINE|TEL|LH)(?![\p{L}])[:.]?\s*(?=[\d(+]|$)[\d .()+]*/giu, ' ')
    .replace(/(?<!\d)0\d{3,}[\d .]*/g, ' ').replace(/\d[\d .]{6,}\d/g, ' ');
  s = s.replace(/\.{2,}|…/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s,;:()\-–—.·/|]+/, '').replace(/[\s,;:()\-–—.·/|]+$/, '').trim();
  if (s.length < 2 || !/[A-ZĐÀ-Ỹ0-9]/i.test(s)) return null;
  if (/^(50%|CHO THUÊ)/i.test(s)) return null;
  const U = s.toUpperCase();
  if (DESCR.test(U) || STREET.test(U)) return null;
  if (/[()[\]{};]/.test(U)) return null;               // mô tả lẫn ngoặc/chấm phẩy (vd "(CHỮ")
  if (U.length > MAXL) {                                // cắt ở ranh giới từ
    const cut = U.slice(0, MAXL + 1), k = cut.lastIndexOf(' ');
    s = (k >= 8 ? cut.slice(0, k) : U.slice(0, MAXL)).replace(/[\s,;:\-–—.·/|&]+$/, '');
  } else s = U;
  if (s.replace(/[^A-ZĐÀ-Ỹ0-9]/gi, '').length < (cutName ? 6 : 3)) return null;   // mảnh tên bị cắt ("GIA...") vô nghĩa
  return s;
}

for (const p of arr) {
  if (p.X === undefined) continue;
  for (const b of p.buildings || []) {
    if (typeof b.heading !== 'number' || !b.features) continue;
    const names = [...(b.features.matchAll(/'([^']*)'/g))].map((m) => clean(m[1])).filter(Boolean).slice(0, 2);
    for (const name of names) {
      const rad = b.heading * Math.PI / 180;
      const x = +(p.X + Math.sin(rad) * 14).toFixed(1), z = +(p.Z - Math.cos(rad) * 14).toFixed(1);
      const key = name + '|' + Math.round(x / 30) + '|' + Math.round(z / 30);
      if (seen.has(key)) continue;
      seen.add(key);
      // biển quay MẶT về phía pano (ngược heading): góc quay game cho pháp tuyến -heading
      const t = debrand(name).slice(0, MAXL);
      out.push([x, z, +(-rad).toFixed(3), t]);
    }
  }
}
const bad = out.filter((e) => /^[\s,;:(.…\-]/.test(e[3]) || /[\s,;:(\-–—./]$/.test(e[3]) || e[3].length < 2);
if (bad.length) { console.error('gen_shopsigns: ' + bad.length + ' biển lỗi định dạng', bad.slice(0, 5)); process.exit(1); }
fs.writeFileSync('js/shopsigns.js', '// SINH TỰ ĐỘNG bởi tools/pano_loop/gen_shopsigns.mjs — ĐỪNG SỬA TAY\n'
  + 'export const SHOP_SIGNS = ' + JSON.stringify(out) + ';\n');
console.log('signs:', out.length, '(kiểm định dạng: 0 lỗi)');
