// S2: AOI (server/src/game/aoi.js) + snapshot encoding (encoder.js) on the World (world.js), without sockets.
// Cap 96, nearest-first with hysteresis, ENTER spread over snapshots, byte budget, priority accumulator fairness,
// LEAVE / re-ENTER, far tier rates, degrade levels, NAMES once per session, keyframes, and a client-side mirror
// that decodes every snapshot and must always agree with the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { AoiState, AoiFrame, aoiStep, levelParams, takeNames, AOI_CFG } from '../src/game/aoi.js';
import { encodeFrame } from '../src/game/encoder.js';
import { DegradeLadder, LADDER } from '../src/game/degrade.js';
import { Writer, SnapshotBuilder, decodeS2C } from '../../js/shared/codec.js';
import { SNAP_FLAG } from '../../js/shared/protocol.js';
import { MODE } from '../../js/shared/constants.js';
import { dqPos } from '../../js/shared/quant.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296); }

function setup(n, spread, seed = 1, cx = 0, cz = 0) {
  const world = new World();
  const r = rng(seed);
  const self = world.createEntity('self');
  self.setPose(cx, cz, 2, 0, 0, MODE.WALK, 0);
  world.add(self);
  const ents = [];
  for (let i = 0; i < n; i++) {
    const e = world.createEntity('a' + i);
    e.name = 'P' + i + '#0001';
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    e.setPose(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 2, a, 3, MODE.WALK, 0);
    world.add(e);
    ents.push(e);
  }
  return { world, self, ents, r };
}
// a decoding client: slot table mirror
class Mirror {
  constructor() { this.slots = new Map(); this.names = new Set(); }
  apply(m) {
    assert.ok(!m.err, 'decode ' + m.err);
    if (m.flags & SNAP_FLAG.KEYFRAME) this.slots.clear();
    for (const s of m.leaves) { assert.ok(this.slots.has(s), 'LEAVE of an unknown slot ' + s); this.slots.delete(s); }
    for (const e of m.enters) { assert.ok(!this.slots.has(e.slot), 'ENTER into a used slot ' + e.slot); this.slots.set(e.slot, { ...e }); }
    for (const u of m.updates) { const cur = this.slots.get(u.slot); assert.ok(cur, 'UPDATE of an unknown slot ' + u.slot); Object.assign(cur, u); }
  }
}
function step(world, self, st, frame, sb, level = 0, over = {}) {
  aoiStep(world, self, st, { ...levelParams(level), ...over }, frame);
  return encodeFrame(sb, 1, self, 0, 0, frame, level > 0);
}

test('hotspot: 300 players within 30 m → cap 96, ENTER ≤ 24 per snapshot, ≤ 1,100 B, nearest kept', () => {
  const { world, self, ents, r } = setup(300, 30);
  const st = new AoiState(), frame = new AoiFrame(), sb = new SnapshotBuilder(new Writer(4096));
  const mirror = new Mirror();
  let maxBytes = 0;
  for (let k = 0; k < 60; k++) {
    for (const e of ents) { e.setPose(e.x + (r() - 0.5) * 0.6, e.z + (r() - 0.5) * 0.6, 2, e.yaw + 0.05, 3, MODE.WALK, 0); world.relocate(e); }
    const bytes = step(world, self, st, frame, sb);
    maxBytes = Math.max(maxBytes, bytes.length);
    assert.ok(bytes.length <= AOI_CFG.BUDGET, `snapshot ${k}: ${bytes.length} B`);
    assert.ok(frame.nEnter <= AOI_CFG.ENTER_MAX);
    assert.ok(frame.nEnter + frame.nUpd <= AOI_CFG.CAP);
    assert.ok(st.visible <= AOI_CFG.CAP);
    mirror.apply(decodeS2C(bytes));
    assert.equal(mirror.slots.size, st.visible);
  }
  assert.equal(st.visible, 96);
  // the visible set is (about) the nearest 96: nothing invisible is much closer than the farthest visible
  const d = (e) => Math.hypot(e.x - self.x, e.z - self.z);
  const vis = new Set([...st.entSlot.keys()]);
  const maxVis = Math.max(...[...vis].map(d));
  const minHidden = Math.min(...ents.filter((e) => !vis.has(e)).map(d));
  assert.ok(minHidden >= maxVis * 0.84, `hidden ${minHidden.toFixed(2)} vs visible ${maxVis.toFixed(2)}`);
  // mirror positions equal the server's quantised positions after the last snapshot (all moved → all updated or deferred)
  let exact = 0;
  for (const [slot, m] of mirror.slots) { const e = st.slotEnt[slot]; if (m.x === dqPos(e.qx) && m.z === dqPos(e.qz)) exact++; assert.equal(m.netId, e.netId); }
  assert.ok(exact >= 90, `exact ${exact}`);
});

test('priority accumulator: under a tight byte budget every visible player is still updated regularly', () => {
  const { world, self, ents } = setup(96, 60, 7);
  const st = new AoiState(), frame = new AoiFrame(), sb = new SnapshotBuilder(new Writer(4096));
  const lastSent = new Map();
  let maxStale = 0;
  for (let k = 0; k < 80; k++) {
    for (const e of ents) { e.setPose(e.x + 0.3, e.z, 2, e.yaw, 3, MODE.WALK, 0); world.relocate(e); }
    step(world, self, st, frame, sb, 0, { budget: 400 });          // ≈ 42 UPDATE records per snapshot
    for (let i = 0; i < frame.nUpd; i++) lastSent.set(st.slotEnt[frame.updSlot[i]], k);
    if (k >= 10) for (const e of ents) { if (!st.entSlot.has(e)) continue; maxStale = Math.max(maxStale, k - (lastSent.get(e) ?? -99)); }
  }
  assert.equal(st.visible, 96);
  assert.ok(maxStale <= 5, `max staleness ${maxStale} snapshots`);
});

test('leave / re-enter, hysteresis, NAMES once per session, idle players cost nothing, keyframe', () => {
  const { world, self, ents } = setup(5, 20, 3);
  const st = new AoiState(), frame = new AoiFrame(), sb = new SnapshotBuilder(new Writer(4096));
  step(world, self, st, frame, sb);
  assert.equal(frame.keyframe, true); assert.equal(frame.nEnter, 5);
  let names = takeNames(st);
  assert.equal(names.length, 5);
  // idle: nothing changes → no records
  step(world, self, st, frame, sb);
  assert.equal(frame.nUpd + frame.nEnter + frame.nLeave, 0);
  // move one to 165 m (inside radius 160 + hysteresis 8): stays visible, far tier
  const e = ents[0];
  e.setPose(165, 0, 2, 0, 3, MODE.WALK, 0); world.relocate(e);
  step(world, self, st, frame, sb);
  assert.ok(st.entSlot.has(e));
  // to 175 m: leaves
  e.setPose(175, 0, 2, 0, 3, MODE.WALK, 0); world.relocate(e);
  step(world, self, st, frame, sb);
  assert.equal(frame.nLeave, 1); assert.ok(!st.entSlot.has(e));
  // a newcomer at 165 m does not enter (only ≤ 160)
  e.setPose(165, 0, 2, 0, 3, MODE.WALK, 0); world.relocate(e);
  step(world, self, st, frame, sb);
  assert.ok(!st.entSlot.has(e));
  // back at 50 m: re-enters, but its NAMES were already sent this session
  e.setPose(50, 0, 2, 0, 3, MODE.WALK, 0); world.relocate(e);
  step(world, self, st, frame, sb);
  assert.ok(st.entSlot.has(e)); assert.equal(frame.nEnter, 1);
  assert.equal(takeNames(st), null);
  // the player disconnects for good and another account gets the same netId → NAMES again
  world.destroy(e);
  step(world, self, st, frame, sb);
  assert.equal(frame.nLeave, 1);
  const e2 = world.createEntity('new');
  world.byNetId.delete(e2.netId); e2.netId = e.netId; world.byNetId.set(e2.netId, e2);
  e2.name = 'New#0002'; e2.setPose(10, 10, 2, 0, 0, MODE.WALK, 0); world.add(e2);
  step(world, self, st, frame, sb);
  names = takeNames(st);
  assert.equal(names.length, 1); assert.equal(names[0], e2);
  // keyframe after a dropped snapshot: everything re-enters, flag set
  st.keyframe = true;
  const bytes = step(world, self, st, frame, sb);
  const m = decodeS2C(bytes);
  assert.ok(m.flags & SNAP_FLAG.KEYFRAME);
  assert.equal(m.enters.length, st.visible);
});

test('far tier 5 Hz (L0) / 2.5 Hz (L1), radius 80 m at L2, thin snapshots at L3', () => {
  const { world, self, ents } = setup(0, 0);
  void ents;
  const mk = (x, z, id) => { const e = world.createEntity(id); e.setPose(x, z, 2, 0, 3, MODE.WALK, 0); world.add(e); return e; };
  const near = mk(30, 0, 'near'), far = mk(140, 0, 'far'), mid = mk(100, 0, 'mid');
  const st = new AoiState(), frame = new AoiFrame(), sb = new SnapshotBuilder(new Writer(4096));
  const count = (level, n) => {
    const c = new Map([[near, 0], [far, 0], [mid, 0]]);
    for (let k = 0; k < n; k++) {
      for (const e of [near, far, mid]) { e.setPose(e.x, e.z + 0.2, 2, 0, 3, MODE.WALK, 0); world.relocate(e); }
      step(world, self, st, frame, sb, level);
      for (let i = 0; i < frame.nUpd; i++) { const e = st.slotEnt[frame.updSlot[i]]; c.set(e, c.get(e) + 1); }
    }
    return c;
  };
  step(world, self, st, frame, sb, 0);   // enter all
  let c = count(0, 40);
  assert.equal(c.get(near), 40); assert.equal(c.get(mid), 40); assert.equal(c.get(far), 20);
  c = count(1, 40);
  assert.equal(c.get(near), 40); assert.equal(c.get(far), 10);
  c = count(2, 4);   // radius 80: mid (100 m) and far leave
  assert.ok(!st.entSlot.has(mid) && !st.entSlot.has(far) && st.entSlot.has(near));
  // L3: with > 16 visible, odd snapshots carry only the 16 nearest
  const crowd = [];
  for (let i = 0; i < 40; i++) crowd.push(mk(5 + i, 1, 'c' + i));
  for (let k = 0; k < 4; k++) step(world, self, st, frame, sb, 3);
  const upd = [];
  for (let k = 0; k < 2; k++) {
    for (const e of crowd) { e.setPose(e.x, e.z + 0.2, 2, 0, 3, MODE.WALK, 0); world.relocate(e); }
    step(world, self, st, frame, sb, 3);
    upd.push(frame.nUpd);
  }
  assert.ok(Math.min(...upd) <= 16 && Math.max(...upd) >= 40, `L3 thin/full ${upd}`);
  assert.ok(levelParams(2).rVis === 80 && levelParams(0).rVis === 160 && levelParams(0).rNear === 120);
});

test('mirror stays consistent over 2,000 random snapshots (moves, joins, leaves, keyframes)', () => {
  const { world, self, ents, r } = setup(150, 200, 11);
  const st = new AoiState(), frame = new AoiFrame(), sb = new SnapshotBuilder(new Writer(4096));
  const mirror = new Mirror();
  const live = new Set(ents);
  for (let k = 0; k < 2000; k++) {
    for (const e of live) { if (r() < 0.5) { e.setPose(e.x + (r() - 0.5) * 3, e.z + (r() - 0.5) * 3, 2, r() * 6, r() * 7, r() < 0.3 ? MODE.MOTO : MODE.WALK, 0); world.relocate(e); } }
    if (r() < 0.1) { const e = [...live][Math.floor(r() * live.size)]; if (e) { world.destroy(e); live.delete(e); } }
    if (r() < 0.1) { const e = world.createEntity('n' + k); e.setPose((r() - 0.5) * 300, (r() - 0.5) * 300, 2, 0, 0, MODE.WALK, 0); world.add(e); live.add(e); }
    if (r() < 0.02) st.keyframe = true;
    self.setPose(self.x + (r() - 0.5) * 4, self.z + (r() - 0.5) * 4, 2, 0, 0, MODE.WALK, 0); world.relocate(self);
    const bytes = step(world, self, st, frame, sb, k % 500 < 100 ? 2 : 0);
    assert.ok(bytes.length <= AOI_CFG.BUDGET);
    mirror.apply(decodeS2C(bytes));
    assert.equal(mirror.slots.size, st.visible);
  }
  for (const [slot, m] of mirror.slots) assert.equal(m.netId, st.slotEnt[slot].netId);
});

test('degrade ladder: up one level at a time with hold, down with hysteresis, forced level', () => {
  const L = new DegradeLadder();
  const feed = (ms, secs) => { const out = []; for (let s = 0; s < secs; s++) { for (let i = 0; i < 20; i++) L.observe(ms); const c = L.evaluate(); if (c) out.push(c.level); } return out; };
  assert.deepEqual(feed(5, 5), []);
  assert.deepEqual(feed(60, 10), [1, 2, 3, 4]);           // one level per UP_HOLD seconds, in order
  assert.equal(L.level, 4);
  const down = feed(5, 60);
  assert.deepEqual(down, [3, 2, 1, 0]);                    // down only after DOWN_HOLD calm seconds each
  feed(30, 10);                                             // 30 ms p99: L1 only (needs > 35 for L2)
  assert.equal(L.level, 1);
  L.force(3); L.evaluate(); assert.equal(L.level, 3);
  L.force(-1);
  assert.ok(LADDER.TH[1] === 25 && LADDER.TH[4] === 50);
});

test('degrade ladder ignores periodic machine stalls (5 % of ticks 6× slower) but reacts to sustained cost', () => {
  const L = new DegradeLadder();
  const feed = (pattern, secs) => { for (let s = 0; s < secs; s++) { for (let i = 0; i < 20; i++) L.observe(pattern(i)); L.evaluate(); } };
  feed((i) => (i === 0 ? 70 : 12), 30);          // one 70 ms tick per second (the owner's PC under load), median 12 ms
  assert.equal(L.level, 0, `jitter must not degrade (p99 ${L.lastP99}, decision ${L.lastQ})`);
  assert.ok(L.lastP99 >= 70);
  feed((i) => (i < 4 ? 40 : 20), 10);             // 20 % of ticks over 35 ms: sustained → engages
  assert.ok(L.level >= 1, `sustained cost engages (decision ${L.lastQ})`);
});
