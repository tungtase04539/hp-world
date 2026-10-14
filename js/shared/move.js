// js/shared/move.js — movement rules shared by the game server (validation), the headless bots and, later, the client.
// Pure ESM: no three, no DOM. Imports the pure terrain module read-only (js/terrain.js → js/mapdata.js).
//
// What lives here (ARCH §8.1 / §12, SPEC §3.2):
//   surface tests   landOk(x, z)  — may a land mode (walk/run/air/sit/moto/cyclo/pillion) stand here?
//                                    land, OR a bridge deck (terrain deck, BRIDGE_WAYS corridor, ELEVATED_RI road),
//                                    OR the Bến Bính pier, OR within EDGE_TOL_M of land (bank / quay edge).
//                   waterOk(x, z) — may a boat be here? water, or within BOAT_SHORE_M of water (docking).
//                   onBridge(x, z), onPier(x, z), inPlayDisc(x, z, tol)
//   allowance       stepAllowance(modeA, modeB, dtS) — metres a player may cover in dtS between two samples.
//   MoveCheck       per-player plausibility checker ("client moves first, server verifies"):
//                   time budget, per-mode 1 s sliding window, teleport, play disc, surface, vehicle rules.
//                   It only CLASSIFIES samples; the server (server/src/game/validate.js) turns violations into
//                   points / CORRECT / kick. Bots can run the same checker on themselves.
//
// Time budget model (client clock vs real time, ARCH §12.2): each STATE carries clientMs (u16, wraps). The checker
// unwraps it to a monotonic client time C and computes the one-way offset o = serverRecvMs − C. For an honest client
// o = trueOffset + networkDelay ≥ trueOffset + minDelay. During LEARN_MS after a reset `base` follows the minimum of o
// freely; afterwards base may sink only at the tolerated quartz drift (DRIFT_MS_PER_S). A client whose clock runs fast
// (time-dilation speed hack) makes o fall continuously: more than TIME_AHEAD_MS (100 ms, = −VALIDATE.TIME_BUDGET_MIN_MS)
// below the drifting floor → TIME violation, and base is re-anchored 100 ms below that sample (so the next violation
// needs another 200 ms of lead). A client that lags (o above base) is not penalised — bursts after a network stall
// bring o back to base, never below — but lag credit is capped: when EVERY sample of the last LAG_WINDOW_MS was more
// than TIME_LAG_MS (200 ms, = VALIDATE.TIME_BUDGET_MAX_MS) above base, base is raised to (that window's minimum −
// 200 ms). So time cannot be "banked" for more than ~10 s.
//
// Distance window: positions are judged in CLIENT time (validated by the time budget above), so jitter and bursts of
// delayed packets never look like speed. Over the samples of the last WINDOW_S (1 s) of client time:
//   straight-line distance ≤ SLACK_MUL · Σ segAllow + SLACK_ADD_M (the window starts after the last mount/dismount;
//   the mount step itself gets + MOUNT_SLACK_M)
//   segAllow = max(vmax(mode before), vmax(mode after)) · Δt        (vmax = constants.js MODE_VMAX)
// Teleport (hard flag): one step longer than max(TELEPORT_MIN_M, TELEPORT_MUL × that step's own limit).
import { isWater, groundHeight, groundHeightNoDeck, BRIDGE_WAYS, ROADS_DT, ELEVATED_RI, nearestRiverPoint } from '../terrain.js';
import { roadHW, sidewalkW } from '../xsection.js';
import { MODE, MODE_VMAX, MODE_MOUNTED, PLAY_RADIUS, VALIDATE, LAND_H } from './constants.js';

export const MOVE = Object.freeze({
  TIME_AHEAD_MS: -VALIDATE.TIME_BUDGET_MIN_MS,   // 100: client clock may lead real time by this much
  TIME_LAG_MS: VALIDATE.TIME_BUDGET_MAX_MS,      // 200: lag credit kept after a sustained lag
  LAG_WINDOW_MS: 10000,                          // a lag must be sustained this long before credit is capped
  DRIFT_MS_PER_S: 2,                             // tolerated clock drift (0.2 %)
  LEARN_MS: 5000,                                // after a reset the minimum delay is learned freely for 5 s
  WINDOW_MS: VALIDATE.WINDOW_S * 1000,
  BURST_MS: 300,             // second, short window (same slack): an idle player cannot "bank" 1 s of allowance and
                             // dash at 3× for half a second before the 1 s window overflows (integration 15/10/2026)
  SLACK_MUL: VALIDATE.SLACK_MUL,
  SLACK_ADD_M: VALIDATE.SLACK_ADD_M,
  TELEPORT_MUL: VALIDATE.TELEPORT_MUL,
  TELEPORT_MIN_M: 12,        // dismount searches a free spot up to 8 m away (main.js dismount), mount snaps to the seat
  MOUNT_SLACK_M: 9,          // extra metres in a window that mounts / dismounts
  FIRST_RADIUS_M: 15,        // first STATE after a (re)start may be this far from the anchor (spawn jitter, dismount)
  FIRST_RTT_S: 1,            // extra seconds of allowance for the first STATE (RTT / loading)
  MAX_GAP_S: 30,             // allowance for a single gap is capped at this many seconds
  PLAY_TOL_M: 2,             // play disc tolerance (quantisation, clampToPlayArea slide)
  PLAY_HARD_M: 50,           // beyond PLAY_RADIUS + this = hard flag
  EDGE_TOL_M: 1.5,           // land modes: water within this distance of land is tolerated (bank edges)
  BOAT_SHORE_M: 8,           // boats: land within this distance of water is tolerated (docking at a pier)
  BRIDGE_MARGIN_M: 3,        // bridge corridor = half deck width + this
  RING: 48,                  // samples kept (> 25 Hz × 1 s)
});

// violation codes (match js/shared/protocol.js CORRECT_REASON values)
export const MV = Object.freeze({ OK: 0, SPEED: 1, TIME: 2, WATER: 3, OUT_OF_BOUNDS: 4, TELEPORT: 5, MODE: 6 });

const LAND_MODES = Object.freeze([true, true, true, true, true, true, false, true]);   // BOAT is the only water mode
export const isLandMode = (mode) => LAND_MODES[mode & 7];
export const vmaxOf = (mode) => MODE_VMAX[mode & 7];
export const isMountedMode = (mode) => MODE_MOUNTED[mode & 7];

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t), ez = pz - (az + dz * t);
  return Math.sqrt(ex * ex + ez * ez);
}

export function inPlayDisc(x, z, tol = 0) {
  const r = PLAY_RADIUS + tol;
  return x * x + z * z <= r * r;
}

// ---- bridge corridor index (BRIDGE_WAYS decks + ELEVATED_RI road ways), 64 m buckets ---------------------------------
const BK = 64, BK_N = 64, BK_O = -2048;   // covers [-2048, 2048) — the play disc is inside ±1588
const bucketOf = (x, z) => {
  const cx = Math.floor((x - BK_O) / BK), cz = Math.floor((z - BK_O) / BK);
  return cx < 0 || cz < 0 || cx >= BK_N || cz >= BK_N ? -1 : cz * BK_N + cx;
};
let bridgeIdx = null;   // Map bucket → Float64Array-like list of segments [ax, az, bx, bz, halfW]
function buildBridgeIndex() {
  const tmp = new Map();
  const addSeg = (ax, az, bx, bz, hw) => {
    const x0 = Math.min(ax, bx) - hw, x1 = Math.max(ax, bx) + hw, z0 = Math.min(az, bz) - hw, z1 = Math.max(az, bz) + hw;
    for (let z = Math.floor((z0 - BK_O) / BK); z <= Math.floor((z1 - BK_O) / BK); z++) {
      for (let x = Math.floor((x0 - BK_O) / BK); x <= Math.floor((x1 - BK_O) / BK); x++) {
        if (x < 0 || z < 0 || x >= BK_N || z >= BK_N) continue;
        const k = z * BK_N + x;
        let a = tmp.get(k);
        if (!a) { a = []; tmp.set(k, a); }
        a.push(ax, az, bx, bz, hw);
      }
    }
  };
  for (const b of BRIDGE_WAYS || []) {
    const P = b.pts, hw = (b.w || 10) / 2 + MOVE.BRIDGE_MARGIN_M;
    for (let i = 0; i + 1 < P.length; i++) addSeg(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], hw);
  }
  for (const ri of ELEVATED_RI) {
    const w = ROADS_DT[ri];
    if (!w) continue;
    const hw = roadHW(w) + sidewalkW(w) + MOVE.BRIDGE_MARGIN_M, P = w.pts;
    for (let i = 0; i + 1 < P.length; i++) addSeg(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], hw);
  }
  const out = new Map();
  for (const [k, a] of tmp) out.set(k, Float64Array.from(a));
  return out;
}
// true when (x, z) is inside the deck corridor of a bridge way (any level — the server does not know the deck height
// the player is on; y is not validated in v1)
export function onBridge(x, z) {
  if (!bridgeIdx) bridgeIdx = buildBridgeIndex();
  const a = bridgeIdx.get(bucketOf(x, z));
  if (!a) return false;
  for (let i = 0; i < a.length; i += 5) if (segDist(x, z, a[i], a[i + 1], a[i + 2], a[i + 3]) <= a[i + 4]) return true;
  return false;
}

// ---- piers inside the play disc (mirrors world.js buildPier for Bến Bính; deterministic from terrain) ---------------
let piers = null;
function buildPiers() {
  const out = [];
  try {
    const bank = nearestRiverPoint(-30) || [-12, -166, 62];
    let shoreZ = bank[1] + bank[2] / 2 + 6;
    for (let tz = shoreZ; tz > shoreZ - 400; tz -= 4) {
      if (groundHeightNoDeck(-24, tz) < 0.25) { shoreZ = tz + 8; break; }
    }
    const x0 = -24, z0 = shoreZ, dx = 0, dz = -1;
    let endT = 34;
    for (let t = 8; t <= 70; t += 4) {
      if (groundHeightNoDeck(x0 + dx * t, z0 + dz * t) < -1.2) { endT = t + 8; break; }
      endT = t + 8;
    }
    const ex = x0 + dx * endT, ez = z0 + dz * endT, m = 4 + 2;   // world.js margin 4 + 2 m tolerance
    out.push({ x0: Math.min(x0, ex) - m, x1: Math.max(x0, ex) + m, z0: Math.min(z0, ez) - m, z1: Math.max(z0, ez) + m });
  } catch { /* terrain data changed shape: no pier tolerance */ }
  return out;
}
export function onPier(x, z) {
  if (!piers) piers = buildPiers();
  for (const p of piers) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return true;
  return false;
}
export function pierRects() { if (!piers) piers = buildPiers(); return piers; }

// any point on a ring of radius r around (x, z) (8 directions) satisfies pred
function ringAny(x, z, r, pred) {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (pred(x + r * Math.cos(a), z + r * Math.sin(a))) return true;
  }
  return false;
}
const notWater = (x, z) => !isWater(x, z);

// terrain deck (street bridges over water, arch bridges) — groundHeight lifts the surface above the water bed
export function onDeck(x, z) { return groundHeight(x, z) > LAND_H - 0.5; }

// Surface classification for a point: 0 land, 1 deck/bridge/pier over water, 2 water at a bank edge, 3 open water.
export function surfaceKind(x, z) {
  if (!isWater(x, z)) return 0;
  if (onDeck(x, z) || onBridge(x, z) || onPier(x, z)) return 1;
  if (ringAny(x, z, MOVE.EDGE_TOL_M, notWater)) return 2;
  return 3;
}
export function landOk(x, z) { return surfaceKind(x, z) !== 3; }
export function waterOk(x, z) {
  return isWater(x, z) || ringAny(x, z, MOVE.BOAT_SHORE_M * 0.5, isWater) || ringAny(x, z, MOVE.BOAT_SHORE_M, isWater);
}

// metres allowed between two samples dtS apart (before the window slack)
export function stepAllowance(modeA, modeB, dtS) {
  const v = Math.max(vmaxOf(modeA), vmaxOf(modeB));
  return v * dtS;
}

// =====================================================================================================================
// MoveCheck — per-player sample classifier (no allocation per sample)
// =====================================================================================================================
// usage:
//   const mc = new MoveCheck();
//   mc.reset(x, z, mode, serverMs)                  anchor (spawn / correction / takeover); time base re-learned
//   const r = mc.check(clientMs16, x, z, mode, serverMs, flags)
//       flags: bit 1 = vehicleOk (the server confirmed the mounted vehicle), bit 2 = skipSurface (tests)
//       r === MV.OK → sample accepted and recorded; else violation code (sample NOT recorded); mc.hard is true for
//       hard flags (teleport, far outside the disc). mc.lastDist / mc.lastLimit describe the failed window check.
//   mc.correctTo(x, z, mode)                        after a CORRECT: next samples are judged from here
export const MCF = Object.freeze({ VEHICLE_OK: 1, SKIP_SURFACE: 2 });

export class MoveCheck {
  constructor() {
    const n = MOVE.RING;
    this.t = new Float64Array(n);       // client time (ms, unwrapped)
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.m = new Uint8Array(n);
    this.allow = new Float64Array(n);   // cumulative allowance (m) up to this sample
    this.head = -1; this.count = 0;
    this.reset(0, 0, MODE.WALK, 0);
  }
  // Anchor at a server-chosen position. The next sample is judged against it with real (server) elapsed time.
  reset(x, z, mode, serverMs) {
    this.head = -1; this.count = 0;
    this.ax = x; this.az = z; this.amode = mode; this.aServerMs = serverMs; this.anchored = true;
    this.lastClient16 = -1; this.clientT = 0; this.lastServerMs = serverMs;
    this.base = NaN; this.baseT = serverMs; this.learnUntil = 0;
    this.lagMinCur = Infinity; this.lagMinPrev = Infinity; this.lagBucketT = serverMs; this.lagBuckets = 0;
    this.hard = false; this.lastDist = 0; this.lastLimit = 0; this.lastDt = 0;
    this.accepted = 0;
  }
  // after a CORRECT: keep the time base, restart the window from the corrected point at the latest client time
  correctTo(x, z, mode, serverMs) {
    const t = this.clientT, base = this.base, baseT = this.baseT, l16 = this.lastClient16, learn = this.learnUntil;
    const lc = this.lagMinCur, lp = this.lagMinPrev, lb = this.lagBucketT, lbn = this.lagBuckets;
    this.reset(x, z, mode, serverMs);
    this.base = base; this.baseT = baseT; this.lastClient16 = l16; this.clientT = t; this.learnUntil = learn;
    this.lagMinCur = lc; this.lagMinPrev = lp; this.lagBucketT = lb; this.lagBuckets = lbn;
    if (l16 >= 0) { this.anchored = false; this._push(t, x, z, mode, 0); }
  }
  get lastX() { return this.count ? this.x[this.head] : this.ax; }
  get lastZ() { return this.count ? this.z[this.head] : this.az; }
  get lastMode() { return this.count ? this.m[this.head] : this.amode; }

  _push(t, x, z, mode, add) {
    const n = MOVE.RING;
    const prevAllow = this.count ? this.allow[this.head] : 0;
    this.head = (this.head + 1) % n;
    this.t[this.head] = t; this.x[this.head] = x; this.z[this.head] = z; this.m[this.head] = mode;
    this.allow[this.head] = prevAllow + add;
    if (this.count < n) this.count++;
  }

  // distance from ring sample s to (x, z) beyond the allowance accumulated since s (+ this segment)? (sets lastDist/Limit)
  _over(s, x, z, segAllow, slack) {
    const wx = x - this.x[s], wz = z - this.z[s];
    const d = Math.sqrt(wx * wx + wz * wz);
    const lim = (this.allow[this.head] - this.allow[s] + segAllow) * MOVE.SLACK_MUL + slack;
    if (d <= lim) return false;
    this.lastDist = d; this.lastLimit = lim;
    return true;
  }

  // ---- time budget: returns true when the sample's client time is plausible -----------------------------------------
  _time(clientMs16, serverMs) {
    // unwrap the u16 client clock; long gaps are resolved with the real elapsed time
    let ct;
    if (this.lastClient16 < 0) ct = clientMs16;
    else {
      let d = (clientMs16 - this.lastClient16) & 0xffff;
      const real = serverMs - this.lastServerMs;
      if (real > 30000) d += 65536 * Math.max(0, Math.round((real - d) / 65536));
      ct = this.clientT + d;
    }
    this.lastClient16 = clientMs16; this.clientT = ct; this.lastServerMs = serverMs;
    const o = serverMs - ct;
    if (Number.isNaN(this.base)) {
      this.base = o; this.baseT = serverMs; this.lagBucketT = serverMs; this.learnUntil = serverMs + MOVE.LEARN_MS;
      return true;
    }
    let ok = true;
    if (serverMs < this.learnUntil) {
      if (o < this.base) this.base = o;           // learning the minimum network delay: follow freely
    } else {
      // base follows a falling offset no faster than the tolerated clock drift; a lead beyond that by > 100 ms is a
      // violation (then re-anchor 100 ms lower: the next violation needs another 200 ms of lead, so the catch-up after a
      // long bufferbloat costs few points while a fast clock keeps failing)
      const floor = this.base - (MOVE.DRIFT_MS_PER_S * (serverMs - this.baseT)) / 1000;
      if (o < floor - MOVE.TIME_AHEAD_MS) { ok = false; this.base = o - MOVE.TIME_AHEAD_MS; }
      else if (o < this.base) this.base = o > floor ? o : floor;
    }
    this.baseT = serverMs;
    // lag cap: rolling minimum over two half-windows (≈ LAG_WINDOW_MS)
    if (o < this.lagMinCur) this.lagMinCur = o;
    if (serverMs - this.lagBucketT >= MOVE.LAG_WINDOW_MS / 2) {
      const winMin = Math.min(this.lagMinPrev, this.lagMinCur);
      this.lagMinPrev = this.lagMinCur; this.lagMinCur = Infinity; this.lagBucketT = serverMs; this.lagBuckets++;
      if (this.lagBuckets >= 2 && winMin - this.base > MOVE.TIME_LAG_MS) {
        this.base = winMin - MOVE.TIME_LAG_MS; this.baseT = serverMs;
      }
    }
    return ok;
  }

  check(clientMs16, x, z, mode, serverMs, flags = 0) {
    this.hard = false; this.lastDist = 0; this.lastLimit = 0;
    const timeOk = this._time(clientMs16 & 0xffff, serverMs);
    const t = this.clientT;
    mode &= 7;

    // play disc
    const r2 = x * x + z * z;
    const rIn = PLAY_RADIUS + MOVE.PLAY_TOL_M;
    if (r2 > rIn * rIn) {
      const rh = PLAY_RADIUS + MOVE.PLAY_HARD_M;
      this.hard = r2 > rh * rh;
      return MV.OUT_OF_BOUNDS;
    }

    // movement against the previous accepted sample / the anchor
    let px, pz, pmode, dt;
    if (this.count === 0) {
      px = this.ax; pz = this.az; pmode = this.amode;
      dt = Math.min(MOVE.MAX_GAP_S, Math.max(0, (serverMs - this.aServerMs) / 1000) + MOVE.FIRST_RTT_S);
    } else {
      px = this.x[this.head]; pz = this.z[this.head]; pmode = this.m[this.head];
      dt = Math.min(MOVE.MAX_GAP_S, Math.max(0, (t - this.t[this.head]) / 1000));
    }
    const sx = x - px, sz = z - pz;
    const step = Math.sqrt(sx * sx + sz * sz);
    const segAllow = stepAllowance(pmode, mode, dt);
    const mountChange = isMountedMode(pmode) !== isMountedMode(mode);
    let stepLim = segAllow * MOVE.SLACK_MUL + MOVE.SLACK_ADD_M + (mountChange ? MOVE.MOUNT_SLACK_M : 0);
    if (this.count === 0) stepLim += MOVE.FIRST_RADIUS_M;
    this.lastDt = dt;
    if (step > Math.max(MOVE.TELEPORT_MIN_M + (this.count === 0 ? MOVE.FIRST_RADIUS_M : 0), MOVE.TELEPORT_MUL * stepLim)) {
      this.hard = true; this.lastDist = step; this.lastLimit = stepLim;
      return MV.TELEPORT;
    }

    // sliding window (client time): oldest accepted sample within WINDOW_MS
    if (this.count > 0) {
      const n = MOVE.RING;
      // The window never reaches back across a mount / dismount: the (up to 8 m) mount jump is judged once, on its own
      // step (mountChange → window = that single segment + MOUNT_SLACK_M), and the samples after it are judged against
      // the new mode only. (Integration 15/10/2026: before, a dismount kept +9 m slack and the previous mode's speed in
      // the window for a whole second, so a walk-mode speed hack right after riding went unflagged for ~1.2 s.)
      let i = this.head, k = 0, ib = this.head;
      if (!mountChange) {
        while (k + 1 < this.count) {
          const j = (i - 1 + n) % n;
          if (t - this.t[j] > MOVE.WINDOW_MS) break;
          if (isMountedMode(this.m[j]) !== isMountedMode(this.m[i])) break;
          i = j; k++;
          if (t - this.t[j] <= MOVE.BURST_MS) ib = j;
        }
      }
      const slack = MOVE.SLACK_ADD_M + (mountChange ? MOVE.MOUNT_SLACK_M : 0);
      if (this._over(i, x, z, segAllow, slack) || (ib !== i && this._over(ib, x, z, segAllow, slack))) return MV.SPEED;
    } else if (step > stepLim) {
      this.lastDist = step; this.lastLimit = stepLim;
      return MV.SPEED;
    }

    if (!timeOk) return MV.TIME;

    // vehicle rules: shared vehicles / boats / pillion need the server's confirmation
    if (mode === MODE.CYCLO || mode === MODE.BOAT || mode === MODE.PILLION) {
      if (!(flags & MCF.VEHICLE_OK)) return MV.MODE;
    }
    // surface
    if (!(flags & MCF.SKIP_SURFACE)) {
      if (mode === MODE.BOAT) { if (!waterOk(x, z)) return MV.MODE; }
      else if (!landOk(x, z)) return MV.WATER;
    }

    this._push(t, x, z, mode, segAllow);
    this.anchored = false;
    this.accepted++;
    return MV.OK;
  }
}
