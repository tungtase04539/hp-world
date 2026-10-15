// gen_spawns.mjs — find sidewalk spawn points near named places and print them for js/shared/spawns.js.
// Usage: node server/scripts/gen_spawns.mjs
// For each target, scan ROADS_DT ways (not elevated bridge ways) within SEARCH_R of the target, place a candidate on the
// sidewalk centre (road half width + half sidewalk width off the centre line), and keep the candidate closest to the
// target that passes every check in js/shared/spawn_check.mjs (land, not water, inside PLAY_RADIUS, outside footprints).
import { ROADS_DT, ELEVATED_RI, EXTRAS, LM } from '../../js/terrain.js';
import { roadHW, sidewalkW } from '../../js/xsection.js';
import { makeSpawnChecker } from '../test/helpers/spawn_check.mjs';

const TARGETS = [
  { id: 'opera', name: 'Quảng trường Nhà hát lớn', at: [EXTRAS.square[0] - 5, EXTRAS.square[1] + 23] },
  { id: 'buudien', name: 'Bưu điện thành phố', at: LM.postoffice },
  { id: 'tambac', name: 'Hồ Tam Bạc', at: [LM.lake[0] + 110, LM.lake[1] + 20] },
  { id: 'chosat', name: 'Chợ Sắt', at: [LM.market[0] - 40, LM.market[1] - 60] },
  { id: 'ga', name: 'Ga Hải Phòng', at: LM.station },
  { id: 'lachtray', name: 'Phố Lạch Tray', at: [957, 1151] },
  { id: 'chuahang', name: 'Chùa Hàng', at: LM.chuahang },
  { id: 'nhatho', name: 'Nhà thờ lớn', at: LM.cathedral },
];
const SEARCH_R = 140;

const check = makeSpawnChecker();
const out = [];
for (const t of TARGETS) {
  let best = null;
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const r = ROADS_DT[ri];
    if (ELEVATED_RI.has(ri)) continue;
    const sw = sidewalkW(r);
    if (!(sw > 0)) continue;
    const off = roadHW(r) + sw * 0.5;
    const P = r.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let s = 1; s < L - 1; s += 2) {
        const cx = ax + ux * s, cz = az + uz * s;
        if (Math.hypot(cx - t.at[0], cz - t.at[1]) > SEARCH_R) continue;
        for (const side of [1, -1]) {
          const x = Math.round((cx - uz * off * side) * 10) / 10, z = Math.round((cz + ux * off * side) * 10) / 10;
          const d = Math.hypot(x - t.at[0], z - t.at[1]);
          if (best && d >= best.d) continue;
          const yaw = Math.atan2(ux * side, uz * side);
          const res = check(x, z);
          if (!res.ok) continue;
          best = { d, x, z, yaw: Math.round(yaw * 100) / 100, ri };
        }
      }
    }
  }
  if (!best) { console.error('no spawn for', t.id); continue; }
  out.push({ id: t.id, name: t.name, x: best.x, z: best.z, yaw: best.yaw, ri: best.ri, d: Math.round(best.d) });
}
for (const s of out) console.log(JSON.stringify(s));
let minD = Infinity;
for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
  const d = Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z);
  if (d < minD) minD = d;
}
console.log('min pairwise distance', Math.round(minD));
