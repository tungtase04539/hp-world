// roadgraph.js — ĐỒ THỊ ĐƯỜNG cho giao thông (Đợt 3 WP8). Thuần JS (không three) → chạy được trong node để test.
//
// Vì sao cần: giao thông cũ chạy khứ hồi trên 8 polyline DÀI NHẤT của cả DT_BOX + 3 trục vùng → chỉ 11,9% quãng đường
// nằm trong vùng chơi, ~2 xe máy nhìn thấy được, chạy LÀN TRÁI (kiểm toán 2026-10-04 mục 12).
// Nay: mọi phố p/s/t/r trong đĩa vùng chơi (+biên) thành đồ thị nút–cạnh với ngã ba/ngã tư thật:
//  1. gom đỉnh trùng (lượng tử 1,5 m) — OSM chia way tại nút chung;
//  2. ngã ba chữ T: đầu mút một phố nằm cách THÂN đoạn phố khác ≤ 6 m (ROADS_DT đã giản lược nên nút giao giữa
//     thân way có thể bị mất) → chèn đỉnh vào thân đoạn đó;
//  3. ngã tư chéo: 2 đoạn của 2 phố khác nhau cắt nhau → chèn đỉnh vào cả hai;
//  4. đỉnh thuộc ≥ 2 polyline hoặc là đầu mút = NÚT; đoạn polyline giữa 2 nút liên tiếp = CẠNH (2 chiều).
// W3-F (phản biện): KHÁC TẦNG KHÔNG NỐI. Đỉnh polyline có thể mang cao độ mặt đường p[2] (cầu nâng HVT/Lạc Long — world.js
// trafficRoads lấy hình + cao độ từ BRIDGE_WAYS); không có p[2] = mặt đất (opts.groundLevel). Bước 2/3/4 chỉ nối 2 tuyến
// khi mặt đường tại điểm nối lệch ≤ LV_TOL (1 m): bản cũ nối mọi giao cắt 2D → xe rẽ từ phố mặt đất "lên" nhịp chính
// (chạy dưới đất theo đường cầu, 88-102 xe/mẫu ở nút HVT) hoặc lặn dưới sông (y −2,9). Cạnh mang e.ys (cao độ từng đỉnh)
// + e.kind (loại cầu) → traffic.js đặt cao độ theo cạnh (edgeY), không tra mặt cầu theo vị trí.
// Toạ độ theo quy ước game (+x đông, +z NAM, mét). Làn: xe chạy bên PHẢI hướng đi — vector phải của hướng
// t = (tx, tz) là (−tz, tx) (kiểm: đi về bắc t=(0,−1) → phải = (1,0) = đông).
import { ROAD_HW, roadHW, sidewalkW } from './xsection.js';

const DRIVE = { p: 1, s: 1, t: 1, r: 1 };
const Q = 1.5;   // lượng tử gom đỉnh (m)

const LV_TOL = 1.0;   // lệch cao độ mặt đường tối đa để 2 tuyến được nối (m)

export function buildRoadGraph(roads, { radius = 1600, margin = 80, groundLevel = 2.11 } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const R2 = (radius + margin) * (radius + margin);
  const G0 = groundLevel;
  const lvOf = (p) => (p.length > 2 && p[2] != null ? p[2] : G0);
  const lerpLv = (a, b, t) => { const ya = lvOf(a), yb = lvOf(b); return ya + (yb - ya) * t; };
  // --- 0. cắt polyline theo đĩa (giữ đoạn có ít nhất 1 đầu trong đĩa) ---
  const lines = [];
  roads.forEach((r, ri) => {
    if (!DRIVE[r.c]) return;
    let cur = null;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const inA = a[0] * a[0] + a[1] * a[1] <= R2, inB = b[0] * b[0] + b[1] * b[1] <= R2;
      if (!inA && !inB) { cur = null; continue; }
      // W3-A: giữ lòng/vỉa riêng phố (w/sw); W3-F: ri/kind/hw mặt cầu + cao độ đỉnh p[2] + cờ cắt đầu mút
      if (!cur) { cur = { c: r.c, w: r.w, sw: r.sw, ri, kind: r.kind || null, hw: r.hw || 0, lvl: a.length > 2, cutA: !!(r.cut && r.cut[0] && i === 0), pts: [[a[0], a[1], a[2]]] }; lines.push(cur); }
      cur.pts.push([b[0], b[1], b[2]]);
    }
    if (cur && r.cut && r.cut[1]) cur.cutB = true;
  });
  // --- spatial hash các đoạn ---
  const CELL = 40;
  const hk = (i, j) => (i + 2048) * 4096 + (j + 2048);
  const hash = new Map();
  const segs = [];   // [lineIdx, segIdx]
  lines.forEach((l, li) => {
    for (let k = 0; k < l.pts.length - 1; k++) {
      const a = l.pts[k], b = l.pts[k + 1];
      const id = segs.length; segs.push([li, k]);
      const i0 = Math.floor(Math.min(a[0], b[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const j0 = Math.floor(Math.min(a[1], b[1]) / CELL), j1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const kk = hk(i, j); let arr = hash.get(kk); if (!arr) hash.set(kk, (arr = [])); arr.push(id);
      }
    }
  });
  const near = (x0, z0, x1, z1, cb) => {
    const seen = new Set();
    for (let i = Math.floor(Math.min(x0, x1) / CELL); i <= Math.floor(Math.max(x0, x1) / CELL); i++)
      for (let j = Math.floor(Math.min(z0, z1) / CELL); j <= Math.floor(Math.max(z0, z1) / CELL); j++) {
        const arr = hash.get(hk(i, j)); if (!arr) continue;
        for (const id of arr) if (!seen.has(id)) { seen.add(id); cb(id); }
      }
  };
  // điểm chèn: inserts[li][k] = [{t, x, z}]
  const inserts = lines.map((l) => l.pts.map(() => []));
  const addIns = (li, k, t, x, z, y) => { if (t > 0.02 && t < 0.98) inserts[li][k].push({ t, x, z, y: lines[li].lvl ? y : undefined }); };
  let lvSkip = 0;
  // --- 2. ngã ba chữ T ---
  lines.forEach((l, li) => {
    for (const e of [l.cutA ? null : l.pts[0], l.cutB ? null : l.pts[l.pts.length - 1]]) {
      if (!e) continue;                                          // đầu mút cắt dưới mặt cầu (trimRoadEnds): phố cụt
      let best = null, bd = 6;
      const ey = lvOf(e);
      near(e[0] - 6, e[1] - 6, e[0] + 6, e[1] + 6, (id) => {
        const [lj, k] = segs[id]; if (lj === li) return;
        const a = lines[lj].pts[k], b = lines[lj].pts[k + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; if (L2 < 1e-6) return;
        const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * dx + (e[1] - a[1]) * dz) / L2));
        const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - e[0], pz - e[1]);
        if (d >= bd) return;
        const y = lerpLv(a, b, t);
        if (Math.abs(y - ey) > LV_TOL) { lvSkip++; return; }   // khác tầng (cầu nâng ↔ phố dưới) → không phải nút
        bd = d; best = { lj, k, t, px, pz, y };
      });
      if (best) {
        addIns(best.lj, best.k, best.t, best.px, best.pz, best.y);
        e[0] = best.px; e[1] = best.pz;     // kéo đầu mút về đúng thân phố kia
      }
    }
  });
  // --- 3. ngã tư chéo (2 đoạn khác phố cắt nhau) ---
  for (let id = 0; id < segs.length; id++) {
    const [li, k] = segs[id];
    const a = lines[li].pts[k], b = lines[li].pts[k + 1];
    near(a[0], a[1], b[0], b[1], (id2) => {
      if (id2 <= id) return;
      const [lj, k2] = segs[id2]; if (lj === li) return;
      const c = lines[lj].pts[k2], d = lines[lj].pts[k2 + 1];
      const r1x = b[0] - a[0], r1z = b[1] - a[1], r2x = d[0] - c[0], r2z = d[1] - c[1];
      const den = r1x * r2z - r1z * r2x; if (Math.abs(den) < 1e-6) return;
      const qx = c[0] - a[0], qz = c[1] - a[1];
      const t = (qx * r2z - qz * r2x) / den, u = (qx * r1z - qz * r1x) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return;
      const x = a[0] + r1x * t, z = a[1] + r1z * t;
      const ya = lerpLv(a, b, t), yb = lerpLv(c, d, u);
      if (Math.abs(ya - yb) > LV_TOL) { lvSkip++; return; }    // cầu vượt trên phố / nhịp trên vòng xoắn dưới
      addIns(li, k, t, x, z, ya); addIns(lj, k2, u, x, z, yb);
    });
  }
  // --- dựng lại polyline có đỉnh chèn ---
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li], out = [];
    for (let k = 0; k < l.pts.length; k++) {
      out.push(l.pts[k]);
      if (k < l.pts.length - 1 && inserts[li][k].length) {
        inserts[li][k].sort((p, q) => p.t - q.t);
        for (const p of inserts[li][k]) out.push([p.x, p.z, p.y]);
      }
    }
    l.pts = out;
  }
  // --- 4. nút (khoá = ô lượng tử 1,5 m + CỤM CAO ĐỘ: 2 tuyến khác tầng có đỉnh trùng ô → 2 nút riêng) ---
  const qk = (x, z) => `${Math.round(x / Q)},${Math.round(z / Q)}`;
  const use = new Map();   // key → [{y, n}]: số polyline chạm theo cụm cao độ
  const slot = (arr, y) => { for (const s of arr) if (Math.abs(s.y - y) <= LV_TOL) return s; return null; };
  for (const l of lines) {
    const seen = new Set();
    for (const p of l.pts) {
      const k = qk(p[0], p[1]), y = lvOf(p);
      let arr = use.get(k); if (!arr) use.set(k, (arr = []));
      let s = slot(arr, y); if (!s) arr.push((s = { y, n: 0 }));
      if (!seen.has(s)) { seen.add(s); s.n++; }
    }
  }
  const useAt = (p) => { const arr = use.get(qk(p[0], p[1])); const s = arr && slot(arr, lvOf(p)); return s ? s.n : 0; };
  const nodes = [], nodeOf = new Map();
  const nodeAt = (x, z, y) => {
    const k = qk(x, z); let arr = nodeOf.get(k); if (!arr) nodeOf.set(k, (arr = []));
    for (const n of arr) if (Math.abs(nodes[n].y - y) <= LV_TOL) return n;
    const n = nodes.length; arr.push(n); nodes.push({ x, z, y, out: [] });
    return n;
  };
  const edges = [];
  for (const l of lines) {
    let start = 0;
    for (let k = 1; k < l.pts.length; k++) {
      const isEnd = k === l.pts.length - 1;
      if (!isEnd && useAt(l.pts[k]) < 2) continue;
      const pts = l.pts.slice(start, k + 1);
      start = k;
      // bỏ đỉnh trùng liên tiếp
      const P = [pts[0]];
      for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - P[P.length - 1][0], pts[i][1] - P[P.length - 1][1]) > 0.3) P.push(pts[i]);
      if (P.length < 2) continue;
      const a = nodeAt(P[0][0], P[0][1], lvOf(P[0])), b = nodeAt(P[P.length - 1][0], P[P.length - 1][1], lvOf(P[P.length - 1]));
      if (a === b) continue;
      const xs = new Float32Array(P.length), zs = new Float32Array(P.length), cum = new Float32Array(P.length);
      const ys = l.lvl ? new Float32Array(P.length) : null;
      for (let i = 0; i < P.length; i++) {
        xs[i] = P[i][0]; zs[i] = P[i][1];
        if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
        if (ys) ys[i] = lvOf(P[i]);
      }
      const L = cum[P.length - 1];
      if (L < 1) continue;
      const ei = edges.length;
      const mx = (xs[0] + xs[P.length - 1]) / 2, mz = (zs[0] + zs[P.length - 1]) / 2;
      let lv = G0; if (ys) { lv = 0; for (let i = 0; i < ys.length; i++) lv += ys[i]; lv /= ys.length; }
      // hw: mặt cầu nâng (W3-F deckRoads) > lòng riêng phố (W3-A roadHW(way)) > 2,75
      edges.push({ a, b, xs, zs, cum, L, c: l.c, hw: l.hw || roadHW(l) || 2.75, sw: sidewalkW(l), mx, mz, ri: l.ri, kind: l.kind, ys, lv });
      nodes[a].out.push(ei * 2);       // cạnh ei theo chiều a→b
      nodes[b].out.push(ei * 2 + 1);   // chiều b→a
    }
  }
  markDualCarriageways(edges);
  const ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  return { nodes, edges, ms, lvSkip };
}

// Cao độ MẶT ĐƯỜNG trên cạnh e (chiều dir, quãng s từ đầu chiều đi) — chỉ cạnh có e.ys (way cầu nâng, cả đoạn đầu cầu
// sát đất); null = phố mặt đất (traffic.js tra groundHeight). Nội suy tuyến tính theo đỉnh (BRIDGE_WAYS lấy mẫu 3 m).
export function edgeY(e, dir, s) {
  const ys = e.ys; if (!ys) return null;
  const L = e.L, n = e.xs.length;
  const u = dir ? L - s : s;
  if (u <= 0) return ys[0];
  if (u >= L) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= u) lo = m; else hi = m; }
  const t = (u - e.cum[lo]) / ((e.cum[lo + 1] - e.cum[lo]) || 1e-6);
  return ys[lo] + (ys[lo + 1] - ys[lo]) * t;
}

// ĐƯỜNG ĐÔI (2 chiều tách bởi dải phân cách/vườn hoa — Trần Hưng Đạo, Quang Trung, Lê Hồng Phong… OSM vẽ 2 way
// MỘT CHIỀU song song; ROADS_DT không giữ thẻ oneway): cạnh có "bạn" song song cùng cấp lớn cách 8-26 m về MỘT
// bên ở ≥ 2/3 điểm mẫu → một chiều, chiều cho phép = chiều mà bạn nằm bên TRÁI (giữ phải). e.oneway: 0 hai chiều,
// 1 chỉ a→b, 2 chỉ b→a. e.partner = +1/−1: bạn ở bên phải/trái của chiều a→b (vỉa hè đi bộ chỉ ở phía NGOÀI).
function markDualCarriageways(edges) {
  const CELL = 40, hash = new Map();
  const hk = (i, j) => (i + 2048) * 4096 + (j + 2048);
  edges.forEach((e, ei) => {
    for (let k = 0; k < e.xs.length - 1; k++) {
      const i0 = Math.floor(Math.min(e.xs[k], e.xs[k + 1]) / CELL), i1 = Math.floor(Math.max(e.xs[k], e.xs[k + 1]) / CELL);
      const j0 = Math.floor(Math.min(e.zs[k], e.zs[k + 1]) / CELL), j1 = Math.floor(Math.max(e.zs[k], e.zs[k + 1]) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = hk(i, j); let a = hash.get(kk); if (!a) hash.set(kk, (a = [])); a.push([ei, k]); }
    }
  });
  const o = { x: 0, z: 0, tx: 0, tz: 0 };
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    e.oneway = 0; e.partner = 0;
    if (e.L < 25 || (e.c !== 'p' && e.c !== 's' && e.c !== 't')) continue;
    let left = 0, right = 0;
    for (const f of [0.25, 0.5, 0.75]) {
      edgePoint(e, 0, e.L * f, o);
      const rx = -o.tz, rz = o.tx;   // vector phải của chiều a→b
      let bestL = 1e9, bestR = 1e9;
      for (let i = Math.floor((o.x - 28) / CELL); i <= Math.floor((o.x + 28) / CELL); i++)
        for (let j = Math.floor((o.z - 28) / CELL); j <= Math.floor((o.z + 28) / CELL); j++) {
          const arr = hash.get(hk(i, j)); if (!arr) continue;
          for (const [fj, k] of arr) {
            if (fj === ei) continue;
            const g = edges[fj];
            if (g.c !== 'p' && g.c !== 's' && g.c !== 't') continue;
            if (Math.abs(g.lv - e.lv) > 2) continue;                       // W3-F: cầu nâng song song phố dưới ≠ đường đôi
            const ax = g.xs[k], az = g.zs[k], bx = g.xs[k + 1], bz = g.zs[k + 1];
            const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1) continue;
            if (Math.abs((dx * o.tx + dz * o.tz) / L) < 0.9) continue;         // phải gần song song
            // giao của tia vuông góc (o + r·t) với đoạn g
            const den = rx * dz - rz * dx; if (Math.abs(den) < 1e-6) continue;
            const qx = ax - o.x, qz = az - o.z;
            const tt = (qx * dz - qz * dx) / den, uu = (qx * rz - qz * rx) / den;
            if (uu < 0 || uu > 1) continue;
            const minD = e.hw + g.hw + 0.5;
            if (tt > minD && tt < 26 && tt < bestR) bestR = tt;
            if (-tt > minD && -tt < 26 && -tt < bestL) bestL = -tt;
          }
        }
      if (bestL < 1e9 && bestR > 1e8) left++;
      if (bestR < 1e9 && bestL > 1e8) right++;
    }
    if (left >= 2 && right === 0) { e.oneway = 1; e.partner = -1; }
    else if (right >= 2 && left === 0) { e.oneway = 2; e.partner = 1; }
  }
}

// Điểm + tiếp tuyến trên cạnh e đi theo chiều dir (0: a→b, 1: b→a) tại quãng s tính từ đầu chiều đi.
// s < 0 hoặc s > L: NGOẠI SUY thẳng theo đoạn đầu/cuối (dùng để bo cua mượt qua nút).
export function edgePoint(e, dir, s, out) {
  const L = e.L, n = e.xs.length;
  let u = dir ? L - s : s;            // quãng theo chiều a→b
  let i;
  if (u <= 0) i = 0;
  else if (u >= L) i = n - 2;
  else { i = 0; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= u) lo = m; else hi = m; } i = lo; }
  const x0 = e.xs[i], z0 = e.zs[i], x1 = e.xs[i + 1], z1 = e.zs[i + 1];
  const sl = (e.cum[i + 1] - e.cum[i]) || 1e-6;
  const t = (u - e.cum[i]) / sl;
  let tx = (x1 - x0) / sl, tz = (z1 - z0) / sl;
  if (dir) { tx = -tx; tz = -tz; }
  out.x = x0 + (x1 - x0) * t; out.z = z0 + (z1 - z0) * t; out.tx = tx; out.tz = tz;
  return out;
}

// W3-F (phản biện): phố MẶT ĐẤT có ĐẦU MÚT nằm dưới mặt cầu nâng thấp (lowAt(x,z): mặt cầu phủ, gầm < ~4 m — Bạch Đằng
// 51/222 gặp nhau ngay dưới Cầu Lạc Long, mặt cầu +2 m, gầm 0,9 m) → cắt lùi đầu mút tới điểm đầu tiên ra khỏi vùng phủ
// (bước 0,5 m): phố cụt sát tường nền đắp đầu cầu, không chui vào gầm. Giữ CHỈ SỐ way (bản sao mảng); skip(ri) = way bỏ qua
// (chính các way cầu). Dùng cho roadnet + đồ thị giao thông (world.js ROADS_NET).
export function trimRoadEnds(roads, lowAt, skip) {
  const out = roads.slice(), trimmed = [];
  roads.forEach((r, ri) => {
    if ((skip && skip(ri)) || r.pts.length < 2) return;
    let pts = r.pts, changed = false;
    const cut = [false, false];
    for (const end of [0, 1]) {
      const P = end ? pts.slice().reverse() : pts;
      if (P.length < 2 || !lowAt(P[0][0], P[0][1])) continue;
      cut[end] = true;
      let cp = null, ci = -1;
      search: for (let k = 0; k < P.length - 1; k++) {
        const [ax, az] = P[k], [bx, bz] = P[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.5));
        for (let q = 1; q <= n; q++) {
          const x = ax + (bx - ax) * q / n, z = az + (bz - az) * q / n;
          if (!lowAt(x, z)) { cp = [Math.round(x * 100) / 100, Math.round(z * 100) / 100]; ci = k; break search; }
        }
      }
      changed = true;
      if (!cp) { pts = [P[P.length - 1]]; break; }             // cả way nằm dưới mặt cầu → còn 1 điểm (roadnet/đồ thị bỏ)
      const np = [cp, ...P.slice(ci + 1)];
      pts = end ? np.reverse() : np;
    }
    // r.cut[0/1]: đầu mút ĐÃ CẮT = phố cụt sát tường đầu cầu — roadnet/đồ thị KHÔNG kéo nó "T-snap" sang phố khác
    // (Bạch Đằng 51 cắt ở (−376,−492) từng bị kéo 5 m sang đầu phố 243 → chữ V nhọn)
    if (changed) { out[ri] = { ...r, pts, cut }; trimmed.push(ri); }
  });
  return { roads: out, trimmed };
}

// W3-F: way cầu nâng (BRIDGE_WAYS kind ≠ 'flat') cho ĐỒ THỊ GIAO THÔNG: thay polyline ROADS_DT (giản lược — dây cung vòng
// xoắn r 63 m lệch ~3 m khỏi tim mặt cầu) bằng tim mặt cầu lấy mẫu 3 m + CAO ĐỘ mặt nhựa từng đỉnh (p[2] = y hồ sơ + dy,
// trùng DECKS.yAt), hw = nửa lòng giữa 2 gờ lan can (HVT 11 m → 5,0; không lấy ROAD_HW cấp 'p' 6,5 → xe máy lấn gờ).
// Chiều way ROADS_DT giữ nguyên (2 đầu mút gắn đúng toạ độ ROADS_DT — nút chung với phố khác). Trả bản sao (chỉ số giữ).
export function deckRoads(roads, bridgeWays, { roadTop = 0.11, parapet = 0.42 } = {}) {
  const byRi = new Map();
  for (const b of bridgeWays || []) if (b.kind !== 'flat') for (const ri of b.ri) byRi.set(ri, b);
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  return roads.map((r, ri) => {
    const b = byRi.get(ri); if (!b || r.pts.length < 2) return r;
    const dy = b.kind === 'deck' ? roadTop : 0.02;
    const P = b.pts.map((p) => [p[0], p[1], Math.round((p[2] + dy) * 1000) / 1000]);
    const A = r.pts[0], Z = r.pts[r.pts.length - 1];
    if (d(P[0], Z) + d(P[P.length - 1], A) < d(P[0], A) + d(P[P.length - 1], Z)) P.reverse();
    if (d(P[0], A) > 4 || d(P[P.length - 1], Z) > 4) return r;      // way ROADS_DT không trùng way cầu → giữ như cũ
    P[0] = [A[0], A[1], P[0][2]]; P[P.length - 1] = [Z[0], Z[1], P[P.length - 1][2]];
    const hw = b.kind === 'deck' ? 0 : b.w / 2 - parapet - 0.1;
    // giữ MỌI trường khác của way (W3-A thêm bề rộng riêng w/sw — phản biện r2: bản cũ trả {c,pts,kind,hw} làm rơi chúng)
    return { ...r, pts: P, kind: b.kind, hw };
  });
}
