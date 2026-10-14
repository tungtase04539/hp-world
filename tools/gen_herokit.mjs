// tools/gen_herokit.mjs — Đợt 3 W5-A HERO-KIT: chọn CHƯƠNG TRÌNH DỰNG ĐẶC TRƯNG cho từng nhà "không phải nhà ống" (ngân hàng,
// văn phòng kính, khách sạn, showroom/siêu thị, cây xăng, nhà chợ, trường/công sở thuộc địa, chùa, nhà cột tân cổ điển)
// từ QUAN SÁT ẢNH PANO THẬT (fp_json: kiểu + GHI CHÚ tự do của agent trích xuất) + thẻ OSM (amenity/shop/tourism/religion).
//
// usage: node tools/gen_herokit.mjs <fp_json dir> <fp_plan.json> [--dump out.json]
//   → js/herokit_data.js (SINH TỰ ĐỘNG — đừng sửa tay). Đầu vào ảnh/JSON gốc nằm ngoài repo như --collect của
//   tools/gen_facade_fp.mjs (ghi chú tự do không vào audit/facade_fp.json). Tất định: cùng đầu vào → cùng byte.
//
// ÁNH XẠ ảnh → nhà = mapFacadeFP của W4-A (cùng tia, cùng trọng số) trên footprint HIỆN TẠI của js/buildings_real.js.
// Khoá runtime = TÂM DIỆN TÍCH footprint (dm) — js/herokit.js khớp lân cận ≤ 0,6 m ⇒ ai sinh lại buildings_real.js mà nhà
// không đổi hình vẫn khớp; nhà đổi hình thì mất chương trình (không lỗi) → chạy lại tool này sau process_buildings.
import fs from 'fs';
import { collectFP, mapFacadeFP, FP_COLS, FP_ENUMS } from './gen_facade_fp.mjs';
import { RB_B64 } from '../js/buildings_real.js';
import { decodeRB } from '../js/buildings_data.js';

const A = process.argv.slice(2);
if (A.length < 2) { console.error('usage: node tools/gen_herokit.mjs <fp_json dir> <fp_plan.json> [--dump out.json]'); process.exit(1); }
const C = Object.fromEntries(FP_COLS.map((k, i) => [k, i]));
const SI = Object.fromEntries(FP_ENUMS.style.map((v, i) => [v, i]));
const GI = Object.fromEntries(FP_ENUMS.ground.map((v, i) => [v, i]));
const WI = Object.fromEntries(FP_ENUMS.windows.map((v, i) => [v, i]));
const RI = Object.fromEntries(FP_ENUMS.roof.map((v, i) => [v, i]));

// chương trình (chỉ số khớp js/herokit.js HP)
export const PROG = ['none', 'pagoda', 'petrol', 'market', 'school', 'bank', 'hotel', 'store', 'office', 'colonnade'];
const P = Object.fromEntries(PROG.map((v, i) => [v, i]));
// ghi chú tự do (tiếng Việt CÓ dấu hoặc tiếng Anh). Chú ý: "đen" (màu đen) ≠ "đền"; "nhà nghỉ" = nhà ống, không phải khách sạn.
const RX = {
  petrol: /trạm xăng|cây xăng|cửa hàng xăng|xăng dầu|petrol|gas station|fuel station/i,
  pagoda: /chùa|đình làng|đền thờ|(^|[\s,(])đền([\s,).]|$)|miếu|pagoda|temple|shrine/i,
  marketHall: /nhà chợ|chợ có mái|mái tôn.*chợ|chợ.*mái tôn|market hall|covered market|market building|corrugated.*market|market.*corrugated/i,
  school: /trường|school|mầm non|kindergarten|nhà trẻ/i,
  bank: /ngân hàng|(^|[^a-z])bank([^a-z]|$)|(^|[^a-z])atm([^a-z]|$)/i,
  hotel: /khách sạn|hotel|porte|resort/i,
  store: /showroom|điện máy|siêu thị|electronics|superstore|supermarket|thời trang|fashion|điện thoại|phone|salon|cửa hàng giày|shoe|nội thất|furniture/i,
  office: /văn phòng|office|mặt dựng|curtain|thương mại|tòa kính|toà kính|glass tower|cao ốc/i,
  column: /cột|column|colonnade|portico|pillar|trụ đá|trụ lớn/i,
  civic: /trụ sở|hành chính|ủy ban|uỷ ban|government|bưu điện|post office|bệnh viện|hospital|nhà hát|theatre|bảo tàng|museum|cơ quan|toà án|tòa án/i,
  fence: /rào|fence|cổng|gate/i,
  wallOnly: /^\s*(tường rào|hàng rào|rào|cổng|fence|wall|boundary|low wall|gate)/i,
  stairs: /bậc thang|bậc tam cấp|sảnh cầu thang|cầu thang|stair|steps/i,
  canopy: /mái che|mái sảnh|mái hiên kính|canopy|porte/i,
  tile: /ngói|tile roof|tiled/i,
  curved: /cong|curved|góc tròn|rounded/i,
};

const fpDir = A[0], planFile = A[1];
const FP = collectFP(fpDir, planFile, { notes: true });
// kiểm: obs phải TRÙNG với audit/facade_fp.json đã cam kết (cùng hàm gộp) — nếu lệch thì fp_json đã đổi, ghi rõ
let committed = null; try { committed = JSON.parse(fs.readFileSync(new URL('../audit/facade_fp.json', import.meta.url), 'utf8')); } catch {}
const sameObs = committed ? committed.obs.length === FP.obs.length : null;

const D = decodeRB(RB_B64);
const polys = [], CX = new Float64Array(D.nB), CZ = new Float64Array(D.nB), AREA = new Float64Array(D.nB);
for (let b = 0; b < D.nB; b++) {
  const s = D.vStart[b], n = D.vStart[b + 1] - s, Pl = [];
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, xa = D.x[s + i], za = D.z[s + i], xb = D.x[s + j], zb = D.z[s + j], c = xa * zb - xb * za;
    a += c; cx += (xa + xb) * c; cz += (za + zb) * c; Pl.push([xa, za]);
  }
  if (Math.abs(a) < 1e-6) { cx = D.x[s]; cz = D.z[s]; } else { cx /= 3 * a; cz /= 3 * a; }
  CX[b] = cx; CZ[b] = cz; AREA[b] = Math.abs(a) / 2; polys.push(Pl);
}
const R = mapFacadeFP(polys, FP, { keepHits: true });

// ---- chương trình của MỘT quan sát (kiểu + ghi chú + trệt/cửa sổ) ----
function obsProg(o, note) {
  const st = o[C.style], g = o[C.ground], w = o[C.windows], fl = o[C.floors];
  const nt = note || '';
  const wallOnly = RX.wallOnly.test(nt) && !RX.pagoda.test(nt.replace(RX.wallOnly, '')) && fl <= 1;
  if (RX.petrol.test(nt)) return P.petrol;
  if (wallOnly) return 0;   // quan sát tả TƯỜNG RÀO/CỔNG chứ không phải nhà
  if (st === SI.temple || (RX.pagoda.test(nt) && !/tường rào chùa|rào chùa/i.test(nt))) return P.pagoda;
  if ((st === SI.market && (o[C.roof] === RI.tin || RX.marketHall.test(nt))) || RX.marketHall.test(nt)) return P.market;
  if (RX.bank.test(nt)) return P.bank;
  if (RX.hotel.test(nt) && !/nhà nghỉ/i.test(nt) && (fl >= 4 || fl < 0)) return P.hotel;
  if (RX.store.test(nt) && (g === GI.glass_store || w === WI.glass_curtain || st === SI.glass_office)) return P.store;
  if (RX.school.test(nt) && st !== SI.tube && st !== SI.tube_old) return P.school;
  if ((st === SI.neoclassical || st === SI.colonial || st === SI.civic) && RX.column.test(nt) && fl >= 2) return P.colonnade;
  if ((st === SI.civic || st === SI.colonial || st === SI.neoclassical) && RX.civic.test(nt) && fl >= 2) return P.school;   // công sở thuộc địa: cùng bộ rào + cổng + mái ngói
  // văn phòng kính: ghi chú nói văn phòng/mặt dựng/kính HOẶC vách kính, trên kiểu kính/công sở/khác (tòa "ốp tấm + kính" của 235 ghi civic)
  if ((st === SI.glass_office || st === SI.civic || st === SI.other) && fl >= 3
    && (RX.office.test(nt) || w === WI.glass_curtain || (st === SI.glass_office && g === GI.glass_store))) return P.office;
  if (st === SI.hotel_tower && fl >= 6 && w === WI.glass_curtain) return P.office;
  return 0;
}

// ---- gộp theo nhà ----
const per = new Map();   // bi → {tot, votes[], ...}
for (const [oi, bi, d, w] of R.hits) {
  const o = FP.obs[oi], note = FP.notes[oi] || '';
  let r = per.get(bi); if (!r) per.set(bi, (r = { tot: 0, votes: new Array(PROG.length).fill(0), obs: [] }));
  r.tot += w;
  const p = obsProg(o, note);
  if (p) { r.votes[p] += w; r.obs.push({ oi, w, p, d }); }
}
const toLin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const toS = (l) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function avgCol(list) {   // trung bình tuyến tính có trọng số quanh màu nặng nhất (< 70)
  if (!list.length) return -1;
  list.sort((a, b) => b.w - a.w || a.c - b.c);
  const ref = rgb(list[0].c), acc = [0, 0, 0]; let ws = 0;
  for (const { c, w } of list) { const q = rgb(c); if (Math.hypot(q[0] - ref[0], q[1] - ref[1], q[2] - ref[2]) > 70) continue; for (let k = 0; k < 3; k++) acc[k] += toLin(q[k]) * w; ws += w; }
  const s = acc.map((v) => Math.max(0, Math.min(255, toS(v / ws))));
  return (s[0] << 16) | (s[1] << 8) | s[2];
}
const OUT = [], stat = { prog: {}, dropped: { weak: 0, minority: 0, small: 0, far: 0 } };
const MIN_V = 0.05;
for (const bi of [...per.keys()].sort((a, b) => a - b)) {
  const r = per.get(bi);
  let best = 0, bv = 0; for (let p = 1; p < PROG.length; p++) if (r.votes[p] > bv) { bv = r.votes[p]; best = p; }
  if (!best) continue;
  if (bv < MIN_V) { stat.dropped.weak++; continue; }
  if (bv < 0.25 * r.tot) { stat.dropped.minority++; continue; }
  // quan sát gần nhất của chương trình này phải ≤ 60 m (ảnh "xa" chỉ là hình bóng — không đủ để dựng chi tiết)
  const mine = r.obs.filter((q) => q.p === best);
  if (Math.min(...mine.map((q) => q.d)) > 60) { stat.dropped.far++; continue; }
  if (AREA[bi] < (best === P.petrol ? 12 : best === P.store || best === P.bank ? 25 : best === P.school ? 100 : 40)) { stat.dropped.small++; continue; }
  const walls = [], accents = []; let flags = 0, fl = 0, flw = 0, fx = 0, fz = 0, fw = 0;
  for (const q of mine) {
    const o = FP.obs[q.oi], nt = FP.notes[q.oi] || '';
    // ĐIỂM TIÊU: nơi tia quan sát (giữa [x0,x1] trong ảnh) chạm mặt nhà — khối gộp lớn (b1471 2.321 m²: ngân hàng + văn phòng +
    // quán) thì sảnh/mái che/biển đặt ĐÚNG đoạn mặt tiền ảnh thấy, không giữa cạnh dài nhất
    const pano = FP.panos[o[C.pano]], xm = (o[C.x0] + o[C.x1]) / 2;
    const brg = ((o[C.heading] + (Math.atan((xm - 0.5) * 2 * Math.tan((49 * Math.PI) / 180)) * 180) / Math.PI) * Math.PI) / 180;
    fx += (pano[1] + Math.sin(brg) * q.d) * q.w; fz += (pano[2] - Math.cos(brg) * q.d) * q.w; fw += q.w;
    if (o[C.wall] >= 0) walls.push({ c: o[C.wall], w: q.w });
    if (o[C.signPresent] === 1 && o[C.signBg] >= 0) accents.push({ c: o[C.signBg], w: q.w });
    if (o[C.roof] === RI.tile || RX.tile.test(nt)) flags |= 1;
    if (RX.fence.test(nt) || o[C.ground] === GI.gate || o[C.ground] === GI.wall) flags |= 2;
    if (RX.canopy.test(nt)) flags |= 4;
    if (RX.stairs.test(nt)) flags |= 8;
    if (o[C.windows] === WI.arched) flags |= 16;
    if (RX.curved.test(nt)) flags |= 32;
    if (RX.column.test(nt)) flags |= 64;
    if (o[C.floors] > 0) { fl += o[C.floors] * q.w; flw += q.w; }
  }
  OUT.push([Math.round(CX[bi] * 10), Math.round(CZ[bi] * 10), best, avgCol(walls), avgCol(accents), flags, Math.round((fx / fw) * 10), Math.round((fz / fw) * 10)]);
  stat.prog[PROG[best]] = (stat.prog[PROG[best]] || 0) + 1;
}
OUT.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const meta = { v: 1, generator: 'tools/gen_herokit.mjs', rb: D.nB, obs: FP.obs.length, sameObsAsFacadeFP: sameObs, hits: R.hits.length, n: OUT.length, ...stat };
const txt = '// js/herokit_data.js — SINH TỰ ĐỘNG bởi tools/gen_herokit.mjs (Đợt 3 W5-A HERO-KIT). ĐỪNG SỬA TAY.\n'
  + '// HERO[i] = [cx·10, cz·10 (tâm diện tích footprint, dm), chương trình (HERO_PROG), màu tường sRGB | −1, màu nhấn (biển) sRGB | −1,\n'
  + '//            cờ: 1 mái ngói · 2 rào/cổng · 4 mái che sảnh · 8 bậc thang · 16 cửa vòm · 32 khối cong · 64 hàng cột,\n'
  + '//            điểm tiêu x·10, z·10 (nơi tia quan sát chạm mặt nhà: sảnh/mái che/biển đặt ở đoạn mặt tiền đó)]\n'
  + `export const HERO_PROG = ${JSON.stringify(PROG)};\n`
  + `export const HERO_META = ${JSON.stringify(meta)};\n`
  + 'export const HERO = [\n' + OUT.map((r) => JSON.stringify(r)).join(',\n') + '\n];\n';
fs.writeFileSync(new URL('../js/herokit_data.js', import.meta.url), txt);
console.log('ghi js/herokit_data.js', OUT.length, 'nhà', JSON.stringify(meta));
// --why x,z[,r]: chẩn đoán — phiếu từng nhà quanh điểm (vì sao có/không có chương trình)
const wi = A.indexOf('--why');
if (wi >= 0) {
  const [wx, wz, wr = 30] = A[wi + 1].split(',').map(Number);
  for (const [bi, r] of [...per.entries()].sort((a, b) => a[0] - b[0])) {
    if (Math.hypot(CX[bi] - wx, CZ[bi] - wz) > wr) continue;
    console.log(`b${bi} c(${CX[bi].toFixed(0)},${CZ[bi].toFixed(0)}) A${AREA[bi].toFixed(0)} tot${r.tot.toFixed(3)} votes ${r.votes.map((v, i) => v > 0 ? PROG[i] + ':' + v.toFixed(3) : '').filter(Boolean).join(' ')}`);
    for (const [oi, b2, d, w] of R.hits) if (b2 === bi) { const o = FP.obs[oi]; console.log(`    ${FP.panos[o[C.pano]][0]}_h${o[C.heading]} d${d} w${w} ${FP_ENUMS.style[o[C.style]]} p=${PROG[obsProg(o, FP.notes[oi])]} | ${(FP.notes[oi] || '').slice(0, 80)}`); }
  }
}
const di = A.indexOf('--dump');
if (di >= 0) {
  const dump = OUT.map((r) => {
    const bi = [...per.keys()].find((b) => Math.round(CX[b] * 10) === r[0] && Math.round(CZ[b] * 10) === r[1]);
    const pr = per.get(bi);
    return { bi, prog: PROG[r[2]], area: Math.round(AREA[bi]), fl: D.floors[bi], obs: pr.obs.filter((q) => q.p === r[2]).map((q) => FP.panos[FP.obs[q.oi][C.pano]][0] + '_h' + FP.obs[q.oi][C.heading] + ' ' + (FP.notes[q.oi] || '').slice(0, 70)) };
  });
  fs.writeFileSync(A[di + 1], JSON.stringify(dump, null, 1));
}
