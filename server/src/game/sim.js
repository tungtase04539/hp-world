// game/sim.js — OWNER: S2. 20 Hz world loop: apply validated STATE, sessions' AOI bookkeeping, staggered 10 Hz
// snapshots, persistence of dirty characters every 30 s, degrade ladder L0–L4 from tick / snapshot p99.
//
// FOUNDATION STUB (working): starts an empty fixed-rate loop at config.tickHz on 'start' (metric hp_sim_tick_ms /
// hp_sim_tick_late_ms) and provides service 'sim' = { get tick(), stats() }.
export function register(app) {
  let loop = null;
  app.provide('sim', {
    get tick() { return loop ? loop.tick : 0; },
    stats: () => (loop ? loop.stats() : null),
  });
  app.bus.on('start', () => {
    loop = app.timers.loop(app.config.tickHz, 'sim_tick', () => { /* S2: world step */ });
  });
}
