// js/shared/clock.js — client/server clock sync and the shared day clock (ARCH §7). Pure ESM.
//
// ClockSync: feed it PING/PONG samples; it keeps a window of recent samples, takes the 8 with the lowest RTT and uses
// the MEDIAN of their offsets (robust to TCP retransmit spikes). serverNow() slews toward the estimate at ≤ 0.5 % of
// elapsed time (no visible jumps) and snaps only on the first sample or when the error is > SNAP_MS.
// Times: `local` = the caller's monotonic clock in ms (performance.now()); `server` = server epoch ms (f64).
import { DAY_LENGTH, DAY_START } from './constants.js';

export const CLOCK_WINDOW = 32;
export const CLOCK_BEST = 8;
export const SLEW_RATE = 0.005;     // ms of correction per ms elapsed
export const SNAP_MS = 1000;

export class ClockSync {
  constructor({ window = CLOCK_WINDOW, best = CLOCK_BEST, slew = SLEW_RATE, snapMs = SNAP_MS } = {}) {
    this.window = window; this.best = best; this.slew = slew; this.snapMs = snapMs;
    this.rtt = new Float64Array(window);
    this.off = new Float64Array(window);
    this.n = 0; this.head = 0;
    this.target = 0;            // estimated server − local offset (ms)
    this.applied = 0;           // offset currently applied by serverNow()
    this.lastLocal = NaN;
    this.samples = 0;
    this._idx = new Int32Array(window);
    this._tmp = new Float64Array(window);
  }
  // sentLocal / recvLocal: local ms when PING was sent / PONG received; serverTime: PONG.serverTime.
  // Returns the sample RTT (ms). Ignores negative/NaN RTTs.
  addSample(sentLocal, serverTime, recvLocal) {
    const rtt = recvLocal - sentLocal;
    if (!(rtt >= 0) || !Number.isFinite(serverTime)) return NaN;
    const offset = serverTime - (sentLocal + rtt / 2);
    this.rtt[this.head] = rtt; this.off[this.head] = offset;
    this.head = (this.head + 1) % this.window;
    if (this.n < this.window) this.n++;
    this.samples++;
    this.target = this._estimate();
    if (this.samples === 1 || Number.isNaN(this.lastLocal)) { this.applied = this.target; this.lastLocal = recvLocal; }
    return rtt;
  }
  _estimate() {
    const n = this.n, idx = this._idx, k = Math.min(this.best, n);
    for (let i = 0; i < n; i++) idx[i] = i;
    // partial selection sort by RTT (n ≤ 32)
    for (let i = 0; i < k; i++) {
      let m = i;
      for (let j = i + 1; j < n; j++) if (this.rtt[idx[j]] < this.rtt[idx[m]]) m = j;
      const t = idx[i]; idx[i] = idx[m]; idx[m] = t;
    }
    const tmp = this._tmp;
    for (let i = 0; i < k; i++) tmp[i] = this.off[idx[i]];
    const sorted = tmp.subarray(0, k).sort();
    return k % 2 ? sorted[(k - 1) >> 1] : (sorted[k / 2 - 1] + sorted[k / 2]) / 2;
  }
  // RTT statistics over the window (ms)
  get rttMin() { let m = Infinity; for (let i = 0; i < this.n; i++) if (this.rtt[i] < m) m = this.rtt[i]; return m; }
  get rttMedian() {
    if (!this.n) return NaN;
    const s = Float64Array.from(this.rtt.subarray(0, this.n)).sort();
    return this.n % 2 ? s[(this.n - 1) >> 1] : (s[this.n / 2 - 1] + s[this.n / 2]) / 2;
  }
  get offset() { return this.applied; }
  get synced() { return this.samples > 0; }
  // Estimated server time at local time `local` (slewed).
  serverNow(local) {
    if (!this.samples) return NaN;
    if (!Number.isNaN(this.lastLocal) && local > this.lastLocal) {
      const err = this.target - this.applied;
      if (Math.abs(err) > this.snapMs) this.applied = this.target;
      else {
        const maxStep = (local - this.lastLocal) * this.slew;
        this.applied += err > maxStep ? maxStep : err < -maxStep ? -maxStep : err;
      }
    }
    if (Number.isNaN(this.lastLocal) || local > this.lastLocal) this.lastLocal = local;
    return local + this.applied;
  }
}

// Shared day clock: every client computes the same dayT ∈ [0, 1) from server time (ARCH §7.2).
// dayT = ((serverNow − dayEpoch)/1000/dayLength + start) mod 1
export function dayTAt(serverNowMs, dayEpochMs, dayLength = DAY_LENGTH, start = DAY_START) {
  const t = (serverNowMs - dayEpochMs) / 1000 / dayLength + start;
  return t - Math.floor(t);
}
// hours 0..24 for display
export function dayHours(dayT) { return dayT * 24; }
// next server time (ms) at which dayT == target (0..1), after serverNowMs
export function nextDayT(serverNowMs, dayEpochMs, target, dayLength = DAY_LENGTH, start = DAY_START) {
  const cur = dayTAt(serverNowMs, dayEpochMs, dayLength, start);
  let d = target - cur;
  if (d <= 0) d += 1;
  return serverNowMs + d * dayLength * 1000;
}

// Server-side monotonic epoch time with sub-ms precision (Node and browsers).
export function nowMs() { return performance.timeOrigin + performance.now(); }
