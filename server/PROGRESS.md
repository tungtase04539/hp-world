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

## S5 Vận hành tự host + netprobe (tag `s5ops`, 15/10/2026) — XONG

- Docker: `server/Dockerfile` (node:24-trixie-slim ghim digest, uWS nạp được trong container, non-root, root FS chỉ đọc,
  kiểm import lúc build), `server/docker-compose.yml` (game + db + profile tunnel/quicktunnel/backup; mạng edge/backend
  internal; mọi cổng 127.0.0.1; cap_drop ALL; giới hạn CPU/RAM/PID; log xoay vòng), ingress tunnel chỉ 4 đường.
- Script `server/ops/*.ps1` (PowerShell 5.1, tiếng Việt): mở/tắt/trạng thái/sao lưu/khôi phục (diễn tập + thật)/mã mời/
  lịch/khẩn cấp/giữ máy thức — chạy thật trên máy này ở chế độ thử (bộ hpmp-ops, cổng 9140/9141).
- netprobe: WS /probe có giới hạn, POST /v1/netprobe + migration 030, admin `/admin/api/netprobe`, `netprobe.html`.
- Bảo vệ cổng admin khỏi tunnel/edge (`api/admin_edge_guard.js`).
- Tài liệu: `docs/multiplayer/VAN_HANH.md` (chủ dự án), SERVER.md §5 (kỹ thuật + số đo).
