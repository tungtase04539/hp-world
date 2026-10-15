// Spawn points re-verified against the CURRENT terrain / map / building data (the graphics workflow regenerates
// those files; if a spawn now sits in water or inside a building, regenerate with server/scripts/gen_spawns.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPAWNS, pickSpawn, nearestSpawn, SPAWN_JITTER_M } from '../../js/shared/spawns.js';
import { makeSpawnChecker } from './helpers/spawn_check.mjs';

test('6–8 spawn points, spread ≥ 250 m apart', () => {
  assert.ok(SPAWNS.length >= 6 && SPAWNS.length <= 8);
  const ids = new Set(SPAWNS.map((s) => s.id));
  assert.equal(ids.size, SPAWNS.length);
  for (let i = 0; i < SPAWNS.length; i++) for (let j = i + 1; j < SPAWNS.length; j++) {
    const d = Math.hypot(SPAWNS[i].x - SPAWNS[j].x, SPAWNS[i].z - SPAWNS[j].z);
    assert.ok(d >= 250, `${SPAWNS[i].id} – ${SPAWNS[j].id} only ${d.toFixed(0)} m apart`);
  }
});

test('every spawn (and its jitter extremes) is on land, near a street, inside the play disc, outside buildings', () => {
  const check = makeSpawnChecker();
  for (const s of SPAWNS) {
    for (const j of [0, -SPAWN_JITTER_M, SPAWN_JITTER_M]) {
      const x = s.x + Math.sin(s.yaw) * j, z = s.z + Math.cos(s.yaw) * j;
      const r = check(x, z);
      assert.ok(r.ok, `${s.id} (jitter ${j}) fails: ${r.reasons.join(', ')}`);
    }
  }
});

test('pickSpawn chooses the least crowded point', () => {
  const counts = SPAWNS.map(() => 5);
  counts[3] = 1;
  const p = pickSpawn(counts, () => 0.5);
  assert.equal(p.index, 3);
  assert.ok(Math.hypot(p.x - SPAWNS[3].x, p.z - SPAWNS[3].z) <= SPAWN_JITTER_M + 1e-9);
  const seen = new Set();
  let s = 1;
  for (let i = 0; i < 400; i++) seen.add(pickSpawn(null, () => ((s = (s * 48271) % 2147483647) / 2147483647)).index);
  assert.equal(seen.size, SPAWNS.length);
  assert.equal(nearestSpawn(SPAWNS[5].x + 1, SPAWNS[5].z), 5);
});
