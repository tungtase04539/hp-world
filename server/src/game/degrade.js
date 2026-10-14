// game/degrade.js — OWNER: S2. Degrade ladder L0–L4 (ARCH §5) driven by the p99 of the 20 Hz tick duration (the
// tick includes snapshot assembly and sends) over the last WINDOW ticks:
//   L1 (> 25 ms) far tier 5 → 2.5 Hz · L2 (> 35 ms) radius 120 → 80 m · L3 (> 45 ms) thin snapshots (self + 16 nearest
//   every other snapshot) · L4 (> 50 ms) stop admitting new sessions (join queue with ETA).
// One level at a time: up when p99 stays above the next threshold for UP_HOLD evaluations (1 s each), down when it
// stays below DOWN_FRAC × the current level's threshold for DOWN_HOLD evaluations. Every change is logged + counted.
import { DEGRADE } from '../../../js/shared/constants.js';

export const LADDER = Object.freeze({
  TH: [0, DEGRADE.L1_MS, DEGRADE.L2_MS, DEGRADE.L3_MS, DEGRADE.BUDGET_MS],   // p99 threshold to BE at level i
  WINDOW: 100,         // ticks (5 s at 20 Hz)
  UP_HOLD: 2,
  DOWN_HOLD: 10,
  DOWN_FRAC: 0.7,
  MAX: 4,
});

export class DegradeLadder {
  constructor() {
    this.ring = new Float64Array(LADDER.WINDOW);
    this.n = 0; this.h = 0;
    this.level = 0; this.forced = -1;
    this.up = 0; this.down = 0;
    this.lastP99 = 0;
    this._s = new Float64Array(LADDER.WINDOW);
  }
  observe(ms) { this.ring[this.h] = ms; this.h = (this.h + 1) % LADDER.WINDOW; if (this.n < LADDER.WINDOW) this.n++; }
  p99() {
    if (!this.n) return 0;
    const s = this._s.subarray(0, this.n);
    s.set(this.ring.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.ceil(0.99 * this.n) - 1)];
  }
  // force a level (tests / owner override); -1 = automatic
  force(level) { this.forced = level; if (level >= 0) this.level = level; }
  // call once per second; returns {level, prev} on a change, else null
  evaluate() {
    const prev = this.level;
    const p = (this.lastP99 = this.p99());
    if (this.forced >= 0) { this.level = this.forced; return this.level !== prev ? { level: this.level, prev } : null; }
    if (this.level < LADDER.MAX && p > LADDER.TH[this.level + 1]) { this.up++; this.down = 0; }
    else if (this.level > 0 && p < LADDER.TH[this.level] * LADDER.DOWN_FRAC) { this.down++; this.up = 0; }
    else { this.up = 0; this.down = 0; }
    if (this.up >= LADDER.UP_HOLD) { this.level++; this.up = 0; }
    else if (this.down >= LADDER.DOWN_HOLD) { this.level--; this.down = 0; }
    return this.level !== prev ? { level: this.level, prev } : null;
  }
}
