-- 030_netprobe.sql — S5: kết quả đo mạng từ netprobe.html (POST /v1/netprobe).
-- KHÔNG lưu dữ liệu cá nhân: không IP, không user-agent đầy đủ, không tài khoản. Chỉ nhà mạng + loại mạng + số đo.
-- Giữ 90 ngày (job dọn hằng ngày trong server/src/api/netprobe.js).
CREATE TABLE netprobe_results (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  carrier     text NOT NULL CHECK (carrier IN ('viettel', 'vnpt', 'fpt', 'mobifone', 'vinaphone', 'khac')),
  net_type    text NOT NULL CHECK (net_type IN ('wifi', '4g', '5g', 'khac')),
  samples     smallint NOT NULL CHECK (samples BETWEEN 1 AND 100),
  lost        smallint NOT NULL CHECK (lost >= 0 AND lost <= samples),
  median_ms   real NOT NULL CHECK (median_ms >= 0),
  p95_ms      real NOT NULL CHECK (p95_ms >= 0),
  jitter_ms   real NOT NULL CHECK (jitter_ms >= 0),
  min_ms      real NOT NULL CHECK (min_ms >= 0),
  max_ms      real NOT NULL CHECK (max_ms >= 0),
  device      text NOT NULL DEFAULT 'khac' CHECK (device IN ('dienthoai', 'maytinh', 'khac')),   -- thô, không định danh
  via         text NOT NULL DEFAULT 'tunnel' CHECK (via IN ('tunnel', 'local'))                  -- đo qua tunnel hay nội bộ
);
CREATE INDEX netprobe_results_created_idx ON netprobe_results (created_at);
CREATE INDEX netprobe_results_carrier_idx ON netprobe_results (carrier, net_type, created_at);
