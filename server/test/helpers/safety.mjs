// Helpers for the S3 safety tests: accounts in the test DB, a fake clock, a recording bus.
import http from 'node:http';

export async function makeAccount(db, name) {
  const a = await db.one('INSERT INTO accounts (kind, play_seconds) VALUES ($1, 3600) RETURNING id', ['guest']);
  if (name) {
    const [nick, disc] = name.split('#');
    await db.query('INSERT INTO characters (account_id, nickname, discriminator, display_name) VALUES ($1,$2,$3,$4)', [a.id, nick, Number(disc || 1), name]);
  }
  return a.id;
}

export function fakeClock(start = Date.now()) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; return t; };
  now.set = (v) => { t = v; };
  return now;
}

export function recordingBus() {
  const events = [];
  const handlers = new Map();
  return {
    events,
    on(evt, fn) { if (!handlers.has(evt)) handlers.set(evt, new Set()); handlers.get(evt).add(fn); return () => handlers.get(evt).delete(fn); },
    emit(evt, payload) { events.push({ evt, payload }); for (const fn of handlers.get(evt) || []) fn(payload); return (handlers.get(evt)?.size) || 0; },
    of: (evt) => events.filter((e) => e.evt === evt).map((e) => e.payload),
  };
}

export function session(accountId, name, extra = {}) {
  return { accountId, netId: extra.netId ?? 1, displayName: name, playSeconds: 3600, x: 0, z: 0, ...extra };
}

// raw HTTP request (lets the test set Host / Origin / Cookie freely)
export function rawRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
