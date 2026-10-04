// brands.js — DANH SÁCH CHẶN TÊN THƯƠNG HIỆU THẬT trên biển hiệu (quy tắc chủ dự án 2026-07-15: từ CHUNG / tên riêng
// dân dã OK, thương hiệu/nhãn hiệu đăng ký thì KHÔNG). Nguồn DUY NHẤT cho:
//   - tools/pano_loop/gen_shopsigns.mjs  (sinh js/shopsigns.js),
//   - js/cellsink.js (lưới an toàn lúc vẽ biển của khối ô world.js: chữ nào khớp bị thay bằng từ chung TRƯỚC khi vẽ).
// Không import gì → chạy được trong node lẫn trình duyệt.
// Mỗi dòng: [regex thương hiệu, từ chung thay thế]. Đặt regex "tham lam"/cụ thể hơn lên trước. Từ thay '' = XOÁ phần khớp,
// giữ phần còn lại (vd "NHÔM KÍNH XINGFA" → "NHÔM KÍNH").
export const BRAND_MAP = [
  // ngân hàng / bảo hiểm / chứng khoán
  [/\b(VIETCOMBANK|VIETINBANK|AGRIBANK|BIDV|VPBANK|MSB|SHB|ACB|TECHCOMBANK|VIB|SCB|SEABANK|TPBANK|OCB|SACOMBANK|PVCOMBANK|ABBANK|VIETABANK|SAIGONBANK|EXIMBANK|HD ?BANK|PG ?BANK|BAOVIET ?BANK|NAM ?A ?BANK|LPBANK|VIETBANK|MB ?BANK|MBBANK|KIENLONGBANK|BAC ?A ?BANK|OCEANBANK|GPBANK|NCB|VIET ?CAPITAL ?BANK|MARITIME ?BANK)\b.*/i, 'NGÂN HÀNG'],
  [/^MB$/i, 'NGÂN HÀNG'],
  [/\bNGÂN HÀNG (Á CHÂU|NGOẠI THƯƠNG|CÔNG THƯƠNG|ĐẦU TƯ|NÔNG NGHIỆP|QUÂN ĐỘI|HÀNG HẢI|TIÊN PHONG|QUỐC TẾ|SÀI GÒN|VIỆT Á|BƯU ĐIỆN|AN BÌNH|PHƯƠNG ĐÔNG|KỸ THƯƠNG|XĂNG DẦU)\b.*/i, 'NGÂN HÀNG'],
  [/\b(BẢO VIỆT|BAO ?VIET|BẢO MINH|BAO ?MINH|BẢO M\.{2,}|BẢO MIN\b|GENERALI|PRUDENTIAL|MANULIFE|DAI-?ICHI|AIA|PJICO|PVI)\b.*/i, 'BẢO HIỂM'],
  [/\bTỔNG CÔNG TY\s*(\.\.\.|…)?\s*BẢO MIN.*/i, 'BẢO HIỂM'],
  [/\b(SSI|VNDIRECT|HSC|VPS)\b.*/i, 'CHỨNG KHOÁN'],
  // tiện lợi / siêu thị
  [/\b(CIRCLE ?K|GS25|MINISTOP|B'?S ?MART|FAMILY ?MART|7-?ELEVEN)\b.*/i, 'CỬA HÀNG TIỆN LỢI'],
  [/\b(WINMART|WIN ?MART|VINMART|BRG ?MART|CO\.?OP ?MART|CO\.?OP ?FOOD|CO\.?OP|COOPMART|BÁCH HÓA XANH|BÁCH HOÁ XANH|BIG ?C|LOTTE ?MART|AEON|GO!)\S*.*/i, 'SIÊU THỊ'],
  // viễn thông / chuyển phát
  [/\bVIETTEL ?POST\b.*/i, 'CHUYỂN PHÁT NHANH'],
  [/\b(VIETTEL|VINAPHONE|MOBIFONE|VNPT|FPT ?TELECOM)\b.*/i, 'VIỄN THÔNG'],
  [/\b(VIETNAM ?AIRLINES|VIETJET|BAMBOO ?AIRWAYS)\b.*/i, 'VÉ MÁY BAY'],
  [/\b(J&T ?EXPRESS|GHN|GIAO HÀNG NHANH|GIAO HÀNG TIẾT KIỆM|NINJA ?VAN)\b.*/i, 'CHUYỂN PHÁT NHANH'],
  // điện lực / xăng dầu
  [/\b(EVN ?NPC|EVNNPC|EVN)\b.*/i, 'ĐIỆN LỰC'],
  [/\b(PETROLIMEX|PV ?OIL)\b.*/i, 'CÂY XĂNG'],
  // cà phê / trà / F&B
  [/\b(HIGHLANDS|THE COFFEE HOUSE|AHA ?COFFEE|AHA CAFE|TRUNG NGUY[ÊE]N|PHÚC LONG|KATINAT|STARBUCKS|COFFEE ?BEAN|CỘNG CÀ PHÊ|MILANO)\b.*/i, 'CÀ PHÊ'],   // Milano = chuỗi nhượng quyền cà phê
  [/\b(MIXUE|TOCOTOCO|GONG ?CHA|MR ?GOOD ?TEA|CHATIME|DING ?TEA|LIPTON|PHÚC LONG)\b.*/i, 'TRÀ SỮA'],
  [/\b(KFC|LOTTERIA|JOLLIBEE|DON ?CHICKEN|TEXAS ?CHICKEN|POPEYES|MCDONALD'?S)\b.*/i, 'GÀ RÁN'],
  [/\bBOSSAM\b.*/i, 'QUÁN NƯỚNG'], [/\bPIZZA ?(HUT|COMPANY)?\b.*/i, 'PIZZA'],
  [/\bFUNZ\b.*/i, 'TRÀ & BAR'],
  [/\bVIFON\b.*/i, 'MÌ ĂN LIỀN'],
  [/\b(HEINEKEN|STRONGBOW|TIGER ?BEER|SAIGON ?BEER|HABECO|SABECO|CHIVAS|HOEGAARDEN|BUDWEISER|CARLSBERG|HANOI ?BEER)\b.*/i, 'BIA RƯỢU'],
  [/\bCOOLER ?CITY\b.*/i, 'TRÀ SỮA'], [/\bBESTORE\b.*/i, 'ĂN VẶT'],
  // điện thoại / điện máy / điện lạnh
  [/\b(THE ?GIOI ?DI ?DONG|THEGIOIDIDONG|THẾ GIỚI DI ĐỘNG|FPT ?RETAIL|FPT ?SHOP|VIETTEL ?STORE|CELLPHONES|DI ĐỘNG VIỆT|HOÀNG HÀ MOBILE)\b.*/i, 'ĐIỆN THOẠI'],
  [/\b(OPPO|SAMSUNG|SAMCENTER|IPHONE|APPLE|XIAOMI|VIVO|NOKIA|REALME|HUAWEI|HD ?MOBILE|SHB ?MOBILE)\b.*/i, 'ĐIỆN THOẠI'],
  [/\b(PICO|SAMNEC|MEDIA ?MART|ĐIỆN MÁY XANH|NGUYỄN KIM|SONY|PANASONIC|TOSHIBA|BEKO|HITACHI|TCL|LG|SHARP|ELECTROLUX)\b.*/i, 'ĐIỆN MÁY'],
  [/\b(CHIGO|GREE|DAIKIN|AQUA|HIKAWA|CASPER|FUNIKI)\b.*/i, 'ĐIỀU HÒA'],
  [/\b(BOSCH|TAKARA|SPELIER|MALLOCA|HAFELE|CANZY)\b.*/i, 'THIẾT BỊ NHÀ BẾP'],
  [/\b(INAX|TOTO|VIGLACERA|CAESAR|AMERICAN ?STANDARD)\b.*/i, 'THIẾT BỊ VỆ SINH'],
  [/\b(OMRON|MEDIPHARCARE|MEDIPHAR)\b.*/i, 'THIẾT BỊ Y TẾ'],
  [/\bSKF\b.*/i, 'VÒNG BI'],
  // xe / lốp / dầu
  [/\bHONDA ?(HEAD)?\b.*/i, 'XE MÁY'], [/^HEAD$/i, 'XE MÁY'],   // 'HEAD' trơn = đại lý Honda HEAD
  [/\b(YAMAHA|SUZUKI|PIAGGIO|VESPA|SYM)\b.*/i, 'XE MÁY'],
  [/\b(YADEA|DK ?BIKE|PEGA|VINFAST|ASAMA)\b.*/i, 'XE ĐIỆN'],
  [/\b(GAC ?MOTOR|TOYOTA|HYUNDAI|MAZDA|FORD|MITSUBISHI|THACO)\b.*/i, 'Ô TÔ'],
  [/\b(MICHELIN|CONTINENTAL|GOODYEAR|BRIDGESTONE|CASUMINA|DUNLOP)\b.*/i, 'LỐP XE'],
  [/\b(CASTROL|SHELL)\b.*/i, 'DẦU NHỚT'],
  // thời trang / giày / trang sức
  [/\b(ZARA|H&M|MANGO|LEVI'?S|IVY ?MODA|CANIFA|ELISE|CHRISBELLA|TOKYO ?LIFE|TOKY ?LIFE|SUNFLY|SIXDO|JK ?JEANS?|QIAODAN|WHITE ?DAISY|MOCHI|4TEEN|MADE IN VIETNAM|HOANG ?PHUC|ARISTINO|KAPPA|VIET ?TIEN|VTEC|FORMAT|AFANI|VICTORIA'?S? ?SECRET|VICTORIA|MAY ?10|SEVEN\.?\s?(AM|UOMO|ART)?|NEM ?FASHION|NINOMAXX|ROUTINE|YODY|OWEN|NIKE|ADIDAS|PUMA|UNIQLO)\b.*/i, 'THỜI TRANG'],
  [/\bTRIUMPH\b.*/i, 'ĐỒ LÓT'],
  [/\bBITI'?S?\b.*/i, 'GIÀY DÉP'],
  [/\bDOJI\b.*/i, 'TRANG SỨC'], [/\bPNJ\b.*/i, 'TIỆM VÀNG'], [/\bSJC\b.*/i, 'VÀNG BẠC'],
  // nhà thuốc / mỹ phẩm / mẹ&bé / y tế
  [/\b(PHARMACITY|LONG ?CHÂU|LONG ?CHAU|AN ?KHANG|GUARDIAN|MEDICARE|HAIPHARCO|TRAPHACO|ECO ?PHARMA)\b.*/i, 'NHÀ THUỐC'],
  [/\b(MEDELA|SIMILAC|CON ?CƯNG|KIDS ?PLAZA|BIBO ?MART)\b.*/i, 'MẸ & BÉ'], [/\b(TENAMYD|HASAKI|THE ?FACE ?SHOP|INNISFREE|KOJI|HANA)\b.*/i, 'MỸ PHẨM'],
  // chăn ga / nội thất / sơn / nhựa / nhôm
  [/\b(EVERON|HANVICO|LIEN ?A|KYMDAN)\b.*/i, 'CHĂN GA GỐI ĐỆM'],
  // chữ Việt đầu/cuối cụm: \b của JS chỉ hiểu chữ ASCII → dùng lookahead/đầu chuỗi
  [/(^|\s)LIÊN ?Á(?=$|[\s\-–—,.!:])/i, 'CHĂN GA GỐI ĐỆM'],
  [/ĐIỆN MÁY XANH/i, 'ĐIỆN MÁY'],
  [/\b(NORTHFREIGHT|HATRACO)\b.*/i, 'CÔNG TY VẬN TẢI'],
  [/\b(CROCS|ECKO( UNLTD)?)\b.*/i, 'GIÀY DÉP'],
  [/\b(STARPOST|VNPOST|EMS)\b.*/i, 'CHUYỂN PHÁT NHANH'],
  [/\bPOS\.VN\b.*/i, 'CỬA HÀNG'],
  [/\bDEEP ?C\b.*/i, 'VĂN PHÒNG'],
  [/\bPASSIO\b/i, ''],                                       // "PASSIO FITNESS & YOGA" → "FITNESS & YOGA"
  [/\b(HÒA PHÁT|S\.?HOME|NHÀ ?XINH|IKEA)\b.*/i, 'NỘI THẤT'],
  [/\b(JOTUN|DULUX|KOVA|NIPPON)\b.*/i, 'CỬA HÀNG SƠN'],
  [/\b(NHỰA ?)?TIỀN PHONG\b.*/i, 'ỐNG NHỰA'],
  [/\bXINGFA\b/i, ''],  // strip: giữ phần "NHÔM KÍNH ..." còn lại
  // giáo dục / tóc / cầm đồ / karaoke / đồ chơi / vận tải / tập đoàn
  [/\b(APOLLO|SCOTS ?ENGLISH|ILA|VUS|OCEAN ?EDU|LANGMASTER|WALL ?STREET ?ENGLISH)\b.*/i, 'ANH NGỮ'],
  [/\b30 ?SHINE\b.*/i, 'TÓC NAM'],
  [/\bF88\b.*/i, 'CẦM ĐỒ'], [/\b(FERROLI|ARISTON)\b.*/i, 'MÁY NƯỚC NÓNG'],
  [/\bVINAKTV\b.*/i, 'KARAOKE'],
  [/\b(MY ?KINGDOM|VUA ĐỒ CHƠI|TOYS ?R ?US)\b.*/i, 'ĐỒ CHƠI'],
  [/\b(VINASHIP|VOSA|VOSCO|VINALINES|GEMADEPT)\b.*/i, 'CÔNG TY VẬN TẢI BIỂN'],
  [/\bVINACOMIN\b.*/i, 'CÔNG TY THAN'],
  [/\b(PROSIMEX|VITIMEX)\b.*/i, 'CÔNG TY THƯƠNG MẠI'],
  [/\bDELTA ?GROUP\b.*/i, 'NHÀ THẦU XÂY DỰNG'],
  [/\bSUMMO\b.*/i, 'CÔNG TRÌNH'],
  [/\b(VINCOM|VINHOMES|VINGROUP|PULLMAN|MELIA|SHERATON|HILTON|MARRIOTT|NOVOTEL|MƯỜNG ?THANH|AVANI)\b.*/i, 'KHÁCH SẠN'],
  [/\b(HIDOO|HDOO|GENCE)\b.*/i, 'CỬA HÀNG'],
  [/\bBRG\b.*/i, 'SIÊU THỊ'],
  [/\bCP ?(PORK|FRESH)\b.*/i, 'CỬA HÀNG THỊT'],
  [/\b(BOSE|JBL|DENON|MARSHALL|HARMAN ?KARDON)\b.*/i, 'THIẾT BỊ ÂM THANH'],
  [/\bVAB\b.*/i, 'NGÂN HÀNG'],
  [/\bBIA HÀ.*/i, 'BIA HƠI'],                                // "Bia Hà Nội" (Habeco), kể cả bản cắt "BIA HÀ..."
  [/\bBAMBOO\b/i, ''],
];

// Thay thương hiệu trong 1 chuỗi biển (giữ nguyên chuỗi nếu không khớp). Trả '' chỉ khi đầu vào rỗng.
export function debrand(raw) {
  if (raw == null) return raw;
  let s = String(raw);
  if (!s.trim()) return s;
  for (const [re, generic] of BRAND_MAP) {
    if (re.test(s)) {
      if (generic === '') s = s.replace(re, '').replace(/[\s\-–—·•|]+$/, '').trim();
      else { s = generic; break; }
    }
  }
  s = s.replace(/^[\s\-–—·•|]+/, '').replace(/[\s\-–—·•|]+$/, '').trim();
  return s || 'CỬA HÀNG';
}
export const isBrand = (s) => s != null && debrand(s) !== String(s).replace(/^[\s\-–—·•|]+/, '').replace(/[\s\-–—·•|]+$/, '').trim();
