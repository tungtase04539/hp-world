// metrics.js — tiny metrics registry with Prometheus text exposition (served at /metrics on the ADMIN port only).
// counter / gauge / histogram (fixed buckets + a ring buffer of recent samples for p50/p99 used by the degrade ladder
// and the admin page). Process metrics: CPU %, RSS, heap, event-loop delay p50/p99. No dependencies.
import { monitorEventLoopDelay } from 'node:perf_hooks';

const DEFAULT_MS_BUCKETS = [0.5, 1, 2, 5, 10, 15, 20, 25, 35, 45, 50, 75, 100, 250, 500, 1000];
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labelKey = (labels) => {
  if (!labels) return '';
  const ks = Object.keys(labels).sort();
  return ks.map((k) => `${k}="${esc(labels[k])}"`).join(',');
};
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

class Counter {
  constructor(name, help) { this.name = name; this.help = help; this.type = 'counter'; this.values = new Map(); }
  inc(n = 1, labels) { const k = labelKey(labels); this.values.set(k, (this.values.get(k) || 0) + n); }
  get(labels) { return this.values.get(labelKey(labels)) || 0; }
  render() {
    const out = [];
    if (!this.values.size) out.push(`${this.name} 0`);
    for (const [k, v] of this.values) out.push(`${this.name}${k ? `{${k}}` : ''} ${v}`);
    return out;
  }
  json() { return Object.fromEntries([...this.values].map(([k, v]) => [k || '_', v])); }
}

class Gauge {
  constructor(name, help, collect) { this.name = name; this.help = help; this.type = 'gauge'; this.values = new Map(); this.collect = collect; }
  set(v, labels) { this.values.set(labelKey(labels), v); }
  inc(n = 1, labels) { const k = labelKey(labels); this.values.set(k, (this.values.get(k) || 0) + n); }
  dec(n = 1, labels) { this.inc(-n, labels); }
  get(labels) { if (this.collect) this._run(); return this.values.get(labelKey(labels)) ?? 0; }
  _run() { try { const v = this.collect(this); if (typeof v === 'number') this.values.set('', v); } catch { /* ignore */ } }
  render() {
    if (this.collect) this._run();
    const out = [];
    if (!this.values.size) out.push(`${this.name} 0`);
    for (const [k, v] of this.values) out.push(`${this.name}${k ? `{${k}}` : ''} ${Number.isFinite(v) ? v : 0}`);
    return out;
  }
  json() { if (this.collect) this._run(); return Object.fromEntries([...this.values].map(([k, v]) => [k || '_', v])); }
}

// Histogram without labels (one per metric name keeps the hot path allocation-free).
class Histogram {
  constructor(name, help, buckets = DEFAULT_MS_BUCKETS, window = 2048) {
    this.name = name; this.help = help; this.type = 'histogram';
    this.buckets = buckets.slice().sort((a, b) => a - b);
    this.counts = new Float64Array(this.buckets.length + 1);
    this.sum = 0; this.count = 0;
    this.ring = new Float64Array(window); this.rn = 0; this.rh = 0;
    this.max = 0;
  }
  observe(v) {
    if (!Number.isFinite(v)) return;
    let i = 0;
    while (i < this.buckets.length && v > this.buckets[i]) i++;
    this.counts[i]++;
    this.sum += v; this.count++;
    if (v > this.max) this.max = v;
    this.ring[this.rh] = v; this.rh = (this.rh + 1) % this.ring.length;
    if (this.rn < this.ring.length) this.rn++;
  }
  // quantile over the most recent `window` samples (NaN if none)
  quantile(q) {
    if (!this.rn) return NaN;
    const s = Float64Array.from(this.ring.subarray(0, this.rn)).sort();
    const idx = Math.min(this.rn - 1, Math.max(0, Math.ceil(q * this.rn) - 1));
    return s[idx];
  }
  resetWindow() { this.rn = 0; this.rh = 0; this.max = 0; }
  render() {
    const out = [];
    let cum = 0;
    for (let i = 0; i < this.buckets.length; i++) { cum += this.counts[i]; out.push(`${this.name}_bucket{le="${this.buckets[i]}"} ${cum}`); }
    cum += this.counts[this.buckets.length];
    out.push(`${this.name}_bucket{le="+Inf"} ${cum}`);
    out.push(`${this.name}_sum ${this.sum}`);
    out.push(`${this.name}_count ${this.count}`);
    // convenience gauges for humans / the admin page
    out.push(`${this.name}_p50 ${this.rn ? this.quantile(0.5) : 0}`);
    out.push(`${this.name}_p99 ${this.rn ? this.quantile(0.99) : 0}`);
    return out;
  }
  json() { return { count: this.count, p50: this.quantile(0.5), p99: this.quantile(0.99), max: this.max }; }
}

export function createMetrics({ prefix = 'hp_', processMetrics = true } = {}) {
  const items = new Map();
  const reg = (m) => {
    if (!NAME_RE.test(m.name)) throw new Error(`metrics: bad name ${m.name}`);
    const prev = items.get(m.name);
    if (prev) {
      if (prev.type !== m.type) throw new Error(`metrics: ${m.name} already registered as ${prev.type}`);
      return prev;     // idempotent: modules may ask for the same metric twice
    }
    items.set(m.name, m);
    return m;
  };
  const metrics = {
    prefix,
    counter: (name, help = '') => reg(new Counter(prefix + name, help)),
    gauge: (name, help = '', collect) => reg(new Gauge(prefix + name, help, collect)),
    histogram: (name, help = '', buckets, window) => reg(new Histogram(prefix + name, help, buckets, window)),
    get: (name) => items.get(prefix + name) || items.get(name),
    render() {
      const lines = [];
      for (const m of items.values()) {
        if (m.help) lines.push(`# HELP ${m.name} ${m.help.replace(/\n/g, ' ')}`);
        lines.push(`# TYPE ${m.name} ${m.type === 'histogram' ? 'histogram' : m.type}`);
        lines.push(...m.render());
      }
      return lines.join('\n') + '\n';
    },
    snapshot() {
      const out = {};
      for (const m of items.values()) out[m.name.slice(prefix.length)] = m.json();
      return out;
    },
    stop() { if (eld) eld.disable(); },
  };

  let eld = null;
  if (processMetrics) {
    eld = monitorEventLoopDelay({ resolution: 5 });
    eld.enable();
    let lastCpu = process.cpuUsage(), lastT = performance.now(), cpuPct = 0;
    const sampleCpu = () => {
      const now = performance.now(), c = process.cpuUsage();
      const dt = now - lastT;
      if (dt > 200) {
        cpuPct = ((c.user - lastCpu.user + c.system - lastCpu.system) / 1000 / dt) * 100;
        lastCpu = c; lastT = now;
      }
      return cpuPct;
    };
    metrics.gauge('process_cpu_percent', 'CPU of this process, % of one core (since the previous scrape)', sampleCpu);
    metrics.gauge('process_rss_bytes', 'resident set size', () => process.memoryUsage.rss());
    metrics.gauge('process_heap_used_bytes', 'V8 heap used', () => process.memoryUsage().heapUsed);
    metrics.gauge('eventloop_delay_p50_ms', 'event-loop delay p50 (ms) since the last scrape', () => eld.percentile(50) / 1e6);
    metrics.gauge('eventloop_delay_p99_ms', 'event-loop delay p99 (ms) since the last scrape', () => {
      const v = eld.percentile(99) / 1e6;
      return v;
    });
    metrics.gauge('eventloop_delay_max_ms', 'event-loop delay max (ms) since the last scrape', () => {
      const v = eld.max / 1e6;
      eld.reset();          // window = between scrapes of the max gauge (rendered after p50/p99)
      return v;
    });
    metrics.gauge('uptime_seconds', 'process uptime', () => process.uptime());
  }
  return metrics;
}
