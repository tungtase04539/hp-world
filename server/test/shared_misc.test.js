// quant.js, grid.js, clock.js, textfilter.js (API stub) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../js/shared/quant.js';
import * as G from '../../js/shared/grid.js';
import { ClockSync, dayTAt, nextDayT } from '../../js/shared/clock.js';
import { filterChat, checkNickname, normalize, FILTER_VERSION, setLists } from '../../js/shared/textfilter.js';
import { PLAY_RADIUS, DAY_LENGTH } from '../../js/shared/constants.js';

test('quant: ranges, clamping, NaN', () => {
  assert.equal(Q.qPos(Q.POS_MIN), 0);
  assert.equal(Q.qPos(1e9), 65535);
  assert.equal(Q.qPos(-1e9), 0);
  assert.equal(Q.dqPos(Q.qPos(0)), 0);
  assert.equal(Q.qPos(NaN), 32768);
  assert.ok(Q.POS_MAX > PLAY_RADIUS && -Q.POS_MIN > PLAY_RADIUS);
  assert.equal(Q.qY(-5), 0); assert.equal(Q.qY(100), 255); assert.equal(Q.dqY(Q.qY(2.25)), 2.25);
  assert.equal(Q.qSpd(16), 128); assert.equal(Q.dqSpd(128), 16); assert.equal(Q.qSpd(99), 255);
  assert.equal(Q.qVel(-100), -128); assert.equal(Q.qVel(100), 127);
  assert.equal(Q.qYaw(Infinity), 0);
  for (let a = -10; a < 10; a += 0.37) {
    const d = Math.abs(Q.angleDiff(Q.dqYaw(Q.qYaw(a)), a));
    assert.ok(d <= Math.PI / 256 + 1e-9, `yaw ${a}`);
  }
  assert.ok(Q.dqYaw(128) === -Math.PI);
  const s = Q.packState(6, 31);
  assert.equal(Q.stateMode(s), 6); assert.equal(Q.stateFlags(s), 31);
});

test('grid: ids, bounds, neighbours, hysteresis', () => {
  assert.equal(G.CELL_COUNT, 625);
  const id = G.cellOf(0, 0);
  assert.equal(G.cellCX(id), 12); assert.equal(G.cellCZ(id), 12);
  const b = G.cellBounds(id);
  assert.ok(b[0] <= 0 && 0 < b[2] && b[1] <= 0 && 0 < b[3]);
  assert.equal(G.cellOf(-5000, -5000), 0);
  assert.equal(G.cellOf(5000, 5000), 624);
  const out = new Int32Array(9);
  assert.equal(G.neighbors(id, out), 9);
  assert.equal(out[0], id);
  assert.equal(G.neighbors(0, out), 4);
  assert.equal(G.neighbors(12, out), 6);
  const nn = G.neighbors(id, out);
  for (let i = 0; i < nn; i++) assert.ok(G.areNeighbors(id, out[i]));
  assert.ok(!G.areNeighbors(0, 2));
  // every point of the play disc is inside the grid
  for (let a = 0; a < Math.PI * 2; a += 0.01) assert.ok(G.inGrid(Math.cos(a) * PLAY_RADIUS, Math.sin(a) * PLAY_RADIUS));
  // hysteresis: crossing an edge by < 8 m keeps the old cell, > 8 m switches
  const [x0] = G.cellBounds(id);
  assert.equal(G.cellWithHysteresis(id, x0 - 5, 10), id);
  assert.notEqual(G.cellWithHysteresis(id, x0 - 9, 10), id);
  assert.equal(G.cellWithHysteresis(-1, 0, 0), id);
});

test('clock: converges on the true offset with jitter and spikes', () => {
  const c = new ClockSync();
  const trueOff = 1_790_000_000_000 - 5_000;
  let local = 5_000;
  let seed = 1;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const up = 20 + r() * 10 + (i % 7 === 0 ? 300 : 0);   // asymmetric spikes every 7th sample
    const down = 20 + r() * 10;
    const sent = local;
    const server = sent + up + trueOff;
    const recv = sent + up + down;
    c.addSample(sent, server, recv);
    local = recv + 1000;
  }
  assert.ok(Math.abs(c.target - trueOff) < 8, `offset error ${c.target - trueOff}`);
  assert.ok(c.rttMin >= 40 && c.rttMin < 61);
  // slewing: a 500 ms target change is applied gradually (≤ 0.5 % of elapsed)
  const before = c.serverNow(local);
  c.target += 500;
  const after = c.serverNow(local + 1000);
  assert.ok(after - before - 1000 <= 5.0001, `slew too fast ${after - before - 1000}`);
  // > 1 s error snaps
  c.target += 5000;
  const snapped = c.serverNow(local + 2000);
  assert.ok(Math.abs(snapped - (local + 2000 + c.target)) < 1e-6);
  assert.ok(Number.isNaN(new ClockSync().serverNow(1)));
  assert.ok(Number.isNaN(c.addSample(10, 1, 5)));   // negative RTT ignored
});

test('clock: dayTAt', () => {
  const epoch = 1_767_225_600_000;
  assert.ok(Math.abs(dayTAt(epoch, epoch) - 9 / 24) < 1e-12);
  assert.ok(Math.abs(dayTAt(epoch + DAY_LENGTH * 1000, epoch) - 9 / 24) < 1e-9);
  assert.ok(Math.abs(dayTAt(epoch + DAY_LENGTH * 500, epoch) - 21 / 24) < 1e-9);
  const t = dayTAt(epoch - 1000, epoch);
  assert.ok(t >= 0 && t < 1);
  const n = nextDayT(epoch, epoch, 0.5);
  assert.ok(Math.abs(dayTAt(n, epoch) - 0.5) < 1e-9 && n > epoch);
});

test('textfilter: final API shape (stub implementation)', () => {
  assert.equal(typeof FILTER_VERSION, 'number');
  const ok = filterChat('  xin​   chào bạn ');
  assert.deepEqual(Object.keys(ok).sort(), ['action', 'ok', 'reasons', 'text']);
  assert.equal(ok.ok, true); assert.equal(ok.action, 'pass'); assert.equal(ok.text, 'xin chào bạn');
  assert.ok(ok.reasons.includes('control'));
  assert.deepEqual(filterChat('   ').reasons, ['empty']);
  const long = filterChat('a'.repeat(141));
  assert.equal(long.ok, false); assert.equal(long.action, 'block');
  assert.equal(filterChat('a'.repeat(141), { maxChars: 200 }).ok, true);
  assert.ok(['pass', 'mask', 'block', 'flag'].includes(filterChat('hello').action));
  assert.equal(normalize('á'), 'á');
  const n = (s) => checkNickname(s);
  assert.deepEqual(n('Tùng Hải Phòng'), { ok: true, reason: null });
  assert.equal(n('ab').reason, 'length');
  assert.equal(n('x'.repeat(17)).reason, 'length');
  assert.equal(n('bad<script>').reason, 'chars');
  assert.equal(n('Admin').reason, 'reserved');
  assert.equal(n('Quản Trị').reason, 'reserved');
  assert.equal(n('quan_tri').reason, 'reserved');
  assert.equal(n('He thong 1').reason, 'reserved');
  assert.equal(n('VIETTEL').reason, 'brand');
  setLists({ reserved: ['admin', 'bot ma'] });
  assert.equal(n('Bot Ma').reason, 'reserved');
  setLists({ reserved: ['admin', 'administrator', 'gm', 'mod', 'moderator', 'quan tri', 'he thong', 'chu server', 'system', 'server', 'staff'] });
});
