// game/validate.js — OWNER: S2. Movement validation (ARCH §12 items 2, 3, 5, 6; SPEC §3.2) on top of the pure checker
// js/shared/move.js MoveCheck: time budget [−100, +200] ms, per-mode 1 s sliding-window distance ≤ v_max·1.2 + 1 m,
// play disc, teleport (> 3 × max step = hard flag), mounted-mode rules (personal moto any time on land; shared
// vehicles / boats need a claim; boat only on water; pillion next to a rider), on-foot water with bridge tolerance.
// Violation points: +1 per violating STATE (the k-th consecutive SPEED violation: +min(k, 3)), +5 for a hard flag,
// −1 per second; > 5 → CORRECT (snap back to the last
// accepted position, corrEpoch + 1), > 20 → kick. A hard flag corrects immediately. Never a ban for one event.
// STATEs carrying an old corrEpoch are ignored (the client has not applied the CORRECT yet); a client that keeps
// ignoring a CORRECT gets it re-sent every 3 s and is kicked after 5 re-sends.
//
// Service 'validate':
//   createValidator() → Validator   (one per session; game/gateway.js drives it)
//   vehicles: {claim(session, ref) → bool, release(session), holder(ref) → session|null, size}
import { MoveCheck, MV, MCF, isMountedMode } from '../../../js/shared/move.js';
import { MODE, VALIDATE } from '../../../js/shared/constants.js';
import { CORRECT_REASON } from '../../../js/shared/protocol.js';

export const VAL = Object.freeze({
  POINTS_HARD: 5,
  RESEND_MS: 3000,
  MAX_RESENDS: 5,
  PILLION_R: 4,             // m: a pillion passenger must be this close to a rider
  SPEED_STREAK_MAX: 3,      // points of the k-th consecutive speed violation = min(k, 3)
});

// result object reused per call (read immediately)
export class Validator {
  constructor() {
    this.mc = new MoveCheck();
    this.points = 0;
    this.pointsT = 0;
    this.speedStreak = 0;       // consecutive speed violations (reset by an accepted STATE or a CORRECT)
    this.pending = false;       // a CORRECT is waiting for the client's ack (new corrEpoch)
    this.pendingSince = 0;
    this.resends = 0;
    this.lastResend = 0;
    this.counts = new Uint32Array(10);   // violations by MV code
    this.corrections = 0;
    this.accepted = 0;
    this.r = { accepted: false, violation: 0, correct: 0, kick: false, hard: false };
    this.extraFlags = 0;          // tests: MCF.SKIP_SURFACE
  }
  reset(x, z, mode, now) {
    this.mc.reset(x, z, mode, now);
    this.pending = false; this.resends = 0;
  }
  _decay(now) {
    if (this.points > 0) this.points = Math.max(0, this.points - (VALIDATE.VIOL_DECAY_PER_S * (now - this.pointsT)) / 1000);
    this.pointsT = now;
  }
  // A STATE whose corrEpoch matches the session's. vehicleOk: the server confirmed the mounted vehicle (or N/A).
  onState(clientMs, x, z, mode, now, vehicleOk) {
    const r = this.r;
    r.accepted = false; r.violation = 0; r.correct = 0; r.kick = false; r.hard = false;
    this.pending = false; this.resends = 0;
    this._decay(now);
    const v = this.mc.check(clientMs, x, z, mode, now, (vehicleOk ? MCF.VEHICLE_OK : 0) | this.extraFlags);
    if (v === MV.OK) { r.accepted = true; this.accepted++; this.speedStreak = 0; return r; }
    r.violation = v; r.hard = this.mc.hard;
    this.counts[v]++;
    // sustained speeding escalates: the k-th CONSECUTIVE speed violation costs min(k, 3) points, so a speed hack is
    // corrected on its 3rd rejected STATE (≈ 0.2–0.3 s after the window first overflows) instead of the 6th, while an
    // isolated honest overflow still costs 1 point (integration 15/10/2026: bot abuse T7 "rejected within 1 s")
    let add = 1;
    if (v === MV.SPEED) add = Math.min(VAL.SPEED_STREAK_MAX, ++this.speedStreak);
    else this.speedStreak = 0;
    this.points += r.hard ? VAL.POINTS_HARD : add;
    if (this.points > VALIDATE.VIOL_KICK) { r.kick = true; return r; }
    if (r.hard || this.points > VALIDATE.VIOL_CORRECT) r.correct = correctReason(v);
    return r;
  }
  // the gateway sent a CORRECT: judge the next samples from the corrected point
  corrected(x, z, mode, now) {
    this.mc.correctTo(x, z, mode, now);
    this.speedStreak = 0;
    this.pending = true; this.pendingSince = now; this.lastResend = now; this.resends = 0;
    this.corrections++;
  }
  // a STATE with an old corrEpoch arrived → 'resend' | 'kick' | null
  onStale(now) {
    if (!this.pending) return null;
    if (now - this.lastResend < VAL.RESEND_MS) return null;
    this.lastResend = now;
    if (++this.resends > VAL.MAX_RESENDS) return 'kick';
    return 'resend';
  }
  get pointsNow() { return this.points; }
}

export function correctReason(v) {
  switch (v) {
    case MV.SPEED: return CORRECT_REASON.SPEED;
    case MV.TIME: return CORRECT_REASON.TIME;
    case MV.WATER: return CORRECT_REASON.WATER;
    case MV.OUT_OF_BOUNDS: return CORRECT_REASON.OUT_OF_BOUNDS;
    case MV.TELEPORT: return CORRECT_REASON.TELEPORT;
    case MV.MODE: return CORRECT_REASON.MODE;
    default: return CORRECT_REASON.SERVER_MOVE;
  }
}
export const MV_NAMES = Object.freeze(['ok', 'speed', 'time', 'water', 'bounds', 'teleport', 'mode']);

// Shared-vehicle claims (default moto, cyclo, boats): vehicleRef u16 ≠ 0 → one rider at a time. The personal moto is
// vehicleRef 0 and needs no claim. Claims are released on dismount (a non-mounted STATE), DISMOUNT, or session end.
export function createVehicles() {
  const holders = new Map();   // ref → session
  return {
    claim(session, ref) {
      if (!ref) return true;
      const h = holders.get(ref);
      if (h && h !== session) return false;
      if (session.vehicleRef && session.vehicleRef !== ref) holders.delete(session.vehicleRef);
      holders.set(ref, session);
      session.vehicleRef = ref;
      return true;
    },
    release(session) {
      if (session.vehicleRef && holders.get(session.vehicleRef) === session) holders.delete(session.vehicleRef);
      session.vehicleRef = 0;
    },
    holder: (ref) => holders.get(ref) || null,
    get size() { return holders.size; },
  };
}

// Is `mode` with `ref` allowed for this session right now? Claims shared vehicles implicitly (first rider wins).
export function vehicleAllowed(vehicles, world, session, mode, ref) {
  if (!isMountedMode(mode)) { if (session.vehicleRef) vehicles.release(session); return true; }
  if (mode === MODE.MOTO && !ref) { if (session.vehicleRef) vehicles.release(session); return true; }   // personal moto
  if (mode === MODE.PILLION) {
    let ok = false;
    const self = session.entity;
    world.forNear(self.x, self.z, VAL.PILLION_R, (e) => {
      if (e !== self && (e.mode === MODE.MOTO || e.mode === MODE.CYCLO)) { ok = true; return true; }
      return false;
    }, self.cell >= 0 ? self.cell : undefined);
    return ok;
  }
  if (!ref) return false;
  return vehicles.claim(session, ref);
}

export function register(app) {
  const vehicles = createVehicles();
  app.provide('validate', { createValidator: () => new Validator(), vehicles });
}
