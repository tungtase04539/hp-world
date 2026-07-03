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
RIVERS.push({ w: 110, pts: [[1400, 100], [1700, 380], [2000, 640], [2350, 900]] });
// Hồ Tam Bạc: trục + bề rộng lấy từ polygon nước OSM thật; bờ hẹp (sh=6)
// để không ngập trường THCS Trần Phú ngay mép nam hồ
RIVERS.push({ w: EXTRAS.lake.w, sh: 6, pts: EXTRAS.lake.pts });

const riverIdx = makeBucketIndex(RIVERS.map((r) => ({ pts: r.pts, meta: [r.w, r.sh || 16] })));
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
    if (Math.abs(across) < 7 && Math.abs(along) < b.half) {
      const tt = along / b.half;
      h = Math.max(h, LAND_H + b.rise * Math.max(0, 1 - tt * tt));
    }
  }
  for (const p of PIERS) {
    if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) h = Math.max(h, LAND_H);
  }
  // đường bộ băng sông = mặt cầu phẳng (mọi cây cầu phố thật: cầu Rào, Lạc Long, An Dương...)
  if (rf > 0.03) {
    if (nearDTRoad(x, z, 5) || nearRegionRoad(x, z, 6)) h = Math.max(h, LAND_H + 0.05);
  }
  return h;
}

// ---------- Đồi núi ----------
const DS_RIDGE = EXTRAS.dsRidge; // sống đồi Đồ Sơn (từ bãi biển OSM thật)
function hills(x, z, v) {
  let h = 0;
  const dDS = distToSeg(x, z, ...DS_RIDGE);
  h += 19 * (1 - smoothstep(25, 105, dDS)) * (0.72 + 0.28 * Math.sin(x * 0.05 + z * 0.03));
  // đồi Vụng — nơi đặt biệt thự Bảo Đại (node OSM thật)
  const dBD = Math.hypot(x - EXTRAS.baodai[0], z - EXTRAS.baodai[1]);
  h += 15 * (1 - smoothstep(16, 90, dBD));
  if (z < -600 && v > 0.6) { // đồi Thủy Nguyên
    h += 7 * smoothstep(-600, -1000, z) * (0.5 + 0.5 * Math.sin(x * 0.011) * Math.sin(z * 0.013)) * smoothstep(0.6, 0.9, v);
  }
  if (x > 3600 && v > 0.55) { // núi Cát Bà
    h += 13 * (0.45 + 0.55 * Math.sin(x * 0.016 + 1) * Math.sin(z * 0.019)) * smoothstep(0.55, 0.85, v);
  }
  return Math.max(0, h);
}

// ---------- Cao độ ----------
export function groundHeightNoDeck(x, z) {
  const v = landAt(x, z);
  let h = lerp(SEA_FLOOR, LAND_H, smoothstep(0.32, 0.68, v));
  // gợn nhẹ đồng bằng
  h += 0.4 * Math.sin(x * 0.021) * Math.sin(z * 0.017) * smoothstep(0.6, 0.9, v);
  h += hills(x, z, v);
  // san phẳng trung tâm (hộp phố thật) + thị trấn Cát Bà + khu cảng
  h = lerp(h, LAND_H, rectFactor(x, DT_BOX.x1, DT_BOX.x2, z, DT_BOX.z1, DT_BOX.z2, 60) * smoothstep(0.35, 0.55, v));
  const CT = EXTRAS.catbaTown;
  h = lerp(h, LAND_H, rectFactor(x, CT[0] - 95, CT[0] + 95, z, CT[1] - 70, CT[1] + 70, 24) * smoothstep(0.35, 0.55, v));
  h = lerp(h, LAND_H, rectFactor(x, LM.port[0] - 95, LM.port[0] + 95, z, LM.port[1] - 45, LM.port[1] + 45, 16) * smoothstep(0.3, 0.5, v));
  // đào lòng sông (thắng san phẳng)
  const rf = riverFactor(x, z);
  if (rf > 0) h = lerp(h, -3, rf);
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
export function findShore(ax, az, searchR = 260, step = 10) {
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
