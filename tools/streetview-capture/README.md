# HP Street View Capturer (extension Chrome)

Chụp **Street View 360°** theo tọa độ **dải trung tâm Hải Phòng**, tự xoay hết các góc ở mỗi
điểm, tải về thành **1 thư viện ảnh** — mỗi ảnh gắn **tọa độ + góc quay** (trong `manifest.json`).

Vì môi trường máy chủ (Claude Code remote) chặn Google Maps, extension này chạy trên **máy của
bạn** (nơi vào được Street View). Bạn chạy nó, nó chụp, rồi gửi thư mục ảnh lại cho mình để mình
dùng làm **tham chiếu** dựng dãy phố dải trung tâm cho khớp thật (không nhúng pixel Google vào game).

## Cần chuẩn bị: 1 Google Maps API key (miễn phí)
1. Vào <https://console.cloud.google.com/> → tạo project.
2. **APIs & Services → Enable APIs** → bật **Maps JavaScript API**.
3. **Credentials → Create credentials → API key** → copy key (`AIza…`).
   (Không cần thẻ để dùng mức miễn phí Maps JavaScript API cho việc này; nếu Google bắt bật billing
   thì mức free hàng tháng vẫn dư cho lần chụp này.)

## Cài extension
1. Mở Chrome → `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. **Load unpacked** → chọn thư mục `tools/streetview-capture/`.
4. Bấm biểu tượng extension trên thanh công cụ → mở **trang chụp**.

## Chụp
1. Dán **API key** vào ô.
2. Tuỳ chọn:
   - **Số góc / vòng**: 8 = mỗi 45° (đủ phủ 360°). Muốn kỹ hơn để 12 (30°).
   - **Pitch**: `0` là ngang tầm mắt. Muốn thêm mái nhà để `0,15`; thêm vỉa hè để `-10,0,15`.
   - **Chờ tải tile**: tăng nếu mạng chậm (ảnh chưa nét đã chụp).
   - **Bán kính tìm pano**: 70m — điểm nào không có Street View sẽ **tự bỏ qua**.
3. **▶ Bắt đầu chụp**. Cứ để tab chạy (đừng chuyển tab — `captureVisibleTab` chụp tab đang hiện).
4. Xong: ảnh nằm ở **Downloads/hp-streetview/** kèm **manifest.json**.

> Lưu ý: Hải Phòng có thể **thưa Street View chính thức**; extension chụp **hết chỗ nào có phủ**
> và tự bỏ điểm không có. `manifest.json` ghi lại `date`/`copyright` từng pano.

## Cấu trúc mỗi ảnh trong `manifest.json`
```json
{
  "file": "pano_007_h045_p0.jpg",
  "reqLat": 20.8571, "reqLng": 106.6829,   // tọa độ yêu cầu (trên đường thật)
  "panoId": "…", "panoLat": 20.8572, "panoLng": 106.6830,  // pano thực Google trả về
  "heading": 45, "pitch": 0, "zoom": 1,
  "date": "2019-08", "copyright": "© Google"
}
```

## Tọa độ chụp ở đâu ra?
`coords.js` = các điểm **bám đúng đường thật** dải trung tâm, lấy từ dữ liệu OSM của chính dự án
(`js/mapdata.js`) rồi chuyển ngược phép chiếu về lat/lng. Muốn đổi phạm vi/độ dày:
```
node tools/gen_sv_coords.mjs 1100 40    # radius 1100m, cách 40m  → sinh lại coords.js
```

## Sau khi chụp xong
Nén thư mục `hp-streetview/` (kèm `manifest.json`) gửi lại cho mình. Mình sẽ:
- Dùng làm tham chiếu chỉnh **màu tường, số tầng, kiểu mái, ban công, biển hiệu** dãy phố trung tâm.
- Với toà nhà tiêu biểu có ảnh rõ mặt → có thể đưa vào Meshy như pipeline địa danh.
