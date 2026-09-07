// Địa hình từ dữ liệu OpenStreetMap thật (không phụ thuộc three.js — chạy được cả trong node)
import { WORLD, DT_BOX, MASK, RIVERS, ROADS_DT, ROADS_REGION, LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, BUILDINGS, WATER } from './mapdata.js';

export const WORLD_BOUNDS = WORLD;
export { LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BUILDINGS, WATER };

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

// khoảng cách CÓ DẤU tới 1 polygon: ÂM = trong (nước), DƯƠNG = ngoài (đất)
function polySD(x, z, poly) {
  let inside = false, bd = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const d = distToSeg(x, z, xi, zi, xj, zj);
    if (d < bd) bd = d;
  }
  return inside ? -bd : bd;
}
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// POLYGON HỒ TAM BẠC THẬT (OSM way 236743184 "Hồ Tam Bạc", chiếu hệ game, ĐỦ 20 đỉnh — khớp 0,00 m với
// node OSM; bản trong WATER bị simplify 1.5 m còn 11 đỉnh nên waterSD dùng chính bản này thay thế) —
// user chốt: hình hồ phải đúng thực địa (2 đầu, bờ cong), KHÔNG xấp xỉ trục+bề rộng.
// Đầu đông x≈-392..-401 = đập gần tượng Lê Chân (đông đập là đất); đầu tây bo tròn -1186.
// Đối chiếu: bờ bắc cách polyline Quang Trung ~19m, bờ nam cách Thế Lữ ~13m → vỉa hè luôn khô.
export const LAKE_POLY = [
  [-1166.7, 300], [-1176.9, 303], [-1183.8, 306.9], [-1186.5, 311], [-1185, 347.6],
  [-1183.1, 355.9], [-1179.5, 362], [-1173.1, 366.2], [-1165.5, 368.4], [-1155.8, 367.4],
  [-1006.2, 346.6], [-392.5, 218.9], [-401.6, 172.8], [-608.7, 215.4], [-769.3, 246.1],
  [-977.2, 287.5], [-1039.5, 299.7], [-1076.1, 302.8], [-1113.8, 302.2], [-1150.8, 299.2],
];
// khoảng cách CÓ DẤU tới bờ hồ Tam Bạc: ÂM = trong hồ (nước), DƯƠNG = trên đất (world.js: promenade/kè/cây ven hồ)
export function lakeSD(x, z) { return polySD(x, z, LAKE_POLY); }
// HỒ SEN (quận Lê Chân) — polygon OSM thật way 203719090 lấy từ WATER (trước đây vẽ tay 8 đỉnh, bờ đông lệch 14 m);
// world.js dựng kè theo HOSEN_POLY + hoSenSD, cùng polygon với waterSD nên kè luôn bám đúng mép nước.
const hoSenWater = WATER.find((w) => w.n === 'Hồ Sen');
if (!hoSenWater) console.warn('terrain: WATER không có polygon "Hồ Sen" — kè hồ Sen sẽ không dựng');
export const HOSEN_POLY = hoSenWater ? hoSenWater.pts : [];
const HOSEN_BB = HOSEN_POLY.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [1e9, -1e9, 1e9, -1e9]);
export function hoSenSD(x, z) {
  if (x < HOSEN_BB[0] - 30 || x > HOSEN_BB[1] + 30 || z < HOSEN_BB[2] - 30 || z > HOSEN_BB[3] + 30) return 1e6;   // bbox nhanh
  return polySD(x, z, HOSEN_POLY);
}

// ---------- NƯỚC POLYGON OSM (trong thành phố) ----------
// Trong bán kính R_POLY quanh Nhà hát, đất/nước do POLYGON natural=water THẬT (mapdata.WATER) quyết định:
// waterSD(x,z) = khoảng cách có dấu tới TẬP polygon (ÂM = trong nước). Thay cho polyline bề rộng hằng
// (Cấm 620 m vs thật 201 m ở Bến Bính; Tam Bạc/Hạ Lý chữ Y; Hồ Tiên Nga không có trục) và mọi vá tay
// (reclaimPort, nắn R3, ellipse Quần Ngựa, w38/48). Ngoài R_POLY_END vẫn polyline RIVERS + MASK bờ biển
// (Lạch Tray, kênh Nam Triệu, Cát Bà…); giữa 2 mốc hoà dần 2 mô hình để mép vùng không có bậc.
// Tra cứu: lưới ô WB m; mỗi ô giữ các cạnh cách ô ≤ WMARGIN (|sd| chính xác tới WMARGIN, xa hơn kẹp) và
// cờ "tâm ô nằm trong polygon i" (ray-casting đầy đủ 1 lần lúc nạp) → lúc chạy chỉ đếm số lần đoạn
// tâm-ô→điểm cắt các cạnh trong ô (chẵn/lẻ) — chính xác tuyệt đối, ~0.5 µs/lần.
export const R_POLY = 1750, R_POLY_END = 1950;
const WPOLYS = WATER.map((w) => (w.n === 'Hồ Tam Bạc' ? LAKE_POLY : w.pts));
const WB = 100, WMARGIN = 40;
const WG = Math.ceil((R_POLY_END + WMARGIN) / WB) * WB;   // nửa cạnh lưới (m), lưới phủ [-WG, WG]²
const WN = (2 * WG) / WB;
const NP = WPOLYS.length;
const wSegs = Array.from({ length: WN * WN }, () => []);   // [ax, az, bx, bz, polygonIdx]
const wIn = new Uint8Array(WN * WN * NP);                   // tâm ô nằm trong polygon i
const wInList = Array.from({ length: WN * WN }, () => []);  // các polygon chứa tâm ô
{
  const ci = (v) => Math.floor((v + WG) / WB);
  WPOLYS.forEach((poly, pi) => {
    let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
    for (const [x, z] of poly) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, az] = poly[j], [bx, bz] = poly[i];
      const ix1 = ci(Math.min(ax, bx) - WMARGIN), ix2 = ci(Math.max(ax, bx) + WMARGIN);
      const iz1 = ci(Math.min(az, bz) - WMARGIN), iz2 = ci(Math.max(az, bz) + WMARGIN);
      if (ix2 < 0 || ix1 >= WN || iz2 < 0 || iz1 >= WN) continue;
      for (let cz = Math.max(0, iz1); cz <= Math.min(WN - 1, iz2); cz++) {
        for (let cx = Math.max(0, ix1); cx <= Math.min(WN - 1, ix2); cx++) wSegs[cz * WN + cx].push([ax, az, bx, bz, pi]);
      }
    }
    const ix1 = ci(x1), ix2 = ci(x2), iz1 = ci(z1), iz2 = ci(z2);
    if (ix2 < 0 || ix1 >= WN || iz2 < 0 || iz1 >= WN) return;
    for (let cz = Math.max(0, iz1); cz <= Math.min(WN - 1, iz2); cz++) {
      for (let cx = Math.max(0, ix1); cx <= Math.min(WN - 1, ix2); cx++) {
        if (inPoly(-WG + (cx + 0.5) * WB, -WG + (cz + 0.5) * WB, poly)) { wIn[(cz * WN + cx) * NP + pi] = 1; wInList[cz * WN + cx].push(pi); }
      }
    }
  });
}
const wParity = new Uint8Array(NP);
export function waterSD(x, z) {
  const cx = Math.floor((x + WG) / WB), cz = Math.floor((z + WG) / WB);
  if (cx < 0 || cx >= WN || cz < 0 || cz >= WN) return WMARGIN;
  const cell = cz * WN + cx, segs = wSegs[cell];
  const mx = -WG + (cx + 0.5) * WB, mz = -WG + (cz + 0.5) * WB;   // tâm ô
  const dx = x - mx, dz = z - mz;
  let bd = WMARGIN, inside = false;
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k], ax = s[0], az = s[1], bx = s[2], bz = s[3];
    const d = distToSeg(x, z, ax, az, bx, bz);
    if (d < bd) bd = d;
    // đoạn tâm-ô→điểm cắt cạnh (a,b)? quy ước nửa-mở (>0) để đỉnh chung 2 cạnh chỉ đếm 1 lần
    const ex = bx - ax, ez = bz - az;
    if ((ex * (mz - az) - ez * (mx - ax) > 0) === (ex * (z - az) - ez * (x - ax) > 0)) continue;
    if ((dx * (az - mz) - dz * (ax - mx) > 0) !== (dx * (bz - mz) - dz * (bx - mx) > 0)) wParity[s[4]] ^= 1;
  }
  // trong nước ⇔ với polygon nào đó: (tâm ô nằm trong) XOR (số lần cắt lẻ)
  const inList = wInList[cell];
  for (let k = 0; k < inList.length; k++) if (!wParity[inList[k]]) inside = true;
  for (let k = 0; k < segs.length; k++) {
    const pi = segs[k][4];
    if (wParity[pi]) { if (!wIn[cell * NP + pi]) inside = true; wParity[pi] = 0; }
  }
  return inside ? -bd : bd;
}
// trọng số mô hình polygon: 1 trong R_POLY, 0 ngoài R_POLY_END
function polyWeight(x, z) { return 1 - smoothstep(R_POLY, R_POLY_END, Math.hypot(x, z)); }

const riverIdx = makeBucketIndex(RIVERS.map((r) => ({ pts: r.pts, meta: [r.w, r.sh || 28] })));
const regionIdx = makeBucketIndex(ROADS_REGION.map((r) => ({ pts: r.pts, meta: 0 })));
const dtRoadIdx = makeBucketIndex(ROADS_DT.map((r) => ({ pts: r.pts, meta: r.c })));

// hệ số đào lòng sông 0..1 theo POLYLINE (ngoài thành phố)
function riverFactorLine(x, z) {
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
// hệ số "trong/gần sông" 0..1 (world.js dùng làm rào chắn đặt nhà/prop): trong thành phố suy từ polygon
// (1 trong nước, giảm về 0 ở 28 m ngoài mép như bờ polyline), ngoài thành phố theo polyline như cũ.
export function riverFactor(x, z) {
  const wp = polyWeight(x, z);
  const fl = wp < 1 ? riverFactorLine(x, z) : 0;
  if (wp <= 0) return fl;
  const sd = waterSD(x, z);
  const fp = sd < 0 ? 1 : 1 - smoothstep(0, 28, sd);
  return wp >= 1 ? fp : lerp(fl, fp, wp);
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

function deckHeight(x, z, wet) {
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
  if (wet) {
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

// ---------- Cao độ ----------
// cao độ ĐẤT theo độ "đất" v (0 biển .. 1 đất): bờ biển thoải + gợn + đồi + san phẳng phố/Cát Bà/cảng
function baseHeight(x, z, v) {
  let h = lerp(SEA_FLOOR, LAND_H, smoothstep(0.32, 0.68, v));
  // gợn nhẹ đồng bằng
  h += 0.4 * Math.sin(x * 0.0021) * Math.sin(z * 0.0017) * smoothstep(0.6, 0.9, v);
  h += hills(x, z, v);
  // san phẳng trung tâm (hộp phố thật) + thị trấn Cát Bà + khu cảng
  h = lerp(h, LAND_H, rectFactor(x, DT_BOX.x1, DT_BOX.x2, z, DT_BOX.z1, DT_BOX.z2, 250) * smoothstep(0.35, 0.55, v));
  const CT = EXTRAS.catbaTown;
  h = lerp(h, LAND_H, rectFactor(x, CT[0] - 500, CT[0] + 500, z, CT[1] - 380, CT[1] + 380, 120) * smoothstep(0.35, 0.55, v));
  h = lerp(h, LAND_H, rectFactor(x, LM.port[0] - 600, LM.port[0] + 600, z, LM.port[1] - 300, LM.port[1] + 300, 90) * smoothstep(0.3, 0.5, v));
  return h;
}
// cờ nội bộ: lần gọi groundHeightNoDeck gần nhất rơi vào lòng nước polygon (groundHeight/deckHeight
// dùng ngay sau đó — tránh tính waterSD 2 lần)
let polyWet = false;
export function groundHeightNoDeck(x, z) {
  const wp = polyWeight(x, z);
  polyWet = false;
  let hLine = 0;
  if (wp < 1) {
    // NGOÀI thành phố: MASK bờ biển + đào lòng sông theo polyline (thắng san phẳng, đáy −3)
    hLine = baseHeight(x, z, landAt(x, z));
    const rf = riverFactorLine(x, z);
    if (rf > 0) hLine = lerp(hLine, -3, rf);
    if (wp <= 0) return hLine;
  }
  // TRONG thành phố: lòng sông/hồ theo polygon OSM thật (taluy kè 2 m: −3 → 1.7 ở mép),
  // ngoài mép là ĐẤT phố (v=1: bỏ MASK bờ biển thô 40 m — nó từng làm nước thò ra sau nhà)
  const sd = waterSD(x, z);
  polyWet = sd < 0;
  const hPoly = polyWet ? lerp(-3, 1.7, smoothstep(-2, 0, sd)) : baseHeight(x, z, 1);
  return wp >= 1 ? hPoly : lerp(hLine, hPoly, wp);
}

export function groundHeight(x, z) {
  const h = groundHeightNoDeck(x, z);
  const wet = h < 1.9 && (polyWet || riverFactorLine(x, z) > 0.03);
  const d = deckHeight(x, z, wet);
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
