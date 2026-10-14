// admin/live.js — live numbers and player positions for the admin page.
// Players: S2 announces them on the bus ('player:join' / 'player:leave' with the session object); positions are read
// from the live session objects (x/z or pos.{x,z}). If S2 also provides a service 'sessions' / 'players' with a
// list()/all()/values() method, that list wins.
import { posOf } from '../chat/util.js';

export function createLive(app) {
  const tracked = new Map();
  const key = (s) => s?.accountId || s?.netId;
  app.bus.on('player:join', ({ session } = {}) => { if (key(session) != null) tracked.set(key(session), session); });
  app.bus.on('player:leave', ({ session } = {}) => { if (key(session) != null && tracked.get(key(session)) === session) tracked.delete(key(session)); });
  let degrade = { level: 0, at: null };
  app.bus.on('degrade', ({ level } = {}) => { degrade = { level: Number(level) || 0, at: new Date().toISOString() }; });
  let last = null;

  function sessions() {
    for (const name of ['sessions', 'players']) {
      if (!app.has(name)) continue;
      const svc = app.get(name);
      for (const fn of ['list', 'all', 'values']) {
        if (typeof svc?.[fn] === 'function') {
          try { const v = svc[fn](); if (v && typeof v[Symbol.iterator] === 'function') return [...v]; } catch { /* fall back */ }
        }
      }
    }
    return [...tracked.values()];
  }

  function players(limit = 3000) {
    const out = [];
    for (const s of sessions()) {
      if (out.length >= limit) break;
      const p = posOf(s);
      out.push({ netId: s.netId ?? null, accountId: s.accountId ?? null, name: s.displayName ?? s.name ?? null,
        x: p ? Math.round(p.x * 10) / 10 : null, z: p ? Math.round(p.z * 10) / 10 : null, mode: s.mode ?? s.state?.mode ?? null });
    }
    return out;
  }

  const num = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const counterTotal = (c) => (c && typeof c === 'object' ? Object.values(c).reduce((a, b) => a + (Number(b) || 0), 0) : 0);

  function stats() {
    const snap = app.metrics.snapshot();
    const t = Date.now();
    const out = counterTotal(snap.ws_play_bytes_out_total);
    const inn = counterTotal(snap.ws_play_bytes_in_total);
    let outBps = null, inBps = null;
    if (last && t > last.t) { outBps = ((out - last.out) * 1000) / (t - last.t); inBps = ((inn - last.inn) * 1000) / (t - last.t); }
    last = { t, out, inn };
    const tick = snap.sim_tick_ms || {};
    const g = (k) => { const v = snap[k]; return v && typeof v === 'object' ? Number(Object.values(v)[0]) : Number(v); };
    const list = sessions();
    return {
      at: new Date(t).toISOString(),
      ccu: list.length,
      sockets: app.ws.connections,
      tickP50: num(tick.p50), tickP99: num(tick.p99), tickMax: num(tick.max),
      bytesOutPerS: outBps == null ? null : Math.round(outBps), bytesInPerS: inBps == null ? null : Math.round(inBps),
      bytesOutPerClient: outBps == null || !list.length ? null : Math.round(outBps / list.length),
      degrade: degrade.level, degradeAt: degrade.at,
      cpu: num(g('process_cpu_percent')), rssMB: Math.round((g('process_rss_bytes') || 0) / 1048576),
      heapMB: Math.round((g('process_heap_used_bytes') || 0) / 1048576),
      loopP99: num(g('eventloop_delay_p99_ms')),
      sim: app.has('sim') ? safe(() => app.get('sim').stats()) : null,
    };
  }
  return { players, stats, sessions };
}

function safe(fn) { try { return fn(); } catch { return null; } }
