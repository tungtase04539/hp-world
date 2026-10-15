// server/bots/lib/roadgraph.mjs — walkable graph from the real street network (js/mapdata.js ROADS_DT) for the bots.
// Nodes = way vertices merged at 0.5 m; edges = consecutive vertices of a way. Dropped: elevated bridge ways (deck
// height ≠ ground), any segment that touches water (sampled every 4 m with js/terrain.js isWater) and anything outside
// PLAY_RADIUS − 20 m (= SPAWN_MAX_R). Only the largest connected component is kept so every bot can reach every node.
// Walker: follows edges, picks a random next edge at junctions (no U-turn unless a dead end), optional A* goal.
import { ROADS_DT, ELEVATED_RI, isWater, groundHeight, EXTRAS } from '../../../js/terrain.js';
import { PLAY_RADIUS } from '../../../js/shared/constants.js';

const KEY = (x, z) => Math.round(x * 2) + ',' + Math.round(z * 2);
const BUCKET = 32;

let cached = null;

export function buildRoadGraph({ margin = 20, waterStep = 4, snap = 8 } = {}) {
  if (cached) return cached;
  const t0 = performance.now();
  const rMax = PLAY_RADIUS - margin;
  const ids = new Map();
  const xs = [], zs = [], adj = [];
  const node = (x, z) => {
    const k = KEY(x, z);
    let i = ids.get(k);
    if (i === undefined) { i = xs.length; ids.set(k, i); xs.push(x); zs.push(z); adj.push([]); }
    return i;
  };
  const wet = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / waterStep));
    for (let s = 0; s <= n; s++) { const t = s / n; if (isWater(ax + (bx - ax) * t, az + (bz - az) * t)) return true; }
    return false;
  };
  // pass A: kept segments
  const S = [];        // [ax, az, bx, bz]
  let dropped = 0;
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    if (ELEVATED_RI.has(ri)) continue;
    const P = ROADS_DT[ri].pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.25) continue;
      if (Math.hypot(ax, az) > rMax || Math.hypot(bx, bz) > rMax || wet(ax, az, bx, bz)) { dropped++; continue; }
      S.push([ax, az, bx, bz]);
    }
  }
  // pass B: T-junctions. OSM ways often end ON another way's segment interior (no shared vertex) → split that segment
  // at the projection of every dead-end vertex within `snap` metres and add a short connector.
  const deg = new Map();
  for (const [ax, az, bx, bz] of S) { const a = KEY(ax, az), b = KEY(bx, bz); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  const SB = 24, segB = new Map();
  S.forEach((s, si) => {
    const x0 = Math.floor(Math.min(s[0], s[2]) / SB), x1 = Math.floor(Math.max(s[0], s[2]) / SB);
    const z0 = Math.floor(Math.min(s[1], s[3]) / SB), z1 = Math.floor(Math.max(s[1], s[3]) / SB);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) { const k = bx + ':' + bz; let b = segB.get(k); if (!b) segB.set(k, (b = [])); b.push(si); }
  });
  const splits = new Map();   // si → [t...]
  const extra = [];           // connector segments
  const seen = new Set();
  for (const s of S) for (const [px, pz] of [[s[0], s[1]], [s[2], s[3]]]) {
    const k = KEY(px, pz);
    if (deg.get(k) !== 1 || seen.has(k)) continue;
    seen.add(k);
    let best = null;
    const bx0 = Math.floor(px / SB), bz0 = Math.floor(pz / SB);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const si of segB.get((bx0 + dx) + ':' + (bz0 + dz)) || []) {
        const [ax, az, bx, bz] = S[si];
        if (KEY(ax, az) === k || KEY(bx, bz) === k) continue;
        const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
        let t = ((px - ax) * ux + (pz - az) * uz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ux * t, qz = az + uz * t, d = Math.hypot(px - qx, pz - qz);
        if (d <= snap && (!best || d < best.d)) best = { d, si, t, qx, qz };
      }
    }
    if (!best) continue;
    const sg = S[best.si];
    const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
    if (best.t * L > 0.5 && (1 - best.t) * L > 0.5) { let a = splits.get(best.si); if (!a) splits.set(best.si, (a = [])); a.push(best.t); }
    else if (best.t * L <= 0.5) { best.qx = sg[0]; best.qz = sg[1]; }
    else { best.qx = sg[2]; best.qz = sg[3]; }
    if (Math.hypot(px - best.qx, pz - best.qz) > 0.25 && !wet(px, pz, best.qx, best.qz)) extra.push([px, pz, best.qx, best.qz]);
  }
  let segs = 0;
  const junctions = extra.length;
  const addEdge = (ax, az, bx, bz) => {
    const a = node(ax, az), b = node(bx, bz);
    if (a === b) return;
    const L = Math.hypot(bx - ax, bz - az);
    adj[a].push(b, L); adj[b].push(a, L); segs++;
  };
  S.forEach((s, si) => {
    const ts = (splits.get(si) || []).sort((a, b) => a - b);
    let px = s[0], pz = s[1];
    for (const t of ts) { const qx = s[0] + (s[2] - s[0]) * t, qz = s[1] + (s[3] - s[1]) * t; addEdge(px, pz, qx, qz); px = qx; pz = qz; }
    addEdge(px, pz, s[2], s[3]);
  });
  for (const e of extra) addEdge(e[0], e[1], e[2], e[3]);
  // largest connected component
  const comp = new Int32Array(xs.length).fill(-1);
  let best = -1, bestSize = 0, nc = 0;
  for (let s = 0; s < xs.length; s++) {
    if (comp[s] >= 0 || !adj[s].length) continue;
    let size = 0;
    const st = [s]; comp[s] = nc;
    while (st.length) {
      const u = st.pop(); size++;
      const A = adj[u];
      for (let k = 0; k < A.length; k += 2) if (comp[A[k]] < 0) { comp[A[k]] = nc; st.push(A[k]); }
    }
    if (size > bestSize) { bestSize = size; best = nc; }
    nc++;
  }
  // re-index the kept component
  const remap = new Int32Array(xs.length).fill(-1);
  const X = [], Z = [], ADJ = [];
  for (let i = 0; i < xs.length; i++) if (comp[i] === best) { remap[i] = X.length; X.push(xs[i]); Z.push(zs[i]); }
  for (let i = 0; i < xs.length; i++) {
    if (remap[i] < 0) continue;
    const A = adj[i], out = [];
    for (let k = 0; k < A.length; k += 2) out.push(remap[A[k]], A[k + 1]);
    ADJ.push(out);
  }
  let totalLen = 0;
  for (const A of ADJ) for (let k = 1; k < A.length; k += 2) totalLen += A[k];
  const buckets = new Map();
  for (let i = 0; i < X.length; i++) {
    const k = Math.floor(X[i] / BUCKET) + ':' + Math.floor(Z[i] / BUCKET);
    let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(i);
  }
  const g = {
    x: Float64Array.from(X), z: Float64Array.from(Z), adj: ADJ,
    nodes: X.length, lengthM: Math.round(totalLen / 2), segments: segs, droppedSegments: dropped, tJunctions: junctions, components: nc,
    buildMs: Math.round(performance.now() - t0),
    nearest(x, z) {
      const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
      for (let r = 0; r < 60; r++) {
        let bi = -1, bd = Infinity;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const b = buckets.get((bx + dx) + ':' + (bz + dz));
          if (!b) continue;
          for (const i of b) { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
        }
        if (bi >= 0 && Math.sqrt(bd) <= r * BUCKET) return bi;
        if (bi >= 0 && r > 0) return bi;
      }
      return 0;
    },
    // nearest node reachable by a DRY straight line from (x, z) (sampled every 2 m) — a bot placed at a saved position on
    // a lake shore must not walk across the water to the closest node on the far bank (the server corrects / kicks it;
    // a real client cannot walk on water). Falls back to nearest() when no dry candidate exists within 400 m.
    nearestDry(x, z) {
      const cand = [];
      const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET), R = Math.ceil(400 / BUCKET);
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        const b = buckets.get((bx + dx) + ':' + (bz + dz));
        if (b) for (const i of b) cand.push([Math.hypot(this.x[i] - x, this.z[i] - z), i]);
      }
      cand.sort((p, q) => p[0] - q[0]);
      // bounded cost: at most the 24 nearest nodes are tried (a position with water all around, e.g. a pier, would
      // otherwise test every node within 400 m × up to 200 isWater samples and stall a whole bot worker)
      let tries = 0;
      for (const [d, i] of cand) {
        if (d > 400 || ++tries > 24) break;
        const n = Math.max(1, Math.ceil(d / 2));
        let dry = true;
        for (let s = 1; s < n && dry; s++) { const f = s / n; if (isWater(x + (this.x[i] - x) * f, z + (this.z[i] - z) * f)) dry = false; }
        if (dry) return i;
      }
      return this.nearest(x, z);
    },
    // A* shortest path (node list, inclusive) from a to b; null if unreachable
    path(a, b) {
      if (a === b) return [a];
      const n = this.nodes, gS = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
      const h = (i) => Math.hypot(this.x[i] - this.x[b], this.z[i] - this.z[b]);
      const heap = [];   // [f, node] binary heap
      const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      gS[a] = 0; push(h(a), a);
      while (heap.length) {
        const [, u] = pop();
        if (closed[u]) continue;
        if (u === b) break;
        closed[u] = 1;
        const A = this.adj[u];
        for (let k = 0; k < A.length; k += 2) {
          const v = A[k], ng = gS[u] + A[k + 1];
          if (ng < gS[v]) { gS[v] = ng; prev[v] = u; push(ng + h(v), v); }
        }
      }
      if (!Number.isFinite(gS[b])) return null;
      const out = [];
      for (let u = b; u >= 0; u = prev[u]) out.push(u);
      return out.reverse();
    },
  };
  cached = g;
  return g;
}

export { isWater, groundHeight, EXTRAS };

// Moves a point along the graph. Position = (x, z); heading in yaw (0 = +Z, atan2(dx, dz) like main.js).
export class Walker {
  constructor(g, rand, x, z) {
    this.g = g; this.rand = rand;
    this.x = x; this.z = z; this.yaw = 0;
    this.prev = -1;
    // first walk straight to the nearest node reachable without crossing water (sidewalk spawn: a few metres)
    this.to = typeof g.nearestDry === 'function' ? g.nearestDry(x, z) : g.nearest(x, z);
    this.route = null;           // optional list of nodes to follow (A*)
    this.leash = null;           // {x, z, r}: prefer staying within r of (x, z) when wandering
  }
  goTo(x, z) {
    const target = this.g.nearest(x, z);
    const p = this.g.path(this.to, target);
    this.route = p && p.length > 1 ? p.slice(1) : null;
    return !!this.route;
  }
  _pickNext(at) {
    const g = this.g;
    if (this.route && this.route.length) {
      if (this.route[0] === at) this.route.shift();
      if (this.route.length) return this.route.shift();
      this.route = null;
    }
    const A = g.adj[at];
    const opts = [];
    for (let k = 0; k < A.length; k += 2) if (A[k] !== this.prev) opts.push(A[k]);
    if (!opts.length) return this.prev >= 0 ? this.prev : at;
    if (this.leash) {
      const inside = opts.filter((v) => Math.hypot(g.x[v] - this.leash.x, g.z[v] - this.leash.z) <= this.leash.r);
      if (inside.length) return inside[Math.floor(this.rand() * inside.length)];
      // all exits leave the leash: head back toward its centre
      let bv = opts[0], bd = Infinity;
      for (const v of opts) { const d = Math.hypot(g.x[v] - this.leash.x, g.z[v] - this.leash.z); if (d < bd) { bd = d; bv = v; } }
      return bv;
    }
    return opts[Math.floor(this.rand() * opts.length)];
  }
  // advance by `dist` metres; returns the distance actually moved
  step(dist) {
    const g = this.g;
    let moved = 0, guard = 0;
    while (dist > 1e-6 && guard++ < 64) {
      const tx = g.x[this.to], tz = g.z[this.to];
      const dx = tx - this.x, dz = tz - this.z, L = Math.hypot(dx, dz);
      if (L > 1e-6) this.yaw = Math.atan2(dx, dz);
      if (L <= dist) {
        this.x = tx; this.z = tz; dist -= L; moved += L;
        const at = this.to;
        this.to = this._pickNext(at);
        this.prev = at;
        if (this.to === at) break;
      } else {
        this.x += (dx / L) * dist; this.z += (dz / L) * dist; moved += dist; dist = 0;
      }
    }
    return moved;
  }
  get routing() { return !!(this.route && this.route.length); }
}
