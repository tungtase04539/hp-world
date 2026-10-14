// game/bench.mjs — OWNER: S2. In-process benchmark of the game core WITHOUT sockets: N simulated sessions go through
// the real code path (gateway handlers: HELLO with a real ticket → WELCOME → READY → STATE at 15 Hz / 2 Hz idle →
// validation → AOI → snapshot encoding) with fake connections that only count bytes. The 20 Hz sim loop runs live.
//
//   node src/game/bench.mjs [--n 1000] [--dur 20] [--hotspot 0] [--out file.json]
//     --hotspot K   put K of the N players within 30 m of the Opera square (AOI cap stress)
// Prints tick ms p50/p99 (hp_sim_tick_ms), snapshot bytes p50/p95/max, bytes/s per client, CORRECTs, RSS, CPU.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { startServer } from '../main.js';
import { loadConfig } from '../config.js';
import { nullLogger } from '../log.js';
import { Writer, encodeHello, encodeReady, encodeState } from '../../../js/shared/codec.js';
import { MODE, SPEED, PLAY_RADIUS } from '../../../js/shared/constants.js';
import { SPAWNS } from '../../../js/shared/spawns.js';
import { landOk } from '../../../js/shared/move.js';
import { packState } from '../../../js/shared/quant.js';
import { S2C } from '../../../js/shared/protocol.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const N = Number(args.n || 1000), DUR = Number(args.dur || 20), HOT = Number(args.hotspot || 0);
const OUT = args.out || null;

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296); }
const r = rng(12345);

const config = loadConfig({
  env: {}, envFile: null,
  overrides: { NODE_ENV: 'test', PGLITE_DIR: 'memory', LOG_LEVEL: 'silent', GAME_HOST: '127.0.0.1', ADMIN_HOST: '127.0.0.1', INVITE_REQUIRED: 'false', CAPACITY: String(N + 100) },
});
const app = await startServer({ config, log: nullLogger, ports: { game: 0, admin: 0 } });
const gw = app.get('gateway').handlers;
const tickets = app.get('tickets');
const sessions = app.get('sessions');

// ---- accounts (bulk SQL; the HTTP auth path is covered by the tests) ------------------------------------------------
const t0 = performance.now();
const ids = [];
for (let i = 0; i < N; i += 200) {
  const n = Math.min(200, N - i);
  const rows = await app.db.query(`INSERT INTO accounts (kind) SELECT 'guest' FROM generate_series(1, ${n}) RETURNING id`);
  const acc = rows.rows.map((x) => x.id);
  await app.db.query(`INSERT INTO characters (account_id, nickname, discriminator, display_name, appearance)
      SELECT a, 'Bot' || (row_number() OVER ())::text || '_${i}', 1, 'Bot' || (row_number() OVER ())::text || '_${i}#0001', $2::bytea
        FROM unnest($1::uuid[]) AS a`, [acc, crypto.randomBytes(8)]);
  ids.push(...acc);
}
const tAccounts = performance.now() - t0;

// ---- fake connections ---------------------------------------------------------------------------------------------
let connId = 0;
const stats = { bytes: 0, msgs: 0, snaps: 0, corrections: 0, maxSnap: 0 };
function fakeConn() {
  const c = {
    id: ++connId, ip: '127.0.0.1', origin: '', path: '/play', openedAt: Date.now(), data: null, closed: false, bytes: 0,
    welcome: null,
    send(b) {
      stats.bytes += b.length; stats.msgs++; c.bytes += b.length;
      const op = b[0];
      if (op === S2C.SNAPSHOT) { stats.snaps++; if (b.length > stats.maxSnap) stats.maxSnap = b.length; }
      else if (op === S2C.CORRECT) { stats.corrections++; c.corr = (b[7] & 255); c.corrected = true; }
      else if (op === S2C.WELCOME) c.welcome = true;
      return 1;
    },
    cork(fn) { fn(); },
    bufferedAmount() { return 0; },
    close(code) { if (!c.closed) { c.closed = true; gw.close(c, code); } },
    terminate() { c.close(1006); },
  };
  return c;
}

// ---- bots ---------------------------------------------------------------------------------------------------------
const w = new Writer(256);
const bots = [];
for (let i = 0; i < N; i++) {
  const hot = i < HOT;
  const sp = SPAWNS[i % SPAWNS.length];
  let x, z;
  for (let k = 0; k < 50; k++) {
    const a = r() * Math.PI * 2, d = hot ? Math.sqrt(r()) * 30 : Math.sqrt(r()) * 300;
    x = (hot ? SPAWNS[0].x : sp.x) + Math.cos(a) * d; z = (hot ? SPAWNS[0].z : sp.z) + Math.sin(a) * d;
    if (landOk(x, z) && Math.hypot(x, z) < PLAY_RADIUS - 30) break;
    x = sp.x; z = sp.z;
  }
  const roll = r();
  const mode = hot ? (roll < 0.5 ? MODE.WALK : roll < 0.8 ? MODE.RUN : MODE.MOTO) : roll < 0.35 ? MODE.WALK : roll < 0.6 ? MODE.RUN : roll < 0.8 ? MODE.MOTO : -1;
  bots.push({ id: ids[i], x, z, yaw: r() * Math.PI * 2, mode: mode < 0 ? MODE.WALK : mode, idle: mode < 0, conn: fakeConn(), seq: 0, epoch: 0, hot, cx: x, cz: z });
}
await app.db.query(`UPDATE characters c SET pos_x = v.x, pos_z = v.z FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, x real, z real) WHERE c.account_id = v.id`,
  [JSON.stringify(bots.map((b) => ({ id: b.id, x: b.x, z: b.z })))]);

const t1 = performance.now();
for (const b of bots) {
  gw.open(b.conn);
  gw.message(b.conn, encodeHello(w, { ticket: tickets.issue(b.id).ticket, tier: 2 }), true);
}
// wait for every HELLO (async DB load)
for (let k = 0; k < 600 && bots.some((b) => !b.conn.welcome); k++) await new Promise((res) => setTimeout(res, 50));
for (const b of bots) gw.message(b.conn, encodeReady(w), true);
const tJoin = performance.now() - t1;

// movement driver: 15 Hz while moving, 2 Hz idle; honest speeds (90 % of the mode's max), turn back at water / disc edge
function stepBot(b, dtS, nowMs) {
  if (b.conn.corrected) {   // apply a CORRECT like a real client: snap to the server position, new epoch
    const s = sessions.get(b.id);
    b.x = s.entity.x; b.z = s.entity.z; b.epoch = b.conn.corr; b.conn.corrected = false;
  }
  if (!b.idle) {
    const v = (b.mode === MODE.MOTO ? SPEED.moto : b.mode === MODE.RUN ? SPEED.run : SPEED.walk) * 0.9;
    b.yaw += (r() - 0.5) * 0.3;
    let nx = b.x + Math.sin(b.yaw) * v * dtS, nz = b.z + Math.cos(b.yaw) * v * dtS;
    const far = b.hot ? Math.hypot(nx - SPAWNS[0].x, nz - SPAWNS[0].z) > 30 : Math.hypot(nx - b.cx, nz - b.cz) > 350;
    if (!landOk(nx, nz) || far || Math.hypot(nx, nz) > PLAY_RADIUS - 10) { b.yaw += Math.PI; nx = b.x; nz = b.z; }
    b.x = nx; b.z = nz;
  }
  gw.message(b.conn, encodeState(w, {
    seq: b.seq++ & 0xffff, clientMs: Math.floor(nowMs) & 0xffff, x: b.x, z: b.z, y: 2, yaw: b.yaw,
    vx: b.idle ? 0 : Math.sin(b.yaw) * 3, vz: b.idle ? 0 : Math.cos(b.yaw) * 3, state: packState(b.mode, 0), corrEpoch: b.epoch, vehicleRef: 0,
  }), true);
}
const startBytes = stats.bytes;
const tickH = app.metrics.get('sim_tick_ms');
const snapH = app.metrics.get('snapshot_bytes');
tickH.resetWindow(); snapH.resetWindow();
const cpu0 = process.cpuUsage();
const tRun = performance.now();
let lastMove = performance.now(), frames = 0;
const driver = setInterval(() => {
  const now = performance.now();
  const dt = (now - lastMove) / 1000;
  lastMove = now;
  frames++;
  for (const b of bots) if (!b.idle || frames % 8 === 0) stepBot(b, b.idle ? dt * 8 : dt, now);
}, 1000 / 15);
await new Promise((res) => setTimeout(res, DUR * 1000));
clearInterval(driver);
const runS = (performance.now() - tRun) / 1000;
const cpu = process.cpuUsage(cpu0);

const q = (h, p) => Math.round(h.quantile(p) * 1000) / 1000;
const ccu = sessions.count();
const report = {
  n: N, hotspot: HOT, durS: Math.round(runS * 10) / 10, ccu, transport: 'none (in-process fake connections)',
  setup: { accountsMs: Math.round(tAccounts), joinMs: Math.round(tJoin) },
  tickMs: { p50: q(tickH, 0.5), p99: q(tickH, 0.99), max: Math.round(tickH.max * 1000) / 1000, samples: tickH.rn },
  snapshotBytes: { p50: q(snapH, 0.5), p95: q(snapH, 0.95), max: stats.maxSnap },
  bytesPerClientPerS: Math.round((stats.bytes - startBytes) / ccu / runS),
  corrections: stats.corrections,
  degradeLevel: app.get('sim').level,
  rssMB: Math.round(process.memoryUsage.rss() / 1048576),
  cpuPercentOneCore: Math.round(((cpu.user + cpu.system) / 1000 / (runS * 1000)) * 1000) / 10,
  note: 'CPU includes the bot driver (encoding 15 Hz STATE for every bot) in the same thread',
  node: process.version, platform: process.platform,
};
console.log(JSON.stringify(report, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
await app.stop('bench');
process.exit(0);
