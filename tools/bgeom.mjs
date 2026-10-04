// bgeom.mjs — hình học đa giác 2D cho tools/process_buildings.mjs (toạ độ game x đông, z nam, mét).
// Không phụ thuộc thư viện ngoài. Đa giác = mảng [[x,z],...] KHÔNG lặp điểm đầu.
// Quy ước diện tích có dấu giống js/buildings_data.js: S = Σ(x_i·z_{i+1} − x_{i+1}·z_i)/2; S < 0 = thứ tự "tường ra ngoài".

export function signedArea(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export const absArea = (P) => Math.abs(signedArea(P));
export const outward = (P) => (signedArea(P) > 0 ? P.slice().reverse() : P);

// tâm diện tích (fallback trung bình đỉnh khi suy biến)
export function centroid(P) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % n], c = x0 * z1 - x1 * z0;
    a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-9) { let sx = 0, sz = 0; for (const [x, z] of P) { sx += x; sz += z; } return [sx / P.length, sz / P.length]; }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(P) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}

export function pointInPoly(P, x, z) {
  let c = false;
  for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

// khoảng cách điểm → biên đa giác
export function polyEdgeDist(P, x, z) {
  let d = Infinity;
  for (let i = 0, n = P.length; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; d = Math.min(d, segDist(x, z, a[0], a[1], b[0], b[1])); }
  return d;
}

// Bỏ đỉnh trùng (< eps), đỉnh thẳng hàng (lệch < colTol m khỏi dây cung), gai nhọn ngược chiều.
export function cleanPoly(P, eps = 0.05, colTol = 0.04) {
  let Q = [];
  for (const p of P) { const q = Q[Q.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) Q.push(p); }
  while (Q.length > 1 && Math.hypot(Q[0][0] - Q[Q.length - 1][0], Q[0][1] - Q[Q.length - 1][1]) <= eps) Q.pop();
  let changed = true;
  while (changed && Q.length > 3) {
    changed = false;
    for (let i = 0; i < Q.length && Q.length > 3; i++) {
      const a = Q[(i + Q.length - 1) % Q.length], b = Q[i], c = Q[(i + 1) % Q.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
      // khoảng cách b tới đường a-c (cả trường hợp gai: b nằm ngoài đoạn a-c → dùng segDist)
      const d = L < 1e-9 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : segDist(b[0], b[1], a[0], a[1], c[0], c[1]);
      if (d < colTol) { Q.splice(i, 1); i--; changed = true; }
    }
  }
  return Q;
}

function segInter(a, b, c, d) {
  const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = d[0] - c[0], d2z = d[1] - c[1];
  const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * d2z - (c[1] - a[1]) * d2x) / den, u = ((c[0] - a[0]) * d1z - (c[1] - a[1]) * d1x) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}
// đa giác đơn (không cạnh nào cắt nhau, trừ cạnh kề)
export function isSimple(P) {
  const n = P.length; if (n < 3) return false;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segInter(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return true;
}

// Cắt đa giác (đơn, có thể lõm) bởi nửa mặt phẳng GIỮ {nx·x + nz·z ≥ c}. Trả về MẢNG đa giác (đa giác lõm có thể
// vỡ thành nhiều mảnh: ghép cặp giao điểm theo thứ tự dọc đường cắt — thuật toán chuẩn cho đa giác đơn).
export function clipHalf(P, nx, nz, c) {
  const n = P.length; if (n < 3) return [];
  const f = P.map(([x, z]) => { const v = nx * x + nz * z - c; return Math.abs(v) < 1e-9 ? 1e-9 : v; });
  let allIn = true, allOut = true;
  for (const v of f) { if (v < 0) allIn = false; else allOut = false; }
  if (allIn) return [P.slice()];
  if (allOut) return [];
  // dựng vòng đỉnh có chèn giao điểm; đánh dấu giao điểm "vào" (out→in) và "ra" (in→out)
  const V = [];   // {p, inside, cross: 0|'in'|'out', t}
  const ux = -nz, uz = nx;   // hướng dọc đường cắt
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], fa = f[i], fb = f[(i + 1) % n];
    V.push({ p: a, inside: fa > 0 });
    if ((fa > 0) !== (fb > 0)) {
      const t = fa / (fa - fb), p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      V.push({ p, inside: true, cross: fa > 0 ? 'out' : 'in', t: p[0] * ux + p[1] * uz });
    }
  }
  const crosses = V.map((v, i) => (v.cross ? i : -1)).filter((i) => i >= 0);
  if (crosses.length === 2) {
    // 1 mảnh: đi từ giao điểm 'in' qua các đỉnh trong tới giao 'out'
    const out = [];
    const s = crosses.find((i) => V[i].cross === 'in');
    for (let k = 0; k < V.length; k++) { const v = V[(s + k) % V.length]; if (v.inside) out.push(v.p); if (v.cross === 'out' && k > 0) break; }
    return out.length >= 3 ? [out] : [];
  }
  // nhiều mảnh: sắp giao điểm theo t, ghép cặp (0,1),(2,3)... — mỗi cặp là 1 đoạn đường cắt nằm TRONG đa giác
  const sorted = crosses.slice().sort((i, j) => V[i].t - V[j].t);
  const partner = new Map();
  for (let k = 0; k + 1 < sorted.length; k += 2) { partner.set(sorted[k], sorted[k + 1]); partner.set(sorted[k + 1], sorted[k]); }
  const used = new Set(), res = [];
  for (const s0 of crosses) {
    if (V[s0].cross !== 'in' || used.has(s0)) continue;
    const poly = []; let i = s0, guard = 0, closed = false;
    while (guard++ < 4 * V.length) {
      used.add(i); poly.push(V[i].p);
      if (V[i].cross === 'out') {   // nhảy dọc đường cắt tới giao điểm cặp (phải là 1 giao 'in')
        const j = partner.get(i);
        // ghép cặp hỏng (đỉnh chạm đúng đường cắt → thứ tự t suy biến): bỏ mảnh. Trước đây mảnh vẫn được nhận →
        // vòng 'out'↔'out' nảy qua lại tới hết guard, đẻ đa giác răng cưa 52 đỉnh diện tích 0 (gặp 1 lần ở x −1606).
        if (j === undefined || V[j].cross !== 'in') break;
        if (j === s0) { closed = true; break; }
        i = j; continue;
      }
      i = (i + 1) % V.length;
      if (i === s0) { closed = true; break; }
    }
    if (closed && poly.length >= 3) res.push(poly);
  }
  return res;
}

// Giao với dải a ≤ u·p ≤ b
export function clipStrip(P, ux, uz, a, b) {
  const out = [];
  for (const Q of clipHalf(P, ux, uz, a)) for (const R of clipHalf(Q, -ux, -uz, -b)) out.push(R);
  return out;
}

// Hình chữ nhật diện tích nhỏ nhất (theo các hướng cạnh): {ux,uz (trục dài), u0,u1,v0,v1, w (dài), d (rộng)}
export function minRect(P) {
  let best = null;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of P) { const u = x * ux + z * uz, v = -x * uz + z * ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  if (best.u1 - best.u0 < best.v1 - best.v0) {   // trục dài = u
    best = { A: best.A, ux: -best.uz, uz: best.ux, u0: best.v0, u1: best.v1, v0: -best.u1, v1: -best.u0 };
  }
  best.w = best.u1 - best.u0; best.d = best.v1 - best.v0;
  return best;
}

// Lưới không gian động: id → bbox; query bbox
export class Grid {
  constructor(cell = 16) { this.cell = cell; this.m = new Map(); this.bb = new Map(); }
  _keys(bb, cb) {
    const c = this.cell;
    for (let i = Math.floor(bb[0] / c); i <= Math.floor(bb[2] / c); i++)
      for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) cb((i + 8192) * 16384 + (j + 8192));
  }
  insert(id, bb) {
    this.bb.set(id, bb);
    this._keys(bb, (k) => { let s = this.m.get(k); if (!s) this.m.set(k, (s = new Set())); s.add(id); });
  }
  remove(id) {
    const bb = this.bb.get(id); if (!bb) return;
    this._keys(bb, (k) => { const s = this.m.get(k); if (s) s.delete(id); });
    this.bb.delete(id);
  }
  update(id, bb) { this.remove(id); this.insert(id, bb); }
  query(bb, cb) {
    const seen = new Set();
    this._keys(bb, (k) => {
      const s = this.m.get(k); if (!s) return;
      for (const id of s) {
        if (seen.has(id)) continue; seen.add(id);
        const b = this.bb.get(id);
        if (b[0] > bb[2] || b[2] < bb[0] || b[1] > bb[3] || b[3] < bb[1]) continue;
        cb(id);
      }
    });
  }
}

// Diện tích giao xấp xỉ bằng lấy mẫu lưới (đủ chính xác cho quyết định trùng lặp/che phủ)
export function overlapArea(A, B, step = 0.35) {
  const a = bbox(A), b = bbox(B);
  const x0 = Math.max(a[0], b[0]), z0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), z1 = Math.min(a[3], b[3]);
  if (x0 >= x1 || z0 >= z1) return 0;
  let hit = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step)
    if (pointInPoly(A, x, z) && pointInPoly(B, x, z)) hit++;
  return hit * step * step;
}

// hash/RNG ổn định
export function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909); s ^= s >>> 16; s >>>= 0; s = (s + 0x6d2b79f5) >>> 0; return s / 4294967296; };
}
export const pickW = (r, w) => { let t = r * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; } return w.length - 1; };
