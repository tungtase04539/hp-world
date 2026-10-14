// js/shared/constants.js — numbers shared by the game client, the game server and the headless bots.
// Pure ESM: no three.js, no DOM. Runs in Node 24 and in browsers (served statically, no bundler).
//
// The movement numbers MIRROR the single-player code (js/main.js, js/vehicles.js, js/world.js, js/daynight.js).
// They are NOT imported from there (those files import three). server/test/shared_constants_drift.test.js reads the
// source text of those files and fails when a value here no longer matches — update both sides together.

// ---- movement (m/s) ----------------------------------------------------------------------------------------------
// main.js:  const WALK = 3.0, RUN = 7.0, GRAV = 26, JUMP = 6.5;
// vehicles.js TEMPLATES: motorbike speed 16, cyclo 4.2, boat 10
export const SPEED = Object.freeze({ walk: 3.0, run: 7.0, moto: 16, cyclo: 4.2, boat: 10 });
export const ACCEL = Object.freeze({ moto: 3.6, cyclo: 1.1, boat: 1.5 });   // vehicles.js TEMPLATES accel (m/s²)
export const JUMP_V = 6.5;            // m/s initial vertical speed
export const GRAVITY = 26;            // m/s²
export const JUMP_APEX = (JUMP_V * JUMP_V) / (2 * GRAVITY);   // ≈ 0.81 m
export const LAND_H = 2;              // flat city ground level (terrain.js LAND_H)

// ---- world ----------------------------------------------------------------------------------------------------------
export const BUILD_RADIUS = 1600;                    // world.js BUILD_RADIUS
export const PLAY_RADIUS = BUILD_RADIUS - 12;        // main.js PLAY_RADIUS = 1588
export const DAY_LENGTH = 1440;                      // daynight.js DAY_LENGTH: real seconds per game day
export const DAY_START = 9 / 24;                     // a fresh session starts at 09:00 → dayT offset

// ---- movement modes (3 bits of the STATE/SNAPSHOT state byte) -------------------------------------------------------
export const MODE = Object.freeze({ WALK: 0, RUN: 1, AIR: 2, SIT: 3, MOTO: 4, CYCLO: 5, BOAT: 6, PILLION: 7 });
export const MODE_NAMES = Object.freeze(['walk', 'run', 'air', 'sit', 'moto', 'cyclo', 'boat', 'pillion']);
// max legit horizontal speed per mode (m/s). AIR uses run speed (a jump keeps horizontal speed); PILLION follows the
// driver (moto). SIT = 0 but validation still allows small slides.
export const MODE_VMAX = Object.freeze([SPEED.walk, SPEED.run, SPEED.run, 0.5, SPEED.moto, SPEED.cyclo, SPEED.boat, SPEED.moto]);
export const MODE_MOUNTED = Object.freeze([false, false, false, false, true, true, true, true]);
// state-byte flags (5 high bits)
export const SFLAG = Object.freeze({ HORN: 1, EMOTE: 2, BUSY: 4, CARGO: 8, AWAY: 16 });

// ---- ticks / rates (Hz) ---------------------------------------------------------------------------------------------
export const TICK_HZ = 20;            // server simulation
export const SNAP_HZ = 10;            // snapshots per client (staggered)
export const STATE_HZ_MOVING = 15;    // client → server while moving
export const STATE_HZ_IDLE = 2;       // client → server while standing
export const PING_HZ = 1;             // 2 Hz during the first 10 s
export const PING_FAST_HZ = 2;
export const PING_FAST_S = 10;

// ---- AOI (ARCH §5) --------------------------------------------------------------------------------------------------
export const AOI = Object.freeze({
  CELL: 128,            // m, grid cell
  ORIGIN: -1600,        // world coordinate of grid cell 0 edge (x and z)
  N: 25,                // 25 × 25 cells
  HYST: 8,              // m, cell-change hysteresis for subscriptions
  RADIUS: 120,          // m, default visibility radius
  RADIUS_MAX: 160,      // m, hard maximum
  RADIUS_L2: 80,        // m, degrade level L2
  NEAR: 40,             // m, near tier
  CAP: 96,              // records per snapshot
  FAR_HZ: 5,            // far tier (RADIUS..RADIUS_MAX) update rate
  SNAPSHOT_MAX_BYTES: 1100,
});
// degrade ladder thresholds on tick / snapshot-assembly p99 (ms) — ARCH §5
export const DEGRADE = Object.freeze({ L1_MS: 25, L2_MS: 35, L3_MS: 45, BUDGET_MS: 50 });

// ---- validation (ARCH §12, SPEC §3.2) -------------------------------------------------------------------------------
export const VALIDATE = Object.freeze({
  TIME_BUDGET_MIN_MS: -100,
  TIME_BUDGET_MAX_MS: 200,
  WINDOW_S: 1,          // sliding window for distance checks
  SLACK_MUL: 1.2,       // distance ≤ vmax·window·1.2 + 1 m
  SLACK_ADD_M: 1,
  TELEPORT_MUL: 3,      // a jump > 3 × max step = hard flag
  VIOL_DECAY_PER_S: 1,
  VIOL_CORRECT: 5,      // > 5 points → CORRECT
  VIOL_KICK: 20,        // > 20 points → kick
  Y_TOL_M: 1.5,
});

// ---- chat (SPEC §3.3) -----------------------------------------------------------------------------------------------
export const CHAT = Object.freeze({
  RADIUS: 40,           // m, SAY channel
  MAX_CHARS: 140,       // after normalisation
  MAX_BYTES: 420,       // UTF-8 bytes on the wire
  RATE_PER_S: 0.5,      // 1 msg / 2 s
  BURST: 3,
  SLOW_MODE_PLAY_S: 600,   // accounts with < 10 min play time
  SLOW_RATE_PER_S: 0.2,    // 1 msg / 5 s
  DUP_WINDOW_S: 30,
  DUP_LEVENSHTEIN: 2,
  CONTEXT_LINES: 20,    // lines attached to a report
});

// ---- nicknames / names ----------------------------------------------------------------------------------------------
export const NICK = Object.freeze({ MIN: 3, MAX: 16, DISPLAY_MAX_BYTES: 72 });

// ---- rate limits per connection (ARCH §13.3; token buckets: rate/s, burst) ------------------------------------------
export const RATE = Object.freeze({
  STATE: [25, 25],
  ACTION: [5, 5],
  CHAT: [CHAT.RATE_PER_S, CHAT.BURST],
  PING: [2, 4],
  REPORT: [0.1, 1],
  BAD_MSG_CLOSE: 10,    // malformed messages before close 1008
});

// ---- network --------------------------------------------------------------------------------------------------------
export const NET = Object.freeze({
  MAX_C2S_BYTES: 512,          // maxPayloadLength client → server
  IDLE_TIMEOUT_S: 20,
  MAX_BACKPRESSURE: 64 * 1024, // close the socket above this
  DROP_SNAPSHOT_BUFFERED: 16 * 1024,   // skip a snapshot above this, next one is a keyframe
  RESUME_S: 60,
  TICKET_TTL_S: 60,
  HELLO_TIMEOUT_S: 10,
  RESUME_TOKEN_BYTES: 16,
  MAX_TICKET_BYTES: 255,
});

export const CAPACITY_DEFAULT = 1200;
