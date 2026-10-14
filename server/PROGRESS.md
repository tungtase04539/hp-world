# server/PROGRESS.md — nhật ký tiến độ các gói việc

## Foundation (tag `found`, 14/10/2026) — XONG

- js/shared: constants, protocol, quant, codec (mọi opcode ARCH §6.4, P1 tuyệt đối, Writer/BitWriter/BitReader,
  SnapshotBuilder, decode không ném lỗi), grid, clock, spawns (8 điểm, kiểm theo dữ liệu hiện hành), textfilter (stub, API cuối).
- server: config (+ sinh server/.env), log, metrics, net/transport (uWS v20.71.0 ↔ ws tự lùi), http/router, db (pg | PGlite),
  migrate + 001_base.sql, app (bus/timers/services), main.js với 17 module stub chạy được.
- Test: `npm test` 39 xanh (Windows, PGlite); `npm run test:pg` 4 xanh (Docker postgres:17, project hpmp-found, cổng 55432,
  đã dọn); uWS + ws kiểm cả trong container node:24-trixie-slim.
- Tài liệu: server/CONTRACT.md, docs/multiplayer/SERVER.md §1, server/.env.example.
- Còn mở: xem SERVER.md §1.8.

## S2 CORE (tag `s2core`, 15/10/2026) — XONG

- Tài khoản: guest + mã mời + `Nick#1234` + refresh xoay vòng (phát hiện dùng lại) + JWT EdDSA 15' + mã khôi phục 12 ký tự;
  `/v1/join` vé HMAC 60 s 1 lần + trần CCU + hàng chờ có ETA.
- WS `/play`: HELLO→WELCOME→READY→keyframe, 1 phiên/tài khoản, resume 60 s (AWAY), RELOAD khi lệch proto, BACKOFF.
- Mô phỏng 20 Hz, snapshot 10 Hz so le, AOI 128 m (trần 96, ưu tiên, tầng xa, ENTER ≤ 24), NAMES 1 lần, bỏ snapshot khi
  nghẽn → keyframe, thang L0–L4; kiểm di chuyển (`js/shared/move.js`), điểm → CORRECT/kick; chat SAY 40 m qua `chat.handle`.
- Lưu nhân vật (bẩn 30 s + khi rớt + khi tắt) + `playtime_daily`.
- Test: `npm test` 68 xanh (+1 bỏ qua cần Docker); `node test/core_pg.mjs` 12/12 trên Postgres 17 (hpmp-core, 55433, đã dọn).
- Đo: 1.000 phiên tick p50 3,4 / p99 5,9 ms; 300 dồn 1 điểm p99 8,7 ms, snapshot p95 914 B; 2.000 phiên p99 15,8 ms.
- Chi tiết: docs/multiplayer/SERVER.md §2.

## S3 An toàn chat + quản trị + cảnh báo (tag `safety`, 15/10/2026) — XONG

- `js/shared/textfilter.js`: bộ lọc tiếng Việt thật (dấu thanh / dấu chữ, teencode, leet, chèn dấu, cách quãng,
  zero-width, chữ Kirin / toàn khổ, link / SĐT / nick MXH, allow-list); danh sách `server/data/filter/*.txt` nhúng bằng
  `server/scripts/filter_sync.mjs`. Corpus 532 câu thường (100 % qua) + 338 câu xấu (98,5 % bắt đúng mức), p99 142 µs.
- `server/src/chat/*` (dịch vụ `chat`), `alerts.js` (Telegram), `admin/*` + `server/admin/*` (trang quản trị),
  `api/moderation.js`, migration 020–023.
- Test: `npm test` 71 xanh (32 test S3); `node test/safety_pg_run.mjs` 20/20 trên Postgres 17 (hpmp-safety:55434, đã
  dọn); smoke trang quản trị 1 Chrome dưới khoá GPU: 12 ảnh, 0 lỗi.
- Còn mở: docs/multiplayer/SERVER.md §3.9 (nối gateway S2, ADMIN_ALLOW_IPS trong Docker S5, mã EVENT.SANCTION).

## S5 Vận hành tự host + netprobe (tag `s5ops`, 15/10/2026) — XONG

- Docker: `server/Dockerfile` (node:24-trixie-slim ghim digest, uWS nạp được trong container, non-root, root FS chỉ đọc,
  kiểm import lúc build), `server/docker-compose.yml` (game + db + profile tunnel/quicktunnel/backup; mạng edge/backend
  internal; mọi cổng 127.0.0.1; cap_drop ALL; giới hạn CPU/RAM/PID; log xoay vòng), ingress tunnel chỉ 4 đường.
- Script `server/ops/*.ps1` (PowerShell 5.1, tiếng Việt): mở/tắt/trạng thái/sao lưu/khôi phục (diễn tập + thật)/mã mời/
  lịch/khẩn cấp/giữ máy thức — chạy thật trên máy này ở chế độ thử (bộ hpmp-ops, cổng 9140/9141).
- netprobe: WS /probe có giới hạn, POST /v1/netprobe + migration 030, admin `/admin/api/netprobe`, `netprobe.html`.
- Bảo vệ cổng admin khỏi tunnel/edge (`api/admin_edge_guard.js`).
- Tài liệu: `docs/multiplayer/VAN_HANH.md` (chủ dự án), SERVER.md §5 (kỹ thuật + số đo).

## S4 Bot & load test (14–15/10/2026) — XONG phần harness

- `server/bots/`: run.mjs (7 kịch bản, fork/thread, /metrics, report.json + report.md, --rerender), worker.mjs, lib/{bot,
  roadgraph, abuse, netem, metrics, report, stats, phrases}, fakeserver.mjs (máy chủ giả đủ giao thức để phát triển).
- Test: `server/test/bots.test.js` (6 test: histogram, đồ thị đường thật, netem FIFO, kế hoạch kịch bản, e2e máy chủ giả
  smoke/reconnect/abuse, e2e máy chủ nền móng chế độ ping).
- Đo trên máy chủ nền móng: smoke 50, hotspot 300 (GPU lock), ramp 1.200 (GPU lock) — SERVER.md §4.5.
- Còn chờ: chạy đủ 7 kịch bản trên máy chủ đã gộp S2/S3 (integrator), xem SERVER.md §4.6.

## Tích hợp (integrator, nhánh worktree-wf_5a0111aa-fcc-6, 15/10/2026) — XONG

- Gộp `--no-ff` S2 → S3 → S5 → S4 trên nền móng `9c80c1a`; xung đột chỉ ở tài liệu + `boot.test.js` (không còn stub 501).
- Nối gateway ↔ chat (msgRef, SUPPORT_LINE, chặn bền, xử phạt kick/ban/mute/warn/shadow, cấm có hạn ở join + HELLO,
  phát thanh + báo khởi động lại), vị trí phiên cho S3, bản đồ admin, MỘT route netprobe admin, `ACTION_RESULT` +
  `SANCTION_KIND` vào `protocol.js`; Docker: `xsection.js` vào ảnh, `ADMIN_ALLOW_IPS` = gateway `hostlink` cố định,
  `DATA_DIR` = volume `gamedata`; `chung.ps1` sửa thư mục làm việc khi tạo `.env`.
- Sửa theo kết quả chạy bot (nguyên nhân gốc): speed-hack bị CORRECT < 1 s; vé giữ chỗ tới khi phiên tạo xong (hết
  SERVER_FULL); thang suy giảm quyết theo p90 (p99 đo nhiễu ~1 Hz của máy); harness bot (deviceId, không lội nước,
  worker không mất kết quả / không treo, giữ access token, đo lách lọc bằng tin vọng).
- Test: `npm test` 126 xanh + 1 bỏ qua; `npm run test:pg` 40/40 (Postgres 17, `hpmp-integ-pg:55437`, đã dọn);
  `server/test/integ.test.js` (5) mới.
- Đủ 7 kịch bản bot + Docker + quick tunnel + trang admin trong 1 Chrome: SERVER.md §6.5. Còn trượt: tick/event-loop p99
  ở 1.200 CCU trên máy này (nhiễu máy + chi phí send của Windows) — SERVER.md §6.4 / §6.6.
- Dọn: không còn container / volume / ảnh `hpmp-integ*`, không còn gì nghe 9150/9151/55437; `server/.env`, `server/data`
  thử đã xoá.

## Vòng sửa 1 (fixer, 15/10/2026) — XONG

- Sửa 29 phát hiện (an ninh SEC-1..7, netcode NET-1..12, an toàn/vận hành SO-1..10) + phần lớn ghi chú "nice to have";
  chi tiết từng mục, nguyên nhân gốc và số đo: SERVER.md §7. Client cần biết: CONTRACT.md §7.
- Test: `test/fix1_regress.test.js` (21 test, một cho mỗi phát hiện); `npm test` 147 xanh + 1 bỏ qua; `npm run test:pg`
  61/61 (Postgres 17 `hpmp-fix:55441`, đã dọn).
- Kịch bản bot (GPU lock, 9175/9176): smoke, abuse (16 lớp), reconnect 1.000, netem-lite, ramp 1.200; Docker `hpmp-fix`
  (portal + mạng internal, quick tunnel, khoá khẩn cấp, tắt). Dọn: không còn container / volume / mạng / ảnh `hpmp-fix*`,
  không còn gì nghe 9175/9176/55441; `server/.env` và `server/data` thử đã xoá.
