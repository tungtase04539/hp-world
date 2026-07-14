# Đối chiếu ảnh vệ tinh (QA cấu trúc: đường xá + vị trí công trình)

Mỗi tile phủ **640m × 640m** (±320m quanh tâm), **Bắc hướng lên, Đông sang phải**.
Ảnh game (`game_tN.png`) đã chụp sẵn bằng `window.__hp.aerial()` → `tools/pano_loop/aerial.mjs`.

## Cách lấy 8 ảnh vệ tinh THẬT
Với mỗi tile: mở **Google Maps → chế độ Vệ tinh (Satellite)** tại toạ độ dưới,
xoay **Bắc lên**, zoom sao cho khung phủ ~**640m ngang** (≈ thanh tỉ lệ 100m × ~6),
chụp màn hình vùng vuông, lưu vào thư mục này với đúng tên `real_tN.png`.

| tile | tâm (lat, lon) | lưu tên |
|------|----------------|---------|
| t1 | 20.85976, 106.67413 | real_t1.png |
| t2 | 20.85976, 106.67913 | real_t2.png |
| t3 | 20.85976, 106.68413 | real_t3.png |
| t4 | 20.85976, 106.68874 | real_t4.png |
| t5 | 20.85316, 106.67413 | real_t5.png |
| t6 | 20.85316, 106.67913 | real_t6.png |
| t7 | 20.85316, 106.68413 | real_t7.png |
| t8 | 20.85316, 106.68874 | real_t8.png |

overview (toàn dải, ±1100m): tâm 20.85660, 106.68086 → `real_overview.png` (tuỳ chọn).

Mẹo nhanh: dán trực tiếp vào ô tìm kiếm Google Maps chuỗi `20.85976, 106.67413`
rồi bật lớp Vệ tinh — nó nhảy đúng tâm.

## Sau khi thả đủ ảnh
Báo tôi — tôi sẽ tự căn tỉ lệ, ghép cạnh nhau (thật/game), và soi:
đường có đúng vị trí/hướng không, ô phố & footprint nhà có khớp không,
công trình công cộng lớn có đúng chỗ không → sửa `tools/process_osm.mjs`
hoặc dữ liệu nguồn nếu lệch.
