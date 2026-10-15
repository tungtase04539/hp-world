# server/ops/cloudflared/Dockerfile — S5. cloudflared (ghim digest, bản 2026.7.2) + file ingress cố định.
# Ảnh gốc là distroless, chạy user 65532 (không root). Token KHÔNG ở trong ảnh: compose truyền TUNNEL_TOKEN từ server/.env.
FROM cloudflare/cloudflared:2026.7.2@sha256:4f6655284ab3d252b7f28fedb19fe6c8fc82ee5b1295c20ac74d475e5398a52d
COPY config.yml /etc/cloudflared/config.yml
USER 65532:65532
