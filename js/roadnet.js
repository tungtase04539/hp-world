// roadnet.js — MẠNG ĐƯỜNG THẬT (Đợt 3 WP6): đồ thị nút giao + dải lòng đường (ribbon) + đa giác nút giao có bó vỉa
// bo góc + vỉa hè/bó vỉa/mặt đứng theo js/xsection.js. THUẦN JS (không import three) → chạy được trong node để kiểm.
//
// Vì sao: bản cũ (world.js layRoad) đặt HỘP 30 m dọc từng đoạn ROADS_DT: 80% tam giác là mặt hộp vô hình, vỉa hè chạy
// XUYÊN ngã tư, không có góc bo, vạch kẻ là hộp MeshBasic, đèn tín hiệu chỉ ở 19 điểm INTERSECTIONS.
//
// DỮ LIỆU: ROADS_DT bị simplify 6 m (ngõ 5 m) TỪNG WAY RIÊNG → đỉnh chung của ngã ba thường MẤT khỏi phố đi thẳng
// (1.697/2.850 đầu mút "lơ lửng"). Bước 1 nối lại đồ thị:
//   (a) T-SNAP: đầu mút không chung với way nào mà cách đoạn của way khác ≤ 6,5 m → kéo đầu mút về hình chiếu trên
//       đoạn đó (CHÈN đỉnh vào phố đi thẳng, KHÔNG đổi hình phố đi thẳng — WP1 bám mặt tiền theo ROADS_DT);
//   (b) X-CROSS: 2 đoạn của 2 way cắt nhau ở giữa → chèn đỉnh giao vào cả hai (trừ chỗ có mặt cầu).
// Bước 2 phân loại từng NÚT theo nhánh: phố (p/s/t/r, có vỉa hè) vs ngõ (h/w, không vỉa hè):
//   • ≥2 nhánh phố: tập chính = các nhánh phố; nhánh ngõ = LỐI RẼ (cắt ngõ ở mép ngoài vỉa hè, vỉa hè phố chạy liền).
//   • tập chính 2 nhánh cùng bề rộng, gãy ≤ 50° → nối MITER (dải liền, vạch kẻ liền).
//   • còn lại → NÚT GIAO: mỗi cặp nhánh kề nhau (theo góc) có 1 GÓC: bo cung bán kính R (fillet, góc < 176°),
//     thẳng (≈180°) hoặc vòng quanh tâm (góc > 184°, phía ngoài khúc cua). Lùi đầu dải (setback) = max tiếp điểm.
//     Đa giác nút giao = nắp các nhánh + đường bó vỉa các góc; vỉa hè góc = dải giữa đường bó vỉa và góc lưng Q.
// Bước 3 phát hình học theo TỪNG Ô (tile T m) cho 2 mesh: 'roads_x,z' (nhựa/bê tông/lát + nút giao) và
// 'sidewalk_x,z' (mặt vỉa hè, mặt đứng bó vỉa, mép lưng, nắp). Thuộc tính đỉnh:
//   position, normal, uv (dải: u dọc m, v ngang m có dấu; vỉa hè: u dọc, d cách bó vỉa; mặt đứng: u, cao),
//   aSurf = (lớp texture, mã vạch kẻ, nửa lòng hw, d cách bó vỉa), aZeb = (u bắt đầu vùng zebra đầu, u đầu vùng zebra cuối).
// Vạch kẻ vẽ TRONG shader (roadtex.js) theo (u, v) → 0 tam giác thêm, không z-fight.
import { ROAD_HW, SIDEWALK_W, ROAD_TOP, SIDEWALK_TOP } from './xsection.js';

const STREET = { p: 1, s: 1, t: 1, r: 1 };
const RANK = { p: 5, s: 4, t: 3, r: 2, w: 1, h: 0 };
// bán kính bo bó vỉa góc phố (m) theo cấp THẤP hơn của 2 nhánh — phố HP: góc bo nhỏ 3-7 m
const CORNER_R = { p: 7, s: 6, t: 4.5, r: 3, w: 1.2, h: 1.2 };
// lớp trong DataArrayTexture (roadtex.js)
export const RL = { ASPHALT: 0, CONCRETE: 1, GACH_XAM: 2, CARO_DO_XAM: 3, TERRACOTTA: 4, CON_SAU: 5, CURB: 6, DECAL: 7, MACRO: 8 };
const SW_LAYER = { gach_xam: 2, caro_do_xam: 3, terracotta: 4, con_sau: 5 };
// mã vạch kẻ (bit) — shader roadtex.js giải mã
export const MK = {
  CDY: 1,        // tim vàng đứt (vạch 1.1 vàng — QCVN 41:2019 phân 2 chiều)
  CDBL: 2,       // tim vàng đôi liền
  EDGE: 4,       // vạch mép trắng liền cách bó vỉa 0,45 m
  LANES: 8,      // vạch phân làn trắng đứt ở ±hw/2
  CDW: 16,       // tim trắng đứt (đường cũ)
  STOP0: 32,     // vạch dừng ở ĐẦU dải (xe đi về đầu dải, nửa v<0)
  STOP1: 64,     // vạch dừng ở CUỐI dải (nửa v>0)
  WUV: 128,      // texture theo toạ độ THẾ GIỚI (đa giác nút giao, góc vỉa hè)
  GUTTER: 256,   // dải rãnh biên bê tông sát bó vỉa (p/s)
  FACE: 512,     // mặt đứng (bó vỉa, mép lưng, nắp)
  BACK: 1024,    // mặt đứng mép LƯNG vỉa hè (tối hơn)
  ZEB0: 2048,    // zebra ở đầu dải (u − aZeb.x ∈ [0,8; 3,8])
  ZEB1: 4096,    // zebra ở cuối dải
  PAINT: 2048,   // (vỉa hè/mặt đứng) bó vỉa sơn sọc ĐỎ-TRẮNG — trên cầu (pano_074 cầu qua sông Tam Bạc)
  // bit 13+: seed của đoạn chạy (nắp cống/vá đường không lặp giữa các phố)
};
// Đoạn đại lộ có dải phân cách OSM nhưng ẢNH THẬT cho thấy mặt đường liền + tim vàng (chép từ world.js MEDIAN_SKIP
// — pano_153/225/195, pano_155-160). Trong các vòng này vẫn vẽ tim đường dù gần MEDIANS.
const MEDIAN_SKIP = [[572, -451.2, 90], [667.9, -640.2, 90], [589.3, -204, 90], [176, -457, 90], [287, -455, 90], [414, -454, 90]];

const hwOf = (c) => ROAD_HW[c] ?? ROAD_HW.r;
const swOf = (c) => SIDEWALK_W[c] ?? 0;
const nR = (d) => [-d[1], d[0]];          // pháp tuyến "phải" của hướng d (x đông, z nam): bên phải người đi theo d
const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const D2R = Math.PI / 180;

// ---------- tam giác hoá đa giác đơn (ear clipping; đa giác nút giao ≤ ~60 đỉnh) ----------
function earClip(P) {
  const n = P.length; if (n < 3) return [];
  let A = 0; for (let i = 0, j = n - 1; i < n; j = i++) A += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  if (A < 0) idx.reverse();
  const cr = (a, b, c) => (P[b][0] - P[a][0]) * (P[c][1] - P[b][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[b][0]);
  const inTri = (p, a, b, c) => {
    const s1 = (P[b][0] - P[a][0]) * (p[1] - P[a][1]) - (P[b][1] - P[a][1]) * (p[0] - P[a][0]);
    const s2 = (P[c][0] - P[b][0]) * (p[1] - P[b][1]) - (P[c][1] - P[b][1]) * (p[0] - P[b][0]);
    const s3 = (P[a][0] - P[c][0]) * (p[1] - P[c][1]) - (P[a][1] - P[c][1]) * (p[0] - P[c][0]);
    return s1 > 1e-9 && s2 > 1e-9 && s3 > 1e-9;
  };
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 4 * n + 20) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cr(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const j of idx) { if (j === a || j === b || j === c) continue; if (inTri(P[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      out.push([a, b, c]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) {   // suy biến (thẳng hàng/tự cắt nhẹ): bỏ đỉnh "phẳng" nhất rồi thử tiếp
      let bi = 0, bv = Infinity;
      for (let i = 0; i < idx.length; i++) {
        const v = Math.abs(cr(idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]));
        if (v < bv) { bv = v; bi = i; }
      }
      idx.splice(bi, 1);
    }
  }
  if (idx.length === 3 && cr(idx[0], idx[1], idx[2]) > 1e-9) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
// dải tam giác giữa 2 chuỗi điểm cùng chiều (bó vỉa ↔ lưng vỉa hè): đi theo đường chéo ngắn hơn
function zipper(nA, nB, PA, PB) {
  const out = []; let i = 0, j = 0;
  const d = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  while (i < nA - 1 || j < nB - 1) {
    if (i === nA - 1) { out.push([0, i, 1, j, 1, j + 1]); j++; }
    else if (j === nB - 1) { out.push([0, i, 1, j, 0, i + 1]); i++; }
    else if (d(PA[i + 1], PB[j]) < d(PA[i], PB[j + 1])) { out.push([0, i, 1, j, 0, i + 1]); i++; }
    else { out.push([0, i, 1, j, 1, j + 1]); j++; }
  }
  return out;   // mỗi tam giác: [chuỗi, chỉ số] ×3 (chuỗi 0 = A, 1 = B)
}
function distToPolyline(p, L) {
  let best = Infinity;
  for (let i = 0; i < L.length - 1; i++) {
    const [ax, az] = L[i], [bx, bz] = L[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 ? ((p[0] - ax) * dx + (p[1] - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t));
  }
  return L.length === 1 ? Math.hypot(p[0] - L[0][0], p[1] - L[0][1]) : best;
}
function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {   // khoảng cách 2 đoạn (0 nếu cắt nhau)
  const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) return 0;
  return Math.min(segDist(ax, az, cx, cz, dx, dz), segDist(bx, bz, cx, cz, dx, dz), segDist(cx, cz, ax, az, bx, bz), segDist(dx, dz, ax, az, bx, bz));
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

// ---------- lưới băm đoạn ----------
function buildSegGrid(ways, cell) {
  const g = new Map();
  ways.forEach((w, wi) => {
    for (let i = 0; i < w.pts.length - 1; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (cell * 0.5)));
      let last = null;
      for (let s = 0; s <= n; s++) {
        const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n;
        const k = Math.floor(x / cell) * 100003 + Math.floor(z / cell);
        if (k === last) continue; last = k;
        let a = g.get(k); if (!a) g.set(k, a = []);
        if (!a.length || a[a.length - 1][0] !== wi || a[a.length - 1][1] !== i) a.push([wi, i]);
      }
    }
  });
  return {
    near(x, z, cb) {     // gọi cb(wi, i) cho đoạn trong 3×3 ô quanh (x,z) — có thể trùng, cb tự lọc
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = g.get((ix + a) * 100003 + iz + b); if (l) for (const [wi, i] of l) cb(wi, i);
      }
    },
    cells: g,
  };
}
function applyInsertions(ways, ins) {
  const byW = new Map();
  for (const e of ins) { let l = byW.get(e.wi); if (!l) byW.set(e.wi, l = []); l.push(e); }
  for (const [wi, list] of byW) {
    const w = ways[wi], out = [];
    list.sort((a, b) => a.i - b.i || a.t - b.t);
    let li = 0;
    for (let i = 0; i < w.pts.length; i++) {
      out.push(w.pts[i]);
      while (li < list.length && list[li].i === i) { out.push([list[li].x, list[li].z]); li++; }
    }
    w.pts = dedupe(out);
  }
}
function dedupe(pts) {
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (l && Math.abs(l[0] - p[0]) < 0.05 && Math.abs(l[1] - p[1]) < 0.05) continue; out.push(p); }
  return out;
}

// ======================================================================================================
// buildRoadNet(ROADS_DT, deps) → { tiles: Map('tx,tz' → {roads, sidewalk}), junctions, signals, stats }
// deps: { groundHeightNoDeck, groundHeight, isWater, swTypeOf(ri), LAND_H, R (bán kính dựng), T (cạnh ô),
//         MEDIANS, MARKS (ROAD_MARK_EVIDENCE) }
// ======================================================================================================
export function buildRoadNet(ROADS_DT, deps) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const { groundHeightNoDeck: ghN, isWater } = deps;
  const LAND_H = deps.LAND_H ?? 2, R = deps.R ?? 1600, T = deps.T ?? 450;
  const MEDIANS = deps.MEDIANS || [], MARKS = deps.MARKS || [];
  const gh = (x, z) => Math.max(ghN(x, z), LAND_H);
  const stats = { tsnap: 0, tsnapIns: 0, xcross: 0, nodes: 0, junctions: 0, miters: 0, driveways: 0, deadEnds: 0, signals: 0, zebraArms: 0, runs: 0, waterGaps: 0, chordCorners: 0 };

  // ---------- 0) way ----------
  const ways = [];
  ROADS_DT.forEach((r, ri) => { const pts = dedupe(r.pts.map(([x, z]) => [x, z])); if (pts.length >= 2) ways.push({ ri, c: r.c, pts }); });
  const vkey = (x, z) => Math.round(x * 20) + ',' + Math.round(z * 20);
  // mặt cầu VÒM có mô hình riêng (terrain BRIDGES: HVT, Bính…) — dải đường dưới vòm bị cắt (kiểm giải tích, không gọi địa hình)
  const ARCH = (deps.bridges || []).filter((b) => b.rise > 3);
  const onArch = (x, z) => {
    for (const b of ARCH) {
      const dx = x - b.x, dz = z - b.zc, al = dx * b.sin + dz * b.cos, ac = dx * b.cos - dz * b.sin;
      if (Math.abs(ac) < 10 && Math.abs(al) < b.half) return true;
    }
    return false;
  };

  // ---------- 1a) T-snap đầu mút lơ lửng ----------
  {
    const use = new Map();
    ways.forEach((w) => w.pts.forEach(([x, z]) => { const k = vkey(x, z); use.set(k, (use.get(k) || 0) + 1); }));
    const grid = buildSegGrid(ways, 16);
    const ins = [], insBySeg = new Map();
    const SNAP = 6.5;
    ways.forEach((w, wi) => {
      for (const k of [0, w.pts.length - 1]) {
        const E = w.pts[k];
        if (use.get(vkey(E[0], E[1])) > 1) continue;
        let bs = Infinity, bw = -1, bi = -1, bt = 0;
        grid.near(E[0], E[1], (wj, j) => {
          if (wj === wi) return;
          const [ax, az] = ways[wj].pts[j], [bx, bz] = ways[wj].pts[j + 1];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; if (l2 < 1e-6) return;
          let t = ((E[0] - ax) * dx + (E[1] - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(E[0] - ax - dx * t, E[1] - az - dz * t);
          if (d > SNAP) return;
          // điểm = khoảng cách − 0,3·cấp: đầu ngõ chạm cả ngõ khác lẫn phố gần như nhau → ưu tiên phố cấp cao
          const sc = d - 0.3 * RANK[ways[wj].c];
          if (sc < bs) { bs = sc; bw = wj; bi = j; bt = t; }
        });
        if (bw < 0) continue;
        const ow = ways[bw], [ax, az] = ow.pts[bi], [bx, bz] = ow.pts[bi + 1], L = Math.hypot(bx - ax, bz - az);
        let P;
        if (bt * L < 2.5) P = [ax, az];
        else if ((1 - bt) * L < 2.5) P = [bx, bz];
        else {
          const sk = bw + ':' + bi; let l = insBySeg.get(sk); if (!l) insBySeg.set(sk, l = []);
          const hit = l.find((e) => Math.abs(e.t - bt) * L < 2.0);
          if (hit) P = [hit.x, hit.z];
          else { P = [ax + (bx - ax) * bt, az + (bz - az) * bt]; const e = { wi: bw, i: bi, t: bt, x: P[0], z: P[1] }; l.push(e); ins.push(e); stats.tsnapIns++; }
        }
        w.pts[k] = [P[0], P[1]];
        const kk = vkey(P[0], P[1]); use.set(kk, (use.get(kk) || 0) + 1);
        stats.tsnap++;
      }
    });
    applyInsertions(ways, ins);
    for (const w of ways) w.pts = dedupe(w.pts);
  }
  // ---------- 1b) giao cắt chéo không có đỉnh chung ----------
  {
    const grid = buildSegGrid(ways, 24);
    const segBase = []; { let acc = 0; for (const w of ways) { segBase.push(acc); acc += w.pts.length; } }
    const seen = new Set(), ins = [], insBySeg = new Map();
    const addIns = (wi, i, t, x, z) => {
      const sk = wi + ':' + i; let l = insBySeg.get(sk); if (!l) insBySeg.set(sk, l = []);
      if (l.some((e) => Math.hypot(e.x - x, e.z - z) < 1.0)) return;
      const e = { wi, i, t, x, z }; l.push(e); ins.push(e);
    };
    for (const list of grid.cells.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const [wa, ia] = list[a], [wb, ib] = list[b];
        if (wa === wb) continue;
        const ga = segBase[wa] + ia, gb = segBase[wb] + ib, key = ga < gb ? ga * 1048576 + gb : gb * 1048576 + ga;
        if (seen.has(key)) continue; seen.add(key);
        const [p1x, p1z] = ways[wa].pts[ia], [p2x, p2z] = ways[wa].pts[ia + 1];
        const [q1x, q1z] = ways[wb].pts[ib], [q2x, q2z] = ways[wb].pts[ib + 1];
        const rx = p2x - p1x, rz = p2z - p1z, sx = q2x - q1x, sz = q2z - q1z;
        const den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
        const t = ((q1x - p1x) * sz - (q1z - p1z) * sx) / den, u = ((q1x - p1x) * rz - (q1z - p1z) * rx) / den;
        if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
        const x = p1x + rx * t, z = p1z + rz * t;
        const La = Math.hypot(rx, rz), Lb = Math.hypot(sx, sz);
        if (t * La < 1 || (1 - t) * La < 1 || u * Lb < 1 || (1 - u) * Lb < 1) continue;   // sát đỉnh sẵn có
        if (onArch(x, z)) continue;      // mặt cầu vượt → không phải nút
        addIns(wa, ia, t, x, z); addIns(wb, ib, u, x, z); stats.xcross++;
      }
    }
    applyInsertions(ways, ins);
  }

  const _now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  stats.tGraph = Math.round(_now() - t0);
  // ---------- 2) nút + nhánh ----------
  const nodes = new Map();
  const nodeAt = (x, z) => { const k = vkey(x, z); let n = nodes.get(k); if (!n) nodes.set(k, n = { x, z, arms: [] }); return n; };
  ways.forEach((w, wi) => {
    const n = w.pts.length;
    w.armF = new Array(n); w.armB = new Array(n); w.node = new Array(n);
    for (let k = 0; k < n; k++) w.node[k] = nodeAt(w.pts[k][0], w.pts[k][1]);
    const hw = hwOf(w.c), sw = swOf(w.c);
    const swType = deps.swTypeOf ? deps.swTypeOf(w.ri) : 'gach_xam';
    for (let k = 0; k < n; k++) {
      for (const dir of [1, -1]) {
        const j = k + dir; if (j < 0 || j >= n) continue;
        const dx = w.pts[j][0] - w.pts[k][0], dz = w.pts[j][1] - w.pts[k][1], L = Math.hypot(dx, dz);
        const arm = { wi, k, dir, c: w.c, hw, sw, swType, d: [dx / L, dz / L], ang: Math.atan2(dz, dx), len: L, node: w.node[k], spec: null };
        if (dir > 0) w.armF[k] = arm; else w.armB[k] = arm;
        w.node[k].arms.push(arm);
      }
    }
  });
  stats.nodes = nodes.size;
  // chiều dài "đoạn chạy" của nhánh tới nút kế tiếp có bậc ≠ 2 (để kẹp setback ≤ 45%)
  for (const w of ways) {
    for (let k = 0; k < w.pts.length; k++) for (const dir of [1, -1]) {
      const arm = dir > 0 ? w.armF[k] : w.armB[k]; if (!arm) continue;
      let L = 0, j = k;
      while (true) {
        const j2 = j + dir; if (j2 < 0 || j2 >= w.pts.length) break;
        L += Math.hypot(w.pts[j2][0] - w.pts[j][0], w.pts[j2][1] - w.pts[j][1]); j = j2;
        if (w.node[j].arms.length !== 2) break;
      }
      arm.runLen = L;
    }
  }

  // ---------- 3) xử lý nút: phân loại → gom CỤM nút giao gần nhau → hình học góc ----------
  const MARK_GRID = new Map();
  for (const m of MARKS) { const k = Math.floor(m[0] / 50) + ',' + Math.floor(m[1] / 50); let l = MARK_GRID.get(k); if (!l) MARK_GRID.set(k, l = []); l.push(m); }
  const marksNear = (x, z, r) => {
    const out = [], ix = Math.floor(x / 50), iz = Math.floor(z / 50);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = MARK_GRID.get((ix + a) + ',' + (iz + b)); if (!l) continue;
      for (const m of l) if ((m[0] - x) ** 2 + (m[1] - z) ** 2 < r * r) out.push(m);
    }
    return out;
  };
  const swSpec = (e, cut, cap) => ({ e, cut, cap });
  // điểm trên đường mép: gốc O (nút của nhánh) + pháp tuyến·off + hướng·t
  const lineAt = (O, nx, nz, off, d, t) => [O[0] + nx * off + d[0] * t, O[1] + nz * off + d[1] * t];
  function intersect(OA, nA, offA, dA, OB, nB, offB, dB) {   // OA + nA·offA + t·dA = OB + nB·offB + s·dB
    const rx = OB[0] + nB[0] * offB - OA[0] - nA[0] * offA, rz = OB[1] + nB[1] * offB - OA[1] - nA[1] * offA;
    const det = dA[0] * (-dB[1]) - dA[1] * (-dB[0]);
    if (Math.abs(det) < 1e-6) return null;
    return [(rx * (-dB[1]) - rz * (-dB[0])) / det, (dA[0] * rz - dA[1] * rx) / det];
  }
  // GÓC giữa nhánh a (phía +nR) và nhánh b kế tiếp theo chiều tăng góc (phía −nR của b)
  function makeCorner(a, b, Rforce) {
    const nA = nR(a.d), nB = nR(b.d), mB = [-nB[0], -nB[1]];
    let gap = Math.atan2(a.d[0] * b.d[1] - a.d[1] * b.d[0], a.d[0] * b.d[0] + a.d[1] * b.d[1]);
    if (gap <= 0) gap += 2 * Math.PI;
    const deg = gap / D2R, same = Math.hypot(a.O[0] - b.O[0], a.O[1] - b.O[1]) < 0.3;
    const C = { a, b, gap, type: 'fillet', tuA: 0, tuB: 0, curb: null, back: null, hasSW: a.sw > 0 && b.sw > 0 };
    if (deg < 8 || deg > 352) { C.type = 'chord'; return C; }    // 2 nhánh song song (đầu dải phân cách) — nối dây cung sau khi có setback
    if (deg >= 184) {
      if (!same) {   // phía ngoài của cụm 2 nút: nối thẳng mép 2 nhánh tại gốc mỗi nhánh
        C.type = 'straight';
        C.curb = [lineAt(a.O, nA[0], nA[1], a.hw, a.d, 0), lineAt(b.O, mB[0], mB[1], b.hw, b.d, 0)];
        C.back = [lineAt(a.O, nA[0], nA[1], a.hw + a.sw, a.d, 0), lineAt(b.O, mB[0], mB[1], b.hw + b.sw, b.d, 0)];
        return C;
      }
      C.type = 'round';   // phía ngoài khúc cua / chữ Y: bo vòng quanh tâm nút
      let a0 = Math.atan2(nA[1], nA[0]), a1 = Math.atan2(mB[1], mB[0]);
      while (a1 < a0) a1 += Math.PI * 2;
      const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 10)));
      C.curb = []; C.back = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, an = a0 + (a1 - a0) * t, r = a.hw + (b.hw - a.hw) * t, rb = r + a.sw + (b.sw - a.sw) * t;
        C.curb.push([a.O[0] + Math.cos(an) * r, a.O[1] + Math.sin(an) * r]);
        C.back.push([a.O[0] + Math.cos(an) * rb, a.O[1] + Math.sin(an) * rb]);
      }
      return C;
    }
    if (deg > 176) {    // gần thẳng (phía đối diện ngã ba)
      C.type = 'straight';
      C.curb = [lineAt(a.O, nA[0], nA[1], a.hw, a.d, 0), lineAt(b.O, mB[0], mB[1], b.hw, b.d, 0)];
      C.back = [lineAt(a.O, nA[0], nA[1], a.hw + a.sw, a.d, 0), lineAt(b.O, mB[0], mB[1], b.hw + b.sw, b.d, 0)];
      if (same && Math.abs(a.hw - b.hw) < 0.01 && Math.abs(a.sw - b.sw) < 0.01) C.miter = norm(nA[0] - nB[0], nA[1] - nB[1]);
      return C;
    }
    const ts = intersect(a.O, nA, a.hw, a.d, b.O, mB, b.hw, b.d);
    if (!ts) { C.type = 'chord'; return C; }
    const [t0, s0] = ts, half = gap / 2;
    let Rr = Rforce ?? Math.min(CORNER_R[a.c] ?? 3, CORNER_R[b.c] ?? 3);
    if (Rforce === undefined && C.hasSW) Rr = Math.min(Rr, 0.85 * Math.min(a.sw, b.sw) / Math.max(1e-3, 1 - Math.sin(half)));
    Rr = Math.max(Rr, 0);
    const tau = Rr / Math.tan(half);
    C.t0 = t0; C.s0 = s0; C.R = Rr;
    C.tuA = t0 + tau; C.tuB = s0 + tau;
    const TA = lineAt(a.O, nA[0], nA[1], a.hw, a.d, C.tuA), TB = lineAt(b.O, mB[0], mB[1], b.hw, b.d, C.tuB);
    C.curb = [TA];
    if (Rr > 0.05) {
      const P = lineAt(a.O, nA[0], nA[1], a.hw, a.d, t0), bis = norm(a.d[0] + b.d[0], a.d[1] + b.d[1]);
      const cx = P[0] + bis[0] * Rr / Math.sin(half), cz = P[1] + bis[1] * Rr / Math.sin(half);
      const aA = Math.atan2(TA[1] - cz, TA[0] - cx);
      let sweep = Math.atan2(TB[1] - cz, TB[0] - cx) - aA;
      while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 14)));
      for (let i = 1; i < n; i++) { const an = aA + sweep * i / n; C.curb.push([cx + Math.cos(an) * Rr, cz + Math.sin(an) * Rr]); }
    }
    C.curb.push(TB);
    if (C.hasSW) {
      const q = intersect(a.O, nA, a.hw + a.sw, a.d, b.O, mB, b.hw + b.sw, b.d);
      if (q) { C.tq = q[0]; C.sq = q[1]; C.Q = lineAt(a.O, nA[0], nA[1], a.hw + a.sw, a.d, q[0]); }
    }
    return C;
  }

  // 3a) phân loại từng nút
  const juncNodes = [];
  for (const N of nodes.values()) {
    const arms = N.arms.slice().sort((p, q) => p.ang - q.ang);
    N.h = gh(N.x, N.z);
    for (const a of arms) a.O = [N.x, N.z];
    const streets = arms.filter((a) => STREET[a.c]);
    N.major = streets.length >= 2 ? streets : arms;
    N.minor = streets.length >= 2 ? arms.filter((a) => !STREET[a.c]) : [];
    const M = N.major;
    if (M.length === 1) {
      M[0].spec = { trim: 0, cut: null, capA: true, sw: [swSpec(0, null, true), swSpec(0, null, true)] };
      N.kind = 'dead'; stats.deadEnds++;
    } else if (M.length === 2 && M[0].hw === M[1].hw && M[0].sw === M[1].sw &&
               M[0].d[0] * M[1].d[0] + M[0].d[1] * M[1].d[1] <= -Math.cos(50 * D2R)) {
      const [a, b] = M, na = nR(a.d), nb = nR(b.d), m = norm(na[0] - nb[0], na[1] - nb[1]);
      a.spec = { trim: 0, cut: m, sw: [swSpec(0, m, false), swSpec(0, m, false)] };
      b.spec = { trim: 0, cut: m, sw: [swSpec(0, m, false), swSpec(0, m, false)] };
      if (a.wi === b.wi && a.k === b.k) a.cont = b.cont = true;
      N.kind = 'miter'; stats.miters++;
    } else { N.kind = 'junc'; juncNodes.push(N); }
  }
  // 3b) gom cụm: 2 nút giao nối TRỰC TIẾP bằng 1 đoạn phố ngắn (≤ hw1+hw2+3, ≤ 14 m) → 1 nút giao (ngã ba lệch,
  // đường đôi cắt phố ngang...). Cụm giới hạn đường kính 26 m. Đoạn nối thành "trong cụm" (không dựng dải riêng).
  const farNode = (a) => ways[a.wi].node[a.k + a.dir];
  const backArm = (a) => (a.dir > 0 ? ways[a.wi].armB[a.k + 1] : ways[a.wi].armF[a.k - 1]);
  for (const N of juncNodes) N.cl = { nodes: [N] };
  const maxHw = (N) => Math.max(...N.major.map((a) => a.hw));
  for (const N of juncNodes) {
    for (const a of N.major) {
      const F = farNode(a), b = backArm(a);
      if (!F || F.kind !== 'junc' || F.cl === N.cl || !b || !F.major.includes(b)) continue;
      if (a.len > Math.min(14, maxHw(N) + maxHw(F) + 3)) continue;
      const all = N.cl.nodes.concat(F.cl.nodes);
      let diam = 0; for (const p of all) for (const q of all) diam = Math.max(diam, Math.hypot(p.x - q.x, p.z - q.z));
      if (diam > 26) continue;
      const cl = { nodes: all }; for (const p of all) p.cl = cl;
    }
  }
  const clusters = [...new Set(juncNodes.map((N) => N.cl))];
  for (const cl of clusters) {
    const set = new Set(cl.nodes);
    const arms = [];
    for (const N of cl.nodes) for (const a of N.major) {
      const F = farNode(a);
      if (set.has(F) && F !== N && a.len <= 14.01) { a.internal = true; continue; }
      arms.push(a);
    }
    cl.arms = arms;
    if (cl.nodes.length > 1) stats.clusterNodes = (stats.clusterNodes || 0) + cl.nodes.length;
  }
  // 3c) hình học nút giao (cụm)
  const junctions = [];
  for (const cl of clusters) junction(cl);
  // 3d) lối rẽ ngõ (sau khi biết nhánh chính)
  for (const N of nodes.values()) {
    for (const a of N.minor || []) {
      // LỐI RẼ: ngõ cắt ở mép NGOÀI vỉa hè phố (vỉa hè phố chạy liền qua miệng ngõ như thật)
      let trim = 0;
      for (const s of N.major) {
        const cos = a.d[0] * s.d[0] + a.d[1] * s.d[1];
        if (cos < -0.2) continue;
        const sin = Math.abs(a.d[0] * s.d[1] - a.d[1] * s.d[0]);
        trim = Math.max(trim, (s.hw + s.sw + a.hw * Math.abs(cos)) / Math.max(sin, 0.2));
      }
      a.spec = { trim: trim + 0.02, cut: null, capA: true, drive: true };
      stats.driveways++;
    }
  }

  function junction(cl) {
    let cx = 0, cz = 0; for (const N of cl.nodes) { cx += N.x; cz += N.z; } cx /= cl.nodes.length; cz /= cl.nodes.length;
    const arms = cl.arms.slice();
    for (const a of arms) a.pang = Math.atan2(a.O[1] + a.d[1] * 12 - cz, a.O[0] + a.d[0] * 12 - cx);
    arms.sort((p, q) => p.pang - q.pang);
    const k = arms.length;
    const J = { x: cx, z: cz, h: Math.min(...cl.nodes.map((N) => N.h)), arms, corners: [], nodes: cl.nodes, rad: 0 };
    if (k < 2) {   // cụm khép kín (vòng xuyến nhỏ) — chỉ phủ đa giác các nút
      for (const a of arms) a.spec = { trim: 0, cut: null, capA: true, sw: [swSpec(0, null, true), swSpec(0, null, true)] };
      J.degenerate = true; junctions.push(J); return;
    }
    const corners = J.corners;
    for (let i = 0; i < k; i++) corners.push(makeCorner(arms[i], arms[(i + 1) % k]));
    for (let i = 0; i < k; i++) {
      const a = arms[i], cR = corners[i], cL = corners[(i + k - 1) % k];
      a.sMax = Math.min(0.45 * a.runLen, 40);
      a.s = Math.min(Math.max(0, cR.tuA, cL.tuB), a.sMax);
    }
    for (let i = 0; i < k; i++) {
      let C = corners[i]; const a = C.a, b = C.b;
      if (C.type === 'fillet' && (C.tuA > a.s + 1e-3 || C.tuB > b.s + 1e-3)) {
        const tauMax = Math.min(a.s - C.t0, b.s - C.s0);
        if (tauMax > 0.05) { C = corners[i] = makeCorner(a, b, tauMax * Math.tan(C.gap / 2)); }
        else { C.type = 'chord'; stats.chordCorners++; }
      }
      if (C.type === 'chord') {
        const nA = nR(a.d), nB = nR(b.d);
        C.tuA = a.s; C.tuB = b.s;
        C.curb = [lineAt(a.O, nA[0], nA[1], a.hw, a.d, a.s), lineAt(b.O, -nB[0], -nB[1], b.hw, b.d, b.s)];
      }
    }
    for (let i = 0; i < k; i++) arms[i].spec = { trim: arms[i].s, cut: null, sw: [null, null], junc: true };
    for (let i = 0; i < k; i++) {
      const C = corners[i], a = C.a, b = C.b;
      if (a.sw > 0 && b.sw > 0 && C.type !== 'chord') {
        if (C.type === 'straight' && C.miter) {
          a.spec.sw[1] = swSpec(0, C.miter, false); b.spec.sw[0] = swSpec(0, C.miter, false);
        } else if (C.type === 'fillet') {
          let eA = Math.max(0, C.tuA, C.tq ?? C.tuA), eB = Math.max(0, C.tuB, C.sq ?? C.tuB);
          const okQ = C.Q && eA <= a.sMax + 2 && eB <= b.sMax + 2;
          if (!okQ) { eA = Math.max(0, Math.min(Math.max(C.tuA, eA), a.sMax)); eB = Math.max(0, Math.min(Math.max(C.tuB, eB), b.sMax)); }
          a.spec.sw[1] = swSpec(eA, null, false); b.spec.sw[0] = swSpec(eB, null, false);
          C.eA = eA; C.eB = eB; C.useQ = okQ; C.piece = true;
        } else {   // straight khác bề rộng / round / phía ngoài cụm
          a.spec.sw[1] = swSpec(0, null, false); b.spec.sw[0] = swSpec(0, null, false);
          C.piece = !!C.back;
        }
      } else {
        // 1 trong 2 nhánh không vỉa hè (ngõ) hoặc dây cung: dải vỉa hè dừng ở tiếp điểm + nắp; mép nhựa có gờ
        if (a.sw > 0) a.spec.sw[1] = swSpec(Math.max(0, Math.min(C.type === 'fillet' || C.type === 'chord' ? C.tuA : 0, a.sMax)), null, true);
        if (b.sw > 0) b.spec.sw[0] = swSpec(Math.max(0, Math.min(C.type === 'fillet' || C.type === 'chord' ? C.tuB : 0, b.sMax)), null, true);
        C.skirt = true;
      }
    }
    // zebra / đèn tín hiệu: theo số nhánh phố cấp p/s/t + bằng chứng pano (≤ 45 m)
    const st = arms.filter((a) => STREET[a.c]);
    const nPS = st.filter((a) => a.c === 'p' || a.c === 's').length, nPST = nPS + st.filter((a) => a.c === 't').length;
    let evZ = false, evS = false;
    for (const m of marksNear(cx, cz, 45)) { if (m[2] & 8) evZ = true; if (m[2] & 16) evS = true; }
    const inside = Math.hypot(cx, cz) < R;
    J.signal = inside && st.length >= 3 && (nPS >= 2 || (evS && nPST >= 2));
    J.zebra = inside && st.length >= 3 && (nPST >= 2 || evZ);
    J.evS = evS;
    for (const a of arms) J.rad = Math.max(J.rad, Math.hypot(a.O[0] - cx, a.O[1] - cz) + Math.max(a.s + a.sw + 1, a.hw + a.sw));
    junctions.push(J);
    stats.junctions++;
  }
  // đèn tín hiệu: nút "lớn" cách nhau ≥ 45 m (cụm sát nhau chỉ giữ nút nhiều nhánh/cấp cao hơn; pano có đèn ưu tiên)
  {
    const sig = junctions.filter((J) => J.signal);
    const score = (J) => (J.evS ? 100 : 0) + J.arms.reduce((s, a) => s + RANK[a.c], 0);
    sig.sort((p, q) => score(q) - score(p));
    const kept = [];
    for (const J of sig) {
      if (kept.some((K) => Math.hypot(K.x - J.x, K.z - J.z) < 45)) { J.signal = false; continue; }
      kept.push(J);
    }
    stats.signals = kept.length;
  }
  for (const J of junctions) {
    for (const a of J.arms) {
      if (!a.spec || !STREET[a.c] || (a.c === 'r' && !J.signal)) continue;
      if (J.zebra) { a.spec.zebra = true; stats.zebraArms++; }
      if (J.signal) a.spec.stop = true;
    }
  }

  stats.tNodes = Math.round(_now() - t0);
  // ---------- 4) phát hình học ----------
  const tiles = new Map();
  const bufOf = (x, z, kind) => {
    const k = Math.floor(x / T) + ',' + Math.floor(z / T);
    let t = tiles.get(k); if (!t) tiles.set(k, t = { roads: newBuf(), sidewalk: newBuf() });
    return t[kind];
  };
  // bộ đệm typed array tự giãn (tránh mảng JS + GC khi phát ~200k đỉnh)
  function newBuf() { return { p: new Float32Array(3072), n: new Float32Array(3072), uv: new Float32Array(2048), s: new Float32Array(4096), z: new Float32Array(2048), idx: new Uint32Array(3072), vc: 0, ic: 0 }; }
  const grow = (a, need) => { if (need <= a.length) return a; let L = a.length * 2; while (L < need) L *= 2; const b = new a.constructor(L); b.set(a); return b; };
  const inRange = (x, z) => x * x + z * z < (R + T * 0.5) ** 2;
  // thêm 1 đa giác (đỉnh [x,y,z,u,v,d]) + tam giác (chỉ số cục bộ), pháp tuyến want (đảo thứ tự nếu ngược)
  function emit(kind, V, tris, nrm, surf, zeb) {
    let cx = 0, cz = 0; for (const v of V) { cx += v[0]; cz += v[2]; } cx /= V.length; cz /= V.length;
    if (!inRange(cx, cz)) return;
    const B = bufOf(cx, cz, kind), base = B.vc, nv = base + V.length;
    B.p = grow(B.p, nv * 3); B.n = grow(B.n, nv * 3); B.uv = grow(B.uv, nv * 2); B.s = grow(B.s, nv * 4); B.z = grow(B.z, nv * 2);
    B.idx = grow(B.idx, B.ic + tris.length * 3);
    const z0 = zeb ? zeb[0] : -1e4, z1 = zeb ? zeb[1] : 1e4;
    for (let i = 0; i < V.length; i++) {
      const v = V[i], j = base + i;
      B.p[j * 3] = v[0]; B.p[j * 3 + 1] = v[1]; B.p[j * 3 + 2] = v[2];
      B.n[j * 3] = nrm[0]; B.n[j * 3 + 1] = nrm[1]; B.n[j * 3 + 2] = nrm[2];
      B.uv[j * 2] = v[3]; B.uv[j * 2 + 1] = v[4];
      B.s[j * 4] = surf[0]; B.s[j * 4 + 1] = surf[1]; B.s[j * 4 + 2] = surf[2]; B.s[j * 4 + 3] = v[5] ?? 99;
      B.z[j * 2] = z0; B.z[j * 2 + 1] = z1;
    }
    B.vc = nv;
    for (const [a, b, c] of tris) {
      const A = V[a], Bv = V[b], C = V[c];
      const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const flip = nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0;
      B.idx[B.ic++] = base + a; B.idx[B.ic++] = base + (flip ? c : b); B.idx[B.ic++] = base + (flip ? b : c);
    }
  }
  const quadTris = [[0, 1, 2], [0, 2, 3]];
  // mặt đứng giữa 2 điểm mặt bằng p1→p2 từ yTop xuống yBot, pháp tuyến ngang về phía (fx,fz)
  function face(kind, p1, p2, yT1, yB1, yT2, yB2, fx, fz, u1, u2, surf) {
    const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
    let nx = -dz, nz = dx; const l = Math.hypot(nx, nz); if (l < 1e-4) return; nx /= l; nz /= l;
    if (nx * fx + nz * fz < 0) { nx = -nx; nz = -nz; }
    emit(kind, [[p1[0], yT1, p1[1], u1, yT1 - yB1], [p2[0], yT2, p2[1], u2, yT2 - yB2], [p2[0], yB2, p2[1], u2, 0], [p1[0], yB1, p1[1], u1, 0]],
      quadTris, [nx, 0, nz], surf, null);
  }

  // mặt cắt dọc 1 đoạn chạy P (đa tuyến) trong [uA, uB] với nhát cắt đầu/cuối (null = vuông góc, [mx,mz] = miter)
  function sections(P, cum, uA, uB, cutA, cutB) {
    const out = [];
    const segAt = (u) => { let j = 0; while (j < P.length - 2 && cum[j + 1] < u) j++; return j; };
    const nrmOf = (j) => { const dx = P[j + 1][0] - P[j][0], dz = P[j + 1][1] - P[j][1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l, dx / l, dz / l]; };
    const push = (u, j, m) => {
      const t = Math.min(1, Math.max(0, (u - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])));
      const x = P[j][0] + (P[j + 1][0] - P[j][0]) * t, z = P[j][1] + (P[j + 1][1] - P[j][1]) * t;
      const nn = nrmOf(j);
      let mx = nn[0], mz = nn[1], k = 1;
      if (m) { const dot = m[0] * nn[0] + m[1] * nn[1]; if (Math.abs(dot) > 0.3) { mx = m[0]; mz = m[1]; k = 1 / dot; } }
      out.push({ x, z, mx, mz, k, u, dx: nn[2], dz: nn[3], h: gh(x, z) });
    };
    push(uA, segAt(uA), uA < 0.01 ? cutA : null);
    for (let j = 1; j < P.length - 1; j++) {
      if (cum[j] <= uA + 0.01 || cum[j] >= uB - 0.01) continue;
      const a = nrmOf(j - 1), b = nrmOf(j);
      const m = norm(a[0] + b[0], a[1] + b[1]), dot = m[0] * b[0] + m[1] * b[1];
      out.push({ x: P[j][0], z: P[j][1], mx: m[0], mz: m[1], k: 1 / Math.max(dot, 0.5), u: cum[j], dx: (a[2] + b[2]) / 2, dz: (a[3] + b[3]) / 2, h: gh(P[j][0], P[j][1]) });
    }
    push(uB, segAt(uB), uB > cum[cum.length - 1] - 0.01 ? cutB : null);
    // chia nhỏ: ô ≤ 48 m (cull theo ô) + bám địa hình (lệch > 3 cm so với nội suy → chia 8 m)
    const res = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const A = out[i - 1], Bs = out[i], L = Bs.u - A.u;
      let n = Math.max(1, Math.ceil(L / 48));
      const hm = gh((A.x + Bs.x) / 2, (A.z + Bs.z) / 2);
      if (Math.abs(hm - (A.h + Bs.h) / 2) > 0.03) n = Math.max(n, Math.ceil(L / 8));
      for (let s = 1; s < n; s++) {
        const u = A.u + L * s / n, j = segAt(u);
        const t = Math.min(1, Math.max(0, (u - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j])));
        const x = P[j][0] + (P[j + 1][0] - P[j][0]) * t, z = P[j][1] + (P[j + 1][1] - P[j][1]) * t, nn = nrmOf(j);
        res.push({ x, z, mx: nn[0], mz: nn[1], k: 1, u, dx: nn[2], dz: nn[3], h: gh(x, z) });
      }
      res.push(Bs);
    }
    return res;
  }
  const off = (S, v) => [S.x + S.mx * v * S.k, S.z + S.mz * v * S.k];
  const nearMedian = (x, z) => {
    if (MEDIAN_SKIP.some(([qx, qz, qr]) => (x - qx) ** 2 + (z - qz) ** 2 < qr * qr)) return false;
    for (const L of MEDIANS) for (let i = 0; i < L.length - 1; i++) if (segDist(x, z, L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]) < 9) return true;
    return false;
  };
  // LÒNG ĐƯỜNG KHÁC: vỉa hè không được mọc trong lòng/vỉa hè của phố khác (đường đôi, 2 phố song song sát nhau)
  const lumen = buildSegGrid(ways.map((w) => (STREET[w.c] ? w : { pts: [] })), 16);
  ways.forEach((w, wi) => { w.wi0 = wi; });
  const segBase2 = []; { let acc = 0; for (const w of ways) { segBase2.push(acc); acc += w.pts.length; } }
  const seenStamp = new Int32Array(ways.reduce((s2, w) => s2 + w.pts.length, 0) + 1); let stamp = 0;
  // ứng viên "phố khác" quanh 1 đoạn chạy: đoạn phố của way khác nằm trong hộp bao (+14 m), trừ đoạn chạm nút/cụm 2 đầu
  function foreignCands(P, w, nA, nB) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const out = [], cell = 16; stamp++;
    const touch = (N) => N === nA || N === nB || (N.cl && (N.cl === nA.cl || N.cl === nB.cl));
    for (let ix = Math.floor((x0 - 14) / cell); ix <= Math.floor((x1 + 14) / cell); ix++)
      for (let iz = Math.floor((z0 - 14) / cell); iz <= Math.floor((z1 + 14) / cell); iz++) {
        const l = lumen.cells.get(ix * 100003 + iz); if (!l) continue;
        for (const [wj, j] of l) {
          if (wj === w.wi0) continue;
          const key = segBase2[wj] + j; if (seenStamp[key] === stamp) continue; seenStamp[key] = stamp;
          const o = ways[wj];
          if (touch(o.node[j]) || touch(o.node[j + 1])) continue;
          const ohw = hwOf(o.c), win = RANK[o.c] > RANK[w.c] || (RANK[o.c] === RANK[w.c] && wj < w.wi0);
          out.push([o.pts[j][0], o.pts[j][1], o.pts[j + 1][0], o.pts[j + 1][1], ohw - 0.2, win ? ohw + swOf(o.c) - 0.3 : -1]);
        }
      }
    return out;
  }
  // đoạn S1→S2 (theo tim) có đi gần ứng viên nào (≤ hw+sw+băng ứng viên)? — chỉ khi đó mới chia mịn
  function closeQuadOf(cands, reach) {
    return (S1, S2) => {
      for (const c of cands) {
        const lim = Math.max(c[4], c[5]) + reach;
        if (segSegDist(S1.x, S1.z, S2.x, S2.z, c[0], c[1], c[2], c[3]) < lim) return true;
      }
      return false;
    };
  }
  // 2 = trong lòng phố khác, 1 = trong vỉa hè phố khác "thắng" (cấp cao hơn), 0 = sạch
  function foreign(x, z, cands) {
    let hit = 0;
    for (const c of cands) {
      const d = segDist(x, z, c[0], c[1], c[2], c[3]);
      if (d < c[4]) return 2;
      if (d < c[5]) hit = 1;
    }
    return hit;
  }

  for (const w of ways) {
    const n = w.pts.length;
    const street = !!STREET[w.c], hw = hwOf(w.c), sw = swOf(w.c);
    const swLayer = SW_LAYER[deps.swTypeOf ? deps.swTypeOf(w.ri) : 'gach_xam'] ?? RL.GACH_XAM;
    const roadLayer = street ? RL.ASPHALT : w.c === 'w' ? RL.GACH_XAM : RL.CONCRETE;
    let ka = 0;
    for (let kb = 1; kb < n; kb++) {
      if (kb < n - 1 && w.armB[kb].cont) continue;
      if (!w.armF[ka].internal) emitRun(w, ka, kb, street, hw, sw, swLayer, roadLayer);
      ka = kb;
    }
  }

  function emitRun(w, ka, kb, street, hw, sw, swLayer, roadLayer) {
    const sA = w.armF[ka].spec, sB = w.armB[kb].spec;
    if (!sA || !sB) return;
    const nA = w.node[ka], nB = w.node[kb];
    const P = w.pts.slice(ka, kb + 1), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[cum.length - 1];
    let anyIn = false;
    for (let i = 0; i < P.length - 1 && !anyIn; i++) if (segDist(0, 0, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]) < R + T * 0.5) anyIn = true;
    if (!anyIn) return;
    stats.runs++;
    // đoạn qua sông DƯỚI mặt cầu vòm có mô hình riêng (HVT/Bính: groundHeight − NoDeck > 1 m) → cắt dải; sông/kênh
    // không có mô hình cầu giữ dải phẳng 2,11 m làm MẶT CẦU (terrain cũng cho đi bộ trên cầu phẳng 2,05 ở tim đường)
    const gaps = [];
    {
      const ns = ARCH.length ? Math.max(1, Math.ceil(L / 4)) : 0;
      let g0 = -1;
      const ptAt = (u) => { let j = 0; while (j < P.length - 2 && cum[j + 1] < u) j++; const t = (u - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); return [P[j][0] + (P[j + 1][0] - P[j][0]) * t, P[j][1] + (P[j + 1][1] - P[j][1]) * t]; };
      for (let i = 0; i <= ns; i++) {
        const u = L * i / ns, [x, z] = ptAt(u), wet = onArch(x, z);
        if (wet && g0 < 0) g0 = u;
        if ((!wet || i === ns) && g0 >= 0) { const g1 = wet ? L : u; if (g1 - g0 > 8) gaps.push([Math.max(0, g0 - 2), Math.min(L, g1 + 2)]); g0 = -1; }
      }
      if (gaps.length) stats.waterGaps += gaps.length;
    }
    const pieces = (u0, u1) => {     // [u0,u1] trừ khoảng nước → [[a,b,capA,capB]]
      const out = []; let a = u0, capA = false;
      for (const [g0, g1] of gaps) {
        if (g1 <= a || g0 >= u1) continue;
        if (g0 > a) out.push([a, g0, capA, true]);
        a = Math.max(a, g1); capA = true;
      }
      if (u1 > a) out.push([a, u1, capA, false]);
      return out;
    };
    // ---- vạch kẻ theo cấp + bằng chứng pano (≤ 14 m) ----
    let pat = 0;
    if (street) {
      if (w.c === 'p') pat = MK.CDBL | MK.EDGE | MK.LANES | MK.GUTTER;
      else if (w.c === 's') pat = MK.CDY | MK.EDGE | MK.GUTTER;
      else if (w.c === 't') pat = MK.CDY;
      let ev = 0, bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (const [x, z] of P) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z; }
      for (const m of MARKS) {
        if (m[0] < bx0 - 14 || m[0] > bx1 + 14 || m[1] < bz0 - 14 || m[1] > bz1 + 14) continue;
        for (let i = 0; i < P.length - 1; i++) if (segDist(m[0], m[1], P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]) < 14) ev |= m[2];
      }
      if (ev & 2) pat = (pat & ~(MK.CDY | MK.CDW)) | MK.CDBL;
      else if ((ev & 1) && !(pat & MK.CDBL)) pat = (pat & ~MK.CDW) | MK.CDY;
      else if ((ev & 4) && !(pat & (MK.CDBL | MK.CDY))) pat |= MK.CDW;
    }
    // mặt nhựa nâng theo cấp (+4 mm/cấp): 2 dải chồng nhau (đường đôi/nhánh song song) → dải cấp cao thắng, không z-fight
    const yR = ROAD_TOP + 0.004 * RANK[w.c];
    // ---- lòng đường ----
    const u0 = sA.trim, u1 = L - sB.trim;
    if (u1 - u0 > 0.2) {
      const zebOK = street && u1 - u0 >= 14;
      // aZeb = u của 2 đầu dải tại NÚT GIAO (vạch kẻ dừng trước nút; nối miter/đường cụt: vạch chạy liền)
      const zeb = [sA.junc ? u0 : -1e4, sB.junc ? u1 : 1e4];
      const seed = ((w.wi0 * 131 + ka * 17) & 255) << 13;
      const pr = pat | seed | (zebOK && sA.zebra ? MK.ZEB0 : 0) | (zebOK && sB.zebra ? MK.ZEB1 : 0) |
        (zebOK && sA.stop ? MK.STOP0 : 0) | (zebOK && sB.stop ? MK.STOP1 : 0);
      for (const [a, b, gA, gB] of pieces(u0, u1)) {
        const S = sections(P, cum, a, b, gA ? null : sA.cut, gB ? null : sB.cut);
        for (let i = 0; i < S.length - 1; i++) {
          const S1 = S[i], S2 = S[i + 1];
          const y1 = S1.h + yR, y2 = S2.h + yR;
          const p1a = off(S1, -hw), p1b = off(S1, hw), p2a = off(S2, -hw), p2b = off(S2, hw);
          let pq = pr;
          if (w.c === 'p' && (pq & (MK.CDBL | MK.CDY | MK.CDW)) && nearMedian((S1.x + S2.x) / 2, (S1.z + S2.z) / 2)) pq &= ~(MK.CDBL | MK.CDY | MK.CDW);
          emit('roads', [[p1a[0], y1, p1a[1], S1.u, -hw], [p1b[0], y1, p1b[1], S1.u, hw], [p2b[0], y2, p2b[1], S2.u, hw], [p2a[0], y2, p2a[1], S2.u, -hw]],
            quadTris, [0, 1, 0], [roadLayer, pq, hw], zeb);
          if (!street) {   // ngõ: gờ 2 bên xuống đất (không có bó vỉa che)
            for (const sg of [-1, 1]) {
              const q1 = sg < 0 ? p1a : p1b, q2 = sg < 0 ? p2a : p2b;
              face('roads', q1, q2, y1, S1.h - 0.05, y2, S2.h - 0.05, S1.mx * sg, S1.mz * sg, S1.u, S2.u, [RL.CURB, MK.FACE, 0]);
            }
          }
        }
        const capAt = (Sx, dirSign) => {   // nắp cuối dải (đường cụt, miệng ngõ, mép sông)
          const p1 = off(Sx, -hw), p2 = off(Sx, hw), y = Sx.h + yR;
          face('roads', p1, p2, y, Sx.h - 0.05, y, Sx.h - 0.05, Sx.dx * dirSign, Sx.dz * dirSign, -hw, hw, [RL.CURB, MK.FACE, 0]);
        };
        if (gA || (a === u0 && sA.capA)) capAt(S[0], -1);
        if (gB || (b === u1 && sB.capA)) capAt(S[S.length - 1], 1);
      }
    }
    // ---- vỉa hè 2 bên ----
    const cands = street && sw > 0 ? foreignCands(P, w, nA, nB) : [];
    const closeQuad = closeQuadOf(cands, hw + sw);
    if (street && sw > 0) {
      for (const side of [0, 1]) {
        const sg = side ? 1 : -1;
        const st = sA.sw ? sA.sw[side] : null, en = sB.sw ? sB.sw[1 - side] : null;
        if (!st || !en) continue;
        const e0 = st.e, e1 = L - en.e;
        if (e1 - e0 < 0.2) continue;
        for (const [a, b, gA, gB] of pieces(e0, e1)) {
          const S0 = sections(P, cum, a, b, gA ? null : st.cut, gB ? null : en.cut);
          const vin = sg * hw, vout = sg * (hw + sw), vmid = sg * (hw + sw * 0.5);
          // lọc vỉa hè lấn phố khác: ô nào có ứng viên gần thì chia mịn 5 m rồi kiểm từng ô (giữa ô + mép trong)
          const S = [];
          const bad = (S1, S2) => {
            if (!cands.length) return 0;
            const m1 = off(S1, vmid), m2 = off(S2, vmid), c1 = off(S1, vin), c2 = off(S2, vin);
            return Math.max(foreign((m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2, cands), foreign((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2, cands));
          };
          for (let i = 0; i < S0.length; i++) {
            if (i > 0 && cands.length && closeQuad(S0[i - 1], S0[i])) {
              const A = S0[i - 1], Bq = S0[i], n = Math.ceil((Bq.u - A.u) / 5);
              const [ddx, ddz] = norm(Bq.x - A.x, Bq.z - A.z);   // 2 mặt cắt liên tiếp luôn trên CÙNG 1 đoạn thẳng
              for (let q = 1; q < n; q++) {   // điểm chia: nội suy tuyến tính, mặt cắt vuông góc đoạn
                const t = q / n;
                S.push({ x: A.x + (Bq.x - A.x) * t, z: A.z + (Bq.z - A.z) * t, mx: -ddz, mz: ddx, k: 1, u: A.u + (Bq.u - A.u) * t, dx: ddx, dz: ddz, h: A.h + (Bq.h - A.h) * t, sub: true });
              }
            }
            S.push(S0[i]);
          }
          let prevSkip = false;
          for (let i = 0; i < S.length - 1; i++) {
            const S1 = S[i], S2 = S[i + 1];
            if (bad(S1, S2) && (S1.sub || S2.sub || closeQuad(S1, S2))) { if (!prevSkip && i > 0) capAt(S1, 1); prevSkip = true; stats.swForeign = (stats.swForeign || 0) + 1; continue; }
            if (prevSkip) capAt(S1, -1);
            prevSkip = false;
            const t1 = S1.h + SIDEWALK_TOP, t2 = S2.h + SIDEWALK_TOP;
            const i1 = off(S1, vin), o1 = off(S1, vout), i2 = off(S2, vin), o2 = off(S2, vout);
            const paint = isWater((i1[0] + i2[0]) / 2, (i1[1] + i2[1]) / 2) ? MK.PAINT : 0;   // trên cầu
            emit('sidewalk', [[i1[0], t1, i1[1], S1.u, 0, 0], [o1[0], t1, o1[1], S1.u, sw, sw], [o2[0], t2, o2[1], S2.u, sw, sw], [i2[0], t2, i2[1], S2.u, 0, 0]],
              quadTris, [0, 1, 0], [swLayer, paint, hw], null);
            // mặt đứng bó vỉa (về phía lòng đường) + mép lưng xuống đất
            face('sidewalk', i1, i2, t1, S1.h + ROAD_TOP, t2, S2.h + ROAD_TOP, -S1.mx * sg, -S1.mz * sg, S1.u, S2.u, [RL.CURB, MK.FACE | paint, 0]);
            face('sidewalk', o1, o2, t1, S1.h - 0.05, t2, S2.h - 0.05, S1.mx * sg, S1.mz * sg, S1.u, S2.u, [RL.CURB, MK.FACE | MK.BACK, 0]);
          }
          function capAt(Sx, dirSign) {
            const p1 = off(Sx, vin), p2 = off(Sx, vout), y = Sx.h + SIDEWALK_TOP;
            face('sidewalk', p1, p2, y, Sx.h - 0.05, y, Sx.h - 0.05, Sx.dx * dirSign, Sx.dz * dirSign, 0, sw, [RL.CURB, MK.FACE, 0]);
          }
          if (gA || (a === e0 && st.cap)) capAt(S[0], -1);
          if (!prevSkip && (gB || (b === e1 && en.cap))) capAt(S[S.length - 1], 1);
        }
      }
    }
  }

  stats.tRuns = Math.round(_now() - t0);
  // ---------- 5) nút giao: đa giác lòng + vỉa hè góc ----------
  const signals = [];
  for (const J of junctions) {
    if (!inRange(J.x, J.z)) continue;
    const arms = J.arms, k = arms.length;
    const yR = ROAD_TOP + 0.004 * Math.max(...arms.map((a) => RANK[a.c]), ...J.nodes.flatMap((N) => N.major.map((a) => RANK[a.c])));
    const y = J.h + yR, ys = J.h + SIDEWALK_TOP;
    const anyStreet = J.nodes.some((N) => N.major.some((a) => STREET[a.c]));
    const layer = anyStreet ? RL.ASPHALT : J.nodes.some((N) => N.major.some((a) => a.c === 'h')) ? RL.CONCRETE : RL.GACH_XAM;
    const poly = [];
    const push = (p) => { const l = poly[poly.length - 1]; if (l && Math.abs(l[0] - p[0]) < 0.01 && Math.abs(l[1] - p[1]) < 0.01) return; poly.push(p); };
    if (J.degenerate) {   // cụm không còn nhánh ngoài: phủ bao lồi các nút + bề rộng
      for (const N of J.nodes) for (let i = 0; i < 8; i++) { const an = i * Math.PI / 4; push([N.x + Math.cos(an) * 4, N.z + Math.sin(an) * 4]); }
    } else {
      for (let i = 0; i < k; i++) {
        const a = arms[i], nA = nR(a.d), C = J.corners[i];
        push(lineAt(a.O, -nA[0], -nA[1], a.hw, a.d, a.s));
        push(lineAt(a.O, nA[0], nA[1], a.hw, a.d, a.s));
        for (const p of C.curb) push(p);
      }
    }
    if (poly.length > 2 && Math.abs(poly[0][0] - poly[poly.length - 1][0]) < 0.01 && Math.abs(poly[0][1] - poly[poly.length - 1][1]) < 0.01) poly.pop();
    let area = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    if (Math.abs(area) > 0.1 && !J.degenerate) {
      let tris = earClip(poly);
      if (tris.length < poly.length - 4) { stats.fanFallback = (stats.fanFallback || 0) + 1; tris = []; const c = poly.length; poly.push([J.x, J.z]); for (let i = 0; i < c; i++) tris.push([c, i, (i + 1) % c]); }
      emit('roads', poly.map((p) => [p[0], y, p[1], p[0], p[1]]), tris, [0, 1, 0], [layer, MK.WUV, 0], null);
      J.poly = poly; J.yTop = yR;
    }
    if (J.degenerate) continue;
    for (const C of J.corners) {
      const a = C.a, b = C.b;
      if (C.skirt && C.curb && C.curb.length > 1)
        for (let i = 0; i < C.curb.length - 1; i++) face('roads', C.curb[i], C.curb[i + 1], y, J.h - 0.05, y, J.h - 0.05, (C.curb[i][0] + C.curb[i + 1][0]) / 2 - J.x, (C.curb[i][1] + C.curb[i + 1][1]) / 2 - J.z, 0, 1, [RL.CURB, MK.FACE, 0]);
      if (!C.piece) continue;
      const nA = nR(a.d), nB = nR(b.d);
      let curb, back;
      if (C.type === 'fillet') {
        curb = [];
        if (C.eA > C.tuA + 0.01) curb.push(lineAt(a.O, nA[0], nA[1], a.hw, a.d, C.eA));
        curb.push(...C.curb);
        if (C.eB > C.tuB + 0.01) curb.push(lineAt(b.O, -nB[0], -nB[1], b.hw, b.d, C.eB));
        back = [lineAt(a.O, nA[0], nA[1], a.hw + a.sw, a.d, C.eA)];
        if (C.useQ && C.Q) { const l = back[0]; if (Math.hypot(C.Q[0] - l[0], C.Q[1] - l[1]) > 0.01) back.push(C.Q); }
        const eB = lineAt(b.O, -nB[0], -nB[1], b.hw + b.sw, b.d, C.eB);
        const l = back[back.length - 1]; if (Math.hypot(eB[0] - l[0], eB[1] - l[1]) > 0.01) back.push(eB);
      } else { curb = C.curb; back = C.back; }
      if (!back || back.length < 1 || curb.length < 2) continue;
      const swL = SW_LAYER[a.swType] ?? RL.GACH_XAM;
      const V = [];
      for (const p of curb) V.push([p[0], ys, p[1], p[0], p[1], 0]);
      for (const p of back) V.push([p[0], ys, p[1], p[0], p[1], Math.min(4, distToPolyline(p, curb))]);
      const zt = zipper(curb.length, back.length, curb, back).map(([ca, ia, cb, ib, cc, ic]) => [ca ? curb.length + ia : ia, cb ? curb.length + ib : ib, cc ? curb.length + ic : ic]);
      emit('sidewalk', V, zt, [0, 1, 0], [swL, MK.WUV, a.hw], null);
      // mặt đứng bó vỉa về phía lòng (xa tâm cung = về phía tâm nút) + mép lưng
      for (let i = 0; i < curb.length - 1; i++) face('sidewalk', curb[i], curb[i + 1], ys, J.h + ROAD_TOP, ys, J.h + ROAD_TOP, J.x - (curb[i][0] + curb[i + 1][0]) / 2, J.z - (curb[i][1] + curb[i + 1][1]) / 2, 0, 1, [RL.CURB, MK.FACE, 0]);
      for (let i = 0; i < back.length - 1; i++) face('sidewalk', back[i], back[i + 1], ys, J.h - 0.05, ys, J.h - 0.05, (back[i][0] + back[i + 1][0]) / 2 - J.x, (back[i][1] + back[i + 1][1]) / 2 - J.z, 0, 1, [RL.CURB, MK.FACE | MK.BACK, 0]);
    }
    // cột đèn tín hiệu: mỗi nhánh phố 1 cột ở góc bên PHẢI làn xe đi tới (phía −nR của nhánh), tay vươn ra lòng đường
    if (J.signal) {
      const a0 = arms.find((a) => STREET[a.c]);
      for (const a of arms) {
        if (!STREET[a.c] || a.runLen < 14) continue;
        const nA = nR(a.d), p = lineAt(a.O, -nA[0], -nA[1], a.hw + Math.min(0.6, a.sw * 0.5), a.d, a.s + 1.2);
        const axis = Math.abs(Math.sin(a.ang - a0.ang)) > 0.7 ? 1 : 0;
        signals.push({ x: p[0], z: p[1], y: J.h + (a.sw > 0 ? SIDEWALK_TOP : ROAD_TOP), dx: a.d[0], dz: a.d[1], nx: nA[0], nz: nA[1], hw: a.hw, phase: axis, jx: J.x, jz: J.z });
      }
    }
  }

  stats.tJunc = Math.round(_now() - t0);
  // ---------- 6) đóng gói ----------
  for (const [, t] of tiles) for (const kind of ['roads', 'sidewalk']) {
    const B = t[kind];
    t[kind] = B.vc ? {
      position: B.p.slice(0, B.vc * 3), normal: B.n.slice(0, B.vc * 3), uv: B.uv.slice(0, B.vc * 2),
      aSurf: B.s.slice(0, B.vc * 4), aZeb: B.z.slice(0, B.vc * 2),
      index: B.vc > 65535 ? B.idx.slice(0, B.ic) : Uint16Array.from(B.idx.subarray(0, B.ic)),
    } : null;
  }
  // tra cứu nút giao cho hệ khác (cây/prop/biển tránh miệng ngã tư): lưới 50 m
  const pub = junctions.map((J) => ({ x: J.x, z: J.z, rad: J.rad, signal: !!J.signal, zebra: !!J.zebra, arms: J.arms.map((a) => ({ c: a.c, dx: a.d[0], dz: a.d[1], ox: a.O[0], oz: a.O[1], setback: a.s ?? 0, hw: a.hw, sw: a.sw })) }));
  const jgrid = new Map();
  junctions.forEach((J, i) => { const kk = Math.floor(J.x / 50) + ',' + Math.floor(J.z / 50); let l = jgrid.get(kk); if (!l) jgrid.set(kk, l = []); l.push(i); });
  const nearJ = (x, z, pad, cb) => {
    const ix = Math.floor(x / 50), iz = Math.floor(z / 50);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = jgrid.get((ix + a) + ',' + (iz + b)); if (!l) continue;
      for (const i of l) { const J = junctions[i]; if ((J.x - x) ** 2 + (J.z - z) ** 2 < (J.rad + pad) ** 2 && cb(i, J)) return i; }
    }
    return -1;
  };
  const nearJunction = (x, z, pad = 0) => { const i = nearJ(x, z, pad, () => true); return i < 0 ? null : pub[i]; };
  // MẶT ĐI ĐƯỢC: độ cao mặt nhựa / mặt vỉa hè so với groundHeight tại (x,z) — cho chân người chơi/NPC/prop
  // (groundHeight là NỀN LAND_H; lòng đường nổi +0,11..0,13 m, vỉa hè +0,25 m theo xsection.js). Trả 0 ngoài mạng đường
  // và trên mặt cầu vòm (mô hình cầu riêng). Lòng thắng vỉa hè; trong đa giác nút giao = lòng (kể cả vùng góc bo).
  const sgrid = buildSegGrid(ways, 16);
  const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };
  const surfaceAt = (x, z) => {
    if (ARCH.length && onArch(x, z)) return 0;
    let road = -1, side = false;
    sgrid.near(x, z, (wi, i) => {
      const w = ways[wi], [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], d = segDist(x, z, ax, az, bx, bz), hw = hwOf(w.c);
      if (d <= hw) road = Math.max(road, ROAD_TOP + 0.004 * RANK[w.c]);
      else if (STREET[w.c] && d <= hw + swOf(w.c)) side = true;
    });
    let jy = -1;
    nearJ(x, z, 0, (i, J) => { if (J.poly && pip(J.poly, x, z)) { jy = J.yTop; return true; } return false; });
    if (jy >= 0) return Math.max(jy, road);
    return road >= 0 ? road : side ? SIDEWALK_TOP : 0;
  };
  stats.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  return { tiles, signals, stats, nearJunction, surfaceAt, junctions: pub };
}
