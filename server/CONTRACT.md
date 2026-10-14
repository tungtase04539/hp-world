# Server module contract (Foundation → S2 / S3 / S4 / S5)

This is the interface every work package builds against. It is owned by Foundation; change it only through the
integrator. Code: `server/src/main.js` (wiring), `server/src/app.js` (bus / timers / services).

## 1. Feature modules

`server/src/main.js` imports a FIXED list (`FEATURES`) and calls `await mod.register(app)` in this order:

| # | module file | owner | provides service | routes |
|---|---|---|---|---|
| 1 | `alerts.js` | S3 | `alerts` | — |
| 2 | `chat/index.js` | S3 | `chat` | — |
| 3 | `game/worldclock.js` | S2 | `worldclock` | — |
| 4 | `game/ratelimit.js` | S2 | (suggested `ratelimit`) | — |
| 5 | `game/validate.js` | S2 | — | — |
| 6 | `game/aoi.js` | S2 | — | — |
| 7 | `game/encoder.js` | S2 | — | — |
| 8 | `game/session.js` | S2 | — | — |
| 9 | `game/resume.js` | S2 | — | — |
| 10 | `game/queue.js` | S2 | — | — |
| 11 | `game/sim.js` | S2 | `sim` | — |
| 12 | `game/gateway.js` | S2 | — | WS `/play` |
| 13 | `api/auth.js` | S2 | — | `POST /v1/auth/guest`, `/v1/auth/refresh`, `/v1/auth/recover` |
| 14 | `api/join.js` | S2 | — | `POST /v1/join` |
| 15 | `api/moderation.js` | S3 | — | (player-facing moderation HTTP) |
| 16 | `api/netprobe.js` | S5 | — | WS `/probe`, `POST /v1/netprobe` |
| 17 | `admin/index.js` | S3 | — | admin port: `/admin`, `/admin/api/*` |

Rules: a WP edits only its own files (plus new files it creates under its own directory). A module may add helper
files next to it (`game/*.js`, `chat/*.js`, `admin/*`). `register(app)` may be `async`. Use services from other
modules lazily (`app.get('chat')` inside a handler or on `'start'`), never at import time.
Foundation-owned (do not edit without the integrator): `main.js`, `app.js`, `config.js`, `log.js`, `metrics.js`,
`net/transport.js`, `http/router.js`, `db/db.js`, `db/migrate.js`, `db/migrations/001_base.sql`, `js/shared/{constants,
protocol,quant,codec,grid,clock,spawns}.js`. `js/shared/textfilter.js` belongs to S3 (keep the API).

## 2. The `app` object

```
app.config      frozen config (server/src/config.js loadConfig). Secrets in app.config.secrets — never log them.
                game {host, port}, admin {host, port}, publicWsUrl, publicHttpUrl, allowedOrigins, allowNoOrigin,
                trustProxy ('none'|'cloudflare'), transport, db {driver, url, pgliteDir, poolMax}, capacity (1200),
                inviteRequired (true), dayEpoch, dayLength (1440), tickHz (20), snapHz (10), httpBodyLimit, dataDir,
                secrets {jwtPrivateKey (Ed25519 PKCS#8 DER base64), jwtKid, ticketHmacKey (base64url 32 B),
                adminToken, dbPassword, telegramBotToken, telegramChatId, turnstileSecret}
app.log         log.debug/info/warn/error(msg, fields?), log.child({mod}) — JSON lines; keys like *token*/*ticket*/
                *password*/*secret* are redacted automatically.
app.metrics     counter(name, help) → {inc(n=1, labels?)}, gauge(name, help, collect?) → {set, inc, dec},
                histogram(name, help, bucketsMs?, window=2048) → {observe(v), quantile(q), json()};
                names get the `hp_` prefix; registration is idempotent; render() = Prometheus text at /metrics
                (admin port only); snapshot() = JSON for the admin page.
app.db          query(sql, params) → {rows, rowCount}; one(sql, params) → row|null; exec(sql); tx(async q => …);
                ping(); driver 'pg'|'pglite'. int8 → number, bytea → Uint8Array/Buffer, timestamptz → Date.
app.http        public router (game port 9100): get/post/put/patch/delete(path, handler, opts)
app.admin       admin router (admin port 9101, localhost only). opts {auth: 'admin'} = header
                `Authorization: Bearer <ADMIN_TOKEN>` (constant-time check). Cross-origin requests are refused.
app.ws          route(path, {open, message, drain, close}) — WebSocket endpoint on the game port
                guard(fn) — extra upgrade guard fn({path, origin, ip, headers}) → null | {status, reason}
                connections — open sockets; kind — 'uws'|'ws'
app.bus         on(evt, fn) → off(); once; off; emit(evt, payload) (sync; errors isolated and logged)
app.timers      after(ms, fn) → cancel; every(ms, name, fn) → cancel (async ok, no overlap);
                loop(hz, name, fn(tick, nowMs, dtMs)) → {cancel, tick, stats()} drift-compensated fixed rate,
                records hp_<name>_ms and hp_<name>_late_ms; clearAll() on shutdown.
app.provide(name, svc) / app.get(name) / app.has(name) / app.replace(name, svc) / app.services()
app.onStop(async fn)   shutdown hooks, run in reverse order before sockets and DB close (flush dirty state here)
app.nowMs()     server epoch time in ms with sub-ms precision (performance.timeOrigin + performance.now())
app.health()    → {ok, db, ccu, transport, proto, version, uptimeS, serverTime}
app.paths       {serverRoot, repoRoot, dataDir}
app.ports       {game, admin} actual listening ports (after start)
app.migrations  {applied, current}
app.stop(reason)
```

### Router handlers
`handler(req, res)`; return a plain object → 200 JSON, or use `res.json(obj, status)`, `res.text(str, status, type)`,
`res.error(status, code, extra)` → `{error: code, ...extra}`, or `throw httpError(status, code)` (from
`http/router.js`). `req`: `method, path, query, queryObj, params, headers (lower-case), ip, json (parsed body)`;
`opts.raw: true` gives `req.rawBody` (Buffer). Body limit `config.httpBodyLimit` (16 KB) → 413. Error codes:
`API_ERR` in `js/shared/protocol.js`. `opts.rateLimit(req) → null | {retryAfterS}` → 429.
CORS / Origin: allowed origins get `Access-Control-Allow-Origin`; a non-GET with a foreign Origin → 403.

### WebSocket connections (`conn`)
`conn.id, ip, origin, path, openedAt, data` (free slot: put your session here), `send(bytes)` → `1` sent / `0`
buffered (backpressure) / `2` dropped (closed, or over 64 KB maxBackpressure → the socket is closed),
`cork(fn)` (batch several sends), `bufferedAmount()`, `close(code, reason)`, `terminate()`, `closed`.
`message(conn, bytes, isBinary)`: `bytes` is a Uint8Array **view valid only during the callback** — decode right away
(`decodeC2S` copies strings/tokens). `send()` copies, so one shared `Writer` per module is safe.
Limits (constants `NET`): max client message 512 B (bigger → close 1009), idle timeout 20 s (pings are automatic),
maxBackpressure 64 KB. The game port checks `Origin` against `ALLOWED_ORIGINS` (no Origin allowed iff
`ALLOW_NO_ORIGIN=true`, default — bots). Drop a snapshot when `conn.bufferedAmount() > NET.DROP_SNAPSHOT_BUFFERED`.

### Bus events (conventions — the emitter is the owner)
| event | payload | emitter |
|---|---|---|
| `start` | `{ports}` | main (after listen) — start loops here |
| `stop` | `{reason}` | main (before stop hooks) |
| `conn:open` / `conn:close` | `{conn}` / `{conn, code}` | gateway |
| `player:join` / `player:leave` | `{session}` | S2 |
| `chat:message` | `{session, channel, text, shadow, flagged}` | S2 (after `chat.handle`) — admin live feed |
| `report:new` | `{report}` | S3 |
| `sanction` | `{accountId, kind, until}` | S3 |
| `degrade` | `{level, prev}` | S2 |
| `alert` | `{kind, text}` | anyone → S3 alerts |

## 3. Services (final signatures; stubs exist)

- `alerts` (S3): `{ enabled, send(kind, text) → Promise<boolean> }`
- `chat` (S3): `createChat({db, log, alerts, config, metrics, bus})` →
  `handle(session, channel, text) → Promise<{ok, deliverText, shadow, reason, code}>`,
  `report(reporterSession, targetAccountId, reason, chatRef) → Promise<{ok, code}>`, `isMuted(accountId)`,
  `nicknameCheck(name) → {ok, reason}`, `blocks(accountId) → Set|null`.
  `session` fields read by chat: `accountId, netId, displayName, playSeconds`.
- `worldclock` (S2): `{ dayEpoch, dayLength, now(), dayT(now?), weather() }`
- `sim` (S2): `{ tick, stats() }`

## 4. Shared code (`js/shared/`, pure ESM, Node + browser)

- `constants.js` — SPEED/MODE/MODE_VMAX/SFLAG, PLAY_RADIUS 1588, TICK_HZ/SNAP_HZ, AOI, DEGRADE, VALIDATE, CHAT, NICK,
  RATE, NET, CAPACITY_DEFAULT. Drift-tested against js/main.js, js/vehicles.js, js/world.js, js/daynight.js.
- `protocol.js` — PROTO_VERSION, C2S/S2C opcodes, HELLO_FLAG, SNAP_FLAG, CHANNEL, SYS, KICK_REASON, AUTH_REASON,
  CORRECT_REASON, ACTION, EVENT, CHAT_CODE, REPORT_CODE, REPORT_REASON, CLOSE, STAT, WEATHER, API_ERR.
- `quant.js` — qPos/dqPos (5 cm u16), qY/dqY, qYaw/dqYaw, qSpd/dqSpd, qVel/dqVel, packState/stateMode/stateFlags.
- `codec.js` — byte layouts in the file header. `Writer`, `BitWriter/BitReader`, `encodeX(w, …)` → Uint8Array view,
  `SnapshotBuilder` (quantised ints, hot path), `decodeC2S(bytes, pool?)` / `decodeS2C` / `decode` (never throw;
  errors are `DECODE_ERR.*` with `.err`), `SIZE`, `u32Diff`.
- `grid.js` — cellOf, neighbors(id, out), cellWithHysteresis, cellBounds, areNeighbors.
- `clock.js` — `ClockSync` (8 lowest-RTT median, slew 0.5 %), `dayTAt`, `nextDayT`, `nowMs`.
- `spawns.js` — `SPAWNS` (8 sidewalk points), `pickSpawn(counts, rand)`, `nearestSpawn`.
- `textfilter.js` (S3) — `filterChat(text, opts) → {ok, text, action, reasons}`, `checkNickname(name) → {ok, reason}`,
  `normalize`, `setLists`, `FILTER_VERSION`.

## 5. Database

Migrations `server/src/db/migrations/NNN_name.sql`, forward only, each in a transaction under an advisory lock:
001–009 Foundation, 010–019 S2, 020–029 S3, 030–039 S5. `001_base.sql`: invites, accounts, identities,
refresh_tokens, characters, admin_audit, playtime_daily (see the file for columns).

## 6. Tests

`npm test` — `node --test` on `server/test/*.test.js`, Windows, no Docker (PGlite in memory). Use
`test/helpers/client.mjs`: `bootTestServer(overrides)` → `{app, game, admin, ws, config}` on ephemeral ports;
`openWs`, `nextMessage`, `pingRtts`, `waitClose`, `getJson`. `npm run test:pg` — same DB tests on Docker Postgres 17
(env `PG_TEST_PORT`, `PG_TEST_PROJECT`: use YOUR assigned port / compose project).
