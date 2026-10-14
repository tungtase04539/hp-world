# Hải Phòng 3D — KIẾN TRÚC MULTIPLAYER (1.000+ người chơi trong MỘT thành phố)

Ngày: 2026-10-14 · Nhánh tham chiếu: `dot3` @ `bcdcacc` · Tác giả: kiến trúc sư mạng/backend (Claude)
Đầu vào: `research_backends.md`, `research_hosting.md`, `research_netcode.md`, `codebase_hooks.md` (cùng thư mục) + đọc repo.
Ký hiệu độ tin cậy: **[Đo]** số đã đo/đọc từ nguồn gốc · **[Ng]** nguồn thứ cấp · **[ƯT]** ước tính của tôi, PHẢI kiểm bằng spike/load test ở §17.

> Quyết định chủ dự án đã chốt: (1) sinh tồn kiểu "đời sống thành phố" (đói/khát/thể lực/máu/thân nhiệt/tiền, nghề: shipper, xe ôm, bán hàng rong, bốc xếp cảng, ngư dân, hướng dẫn viên; ăn uống ở quán thật; thời tiết có bão); (2) multiplayer LÀM TRƯỚC, mục tiêu > 1.000 CCU cùng một thế giới; (3) chơi ngay bằng nickname, tùy chọn đăng nhập Google để giữ tiến trình; (4) nhiệm vụ + cốt truyện lịch sử/văn hoá Hải Phòng làm sau, trên nền multiplayer. Client vẫn là site tĩnh.

---

## 0. Tóm tắt quyết định (đọc bảng này là đủ để bắt đầu)

| # | Hạng mục | Quyết định | Á quân / lối thoát |
|---|---|---|---|
| 1 | Stack server | **Node.js 24 LTS + uWebSockets.js** (fallback thư viện `ws`), JS thuần ESM, **dùng chung mã với client** qua `js/shared/` | Colyseus self-host (MIT) là á quân; Cloudflare Durable Objects là Plan B zero-ops; SpacetimeDB self-host đánh giá lại Q1/2027 |
| 2 | Hình dạng hệ thống | **Gateway (N, gần như không trạng thái) ⇄ Zone sim (M, có trạng thái) ⇄ Postgres**. Gateway giữ **bản sao toàn thế giới** (world mirror) và tự lắp snapshot theo AOI cho từng client → nhìn xuyên zone miễn phí, handoff vô hình | Ghost-band giữa các zone (cổ điển) — không cần vì mirror rẻ (≤ 1,2 MB/s/gateway ở 10k CCU) |
| 3 | Mở rộng theo giai đoạn | **A**: 1 tiến trình (≤ 500 CCU) → **B**: 1 máy, `worker_threads` gateway + 1 sim thread, SharedArrayBuffer (≤ 3.000) → **C**: nhiều máy, bus NATS, zone theo ô 128 m (3.000–10.000+). **Cùng một giao diện** `Bus`/`Transport`/`Repo` ở cả 3 | Khi hotspot không gánh nổi: "lớp" (layer) cùng bản đồ, mềm, theo nhóm bạn |
| 4 | Không gian | Lưới ô **128 m** (25×25, ~484 ô trong đĩa R≈1.588 m). Zone = tập ô liền nhau, chia theo **mật độ thực** (k-d split), ranh giới ưu tiên theo sông/đường lớn; **hysteresis 16 m** | — |
| 5 | AOI | Ô hiện tại + 8 ô lân cận (384 m), bán kính mềm 160 m; **trần 96 bản ghi/snapshot**, ưu tiên bằng *priority accumulator*; tầng xa 5 Hz; thang suy giảm L0–L4 | — |
| 6 | Transport | **WebSocket `wss://` nhị phân, 1 kết nối/client**, mở trong **Web Worker**; WebTransport (datagram) thêm sau sau feature-detect | — |
| 7 | Nhịp | Server world loop **20 Hz**; snapshot **10 Hz** (xe gần ≤ 40 m: 20 Hz ở P2); client gửi STATE **15 Hz** khi di chuyển / 2 Hz khi đứng | — |
| 8 | Quyền di chuyển | **v1: "client đi trước, server kiểm" (trust-but-verify, kiểu WoW)** — client gửi trạng thái, server kiểm tốc độ/ngân sách thời gian/đất-nước/footprint và kéo lại (CORRECT) khi sai. Kinh tế/sinh tồn/nhiệm vụ **100 % server**. | **v2 (khi có PvP/đua có thưởng)**: input-authoritative, `stepPlayer` bước cố định 30 Hz chung client/server + reconcile |
| 9 | Client-only | Giao thông + người đi đường (traffic.js, props walkers), mây, âm thanh — **mỹ thuật, không đồng bộ** | Vật thể "đường ray" (xe buýt/phà) = hàm thuần của `(route, serverTime)` ở P4 |
| 10 | Lưu trữ | **Postgres 17** (tài khoản, nhân vật, ví + **sổ cái kép**, kho đồ, nhiệm vụ); **Valkey** (phiên, presence, rate-limit) từ giai đoạn B; trạng thái nóng trong RAM zone, flush 30 s + theo sự kiện | Supabase/Neon Singapore nếu không muốn tự vận hành DB |
| 11 | Đăng nhập | **Guest server-side** (nickname → tài khoản khách, refresh token trong localStorage) + **"Liên kết Google"** (GIS ID token, server tự xác thực, không Firebase). Quy tắc **"liên kết, không gộp"** | Phone-OTP "đã xác minh" thiết kế sẵn cờ — xem rủi ro pháp lý §20 |
| 12 | Hosting | **Singapore**, VM CPU chuyên dụng loại Vultr/Hetzner/DO (egress $8–10/TB), Cloudflare phía trước, **asset GLB chuyển lên R2**. Thăm dò RTT thật 2 tuần rồi quyết định thêm nút **Hà Nội** | Hà Nội làm chính nếu RTT/cáp biển xấu hoặc luật yêu cầu dữ liệu trong nước |
| 13 | Chi phí/tháng [ƯT] | **1k CCU ≈ $330** · **3k ≈ $930–1.150** · **10k ≈ $3.000** (kịch bản "căng" 100 % tải 24/7, 8 KB/s/người: $340 / $1.300 / $3.800) | Managed (Heroic, Maincloud, AWS egress): gấp 4–15 lần |
| 14 | Chống gian lận | Server-authoritative cho mọi thứ có giá trị; ngân sách thời gian lệnh; giới hạn động học theo chế độ; điểm vi phạm tích luỹ (không ban vì 1 lần); toàn bộ tiền đi qua sổ cái | — |
| 15 | Kiểm duyệt | Chat theo khoảng cách (40 m), lọc tiếng Việt cục bộ (bỏ dấu, teencode), báo cáo + mute/shadow-mute, giới hạn tần suất; **không dùng Perspective API** (tắt 31/12/2026) | ML kiểm hậu (omni-moderation) tùy chọn, không chặn gameplay |
| 16 | Rủi ro số 1 | **Pháp lý (Nghị định 147/2024, game G1)** — xác thực số điện thoại VN, lưu dữ liệu trong nước, giới hạn giờ chơi < 18 tuổi. **Phải hỏi luật sư trước khi mở công khai.** Kiến trúc đã chừa móc (cờ `verified`, đếm giờ chơi, xuất/xoá dữ liệu, chuyển vùng trong nước) | — |

---

## 1. Bối cảnh và các con số làm nền

| Thông số | Giá trị | Nguồn |
|---|---|---|
| Đĩa chơi | `PLAY_RADIUS = BUILD_RADIUS − 12` ≈ **1.588 m**, đường kính ≈ 3,18 km, diện tích ≈ 7,92 km² | `js/main.js:126` |
| Mật độ trung bình | 1k CCU ≈ 126 người/km²; 3k ≈ 380; 10k ≈ 1.260 | tính |
| Tốc độ hợp lệ | đi 3,0 · chạy 7,0 · xe máy 16 · xích lô 4,2 · thuyền 10 m/s; nhảy 6,5 m/s, trọng lực 26 (đỉnh ≈ 0,81 m) | `main.js:333`, `vehicles.js:154-208` |
| Ngày game | `DAY_LENGTH = 1440` s thật | `daynight.js:20` |
| Vòng frame | `dt = min(getDelta, 0.05)` — dt biến thiên, không bước cố định | `main.js:707` |
| Boot | `buildWorld` chặn luồng chính 17–35 s | PROJECT_MAP §0 |
| Frame CPU-bound | ≈ 23 µs/draw call, 672 draw call ở điểm spawn → avatar người chơi khác phải là **số draw call cố định** | PROJECT_MAP §0 |
| RTT tới Singapore | HN→SG 44 ms, HCM→SG 47 ms (server-server, 14/10/2026); người chơi Hải Phòng ước **50–75 ms cáp quang, 70–120 ms p50 4G** | research_hosting §2 [Đo/ƯT] |
| Cáp biển | 25/08/2026 mất ≈ 30 % dung lượng quốc tế; AAE-1 hỏng từ 02/2026 | research_hosting §2.4 [Ng] |
| Pháp lý | NĐ 147/2024: game nhiều người qua server = G1 | research_backends §7 [Ng] |

---

## 2. Stack đã chọn và lý do

### 2.1 Chọn: server tự viết Node.js 24 + uWebSockets.js

1. **Không sản phẩm nào cho sẵn "một thành phố liền mạch 1.000–10.000 người".** Nakama, Colyseus, Durable Objects, SpacetimeDB đều chia theo phòng/match/actor/DB; lớp không gian (zone, nhìn xuyên biên, chuyển giao) đằng nào cũng phải tự viết. Giá trị cộng thêm của chúng chủ yếu là auth + hosting — hai thứ rẻ để tự làm.
2. **Cùng ngôn ngữ với client** → dùng lại *chính xác* `terrain.js` (`groundHeight`, `landAt`, `isWater`), `mapdata.js`, `roadgraph.js`, `skymodel.js`, `brands.js` (đều không import three, chạy được trong Node — KNOWLEDGE §2). Kiểm tra đất/nước/cầu trên server khớp từng bit với client.
3. **Chi phí do băng thông ra quyết định, không phải CPU.** VM có egress $8–10/TB so với $77–150/TB của Maincloud/Rivet/AWS: chênh 10–50 lần.
4. **Rủi ro nền tảng 2026**: Hathora tắt (05/05/2026), Unity Multiplay ngừng (31/03/2026), PlayFab thu hẹp. Tự sở hữu mã zone, chỉ thuê VM hàng hoá.
5. uWS: lõi C++, ≈ 5 KB/kết nối, cork/batch, backpressure tốt; **tắt permessage-deflate** (payload đã bit-pack).

Rủi ro đã biết và cách đỡ: uWS ít người bảo trì → bọc sau `server/src/net/transport.js`, có bản `ws` thay thế 1:1; tự viết nhiều → chia nhỏ module, test bằng bot từ ngày đầu.

### 2.2 Á quân và phương án dự phòng

| Phương án | Vì sao không chọn làm chính | Khi nào dùng |
|---|---|---|
| **Colyseus self-host (á quân, điểm 75 vs 81)** | Room = 1 tiến trình, `StateView` "chưa tối ưu cho dữ liệu lớn"; ta sẽ phải bỏ qua Schema sync và tự gửi snapshot nhị phân → còn lại ít giá trị | Nếu đội muốn matchmaking/phòng mini-game (đua xe, sự kiện có lượt) — chạy cạnh, không thay lõi |
| **Cloudflare Durable Objects (Plan B)** | ≈ 80–100 người/object ở 10 Hz (soft limit 1.000 req/s), deploy làm rớt mọi WS, không ghim được Việt Nam, khoá nhà cung cấp | Dịch vụ phụ không trạng thái nặng: bảng xếp hạng, hộp thư, lobby sự kiện; hoặc chạy khẩn cấp ≤ 1k CCU ($130–400) |
| **SpacetimeDB self-host (Plan C)** | Mô hình dữ liệu hợp MMO nhất, nhưng sharding mới ra (31/10/2026), BSL, 1 luồng/DB trong RAM | Spike lại Q1/2027 |
| Nakama | Auth/kho/ví tốt nhất nhưng lớp realtime không hợp, cluster là bản trả phí | Không |
| Photon / PlayFab / Edgegap / Rivet Cloud | Relay hoặc session-container hoặc egress đắt | Không |

### 2.3 Thư viện server (tối thiểu, đều mã nguồn mở)

`uWebSockets.js` (tag GitHub, ghim phiên bản) · `pg` (Postgres) · `jose` (JWT EdDSA + JWKS Google) · `nats` (giai đoạn C) · `iovalkey`/`ioredis` (giai đoạn B+) · `prom-client` · `pino` · `maxmind` (GeoLite2-ASN để gắn nhà mạng vào telemetry). Không ORM — SQL viết tay trong `server/src/db/repo.js`.

---

## 3. Tổng quan kiến trúc

### 3.1 Sơ đồ (giai đoạn C, 3k–10k CCU)

```
 Trình duyệt (GitHub Pages, tĩnh)                      Cloudflare (DNS, TLS edge, DDoS, Turnstile, R2)
 ┌───────────────────────────────┐   HTTPS  ┌──────────────────────────────┐
 │ main thread: three.js, HUD    │─────────▶│ api.<domain>  (API: auth,     │──┐
 │   js/net/net.js  (facade)     │          │ join, shop menu, admin)      │  │
 │ Web Worker: js/net/net_worker │   WSS    ├──────────────────────────────┤  │
 │   WebSocket + decode nhị phân │─────────▶│ gw1..gwN.<domain>  GATEWAY    │  │
 └───────────────────────────────┘          │  - TLS, rate limit, Origin    │  │
        ▲ GLB (R2 + CDN)                    │  - world mirror (mọi entity)  │  │
        │                                   │  - AOI + ưu tiên + mã hoá     │  │
                                            │  - chat SAY theo khoảng cách  │  │
                                            └───────┬──────────────▲───────┘  │
                                     input theo zone│              │ zone frame 10 Hz (mọi gateway)
                                            ┌───────▼──────────────┴───────┐  │
                                            │        NATS (bus nội bộ)       │  │
                                            └───────┬──────────────▲───────┘  │
                                            ┌───────▼──────┐ ┌─────┴────────┐ │
                                            │ ZONE 1..M     │ │ WORLD service│ │
                                            │ sim 20 Hz:    │ │ giờ/thời tiết│ │
                                            │ kiểm di chuyển│ │ sự kiện, cân │ │
                                            │ sinh tồn, nghề│ │ bằng zone    │ │
                                            │ shop, quest   │ └──────────────┘ │
                                            └───────┬──────┘                  │
                                                    ▼                         ▼
                                     Postgres 17 (primary + replica) + Valkey (phiên, presence, rate)
                                     Backup: WAL/pgBackRest → R2 · Metrics: Prometheus/VictoriaMetrics + Grafana + Loki
```

### 3.2 Vai trò tiến trình

| Vai trò | Trạng thái | Việc làm | Mở rộng |
|---|---|---|---|
| **API** (`ROLE=api`) | không | HTTP: `/v1/auth/*`, `/v1/join` (chọn gateway ít tải, phát vé), menu/giá, báo cáo, admin | ngang, sau Cloudflare |
| **Gateway** (`ROLE=gateway`) | mềm (phiên kết nối + mirror tái tạo được) | kết thúc WSS, xác thực vé, giới hạn tần suất, chuyển input tới zone sở hữu, **lắp snapshot theo AOI cho từng client**, chat SAY | ngang: ≈ 2.000 client / máy 8 vCPU [ƯT] |
| **Zone** (`ROLE=zone`) | **có** (người chơi trong các ô của nó) | kiểm di chuyển, sinh tồn, nghề, shop, hành động, quest; phát *zone frame* 10 Hz; lưu DB | theo số zone; ≈ 1.000–1.500 người/zone [ƯT] |
| **World** (`ROLE=world`, 1 bản) | ít | đồng hồ ngày/đêm, lịch thời tiết/bão, sự kiện thành phố, bản đồ ô→zone, cấp `netId` | 1 + dự phòng nóng |

### 3.3 Ba giai đoạn triển khai — cùng một mã, khác "dây nối"

| Giai đoạn | Quy mô | Bố trí | Bus | World mirror |
|---|---|---|---|---|
| **A** (MVP) | ≤ 300–500 CCU | 1 tiến trình Node: api + gateway + zone + world | `bus/inproc.js` (gọi hàm) | chính là bảng entity của zone |
| **B** | ≤ 3.000 CCU | 1 máy 8 vCPU: luồng chính = zone sim; 4–6 `worker_threads` gateway, mỗi luồng một uWS app chung cổng (SO_REUSEPORT); API là tiến trình riêng | `bus/threads.js`: input qua `MessagePort`, entity table qua **SharedArrayBuffer** đệm đôi + `Atomics` (server-side nên không vướng COOP/COEP) | SAB đọc trực tiếp |
| **C** | 3.000–10.000+ | nhiều máy gateway, nhiều máy zone, NATS 3 nút | `bus/nats.js` | mỗi gateway nhận *mọi* zone frame (10k entity × 10 B × 10 Hz ≈ 1 MB/s) |

Lý do thiết kế "gateway giữ toàn thế giới": phần tốn CPU nhất là lắp snapshot cho từng client (CPU tăng theo client × số entity nhìn thấy), và phần này **mở rộng ngang** khi đặt ở gateway. Zone chỉ còn mô phỏng nhẹ. Hệ quả: (1) nhìn xuyên ranh zone không cần ghost-band; (2) handoff người chơi giữa zone không đổi socket, không nháy hình; (3) deploy gateway lăn từng máy mà không mất trạng thái người chơi.

---

## 4. Thiết kế không gian: ô, zone, handoff, nhìn xuyên zone

### 4.1 Lưới ô

- Gốc toạ độ thế giới = Nhà hát lớn (như repo). Ô vuông **128 m**, chỉ số `cx = floor((x + 1600)/128)`, `cz` tương tự → lưới **25 × 25 = 625 ô**, ≈ 484 ô cắt đĩa chơi. `cellId = cz*25 + cx` (u16). Mã trong `js/shared/grid.js` (dùng chung client/server/bot).
- Ô là đơn vị của: AOI, sở hữu zone, phát chat SAY, bản đồ nhiệt mật độ, cân bằng tải.

### 4.2 Zone

- **Zone = tập ô liền nhau**, bảng `cell→zone` (625 byte) do World service phát kèm số phiên bản (`mapEpoch`).
- **Chia ban đầu** bằng k-d split theo bản đồ nhiệt người chơi (đo ở beta): cắt xen kẽ trục x/z sao cho mỗi zone có tải ≈ bằng nhau; đường cắt được "hút" về ranh tự nhiên gần nhất (sông Tam Bạc, sông Cấm, trục Lạch Tray / Điện Biên Phủ) vì ở đó ít người qua lại → ít handoff.
- Cỡ đích: **≤ 1.200 người chơi/zone** hoặc **p99 tick ≤ 20 ms**, điều nào đến trước. Ví dụ 10k CCU → 8 zone; 3k → 2–3 zone.
- Ô nóng (Nhà hát lớn, Chợ Sắt, hồ Tam Bạc, bến Bính) **không bao giờ bị cắt đôi**; một ô quá tải được xử lý bằng AOI/thang suy giảm (§5), không phải chia nhỏ hơn.
- **Cân bằng lại** khi một zone lệch > 30 % so với trung bình trong 10 phút: World service chuyển *từng ô ở rìa*: đóng băng ô ≤ 50 ms, handoff hàng loạt người trong ô, tăng `mapEpoch`. Không cân bằng trong sự kiện lớn đang diễn ra.

### 4.3 Handoff (chuyển quyền một người chơi sang zone khác)

```
Zone A thấy P vượt ranh vào ô của B quá 16 m (hysteresis)  ──►  A: ngừng nhận input của P, đóng gói P (≈ 200–400 B:
  vị trí, vận tốc, chế độ, chỉ số sinh tồn dạng lười, job đang làm, item cầm tay, version) ──► bus: HANDOFF(P, blob)
B: dựng P, trả HANDOFF_ACK ──► A xoá P, phát ROUTE(P→B) ──► gateway chuyển định tuyến input của P sang B,
  xả input đã đệm (≤ 50 ms)
```

- Socket không đổi; vị trí trên màn hình người khác liên tục vì gateway đã có mirror của cả hai zone. Mục tiêu: **handoff p99 < 50 ms**, 0 input bị mất.
- Ghi DB dùng **optimistic concurrency** (`characters.version`): zone nào ghi với version cũ sẽ bị từ chối → không có "bản ghi ma" sau handoff.
- Tương tác hai người ở hai zone (nói chuyện, mời nhóm, giao dịch): gửi qua bus tới zone sở hữu đối tượng; **giao dịch tiền/đồ hai bên** dùng giao dịch Postgres một lần (không 2PC giữa zone). **Xe ôm/chở người**: khi khách lên xe, quyền sở hữu khách *đi theo tài xế* (handoff khách sang zone tài xế).

### 4.4 Nhìn xuyên zone và chat xuyên zone

- Hiển thị: gateway có mirror toàn thế giới → AOI không biết đến zone.
- Chat SAY 40 m: gateway của người nói tính ô lân cận từ mirror, phát `chat.cell.<id>` lên bus; mọi gateway lọc người nhận ≤ 40 m trong mirror. Giai đoạn A/B: gọi hàm/MessagePort.

### 4.5 Van an toàn cho hotspot: "lớp" (layer)

Nếu đo thấy > ~400 người dồn vào 1–2 ô (sự kiện lớn) vượt mọi mức suy giảm: bật **layer 2** của *đúng khu vực đó* (cùng bản đồ, người chơi mới vào khu bị xếp vào layer ít người; bạn bè/nhóm luôn cùng layer). Đây là phương án cuối, chủ dự án quyết định có bật hay không; mặc định TẮT.

### 4.6 Rải điểm xuất hiện

Hiện mọi người spawn ở 1 điểm (`SPAWN`, `main.js:213`) → hotspot tự tạo. Thay bằng: người cũ = vị trí đăng xuất (nếu hợp lệ); người mới = 1 trong ~8 điểm (quảng trường Nhà hát, Chợ Sắt, bến Bính, hồ Tam Bạc, ga Hải Phòng, Cát Bi… trong đĩa chơi), chọn điểm ít người nhất, lệch ngẫu nhiên bằng `world.findFree`.

---

## 5. Quản lý quan tâm (AOI)

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| Đăng ký | ô hiện tại + 8 ô lân cận (384 × 384 m) | đổi đăng ký khi vượt ranh ô 8 m (hysteresis) |
| Bán kính hiển thị | 160 m cứng, 120 m mặc định | khớp `DRAW_R` 170/230/260 của traffic; avatar > 150 m không đọc được |
| Trần bản ghi | **96 bản ghi/snapshot**, payload ≤ 1.100 B | vừa 1 TCP segment trên mobile → giảm head-of-line stall |
| Chọn khi quá trần | `ưu tiên += trọng số × 1/(d+10)` mỗi tick, gửi top-K, reset phần đã gửi (Gaffer/Tribes) | trọng số ×4: nhóm/bạn/khách xe ôm; ×2: đang lái xe; ×1.5: mục tiêu nhiệm vụ |
| Tầng tốc độ | ≤ 40 m: 10 Hz (P2: 20 Hz cho xe) · 40–120 m: 10 Hz · 120–160 m: 5 Hz | |
| Vào/ra | `ENTER` (bản ghi tuyệt đối + appearance) / `LEAVE` (slot) | tên gửi qua `NAMES` 1 lần/phiên/người |
| Entity tĩnh | chủ quán, NPC giao việc, quầy hàng: **không gửi**, vị trí trong dữ liệu chung; chỉ gửi *trạng thái* qua EVENT | |
| Trần render client theo TIER | TIER1: 40 · TIER2: 96 · TIER3: 96 avatar; tên nổi cho 24 người gần nhất | đọc `TIER` từ `js/device.js`, KHÔNG theo cảm ứng (quy tắc dự án) |

**Thang suy giảm** (kích hoạt theo p99 thời gian lắp snapshot của gateway hoặc tick của zone, ngân sách 50 ms):
L0 bình thường → L1 (> 25 ms): tầng xa 5 → 2,5 Hz → L2 (> 35 ms): bán kính 120 → 80 m → L3 (> 45 ms): snapshot 10 → 5 Hz trừ bản thân + 16 người gần nhất → L4: ngừng nhận kết nối mới (hàng đợi có ETA). Mọi chuyển mức đều ghi log + metric.

Không có va chạm người–người (đi xuyên nhau): tránh phá game và tránh chi phí theo cặp.

---

## 6. Giao thức

### 6.1 Transport

- **WebSocket `wss://`**, nhị phân, little-endian, `DataView` trên `ArrayBuffer` cấp sẵn (0 cấp phát mỗi tick). Không nén. uWS: `maxPayloadLength 512` (client→server), `idleTimeout 20 s`, `maxBackpressure 64 KB` + `closeOnBackpressureLimit`, mỗi tick **cork** toàn bộ gửi của 1 client.
- Nếu `getBufferedAmount() > 16 KB`: **bỏ snapshot này** (mới nhất thắng), đánh dấu `needKeyframe` cho client.
- Client: socket nằm trong **Web Worker module** (`js/net/net_worker.js`) để không lỡ heartbeat trong 17–35 s dựng thế giới; worker giải mã và chuyển `ArrayBuffer` (transferable) về luồng chính 10 lần/s.
- Lớp `Transport` (client `js/net/transport_ws.js`, server `server/src/net/transport.js`) có `send(bytes)`, `onMessage`, `bufferedAmount` → thêm `transport_wt.js` (WebTransport: datagram cho snapshot + 1 stream tin cậy cho event) ở P5 nếu đo mất gói di động đáng kể. Khi chuyển sang datagram thì phải thêm số thứ tự + baseline đã ack (kiểu Quake 3); với WS thì không cần.

### 6.2 Kết nối và vé

```
1. Trang tải  → POST https://api/v1/auth/guest {nickname, deviceId, turnstileToken}      (lần đầu)
                hoặc POST /v1/auth/refresh {refreshToken}                                 (lần sau)
              ← {accessToken (JWT EdDSA 15'), refreshToken (xoay vòng), account}
2. Nhấn "Bắt đầu" → POST /v1/join {accessToken, worldVersion, tier}
              ← {wsUrl: "wss://gw3.<domain>/play", ticket (HMAC, TTL 60 s, 1 lần), netId, spawnHint}
3. Worker mở WSS; tin nhắn ĐẦU TIÊN = HELLO{ticket} (vé KHÔNG nằm trong URL vì URL lọt vào log)
4. Gateway (upgrade): kiểm Origin (allow-list), ngân sách kết nối toàn cục/IP/tài khoản → kiểm vé → đá phiên cũ của
   cùng tài khoản (1 phiên/tài khoản) → WELCOME → client dựng xong thế giới gửi READY → bắt đầu AOI (keyframe đầy đủ)
5. Mất kết nối: WELCOME có resumeToken; trong 60 s nối lại → cùng netId, cùng trạng thái; avatar hiện "vắng mặt"
   trong thời gian đó. Backoff 1-2-4-8 s + ngẫu nhiên 0–1 s (tránh tự DDoS khi deploy).
```

### 6.3 Lượng tử hoá (chung, `js/shared/quant.js`)

| Trường | Mã | Độ phân giải / tầm |
|---|---|---|
| x, z | u16 | 5 cm, tầm [−1.638,4; +1.638,35] m (phủ đĩa R 1.588) |
| y | u8 | 0,25 m, 0–63,75 m (mặt cầu, dốc xoắn HVT); remote có thể tự suy từ `surfaceY` |
| yaw | u8 | 1,41° |
| tốc độ | u8 | 0,125 m/s, 0–31,9 m/s (đủ cho xe máy 16) |
| vận tốc vx, vz (client→server) | i8 ×2 | 0,25 m/s, ±32 m/s |
| state | u8 | 3 bit chế độ {đi, chạy, trên không, ngồi, xe máy, xích lô, thuyền, ngồi sau} + 5 bit cờ {còi, emote, bận (đang mở shop), chở hàng, vắng mặt} |
| appearance | 8 B | `optWord` của `models_kit.js` (mũ nón lá/cap/túi/khẩu trang/tóc/tay áo/quần) + seed màu áo/da/tóc → dùng lại đúng định dạng traffic |

### 6.4 Danh mục thông điệp (byte đầu = opcode)

**Client → Server**

| Op | Tên | Payload (byte) | Tần suất / giới hạn |
|---|---|---|---|
| 0x01 | HELLO | proto u8, worldVersion u32, tier u8, ticketLen u8, ticket | 1 lần |
| 0x02 | READY | — | 1 lần sau khi dựng xong thế giới |
| 0x10 | STATE | seq u16, clientMs u16, x u16, z u16, y u8, yaw u8, vx i8, vz i8, state u8, corrEpoch u8, vehicleRef u16 → **16 B** | 15 Hz khi di chuyển, 2 Hz khi đứng; token bucket 25/s |
| 0x11 | ACTION | reqId u16, type u8, target u32, arg u32 → 12 B | 5/s; type: interact, buy, eat, drink, mount, dismount, job_accept, job_pickup, job_deliver, emote, talk, claim_pickup, give, invite… |
| 0x12 | CHAT | channel u8, len u8, UTF-8 ≤ 420 B (140 ký tự) | 1 / 2 s, burst 3 |
| 0x13 | PING | clientTime u32 | 1/s (2 Hz trong 10 s đầu) |
| 0x14 | REPORT | targetNetId u16, reason u8, chatRef u32 | 1 / 10 s |

**Server → Client**

| Op | Tên | Payload | Tần suất |
|---|---|---|---|
| 0x81 | WELCOME | netId u16, serverTime f64, tickHz u8, snapHz u8, dayEpoch f64, dayLength u16, resumeToken 16 B, weather block, spawn x/z u16 | 1 lần |
| 0x82 | SNAPSHOT | tick u32, flags u8 (keyframe…), **self** (x,z u16, y u8, corrEpoch u8, lastSeq u16 = 8 B), nLeave u8 + slot u8[], nEnter u8 + {slot u8, netId u16, abs 9 B, appearance 8 B}[], nUpd u8 + bản ghi | 10 Hz |
| 0x83 | NAMES | n × {netId u16, len u8, UTF-8 nickname (≤ 24 ký tự), badge u8} | khi có người mới vào AOI |
| 0x84 | EVENT | type u16 + payload (ACTION_RESULT, nhiệm vụ, giao hàng, sát thương môi trường, thời tiết, NPC đổi trạng thái…) — **mã + tham số**, client tự dịch qua `i18n.t()` | khi cần |
| 0x85 | STATS | bitmask u8 + {đói, khát, thể lực, máu, thân nhiệt} u8 mỗi cái + tốc độ thay đổi i8 (để client nội suy thanh HUD) + tiền (varint đồng) | khi đổi, ≤ 1 Hz |
| 0x86 | CHAT | fromNetId u16, channel u8, len u8, UTF-8 | |
| 0x87 | SYSTEM | code u8 (kick, khởi động lại sau N s, vị trí hàng đợi, reload vì worldVersion lệch), arg u32 | |
| 0x88 | PONG | clientTime u32, serverTime f64 | |
| 0x89 | CORRECT | x,z u16, y u8, yaw u8, epoch u8, reason u8 | khi kiểm di chuyển thất bại |
| 0x8A | WORLD | lịch thời tiết + sự kiện (xem §7.3) | khi vào + khi lịch đổi |

**Bản ghi cập nhật** (trong SNAPSHOT):
- *P1 (tuyệt đối, đơn giản)*: slot u8, x u16, z u16, y u8, yaw u8, spd u8, state u8 = **9 B** (slot thay netId nhờ bảng slot riêng từng client, gán ở ENTER).
- *P2 (delta so với bản đã gửi cho chính client đó — WS tin cậy, có thứ tự nên không cần ack)*: bitmask "không đổi" 1 bit/slot + với slot có đổi: dx, dz i8 (5 cm, ±6,4 m), dyaw i4, spd/state 4 bit hoặc escape sang tuyệt đối → **≈ 3,5 B** trung bình. Bỏ snapshot do backpressure → `keyframe` tuyệt đối lần sau.

Mọi mã hoá/giải mã nằm ở **một file duy nhất** `js/shared/codec.js`, import bởi client worker, server và bot. Có `PROTO_VERSION`; lệch phiên bản → SYSTEM "reload".

### 6.5 Băng thông (tính bằng script, gồm 68 B overhead WS+TLS+TCP/IP mỗi message, 10 Hz) [ƯT]

| Mã hoá | 19 entity (trung bình 1k CCU) | 40 entity | 96 entity (trần, đông) |
|---|---|---|---|
| Tuyệt đối 9–10 B (P1) | 2,9 KB/s = 23 kbps = 10 MB/giờ | 5,0 KB/s = 40 kbps | 10,7 KB/s = 85 kbps |
| Delta ≈ 3,5 B (P2) | 1,7 KB/s = 13 kbps = 6 MB/giờ | 2,4 KB/s = 19 kbps | 4,4 KB/s = 36 kbps |
| (JSON — cấm) | ≈ 10,6 KB/s | | ≈ 42 KB/s |

Chiều lên: 15 × (16 + 72) ≈ 1,3 KB/s/người. **Số lập kế hoạch chi phí: 3 KB/s/người trung bình (gồm chat/event), kịch bản căng 8 KB/s.** Tháng (40 % tải trung bình): 1k = **3,1 TB**, 3k = 9,3 TB, 10k = 31 TB; căng (100 % tải 24/7, 8 KB/s): 21 / 62 / 207 TB. Đỉnh: 1k ≈ 24 Mbps (căng 64), 10k ≈ 240 Mbps (căng 640) → **mọi nút cần cổng 1 Gbps**.

---

## 7. Nhịp tick và đồng hồ

| Vòng | Tần số | Ghi chú |
|---|---|---|
| Render client | 30–60 fps | không đổi |
| STATE client→server | 15 Hz di chuyển / 2 Hz đứng | gửi trạng thái đã mô phỏng cục bộ |
| Zone sim | **20 Hz** (50 ms) | áp STATE đã kiểm, sinh tồn (lười), nghề, NPC, hẹn giờ, phát zone frame mỗi tick thứ 2 |
| Snapshot gateway→client | **10 Hz** (xe gần ≤ 40 m: 20 Hz từ P2) | lệch pha giữa các client để san tải CPU |
| STATS | ≤ 1 Hz, khi đổi | |
| Flush DB | 30 s/nhân vật + ngay khi có sự kiện tiền/đồ/quest | |
| Đồng bộ đồng hồ | PING 1 Hz; giữ 8 mẫu RTT thấp nhất, offset = trung vị; chỉnh ≤ 0,5 %/s (không giật) | |

### 7.1 Thời gian

Mọi thứ mạng dùng **đồng hồ thực + offset server** (`performance.now()` + offset), không bao giờ dùng `time`/`dt` đã kẹp của vòng frame (`main.js:707-708`, trôi trên máy chậm).

### 7.2 Ngày/đêm chung

Server phát `dayEpoch`; client tính `dayT = ((serverNow − dayEpoch)/1000/1440 + 9/24) mod 1` và gọi `dayNight.syncTo(dayT)` mới (nắn tỉ lệ nhỏ, chỉ nhảy khi lệch lớn — setter `t` hiện tại ép bake IBL nên không gọi mỗi frame, `daynight.js:463-500`).

### 7.3 Thời tiết và bão (tất định)

World service giữ **lịch**: `[{kind: nắng|mây|mưa phùn|mưa rào|giông|bão, t0, t1, intensity, windDir, windSpeed, seed}]` cho 2–6 giờ thực tới; phát WORLD khi vào và khi lịch đổi. Client tính hiệu ứng (mưa hạt, gió cây `aSway`, ướt mặt đường qua uniform của `makeRoadMaterial`, sét = bloom + hemi flash) **từ `seed + serverTime`** → mọi người thấy cùng tia sét mà không tốn 1 byte/frame. Bão có báo trước (EVENT "cảnh báo bão" trước 10 phút game) — móc nối cho nhiệm vụ & nghề (ngư dân phải về bến).

---

## 8. Di chuyển: quyền sở hữu, dự đoán, nội suy

### 8.1 Vì sao v1 chọn "client đi trước, server kiểm"

| | Input-authoritative (á quân) | **Trust-but-verify (chọn cho v1)** |
|---|---|---|
| Cần server có va chạm giống hệt client | **Bắt buộc** — collider (vòng tròn + đa giác fabric) đang được dựng lúc chạy trong `world.js` 21.900 dòng, phụ thuộc TIER; không có thì người chơi trung thực bị kéo giật ở mọi bức tường | Không bắt buộc; dùng dần để siết kiểm tra |
| Cảm giác tay | tốt nếu dự đoán khớp; kéo giật nếu lệch | luôn mượt cho người trung thực |
| CPU server | 1k × 30 bước/s mô phỏng | chỉ kiểm cửa sổ |
| Chống speed/teleport | tự nhiên | bằng kiểm cửa sổ + ngân sách thời gian (§12) — đủ cho game không PvP |
| Xuyên tường | không thể | có thể tới khi có collider export (P3); không có gì giá trị đằng sau tường (không có nội thất) |

Kết luận: v1 dùng trust-but-verify; **tiền, đồ, chỉ số, nhiệm vụ, khoảng cách tương tác đều do server quyết** dựa trên vị trí đã kiểm. Vẫn tách `js/shared/move.js` (`stepPlayer`, `stepVehicle`, giới hạn) từ P0 để bot dùng và để chuyển sang v2 khi có PvP/đua có thưởng.

### 8.2 Người chơi cục bộ

- Chạy như hiện nay (phản hồi tức thì). Gửi STATE 15 Hz kèm `seq`, `corrEpoch`.
- Nhận CORRECT: tăng `corrEpoch`, đặt vị trí đích; **không snap hình**: giữ độ lệch hiển thị và giảm dần theo hàm mũ (τ ≈ 100 ms đi bộ, 150 ms xe máy); snap cứng khi lệch > 2 m (đi) / > 5 m (xe) hoặc lý do = dịch chuyển/hồi sinh. Server bỏ qua STATE có `corrEpoch` cũ.
- Lên/xuống xe dùng chung (moto mặc định, xích lô, thuyền): **chờ server xác nhận** (claim) — client chạy hoạt ảnh ngắn; bị từ chối → huỷ. Xe máy cá nhân (`callMoto`) thuộc người chơi, không cần claim.

### 8.3 Người chơi khác (đi bộ + xe máy)

- **Bộ đệm nội suy**: `renderTime = serverNowEst − interpDelay`, `interpDelay = clamp(2 × 100 ms + 2σ_đến, 150, 350 ms)`, khởi đầu 220 ms. Snapshot đến dồn (TCP truyền lại) → xử lý theo thứ tự, không dịch chuyển tức thời.
- **Hermite** dùng (vị trí, tốc độ, yaw) hai đầu → mượt hơn tuyến tính ở 10 Hz (đi bộ lẫn xe).
- **Xe máy**: nội suy theo đường cong Hermite; `heading` = yaw; **độ nghiêng (lean) suy từ tốc độ quay yaw × tốc độ** (kẹp 0,45 rad như `vehicles.js`), bánh xe quay theo tốc độ — không gửi lean/bánh. Tốc độ xe điều khiển âm thanh động cơ gần (pooled `PannerNode` cho 3–4 xe gần nhất).
- **Hết đệm**: ngoại suy theo vận tốc tối đa 150 ms (đi) / 250 ms (xe, theo heading + tốc độ quay hiện tại), rồi giảm tốc dần về dừng. Lệch > 8 m → snap.
- Độ trễ hiển thị ở 200 ms: đi 0,6 m, chạy 1,4 m, xe máy 3,2 m — chấp nhận được với game không chiến đấu. Tương tác gần (nói chuyện, chở khách) dùng vị trí **server** + dung sai `r + min(2 m, v × RTT/2)`.
- **Hiển thị**: nhóm instanced `remote_ped`, `remote_ride_*` dùng lại `pedestrianGeometry`/`motorbikeGeometry`/`kitMaterial`/`contactShadowGeometry` (models_kit.js) và sơ đồ buffer xoay vòng 3 bộ của traffic (`traffic.js:161-221`) → **số draw call cố định**, không tạo shader mới, không đổ bóng vào shadow map; giữ hợp đồng `userData.noCull`, `raycast = () => {}`, `matrixAutoUpdate = false`, boundingSphere đặt tay. Tên nổi = 1 atlas canvas + 1 billboard instanced, 24 người gần nhất, font có hỗ trợ tiếng Việt (kiểm khung hình có dấu trên điện thoại).

### 8.4 Nâng cấp v2 (khi cần)

Bước cố định 1/30 s ở client và server, client gửi lệnh (fwd/turn/flags), dự đoán + replay lệnh chưa xác nhận, deadband 5 cm, bộ đệm 64 lệnh, ngân sách thời gian như §12. Điều kiện tiên quyết: collider export (`tools/gen_colliders.mjs`) đã khớp mọi TIER và test "phát lại input → vị trí giống hệt" xanh.

---

## 9. Cái gì ở client, cái gì ở server

| Hệ thống | Sở hữu | Đồng bộ thế nào | Lý do |
|---|---|---|---|
| Hình học thế giới, nhà, đường, biển hiệu, cây | client (dữ liệu sinh sẵn) | `worldVersion` (hash dữ liệu + build) trong HELLO; lệch → yêu cầu tải lại | tất định theo dữ liệu |
| Giao thông + người đi đường (`traffic.js`), walker của `props.js`, chim, thuyền trang trí | **client, mỹ thuật** | không đồng bộ; sửa `avoidPlayer` để tránh cả 8 người chơi khác gần nhất | `traffic.js` dùng bong bóng quanh người chơi + `performance.now()` + LCG theo thứ tự gọi → không thể lockstep; đồng bộ 200 xe tốn ≈ 6 KB/s/người |
| Xe buýt/phà/tàu có lịch (P4) | hàm thuần `(routeId, serverTime)` | 0 byte sau khi đồng bộ đồng hồ; chỉ dùng +,−,×,÷, sqrt (tránh `Math.sin/cos` trong đường đồng bộ) | |
| Vị trí người chơi | client đề xuất, **server kiểm** | STATE/SNAPSHOT | §8 |
| Xe dùng chung (moto mặc định, xích lô, thuyền) | **server** (claim/nhả, timeout 60 s khi rớt mạng) | EVENT | tránh 2 người cùng lái 1 thuyền |
| Xe máy cá nhân | người chơi | là một phần trạng thái người chơi | |
| NPC chủ quán, giao việc, kể chuyện | **server** (trạng thái), vị trí tĩnh trong dữ liệu | EVENT | |
| Đói/khát/thể lực/máu/thân nhiệt | **server** (đánh giá lười) | STATS ≤ 1 Hz + tốc độ để client nội suy thanh | chống sửa console |
| Tiền, kho đồ, giá, tồn kho quán | **server** + sổ cái Postgres | ACTION → EVENT | |
| Nghề (đơn giao hàng, cuốc xe ôm, ca bốc xếp, mẻ cá) | **server** | EVENT | |
| Nhiệm vụ/cốt truyện, khám phá địa danh, nhặt hoa | **server** (định nghĩa JSON chung) | EVENT | hiện tại đều tin client (`quests.js`) |
| Ngày/đêm, thời tiết, bão, sự kiện thành phố | **server (World)** | WORLD (lịch) → client tính tất định | |
| Camera, UI, âm thanh, hậu kỳ, mây | client | — | |

---

## 10. Lưu trữ, tài khoản, phiên

### 10.1 Mô hình tài khoản

- **Khách (mặc định)**: nhập nickname → `POST /v1/auth/guest` tạo tài khoản `kind='guest'` trên server (tiến trình nằm ở server ngay từ đầu, chống sửa). Trả refresh token (256 bit ngẫu nhiên, DB chỉ lưu hash, xoay vòng mỗi lần dùng, hạn 180 ngày) lưu trong `localStorage` (cookie bên thứ ba từ GitHub Pages sang domain API sẽ bị Safari chặn) + access JWT 15 phút.
- **Liên kết Google (tuỳ chọn)**: Google Identity Services trên trang → ID token → `POST /v1/auth/google {idToken, link: true}`; server xác thực bằng JWKS của Google (`aud` = client ID, `iss` ∈ {accounts.google.com, https://accounts.google.com}, `exp`), lưu `sub` (và email nếu người dùng đồng ý). Nếu `sub` chưa thuộc ai → gắn vào tài khoản khách hiện tại. Nếu `sub` đã có tài khoản khác → **hỏi người dùng giữ tiến trình nào; không tự gộp** (gộp tiền/đồ mở đường gian lận).
- **Thiết bị mới**: đăng nhập Google → lấy lại tài khoản. Khách mất localStorage = mất tiến trình → nhắc liên kết Google sau 20 phút chơi và trước giao dịch lớn đầu tiên.
- **Tên hiển thị**: `Nickname#1234` (4 số phân biệt), lọc tục/mạo danh/tên thương hiệu (dùng `js/brands.js` + danh sách tên dành riêng như "Admin", "GM", "Quản trị").
- Dọn dẹp: tài khoản khách không liên kết, không chơi 90 ngày → xoá.
- **Tiến trình cục bộ cũ** `hp3d.progress.v1` (hoa, địa danh): nhập 1 lần như *thành tựu trang trí* — **không** quy ra tiền/đồ (người dùng sửa tay được).
- **Móc pháp lý**: cột `verified_phone_at`, `birth_year`, bảng `playtime_daily` — chưa bắt buộc, bật bằng cờ cấu hình nếu luật sư yêu cầu (§20).

### 10.2 Lược đồ Postgres (rút gọn; migration trong `server/src/db/migrations/`)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `accounts` | id uuid, kind (guest/full), created_at, last_seen, status, verified_phone_at, birth_year, locale | |
| `identities` | account_id, provider (device/google/phone), subject, created_at; UNIQUE(provider, subject) | |
| `refresh_tokens` | id, account_id, token_hash, device_id, expires_at, rotated_from | |
| `characters` | id, account_id, display_name, discriminator, appearance bytea(8), pos_x/z/y, cell, **version bigint**, updated_at | 1 nhân vật/tài khoản ở v1 |
| `character_vitals` | character_id, hunger, thirst, stamina, health, heat (real), t_ref timestamptz, rates jsonb | đánh giá lười |
| `wallets` | character_id, balance_vnd bigint (CHECK ≥ 0), version | |
| `ledger` | id bigserial, tx_id uuid, character_id (NULL = tài khoản hệ thống), delta_vnd bigint, reason, ref, created_at | **sổ cái kép**: mỗi `tx_id` có tổng delta = 0; append-only |
| `inventory` | character_id, item_id, qty, meta jsonb | |
| `quest_progress` | character_id, quest_id, step, state jsonb, updated_at | |
| `job_stats` | character_id, job, day, count, income_vnd | trần thu nhập ngày |
| `social` | mute/block/friend: owner_id, target_id, kind | |
| `reports` | id, reporter_id, target_id, reason, context jsonb (20 dòng chat), status | |
| `sanctions` | id, account_id, kind (mute/kick/ban/shadow), until, reason, by_admin | |
| `chat_log` | id, cell, sender_id, text, created_at | **phân vùng theo ngày, giữ 30–90 ngày** |
| `playtime_daily` | account_id, day, seconds | móc pháp lý |
| `admin_audit` | ai, làm gì, khi nào | |

### 10.3 Chiến lược ghi

- Trạng thái nóng trong RAM của zone; cờ "bẩn"; **flush mỗi 30 s** theo lô (≈ 33 ghi/s ở 1k CCU, 330 ở 10k — Postgres nhỏ dư sức), khi đăng xuất, khi handoff (blob mang theo version).
- **Tiền/đồ**: áp vào RAM + xếp hàng giao dịch ledger; commit theo lô **mỗi 1 s** (sập máy mất tối đa 1 s, không bao giờ âm vì kiểm trong RAM trước). Giao dịch giá trị lớn (> 1 triệu đồng game) hoặc giao dịch giữa 2 người chơi → **commit đồng bộ** trước khi trả kết quả.
- Đối soát đêm: `SUM(ledger) = SUM(wallets)` theo nhân vật; lệch → cảnh báo.
- 1 phiên/tài khoản: khoá `session:{account}` trong Valkey (TTL 30 s, gateway gia hạn); giai đoạn A dùng Map trong RAM.
- Sao lưu: WAL liên tục + base backup hằng đêm (pgBackRest/wal-g) mã hoá → R2; diễn tập khôi phục mỗi tháng. Script **xuất toàn bộ tài khoản/save** từ ngày đầu (bài học 2026).

---

## 11. Sinh tồn và kinh tế phía server (mức engine; con số cân bằng do tài liệu game design quyết)

- **Đánh giá lười**: mỗi chỉ số `v(t) = clamp(v0 + rate × (t − t0))`; `rate` chỉ đổi khi *ngữ cảnh* đổi (đi/chạy/lái xe/làm nghề/trú mưa/thời tiết/đêm) → zone tính lại đoạn mới. Một vòng quét 1 Hz/zone kiểm ngưỡng (đói = 0 → mất máu; thân nhiệt thấp khi mưa bão không trú). 10k người × 1 Hz là không đáng kể.
- **Offline: chỉ số đóng băng** (đời sống thành phố, không trừng phạt người nghỉ chơi) — đề xuất, chủ dự án xác nhận.
- **Thể lực** chặn chạy/nhảy ở server: STATE chế độ "chạy" khi thể lực 0 → coi như đi bộ (kiểm tốc độ theo đó).
- **Ngất**: máu 0 → tỉnh lại ở bệnh viện gần nhất, trừ viện phí; không mất đồ, không chết vĩnh viễn.
- **Trú mưa/bão**: không có nội thất → **vùng trú** định nghĩa bằng dữ liệu (`js/shared/data/shelters.json`: mái hiên, chợ có mái, hiên quán) sinh offline.
- **Quán ăn thật**: `tools/gen_shops.mjs` sinh `js/shared/data/shops.json` từ `js/shopsigns.js` (954 biển, ≈ 530 trùng vị trí, không id): id ổn định = hash(x, z làm tròn, tên), phân loại theo từ khoá (phở, bún, bánh mì, cà phê, trà đá, nhà hàng, tạp hoá…), điểm phục vụ = `world.findFree`, **lọc thương hiệu** (quy tắc dự án). Thực đơn + giá ở `server/data/menu.json` theo loại quán; mua = ACTION có kiểm khoảng cách (≤ 4 m + dung sai), giá server tính, tồn kho, cooldown, `reqId` idempotent.
- **Tiền**: số nguyên đồng (VND game). Nguồn: nghề, nhiệm vụ. Hố tiền: ăn uống, xăng (móc `updateVehicle`), viện phí, thuê xe, trang phục. Trần thu nhập ngày theo nghề; khách thấp hơn tài khoản đã liên kết (giảm farm nhiều tài khoản).
- **Nghề** (máy trạng thái server, `server/src/zone/jobs/*.js`): shipper (lấy ở quán A, giao ở địa chỉ B; kiểm thời gian tối thiểu = quãng đường theo `roadgraph` / v_max), xe ôm (khách NPC hoặc người chơi; cần tư thế ngồi sau — `character.js` chưa có, dùng tư thế PILLION của kit), bán hàng rong (đặt sạp ở ô cho phép, khách NPC theo mật độ người chơi gần), bốc xếp cảng (ca có thời lượng, chuỗi hành động), ngư dân (thuyền + vùng nước, ngừng khi bão), hướng dẫn viên (dẫn người chơi/khách NPC qua chuỗi địa danh `LANDMARKS`).

---

## 12. Chống gian lận

Mô hình đe doạ: JS trình duyệt sửa được hoàn toàn (console, userscript, client sửa, bot, phát lại gói). Che giấu mã ≠ bảo mật. `window.__hp` (`main.js:885`) phải ẩn sau cờ QA ở bản production.

1. **Không tin client về giá trị**: tiền, đồ, chỉ số, nhiệm vụ, kết quả nghề, khoảng cách tương tác đều do server tính trên vị trí đã kiểm.
2. **Ngân sách thời gian**: mỗi người có `credit_ms` (+ thời gian thật trôi, − khoảng thời gian STATE khai báo); khoảng hợp lệ [−100, +200] ms; vượt → bỏ gói + đếm. Chặn "tua nhanh".
3. **Giới hạn động học theo chế độ** (hằng số ở `js/shared/constants.js`, KHÔNG chép tay — tốc độ đã đổi một lần): quãng đường trong cửa sổ trượt 1 s ≤ `v_max × 1,2 + 1 m`; gia tốc ≤ gia tốc xe × 1,5; chế độ xe chỉ hợp lệ sau claim/xe cá nhân; thuyền phải trên nước (`isWater`), đi bộ không trên nước (trừ mặt cầu `surfaceY`); trong đĩa chơi; y khớp `groundHeight`/mặt cầu ± 1,5 m (nhảy).
4. **Xuyên tường** (P3): kiểm đoạn thẳng giữa 2 STATE với đa giác footprint (từ `buildings_data.js` + `colliders.bin` export) — chỉ với đoạn > 1 m để rẻ.
5. **Điểm vi phạm**: +1 mỗi cửa sổ vi phạm, −1/s; > 5 → CORRECT (kéo về); > 20 → kick; tái phạm → ban tạm. Không bao giờ ban vì 1 sự kiện (độ trễ/burst TCP tạo dương tính giả). Ngưỡng tinh chỉnh theo dữ liệu beta, chia theo nhóm RTT.
6. **Dịch chuyển**: nhảy > 3 × bước tối đa = cờ cứng; dịch chuyển hợp lệ chỉ do server khởi tạo.
7. **Kinh tế**: idempotency key mỗi ACTION, cooldown, trần ngày, cảnh báo bất thường (thu nhập/giờ > trung vị + 5σ), đối soát sổ cái đêm.
8. **Bot**: Turnstile khi tạo phiên và mỗi 2 giờ chơi; heuristic phase 2: nhịp input không jitter, đường lặp hoàn hảo, phiên 24/7, không xoay camera → gắn cờ bóng (không ban ngay), giới hạn thu nhập.
9. **Phát lại/giả mạo**: vé HMAC dùng 1 lần TTL 60 s; access JWT 15 phút; mọi thứ client gửi đều được kiểm lại.

---

## 13. Kiểm duyệt và giới hạn tần suất

### 13.1 Chat

- Kênh: **SAY** (40 m, mặc định), **NHÓM** (party), **THẾ GIỚI/RAO** (cooldown 60 s + tốn tiền/thể lực, có thể tắt), **HỆ THỐNG**. Không phát "đang gõ".
- Giới hạn: ≤ 140 ký tự; 1 tin/2 s burst 3; chặn lặp/gần lặp; không link (hoặc ≤ 1 link trắng danh sách); gộp ký tự lặp.
- **Bộ lọc tiếng Việt đồng bộ** (`js/shared/textfilter.js`, < 1 ms): chuẩn hoá NFC/NFD, bỏ dấu để so khớp, ánh xạ teencode/leetspeak (`dm`, `đ.m`, `vl`, chữ cách quãng, ký tự zero-width), blocklist + allowlist (tránh bắt nhầm âm tiết không dấu), áp cho nickname. Danh sách cần **người Việt bản ngữ** duyệt.
- **Kiểm hậu ML** (tuỳ chọn, 1–2 s sau khi gửi): omni-moderation (miễn phí) → ẩn hồi tố + gắn cờ, không chặn gameplay; ghi rõ trong chính sách quyền riêng tư vì gửi nội dung ra bên thứ ba. Không dùng Perspective API.
- **Khách mới**: 10 phút đầu chỉ chat nhanh/emote (giảm spam tài khoản rác), mở khoá sớm khi liên kết Google — chủ dự án quyết.

### 13.2 Báo cáo và xử phạt

- Mute/chặn (lưu server), báo cáo kèm 20 dòng chat gần nhất; tự mute tạm khi ≥ 3 báo cáo từ 3 tài khoản khác nhau trong 10 phút; shadow-mute cho tái phạm.
- **Bảng admin** (`server/src/api/admin.js` + trang tĩnh `admin/` triển khai riêng sau Cloudflare Access, KHÔNG nằm trên GitHub Pages): tìm người chơi, xem báo cáo, mute/kick/ban có thời hạn, xem log chat, nhật ký thao tác admin.

### 13.3 Bảng giới hạn

| Đối tượng | Giới hạn |
|---|---|
| Tạo khách | 5 / giờ / thiết bị, 30 / giờ / IPv4 (CGNAT Viettel → lỏng), Turnstile bắt buộc |
| Kết nối WS | ≤ 50 đồng thời / IPv4, ≤ 10 mới / phút / IPv4; IPv6 gom theo /64; 1 phiên / tài khoản |
| STATE | 25/s · ACTION 5/s · CHAT 1/2 s (burst 3) · PING 1/s · REPORT 1/10 s |
| Payload | ≤ 512 B; opcode lạ, độ dài sai → đóng 1008 sau N lần |
| Toàn cục | trần CCU = 1,2 × mục tiêu; vượt → hàng đợi có ETA |

---

## 14. Bảo mật

- TLS khắp nơi (`wss://`, HTTPS); Cloudflare Full (strict) tới origin; origin chỉ nhận IP Cloudflare (firewall) — giấu IP máy thật.
- **Không commit bí mật** (quy tắc dự án): khoá ký JWT (Ed25519), HMAC vé, mật khẩu DB, Turnstile secret, Google client secret (không cần — chỉ client ID công khai) nằm trong biến môi trường/`systemd` credential trên máy, xoay vòng 90 ngày; khoá ký có `kid` để xoay không rớt phiên.
- Kiểm `Origin` khi upgrade WS + CORS chỉ cho domain trang game; vé trong tin nhắn đầu, không trong URL.
- Client: CSP bằng thẻ `<meta http-equiv>` (Pages không đặt header được): `connect-src` chỉ api/gw/R2/jsDelivr, `script-src` self + accounts.google.com + challenges.cloudflare.com; không thêm script bên thứ ba khác (token trong localStorage → XSS là rủi ro chính).
- Server: kiểm độ dài/miền mọi trường; không `eval`/JSON động từ client; Postgres user tối thiểu quyền (zone không DROP/ALTER); SQL tham số hoá.
- Mạng nội bộ: NATS/Postgres/Valkey chỉ trên VPC riêng + mật khẩu/TLS; SSH chỉ bằng khoá, qua WireGuard; admin sau Cloudflare Access.
- Quyền riêng tư: lưu tối thiểu (Google `sub`; email chỉ khi cần), endpoint **xuất/xoá dữ liệu** của tôi, chính sách lưu log chat 30–90 ngày, trang chính sách bằng tiếng Việt.
- Chuỗi cung ứng: ghim phiên bản npm + `npm ci` + `npm audit` trong CI; uWS ghim theo tag + checksum.
- Deploy: `deploy-pages.yml` hiện mirror **toàn bộ nhánh** lên gh-pages → thêm bước loại `server/` khỏi Pages (mã server công khai không sao vì không có bí mật, nhưng site đã 1,77 GB > giới hạn 1 GB).

---

## 15. Hosting và chi phí

### 15.1 Topology theo mức

Giá tham chiếu Vultr Singapore đọc từ API (14/10/2026): CPU-Optimized 2c/4 GB $40 (5 TB), 4c/8 GB $80 (6 TB), 8c/16 GB $160 (7 TB), 16c/32 GB $320 (8 TB); quá hạn mức $10/TB; +2 TB chung/tài khoản. Hetzner SIN/DigitalOcean SGP tương đương. Tất cả [ƯT] về số máy cần — xác nhận bằng load test §17.

| Hạng mục | **Alpha ≤ 200** | **1.000 CCU** (giai đoạn B) | **3.000 CCU** (đầu giai đoạn C) | **10.000 CCU** (giai đoạn C) |
|---|---|---|---|---|
| Game | 1× 2c/4 GB (tất cả trong 1) $24 | 1× 8c/16 GB (5 luồng gateway + sim + world) **$160** | 2× gateway 8c **$320** + 1× zone 8c (2–3 zone + NATS + world) **$160** + 1× dự phòng nóng 8c **$160** | 6× gateway 8c **$960** (≈ 2.000 client/máy + 1 dư) + 4× zone 8c **$640** (8 zone + 1 dư) + 3× NATS 2c **$120** |
| API/auth/admin/obs | (chung) | 1× 4c/8 GB dự phòng nóng + staging + Grafana/VM/Loki **$80** | 1× 4c **$80** | 2× API 4c **$160** + 1× obs 4c **$80** + Grafana Cloud trả phí ~**$50** |
| Postgres + Valkey | (chung) | 1× 2c/4 GB tự vận hành **$40** (hoặc Supabase SG ≈ $75) | primary 4c **$80** + replica 2c **$40** | primary 16c/32 GB **$320** + replica 8c **$160** + Valkey 2× 2c **$80** |
| Cloudflare | Free $0 | Pro **$25** | Pro $25 (→ Business $250 nếu CF yêu cầu do lưu lượng WS) | Business **$250** (cần nói chuyện với CF về 30–200 TB WS/tháng) |
| Chống DDoS nhà cung cấp | — | 2 IP **$20** | **$60** | **$150** (hoặc báo giá anti-DDoS) |
| R2 (GLB) + backup + domain | ~$2 | **$5** | **$5** | **$10** |
| Hạn mức egress kèm máy | 5 TB | 20 TB | 47 TB | ≈ 130 TB |
| Egress kế hoạch (3 KB/s, 40 %) | 0,6 TB → $0 | 3,1 TB → **$0** | 9,3 TB → **$0** | 31 TB → **$0** |
| **Tổng / tháng (kế hoạch)** | **≈ $25–30** | **≈ $330** (dải $300–380) | **≈ $930** (dải $930–1.150 với CF Business) | **≈ $3.000** (dải $2.800–3.300) |
| Kịch bản căng (100 % tải 24/7, 8 KB/s) | — | 21 TB → **≈ $340** | 62 TB → **≈ $1.100–1.300** | 207 TB → +$770 → **≈ $3.800** |
| $/CCU/tháng | — | ≈ $0,33 | ≈ $0,31–0,38 | ≈ $0,30–0,38 |

### 15.2 So sánh để thấy cái bẫy

| Phương án | 1k | 3k | 10k |
|---|---|---|---|
| **Đề xuất (VM Singapore)** | $330 | $930–1.150 | $2.800–3.800 |
| Cao cấp: nút chính **Hà Nội** (Viettel IDC/BizFly/AWS Hanoi Local Zone, cổng 1 Gbps cam kết) + SG dự phòng + HA DB + anti-DDoS | $1.500–2.200 | $3.300–4.800 | ≈ $7.000–10.000 (cần báo giá) |
| Cloudflare Durable Objects (Plan B, ~100 người/object) | $130–370 | $440–1.250 | ≈ $1.500–4.000, rủi ro hotspot cao |
| AWS/GCP Singapore (chỉ riêng egress $0,12/GB) | +$370–2.500 | +$1.100–7.400 | +$3.700–20.000 |
| Nakama Heroic Cloud / SpacetimeDB Maincloud | $1.200–6.000+ | $2.400–17.000+ | không khả thi |

### 15.3 Vị trí

- Bắt đầu **Singapore** (RTT 50–75 ms tới Hải Phòng, ổn với game không bắn súng).
- **P0 netprobe 2 tuần** (§17.1) so SG vs Hà Nội vs Hong Kong theo nhà mạng giờ cao điểm. Thêm/chuyển nút Hà Nội nếu: trung vị RTT tới SG > 80 ms hoặc p95 > 150 ms giờ cao điểm; sự cố cáp biển còn làm xấu tối; hoặc luật sư yêu cầu dữ liệu trong nước. Kiến trúc cho phép **một zone chạy ở Hà Nội** (bus NATS qua WireGuard) — nhưng mỗi thế giới chỉ nên có một vùng sở hữu; ưu tiên chuyển cả cụm.
- **Asset GLB rời GitHub**: lần đầu mỗi người kéo 100–270 MB; Pages giới hạn 100 GB/tháng mềm → chuyển lên **R2 + Cloudflare CDN** (egress $0), giữ sơ đồ ghim SHA (`ASSETS_SHA` → tiền tố đường dẫn R2) và cổng `tools/check_assets.mjs`. Bắt buộc trước khi mời > 200 người.

---

## 16. Quan sát hệ thống (observability)

- **Metric server** (`prom-client`, Prometheus/VictoriaMetrics + Grafana): CCU theo zone/gateway; histogram thời gian tick zone, thời gian lắp snapshot gateway; event-loop delay (`monitorEventLoopDelay`) p99; GC pause; RSS; số FD; byte/s vào/ra theo opcode; kích thước snapshot p50/p95; bản ghi bị cắt do trần; keyframe/phút; CORRECT/phút; vi phạm theo lý do; handoff/s + độ trễ handoff; mức suy giảm; hàng đợi; độ trễ DB p99; độ sâu hàng ghi ledger; lỗi auth.
- **Log**: `pino` JSON → Loki (giữ 14 ngày; log admin/kiểm duyệt giữ lâu hơn trong Postgres). Mọi log có `netId`/`accountId` băm, không ghi token.
- **Telemetry client (RUM)**, lấy mẫu 10 %, gửi `POST /v1/telemetry` mỗi 60 s: RTT p50/p95, jitter, khoảng trống snapshot, interpDelay hiện tại, CORRECT/phút, fps, số avatar đang vẽ, **`__hp.tier` + `__hp.gpu`** (quy tắc dự án cho mọi số đo perf), nhà mạng (server suy từ IP qua GeoLite2-ASN — không gửi IP vào kho phân tích), loại mạng (`navigator.connection` nếu có).
- **Cảnh báo**: tick p99 > 30 ms trong 5 phút; event-loop p99 > 40 ms; CCU giảm > 20 % trong 1 phút (sập/rớt mạng); tỉ lệ lỗi auth > 5 %; DB p99 > 100 ms; lệch sổ cái; egress tháng > 80 % hạn mức; chứng chỉ sắp hết hạn. Kênh: email/Telegram của chủ dự án.
- **Trang trạng thái** công khai đơn giản (Pages tĩnh đọc JSON từ API).

---

## 17. Kế hoạch đo và load test

### 17.1 Đo trước khi cam kết (P0)

1. **Netprobe**: `?netprobe=1` trên trang hiện có mở WS tới 3 VPS echo (SG, HK/Tokyo, Hà Nội), 20 ping, gửi trung vị/p95/mất gói + `cf-ray` PoP + `__hp.tier/gpu`; thu 2 tuần, giờ cao điểm 19–23 h, theo Viettel/VNPT/FPT/Mobifone/Vinaphone. Chi phí ≈ $15.
2. **Spike sim**: 500 rồi 1.000 bot trên VM 2c Singapore, 10 Hz, V=40. Đạt: tick p99 < 25 ms, CPU < 60 % một lõi ở 1.000, RAM < 1,5 GB, egress đo trong ±20 % mô hình §6.5. Trượt → chuyển giai đoạn B sớm hơn.

### 17.2 Bot không giao diện (công cụ chính)

- `server/bots/bot.js`: Node + `ws` + **chính `js/shared/codec.js` và `move.js`**; đi theo đồ thị đường thật (`roadgraph.js`), đổi chế độ đi/chạy/xe máy, chat ngẫu nhiên, mua đồ, nhận nghề; tự báo RTT, CORRECT, lỗi giải mã. Kịch bản trong `server/bots/scenarios/*.js`.
- Mỗi lõi ≈ 200–400 bot [ƯT] → 1.500 bot cần 4–8 lõi ở máy riêng; 10.000 bot ≈ 34 lõi = 5 máy 8c thuê theo giờ (≈ $5 cho 3 giờ). `tc netem` mô phỏng mạng VN (80 ± 30 ms, mất 2 %) trên 30 % bot.
- **Không bao giờ** chạy nhiều Chrome WebGL thật song song trên máy chủ dự án (BSOD 0x133 đã xảy ra 3 lần) — tối đa 1 trình duyệt thật/lần qua `tools/qa/gpulock.mjs`, chỉ để kiểm hình.
- k6 (`k6/websockets`) chỉ dùng cho bão bắt tay/kết nối lại và endpoint HTTP.

### 17.3 Kịch bản và tiêu chí đạt

| Mã | Tải | Thời lượng | Đạt khi |
|---|---|---|---|
| T0 smoke | 50 bot + 3 trình duyệt | 10' | 0 lỗi giải mã; CORRECT < 2/phút/người trung thực |
| T1 ramp | 0 → mục tiêu × 1,2 trong 10' | 30' | tick zone p99 < 25 ms; lắp snapshot p99 < 25 ms; event-loop p99 < 20 ms; snapshot p95 < 1.100 B; RSS không tăng > 10 % sau GC |
| T2 hotspot | 300 bot dồn về quảng trường Nhà hát | 10' | trần + accumulator giữ; p99 < 40 ms; không client nào > 12 KB/s |
| T3 stress | 1,5–2 × mục tiêu | 15' | thang suy giảm kích hoạt đúng thứ tự; hàng đợi chạy; không sập |
| T4 mạng xấu | netem 80 ± 30 ms, mất 2 % trên 30 % bot | 20' | interpDelay tự thích nghi; snap < 1/phút |
| T5 bão kết nối lại | rớt toàn bộ, nối lại trong 30 s | 5' | 100 % phục hồi đúng netId/trạng thái; tôn trọng trần |
| T6 soak | 0,8 × mục tiêu | 8–12 h | RAM phẳng, không trôi đồng hồ, log hợp lý |
| T7 lạm dụng | gói sai, quá cỡ, spam 1.000 msg/s, speed-hack, teleport, mua khi xa quán | 10' | mỗi loại bị từ chối/đóng trong 1 s; CPU tăng < 10 %; phát hiện speed-hack ≥ 99 % |
| T8 handoff (giai đoạn C) | 3.000 bot đi xuyên ranh 4 zone liên tục | 30' | handoff p99 < 50 ms; 0 mất input; 0 nháy hình (bot kiểm liên tục vị trí) |
| T9 sổ cái | 1.000 bot mua/bán/làm nghề + giết tiến trình zone giữa chừng | 30' | sau khởi động lại: tổng ledger = tổng ví; mất tối đa 1 s giao dịch nhỏ, 0 giao dịch lớn |

---

## 18. Lộ trình theo giai đoạn

Thời lượng giả định 1 người phát triển chính + Claude; mỗi giai đoạn kết thúc bằng cổng nghiệm thu. Thay đổi phía client vẫn phải qua `tools/diag.mjs` + `tools/waterbfs.mjs` + ảnh `tools/tour.mjs` trước khi push, và **cập nhật `KNOWLEDGE.md` (mục mới §11 Multiplayer) trong cùng commit**.

### P0 — Nền móng & spike (2 tuần)

- Netprobe + 3 VPS echo; spike sim 1.000 bot (§17.1).
- Tách `js/shared/`: `constants.js` (tốc độ, bán kính, nhịp — `main.js:333` và `vehicles.js` import từ đây), `quant.js`, `grid.js`, `codec.js` (+ test khứ hồi), `move.js` (bước cố định `stepPlayer`/`stepVehicle` — client vẫn chạy như cũ), `clock.js`.
- `tools/gen_worldversion.mjs` → `js/shared/worldversion.js` (hash dữ liệu sinh + build id); test băm `world.colliders` theo TIER (1 trình duyệt, gpulock).
- Bắt đầu hỏi luật sư về NĐ 147/2024.
- **Nghiệm thu**: game đơn người không đổi (diag/tour xanh); codec khứ hồi 10⁶ bản ghi ngẫu nhiên khớp; báo cáo RTT theo nhà mạng; quyết định SG/HN có dữ liệu.

### P1 — MVP "thấy nhau + chat" (4–6 tuần, giai đoạn A)

- Server 1 tiến trình: `server/src/main.js` (ROLE=all), gateway uWS, zone sim 20 Hz, AOI lưới 128 m, snapshot tuyệt đối 10 Hz, kiểm di chuyển cơ bản (tốc độ cửa sổ, ngân sách thời gian, trong đĩa, đất/nước), CORRECT.
- Client: `js/net/*` (worker, transport, nội suy Hermite, avatar instanced đi bộ + xe máy, tên nổi atlas), ô nickname trên màn hình tiêu đề, khách server-side tối giản (chưa Postgres: SQLite/tệp, hoặc Postgres nhỏ ngay), chat SAY + lọc + báo cáo + mute, đồng bộ ngày/đêm, điểm spawn rải, trần CCU + hàng đợi, telemetry.
- `window.__hp` sau cờ QA; CSP meta; Turnstile ở `/auth/guest`.
- Hạ tầng: 1 VPS SG + Cloudflare Free + domain; Grafana Cloud free.
- **Nghiệm thu**: T0 + T1 ở 300 bot + 5 trình duyệt thật; RTT p50 từ Hải Phòng ≤ 70 ms (cáp quang); độ trễ "người A bước → người B thấy" p50 ≤ 300 ms; tick p99 < 25 ms; băng thông trung bình ≤ 3 KB/s/người; fps giảm ≤ 5 % với 50 avatar ở TIER 2 (ghi `__hp.tier`/`__hp.gpu`); soak 8 h không sập; chi phí ≤ $50/tháng.

### P2 — Tài khoản, lưu trữ, mở rộng tới 1.000+ (4–6 tuần, giai đoạn B)

- Postgres + migrations, refresh/access token, **liên kết Google**, `resumeToken`, 1 phiên/tài khoản, xuất/xoá dữ liệu, nhập `hp3d.progress.v1` thành thành tựu.
- `worker_threads` gateway + SAB mirror; delta encoding; priority accumulator; tầng tốc độ; thang suy giảm; 20 Hz cho xe gần.
- GLB lên R2; bảng admin + xử phạt; Valkey; sao lưu + diễn tập khôi phục; cảnh báo.
- **Nghiệm thu**: T1 ở 1.200 bot, T2, T3 ở 2.000, T4, T5 (1.000 kết nối lại trong 30 s), T6; tick/snapshot p99 < 25 ms; trung bình ≤ 2,5 KB/s/người; mất dữ liệu khi giết tiến trình ≤ 30 s chỉ số, 0 ledger; chi phí ≤ $380/tháng ở 1k CCU; beta kín 200 CCU thật có số liệu nhà mạng.

### P3 — Sinh tồn & kinh tế do server quyết (6–8 tuần)

- `js/shared/survival.js` (công thức lười) + HUD chỉ số; `tools/gen_shops.mjs` → `shops.json`; `server/data/menu.json`; ví + sổ cái kép; mua/ăn/uống; claim xe dùng chung; nghề (shipper → xe ôm (cần tư thế ngồi sau) → bán rong → bốc xếp cảng → ngư dân → hướng dẫn viên); thời tiết + bão tất định + vùng trú; xăng/viện phí làm hố tiền.
- Chống gian lận đầy đủ: điểm vi phạm, collider export + kiểm xuyên tường, trần thu nhập, cảnh báo bất thường, đối soát đêm.
- **Nghiệm thu**: T7 (phát hiện speed-hack ≥ 99 %), T9; dương tính giả ≤ 0,1 % phiên trong beta; 0 lệch sổ cái 14 đêm liên tiếp; mỗi nghề có bot kịch bản chạy hết vòng; thời tiết giống nhau trên 2 máy (so ảnh cùng `serverTime`); chi phí không đổi đáng kể (+≤ 10 %).

### P4 — Nhiệm vụ, sự kiện, co-op, sharding 3k–10k (8+ tuần, giai đoạn C)

- Động cơ nhiệm vụ dữ liệu (`js/shared/quests/*.json`: bước, điều kiện sự kiện `visit/talk/pickup/deliver/buy/wait`, phần thưởng, văn bản `{vi,en}`), NPC giao việc, cốt truyện từ `docs/KICHBAN_*` + `HOI*_PHANCANH.md` + `LANDMARKS[].text`; nhóm (party) + nhiệm vụ chung; sự kiện thành phố theo lịch (lễ hội, bão lớn); xe buýt/phà "đường ray".
- NATS, nhiều zone, handoff, chia k-d theo bản đồ nhiệt, cân bằng lại, World service riêng, deploy lăn gateway / drain zone.
- **Nghiệm thu**: T8 ở 3.000 bot qua 4 zone; T1/T3 ở 10.000 bot trên staging thuê theo giờ (trước bất kỳ chiến dịch quảng bá nào); handoff p99 < 50 ms; một nhiệm vụ nhóm 4 người hoàn thành khi 4 người ở 2 zone khác nhau; chi phí thực ≤ $1.150 ở 3k.

### P5 — Tuỳ chọn theo nhu cầu

WebTransport datagram; nút Hà Nội; input-authoritative v2 (nếu có đua/PvP); layer cho hotspot; ứng dụng di động bọc web.

---

## 19. Bản đồ module code

### 19.1 Tạo mới — dùng chung (`js/shared/`, JS thuần, KHÔNG import three; phục vụ tĩnh cho trình duyệt và import bởi Node/bot)

| File | Nội dung |
|---|---|
| `js/shared/constants.js` | tốc độ theo chế độ, gia tốc, bán kính tương tác, `PLAY_RADIUS`, nhịp tick, trần AOI |
| `js/shared/protocol.js` | `PROTO_VERSION`, opcode, mã lỗi/sự kiện |
| `js/shared/codec.js` | BitWriter/BitReader, encode/decode mọi thông điệp, bản ghi tuyệt đối + delta |
| `js/shared/quant.js` | lượng tử hoá x/z/y/yaw/spd/state |
| `js/shared/grid.js` | toán ô 128 m, lân cận, hysteresis |
| `js/shared/move.js` | `stepPlayer`, `stepVehicle` (bước cố định), `validateWindow` |
| `js/shared/clock.js` | đồng bộ đồng hồ, `dayTAt(serverNow, epoch)` |
| `js/shared/weather.js` | hiệu ứng tất định từ lịch + seed |
| `js/shared/survival.js` | công thức chỉ số lười, ngưỡng |
| `js/shared/textfilter.js` | chuẩn hoá tiếng Việt + blocklist (dùng `js/brands.js`) |
| `js/shared/worldversion.js` | SINH bởi `tools/gen_worldversion.mjs` — không sửa tay |
| `js/shared/data/shops.json`, `shelters.json`, `spawns.json`, `colliders.bin` | SINH bởi tools tương ứng |
| `js/shared/quests/*.json` | định nghĩa nhiệm vụ (P4) |

### 19.2 Tạo mới — client (`js/net/` và UI)

`js/net/net.js` (facade `createNet`) · `net_worker.js` (WebSocket + giải mã) · `transport_ws.js` (+ `transport_wt.js` P5) · `session.js` (khách, refresh, Google GIS, liên kết) · `interp.js` (bộ đệm + Hermite + ngoại suy) · `remote_avatars.js` (nhóm instanced, trần TIER) · `nametags.js` (atlas) · `correct.js` (sửa sai mượt) · `telemetry.js` · `netprobe.js` · `js/ui/chat.js` · `js/ui/vitals_hud.js` · `js/ui/shop_panel.js` · `js/ui/jobs_panel.js` · `js/ui/account_panel.js` · `js/progress.js` (adapter local/remote thay localStorage trực tiếp trong quests.js).

### 19.3 Sửa — client (theo điểm móc của `codebase_hooks.md` §9)

| File | Thay đổi |
|---|---|
| `js/main.js` | import net; tạo session sớm (:136-141); join khi Start (:156, :1028) + spawn từ server (thay `SPAWN` :213); `net.sendState` sau `clampToPlayArea` (:725); `net.update` trước `updateNPCs` (:757); mount/dismount/callMoto qua claim (:397/:422/:458); `handleInteract`/`nearestInteraction` thêm loại shop/job/player/quest (:514/:535); nhặt hoa/khám phá qua server (:741-755); thể lực chặn chạy/nhảy (:350/:370); ẩn `window.__hp` sau cờ QA (:885); trạng thái "Đang kết nối" ở boot (:1056) |
| `js/daynight.js` | `syncTo(dayT)`; nhận thời tiết (mây, sương, mưa) |
| `js/quests.js` | chuyển thành view mỏng đọc trạng thái server qua `progress.js` |
| `js/traffic.js` | export `makeGroup`/sơ đồ buffer; `avoidPlayer` xét 8 người chơi khác gần nhất |
| `js/vehicles.js` | claim/nhả, xăng (hook :190), chỗ ngồi sau |
| `js/character.js` | tư thế ngồi sau (pillion) |
| `js/npcs.js` | `action` thành registry (`minigame`, `shop`, `job`, `quest`) |
| `js/ui.js`, `js/input.js` | đăng ký modal mới; phím chat `T` hoặc `/` (Enter đang là tương tác, `input.js:48`); panel không chặn (avatar "bận") |
| `js/i18n.js` | khoá mới, định dạng VND, giờ |
| `js/minimap.js` | tham số `markers` (bạn, nhóm, mục tiêu) |
| `js/audio.js` | `env.remote` (còi/động cơ gần), mưa/gió/sấm |
| `js/roadtex.js`, `js/post.js` | uniform ướt đường; sét |
| `index.html`, `css/style.css` | nickname + nút Google trên màn tiêu đề, HUD chỉ số, chat, CSP meta |
| `.github/workflows/deploy-pages.yml` | loại `server/` (và `admin/`) khỏi gh-pages |
| `KNOWLEDGE.md` | §11 Multiplayer: giao thức, hằng số, quy trình test bot, quy tắc "mọi thứ có giá trị do server quyết" |

### 19.4 Tạo mới — server (`server/`, có `package.json` riêng; client vẫn không có bước build)

```
server/
  package.json                 # uWebSockets.js (tag), pg, jose, nats, iovalkey, prom-client, pino, maxmind
  src/main.js                  # ROLE=all|api|gateway|zone|world, đọc cấu hình từ env
  src/config.js
  src/net/transport.js         # uWS (fallback ws), cork, backpressure, Origin
  src/bus/inproc.js · threads.js · nats.js      # cùng giao diện Bus
  src/gateway/gateway.js · session.js · mirror.js · aoi.js · encoder.js · ratelimit.js · chat.js
  src/zone/zone.js · sim.js · validate.js · handoff.js · vitals.js · actions.js · shops.js · vehicles.js
  src/zone/jobs/shipper.js · xeom.js · vendor.js · port.js · fisher.js · guide.js
  src/zone/quests.js           # P4
  src/world/world.js · clock.js · weather.js · events.js · cellmap.js · netid.js
  src/api/http.js · auth_guest.js · auth_google.js · join.js · telemetry.js · moderation.js · admin.js · privacy.js
  src/db/repo.js · ledger.js · migrations/001_init.sql …
  src/metrics.js · log.js
  data/menu.json · jobs.json
  bots/bot.js · swarm.mjs · scenarios/{walk,drive,hotspot,abuse,economy,handoff}.js
  test/codec.test.js · validate.test.js · ledger.test.js · handoff.test.js   # node --test
  deploy/systemd/*.service · caddy|nginx (nếu cần) · provision.sh · backup.sh · README.md
tools/gen_shops.mjs · gen_colliders.mjs · gen_worldversion.mjs · gen_spawns.mjs · qa/net_smoke.mjs
admin/ (trang tĩnh, triển khai riêng sau Cloudflare Access)
```

---

## 20. Rủi ro và câu hỏi mở cho chủ dự án

1. **PHÁP LÝ (cao nhất)** — NĐ 147/2024/NĐ-CP: game G1 cần doanh nghiệp VN + giấy phép + quyết định phát hành; xác thực tài khoản bằng **số điện thoại VN**; lưu họ tên/ngày sinh/SĐT **tại Việt Nam**; < 18 tuổi giới hạn 60 phút/game, 180 phút/ngày; NĐ 53/2022 về lưu trữ dữ liệu trong nước. Điều này **mâu thuẫn trực tiếp với "chơi ngay bằng nickname"** nếu mở công khai tại VN. Đề xuất: alpha/beta kín theo lời mời trong lúc hỏi luật sư; kiến trúc đã có cờ `verified`, đếm giờ chơi, xuất/xoá dữ liệu, khả năng chuyển cụm về Hà Nội. *Đây không phải tư vấn pháp lý.*
2. **Va chạm server ≠ client**: collider dựng lúc chạy trong `world.js`, có thể khác theo TIER → v1 không dựa vào nó; P3 cần export + test băm.
3. **Hotspot** (Nhà hát lớn, sự kiện): trần AOI + thang suy giảm + spawn rải; layer là van cuối — chủ dự án có chấp nhận layer không?
4. **Băng thông thực** chưa đo: mọi chi phí dùng 3 KB/s; nếu đo ra 10 KB/s, 10k CCU thêm ≈ $1.300/tháng — vẫn trong tầng.
5. **Cáp biển** quốc tế: tối có thể xấu → netprobe quyết nút Hà Nội.
6. **Mobile**: tab bị treo/đổi mạng → resume 60 s; pin do radio thức ở 10 Hz → giảm 5 Hz khi tab ẩn/đứng yên.
7. **Hiệu năng client**: avatar phải là số draw call cố định; frame đã CPU-bound.
8. **Danh sách lọc tiếng Việt** cần người bản ngữ duyệt; kiểm duyệt cần người trực khi mở rộng.
9. Câu hỏi cần chủ dự án chốt: domain; tầng ngân sách khởi đầu (đề xuất: Alpha → 1k); chỉ số sinh tồn đóng băng khi offline?; khách bị giới hạn chat 10 phút đầu?; có PvP/va chạm người–người không (đề xuất KHÔNG ở v1); có bật layer không; có gửi chat sang dịch vụ ML bên ngoài không.

---

## 21. Nguồn

Chi tiết và đường dẫn nguồn nằm trong: `research_backends.md` (so sánh backend, chi phí theo nền tảng, 2026 platform deaths), `research_hosting.md` (giá Vultr đọc từ API, Hetzner/DO/Linode, độ trễ WonderNetwork, cáp biển, R2, Supabase/Neon), `research_netcode.md` (Gaffer, Gambetta, Valve, Mirror, Unreal Replication Graph, uWS, k6, netem, Turnstile, Perspective sunset, NĐ 147), `codebase_hooks.md` (điểm móc file:dòng trong repo). Mô hình băng thông: `model.mjs`; ma trận điểm: `score.mjs`.
