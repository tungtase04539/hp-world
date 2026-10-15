// spawn_check.mjs — the acceptance check for a spawn point, shared by server/scripts/gen_spawns.mjs and the spawn test.
// A point passes when it is: inside PLAY_RADIUS (with margin), on land (js/terrain.js isWater false, ground ~LAND_H,
// no water within 3 m), on the sidewalk/road corridor of a non-elevated ROADS_DT way, away from bridge ways, and
// outside every real building footprint (js/buildings_real.js) by at least 1 m.
import { isWater, groundHeight, ROADS_DT, ELEVATED_RI, BRIDGE_WAYS } from '../../../js/terrain.js';
import { roadHW, sidewalkW } from '../../../js/xsection.js';
import { decodeRB } from '../../../js/buildings_data.js';
import { RB_B64 } from '../../../js/buildings_real.js';
import { PLAY_RADIUS } from '../../../js/shared/constants.js';

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function makeSpawnChecker() {
  const D = decodeRB(RB_B64);
  // bbox per building for a fast prefilter
  const n = D.nB;
  const bb = new Float32Array(n * 4);
  for (let b = 0; b < n; b++) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) {
      const x = D.x[v], z = D.z[v];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    bb[b * 4] = x0; bb[b * 4 + 1] = z0; bb[b * 4 + 2] = x1; bb[b * 4 + 3] = z1;
  }
  function building(x, z, clear) {
    for (let b = 0; b < n; b++) {
      if (D.dead && D.dead[b]) continue;
      if (x < bb[b * 4] - clear || x > bb[b * 4 + 2] + clear || z < bb[b * 4 + 1] - clear || z > bb[b * 4 + 3] + clear) continue;
      const s = D.vStart[b], e = D.vStart[b + 1];
      let inside = false, dmin = Infinity;
      for (let i = s, j = e - 1; i < e; j = i++) {
        const xi = D.x[i], zi = D.z[i], xj = D.x[j], zj = D.z[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        const d = segDist(x, z, xi, zi, xj, zj);
        if (d < dmin) dmin = d;
      }
      if (inside || dmin < clear) return b;
    }
    return -1;
  }
  return function check(x, z) {
    const reasons = [];
    const r = Math.hypot(x, z);
    if (r > PLAY_RADIUS - 20) reasons.push('outside_play_radius');
    if (isWater(x, z)) reasons.push('water');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (isWater(x + 3 * Math.cos(a), z + 3 * Math.sin(a))) { reasons.push('water_near'); break; }
    }
    const h = groundHeight(x, z);
    if (!(h > 1.9 && h < 2.6)) reasons.push('ground_h_' + h.toFixed(2));
    let road = -1, roadD = Infinity;
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      if (ELEVATED_RI.has(ri)) continue;
      const w = ROADS_DT[ri], P = w.pts, lim = roadHW(w) + sidewalkW(w) + 0.5;
      for (let i = 0; i + 1 < P.length; i++) {
        const d = segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
        if (d <= lim && d < roadD) { roadD = d; road = ri; }
      }
    }
    if (road < 0) reasons.push('not_near_road');
    for (const bw of BRIDGE_WAYS || []) {
      const P = bw.pts;
      for (let i = 0; i + 1 < P.length; i++) {
        if (segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]) < 20) { reasons.push('near_bridge'); i = P.length; }
      }
      if (reasons.includes('near_bridge')) break;
    }
    const b = building(x, z, 1.0);
    if (b >= 0) reasons.push('building_' + b);
    return { ok: reasons.length === 0, reasons, road, roadD };
  };
}
