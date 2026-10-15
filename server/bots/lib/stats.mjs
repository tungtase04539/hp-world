// server/bots/lib/stats.mjs — mergeable histograms for the bot harness (worker → parent over IPC as plain JSON).
// LogHist: positive values (ms) in log buckets with ~2 % relative resolution. LinHist: integers (bytes) 1-unit buckets.
// Both serialise to sparse {idx: count} objects so 2,000 bots × several histograms stay small on the wire.

export class LogHist {
  constructor(min = 0.01, res = 0.02, nb = 1200) {
    this.min = min; this.res = res; this.nb = nb; this.lr = Math.log(1 + res);
    this.c = new Float64Array(nb + 1);     // last bucket = overflow
    this.n = 0; this.sum = 0; this.max = 0; this.minSeen = Infinity;
  }
  _idx(v) {
    if (!(v > this.min)) return 0;
    const i = Math.floor(Math.log(v / this.min) / this.lr) + 1;
    return i > this.nb ? this.nb : i;
  }
  add(v) {
    if (!Number.isFinite(v) || v < 0) return;
    this.c[this._idx(v)]++; this.n++; this.sum += v;
    if (v > this.max) this.max = v;
    if (v < this.minSeen) this.minSeen = v;
  }
  _val(i) { return i === 0 ? this.min : this.min * Math.exp(this.lr * (i - 0.5)); }
  quantile(q) {
    if (!this.n) return NaN;
    const target = Math.max(1, Math.ceil(q * this.n));
    let acc = 0;
    for (let i = 0; i <= this.nb; i++) {
      acc += this.c[i];
      if (acc >= target) return i === this.nb ? this.max : Math.min(this.max, this._val(i));
    }
    return this.max;
  }
  get mean() { return this.n ? this.sum / this.n : NaN; }
  toJSON() {
    const s = {};
    for (let i = 0; i <= this.nb; i++) if (this.c[i]) s[i] = this.c[i];
    return { k: 'log', min: this.min, res: this.res, nb: this.nb, n: this.n, sum: this.sum, max: this.max, lo: this.minSeen, s };
  }
  merge(j) {
    if (!j || !j.n) return this;
    if (j instanceof LogHist) j = j.toJSON();
    for (const k in j.s) this.c[+k] += j.s[k];
    this.n += j.n; this.sum += j.sum;
    if (j.max > this.max) this.max = j.max;
    if (j.lo < this.minSeen) this.minSeen = j.lo;
    return this;
  }
  static from(j) { const h = new LogHist(j?.min, j?.res, j?.nb); return h.merge(j); }
  summary(digits = 2) {
    const r = (v) => (Number.isFinite(v) ? +v.toFixed(digits) : null);
    return { n: this.n, p50: r(this.quantile(0.5)), p95: r(this.quantile(0.95)), p99: r(this.quantile(0.99)), max: r(this.n ? this.max : NaN), mean: r(this.mean) };
  }
}

export class LinHist {
  constructor(max = 8192) { this.maxV = max; this.c = new Float64Array(max + 1); this.n = 0; this.sum = 0; this.max = 0; }
  add(v) {
    v = Math.round(v);
    if (!(v >= 0)) return;
    this.c[v > this.maxV ? this.maxV : v]++; this.n++; this.sum += v;
    if (v > this.max) this.max = v;
  }
  quantile(q) {
    if (!this.n) return NaN;
    const target = Math.max(1, Math.ceil(q * this.n));
    let acc = 0;
    for (let i = 0; i <= this.maxV; i++) { acc += this.c[i]; if (acc >= target) return i === this.maxV ? this.max : i; }
    return this.max;
  }
  countAbove(v) { let a = 0; for (let i = Math.floor(v) + 1; i <= this.maxV; i++) a += this.c[i]; return a; }
  get mean() { return this.n ? this.sum / this.n : NaN; }
  toJSON() {
    const s = {};
    for (let i = 0; i <= this.maxV; i++) if (this.c[i]) s[i] = this.c[i];
    return { k: 'lin', maxV: this.maxV, n: this.n, sum: this.sum, max: this.max, s };
  }
  merge(j) {
    if (!j || !j.n) return this;
    if (j instanceof LinHist) j = j.toJSON();
    for (const k in j.s) this.c[Math.min(this.maxV, +k)] += j.s[k];
    this.n += j.n; this.sum += j.sum;
    if (j.max > this.max) this.max = j.max;
    return this;
  }
  static from(j) { const h = new LinHist(j?.maxV); return h.merge(j); }
  summary() {
    const r = (v) => (Number.isFinite(v) ? Math.round(v) : null);
    return { n: this.n, p50: r(this.quantile(0.5)), p95: r(this.quantile(0.95)), p99: r(this.quantile(0.99)), max: this.n ? this.max : null, mean: r(this.mean) };
  }
}

// quantile of a plain number array (sorted copy)
export function quantile(arr, q) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
}
export function summarize(arr, digits = 2) {
  const a = arr.filter(Number.isFinite);
  const r = (v) => (Number.isFinite(v) ? +v.toFixed(digits) : null);
  return { n: a.length, p50: r(quantile(a, 0.5)), p95: r(quantile(a, 0.95)), p99: r(quantile(a, 0.99)), max: r(a.length ? Math.max(...a) : NaN), mean: r(a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN) };
}

// deterministic PRNG (mulberry32) so a scenario with --seed replays the same choices
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
