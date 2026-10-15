// server/bots/lib/metrics.mjs — scrape the server's Prometheus text (/metrics on the ADMIN port) + /healthz, and the
// machine-wide CPU (os.cpus deltas) so the report can split CPU between the server process, the bots and the rest.
import os from 'node:os';

// Parse Prometheus text → {name or name{labels}: value}. Histogram buckets are skipped (the _p50/_p99 convenience
// gauges rendered by server/src/metrics.js carry the quantiles).
export function parseProm(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    if (!line || line[0] === '#') continue;
    const sp = line.lastIndexOf(' ');
    if (sp <= 0) continue;
    const key = line.slice(0, sp).trim();
    if (key.includes('_bucket{')) continue;
    const v = Number(line.slice(sp + 1));
    if (Number.isFinite(v)) out[key] = v;
  }
  return out;
}

// Pick well-known values from one scrape. Snapshot-assembly / degrade / ccu names are matched loosely because the
// game modules (S2) name them; the first match wins and the chosen name is reported.
export function pick(m) {
  const first = (re) => { for (const k of Object.keys(m)) if (re.test(k)) return [k, m[k]]; return [null, NaN]; };
  const [snapName, snapP99] = first(/^hp_\w*snap\w*_ms_p99$/);
  const [snapName50, snapP50] = first(/^hp_\w*snap\w*_ms_p50$/);
  const [ccuName, ccu] = first(/^hp_(ccu|players_online|sessions_live|sessions|players)$/);
  const [degName, degrade] = first(/^hp_degrade_level$/);
  const [qName, queue] = first(/^hp_\w*queue\w*(len|length|size|waiting)$/);
  return {
    tickP50: m.hp_sim_tick_ms_p50 ?? NaN, tickP99: m.hp_sim_tick_ms_p99 ?? NaN, tickLateP99: m.hp_sim_tick_late_ms_p99 ?? NaN,
    snapP50, snapP99, snapName: snapName || snapName50,
    elP50: m.hp_eventloop_delay_p50_ms ?? NaN, elP99: m.hp_eventloop_delay_p99_ms ?? NaN, elMax: m.hp_eventloop_delay_max_ms ?? NaN,
    // fixer round 2: the old timer-based reading (includes the Windows 15.6 ms timer quantum), tick span / overruns
    elTimerP99: m.hp_eventloop_timer_delay_p99_ms ?? NaN, tickSpanP99: m.hp_sim_tick_span_ms_p99 ?? NaN,
    tickOverrun: m.hp_sim_tick_overrun_total ?? NaN,
    cpu: m.hp_process_cpu_percent ?? NaN, rss: m.hp_process_rss_bytes ?? NaN, heap: m.hp_process_heap_used_bytes ?? NaN,
    ccu, ccuName, degrade, degName, queue, qName,
    decodeErrorsServer: m.hp_ws_play_decode_errors_total ?? NaN,
    bytesOut: m.hp_ws_play_bytes_out_total ?? NaN, bytesIn: m.hp_ws_play_bytes_in_total ?? NaN,
  };
}

export function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
  return { idle, total };
}
export function cpuBusyPct(a, b) {
  const dt = b.total - a.total;
  return dt > 0 ? (1 - (b.idle - a.idle) / dt) * 100 : NaN;
}

export async function scrape(adminUrl, httpUrl, token) {
  const t = Date.now();
  const r = { t, ok: false, m: null, health: null, err: null };
  try {
    const res = await fetch(adminUrl.replace(/\/$/, '') + '/metrics', { headers: token ? { authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(3000) });
    if (res.ok) { r.m = parseProm(await res.text()); r.ok = true; } else r.err = 'metrics ' + res.status;
  } catch (e) { r.err = 'metrics ' + (e.cause?.code || e.message); }
  try {
    const res = await fetch(httpUrl.replace(/\/$/, '') + '/healthz', { signal: AbortSignal.timeout(3000) });
    r.health = res.ok ? await res.json() : { ok: false, status: res.status };
  } catch (e) { r.health = { ok: false, err: e.cause?.code || e.message }; }
  return r;
}
