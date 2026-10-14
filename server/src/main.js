// main.js — wiring. Loads config, logger, metrics, DB (+ migrations), the two HTTP/WS listeners (game 9100 public,
// admin 9101 localhost-only) and then registers the FIXED list of feature modules below. Each feature module exports
// `register(app)` (may be async). Work packages fill their own module files and never edit this file (the integrator
// may). The `app` object is documented in server/CONTRACT.md.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ensureEnvFile, publicConfig } from './config.js';
import { createLogger } from './log.js';
import { createMetrics } from './metrics.js';
import { createTransport } from './net/transport.js';
import { createRouter } from './http/router.js';
import { createDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { createBus, createTimers, createServices } from './app.js';
import { nowMs } from '../../js/shared/clock.js';
import { PROTO_VERSION } from '../../js/shared/protocol.js';
import { NET } from '../../js/shared/constants.js';

import * as alerts from './alerts.js';
import * as chat from './chat/index.js';
import * as worldclock from './game/worldclock.js';
import * as ratelimit from './game/ratelimit.js';
import * as validate from './game/validate.js';
import * as aoi from './game/aoi.js';
import * as encoder from './game/encoder.js';
import * as session from './game/session.js';
import * as resume from './game/resume.js';
import * as queue from './game/queue.js';
import * as sim from './game/sim.js';
import * as gateway from './game/gateway.js';
import * as auth from './api/auth.js';
import * as join from './api/join.js';
import * as moderation from './api/moderation.js';
import * as netprobe from './api/netprobe.js';
import * as admin from './admin/index.js';

// Registration order matters only for services used AT REGISTER TIME; prefer app.get(name) inside handlers/'start'.
export const FEATURES = Object.freeze([
  ['alerts', alerts],
  ['chat', chat],
  ['game/worldclock', worldclock],
  ['game/ratelimit', ratelimit],
  ['game/validate', validate],
  ['game/aoi', aoi],
  ['game/encoder', encoder],
  ['game/session', session],
  ['game/resume', resume],
  ['game/queue', queue],
  ['game/sim', sim],
  ['game/gateway', gateway],
  ['api/auth', auth],
  ['api/join', join],
  ['api/moderation', moderation],
  ['api/netprobe', netprobe],
  ['admin', admin],
]);

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Start everything. Options (all optional; tests use them):
//   config      a ready config object (else loadConfig({env, envFile, overrides}))
//   log         logger (else from config)
//   features    feature list (default FEATURES)
//   ports       {game, admin} override listen ports (0 = ephemeral)
// Returns the app (with app.ports and app.stop()).
export async function startServer({ config, env, envFile, overrides, log, features = FEATURES, ports } = {}) {
  config = config || loadConfig({ env, envFile, overrides });
  log = log || createLogger({ level: config.logLevel, format: config.logFormat, bindings: { svc: 'hp-server' } });
  const metrics = createMetrics();
  const bus = createBus(log);
  const timers = createTimers(log, metrics);
  const services = createServices();
  const stopHooks = [];
  const startedAt = Date.now();

  const db = await createDb(config.db, { log: log.child({ mod: 'db' }), metrics });
  // on a startup failure, release what was opened so far (tests / supervisors must not hang on open handles)
  const undo = [() => db.close(), () => metrics.stop(), () => timers.clearAll()];
  try {
    return await startRest();
  } catch (e) {
    for (const f of undo.reverse()) { try { await f(); } catch { /* ignore */ } }
    throw e;
  }

  async function startRest() {
    const mig = await migrate(db, { log: log.child({ mod: 'migrate' }) });

    const limits = { maxPayload: NET.MAX_C2S_BYTES, idleTimeout: NET.IDLE_TIMEOUT_S, maxBackpressure: NET.MAX_BACKPRESSURE, bodyLimit: config.httpBodyLimit };
    const gameT = await createTransport({ kind: config.transport, log: log.child({ mod: 'transport' }), limits, trustProxy: config.trustProxy });
    undo.push(() => gameT.close());
    const adminT = await createTransport({ kind: gameT.kind, log: log.child({ mod: 'transport-admin' }), limits, trustProxy: 'none' });
    undo.push(() => adminT.close());

    const adminAuth = (req) => {
      const h = req.headers.authorization || '';
      const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
      return safeEqual(tok, config.secrets.adminToken);
    };
    const http = createRouter({ log: log.child({ mod: 'http' }), metrics, name: 'game', allowedOrigins: config.allowedOrigins, allowNoOrigin: config.allowNoOrigin, bodyLimit: config.httpBodyLimit });
    // the admin page is same-origin; cross-origin requests to the admin port are refused
    const adminHttp = createRouter({ log: log.child({ mod: 'admin-http' }), metrics, name: 'admin', allowedOrigins: [], allowNoOrigin: true, bodyLimit: 256 * 1024, auth: { admin: adminAuth } });
    gameT.onHttp(http.handle);
    adminT.onHttp(adminHttp.handle);

    // WebSocket Origin allow-list (browsers always send Origin; bots/native clients send none)
    gameT.guard((info) => {
      if (info.origin) return http.isAllowedOrigin(info.origin) ? null : { status: 403, reason: 'origin not allowed' };
      return config.allowNoOrigin ? null : { status: 403, reason: 'origin required' };
    });

    const wsConn = metrics.gauge('ws_connections', 'open WebSocket connections (game port)', () => gameT.connections);
    void wsConn;

    let dbOk = { at: 0, ok: true, ms: 0 };
    const health = async () => {
      if (Date.now() - dbOk.at > 1000) {
        try { const ms = await db.ping(); dbOk = { at: Date.now(), ok: true, ms }; } catch { dbOk = { at: Date.now(), ok: false, ms: -1 }; }
      }
      return { ok: dbOk.ok, version: config.version, proto: PROTO_VERSION, transport: gameT.kind, uptimeS: Math.round((Date.now() - startedAt) / 1000), db: dbOk.ok ? 'ok' : 'error', dbMs: Math.round(dbOk.ms * 100) / 100, ccu: gameT.connections, serverTime: nowMs() };
    };
    const healthRoute = async (req, res) => { const h = await health(); res.json(h, h.ok ? 200 : 503); };
    http.get('/healthz', healthRoute);
    adminHttp.get('/healthz', healthRoute);
    adminHttp.get('/metrics', (req, res) => res.text(metrics.render(), 200, 'text/plain; version=0.0.4; charset=utf-8'));

    const app = {
      config, log, metrics, db, bus, timers,
      http,                 // public router (game port)
      admin: adminHttp,     // admin router (admin port, localhost-only); opts {auth: 'admin'} = Bearer ADMIN_TOKEN
      ws: {
        route: (p, handlers) => gameT.route(p, handlers),
        guard: (fn) => gameT.guard(fn),
        get connections() { return gameT.connections; },
        get kind() { return gameT.kind; },
      },
      provide: services.provide, replace: services.replace, get: services.get, has: services.has, services: services.names,
      onStop: (fn) => { stopHooks.push(fn); },
      nowMs,
      startedAt,
      paths: { serverRoot: config.serverRoot, repoRoot: config.repoRoot, dataDir: config.dataDir },
      migrations: mig,
      health,
      ports: { game: 0, admin: 0 },
      stop: null,
    };

    for (const [name, mod] of features) {
      if (typeof mod.register !== 'function') throw new Error(`feature ${name} has no register(app)`);
      await mod.register(app);
    }

    app.ports.game = await gameT.listen(config.game.host, ports?.game ?? config.game.port);
    app.ports.admin = await adminT.listen(config.admin.host, ports?.admin ?? config.admin.port);

    let stopping = null;
    app.stop = (reason = 'stop') => {
      if (stopping) return stopping;
      stopping = (async () => {
        log.info('server stopping', { reason });
        bus.emit('stop', { reason });
        for (const fn of stopHooks.slice().reverse()) {
          try { await fn(); } catch (e) { log.error('stop hook failed', { err: e }); }
        }
        timers.clearAll();
        await gameT.close(1001, 'shutdown');
        await adminT.close(1001, 'shutdown');
        metrics.stop();
        await db.close();
        log.info('server stopped');
      })();
      return stopping;
    };

    bus.emit('start', { ports: app.ports });
    log.info('server started', {
      transport: gameT.kind, game: `${config.game.host}:${app.ports.game}`, admin: `${config.admin.host}:${app.ports.admin}`,
      db: config.db.driver, migrations: mig.current, applied: mig.applied, features: features.length, proto: PROTO_VERSION,
    });
    return app;
  }
}

// ---- CLI ------------------------------------------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const created = ensureEnvFile();
  const config = loadConfig();
  const log = createLogger({ level: config.logLevel, format: config.logFormat, bindings: { svc: 'hp-server' } });
  if (created.created) log.warn('created server/.env with fresh random secrets (keep it private, never commit it)', { path: created.path });
  else if (created.added.length) log.warn('added missing secrets to server/.env', { keys: created.added });
  log.info('config', publicConfig(config));
  let app;
  const shutdown = async (sig) => {
    try { if (app) await app.stop(sig); } finally { process.exit(0); }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));
  try {
    app = await startServer({ config, log });
  } catch (e) {
    log.error('startup failed', { err: e });
    process.exit(1);
  }
}
