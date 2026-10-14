// metrics.js — tiny metrics registry with Prometheus text exposition (served at /metrics on the ADMIN port only).
// counter / gauge / histogram (fixed buckets + a ring buffer of recent samples for p50/p99 used by the degrade ladder
// and the admin page). Process metrics: CPU %, RSS, heap, event-loop lag p50/p99/max. No dependencies.
//
// Event-loop lag (fixer round 2): hp_eventloop_delay_{p50,p99,max}_ms measure how long an EXTERNAL event waits before
// the main thread handles it — a tiny worker thread posts its clock every PROBE_MS and the main thread records
// (receive − send). That is exactly what an inbound WebSocket message experiences. The previous source,
// perf_hooks.monitorEventLoopDelay, records the interval of a 5 ms timer: it includes the 5 ms itself and, on Windows,
// the 15.6 ms system timer quantum (an IDLE process reads p50 15.5 ms / p99 16.6 ms, a busy one 2 quanta ≈ 31 ms), so
// it measured the platform, not the server. It is still exported, minus its resolution, as
// hp_eventloop_timer_delay_{p50,p99}_ms for comparison.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

const PROBE_MS = 5;
const PROBE_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
let stopped = false;
parentPort.on('message', (m) => { if (m === 'stop') { stopped = true; parentPort.close(); } });
(function tick() { if (stopped) return; parentPort.postMessage(now()); setTimeout(tick, workerData.ms); })();
`;
const hrMs = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };

// Starts the worker probe; lag samples go to hist (a Histogram) and to st.max (max since the last take).
export function startLagProbe(hist, { intervalMs = PROBE_MS } = {}) {
  const st = {
    max: 0, samples: 0, worker: null,
    stop() {
      const w = this.worker;
      if (!w) return;
      this.worker = null;
      try { w.postMessage('stop'); } catch { /* gone */ }
      w.terminate().catch(() => {});
    },
  };
  try {
    const w = new Worker(PROBE_SRC, { eval: true, workerData: { ms: intervalMs }, resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 } });
    w.unref();
    w.on('message', (t) => {
      const lag = hrMs() - t;
      const v = lag > 0 ? lag : 0;
      hist.observe(v);
      if (v > st.max) st.max = v;
      st.samples++;
    });
    w.on('error', () => { st.worker = null; });
    st.worker = w;
  } catch { /* no worker threads: the gauges read 0 */ }
  return st;
}

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
    stop() { if (eld) eld.disable(); if (probe) probe.stop(); },
  };

  let eld = null, probe = null;
  if (processMetrics) {
    const RES = 5;
    eld = monitorEventLoopDelay({ resolution: RES });
    eld.enable();
    const lagH = metrics.histogram('eventloop_lag_ms', 'delay before the main thread handles an external event (worker probe, ms)', [0.1, 0.25, 0.5, 1, 2, 4, 6, 8, 10, 15, 20, 25, 35, 50, 100, 250], 2048);
    probe = startLagProbe(lagH);
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
    const q = (p) => { const v = lagH.quantile(p); return Number.isFinite(v) ? v : 0; };
    metrics.gauge('eventloop_delay_p50_ms', 'event-loop lag p50 (ms): wait of an external event, last 2048 probe samples', () => q(0.5));
    metrics.gauge('eventloop_delay_p99_ms', 'event-loop lag p99 (ms): wait of an external event, last 2048 probe samples', () => q(0.99));
    metrics.gauge('eventloop_delay_max_ms', 'event-loop lag max (ms) since the last scrape', () => {
      const v = probe.max;
      probe.max = 0;        // window = between scrapes of the max gauge
      return v;
    });
    // the old timer-based reading, minus its own resolution (on Windows it still contains the 15.6 ms timer quantum)
    metrics.gauge('eventloop_timer_delay_p50_ms', 'perf_hooks timer delay p50 minus the 5 ms resolution (platform timer granularity included)', () => Math.max(0, eld.percentile(50) / 1e6 - RES));
    metrics.gauge('eventloop_timer_delay_p99_ms', 'perf_hooks timer delay p99 minus the 5 ms resolution (platform timer granularity included); window = between scrapes', () => {
      const v = Math.max(0, eld.percentile(99) / 1e6 - RES);
      eld.reset();
      return v;
    });
    metrics.gauge('uptime_seconds', 'process uptime', () => process.uptime());
  }
  return metrics;
}
