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

## S3 An toàn chat + quản trị + cảnh báo (tag `safety`, 15/10/2026) — XONG

- `js/shared/textfilter.js`: bộ lọc tiếng Việt thật (dấu thanh / dấu chữ, teencode, leet, chèn dấu, cách quãng,
  zero-width, chữ Kirin / toàn khổ, link / SĐT / nick MXH, allow-list); danh sách `server/data/filter/*.txt` nhúng bằng
  `server/scripts/filter_sync.mjs`. Corpus 532 câu thường (100 % qua) + 338 câu xấu (98,5 % bắt đúng mức), p99 142 µs.
- `server/src/chat/*` (dịch vụ `chat`), `alerts.js` (Telegram), `admin/*` + `server/admin/*` (trang quản trị),
  `api/moderation.js`, migration 020–023.
- Test: `npm test` 71 xanh (32 test S3); `node test/safety_pg_run.mjs` 20/20 trên Postgres 17 (hpmp-safety:55434, đã
  dọn); smoke trang quản trị 1 Chrome dưới khoá GPU: 12 ảnh, 0 lỗi.
- Còn mở: docs/multiplayer/SERVER.md §3.9 (nối gateway S2, ADMIN_ALLOW_IPS trong Docker S5, mã EVENT.SANCTION).
