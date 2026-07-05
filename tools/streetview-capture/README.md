# HP Street View Capturer (extension Chrome, v2)

Chụp **Street View 360°** dải trung tâm Hải Phòng **ngay trên instantstreetview.com** — **KHÔNG
cần API key**. Extension chèn 1 bảng điều khiển vào trang, tái dùng Google Maps mà trang đã nạp,
tự lái panorama xoay đủ các góc ở từng tọa độ và chụp về **1 thư viện ảnh** (mỗi ảnh gắn **tọa độ
+ góc quay** trong `manifest.json`).

Chạy trên **máy của bạn** (nơi vào được Street View); máy chủ Claude Code remote bị chặn Google.

## Cài extension
1. Chrome → `chrome://extensions` → bật **Developer mode** (góc trên phải).
2. **Load unpacked** → chọn thư mục `tools/streetview-capture/`.
3. Bấm **icon extension** trên thanh công cụ → nó tự mở **instantstreetview.com** kèm bảng điều khiển
   góc trên-trái. (Hoặc tự vào <https://www.instantstreetview.com/> — bảng vẫn hiện.)

## Chụp
1. Chờ trang instantstreetview hiện ảnh Street View (Google Maps đã nạp).
2. Trên bảng điều khiển, chỉnh nếu muốn:
   - **Số góc / vòng**: 8 = mỗi 45° (đủ phủ 360°). Kỹ hơn để 12.
   - **Pitch**: `0` ngang mắt; thêm mái để `0,15`; thêm vỉa hè để `-10,0,15`.
   - **Chờ tile / Nghỉ giữa ảnh**: tăng nếu mạng chậm.
   - **Bán kính tìm pano**: 70m — điểm nào không có Street View **tự bỏ qua**.
3. **▶ Bắt đầu chụp** → **để yên tab đang chạy** (đừng chuyển tab; `captureVisibleTab` chụp tab đang hiện).
4. Xong: ảnh ở **Downloads/hp-streetview/** + **manifest.json**.

> Không cần API key vì extension dùng lại Google Maps mà instantstreetview đã tải sẵn.
> Hải Phòng có thể thưa Street View — extension chụp hết chỗ có phủ, tự bỏ điểm trống.

## Kiến trúc (vì sao 2 file JS chạy trên trang)
- `page.js` (world **MAIN**): chạy cùng ngữ cảnh trang → dùng được `google.maps` đã nạp; tạo panorama
  phủ toàn trang, lái POV, vòng lặp chụp, chèn bảng điều khiển.
- `bridge.js` (world **ISOLATED**): chỉ world này có `chrome.*`; nhận lệnh của page.js qua
  `postMessage` rồi gọi `background.js` để `captureVisibleTab` + tải file.
- `background.js`: service worker — chụp tab + `downloads`; mở instantstreetview khi bấm icon.
- `coords.js`: 446 tọa độ bám đường thật (gán `window.HP_WAYPOINTS`).

## `manifest.json` mỗi ảnh
```json
{ "file":"pano_007_h045_p0.jpg",
  "reqLat":20.8571,"reqLng":106.6829,
  "panoId":"…","panoLat":20.8572,"panoLng":106.6830,
  "heading":45,"pitch":0,"zoom":1,
  "date":"2019-08","copyright":"© Google" }
```

## Đổi phạm vi tọa độ
```
node tools/gen_sv_coords.mjs 1100 40   # radius 1100m, cách 40m → sinh lại coords.js
```

## Sau khi chụp
Nén `hp-streetview/` (kèm `manifest.json`) gửi lại cho mình → mình dùng làm **tham chiếu** dựng dãy
phố dải trung tâm cho khớp thật (màu tường, số tầng, kiểu mái, ban công, biển hiệu); toà tiêu biểu
ảnh rõ mặt → đưa vào Meshy như pipeline địa danh. (Chỉ tham chiếu, không nhúng pixel Google vào game.)
