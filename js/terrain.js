// Địa hình từ dữ liệu OpenStreetMap thật (không phụ thuộc three.js — chạy được cả trong node)
import { WORLD, DT_BOX, MASK, RIVERS, ROADS_DT, ROADS_REGION, LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, BUILDINGS } from './mapdata.js';

export const WORLD_BOUNDS = WORLD;
export { LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BUILDINGS };

const SEA_FLOOR = -4, LAND_H = 2;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function distToSeg(x, z, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}
function rectFactor(x, x1, x2, z, z1, z2, m) {
  return smoothstep(x1 - m, x1, x) * (1 - smoothstep(x2, x2 + m, x))
       * smoothstep(z1 - m, z1, z) * (1 - smoothstep(z2, z2 + m, z));
}

// ---------- Giải mã lưới đất/biển ----------
const maskBits = (() => {
  const b64 = MASK.b64;
  let bytes;
  if (typeof Buffer !== 'undefined') bytes = Buffer.from(b64, 'base64');
  else {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
})();
function cellLand(cx, cz) {
  if (cx < 0 || cx >= MASK.w || cz < 0 || cz >= MASK.h) return 1; // ngoài rìa coi là đất (rìa tây/bắc)
  const i = cz * MASK.w + cx;
  return (maskBits[i >> 3] >> (i & 7)) & 1;
}
// độ "đất" 0..1, nội suy song tuyến giữa tâm các ô
export function landAt(x, z) {
  const fx = (x - WORLD.minX) / MASK.cell - 0.5;
  const fz = (z - WORLD.minZ) / MASK.cell - 0.5;
  const cx = Math.floor(fx), cz = Math.floor(fz);
  const tx = fx - cx, tz = fz - cz;
  const v00 = cellLand(cx, cz), v10 = cellLand(cx + 1, cz);
  const v01 = cellLand(cx, cz + 1), v11 = cellLand(cx + 1, cz + 1);
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}

// ---------- Bucket cho sông & đường (tra cứu nhanh) ----------
const BK = 150;
const BW = Math.ceil((WORLD.maxX - WORLD.minX) / BK);
const BH = Math.ceil((WORLD.maxZ - WORLD.minZ) / BK);
function makeBucketIndex(polylines) {
  const buckets = new Map(); // key -> [[x1,z1,x2,z2,meta], ...]
  for (const { pts, meta } of polylines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const cx1 = Math.max(0, Math.floor((Math.min(ax, bx) - WORLD.minX - 40) / BK));
      const cx2 = Math.min(BW - 1, Math.floor((Math.max(ax, bx) - WORLD.minX + 40) / BK));
      const cz1 = Math.max(0, Math.floor((Math.min(az, bz) - WORLD.minZ - 40) / BK));
      const cz2 = Math.min(BH - 1, Math.floor((Math.max(az, bz) - WORLD.minZ + 40) / BK));
      for (let cz = cz1; cz <= cz2; cz++) {
        for (let cx = cx1; cx <= cx2; cx++) {
          const key = cz * BW + cx;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push([ax, az, bx, bz, meta]);
        }
      }
    }
  }
  return buckets;
}
function bucketQuery(buckets, x, z) {
  const cx = Math.floor((x - WORLD.minX) / BK), cz = Math.floor((z - WORLD.minZ) / BK);
  if (cx < 0 || cx >= BW || cz < 0 || cz >= BH) return null;
  return buckets.get(cz * BW + cx) || null;
}
// Kênh Nam Triệu: nối cửa sông Cấm ra biển (luồng tàu thật giữa Đình Vũ - Cát Hải;
// dữ liệu waterway OSM dừng ở cửa sông nên phải nối thủ công, nếu không thuyền bị "đập" chắn)
RIVERS.push({ w: 1300, pts: [[7600, 0], [11000, 4100], [15000, 7000], [20600, 9700]] });
// Hồ Tam Bạc: trục + bề rộng lấy từ polygon nước OSM thật; bờ hẹp sh=14 để nước không lấn
// ra promenade/phố đi bộ Quang Trung (đối chiếu pano_004; lõi hồ w/2=39m giữ nguyên là nước)
// để không ngập trường THCS Trần Phú ngay mép nam hồ
RIVERS.push({ w: EXTRAS.lake.w, sh: 14, pts: EXTRAS.lake.pts });
// POLYGON HỒ TAM BẠC THẬT (OSM way 236743184 "Hồ Tam Bạc", chiếu hệ game, 20 đỉnh) —
// user chốt: hình hồ phải đúng thực địa (2 đầu, bờ cong), KHÔNG xấp xỉ trục+bề rộng.
// Đầu đông x≈-392..-401 = đập gần tượng Lê Chân (đông đập là đất); đầu tây bo tròn -1186.
// Đối chiếu: bờ bắc cách polyline Quang Trung ~19m, bờ nam cách Thế Lữ ~13m → vỉa hè luôn khô.
export const LAKE_POLY = [
  [-1166.7, 300], [-1176.9, 303], [-1183.8, 306.9], [-1186.5, 311], [-1185, 347.6],
  [-1183.1, 355.9], [-1179.5, 362], [-1173.1, 366.2], [-1165.5, 368.4], [-1155.8, 367.4],
  [-1006.2, 346.6], [-392.5, 218.9], [-401.6, 172.8], [-608.7, 215.4], [-769.3, 246.1],
  [-977.2, 287.5], [-1039.5, 299.7], [-1076.1, 302.8], [-1113.8, 302.2], [-1150.8, 299.2],
];
// HỒ SEN (quận Lê Chân, ~85×195m) — cell_nam V1: hồ thật hoàn toàn THIẾU trong terrain
// (8 pano water sev3). Polygon đã chừa lòng đường + kè >=10m khỏi tim các phố #294/#44/#102.
export const HOSEN_POLY = [
  [-55, 865], [5, 852], [14, 950], [34, 988], [43, 1040], [0, 1056], [-40, 1050], [-52, 960],
];
export function hoSenSD(x, z) {
  if (x < -75 || x > 63 || z < 832 || z > 1076) return 1e6;   // bbox nhanh
  let inside = false, bd = 1e9;
  for (let i = 0, j = HOSEN_POLY.length - 1; i < HOSEN_POLY.length; j = i++) {
    const [xi, zi] = HOSEN_POLY[i], [xj, zj] = HOSEN_POLY[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const d = distToSeg(x, z, xi, zi, xj, zj);
    if (d < bd) bd = d;
  }
  return inside ? -bd : bd;
}

// khoảng cách CÓ DẤU tới bờ hồ: ÂM = trong hồ (nước), DƯƠNG = trên đất
export function lakeSD(x, z) {
  let inside = false, bd = 1e9;
  for (let i = 0, j = LAKE_POLY.length - 1; i < LAKE_POLY.length; j = i++) {
    const [xi, zi] = LAKE_POLY[i], [xj, zj] = LAKE_POLY[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const d = distToSeg(x, z, xi, zi, xj, zj);
    if (d < bd) bd = d;
  }
  return inside ? -bd : bd;
}

// Sông Tam Bạc (w=55) đoạn trong phố có KÈ CỨNG — bờ thoải mặc định 28m làm nước loang lên
// dải phố chợ Đổ/Lý Thường Kiệt (pano_135/200: "mặt nước lấn promenade/mặt phố") và cấm cả
// dải đất ven sông xây nhà (cornersDry fail) → thu về 10m (taluy sát kè, kênh giữ nguyên w).
for (const r of RIVERS) if (r.w === 55) r.sh = 10;
// SÔNG TAM BẠC đoạn phố cổ (x -1092..-506): trục OSM lệch NAM 5-30m — đè tim Phố Tam Bạc
// (pano_204/208/210/211/473 gh<1.6) và biến dải ven Thế Lữ thành đất xây nhà (cell_taysong V0).
// Nắn về TRUNG TUYẾN tim Thế Lữ (#243) ↔ tim Phố Tam Bạc (#82), thu w 55→38 (kè cứng đô thị).
for (const r of RIVERS) {
  const i = r.pts.findIndex((p) => p[0] === -878 && p[1] === -9);
  if (i > 0) {
    r.w = 38;
    r.pts.splice(i - 1, 2,
      [-1092, 50], [-1030, 29], [-960, 8], [-900, -8], [-840, -19.5],
      [-780, -29], [-700, -38], [-620, -47], [-506, -76]);
  }
}
// FIX t4 (cell_struct): sông Tam Bạc arc LIỀN MẠCH — splice ở trên xoá đỉnh nối (-1257,148)
// làm arc tách khỏi nhánh rộng. Nối lại + làm dày (w38→48) → nước liền, hết "đứt khúc" trên vệ tinh.
for (const r of RIVERS) {
  if (r.pts.some((p) => p[0] === -314 && p[1] === -182)) { r.w = 48; r.sh = 14; }
}
RIVERS.push({ w: 48, sh: 14, pts: [[-1257, 148], [-1250, 108], [-1238, 72], [-1220, 50], [-1150, 44], [-1092, 50]] });
// NẮN R3 (kênh Tam Bạc): đuôi cũ chạy XUYÊN tile6 (real 0 nước) → thay bằng trục thật x≈-860..-1133
// qua cầu Lạc Long, chạm sông Cấm R1 tại [-1133,-1125] (audit nước georef + ChatGPT vet splice an toàn).
{
  const samePt = (a, b) => a[0] === b[0] && a[1] === b[1];
  const findSeq = (pts, seq) => { outer: for (let i = 0; i <= pts.length - seq.length; i++) { for (let j = 0; j < seq.length; j++) if (!samePt(pts[i + j], seq[j])) continue outer; return i; } return -1; };
  const OLD_R3_TAIL = [[-506, -61], [-314, -182], [-282, -299], [-313, -459], [-631, -952], [-591, -1055], [-414, -1138]];
  const NEW_R3_TAIL = [[-506, -61], [-491, -393], [-482, -646], [-650, -705], [-930, -738], [-992, -862], [-1133, -1125]];
  const cand = RIVERS.filter((r) => findSeq(r.pts, OLD_R3_TAIL) >= 0 || findSeq(r.pts, NEW_R3_TAIL) >= 0);
  if (cand.length === 1 && findSeq(cand[0].pts, NEW_R3_TAIL) < 0) {
    const at = findSeq(cand[0].pts, OLD_R3_TAIL);
    if (at >= 0) cand[0].pts.splice(at, OLD_R3_TAIL.length, ...NEW_R3_TAIL.map((p) => p.slice()));
  } else if (cand.length !== 1) { console.warn('R3 splice: match count =', cand.length, '(bỏ qua)'); }
}
const riverIdx = makeBucketIndex(RIVERS.map((r) => ({ pts: r.pts, meta: [r.w, r.sh || 28] })));
const regionIdx = makeBucketIndex(ROADS_REGION.map((r) => ({ pts: r.pts, meta: 0 })));
const dtRoadIdx = makeBucketIndex(ROADS_DT.map((r) => ({ pts: r.pts, meta: r.c })));

// hệ số đào lòng sông 0..1 tại điểm
export function riverFactor(x, z) {
  const list = bucketQuery(riverIdx, x, z);
  if (!list) return 0;
  let f = 0;
  for (const [ax, az, bx, bz, m] of list) {
    const d = distToSeg(x, z, ax, az, bx, bz);
    const fi = 1 - smoothstep(m[0] / 2, m[0] / 2 + m[1], d);
    if (fi > f) f = fi;
  }
  return f;
}
export function nearRegionRoad(x, z, r) {
  const list = bucketQuery(regionIdx, x, z);
  if (!list) return false;
  for (const [ax, az, bx, bz] of list) if (distToSeg(x, z, ax, az, bx, bz) < r) return true;
  return false;
}
function nearDTRoad(x, z, r) {
  const list = bucketQuery(dtRoadIdx, x, z);
  if (!list) return false;
  for (const [ax, az, bx, bz] of list) if (distToSeg(x, z, ax, az, bx, bz) < r) return true;
  return false;
}

// ---------- Cầu lớn (vòm) & cầu tàu ----------
// nhịp cầu lấy đúng từ way OSM: tâm (x,zc), nửa chiều dài half, góc trục ang (atan2(dx,dz))
export const BRIDGES = EXTRAS.bridges.map((b) => ({
  ...b, sin: Math.sin(b.ang), cos: Math.cos(b.ang),
}));
const PIERS = []; // world.js đăng ký sau khi dò bờ
export function addPier(p) { PIERS.push(p); }

function deckHeight(x, z, rf) {
  let h = -Infinity;
  for (const b of BRIDGES) {
    const dx = x - b.x, dz = z - b.zc;
    const along = dx * b.sin + dz * b.cos;      // dọc trục cầu
    const across = dx * b.cos - dz * b.sin;     // ngang trục cầu
    if (Math.abs(across) < 10 && Math.abs(along) < b.half) {
      const tt = along / b.half;
      h = Math.max(h, LAND_H + b.rise * Math.max(0, 1 - tt * tt));
    }
  }
  for (const p of PIERS) {
    if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) h = Math.max(h, LAND_H);
  }
  // đường bộ băng sông = mặt cầu phẳng (mọi cây cầu phố thật: cầu Rào, Lạc Long, An Dương...)
  // NHƯNG trong LÒNG HỒ Tam Bạc: ROADS_REGION vẽ thô đè qua lòng hồ → "dải đất" nổi giữa
  // nước (lộ ở render aerial); chỉ đường DT thật cắt hồ (đập Tam Kỳ) mới được lát mặt.
  if (rf > 0.03) {
    if (nearDTRoad(x, z, 8) || (lakeSD(x, z) > -2 && nearRegionRoad(x, z, 9))) h = Math.max(h, LAND_H + 0.05);
  }
  return h;
}

// ---------- Đồi núi ----------
const DS_RIDGE = EXTRAS.dsRidge; // sống đồi Đồ Sơn (từ bãi biển OSM thật)
function hills(x, z, v) {
  let h = 0;
  const dDS = distToSeg(x, z, ...DS_RIDGE);
  h += 62 * (1 - smoothstep(220, 950, dDS)) * (0.72 + 0.28 * Math.sin(x * 0.005 + z * 0.003));
  // đồi Vụng — nơi đặt biệt thự Bảo Đại (node OSM thật)
  const dBD = Math.hypot(x - EXTRAS.baodai[0], z - EXTRAS.baodai[1]);
  h += 32 * (1 - smoothstep(150, 700, dBD));
  if (z < -2500 && v > 0.6) { // đồi Thủy Nguyên
    h += 28 * smoothstep(-2500, -6000, z) * (0.5 + 0.5 * Math.sin(x * 0.0011) * Math.sin(z * 0.0013)) * smoothstep(0.6, 0.9, v);
  }
  if (x > 30000 && v > 0.55) { // núi Cát Bà
    h += 110 * (0.45 + 0.55 * Math.sin(x * 0.0016 + 1) * Math.sin(z * 0.0019)) * smoothstep(0.55, 0.85, v);
  }
  return Math.max(0, h);
}

// KHU CẢNG Hoàng Diệu (tile7/8): sông Cấm R1 (w620, từ OSM) modeled quá RỘNG/nam → ngập dải cảng +
// bán đảo Sở GTVT (real là ĐẤT tới z≈-1250). KHÔNG dời centerline/giảm w (rủi ro sông xuyên khu khác);
// dùng OVERRIDE đất cục bộ polygon thuôn, feather bờ 18m, chạy CUỐI groundHeightNoDeck (audit + ChatGPT vet).
const PORT_RECLAIM = [
  [-480, -955], [-430, -1120], [-300, -1230], [320, -1230], [450, -1120], [500, -955], [500, -900], [-480, -900],
];
function _inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (((zi > z) !== (zj > z)) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function _segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], vv = vx * vx + vz * vz;
  let t = vv ? ((x - a[0]) * vx + (z - a[1]) * vz) / vv : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * vx), z - (a[1] + t * vz));
}
function reclaimPort(h, x, z) {
  if (x < -490 || x > 510 || z < -1240 || z > -890) return h;   // bbox nhanh
  if (!_inPoly(x, z, PORT_RECLAIM)) return h;
  let d = Infinity;
  for (let i = 0; i < PORT_RECLAIM.length; i++) d = Math.min(d, _segDist(x, z, PORT_RECLAIM[i], PORT_RECLAIM[(i + 1) % PORT_RECLAIM.length]));
  let t = Math.min(1, d / 18); t = t * t * (3 - 2 * t);          // feather bờ 18m
  const raised = 0.30 + (LAND_H - 0.30) * t;                     // dryH 0.30 > cutoff isWater 0.25
  return Math.max(h, raised);
}

// ---------- Cao độ ----------
export function groundHeightNoDeck(x, z) {
  const v = landAt(x, z);
  let h = lerp(SEA_FLOOR, LAND_H, smoothstep(0.32, 0.68, v));
  // gợn nhẹ đồng bằng
  h += 0.4 * Math.sin(x * 0.0021) * Math.sin(z * 0.0017) * smoothstep(0.6, 0.9, v);
  h += hills(x, z, v);
  // san phẳng trung tâm (hộp phố thật) + thị trấn Cát Bà + khu cảng
  h = lerp(h, LAND_H, rectFactor(x, DT_BOX.x1, DT_BOX.x2, z, DT_BOX.z1, DT_BOX.z2, 250) * smoothstep(0.35, 0.55, v));
  const CT = EXTRAS.catbaTown;
  h = lerp(h, LAND_H, rectFactor(x, CT[0] - 500, CT[0] + 500, z, CT[1] - 380, CT[1] + 380, 120) * smoothstep(0.35, 0.55, v));
  h = lerp(h, LAND_H, rectFactor(x, LM.port[0] - 600, LM.port[0] + 600, z, LM.port[1] - 300, LM.port[1] + 300, 90) * smoothstep(0.3, 0.5, v));
  // đào lòng sông (thắng san phẳng)
  const rf = riverFactor(x, z);
  if (rf > 0) h = lerp(h, -3, rf);
  // HỒ TAM BẠC — TẠO HÌNH SẠCH (đè lên mask OSM nham nhở): trong hành lang hồ, lòng hồ là KÊNH
  // theo POLYGON hồ thật LAKE_POLY (bờ cong đúng thực địa, KHÔNG ngập 2 phố ven hồ);
  // ngoài mép là ĐẤT PHỐ. Hết "bét nhè"/nước thò sau nhà.
  // (Giữ NƯỚC đầy hồ theo yêu cầu chủ dự án — thực địa 2026 hồ cạn thi công nhưng không mô phỏng.)
  if (x > -1200 && x < -205 && z > 55 && z < 400) {
    const sd = lakeSD(x, z);
    if (sd < 0) h = lerp(-3, 1.7, smoothstep(-2, 0, sd));   // lòng hồ theo POLYGON thật, taluy kè 2m
    else if (sd < 60 && h < 1.6) h = LAND_H;                // ngoài mép = đất phố
    // ĐÔNG ĐẬP Lê Chân: thực tế là ĐẤT (dải vườn hoa + Triển lãm) nhưng mask nước OSM cũ
    // kéo tới ~x=-240 → lấp thành đất phố (user: "đằng sau nhà triển lãm có hồ đâu")
    else if (x > -400 && z > 100 && z < 240 && h < 1.6) h = LAND_H;
  }
  // HỒ SEN (cell_nam V1): kênh theo polygon thật, taluy kè 2m — ngoài mép giữ đất phố
  if (x > -75 && x < 63 && z > 832 && z < 1076) {
    const sd = hoSenSD(x, z);
    if (sd < 0) h = lerp(-3, 1.7, smoothstep(-2, 0, sd));
  }
  // HỒ QUẦN NGỰA (tile3 góc Đông-Nam) — real CÓ hồ lớn nhưng game THIẾU (audit nước georef, t3=2.4).
  // Ellipse tâm ~(600,228), tràn ra ngoài khung đông; carve nước, nhà tự loại qua isWater. Chỉ hạ (an toàn).
  // (dời tâm SE + thu bắc: tránh chìm entity ga ở (635,172) — diag bắt được)
  if (x > 500 && x < 760 && z > 185 && z < 360) {
    const dx = (x - 628) / 116, dz = (z - 276) / 82, r2 = dx * dx + dz * dz;
    if (r2 < 1) { const hl = lerp(-3, 1.9, smoothstep(0.45, 1.0, r2)); if (hl < h) h = hl; }
  }
  h = reclaimPort(h, x, z);   // ĐẤT cảng: chạy CUỐI (sau mọi carve sông/hồ) để R1 không ngập lại
  return h;
}

export function groundHeight(x, z) {
  const h = groundHeightNoDeck(x, z);
  const rf = h < 1.9 ? riverFactor(x, z) : 0;
  const d = deckHeight(x, z, rf);
  return d > h ? d : h;
}

export function isWater(x, z) { return groundHeightNoDeck(x, z) < 0.25; }

// điểm trên sông Cấm gần x nhất (đặt cảng, bến)
export function nearestRiverPoint(x0, minW = 50) {
  let best = null, bd = Infinity;
  for (const r of RIVERS) {
    if (r.w < minW) continue;
    for (const [px, pz] of r.pts) {
      const d = Math.abs(px - x0);
      if (d < bd) { bd = d; best = [px, pz, r.w]; }
    }
  }
  return best;
}

// Dò bãi biển/bến quanh một mỏ neo: trả về các điểm cát + hướng ra biển
export function findShore(ax, az, searchR = 1200, step = 40) {
  const beach = [];
  for (let dx = -searchR; dx <= searchR; dx += step) {
    for (let dz = -searchR; dz <= searchR; dz += step) {
      if (dx * dx + dz * dz > searchR * searchR) continue;
      const x = ax + dx, z = az + dz;
      const h = groundHeightNoDeck(x, z);
      if (h > 0.55 && h < 1.35) beach.push([x, z, h]);
    }
  }
  if (!beach.length) return null;
  // điểm bãi gần mỏ neo nhất làm gốc bến
  beach.sort((p, q) => (p[0] - ax) ** 2 + (p[1] - az) ** 2 - ((q[0] - ax) ** 2 + (q[1] - az) ** 2));
  const [bx, bz] = beach[0];
  // hướng dốc xuống biển
  let dir = [1, 0], bestH = Infinity;
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    const h = groundHeightNoDeck(bx + Math.cos(ang) * 26, bz + Math.sin(ang) * 26);
    if (h < bestH) { bestH = h; dir = [Math.cos(ang), Math.sin(ang)]; }
  }
  return { beach, pierBase: [bx, bz], seaDir: dir };
}
