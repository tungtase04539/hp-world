# Spec chụp ảnh landmark cho Meshy photo→3D (multi-image 3–4 góc)

Mục tiêu: mỗi công trình **3–4 ảnh HIỆN ĐẠI, cùng 1 buổi**, phủ nhiều mặt → Meshy dựng model
**đủ mọi phía** (không đoán hông/lưng). Ảnh online (Wikimedia/web) vừa **cũ** vừa **rời rạc** →
KHÔNG ghép multi-image được (Meshy cần ảnh nhất quán). Vì vậy cần **bạn tự chụp**.

## ⚠️ Quy tắc VÀNG cho multi-image
1. **Cùng 1 buổi, cùng ánh sáng** cho cả 3–4 ảnh của MỘT công trình (đừng trộn sáng/chiều/nhiều hôm).
2. **Đi vòng quanh** chụp các góc bổ sung nhau, KHÔNG đứng yên zoom.
3. Cùng máy, cùng phơi sáng; công trình luôn là chủ thể chính, chiếm ~70–80% khung.

## 4 góc nên có (mỗi công trình)
| # | Góc | Mục đích |
|---|---|---|
| 1 | **Chính diện mặt trước** | mặt tiền chuẩn (quan trọng nhất) |
| 2 | **3/4 trái** (chếch ~40°) | thấy mặt trước + hông trái |
| 3 | **3/4 phải** (chếch ~40°) | thấy mặt trước + hông phải |
| 4 | **Mặt sau / hoặc từ trên cao** (nếu tới được) | khép khối, mái (bạn nhắc "từ trên xuống") |

→ Tối thiểu **góc 1+2+3**; có thêm góc 4 càng toàn diện.

## Kỹ thuật (rút từ KNOWLEDGE §5.1)
- **BAN NGÀY**, trời sáng đều, **không ngược sáng / không hoàng hôn / không đèn đêm**.
- **≥1600px** cạnh dài mỗi ảnh (crop xong ≥1200px).
- **Không vật cản** che dáng: tránh cây/xe/người/cờ/dây/biển quảng cáo chồng lên mặt tiền — lùi ra, đợi thoáng.
- **Máy ngang tầm mắt**, hạn chế ngước (méo keystone); lùi xa + zoom nhẹ thay vì đứng sát ngửa máy.

## Danh sách ưu tiên
| Công trình | Vị trí | Lưu ý |
|---|---|---|
| Cung VH Việt Tiệp | 53 Lạch Tray | khối hiện đại dài — 3/4 để lộ chiều sâu; tránh bãi xe trước cửa |
| Nhà Kèn (bát giác) | Vườn hoa Nguyễn Du | nhà bát giác — đi vòng chụp 4 cạnh; tránh ngày có sự kiện |
| Chợ Sắt (TTTM mới) | bờ Tam Bạc | chỉ chụp khi mặt tiền mới đã hoàn thiện |
| Rạp/Nhà hát Tháng Tám | Quang Trung | tránh poster phim che mặt tiền |
| UBND TP | 18 Hoàng Diệu | (nếu toà Pháp cũ còn) chụp MỚI 3–4 góc để thay bưu thiếp cũ |

## Giao ảnh → tôi lo phần còn lại
Bỏ ảnh vào `tools/meshy_input/<tên_công_trình>/` (vd `viettiep/1.jpg 2.jpg 3.jpg`) → báo tôi.
Tôi: làm sạch từng ảnh (crop, xoá vật cản/biển brand, nền đồng đều) → ChatGPT đồng duyệt →
`meshy_submit.py "viettiep/1.jpg,viettiep/2.jpg,viettiep/3.jpg" "<prompt>" viettiep` → GLB → đặt vào game.

## Đã làm mẫu
- **UBND** (`ubnd_hotel_de_ville.jpg`) — từ **1 bưu thiếp Public Domain (cũ, 1 góc)** → chỉ đủ single-image
  (bas-relief). Nếu bạn chụp mới 3–4 góc toà UBND hiện tại, tôi thay bằng model đủ mặt.
