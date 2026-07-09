# 551 pano Street View — dải trung tâm TP Hải Phòng

Bộ tư liệu gốc mà đợt phân tích multi-agent đã dùng để đối chiếu thật↔game
(kết quả phân tích: `../audit_done.json`, `../audit_enriched.json`, `../gap_analysis.json`,
bảng đọc được: `../hp_pano_audit.html`).

## Ánh xạ ẢNH → TỌA ĐỘ (đọc cái này là đủ)

**Tên file**: `pano_NNN_hHHH_p0.jpg`
- `NNN` = số pano (001–551)
- `HHH` = heading la bàn của khung nhìn: 000/045/090/135/180/225/270/315
  (000 = nhìn về hướng Bắc, 090 = Đông…)
- `p0` = pitch 0 (nhìn ngang)

**`manifest.json`** (+ `manifest_from421.json` cho pano 421–551): mỗi ảnh một bản ghi
`{ file, panoId, panoLat, panoLng, heading, pitch, date }` — `panoLat/panoLng` là tọa độ
WGS84 THẬT của điểm chụp.

**Đổi sang tọa độ GAME (x,z)** — phép chiếu 1:1 của dự án (xem `KNOWLEDGE.md` §2):

```
LON0 = 106.68182 ; LAT0 = 20.85750
x =  (lng − LON0) × 104040     // UX = 111320·cos(LAT0)
z = −(lat − LAT0) × 110574     // UZ
```

Hoặc tra thẳng **`../audit_enriched.json`**: mỗi pano đã gắn sẵn `X`,`Z` game
(cùng 11 trường mô tả: vỉa hè, nhà cửa, cây, biển hiệu, công trình đặc trưng…).

**Bearing từ pano tới vật thể trong ảnh**: vật ở giữa khung `hHHH` nằm theo hướng
compass HHH từ điểm chụp; trong hệ game `bearing = atan2(dx, −dz)` (0°=Bắc=−Z, 90°=Đông=+X).

Dữ liệu suy dẫn đã nấu vào code: `js/panosides.js` (bitmask 8 hướng thấy-nhà mỗi pano),
`js/housemap.js` (1.920 điểm nhà = pano + 14m theo heading thấy nhà).

Lưu ý: thư mục này bị loại khỏi deploy Vercel (`.vercelignore`); vài file `.crdownload`
là bản tải trùng của Chrome, bỏ qua.
