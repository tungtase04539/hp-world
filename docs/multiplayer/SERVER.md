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
