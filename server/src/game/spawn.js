// game/spawn.js — OWNER: S2. Where a session starts (ARCH §4.6): a returning player at the saved position when it is
// still valid (inside the play disc, on land / a deck — the city data may have changed), else the least crowded of
// the spread spawn points (js/shared/spawns.js) with a small jitter along the street.
import { SPAWNS, pickSpawn } from '../../../js/shared/spawns.js';
import { inPlayDisc, landOk } from '../../../js/shared/move.js';

export const SPAWN_CROWD_R = 40;   // m: players within this radius count as "near" a spawn point

export function savedSpawnOk(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) && inPlayDisc(x, z, -5) && landOk(x, z);
}

// char: {x, z, yaw} | null ; world: World (for crowding) | null → {x, z, yaw, id}
export function chooseSpawn(world, char, rand = Math.random) {
  if (char && savedSpawnOk(char.x, char.z)) return { x: char.x, z: char.z, yaw: Number.isFinite(char.yaw) ? char.yaw : 0, id: 'saved' };
  const counts = world ? world.countNear(SPAWNS, SPAWN_CROWD_R) : null;
  const p = pickSpawn(counts, rand);
  return { x: p.x, z: p.z, yaw: p.yaw, id: p.id };
}
