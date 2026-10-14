// tools/gen_fp_nature.mjs — Đ3-W4-B: tóm tắt trường "trees"/"street" của FACADE FINGERPRINTS (fp_json — mỗi ảnh pano thật
// 1 JSON do agent trích xuất, ~6 hướng mặt tiền/pano, tiếng Việt HOẶC tiếng Anh) thành SỐ ĐẾM theo pano → tools/fp_nature.json
// (ảnh chụp dữ liệu NHỎ, có commit — fp_json nằm ngoài repo; bộ sinh gen_treemap / gen_props_evidence đọc file này nếu có).
//
// Mỗi pano: [id, X, Z, n, young, lean, sparse, dense, bikeDense, bikeFew, bikeCover, goods, stools, plants, wires]
//   n = số ảnh (hướng) có dữ liệu hợp lệ; các cột còn lại = SỐ HƯỚNG nhắc tới:
//   young  cây non/mới trồng/chống cọc/khung kiềng · lean cây nghiêng/thân xiên · sparse tán thưa/trụi · dense tán rậm/rợp
//   bikeDense hàng xe máy đỗ dày/kín/nhiều · bikeFew ít/không xe máy · bikeCover xe máy phủ bạt/áo trùm
//   goods hàng hoá/sạp bày hè · stools ghế nhựa/bàn ghế quán · plants chậu cây/cây cảnh · wires dây điện chằng chịt/búi
//
// Chạy (từ gốc repo): node tools/gen_fp_nature.mjs [--fp <thư mục fp_json>]   → ghi tools/fp_nature.json
// rồi chạy lại: node tools/gen_treemap.mjs && node tools/gen_props_evidence.mjs
import fs from 'fs';
import path from 'path';

// thư mục fp_json: --fp <dir> hoặc biến môi trường HP_FP_JSON (fp_json nằm NGOÀI repo — không có mặc định)
const ai = process.argv.indexOf('--fp');
const DIR = ai > 0 ? process.argv[ai + 1] : process.env.HP_FP_JSON;
if (!DIR || !fs.existsSync(DIR)) {
  console.error('gen_fp_nature: thiếu thư mục fp_json — chạy: node tools/gen_fp_nature.mjs --fp <thư mục fp_json> (hoặc đặt HP_FP_JSON)' + (DIR ? ' — không thấy: ' + DIR : ''));
  process.exit(1);
}
const OUT = 'tools/fp_nature.json';
const AUD = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const POS = new Map(AUD.filter((e) => e.X != null).map((e) => [e.id, [e.X, e.Z]]));

// biểu thức theo 2 ngôn ngữ (mô tả trích xuất lẫn Việt/Anh); so trên chữ thường, theo MỆNH ĐỀ (giữa , ; .)
const R = {
  invalid: /không hợp lệ|không có dữ liệu|invalid|no data|giao diện web|web page/,
  young: /young|staked|sapling|newly planted|replanted|cây non|mới trồng|trồng mới|trồng lại|cọc chống|chống cọc|có cọc|khung chống|kiềng/,
  lean: /slant|leaning|tilted|nghiêng|thân xiên/,
  sparse: /sparse|thin crown|bare|leafless|thưa|trụi|xơ xác/,
  dense: /dense|lush|thick crown|closed canopy|rậm|rợp|um tùm|xum xuê/,
  bikeDense: /(rows?|lines?|dense|many|lots of|crowded|packed|full of)[^,;.]{0,25}(motorbikes|scooters)|(motorbikes|scooters)[^,;.]{0,25}(rows?|dense|packed|lined|crowded)|xe máy[^,;.]{0,25}(dày|kín|nhiều|san sát|hàng dài|chật|đông)|(nhiều|dày|hàng|dãy) xe máy/,
  bikeFew: /(few|no|sparse|single|one)[^,;.]{0,10}(parked )?(motorbikes?|scooters?)|(ít|không|vài|một) xe máy/,
  bikeCover: /(covered|tarp)[^,;.]{0,20}(motorbikes?|scooters?)|(motorbikes?|scooters?)[^,;.]{0,25}(covered|under (a )?(tarp|cover))|xe máy[^,;.]{0,30}(phủ bạt|trùm|áo trùm)|(phủ bạt|trùm)[^,;.]{0,12}xe máy/,
  goods: /goods|merchandise|wares|stalls?|hàng hoá|hàng hóa|bày hàng|sạp/,
  stools: /stools?|plastic chairs?|café tables|cafe tables|ghế nhựa|ghế đẩu|bàn ghế/,
  plants: /potted|plant pots?|pot plants|chậu cây|chậu hoa|cây cảnh|bonsai/,
  wires: /tangled|bundles?|dense wires|messy wires|chằng chịt|búi|rối/,
  // phản biện W4-B: "xe máy chạy dày/đông" (pano_177/435 — ngã tư, xe ĐANG CHẠY/dừng đèn đỏ) ≠ hàng xe ĐỖ → mệnh đề nói xe
  // chạy/lưu thông mà không nói đỗ/đậu/dựng thì không tính bikeDense
  // ("xe máy ô tô đông" ở đại lộ 435, "xe máy đông dày trên đường" 172 = dòng xe; "đông" không kèm từ đỗ/vỉa → dòng xe)
  moving: /chạy|lưu thông|qua lại|di chuyển|dừng đèn|đèn đỏ|giữa đường|trên đường|lòng đường|ngã tư|đông|moving|riding|fast|traffic|passing|on (the )?road|(in|at) (the )?(junction|intersection|crossing)/,
  parked: /đỗ|đậu|dựng|vỉa hè|trước (cửa|nhà|quán|tiệm|hiệu)|parked|parking|kerb|curb|sidewalk|pavement/,
};
// bikeDense theo MỆNH ĐỀ: bỏ mệnh đề chỉ nói xe đang chạy
const bikeDenseOf = (S) => S.split(/[,;.]/).some((c) => R.bikeDense.test(c) && (!R.moving.test(c) || R.parked.test(c)));
const COLS = ['young', 'lean', 'sparse', 'dense', 'bikeDense', 'bikeFew', 'bikeCover', 'goods', 'stools', 'plants', 'wires'];
const per = new Map();
let files = 0, bad = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { bad++; continue; }
  const id = j.pano || f.replace(/_h\d+\.json$/, '');
  const T = (j.trees || '').toString().toLowerCase(), S = (j.street || '').toString().toLowerCase();
  if (R.invalid.test(T + ' ' + S) && T.length + S.length < 60) { bad++; continue; }
  files++;
  let a = per.get(id); if (!a) per.set(id, (a = { n: 0, c: Object.fromEntries(COLS.map((k) => [k, 0])) }));
  a.n++;
  for (const k of ['young', 'lean', 'sparse', 'dense']) if (R[k].test(T)) a.c[k]++;
  if (bikeDenseOf(S)) a.c.bikeDense++;
  for (const k of ['bikeFew', 'bikeCover', 'goods', 'stools', 'plants', 'wires']) if (R[k].test(S)) a.c[k]++;
}
const rows = [];
for (const [id, a] of [...per.entries()].sort()) {
  const p = POS.get(id); if (!p) continue;
  rows.push([id, Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, a.n, ...COLS.map((k) => a.c[k])]);
}
fs.writeFileSync(OUT, JSON.stringify({ src: 'fp_json (W4-A extraction)', cols: ['id', 'X', 'Z', 'n', ...COLS], rows }).replace(/\],\[/g, '],\n['));
const sum = Object.fromEntries(COLS.map((k, i) => [k, rows.filter((r) => r[4 + i] > 0).length]));
console.log(OUT, 'panos', rows.length, 'images', files, 'bad', bad, 'panos with ≥1 mention', JSON.stringify(sum));
