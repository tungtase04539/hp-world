// game/aoi.js — OWNER: S2. Area of interest (ARCH §5, SPEC §3.2): 128 m grid (js/shared/grid.js), 3×3 cells,
// radius 120 m default with a far ring to 160 m (5 Hz), cap 96 visible records chosen by distance with hysteresis,
// priority accumulator when the byte budget (1,100 B) cannot hold every changed record, ENTER / LEAVE / UPDATE,
// NAMES once per session per player, degrade levels L1–L3 (far tier 2.5 Hz, radius 80 m, thin snapshots).
//
// Pure module: AoiState is per client; aoiStep() fills an AoiFrame that game/encoder.js turns into bytes.
// No allocation per snapshot on the hot path (scratch arrays are module-level and grow only).
import { AOI, MODE_MOUNTED } from '../../../js/shared/constants.js';
import { SNAPSHOT_HEADER_BYTES, ENTER_RECORD_BYTES, UPDATE_RECORD_BYTES } from '../../../js/shared/codec.js';

export const MAX_SLOTS = 255;                 // u8 slot ids on the wire
export const AOI_CFG = Object.freeze({
  CAP: AOI.CAP,                               // 96 visible / records per snapshot
  ENTER_MAX: 24,                              // ENTER records per snapshot: a full AOI fills over several snapshots
  BUDGET: AOI.SNAPSHOT_MAX_BYTES,             // 1,100 B per snapshot
  R_NEAR: AOI.RADIUS,                         // 120 m: 10 Hz
  R_FAR: AOI.RADIUS_MAX,                      // 160 m: far tier (5 Hz)
  R_L2: AOI.RADIUS_L2,                        // 80 m at degrade L2+
  HYST: AOI.HYST,                             // 8 m: a visible entity leaves only beyond radius + HYST
  KEEP: 0.72,                                 // a visible entity's score × this (≈ 0.85²): resists eviction
  L3_NEAR: 16,                                // at L3 every other snapshot carries only the 16 nearest
  NAMES_MAX: 32,                              // NAMES entries per message
});

// degrade-level parameters (ARCH §5): far tier 5 Hz (L0) → 2.5 Hz (L1); radius 80 m without far ring (L2);
// thin snapshots (only self + 16 nearest every other snapshot) at L3.
export function levelParams(level) {
  return {
    rNear: level >= 2 ? AOI_CFG.R_L2 : AOI_CFG.R_NEAR,
    rVis: level >= 2 ? AOI_CFG.R_L2 : AOI_CFG.R_FAR,
    farDiv: level >= 1 ? 4 : 2,                       // far-tier updates every farDiv-th snapshot (10 Hz base)
    thin: level >= 3,
  };
}

export class AoiState {
  constructor() {
    this.slotEnt = new Array(MAX_SLOTS).fill(null);
    this.entSlot = new Map();                    // Entity → slot
    this.free = new Uint8Array(MAX_SLOTS);
    this.nFree = 0;
    this.sentK1 = new Uint32Array(MAX_SLOTS);
    this.sentK2 = new Uint32Array(MAX_SLOTS);
    this.prio = new Float32Array(MAX_SLOTS);
    this.d2 = new Float64Array(MAX_SLOTS);
    this.stamp = new Uint32Array(MAX_SLOTS);
    this.curStamp = 0;
    this.visible = 0;
    this.namesSent = new Map();                  // netId → entity gen
    this.pendingNames = [];                      // entities whose NAMES are due
    this.snapCount = 0;
    this.keyframe = true;                        // first snapshot after READY / resume / a dropped snapshot
    this.clear();
  }
  clear() {
    this.slotEnt.fill(null);
    this.entSlot.clear();
    this.nFree = 0;
    for (let s = MAX_SLOTS - 1; s >= 0; s--) this.free[this.nFree++] = s;   // pop gives 0, 1, 2 …
    this.prio.fill(0);
    this.visible = 0;
  }
  _take() { return this.nFree ? this.free[--this.nFree] : -1; }
  _release(s) {
    const e = this.slotEnt[s];
    if (e) this.entSlot.delete(e);
    this.slotEnt[s] = null;
    this.prio[s] = 0;
    this.free[this.nFree++] = s;
    this.visible--;
  }
}

// Output of one aoiStep (reused per call; consumed by the encoder immediately)
export class AoiFrame {
  constructor() {
    this.keyframe = false;
    this.nLeave = 0; this.leaves = new Uint8Array(MAX_SLOTS);
    this.nEnter = 0; this.enterSlot = new Uint8Array(MAX_SLOTS); this.enterEnt = new Array(MAX_SLOTS).fill(null);
    this.nUpd = 0; this.updSlot = new Uint8Array(MAX_SLOTS); this.updEnt = new Array(MAX_SLOTS).fill(null);
    this.candidates = 0;       // entities in range (before the cap)
    this.capped = 0;           // in range but not visible because of the cap
    this.deferred = 0;         // changed visible records not sent this snapshot (budget / tier)
  }
}

// ---- module scratch (grows; aoiStep is synchronous and non-reentrant) ----------------------------------------------
let cap = 512;
let cE = new Array(cap).fill(null);
let cD = new Float64Array(cap);
let cS = new Float64Array(cap);       // score (weighted squared distance)
let cOrd = new Int32Array(cap);
let nC = 0;
const uSlot = new Int32Array(MAX_SLOTS);
const uPrio = new Float64Array(MAX_SLOTS);
const vD = new Float64Array(MAX_SLOTS);
let ordScore = cS;
const byScore = (a, b) => ordScore[a] - ordScore[b];
const byPrioDesc = (a, b) => uPrio[b] - uPrio[a];

function grow() {
  cap *= 2;
  const e2 = new Array(cap).fill(null); for (let i = 0; i < nC; i++) e2[i] = cE[i];
  const d2 = new Float64Array(cap); d2.set(cD.subarray(0, nC));
  const s2 = new Float64Array(cap); s2.set(cS.subarray(0, nC));
  cE = e2; cD = d2; cS = s2; cOrd = new Int32Array(cap);
}

const weightOf = (e) => (MODE_MOUNTED[e.mode] ? 2 : 1);

// One snapshot's AOI decisions for observer `self` (an Entity in `world`) with state `st`.
//   p = levelParams(level) (+ optional overrides: cap, enterMax, budget)
// Fills `out` and updates `st` (slot table, sent keys, priorities, names queue). Returns out.
export function aoiStep(world, self, st, p, out) {
  const CAPN = p.cap ?? AOI_CFG.CAP;
  const ENTER_MAX = p.enterMax ?? AOI_CFG.ENTER_MAX;
  const BUDGET = p.budget ?? AOI_CFG.BUDGET;
  st.snapCount++;
  out.nLeave = 0; out.nEnter = 0; out.nUpd = 0; out.capped = 0; out.deferred = 0;
  out.keyframe = st.keyframe;
  if (st.keyframe) { st.clear(); st.keyframe = false; }
  const stamp = ++st.curStamp;
  const rVis = p.rVis, rKeep = rVis + AOI_CFG.HYST;
  const rVis2 = rVis * rVis, rNear2 = p.rNear * p.rNear;

  // 1. gather candidates within rKeep (visible entities keep their slot up to rVis + HYST)
  nC = 0;
  world.forNear(self.x, self.z, rKeep, (e, d2) => {
    if (e === self) return false;
    const s = st.entSlot.get(e);
    if (s !== undefined) { st.stamp[s] = stamp; st.d2[s] = d2; }
    else if (d2 > rVis2) return false;
    if (nC === cap) grow();
    cE[nC] = e; cD[nC] = d2;
    const w = weightOf(e);
    cS[nC] = (d2 / (w * w)) * (s !== undefined ? AOI_CFG.KEEP : 1);
    nC++;
    return false;
  }, self.cell >= 0 ? self.cell : undefined);
  out.candidates = nC;

  // 2. leaves: visible entities no longer gathered (out of range, removed from the world)
  for (let s = 0; s < MAX_SLOTS; s++) {
    const e = st.slotEnt[s];
    if (e && st.stamp[s] !== stamp) { out.leaves[out.nLeave++] = s; st._release(s); }
  }

  // 3. choose entrants (nearest first); evict the worst visible only to make room for a better entrant
  let budget = BUDGET - SNAPSHOT_HEADER_BYTES - out.nLeave;
  let records = 0;
  const newcomers = nC - st.visible;
  if (newcomers > 0) {
    for (let i = 0; i < nC; i++) cOrd[i] = i;
    const ord = cOrd.subarray(0, nC);
    ordScore = cS;
    ord.sort(byScore);
    // desired = first CAPN by score; newcomers inside it may enter; visible outside it may be evicted
    const limit = Math.min(CAPN, nC);
    let enterWant = 0;
    for (let r = 0; r < limit; r++) if (!st.entSlot.has(cE[ord[r]])) enterWant++;
    out.capped = Math.max(0, nC - limit);
    let enterN = Math.min(enterWant, ENTER_MAX, Math.floor(budget / (ENTER_RECORD_BYTES + 1)));
    // room: free capacity under the cap, plus evictions of visible entities ranked beyond the cap
    let room = CAPN - st.visible;
    if (enterN > room) {
      // evict from the bottom of the ranking (visible ones beyond `limit`)
      for (let r = nC - 1; r >= limit && enterN > room; r--) {
        const e = cE[ord[r]];
        const s = st.entSlot.get(e);
        if (s === undefined) continue;
        out.leaves[out.nLeave++] = s; st._release(s); budget--; room++;
      }
      if (enterN > room) enterN = Math.max(0, room);
    }
    for (let r = 0; r < limit && out.nEnter < enterN; r++) {
      const ci = ord[r];
      const e = cE[ci];
      if (st.entSlot.has(e)) continue;
      const s = st._take();
      if (s < 0) break;
      st.slotEnt[s] = e; st.entSlot.set(e, s); st.visible++;
      st.stamp[s] = stamp; st.d2[s] = cD[ci]; st.prio[s] = 0;
      st.sentK1[s] = e.k1; st.sentK2[s] = e.k2;
      out.enterSlot[out.nEnter] = s; out.enterEnt[out.nEnter] = e; out.nEnter++;
      budget -= ENTER_RECORD_BYTES; records++;
      const g = st.namesSent.get(e.netId);
      if (g !== e.gen) { st.namesSent.set(e.netId, e.gen); st.pendingNames.push(e); }
    }
  } else {
    out.capped = 0;
  }

  // 4. updates: changed visible records, far tier at reduced rate, thin snapshots at L3, priority accumulator
  const farTurn = st.snapCount % p.farDiv === 0;
  let thinD2 = Infinity;
  if (p.thin && (st.snapCount & 1) === 1 && st.visible > AOI_CFG.L3_NEAR) {
    let n = 0;
    for (let s = 0; s < MAX_SLOTS; s++) if (st.slotEnt[s]) vD[n++] = st.d2[s];
    const sub = vD.subarray(0, n).sort();
    thinD2 = sub[AOI_CFG.L3_NEAR - 1];
  }
  let nU = 0;
  for (let s = 0; s < MAX_SLOTS; s++) {
    const e = st.slotEnt[s];
    if (!e || st.stamp[s] !== stamp) continue;
    if (e.k1 === st.sentK1[s] && e.k2 === st.sentK2[s]) continue;     // unchanged since last sent: nothing to send
    const d2 = st.d2[s];
    st.prio[s] += (weightOf(e)) / (Math.sqrt(d2) + 10);
    if (d2 > rNear2 && !farTurn) { out.deferred++; continue; }
    if (d2 > thinD2) { out.deferred++; continue; }
    uSlot[nU] = s; uPrio[nU] = st.prio[s]; nU++;
  }
  const fit = Math.min(Math.floor(budget / UPDATE_RECORD_BYTES), CAPN - records, nU);
  if (fit < nU) {
    // keep the `fit` highest priorities (simple selection by sorting slot indices)
    for (let i = 0; i < nU; i++) cOrd[i] = i;
    const ord = cOrd.subarray(0, nU);
    ord.sort(byPrioDesc);
    for (let r = 0; r < fit; r++) pushUpd(out, st, uSlot[ord[r]]);
    out.deferred += nU - fit;
  } else {
    for (let i = 0; i < nU; i++) pushUpd(out, st, uSlot[i]);
  }
  return out;
}

function pushUpd(out, st, s) {
  const e = st.slotEnt[s];
  out.updSlot[out.nUpd] = s; out.updEnt[out.nUpd] = e; out.nUpd++;
  st.sentK1[s] = e.k1; st.sentK2[s] = e.k2; st.prio[s] = 0;
}

// Names due for this client (each player's name once per session). Returns up to `max` entities and removes them.
export function takeNames(st, max = AOI_CFG.NAMES_MAX) {
  if (!st.pendingNames.length) return null;
  return st.pendingNames.splice(0, max);
}

export function register(app) { void app; }
