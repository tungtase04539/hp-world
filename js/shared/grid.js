// js/shared/grid.js — 128 m cell grid for AOI, chat range, zones and heat maps (ARCH §4.1). Pure ESM.
// World origin = Opera House. Cell (cx, cz): cx = floor((x − ORIGIN)/CELL), 0..N−1; cellId = cz·N + cx (u16, < 625).
// Points outside the 25 × 25 grid are clamped to the edge cells (the play disc R 1588 lies fully inside ±1600).
import { AOI } from './constants.js';

export const CELL = AOI.CELL;
export const ORIGIN = AOI.ORIGIN;
export const N = AOI.N;
export const CELL_COUNT = N * N;

const clampI = (v) => (v < 0 ? 0 : v >= N ? N - 1 : v);

export function cellX(x) { return clampI(Math.floor((x - ORIGIN) / CELL)); }
export function cellZ(z) { return clampI(Math.floor((z - ORIGIN) / CELL)); }
export function cellOf(x, z) { return cellZ(z) * N + cellX(x); }
export function cellCX(id) { return id % N; }
export function cellCZ(id) { return (id / N) | 0; }
export function inGrid(x, z) {
  return x >= ORIGIN && z >= ORIGIN && x < ORIGIN + N * CELL && z < ORIGIN + N * CELL;
}
// cell bounds in world metres: [x0, z0, x1, z1]
export function cellBounds(id, out = [0, 0, 0, 0]) {
  const cx = id % N, cz = (id / N) | 0;
  out[0] = ORIGIN + cx * CELL; out[1] = ORIGIN + cz * CELL; out[2] = out[0] + CELL; out[3] = out[1] + CELL;
  return out;
}
export function cellCenter(id, out = [0, 0]) {
  out[0] = ORIGIN + (id % N + 0.5) * CELL; out[1] = ORIGIN + (((id / N) | 0) + 0.5) * CELL;
  return out;
}

// 3 × 3 neighbourhood (the cell itself first), written into `out` (length ≥ 9). Returns the count (4..9 at edges).
export function neighbors(id, out) {
  const cx = id % N, cz = (id / N) | 0;
  let n = 0;
  out[n++] = id;
  for (let dz = -1; dz <= 1; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= N) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const x = cx + dx;
      if (x < 0 || x >= N) continue;
      out[n++] = z * N + x;
    }
  }
  return n;
}
// true when cells a and b are in each other's 3 × 3 neighbourhood
export function areNeighbors(a, b) {
  return Math.abs((a % N) - (b % N)) <= 1 && Math.abs(((a / N) | 0) - ((b / N) | 0)) <= 1;
}

// Hysteresis: keep `prev` while (x, z) is within `hyst` metres outside its bounds; otherwise return the new cell.
// Prevents subscription flapping for a player walking along a cell edge.
export function cellWithHysteresis(prev, x, z, hyst = AOI.HYST) {
  if (prev >= 0 && prev < CELL_COUNT) {
    const x0 = ORIGIN + (prev % N) * CELL, z0 = ORIGIN + ((prev / N) | 0) * CELL;
    if (x >= x0 - hyst && x < x0 + CELL + hyst && z >= z0 - hyst && z < z0 + CELL + hyst) return prev;
  }
  return cellOf(x, z);
}

// squared distance helper (avoid sqrt in AOI loops)
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
