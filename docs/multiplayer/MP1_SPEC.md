# MP-1 SPEC — game server for the closed test (GĐ0 + server side of GĐ1), SELF-HOSTED on the owner's PC

(Restored 2026-10-15 ~00:50 after the session scratchpad was wiped at ~00:12. A durable copy is committed on branch dot3 as
docs/multiplayer/MP1_SPEC.md. If this file disappears again, read that copy: `git -C C:/Users/Admin/hp-world show dot3:docs/multiplayer/MP1_SPEC.md`.)

Repo: C:/Users/Admin/hp-world (three.js r160 static site, no build step, GitHub Pages). Branch base: `dot3`.
Read first: `docs/multiplayer/KE_HOACH.md` (§2, **§2b self-host**, §4, §5 GĐ0–GĐ1, §8 owner answers),
`docs/multiplayer/ARCH.md` (§5 AOI, §6 protocol, §7 ticks/clock, §8 movement, §10 storage, §12 anti-cheat, §13 moderation,
§14 security, §17 load test, §19 module map), `docs/multiplayer/codebase_hooks.md` (§1.3 movement facts, §4 determinism,
§9 pure modules / hook points, §10 risks). When ARCH.md and KE_HOACH.md differ, KE_HOACH.md wins; this SPEC wins over both.

## 0. Owner decisions (14/10/2026)
- Closed, invite-only, NON-commercial test. Guest accounts need an **invite code** (config `INVITE_REQUIRED=true` default).
- Budget ~1M VND/month → the server runs **on the owner's own PC** (Windows 11, AMD Ryzen AI 9 HX 370 12C/24T, 31 GB RAM,
  Docker 29.4 running, Node 24.15, cloudflared 2026.7.2 at `C:\Program Files (x86)\cloudflared\cloudflared.exe`), exposed with
  **Cloudflare Tunnel** (no open ports, home IP hidden, wss:// TLS at the edge). Later the same Docker setup moves to a VPS.
- Chat: **free typed chat for everyone (guests included) within 40 m, under STRICT control** (§3.3).
- Operator = the owner: alerts (optional Telegram) + a **localhost-only admin page** on the same PC.
- Target capacity of the code: 1,000+ CCU on one process/machine (measured with headless bots).
- Owner (14/10/2026): "hãy đảm bảo an toàn 100% cho máy tôi" → §4 MACHINE SAFETY is mandatory.

## 1. Hard constraints (all agents)
1. **Only new files**, except: `.gitignore` (add `server/node_modules`, `server/.env`, `server/data/`), and
   `.github/workflows/deploy-pages.yml` (strip `server/` from the gh-pages mirror). Do NOT edit any other existing file —
   a parallel graphics workflow is rewriting js/*.js, tools/*, KNOWLEDGE.md right now. Do NOT touch KNOWLEDGE.md (the
   orchestrator adds a §11 pointer later); write technical notes in `docs/multiplayer/SERVER.md` instead.
2. New shared code lives in `js/shared/` — pure ESM, NO `three`, NO DOM, runs in Node 24 and in browsers (served statically,
   no bundler). It may import `../terrain.js` / `../mapdata.js` / `../brands.js` read-only (pure modules). Never import
   world.js, bridges.js, landmarks.js, quests.js (they import three).
3. Server code in `server/` with its own `package.json` + committed `package-lock.json`, exact pinned versions, ESM, Node 24.
   Deps (keep minimal): uWebSockets.js from a GitHub tag (verify it loads on win32-x64 AND in the linux Docker image; if it
   cannot load, the `ws` fallback must work transparently via the Transport interface), `ws`, `pg`, `jose` (EdDSA JWT),
   dev: `@electric-sql/pglite` (in-process Postgres for tests, no Docker needed). No other runtime deps without a reason
   written in SERVER.md.
4. **Secrets never committed**: `server/.env.example` only; first run generates dev secrets into `server/.env` (gitignored).
   JWT key (Ed25519), ticket HMAC key, admin token, DB password, optional TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TURNSTILE.
5. **GPU safety** (the PC blue-screened 3× from parallel GPU Chrome): MP work needs no Chrome. If you must open a page
   (netprobe/admin smoke), use `node tools/qa/gpulock.mjs run -- <cmd>` and one browser only. **Every load test with > 300 bots
   or longer than 60 s must run under the GPU lock** (`node tools/qa/gpulock.mjs run -- node server/bots/run.mjs ...`) so it does
   not overlap the graphics workflow's perf captures; keep each locked run < 15 min.
6. Ports / Docker names are assigned per agent in the prompt (never use another agent's). Stop your servers/containers when done
   (`docker compose -p <project> down -v` for test stacks). **Never delete files you did not create — and NEVER run a recursive
   delete on any parent folder of the scratchpad, on %TEMP%, or with a path built from an unset/empty variable** (the whole
   session scratchpad was wiped once at ~00:12 on 2026-10-15). Never touch `.../scratchpad/dot3/keep/`.
7. No brand names in any generated text/data (project rule; `js/brands.js` is the blocklist source). Vietnamese UI text for the
   owner and players; code comments in English or Vietnamese consistently per file.
8. Checkpoint-commit every ~20–30 tool calls in your worktree; write `server/PROGRESS.md` notes as you go.

## 2. Module contract (Foundation creates all files as working stubs; WPs fill their own files only)
```
js/shared/constants.js   speeds per mode (walk 3.0, run 7.0, moto 16, cyclo 4.2, boat 10 m/s; jump 6.5; grav 26),
                         PLAY_RADIUS 1588 (= BUILD_RADIUS-12), tick/snap Hz, AOI params, chat limits. A test greps
                         js/main.js / js/vehicles.js / js/world.js to detect drift of these numbers.
js/shared/protocol.js    PROTO_VERSION, opcodes (ARCH §6.4), error/event/system codes
js/shared/quant.js       quantisation (ARCH §6.3)
js/shared/codec.js       BitWriter/BitReader + encode/decode of EVERY message (preallocated buffers, 0 alloc per tick on
                         the hot path); P1 absolute records; P2 delta records optional behind a flag
js/shared/grid.js        128 m cell math, 3×3 neighbourhood, hysteresis
js/shared/clock.js       RTT/offset estimator (8 lowest-RTT samples, median), dayTAt(serverNow, epoch, 1440 s, start 9/24)
js/shared/textfilter.js  Vietnamese chat/nickname filter (S3 owns)
js/shared/spawns.js      6–8 spread spawn points (generated or hand-checked against terrain: on land, not in water, on a
                         road/sidewalk; Opera square, Tam Bạc lake, Chợ Sắt, Cầu Đất, Lạch Tray, Quang Trung …)
server/src/main.js       wiring; each feature module exports register(app) — main.js imports a fixed list, so WPs never
                         edit main.js (integrator may)
server/src/config.js     env + defaults (production defaults: game HTTP+WS 9100 on 0.0.0.0 inside Docker; admin 9101 —
                         see §4.2 for how admin stays unreachable from the tunnel)
server/src/log.js, metrics.js (prom text at /metrics, admin port only)
server/src/net/transport.js   uWS or ws behind one interface: send(bytes), cork, bufferedAmount, close(code)
server/src/http/router.js     tiny router (JSON body limit, CORS allow-list, Origin check)
server/src/db/db.js           pg Pool or PGlite behind one query(sql, params) interface; migrate.js; migrations/NNN_*.sql
                              (foundation 001–009, S2 010–019, S3 020–029, S5 030–039)
server/src/game/*        (S2) gateway, session, aoi, encoder, validate, sim, worldclock, queue, ratelimit, resume
server/src/api/auth.js, join.js (S2); moderation.js (S3); netprobe.js (S5)
server/src/chat/*        (S3) createChat({db, log, alerts, config}) → { handle(session, channel, text) →
                              {ok, deliverText, shadow, reason, code}, report(...), isMuted(accountId), nicknameCheck(name) }
server/src/admin/*       (S3) admin HTTP + static page server/admin/ (Vietnamese)
server/src/alerts.js     (S3) Telegram sender, no-op when unset; rate-limited
server/bots/*            (S4) headless bots + scenarios + report
server/Dockerfile, server/docker-compose.yml, server/ops/*.ps1, netprobe.html (repo root)   (S5)
docs/multiplayer/SERVER.md (technical, all WPs append their section), docs/multiplayer/VAN_HANH.md (owner runbook, S5)
server/test/*.test.js    node --test; MUST pass on Windows without Docker (PGlite); a separate `npm run test:pg` runs the
                         DB tests against Docker Postgres 17.
```

## 3. Feature scope (what DONE looks like)

### 3.1 Accounts, sessions (S2)
- `POST /v1/auth/guest {nickname, deviceId, inviteCode}` → account (kind guest) + display name `Nick#1234` + refresh token
  (256-bit random, only the hash stored, rotated on use, 180 days) + access JWT (EdDSA, 15 min) + **recovery code** (12 chars,
  unambiguous alphabet, hash stored, shown once). `POST /v1/auth/refresh`, `POST /v1/auth/recover {code, deviceId}`.
  Google link = GĐ2 (leave a clean extension point, do not implement).
- Invite codes: table `invites` (code hash, uses_left, expires, created_by, note); admin creates batches.
- `POST /v1/join {accessToken, proto, tier}` → `{wsUrl, ticket (HMAC, 60 s, single use), spawnHint}`; capacity cap
  (config, default 1,200) → queue position + ETA instead of a ticket.
- WS `/play`: first message HELLO{ticket} (never in the URL) → one session per account (kick the old one) → WELCOME
  {netId, serverTime, tickHz, snapHz, dayEpoch, dayLength, resumeToken, spawn}; READY → full AOI keyframe; resume within 60 s
  keeps netId/state; backoff guidance in SYSTEM. PING/PONG for clock sync. Proto mismatch → SYSTEM reload.
- Persist characters (pos, appearance 8 B, display name) on disconnect and every 30 s (dirty only); playtime_daily.

### 3.2 Simulation, AOI, validation (S2)
- 20 Hz sim, 10 Hz snapshots (staggered per client), STATE 15 Hz moving / 2 Hz idle accepted, token buckets per ARCH §13.3
  (primary limits per account/device; per-IP limits lenient — Vietnamese 4G CGNAT puts thousands behind one IP).
- AOI: 128 m grid, 3×3 cells, radius 120 m default / 160 m max, cap 96 records with the priority accumulator, far tier 5 Hz,
  ENTER/LEAVE/UPDATE, NAMES once per session per player; degrade ladder L0–L4 driven by tick/snapshot p99 (ARCH §5).
- Backpressure: bufferedAmount > 16 KB → drop this snapshot, next one is a keyframe; closeOnBackpressureLimit.
- Validation (ARCH §12 items 2,3,5,6): time budget [−100, +200] ms; per-mode sliding-window distance ≤ v_max·1.2 + 1 m;
  inside play disc; teleport > 3× max step = hard flag; mounted modes only with a vehicle (personal moto allowed any time on
  land; boat only on water); on-foot water check with `isWater` from js/terrain.js with a bridge tolerance (allow if within the
  deck corridor of a BRIDGE_WAYS / ELEVATED_RI way — implement purely in js/shared, no edits to existing files); violation
  points (+1 per window, −1/s; >5 CORRECT, >20 kick). No player-player collision.
- Shared day clock: dayEpoch so every client computes the same dayT (ARCH §7.2).

### 3.3 Chat & safety — "free chat, strict control" (S3)
- Channels v1: SAY (40 m, everyone incl. guests), SYSTEM. No global chat. ≤ 140 chars after normalisation.
- Rate: 1 msg / 2 s, burst 3; accounts younger than 10 min of play: slow mode 1 / 5 s; duplicate / near-duplicate (normalised
  Levenshtein ≤ 2 within 30 s) dropped; char-flood collapsed (aaaaaa→aaa); caps-flood lowered.
- `js/shared/textfilter.js` (< 1 ms per message, deterministic, same code client & server): NFC; strip diacritics for matching;
  teencode/leet map (dm, đ.m, vl, vcl, cc, clgt, đ m, d!t, zero-width, spaced letters, repeated letters, mixed scripts);
  blocklist with severity {mask, block, block+flag} + allowlist to avoid false hits on innocent unaccented syllables
  (build a test corpus of ≥ 300 normal Vietnamese chat lines that MUST pass and ≥ 200 abusive / evasive lines that MUST be
  caught; report precision/recall). Word lists in `server/data/filter/*.txt` (owner-editable, reload without restart).
- Always BLOCK: URLs/domains (incl. "chấm com", spaced dots), phone numbers (VN formats, spaced/dotted, digits written as
  words "không chín…"), social handles (zalo/fb/tele/ig/tiktok + id, "@"), money/scam patterns (nạp thẻ, bán acc, chuyển
  khoản, cho số tài khoản …), sexual content, hate slurs. FLAG (deliver but queue for the owner): personal-info probing
  ("bao nhiêu tuổi", "nhà ở đâu", "học trường nào", "gửi ảnh"), self-harm words (also send the player a support line message).
- Nickname: textfilter + `js/brands.js` + reserved (Admin, GM, Quản trị, Hệ thống, Chủ server, …) + length 3–16.
- Reports: REPORT op + admin queue with the 20 surrounding chat lines (server-side context, not client-supplied);
  auto-mute 10 min when ≥ 3 distinct accounts report the same player within 10 min (escalates 1 h / 24 h on repeat);
  shadow-mute (sender sees own messages, nobody else does) for repeat offenders; sanctions table with expiry; mute/block lists
  per player (client sends block → server stops delivering). Chat log retained 30 days (daily purge job).
- Alerts (Telegram, optional): new report, auto-mute, server start/crash/restart, degrade ≥ L2, backup failure. Rate-limited.
- Admin page (`http://127.0.0.1:9101/admin`, Vietnamese UI, admin token): live CCU, tick p50/p99, bandwidth, degrade level;
  live 2D map of players over ROADS_DT lines (from `js/mapdata.js`); live chat feed with flagged lines highlighted; report
  queue with context and one-click actions (mute 10 m/1 h/24 h/forever, shadow-mute, kick, ban with expiry, dismiss); player
  search; invite-code batch generator (show/copy codes); broadcast SYSTEM message; restart notice; filter list reload;
  admin_audit log of every action; netprobe results by carrier.

### 3.4 Bots & load test (S4) — `server/bots/`
- Headless Node bots using **js/shared/codec.js** (no Chrome). Walk the real road graph from `js/mapdata.js` ROADS_DT (walk,
  run, moto), idle pauses, chat from a clean phrase list (+ abusive lines in the abuse scenario), random disconnects.
- `node server/bots/run.mjs --scenario <name> --url <ws/http> --n <N> --dur <s> --out <dir>`; scenarios: smoke (50),
  ramp (0→1,200 in 5 min, hold 5 min), hotspot (300 at the Opera square EXTRAS.square), stress (2,000), reconnect (1,000 drop
  and reconnect within 30 s), abuse (bad opcodes, oversize, 1,000 msg/s spam, speed-hack, teleport, forged tickets, replayed
  tickets, chat bypass attempts), netem-lite (bots add 80±30 ms send/recv delay and 2% "loss" emulated by delayed bursts).
- Collect from the server (/metrics) + bots: tick p50/p99, snapshot-assembly p99, event-loop lag p99, CPU %, RSS, bytes/s per
  client (p50/p95/max), snapshot size p95, CORRECT rate for honest bots, decode errors, abuse detection rate/latency,
  reconnect success. Write `report.json` + `report.md`.
- Acceptance (on this PC; server and bots share the CPU — run bots in worker threads/child processes and report the split):
  1,200 bots: tick p99 < 25 ms, snapshot p95 < 1,100 B, RSS < 1.5 GB, honest CORRECT < 2/min/bot, 0 decode errors;
  hotspot 300: cap 96 holds, no client > 12 KB/s; stress 2,000: ladder engages in order, no crash, queue works;
  reconnect: 100 % recover same netId; abuse: each class rejected/closed within 1 s, speed-hack detection ≥ 99 %.

### 3.5 Self-host ops (S5)
- `server/Dockerfile` (node:24-bookworm-slim, non-root user, healthcheck), `server/docker-compose.yml`: services `game`
  (9100 and 9101 published on 127.0.0.1 only), `db` (postgres:17, volume, internal network only), optional profile `tunnel`
  (cloudflared container using a token from .env), optional `backup` (nightly pg_dump, 14-day rotation into
  server/data/backups + optional copy dir). See §4 for the mandatory hardening.
- Windows scripts (PowerShell 5.1 compatible, Vietnamese messages, no admin rights needed): `server/ops/mo-may-chu.ps1`
  (start Docker stack + keep the PC awake while running via SetThreadExecutionState in a background helper + optional quick
  tunnel + prints the public URL + opens the admin page), `tat-may-chu.ps1`, `trang-thai.ps1` (health, CCU, last backup,
  exposure status), `sao-luu.ps1` / `khoi-phuc.ps1` (restore drill on a scratch DB), `tao-ma-moi.ps1` (invite batch via admin
  API), `khoa-khan-cap.ps1` (emergency tunnel cut), `cai-lich.ps1` (registers Task Scheduler jobs for nightly backup —
  provided, NOT executed).
- Tunnel: quick tunnel (random trycloudflare.com URL) for tests; named tunnel guide for the owner (buy a domain ~300k VND/yr,
  add to Cloudflare, create tunnel in the dashboard, put the token in .env, run the compose `tunnel` profile). The game page
  will connect to the URL given in config.
- `netprobe.html` (repo root, served by GitHub Pages; standalone, imports js/shared/codec.js + clock.js): Vietnamese page;
  server URL from `?s=` or a default; 30 PINGs over the real WS protocol (dedicated `/probe` WS endpoint that only answers
  PING), shows median/p95/jitter/loss; user picks carrier (Viettel/VNPT/FPT/Mobifone/Vinaphone/Khác) and network type
  (Wi-Fi/4G/5G); POSTs results to `/v1/netprobe` (rate-limited, no personal data). Admin aggregates by carrier.
- Docs: `docs/multiplayer/VAN_HANH.md` — the owner's runbook in plain Vietnamese (no jargon): mở/tắt máy chủ, tạo mã mời,
  xử lý báo cáo/khoá chat, sao lưu & khôi phục, tunnel tạm & tên miền, giữ máy không ngủ, Windows Update giờ hoạt động,
  không chạy kiểm tra đồ hoạ trong giờ chơi, an toàn cho máy (§4.9), khi nào chuyển VPS và cách chuyển, xử lý sự cố.
- `deploy-pages.yml`: strip `server/` from the gh-pages mirror (e.g. commit a tree without server/ on a temp branch before the
  force-push), keep everything else identical.

### 3.6 Verification (integrator + verifier, recorded in SERVER.md with numbers)
`npm test` (PGlite) and `npm run test:pg` (Docker PG 17) green; `docker compose up` → /healthz OK, migrations applied, a bot
session works through the container; every bot scenario of §3.4 run on this PC with report.md; a quick-tunnel smoke ≤ 5 min
(20 bots via wss://<random>.trycloudflare.com, RTT numbers recorded, tunnel stopped afterwards, URL not committed); admin page
smoke in ONE Chrome under the GPU lock (screenshot to scratchpad); §4 exposure tests (admin unreachable via tunnel/edge).

## 4. MACHINE SAFETY — owner requirement (14/10/2026): "hãy đảm bảo an toàn 100% cho máy tôi"
The server runs on the owner's personal Windows PC. Nothing is ever 100 %, so we build **defence in depth** and the security
reviewer must try to break every layer. These are HARD requirements (they override anything looser above):
1. **Zero inbound exposure of the PC.** No port is reachable from the Internet or the LAN: every published compose port is bound
   to `127.0.0.1` only; no UPnP; no Windows Firewall rule is added or changed; the Docker daemon is never exposed over TCP.
   The ONLY way in from the Internet is the Cloudflare Tunnel, and **cloudflared runs as a container** (compose profile
   `tunnel`) on a dedicated Docker network `edge` shared ONLY with the `game` container — never as a Windows service, never
   with host networking. Its ingress routes exactly `/play`, `/probe`, `/v1/*`, `/healthz` to `http://game:9100` and ends with
   `http_status:404`. The DB lives on an `internal: true` network (no Internet egress, not reachable by cloudflared).
2. **Admin is never reachable through the tunnel.** Admin listens on its own port; requests are accepted only when the source is
   the host's published-port path (reject the cloudflared container's source address / the `edge` network), with a strong token
   (≥ 32 random bytes, constant-time compare), CSRF protection for actions, rate-limited login, and an audit log. Test it: from
   inside the cloudflared container and through the tunnel, admin must be unreachable.
3. **Containers are boxed:** non-root user, `read_only: true` root FS (+ tmpfs for /tmp), `security_opt: no-new-privileges`,
   `cap_drop: [ALL]`, no `privileged`, **no docker.sock mount, no bind mount of the user's folders** — repo files the server
   needs (js/shared, js/mapdata.js, js/terrain.js, js/brands.js, admin page) are COPIED into the image at build time; the only
   bind mount is the dedicated backup folder `server/data/backups` (write by the backup service only). Resource limits so a
   DoS cannot freeze the PC: game ≤ 4 CPUs / 2 GB RAM / pids 512, db ≤ 2 CPUs / 1 GB, cloudflared ≤ 0.5 CPU / 256 MB.
   Base images pinned by digest (node:24-bookworm-slim, postgres:17, cloudflare/cloudflared).
4. **Supply chain:** exact versions + package-lock + `npm ci`; uWebSockets.js from a pinned tag with its tarball checksum
   recorded; `npm audit --omit=dev` clean of high/critical (or documented); no postinstall scripts from unknown packages.
5. **Secrets:** generated on first run into `server/.env` (gitignored, never inside the image, never logged); a test asserts
   that no secret value appears in logs/HTTP responses; the tunnel token lives only in `.env`.
6. **Abuse cannot hurt the PC:** global caps (CCU cap, connection rate, payload size, per-message work), slow-loris timeouts,
   bounded queues/buffers, log rotation (Docker json-file max-size 10m × 5), DB size watch, backups rotated (14 days) — the
   disk can never fill up. Cloudflare's edge absorbs volumetric DDoS; the home IP is never revealed (no direct `ws://IP`
   fallback anywhere in client/netprobe code).
7. **GPU / blue-screen guard:** production start (`mo-may-chu.ps1`) writes `%TEMP%\hpworld_server_live.txt` and its helper
   touches it every minute (also keeps the PC awake); `tat-may-chu.ps1` deletes it. `tools/qa/gpulock.mjs` (already updated by
   the orchestrator on dot3, commit a5f4b37) makes all GPU work WAIT while that file is fresh, so no Chrome 3D can blue-screen
   the PC mid-session. **Every agent test run of the ops scripts MUST use test mode** (`-TestMode` switch or env `HPMP_TEST=1`)
   which does NOT write the marker (otherwise the parallel graphics workflow freezes) and uses the agent's own ports/project.
8. **Kill switch & recovery:** `tat-may-chu.ps1` stops tunnel + game + db within 10 s and verifies nothing listens on the ports
   afterwards; `khoa-khan-cap.ps1` (emergency) stops only the tunnel instantly (players disconnected, data kept);
   `trang-thai.ps1` shows exposure status (what listens on which address) so the owner can see at a glance that only
   127.0.0.1 is used.
9. **Docs:** VAN_HANH.md has a short "An toàn cho máy của anh" section in plain Vietnamese: the layers above, what the owner
   must keep on (Windows Update, Defender, firewall), what never to do (don't disable the firewall, don't run with
   HPWORLD_ALLOW_GPU_WHILE_LIVE, don't share the .env or tunnel token, don't add port forwarding on the modem), and the
   honest residual risks (a zero-day in Docker/WSL2/cloudflared; home bandwidth saturation by DDoS → use the emergency stop).
