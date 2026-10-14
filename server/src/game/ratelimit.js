// game/ratelimit.js — OWNER: S2. Token buckets (js/shared/constants.js RATE): per connection / account / device as the
// primary limits; per-IP limits lenient (Vietnamese 4G CGNAT puts thousands of players behind one IP).
// Suggested service: app.provide('ratelimit', { bucket(rate, burst) → { take(now, n=1) → bool } , ... }).
// FOUNDATION STUB: nothing registered yet. Keep `export function register(app)`.
export function register(app) { void app; }
