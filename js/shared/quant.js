// js/shared/quant.js — quantisation of wire fields (ARCH §6.3). Pure ESM, no allocation.
//
// | field      | type | step      | range                     |
// |------------|------|-----------|---------------------------|
// | x, z       | u16  | 0.05 m    | [-1638.4, +1638.35] m     |
// | y          | u8   | 0.25 m    | [0, 63.75] m              |
// | yaw        | u8   | 2π/256    | dequant → [-π, π)         |
// | spd        | u8   | 0.125 m/s | [0, 31.875] m/s           |
// | vx, vz     | i8   | 0.25 m/s  | [-32, +31.75] m/s         |
// | state      | u8   | 3 bits mode (MODE) + 5 bits flags (SFLAG) |
// Every quantiser clamps (never wraps) except yaw, which is periodic.

export const POS_STEP = 0.05;
export const POS_MIN = -1638.4;
export const POS_MAX = POS_MIN + 65535 * POS_STEP;   // 1638.35
export const Y_STEP = 0.25;
export const Y_MAX = 255 * Y_STEP;                   // 63.75
export const SPD_STEP = 0.125;
export const SPD_MAX = 255 * SPD_STEP;               // 31.875
export const VEL_STEP = 0.25;
const TWO_PI = Math.PI * 2;

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function qPos(m) {
  if (!(m === m)) return 32768;   // NaN → 0 m
  return clampInt(Math.round((m - POS_MIN) / POS_STEP), 0, 65535);
}
export function dqPos(q) { return Math.round((POS_MIN + q * POS_STEP) * 100) / 100; }

export function qY(m) {
  if (!(m === m)) return 0;
  return clampInt(Math.round(m / Y_STEP), 0, 255);
}
export function dqY(q) { return q * Y_STEP; }

export function qYaw(rad) {
  if (!(rad === rad) || !Number.isFinite(rad)) return 0;
  let t = rad / TWO_PI;
  t -= Math.floor(t);                 // [0, 1)
  return Math.round(t * 256) & 255;
}
export function dqYaw(q) {
  const a = ((q & 255) / 256) * TWO_PI;
  return a >= Math.PI ? a - TWO_PI : a;   // [-π, π)
}

export function qSpd(ms) {
  if (!(ms === ms)) return 0;
  return clampInt(Math.round(ms / SPD_STEP), 0, 255);
}
export function dqSpd(q) { return q * SPD_STEP; }

export function qVel(ms) {
  if (!(ms === ms)) return 0;
  return clampInt(Math.round(ms / VEL_STEP), -128, 127);
}
export function dqVel(q) { return q * VEL_STEP; }

export function packState(mode, flags) { return ((mode & 7) | ((flags & 31) << 3)) & 255; }
export function stateMode(s) { return s & 7; }
export function stateFlags(s) { return (s >> 3) & 31; }

// smallest angle difference a-b in (-π, π]
export function angleDiff(a, b) {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI; else if (d <= -Math.PI) d += TWO_PI;
  return d;
}
