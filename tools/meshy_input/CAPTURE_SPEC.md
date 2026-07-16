# Spec chụp ảnh landmark cho Meshy photo→3D

Các công trình dưới đây **không có ảnh mặt tiền sạch trên mạng** (Wikimedia + web search đã vét).
Cách duy nhất để có model photoreal đẹp là **bạn tự chụp** (bạn ở Hải Phòng). Chụp theo spec này
rồi đưa vào `tools/meshy_input/` — tôi làm sạch + Meshy như đã làm với UBND.

## Nguyên tắc chung (rút từ KNOWLEDGE §5.1)
1. **Góc**: chính diện mặt tiền, HOẶC 3/4 (thấy mặt trước + 1 hông) — 3/4 cho model đủ 2 mặt, tốt hơn.
2. **Ánh sáng**: BAN NGÀY, trời sáng đều, **KHÔNG ngược sáng**, không hoàng hôn/đèn đêm.
3. **Độ phân giải**: ≥ 1600px cạnh dài (crop xong còn ≥1200px).
4. **KHÔNG vật cản** chồng lên dáng công trình: tránh cây, xe, người, cờ, dây điện, biển quảng cáo
   che mặt tiền. Đứng lùi ra, chọn khung ít vật cản nhất (có thể chụp nhiều kiểu rồi chọn).
5. **Đứng thẳng**: máy ngang tầm, hạn chế ngước lên (méo phối cảnh keystone). Lùi xa + zoom nhẹ tốt hơn.
6. Chụp **2-3 kiểu/công trình** (chính diện + 3/4 trái + 3/4 phải) để tôi chọn/ghép.

## Danh sách ưu tiên
| Công trình | Vị trí | Ghi chú chụp |
|---|---|---|
| **Cung VH Việt Tiệp** | 53 Lạch Tray | Khối hiện đại mặt tiền dài — chụp 3/4 để thấy chiều sâu; tránh bãi xe trước cửa. |
| **Nhà Kèn** (bát giác) | Vườn hoa Nguyễn Du (Kim Đồng) | Nhà bát giác nhỏ — chụp chính diện 1 cạnh + thấy mái; tránh ngày có sự kiện (che chân). |
| **Chợ Sắt** | Bờ sông Tam Bạc | Nếu TTTM mới đã xong: chụp mặt tiền; nếu chưa, tạm bỏ (nhà cũ đã phá). |
| **Rạp/Nhà hát Tháng Tám** | Quang Trung | Mặt tiền rạp — chính diện, tránh biển hiệu phim che. |
| **Trung tâm Triển lãm** | (nếu muốn) | BAN NGÀY (ảnh mạng chỉ có hoàng hôn + tượng AFTA che). |

## Sau khi có ảnh
Đưa file vào `tools/meshy_input/` → báo tôi. Tôi: làm sạch (crop tách khối, xoá vật cản/biển brand,
nền đồng đều) → ChatGPT đồng duyệt tới khi hết lỗi → Meshy (`meshy_submit.py`) → GLB → đặt vào game.

## Đã xong
- ✅ **UBND / Hôtel de Ville** — từ bưu thiếp Wikimedia (Public Domain), đã prep + ChatGPT duyệt 5 vòng.
  File: `ubnd_hotel_de_ville.jpg`. Chờ chạy Meshy (cần key).
