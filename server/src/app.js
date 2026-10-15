// app.js — the `app` object every feature module receives in register(app). See server/CONTRACT.md.
// Owns: the event bus, timers / fixed-rate loops, the service registry and the shutdown hooks.

// ---- event bus ------------------------------------------------------------------------------------------------------
export function createBus(log) {
  const map = new Map();
  const bus = {
    on(evt, fn) {
      let s = map.get(evt);
      if (!s) { s = new Set(); map.set(evt, s); }
      s.add(fn);
      return () => s.delete(fn);
    },
    once(evt, fn) { const off = bus.on(evt, (p) => { off(); fn(p); }); return off; },
    off(evt, fn) { map.get(evt)?.delete(fn); },
    // synchronous; a throwing handler is logged and does not stop the others. Returns the number of handlers called.
    emit(evt, payload) {
      const s = map.get(evt);
      if (!s || !s.size) return 0;
      let n = 0;
      for (const fn of [...s]) {
        n++;
        try {
          const r = fn(payload);
          if (r && typeof r.catch === 'function') r.catch((e) => log.error('bus handler rejected', { evt, err: e }));
        } catch (e) { log.error('bus handler threw', { evt, err: e }); }
      }
      return n;
    },
    listenerCount: (evt) => map.get(evt)?.size || 0,
  };
  return bus;
}

// ---- timers ---------------------------------------------------------------------------------------------------------
export function createTimers(log, metrics) {
  const live = new Set();
  const track = (h) => { live.add(h); return h; };
  const timers = {
    // setTimeout that is cleared on shutdown. Returns cancel().
    after(ms, fn) {
      const h = { cancel: null };
      const t = setTimeout(() => { live.delete(h); try { fn(); } catch (e) { log.error('timer threw', { err: e }); } }, ms);
      h.cancel = () => { clearTimeout(t); live.delete(h); };
      track(h);
      return h.cancel;
    },
    // setInterval with error isolation (async fn allowed; overlapping runs are skipped). Returns cancel().
    every(ms, name, fn) {
      let busy = false;
      const h = { cancel: null };
      const t = setInterval(async () => {
        if (busy) return;
        busy = true;
        try { await fn(); } catch (e) { log.error('periodic task threw', { name, err: e }); } finally { busy = false; }
      }, ms);
      h.cancel = () => { clearInterval(t); live.delete(h); };
      track(h);
      return h.cancel;
    },
    // Drift-compensated fixed-rate loop (e.g. the 20 Hz sim). fn(tick, nowMs, dtMs, lateMs) is synchronous
    // (lateMs = how late this tick started — event-loop pressure the tick's own duration does not show).
    // Records `<name>_ms` (duration) and `<name>_late_ms` (start lateness) histograms. If the loop falls more than
    // `maxCatchUp` ticks behind it skips ahead (counted in `<name>_skipped_total`) instead of spiralling.
    // external: true → the loop does NOT record the synchronous duration of fn; the caller reports each tick's real
    // work with handle.record(ms) (the sim tick is sliced across several event-loop turns, fixer round 2).
    loop(hz, name, fn, { maxCatchUp = 3, external = false } = {}) {
      const period = 1000 / hz;
      const dur = metrics.histogram(`${name}_ms`, `${name} duration (ms)`);
      const late = metrics.histogram(`${name}_late_ms`, `${name} start lateness (ms)`);
      const skipped = metrics.counter(`${name}_skipped_total`, `${name} ticks skipped (overload)`);
      let tick = 0, next = performance.now() + period, stopped = false, timer = null, last = performance.now();
      const run = () => {
        if (stopped) return;
        let now = performance.now();
        let behind = Math.floor((now - next) / period);
        if (behind > maxCatchUp) { skipped.inc(behind); next += behind * period; behind = 0; }
        let n = 0;
        while (now >= next && n <= maxCatchUp && !stopped) {
          const lateMs = now - next;
          late.observe(lateMs);
          const t0 = performance.now();
          try { fn(tick, t0, t0 - last, lateMs); } catch (e) { log.error('loop tick threw', { name, tick, err: e }); }
          last = t0;
          if (!external) dur.observe(performance.now() - t0);
          tick++; next += period; n++;
          now = performance.now();
        }
        if (!stopped) timer = setTimeout(run, Math.max(0, next - performance.now()));
      };
      timer = setTimeout(run, period);
      const h = {
        cancel: () => { stopped = true; clearTimeout(timer); live.delete(h); },
        get tick() { return tick; },
        record: (ms) => dur.observe(ms),
        stats: () => ({ p50: dur.quantile(0.5), p99: dur.quantile(0.99), lateP99: late.quantile(0.99), skipped: skipped.get() }),
      };
      track(h);
      return h;
    },
    clearAll() { for (const h of [...live]) h.cancel(); },
    get count() { return live.size; },
  };
  return timers;
}

// ---- service registry -----------------------------------------------------------------------------------------------
export function createServices() {
  const map = new Map();
  return {
    provide(name, svc) {
      if (map.has(name)) throw new Error(`service ${name} already provided`);
      map.set(name, svc);
      return svc;
    },
    // replace a stub service (integration / tests)
    replace(name, svc) { map.set(name, svc); return svc; },
    get(name) {
      if (!map.has(name)) throw new Error(`service ${name} not provided (is its module registered before use?)`);
      return map.get(name);
    },
    has: (name) => map.has(name),
    names: () => [...map.keys()],
  };
}
