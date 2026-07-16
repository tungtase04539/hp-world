# HP Landmark Image Grabber (extension Edge/Chrome)

Tải **ảnh gốc hàng loạt** từ Google Images cho dự án Hải Phòng 3D — vượt tường chặn hotlink/CORS
(extension có host-permission, `chrome.downloads` gửi request như trình duyệt).

## Cài (Edge — 1 lần)
1. Mở `edge://extensions`
2. Bật **Chế độ nhà phát triển** (Developer mode) — góc trái dưới.
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục
   `C:\Users\Admin\hp-world\tools\gg_image_grabber`
4. Xong. (Chrome: `chrome://extensions` → y hệt.)

## Dùng — extension này DÀNH CHO CLAUDE (bạn chỉ cài 1 lần)
Sau khi cài, **Claude tự tải** qua cầu nối message (không cần bạn bấm gì):
- Claude điều khiển tab Edge → chạy JS trong trang Google Images →
  `window.postMessage({type:'HP_GRAB', folder:'...'}, '*')`
- content script bắt được → trích URL gốc → background `chrome.downloads` tải về
  `Downloads/hp_landmark/<từ-khoá>/` → Claude đọc file, lọc, làm sạch, Meshy.

Nút đỏ **"⬇ Tải ảnh gốc (HP)"** góc phải-trên là để bạn tự bấm khi muốn (tuỳ chọn).

### Giao thức message (Claude dùng)
- Gửi: `postMessage({type:'HP_GRAB', urls?:[...], folder?:'...'})` — không có `urls` thì tự trích trên trang.
- Nhận lại: `{type:'HP_GRAB_ACK', count, folder}` (ngay) rồi `{type:'HP_GRAB_RESULT', count, folder}` (sau khi gửi tải).

## Ghi chú
- Nút trích URL từ link `/imgres?imgurl=...` (URL gốc thật), dự phòng quét HTML.
- Nguồn ký-URL chặt (vài ảnh Facebook/TripHunter) có thể lỗi lẻ — cứ để, ảnh khác vẫn tải.
- Chỉ tải ảnh cho việc dựng model công trình công cộng có thật (photo→3D, giữ attribution nguồn).
