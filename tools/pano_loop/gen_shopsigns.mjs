// Sinh js/shopsigns.js: biển hiệu TÊN THẬT từ catalog 551 pano (audit/audit_enriched.json)
// Vị trí = pano + 14m theo heading công trình; chữ lấy trong dấu nháy ở features.
import fs from 'fs';
const arr = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const out = [], seen = new Set();
// ===== BRAND FILTER (cell_brand — cấm tên thương hiệu trên biển) =====
// ===== BRAND FILTER (thêm trên cùng, trước vòng for) =====
// map: regex brand  ->  từ chung thay thế (đặt regex "tham lam" hơn lên trước)
const BRAND_MAP = [
  // ngân hàng
  [/\b(VIETCOMBANK|VIETINBANK|AGRIBANK|BIDV|VPBANK|MSB|SHB|ACB|TECHCOMBANK|VIB|SCB|SEABANK|TPBANK|OCB|SACOMBANK|PVCOMBANK|ABBANK|VIETABANK|SAIGONBANK|EXIMBANK|HD ?BANK|PG ?BANK|BAOVIET ?BANK|NAM ?A ?BANK|LPBANK)\b.*/i, 'NGÂN HÀNG'],
  // tiện lợi / siêu thị
  [/\b(CIRCLE ?K|GS25|MINISTOP|B'?S ?MART)\b.*/i, 'CỬA HÀNG TIỆN LỢI'],
  [/\b(WINMART|VINMART|BRG ?MART|CO\.?OPMART|BÁCH HÓA XANH)\S*.*/i, 'SIÊU THỊ'],
  // viễn thông
  [/\bVIETTEL ?POST\b.*/i, 'CHUYỂN PHÁT NHANH'],
  [/\b(VIETTEL|VINAPHONE|MOBIFONE|VNPT)\b.*/i, 'VIỄN THÔNG'],
  [/\bVIETNAM ?AIRLINES\b.*/i, 'VÉ MÁY BAY'],
  // cà phê / trà / F&B
  [/\b(HIGHLANDS|THE COFFEE HOUSE|AHA ?COFFEE|TRUNG NGUY[ÊE]N|PHÚC LONG|KATINAT|STARBUCKS)\b.*/i, 'CÀ PHÊ'],
  [/\b(MIXUE|TOCOTOCO|GONG ?CHA|MR ?GOOD ?TEA|CHATIME)\b.*/i, 'TRÀ SỮA'],
  [/\b(KFC|LOTTERIA|JOLLIBEE|DON ?CHICKEN|TEXAS ?CHICKEN|POPEYES)\b.*/i, 'GÀ RÁN'],
  [/\bBOSSAM\b.*/i, 'QUÁN NƯỚNG'], [/\bPIZZA ?(HUT|COMPANY)?\b.*/i, 'PIZZA'],
  [/\bFUNZ\b.*/i, 'TRÀ & BAR'],
  [/\bVIFON\b.*/i, 'MÌ ĂN LIỀN'],
  [/\b(HEINEKEN|STRONGBOW|TIGER ?BEER|SAIGON ?BEER|HABECO|CHIVAS)\b.*/i, 'BIA RƯỢU'],
  // điện thoại / điện máy / điện lạnh
  [/\b(OPPO|SAMSUNG|SAMCENTER|IPHONE|APPLE|XIAOMI|VIVO|NOKIA|REALME|HUAWEI|HD ?MOBILE|SHB ?MOBILE)\b.*/i, 'ĐIỆN THOẠI'],
  [/\b(PICO|SAMNEC|MEDIA ?MART|ĐIỆN MÁY XANH|SONY|PANASONIC|TOSHIBA|BEKO|HITACHI|TCL)\b.*/i, 'ĐIỆN MÁY'],
  [/\b(CHIGO|GREE|DAIKIN|AQUA|HIKAWA)\b.*/i, 'ĐIỀU HÒA'],
  [/\b(BOSCH|TAKARA|SPELIER)\b.*/i, 'THIẾT BỊ NHÀ BẾP'],
  [/\bOMRON\b.*/i, 'THIẾT BỊ Y TẾ'],
  // xe / lốp / dầu
  [/\bHONDA ?(HEAD)?\b.*/i, 'XE MÁY'], [/\bYAMAHA\b.*/i, 'XE MÁY'],
  [/\b(YADEA|DK ?BIKE|PEGA|VINFAST)\b.*/i, 'XE ĐIỆN'],
  [/\b(MICHELIN|CONTINENTAL|GOODYEAR)\b.*/i, 'LỐP XE'],
  [/\bCASTROL\b.*/i, 'DẦU NHỚT'], [/\bPETROLIMEX\b.*/i, 'CÂY XĂNG'],
  // thời trang / giày / trang sức
  [/\b(ZARA|H&M|MANGO|LEVI'?S|IVY ?MODA|CANIFA|ELISE|CHRISBELLA|TOKYOLIFE|SUNFLY|SIXDO|JK ?JEANS?|QIAODAN|WHITE ?DAISY|MOCHI|4TEEN|MADE IN VIETNAM|HOANG ?PHUC|ARISTINO|KAPPA|VIET ?TIEN|VTEC|FORMAT|AFANI|VICTORIA'?S? ?SECRET|VICTORIA)\b.*/i, 'THỜI TRANG'],
  [/\bTRIUMPH\b.*/i, 'ĐỒ LÓT'],
  [/\bBITI'?S?\b.*/i, 'GIÀY DÉP'],
  [/\bDOJI\b.*/i, 'TRANG SỨC'], [/\bPNJ\b.*/i, 'TIỆM VÀNG'], [/\bSJC\b.*/i, 'VÀNG BẠC'],
  // nhà thuốc / mỹ phẩm / mẹ&bé
  [/\b(PHARMACITY|LONG ?CHÂU|AN ?KHANG|GUARDIAN|MEDICARE)\b.*/i, 'NHÀ THUỐC'],
  [/\bMEDELA\b.*/i, 'MẸ & BÉ'], [/\bTENAMYD\b.*/i, 'MỸ PHẨM'],
  // chăn ga / nội thất / sơn / nhựa / nhôm
  [/\b(EVERON|HANVICO|LIÊN ?Á)\b.*/i, 'CHĂN GA GỐI ĐỆM'],
  [/\b(HÒA PHÁT|S\.?HOME)\b.*/i, 'NỘI THẤT'],
  [/\bJOTUN\b.*/i, 'CỬA HÀNG SƠN'],
  [/\b(NHỰA ?)?TIỀN PHONG\b.*/i, 'ỐNG NHỰA'],
  [/\bXINGFA\b/i, ''],  // strip: giữ phần "NHÔM KÍNH ..." còn lại
  // giáo dục / tóc / cầm đồ / bảo hiểm / karaoke / đồ chơi / vận tải
  [/\b(APOLLO|SCOTS ?ENGLISH|ILA|VUS|OCEAN ?EDU)\b.*/i, 'ANH NGỮ'],
  [/\b30 ?SHINE\b.*/i, 'TÓC NAM'],
  [/\bF88\b.*/i, 'CẦM ĐỒ'], [/\bFERROLI\b.*/i, 'MÁY NƯỚC NÓNG'],
  [/\b(BẢO VIỆT|GENERALI|PRUDENTIAL|MANULIFE)\b.*/i, 'BẢO HIỂM'],
  [/\bVINAKTV\b.*/i, 'KARAOKE'],
  [/\b(MY ?KINGDOM|VUA ĐỒ CHƠI)\b.*/i, 'ĐỒ CHƠI'],
  [/\b(VINASHIP|VOSA|VOSCO)\b.*/i, 'CÔNG TY VẬN TẢI BIỂN'],
  [/\bVINACOMIN\b.*/i, 'CÔNG TY THAN'],
  [/\b(PROSIMEX|VITIMEX)\b.*/i, 'CÔNG TY THƯƠNG MẠI'],
  [/\bDELTA ?GROUP\b.*/i, 'NHÀ THẦU XÂY DỰNG'],
  [/\bSUMMO\b.*/i, 'CÔNG TRÌNH'],
  [/\b(FPT ?RETAIL|FPT ?SHOP|VIETTEL ?STORE|THẾ GIỚI DI ĐỘNG|CELLPHONES)\b.*/i, 'ĐIỆN THOẠI'],
  [/\bJ&T ?EXPRESS\b.*/i, 'CHUYỂN PHÁT NHANH'],
  [/\b(HIDOO|GENCE)\b.*/i, 'CỬA HÀNG'],
  // === bổ sung (rà soát pano thực tế 2026-07) ===
  [/\bBRG\b.*/i, 'SIÊU THỊ'],                              // BRG Group (BRG Shopping...)
  [/\bCP ?(PORK|FRESH)\b.*/i, 'CỬA HÀNG THỊT'],            // C.P. Vietnam (CP Pork Shop)
  [/\bSIMILAC\b.*/i, 'MẸ & BÉ'],                            // sữa Similac (Abbott)
  [/\b(BOSE|JBL|DENON|MARSHALL|HARMAN ?KARDON)\b.*/i, 'THIẾT BỊ ÂM THANH'],
  [/\bVAB\b.*/i, 'NGÂN HÀNG'],                              // VietABank (viết tắt VAB)
  [/\bBIA HÀ.*/i, 'BIA HƠI'],                               // Habeco "Bia Hà Nội"
  [/\bCOOLER ?CITY\b.*/i, 'TRÀ SỮA'],                      // chuỗi trà sữa Cooler City
  [/\bBAMBOO\b/i, ''],                                      // Bamboo Airways -> strip, giữ "VÉ MÁY BAY"
];

function debrand(raw) {
  let s = raw;
  for (const [re, generic] of BRAND_MAP) {
    if (re.test(s)) {
      if (generic === '') { s = s.replace(re, '').replace(/[\s\-–—·•|]+$/,'').trim(); }
      else { s = generic; break; }
    }
  }
  s = s.replace(/^[\s\-–—·•|]+/,'').replace(/[\s\-–—·•|]+$/,'').trim();
  return s || 'CỬA HÀNG';   // fallback nếu strip hết
}

for (const p of arr) {
  if (p.X === undefined) continue;
  for (const b of p.buildings || []) {
    if (typeof b.heading !== 'number' || !b.features) continue;
    const names = [...(b.features.matchAll(/'([^']{2,26})'/g))].map((m) => m[1])
      .filter((n) => /[A-ZĐÀ-Ỹ0-9]/.test(n) && !/^(50%|CHO THUÊ)/i.test(n)).slice(0, 2);
    for (const name of names) {
      const rad = b.heading * Math.PI / 180;
      const x = +(p.X + Math.sin(rad) * 14).toFixed(1), z = +(p.Z - Math.cos(rad) * 14).toFixed(1);
      const key = name.toUpperCase() + '|' + Math.round(x / 30) + '|' + Math.round(z / 30);
      if (seen.has(key)) continue;
      seen.add(key);
      // biển quay MẶT về phía pano (ngược heading): góc quay game cho pháp tuyến -heading
      out.push([x, z, +(-rad).toFixed(3), debrand(name.toUpperCase().slice(0, 24)).slice(0, 24)]);
    }
  }
}
fs.writeFileSync('js/shopsigns.js', '// SINH TỰ ĐỘNG bởi tools/pano_loop/gen_shopsigns.mjs — ĐỪNG SỬA TAY\n'
  + 'export const SHOP_SIGNS = ' + JSON.stringify(out) + ';\n');
console.log('signs:', out.length);
