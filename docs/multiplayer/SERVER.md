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
