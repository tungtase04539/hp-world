// game/worldclock.js — OWNER: S2. Shared day clock (ARCH §7.2) and, later, the weather schedule (WORLD message).
//
// FOUNDATION STUB (working): provides service 'worldclock' = { dayEpoch, dayLength, now(), dayT(now?) } from config.
// Every client computes the same dayT with js/shared/clock.js dayTAt(serverNow, dayEpoch, dayLength).
import { dayTAt } from '../../../js/shared/clock.js';

export function register(app) {
  const { dayEpoch, dayLength } = app.config;
  app.provide('worldclock', {
    dayEpoch,
    dayLength,
    now: app.nowMs,
    dayT: (now = app.nowMs()) => dayTAt(now, dayEpoch, dayLength),
    weather: () => ({ kind: 0, intensity: 0, windDir: 0, windSpeed: 0, seed: 0 }),
  });
}
