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

## Cách chạy (CÁCH B — chắc ăn, điều hướng URL)
Từ v3, extension **không tạo panorama riêng** (tránh màn đen). Thay vào đó:
1. **Pha 1** (không tải lại): dùng `google.maps.StreetViewService` của trang dò 446 tọa độ → lọc ra
   các **pano có Street View** thật (bỏ điểm trống), dựng danh sách công việc = pano × góc × pitch.
2. **Pha 2**: lần lượt **đổi URL** `.../@lat,lng,{heading}h,{pitch}p,0z,{panoId}` → trang **tự tải lại**
   và hiện đúng view đó → chờ `Chờ tải trang (ms)` → **chụp chính ảnh trang đang hiển thị** → sang cái kế.
   Tiến trình lưu qua mỗi lần tải lại (chrome.storage) nên tự chạy tiếp, không cần bấm lại.

> Vì mỗi ảnh là 1 lần tải lại trang nên **chậm** (vài giây/ảnh) nhưng **chắc chắn đúng ảnh trang hiện**.
> Muốn nhanh: giảm **Số góc/vòng** xuống 4–6. **Đừng chuyển tab** khi đang chạy.

## Kiến trúc file
- `page.js` (world **MAIN**): dùng `google.maps` của trang (Pha 1), điều hướng URL + vòng chụp, bảng điều khiển.
- `bridge.js` (world **ISOLATED**, chỉ world này có `chrome.*`): lưu/đọc tiến trình (`chrome.storage`) và
  chuyển lệnh `captureVisibleTab`/tải file sang `background.js` qua `postMessage`.
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
