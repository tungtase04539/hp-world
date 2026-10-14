# Máy chủ multiplayer — ghi chú kỹ thuật (as built)

Tài liệu kỹ thuật của thư mục `server/` và `js/shared/`. Mỗi gói việc (S2 game, S3 chat/quản trị, S4 bot, S5 vận hành)
**thêm một mục riêng** ở cuối file này. Kế hoạch: `KE_HOACH.md` (thắng khi khác `ARCH.md`). Hợp đồng module:
`server/CONTRACT.md`. Hướng dẫn cho chủ dự án (không thuật ngữ): `VAN_HANH.md` (S5).

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
- **Ngân sách thời gian** (−100 / +200 ms): `o = giờ server nhận − giờ client` (u16 được mở gói; khoảng trống > 30 s
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
- **Chưa kiểm** (v1): độ cao y, xuyên tường (cần collider export — ARCH §12.4), gia tốc.
- **Đánh đổi đã đo** (`test/core_move.test.js`): trung thực → 0 CORRECT với jitter 0–300 ms, rớt sóng 1–3 s mỗi 8 s,
  bufferbloat 800 ms, 2 Hz khi đứng, đổi chế độ + lên/xuống xe, tab ẩn 70 s, đồng hồ lệch 0,1 %. Bufferbloat ≥ 1,5 s kéo
  dài > 10 s rồi xả trong 1 s có thể tốn **1** CORRECT (giá của trần +200 ms). Hack tốc độ ×1,5 bị CORRECT < 2,5 s;
  đồng hồ client nhanh ×2 < 8 s, ×1,5 < 12 s, ×1,25 < 45 s (lợi 25 % tốc độ trong khoảng đó).

### 2.5 AOI, snapshot, thang suy giảm

- Ứng viên: 3×3 ô quanh ô (hysteresis 8 m) của người xem, bán kính 160 m (≤ 120 m: 10 Hz; 120–160 m: tầng xa 5 Hz);
  người đang thấy chỉ rời khi > bán kính + 8 m. Tối đa **96** người thấy cùng lúc: điểm = d² / trọng số² (trọng số 2 cho
  người đang lái xe), người đang thấy được nhân 0,72 (chống đổi qua lại); ngưỡng = phần tử thứ 96 (quickselect, không
  sort cả danh sách). ENTER ≤ 24/snapshot (keyframe 96 người rải qua 4 snapshot ≈ 0,4 s). Chỉ gửi UPDATE cho người **có
  thay đổi** kể từ lần gửi trước (người đứng yên tốn 0 byte); vượt ngân sách 1.100 B / 96 bản ghi → bộ tích luỹ ưu tiên
  `+= w/(d+10)` mỗi snapshot, gửi điểm cao trước, reset khi gửi.
- NAMES: mỗi người 1 lần mỗi phiên của người xem (nhớ theo `netId` + `gen`; netId được tái dùng → gửi lại).
- `bufferedAmount > 16 KB` → bỏ snapshot, lần sau là KEYFRAME (client xoá bảng slot).
- Thang: L1 (p99 tick > 25 ms) tầng xa 2,5 Hz · L2 (> 35) bán kính 80 m · L3 (> 45) snapshot "mỏng" xen kẽ (bản thân +
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
| Tài khoản / thiết bị | guest 5/giờ/thiết bị · recover 5/giờ/thiết bị (+ 300/giờ toàn máy chủ) · join 0,5/s burst 10 · HELLO 1/s burst 10 · refresh 1/s mỗi token |
| IP (lỏng vì CGNAT) | guest 30/giờ · recover 20/giờ · refresh 10/s · join 50/s · kết nối WS mới 20/s burst 300 · socket chưa HELLO ≤ 64/IP, ≤ 5.000 toàn máy |
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
