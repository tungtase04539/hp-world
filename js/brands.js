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
  [/\b(BẢO VIỆT|BAO ?VIET|BẢO MINH|BAO ?MINH|BẢO MIN|GENERALI|PRUDENTIAL|MANULIFE|DAI-?ICHI|PJICO|PVI)\b.*/i, 'BẢO HIỂM'],
  [/\bBẢO M(\.{2,}|…).*/i, 'BẢO HIỂM'],   // bản cắt 'BẢO M...' (bản cũ trong nhóm trên có \b sau '...' → không bao giờ khớp)
  [/\bTỔNG CÔNG TY\s*(\.\.\.|…)?\s*BẢO MIN.*/i, 'BẢO HIỂM'],
  [/\b(SSI|VNDIRECT|HSC|VPS)\b.*/i, 'CHỨNG KHOÁN'],
  // tiện lợi / siêu thị
  [/\b(CIRCLE ?K|GS25|MINISTOP|B'?S ?MART|FAMILY ?MART|7-?ELEVEN)\b.*/i, 'CỬA HÀNG TIỆN LỢI'],
  [/\b(WINMART|WIN ?MART|VINMART|BRG ?MART|CO\.?OP ?MART|CO\.?OP ?FOOD|CO\.?OP|COOPMART|BÁCH HÓA XANH|BÁCH HOÁ XANH|BIG ?C|LOTTE ?MART|AEON)\S*.*/i, 'SIÊU THỊ'],
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
  [/\b(COCA-?\s?COLA|PEPSI|MIRINDA|RED ?BULL|TÂN HIỆP PHÁT|AQUAFINA|LAVIE)\b.*/i, 'GIẢI KHÁT'],   // W3-C vòng 2
  [/\b(VINAMILK|TH ?TRUE ?MILK|DUTCH ?LADY|NUTIFOOD|ABBOTT|MEAD ?JOHNSON|NESTL[EÉ]|MILO)\b.*/i, 'SỮA'],
  [/\b(MAGIC ?MOMENTS|SMIRNOFF|ABSOLUT|JOHNNIE ?WALKER|HENNESSY|REMY ?MARTIN|BALLANTINE'?S)\b.*/i, 'RƯỢU'],
  [/\bBOSSAM\b.*/i, 'QUÁN NƯỚNG'], [/\bPIZZA ?(HUT|COMPANY)?\b.*/i, 'PIZZA'],
  [/\bFUNZ\b.*/i, 'TRÀ & BAR'],
  [/\bVIFON\b.*/i, 'MÌ ĂN LIỀN'],
  [/\b(HEINEKEN|STRONGBOW|TIGER ?BEER|SAIGON ?BEER|HABECO|SABECO|CHIVAS|HOEGAARDEN|BUDWEISER|CARLSBERG|HANOI ?BEER)\b.*/i, 'BIA RƯỢU'],
  [/\bCOOLER ?CITY\b.*/i, 'TRÀ SỮA'], [/\bBESTORE\b.*/i, 'ĂN VẶT'],
  // điện thoại / điện máy / điện lạnh
  [/\b(THE ?GIOI ?DI ?DONG|THEGIOIDIDONG|THẾ GIỚI DI ĐỘNG|FPT ?RETAIL|FPT ?SHOP|VIETTEL ?STORE|CELLPHONES|DI ĐỘNG VIỆT|HOÀNG HÀ MOBILE)\b.*/i, 'ĐIỆN THOẠI'],
  [/\b(OPPO|SAMSUNG|SAMCENTER|IPHONE|XIAOMI|VIVO|NOKIA|REALME|HUAWEI|HD ?MOBILE|SHB ?MOBILE)\b.*/i, 'ĐIỆN THOẠI'],
  [/\b(PICO|SAMNEC|MEDIA ?MART|ĐIỆN MÁY XANH|NGUYỄN KIM|SONY|PANASONIC|TOSHIBA|BEKO|HITACHI|TCL|SHARP|ELECTROLUX)\b.*/i, 'ĐIỆN MÁY'],
  [/\b(CHIGO|GREE|DAIKIN|HIKAWA|CASPER|FUNIKI)\b.*/i, 'ĐIỀU HÒA'],
  [/\b(BOSCH|TAKARA|SPELIER|MALLOCA|HAFELE|CANZY)\b.*/i, 'THIẾT BỊ NHÀ BẾP'],
  [/\b(INAX|TOTO|VIGLACERA|CAESAR|AMERICAN ?STANDARD|MIKADO)\b.*/i, 'THIẾT BỊ VỆ SINH'],   // W3-C: + MIKADO (pano_455)
  [/\b(OMRON|MEDIPHARCARE|MEDIPHAR)\b.*/i, 'THIẾT BỊ Y TẾ'],
  [/\bSKF\b.*/i, 'VÒNG BI'],
  // xe / lốp / dầu
  [/\bHONDA ?(HEAD)?\b.*/i, 'XE MÁY'], [/^HEAD$/i, 'XE MÁY'],   // 'HEAD' trơn = đại lý Honda HEAD
  [/\b(YAMAHA|SUZUKI|PIAGGIO|VESPA|SYM)\b.*/i, 'XE MÁY'],
  [/\b(YADEA|DK ?BIKE|PEGA|VINFAST|ASAMA|DIBAO|NIJIA)\b.*/i, 'XE ĐIỆN'],
  [/\b(GAC ?MOTOR|TOYOTA|HYUNDAI|MAZDA|FORD|MITSUBISHI|THACO)\b.*/i, 'Ô TÔ'],
  [/\b(MICHELIN|CONTINENTAL|GOODYEAR|BRIDGESTONE|CASUMINA|DUNLOP)\b.*/i, 'LỐP XE'],
  [/\bCASTROL\b.*/i, 'DẦU NHỚT'],
  // thời trang / giày / trang sức
  [/\b(ZARA|H&M|MANGO|LEVI'?S|IVY ?MODA|CANIFA|ELISE|CHRISBELLA|TOKYO ?LIFE|TOKY ?LIFE|SUNFLY|SIXDO|JK ?JEANS?|QIAODAN|WHITE ?DAISY|MOCHI|4TEEN|MADE IN VIETNAM|HOANG ?PHUC|ARISTINO|KAPPA|VIET ?TIEN|VTEC|AFANI|VICTORIA'?S? ?SECRET|VICTORIA|MAY ?10|SEVEN\.?\s?(AM|UOMO|ART)?|NEM ?FASHION|NINOMAXX|ROUTINE|YODY|OWEN|NIKE|ADIDAS|PUMA|UNIQLO)\b.*/i, 'THỜI TRANG'],
  [/(\bD ?& ?G\b|\bDOLCE\b|GABBANA|GIORGIO ?ARMANI|\bARMANI\b|\bGUCCI\b|\bCHANEL\b|\bDIOR\b|LOUIS ?VUITTON|\bPRADA\b|\bBURBERRY\b|\bVERSACE\b|\bHERM[EÈ]S\b|\bLACOSTE\b).*/i, 'THỜI TRANG'],   // W3-C vòng 2
  [/\bTRIUMPH\b.*/i, 'ĐỒ LÓT'],
  [/\bBITI'?S?\b.*/i, 'GIÀY DÉP'],
  [/\bCASIO\b.*/i, 'MÁY TÍNH'], [/\b(ROLEX|SEIKO|CITIZEN|TISSOT|ORIENT ?STAR)\b.*/i, 'ĐỒNG HỒ'],   // W3-C vòng 2
  [/\bDOJI\b.*/i, 'TRANG SỨC'], [/\bPNJ\b.*/i, 'TIỆM VÀNG'], [/\bSJC\b.*/i, 'VÀNG BẠC'],
  // nhà thuốc / mỹ phẩm / mẹ&bé / y tế
  [/\b(PHARMACITY|LONG ?CHÂU|LONG ?CHAU|MEDICARE|HAIPHARCO|TRAPHACO|ECO ?PHARMA)\b.*/i, 'NHÀ THUỐC'],
  [/\b(DAVINES|L'?OR[EÉ]AL|SCHWARZKOPF|TRESEMM[EÉ])\b.*/i, 'SALON TÓC'], [/\bPHI ?BROWS\b.*/i, 'PHUN XĂM'],   // W3-C vòng 2
  [/\b(MEDELA|SIMILAC|CON ?CƯNG|KIDS ?PLAZA|BIBO ?MART)\b.*/i, 'MẸ & BÉ'], [/\b(TENAMYD|HASAKI|THE ?FACE ?SHOP|INNISFREE|KOJI|HANA)\b.*/i, 'MỸ PHẨM'],
  // chăn ga / nội thất / sơn / nhựa / nhôm
  [/\b(EVERON|HANVICO|LIEN ?A|KYMDAN)\b.*/i, 'CHĂN GA GỐI ĐỆM'],
  // chữ Việt đầu/cuối cụm: \b của JS chỉ hiểu chữ ASCII → dùng lookahead/đầu chuỗi
  [/(^|\s)LIÊN ?Á(?=$|[\s\-–—,.!:])/i, 'CHĂN GA GỐI ĐỆM'],
  [/ĐIỆN MÁY XANH/i, 'ĐIỆN MÁY'],
  [/\b(NORTHFREIGHT|HATRACO)\b.*/i, 'CÔNG TY VẬN TẢI'],
  [/\b(CROCS|ECKO( UNLTD)?)\b.*/i, 'GIÀY DÉP'],
  [/\b(STARPOST|VNPOST)\b.*/i, 'CHUYỂN PHÁT NHANH'],
  [/\bPOS\.VN\b.*/i, 'CỬA HÀNG'],
  [/\bDEEP ?C\b.*/i, 'VĂN PHÒNG'],
  [/\bPASSIO\b/i, ''],                                       // "PASSIO FITNESS & YOGA" → "FITNESS & YOGA"
  [/\b(HÒA PHÁT|S\.?HOME|NHÀ ?XINH|NHAXINH|IKEA)\b.*/i, 'NỘI THẤT'],
  [/\bJARKO\b/i, ''],                                        // "JARKO - KEO DÁN GẠCH ĐÁ" → "KEO DÁN GẠCH ĐÁ"
  [/\b(CHUNGHO|KANGAROO|KAROFI|AQUAPHOR|MUTOSI)\b.*/i, 'MÁY LỌC NƯỚC'],
  [/\b(SUNHOUSE|SUNHOME|ROSSI)\b.*/i, 'ĐỒ GIA DỤNG'],
  [/^\s*FASTER(?=$|[\s\-–—,.!:])/i, 'THIẾT BỊ NHÀ BẾP'],
  [/\b(JOTUN|DULUX|KOVA|NIPPON)\b.*/i, 'CỬA HÀNG SƠN'],
  [/\b(NHỰA ?)?TIỀN PHONG\b.*/i, 'ỐNG NHỰA'],
  [/\bXINGFA\b/i, ''],  // strip: giữ phần "NHÔM KÍNH ..." còn lại
  // giáo dục / tóc / cầm đồ / karaoke / đồ chơi / vận tải / tập đoàn
  [/\b(APOLLO|SCOTS ?ENGLISH|VUS|OCEAN ?EDU|LANGMASTER|WALL ?STREET ?ENGLISH)\b.*/i, 'ANH NGỮ'],
  [/\b30 ?SHINE\b.*/i, 'TÓC NAM'],
  [/\bF88\b.*/i, 'CẦM ĐỒ'], [/\b(FERROLI|ARISTON)\b.*/i, 'MÁY NƯỚC NÓNG'],
  [/\bVINA ?KTV\b.*/i, 'KARAOKE'],
  [/\b(MY ?KINGDOM|VUA ĐỒ CHƠI|TOYS ?R ?US)\b.*/i, 'ĐỒ CHƠI'],
  [/\b(VINASHIP|VOSA|VOSCO|VINALINES|GEMADEPT)\b.*/i, 'CÔNG TY VẬN TẢI BIỂN'],
  [/\bVINACOMIN\b.*/i, 'CÔNG TY THAN'],
  [/\b(PROSIMEX|VITIMEX)\b.*/i, 'CÔNG TY THƯƠNG MẠI'],
  [/\bDELTA ?GROUP\b.*/i, 'NHÀ THẦU XÂY DỰNG'],
  [/\bSUMMO\b.*/i, 'CÔNG TRÌNH'],
  [/\b(VINCOM|VINHOMES|VINGROUP|PULLMAN|MELIA|SHERATON|HILTON|MARRIOTT|NOVOTEL|MƯỜNG ?THANH|AVANI)\b.*/i, 'KHÁCH SẠN'],
  [/\b(H?ARBOUR ?VIEW|SOLIS ?HOTEL)\b.*/i, 'KHÁCH SẠN'],   // W3-C: '...ARBOUR VIEW' (khách sạn thật, pano_041) lọt lưới
  [/\bATLANTIC\b.*/i, 'MÁY NƯỚC NÓNG'],
  [/\b(HIDOO|HDOO|GENCE)\b.*/i, 'CỬA HÀNG'],
  [/\bBRG\b.*/i, 'SIÊU THỊ'],
  [/\bCP ?(PORK|FRESH)\b.*/i, 'CỬA HÀNG THỊT'],
  [/\b(BOSE|JBL|DENON|MARSHALL|HARMAN ?KARDON)\b.*/i, 'THIẾT BỊ ÂM THANH'],
  [/\bVAB\b.*/i, 'NGÂN HÀNG'],
  [/\bBIA HÀ.*/i, 'BIA HƠI'],                                // "Bia Hà Nội" (Habeco), kể cả bản cắt "BIA HÀ..."
  [/\bBAMBOO\b/i, ''],
  // tên riêng cơ sở thật còn sót (phản biện WP3): bệnh viện quốc tế NTP, shop thời trang, tiệm hoa
  [/\bGOLD ?STAR\b.*HOSPITAL.*/i, 'BỆNH VIỆN QUỐC TẾ'], [/\bGOLD ?STAR\b.*/i, 'CỬA HÀNG'],
  [/\bNOAH'?S\b.*/i, 'THỜI TRANG'], [/\bTAGONE\b.*/i, 'HOA TƯƠI'],
  // TỪ THƯỜNG trùng tên hãng (shell, apple, aqua, guardian, format, go!) + viết tắt ngắn (LG, AIA, ILA, EMS) + AN KHANG:
  // chỉ khớp khi là TỪ ĐẦU biển (hoặc ngay sau 'NHÀ THUỐC') — 'NHÀ HÀNG AN KHANG', "LET'S GO!", 'SEA SHELL' giữ nguyên
  // (lưới an toàn lúc vẽ thay CẢ biển → token rộng = bẫy).
  [/^\s*GO!(?=$|[\s\-–—,.:])/i, 'SIÊU THỊ'],
  [/^\s*AIA(?=$|[\s\-–—,.!:])/i, 'BẢO HIỂM'],
  [/^\s*LG(?=$|[\s\-–—,.!:])/i, 'ĐIỆN MÁY'],
  [/^\s*AQUA(?=$|[\s\-–—,.!:])/i, 'ĐIỀU HÒA'],
  [/^\s*SHELL(?=$|[\s\-–—,.!:])/i, 'DẦU NHỚT'],
  [/(^|[\s\-–—/|])(APPLE( ?STORE)?|IPAD|MACBOOK|AIRPODS)(?=$|[\s\-–—,.!:])/i, 'ĐIỆN THOẠI'],   // W3-C vòng 2: cả "VIP HOÀNG LINH – APPLE\"
  [/^\s*FORMAT(?=$|[\s\-–—,.!:])/i, 'THỜI TRANG'],
  [/(^\s*|NHÀ THUỐC\s+)(AN ?KHANG|GUARDIAN)(?=$|[\s\-–—,.!:])/i, 'NHÀ THUỐC'],
  [/^\s*ILA(?=$|[\s\-–—,.!:])/i, 'ANH NGỮ'],
  [/^\s*EMS(?=$|[\s\-–—,.!:])/i, 'CHUYỂN PHÁT NHANH'],
];

// W3-C vòng 2 (phản biện: 8 thương hiệu thật lọt BRAND_MAP — COCA-COLA, D&G/ARMANI, VINAMILK, APPLE, CASIO, DAVINES,
// MAGIC MOMENTS, PHIBROWS): BRAND_WATCH = danh sách THƯƠNG HIỆU NỔI TIẾNG rộng hơn, chỉ dùng để TỰ KIỂM sau khi sinh
// (tools/pano_loop/gen_shopsigns.mjs exit 1 nếu biển nào khớp) — KHÔNG thay chữ. Chỉ chứa token KHÔNG mơ hồ (bỏ từ thường /
// tên người: 'HOÀNG HÀ', 'SƠN HÀ', 'HOA SEN', 'HỒNG NGỌC', 'KIA', 'HEAD', 'SHELL'...). Khớp theo ranh giới chữ Unicode.
export const BRAND_WATCH = ['VIETTEL', 'MOBIFONE', 'VINAPHONE', 'VNPT', 'HONDA', 'YAMAHA', 'SAMSUNG', 'OPPO', 'XIAOMI', 'APPLE', 'IPHONE',
  'NOKIA', 'CANON', 'PEPSI', 'COCA', 'COLA', 'HEINEKEN', 'SABECO', 'HABECO', 'VINAMILK', 'TH TRUE', 'KFC', 'LOTTERIA', 'JOLLIBEE', 'PIZZA HUT',
  'GRAB', 'SHOPEE', 'LAZADA', 'TIKI', 'PVOIL', 'VPBANK', 'TPBANK', 'ACB', 'SHB', 'MSB', 'OCB', 'HDBANK', 'SEABANK', 'LIENVIET', 'VIB',
  'BAOVIET', 'BẢO VIỆT', 'PRUDENTIAL', 'MANULIFE', 'DAI-ICHI', 'WATSONS', 'CIRCLE K', 'FAMILYMART', 'MINISTOP', 'GS25', '7-ELEVEN',
  'TRUNG NGUYÊN', 'PHÚC LONG', 'COFFEE HOUSE', 'STARBUCKS', 'KATINAT', 'MIXUE', 'GONG CHA', 'TOCOTOCO', 'DOMINO', 'CANIFA', 'IVY MODA',
  'ZARA', 'UNIQLO', 'ADIDAS', 'NIKE', 'PUMA', "BITI'S", 'BITIS', 'YODY', 'CELLPHONES', 'FPT', 'NGUYỄN KIM', 'TOYOTA', 'HYUNDAI', 'MAZDA',
  'VINFAST', 'SUZUKI', 'PIAGGIO', 'VESPA', 'MICHELIN', 'BRIDGESTONE', 'CASTROL', 'MOTUL', 'PETROLIMEX', 'DULUX', 'JOTUN', 'KOVA',
  'MYKOLOR', 'PANASONIC', 'HÒA PHÁT', 'INAX', 'TOTO', 'VIGLACERA', 'HAFELE', 'SUNHOUSE', 'KANGAROO', 'KAROFI', 'ARISTON', 'FERROLI',
  'TOSHIBA', 'SHARP', 'DAIKIN', 'MITSUBISHI', 'MEDIAMART', 'ĐIỆN MÁY XANH', 'BÁCH HÓA XANH', 'BÁCH HOÁ XANH', 'WINMART', 'VINMART',
  'CO.OP', 'COOPMART', 'BIG C', 'AEON', 'LOTTE', 'VINCOM', 'VINHOMES', 'PNJ', 'DOJI', 'SJC', 'PHARMACITY', 'LONG CHÂU', 'VIETJET', 'MOMO',
  'ZALO', 'VNPAY', 'AGRIBANK', 'BIDV', 'VIETCOMBANK', 'TECHCOMBANK', 'SACOMBANK', 'VIETINBANK', 'EXIMBANK', 'PVCOMBANK', 'ABBANK',
  'KIENLONGBANK', 'GPBANK', 'OCEANBANK', 'SAIGONBANK', 'VIETBANK', 'LPBANK', 'HSBC', 'SHINHAN', 'WOORI', 'HALIDA', 'LARUE', 'SAPPORO',
  'BUDWEISER', 'CARLSBERG', 'MASAN', 'CHIN-SU', 'OMACHI', 'ACECOOK', 'HẢO HẢO', 'NESTLE', 'NESTLÉ', 'NESCAFE', 'MILO', 'OISHI', 'BIBICA',
  'MEDLATEC', 'VINMEC', 'TRAPHACO', 'HAIPHARCO', 'GOLDSTAR', 'MƯỜNG THANH', 'MELIA', 'SHERATON', 'HILTON', 'NOVOTEL', 'AVANI', 'PULLMAN',
  'WYNDHAM', 'MARRIOTT', 'MIKADO', 'TOKYOLIFE', 'MINISO', 'DAISO', 'MUJI', 'GUCCI', 'CHANEL', 'DIOR', 'ARMANI', 'D&G', 'DOLCE', 'ROLEX',
  'CASIO', 'SEIKO', 'CITIZEN', 'DAVINES', 'MAGIC MOMENTS', 'PHIBROWS', 'DIBAO', 'CHUNGHO', 'JARKO', 'NHAXINH', 'VINA KTV', 'VINAKTV',
  'DUNLOP', 'CASUMINA', 'KUMHO', 'YOKOHAMA', 'GOODYEAR', 'PIRELLI', 'ENEOS', 'IDEMITSU', 'PETRONAS', 'VALVOLINE', 'REPSOL', 'HIGHLANDS',
  'JUNO', 'VASCARA', 'TOPCARE', 'AQUAFINA', 'REDBULL', 'RED BULL', 'TÂN HIỆP PHÁT', 'SMIRNOFF', 'HENNESSY', 'LACOSTE', 'LOUIS VUITTON'];
const _esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _WATCH = BRAND_WATCH.map((b) => [b, new RegExp('(^|[^\\p{L}\\p{N}])' + _esc(b) + '(?=[^\\p{L}\\p{N}]|$)', 'iu')]);
// token thương hiệu đầu tiên khớp (hoặc null) — chỉ cho tự kiểm của bộ sinh biển
export const brandWatchHit = (s) => { for (const [b, re] of _WATCH) if (re.test(String(s))) return b; return null; };

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
