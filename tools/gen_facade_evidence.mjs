// tools/gen_facade_evidence.mjs — BẰNG CHỨNG MẶT TIỀN từ 551 pano thật (audit/audit_enriched.json) → js/facade_evidence.js
// (W3-C FACADES, Đợt 3 wave 3). Chạy ở gốc repo: node tools/gen_facade_evidence.mjs
//
// Mỗi quan sát nhà của pano (buildings[]: heading, style, floors, color, features) → cờ từ vựng mặt tiền (thuộc địa, tân cổ
// điển, kính, showroom, đang xây, tập thể, cây leo, cũ/ố, mới, biển lớn, mái hiên tôn/bạt, cao tầng, nhà ở). Mỗi pano → cờ
// VÙNG (khu Pháp/biệt thự/công sở, chợ, phố cũ xuống cấp, đô thị mới, phố buôn bán) từ area + summary.
// citygen.js đọc: quan sát → bắn tia theo hướng nhìn từ camera pano (h−8°, h, h+8°) tới mặt nhà ĐẦU TIÊN → gắn cờ cho
// đúng nhà đó; nhà không có quan sát → dùng cờ vùng của pano gần nhất (≤ 90 m) làm XÁC SUẤT (không phải mặc định cứng).
// Xác định, không ngẫu nhiên. Không thương hiệu (chỉ cờ số, không chép chữ biển).
import fs from 'fs';

const E = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const L = '(?<![\\p{L}\\p{N}])', R = '(?![\\p{L}\\p{N}])';
const W = (s) => new RegExp(L + '(?:' + s + ')' + R, 'iu');
export const FEF = {
  COL: 1, NEO: 2, GLASS: 4, SHOW: 8, CONS: 16, TEN: 32, VINE: 64, OLD: 128, NEW: 256, BIGSIGN: 512, TIN: 1024, TARP: 2048,
  AWN: 4096, TOWER: 8192, HOME: 16384,
};
const RX = {
  // W3-C vòng 2 (phản biện): 'cửa chớp|chớp lật|phào' có trên RẤT nhiều nhà ống thường → chỉ là COL khi đi kèm cờ CŨ (OLD)
  COL: W('pháp|kiểu pháp|thời pháp|thuộc địa|cửa vòm|vòm cuốn|cổ điển kiểu pháp|biệt thự cổ|nhà cổ|kiến trúc cổ'),
  COLW: W('cửa chớp|chớp lật|phào chỉ|phào'),
  NEO: W('tân cổ điển|cổ điển|hàng cột|cột tròn|cột lớn|cột la mã|cột trắng|mặt tiền cột|colonnade|trán tường'),
  GLASS: W('vách kính|mặt kính|toàn kính|kính xanh|kính đen|kính phản quang|kính cường lực|kính lớn|tường kính|ốp kính|kính màu'),
  SHOW: W('showroom|trưng bày|phòng trưng bày'),
  CONS: W('đang xây|đang thi công|giàn giáo|lưới che|lưới xanh|khung bê tông|xây dở|xây thô|công trường|thi công|tôn quây|quây tôn|rào tôn'),
  TEN: W('tập thể|khu tập thể|ktt|chung cư cũ|cơi nới|chuồng cọp|lồng sắt'),
  VINE: W('cây leo|dây leo|leo kín|phủ cây leo|hoa giấy leo|cây leo phủ|dây leo phủ'),
  OLD: W('cũ|cũ kỹ|ố|ố vàng|ố đen|rêu|rêu mốc|mốc|bong tróc|tróc|xuống cấp|loang|loang lổ|bạc màu|phai màu|lụp xụp|gỉ|han gỉ|nứt'),
  NEW: W('mới|mới xây|mới sơn|hiện đại|sang trọng|cao cấp'),
  BIGSIGN: W('biển lớn|biển to|biển quảng cáo lớn|biển hiệu lớn|biển bạt lớn|biển che kín|biển chiếm|phủ kín biển|biển nhiều tầng|biển dọc|biển đứng|biển led|pano quảng cáo|biển alu|biển ốp alu'),
  TIN: W('mái hiên tôn|mái tôn|hiên tôn|tôn xanh|tôn che|mái che tôn|tôn sóng'),
  TARP: W('bạt|mái bạt|bạt xanh|bạt sọc|ô che|dù che|mái che bạt'),
  AWN: W('mái hiên|mái che|hiên|bạt|ô dù|(?<!mặc\s)dù'),   // 'mặc dù' (= although) KHÔNG phải ô dù
  TOWER: W('cao tầng|tòa nhà cao|tháp|chung cư cao|khách sạn cao|tòa văn phòng'),
  HOME: W('nhà ở|nhà dân|để ở|cổng sắt|không biển|không có biển|nhà riêng'),
};
const ZRX = {
  COLQ: W('pháp|thuộc địa|biệt thự|công sở|cơ quan|ủy ban|uỷ ban|trụ sở|nhà hát|bảo tàng|ngân hàng nhà nước'),
  MARKET: W('chợ|sạp|hàng rong|bán rong'),
  OLDQ: W('cũ|xuống cấp|lụp xụp|ngõ|hẻm|phố cổ|nghèo|tập thể'),
  NEWQ: W('hiện đại|cao tầng|đô thị mới|khu đô thị|mới xây|chung cư mới|khách sạn'),
  COMM: W('buôn bán|thương mại|cửa hàng|shophouse|kinh doanh|nhộn nhịp|sầm uất|phố buôn|dãy shophouse|showroom'),
};
export const FEZ = { COLQ: 1, MARKET: 2, OLDQ: 4, NEWQ: 8, COMM: 16 };
const obs = [], pano = [], stat = {}, zstat = {};
for (const p of E) {
  if (!Number.isFinite(p.X) || !Number.isFinite(p.Z)) continue;
  const ztxt = [p.area, p.summary].join(' . ');
  let zf = 0; for (const [k, rx] of Object.entries(ZRX)) if (rx.test(ztxt)) { zf |= FEZ[k]; zstat[k] = (zstat[k] || 0) + 1; }
  let ageSum = 0, ageN = 0;
  for (const b of p.buildings || []) {
    const t = [b.style, b.color, b.features].filter(Boolean).join(' . ');
    let f = 0; for (const [k, rx] of Object.entries(RX)) if (FEF[k] && rx.test(t)) f |= FEF[k];
    if (RX.COLW.test(t) && (f & FEF.OLD) && !(f & FEF.NEW)) f |= FEF.COL;   // chớp/phào + cũ → thuộc địa
    // xung khắc: "mới/hiện đại" lẫn "cũ" → bỏ cả hai (mô tả mập mờ)
    if ((f & FEF.OLD) && (f & FEF.NEW)) f &= ~(FEF.OLD | FEF.NEW);
    const fl = Math.max(0, Math.min(40, Math.round(+b.floors || 0)));
    if ((f & FEF.TOWER) && fl && fl < 7) f &= ~FEF.TOWER;
    if (!(f & FEF.TOWER) && fl >= 9) f |= FEF.TOWER;
    for (const [k, v] of Object.entries(FEF)) if (f & v) stat[k] = (stat[k] || 0) + 1;
    if (f & FEF.OLD) { ageSum += 1; ageN++; } else if (f & FEF.NEW) { ageSum -= 1; ageN++; }
    const h = ((Math.round(+b.heading || 0) % 360) + 360) % 360;
    obs.push(Math.round(p.X * 10), Math.round(p.Z * 10), h, f, fl);
  }
  // tuổi vùng 0..3: 1 mặc định; phố cũ +1; mô tả nhà cũ chiếm đa số +1; đô thị mới −1
  let age = 1 + ((zf & FEZ.OLDQ) ? 1 : 0) + (ageN && ageSum / ageN > 0.3 ? 1 : 0) - ((zf & FEZ.NEWQ) ? 1 : 0) - (ageN && ageSum / ageN < -0.3 ? 1 : 0);
  age = Math.max(0, Math.min(3, age));
  pano.push(Math.round(p.X * 10), Math.round(p.Z * 10), zf, age);
}
const out = `// GENERATED by tools/gen_facade_evidence.mjs từ audit/audit_enriched.json (551 pano thật) — KHÔNG sửa tay.
// W3-C FACADES: cờ từ vựng mặt tiền theo quan sát từng nhà + cờ vùng theo pano (xem citygen.js renderStyles()).
// FE_OBS = [x×10, z×10, heading°, cờ FEF, số tầng] × ${obs.length / 5} quan sát; FE_PANO = [x×10, z×10, cờ FEZ, tuổi 0..3] × ${pano.length / 4} pano
export const FEF = ${JSON.stringify(FEF)};
export const FEZ = ${JSON.stringify(FEZ)};
export const FE_OBS = new Int32Array([${obs.join(',')}]);
export const FE_PANO = new Int32Array([${pano.join(',')}]);
`;
fs.writeFileSync('js/facade_evidence.js', out);
console.log('obs', obs.length / 5, 'pano', pano.length / 4, 'bytes', out.length);
console.log('flags', JSON.stringify(stat));
console.log('zones', JSON.stringify(zstat));
