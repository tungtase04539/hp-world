# Máy chủ multiplayer — ghi chú kỹ thuật (as built)

Tài liệu kỹ thuật của thư mục `server/` và `js/shared/`. Mỗi gói việc (S2 game, S3 chat/quản trị, S4 bot, S5 vận hành)
**thêm một mục riêng** ở cuối file này. Kế hoạch: `KE_HOACH.md` (thắng khi khác `ARCH.md`). Hợp đồng module:
`server/CONTRACT.md`. Hướng dẫn cho chủ dự án (không thuật ngữ): `VAN_HANH.md` (S5).
**Đọc §6 trước** (tích hợp 15/10/2026): kiến trúc cuối, bảng giao thức, các mối nối giữa gói, số đo đủ 7 kịch bản bot
so với mục tiêu, việc còn mở. §1–§5 là ghi chép của từng gói lúc làm (mô tả "stub"/số test ở §1 là trạng thái nền móng).

## 1. Nền móng (Foundation, 14/10/2026)

### 1.1 Kiến trúc đã dựng

```
trình duyệt / bot ──HTTP + WS──► cổng game 9100 (public qua Cloudflare Tunnel)
                                  ├─ http/router.js  (/healthz, /v1/*  — CORS allow-list, kiểm Origin, giới hạn body 16 KB)
                                  └─ WS /play (gateway, S2) · WS /probe (netprobe, S5)
chủ dự án (chính máy) ──HTTP──► cổng admin 9101 (chỉ 127.0.0.1): /healthz, /metrics, /admin, /admin/api/* (Bearer ADMIN_TOKEN)

main.js: config → log → metrics → DB (pg | PGlite) → migrate → 2 transport (uWS | ws) → register(app) × 17 module
         → listen → bus 'start'
```

- **Một tiến trình Node 24** (giai đoạn A của ARCH §3.3). Mọi thứ phụ thuộc giao diện nhỏ (`Transport`, `db.query`,
  `app.bus`) để sau tách luồng/máy mà không viết lại module tính năng.
- **Transport** (`server/src/net/transport.js`): uWebSockets.js (tag GitHub `v20.71.0`, tarball ghim trong
  `package-lock.json` kèm sha512) hoặc `ws` 8.22 + `node:http`, **tự lùi về `ws`** khi uWS không nạp được. Cùng một
  giao diện cho HTTP lẫn WS: `conn.send()` trả 1/0/2, `cork`, `bufferedAmount`, `close`, `terminate`. Tắt
  permessage-deflate (payload đã bit-pack), tin client ≤ 512 B, idle 20 s (ping tự động), maxBackpressure 64 KB
  (vượt → đóng socket ngay, cả hai backend).
- **uWS ESM wrapper hỏng ở v20.71.0** (`ESM_wrapper.mjs` import `./index.js` không tồn tại) → nạp bằng `createRequire`.
- **DB** (`server/src/db/db.js`): `pg` Pool khi có `DB_URL`, ngược lại **PGlite** (Postgres 17 chạy trong tiến trình,
  WASM) — test chạy trên Windows không cần Docker. Chuẩn hoá kiểu: int8 → number, bytea → Uint8Array, timestamptz →
  Date. Migration tiến một chiều, mỗi file một transaction + advisory lock, checksum sha256 (bỏ qua khác biệt CRLF).
  Dải số: 001–009 nền móng, 010–019 S2, 020–029 S3, 030–039 S5.
- **Bí mật**: lần chạy đầu `npm start` sinh `server/.env` (gitignore) — khoá Ed25519 (PKCS#8 DER base64) cho JWT
  EdDSA, khoá HMAC vé 32 B, ADMIN_TOKEN 32 B, mật khẩu DB. `NODE_ENV=production` thiếu bí mật → từ chối khởi động.
  Log tự che mọi khoá dạng token/ticket/password/secret.
- **Metrics** tự viết (không thêm dependency): counter/gauge/histogram + cửa sổ 2.048 mẫu cho p50/p99 (thang suy giảm
  và trang quản trị đọc), CPU %, RSS, heap, event-loop delay p50/p99/max. Prometheus text ở `/metrics` cổng admin.
- **Phụ thuộc runtime** đúng SPEC: `uWebSockets.js`, `ws`, `pg`, `jose`; dev: `@electric-sql/pglite`. Không thêm gì
  khác (logger/metrics/router/.env đều tự viết vài chục dòng thay cho pino/prom-client/dotenv).

### 1.2 Mã dùng chung `js/shared/` (client + server + bot, ESM thuần, không three, không DOM)

| File | Nội dung |
|---|---|
| `constants.js` | tốc độ đi 3 / chạy 7 / xe máy 16 / xích lô 4,2 / thuyền 10 m/s, nhảy 6,5, trọng lực 26, PLAY_RADIUS 1588, tick 20 Hz / snapshot 10 Hz, AOI, thang suy giảm, kiểm di chuyển, chat, giới hạn tần suất, mạng |
| `protocol.js` | PROTO_VERSION = 1, opcode ARCH §6.4, mã SYSTEM/CORRECT/EVENT/CHAT/REPORT/CLOSE, mã lỗi API |
| `quant.js` | lượng tử hoá ARCH §6.3 (x/z 5 cm u16, y 0,25 m, yaw 1,41°, tốc độ 0,125 m/s, vận tốc i8) |
| `codec.js` | **file duy nhất** đọc/ghi định dạng dây; bố cục từng byte ghi ở đầu file |
| `grid.js` | lưới ô 128 m 25×25, 3×3 lân cận, hysteresis 8 m |
| `clock.js` | `ClockSync` (8 mẫu RTT thấp nhất, trung vị, nắn ≤ 0,5 %), `dayTAt` ngày/đêm chung |
| `spawns.js` | 8 điểm xuất hiện trên vỉa hè phố thật (sinh bởi `server/scripts/gen_spawns.mjs`) |
| `textfilter.js` | API cuối của bộ lọc (S3 thay phần ruột) |

**Chống trôi hằng số**: `server/test/shared_constants_drift.test.js` đọc văn bản `js/main.js` (WALK/RUN/GRAV/JUMP,
PLAY_RADIUS), `js/vehicles.js` (speed/accel từng loại xe), `js/world.js` (BUILD_RADIUS), `js/daynight.js` (DAY_LENGTH)
và báo đỏ khi lệch `constants.js`.

**Điểm xuất hiện** (kiểm lại mỗi lần chạy test với dữ liệu hiện hành, cả biên jitter ±2,5 m): trên đất
(`isWater` false, không có nước trong 3 m, cao độ ≈ LAND_H), trong đĩa chơi (≤ 1568 m), trong hành lang lòng+vỉa của
một way ROADS_DT không phải cầu nâng, cách cầu ≥ 20 m, cách mọi footprint nhà thật (`js/buildings_real.js`) ≥ 1 m.
Cách nhau tối thiểu 330 m: Quảng trường Nhà hát lớn, Bưu điện thành phố, Hồ Tam Bạc, Chợ Sắt, Ga Hải Phòng,
phố Lạch Tray, Chùa Hàng, Nhà thờ lớn. Dữ liệu thành phố đổi làm test đỏ → chạy lại `node server/scripts/gen_spawns.mjs`.

### 1.3 Giao thức — kích thước đo được (byte, kể cả opcode)

| Tin | B | Tin | B |
|---|---|---|---|
| C2S HELLO (vé 43 ký tự) | 52 | S2C WELCOME | 53 |
| C2S HELLO resume | 25 | S2C SNAPSHOT rỗng | 17 |
| C2S STATE | 17 | S2C SNAPSHOT 19 bản ghi (TB 1k CCU) | 188 |
| C2S ACTION | 12 | S2C SNAPSHOT 40 bản ghi | 377 |
| C2S CHAT (40 ký tự Việt) | 56 | S2C SNAPSHOT 96 bản ghi (trần) | **881** (< 1.100) |
| C2S PING | 5 | S2C SNAPSHOT keyframe 96 ENTER | 1.841 (⚠ S2 phải rải ENTER qua nhiều snapshot) |
| C2S REPORT | 8 | S2C NAMES 1 người | 23 |
| S2C PONG | 13 | S2C STATS đủ + tiền | 15 |
| S2C CORRECT | 9 | S2C CHAT (40 ký tự) | 62 |
| S2C SYSTEM | 6 | S2C WORLD 4 mục thời tiết | 108 |

Băng thông xuống ở 10 Hz kèm ~68 B overhead WS+TLS+TCP/IP mỗi tin: 19 người ≈ 2,5 KB/s, 40 ≈ 4,3 KB/s, 96 ≈ 9,3 KB/s
(khớp ARCH §6.5, bản ghi P1 tuyệt đối 9 B; P2 delta để dành cờ `SNAP_FLAG.DELTA_P2`, proto 1 từ chối).

Bộ giải mã **không bao giờ ném lỗi**: trả `DECODE_ERR.*` cho rỗng / opcode lạ / cụt / thừa byte / quá cỡ / giá trị
ngoài miền / UTF-8 hỏng. Test: mọi cách cắt cụt mọi tin hợp lệ, 200.000 buffer ngẫu nhiên + 100.000 tin hợp lệ bị đột
biến, 100.000 STATE ngẫu nhiên khứ hồi trong sai số lượng tử. `decodeC2S(bytes, pool)` dùng lại 1 object mỗi opcode →
0 cấp phát cho STATE/PING trên đường nóng.

### 1.4 Số đo nền (máy chủ dự án, Windows 11, Node 24.15, 14/10/2026)

PING→PONG qua tiến trình máy chủ thật, loopback, 2.000 mẫu tuần tự (sau 100 mẫu khởi động),
`node server/scripts/measure.mjs`:

| Transport | p50 | p95 | p99 | max |
|---|---|---|---|---|
| uWS | 0,030 ms | 0,131 ms | 0,239 ms | 0,77 ms |
| ws | 0,032 ms | 0,119 ms | 0,276 ms | 0,62 ms |

(Một kết nối không tải — chỉ là sàn; số dưới tải do S4 đo bằng bot.)

### 1.5 uWS trên Linux / Docker (cho S5)

- Gói `uWebSockets.js@v20.71.0` kèm sẵn nhị phân win32/linux/darwin × Node ABI 127/137/147 (Node 22/24/26).
- **Bản linux x64 cần GLIBC ≥ 2.38.** `node:24-bookworm-slim` (Debian 12, glibc 2.36) **không nạp được** → máy chủ tự
  lùi về `ws` (đã kiểm: test chạy xanh với `ws`, test uWS tự bỏ qua). **Dùng `node:24-trixie-slim`** (Debian 13, glibc
  2.41): đã kiểm trong container — uWS nạp được, `boot.test.js` + `core.test.js` xanh cả uWS lẫn ws.
- Cài trong Docker: `npm ci` tải tarball tag từ GitHub qua HTTPS (không cần git/ssh), kiểm sha512 trong lockfile.
- Alpine (musl) không được uWS hỗ trợ.

### 1.6 Chạy

```
cd server
npm ci                       # lần đầu
npm start                    # lần đầu tự tạo server/.env; PGlite lưu ở server/data/pglite
                             #   GAME_PORT/ADMIN_PORT/PGLITE_DIR=memory/TRANSPORT=ws ... để đổi
npm test                     # node --test, Windows, không Docker (PGlite trong RAM) — 39 test
PG_TEST_PORT=55432 PG_TEST_PROJECT=<dự án-compose-của-bạn> npm run test:pg   # Postgres 17 trong Docker, tự dọn
node scripts/measure.mjs --port 9100   # kích thước codec + RTT PING cả 2 transport
node scripts/gen_spawns.mjs            # sinh lại điểm xuất hiện
```

Kiểm nhanh: `curl http://127.0.0.1:9100/healthz` → `{"ok":true,"transport":"uws","db":"ok",...}`;
`curl http://127.0.0.1:9101/metrics`; `curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://127.0.0.1:9101/admin/api/status`.

### 1.7 Tóm tắt hợp đồng (chi tiết: `server/CONTRACT.md`)

- `main.js` import **danh sách cố định** 17 module; mỗi module `export function register(app)`. WP chỉ sửa file của mình.
- `app`: `config, log, metrics, db, http` (router cổng game), `admin` (router cổng admin, `{auth:'admin'}`),
  `ws.route/guard`, `bus` (on/once/off/emit), `timers` (after/every/loop cố định nhịp), `provide/get/has/replace`
  dịch vụ, `onStop`, `nowMs`, `health`, `paths`, `ports`.
- Dịch vụ có chữ ký cuối: `alerts` (S3), `chat` (S3: `handle/report/isMuted/nicknameCheck/blocks`), `worldclock`, `sim`.
- Stub hiện có: `/play` trả PONG cho PING và SYSTEM NOT_IMPLEMENTED cho HELLO; `/probe` chỉ PING; `/v1/auth/*`,
  `/v1/join`, `/v1/netprobe` trả 501; `/admin` trang tạm; vòng sim 20 Hz rỗng (đo `hp_sim_tick_ms`).

### 1.8 Lưu ý cho các gói sau

- **Keyframe đầy đủ 96 người = 1.841 B** > ngân sách 1.100 B: S2 nên giới hạn ENTER mỗi snapshot (vd ≤ 32 ENTER =
  625 B + UPDATE còn lại) và gửi NAMES riêng.
- `message(conn, bytes)` của uWS: `bytes` chỉ hợp lệ trong callback — `decodeC2S` đã sao chép chuỗi/token.
- `.gitignore`: `server/data/*` bị bỏ qua **trừ** `server/data/filter/` (danh sách từ lọc chat của S3 cần commit).
- `TRUST_PROXY=cloudflare` chỉ bật khi cổng game không tới được trừ qua tunnel (compose publish 127.0.0.1).
- `deploy-pages.yml` dựng commit có cây = HEAD trừ `server/` rồi đẩy lên `gh-pages` (`js/shared/` vẫn lên Pages vì
  client cần).

## 2. S2 CORE — máy chủ game (tài khoản, phiên, mô phỏng, AOI, kiểm di chuyển) — 15/10/2026

### 2.1 Module (`server/src/game/*`, `server/src/api/{auth,join}.js`, `js/shared/move.js`)

| File | Việc | Dịch vụ (`app.get`) |
|---|---|---|
| `game/world.js` | bảng thực thể (1 Entity / người chơi), lưới ô 128 m, cấp `netId` (u16, tái dùng an toàn nhờ `gen`), lượng tử hoá 1 lần mỗi STATE được nhận | — (qua `sessions.world`) |
| `game/session.js` | Session + quản lý phiên: 1 phiên/tài khoản, "limbo" 60 s (avatar ở lại, cờ AWAY), pha snapshot so le, hàng ghi DB, giờ chơi | `sessions` |
| `game/gateway.js` | WS `/play`: HELLO→WELCOME(+WORLD)→READY, resume, STATE/ACTION/CHAT/REPORT/PING, token bucket, giới hạn IP | `gateway` (handlers cho bench/test) |
| `game/sim.js` | vòng 20 Hz: snapshot 10 Hz/khách (2 pha), bỏ snapshot khi nghẽn (> 16 KB) → keyframe, NAMES, thang suy giảm, flush 30 s | `sim` |
| `game/aoi.js` + `encoder.js` | chọn ai thấy ai (trần 96, ENTER ≤ 24/snapshot, ngân sách 1.100 B, bộ tích luỹ ưu tiên, tầng xa) → `SnapshotBuilder` | — |
| `game/validate.js` | điểm vi phạm → CORRECT/kick, giữ chỗ xe dùng chung | `validate` |
| `game/degrade.js` | thang L0–L4 theo p99 thời gian tick (cửa sổ 100 tick) | (trong `sim`) |
| `game/queue.js` | trần CCU (`CAPACITY`, mặc định 1.200) + hàng chờ có vị trí/ETA; vé giữ chỗ 60 s; L4 ngừng nhận | `queue` |
| `game/tickets.js` | vé vào (HMAC-SHA256, 60 s, dùng 1 lần) | `tickets` (đăng ký trong `api/join.js`) |
| `game/resume.js` | token resume 16 B (ngẫu nhiên, 1 lần, đổi mỗi WELCOME) + backoff 1-2-4-8 s | `resume` |
| `game/ratelimit.js` | token bucket, giới hạn theo khoá có bộ nhớ chặn trên, nhóm IPv6 /64, miễn trừ loopback/IP riêng | `ratelimit` |
| `game/persist.js`, `spawn.js`, `worldclock.js` | ghi nhân vật + `playtime_daily`; chỗ xuất hiện (vị trí đã lưu nếu còn hợp lệ, không thì điểm ít người nhất); ngày/đêm chung + WORLD | `worldclock` |
| `game/bench.mjs` | đo trong tiến trình (không socket) — xem 2.8 | — |
| `api/auth.js` | `/v1/auth/guest`, `/refresh`, `/recover`; JWT EdDSA; mã mời; mã khôi phục | `auth` |
| `api/join.js` | `/v1/join` → vé hoặc hàng chờ | — |
| `js/shared/move.js` | luật di chuyển THUẦN dùng chung (server, bot, sau này client): đất/nước/cầu/bến, `MoveCheck` | — |
| `db/migrations/010_game_auth.sql` | chỉ mục (refresh_tokens.expires_at, invites.batch, playtime_daily.day) | — |

### 2.2 HTTP API (JSON, lỗi = `{error: code, ...}`)

| Đường | Vào | Ra (200) | Lỗi |
|---|---|---|---|
| `POST /v1/auth/guest` | `{nickname, deviceId, inviteCode, appearance?}` (`deviceId` 8–64 ký tự `[A-Za-z0-9_-]`, `appearance` 16 hex) | `{accessToken, accessExpiresIn: 900, refreshToken, refreshExpiresAt, recoveryCode, account}` | 400 `bad_request` / `device_invalid` / `nickname_invalid {reason}`; 403 `invite_required` / `invite_invalid`; 409 `nickname_taken`; 429 |
| `POST /v1/auth/refresh` | `{refreshToken}` | như trên trừ `recoveryCode` | 401 `unauthorized` / `refresh_reused`; 403 `banned`; 409 `refresh_race`; 429 |
| `POST /v1/auth/recover` | `{code, deviceId}` | như refresh | 401 `recovery_invalid`; 403 `banned`; 429 |
| `POST /v1/join` | `{accessToken, proto, tier, worldVersion?}` | `{wsUrl, ticket, ticketExpiresIn: 60, spawnHint{x,z,yaw,id}, proto, serverTime}` **hoặc** `{queue: {position, etaS, retryAfterS}}` | 409 `proto_mismatch {serverProto}`; 401; 403 `banned`; 429 |

`account = {id, kind, nickname, discriminator, displayName}`, `displayName = "Nick#1234"` (4 số, duy nhất theo
`lower(nickname)`). Tên kiểm bằng `chat.nicknameCheck` (S3: textfilter + thương hiệu + tên dành riêng + dài 3–16).

- **Access JWT**: EdDSA (Ed25519, `JWT_PRIVATE_KEY`), header `kid = JWT_KID`, `iss hp-world`, `aud hp-world-play`,
  `sub` = id tài khoản, `dn` = tên hiển thị, `k` = loại, 15 phút. Khoá công khai: `app.get('auth').publicJwk()`.
- **Refresh**: 256 bit ngẫu nhiên, DB chỉ giữ sha256, **xoay vòng mỗi lần dùng** (`rotated_from`), 180 ngày. Dùng lại
  token đã xoay: trong 30 s = gửi trùng (`409 refresh_race`, không thu hồi gì); sau 30 s = dấu hiệu bị lộ → thu hồi MỌI
  refresh token của tài khoản (`401 refresh_reused`). Token bị thu hồi (không có token con) → 401. Token hết hạn > 7 ngày
  được dọn mỗi giờ.
- **Mã khôi phục**: 12 ký tự bảng chữ không nhầm `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (không I L O 0 1), hiện **một lần**
  dạng `XXXX-XXXX-XXXX`, lưu sha256 của mã đã chuẩn hoá (`accounts.recovery_hash`); gõ thường/hoa/có cách đều được; vẫn
  dùng được về sau (là chìa khoá tài khoản trên máy mới).
- **Mã mời**: 10 ký tự cùng bảng chữ, dạng `XXXXX-XXXXX`; `invites.code_hash = sha256(normalizeCode(code))`,
  `normalizeCode` = NFKC → CHỮ HOA → bỏ mọi ký tự ngoài A-Z0-9. Mỗi lần dùng giảm `uses_left` NGUYÊN TỬ trong cùng giao
  dịch tạo tài khoản. Trang quản trị (S3) tạo lô bằng `createInviteBatch(db, {count, uses, expiresAt, batch, note,
  createdBy})` (export từ `api/auth.js`; cũng là `app.get('auth').createInviteBatch(opts)`) → trả mã THƯỜNG để hiện 1 lần.
- **Google (GĐ2)**: chưa có route; `linkIdentity(db, accountId, 'google', sub, email)` là điểm mở rộng "liên kết, không
  gộp" (trả `{ok: false, conflictAccountId}` khi `sub` đã thuộc tài khoản khác).
- **Vé**: `"v1." + b64url(accountId 16 B | exp u32 | nonce 8 B | tier u8) + "." + b64url(HMAC-SHA256[0..16])`, 62 ký tự,
  gửi trong HELLO (không bao giờ trong URL). Vé giữ 1 chỗ trong trần CCU tới khi dùng/hết hạn. Tài khoản đang có phiên
  (kể cả limbo) luôn được vé (kết nối mới thay kết nối cũ).

### 2.3 Vòng đời WebSocket `/play`

```
open ─(≤ 10 s; PING được trả lời, tối đa 3.000 PING trước HELLO)─► HELLO{ticket}
  ├ proto ≠ 1                   → SYSTEM RELOAD(arg = 1) + close 4004
  ├ vé sai / hết hạn / đã dùng   → SYSTEM AUTH_FAILED(BAD_TICKET 1 | EXPIRED 2 | REUSED 3) + close 4001
  ├ tài khoản bị cấm             → SYSTEM BANNED(0xFFFFFFFF) + close 4003
  ├ đã có phiên cùng tài khoản   → socket cũ: SYSTEM DUPLICATE_SESSION + close 4002; giữ netId + vị trí
  └ WELCOME{netId, serverTime, 20, 10, dayEpoch, 1440, resumeToken, weather, spawn} + WORLD{lịch thời tiết}
READY ─► avatar vào thế giới; snapshot đầu = KEYFRAME (ENTER rải ≤ 24/snapshot); NAMES cho người mới thấy
mất kết nối ─► limbo 60 s: avatar ở lại với cờ AWAY (người khác thấy "vắng mặt"); nhân vật được ghi DB ngay
HELLO{flags = RESUME, resumeToken} trong 60 s ─► WELCOME (token mới) + SYSTEM RESUMED(netId) + KEYFRAME ngay (không cần READY)
                        token sai / đã dùng / hết hạn → SYSTEM AUTH_FAILED(BAD_RESUME 4) + close 4001
quá 60 s ─► LEAVE cho người xem, netId được nhả, bus `player:leave`
```

- Chưa READY sau 180 s → close 4007. Tắt máy chủ → SYSTEM BACKOFF(1–2 s ngẫu nhiên) rồi close 1001.
- **ACTION** → `EVENT ACTION_RESULT [reqId, code]`; `code` 0 OK, 1 UNSUPPORTED, 2 BUSY (xe đã có người), 3 INVALID,
  4 DENIED (`ACTION_RESULT` export từ `game/gateway.js`). Đã làm: MOUNT/DISMOUNT (giữ chỗ xe dùng chung theo `target` =
  vehicleRef ≠ 0), CALL_MOTO, EMOTE, BLOCK_PLAYER/UNBLOCK_PLAYER (`target` = netId; gọi `chat.block(session, accountId)` /
  `chat.unblock` nếu S3 có, không thì danh sách chặn trong RAM của phiên). Loại khác → UNSUPPORTED.
- **CHAT** → `chat.handle(session, channel, text)` (S3) → ok: SAY tới mọi người **active trong 40 m** (kể cả người gửi
  để biết `msgRef`), bỏ người nhận đã chặn người gửi (`chat.blocks(recipientAccountId)`); `shadow` → chỉ người gửi;
  không ok → `EVENT CHAT_REJECTED [code, retryAfterMs]`. Bus `chat:message {session, channel, text, shadow, flagged,
  msgRef, x, z, recipients, at}` (S3 dùng `msgRef` làm `chatRef` cho báo cáo). Chặn cứng ở gateway: 2 tin/s, burst 6.
- **REPORT** → `chat.report(session, targetAccountId, reason, chatRef)` → `EVENT REPORT_RESULT [code]`; netId đã rời
  vẫn tra được tài khoản trong 10 phút; tự báo mình → SELF; netId lạ → UNKNOWN_TARGET.
- Bus `sanction {accountId, kind, until}` (S3): `kick` / `ban` → đóng phiên (ban: SYSTEM BANNED(giây còn lại) + 4003),
  `mute` → SYSTEM MUTED(giây). Thang suy giảm đổi mức → SYSTEM DEGRADE(mức) cho mọi người + bus `degrade`.

### 2.4 Kiểm di chuyển ("client đi trước, server kiểm" — `js/shared/move.js` + `game/validate.js`)

- **Cửa sổ trượt 1 s theo ĐỒNG HỒ CLIENT** (đồng hồ này được kiểm bằng ngân sách thời gian bên dưới): quãng đường thẳng
  từ mẫu cũ nhất trong 1 s ≤ `1,2 × Σ vmax(chế độ hai đầu đoạn) × Δt + 1 m` (+ 9 m nếu cửa sổ có lên/xuống xe: chỗ xuống
  xe được tìm tới 8 m). Nhờ dùng đồng hồ client, jitter và gói dồn sau khi rớt sóng **không** bị coi là chạy nhanh.
- **Dịch chuyển** (cờ cứng, CORRECT ngay): một bước > max(12 m, 3 × giới hạn của chính bước đó).
- **[Đã thay ở vòng sửa 1 — xem §7.1: không còn 5 s học tự do; xô tha thứ 2 s; thời gian hiệu dụng; trần trễ 2,5 s; RESUME
  giữ bộ kiểm]** **Ngân sách thời gian** (−100 / +200 ms): `o = giờ server nhận − giờ client` (u16 được mở gói; khoảng trống > 30 s
  mở theo thời gian thật). 5 s đầu học độ trễ tối thiểu; sau đó mốc `base` chỉ được hạ theo trôi đồng hồ ≤ 2 ms/s;
  client "đi trước" mốc > 100 ms = vi phạm TIME (mốc hạ xuống 100 ms dưới mẫu đó). Trễ (lag) không bị phạt, nhưng trễ
  > 200 ms LIÊN TỤC 10 s thì mốc được nâng (mất phần tín dụng thừa) → không "tích thời gian" quá ~10 s để lao đi.
- **Đĩa chơi**: ngoài `PLAY_RADIUS + 2 m` = vi phạm; ngoài + 50 m = cờ cứng.
- **Mặt nền**: chế độ trên cạn mà ở trên nước (`isWater` của `js/terrain.js`) chỉ hợp lệ khi trên mặt cầu (mặt cầu địa
  hình `groundHeight`, hành lang `BRIDGE_WAYS` (nửa bề rộng + 3 m), way `ELEVATED_RI`), trên bến Bến Bính (tính lại đúng
  như `world.js buildPier`), hoặc trong 1,5 m của đất (mép kè). Thuyền phải ở nước hoặc trong 8 m của nước.
- **Xe**: xe máy cá nhân (`vehicleRef 0`) đi mọi nơi trên cạn; xích lô / thuyền / xe máy dùng chung (`vehicleRef ≠ 0`)
  cần giữ chỗ (ACTION MOUNT, hoặc tự giữ ở STATE đầu nếu xe trống; người thứ hai → MODE); ngồi sau (PILLION) cần một
  người đang lái trong 4 m. Chuyển về chế độ đi bộ thì tự nhả xe.
- **Điểm**: +1 mỗi STATE vi phạm, +5 cờ cứng, −1/s; > 5 → CORRECT (về vị trí được nhận cuối, `corrEpoch + 1`), > 20 →
  kick (`KICK_REASON.CHEAT`). STATE mang `corrEpoch` cũ bị bỏ qua; client không áp CORRECT → gửi lại mỗi 3 s, quá 5 lần
  → kick. STATE vi phạm không được nhận (người khác vẫn thấy vị trí hợp lệ cuối).
- **Chưa kiểm** (v1): xuyên tường (cần collider export — ARCH §12.4), gia tốc. Độ cao y: **kẹp** từ vòng sửa 1 (§7.3).
- **Đánh đổi đã đo** (`test/core_move.test.js`): trung thực → 0 CORRECT với jitter 0–300 ms, rớt sóng 1–3 s mỗi 8 s,
  bufferbloat 800 ms, 2 Hz khi đứng, đổi chế độ + lên/xuống xe, tab ẩn 70 s, đồng hồ lệch 0,1 %. Bufferbloat ≥ 1,5 s kéo
  dài > 10 s rồi xả trong 1 s có thể tốn **1** CORRECT (giá của trần +200 ms). Hack tốc độ ×1,5 bị CORRECT < 2,5 s;
  đồng hồ client nhanh ×2 < 8 s, ×1,5 < 12 s, ×1,25 < 45 s (lợi 25 % tốc độ trong khoảng đó).

### 2.5 AOI, snapshot, thang suy giảm

- Ứng viên (vòng sửa 1, §7.3: mọi ô giao hình vuông ±(bán kính + 8 m) quanh vị trí thật — trước là 3×3 ô): bán kính 160 m (≤ 120 m: 10 Hz; 120–160 m: tầng xa 5 Hz);
  người đang thấy chỉ rời khi > bán kính + 8 m. Tối đa **96** người thấy cùng lúc: điểm = d² / trọng số² (trọng số 2 cho
  người đang lái xe), người đang thấy được nhân 0,72 (chống đổi qua lại); ngưỡng = phần tử thứ 96 (quickselect, không
  sort cả danh sách). ENTER ≤ 24/snapshot (keyframe 96 người rải qua 4 snapshot ≈ 0,4 s). Chỉ gửi UPDATE cho người **có
  thay đổi** kể từ lần gửi trước (người đứng yên tốn 0 byte); vượt ngân sách 1.100 B / 96 bản ghi → bộ tích luỹ ưu tiên
  `+= w/(d+10)` mỗi snapshot, gửi điểm cao trước, reset khi gửi.
- NAMES: mỗi người 1 lần mỗi phiên của người xem (nhớ theo `netId` + `gen`; netId được tái dùng → gửi lại).
- `bufferedAmount > 16 KB` → bỏ snapshot (vòng sửa 1, §7.2: KHÔNG còn ép keyframe; delta kế tiếp vẫn đúng).
- Thang (vòng sửa 1, §7.4: quyết theo max(p90 tick, p90 trễ bắt đầu tick − 16 ms)): L1 (p99 tick > 25 ms) tầng xa 2,5 Hz · L2 (> 35) bán kính 80 m · L3 (> 45) snapshot "mỏng" xen kẽ (bản thân +
  16 người gần nhất) · L4 (> 50) ngừng nhận phiên mới (hàng chờ). Lên 1 mức sau 2 s liên tục, xuống sau 10 s dưới 70 %
  ngưỡng. Metric `hp_degrade_level`, `hp_degrade_changes_total`; gửi cảnh báo (S3) khi lên ≥ L2.

### 2.6 Lưu trữ

- Nhân vật (`pos_x/z/y`, `yaw`, `cell`, `version + 1`) ghi khi **bẩn** mỗi 30 s bằng MỘT câu lệnh (`jsonb_to_recordset`),
  ngay khi rớt kết nối, khi phiên kết thúc và khi tắt máy chủ.
- Giờ chơi: cộng mỗi giây khi phiên active; mỗi lần ghi cộng phần nguyên vào `accounts.play_seconds` và
  `playtime_daily(account_id, day)`, `day` = ngày giờ Việt Nam (UTC+7). `session.playSeconds` (chat slow mode) = tổng
  đời + phiên hiện tại.

### 2.7 Giới hạn tần suất (`game/ratelimit.js LIMITS`, `session.js`, `gateway.js GW`)

| Đối tượng | Giới hạn |
|---|---|
| Mỗi phiên | STATE 25/s · ACTION 5/s · CHAT 2/s burst 6 (chính sách thật ở S3) · PING 2/s burst 4 · REPORT 1/10 s; > 500 tin bị bỏ trong 10 s → SYSTEM BACKOFF + close 4006; 10 tin hỏng → 1008 |
| Tài khoản / thiết bị | guest 5/giờ/thiết bị · recover 5/giờ/thiết bị (300/giờ toàn máy chủ: chỉ CẢNH BÁO từ vòng sửa 1) · join 0,5/s burst 10 (**1 chỗ giữ/tài khoản**) · HELLO **và RESUME** 1/s burst 10 · refresh 1/s mỗi token |
| IP (lỏng vì CGNAT) | guest 30/giờ (/48) · recover 20/giờ (/48) · refresh 10/s · join 50/s · kết nối WS mới 20/s burst 300 · socket chưa HELLO ≤ 64/IP (/48 với IPv6), ≤ 5.000 toàn máy; tin đầu không phải PING/HELLO → đóng 1008 ngay |
| Miễn trừ theo IP | loopback, 10/8, 172.16/12, 192.168/16, fc00::/7, fe80::/10 (bot cùng máy, đường Docker host); người thật qua tunnel có IP công khai từ `CF-Connecting-IP` |

### 2.8 Số đo (máy chủ dự án, Windows 11, Node 24.15, 15/10/2026)

`node src/game/bench.mjs --n N --hotspot K --dur 30` (chạy dưới `tools/qa/gpulock.mjs`): N phiên đi qua **đường mã thật**
(HELLO có vé → WELCOME → READY → STATE 15 Hz khi đi / 2 Hz khi đứng → kiểm → AOI → mã hoá snapshot) với kết nối giả chỉ
đếm byte; vòng 20 Hz chạy thật; bot trung thực 35 % đi bộ, 25 % chạy, 20 % xe máy, 20 % đứng, quanh 8 điểm xuất hiện.

| Kịch bản | tick p50 | tick p99 | tick max | snapshot p50 / p95 / max (B) | byte/s/khách (payload) | CORRECT | RSS |
|---|---|---|---|---|---|---|---|
| 1.000 phiên | 3,4 ms | 5,9 ms | 12,1 ms | 170 / 386 / 815 | 2.145 | 0 | 486 MB |
| 1.000, trong đó 300 dồn trong 30 m (Nhà hát) | 5,6 ms | 8,7 ms | 13,5 ms | 179 / 914 / 1.100 | 3.965 | 0 | 498 MB |
| 2.000 phiên | 10,0 ms | 15,8 ms | 23,6 ms | 323 / 692 / 1.058 | 3.915 | 0 | 548 MB |

Cả 3 đều ở L0 (không cần giảm tải). Byte/s chưa gồm ~68 B overhead WS+TLS+TCP mỗi tin (× 10/s ≈ + 0,7 KB/s): điểm nóng
≈ 4,6 KB/s/khách < 12 KB/s. RSS phần lớn là PGlite (WASM) + `mapdata.js`. Chưa gồm socket thật / TLS — S4 đo bằng bot
qua mạng. (Trước khi tối ưu AOI — sort toàn bộ ứng viên mỗi snapshot — điểm nóng là 16 ms p50.)

### 2.9 Test

- `npm test`: `core_move` (11: trung thực / gian lận / mặt nền / điểm), `core_aoi` (6: trần, ưu tiên, rời/vào lại,
  tầng xa, mức suy giảm, "gương" client qua 2.000 snapshot ngẫu nhiên), `core_auth` (5), `core_session` (7: WS thật end
  to end). Toàn bộ `npm test`: 68 xanh + 1 bỏ qua (pg_boot cần Docker).
- `node test/core_pg.mjs`: chạy `core_auth` + `core_session` trên Docker Postgres 17 (project `hpmp-core`, cổng 55433, tự
  dọn) — 12/12 xanh.
- `boot.test.js` (nền móng) sửa tối thiểu: `/v1/auth/*`, `/v1/join` nay trả 4xx thay vì 501; HELLO vé sai → AUTH_FAILED.

### 2.10 Ghi chú cho S3 / S4 / S5 / tích hợp

- `sessions.list()` cho bản đồ admin: `{netId, accountId, displayName, x, z, mode, away, state, connectedS, ip, tier,
  corrections, points}`; `sessions.kick(accountId, reason)`, `sendSystem`, `broadcastSystem`, `broadcastChat(text)`
  (CHAT kênh SYSTEM từ netId 0), `flush()`; `sim.stats()`, `sim.forceDegrade(level | -1)`; `queue.stats()`.
- Bot (S4): STATE phải mang `clientMs = performance.now() & 0xffff` thật và `corrEpoch` theo CORRECT cuối; lên xe dùng
  chung bằng ACTION MOUNT (`target` = vehicleRef ≠ 0); xe máy cá nhân là `vehicleRef 0`. Cần mã mời (hoặc
  `INVITE_REQUIRED=false` khi thử tải) — `createInviteBatch` tạo nhanh. Bot chạy cùng máy (loopback) được miễn giới hạn
  theo IP.
- Metric mới (tiền tố `hp_`): `ccu`, `sessions_limbo`, `queue_length`, `queue_reserved`, `snapshot_bytes`,
  `snapshot_ms`, `snapshot_records`, `snapshots_{sent,dropped,keyframe}_total`, `names_sent_total`,
  `aoi_{capped,deferred}_total`, `degrade_level`, `degrade_changes_total`, `violations_total{reason}`,
  `corrections_total{reason}`, `kicks_total{reason}`, `rate_dropped_total`, `chat_delivered_total`, `hello_total{r}`,
  `auth_total{r}`, `join_total{r}`, `persist_flush_ms`, `persist_rows_total`, `session_{join,end}_total`.

## 3. An toàn chat, quản trị, cảnh báo (S3, 15/10/2026)

"Chat gõ tự do, kiểm soát chặt" (SPEC §3.3) + trang quản trị chỉ mở trên máy chủ + cảnh báo Telegram.

### 3.1 File

| File | Vai trò |
|---|---|
| `js/shared/textfilter.js` | bộ lọc tiếng Việt (client + server + bot dùng chung), bản nhúng danh sách mặc định |
| `server/data/filter/*.txt` + `README.txt` | danh sách từ chủ dự án sửa được: profanity, mild, sexual, hate, scam, probe, selfharm, allow, ambiguous, reserved |
| `server/src/chat/index.js` | dịch vụ `chat` (giới hạn tần suất, chống lặp, lọc, khoá chat, báo cáo, chặn, nhật ký, dọn 30 ngày) |
| `server/src/chat/lists.js`, `util.js` | đọc danh sách từ đĩa; token bucket, Levenshtein, vị trí phiên, biến môi trường S3 |
| `server/src/alerts.js` | dịch vụ `alerts` (Telegram, giới hạn tần suất, gộp) + nối bus |
| `server/src/admin/{index,security,invites,live,netprobe}.js` | cổng quản trị: lớp an ninh, API, mã mời, số liệu trực tiếp, đo mạng |
| `server/admin/{index.html,admin.css,admin.js}` | trang quản trị tiếng Việt (tĩnh, CSP chặt, không thư viện ngoài) |
| `server/src/api/moderation.js` | API cho người chơi: `/v1/chat/rules`, `/v1/chat/filter`, `/v1/moderation/{me,blocks}` |
| `server/src/db/migrations/020–023` | chat_log, reports + sanctions, social_blocks, filter_audit |
| `server/scripts/filter_sync.mjs` | nhúng `server/data/filter/*.txt` vào `textfilter.js` (`--check` để kiểm) |
| `server/scripts/admin_smoke.mjs` | smoke trang quản trị trong 1 Chrome headless (DevTools pipe), chạy dưới khoá GPU |
| `server/test/safety_*.test.js`, `fixtures/chat_{ok,bad}.txt`, `safety_pg_run.mjs` | test (PGlite và Postgres 17) |

### 3.2 Bộ lọc tiếng Việt (`js/shared/textfilter.js`, `FILTER_VERSION = 1`)

API giữ nguyên hợp đồng: `filterChat(text) → {ok, text, action, reasons}` (đúng 4 khoá — test nền móng kiểm),
`checkNickname`, `normalize`, `setLists`. Thêm: `analyzeChat(text, opts) → … + {flag, support, hits}`, `getLists()`,
`listsVersion()` (hash danh sách đang dùng — client so với `GET /v1/chat/filter`).

Các bước (mọi bước tất định, không cấp phát lớn):
1. **Hiển thị**: NFC; xoá zero-width / bidi / BOM / soft hyphen / ký tự lấp Hangul / tag; control → dấu cách; gộp
   khoảng trắng; ≥ 4 ký tự giống nhau → 3 (`aaaaaa→aaa`, `!!!!!!→!!!`); ≥ 8 chữ cái mà ≥ 70 % viết hoa → viết thường.
   `≤ 140` code point tính SAU chuẩn hoá (trước khi gộp ký tự lặp).
2. **Tách từ**: mỗi code point gập NFKC (chữ toàn khổ / chữ toán học → ASCII), viết thường, chữ Kirin / Hy Lạp giống
   Latin → Latin (`сặс`, `dм`). Trong một từ: dấu chen bị bỏ (`đ.m`, `d-i-t`, `c.ặ.c`), số / ký hiệu thay chữ (`l0n`,
   `đ!t`, `c@c`, `s3x`), `*` = chữ bị giấu (`l*n`, `c*c`, `đ*o` thử mọi nguyên âm). Chuỗi chữ cái rời được nối
   (`đ m`, `c ặ c`, `d i t m e`). Ký tự vô hình NẰM GIỮA chữ = dấu hiệu lách. Mỗi từ giữ: `base` (bỏ dấu, chính tả
   chuẩn hoá `j→i y→i k→c (trước nguyên âm) z→d ph→f`), dấu chữ (ă â ê ô ơ ư đ), dấu thanh, cờ `evasive`.
3. **Khớp mẫu** (chỉ mục theo từ đầu, mỗi tin ≈ 40 µs):
   - mẫu **không dấu** (`dm`, `vcl`, `sex`) → bắt mọi kiểu dấu; chữ lặp bỏ qua (`đmmmm`, `điiiit`) nhưng chữ đôi
     của mẫu cần ≥ 2 (`cc` không bắt `c`).
   - mẫu **có dấu** (`cặc`) → tin gõ dấu khác hẳn (`các`) không bao giờ khớp; tin gõ dấu đúng thì khớp. Từ **thiếu
     dấu** (`cac`) mà bản không dấu là từ vô hại (`ambiguous.txt`: các, buổi, lớn/lợn/lon, đi, cho, …) chỉ khớp khi: nằm
     trong cụm ≥ 2 từ (`ăn cac`, `con cac`), hoặc bị viết lách (`c4c`, `c a c`, `kặc`), hoặc cả câu gõ có dấu (≥ 50 %
     số từ) mà riêng từ này bỏ dấu và bản không dấu không phải từ thật (`mày ăn cac à`). Từ cực phổ biến (`đi!`, `cho!`,
     `mới!`, `mặn!`, `anh!`) không dấu chỉ bị bắt trong cụm ≥ 3 từ (`do cho` = "đồ cho" không bị bắt).
   - `=ngu` = đúng chữ không dấu thanh (không bắt "ngủ"); `a/b` lựa chọn; `_` một từ bất kỳ; `~` 0–2 từ;
     `*ditme` = bắt cả khi dính trong từ dài không dấu thanh (`ditmemay`, `đitme`); `| mask|block|flag|blockflag`.
   - `allow.txt`: một lượt bắt nằm GỌN trong cụm vô hại thì huỷ (`quả óc chó`, `cái lon bia`, `hẹn gặp lại`,
     `đi khách sạn`, `dâm bụt`, `đổ rác`, `tết bím`…). Cụm có dấu không cứu được bản tục (`cái lồn` ≠ `cái lon`).
4. **Bộ dò bằng mã** (luôn CHẶN): link / tên miền (`abc.com`, `abc . vn`, `abc chấm com`, `(.)`, `[.]`, `dot`,
   `c o m` cách quãng, `http`, `www`, `bit.ly`, `t.me/`, e-mail); số điện thoại / số tài khoản (≥ 9 chữ số liền sau khi
   bỏ dấu cách / chấm / gạch, chữ số viết bằng chữ `không chín một…`, `o`→0 và `i/l`→1 trong cụm số, ≥ 3 chữ số khác
   nhau, bỏ qua tiền kiểu `125.000.000`, không nối qua `/` `:` nên ngày giờ an toàn); nick mạng xã hội (`@ten`, tên nền
   tảng + mã có số / dấu `_.` / động từ liên hệ `add kb ib inbox nhắn follow xin gửi…`, hoặc `zalo:`).
5. **Hành động**: block > mask > flag > pass. `hate`, `scam` = chặn + đưa hàng chờ; `probe` (dò tuổi / nhà / trường /
   ảnh / gặp ngoài) = gửi + hàng chờ; `selfharm` = gửi + hàng chờ + `support: true` (gateway gửi EVENT SUPPORT_LINE).
   Mask thay cả từ bằng `***` (3–8 sao) trên văn bản hiển thị.

**Tên nhân vật** (`checkNickname`): 3–16 code point; chỉ chữ Latin (có tiếng Việt), số, cách, `_ . -`; không mở/kết
bằng ký tự ngăn, không 2 ký tự ngăn liền; ≥ 2 chữ cái; tên cấm `reserved.txt` (bỏ dấu, số thay chữ `4dm1n`; từ ≥ 5 chữ
cái bị cấm cả khi nằm trong tên, từ ngắn `gm/mod/dev/bot` khi đứng riêng hoặc đứng đầu kèm ngăn/số); thương hiệu
(`js/brands.js`: `isBrand` + `brandWatchHit`); ≥ 7 chữ số → `contact`; tục (mỗi từ coi như cố ý, và cả tên viết liền).
Lý do mới `contact` (bổ sung cho `profanity`).

**Corpus** (`server/test/fixtures/`): `chat_ok.txt` **532** câu thường (có dấu, không dấu, teencode vô hại, địa danh
Hải Phòng, món ăn, nói chuyện trong game, ~120 câu cố tình trùng chữ tục khi bỏ dấu), `chat_bad.txt` **338** câu
(tục có / không dấu, bỏ dấu riêng chữ tục, teencode, leet, chèn dấu, cách quãng, chữ lặp, zero-width, chữ Kirin, chữ
toàn khổ, tiếng Anh, chửi nhẹ, tình dục, miệt thị, đe doạ, link, SĐT, nick MXH, lừa đảo / cờ bạc, dò thông tin, tự hại),
mỗi dòng ghi mong đợi `block | mask | flag`. Kết quả 15/10/2026: **532/532 câu thường qua (100 %)**, **333/338 câu xấu
bị bắt đúng mức (recall 98,5 %)**, precision 100 % (block 259/261, mask 35/35, flag 39/42). Còn lọt (cố ý đánh đổi):

| Câu | Vì sao để lọt |
|---|---|
| `dau buoi` (block) | không dấu trùng hệt "đầu buổi" (đầu buổi chiều) — cụm vô hại phổ biến hơn |
| `cho xem hàng` (block) | trùng "cho xem hàng" khi mua bán trong game; `show hàng`, `lộ hàng` vẫn bị chặn |
| `ở quận nào` (flag) | hỏi đường trong game ("nhà hát ở quận nào") — chỉ đánh dấu khi có đại từ (`bạn ở quận nào`) |
| `hẹn gặp nhé` (flag) | hẹn gặp nhau TRONG game là bình thường; `hẹn gặp ngoài`, `gặp ngoài đời` vẫn bị đánh dấu |
| `gui anh di` (flag) | không dấu: "gửi ảnh đi" hay "gửi anh đi" — `anh` quá phổ biến; có dấu `gửi ảnh` vẫn bị đánh dấu |

Tốc độ (Node 24, máy chủ dự án): trung bình **37 µs**, p50 33 µs, p99 **142 µs**, tối đa 1,2 ms (GC) trên 17.400 lượt
(test đòi p99 < 1 ms). Danh sách cần **người Việt bản ngữ** duyệt định kỳ (đúng ARCH §13.1); sửa xong chạy `npm test`
(corpus) và `node scripts/filter_sync.mjs` (bản nhúng cho trình duyệt; test báo đỏ nếu lệch).

Giới hạn đã biết: từ tục viết liền CÓ dấu thanh (`địtmẹ`) chỉ bắt khi có trong danh sách dạng liền; ngôn ngữ khác
(Trung, Thái…) không lọc; ngữ nghĩa (mỉa mai, chửi không dùng từ tục) không bắt — người chơi báo cáo + chủ dự án xử lý.
Tên nền tảng mạng xã hội nằm trong mã dò nick (chỉ để chặn, không hiển thị) — ngoại lệ có chủ đích của quy tắc
"không tên thương hiệu".

### 3.3 Dịch vụ `chat` (`server/src/chat/index.js`)

| Quy tắc | Giá trị |
|---|---|
| Kênh | chỉ SAY từ client (SYSTEM / PARTY → `CHAT_CODE.CHANNEL`); bán kính 40 m do gateway chọn người nhận |
| Tần suất | 1 tin / 2 s, burst 3 (theo tài khoản); `playSeconds < 600` → slow mode 1 tin / 5 s, burst 1; trả `retryAfterMs` |
| Lặp | trong 30 s: trùng sau chuẩn hoá (bỏ dấu, viết thường, chỉ chữ/số) hoặc Levenshtein ≤ 2; câu < 6 ký tự chỉ so trùng hẳn |
| Bị chặn | tin không gửi, vẫn ghi `chat_log` (action block) cho chủ dự án; mỗi lần chặn = 1 điểm (tình dục / miệt thị / lừa đảo = 2); ≥ 5 điểm trong 10 phút → khoá tự động |
| Thang khoá tự động | theo số lần khoá chat / khoá ẩn trong 30 ngày: 10 phút → 1 giờ → 24 giờ → **khoá ẩn 7 ngày** (tái phạm) |
| Báo cáo | REPORT 1 / 10 s / người báo; cùng người báo cùng đối tượng trong 10 phút → DUPLICATE; ≥ 3 người khác nhau báo trong 10 phút (không tính báo cáo đã bỏ qua) → khoá tự động theo thang |
| Ngữ cảnh báo cáo | ≤ 20 dòng do MÁY CHỦ lấy (không nhận từ client): quanh dòng `chatRef` (hoặc lúc báo), ±15 phút, chỉ dòng của người bị báo, người báo, hệ thống và người trong 60 m; dòng bị báo có `mark`; lưu bản sao trong `reports.context` (dọn chat_log không làm mất) |
| Đánh dấu của bộ lọc | dòng `flag` / `blockflag` → `reports` nguồn `filter` (≤ 1 / người / 10 phút, tự hại luôn ghi) |
| Khoá ẩn | `handle` trả `ok:true, shadow:true` → gateway chỉ gửi lại cho người gửi; người bị khoá ẩn không bao giờ được báo |
| Cấm | `isBanned()`; cấm vĩnh viễn còn đặt `accounts.status='banned'` (gỡ → `active`) |
| Chặn / tắt tiếng | `social_blocks`: `block` hai chiều, `mute` một chiều; `blocks(id)` = tập người không trao đổi chat với `id` (nạp khi `player:join`, bỏ khi `player:leave`) |
| Nhật ký | vòng nhớ 2.000 dòng + ghi lô vào `chat_log` mỗi 1 s; giữ 30 ngày (`CHAT_LOG_DAYS`), xoá mỗi 6 giờ |
| msgRef | u32 tăng dần, nối tiếp sau khởi động lại (đọc `chat_log` mới nhất) |

Kết quả `handle()` (thêm vào hợp đồng, không phá): `ref` (msgRef cho S2C CHAT), `flagged`, `support`, `retryAfterMs`.
Phương thức thêm: `isBanned, sanctionOf, loadAccount, forget, setBlock(acc, target, on, 'block'|'mute'), listBlocks,
sanction({accountId, kind, ms, reason, source, reportId, actor}), revokeSanction(id), autoSanction, context, recent,
systemLine, reloadLists, saveList, purge, flush, stats`.

**Việc S2 (gateway) cần nối** — danh sách kiểm:
1. C2S CHAT → `r = await chat.handle(session, m.channel, m.text)`; `!r.ok` → EVENT `CHAT_REJECTED [r.code, r.retryAfterMs]`;
   `r.ok` → S2C CHAT `{from: session.netId, channel: SAY, msgRef: r.ref, text: r.deliverText}` tới: chỉ người gửi nếu
   `r.shadow`, ngược lại người gửi + mọi phiên trong 40 m mà `chat.blocks(người_nhận.accountId)` KHÔNG chứa
   `session.accountId`. `r.support` → EVENT `SUPPORT_LINE` cho người gửi. (Tuỳ chọn) bus `chat:message`.
2. C2S REPORT → đổi `targetNetId` ra `accountId` (không thấy → `null`) → `chat.report(session, accountId, m.reason, m.chatRef)` → EVENT `REPORT_RESULT [code]`.
3. ACTION `BLOCK_PLAYER` / `UNBLOCK_PLAYER` (target = netId; đề xuất `arg = 1` = chỉ tắt tiếng) → `chat.setBlock(…)`.
4. bus `player:join` / `player:leave` với `{session}`; phiên có `accountId, netId, displayName, playSeconds` và vị trí
   `x/z` (hoặc `pos.{x,z}`) — trang quản trị vẽ bản đồ từ đó (hoặc cung cấp dịch vụ `sessions` có `list()`).
5. bus `sanction {accountId, kind, until, seconds, revoked?}`: `kick` → SYSTEM KICK(ADMIN) + đóng `4009`; `ban` →
   SYSTEM BANNED(seconds, 0xFFFFFFFF = vĩnh viễn) + đóng `4003`; `mute` → EVENT `SANCTION [1, seconds]`; `warn` →
   EVENT `SANCTION [4, 0]`; **`shadow` → không gửi gì**. Mã `SANCTION` đề xuất: 1 mute, 2 ban, 3 kick, 4 warn.
6. HELLO / `/v1/join`: từ chối khi `chat.isBanned(accountId)` hoặc `accounts.status = 'banned'`.
7. bus `admin:broadcast {text, ref}` → S2C CHAT `{from: 0, channel: SYSTEM, msgRef: ref, text}` cho mọi người;
   `admin:restart {seconds, text}` → SYSTEM `RESTART_IN seconds` cho mọi người.
8. `POST /v1/auth/guest`: biệt danh qua `chat.nicknameCheck()`; mã mời băm bằng `app.get('invites').hash(code)` (§3.6).

### 3.4 Bảng (migration 020–023)

`chat_log` (ref, at, account_id → accounts ON DELETE CASCADE, net_id, name, channel, text đã gửi, raw = câu gốc khi bị
che, action pass|mask|flag|block|system, reasons text[], flagged, shadow, x, z); `reports` (source player|filter|admin,
reporter / target, reason = `REPORT_REASON` hoặc 0, detail, chat_ref, **context jsonb**, status open|actioned|dismissed,
resolved_*); `sanctions` (kind mute|shadow|ban|kick|warn, starts_at, until NULL = vĩnh viễn, reason, source
admin|auto_report|auto_filter|system, report_id, created_by, revoked_*); `social_blocks` (account_id, target_id, kind
mute|block); `filter_audit` (mỗi lần nạp danh sách: phiên bản, số dòng + sha256 từng tệp, dòng thêm/bớt). Mọi truy vấn
tham số hoá; chạy trên PGlite và Postgres 17.

### 3.5 Cảnh báo (`server/src/alerts.js`)

`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` trong `server/.env` → gửi `sendMessage` (timeout 5 s); thiếu → chỉ ghi log.
Mỗi loại ≤ 1 tin / 60 s (`degrade` 5 phút; `selfharm`, `crash`, `backup`, `start`, `stop` không chờ), tổng ≤ 30 tin / giờ;
tin bị gộp được đếm và báo kèm ở tin sau. Lỗi gửi không bao giờ ném và log không chứa token / chat id. Nguồn: báo cáo
mới, khoá tự động, cờ tự hại / miệt thị, `start` (hoặc **crash** nếu lần trước không dừng sạch — tệp
`<DATA_DIR>/run.marker`), `stop`, bus `degrade` khi lên ≥ L2, bus `alert {kind, text}` (ai cũng phát được), và
`POST /admin/api/alert {kind, text}` (script vận hành của S5 báo sao lưu lỗi). `alerts.recent()` → trang quản trị.

### 3.6 Trang quản trị (`http://127.0.0.1:9101/admin`)

**Lớp an ninh** (mọi đường `/admin*`, trước mọi route — `server/src/admin/security.js`):
1. IP nguồn (áp cho CẢ cổng admin, kể cả `/metrics`, `/healthz`): mặc định chỉ `127.0.0.0/8`, `::1` (cả dạng `::ffff:127.0.0.1`). `ADMIN_ALLOW_IPS` (CIDR, dấu phẩy) thêm
   địa chỉ — **trong Docker, lưu lượng từ cổng publish 127.0.0.1 của máy đến container từ gateway của mạng compose**
   (S5 cố định subnet rồi điền gateway `/32`; KHÔNG điền mạng `edge` của cloudflared). Sai → 403 + log cảnh báo.
2. Header `Host` phải là `127.0.0.1` / `localhost` / `[::1]` (bất kỳ cổng) hoặc `ADMIN_ALLOW_HOSTS` → chặn DNS
   rebinding và mọi yêu cầu qua tên miền tunnel.
3. `Origin` (nếu có) phải đúng `http://<host>` (cùng gốc); `Origin: null` bị từ chối; preflight CORS luôn 403.
4. Ghi (POST/PUT) chỉ nhận `content-type: application/json` (chặn form chéo trang).
5. Xác thực: `Authorization: Bearer <ADMIN_TOKEN>` (script, so sánh thời gian hằng) **hoặc** phiên đăng nhập: `POST
   /admin/api/login {token}` → cookie `hp_admin` (HttpOnly, SameSite=Strict, Path=/admin, 12 giờ, hết hạn sau 2 giờ
   không dùng, tối đa 20 phiên) + `csrf` trả trong JSON; mọi yêu cầu ghi bằng cookie phải gửi `x-csrf-token`.
   Đăng nhập sai: 5 lần / 15 phút / IP → khoá 15 phút; 20 lần / giờ toàn cục → khoá mọi IP 15 phút. Ghi `admin_audit`.
6. Trả về: CSP `default-src 'self'` (không inline script, không nguồn ngoài, `frame-ancestors 'none'`), `X-Frame-Options
   DENY`, `nosniff`, `no-referrer`, `no-store`. Trang không chứa bí mật; chữ của người chơi chỉ chèn bằng `textContent`
   (smoke kiểm `<img onerror>` trong chat hiện thành chữ).

**API** (đều cần xác thực, trừ trang tĩnh / login / session): `GET /admin` · `/admin/static/{admin.js,admin.css}` ·
`/admin/mapdata.js` (bản đọc-chỉ của `js/mapdata.js`, trang import `ROADS_DT`) · `POST /admin/api/login|logout` ·
`GET /admin/api/session|status|meta` · `GET /admin/api/live?since=<seq>` (số liệu + người chơi + dòng chat mới + số báo
cáo đang chờ; trang gọi mỗi 1,5 s) · `GET /admin/api/chat?account=&q=&flagged=1&before=&limit=` · `GET
/admin/api/reports?status=open|actioned|dismissed|all` · `POST /admin/api/reports/:id/action {action, days?, note?}`
(`mute10m|mute1h|mute24h|mute_forever|shadow|kick|ban|warn|dismiss`; một quyết định đóng mọi báo cáo đang chờ về cùng
người) · `GET /admin/api/players?q=` · `GET /admin/api/players/:id` · `POST /admin/api/players/:id/sanction` · `POST
/admin/api/sanctions/:id/revoke` · `GET|POST /admin/api/invites {count ≤ 500, uses ≤ 1000, days, note}` · `POST
/admin/api/broadcast {text ≤ 200}` · `POST /admin/api/restart {seconds}` · `GET /admin/api/filter` · `POST
/admin/api/filter/reload` · `PUT /admin/api/filter/:list {text}` · `POST /admin/api/filter/test {text}` · `GET
/admin/api/audit` · `GET /admin/api/netprobe?days=14` · `GET /admin/api/alerts` · `POST /admin/api/alert {kind, text}`.
Mọi thao tác ghi → `admin_audit` (ai, việc, đối tượng, chi tiết, IP).

**Trang** (`server/admin/`): đăng nhập bằng mã trong `server/.env`; dải số liệu (người chơi, tick p50/p99, băng thông
gửi đi tổng và mỗi người, mức giảm tải, CPU, RAM, trễ vòng lặp, Telegram); tab Tổng quan (bản đồ 2D đường `ROADS_DT` +
vòng chơi 1.588 m + chấm người chơi, phóng to / kéo / bấm chấm mở người chơi; chat trực tiếp tô màu đánh dấu / chặn /
che / khoá ẩn / hệ thống), Báo cáo (ngữ cảnh 20 dòng + nút một chạm), Người chơi (tìm, chi tiết, lịch sử xử phạt có nút
Gỡ), Mã mời (tạo lô, hiện mã MỘT lần, sao chép), Thông báo (phát toàn server, báo khởi động lại, trạng thái Telegram),
Bộ lọc chat (thử câu, sửa / lưu từng danh sách, nạp lại, lịch sử), Mạng (netprobe theo nhà mạng), Nhật ký. Sáng / tối
theo hệ điều hành; chạy được ở bề ngang điện thoại.

**Sửa danh sách lọc**: `PUT /admin/api/filter/:list` kiểm cú pháp rồi ghi vào `<DATA_DIR>/filter/<list>.txt` (ghi tạm +
đổi tên) và nạp lại; khi nạp, mỗi danh sách lấy từ `<DATA_DIR>/filter/` nếu có, ngược lại từ `server/data/filter/`
(bản commit). Chạy dev (DATA_DIR mặc định `server/data`) thì hai chỗ là một → sửa thẳng tệp trong repo. Docker: DATA_DIR
là volume ghi được (S5). Thân yêu cầu ≤ 16 KB (giới hạn transport); tệp lớn nhất hiện ~2 KB.

**Mã mời** (`server/src/admin/invites.js`, dịch vụ `invites`): 10 ký tự bảng `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (không
I L O 0 1), hiện `XXXXX-XXXXX`; chuẩn hoá = NFKC, viết hoa, chỉ giữ A–Z 0–9; lưu **`sha256(chuẩn_hoá)`** vào
`invites.code_hash` (không lưu mã gốc). S2 so mã người chơi gõ bằng `app.get('invites').hash(code)`.

**Netprobe** (bảng của S5): trang đọc bảng đầu tiên có tên `netprobe%` (ưu tiên `netprobe_results`) với cột `carrier`,
`net|net_type|network`, `median_ms|median|rtt_median_ms|p50_ms`, `p95_ms|p95`, `jitter_ms|jitter`, `loss_pct|loss`,
`created_at|at`; gộp theo (nhà mạng, kiểu mạng): số lần, trung vị của trung vị, trung bình p95 / jitter / mất gói,
lần cuối, 14 ngày. Không có bảng / cột → "chưa có dữ liệu".

### 3.7 API cho người chơi (`server/src/api/moderation.js`, cổng game)

`GET /v1/chat/rules` (giới hạn chat, phiên bản bộ lọc) và `GET /v1/chat/filter` (danh sách đang dùng, cache 5 phút —
client gọi `setLists()` để xem trước giống server) công khai, giới hạn theo IP. `GET /v1/moderation/me` (`{mute, ban,
shadow: false}` — khoá ẩn không bao giờ lộ), `GET|POST /v1/moderation/blocks {targetAccountId, kind, on}` cần access JWT:
dùng `app.get('auth').verifyAccess(token) → {accountId}` nếu S2 cung cấp, ngược lại tự kiểm EdDSA bằng khoá công khai
suy từ `JWT_PRIVATE_KEY`, `sub` = mã tài khoản.

### 3.8 Kiểm thử và số đo (15/10/2026)

- `npm test` (Windows, PGlite): **72 test, 71 xanh, 1 bỏ qua** (pg_boot cần Docker) — gồm 32 test S3:
  `safety_filter` (corpus, tốc độ, API, hiển thị, bộ dò, dấu, tên, danh sách), `safety_chat` (8), `safety_alerts` (4),
  `safety_admin` (12).
- `node test/safety_pg_run.mjs` (Docker Postgres 17, project `hpmp-safety`, cổng 55434, tự dọn): **20/20 xanh**.
- `node tools/qa/gpulock.mjs run -- node server/scripts/admin_smoke.mjs --out <thư mục>` (1 Chrome headless,
  `--disable-gpu`, DevTools pipe, cổng 9120/9121, 30 người chơi + chat + báo cáo mẫu): đăng nhập sai → báo lỗi, đúng →
  vào; 12 ảnh mọi tab + màn hình 390 px (không cuộn ngang); 0 lỗi JS / console / CSP; chèn thẻ HTML trong chat hiện thành chữ.

### 3.9 Còn mở

- S2 nối gateway theo danh sách §3.3 (chưa có gateway thật nên mới kiểm bằng phiên giả trên bus).
- Docker (S5): đặt `ADMIN_ALLOW_IPS` = gateway mạng compose; DATA_DIR ghi được để sửa danh sách lọc; copy
  `server/admin/`, `server/data/filter/`, `js/mapdata.js` vào image.
- Mã `EVENT.SANCTION` (1 mute, 2 ban, 3 kick, 4 warn) mới là đề xuất — nên thêm hằng vào `protocol.js` (nền móng).
- Danh sách từ cần người Việt bản ngữ duyệt lại sau buổi chơi thử đầu tiên (xem câu bị đánh dấu trên trang quản trị).

**Sau tích hợp (15/10/2026)**: 3 mục đầu đã xong — gateway nối đủ 8 mục của §3.3 (kiểm bằng `server/test/integ.test.js`
qua socket thật), Docker đặt `ADMIN_ALLOW_IPS` = gateway mạng `hostlink` cố định + `DATA_DIR` là volume ghi được, và
`SANCTION_KIND` đã vào `js/shared/protocol.js`. Bảng `netprobe_results` nay luôn có (migration 030) nên trang đọc qua dịch
vụ `netprobe` của S5. Mục cuối (duyệt danh sách từ) còn mở.

## 4. Bot & load test (S4, 14/10/2026)

### 4.1 Cấu trúc `server/bots/`

| File | Vai trò |
|---|---|
| `run.mjs` | CLI + `runScenario(opts)`: chia bot cho K tiến trình con (`--proc fork`, mặc định) hoặc worker thread (`--proc thread`), dòng thời gian sự kiện, đọc `/metrics` + `/healthz` mỗi 2 s, CPU cả máy, gộp kết quả → `report.json`, `report.md`, `timeseries.json` |
| `worker.mjs` | một event loop chạy ~200 bot; nhịp 20 ms; gửi về tiến trình cha mỗi giây: bot sống, delta bộ đếm, CPU (ms), RSS, ELU; cuối: histogram + bản ghi từng bot |
| `scenarios.mjs` | smoke, ramp, hotspot, stress, reconnect, abuse, netem-lite (bảng 4.3) |
| `lib/bot.mjs` | MỘT người chơi: **chỉ dùng `js/shared/codec.js`** để mã hoá/giải mã; auth → join → HELLO → WELCOME → READY → STATE 15 Hz (đứng 2 Hz) + PING (2 Hz 10 s đầu rồi 1 Hz, `ClockSync`) + CHAT; xử lý CORRECT (nhận vị trí + corrEpoch), SNAPSHOT (bảng slot, kiểm trần 96, keyframe, slot lạ), NAMES, SYSTEM (BACKOFF/QUEUE/NOT_IMPLEMENTED), EVENT CHAT_REJECTED; resume (HELLO RESUME + resumeToken), backoff 1-2-4-8 s + 0–1 s |
| `lib/roadgraph.mjs` | đồ thị đường thật từ `ROADS_DT` (bỏ cầu nâng, bỏ đoạn chạm nước — lấy mẫu `isWater` 4 m, bỏ ngoài PLAY_RADIUS−20 m); **nối ngã ba chữ T** (đầu way nằm giữa đoạn way khác, ≤ 8 m) → thành phần lớn nhất ≈ 3.000 nút / ~111 km (không nối chỉ ~47 km); `Walker` đi theo cạnh, A* tới đích; y = `groundHeight` |
| `lib/abuse.mjs` | 14 lớp tấn công (bảng 4.4) + đo độ trễ phát hiện |
| `lib/netem.mjs` | trễ 80 ± 30 ms mỗi chiều, FIFO như TCP; "mất gói" 2 % = giữ thêm 200–500 ms (dồn cục) |
| `lib/metrics.mjs`, `lib/report.mjs`, `lib/stats.mjs` | đọc Prometheus, tiêu chí đạt SPEC §3.4, histogram gộp được (log 2 % / tuyến tính 1 B) |
| `lib/phrases.mjs` | câu chat sạch (phải luôn lọt), câu lạm dụng/lách lọc (phải bị chặn/che) — dữ liệu test, không số/handle thật |
| `fakeserver.mjs` | **máy chủ GIẢ có kịch bản** để phát triển harness khi S2/S3 chưa xong: đủ giao thức (auth/join/vé 1 lần/resume/AOI 96 + ≤ 32 ENTER/snapshot/NAMES/CHAT 40 m + lọc thô/CORRECT/xô token/1008/1009/4001/4004/4007) + `/metrics`. KHÔNG phải máy chủ game. |

Bot trung thực: chạy 0,9 × v_max của chế độ; xe máy tăng tốc theo `ACCEL.moto`; đổi sang chế độ chậm hơn thì giảm tốc trước rồi chờ 1,2 s (> cửa sổ kiểm 1 s) mới đổi → không tạo CORRECT giả.

### 4.2 Chạy

```
node server/bots/run.mjs --scenario smoke --url http://127.0.0.1:9100            # admin mặc định = cổng+1
node tools/qa/gpulock.mjs run -- node server/bots/run.mjs --scenario ramp --url http://127.0.0.1:9100 \
     --invite <MÃ-MỜI-NHIỀU-LƯỢT> --creds server/data/bot_creds.json --out <thư-mục>
```
Tuỳ chọn: `--n --dur --ramp --mode auto|full|ping --workers|--per-worker 200 --proc fork|thread --seed --origin
--netem-frac 0.3 --drop-at 60 --reconnect-max 30 --start-spread --drop-per-min --scrape-ms 2000 --strict` (`--strict`:
exit 1 khi có tiêu chí FAIL). `--mode auto` gọi thử `POST /v1/auth/guest {}`: 501/404 → **ping** (máy chủ nền móng),
còn lại → **full**. `--creds FILE` lưu refresh token theo số thứ tự bot → lần chạy sau dùng `/v1/auth/refresh` thay vì
tạo khách mới (refresh xoay vòng, file được ghi lại cuối lần chạy; để file trong `server/data/` — đã gitignore).
**Mọi lần > 300 bot hoặc > 60 s phải qua GPU lock** (run.mjs cảnh báo khi không thấy `HPWORLD_GPU_LOCK`).
Máy chủ giả: `node server/bots/fakeserver.mjs --port 9130 --admin-port 9131`. Test: `server/test/bots.test.js`.

### 4.3 Kịch bản (mặc định; ghi đè bằng `--n/--dur/--ramp`)

| Tên | N | Thời lượng | Hành vi | Tiêu chí tự chấm (SPEC §3.4) |
|---|---|---|---|---|
| smoke | 50 | 60 s | đường thật: đi 50 % / chạy 25 % / xe máy 25 %, nghỉ 15 %, chat sạch 15–45 s, rớt mạng 0,2/phút | 0 lỗi giải mã; CORRECT trung thực < 2/phút/bot; tick/lắp snapshot p99 < 25 ms; snapshot p95 < 1.100 B; RSS < 1,5 GB |
| ramp | 1.200 | 600 s | 0 → N trong `--ramp` 300 s rồi giữ | như smoke, đo trên pha giữ |
| hotspot | 300 | 300 s | đi xe máy theo A* tới `EXTRAS.square`, xuống xe, lang thang bán kính 50 m | bản ghi/snapshot ≤ 96; không client nào > 12 KB/s (đỉnh trung bình 5 s); tick p99 < 40 ms (đo từ giây 150) |
| stress | 2.000 | 300 s | 0 → N trong 120 s | thang suy giảm tăng từng bậc (`hp_degrade_level`); health OK cuối; có lượt xếp hàng |
| reconnect | 1.000 | 150 s | vào trong 30 s; giây 60 tất cả rớt (terminate, không close frame), nối lại U(0,5; 30) s bằng HELLO RESUME | 100 % resume đúng netId |
| abuse | 200 | 60 s | 20 % quan sát viên đứng yên ghi chat nhận được + 14 lớp tấn công (4.4) | mỗi lớp bị chặn/đóng trong 1 s (no_hello: 11 s); speed-hack ≥ 99 %; 0 dòng lách lọc lọt nguyên văn |
| netem-lite | 300 | 180 s | như smoke; 30 % bot có netem 80 ± 30 ms + 2 % dồn cục | CORRECT trung thực < 2/phút (cả nhóm netem, báo riêng); RTT tách nhóm |

### 4.4 Lớp tấn công (`lib/abuse.mjs`) — tín hiệu được tính là "phát hiện"

bad_opcode / truncated / text_frame (30 tin rác, 10 ms/tin → đóng 1008) · oversize (4 KB → 1009) · flood_ping /
flood_state / chat_spam (1.000 tin/s → đóng, SYSTEM KICK, CHAT_REJECTED; flood_ping còn tính "PONG < 10 % sau 1 s") ·
speed_hack (chế độ đi bộ, 9 m/s thẳng → CORRECT/kick) · teleport (nhảy 300 m → CORRECT/kick) · chat_bypass (30 câu
lách lọc, 1 câu/2,2 s → CHAT_REJECTED; quan sát viên trong 40 m đếm tin lọt nguyên văn / bị che) · forged_ticket (vé
ngẫu nhiên → AUTH_FAILED/4001) · replayed_ticket (chỉ chế độ full: dùng lại vé đã dùng trên socket thứ hai) ·
bad_proto (proto 99 → RELOAD/4004) · no_hello (im lặng → đóng 4007 sau 10 s). Độ trễ = byte tấn công đầu tiên → tín hiệu.

### 4.5 Số đo (14–15/10/2026, máy chủ dự án Ryzen AI 9 HX 370 24 luồng, Node 24.15, bot + máy chủ chung máy)

Máy chủ **nền móng** (uWS, PGlite RAM; chỉ PING/STATE ở mức giao thức — chưa có WELCOME/snapshot nên các tiêu chí
snapshot/AOI ghi n/a). Báo cáo đầy đủ trong scratchpad `mp/s4/foundation_*` (không commit).

| Lần chạy | Bot | Máy chủ | Bot-side |
|---|---|---|---|
| smoke 50 × 60 s | 50/50 vào; 0 lỗi giải mã; 9 lần rớt mạng ngẫu nhiên đều nối lại | CPU p50 2,3 % 1 lõi; RSS 320–608 MB (PGlite); tick rỗng 0,01 ms | RTT p50 0,98 / p99 3,6 ms |
| hotspot 300 × 300 s (GPU lock) | 300/300; 0 lỗi; 832 k STATE + 86 k PING + 1.283 CHAT đã giải mã phía máy chủ (14,6 MB vào) | CPU p50 5,4 % / max 33 % 1 lõi; RSS 333 MB | RTT p50 2,25 / p99 4,3 / max 26 ms; **4,9 % 1 lõi mỗi 100 bot**; 2 tiến trình, RSS tổng 209 MB |
| ramp 1.200 (60 s lên + 90 s giữ, GPU lock) | 1.200/1.200; 0 lỗi; 1,5 M STATE | CPU p50 14 % / max 61 % 1 lõi; RSS 334 MB | RTT p50 2,7 / p99 4,8 ms; **4,3 % 1 lõi mỗi 100 bot**; 6 tiến trình, RSS tổng 625 MB |

- **Chi phí bot (mức PING/STATE)**: ≈ 4–5 % của 1 lõi / 100 bot (STATE 15 Hz đi + 2 Hz đứng, PING 1 Hz, chat); RAM
  ≈ **105 MB nền mỗi tiến trình** (V8 + mapdata + terrain + đồ thị) + phần biên không đo được (< 2 MB/100 bot) →
  1.200 bot ≈ 6 tiến trình ≈ 0,6 GB, ~0,5 lõi. Khi có snapshot thật, giải mã thêm ~10 snapshot/s/bot (ước ×2–3 CPU) —
  ước 2.000 bot cần ~3 lõi + 1 GB: vẫn để lại ≥ 18 luồng cho máy chủ trên máy này.
- `hp_eventloop_delay_p99_ms` của máy chủ nền móng **≈ 16,5 ms kể cả khi nhàn rỗi** (Windows: độ phân giải timer
  ~15,6 ms của `monitorEventLoopDelay`), sát ngưỡng ARCH < 20 ms → nên đo event-loop trên Linux/Docker hoặc đổi tiêu chí
  thành "p99 − sàn nhàn rỗi".
- Máy chủ giả (`fakeserver.mjs`) với đủ giao thức: smoke/reconnect/hotspot/netem/abuse đều chạy hết đường mã của bot
  (WELCOME, keyframe/ENTER/LEAVE/UPDATE, NAMES, CORRECT, resume 100 %, 14 lớp tấn công). Số của máy chủ giả không
  phải số của máy chủ game.

### 4.6 Ghi chú cho tích hợp (S2/S3/integrator)

- **Mã mời & giới hạn tạo khách**: bot full cần `--invite <mã nhiều lượt>` (hoặc `INVITE_REQUIRED=false` khi load
  test) và **miễn giới hạn tạo khách / kết nối theo IP cho 127.0.0.1** (ARCH: 30 khách/giờ/IPv4, 10 WS mới/phút/IPv4 —
  1.200 bot cùng loopback sẽ bị chặn). Dùng `--creds server/data/bot_creds.json` để lần sau chỉ refresh.
- Metric bot đọc: `hp_sim_tick_ms_p50/p99`, `hp_eventloop_delay_*`, `hp_process_cpu_percent`, `hp_process_rss_bytes`;
  **S2 cần xuất**: một histogram có `snap` trong tên và đuôi `_ms` (vd `hp_snapshot_assembly_ms`), gauge `hp_ccu`,
  gauge `hp_degrade_level` (0–4), tuỳ chọn gauge hàng đợi `hp_*queue*_len`. Tên khác → sửa regex trong `lib/metrics.mjs`.
- `/v1/join` trả `{wsUrl, ticket, spawnHint}` hoặc `{queue: {position, etaS}}` (bot cũng nhận `{position, etaS}` ở cấp
  ngoài). Bot dùng `--ws` của chính nó (mặc định `ws://<host>/play`), KHÔNG dùng `wsUrl` máy chủ trả (publicWsUrl là
  URL tunnel).
- Resume: bot gửi HELLO{flags RESUME, ticket rỗng, resumeToken} và coi là thành công khi WELCOME có **cùng netId**
  (SYSTEM RESUMED trước đó là tuỳ chọn). Sau resume bot gửi READY lại và chờ keyframe.
- Bot coi `EVENT CHAT_REJECTED` của bot trung thực là dương tính giả của bộ lọc (báo cáo đếm riêng).

**Sau tích hợp (15/10/2026)**: mọi điểm trên đã có trên máy chủ gộp (miễn giới hạn IP cho loopback/IP riêng, metric
`hp_snapshot_ms`, `hp_ccu`, `hp_degrade_level`, `hp_queue_length`). Sửa trong harness: `deviceId` = `<tag>-<idx 6 số>`
(máy chủ đòi 8–64 ký tự) và `--device-tag` để chạy abuse bằng tài khoản mới (tài khoản cũ có thể đang bị khoá chat từ lần
trước); `Walker` đi tới nút đường gần nhất **không băng qua nước** (`nearestDry`); `chat_bypass` đo bằng tin vọng lại người
gửi (câu bị che = đã vô hiệu, trùng nguyên văn = lọt); worker con chỉ thoát sau khi tin `final` IPC đã gửi xong (trước đây
thoát cứng sau 300 ms → mất kết quả cả một worker khi tải nặng). Kết quả đủ 7 kịch bản: §6.5.

## 5. S5 — Vận hành tự host, netprobe, sổ tay (15/10/2026)

Sổ tay cho chủ dự án (không thuật ngữ): `docs/multiplayer/VAN_HANH.md`. Mục này là ghi chú kỹ thuật.

### 5.1 Docker

- **Ảnh game** (`server/Dockerfile`, context = gốc repo): `node:24-trixie-slim@sha256:173f1258…` (glibc 2.41 → uWS
  v20.71.0 nạp được; bookworm thì lặng lẽ lùi về `ws`). `npm ci --omit=dev --ignore-scripts`. Chỉ chép theo whitelist
  `server/Dockerfile.dockerignore`: `server/{src,admin,data/filter,package*.json}`, `js/shared/`, `js/terrain.js`,
  `js/mapdata.js`, `js/brands.js`. Bước build `import('/app/server/src/main.js')` liên kết toàn bộ đồ thị import → **thiếu
  file là build đỏ**, không phải lỗi lúc khởi động; build cũng in `uWS: OK`. Test `ops_static.test.js` lần theo import từ
  `main.js` và báo đỏ nếu một file `js/` được import mà chưa whitelist: **S2/S3 import thêm `js/*.js` → thêm 1 dòng vào
  Dockerfile + .dockerignore.** Ảnh 150 MB.
- **Điểm vào trong container**: `server/ops/container-main.mjs` — như CLI của `main.js` nhưng `loadConfig({envFile:null})`
  và **không gọi `ensureEnvFile()`** (root FS chỉ đọc; bí mật đến từ `env_file: .env` của compose). `NODE_ENV=production`
  thiếu bí mật → từ chối chạy. HEALTHCHECK = `ops/healthcheck.mjs` (GET /healthz, 3 s).
- **Compose** (`server/docker-compose.yml`, project mặc định `hpworld`, cổng 9100/9101):

| dịch vụ | mạng | cổng host | giới hạn | ghi chú |
|---|---|---|---|---|
| game | hostlink, edge, backend | `127.0.0.1:${HPMP_GAME_PORT:-9100}`→9100, `127.0.0.1:${HPMP_ADMIN_PORT:-9101}`→9101 | 4 CPU, 2 GB, 512 pid, nofile 16k | TRUST_PROXY=cloudflare, ADMIN_DENY_CIDRS=edge+backend, TUNNEL_TOKEN bị xoá khỏi env |
| db | backend | — | 2 CPU, 1 GB, 256 pid | postgres:17 ghim digest, chạy user 999 (không cần cap), tmpfs /var/run/postgresql |
| tunnel (profile) | edge, cfout | — | 0,5 CPU, 256 MB | ảnh `server/ops/cloudflared/` = cloudflared 2026.7.2 ghim digest + `config.yml` chép vào |
| quicktunnel (profile) | edge, cfout | — | 0,5 CPU, 256 MB | `tunnel --url http://game:9100` |
| backup (profile) | backend | — | 0,5 CPU, 256 MB | pg_dump -Fc mỗi đêm 03:15 giờ VN, giữ 14 ngày; `BACKUP_ONCE=1` = một lần |

  Mọi dịch vụ dùng anchor `x-hardening`: `read_only`, `no-new-privileges`, `cap_drop: [ALL]`, `restart: unless-stopped`,
  log json-file 10m × 5. Không docker.sock / privileged / host network. **Bind mount duy nhất** `./data/backups` (dịch vụ
  backup). `edge` và `backend` là `internal: true` (không Internet); cloudflared ra Internet qua mạng riêng `cfout`.
  Kiểm bằng container node trên mạng `hpmp-ops_edge`: `game:9100/healthz` 200, `game:9101/healthz` và `/metrics` **403**,
  `db:5432` không phân giải được, `1.1.1.1` ENETUNREACH.
- **`configs: content:` của compose không dùng được với `read_only: true`** ("`file` is the sole supported option") → ingress
  cloudflared được chép vào một ảnh dẫn xuất nhỏ; script backup nằm inline trong `entrypoint sh -c` (anchor
  `x-backup-script`, `$$` thoát nội suy). Script backup có `trap … TERM` + `sleep & wait`; thiếu nó `docker stop` chờ hết
  8 s (đo: tắt cả bộ 15,8 s → sau khi sửa 6,6 s).
- **Ingress tunnel** (`server/ops/cloudflared/config.yml`): `^/(play|probe|healthz)$` và `^/v1/` → `http://game:9100`, còn
  lại `http_status:404`. Kiểm bằng `cloudflared tunnel ingress rule` trong ảnh: /admin, /admin/api/status, /metrics, /, /v1,
  /playx, /healthz/x → 404. Tunnel phải là loại **quản lý cục bộ** (tạo bằng CLI), chạy bằng `cloudflared tunnel token
  <tên>` → `TUNNEL_TOKEN`; tunnel tạo trên dashboard bỏ qua file ingress này.

### 5.2 Cổng admin không bao giờ tới được từ tunnel (`server/src/api/admin_edge_guard.js`)

Middleware `app.admin.use()` (cài trong `api/netprobe.js`) trả 403 khi: có header Cloudflare (`cf-connecting-ip`, `cf-ray`,
`cf-warp-tag-id`, `cf-ipcountry`, `cdn-loop: cloudflare`); hoặc IP socket nằm trong `ADMIN_DENY_CIDRS`; hoặc
`ADMIN_ALLOW_CIDRS` khác rỗng mà IP không nằm trong đó. CIDR sai → khởi động lỗi (không âm thầm tắt lớp bảo vệ). Nguồn
cấu hình: tham số > `app.config.adminDenyCidrs/adminAllowCidrs` (nếu integrator thêm) > `process.env`. Đây là lớp chồng
thêm lên ingress 404 + Bearer token + publish 127.0.0.1.

### 5.3 netprobe

- **WS `/probe`**: chỉ PONG cho PING, tin khác → 1008. Giới hạn: ≤ 256 socket toàn cục (503), ≤ 8 mỗi địa chỉ (429; nới vì
  CGNAT), ≤ 64 PING mỗi socket, PING cách nhau ≥ 80 ms (4006), socket tự đóng sau 60 s.
- **POST `/v1/netprobe`** `{carrier, netType, device?, samples, lost, medianMs, p95Ms, jitterMs, minMs, maxMs}`: kiểm miền
  giá trị và min ≤ median ≤ p95 ≤ max; 6 lần / 10 phút mỗi địa chỉ, 120 / phút toàn cục, body 2 KB. Bảng
  `netprobe_results` (migration `030_netprobe.sql`) **không lưu IP, user-agent hay tài khoản**; `via` = tunnel/local (từ
  header Cloudflare). Giữ 90 ngày (job dọn mỗi 6 giờ).
- Dịch vụ `netprobe` `{summary({days}), recent(limit), purge(days), stats()}`; admin `GET /admin/api/netprobe?days=14`
  (Bearer) → `{summary: [{carrier, netType, n, medianMs, p95Ms, jitterMs, lossPct, lastAt}], recent}` cho trang quản trị S3.
- **`netprobe.html`** (gốc repo, Pages): import `js/shared/codec.js`, `protocol.js`, `clock.js`. Địa chỉ máy chủ: `?s=` >
  `<meta name="hp-server">` > localStorage. **Chỉ nhận `wss://`** (`ws://` chỉ cho localhost; IP trần bị từ chối). 3 PING
  làm nóng + 30 PING cách 220 ms, timeout 2 s; trung vị/p95/dao động/min/max/% mất; chọn nhà mạng + loại mạng (`?c=`/`?n=`
  điền sẵn) → tự POST. `?auto=1` chạy ngay; `window.__probe` cho kiểm thử tự động.

### 5.4 Script vận hành (`server/ops/*.ps1`, PowerShell 5.1, UTF-8 BOM, không cần quyền admin)

`chung.ps1` (dùng chung) · `mo-may-chu` · `tat-may-chu` · `trang-thai` · `khoa-khan-cap` · `sao-luu` · `khoi-phuc` (mặc
định diễn tập trên container nháp `--network none`; `-KhoiPhucThat` tự sao lưu trước, DROP/CREATE, `pg_restore` qua stdin
bằng `cmd /c <` vì `docker cp` không ghi được vào tmpfs / root FS chỉ đọc) · `tao-ma-moi` · `cai-lich` (cung cấp, không
chạy) · `giu-may-thuc` (tiến trình nền `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED)`; bản thật chạm
`%TEMP%\hpworld_server_live.txt` mỗi 60 s).
**Chế độ thử** (`-TestMode` / `HPMP_TEST=1`): không ghi/xoá tệp đánh dấu, không mở trình duyệt, và **bắt buộc**
`HPMP_PROJECT/HPMP_GAME_PORT/HPMP_ADMIN_PORT` khác bản thật (hpworld/9100/9101), không thì dừng. Biến khác:
`HPMP_EDGE_SUBNET`, `HPMP_BACKEND_SUBNET`, `HPMP_IMAGE`, `HPMP_TUNNEL_IMAGE`.
Lưu ý PowerShell: biến không phân biệt hoa thường (`$S` ≡ `$s`); lệnh native ghi stderr → không dùng
`$ErrorActionPreference='Stop'`; `Get-CmdOutput` dùng `ProcessStartInfo` để đọc stdout+stderr UTF-8 sạch.

### 5.5 Số đo (máy chủ dự án, 14–15/10/2026, bộ thử `hpmp-ops`, cổng 9140/9141)

| Hạng mục | Kết quả |
|---|---|
| `docker compose up` (game + db) → /healthz | `transport: uws`, `db: ok`, migrations 001 + 030 áp dụng; mở lại (ảnh có sẵn) 9–11 s |
| Container game | `ReadonlyRootfs=true`, `CapDrop=[ALL]`, `no-new-privileges`, user `node`, 4 CPU / 2 GiB / 512 pid, 0 mount; db 1 mount (volume) |
| `tat-may-chu.ps1` (game + db + backup) | **6,6 s** (trước khi sửa trap backup: 15,8 s); sau đó không còn gì nghe trên 9140/9141 |
| `khoa-khan-cap.ps1` | 2,0–2,6 s; ngay sau đó địa chỉ tunnel trả 502 |
| Giữ máy thức | đang chạy: `CallNtPowerInformation(SystemExecutionState)` = 0x3 (`ES_SYSTEM_REQUIRED` bật); sau khi tắt: 0x0, không còn tiến trình. `powercfg /requests` cần quyền admin, phiên này không có |
| Sao lưu một lần | 23 KB, < 2 s; chép sang thư mục thứ hai OK |
| Diễn tập khôi phục | 3,9–4,0 s, 9 bảng, số dòng khớp |
| Khôi phục thật | 9 s; netprobe_results 2 → 1 dòng đúng bản sao lưu; game khoẻ lại |
| Quick tunnel (cloudflared trong container), PING `/probe` qua `wss://*.trycloudflare.com`, 3 × 30 tuần tự | **p50 54,6 ms**, p95 57,8, p99 61,1, max 61,1, dao động 1,4, mất 0/90 |
| 8 socket song song × 30 PING | p50 54,7, p95 58,0, max 64,1 ms, mất 0/240 |
| `/play` PING qua tunnel | p50 54,5 ms (10 mẫu) |
| Cùng PING qua 127.0.0.1:9140 (Docker Desktop) | p50 1,8 ms, p95 2,5 ms |
| Đường đi qua tunnel | `/healthz` 200, `POST /v1/netprobe` 200; `/admin`, `/admin/api/status`, `/metrics`, `/` → 404 |
| `netprobe.html` trong 1 Chrome headless (khoá GPU, `--disable-gpu`, origin Pages giả lập bằng chặn request) | 30/30, trung vị 53,9 ms, p95 56,4, POST 200, 0 lỗi JS |
| `npm audit --omit=dev` | 0 lỗ hổng |

RTT qua tunnel đo **từ chính máy chủ** (ra mép Cloudflare rồi vòng về nhà) — là cận dưới cho người chơi ở Việt Nam; số
thật theo nhà mạng sẽ đến từ `netprobe.html` trên điện thoại.

### 5.6 Còn mở / cho integrator

- `admin_edge_guard` đọc `process.env.ADMIN_DENY_CIDRS` vì `config.js` thuộc Foundation; integrator có thể đưa vào
  `config` (`adminDenyCidrs`) hoặc `main.js`.
- `boot.test.js` (Foundation): đã bỏ `/v1/netprobe` khỏi danh sách stub 501.
- `tao-ma-moi.ps1` gọi `POST /admin/api/invites {count, uses, days, note}` → chờ `{codes:[...]}` (hoặc `{invites:[{code}]}`)
  — đường của S3; khác tên thì sửa một dòng.
- Danh sách lọc chat `server/data/filter/` nằm **trong ảnh**: sửa xong phải `mo-may-chu.ps1` (build lại); container không
  đọc thư mục của máy.
- Named tunnel chưa kiểm thật (chưa có tên miền); ingress và lệnh đã kiểm bằng `cloudflared tunnel ingress validate/rule`.

**Đã xử lý khi tích hợp (15/10/2026)** — chi tiết §6:
- Lớp IP của S3 (mặc định chỉ 127.0.0.1) chặn cả chủ dự án trong Docker (yêu cầu tới cổng publish đi vào container từ
  gateway của mạng) → mạng `hostlink` có dải cố định (`HPMP_HOSTLINK_SUBNET`, mặc định `172.31.90.0/24`, gateway
  `HPMP_HOSTLINK_GATEWAY` `172.31.90.1`) và compose đặt `ADMIN_ALLOW_IPS=<gateway>/32`. `ADMIN_DENY_CIDRS` (edge + backend)
  vẫn chặn trước. Kiểm: từ máy `admin/api/status` 200 (có token) / 401 (không token); qua tunnel `/admin` 404.
- `DATA_DIR` từ tmpfs `/tmp/hpdata` → volume tên `gamedata` gắn `/data` (ảnh tạo `/data` của user `node`): bản sửa danh
  sách lọc trên trang quản trị và `run.marker` (cảnh báo "crash") còn sau khi tắt mở. Vẫn không bind mount thư mục máy.
- `GET /admin/api/netprobe` còn MỘT route (module admin, sau lớp an ninh của S3) đọc dịch vụ `netprobe`; trả cả `rows`
  (trang) lẫn `summary/recent` (dạng S5).
- `js/xsection.js` (được `js/shared/move.js` import) thêm vào Dockerfile + `.dockerignore`.
- `chung.ps1 Get-CmdOutput`: `ProcessStartInfo` không theo `Push-Location` → tạo `server/.env` lần đầu hỏng khi chạy
  script từ thư mục khác `server/`; nay đặt `WorkingDirectory` rõ.
- `tao-ma-moi.ps1` ↔ `POST /admin/api/invites` khớp (`{codes:[...]}`).

## 6. Tích hợp (integrator, 15/10/2026) — kiến trúc cuối, giao thức, số đo, việc còn mở

Nhánh tích hợp gộp `--no-ff` theo thứ tự S2 core → S3 safety → S5 ops → S4 bots (trên nền móng `9c80c1a`). Xung đột chỉ ở
tài liệu (`SERVER.md`, `PROGRESS.md`: giữ cả hai phía) và `server/test/boot.test.js` (S2 và S5 cùng bỏ stub 501: nay
không còn stub nào — `/v1/auth/*`, `/v1/join`, `/v1/netprobe` với thân rỗng đều 4xx).

### 6.1 Kiến trúc cuối

```
Internet ─► Cloudflare (TLS wss://, chặn DDoS lớn, ẩn IP nhà)
              │  tunnel (cloudflared TRONG container, mạng edge internal)
              ▼   ingress: chỉ /play /probe /healthz /v1/*  → còn lại 404
 ┌──────────── game (1 tiến trình Node 24, uWS; container read-only, non-root, 4 CPU / 2 GB) ─────────────┐
 │ cổng 9100: router HTTP (/v1/auth/guest|refresh|recover, /v1/join, /v1/netprobe, /v1/chat/*,           │
 │            /v1/moderation/*, /healthz) · WS /play (gateway) · WS /probe (netprobe)                     │
 │ vòng 20 Hz: sim → AOI (lưới 128 m, trần 96) → SnapshotBuilder → send (10 Hz/khách, 2 pha)              │
 │ STATE → validate (js/shared/move.js) · CHAT → chat (textfilter) → SAY 40 m · REPORT → reports          │
 │ bus: player:join/leave, chat:message, sanction, admin:broadcast/restart, degrade, alert                │
 │ cổng 9101 (admin): IP allow (gateway hostlink /32) + deny (edge, backend) + Host + Origin + token/cookie│
 └───────┬──────────────────────────────────────────────────────────────────────────────────────────────┘
         │ mạng backend (internal)                      cổng publish CHỈ 127.0.0.1:9100 / :9101 (chủ dự án)
         ▼
   db: Postgres 17 (volume pgdata) ◄── backup (profile, pg_dump đêm, ./data/backups — bind mount duy nhất)
   game: volume gamedata (/data: danh sách lọc chủ dự án sửa, run.marker)
```

Luồng người chơi: `POST /v1/auth/guest` (mã mời) → access JWT 15' + refresh xoay vòng → `POST /v1/join` → vé HMAC 60 s
(hoặc hàng chờ) → WS `/play` HELLO{vé} → WELCOME + WORLD → READY → KEYFRAME rồi snapshot 10 Hz; STATE 15 Hz đi / 2 Hz
đứng; PING mỗi giây; rớt mạng → HELLO{RESUME} trong 60 s giữ netId.

### 6.2 Mối nối đã làm khi tích hợp (hợp đồng được hoà giải)

| Chỗ nối | Cách làm |
|---|---|
| CHAT msgRef | gateway dùng `chat.handle().ref` (ref nhật ký chat của S3) làm `msgRef` S2C CHAT → `REPORT.chatRef` trỏ đúng dòng; bộ đếm riêng chỉ khi dịch vụ không có ref |
| Tự hại | `r.support` → `EVENT SUPPORT_LINE` cho người gửi (+ báo cáo nguồn `filter` của S3) |
| Chặn / tắt tiếng | ACTION BLOCK/UNBLOCK_PLAYER → `chat.setBlock(acc, target, on, arg = 1 ? 'mute' : 'block')` (bền, `social_blocks`) + tập trong RAM để có hiệu lực ngay |
| Xử phạt (bus `sanction`) | kick → SYSTEM KICK(ADMIN) + 4009 · ban → SYSTEM BANNED(giây) + 4003 · mute → `EVENT SANCTION [1, giây]` (gỡ → `[1, 0]`) · warn → `[4, 0]` · shadow → không gửi gì |
| Cấm có hạn | `/v1/join` → 403 `banned` và HELLO → SYSTEM BANNED khi `chat.isBanned()` (cấm vĩnh viễn vẫn qua `accounts.status`) |
| Phát thanh / khởi động lại | `admin:broadcast {text, ref}` → S2C CHAT kênh SYSTEM từ netId 0 (`sessions.broadcastChat(text, channel, ref)`); `admin:restart {seconds}` → SYSTEM RESTART_IN |
| Vị trí phiên | `Session` có getter `x / z / mode` (từ entity) → dòng chat có toạ độ, ngữ cảnh báo cáo trong 60 m, bản đồ admin đúng |
| Bản đồ admin | `live.sessions()` = `sessions.list()` của S2 ∪ phiên báo qua bus (khử trùng theo accountId) |
| Mã mời | `auth.createInviteBatch` (S2) và `invites.createBatch` (S3) cùng `sha256(NFKC → HOA → A-Z0-9)`; test `integ.test.js` tạo mã bằng trang admin rồi đăng ký bằng API |
| Netprobe admin | MỘT route `GET /admin/api/netprobe` (module admin, sau lớp an ninh S3) đọc dịch vụ `netprobe` của S5 → `{available, rows, summary, recent}` |
| Hằng số giao thức | `ACTION_RESULT` (0 OK · 1 UNSUPPORTED · 2 BUSY · 3 INVALID · 4 DENIED) và `SANCTION_KIND` (1 MUTE · 2 BAN · 3 KICK · 4 WARN) chuyển vào `js/shared/protocol.js` (gateway re-export) |
| Docker | `js/xsection.js` (move.js import) vào ảnh; `ADMIN_ALLOW_IPS` = gateway `hostlink` cố định; `DATA_DIR` = volume `gamedata` |
| Kiểm di chuyển | xem 6.4 (bắt speed-hack < 1 s) |
| Bot | `deviceId` ≥ 8 ký tự (máy chủ thật đòi `[A-Za-z0-9_-]{8,64}`); đi thẳng tới nút đường gần nhất KHÔNG băng qua nước; đo "lách lọc chat" bằng tin vọng lại người gửi; test e2e bot chạy chế độ full trên máy chủ gộp |

### 6.3 Bảng giao thức (proto 1 — bố cục byte: `js/shared/codec.js`, kích thước: §1.3)

| Hướng | Op | Tin | Ghi chú |
|---|---|---|---|
| C→S | 0x01 | HELLO {proto, flags, ticket \| resumeToken, tier, worldVersion} | tin đầu tiên, ≤ 10 s; vé không bao giờ trong URL |
| C→S | 0x02 | READY | sau khi dựng xong thế giới (≤ 180 s) |
| C→S | 0x10 | STATE {seq, clientMs u16, corrEpoch, x, z, y, yaw, vx, vz, mode+flags, vehicleRef} | 15 Hz đi / 2 Hz đứng; 25/s tối đa |
| C→S | 0x11 | ACTION {reqId, type, target, arg} | → EVENT ACTION_RESULT [reqId, code] |
| C→S | 0x12 | CHAT {channel, text ≤ 140} | chỉ SAY; 2/s burst 6 ở gateway, chính sách thật ở S3 |
| C→S | 0x13 | PING {clientTime} | 2/s burst 4 (trước HELLO ≤ 3.000) |
| C→S | 0x14 | REPORT {targetNetId, reason, chatRef} | 1 / 10 s |
| S→C | 0x81 | WELCOME {netId, serverTime, 20, 10, dayEpoch, 1440, resumeToken, weather, spawn} | |
| S→C | 0x82 | SNAPSHOT {tick, flags KEYFRAME/DEGRADED, ack, self, ENTER ≤ 24, UPDATE, LEAVE} | ≤ 96 bản ghi, ≤ 1.100 B |
| S→C | 0x83 | NAMES | 1 lần / người / phiên của người xem |
| S→C | 0x84 | EVENT {type, args i32[≤ 8]} | ACTION_RESULT 1 · CHAT_REJECTED 2 · REPORT_RESULT 3 · SUPPORT_LINE 4 · PLAYER_AWAY 5 · WEATHER_WARN 6 · SANCTION 7 |
| S→C | 0x85 | STATS {mask, value/rate…, money} | có trong codec, máy chủ GĐ1 chưa gửi (sinh tồn = GĐ sau) |
| S→C | 0x86 | CHAT {from, channel, msgRef, text} | from 0 + kênh SYSTEM = chủ dự án |
| S→C | 0x87 | SYSTEM {code, arg} | KICK 1 · RESTART_IN 2 · QUEUE_POS 3 · RELOAD 4 · BACKOFF 5 · BANNED 6 · MUTED 7 · SERVER_FULL 8 · DUPLICATE_SESSION 9 · AUTH_FAILED 10 · RESUMED 11 · DEGRADE 12 |
| S→C | 0x88 | PONG {clientTime, serverTime} | |
| S→C | 0x89 | CORRECT {x, z, y, yaw, epoch, reason} | lý do: SPEED 1 · TIME 2 · WATER 3 · OUT_OF_BOUNDS 4 · TELEPORT 5 · MODE 6 · SERVER_MOVE 8 |
| S→C | 0x8a | WORLD {lịch thời tiết} | |

Mã đóng WS: 1008 tin hỏng · 1009 quá cỡ · 4001 vé/resume sai · 4002 phiên trùng · 4003 cấm · 4004 lệch proto · 4005 đầy ·
4006 spam · 4007 không HELLO/READY · 4009 bị đuổi · 1001 tắt máy chủ (sau SYSTEM BACKOFF). Lỗi HTTP: `API_ERR` +
`AUTH_ERR` (§2.2).

### 6.4 Sửa khi chạy kịch bản (nguyên nhân gốc, không nới ngưỡng)

1. **Speed-hack bị CORRECT sau ~1 s (p50 980 ms, max 1,5 s → 54 % trong 1 s)**. Gốc: (a) điểm +1 mỗi STATE vi phạm, cần
   > 5 → 6 STATE vi phạm (0,4–0,6 s) SAU khi cửa sổ 1 s tràn; (b) người đứng yên "để dành" 1 s phụ cấp tốc độ trong cửa sổ
   nên kẻ gian chạy 3× được ~0,5 s trước khi cửa sổ tràn; (c) cửa sổ chứa một lần lên/xuống xe giữ +9 m và tốc độ xe
   máy suốt 1 s sau khi xuống xe. Sửa: (a) vi phạm SPEED liên tiếp thứ k cộng min(k, 3) điểm (1 + 2 + 3 → CORRECT ở STATE
   vi phạm thứ 3; vi phạm lẻ vẫn 1 điểm); (b) thêm cửa sổ ngắn 300 ms cùng độ nới (1,2× + 1 m); (c) cửa sổ không vắt
   qua lần lên/xuống xe (bước lên/xuống xe được xét riêng với +9 m). Mô phỏng (`speedsim`): 3× đi bộ từ đứng yên
   0,77 → 0,48 s, ngay sau xe máy 1,26 → 0,53 s. Mọi test "trung thực" của `core_move` (jitter 0–300 ms, rớt sóng,
   bufferbloat, tab ẩn 70 s, đổi chế độ/lên xuống xe) vẫn 0 CORRECT; thêm test ×2 trở lên < 1 s.
2. **Bot trung thực bị WATER-kick**: bot đặt ở vị trí đã lưu sát bờ hồ đi thẳng tới nút đường gần nhất ở bờ bên kia →
   lội qua hồ (lỗi bot, client thật không đi trên nước). `Walker` nay chọn nút gần nhất nối bằng đường thẳng KHÔNG chạm
   nước (`nearestDry`).
3. **Đo lách lọc chat**: "observers 0" — không bot quan sát nào đứng trong 40 m nên "lọt 0" là vô nghĩa; và câu bị CHE
   (mask) không được tính là đã chặn. Nay đo bằng tin vọng lại chính người gửi (= đúng điều mọi người trong 40 m nhận):
   trùng nguyên văn = lọt, khác = đã che (đã vô hiệu). Lần chạy chuẩn: 0 lọt nguyên văn.
4. **Stress 2.000: 10 người có vé hợp lệ bị SYSTEM SERVER_FULL lúc HELLO**. Gốc: gateway nhả chỗ giữ của vé NGAY khi
   nhận HELLO rồi mới `await` nạp nhân vật từ DB; trong lúc đó `/v1/join` thấy thêm chỗ trống và phát vé vượt trần.
   Sửa: chỗ giữ được nhả trong `finally` SAU khi phiên đã tạo (hoặc HELLO thất bại). Test `integ.test.js` (trần 1, chặn
   lần nạp nhân vật giữa chừng → người thứ hai vẫn phải xếp hàng).
5. **Kịch bản reconnect gộp 800/1.000 bot** (2 trong 4 lần chạy đủ cỡ): một worker bot (200 bot) đứng hình sau
   `dropAll`. Hai nguyên nhân trong harness: worker `process.exit` cứng 300 ms sau tin `final` IPC (tin chưa gửi xong thì
   mất) → nay thoát trong callback của `process.send`; và `nearestDry` (mục 2) thử MỌI nút trong 400 m khi bot đứng nơi
   nước bao quanh → nay tối đa 24 nút (3.000 điểm ngẫu nhiên: tệ nhất 4 ms). Chạy lại: 1.000/1.000 resume, 5/5 worker.
6. **Thang suy giảm lên L4 (từ chối người chơi) ở 600–900 CCU** dù tick p50 chỉ 8–13 ms. Đo: (a) đầu dò `jitter.mjs`
   (vòng JS cố định 5 ms mỗi 50 ms, KHÔNG có máy chủ) trên máy chủ dự án thấy lát chậm 2–4× đều đặn ~1 lần/giây (khoảng
   cách trung vị 932–993 ms); (b) chẩn đoán `HP_DEBUG_LONG_TICK_MS=30` cho thấy tick dài mang ĐÚNG lượng việc như tick
   thường (≈ 560 snapshot) nhưng mọi thao tác chậm 3–6× (send 85 µs thay 14 µs, AOI 30–50 µs thay 4 µs), cách nhau
   ~950 ms; vẫn thế khi ghim máy chủ / bot vào lõi riêng, khi dùng PGlite thay Postgres, và cả trong container Linux;
   (c) GC không phải thủ phạm (`--trace-gc`: scavenge p99 2 ms, mark-compact max 4,6 ms, heap ~30 MB). p99 trên 100 tick
   (5 s) vì thế đo nhiễu của máy chứ không đo tải máy chủ. Sửa: thang quyết theo **p90** (cùng ngưỡng 25/35/45/50 ms;
   p99 vẫn xuất `hp_sim_tick_ms_p99` và `lastP99`). Test: 1 tick 70 ms mỗi giây (p50 12 ms) → giữ L0; 20 % tick > 35 ms →
   lên. Kết quả: ramp 1.200 vào đủ 100 % (trước: 74–76 %), không còn L4 ở 1.200 CCU.
7. **Chi phí gửi trên Windows** (không sửa được trong mã, ghi lại): profile `--cpu-prof` ramp 1.200 → `send` của uWS
   chiếm 72 % thời gian tick (AOI 17 %). Đo riêng (`sendbench.mjs`, 600 socket, 160 B): **Windows 14–18 µs/lần gửi**
   (`ws` cũng 16 µs), **Linux trong container 3,5 µs**. Bản thật chạy trong Docker (Linux) nên phần này nhẹ hơn ~4×;
   thêm luồng gửi riêng (uWS đa luồng) là việc của giai đoạn sau nếu cần > 1.000 CCU trên một máy.

### 6.5 Số đo — kịch bản → mục tiêu SPEC §3.4 so với đo được (máy chủ dự án, 15/10/2026)

Máy: Ryzen AI 9 HX 370 (24 luồng), 31 GB, Windows 11, Node 24.15; máy chủ gộp chạy **thẳng trên Windows** (uWS,
Postgres 17 trong Docker `127.0.0.1:55437`, `INVITE_REQUIRED=false`) trừ khi ghi "Docker"; bot chạy cùng máy (tiến trình
con, ~7–9 % một lõi / 100 bot). Mọi lần > 300 bot hoặc > 60 s chạy dưới `tools/qa/gpulock.mjs`. Báo cáo đầy đủ
(`report.md/json`) trong scratchpad `mp/integ/run/*` (không commit). Máy đồng thời chạy luồng việc đồ hoạ và ứng dụng
khác của chủ dự án → số tick phụ thuộc giờ đo (cùng kịch bản ramp: p50 12–19 ms tuỳ lúc).

| Kịch bản | Mục tiêu | Đo được | Kết quả |
|---|---|---|---|
| smoke 50 × 60 s | 0 lỗi giải mã, CORRECT trung thực < 2/phút | 50/50 vào; 0 lỗi; 0 CORRECT; tick p50 0,8 / p99 2,5 ms; snapshot p95 35 B; RSS 89 MB; RTT p50 1,4 ms; event-loop p99 17,8 ms (sàn timer Windows ~16 ms) | ĐẠT |
| ramp 0 → 1.200 (5 phút) + giữ 5 phút | tick p99 < 25 ms; snapshot p95 < 1.100 B; RSS < 1,5 GB; CORRECT < 2/phút; 0 lỗi giải mã | 1.200/1.200 vào (100 %); 0 lỗi; **0 CORRECT**; snapshot p95 278 B (max 680, trần 96 không vượt); RSS 243 MB; xuống mỗi khách TB p50 1,4 KB/s (đỉnh 5 s max 3,7 KB/s); resume ngẫu nhiên 192/192. **tick p50 19 ms, p99 69–73 ms; event-loop p99 89–141 ms**; thang L0→L1→L2→L1 (không L4) | ĐẠT trừ **tick p99 / event-loop p99 (TRƯỢT)** — xem 6.4 mục 6–7 |
| ramp 1.200 — **Docker** (đường bản thật: container Linux, uWS, Postgres container) | như trên | 1.200/1.200 (100 %); 0 lỗi; 0 CORRECT; snapshot p95 548 B (max 1.067); RSS 211 MB; đỉnh 5 s max 7,4 KB/s; tick p50 16 ms, **p99 80–83 ms**; thang tới L2 (không L4). Lần chạy trước (thang p99 cũ, máy rảnh hơn): p50 8 ms, p99 47 ms, L4 ở 880 CCU → lý do mục 6.4.6 | TRƯỢT tick p99 (nhiễu máy) |
| hotspot 300 ở quảng trường Nhà hát | trần 96 giữ; không khách > 12 KB/s | bản ghi/snapshot p50 85, **max 96**; đỉnh 5 s max **9,0 KB/s**, 0 khách > 12 KB/s; tick p50 6,4 / p99 12,8 ms; 0 CORRECT (sau sửa 6.4.2) | ĐẠT |
| stress 2.000 (1,7 × trần) | thang lên đúng thứ tự; không sập; hàng đợi chạy | thang 1→0→1→2 (từng bậc); /healthz ok cuối; 1.200 vào (đúng trần), 800 xếp hàng (6.743 lượt hỏi), **0 SERVER_FULL** (sau sửa 6.4.4; trước: 10); 0 CORRECT; RSS 272 MB | ĐẠT |
| reconnect 1.000 (rớt cùng lúc, nối lại 0,5–30 s) | 100 % giữ đúng netId | **1.000/1.000** resume cùng netId; bắt tay resume p50 4,5 / p95 31 / max 126 ms | ĐẠT |
| abuse 200 (14 lớp tấn công + 40 quan sát) | mỗi lớp bị chặn/đóng ≤ 1 s; speed-hack ≥ 99 % | 14/14 lớp 100 % trong hạn: bad_opcode/truncated/text_frame → 1008 (~155 ms), oversize → đóng (1 ms), flood_ping/flood_state → 4006 (0,7–0,8 s), chat_spam → CHAT_REJECTED (26 ms), **speed_hack 100 % phát hiện, p50 453 / max 555 ms** (trước sửa 6.4.1: max 1,5 s), teleport → CORRECT (1 ms), vé giả / vé dùng lại → AUTH_FAILED, proto 99 → RELOAD, không HELLO → đóng ở 10,1 s; lách lọc chat: **0 câu lọt nguyên văn**, câu không bị chặn thì bị che | ĐẠT |
| netem-lite 300 (30 % bot +80 ± 30 ms, mất 2 %) | CORRECT trung thực < 2/phút | 300/300; 0 CORRECT (cả bot netem); RTT bot netem p50 186 / p95 511 ms; snapshot max 1.094 B; tick p99 12,5 ms; resume 39/39 | ĐẠT |
| Quick tunnel (20 bot qua `wss://*.trycloudflare.com`, container cloudflared) | chạy được, ghi RTT | 20/20 vào; 0 lỗi; 0 CORRECT; **RTT PING p50 57,9 / p95 62,7 / p99 66,5 ms**; mở WS p50 159 ms; auth p50 83 ms; join p50 75 ms; qua tunnel `/healthz` 200, `/admin` và `/metrics` 404; tunnel bật 90 s rồi tắt; URL không ghi lại | ĐẠT |
| Docker: compose up → /healthz, migration, phiên bot | | `uWS: OK` lúc build; migration 001, 010, 020–023, 030 áp dụng trên Postgres 17; /healthz `transport uws, db ok`; 20 bot qua container: 20/20, 0 lỗi, event-loop p99 **5,9 ms** (Linux); admin từ máy 200 (token) / 401 (không), từ mạng `edge` và từ container khác trên `hostlink` **403**; `trang-thai.ps1` báo mọi cổng chỉ 127.0.0.1; `tao-ma-moi.ps1` tạo mã OK; `tat-may-chu.ps1` 6–8 s | ĐẠT |
| Trang quản trị trong 1 Chrome (khoá GPU) khi 250 bot đang chơi (Docker) | ảnh chụp, 0 lỗi | 13 ảnh (đăng nhập sai/đúng, tổng quan + bản đồ 250 chấm, báo cáo, người chơi, mã mời, thông báo, bộ lọc, mạng, nhật ký, điện thoại 390 px), **0 lỗi JS / console / CSP**, không cuộn ngang | ĐẠT |
| `npm test` (PGlite) · `npm run test:pg` (Postgres 17) | xanh | **126 xanh + 1 bỏ qua** (pg_boot cần Docker) · **40/40** (db, pg_boot, core_auth, core_session, integ, safety_chat, safety_admin) | ĐẠT |

**Đọc bảng tick**: trên máy này p99 của tick và event-loop bị chi phối bởi (1) "khựng" ~1 Hz của chính máy (6.4.6) và
(2) chi phí `send()` của Windows (6.4.7). Tải thật của máy chủ thấy ở p50 (8–19 ms / 50 ms ngân sách ở 1.200 CCU) và CPU
tiến trình (55–70 % một lõi). Buổi thử kín (vài chục người) cách xa mức này; muốn khẳng định 1.000+ CCU với p99 < 25 ms
cần đo trên máy chủ Linux riêng (VPS) — số trên đây là cận trên của máy chủ cùng máy với bot.

### 6.6 Việc còn mở (cho chủ dự án / giai đoạn sau)

- **Tick p99 < 25 ms ở 1.200 CCU chưa đạt trên máy này** (6.5). Hướng: đo trên VPS Linux; nếu cần > 1.000 CCU trên một
  máy: tách gửi snapshot sang luồng uWS riêng (`uWS.App` mỗi luồng + phân phiên), hoặc giảm số lần `send` (gộp NAMES đã
  làm; snapshot rỗng của người đứng yên một mình có thể giảm còn 2 Hz).
- **Chất lượng khi đông người mới**: tài khoản mới đều xuất hiện ở 8 điểm → cụm dày lúc mở cửa (reconnect 1.000 tài khoản
  mới: AOI chạm trần 96 ở nhiều điểm cùng lúc). Có thể rải điểm xuất hiện rộng hơn khi đông.
- `ADMIN_DENY_CIDRS` / `ADMIN_ALLOW_CIDRS` (S5) và `ADMIN_ALLOW_IPS` / `ADMIN_ALLOW_HOSTS` / `CHAT_LOG_DAYS` (S3) vẫn đọc
  từ `process.env` (config.js của nền móng chưa có khoá) — hoạt động đúng trong Docker và khi chạy tay; chuyển vào
  `config.js` khi nền móng mở lại.
- Danh sách từ của bộ lọc chat cần người Việt bản ngữ duyệt sau buổi đầu (§3.9).
- Named tunnel (tên miền riêng) chưa thử thật — chưa có tên miền (§5.6).
- `server/test/core_move.test.js` có chú thích bị lỗi mã hoá ký tự (mojibake `â†’`) từ trước — vô hại, nên sửa khi S2 mở lại.
- Harness bot: `stress` có 931 + 695 refresh 401/409 ở lần chạy cũ do bot làm mới token mỗi lần hỏi hàng đợi → nay giữ
  access token 15 phút như client thật; lần chạy cuối 0 lỗi refresh.

---

## 7. Vòng sửa 1 (fixer, 15/10/2026) — 29 phát hiện của 3 người kiểm tra (an ninh, netcode, an toàn + vận hành)

Mỗi mục: nguyên nhân gốc → cách sửa → test hồi quy (`server/test/fix1_regress.test.js`, một test cho mỗi phát hiện, chạy cả
trong `npm test` lẫn `npm run test:pg`). Các mục cũ ở §2.4, §2.5, §2.7, §3, §5 được thay bằng nội dung dưới đây khi khác.

### 7.1 Ngân sách thời gian mới (NET-1, NET-3, NET-4) — `js/shared/move.js`

Nguyên nhân gốc: (a) 5 s "học" sau mỗi reset cho `base` đi theo offset **không giới hạn**, và RESUME gọi `reset` → mỗi lần
resume mở lại cửa sổ học (đồng hồ ×30 đi 262 m trong 4,5 s, lặp vô hạn); (b) mỗi vi phạm TIME đặt lại `base` 100 ms dưới
mẫu gian → đồng hồ nhanh tới ~1,19× không bao giờ bị CORRECT và cộng thêm vào độ nới 1,2×; (c) trần "trễ +200 ms sau 10 s"
nâng `base` lúc bufferbloat kéo dài, nên khi hàng đợi xả, người chơi trung thực bị chấm như đồng hồ nhanh.

Mô hình mới:
- Không còn cửa sổ học tự do. Mẫu đầu sau reset (vào mới / takeover = trang mới, gốc đồng hồ mới) đặt `base`.
- `base` chỉ hạ theo trôi 2 ms/s; phần hạ sâu hơn trừ vào **xô tha thứ** mỗi phiên (`FORGIVE_BURST_MS` 2.000 ms, nạp
  `FORGIVE_PER_S` 10 ms/s = 1 %). Xô **không** được nạp lại khi reset/RESUME (vòng takeover không lấy thêm được).
- **Thời gian hiệu dụng** `E = min(C, serverMs − base + 100 ms)` thay cho đồng hồ client trong cửa sổ quãng đường: đồng hồ
  nhanh không còn mua thêm quãng đường ngoài phần đã tha → nó tự vượt cửa sổ SPEED và bị CORRECT. Đo (`learn_exploit`
  của người kiểm tra, mô hình chạy ở giới hạn nới): ×1,1 / 1,15 / 1,19 trong 300 s → ≤ 8,6 m/s (trung thực ở giới hạn nới
  8,4 m/s; trước sửa 9,27 m/s ở ×1,19); ×1,19 trở lên bị CORRECT rồi kick. Đồng hồ ×5 / ×30 ngay sau reset: bị
  CORRECT/kick, quãng đường ≤ trung thực + phần tha (trước: 262 m / 4,5 s, 0 CORRECT).
- Điểm TIME vẫn được tính (một lần mỗi 200 ms "đi trước" MỚI, mốc chấm điểm riêng `sbase`) — chỉ để phát hiện; một gói đầu
  bị kẹt > 2 s của người trung thực tốn vài điểm và tối đa 1 CORRECT, không bao giờ một chuỗi.
- Trần tín dụng trễ `LAG_BANK_MS` = **2,5 s** (thay +200 ms của SPEC — lệch có chủ ý): bufferbloat 1–2,5 s kéo dài rồi xả
  không còn bị chấm. "Tích thời gian" bằng đồng hồ chậm rồi nhanh bị chặn ở 2,5 s × vmax một lần, không tăng tốc độ trung
  bình. Bản mô phỏng `honest_net` của người kiểm tra: 11/11 hồ sơ mạng 0 vi phạm, 0 CORRECT (trước: bloat 2 s → TIME 7,
  CORRECT 2).
- RESUME **không** reset bộ kiểm (giữ mốc thời gian, cửa sổ 1 s, xô tha thứ): client phải giữ đồng hồ `clientMs` qua một
  lần nối lại (cùng trang; bot đã đúng như vậy). RESUME tính vào hạn mức `helloAccount` (1/s, burst 10) như HELLO có vé.
- Takeover bằng vé (trang mới) bắt đầu ĐÚNG tại avatar đang sống: **không** cộng thưởng mẫu đầu 15 m + 1 s (trước: vòng
  takeover 0,5 lần/s cộng ~15 m/s). Vào mới (avatar chưa có trong thế giới) giữ thưởng (lệch điểm xuất hiện).
- Bot: thêm lớp tấn công `clock_dilation` (đồng hồ ×3, vị trí "trung thực" theo đồng hồ đó) và `resume_loop` (×5 + rớt +
  RESUME mỗi 1,5 s); hạn phát hiện 2 s cho hai lớp này (xô tha thứ 2 s là thiết kế) — `bots/lib/report.mjs abuseLimitMs`.

### 7.2 CORRECT mất khi rớt mạng (NET-2), NAMES sau resume (NET-10), backpressure (NET-11)

- `Validator.reset` không còn được gọi khi RESUME nên `pending` sống qua resume; `attach(resumed)` gửi lại
  `CORRECT(SERVER_MOVE, epoch hiện tại)` ngay sau `SYSTEM RESUMED` nếu còn chờ. `onStale` khi **không** có gì chờ (lệch
  trạng thái) cũng gửi lại CORRECT ngay (và đếm như một lần chờ) — không bao giờ đứng hình im lặng.
- Resume xoá `aoi.namesSent` + `pendingNames`: keyframe resume ENTER lại mọi slot nên mỗi tên được gửi lại một lần
  (~30 B/người thấy).
- Bỏ snapshot vì `bufferedAmount > 16 KB` **không** còn ép keyframe (aoiStep không chạy → trạng thái AOI vẫn khớp client;
  P1 là bản ghi tuyệt đối). Keyframe chỉ còn ở READY và RESUME. Lệch có chủ ý so với SPEC §3.2 ("lần sau là keyframe").

### 7.3 AOI đẳng hướng (NET-5), độ cao (NET-6), ngồi sau (NET-7)

- Ứng viên AOI lấy từ **mọi ô giao với hình vuông [x ± (rKeep + HYST)]** của vị trí thật người xem
  (`js/shared/grid.js cellsInRange`, ≤ 7×7, thường 4×4) thay cho 3×3 ô quanh ô có trễ (chỉ bảo đảm ~112 m). `world.forNear`
  (chat 40 m, ngồi sau) dùng cùng cách. Test: thực thể ở R_NEAR − 3 m và R_FAR − 2 m thấy được từ mọi vị trí/hướng.
- `y` của STATE được **kẹp** trước khi người khác thấy (`move.js clampY`): mặt đất (`groundHeight`, gồm mặt cầu phố) ±
  1,5 m (+ đỉnh nhảy 0,81 m ở chế độ AIR); trong hành lang cầu / đường trên cao (`onBridge`: BRIDGE_WAYS, ELEVATED_RI — nhịp
  HVT, nút xoắn) mọi độ cao ≥ đất − 1,5 m (độ cao mặt cầu chưa mô hình hoá trong js/shared); thuyền ≤ 3,5 m. Kẹp, không phạt
  (không CORRECT oan khi mặt nền client hơi khác); metric `hp_y_clamped_total`. **Gia tốc chưa kiểm** (ARCH §12 mục 3) —
  header `validate.js` đã sửa cho đúng; cửa sổ 1 s / 300 ms giới hạn phần lợi.
- Ngồi sau: bán kính = 4 m + vmax(xe) × (tuổi mẫu nhận cuối của người lái + của người ngồi, mỗi cái ≤ 2 s). Tài xế bị kẹt
  TCP 1,5 s cách 20 m vẫn hợp lệ; tài xế tươi cách 20 m thì không.

### 7.4 Thang suy giảm thấy độ trễ vòng lặp (NET-8) và giá trị số đo (NET-9)

- Giá trị quyết định = max(p90 thời lượng tick, **p90 độ trễ BẮT ĐẦU tick − 16 ms**). `app.timers.loop` truyền `lateMs`;
  `DegradeLadder.observeLate`. 16 ms = một nhịp timer Windows (vòng 20 Hz rảnh trễ p50 ~7, p99 ~15 ms). Log/metric:
  `decide`, `tickP90`, `lateP90`. Lệch ARCH §5 (p99 thời lượng tick) có chủ ý, ghi tại đây.
- Đọc số: trên Windows `event-loop p99` có sàn ~16 ms (độ phân giải timer), nên tiêu chí "< 20 ms" chỉ còn ~4 ms thật. Các
  "khựng 1 Hz" chỉ xuất hiện khi chạy tải (người kiểm tra: khoảng cách 936 ms lúc tải, 2.860 ms lúc rảnh) → **không** còn
  coi là nhiễu của máy đã được chứng minh; p99 tick ở 1.200 CCU là cận trên khi bot và máy chủ chung máy, cần đo lại với bot
  ở máy khác trước khi kết luận (xem 7.9).

### 7.5 Hàng chờ / chỗ giữ (SEC-1 = NET-12)

`queue.reserve` giữ **một** chỗ mỗi tài khoản (vé mới thay vé cũ; `release` theo nonce chỉ xoá nếu còn là chỗ hiện tại);
chỗ của chính tài khoản được tính là trống khi nó hỏi lại (không tự xếp hàng sau mình). Test: 1 tài khoản hỏi 8–15 vé → 1
chỗ; tài khoản khác vẫn vào.

### 7.6 An ninh (SEC-2..7)

- **Báo cáo hùa (SEC-2 = SO-5)**: báo cáo `counts` (tính vào tự khoá) chỉ khi có **bằng chứng** (dòng `chatRef` của người bị
  báo cáo trong 10 phút, hoặc một dòng đã giao, không ẩn, trong 60 m quanh người báo cáo trong 10 phút) VÀ người báo cáo
  **đáng tin** (tài khoản ≥ 1 ngày, ≥ 30 phút chơi); đếm người khác nhau theo tài khoản VÀ theo IP công khai (/64; IP
  riêng/loopback không gộp). Mọi báo cáo vẫn vào hàng chờ. Thang tự động từ báo cáo dừng ở mute 24 h (không bao giờ ẩn tin).
  "Bỏ qua" một báo cáo gỡ luôn khoá tự động mà nó gây ra. Migration `024_report_evidence.sql` (`evidence`, `counts`,
  `reporter_ip`, `hits`, `purged_at`).
- **Mạng của container game (SEC-3)**: game chỉ còn trên mạng internal (`edge`, `backend`, `adminlink` mới). Container
  **portal** (`server/ops/portal.mjs`, cùng ảnh nhưng chỉ chạy bộ chuyển TCP tối giản, read-only, non-root, 1 CPU / 128 MB /
  64 pid, restart no) là container DUY NHẤT trên `hostlink`: giữ `127.0.0.1:9100/9101` và một lối ra cố định
  `portal:8443 → api.telegram.org:443`. `ADMIN_ALLOW_IPS = HPMP_PORTAL_IP/32` (địa chỉ cố định trên `adminlink`).
  Cảnh báo Telegram đi `TELEGRAM_VIA=portal:8443` (https.request với `servername: api.telegram.org`, kiểm chứng chỉ đầu-cuối).
- **Khôi phục (SEC-4)**: mã sai định dạng bị từ chối TRƯỚC mọi hạn mức; `recoverGlobal` chỉ còn cảnh báo (không chặn);
  recover/guest theo IP gộp /48.
- **Mã khôi phục (SEC-5)**: lưu `HMAC-SHA256(RECOVERY_PEPPER, mã)` (`recovery_hash_v = 2`, migration `011_recovery_pepper.sql`);
  `RECOVERY_PEPPER` là bí mật mới trong `server/.env` (tự sinh; `chung.ps1` kiểm). Dòng cũ (sha256 trần) được nâng cấp ở lần
  khôi phục thành công kế tiếp. Bản sao lưu chép sang thư mục khác: cảnh báo khi trông giống thư mục đám mây; VAN_HANH §8.
- **Giữ dữ liệu (SEC-6)**: job purge (6 giờ/lần) xoá `context` (bản chép chat) của báo cáo đã xử lý/bỏ qua quá
  `CHAT_LOG_DAYS`, xoá báo cáo bỏ qua quá 90 ngày; báo cáo đang mở giữ nguyên.
- **IPv6 / socket chưa HELLO (SEC-7)**: `ipKey` mở rộng IPv6 đầy đủ (`net.isIPv6` + phân tích; IPv4-mapped → IPv4) rồi
  gộp theo /64 (mặc định) hoặc /48 (pool socket chưa HELLO, recover, guest, /probe); socket chưa HELLO gửi bất kỳ tin nào
  ngoài PING/HELLO bị đóng 1008 ngay. **Chưa làm**: "connect token" HMAC trong `Sec-WebSocket-Protocol` để chỉ tài khoản đã
  đăng nhập mới chiếm được pool — rủi ro còn lại ghi trong VAN_HANH §13.
- Phụ: giới hạn `/v1/chat/*` dùng token bucket có trần bộ nhớ (trước: `Map.clear()` khi > 50k khoá → reset hạn mức của
  mọi người); `/probe` và `/v1/netprobe` gộp IP (/48, /64), hạn mức theo IP chạy trước hạn mức toàn máy; router không còn
  500 khi `%` hỏng; hành động quản trị có thời hạn bắt buộc nhập số ngày (ô trống từng = cấm VĨNH VIỄN).

### 7.7 An toàn trẻ em và bộ lọc (SO-1..7)

- **Dụ dỗ leo thang (SO-1)**: trong 10 phút mỗi tài khoản có MỘT báo cáo lọc đang mở; mọi dòng bị đánh dấu sau đó được
  **nối vào** (`hits`, lý do, chính dòng đó vào `context`) thay vì bị bỏ. Từ lần dò thông tin cá nhân thứ 2 → cảnh báo
  Telegram `grooming`. Trang quản trị: nhãn "AN TOÀN TRẺ EM — xem trước", "N lần bị đánh dấu", cờ an toàn luôn xếp đầu.
- **Số điện thoại lách (SO-2)**: chữ giống số trong token có chữ số (`l2`, `o9l2З4S6789`: o→0, i/l/|→1, z→2, s→5, b→6,
  g/q→9), số đếm tiếng Anh (`zero … nine`), số đếm dính chữ số (`khong9mot2…`, `0nine1two…`), và **số tách nhiều dòng**:
  dịch vụ chat giữ chữ số của ≤ 4 dòng "nhiều số" trong 60 s và kiểm chuỗi ghép (`isPhoneDigits`: 0/84 + 8–10 số, ≥ 3 chữ số
  khác nhau) → chặn + cờ.
- **Tự hại + chữ tục (SO-3)**: dòng bị chặn vẫn trả `support` → gateway gửi `EVENT SUPPORT_LINE` TRƯỚC `CHAT_REJECTED`;
  không tính lỗi (strike) cho dòng có ý tự hại.
- **Xử phạt không đóng cờ an toàn (SO-4)**: hành động trên một báo cáo chỉ đóng các báo cáo NGƯỜI CHƠI đang mở về người đó;
  báo cáo của bộ lọc (tự hại, dò hỏi…) giữ mở.
- **Bộ lọc (SO-6, SO-7)**: (a) `dịt` (giữ dấu thanh, đ→d) = lách `địt` trừ khi chính từ có dấu đó vô hại (`dĩ`, `cút`);
  (b) chữ cách quãng có dấu (`đ ị t m ẹ`) chạy cả so khớp "dính trong từ"; (c) dòng token chưa ghép chữ đơn được so khớp
  thêm (`nhà e ở đâu`, `m ở quận nào`); (d) `~`/`_` cho phép số tiền chen giữa (`nạp 50k thẻ`, `free 1000 kc`);
  (e) danh sách: tự hại có từ chen (`tớ chỉ muốn chết`), dụ dỗ (`bật cam`, `đừng nói với bố mẹ`, `bí mật … đứa mình`, `ở nhà
  1 mình`…), tục/tình dục/miệt thị/lừa đảo/giả danh quản trị theo danh sách người kiểm tra; tên mạng xã hội bị viết lách
  (`za.lo`, `z@lo`) = chia sẻ liên hệ. Dương tính giả: thêm `allow.txt` (`ức hiếp`, `hiếp đáp`, `vú nuôi`, `bà vú`, `đồ bóng
  đá/chuyền/rổ`, `mẹ/bố mày gọi/bảo/đón…`), bỏ `vđ` khỏi `mild.txt`. Tên nhân vật: từ cấm ngắn + số (`BQT01`) và tên mạng xã
  hội + ≥ 3 số (`Zalo09123`) bị từ chối. 142 câu lách + 142 câu vô hại MỚI của người kiểm tra đã nhập vào
  `test/fixtures/chat_bad.txt` / `chat_ok.txt`. Đo: câu lách mới bắt **96,5 %** (trước 52,8 %), câu vô hại mới dương tính
  giả **1,4 %** (2 câu bị CHE: `vl` = vật lý, `cl` = chất lượng; trước 5,6 % gồm chặn + cảnh báo `hate`); toàn bộ corpus:
  bắt 97,7 % (469/480), câu thường qua 99,7 % (672/674). Còn lọt: `kb zép`, `kênh yt … hp3dvn`, `3//`, hẹn gặp ở cổng
  trường, `mai đi chơi với anh không` (cố ý không bắt: câu rủ chơi thường gặp).

### 7.8 Vận hành (SO-8..10)

- **Không tự bật lại sau khi khởi động lại máy (SO-8)**: `restart: "no"` trong khuôn `x-hardening` (portal, tunnel, quick
  tunnel, backup); game và db `on-failure:5` (chỉ dựng lại khi sập lúc đang chạy; nếu Docker dựng lại chúng sau khi khởi
  động lại máy thì không ai tới được vì portal/tunnel không bật). Đường vào luôn qua `mo-may-chu.ps1` (tệp đánh dấu GPU +
  giữ máy thức).
- **Cửa sổ script (SO-9)**: `chung.ps1 Wait-Dong/Exit-Ops` — mọi script của chủ dự án dừng chờ Enter khi tiến trình cha là
  Explorer (nhấp phải → Run with PowerShell); không dừng trong cửa sổ PowerShell sẵn có, `HPMP_TEST=1`, `HPMP_NO_PAUSE=1`.
- **Tunnel tạm (SO-10)**: sau khi có URL, `mo-may-chu.ps1 -TamThoi` hỏi DNS công cộng `1.1.1.1` (KHÔNG qua modem, để không
  "đầu độc" bộ nhớ phủ định của modem) tới khi tên phân giải được (≤ 90 s), đợi thêm 10 s rồi mới in địa chỉ.

### 7.9 Số đo vòng sửa 1 (máy chủ dự án, 15/10/2026, cổng 9175/9176, Postgres 17 `127.0.0.1:55441`, bộ `hpmp-fix`)

Máy chủ chạy thẳng trên Windows (uWS) với Postgres 17 Docker, `INVITE_REQUIRED=false`; mọi kịch bản chạy dưới
`tools/qa/gpulock.mjs`; bot cùng máy (tiến trình con). Báo cáo đầy đủ: scratchpad `mp/fix1/run/*` (không commit).

| Kịch bản / kiểm tra | Đo được (vòng sửa 1) | Kết quả |
|---|---|---|
| smoke 50 | 50/50; 0 lỗi giải mã; 0 CORRECT; tick p99 2,75 ms; snapshot p95 71 B; RSS 89 MB; event-loop p99 18,8 ms | ĐẠT |
| abuse 200 (16 lớp, thêm `clock_dilation`, `resume_loop`) | 16/16 lớp 100 % trong hạn; speed_hack 46/46, p50 462 / max 611 ms; **clock_dilation 11/11 CORRECT, p50 1.376 / max 1.505 ms** (hạn 2 s); **resume_loop 9/9 CORRECT, p50 790 / max 849 ms**; lách lọc: 0 câu lọt nguyên văn | ĐẠT |
| reconnect 1.000 (resume giữ bộ kiểm) | **1.000/1.000** đúng netId; bắt tay resume p50 4,5 / p95 47,5 / max 267 ms; **0 CORRECT** cho bot trung thực sau resume | ĐẠT |
| netem-lite 300 | 300/300; 0 CORRECT (90 bot netem: max 0/phút); RTT netem p50 186 / p95 511 ms; resume 36/36 | ĐẠT |
| ramp 0 → 1.200 + giữ 5 phút | 1.200/1.200 vào; 0 lỗi; **0 CORRECT**; snapshot p95 242 B; RSS 207 MB; resume 186/186; tick p50 18,7 ms, **p99 70–78 ms; event-loop p99 84–229 ms**; thang **L0→L1→L2→L3→L4 (10 s)→L3→L2→L3→L2** — thang giờ THẤY độ trễ vòng lặp (trước: L1–L2 với cùng tải) | ĐẠT trừ tick / event-loop p99 (TRƯỢT như trước, xem 7.4) |
| e2e của người kiểm tra: đồng hồ ×10 + RESUME lặp (`e2e_learn`) | vòng 0: **18 m trong 4,5 s, 3 CORRECT** rồi bị kick (trước: 262 m, 0 CORRECT, lặp vô hạn) | ĐẠT |
| e2e: CORRECT mất + RESUME (`e2e_lostcorrect`) | CORRECT được gửi lại (5 lần) rồi kick client không áp dụng (trước: 0 lần, đứng hình vĩnh viễn) | ĐẠT |
| attack harness (an ninh): 1 tài khoản hỏi /v1/join 15 lần | chỗ giữ **1** (trước 10); tài khoản khác nhận vé | ĐẠT |
| Docker (bộ `hpmp-fix`, 9175/9176, ảnh build mới) | `mo-may-chu.ps1 -TestMode` 26 s; migration 001, 010, **011**, 020–023, **024**, 030 trên Postgres 17; /healthz qua portal: uws, db ok; 20 bot qua portal 20/20, 0 CORRECT, tick p99 0,93 ms, event-loop p99 5,9 ms | ĐẠT |
| Docker: container game KHÔNG ra được mạng nhà (SEC-3) | từ game: `host.docker.internal:54321` EAI_AGAIN, `192.168.1.1` ENETUNREACH, gateway hostlink ENETUNREACH, `https://example.com` EAI_AGAIN; `db` tới được; Telegram qua `portal:8443`: HTTP 302, chứng chỉ CN `api.telegram.org`; admin từ mạng `edge` 403, từ máy (qua portal) 401 không token / 200 có token; cổng game `/admin` 404 | ĐẠT |
| Docker: quick tunnel qua mạng mới + đợi DNS (SO-10) | `-TamThoi` 21 s (DNS 1.1.1.1 có ngay); qua tunnel `/healthz` 200, `/admin` `/metrics` `/admin/api/live` 404; `khoa-khan-cap` 1,9 s; `tat-may-chu -XoaDuLieuThu` 7,3 s, không còn gì nghe 9175/9176 | ĐẠT |
| Bộ lọc: 142 câu lách MỚI / 142 câu vô hại MỚI của người kiểm tra | bắt 96,5 % (trước 52,8 %); dương tính giả 1,4 % (chỉ CHE, trước 5,6 % gồm chặn) | ĐẠT |
| `npm test` (PGlite) · `npm run test:pg` (Postgres 17, `hpmp-fix:55441`) | **147 xanh + 1 bỏ qua** (148) · **61/61** (thêm `fix1_regress.test.js`) | ĐẠT |

### 7.10 Còn mở sau vòng sửa 1

- Connect token cho `/play` (SEC-7) — chưa làm; pool socket chưa HELLO vẫn có trần toàn máy 5.000 (giới hạn theo /48).
- Kiểm gia tốc (ARCH §12 mục 3) — chưa làm; độ cao mặt cầu nâng chưa mô hình hoá trong `js/shared` (cho mọi độ cao trong
  hành lang cầu).
- Quick tunnel vẫn chuyển mọi đường dẫn tới `game:9100` (cổng game trả 404 cho /admin, /metrics — đã kiểm); named tunnel có
  ingress 4 đường dẫn.
- Mã khôi phục vẫn vĩnh viễn; chưa có "đổi mã + đăng xuất thiết bị khác" sau khi khôi phục.
- `/v1/chat/filter` vẫn công bố mọi danh sách (cũng có trong repo công khai).
- Bộ lọc: các câu còn lọt ở 7.7; danh sách cần người Việt bản ngữ duyệt sau buổi đầu.
- Ramp 1.200 cần đo lại với bot ở máy khác (NET-9) trước khi kết luận về p99 tick.

## 8. Vòng sửa 2 (fixer, 15/10/2026) — 4 phát hiện của người kiểm chứng (ramp/reconnect/độ sạch số đo/NET-4)

Mã: `server/src/game/sim.js`, `server/src/app.js` (`timers.loop` có `external`), `server/src/metrics.js`, `server/src/config.js`
(`TICK_SLICE_MS`), `js/shared/move.js` (`MOVE.LONG_MS`), `server/bots/{run,worker}.mjs`, `server/bots/lib/{report,metrics}.mjs`.
Test hồi quy: `server/test/fix2_regress.test.js` (7 test, chạy trong `npm test`). Báo cáo đầy đủ: scratchpad `mp/fix2/run/*`
(không commit). Phần dưới thay cho các đoạn tương ứng ở §6.4 mục 6, §7.4 và §7.9 khi khác.

### 8.1 Độ trễ vòng sự kiện (scenario:ramp-eventloop) — đo cho đúng, rồi mới giảm

**Nguyên nhân gốc 1 — số đo sai.** `hp_eventloop_delay_*` lấy từ `perf_hooks.monitorEventLoopDelay({resolution: 5})`: nó ghi
**khoảng cách giữa hai lần chạy của một timer 5 ms**, tức là gồm chính 5 ms đó và, trên Windows, lượng tử timer hệ thống
15,6 ms. Đo trên máy chủ dự án: một tiến trình Node **rảnh hoàn toàn** đọc p50 15,5 ms / p99 16,6 ms; một vòng bận 19 ms mỗi
50 ms đọc p99 30,4 ms (= 19 ms + một lượng tử) — các con số "event-loop p99 30–34 ms" của ramp phần lớn là đồng hồ Windows.
**Sửa**: `metrics.js startLagProbe` — một worker thread nhỏ gửi đồng hồ (`process.hrtime`, cùng đồng hồ đơn điệu với luồng
chính) mỗi 5 ms; luồng chính ghi (lúc nhận − lúc gửi) = **thời gian một sự kiện từ bên ngoài phải chờ** — đúng điều một tin
WebSocket của người chơi trải qua. `hp_eventloop_delay_p50/p99_ms` = phân vị trên mẫu **10 s gần nhất** (trên Windows worker
chỉ thức 64 lần/s nên cửa sổ 2.048 mẫu dài ~30 s và giữ khựng lúc khởi động quá lâu); `_max_ms` = lớn nhất giữa hai lần đọc;
histogram `hp_eventloop_lag_ms` cho Prometheus. Số cũ vẫn xuất, đã trừ độ phân giải: `hp_eventloop_timer_delay_{p50,p99}_ms`.
Kiểm chứng (`fix2/probe_idle.mjs`): rảnh → probe p50 0,11 / p99 0,27 ms (timer cũ 10,5 / 11,6 ms sau khi trừ 5 ms); khối 4 ms
mỗi 50 ms → p99 4,2 ms; khối 19 ms → p99 19,2 ms (timer cũ 30,4). Đối chiếu khi tải: probe p99 khớp RTT PING→PONG p99 của
bot (ramp 1.200: probe 116–159 ms, RTT p99 130 ms) — số mới là độ trễ thật, không phải số "đẹp" hơn.

**Nguyên nhân gốc 2 — tick là một khối đồng bộ.** Ở 1.200 CCU một tick (≈ 600 snapshot) chạy 14–23 ms liền một mạch, phần lớn
là `send()` của uWS (Windows 14–30 µs/lần); mọi STATE/PING/HTTP đến trong lúc đó phải chờ hết khối. **Sửa**: tick **chia lát**
(`sim.js tickSliced`): mỗi lượt vòng sự kiện làm tối đa `TICK_SLICE_MS` (mặc định 4 ms, `server/.env`) việc snapshot rồi
`setImmediate`; danh sách phiên của tick chốt lúc bắt đầu, phiên rời đi giữa chừng (`_ai = -1`) bị bỏ qua; nếu tick kế tiếp
đến hạn khi các lát chưa xong thì phần còn lại chạy đồng bộ trước (`hp_sim_tick_overrun_total`). Thời lượng tick đưa vào thang
suy giảm và `hp_sim_tick_ms` = **tổng các lát** (việc thật; `timers.loop(..., {external: true})` + `handle.record(ms)`); thời
gian thực từ snapshot đầu → cuối: `hp_sim_tick_span_ms`. `TICK_SLICE_MS=0` = như cũ (một mạch).
A/B cùng phiên, cùng máy (ramp 600 CCU, 40 s lên + 110 s giữ, khoá GPU; `fix2/run/ab2_*`): lát 4 ms so với một mạch —
lag p99 (trung vị các lần đọc) **26 ms so với 62 ms**, RTT PING p95 **18,7 so với 30,1 ms**, p99 **44,8 so với 70,6 ms**,
tick p99 39 so với 47 ms, thang **ở L0** (một mạch: lên L1). Ở 1.200 CCU (`ab1_*`, máy đang chậm, xem 8.3) hai cách gần như
nhau (tick p99 66 so với 78 ms, lag p99 141 so với 133 ms): máy chủ đã gần bão hoà một lõi, chia lát không bù được CPU thiếu.

### 8.2 Cửa sổ quãng đường 4 s (NET-4 phần dư) — `js/shared/move.js`

**Nguyên nhân gốc**: phần nới cộng `SLACK_ADD_M` (1 m) được cấp **cho mỗi cửa sổ 1 s**, nên cửa sổ trượt cho phép giữ mãi
vmax·1,2 + 1 m/s — chạy bộ 9,4 m/s (1,34 × vmax) với **đồng hồ thật**, 0 vi phạm (đo: 9,3 m/s trong 60 s → 0 vi phạm). Đồng hồ
×1,1 (9,0 m/s, 15 vi phạm, 0 CORRECT) chỉ là một cách đi vào cùng khe đó. **Sửa**: thêm cửa sổ dài `MOVE.LONG_MS` = 4 s cùng
luật (1,2 × Σ phụ cấp + 1 m), đi chung một vòng lùi với cửa sổ 1 s và 300 ms, không vắt qua lên/xuống xe; vòng mẫu
`MOVE.RING` 48 → 128 (đủ 4 s ở 30 Hz). Trần duy trì còn vmax·1,2 + 0,25 m/s (chạy bộ 8,65). Đo (`fix2/slack.mjs`, mô hình
của người kiểm tra): đồng hồ thật 9,3 m/s → 63 vi phạm, 32 CORRECT, trung bình còn 8,65 m/s; ×1,1 → **19 CORRECT** (trước 0),
8,84 m/s trong 60 s (gồm 2 s của xô tha thứ, một lần mỗi phiên), bị kick trong 300 s; ×1,19 → kick. Người trung thực: chạy/đi
bộ/xe máy ở vmax và ở 1,2 × vmax, 2/15/30 Hz, 5 phút, đồng hồ khung hình rung 40–90 ms + mạng rung ±15 ms → 0 vi phạm; bot
thật: abuse (speed_hack 46/46 trong 1 s, clock_dilation 11/11 trong 2 s), netem-lite 300 và ramp 1.200 → **0 CORRECT** cho bot
trung thực. Test: 4 test NET-4 trong `fix2_regress` (hai test đầu TRƯỢT với `move.js` cũ — đã thử).

### 8.3 Đo lại sạch (stress / hotspot / reconnect) và vì sao p99 ở ~1.000 CCU vẫn trượt trên máy này

- **Một máy chủ mỗi lần chạy**: `mp/fix2/run.sh` dựng máy chủ mới (DB mới) cho mỗi kịch bản, in PID đang nghe 9175/9176
  (phải đúng MỘT), chạy bot dưới `tools/qa/gpulock.mjs`, rồi dừng theo **cổng đang nghe** (`stop.ps1`:
  `Get-NetTCPConnection -State Listen` → PID Windows; PID của bash không phải PID Windows — lý do người kiểm chứng để sót
  4 máy chủ cũ) và kiểm `listeners left: 0`. Mọi lần chạy ở 8.4: 1 PID, 0 còn sót.
- **Báo cáo bot không còn "100 %" trên mẫu thiếu** (phát hiện khi đo lại): lần reconnect sạch đầu tiên của vòng này ghi
  "resume 800/800 = 100 %" trong khi máy chủ đếm 200 phiên hết hạn chờ — một worker bot (200 bot) **chết** giữa chừng và kết
  quả của nó biến khỏi mẫu số. `report.mjs` nay có tiêu chí `kết quả đủ bot` (= N dự kiến), `worker bot gửi kết quả`
  (= số worker) và, cho reconnect, `bot resume đúng / số bot dự kiến` (≥ N). `run.mjs` luôn in (kể cả `--quiet`) worker im
  lặng > 5 s (kèm trạng thái bot), mã thoát khác 0 và worker thiếu kết quả; công cụ chẩn đoán: `HPBOT_DEBUG_DIR` (mỗi worker
  ghi một dòng mỗi giây), `HPBOT_INSPECT_STALL=1` (dừng worker im lặng qua inspector, in ngăn xếp), `HPBOT_EXEC_ARGV`. Kết quả:
  worker thoát với **0xC0000409** (abort gốc; không có báo cáo lỗi V8 hay dòng stderr nào) trong khoảng 1/2 số lần chạy
  reconnect 1.000 trên Windows, cả khi bot chạy bằng tiến trình con lẫn worker thread (khi là thread thì cả tiến trình bot
  chết) — lỗi gốc trong Node 24.15/Windows khi ~200 socket `ws` phía client rớt/nối lại cùng lúc; **không** phải lỗi máy chủ
  (máy chủ vẫn nhận resume của các bot khác; phiên của bot chết hết hạn đúng 60 s). Chưa tìm được gốc (cần dump); báo cáo nay
  bắt được trường hợp này thay vì báo đạt giả.
- **Máy đang chậm hơn lúc người kiểm chứng đo**: trong cả phiên đo này trình bảo vệ màn hình OLED Care của ASUS chạy liên tục
  (~145 % một lõi CPU, bật lúc 06:30 giờ máy khi máy rảnh — không tắt vì nó bảo vệ màn OLED). Đầu dò thuần JS (`fix2/jit.mjs`,
  cùng một khối việc 0,8 ms lặp 8 s) cho p90 = 1,5–2 × p50 và **p99 = 3–4 × p50**, kể cả khi ghim vào một cặp lõi; ưu tiên cao
  không đổi gì → p99 của tick ≈ 3–4 × p50 ở mọi kịch bản. Cùng kịch bản ramp, tick p50: người kiểm chứng 14 ms (máy rảnh), vòng
  này 23 ms (bản không chia lát cũng 21 ms trong cùng giờ, `ab1_s0`).
- **Profile CPU** (ramp 1.200, 60 s, `fix2/prof/ramp.cpuprofile`): luồng chính rảnh 30 %; `send` của uWS **37 %** (≈ 30 µs mỗi
  lần gửi trên Windows lúc này), AOI 13,5 %, xử lý tin đến 12 % (kiểm di chuyển 5 %). Không còn khối việc thừa đáng kể để cắt
  trong JS: phần lớn là syscall gửi của Windows.

### 8.4 Số đo vòng sửa 2 (máy chủ dự án, 15/10/2026 00:00–02:20 UTC, cổng 9175/9176, Postgres 17 `127.0.0.1:55441`, bộ `hpmp-fix`)

Máy chủ thẳng trên Windows (uWS) trừ dòng "Docker"; một máy chủ mỗi lần chạy; bot cùng máy; mọi lần > 300 bot hoặc > 60 s dưới
khoá GPU. "lag p99" = `hp_eventloop_delay_p99_ms` mới (trung vị các lần đọc / lớn nhất).

| Kịch bản | Đo được | Kết quả |
|---|---|---|
| smoke 50 | 50/50, 0 lỗi, 0 CORRECT; tick p99 2,4 ms; **lag p99 2,1 / 3,5 ms** (timer cũ 12,2 ms); mọi tiêu chí kể cả "event-loop p99 < 20 ms" | ĐẠT |
| hotspot 300 | trần 96 giữ (max 96, vượt 0); đỉnh 5 s max 8,9 KB/s, 0 khách > 12 KB/s; 0 CORRECT; tick p50 7,3 / p99 27 ms (ngưỡng kịch bản 40); lag p99 8 / 15 ms; L0 | ĐẠT |
| stress 2.000 | 1.200 vào đúng trần, 5.856 lượt xếp hàng, 0 lỗi, 0 CORRECT; thang 0→1→2 từng bậc; health cuối ok; RSS 262 MB | ĐẠT |
| reconnect 1.000 (các lần không có worker bot chết: `reconnect4`, `reconnect6`, `rect1`, `rect2`) | **1.000/1.000** resume đúng netId; bắt tay resume p50 4–4,5 / p99 75–103 ms; tick p50 16 ms, **p99 52–56 ms**; lag p99 56–67 / max ≤ 108 ms; thang L0→L1→L0→L1 (không quá L1; người kiểm chứng: tick p99 66–73, lag 83–142, tới L2) | ĐẠT tiêu chí kịch bản; tick p99 > 25 ms (8.3) |
| reconnect 1.000 (`reconnect2/3/5/7/8/9/12`, `rect3`) | worker bot chết 0xC0000409 → 400–800 bot resume; nay báo **TRƯỢT** `kết quả đủ bot` / `bot resume / dự kiến` (trước: "100 %") | lỗi harness, 8.3 |
| abuse 200 (16 lớp) | 16/16 lớp trong hạn; speed_hack 46/46 p50 426 / max 545 ms; clock_dilation 11/11 p50 1.379 / max 1.485 ms; 0 CORRECT người quan sát | ĐẠT |
| netem-lite 300 | 300/300; **0 CORRECT** (cả bot netem) với cửa sổ 4 s; tick p99 18,8 ms; lag p99 5,4 / 7 ms | ĐẠT |
| ramp 0 → 1.200 + giữ 5 phút | 1.200/1.200, 0 lỗi, 0 CORRECT, snapshot p95 521 B, RSS 274 MB; tick p50 23 ms, **p99 65–68 ms**; lag p99 116–159 ms (RTT PING p99 130 ms); thang L0→L1 (227 s)→L2 (548 s) | TRƯỢT tick/lag p99 (8.3) |
| ramp 1.200 — **Docker** (đường bản thật trên máy này: container Linux, uWS, Postgres container, qua portal) | 1.200/1.200, 0 lỗi, 0 CORRECT, snapshot p95 548 B, RSS 223 MB; tick p50 **13,6 ms**, p99 64–67 ms; lag p99 **31–57 ms** (thẳng Windows cùng giờ: 116–159); thang chỉ L1 ở 277 s | TRƯỢT tick/lag p99 (8.3) |

**Đọc**: ở ≤ 300 CCU (buổi thử kín chỉ vài chục người) mọi chỉ số đạt với dư lớn: lag p99 2–15 ms, tick p99 ≤ 27 ms. Ở
1.000–1.200 CCU trên máy này máy chủ dùng 70–80 % một lõi và p99 của tick ≈ 3–4 × p50 vì nhiễu của chính máy (8.3) → tick p99
< 25 ms và lag p99 < 20 ms **không đạt và không đạt được bằng sửa JS**: cần (a) đo trên máy Linux riêng / VPS với bot ở máy khác
(NET-9 — vẫn chưa làm, cần máy thứ hai), hoặc (b) chuyển việc `send` snapshot sang nhiều luồng uWS (giai đoạn sau, §6.6). Thang
suy giảm làm đúng việc của nó (lên L1–L2 từng bậc, không bao giờ L4 ở 1.200).

- **Ảnh Docker của bản thử** (phát hiện khi đo ramp Docker): `-TestMode` dùng bộ/cổng riêng nhưng vẫn dựng ảnh tên
  `hpworld-game:local` của bản thật (vòng sửa 1 tránh được chỉ vì đặt tay `HPMP_IMAGE`). `chung.ps1 Get-HpSettings` nay đặt
  `HPMP_IMAGE=<bộ>-game:local` cho bản thử khi chưa đặt. Lần đo này đã ghi đè `hpworld-game:local` bằng bản dựng từ mã hiện tại —
  vô hại vì `mo-may-chu.ps1` luôn dựng lại (`--build`) khi mở bản thật.

### 8.5 Kiểm thử

`npm test`: thêm `test/fix2_regress.test.js` — NET-4 (đồng hồ thật 9,3 m/s bị bắt; ×1,1 bị CORRECT và trung bình 60 s ≤ trần;
người trung thực 0 vi phạm ở mọi chế độ/tần số/5 phút/rung khung hình; cửa sổ dài không vắt qua lên/xuống xe), tick chia lát
(nhường vòng sự kiện, bỏ phiên đã rời, làm nốt đồng bộ khi quá hạn, tick đồng bộ vẫn như cũ), `timers.loop` ghi thời lượng
ngoài, đầu dò độ trễ (rảnh < 5 ms; sau một khối 40 ms đọc ≥ 20 ms). Kết quả: `npm test` **154 xanh + 1 bỏ qua** (155); `npm run test:pg` (Postgres 17, bộ `hpmp-fix`, cổng 55441) **61/61**. Sửa
thêm một test chập chờn có sẵn: `core_auth` làm hỏng chữ ký JWT bằng cách thay 2 ký tự cuối bằng `AA` — ~1/256 lần đó là không đổi
gì (ký tự cuối mang 4 bit đệm) và test trượt ngẫu nhiên; nay đổi một ký tự ở giữa chữ ký.

### 8.6 Còn mở sau vòng sửa 2

- **NET-9**: đo lại ramp/reconnect với bot ở máy khác (và máy chủ Linux) — cần máy thứ hai; mọi số ở 8.4 là cận trên khi bot,
  máy chủ và ứng dụng của chủ dự án chạy chung máy.
- Tick p99 < 25 ms / lag p99 < 20 ms ở 1.200 CCU trên máy này: cần gửi snapshot đa luồng (8.3, §6.6).
- Harness bot: worker chết 0xC0000409 trong reconnect 1.000 trên Windows (8.3) — cần dump (WER LocalDumps hoặc procdump) để
  tìm gốc; tạm thời chạy lại tới khi `kết quả đủ bot` ĐẠT.

## 9. Phía game GĐ1 — C1 mạng, phiên, giao diện (MP-2, 15/10/2026)

Đặc tả: `MP2_SPEC.md` §2 C1. Không sửa `server/*` hay `js/shared/*` — client chỉ dùng API/giao thức như đã xây (§2.2, §6.3).

### 9.1 File

| File | Việc |
|---|---|
| `js/net/config.js` | địa chỉ máy chủ: `?server=` (nhớ vào localStorage `hp3d.server`, `?server=off` xoá) > localStorage > `DEFAULT_SERVER` (để trống). Nhận `wss://`/`https://`; `ws://` chỉ cho localhost; IP trần công khai bị từ chối. API = cùng gốc `https://…/v1/…`, WS `wss://…/play` |
| `js/net/net_worker.js` | **Web Worker** giữ WebSocket: HELLO (vé / RESUME), PING 2 Hz 10 s đầu rồi 1 Hz + `ClockSync`, giải mã bằng `codec.js`, bảng slot SNAPSHOT → bản ghi theo **netId** đóng gói `Float64Array` TRANSFER về luồng chính; mốc giờ snapshot = min(giờ đến − tick·50 ms) trên 64 snapshot (bỏ dao động mạng); nối lại RESUME trong 60 s (backoff 1-2-4-8 s + 0–1 s; SYSTEM BACKOFF được tôn trọng); 4001 / quá 60 s → xin vé mới; 4002/4003/4004/4009 → không tự nối |
| `js/net/session.js` | HTTP: guest / refresh (xoay vòng, `refresh_race` thử lại) / recover / join; `hp3d.device` (mã thiết bị ngẫu nhiên), `hp3d.mp.v1` = refresh token + tài khoản THEO gốc máy chủ (chỉ localStorage người chơi); access token chỉ trong RAM; ngoại hình 8 byte ngẫu nhiên lúc tạo tài khoản |
| `js/net/correct.js` | CORRECT: lệch ≤ 6 m kéo mượt 0,15 s, lớn hơn nhảy hẳn (đang cưỡi: dời xe, xe dừng); STATE sau đó mang `corrEpoch` mới |
| `js/net/telemetry.js` | số liệu CỤC BỘ (không gửi đi): STATE/snapshot/CORRECT/chat/nối lại/RTT p50-p95 |
| `js/net/net.js` | điều phối: panel tiêu đề, phiên, worker, STATE, người khác, chat, ngày/đêm, HUD — mọi hàm công khai bọc try/catch |
| `js/net/remote_avatars.js` (+ `interp.js`, `nametags.js`) | người chơi khác (C2, §9.5) — bản tạm `remote_avatars_stub.js` đã bỏ khi tích hợp (§9.6) |
| `js/ui/chat.js` | khung chat 40 m, menu Báo cáo / Chặn, đường dây hỗ trợ |
| main.js · input.js · ui.js · daynight.js · i18n.js · css/style.css | điểm nối (dưới đây), phím chat `onChatKey`/`releaseKeys`, `registerModal`, `syncTo`, khoá `mp*`/`chat*` vi+en, giao diện |

### 9.2 Điểm nối trong `js/main.js` (đúng bảng codebase_hooks §9)

- Trước `buildWorld`: chỉ khi `?server=` / `hp3d.server` / `NET_DEFAULT_ON` → `await import('./net/config.js', './net/net.js')`,
  `createNet({cfg, ui, tier, i18n, input, audioGesture})` (dựng panel tiêu đề, làm mới token SỚM song song dựng thế giới).
  Không cấu hình: KHÔNG import gì mới (0 request). `NET_DEFAULT_ON` phải = (`DEFAULT_SERVER` khác rỗng) — `tools/qa/mp2_c1_unit.mjs`.
- Sau khi có người chơi/xe/ngày-đêm: `net.attach({scene, world, camera, pState, player, vehicles, dayNight, surfaceY,
  place: placePlayer, dismountNow})`. `vehicles` lúc này = xe DÙNG CHUNG của thế giới → `vehicleRef = chỉ số + 1` (như nhau
  mọi máy); xe máy gọi riêng = 0.
- `mount()` → `net.onMount(v)` (ACTION MOUNT; BUSY/DENIED → xuống lại + "Xe này đang có người dùng"); `dismount()` /
  `forceDismount()` → `net.onDismount(v)`.
- Mỗi khung: sau `clampToPlayArea` → `net.preFrame(dt)` (CORRECT + STATE); sau camera → `net.frame(dt, camera.position)`
  (người khác nội suy + `dayNight.syncTo` 1 Hz + HUD); `drawMinimap(…, net ? net.markers() : undefined)`.
- `startGame()` → `net.onStart()` (READY + đặt ở điểm xuất hiện + chat); `boot.finish()` → `net.onBootReady()`.
- `window.__hp.net` (QA): `status() say() chatLines() players() names() drop() rejoin() openChat() workerStats()`.

### 9.3 Hành vi

- **Màn tiêu đề** (chỉ khi có máy chủ): Biệt danh + Mã mời (lần đầu), "Có mã khôi phục?", nút **Vào thành phố** (= nút Bắt
  đầu, bấm sớm vẫn được) và **Chơi một mình**. Chưa có tài khoản: `/v1/auth/guest` → hộp **mã khôi phục hiện MỘT lần** (sao
  chép + "Tôi đã lưu mã") → vào. Có tài khoản: "Xin chào, Tên#1234". Mọi mã lỗi API có câu tiếng Việt (`mpErr_*`, lý do
  biệt danh `mpErr_nick_<reason>`, hàng chờ vị trí/ETA, cấm, lệch phiên bản → hộp "Tải lại trang").
- **Vòng đời**: join khi bấm → WELCOME đặt người chơi ở `spawn` máy chủ (camera sau lưng) → READY lúc vào game → STATE 15 Hz
  khi di chuyển / 2 Hz khi đứng (chế độ đi/chạy theo PHÍM chạy — không theo vận tốc ước lượng để không lệch cửa sổ 300 ms;
  AIR khi đang nhảy; MOTO/CYCLO/BOAT khi cưỡi; cờ BUSY khi mở bảng/chat); `clientMs` = u16 của `performance.now()` TRANG (giữ
  qua RESUME đúng CONTRACT §7). Vào lại sau khi mất máy chủ: chỉ về vị trí máy chủ nếu lệch > 12 m (báo "Máy chủ đưa bạn về
  vị trí đã lưu").
- **Mất máy chủ**: biểu tượng HUD đổi ngay ("Khám phá · Đang nối lại…"); quá 3 s chưa RESUME → báo + xoá người khác (rớt ngắn
  không nhấp nháy). Game chạy như một mình; tự nối lại (RESUME ≤ 60 s, sau đó vé mới với backoff 2→15 s). Bấm biểu tượng = thử ngay.
- **Ngày/đêm chung**: `dayNight.syncTo(dayTAt(serverNow, dayEpoch, dayLength))` 1 Hz; `update()` nắn theo đồng hồ thật
  (hằng thời gian ~2 s), lệch > 0,01 ngày thì nhảy + nướng lại IBL (không gọi setter `t` mỗi khung).
- **Chat**: T hoặc / mở (Enter vẫn là tương tác), Enter gửi rồi đóng, Esc đóng; nút 💬 trên HUD; tin của mình hiện khi máy chủ
  VỌNG LẠI (thấy đúng bản đã che); từ chối (`CHAT_REJECTED` 1–8), báo cáo (`REPORT_RESULT`), khoá chat/cảnh cáo (`SANCTION`),
  thông báo quản trị (kênh SYSTEM, from 0 → dải banner), `SUPPORT_LINE` (hộp nổi bật + Tổng đài 111) đều tiếng Việt. Chạm tên
  → Báo cáo (6 lý do, gửi `msgRef` của dòng đó) / Chặn (ACTION BLOCK_PLAYER + ẩn ngay). Chữ người chơi chỉ qua `textContent`.

### 9.4 Kiểm chứng (máy chủ dự án, Radeon 890M TIER 3, 15/10/2026)

`tools/qa/mp2_c1_e2e.mjs` (máy chủ native `HPMP_TEST=1` cổng 9210/9211, PGlite riêng, 30 bot S4 trong tiến trình với biệt danh
có dấu, 1 Chrome dưới khoá GPU, tuần tự 2 trình duyệt): **19/19 bước ĐẠT** — xem `KNOWLEDGE.md` §10 (MP-2 C1) để có số đo.
`tools/qa/mp2_c1_unit.mjs` (node: cấu hình, CORRECT, i18n vi/en, bố cục gói worker) và `tools/qa/mp2_nonet.mjs` (không máy
chủ: 0 import js/net, 0 WebSocket, 0 request API).

### 9.5 Người chơi khác trong game (C2, 15/10/2026)

Tệp: `js/net/remote_avatars.js` (vẽ), `js/net/interp.js` (nội suy, thuần — chạy được trong node), `js/net/nametags.js` (bảng tên
+ vòng sáng), `js/minimap.js` (tham số `markers`). Không mở mạng, không sửa `main.js`; mọi hàm tự nuốt lỗi (không bao giờ làm
hỏng vòng frame). C1 (`js/net/net.js`) nối như sau:

```js
import { createRemoteAvatars, randomAppearanceHex } from './net/remote_avatars.js';
import { createSnapClock } from './net/interp.js';
const ra = createRemoteAvatars({ scene, world, camera, tier: TIER });     // sau khi có scene/camera (main.js hook §9 mục 4)
const snapClock = createSnapClock();                                      // 1 cái / kết nối; reset() khi nối lại trang mới
// /v1/auth/guest: appearance = randomAppearanceHex() (hoặc encodeAppearance(look) → hex) — 8 byte, máy chủ lưu nguyên
// WELCOME:  ra.self(netId)
// SNAPSHOT: const t = snapClock.time(msg.tick, clock.serverNow());       // dấu thời gian snapshot (giờ máy chủ, ms)
//           for (s of leaves) ra.leave(slotNetId[s]);
//           for (e of enters) ra.enter(e.netId, e, e.appearance, t);     // e = {x, z, y, yaw, spd, state, appearance}
//           for (u of updates) ra.update(slotNetId[u.slot], u, t);
//           KEYFRAME: (tuỳ chọn) ra.keep(netIdsTrongKeyframe) — bỏ người không còn trong AOI; ENTER lại cùng netId giữ quỹ đạo
// NAMES:    ra.names(msg.names)                                          // [{netId, name, badge}] — tên giữ qua leave/enter
// mỗi khung (main.js trước traffic.update): ra.frame(dt, clock.serverNow(), camera.position)
// minimap (main.js drawMinimap 10 Hz): drawMinimap(px, pz, yaw, ra.markers())   // [] ở GĐ1 (người lạ ẩn); ra.setFriends(ids)
// thoát online / về chế độ Khám phá: ra.dispose()  (hoặc ra.setEnabled(false) khi rớt mạng tạm)
```

- **Thời gian**: `nowServerMs` = đồng hồ thật + offset `ClockSync`; dấu thời gian snapshot nên lấy từ `createSnapClock`
  (tick·50 ms + độ lệch nhỏ nhất trong 5 s — rung mạng chỉ làm TRỄ gói nên đường bao dưới là đúng; tick lùi/lệch > 10 s → tự đặt
  lại). Truyền giờ nhận thô cũng chạy (kém mượt hơn).
- **Nội suy** (`Track`): vẽ ở `now − delay`, delay tự chỉnh 100–150 ms theo nhịp mẫu (10 Hz → 120, tầng xa 5 Hz → 150); hết mẫu
  → ngoại suy theo vận tốc 2 mẫu cuối ≤ 250 ms rồi đứng; mẫu mới lệch > 8 m so với quỹ đạo dự đoán (dự đoán theo vận tốc qua cả lỗ
  hổng ≤ 2 s) → NHẢY; gói trễ làm đổi quỹ đạo tại thời điểm đang vẽ → chênh lệch tắt dần τ 90 ms (không giật). Máy chủ chỉ gửi bản
  ghi ĐỔI → sau quãng đứng yên chèn mẫu giữ chỗ t − 100 ms. Snapshot 10 Hz mang STATE 15 Hz mới nhất (tuổi mẫu rung 0–67 ms) →
  thời điểm mẫu được căn theo quãng đường/`spd` khi chạy > 2 m/s (rung dấu thời gian 23 → 5,5 ms, mô phỏng `tests/net/interp_sim.mjs`).
- **Vẽ**: ≤ 5 draw call cố định cho mọi N — người (`pedestrianGeometry`, vật liệu `traffic_walk` của traffic.js), xe máy + người
  lái gần/xa (`motorbikeGeometry('scooter', rider 'ride')` / `motorbikeFarGeometry`, LOD theo camera như traffic), bóng tiếp đất
  (`kitShadowMaterial`), vòng sáng + bảng tên + "vắng mặt" (1 InstancedMesh động). 3 bộ đệm instance xoay vòng, `userData.noCull`,
  `raycast = () => {}`, `matrixAutoUpdate = false`, bounding sphere 220 m quanh camera, không đổ bóng vào shadow map. Trần: TIER ≤ 1
  → 40, TIER ≥ 2 → 96 (gần camera nhất, người đang vẽ được ưu tiên ×0,8). Chế độ: WALK/RUN (dáng đi theo tốc độ hiển thị), AIR
  (y bản ghi), SIT/BOAT (ngồi), MOTO (nghiêng atan(v·ω/g), cờ CARGO → thùng hàng), PILLION (gắn vào xe máy gần nhất ≤ 3 m — bật
  người B trên xe đó, áo B = áo người ngồi sau), CYCLO (GĐ1: vẽ bằng xe máy + giỏ). Cờ AWAY → vòng xám + "vắng mặt"/"away".
  `y` = `world.surfaceY(x, z, yBảnGhi)` (mặt cầu theo tầng) + `ROAD_TOP`.
- **Ngoại hình 8 byte** (ENTER): b0 hạt giống màu · b1 mũ (0-4 không, 5 nón lá, 6-7 mũ lưỡi trai) / tóc dài / khẩu trang / túi ·
  b2 áo · b3 sơn xe · b5 chiều cao 0,94–1,06 · b6 quần short / áo dài tay · b7 phiên bản. Byte ngẫu nhiên (máy chủ tự sinh) luôn
  ra người hợp lý. `huy hiệu` (NAMES badge) 1 = viền + chữ vàng.
- **Bảng tên**: atlas canvas 1024² (ô 256×64, LRU 60 ô, ≤ 8 ô vẽ mới/khung, tải lại texture ≤ 10 lần/s), chuỗi NFC, font hệ thống
  có dấu tiếng Việt, co chữ cho vừa ô; 24 người gần nhất trong 25 m, cỡ 0,26 + 0,011·d m, mờ dần 17→25 m (4 mức vẽ sẵn).

**Số đo** (`tools/qa/mp_c2_avatars.mjs`, Radeon 890M ANGLE d3d11, 1280×720, cùng phiên, 1 Chrome dưới khoá GPU; ảnh + `report.json`
+ `interp.json/svg` ở `C:/Users/Admin/hp-world-work/mp2/c2/`):

| | TIER 3 (full) | TIER 1 (lite) |
|---|---|---|
| Người gửi tới / được vẽ (quảng trường Nhà hát) | 96 / 87 (9 xe máy ngoài 200 m) | 96 / 40 (trần) |
| Draw call của mô-đun (đếm theo mesh `mp_*`, 10 khung) | 4 (người, xe máy xa, bóng, bảng tên) — kịch bản trộn: 5 | 3 |
| Tổng draw call trung vị: không mô-đun → 0 người → 96 người | 397 → 399 → 402 (nhiễu bóng/AO ±100 giữa khung) | 480 → 480 → 481 |
| Chương trình shader trước / sau | 76 / 76 | 51 / 51 |
| fps · khung p95 (trước → 96 người) | 60,1 → 60,0 · 18,0 → 16,9 ms (vsync) | 60,2 → 60,0 · 16,9 → 16,8 ms |
| CPU `ra.frame()` ở 96 người | 0,26 ms | 0,26 ms |
| Bảng tên đang hiện | 24 (trần) | 24 |

Nội suy trong game (1 người, quỹ đạo `interp_sim.truthAt`: đi bộ 3 m/s → chạy vòng 7 m/s → đứng 5 s → xe máy 16 m/s; STATE 15 Hz,
snapshot 10 Hz chỉ bản ghi đổi, trễ 35 ms + rung 0–60 ms + đuôi 4 %, kẹt TCP 1,2 %/snapshot 300–700 ms, rớt mạng 40–42 s rồi
RESUME keyframe): sai số vị trí vẽ p50 **0,07 m**, p90 0,18, p95 **0,23 m**, p99 1,34, max 5,4 m (kẹt TCP: ngoại suy dừng ở 250 ms
theo SPEC rồi đuổi kịp trong ~0,2 s), bước khung lớn nhất 0,94 m, trễ hiển thị 265 ms (delay 120 + tuổi mẫu 145). Resume sau 2 s
ở chỗ người kia đã đi tới: dự đoán theo vận tốc khớp → không nhảy. Mặt cầu Lạc Long: người/xe trên cầu y 4,22 (mặt cầu 4,11 +
mặt nhựa), dưới gầm/ngoài cầu theo mặt đất. Dấu tiếng Việt khó ("Nguyễn Thị Hường", "Đặng Quốc Việt", "Trần Ngọc Ẩn", "Lê Thị Ứng")
không vỡ: `atlas.png`, `tags_zoom2.png`.

### 9.6 Tích hợp C1 + C2 (integrator MP-2, 15/10/2026) — số đo đầu-cuối với hình người chơi khác THẬT

**Gộp:** `--no-ff` C1 rồi C2 vào `dot3`; `net.js` import `./remote_avatars.js` (bỏ `remote_avatars_stub.js`). Khác biệt API đã khớp:
- `ra.enter(netId, abs, appearance, serverMs)` — C2 lấy dấu thời gian snapshot ở **tham số thứ 4** (C1 để trong `abs.serverMs` → ENTER
  đầu tiên bị đóng dấu bằng snapshot TRƯỚC). `net.js` truyền `sMs` (mốc tick của worker: min(giờ đến − tick·50 ms) trên 64 snapshot,
  tương đương `createSnapClock`, nên không dùng thêm `createSnapClock`).
- `ra.positions()` (C1 QA `__hp.net.players()`) thêm vào remote_avatars: vị trí ĐANG VẼ + tên + `drawn`. `__hp.net.avatars()` trả mô-đun
  (QA: `debug`, `stats`, `setEnabled`, `tags.canvas`).
- ENTER lại cùng netId (keyframe sau RESUME): C2 GIỮ quỹ đạo (nhảy khi lệch > 8 m) — tốt hơn "đặt lại" của bản tạm; e2e: RESUME
  96 → 96 người, không nhấp nháy.
- Ngoại hình `/v1/auth/guest`: `session.js` vẫn 8 byte ngẫu nhiên nhưng byte 7 = 0 (phiên bản của `decodeAppearance`).
- `ra.frame()` gọi SAU `updateCamera` (C1) thay vì trước `traffic.update` (gợi ý của C2) — chọn LOD/bảng tên theo camera của chính
  khung đó; đo không thấy lỗi.

**Sửa khi tích hợp (đo trước/sau):**
1. **Bảng tên tải lên GPU theo DẢI HÀNG** (`nametags.js`): bản C2 tải lại cả atlas 1024² (4 MB + mipmap) ≤ 10 lần/s khi có ô mới. Với
   96 người trong 25 m, ô LRU thay liên tục → ~3 lần tải/s. Đo trên TIER 3 (bật ↔ tắt mô-đun, cùng khung, 3 lượt × 4 s): số khung
   > 1,8× trung vị = **đúng bằng số lần tải** (13/13, 13/12, 11/11; tắt mô-đun: 0) → giật định kỳ; khung trung bình +0,46 ms. Nay ô mới
   chép bằng `renderer.copyTextureToTexture` (texSubImage2D dải hàng chứa các ô mới, ≤ 64 KB/ô, 1 lần mipmap) trong
   `mesh.onBeforeRender` (có renderer, không đổi API); mesh không được vẽ > 3 khung (vd. test node) → quay về tải cả atlas. Sau sửa:
   0 lần tải cả atlas, ~5 lần chép dải/s, 0 lỗi, khung trung bình +0,12–0,15 ms ở cùng phép đo.
2. **Không vẽ bảng tên người < 2,5 m từ camera** (`remote_avatars.js` `TAG_NEAR2`): đám đông sát camera làm bảng tên phóng to che nửa
   màn hình (ảnh `e2e/06_tags_close_viet.png` lần 1).

**Đầu-cuối** — `tools/qa/mp2_int_e2e.mjs` (máy chủ native `HPMP_TEST=1` cổng 9230/9231, PGlite riêng, **96 bot S4** trong tiến trình —
cùng lớp `Bot` với `server/bots/run.mjs` — dồn quanh điểm xuất hiện của trình duyệt, biệt danh có dấu; 1 Chrome dưới khoá GPU, fps
không kẹp vsync; Radeon 890M ANGLE d3d11, TIER 3 rồi trình duyệt 2 TIER 1): **24/24 bước ĐẠT ở cả 3 lượt chạy** (lượt cuối sau mọi sửa:
`C:/Users/Admin/hp-world-work/mp2/int/e2e_final3/`). Số liệu lượt cuối:

| Bước | Kết quả |
|---|---|
| Vào thành phố (WELCOME + READY) | 1,7 s sau bấm; 82/96 bot trong 60 m sau 141 s (bot chạy xe máy từ 8 điểm xuất hiện) |
| Người lái xe máy | ảnh `04_rider_*.png` (bot được bảo dừng xe để chụp cận cảnh), mode MOTO, mô hình xe + người lái |
| Vẽ bằng mô-đun thật | 96 người: 96 vẽ, 84 vòng sáng, 24 bảng tên; **draw call mô-đun 3–4** (người · bóng · bảng tên [+ xe máy xa]), tổng +4; **0 chương trình shader mới** (danh sách chương trình trước khi có người khác = sau) |
| Bảng tên tiếng Việt | "Nguyễn Thị Hường", "Đặng Quốc Việt"… đúng dấu: `06_tag_atlas.png` (atlas gốc), `06_tags_close_*.png`, `12_vn_diacritics_chat_zoom.png` |
| Chat 2 chiều | bot → khung chat (tên + tin có dấu + emoji); trình duyệt → 84–96 bot trong 40 m nhận nguyên văn; tin có số điện thoại bị chặn (câu tiếng Việt, 0 lọt) |
| Báo cáo / chặn | "Đã gửi báo cáo"; sau chặn tin của người đó không tới (hình người đó VẪN hiện — xem việc mở) |
| Bot gian lận tốc độ (nhảy 155 m trong 1 STATE) | máy chủ CORRECT bot; trình duyệt thấy bot lệch tối đa 1,6–7,1 m (không nhảy theo) |
| `__hp.teleport` 325 m | CORRECT lý do 5 (teleport), về đúng chỗ sau 0,3–0,6 s |
| Rớt socket | RESUME cùng netId sau 1,1–1,9 s, 96 → 96 người (không nhấp nháy) |
| Ngày/đêm | lệch máy chủ 0,01–0,02 phút game; trình duyệt 2 (TIER 1, lấy lại tài khoản bằng mã khôi phục) lệch 0,01 |
| Tắt máy chủ | "Khám phá · Đang nối lại…" + người khác biến mất sau 3,0 s; vẫn đi được; bật lại → tự vào lại 7,1–8,0 s sau khi máy chủ lên |
| Lỗi JS | 0 (1 dòng console `403` của bước mã mời sai — Chrome tự in cho fetch không 2xx) |

**Hiệu năng trực tuyến** (cùng khung nhìn đám đông, bật ↔ tắt mô-đun `setEnabled`, 3 lượt × 4 s xen kẽ, fps KHÔNG kẹp vsync):

| | TIER 3 (96 người trong khung) | TIER 1 lite (96 gửi tới → vẽ 40) |
|---|---|---|
| Draw call tổng (trung vị) | 412 → 416 (**+4**; mô-đun đếm theo mesh 3–4) | 526 → 528 (+2; mô-đun 3) |
| Tam giác | +89 k | +41 k |
| Khung trung bình / p50 / p95 | 9,07 → 10,52 ms (+1,45) / 8,4 → 9,6 / 16,0 → 16,9 | 5,60 → 6,18 ms (+0,58) / 4,9 → 5,4 / 8,9 → 9,4 |
| fps không kẹp | 110 → 95 | 179 → 162 |
| CPU `ra.frame()` | 0,31 ms | 0,20 ms |
| Ở 60 Hz vsync (chơi thật) | khung 10,5 ms < 16,7 ms → **60 fps không đổi** | 60 fps không đổi |

Chi phí ~15 µs/người được vẽ ở TIER 3 (thân người PBR + vòng sáng + bảng tên trong suốt). Khi đám đông khuất sau nhà (lượt 2), +0,14 ms.

**Docker (đường chạy thật, chế độ thử):** `HPMP_PROJECT=hpmp-int2 HPMP_GAME_PORT=9230 HPMP_ADMIN_PORT=9231 server/ops/mo-may-chu.ps1
-TestMode -KhongTunnel -KhongSaoLuu -KhongMoTrang`: dựng ảnh + Postgres + portal, mở sau 25 s, KHÔNG ghi `hpworld_server_live.txt`.
Trình duyệt vào qua portal (`ws://127.0.0.1:9230`): `mp2_int_e2e.mjs --docker --bots 16` **11/11 ĐẠT** (tài khoản "Đặng Quốc Việt",
thấy 11 bot, người lái xe máy, bảng tên, chat 2 chiều, bot gian lận bị kéo về, teleport → CORRECT), RTT p50 2,9 / p95 3,9 ms, 0 lỗi JS.
`tat-may-chu.ps1 -TestMode` tắt sạch (không còn cổng 9230/9231); đã xoá volume/ảnh thử `hpmp-int2`.

**Chế độ một mình — A/B cùng phiên với dot3** (`tools/qa/mp2_int_ab.mjs`: base `dot3` ở cổng 8814 — `git archive` + hard-link GLB, 0
dòng 404 — với bản tích hợp ở 8813; `shoot.mjs --perf` 24 góc `views_std`, giao thông bật, fps không kẹp; 5 lượt xen kẽ thứ tự):
startReady trung vị 7.255 → 7.273 ms (cặp từng lượt: +46, −10, +294, −73, −4 → **trung vị −4 ms**), hpReady 5.644 → 5.668 ms;
draw call trung vị 24 góc 374 → 374, tam giác 3,49 M → 3,49 M; fps trung vị 24 góc 149 → 143 (lượt 1–3) / 149 → 153 (lượt 4–5)
= nhiễu; 0 lỗi JS. `mp2_nonet` full + lite: 0 WebSocket, 0 request API.

**Việc còn mở (sau tích hợp):**
- Chặn chỉ ẩn CHAT; hình + bảng tên người bị chặn vẫn hiện (máy chủ vẫn gửi trong snapshot). Nên ẩn phía client (`ra.hide(netId)`)
  hoặc máy chủ lọc — quyết định sản phẩm (chống bám theo quấy rối).
- ~~Đám đông dày (96 người trong bán kính 13 m) → bảng tên chồng nhau trên màn hình~~ → ĐÃ SỬA §9.9 (gỡ chồng trên màn hình).
- Bot S4 nhận 11–13 CORRECT lý do 1 (SPEED) mỗi lượt khi chạy xe máy tới (C1 đã báo) — phía bot/move.js, trình duyệt không bị
  (trình duyệt chỉ nhận đúng 1 CORRECT: lý do 5 TELEPORT của bước cố ý).
- Chưa đo trên điện thoại thật / qua tunnel `wss://` thật.

### 9.7 Fixer vòng 1 sau phản biện (15/10/2026) — sửa tận gốc + số đo lại

Không đổi `server/*`, `js/shared/*`, giao thức. Phạm vi: `js/net/{net,net_worker,correct,interp,config,remote_avatars}.js`,
`js/ui/chat.js`, `js/i18n.js`, `css/style.css`, test.

| Mã | Lỗi (phản biện) | Sửa | Kiểm |
|---|---|---|---|
| NC-1 | CORRECT nhỏ (1,5–6 m, kéo mượt 0,15 s): `onCorrect` đặt `nextStateAt = 0` → khung sau gửi STATE epoch mới khi mới kéo ~11 % → máy chủ chấm từ điểm đã sửa (`correctTo`), điểm vi phạm không reset → CORRECT dây chuyền (đo: 15 lần/2,5 s) → kick + `noRejoin` | `corr.step()` trả true khi có kéo; `preFrame` KHÔNG gửi STATE khi `corr.pending` (≤ PULL_S + 1 khung) và bỏ phần dời do kéo khỏi ước lượng vận tốc | `tests/net/correct_cascade.test.mjs` — Validator THẬT, 60/30 Hz × RTT 5/50/150 ms × lệch 1,5–5,95 m: **đúng 1 CORRECT, 0 kick** (bản cũ, đối chứng: 3–8). Trình duyệt thật (e2e bước 8b): 1,8 m×3 và 1,5 m×4 → **1 CORRECT** mỗi lần, vẫn trực tuyến cùng netId |
| NC-2 | Sau RESUME, người rời trong lúc mất kết nối thành bóng ma vĩnh viễn (worker xoá bảng slot ở WELCOME rồi mới diff keyframe → không LEAVE ai); diff keyframe trong worker còn sai với ENTER rải 24/snapshot | Worker bỏ diff keyframe (chỉ xoá slot). `net.js` đối chiếu: keyframe → `recon = tập đang vẽ`; mỗi ENTER xoá khỏi tập; chốt ở snapshot đầu sau keyframe có 0 ENTER (rải xong) hoặc 2 s → LEAVE phần còn lại. Phiên MỚI (không resume): ENTER lại cùng netId thì dựng quỹ đạo mới (netId có thể là người khác sau khi máy chủ khởi động lại). KHÔNG thêm luật "lâu không có mẫu thì xoá" — máy chủ chỉ gửi bản ghi ĐỔI, người đứng yên không có mẫu | e2e bước 9 (mở rộng): rớt socket, 6 bot đang vẽ rời + bị kick trong lúc đó → RESUME 1,9 s, **0 bóng ma**, 96 → 90 (= bot còn sống), `tel.reconLeaves` 6 |
| NC-3 | Mốc tick = min(giờ đến − tick·50) trên 64 snapshot: bước LÊN (máy chủ bỏ tick khi quá tải) chỉ theo sau 6,4 s → mọi người khác bị ngoại suy/khựng | `interp.js TickBase` (worker + `createSnapClock`): 12 mẫu cuối là CAO NGUYÊN (dao động ≤ 60 ms) cao hơn mốc > 40 ms → lấy lại mốc từ nửa mới hơn. TCP kẹt rồi xả chùm (độ lệch giảm 100 ms/mẫu) không phải cao nguyên → không lấy lại mốc | `tests/net/interp.test.mjs` (K = 1/2/4/8 tick bị bỏ → sai số < 16 ms sau 1,5 s; rung 0–90 ms 60 s ≤ 1 lần lấy lại mốc; mô phỏng TCP kẹt + resume cũ vẫn đạt). Đo lại kịch bản phản biện (6,4 s sau sự cố, chạy 5 m/s): khung đang ngoại suy K=2/4/8: 80/100/100 % → **9/22/34 %**, sai số p95 0,29/0,74/1,62 m |
| UX-1 | Mọi thời lượng (khoá chat, cấm, chờ, ETA) hiện "22" | `tf()` thay tham số trên chuỗi GỐC, một lượt (tham số thắng biến chung `{N}`; giá trị không bị quét lại) | `mp2_c1_unit` §6; e2e + điện thoại: "🔇 Bạn bị khoá chat 10 phút." / "Bạn đang bị khoá chat (10 phút)." |
| SAFE-1 | `?server=<tên miền bất kỳ>` được nhớ ngầm → đường lừa lấy mã khôi phục | `config.js`: chỉ DEFAULT_SERVER / localhost / host người chơi đã xác nhận (`hp3d.serverTrust`) được nhớ; máy lạ → `cfg.untrusted` → `net.js` hiện hộp "⚠️ Máy chủ lạ" (tên máy chủ chữ 24 px) TRƯỚC mọi request (không làm mới token, không tạo tài khoản, không gửi mã khôi phục). "Không" → quên địa chỉ, chơi một mình. Ô mã khôi phục ghi rõ "Mã sẽ gửi tới máy chủ: host" | `mp2_c1_unit` §7; trình duyệt: hộp hiện, **0 request** tới máy lạ, từ chối → nút "Bắt đầu khám phá", localStorage trống |
| SAFE-2 | Danh sách chặn ở máy theo netId phiên (netId cấp lại sau khi máy chủ khởi động) | Xoá ở mọi WELCOME không resume (danh sách theo TÀI KHOẢN ở máy chủ vẫn giữ); mục "Đã chặn" + Bỏ chặn trong bảng 👥; chặn khi mất kết nối → báo "Chưa kết nối", không chặn giả | điện thoại: chặn → mục Đã chặn 1 dòng → Bỏ chặn → hiện lại |
| SAFE-3 | Chỉ báo cáo/chặn được người đã CHAT; người bị chặn vẫn hiện | Bảng **👥 Người chơi quanh đây** (chạm biểu tượng kết nối hoặc nút 👥 trong ô chat): người đang thấy, gần trước, mỗi dòng → menu Báo cáo/Chặn (`chatRef` 0). `remote_avatars.hide(netId)`: người đã chặn không vẽ thân/vòng sáng/bảng tên/chấm minimap | e2e: 60 dòng, người bị chặn `drawn=false`; test node `hide()` |
| MOB-1/2/3 | Màn tiêu đề ngang: nút dưới nếp gấp; dọc: biểu tượng kết nối tràn trái; ngang: chat đè bảng nhiệm vụ | CSS: cao ≤ 500 px ẩn giới thiệu/phụ đề, 2 ô nhập cạnh nhau; ≤ 520 px rộng: biểu tượng = chấm + 👥 N (chữ đầy đủ ở `aria-label`), `#topRight` xuống dòng; ngang thấp: khung chat sang phải cần điều khiển (left 168 px), mở chat thì cất bảng nhiệm vụ | 844×390 / 740×360 / 667×375: hai nút ở y ≤ 259; dọc 390: `#topRight` x 12…378; chat không chồng bảng nhiệm vụ/cần điều khiển |

Việc nhỏ làm kèm: menu Báo cáo đặt CẠNH tên (không che tin), cao tối đa bằng màn hình (cuộn); placeholder chat ngắn trên cảm
ứng và GIỮ ô chat mở sau khi gửi; tên trong chat gạch chân chấm (biết chạm được); biệt danh chuẩn hoá NFC trước giới hạn 16 ký tự;
`refresh_reused`/`unauthorized` lúc tải → mở sẵn ô mã khôi phục; vé mới (`needTicket`) tôn trọng SYSTEM BACKOFF + backoff 'auth';
`ra.frame` dùng dt THẬT (giờ máy chủ) cho tốc độ/nghiêng (dưới 20 fps không phóng đại); `__hp.net` chỉ khi `navigator.webdriver`
hoặc `?qa`; `PW_PATH` mặc định của tools/qa trỏ `scratchpad/pw`.

**Số đo lại** (máy chủ native `HPMP_TEST=1` 9260/9261, tĩnh 8817, Radeon 890M TIER 3, 1 Chrome dưới khoá GPU):
`mp2_int_e2e.mjs --bots 96` **27/27 ĐẠT** (24 bước cũ + 3 mới: bảng 👥/ẩn người chặn, CORRECT nhỏ, khoá chat đúng phút; bước
RESUME có thêm kiểm bóng ma), 0 lỗi JS (1 dòng 403 của bước mã mời sai). A/B mô-đun (84 người trong khung, fps không kẹp):
draw call +3, 0 chương trình shader mới, khung trung bình +0,04 ms; TIER 1: trần 40, draw call +4, +0,37 ms.
Điện thoại (`hp-world-work/mp2/fixer1/mobile_probe.mjs`, 844×390 cảm ứng + 6 bot): **14/14 ĐẠT**.
Còn mở (thấp): ~~rác mỗi khung của bảng tên (chuỗi khoá per tag, mảng UV) ~0,5 MB/s~~ (ĐÃ SỬA §9.9); ENTER keyframe rải 24/snapshot → tới 72
người không có mẫu 0,1–0,3 s sau RESUME; xoay tại chỗ gửi STATE 2 Hz; rejoin giữ vị trí cục bộ khi lệch ≤ 12 m.

### 9.8 Riders fixer (15/10/2026) — không kéo về oan người chơi / bot trung thực

**Vật lý thật vs trình kiểm.** `js/vehicles.js`: xe máy 16 m/s (ga 3,6 m/s², không có tăng tốc nào khác), xích lô 4,2, thuyền
10; đi bộ 3 / chạy 7 (main.js), nhảy giữ tốc độ ngang; mỗi khung dt ≤ 50 ms. Trình kiểm (`move.js`): ≤ vmax·1,2 + 1 m trong
cửa sổ 1 s / 300 ms / 4 s (thời gian client). Dốc xoắn / nhịp cầu: quãng 3D ≥ 2D nên tốc độ 2D chỉ nhỏ hơn. ⇒ hằng số và trình
kiểm KHÔNG sai; mọi CORRECT oan đo được đều do đường dữ liệu:

| # | Nguồn (đo bằng log `"msg":"correct"` mới) | Sửa | Kiểm |
|---|---|---|---|
| R1 | **Bot đóng dấu sai giờ.** e2e MP-2 (dot3): 28 bot đang lái xe máy bị CORRECT SPEED trong CÙNG 1 ms, cửa sổ 300 ms (`win` 2), 5,8 m trong 0,22 s (26 m/s, bot chạy 14,4). Bot tính vị trí ở `now` chung của vòng tick 96 bot nhưng lấy `clientMs` lúc GỬI; vòng sự kiện khựng giữa vòng (GC / IPC Playwright cùng tiến trình) → mẫu kế mang cả quãng khựng trong khe dấu 20–60 ms → 3 STATE bị từ chối liền → CORRECT. MP-1 không gặp vì bot chạy ở worker ít cấp phát | `bot.mjs`: `posT = now` ở tick, `clientMs` = `posT` (giờ của VỊ TRÍ). Client thật đã đúng (preFrame ngay sau di chuyển, dt kẹp 50 ms) | `riders_regress` (bot thật + Validator thật + khựng 120–280 ms giữa vòng: 0 vi phạm; cách đóng dấu cũ: có CORRECT); `tools/qa/mp_converge.mjs` 96 bot, 122 lần khựng: **0 CORRECT** |
| R2 | **Bot sau khi máy chủ khởi động lại.** Bot giữ vị trí + `corrEpoch` cũ, máy chủ neo ở vị trí lưu ≤ 30 s trước (epoch 0) → 7 SPEED bước đầu (`win` 4) + 29 SERVER_MOVE (epoch lệch) trong e2e; khi bot ở xa (đang lái) → 84 TELEPORT / 96 bot | `bot.mjs _rejoin`: WELCOME phiên mới → epoch 0; lệch > `REJOIN_SNAP_M` (12 m, nay ở constants.js, client dùng chung) → về điểm máy chủ, bỏ chế độ quảng trường, đi lại tới điểm hẹn | test (xa/gần/RESUME); `mp_converge --restartAtS 170` (96/96 bot đang đi bộ quanh điểm hẹn): **0 CORRECT** |
| R3 | **Client: lên rồi xuống xe giữa 2 STATE.** Máy chủ chỉ tha +9 m cho bước CÓ đổi chế độ; lên + xuống trong 66 ms → máy chủ thấy ĐI BỘ A → ĐI BỘ C cách 2–6 m → 3 STATE từ chối → CORRECT | `net.js stateNowAfterMount`: gửi STATE NGAY sau mỗi `onMount`/`onDismount` (cách STATE trước ≥ 30 ms — xô token 25/s), bước nhảy không tính vào vận tốc | test (khoảng 60–400 ms, 7 hoán vị: 0 vi phạm; client cũ: có); trình duyệt thật 28 + 21 lần lên/xuống: 0 |
| R4 | **Client: xe giao thông xô người đi bộ.** `traffic.pushOut` đẩy người ra khỏi thân xe đang chạy, không giới hạn → chạy 7 m/s bị xô thành 9,6 m/1 s trên mặt cầu HVT → CORRECT SPEED (`mp_riders` lượt 3) | `main.js updatePlayerOnFoot`: quãng dời mỗi khung ≤ tốc độ CHẾ ĐỘ (đi 3 / chạy 7, đúng luật `curMode` của STATE) × dt × 1,1 | `mp_riders` lượt 6: bài đi/chạy/nhảy trên nhịp cầu HVT 0 vi phạm |
| R5 | Phụ (thế giới): xe máy kẹt sát lan can chỗ dốc xoắn gặp nhịp HVT (−48, −905), lùi–tiến nhiều lần → cú đẩy của `resolveCollisions` đưa xe qua mép → rơi 14,5 m xuống đất dưới vòng xoắn, kẹt | `vehicles.js`: đẩy mà tới chỗ `blockedAt` (thấp hơn > 1,2 m, nước, gờ) → về chỗ cũ, dừng | không tái hiện ở lượt 6 (dốc xoắn lên + xuống); chưa có ca tái hiện chủ động (mục còn mở) |
| R6 | Trình kiểm: cú nhảy 155 m rơi vào DẢI ngoài vùng chơi ≤ 50 m chỉ bị chấm OUT_OF_BOUNDS 1 điểm/STATE (bot đứng: 2 Hz → 3 s mới CORRECT) | `move.js`: ngoài vùng (dải mềm) vẫn xét TELEPORT trước — cứng, CORRECT ngay. KHÔNG nới gì | test; abuse 22/22 |

**Log trình kiểm.** `gateway.js`: mỗi CORRECT một dòng info `"msg":"correct"` (netId, account, reason, mode/prevMode, `dist`,
`limit`, `win` 1 = 1 s · 2 = 300 ms · 3 = 4 s · 4 = bước đầu, `spanMs`, `dtS`, `points`, `lead` (ms, âm = trễ), `clamped`, from/to,
`spd`); tối đa 40 dòng/phiên. `LOG_LEVEL=debug`: cả STATE bị từ chối (`"msg":"violation"`). `MoveCheck.lastWin/lastSpan`.

**Tay cầm QA (codebase_hooks §9 mục 17).** `js/qagate.js qaAllowed()`: localhost / 127.0.0.1 / [::1] / *.localhost hoặc `?qa=1`
(không theo `navigator.webdriver`). Ngoài đó: `__hp.net` = null; khi ONLINE `__hp.teleport` từ chối, `__hp.pState/world/vehicles/
mount/player/traffic/footprints` đọc ra null (chơi một mình giữ nguyên). launch/shoot/clearance/mp2_nonet thêm `qa=1`.
`tools/qa/mp_qagate.mjs` (host `qa-off.example` → 127.0.0.1, webdriver = true, online): ĐẠT; `?qa=1` trên cùng host → có lại.

**Số đo** (máy chủ native `HPMP_TEST=1` 9310/9311, tĩnh 8821, Radeon 890M TIER 3, 1 Chrome dưới khoá GPU; đầu ra
`C:/Users/Admin/hp-world-work/mp2b/riders/`):
- e2e MP-2 (`mp2_int_e2e --bots 96`), cùng mã dot3 + chỉ thêm log (`e2e_base`): bot trung thực **64 CORRECT** (SPEED 35 = 28
  cùng 1 ms `win` 2 + 7 bước đầu sau khởi động lại; SERVER_MOVE 29). Sau sửa (`e2e_after2`): **27/27 bước, bot trung thực 0** —
  CORRECT duy nhất của bot là bot gian lận (TELEPORT cứng ngay); trình duyệt chỉ bị CORRECT ở các bước cố ý (teleport, lệch nhỏ).
- `mp_converge` 96 bot, 240 s, 122 lần khựng 120–280 ms giữa vòng tick, khởi động lại máy chủ ở giây 170 (96/96 bot đang đi bộ
  quanh điểm hẹn): **0 CORRECT**, 0 dòng correct.
- `mp_riders` lượt 6: 698 s trên xe, 4,6 km, tốc độ tối đa 15,64 m/s, cao nhất 20,6 m (nhịp HVT), lên dốc xoắn + nhịp tới r 1.500
  + quay đầu + xuống (7.581 / 7.025 khung chạy > 3 m/s trên 2 đoạn), phố 5.582 khung, cầu Lạc Long 482 khung; bài A (đi/chạy/
  nhảy/đổi Shift 10 lần), B (28 lần lên/xuống 60–400 ms), D (trên nhịp cầu: xuống xe, đi/chạy/nhảy, 21 lần lên/xuống): **0 CORRECT,
  0 dòng correct, 0 dòng violation (LOG_LEVEL=debug)**, 0 lỗi JS. (Lượt 3 — trước sửa R4 — bắt được 1 CORRECT SPEED khi CHẠY trên
  nhịp cầu: 9,55 m / 0,98 s, xe máy giao thông ngay đó. Bước rơi của lượt 3/6 là giả: bộ đo không xoá độ cao khi tạm dừng cho
  bài D đi bộ dọc nhịp dốc — đã sửa.)
- abuse 200 (16 lớp): **22/22 chấp nhận**, speed_hack 46/46 (p50 468 / max 624 ms), teleport 14/14, clock_dilation 11/11,
  người quan sát 0 CORRECT. `mp_qagate` ĐẠT. diag full 0 lỗi; `mp2_nonet` full: 0 request mạng/WebSocket, 0 lỗi; waterbfs đạt.
  `npm test` 160 (159 đạt, 1 bỏ qua sẵn), tests/net 23/23, `mp2_c1_unit` 278/278.

**Công cụ.** `tools/qa/mp_riders.mjs` — 1 Chrome (khoá GPU) trên máy chủ test LOG_LEVEL=debug: đi/chạy/nhảy/đổi Shift, lên–xuống
dồn dập, tài xế tự động bấm W/A/S/D (KeyboardEvent → input.js) theo đồ thị phố thật + dốc 248 → dốc xoắn 349 → nhịp 242 tới
r 1.500 → quay đầu → xuống → cầu Lạc Long; trên nhịp cầu: xuống xe, đi/chạy/nhảy, lên–xuống dồn dập. ĐẠT = 0 CORRECT trình duyệt +
0 dòng correct/violation + 0 lần rơi. `tools/qa/mp_converge.mjs` — 96 bot dồn về 1 điểm (như e2e) + khựng vòng sự kiện +
khởi động lại máy chủ.

### 9.9 Bảng tên trong đám đông dày — gỡ chồng trên màn hình + 0 rác mỗi khung (15/10/2026)

Đóng 2 việc mở của §9.6/§9.7: "96 người trong 13 m → bảng tên chồng nhau" và "rác mỗi khung của bảng tên ~0,5 MB/s".
Phạm vi: `js/net/nametags.js`, móc nhỏ trong `js/net/remote_avatars.js`; test `tests/net/nametags.test.mjs`; công cụ
`tools/qa/mp_tags_{declutter,page,summary}.mjs` (+ kịch bản `SC.dense` trong `tools/qa/mp_c2_page.js`). Không đổi giao thức,
máy chủ, `main.js`, `net.js`.

**Cách làm.** `remote_avatars` đưa MỌI người có tên trong 25 m (≥ 2,5 m) vào `tags.tagA()` theo THỨ TỰ ƯU TIÊN = khoảng cách
× 0,7 nếu bảng đang hiện × 0,25 nếu là bạn (`setFriends`) / × 0,5 nếu huy hiệu 1 (sắp xếp chèn trên mảng tái dùng).
`nametags` chiếu từng bảng ra hình chữ nhật màn hình (đơn vị nửa-chiều-cao NDC, từ R/UP/F của camera — không cần cỡ canvas)
và xếp chỗ THAM LAM: chỗ gốc trên đầu trống → giữ; bị chiếm → thử 1 NẤC XẾP CHỒNG (nâng đúng 1 bảng); vẫn không → ẩn; ≤ 24
chỗ. Chống nháy: (1) trễ không gian — bảng đang hiện thử va chạm với hình thu 85 % (chấp nhận chồng ≤ ~7 % bề rộng), bảng đang
ẩn phải trống thêm lề 0,012 (~4 px); (2) trễ thời gian — bị chiếm liên tục 0,3 s mới ẩn, đã bị ẩn vì chồng phải trống 0,6 s
mới hiện lại, hạ khỏi nấc chồng sau 0,5 s trống; bảng mới vào tầm (quay camera) hiện ngay; (3) hiện/ẩn mờ dần 0,2/0,25 s bằng
4 MỨC MỜ có sẵn trong atlas (× co giãn 85 → 100 %) — không alpha theo đỉnh → không chương trình shader mới; (4) ô atlas đang
được vẽ ở khung trước không bao giờ bị LRU lấy (bản cũ có thể lấy → bảng mất 1 khung). Bảng gần đầu hơn: viên thuốc cách đỉnh
đầu 0,12 m ở 5 m → 0,2 m ở 25 m (bản cũ +0,22 m + lề ô → người gần có bảng lơ lửng, trông như của người phía sau).

**0 cấp phát ở vòng nóng** (nguyên nhân rác đo được, không chỉ khoá chuỗi): (a) SỐ THỰC TRUYỀN LÀM THAM SỐ cho hàm không được
inline bị đóng hộp (HeapNumber mỗi số mỗi lần gọi) — `quad(12 số)`, `tag(6)`, `ring(6)` → khối tham số `Float64Array`
(`tags.args` + `ringA(away)` / `tagA(netId, name, badge, away)`; `ring()`/`tag()` rời vẫn giữ cho test); (b) số thực gán vào
biến closure `let` mỗi khung (dt, tanH, aspect; lastNow, selAt, EMA của remote_avatars) → `Float64Array`; (c) bản ghi người
khởi tạo trường số thực bằng 0,5 (không phải Smi 0 → không đổi hidden class → không khử tối ưu "wrong map"); (d)
`addUpdateRange` đẩy 1 đối tượng mỗi khung → `_updateRange` của three r160; (e) khoá chuỗi `netId|badge|level|name` → bản ghi
theo netId + `Int16Array` ô theo mức; mảng UV → ghi thẳng; `Set` hàng chờ → mảng số; (f) `Array.prototype.sort` + hàm so
sánh mới, `drawnList.length = 0` (V8 nhả bộ đệm), `list.slice()`, `toFixed`, `Math.hypot` (builtin cấp phát) trong `frame()`;
sắp xếp chèn dùng khoá biến `v[key]` cũng đóng hộp (TIER 1: 280 KB/s) → mỗi trường 1 hàm.

**Số đo** (`tools/qa/mp_tags_declutter.mjs`, tĩnh 8823, 1 Chrome dưới khoá GPU, Radeon 890M, 1280×720; trước = mô-đun dot3
5da02c1 cùng công cụ; đầu ra `C:/Users/Admin/hp-world-work/mp2b/nametags/{before,after}/`, `summary.json`). "Chồng" = cặp bảng
trên màn hình giao nhau > 15 % diện tích bảng nhỏ hơn (đọc tứ giác billboard từ bộ đệm đỉnh, chiếu bằng camera); "bật/tắt" tính
trên người có đầu trong màn hình cách camera 3–24 m ở cả 2 khung; "nháy" = bật/tắt lại < 0,5 s.

| TIER 3 (full), 96 người | trước: cặp chồng · bật/tắt/s · nháy/s · bảng | sau: cặp chồng · bật/tắt/s · nháy/s · bảng |
|---|---|---|
| Đám đông dày 13 m, camera đứng, 20 s | 14,7 (tối đa 26) · 6,36 · 1,84 · 24 | **0,64** (tối đa 4) · 5,15 · **0** · 21,6 |
| như trên, camera quay 0,15 rad/s | 5,33 (14) · 7,14 · 1,75 · 24 | **0,69** (4) · 5,05 · **0** · 22,4 |
| góc cao 12 m nhìn xuống | 7,13 (11) · 6,16 · 1,0 · 24 | **0,52** (2) · 3,99 · **0** · 22,5 |
| Quảng trường Nhà hát (kịch bản crowd C2) | 0,53 · 2,0 · 1,0 | **0,13** · 0,62 · **0** |

TIER 1 (lite, trần 40): đám đông dày 14,8 → **0,73** cặp, nháy 1,81 → **0**; quay 5,08 → 0,86; góc cao 7,4 → 1,05, nháy 1,83 → 0.
Lượt bảng tên (ring() đầu → end(), gồm chọn/sắp ứng viên): TIER 3 0,09 → **0,13–0,16 ms** trung bình (p95 0,2 → 0,3–0,4 ms; xét
~74 ứng viên thay vì 24), TIER 1 0,07 → 0,10 ms. fps 60 (vsync) trước = sau; draw call mô-đun 3 = 3; chương trình shader trước
khi có mô-đun → sau như bản cũ (TIER 3 74 → 76, TIER 1 51 → 51 — 0 chương trình mới so với dot3); 0 lỗi JS.
Rác (CDP HeapProfiler lấy mẫu gồm cả vật đã GC, 3 cửa sổ 20 s, đám đông dày đi + camera quay; cửa sổ cuối): `nametags.js`
**326 → 21 KB/s** (còn lại = vẽ ô mới vào canvas khi bảng đổi mức/hiện — không phải trạng thái ổn định), `remote_avatars.js`
**1.250 → 257 KB/s** (TIER 1: 766 → 227); heap sau GC tăng 0,45 MB/60 s cả trước lẫn sau (không rò). Test node (`node --import
./tests/net/register.mjs --test tests/net/nametags.test.mjs`): A/B cùng đám đông chồng < 10 % bản không gỡ, 0 nháy trong 10 s
đi bộ, trễ ẩn/hiện đúng khung, bạn thắng người lạ gần hơn, vòng nóng nametags + remote_avatars < 64 B/khung (bản cũ ~6 KB/khung).

**Còn mở:** phần rác còn lại của `remote_avatars.js:frame` (~250 KB/s) theo bộ lấy mẫu nằm ở mã `interp.js` được INLINE vào
`frame()` (`Track.sample/_raw/_vel` ghi số thực + `Math.hypot` — builtin cấp phát; trong node tách được: `sample`/`_raw`/`_vel`
1,5–4,5 KB/khung khi ngoại suy) cùng `interp.js:push` 55 KB/s ở đường mạng — sửa ở `interp.js` (ngoài phạm vi lượt này):
`Math.hypot` → `Math.sqrt`, trường `out` khởi tạo số thực. Xếp chỗ tham lam theo ưu tiên (không tối ưu toàn cục) — đám đông
13 m ở 8 m camera hiện ~21/74 bảng; tên dài (40 ký tự) chiếm chỗ hơn. Chưa có "đường dẫn" nối bảng ở nấc chồng với người.
