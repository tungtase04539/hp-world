// game/queue.js — OWNER: S2. Capacity cap (config.capacity, default 1,200) and the join queue with position + ETA.
// Degrade level L4 stops admitting new sessions (the queue keeps order). A join ticket RESERVES a slot until it is
// used (HELLO) or expires (60 s), so a burst of joins cannot overshoot the cap. At most ONE reservation per account:
// a new ticket replaces the account's previous reservation (fixer round 1, SEC-1/NET-12 — one account calling /v1/join
// repeatedly used to hold ~40 slots), and the account's own reservation never queues it behind itself.
//
// Service 'queue':
//   request(accountId, {hasSession}) → {ok: true} | {ok: false, position, etaS, retryAfterS}
//       hasSession: the account already holds a live / resumable session (reconnect replaces it, no extra load)
//   reserve(nonce, accountId, expMs) / release(nonce)   (one reservation per account; the newest nonce wins)
//   noteDeparture(now?)      a session ended (frees a slot; drives the ETA)
//   setBlocked(bool)         degrade L4
//   stats() → {capacity, load, reserved, queued, blocked, free}
export const QUEUE = Object.freeze({
  POLL_TIMEOUT_MS: 30000,       // a queued client that has not polled for 30 s loses its place
  RETRY_S: 5,                   // suggested poll interval
  DEFAULT_SLOT_S: 30,           // ETA assumption with no departure history
  ETA_MIN_S: 5,
  ETA_MAX_S: 3600,
  DEPART_WINDOW_MS: 10 * 60 * 1000,
});

export function createQueue({ capacity, load, now = () => Date.now() }) {
  const reservations = new Map();   // nonce → {accountId, exp}
  const byAccount = new Map();      // accountId → nonce (its single live reservation)
  const queue = new Map();          // accountId → {joinedAt, lastPoll}  (insertion order = queue order)
  const departures = [];            // timestamps
  let blocked = false;

  const sweep = (t = now()) => {
    for (const [n, r] of reservations) if (r.exp <= t) { reservations.delete(n); if (byAccount.get(r.accountId) === n) byAccount.delete(r.accountId); }
    for (const [a, q] of queue) if (t - q.lastPoll > QUEUE.POLL_TIMEOUT_MS) queue.delete(a);
    while (departures.length && t - departures[0] > QUEUE.DEPART_WINDOW_MS) departures.shift();
  };
  const free = () => capacity - load() - reservations.size;
  const etaFor = (position, t) => {
    const span = departures.length ? Math.max(60000, t - departures[0]) : 0;
    const perSlotS = departures.length ? span / 1000 / departures.length : QUEUE.DEFAULT_SLOT_S;
    return Math.round(Math.min(QUEUE.ETA_MAX_S, Math.max(QUEUE.ETA_MIN_S, position * perSlotS + (blocked ? 60 : 0))));
  };

  return {
    capacity,
    request(accountId, { hasSession = false } = {}) {
      const t = now();
      sweep(t);
      if (hasSession) { queue.delete(accountId); return { ok: true }; }
      let q = queue.get(accountId);
      const own = byAccount.has(accountId) ? 1 : 0;   // a re-join replaces the account's own reservation
      if (!q) {
        if (!blocked && queue.size === 0 && free() + own > 0) return { ok: true };
        q = { joinedAt: t, lastPoll: t };
        queue.set(accountId, q);
      }
      q.lastPoll = t;
      let position = 0;
      for (const a of queue.keys()) { position++; if (a === accountId) break; }
      if (!blocked && position <= free() + own) { queue.delete(accountId); return { ok: true }; }
      return { ok: false, position, etaS: etaFor(position, t), retryAfterS: QUEUE.RETRY_S };
    },
    reserve(nonce, accountId, exp) {
      const prev = byAccount.get(accountId);
      if (prev !== undefined && prev !== nonce) reservations.delete(prev);
      reservations.set(nonce, { accountId, exp });
      byAccount.set(accountId, nonce);
    },
    release(nonce) {
      const r = reservations.get(nonce);
      if (!r) return;
      reservations.delete(nonce);
      if (byAccount.get(r.accountId) === nonce) byAccount.delete(r.accountId);
    },
    noteDeparture(t = now()) { departures.push(t); if (departures.length > 5000) departures.shift(); },
    setBlocked(b) { blocked = !!b; },
    get blocked() { return blocked; },
    sweep,
    stats() { const t = now(); sweep(t); return { capacity, load: load(), reserved: reservations.size, queued: queue.size, blocked, free: free() }; },
  };
}

export function register(app) {
  // load = live + resumable sessions; game/session.js provides 'sessions' after this module registers → lazy lookup
  const q = createQueue({
    capacity: app.config.capacity,
    load: () => (app.has('sessions') ? app.get('sessions').load() : 0),
  });
  app.provide('queue', q);
  app.metrics.gauge('queue_length', 'clients waiting in the join queue', () => q.stats().queued);
  app.metrics.gauge('queue_reserved', 'join tickets reserving a slot', () => q.stats().reserved);
  app.bus.on('start', () => { app.timers.every(5000, 'queue_sweep', () => q.sweep()); });
}
