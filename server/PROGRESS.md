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
