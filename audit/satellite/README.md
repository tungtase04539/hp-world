# Đối chiếu vệ tinh (QA cấu trúc) — kết hợp với pano

Hai lớp QA bổ trợ:
- **Pano** (551 ảnh street-view): soi BỀ MẶT phố (nhà/biển/màu tầng mắt người).
- **Vệ tinh** (8 tile top-down): soi CẤU TRÚC (đường, sông, vị trí & mật độ nhà, công trình lớn).

`game_N.png` = ảnh game chụp bằng `__hp.aerial` (build hiện tại), khớp đúng 8 tâm bạn đã chụp.

## Bạn cần: lưu 8 ảnh vệ tinh THẬT vào thư mục này, đúng tên `real_1.png` … `real_8.png`

| tile | khu vực | tâm thật (lat, lon) |
|------|---------|----------------------|
| real_1 | Tây-Nam: hồ Tam Bạc / BV Quốc tế / THPT Ngô Quyền | 20.85524, 106.67509 |
| real_2 | An Biên / Đền Nghè | 20.85691, 106.67675 |
| real_3 | An Biên / ga / Nguyễn Bình Khiêm | 20.85738, 106.68114 |
| real_4 | Tây-Bắc: Lê Hồng Phong / Trần Văn Ơn / Nhà thờ / Tam Bạc arc | 20.86135, 106.67113 |
| real_5 | Nhà thờ / Tam Bạc arc | 20.86131, 106.67884 |
| real_6 | Trung-Bắc: Nhà hát / Quang Trung / Minh Khai | 20.86182, 106.68172 |
| real_7 | Bắc: Bạch Đằng / cầu Lạc Long / sông Cấm tây | 20.86583, 106.67294 |
| real_8 | Bắc: Hoàng Diệu / Cảng / sông Cấm đông | 20.86585, 106.67983 |

(Chính là 8 ảnh Google Earth bạn vừa gửi — chỉ cần lưu file với đúng tên trên.)

## Sau khi lưu xong → nhắn tôi
Tôi chạy `tools/pano_loop/score_sat.py` (ChatGPT chấm CẤU TRÚC từng tile 0-10),
ghép cạnh nhau thật/game, gộp với điểm pano → **QA hai lớp**:
- điểm vệ tinh thấp = sai đường/vị trí/mật độ → sửa `tools/process_osm.mjs` / generator.
- điểm pano thấp = sai bề mặt phố → grid cấu trúc+màu nhà chính.

## KẾT QUẢ CHẤM CẤU TRÚC (2026-07-15, gpt-5.6-sol-xhigh) — TB 5.64/10
| tile | khu | điểm |
|---|---|---|
| 2 | An Biên/Đền Nghè | 6.7 |
| 7 | Bạch Đằng/cầu Lạc Long | 6.6 |
| 3 | An Biên/ga | 6.3 |
| 6 | Nhà hát/Quang Trung | 6.3 |
| 1 | Tam Bạc lake/Ngô Quyền | 5.6 |
| 5 | Nhà thờ/Tam Bạc arc | 5.2 |
| 8 | Hoàng Diệu/Cảng | 4.4 |
| 4 | Lê Hồng Phong/Tam Bạc arc | 4.0 |

**Lỗi cấu trúc phát hiện:** (t4) sông Tam Bạc arc vẽ ĐỨT KHÚC thành vũng rời (cần liền mạch);
(t8) khu Bắc/cảng thưa + thiếu nhà kho cảng. So sánh: pano(bề mặt) 4.14/6, vệ tinh(cấu trúc) 5.64/6.
