// js/shared/protocol.js — wire protocol identifiers (ARCH §6.4). Pure ESM, shared by client worker, server and bots.
// Byte layouts live in js/shared/codec.js (the ONLY file that reads or writes the wire format).
// Bump PROTO_VERSION on any incompatible layout change; the server answers a mismatch with SYSTEM {code: RELOAD}.

export const PROTO_VERSION = 1;

// ---- client → server opcodes ----------------------------------------------------------------------------------------
export const C2S = Object.freeze({
  HELLO: 0x01,
  READY: 0x02,
  STATE: 0x10,
  ACTION: 0x11,
  CHAT: 0x12,
  PING: 0x13,
  REPORT: 0x14,
});

// ---- server → client opcodes ----------------------------------------------------------------------------------------
export const S2C = Object.freeze({
  WELCOME: 0x81,
  SNAPSHOT: 0x82,
  NAMES: 0x83,
  EVENT: 0x84,
  STATS: 0x85,
  CHAT: 0x86,
  SYSTEM: 0x87,
  PONG: 0x88,
  CORRECT: 0x89,
  WORLD: 0x8a,
});

export const OP_NAMES = Object.freeze(Object.fromEntries([
  ...Object.entries(C2S).map(([k, v]) => [v, k]),
  ...Object.entries(S2C).map(([k, v]) => [v, k]),
]));

// ---- HELLO flags ----------------------------------------------------------------------------------------------------
export const HELLO_FLAG = Object.freeze({ RESUME: 1 });   // RESUME: a 16-byte resumeToken follows the ticket

// ---- SNAPSHOT flags -------------------------------------------------------------------------------------------------
export const SNAP_FLAG = Object.freeze({
  KEYFRAME: 1,      // full AOI state: every visible entity is in ENTER; the client drops its slot table first
  DELTA_P2: 2,      // reserved: P2 delta update records (not implemented in proto 1; decoders reject it)
  DEGRADED: 4,      // the server is on degrade level ≥ L1 (informational)
});

// ---- chat channels --------------------------------------------------------------------------------------------------
export const CHANNEL = Object.freeze({ SAY: 0, SYSTEM: 1, PARTY: 2 });   // PARTY reserved (GĐ4)

// ---- SYSTEM codes (S2C SYSTEM {code u8, arg u32}) -------------------------------------------------------------------
export const SYS = Object.freeze({
  KICK: 1,              // arg = KICK_REASON
  RESTART_IN: 2,        // arg = seconds until restart
  QUEUE_POS: 3,         // arg = position in queue (1-based)
  RELOAD: 4,            // proto / worldVersion mismatch → reload the page; arg = server PROTO_VERSION
  BACKOFF: 5,           // arg = ms the client should wait before reconnecting
  BANNED: 6,            // arg = seconds remaining (0xFFFFFFFF = permanent)
  MUTED: 7,             // arg = seconds remaining
  SERVER_FULL: 8,       // arg = ETA seconds
  DUPLICATE_SESSION: 9, // this account connected elsewhere
  AUTH_FAILED: 10,      // ticket invalid / expired / reused; arg = AUTH_REASON
  RESUMED: 11,          // resume accepted; arg = netId
  DEGRADE: 12,          // arg = degrade level 0..4 (informational)
  NOT_IMPLEMENTED: 13,  // stub server answered (development only)
});

export const KICK_REASON = Object.freeze({ ADMIN: 1, CHEAT: 2, ABUSE: 3, IDLE: 4, SHUTDOWN: 5, PROTOCOL: 6, BACKPRESSURE: 7 });
export const AUTH_REASON = Object.freeze({ BAD_TICKET: 1, EXPIRED: 2, REUSED: 3, BAD_RESUME: 4, NO_HELLO: 5 });

// ---- CORRECT reasons ------------------------------------------------------------------------------------------------
export const CORRECT_REASON = Object.freeze({
  SPEED: 1, TIME: 2, WATER: 3, OUT_OF_BOUNDS: 4, TELEPORT: 5, MODE: 6, RESPAWN: 7, SERVER_MOVE: 8, HEIGHT: 9,
});

// ---- ACTION types (C2S ACTION {reqId u16, type u8, target u32, arg u32}) --------------------------------------------
export const ACTION = Object.freeze({
  INTERACT: 1, BUY: 2, EAT: 3, DRINK: 4, MOUNT: 5, DISMOUNT: 6, JOB_ACCEPT: 7, JOB_PICKUP: 8, JOB_DELIVER: 9,
  EMOTE: 10, TALK: 11, CLAIM_PICKUP: 12, GIVE: 13, INVITE: 14, BLOCK_PLAYER: 15, UNBLOCK_PLAYER: 16, CALL_MOTO: 17,
});

// ---- EVENT types (S2C EVENT {type u16, args i32[≤ 8]}) — codes + params, the client localises with i18n.t() --------
export const EVENT = Object.freeze({
  ACTION_RESULT: 1,     // args: [reqId, resultCode, ...]
  CHAT_REJECTED: 2,     // args: [CHAT_CODE, retryAfterMs]
  REPORT_RESULT: 3,     // args: [REPORT_CODE]
  SUPPORT_LINE: 4,      // self-harm keyword → show the support-line message (no args)
  PLAYER_AWAY: 5,       // args: [netId, away 0|1]
  WEATHER_WARN: 6,      // args: [kind, startsInS]
  SANCTION: 7,          // args: [kind, seconds]
});

// EVENT ACTION_RESULT args[1] (integration 15/10/2026: moved here from server/src/game/gateway.js)
export const ACTION_RESULT = Object.freeze({ OK: 0, UNSUPPORTED: 1, BUSY: 2, INVALID: 3, DENIED: 4 });
// EVENT SANCTION args[0] (args[1] = seconds left; 0xFFFFFFFF = permanent). A shadow mute is never sent to the player.
export const SANCTION_KIND = Object.freeze({ MUTE: 1, BAN: 2, KICK: 3, WARN: 4 });

export const CHAT_CODE = Object.freeze({
  OK: 0, RATE: 1, DUPLICATE: 2, TOO_LONG: 3, EMPTY: 4, BLOCKED: 5, MUTED: 6, SLOW_MODE: 7, CHANNEL: 8,
});
export const REPORT_CODE = Object.freeze({ OK: 0, RATE: 1, UNKNOWN_TARGET: 2, SELF: 3, DUPLICATE: 4 });
export const REPORT_REASON = Object.freeze({ CHAT_ABUSE: 1, HARASSMENT: 2, CHEATING: 3, SPAM: 4, BAD_NAME: 5, OTHER: 6 });

// ---- WebSocket close codes ------------------------------------------------------------------------------------------
export const CLOSE = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  POLICY: 1008,         // malformed / abusive traffic
  TOO_BIG: 1009,
  AUTH: 4001,
  DUPLICATE: 4002,
  BANNED: 4003,
  PROTO: 4004,
  FULL: 4005,
  RATE: 4006,
  HELLO_TIMEOUT: 4007,
  BACKPRESSURE: 4008,
  KICKED: 4009,
  SHUTDOWN: 4010,
});

// ---- STATS bits (S2C STATS mask) ------------------------------------------------------------------------------------
export const STAT = Object.freeze({ HUNGER: 0, THIRST: 1, STAMINA: 2, HEALTH: 3, HEAT: 4, MONEY: 5 });
export const STAT_COUNT_U8 = 5;   // bits 0..4 carry {value u8, rate i8}; bit 5 carries money as unsigned LEB128

// ---- weather kinds (WELCOME weather block / WORLD) ------------------------------------------------------------------
export const WEATHER = Object.freeze({ CLEAR: 0, CLOUDY: 1, DRIZZLE: 2, RAIN: 3, THUNDER: 4, STORM: 5, FOG: 6 });

// ---- HTTP API error codes (JSON {error: <code>}) --------------------------------------------------------------------
export const API_ERR = Object.freeze({
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  INVITE_REQUIRED: 'invite_required',
  INVITE_INVALID: 'invite_invalid',
  NICK_INVALID: 'nickname_invalid',
  PROTO_MISMATCH: 'proto_mismatch',
  SERVER_FULL: 'server_full',
  NOT_IMPLEMENTED: 'not_implemented',
  INTERNAL: 'internal',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  ORIGIN: 'origin_not_allowed',
});
