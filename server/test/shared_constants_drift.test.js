// Drift test: js/shared/constants.js MIRRORS numbers that live in the single-player code (which imports three and
// cannot be imported here). Read the source text and assert the numbers still match. If this fails, a graphics/
// gameplay change moved a movement constant: update js/shared/constants.js (and tell the server owners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEED, ACCEL, JUMP_V, GRAVITY, BUILD_RADIUS, PLAY_RADIUS, DAY_LENGTH } from '../../js/shared/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const num = (re, text, what) => {
  const m = text.match(re);
  assert.ok(m, `pattern for ${what} not found — the source moved; update this test and constants.js together`);
  return Number(m[1]);
};

test('main.js walk/run/gravity/jump', () => {
  const t = src('js/main.js');
  assert.equal(num(/\bWALK\s*=\s*([\d.]+)/, t, 'WALK'), SPEED.walk);
  assert.equal(num(/\bRUN\s*=\s*([\d.]+)/, t, 'RUN'), SPEED.run);
  assert.equal(num(/\bGRAV\s*=\s*([\d.]+)/, t, 'GRAV'), GRAVITY);
  assert.equal(num(/\bJUMP\s*=\s*([\d.]+)/, t, 'JUMP'), JUMP_V);
});

test('main.js PLAY_RADIUS = BUILD_RADIUS - 12', () => {
  const t = src('js/main.js');
  const off = num(/PLAY_RADIUS\s*=\s*BUILD_RADIUS\s*-\s*(\d+)/, t, 'PLAY_RADIUS');
  assert.equal(BUILD_RADIUS - off, PLAY_RADIUS);
});

test('world.js BUILD_RADIUS', () => {
  assert.equal(num(/export\s+const\s+BUILD_RADIUS\s*=\s*(\d+)/, src('js/world.js'), 'BUILD_RADIUS'), BUILD_RADIUS);
});

test('vehicles.js template speeds and accelerations', () => {
  const t = src('js/vehicles.js');
  const tpl = (name) => {
    const m = t.match(new RegExp(`\\b${name}\\s*:\\s*\\{[^}]*?\\bspeed\\s*:\\s*([\\d.]+)[^}]*?\\baccel\\s*:\\s*([\\d.]+)`));
    assert.ok(m, `vehicles.js TEMPLATES.${name} not found`);
    return { speed: Number(m[1]), accel: Number(m[2]) };
  };
  assert.deepEqual(tpl('motorbike'), { speed: SPEED.moto, accel: ACCEL.moto });
  assert.deepEqual(tpl('cyclo'), { speed: SPEED.cyclo, accel: ACCEL.cyclo });
  assert.deepEqual(tpl('boat'), { speed: SPEED.boat, accel: ACCEL.boat });
});

test('daynight.js DAY_LENGTH', () => {
  assert.equal(num(/export\s+const\s+DAY_LENGTH\s*=\s*(\d+)/, src('js/daynight.js'), 'DAY_LENGTH'), DAY_LENGTH);
});
