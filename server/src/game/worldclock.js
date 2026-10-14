// game/worldclock.js — OWNER: S2. Shared day clock (ARCH §7.2): every client computes the same dayT from server time
// with js/shared/clock.js dayTAt(serverNow, dayEpoch, dayLength) — dayEpoch is fixed in config (stable across
// restarts) and sent in WELCOME / WORLD. Weather is a fixed "clear" schedule entry until GĐ4 (the WORLD message
// layout already carries the schedule: kind, intensity, wind, seed, t0, t1).
//
// Service 'worldclock': { dayEpoch, dayLength, now(), dayT(now?), weather(now?), world(now?) → WORLD message object }
import { dayTAt } from '../../../js/shared/clock.js';
import { WEATHER } from '../../../js/shared/protocol.js';

export function register(app) {
  const { dayEpoch, dayLength } = app.config;
  const dayMs = dayLength * 1000;
  const entryAt = (now) => {
    const day = Math.floor((now - dayEpoch) / dayMs);
    return {
      kind: WEATHER.CLEAR, intensity: 0, windDir: 0, windSpeed: 0, seed: Math.imul(day, 2654435761) >>> 0,
      t0: dayEpoch + day * dayMs, t1: dayEpoch + (day + 1) * dayMs,
    };
  };
  app.provide('worldclock', {
    dayEpoch,
    dayLength,
    now: app.nowMs,
    dayT: (now = app.nowMs()) => dayTAt(now, dayEpoch, dayLength),
    weather: (now = app.nowMs()) => {
      const w = entryAt(now);
      return { kind: w.kind, intensity: w.intensity, windDir: w.windDir, windSpeed: w.windSpeed, seed: w.seed };
    },
    world: (now = app.nowMs()) => ({ dayEpoch, dayLength, weather: [entryAt(now), entryAt(now + dayMs)] }),
  });
}
