# Hải Phòng 3D — Thiết kế gameplay: Đời sống thành phố, Kinh tế & Nghề, Nhiệm vụ, Xã hội (bản 1, 2026-10-14)

> Vai trò: Lead Game Designer. Phạm vi: lối chơi sinh tồn kiểu "đời sống thành phố", kinh tế và nghề, hệ thống nhiệm vụ và cốt truyện, tính năng xã hội cho hơn 1.000 người chơi trong cùng một thế giới.
> Tài liệu đọc kèm (cùng thư mục): `codebase_hooks.md` (điểm cắm vào code), `research_netcode.md` (AOI 128 m, snapshot 10 Hz, chống gian lận, Nghị định 147), `research_backends.md`, `research_hosting.md`.
> Nguồn dữ liệu đã đo trong repo (nhánh `dot3`, `bcdcacc`): `js/quests.js`, `js/npcs.js`, `js/landmarks.js` (26 địa danh, 22 trong vùng chơi), `js/mapdata.js` (`LM` 29 điểm, `PARKS` 37, `STREETS`, `EXTRAS`), `js/shopsigns.js` (1.154 biển hiệu, tất cả trong đĩa chơi), `audit/audit_enriched.json` (551 pano đời sống phố thật), `js/daynight.js` (`DAY_LENGTH = 1440` s), `docs/KICHBAN_*`, `docs/HOI*_PHANCANH.md`.
> Quy tắc chủ dự án áp dụng xuyên suốt: KHÔNG tên thương hiệu thật (từ chung OK). Mọi tên xe, ứng dụng, cửa hàng trong game là tên chung hoặc hư cấu.

Ký hiệu độ tin cậy: **[ĐO]** = đo/đếm từ dữ liệu repo · **[ĐX]** = đề xuất thiết kế, cần tinh chỉnh bằng số liệu beta · **[THẬT]/[HƯ CẤU]/[CẦN KIỂM CHỨNG]** = quy ước nội dung lịch sử, giữ nguyên như `docs/KICHBAN_1946_1955.md`.

---

## 0. Trụ cột thiết kế và quy ước chung

### 0.1 Năm trụ cột
1. **Sống như người Hải Phòng.** Nhu cầu cơ thể được giải quyết bằng chính thành phố thật: ăn bánh đa cua ở quán ven hồ Tam Bạc, uống trà đá vỉa hè, trú mưa dưới mái hiên bạt, ngủ nhà nghỉ. Không có "túi thần kỳ" hồi máu.
2. **Thân thiện, không hardcore.** Không mất đồ, không mất cấp, không chết vĩnh viễn. Bỏ mặc nhu cầu khoảng 2 giờ chơi mới ngất, ngất chỉ tốn một khoản phí nhỏ và một chút thời gian.
3. **Cùng nhau mới vui.** Mọi nghề đều có biến thể co-op; sự kiện thành phố (bão, Trung thu, lễ hội Hoa Phượng) cần cả server góp sức.
4. **Chơi mà học.** Lịch sử và văn hóa Hải Phòng đi vào hành động (giao thư ở Bưu điện, dẫn tour ở Nhà hát lớn), không bắt đọc bài giảng. Dữ kiện có gắn nhãn nguồn.
5. **Cái gì có giá trị thì server giữ.** Chỉ số sinh tồn, tiền, đồ, tiến độ nhiệm vụ là trạng thái server, tính lười (lazy) theo thời gian; client chỉ hiển thị và gửi ý định (theo `research_netcode.md` §8.4 và §9).

### 0.2 Đơn vị thời gian
- Ngày game hiện tại: `DAY_LENGTH = 1440` s thật = 24 phút thật **[ĐO]**. Suy ra **1 giờ game = 60 giây thật = 1 phút thật**. Vì vậy trong mọi bảng dưới đây, "mỗi phút thật" và "mỗi giờ game" là **cùng một con số**; cột "mỗi ngày game" = ×24.
- Hệ sinh tồn **không** buộc theo "3 bữa mỗi ngày game" (sẽ là ăn mỗi 8 phút thật, quá phiền). Nhịp mục tiêu: **một bữa chính mỗi 25-40 phút chơi thật, một lần uống mỗi 12-20 phút**. Đồng hồ game chỉ quyết định *quán nào mở, món nào bán, nhu cầu khách theo giờ, nắng/đêm*.
- Server giữ đồng hồ chung (`epoch` + `DAY_LENGTH`), mọi người thấy cùng một giờ (hook số 12 trong `codebase_hooks.md`).
- Mùa theo **tháng thật** (giờ Việt Nam): hoa phượng nở tháng 5-6 ngoài đời thì trong game cũng vậy; mùa bão tháng 7-10.

### 0.3 Tiền tệ
- Đơn vị **đồng (₫)**, hiển thị kiểu `35.000₫` hoặc `35k` trên mobile. **Giá đồ ăn uống gần giá thật ở Hải Phòng** (người chơi nhận ra, có giá trị giáo dục) **[ĐX, giá ước lượng, cần khảo sát lại]**. Thu nhập theo giờ chơi cao hơn đời thực khoảng 3-5 lần (nhịp game nén).
- Không có tiền nạp thật trong bản thiết kế này. Nếu sau này có kiếm tiền: chỉ mỹ phẩm, không bán lợi thế, không hộp quà may rủi (xem §4.7).

---

## 1. Hệ sinh tồn "Đời sống thành phố"

### 1.1 Bảy chỉ số

| Chỉ số | Tên hiển thị (vi/en) | Thang | Vai trò | Bắt buộc ở bản đầu? |
|---|---|---|---|---|
| Đói | No bụng / Fullness | 0-100 (100 = no) | Nhu cầu chính, nguồn chi tiêu số 1 | Có |
| Khát | Đủ nước / Hydration | 0-100 | Nhu cầu nhanh, gắn với nắng nóng | Có |
| Thể lực | Thể lực / Stamina | 0-100 | Chạy, nhảy, việc nặng ở cảng, kéo lưới | Có |
| Sức khỏe | Sức khỏe / Health | 0-100 | Chỉ giảm khi bỏ mặc nhu cầu, say nắng, rét, va chạm, bão | Có |
| Thân nhiệt | Nóng-lạnh / Body heat | 0-100, 50 = dễ chịu | Kết nối thời tiết và trang phục, chỗ trú | Đợt 2 |
| Sạch sẽ | Tươm tất / Hygiene | 0-100 | **Chỉ ảnh hưởng xã hội và nghề** (tiền boa, khách hàng rong), không gây mất máu | Đợt 2 (nhẹ) |
| Tinh thần | Tinh thần / Mood | 0-100, trôi về 50 | Thưởng cho chơi đa dạng: văn hóa, ẩm thực, bạn bè. Hệ số XP và tiền boa | Đợt 2 |

Quyết định thiết kế: có giữ "Sạch sẽ" và "Tinh thần" nhưng ở dạng **mềm**: chúng không bao giờ làm người chơi ngất; chúng biến đổi phần thưởng ±10-20%. Lý do: cho nhiều lý do để dùng nhà nghỉ, tiệm gội đầu (33 biển salon **[ĐO]**), quán cà phê (96 biển **[ĐO]**), địa danh, mà không biến game thành danh sách việc vặt.

### 1.2 Tốc độ giảm (mặc định) và hệ số hoạt động

Server tính "lớp hoạt động" từ chuyển động đã kiểm chứng (không tin client): `idle` (vận tốc < 0,3 m/s trong 10 s), `walk`, `run`, `ride` (xe máy/xích lô), `boat`, `heavy` (đang ca bốc xếp ở cảng, kéo lưới), `seated` (ngồi ghế quán, ghế đá), `sleep` (giường nhà nghỉ), `afk` (không lệnh nào 5 phút).

Tốc độ cơ bản (lớp `walk`, thời tiết dễ chịu) **[ĐX]**:

| Chỉ số | Mỗi phút thật = mỗi giờ game | Mỗi ngày game (24 phút) | Từ đầy về 0 |
|---|---|---|---|
| Đói | −1,30 | −31 | ~77 phút thật |
| Khát | −2,00 | −48 | 50 phút thật |
| Sạch sẽ | −0,50 | −12 | 200 phút thật |
| Tinh thần | trôi về 50 với tốc độ 0,5 | ±12 | — |
| Sức khỏe | 0 (không tự giảm) | 0 | — |
| Thể lực | xem §1.4 (tính theo giây) | — | — |
| Thân nhiệt | trôi về "nhiệt độ mục tiêu" của môi trường, xem §1.5 | — | — |

Hệ số theo lớp hoạt động (nhân vào tốc độ giảm):

| Lớp | Đói | Khát | Sạch sẽ | Ghi chú |
|---|---|---|---|---|
| idle / seated | ×0,6 | ×0,7 | ×0,5 | |
| walk | ×1,0 | ×1,0 | ×1,0 | |
| run | ×1,6 | ×1,8 | ×1,5 | |
| ride (xe máy, xích lô khách) | ×0,8 | ×0,9 (×1,2 trời nắng) | ×1,2 (bụi đường) | |
| boat | ×1,0 | ×1,2 | ×1,5 | |
| heavy (cảng, kéo lưới) | ×1,8 | ×1,8 | ×3,0 | nghề nặng = chi phí ăn uống cao hơn, bù bằng lương |
| sleep | ×0,3 | ×0,3 | ×0 | |
| afk | ×0,5 | ×0,5 | ×0 | không có thu nhập |
| **ngoại tuyến** | **đóng băng** | **đóng băng** | đóng băng | đăng nhập lại: Đói, Khát tối thiểu 60 |

Hệ số thời tiết (nhân thêm, xem bảng §1.8): Khát ×0,8 (mát) đến ×1,7 (nắng gắt trưa hè).

### 1.3 Ngưỡng và hiệu ứng

| Chỉ số | Ngưỡng | Trạng thái | Hiệu ứng |
|---|---|---|---|
| Đói | ≥ 60 | No | Cho phép hồi Sức khỏe +1/phút (cùng điều kiện Khát) |
| | 30-59 | Bình thường | — |
| | 15-29 | Đói | Thể lực tối đa 70; thông báo "bụng réo"; biểu tượng vàng |
| | 1-14 | Rất đói | Thể lực tối đa 40; không chạy quá 3 s liền; tốc độ đi −10% |
| | 0 | Kiệt sức vì đói | Sức khỏe −1/phút |
| Khát | ≥ 60 | Đủ nước | điều kiện hồi Sức khỏe |
| | 15-29 | Khát | Thể lực hồi chậm −30% |
| | 1-14 | Rất khát | màn hình hơi nhòe ở rìa; Thể lực tối đa 50 |
| | 0 | Mất nước | Sức khỏe −2/phút |
| Sức khỏe | < 30 | Mệt lả | Tốc độ −15%, màu màn hình nhạt, nhịp tim trong âm thanh |
| | 0 | **Ngất** | xem §1.9 |
| Thân nhiệt | 35-65 | Dễ chịu | — |
| | 66-80 | Nóng bức | Khát ×1,5; Thể lực hồi −30% |
| | > 80 | Say nắng | Khát ×2; Sức khỏe −1/phút; hiệu ứng khói nhiệt |
| | 20-34 | Lạnh | Đói ×1,3; Thể lực hồi −20% |
| | < 20 | Rét cóng | Đói ×1,5; Sức khỏe −1/phút; nhân vật run (animation) |
| Sạch sẽ | < 30 | Lôi thôi | Tiền boa −20%; khách mua hàng rong −20%; NPC bình luận |
| | < 10 | Bẩn | Thêm hạt "ruồi" nhẹ; không được vào nhà hàng hạng cao |
| Tinh thần | > 70 | Phấn chấn | XP nghề +10%, tiền boa +10% |
| | < 30 | Uể oải | XP nghề −10% |

Thời gian từ đầy đến ngất nếu bỏ mặc hoàn toàn, thời tiết thường: Khát về 0 sau 50 phút, Sức khỏe 100 giảm 2/phút (cộng 1/phút khi Đói về 0 ở phút 77) → **ngất khoảng phút 90-95**. Trưa hè nắng gắt không uống nước: ngất khoảng phút 45-55. Đủ dài để không bị bất ngờ, đủ ngắn để nhu cầu có nghĩa.

### 1.4 Thể lực (tính theo giây, không phải phút)

| Hành động | Thay đổi |
|---|---|
| Chạy (`input.run`, 7 m/s) | −2,5/s → chạy liền ~40 s (~280 m) |
| Nhảy | −5 mỗi lần |
| Bốc xếp ở cảng, kéo lưới (mỗi thao tác) | −4 đến −10 |
| Bơi (nếu có sau này) | −1,5/s |
| Đi bộ | +4/s |
| Đứng yên / ngồi | +8/s |
| Ngồi xe (lái hoặc ngồi sau) | +6/s |
| Thể lực = 0 | "Hụt hơi": không chạy 5 s, tốc độ đi 2,4 m/s |

Thể lực tối đa = `100 × min(hệ số Đói, hệ số Khát, hệ số Nhiệt)` (bảng §1.3). Server quyết định cờ "được chạy/được nhảy" (hook số 10: `main.js:350, 370`); client dự đoán để cảm giác mượt, server sửa lại nếu sai.

### 1.5 Thân nhiệt

Mô hình: mỗi phút thật, `H += sign(T − H) × min(|T − H|, r)`, trong đó `T` = nhiệt mục tiêu của môi trường (bảng §1.8) đã cộng trừ trang phục, chỗ trú, ướt; `r` = tốc độ trôi:

| Tình huống | r (điểm/phút) |
|---|---|
| Ngoài trời, không che | 3 |
| Dưới mái hiên, nhà chờ, tán cây lớn, quán (vùng "che chắn") | 1 (và T dịch 30% về 50) |
| Đang chạy xe khi mưa hoặc rét (gió) | 4, T −5 |
| Ngủ nhà nghỉ | 6 về 50 |

**Ướt** (0-100, chỉ số ẩn hiển thị bằng biểu tượng giọt nước): mưa +10/phút (mưa rào +20, bão +30) nếu không áo mưa, không che; khô −5/phút khi che chắn hoặc nắng. Ướt > 50: T −8 (mùa hè) hoặc −15 (mùa đông).

**Trang phục ảnh hưởng nhiệt** (chọn từ mỹ phẩm, xem §2.6): nón lá −6 khi nắng; áo khoác +10 khi rét; áo mưa = không bị ướt (giảm 90%), nhưng +4 khi nắng (bí); khẩu trang chống bụi không ảnh hưởng nhiệt.

**Chỗ trú không suy được từ hình học** (game không có nội thất, `codebase_hooks.md` §5): tạo file dữ liệu `shelters.json` sinh ngoại tuyến gồm: (a) đoạn mặt tiền có mái hiên bạt (263/551 pano nhắc "mái hiên/bạt" **[ĐO]**), (b) vùng 6 m trước mọi biển hiệu quán ăn uống, (c) nhà chờ/pergola đỏ ven hồ Tam Bạc (có trong mục `special` của pano), (d) tán cây lớn trong 37 công viên `PARKS` **[ĐO]**, (e) gầm cầu Hoàng Văn Thụ. Server kiểm tra "trong vùng che chắn" bằng lưới 16 m.

### 1.6 Phục hồi bằng thành phố thật

#### 1.6.1 Sổ đăng ký cửa hàng (`shops.json`) — sinh từ biển hiệu thật
Phân loại 1.154 biển hiệu theo từ khóa **[ĐO]** (sinh bằng script, xem §6):

| Nhóm | Số biển | Ví dụ từ khóa | Vai trò trong game |
|---|---|---|---|
| Quán ăn sáng / bún phở | 25 | PHỞ, BÚN, MIẾN, CHÁO, BÁNH ĐA CUA | Bữa chính, ăn tại chỗ |
| Cơm, nhà hàng, lẩu, hải sản | 33 | CƠM, NHÀ HÀNG, LẨU, HẢI SẢN | Bữa chính, món nhóm (buff cả party) |
| Bánh, xôi, nem, chả | 18 | BÁNH MÌ, XÔI, NEM, CHẢ MỰC, BÁNH CUỐN | Ăn nhanh, mang theo được |
| Cà phê, trà, giải khát, chè, kem | 96 | CÀ PHÊ, TRÀ, CHÈ, SINH TỐ | Uống, Tinh thần, chỗ ngồi trú |
| Tạp hóa, siêu thị mini | 13 | TẠP HÓA, SIÊU THỊ | Nước suối, mì gói, áo mưa |
| Thuốc, y tế | 44 | NHÀ THUỐC, TRẠM Y TẾ, PHÒNG KHÁM, BỆNH VIỆN | Hồi Sức khỏe, điểm tỉnh lại khi ngất |
| Khách sạn, nhà nghỉ | 16 | KHÁCH SẠN, NHÀ NGHỈ | Ngủ, điểm hồi sinh, gửi xe |
| Xe máy, xăng, lốp | 12 | XE MÁY, LỐP, XĂNG DẦU | Đổ xăng, sửa xe, nâng cấp |
| Thời trang, giày, may đo | 65 | THỜI TRANG, GIÀY DÉP, ÁO DÀI | Mỹ phẩm, trang phục nhiệt |
| Tóc, gội, làm móng | 33 | CẮT TÓC, GỘI, SALON | Sạch sẽ, kiểu tóc |
| Vàng bạc | 15 | VÀNG BẠC | (sau) bán đồ hiếm câu được |
| Ngân hàng, bảo hiểm | 31 | NGÂN HÀNG | (sau) gửi tiết kiệm có lãi nhỏ, bảo hiểm xe |
| Điện thoại, điện máy | 13 | ĐIỆN THOẠI, ĐIỆN MÁY | Nâng cấp "điện thoại" (app đơn hàng) |
| Khác (chăn ga, nhựa gia dụng, vật tư...) | 740 | — | Điểm **lấy hàng** cho nghề shipper (đơn chăn ga, đồ gia dụng...) |

Quy tắc hiển thị (tuân thủ "không tên thương hiệu"): trong UI cửa hàng hiển thị **loại + phố**, ví dụ "Quán phở · phố Quang Trung", không hiển thị nguyên văn tên trên biển. Biển hiệu 3D vẫn giữ như hiện tại (đã lọc thương hiệu). Mỗi cửa hàng: `id` ổn định = hash(làm tròn x, z, tên, nhóm); `servicePoint` = `world.findFree()` gần biển (vì một số biển nằm trong footprint, `codebase_hooks.md` §8); `hours` theo nhóm (phở 6-11 h và 17-22 h game, cà phê 6-23 h, bia/nhậu 16-24 h...).

**Độ phủ đo được** (điểm ngẫu nhiên trong đĩa chơi → biển gần nhất, khoảng cách thẳng) **[ĐO]**:

| Loại | Số điểm | Trung vị | P90 | Xa nhất |
|---|---|---|---|---|
| Đồ ăn | 72 | 275 m | 652 m | 1.039 m |
| Đồ uống | 94 | 246 m | 589 m | 907 m |
| Y tế | 36 | 360 m | 785 m | 1.048 m |
| Nhà nghỉ, khách sạn | 16 | 439 m | 905 m | 1.447 m |
| Xe máy, xăng | 11 | 447 m | 936 m | 1.381 m |

Biển hiệu chỉ có dọc tuyến pano, nên có "sa mạc dịch vụ". Lấp bằng: (1) **gánh hàng rong và xe đẩy NPC** đứng ở các nút giao thiếu dịch vụ (72/551 pano có gánh hàng rong/xe đẩy **[ĐO]**), mục tiêu P90 ≤ 300 m cho đồ ăn uống; (2) các sạp `props.stalls` và cụm `FOOD` đã có trong `props.js` (hiện chỉ trang trí) được gắn tương tác; (3) người chơi bán hàng rong (§2.3.3) tự nhiên lấp chỗ trống vì ở đó ít cạnh tranh.

Ăn tại quán: nhân vật **ngồi ghế nhựa** (dùng lại `player.sit(true)` đang dùng khi lái xe) trong thời gian ăn; ngồi cũng là "che chắn" và hồi Thể lực. Trong lúc ăn nhân vật có "khiên bận" (không bị làm phiền bởi lời mời).

#### 1.6.2 Bảng món ăn uống **[ĐX, giá gần giá thật, cần khảo sát lại tại Hải Phòng]**

| Món | Nhóm cửa hàng | Giá | No | Nước | Nhiệt | Tinh thần | Thời gian ăn | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| Bánh mì que cay (gói 5 que) | bánh, hàng rong | 10.000₫ | +18 | −5 | +2 | +3 | 10 s | Mang theo được (2 ô) |
| Bánh mì pa-tê | bánh | 20.000₫ | +30 | −3 | 0 | +2 | 15 s | Mang theo |
| Xôi | bánh, hàng rong | 15.000₫ | +32 | 0 | +2 | +2 | 15 s | Mang theo; chỉ sáng |
| Bánh cuốn | bánh | 30.000₫ | +38 | +5 | +3 | +4 | 25 s | Chỉ sáng |
| Bánh đa cua | bún phở | 40.000₫ | +48 | +15 | +6 | +8 | 30 s | Đặc sản; nhiệm vụ Cô Ba |
| Bún cá cay | bún phở | 40.000₫ | +48 | +10 | +8 | +6 | 30 s | Đặc sản |
| Phở bò | bún phở | 45.000₫ | +50 | +15 | +8 | +5 | 30 s | |
| Cháo (trai, sườn) | bún phở | 25.000₫ | +35 | +15 | +10 | +3 | 25 s | Tốt khi rét/ốm (Sức khỏe +5) |
| Cơm bình dân | cơm | 35.000₫ | +55 | +5 | +3 | +2 | 35 s | Rẻ nhất mỗi điểm No |
| Cơm sườn | cơm | 45.000₫ | +60 | +5 | +3 | +4 | 35 s | |
| Nem cua bể (suất) | nhà hàng | 80.000₫ | +45 | 0 | +2 | +15 | 30 s | Đặc sản, Tinh thần cao |
| Lẩu, hải sản (nồi nhóm 2-6 người) | nhà hàng | 220.000₫ cho cả bàn | +60 mỗi người | +10 | +12 | +15 | 60 s | Cả party cùng ngồi; buff "Bữa đoàn viên" 20 phút: XP +5% |
| Tào phớ | hàng rong | 10.000₫ | +10 | +15 | −6 | +4 | 10 s | Mùa hè |
| Chè | giải khát | 15.000₫ | +12 | +20 | −8 | +5 | 15 s | |
| Kem | giải khát | 10.000₫ | +5 | +10 | −10 | +5 | 8 s | |
| Trà đá vỉa hè | giải khát, hàng rong | 5.000₫ | 0 | +30 | −8 | +3 (+6 nếu ngồi cùng 2 người chơi khác) | 10 s | "Trà đá chém gió" — hoạt động xã hội |
| Nước mía | giải khát | 12.000₫ | +5 | +40 | −10 | +4 | 10 s | |
| Cà phê đen/nâu đá | cà phê | 25.000₫ | 0 | +25 | −5 | +8 | 20 s | Buff "Tỉnh táo" 15 phút: Thể lực hồi +20% |
| Trà sữa (tên chung) | cà phê | 30.000₫ | +8 | +30 | −6 | +7 | 15 s | |
| Trà gừng nóng | cà phê | 15.000₫ | 0 | +25 | +12 | +4 | 15 s | Mùa đông |
| Nước suối 500 ml | tạp hóa | 6.000₫ | 0 | +35 | −3 | 0 | 5 s | Mang theo |
| Mì gói | tạp hóa | 10.000₫ | +25 | −5 | +5 | 0 | 20 s (cần quán/nước nóng) hoặc ăn sống +15 | Dự trữ trước bão |
| Bánh quy khô | tạp hóa | 12.000₫ | +20 | −8 | 0 | 0 | 8 s | Mang theo |
| Oresol | nhà thuốc | 15.000₫ | 0 | +50 | 0 | 0 | 5 s | Sức khỏe +10 nếu đang Mất nước |
| Thuốc cảm, dầu gió | nhà thuốc | 25.000₫ | 0 | 0 | 0 | 0 | 5 s | Sức khỏe +20, hồi chiêu 10 phút |
| Khám ở trạm y tế | y tế | 30.000₫ | — | — | về 50 | — | 30 s | Sức khỏe = 100 |

Quy tắc **"ngán"** (khuyến khích đi ăn khắp thành phố thật): nếu món này nằm trong 3 bữa gần nhất thì No −20% và không có Tinh thần. Ăn 5 loại khác nhau trong một ngày thật → danh hiệu tạm "Thực khách sành ăn" (Tinh thần +10, 1 giờ).

Rượu bia: các biển "BIA HƠI", "BIA RƯỢU" có thật trong dữ liệu **[ĐO]**. Người chơi **không** uống được đồ có cồn (người chơi vị thành niên, và game có lái xe). Các quán này bán "đồ nhắm, nước ngọt, lạc rang" và là điểm tụ tập xã hội buổi tối. Thuốc lá: không có.

Hành trang: 6 ô mang theo (đồ ăn khô, nước, áo mưa, thuốc). Món nước nóng (phở, bún) chỉ ăn tại quán.

### 1.7 Nghỉ ngơi, ngủ, ngoại tuyến

| Nơi | Cách dùng | Tác dụng | Chi phí |
|---|---|---|---|
| Ghế đá công viên (37 công viên **[ĐO]**), ghế quán | Ngồi | Thể lực +8/s, Đói/Khát giảm ×0,6, che chắn nếu dưới tán | Miễn phí |
| Quán cà phê | Ngồi kèm đồ uống | như trên + Tinh thần +0,5/phút khi ngồi | giá đồ uống |
| Nhà nghỉ, khách sạn (16 **[ĐO]**) | Thuê theo **ngày thật** | Ngủ 60 s thật: Thể lực tối đa, Sức khỏe +30, Thân nhiệt về 50, Sạch sẽ 100 (tắm), Tinh thần +10; buff "Ngủ ngon" 30 phút (Thể lực hồi +25%) ; **đặt điểm hồi sinh**; gửi xe không mất độ bền | Nhà nghỉ 120.000₫/ngày, khách sạn 300.000₫/ngày (thêm Tinh thần +10 và tủ đồ 12 ô) |
| Phòng trọ thuê tháng (tiến trình muộn) | Thuê 7 ngày thật | như nhà nghỉ, có trang trí (mỹ phẩm nhà) | 600.000₫/tuần |
| Chùa Dư Hàng, đền Nghè | Ngồi tĩnh tâm 60 s | Tinh thần +15 (hồi chiêu 1 giờ thật) | Miễn phí, có thể công đức (§2.6) |

**Thoát game:** chỉ số đóng băng. Thoát khi đang ở nhà nghỉ/khách sạn còn hạn thì tích "Điểm nghỉ ngơi" (giống rested XP): mỗi giờ ngoại tuyến +5% XP nghề cho lần chơi sau, tối đa +50% cho 1 giờ chơi. Đây là lý do chính để thuê phòng (money sink có ích).

### 1.8 Thời tiết

#### 1.8.1 Mùa (theo tháng thật, khí hậu Hải Phòng **[ĐX dựa trên khí hậu chung miền Bắc; số nhiệt độ là gần đúng]**)

| Mùa | Tháng | Trạng thái hay gặp | Nhiệt mục tiêu ban ngày (thang 0-100) |
|---|---|---|---|
| Xuân | 2-4 | Mưa phùn, nồm ẩm, sương mù sáng | 45-55 |
| Hè | 5-8 | Nắng nóng, oi, dông chiều, bão (7-8) | 60-85 |
| Thu | 9-11 | Mát, nắng nhẹ, bão (9-10) | 45-60 |
| Đông | 12-1 | Gió mùa đông bắc, rét khô, mưa phùn | 20-40 |

Ban đêm trừ 8-12 điểm. Trưa (11-14 h game) mùa hè cộng 10.

#### 1.8.2 Trạng thái và hiệu ứng

| Trạng thái | Nhiệt mục tiêu (ngày hè/đông) | Khát × | Ướt/phút | Tầm nhìn (sương) | Tác động nghề |
|---|---|---|---|---|---|
| Nắng đẹp | 60 / 40 | 1,0 | 0 | xa | — |
| Nắng gắt | 80 / — | 1,6 | 0 | xa, khói nhiệt | Trà đá, nước mía bán chạy (hàng rong ×1,4 khách); giao hàng +10% |
| Nhiều mây | 55 / 35 | 0,9 | 0 | xa | — |
| Mưa phùn, nồm | 50 / 30 | 0,8 | +5 | gần (fog ×1,6) | Đường trơn: xe phanh kém 15% |
| Mưa rào | 50 / 28 | 0,8 | +20 | trung bình | Giao hàng +25% (đơn tăng), xe ôm +20%, hàng rong ×0,6 khách, câu cá ×1,15 |
| Dông | 45 / — | 0,8 | +25 | gần, chớp | Cảng tạm dừng cần cẩu 5 phút mỗi lần sét gần; câu cá ngừng |
| Gió mùa đông bắc | — / 18 | 0,7 | 0 | xa | Cháo, trà gừng ×1,5 khách |
| Sương mù biển | 45 / 30 | 0,8 | +2 | rất gần sáng sớm | Tàu thuyền chạy chậm (giới hạn 6 m/s) |
| **Bão** (sự kiện) | 40 / — | 0,8 | +30 | rất gần | Xem §1.8.3 |

Chu kỳ thời tiết: server đổi trạng thái mỗi 20-40 phút thật theo chuỗi Markov theo mùa (hạt giống chung). Đổi trạng thái có **bản tin dự báo 10 phút trước** (radio ở Nhà Kèn, app "điện thoại" trong game) để người chơi chuẩn bị áo mưa. Không đổi thời tiết theo từng khu (cả đĩa 3,2 km dùng một trạng thái, đơn giản và đồng bộ cho mọi client).

Kỹ thuật: client nhận `{kind, intensity, windX, windZ, seed, t0}` (hook 12-13 trong `codebase_hooks.md` §5): `LIGHT.cloud`, `uCloud`, `fogDensity`, lớp mưa hạt giống chung, uniform "ướt" trên `makeRoadMaterial`, thuộc tính `aSway` của cây + uniform gió, âm thanh mưa từ `makeNoise`.

#### 1.8.3 Bão — sự kiện cả thành phố
Lấy cảm hứng từ thực tế Hải Phòng thường chịu bão, gần nhất là **bão Yagi (số 3) đổ bộ Hải Phòng - Quảng Ninh ngày 7/9/2024 [THẬT]**. Bão Yagi gây thiệt hại người và của thật. Vì vậy: bão trong game mang **tên hư cấu chung** ("bão số N" theo năm game), không mô phỏng thương vong, không giật gân; giọng điệu là **phòng tránh và tình làng nghĩa xóm**. Có thể kèm thông tin phòng chống thiên tai chính thống (sau khi kiểm chứng) và một bảng tri ân trong chương "Vượt bão" (§3.5).

Tần suất: tối đa 1 bão mỗi 2 tuần thật, chỉ tháng 7-10, đặt vào khung giờ đông người (20:00-22:00 giờ Việt Nam), báo trước 24 giờ thật trên màn hình đăng nhập.

| Pha | Thời lượng thật | Thế giới | Việc người chơi làm (co-op toàn server) |
|---|---|---|---|
| 1. Cảnh báo | 24 giờ trước | Bản tin, băng rôn | Mua dự trữ (mì gói, nước, áo mưa: money sink), nhận nhiệm vụ "Chằng chống" |
| 2. Chuẩn bị | 30 phút | Gió tăng, mây kéo | Chằng biển hiệu (tương tác ở 1.154 biển theo phường), kê bao cát ven hồ Tam Bạc và sông Cấm, đưa thuyền vào bến, giúp NPC hàng rong dọn sạp. Thanh tiến độ mỗi phường |
| 3. Bão | 20-30 phút | Mưa +30 ướt/phút, gió giật lắc cây và biển, nước dâng hiển thị ở phố thấp, sét | Ngoài trời không che: Sức khỏe −1/phút (không bao giờ dưới 10 trong bão: ở 10 nhân vật tự chạy vào chỗ trú gần nhất). Cảng và câu cá đóng. Đơn "giao hàng thiết yếu" (thuốc, nước) trả ×2, nhưng giới hạn tốc độ xe 10 m/s |
| 4. Sau bão | 60 phút | Cây đổ (vị trí chọn bằng hạt giống từ danh sách cây có sẵn, mọi client giống nhau), biển rơi, rác | Dọn cây đổ (co-op 2-4 người mỗi cây), dựng lại sạp, trồng lại phượng (Quỹ thành phố §2.6). Thưởng: danh hiệu, mỹ phẩm "áo mưa đồng đội", tiền thưởng chia theo đóng góp, có trần |

Phường đạt 100% chuẩn bị thì thiệt hại sau bão ít hơn (ít cây đổ hơn), tạo cảm giác "công sức có kết quả".

### 1.9 Ngất và tỉnh lại (thân thiện)
- Sức khỏe = 0 → màn hình mờ dần, "Bạn đã ngất". **Tỉnh lại sau 10 s** ở điểm y tế gần nhất (36 biển y tế trong đĩa **[ĐO]**, ưu tiên Trạm y tế phường, bệnh viện như mục `LM.viettiep`) hoặc ở nhà nghỉ đã thuê nếu gần hơn.
- Trạng thái sau khi tỉnh: Sức khỏe 40, Đói 40, Khát 50, Thân nhiệt 50, Ướt 0.
- Phí viện: `min(5% tiền mặt, 30.000₫)`. **Miễn phí** cho cấp công dân < 5, trong sự kiện bão, và lần ngất đầu tiên mỗi ngày thật.
- **Không mất đồ, không mất cấp, không mất XP.**
- Đơn hàng đang giao: được "giữ đơn" 10 phút thật để tiếp tục (đồ ăn nóng mất 20% tiền boa). Hàng rong: xe đẩy tự về bãi gửi ở chợ.
- Xe máy cá nhân: tự đỗ ở cổng điểm y tế.
- Tinh thần −10. Nhân vật Cô y tá (NPC mới) nói một câu nhắc nhẹ, kèm mẹo (lần đầu: hướng dẫn quán gần nhất).
- Tai nạn giao thông: va chạm với giao thông NPC là **cục bộ từng client** (traffic không đồng bộ, `codebase_hooks.md` §4). Vì vậy va chạm chỉ trừ Sức khỏe nhỏ (−5 đến −15), server nhận báo cáo từ client nhưng **trần 2 lần mỗi phút và không bao giờ gây ngất** (trần ở 10). Xe giảm độ bền. Không bao giờ có tác động giữa người chơi với người chơi (không va chạm, xem §4.6).

### 1.10 Lưới an toàn cho người hết tiền
- **Bếp cơm từ thiện ở chùa Dư Hàng** **[HƯ CẤU về chi tiết, dựa trên truyền thống bếp cơm từ thiện có thật ở nhiều thành phố Việt Nam]**: suất cơm miễn phí (No +45, Khát +20), mỗi 2 giờ thật một lần. Kèm câu chuyện về lòng tốt (nhiệm vụ phụ dẫn tới "góp gạo" khi người chơi khá lên).
- Vòi nước, giếng ở đình/đền: Khát +20 miễn phí, hồi chiêu 10 phút.
- **Việc vặt tức thì** khi tiền < 20.000₫: phát tờ rơi (20.000₫ cho 10 tờ ở 10 điểm), nhặt rác ven hồ (5.000₫ mỗi túi, tối đa 10 túi/ngày). Đủ để không kẹt, không đủ để cày.
- Xe máy cho mượn "xe công vụ" miễn phí xăng tới cấp công dân 3.

### 1.11 Mô hình server cho chỉ số (gắn với netcode)
- Mỗi người chơi lưu `{v0[7], t0, activity, weatherId, shelterFlag, wet}`. Giá trị tại thời điểm `t` = hàm đóng của `(v0, t − t0, hệ số)`; chỉ tính lại khi có sự kiện (đổi lớp hoạt động, ăn, đổi thời tiết, vào/ra vùng che chắn). **Không có chi phí mỗi tick** cho 1.000+ người (đúng `research_netcode.md` §8.4).
- Lớp hoạt động do server suy ra từ vị trí và lệnh đã kiểm chứng, không do client khai.
- Client nhận chỉ số trong bản ghi "self state" của snapshot (7 byte, 1 byte mỗi chỉ số) ở 2 Hz là đủ; ngưỡng vượt (vd Đói < 30) gửi sự kiện riêng.
- Mua, ăn, ngủ: lệnh `ACTION` có khoá bất biến (idempotency), server kiểm khoảng cách tới `servicePoint` ≤ 4 m, giờ mở cửa, tiền, hồi chiêu.

### 1.12 Giao diện
- HUD (trong `#hud`, `pointer-events:auto` chỉ ở widget): 4 vòng tròn nhỏ (No, Nước, Thể lực, Sức khỏe) cạnh đồng hồ; Thân nhiệt, Ướt, Tinh thần, Sạch sẽ là biểu tượng chỉ hiện khi lệch khỏi vùng an toàn. Trên điện thoại: một vòng tổng, chạm để xem chi tiết.
- Bản đồ nhỏ: lớp "Ăn uống / Y tế / Nghỉ" bật bằng một nút (hook 14). Khi Đói < 30 tự hiện 3 quán gần nhất đang mở.
- Màn hình **không bao giờ** bị che bởi cảnh báo đỏ liên tục; mỗi cảnh báo có hồi chiêu 2 phút.

---

## 2. Kinh tế và nghề

### 2.1 Nguyên tắc kinh tế
- **Vòi tiền (faucets):** lương nghề (từ hệ thống), thưởng nhiệm vụ, trợ cấp lưới an toàn. **Cống tiền (sinks):** ăn uống, xăng, sửa xe, nhà nghỉ, mỹ phẩm, nâng cấp xe, phí sạp, phạt giao thông, công đức/Quỹ thành phố, phí viện.
- Mục tiêu: chi phí sinh hoạt bắt buộc **~30% thu nhập ở cấp nghề 1, ~15% ở cấp 10**; phần còn lại dồn vào mục tiêu dài hạn (xe, phòng, mỹ phẩm). Theo dõi **tổng cung tiền tăng ≤ 5%/ngày trên mỗi người chơi hoạt động**; vượt → điều chỉnh bảng `balance.json` (không cần sửa code).
- Tiền chuyển giữa người chơi bị giới hạn chặt (chống mua bán tiền thật, lừa đảo trẻ em, §2.8).
- Tiền khởi đầu: 150.000₫ + "phiếu ăn bánh đa cua" (nhiệm vụ mở đầu) + xe công vụ.
- Mọi giao dịch qua server, có khoá bất biến; nhật ký kiểm toán; cảnh báo bất thường khi thu nhập/giờ vượt trung vị 5 lần độ lệch chuẩn (`research_netcode.md` §9.1 mục 7).

### 2.2 Cấp nghề, cấp công dân, uy tín
- **Cấp nghề 1-10** cho từng nghề. XP nghề = số nghìn đồng **lương cơ bản** kiếm được (không tính tiền boa, thưởng), nhân hệ số Tinh thần và Điểm nghỉ ngơi.

| Cấp | XP tích lũy | Giờ chơi ước tính (nghề đó) | Mở khóa ví dụ |
|---|---|---|---|
| 1 | 0 | 0 | đơn cơ bản |
| 2 | 150 | 0,5 h | đơn xa hơn |
| 3 | 400 | 1,2 h | gom 2 đơn (shipper), khách ở ga (xe ôm) |
| 4 | 800 | 2,2 h | |
| 5 | 1.400 | 3,5 h | đơn "đồ nóng" (thưởng nhanh), trang phục nghề |
| 6 | 2.300 | 5 h | |
| 7 | 3.500 | 7 h | gom 3 đơn, khách VIP |
| 8 | 5.200 | 9,5 h | |
| 9 | 7.500 | 12,5 h | |
| 10 | 10.500 | 16 h | danh hiệu "Thợ cả", dạy nghề cho người mới (thưởng uy tín) |

- **Cấp công dân** = tổng điểm từ nhiệm vụ cốt truyện, khám phá, sự kiện, cộng 1 điểm mỗi cấp nghề. Mở chương truyện và tính năng xã hội (chat tự do, sạp chợ).
- **Uy tín (sao 1-5)** cho nghề dịch vụ (shipper, xe ôm, hướng dẫn viên, hàng rong), trung bình 50 lượt gần nhất. Ảnh hưởng tiền boa và ưu tiên nhận khách. NPC chấm theo công thức minh bạch (đúng giờ, tình trạng hàng, Sạch sẽ, Tinh thần, điểm văn minh giao thông); người chơi chấm người chơi chỉ khi đã kết bạn > 24 h hoặc qua nhiệm vụ co-op (chống thao túng).
- **Bằng lái A1 trong game**: nhiệm vụ "Thi sát hạch" ở bãi tập (vòng số 8, đi đường hẹp) + 10 câu luật giao thông. Bắt buộc để làm shipper và xe ôm. Có giá trị giáo dục thật.
- **Điểm văn minh giao thông (12 điểm)**: mô phỏng nhẹ cơ chế 12 điểm giấy phép lái xe áp dụng từ 1/1/2025 theo Luật Trật tự, an toàn giao thông đường bộ 2024 **[THẬT, cần dẫn nguồn văn bản trong game]**. Lỗi server phát hiện được: chạy trên vỉa hè (đối chiếu đa giác đường/footprint), vượt tốc độ ở vùng trường học (vùng dữ liệu quanh `thptnq`, `thcsnq`, `thcstp`; giới hạn 8 m/s), đi vào phố đi bộ giờ cấm, ngược chiều (chỉ khi dữ liệu một chiều có trong `roadgraph.js` — **cần kiểm tra**), vượt đèn đỏ (chỉ khi đèn tín hiệu được đồng bộ theo giờ server — hiện chưa có). Mỗi lỗi: −1 đến −2 điểm, phạt 20.000-100.000₫ (cống tiền). Về 0: tạm khóa nghề lái 30 phút thật hoặc làm nhiệm vụ "Học lại luật" để phục hồi. Tự hồi 1 điểm mỗi 2 giờ chơi sạch lỗi.

### 2.3 Các nghề

Công thức chung: **tiền = cơ bản + theo quãng đường đường bộ (server tính bằng `roadgraph.js`) + thưởng chất lượng + tiền boa**, nhân hệ số thời tiết, nhân hệ số "năng suất ngày" (§2.5). Quãng đường luôn tính trên **đường đi thật** server dựng, không phải đường chim bay.

#### 2.3.1 Shipper (giao hàng)
- **Mở khóa:** bằng lái A1. Trạm nhận đơn: Chị Hằng (NPC mới) gần chợ Sắt; sau đó nhận đơn trên app "điện thoại" ở bất cứ đâu.
- **Vòng chơi:** nhận đơn (server sinh **riêng cho từng người**, không giành đơn) → chạy tới cửa hàng lấy hàng (điểm lấy là bất kỳ biển nào trong 1.154, loại hàng theo nhóm: đồ ăn từ quán, thuốc từ nhà thuốc, chăn ga từ cửa hàng chăn ga...) → giao tới "địa chỉ" (một điểm mặt tiền nhà thật có tên phố OSM, `world.findFree` trên vỉa hè) → bấm E giao, ký nhận.
- **Loại đơn:** thường; đồ nóng (giới hạn thời gian, thưởng đúng giờ); dễ vỡ (phanh gấp, va chạm giảm "tình trạng hàng"); cồng kềnh (cấp 5+, cần thùng hàng nâng cấp); thuốc thiết yếu (trong mưa bão, ×2).
- **Trả:** 10.000₫ + 6.000₫/km chặng giao (chặng đi lấy không trả, nhưng server chọn điểm lấy trong 600 m) + đúng giờ tới 5.000₫ + boa 0-20%.
- **Năng suất ước tính [ĐX]:** chặng giao trung bình 1,6 km, mỗi đơn ~4,5 phút → ~13 đơn/giờ ≈ **300-350k/giờ ở cấp 1**, ~520k ở cấp 5 (gom 2 đơn, cơ bản 12k), ~850k ở cấp 10 (gom 3 đơn, đơn cao cấp).
- **Co-op:** "Giao hàng đoàn" (§3.9).
- **Khả thi kỹ thuật:** cần mô hình thùng hàng trên xe người chơi (traffic kit đã có `OPT.CARGO`, nhân vật người chơi chưa có, `codebase_hooks.md` §2).

#### 2.3.2 Xe ôm (chở khách bằng xe máy)
- **Mở khóa:** bằng lái A1. Trạm: Anh Toàn (NPC mới) ở cổng Ga Hải Phòng (`LM.station`).
- **Khách NPC:** server sinh khách tại các điểm nóng theo giờ (ga, chợ Sắt, Nhà hát lớn, bến tàu, trường học giờ tan, bệnh viện). Khách là thực thể server lớp C (đứng chờ: 0 byte; khi lên xe thì đi cùng người lái). Điểm đến: địa danh, khách sạn, chợ, nhà dân.
- **Trả:** 10.000₫ mở cửa + 8.000₫/km + boa (đi êm, đúng đường, Sạch sẽ, nói chuyện: chọn câu thoại đúng về địa danh được +boa).
- **Năng suất:** chuyến trung bình 1,8 km, chu kỳ ~5 phút → **~320k/giờ cấp 1**, ~550k cấp 5 (khách có hành lý từ ga, giá ×1,3), ~850k cấp 10.
- **Chở người chơi thật** (điểm xã hội đặc sắc): người chơi gọi xe ôm qua app, tài xế người chơi gần nhất nhận. Khách trả cước gợi ý 8.000₫/km từ ví mình. Hệ thống **thưởng thêm 5.000₫/chuyến cho tài xế, tối đa 10 chuyến/ngày, mỗi cặp tài xế-khách chỉ tính thưởng 1 lần/ngày** (chống thông đồng). Khách mới (cấp công dân < 3) đi miễn phí, hệ thống trả tài xế (trần 5 chuyến/ngày) → cơ chế đón tân thủ.
- **Khả thi kỹ thuật:** cần tư thế ngồi sau (pillion) cho nhân vật SkinnedMesh; traffic kit đã có `OPT.PILLION`. Xe hiện chỉ có 1 ghế (`seatY/seatZ`) → thêm ghế 2.

#### 2.3.3 Bán hàng rong / quán vỉa hè
- **Mở khóa:** nhiệm vụ "Học nghề với Cô Ba" (minigame nấu bánh đa cua hiện có trong `minigame.js` thành mức 1 của chuỗi công thức).
- **Vòng chơi:** thuê xe đẩy hoặc gánh ở chợ Sắt (30.000₫/phiên 30 phút thật) → mua nguyên liệu ở chợ (giá nguyên liệu ≈ 40% giá bán) → nấu bằng minigame (điểm minigame = chất lượng) → đẩy xe tới chỗ đứng → khách NPC tới theo **bản đồ nhu cầu theo giờ** (sáng: cổng trường, ga; trưa: khu văn phòng UBND, Ngân hàng; tối: phố đi bộ ven hồ Tam Bạc, Nhà hát lớn) và **người chơi khác mua được thật** (món của người chơi hồi No/Khát như món quán).
- **Giá:** người bán đặt giá trong dải 70-130% giá tham chiếu (bảng §1.6.2).
- **Bão hòa:** cầu của một ô 128 m chia theo `1 / (1 + 0,6 × (số xe đẩy khác trong ô))` → tự phân tán người bán, lấp "sa mạc dịch vụ".
- **Năng suất:** chỗ tốt ~30 khách/giờ × 25.000₫ = 750k doanh thu − 300k nguyên liệu − 60k thuê xe ≈ **~390k/giờ cấp 1**, cấp 10 (công thức đặc sản như nem cua bể, bún cá cay; xe đẩy riêng; khách quen) ~900k.
- **Sạch sẽ** của người bán ảnh hưởng số khách (vệ sinh an toàn thực phẩm, giá trị giáo dục).

#### 2.3.4 Công nhân cảng (Cảng Hải Phòng)
- **Vị trí:** khu cảng dọc sông Cấm. Lưu ý **[ĐO]**: điểm `LM.port` cách tâm 1.567 m, sát mép vùng chơi (`PLAY_RADIUS = 1588`), nên bãi làm việc phải đặt ở phần cảng nằm trong đĩa (kiểm bằng `world.findFree` + `landAt`). Người giao nghề: Ông Khải thợ máy (NPC mới, cũng là nhân vật tuyến "giữ máy" trong chương 1946-55).
- **Ca làm:** 12 phút thật mỗi ca, các ca theo giờ game (sáng/chiều/đêm, đêm +20%).
- **Minigame (chọn vị trí):** kiểm đếm container (đọc số hiệu container khớp phiếu, kiểu "tìm điểm khác"), lái xe nâng (đưa pallet vào ô), lái cần cẩu (cấp 5+, canh lắc dây cáp theo gió thời tiết thật), xi nhan (co-op với người lái cẩu, §3.9).
- **Trả:** 80.000₫/ca + chính xác tới 40.000₫ → **~450-500k/giờ cấp 1**, cấp 10 lái cẩu ~950k. Lớp hoạt động `heavy` → Đói/Khát ×1,8, Sạch sẽ ×3 (chi phí sinh hoạt cao hơn, tạo nhu cầu cho hàng rong quanh cảng).
- **Thời tiết:** dông dừng cẩu từng đợt; bão đóng cảng.

#### 2.3.5 Ngư dân
- **Vị trí:** bến thuyền trong vùng chơi (`world.vehicleSpawns` loại boat), vùng câu trên sông Cấm và sông/hồ Tam Bạc. Đồ Sơn, Hòn Dấu, Cát Bà nằm ngoài đĩa chơi (20-40 km **[ĐO]**) → mở rộng sau (chương 7). Người giao nghề: Thuyền trưởng Hải (NPC đã có) và Ông Bảy câu cá ven Tam Bạc (NPC mới).
- **Vòng chơi:** thuê thuyền 20.000₫/30 phút (hoặc mua thuyền 6.000.000₫ ở cấp 6) → mồi 5.000₫ → minigame câu (căng dây) hoặc thả lưới (đặt lưới, quay lại sau 5 phút thật, kéo lưới co-op) → bán ở chợ (biển "CHỢ TAM BẠC" có trong dữ liệu **[ĐO]**, chợ Sắt).
- **Loài (tên chung, giá trị) [ĐX, cần chuyên gia địa phương xác nhận loài ở vùng nước lợ sông Cấm]:** cá đối, cá vược, tôm, cua, cá bống; hiếm: "cá vàng may mắn" (đồ sưu tầm, không bán, đổi danh hiệu).
- **Giá chợ động:** giá mỗi loài giảm theo tổng sản lượng người chơi bán trong 1 giờ thật gần nhất (−1% mỗi 1% vượt sản lượng tham chiếu, sàn 50%) → tự chống cày.
- **Năng suất:** dao động lớn, **~300k/giờ cấp 1 → ~800k cấp 10**; bình minh và hoàng hôn game ×1,3; mưa rào ×1,15; dông, bão đóng.

#### 2.3.6 Hướng dẫn viên du lịch
- **Mở khóa:** đã khám phá đủ 22 địa danh trong vùng chơi (nhiệm vụ "Nhà thám hiểm" hiện có) + đạt 8/10 câu hỏi thi "Thẻ hướng dẫn viên" (câu hỏi lấy từ `LANDMARKS[].text/fact`). Người giao nghề: Linh (NPC đã có).
- **Tour NPC:** đoàn 4-8 du khách NPC (thực thể server lớp C đi theo, AOI 2-5 Hz) đi theo người chơi qua 3-4 địa danh (~1,2 km, tốc độ đoàn 1,6 m/s, có thể thuê xích lô hoặc "xe điện du lịch" cho đoàn ở cấp 5+). Tại mỗi điểm: khách hỏi, người chơi chọn câu trả lời đúng (dữ kiện có nguồn) và đứng đúng chỗ ngắm (kiểm hướng camera tới địa danh). Mất khách (khách cách > 30 m quá 20 s) bị trừ điểm.
- **Trả:** 150.000₫/tour + boa 0-100.000₫ → ~16 phút/tour → **~550-750k/giờ**, tối đa 3 tour/giờ.
- **Dẫn tân thủ thật (mentor):** người chơi mới (cấp công dân < 3) bật "cần hướng dẫn" → hướng dẫn viên nhận nhóm 1-6 tân thủ; khi tân thủ hoàn thành tour, hệ thống trả 60.000₫ mỗi tân thủ (tối đa 5 tân thủ/ngày) + Uy tín. Vừa là nghề, vừa là onboarding xã hội.

#### 2.3.7 Nghề phụ, mở rộng sau
Đạp xích lô du lịch (Bác Tư), bán hoa ở Quán hoa (mùa Tết, 8/3, 20/10, 20/11), sửa xe (người chơi sửa xe người chơi), thợ chụp ảnh ở địa danh, dọn vệ sinh đô thị (việc vặt), giao báo sáng.

### 2.4 Bảng thu nhập so sánh (giờ chơi thật, thời tiết thường) **[ĐX]**

| Nghề | Cấp 1 | Cấp 5 | Cấp 10 | Độ dao động | Chi phí nghề/giờ | Sở thích người chơi |
|---|---|---|---|---|---|---|
| Shipper | 300-350k | ~520k | ~850k | thấp | xăng ~45k, hao xe ~10k | lái xe, khám phố |
| Xe ôm | ~320k | ~550k | ~850k | thấp-trung | xăng ~40k | lái xe, xã hội |
| Hàng rong | ~390k | ~600k | ~900k | trung (vị trí) | nguyên liệu (đã trừ), thuê xe | buôn bán, nấu ăn |
| Công nhân cảng | 450-500k | ~650k | ~950k | thấp | ăn uống ×1,8 (~+60k) | minigame kỹ năng |
| Ngư dân | ~300k | ~550k | ~800k | cao | thuyền, mồi ~45k | thư giãn, may rủi nhẹ |
| Hướng dẫn viên | ~550k | ~650k | ~750k | trung | không | văn hóa, xã hội |

Mục tiêu cân bằng: **sau khi trừ chi phí nghề và sinh hoạt, các nghề chênh nhau ≤ 15%** ở cùng cấp. Hướng dẫn viên trần thấp hơn vì yêu cầu mở khóa cao và trải nghiệm đã là phần thưởng.

### 2.5 Chống cày, chống bot
1. **Đơn sinh riêng theo người** (không giành đơn, không cắm trại điểm đơn tốt), điểm đầu-cuối ngẫu nhiên có ràng buộc, khoảng cách tối thiểu 400 m, không lặp cặp điểm trong 1 giờ.
2. **Thời gian khả dĩ:** server tính thời gian tối thiểu `quãng đường / (16 m/s × 1,1)`; giao nhanh hơn → không trả, tăng điểm nghi ngờ.
3. **Năng suất ngày (reset 00:00 giờ Việt Nam):** mỗi nghề: sau 2,5 giờ thật trong ngày lương ×0,7, sau 4 giờ ×0,4. Tổng thu nhập ngày vượt 3.500.000₫ → ×0,5. Bù lại "Đa nghề": làm nghề thứ hai trong ngày được +10% (khuyến khích đa dạng chứ không cày).
4. **AFK:** không lệnh 5 phút → không thu nhập, chỉ số giảm ×0,5; 30 phút → đưa về chế độ khán giả, nhả slot nếu server đầy.
5. **Chống thông đồng giữa người chơi:** thưởng hệ thống cho hoạt động người-với-người tính 1 lần mỗi cặp mỗi ngày; tài khoản khách (chưa liên kết Google) không nhận và gửi tiền.
6. **Tín hiệu bot** (`research_netcode.md` §11.1): nhịp lệnh không dao động, tuyến lặp hoàn hảo, phiên 24/7, không xoay camera; gắn cờ bóng (shadow flag) → giảm thưởng, đưa vào hàng chờ xem xét, không khóa tự động ngay.
7. **Trần thu nhập tài khoản mới:** 72 giờ đầu trần 1.500.000₫/ngày (chống clone tài khoản để chuyển tiền).

### 2.6 Cống tiền (money sinks)

| Hạng mục | Mức giá | Tần suất | Tỷ trọng mục tiêu (cấp 1 / cấp 10) |
|---|---|---|---|
| Ăn uống | 25-80k/bữa, 5-30k/đồ uống | ~2 bữa + 3 đồ uống/giờ | 20% / 8% |
| Xăng | 25.000₫/lít, xe số 1 lít/10 km (đã nén cho game; thực tế xe máy đi xa hơn nhiều mỗi lít); xe điện 1.000₫/km | theo quãng đường | 8% / 3% |
| Sửa xe | độ bền 100, −1/5 km, −3 mỗi va chạm; sửa 2.000₫/điểm; dưới 30 thì tăng tốc kém | ~mỗi 2 giờ | 3% / 2% |
| Nhà nghỉ, khách sạn, phòng trọ | 120k-300k/ngày thật, 600k/tuần | mỗi ngày chơi | tùy chọn |
| Mỹ phẩm (áo, nón, khẩu trang, balo, kiểu tóc, màu xe, mũ bảo hiểm) | 30k-500k; độc quyền từ nhiệm vụ không bán | mục tiêu dài | — |
| Nâng cấp xe | xem §2.7 | mục tiêu dài | — |
| Phí sạp, thuê xe đẩy, thuê thuyền | 20-60k/phiên | mỗi phiên nghề | (đã tính trong nghề) |
| Phạt giao thông | 20-100k/lỗi | khi vi phạm | — |
| Phí viện | ≤ 30k | hiếm | — |
| Công đức ở đền, chùa; **Quỹ thành phố** | tự nguyện | — | — |

**Quỹ thành phố**: người chơi góp tiền vào mục tiêu chung hiển thị cho cả server (trồng lại hàng phượng sau bão, thắp đèn lồng Trung thu khắp phố, tu bổ sân khấu Nhà Kèn cho đêm nhạc). Đạt mốc → cả server nhận hiệu ứng thế giới (hoa phượng nở dày hơn trong tuần, đêm nhạc ở Nhà Kèn, pháo hoa ở Nhà hát lớn). Đây là cống tiền lớn nhất cho người chơi lâu năm, và có ý nghĩa cộng đồng. Công đức ở đền Nghè, chùa Dư Hàng: Tinh thần +, không mua được lợi thế.

### 2.7 Xe máy (tên chung, không thương hiệu)
Tất cả xe chung **giới hạn tốc độ server 16 m/s** (công bằng và không cổ vũ phóng nhanh). Nâng cấp chỉ thay đổi tăng tốc, tải hàng, tiết kiệm xăng, độ bền, ngoại hình.

| Xe | Giá | Tăng tốc | Tải (ô hàng) | Xăng | Độ bền | Ghi chú |
|---|---|---|---|---|---|---|
| Xe công vụ (cho mượn) | 0 | 3,0 | 1 | miễn phí tới cấp 3 | 60 | Mặc định người mới |
| Xe đạp | 800.000₫ | 1,5 (tối đa 6 m/s) | 1 | 0 | 100 | Không cần bằng; Tinh thần +, không phạt khói bụi |
| Xe số cũ | 2.500.000₫ | 3,2 | 1 | 1 l/10 km | 70 | |
| Xe số mới | 4.500.000₫ | 3,6 | 2 | 1 l/12 km | 100 | |
| Xe tay ga | 9.000.000₫ | 4,0 | 2 (cốp) | 1 l/11 km | 100 | Ngồi sau êm: xe ôm +5% boa |
| Xe điện | 7.000.000₫ | 3,8 | 2 | 1.000₫/km sạc ở trạm | 100 | Yên lặng (âm thanh động cơ khác) |
| Xe ba gác máy | 6.000.000₫ | 2,8 | 5 | 1 l/8 km | 120 | Đơn cồng kềnh; không chở khách |

Phụ kiện: thùng hàng (+1 ô, 400k), áo mưa trùm xe (300k), đèn sáng (200k, đêm và sương mù: tầm nhìn bản đồ +), lốp bám (500k, trơn mưa −50%), sơn (100-300k), mũ bảo hiểm mẫu (50-250k; đội mũ bảo hiểm là **tự động bắt buộc** khi lên xe).

### 2.8 Giao dịch giữa người chơi và sạp chợ
- **Không có lệnh chuyển tiền tự do.** Chỉ có: (a) mua món từ hàng rong người chơi (giá trong dải), (b) trả cước xe ôm người chơi, (c) cửa sổ trao đổi đồ giữa bạn bè (cả hai đã liên kết Google, kết bạn ≥ 24 giờ thật, trần 200.000₫ giá trị/ngày), (d) sạp chợ đêm.
- **Sạp chợ đêm (player shops, có giới hạn):** ở vùng định sẵn: phố đi bộ ven hồ Tam Bạc (có trong pano **[ĐO]**), sân chợ Sắt, quảng trường Nhà hát lớn tối thứ Bảy, Chủ nhật. Thuê sạp theo giờ thật (40.000₫/giờ), bán: món nấu (hàng rong), hải sản câu được, đồ thủ công từ nhiệm vụ (hoa giấy, đèn lồng Trung thu tự làm). Giá trong dải 50-150% giá tham chiếu; không bán mỹ phẩm độc quyền nhiệm vụ.
- Không có đấu giá, không có sàn giao dịch toàn server ở bản đầu (khó cân bằng, dễ thành mua bán tiền thật).

### 2.9 Bảng thu chi theo giờ (người chơi tiêu biểu) **[ĐX]**

| Mục | Cấp 1 (shipper) | Cấp 5 (đa nghề) | Cấp 10 (thợ cả) |
|---|---|---|---|
| Thu nhập gộp | 330k | 560k | 900k |
| Ăn (2 bữa) | 70k | 80k | 100k (ăn ngon hơn, Tinh thần) |
| Uống (3 lần) | 20k | 35k | 50k |
| Xăng + hao xe | 55k | 45k (xe tiết kiệm) | 40k |
| Sinh hoạt bắt buộc (cộng) | 145k (44%) → giảm còn ~30% khi người chơi biết chọn món rẻ và xe công vụ miễn phí xăng | 160k (29%) | 190k (21%) |
| Dư để tiết kiệm | ~185-230k | ~400k | ~710k |
| Mục tiêu tiết kiệm | Xe số cũ sau ~11-13 giờ | Xe tay ga sau ~22 giờ | Quỹ thành phố, mỹ phẩm, phòng trọ |

Chú ý: cấp 1 dùng xe công vụ miễn phí xăng nên chi phí thật ~100k (30%). Bảng là điểm xuất phát; chỉnh bằng dữ liệu beta (KPI §7.2).

---

## 3. Nhiệm vụ và cốt truyện

### 3.1 Kiến trúc
- **Nhiệm vụ là dữ liệu JSON trên server**, client chỉ hiển thị (đúng `codebase_hooks.md` §7: `quests.js` hiện kéo `three` và `world.js` nên không chạy được trên Node; server cần định nghĩa thuần JSON). Nạp nóng (hot reload) không cần deploy client: văn bản `{vi, en}` gửi kèm.
- **Bus sự kiện server** (mọi bước nhiệm vụ đều là bộ lọc trên sự kiện): `enter_zone`, `visit_landmark`, `talk_npc`, `interact_shop`, `buy`, `consume`, `pickup`, `deliver`, `job_done`, `minigame_score`, `photo`, `quiz_answer`, `stat_threshold`, `weather_changed`, `time_of_day`, `party_together`, `ride_with`, `donate`, `level_up`. Sự kiện vị trí do server tự sinh từ vị trí đã kiểm chứng (bán kính địa danh 18 m như hiện tại).
- **Pha (phasing):** `world` (mọi người cùng thấy, vd bão), `party` (đồ vật nhiệm vụ chỉ nhóm thấy), `personal` (bông phượng nhặt riêng cho từng tài khoản; 10 bông hiện tại thành nhiệm vụ cá nhân). Cảnh hồi tưởng lịch sử ("Ký ức") chạy **solo hoặc theo nhóm, tách khỏi thế giới chung**: client vẽ không gian riêng (lọc người chơi khác, đổi "da" thời kỳ), server chỉ kiểm bước; trong "Ký ức" **chỉ số sinh tồn tạm dừng**.
- Di chuyển tiến độ cũ: `hp3d.progress.v1` (hoa, món ăn, địa danh) nhập lên tài khoản như **huy hiệu/danh hiệu**, không quy ra tiền hoặc đồ (dữ liệu localStorage người dùng sửa được, `codebase_hooks.md` §6).

### 3.2 Định dạng nhiệm vụ (JSON Schema rút gọn)

```json
{
  "$id": "hp3d/quest.schema.json",
  "type": "object",
  "required": ["id", "version", "kind", "title", "steps", "rewards", "status"],
  "properties": {
    "id":       { "type": "string", "pattern": "^[a-z0-9_.]+$", "description": "vd main.c1.s2, side.coba.03, daily.breakfast" },
    "version":  { "type": "integer", "minimum": 1 },
    "kind":     { "enum": ["tutorial", "main", "side", "daily", "weekly", "event", "coop", "job", "generated"] },
    "status":   { "enum": ["draft", "reviewed", "fact_checked", "live", "retired"] },
    "title":    { "$ref": "#/$defs/i18n" },
    "summary":  { "$ref": "#/$defs/i18n" },
    "giver":    { "type": "object", "properties": {
                  "npc": { "type": "string" }, "board": { "type": "string" }, "auto": { "type": "boolean" }, "phoneApp": { "type": "boolean" } } },
    "requires": { "type": "object", "properties": {
                  "citizenLevel": { "type": "integer" },
                  "jobLevel":     { "type": "object", "additionalProperties": { "type": "integer" } },
                  "quests":       { "type": "array", "items": { "type": "string" } },
                  "notQuests":    { "type": "array", "items": { "type": "string" } },
                  "dateRange":    { "type": "object", "properties": { "from": { "type": "string" }, "to": { "type": "string" }, "calendar": { "enum": ["solar", "lunar"] } } },
                  "gameHours":    { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
                  "weather":      { "type": "array", "items": { "type": "string" } },
                  "party":        { "type": "object", "properties": { "min": { "type": "integer" }, "max": { "type": "integer" } } },
                  "account":      { "enum": ["any", "linked"] } } },
    "repeat":   { "type": "object", "properties": {
                  "mode": { "enum": ["once", "daily", "weekly", "cooldown"] }, "cooldownSec": { "type": "integer" }, "resetTz": { "const": "Asia/Ho_Chi_Minh" } } },
    "phase":    { "enum": ["world", "party", "personal", "memory"] },
    "pauseSurvival": { "type": "boolean" },
    "timeLimitSec":  { "type": "integer" },
    "steps":    { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/step" } },
    "choices":  { "type": "array", "items": { "type": "object", "properties": {
                  "atStep": { "type": "string" }, "options": { "type": "array" } } } },
    "rewards":  { "$ref": "#/$defs/rewards" },
    "partyRewards": { "type": "object", "properties": { "perMemberBonusPct": { "type": "number", "maximum": 30 }, "requireContribution": { "type": "boolean" } } },
    "onFail":   { "type": "object", "properties": { "retry": { "type": "boolean" }, "toast": { "$ref": "#/$defs/i18n" } } },
    "facts":    { "type": "array", "items": { "type": "object", "required": ["text", "tag"], "properties": {
                  "text": { "$ref": "#/$defs/i18n" },
                  "tag":  { "enum": ["THAT", "HU_CAU", "CAN_KIEM_CHUNG"] },
                  "source": { "type": "string" } } } },
    "codex":    { "type": "array", "items": { "type": "string" }, "description": "mục tư liệu mở khóa (ảnh, lời kể)" }
  },
  "$defs": {
    "i18n": { "type": "object", "required": ["vi", "en"], "properties": { "vi": { "type": "string", "maxLength": 280 }, "en": { "type": "string", "maxLength": 280 } } },
    "target": { "type": "object", "description": "đúng 1 trong các khóa", "properties": {
      "landmark": { "type": "string" }, "npc": { "type": "string" }, "shop": { "type": "string" },
      "shopCategory": { "type": "string" }, "street": { "type": "string" }, "zone": { "type": "string" },
      "point": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
      "radius": { "type": "number", "default": 18 }, "nearPlayer": { "type": "boolean" } } },
    "step": { "type": "object", "required": ["id", "kind", "text"], "properties": {
      "id":   { "type": "string" },
      "kind": { "enum": ["goto", "talk", "interact", "buy", "consume", "pickup", "collect", "deliver", "job", "minigame",
                         "photo", "quiz", "wait", "stat", "escort", "ride", "together", "donate", "choice"] },
      "text": { "$ref": "#/$defs/i18n" },
      "target": { "$ref": "#/$defs/target" },
      "item":   { "type": "string" }, "count": { "type": "integer", "default": 1 },
      "filter": { "type": "object", "description": "vd {\"category\":\"bun_pho\",\"distinct\":true} hoặc {\"job\":\"shipper\",\"weather\":\"rain\"}" },
      "minigame": { "type": "string" }, "minScore": { "type": "number" },
      "quiz":   { "type": "string", "description": "id bộ câu hỏi" }, "pass": { "type": "integer" },
      "photo":  { "type": "object", "properties": { "maxDist": { "type": "number" }, "yawTolDeg": { "type": "number" } } },
      "gameHours": { "type": "array" },
      "together": { "type": "object", "properties": { "radius": { "type": "number" }, "minMembers": { "type": "integer" }, "holdSec": { "type": "integer" } } },
      "parallel": { "type": "boolean", "description": "các bước liền kề có parallel=true được làm theo thứ tự bất kỳ" },
      "hint":   { "$ref": "#/$defs/i18n" },
      "marker": { "enum": ["map", "compass", "none"] } } },
    "rewards": { "type": "object", "properties": {
      "money": { "type": "integer", "maximum": 500000 },
      "xp": { "type": "object", "additionalProperties": { "type": "integer" }, "description": "khóa: citizen hoặc job:<id>" },
      "items": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "n": { "type": "integer" } } } },
      "vouchers": { "type": "array", "items": { "type": "string" }, "description": "phiếu ăn, phiếu xăng: thưởng hiện vật thay vì tiền mặt để giảm lạm phát" },
      "cosmetics": { "type": "array", "items": { "type": "string" } },
      "title": { "$ref": "#/$defs/i18n" },
      "mood": { "type": "integer" }, "reputation": { "type": "integer" },
      "unlock": { "type": "array", "items": { "type": "string" } },
      "cityFund": { "type": "integer", "description": "đóng góp hệ thống vào Quỹ thành phố" } } }
  }
}
```

### 3.3 Loại bước và cách server xác thực

| Bước | Sự kiện nguồn | Server kiểm | Dữ liệu cần |
|---|---|---|---|
| goto | vị trí đã kiểm chứng | khoảng cách tới mục tiêu ≤ radius, giữ 1 s | `LM`, `landmarks`, `shops.json`, vùng `zones.json`, tên phố từ `roadgraph`/OSM |
| talk | `talk_npc` | khoảng cách NPC ≤ 4 m | `npcs.json` (tách khỏi `npcs.js`) |
| interact / buy / consume | `ACTION` cửa hàng | khoảng cách `servicePoint`, giờ mở, tiền | `shops.json` |
| pickup / collect | `pickup` | đồ thuộc pha của người chơi, chưa nhặt | danh sách điểm nhặt theo id ổn định |
| deliver | `deliver` | đồ trong hành trang, ở mục tiêu, thời gian khả dĩ | `roadgraph.js` |
| job | `job_done` | bộ lọc nghề, thời tiết | — |
| minigame | `minigame_score` | điểm hợp lệ (biên dưới thời gian chơi tối thiểu, chống gửi điểm giả: server sinh đề, client gửi lời giải) | đề minigame |
| photo | `photo` | vị trí ≤ maxDist, hướng camera client gửi lệch ≤ yawTolDeg so với hướng tới địa danh (đủ cho game thân thiện) | tọa độ địa danh |
| quiz | `quiz_answer` | đáp án server giữ | ngân hàng câu hỏi có nguồn |
| wait | đồng hồ server | trong khung giờ game | — |
| stat | đánh giá lười chỉ số | ngưỡng | — |
| escort | NPC server đi theo | khoảng cách NPC-người chơi | NPC lớp C |
| ride | ghép cặp xe | hai người cùng xe, quãng đường | — |
| together | vị trí thành viên nhóm | ≥ minMembers trong bán kính, giữ holdSec | — |
| donate | `donate` | tiền | — |

### 3.4 Ví dụ nhiệm vụ

**(a) Cốt truyện — chương 1, cảnh 2**
```json
{
  "id": "main.c1.s2", "version": 1, "kind": "main", "status": "draft", "phase": "personal",
  "title": { "vi": "Người mở đất An Biên", "en": "The Founder of An Bien" },
  "summary": { "vi": "Theo lời Linh, tìm hiểu về Nữ tướng Lê Chân ở tượng đài và đền Nghè.", "en": "Follow Linh's lead to learn about Lady General Le Chan at her monument and Nghe Temple." },
  "giver": { "npc": "guide" },
  "requires": { "quests": ["main.c1.s1"], "citizenLevel": 1 },
  "repeat": { "mode": "once" },
  "steps": [
    { "id": "s1", "kind": "goto", "target": { "landmark": "lechan", "radius": 18 },
      "text": { "vi": "Tới tượng đài Nữ tướng Lê Chân.", "en": "Go to the Lady General Le Chan monument." }, "marker": "map" },
    { "id": "s2", "kind": "photo", "target": { "landmark": "lechan" }, "photo": { "maxDist": 40, "yawTolDeg": 20 },
      "text": { "vi": "Chụp một tấm ảnh tượng đài.", "en": "Take a photo of the monument." } },
    { "id": "s3", "kind": "goto", "target": { "landmark": "dennghe", "radius": 18 },
      "text": { "vi": "Tới đền Nghè, nơi thờ Nữ tướng.", "en": "Visit Nghe Temple, where she is worshipped." } },
    { "id": "s4", "kind": "talk", "target": { "npc": "temple_keeper" },
      "text": { "vi": "Nói chuyện với bác thủ từ.", "en": "Talk to the temple keeper." } },
    { "id": "s5", "kind": "quiz", "quiz": "lechan_basic", "pass": 2,
      "text": { "vi": "Trả lời câu hỏi của bác thủ từ.", "en": "Answer the keeper's questions." } }
  ],
  "rewards": { "money": 30000, "xp": { "citizen": 40 }, "vouchers": ["phieu_che_1"], "codex": ["codex.lechan.01"], "mood": 10 },
  "facts": [
    { "tag": "THAT", "text": { "vi": "Nữ tướng Lê Chân khai phá vùng đất An Biên, tiền thân Hải Phòng.", "en": "Le Chan founded An Bien, the forerunner of Hai Phong." }, "source": "js/landmarks.js (lechan); đối chiếu Bảo tàng Hải Phòng" },
    { "tag": "CAN_KIEM_CHUNG", "text": { "vi": "Lễ hội đền Nghè vào tháng 2 âm lịch.", "en": "The Nghe Temple festival is in the 2nd lunar month." }, "source": "landmarks.js fact; cần nguồn chính thống" }
  ]
}
```

**(b) Hằng ngày sinh tự động — "Bữa sáng đất Cảng"**
```json
{
  "id": "daily.breakfast", "version": 1, "kind": "daily", "status": "live", "phase": "personal",
  "title": { "vi": "Bữa sáng đất Cảng", "en": "Port City Breakfast" },
  "giver": { "phoneApp": true },
  "repeat": { "mode": "daily", "resetTz": "Asia/Ho_Chi_Minh" },
  "steps": [
    { "id": "s1", "kind": "consume", "count": 2, "filter": { "category": ["bun_pho", "banh"], "distinct": true }, "gameHours": [5, 10],
      "text": { "vi": "Ăn sáng 2 món khác nhau ở 2 quán khác nhau trước 10 giờ.", "en": "Eat 2 different breakfasts at 2 different stalls before 10:00." } }
  ],
  "rewards": { "xp": { "citizen": 10 }, "mood": 8, "vouchers": ["phieu_tra_da_2"] }
}
```

**(c) Co-op — "Mâm cỗ cưới phố cũ"**
```json
{
  "id": "coop.wedding_feast", "version": 1, "kind": "coop", "status": "draft", "phase": "party",
  "title": { "vi": "Mâm cỗ cưới phố cũ", "en": "The Wedding Feast Run" },
  "giver": { "npc": "chi_hang_ship" },
  "requires": { "party": { "min": 2, "max": 6 }, "jobLevel": { "shipper": 3 } },
  "repeat": { "mode": "cooldown", "cooldownSec": 7200 },
  "timeLimitSec": 900,
  "steps": [
    { "id": "s1", "kind": "pickup", "count": 1, "item": "mam_co", "target": { "shopCategory": "com", "nearPlayer": true },
      "text": { "vi": "Mỗi thành viên lấy một mâm cỗ (mỗi người một quán).", "en": "Each member picks up one tray (one restaurant each)." } },
    { "id": "s2", "kind": "together", "target": { "zone": "wedding_house_dyn" }, "together": { "radius": 25, "minMembers": 2, "holdSec": 5 },
      "text": { "vi": "Cả đoàn tới nhà cô dâu trong cùng 45 giây.", "en": "Arrive at the bride's house within 45 seconds of each other." } },
    { "id": "s3", "kind": "deliver", "item": "mam_co", "target": { "zone": "wedding_house_dyn" },
      "text": { "vi": "Bày cỗ (hàng còn nguyên vẹn được thưởng thêm).", "en": "Set the trays (intact food earns a bonus)." } }
  ],
  "rewards": { "money": 60000, "xp": { "job:shipper": 60, "citizen": 15 }, "items": [{ "id": "keo_cuoi", "n": 1 }], "mood": 12 },
  "partyRewards": { "perMemberBonusPct": 10, "requireContribution": true }
}
```

**(d) Sự kiện — "Chằng chống trước bão"**
```json
{
  "id": "event.storm.prep", "version": 1, "kind": "event", "status": "draft", "phase": "world",
  "title": { "vi": "Chằng chống trước bão", "en": "Batten Down Before the Storm" },
  "giver": { "auto": true },
  "requires": { "weather": ["storm_warning"] },
  "steps": [
    { "id": "s1", "kind": "interact", "count": 5, "filter": { "tag": "storm_sign" }, "parallel": true,
      "text": { "vi": "Chằng 5 biển hiệu trong phường của bạn.", "en": "Secure 5 shop signs in your ward." } },
    { "id": "s2", "kind": "interact", "count": 3, "filter": { "tag": "sandbag_spot" }, "parallel": true,
      "text": { "vi": "Kê 3 bao cát ven hồ hoặc bờ sông.", "en": "Lay 3 sandbags by the lake or river bank." } },
    { "id": "s3", "kind": "buy", "count": 2, "filter": { "category": "grocery", "items": ["mi_goi", "nuoc_suoi"] },
      "text": { "vi": "Mua dự trữ mì gói và nước.", "en": "Stock up on noodles and water." } }
  ],
  "rewards": { "money": 40000, "xp": { "citizen": 30 }, "cityFund": 20000, "title": { "vi": "Người giữ phố", "en": "Street Keeper" } }
}
```

**(e) Mẫu sinh đơn shipper (không phải nhiệm vụ viết tay; server điền tham số)**
```json
{ "template": "job.shipper.order", "pickup": { "shopCategory": "$cat" }, "dropoff": { "addressPool": "residential_frontage", "minDistM": 400, "maxDistM": "$byLevel" },
  "pay": { "base": 10000, "perKm": 6000, "onTimeBonus": 5000, "tipPctMax": 20 }, "flags": ["$hot|$fragile|$bulky"] }
```

### 3.5 Cốt truyện chính: hai tuyến song song

Nguyên tắc nội dung lấy nguyên từ `docs/KICHBAN_1946_1955.md` §0: không bịa sự kiện, số liệu tranh luận phải nói rõ là ước tính, không gán lời thoại bịa cho nhân vật lịch sử có thật (nhân vật dẫn truyện là **người dân hư cấu**), trang nghiêm không giật gân, đối chiếu nguồn chính thống (Bảo tàng Hải Phòng, cổng thông tin thành phố, Báo Hải Phòng) trước khi phát hành. Mọi dữ kiện trong nhiệm vụ mang nhãn `THAT/HU_CAU/CAN_KIEM_CHUNG` trong trường `facts`; trình kiểm tra (§6.3) **chặn** trạng thái `live` nếu còn `CAN_KIEM_CHUNG`.

Khung kể: người chơi là một người trẻ mới về sống ở Hải Phòng. Linh (hướng dẫn viên) và những người dân (Cô Ba, Bác Tư, Bà Năm, Thuyền trưởng Hải, Ông Khải) kể chuyện; mỗi chương mở một mảnh "**Ký ức thành phố**" (cảnh hồi tưởng `phase: memory`) đặt trên chính địa điểm thật trong game.

**Tuyến Lịch sử**

| Chương | Tên | Địa điểm trong vùng chơi | Nội dung | Cơ chế chính | Co-op | Trạng thái dữ kiện |
|---|---|---|---|---|---|---|
| Mở đầu | "Thành phố Hoa Phượng Đỏ" | Nhà hát lớn (spawn), Quán hoa, Rạp Tháng Tám | Làm quen: tên, ăn bánh mì, mua nước, gọi xe, bằng lái A1, nghề đầu tiên | Hướng dẫn sinh tồn, bản đồ | Mentor tour (tùy chọn) | — |
| 1 | "Người mở đất An Biên" | Tượng đài Lê Chân, đền Nghè, Trung tâm triển lãm | Nữ tướng Lê Chân, nữ tướng của Hai Bà Trưng thế kỷ 1, khai phá An Biên | goto, photo, quiz, codex | — | THẬT theo `landmarks.js`; ngày lễ hội CẦN KIỂM CHỨNG |
| 2 | "Cọc gỗ Bạch Đằng" | Bảo tàng Hải Phòng, phố Bạch Đằng, đình Hàng Kênh, trường THPT Ngô Quyền | Ba trận Bạch Đằng (938 Ngô Quyền, 981 Lê Hoàn, 1288 Trần Hưng Đạo) **[THẬT]**; sông Bạch Đằng nằm ngoài vùng chơi nên kể qua sa bàn ở bảo tàng | Minigame sa bàn "cắm cọc theo con nước" (thủy triều lên xuống), có thể chơi nhóm 2-4 | Có | Năm trận THẬT; chi tiết đình Hàng Kênh thờ ai: CẦN KIỂM CHỨNG |
| 3 | "Cảng biển và phố Tây" | Cảng Hải Phòng, Bến Bính, Nhà hát lớn, Bưu điện, Nhà thờ lớn, Ngân hàng Nhà nước, Ga Hải Phòng, Nhà Kèn, UBND | Hải Phòng thành cảng và thành phố thời Pháp thuộc (cuối thế kỷ 19, đầu thế kỷ 20); kiến trúc; đời sống công nhân, phu cảng; tiếng nói phê phán thực dân rõ ràng | Săn chi tiết kiến trúc (ảnh), giao thư theo tuyến bưu điện cũ, làm một ca phu cảng thời xưa (cảnh Ký ức) | Có (ca cảng) | Năm khởi công Nhà hát lớn, năm thành lập thành phố, năm xây ga: CẦN KIỂM CHỨNG từng mốc |
| 4 | "Đi trước về sau" (1946-1955) | Quán hoa, Nhà hát lớn, Tam Kỳ, ga, cảng | **Dùng nguyên kịch bản đã có** `docs/KICHBAN_SANXUAT.md`, `HOI1-4_PHANCANH.md`: Hồi 0-4, từ 20/11/1946 tới 13/5/1955 | Cơ chế phi bạo lực: sơ tán, đưa tin, giữ máy, kéo cờ | Hồi 3 "300 ngày giữ máy" chơi nhóm | Theo nhãn trong kịch bản; danh sách kiểm chứng §8 của kịch bản là điều kiện phát hành |

**Tuyến Đời sống (mở song song từ chương 1)**

| Chương | Tên | Địa điểm | Nội dung | Cơ chế |
|---|---|---|---|---|
| 5 | "Mùa phượng" | Hồ Tam Bạc, Quán hoa, trường THPT Ngô Quyền, Nhà hát lớn | Hoa phượng, biểu tượng thành phố; mùa chia tay học trò; Lễ hội Hoa Phượng Đỏ tháng 5 | Nhặt 10 bông (nhiệm vụ hiện có), ép hoa vào sổ (codex), trang trí xe hoa co-op, viết lưu bút (chat có kiểm duyệt) |
| 6 | "Hương vị đất Cảng" | Quán bánh đa cua của Cô Ba, chợ Sắt, các quán thật theo nhóm | Bánh đa cua, bún cá cay, bánh mì que cay, nem cua bể | Food tour 10 quán, học 5 công thức (mở rộng minigame), mở nghề hàng rong |
| 7 | "Biển gọi" (mở rộng) | Đồ Sơn, Hòn Dấu, Cát Bà (ngoài đĩa chơi hiện tại) | Ngư dân, hải đăng, vịnh Lan Hạ | Khóa tới khi bản đồ mở rộng; NPC Chú Sáu, Chị Thu đã có lời thoại |
| 8 | "Vượt bão" | Toàn thành phố | Tinh thần cộng đồng khi thiên tai; tri ân, không tái hiện thương vong | Gắn sự kiện bão §1.8.3; codex về phòng chống thiên tai |

Mốc phát hành gợi ý: chương 4 ra mắt dịp 13/5 (ngày giải phóng Hải Phòng **[THẬT, theo kịch bản]**) hoặc 2/9 như kế hoạch kịch bản; chương 5 trước tháng 5.

### 3.6 Nhiệm vụ phụ từ NPC

NPC hiện có trong vùng chơi **[ĐO]**: Linh (guide), Cô Ba (coba), Bác Tư xích lô (xichlo), Thuyền trưởng Hải (captain), Bà Năm Quán hoa (florist). Chú Sáu (Đồ Sơn) và Chị Thu (Cát Bà) đứng ngoài đĩa nên không dựng. NPC mới đề xuất: Chị Hằng (trạm giao hàng, chợ Sắt), Anh Toàn (xe ôm, ga), Ông Khải (thợ máy cảng), Ông Bảy (câu cá Tam Bạc), Thầy Minh (giáo viên sử, THPT Ngô Quyền), Bác thủ từ (đền Nghè), Sư cô (chùa Dư Hàng, bếp cơm từ thiện), Cô y tá (trạm y tế), Bác bảo vệ (Bảo tàng).

20 nhiệm vụ phụ mẫu (mỗi dòng sẽ thành 1 file JSON):

| # | NPC | Tên | Vòng chơi ngắn | Gắn với |
|---|---|---|---|---|
| 1 | Cô Ba | Nồi nước dùng đầu ngày | Mua cua đồng ở chợ Sắt trước 6 h game, mang về quán | Sinh tồn (bữa sáng miễn phí), mở hàng rong |
| 2 | Cô Ba | Khách quen | Giao 3 bát bánh đa cua cho 3 người già trong phố (đồ nóng) | Shipper |
| 3 | Bà Năm | Hoa cho ngày 20/11 | Giao hoa tới 3 trường học (thptnq, thcsnq, thcstp) | Sự kiện mùa |
| 4 | Bà Năm | Quán hoa 1944 | Tìm 3 tấm ảnh cũ trong bảo tàng, mang về kể chuyện | Codex |
| 5 | Bác Tư | Một vòng phố Tây | Chở một khách NPC bằng xích lô qua 4 công trình Pháp | Xích lô, chương 3 |
| 6 | Bác Tư | Bánh xe xẹp | Mua lốp ở cửa hàng xe, mang về | Kinh tế |
| 7 | Thuyền trưởng Hải | Con nước | Đưa thuyền ra giữa sông Cấm lúc nước lên, ghi lại độ cao mốc | Ngư dân, chương 2 |
| 8 | Linh | Khách lạc đường | Đưa một du khách NPC đi lạc từ ga về khách sạn | Hướng dẫn viên |
| 9 | Linh | Mắt nhìn kiến trúc | Chụp 5 chi tiết kiến trúc (cột đèn gang, hành lang vòm, lan can con tiện...) từ dữ liệu pano | Chương 3 |
| 10 | Chị Hằng | Đơn đầu tiên | Hướng dẫn nghề shipper | Nghề |
| 11 | Chị Hằng | Mưa thì đơn càng nhiều | Giao 5 đơn trong mưa mà hàng không ướt (mua áo mưa trùm hàng) | Thời tiết |
| 12 | Anh Toàn | Khách tàu sớm | Đón 3 khách ở ga trước 7 h game | Xe ôm |
| 13 | Ông Khải | Máy cũ còn chạy | Tìm 4 phụ tùng ở cửa hàng xe/vật tư, sửa máy tời | Cảng, dẫn vào chương 4 hồi 3 |
| 14 | Ông Bảy | Cá đối mùa nước | Câu 5 cá đối, bán ở chợ | Ngư dân |
| 15 | Thầy Minh | Phố mang tên ai | Đến 5 phố mang tên danh nhân, trả lời câu hỏi | Giáo dục, sinh tự động (§6) |
| 16 | Thầy Minh | Ngày tựu trường | Giao sách vở từ hiệu sách tới trường | Sự kiện tháng 9 |
| 17 | Sư cô | Góp gạo | Mua 10 kg gạo ở tạp hóa, mang tới bếp từ thiện | Cống tiền có ý nghĩa |
| 18 | Cô y tá | Mùa nắng nóng | Phát 5 chai nước cho người làm việc ngoài trời (NPC) | Thời tiết, sinh tồn |
| 19 | Bác bảo vệ | Đêm ở bảo tàng | Tìm 4 hiện vật trong sân bảo tàng bằng câu đố | Truy tìm kho báu |
| 20 | Bác thủ từ | Nén hương ngày rằm | Mua hương hoa, dâng ở đền vào ngày rằm âm lịch | Lịch âm |

### 3.7 Hằng ngày và hằng tuần
Mỗi ngày (reset 00:00 giờ Việt Nam), app "điện thoại" đưa 3 nhiệm vụ ngẫu nhiên từ bể ~30 mẫu, ví dụ: "Bữa sáng đất Cảng" (§3.4b), "3 đơn trước trưa", "Ghé 1 địa danh ngẫu nhiên và chụp ảnh", "Giúp 1 tân thủ", "**Trà đá chém gió**" (ngồi ở quán trà đá với ≥ 2 người chơi khác 60 s), "Một chuyến xe ôm trong mưa", "Câu 3 loại cá khác nhau", "Đi xe đạp 3 km". Thưởng: XP công dân, Tinh thần, **phiếu hiện vật** (phiếu ăn, phiếu xăng) thay vì tiền mặt.
Hằng tuần: "Tuần lễ nghề" (một nghề được +15% suốt tuần, xoay vòng), "Người con đất Cảng" (khám phá 1 mục codex mới), "Góp quỹ" (mốc Quỹ thành phố).
Không phạt khi bỏ ngày (không có chuỗi điểm danh mất trắng): chuỗi đăng nhập chỉ cộng, không reset về 0 mà giảm 1 bậc.

### 3.8 Lịch sự kiện mùa

| Thời gian (thật) | Sự kiện | Nội dung | Ghi chú |
|---|---|---|---|
| Tết Nguyên Đán (âm lịch) | Chợ hoa Tết | Giao đào, quất; gói bánh chưng co-op (nhóm 4, đêm 28-30 Tết); phố trang trí | Mỹ phẩm áo dài |
| Tháng 2 âm lịch | Lễ hội Nữ tướng Lê Chân ở đền Nghè | Rước kiệu (đội hình co-op), trò chơi dân gian | Ngày cụ thể CẦN KIỂM CHỨNG |
| 13/5 | Ngày giải phóng Hải Phòng | Ra mắt chương 4, cờ trên quảng trường Nhà hát lớn | THẬT theo kịch bản |
| Tháng 5 | Lễ hội Hoa Phượng Đỏ | Xe hoa, cuộc thi ảnh phượng, nhạc ở Nhà Kèn | Chương 5 |
| Tháng 6 | Mùa chia tay | Lưu bút ở trường, giao hoa | |
| 7-10 | Mùa bão | Sự kiện bão §1.8.3 | tối đa 1 bão/2 tuần |
| Rằm tháng 8 âm lịch | Trung thu | Làm đèn ông sao (thủ công), rước đèn quanh hồ Tam Bạc, phá cỗ | Co-op toàn server |
| 2/9 | Quốc khánh | Cờ, pháo hoa Nhà hát lớn | |
| 20/11 | Ngày Nhà giáo | Giao hoa tới trường | Nhiệm vụ Bà Năm |
| 24-25/12 | Giáng sinh ở Nhà thờ lớn | Đèn trang trí, hát thánh ca ở Nhà Kèn | Không tôn giáo hóa nhiệm vụ: chỉ trang trí, nhạc |

Lịch âm: server tính bằng thư viện lịch âm Việt Nam (múi giờ +7). Ngày lễ âm lịch cụ thể trong game đều qua kiểm chứng.

### 3.9 Nhiệm vụ co-op cho nhiều người

| Tên | Số người | Cơ chế | Chống phá |
|---|---|---|---|
| Giao hàng đoàn ("Mâm cỗ cưới") | 2-6 | Mỗi người lấy một mâm ở quán khác nhau, cả đoàn phải tới trong cửa sổ 45 s; hàng nguyên vẹn +thưởng | Pha `party`: người ngoài không thấy, không nhặt được |
| Rally Giao thông Văn minh | 2-20 | Chạy qua các trạm kiểm (checkpoint) trên phố thật; **giới hạn tốc độ server 12 m/s trong cuộc đua**, lỗi vỉa hè/vùng trường bị trừ điểm; xếp hạng = thời gian + điểm văn minh (văn minh nặng hơn tốc độ) | Không va chạm người chơi (ghost); không có cược |
| Truy tìm kho báu phố cổ | 2-6 | Mỗi thành viên nhận **mảnh gợi ý khác nhau** (thông tin bất đối xứng, phải nói chuyện): gợi ý từ dữ kiện địa danh, chi tiết pano (cây đa cổ thụ, chữ 3D lớn bờ hồ, trụ cứu hỏa đỏ, giàn pergola đỏ), loại cửa hàng + phố | Gợi ý không dùng tên thương hiệu |
| Ca cảng đôi | 2-4 | Người lái cẩu không thấy ô đích; người xi nhan thấy và ra hiệu (bánh xe hiệu lệnh nhanh) | Thưởng chỉ khi cả hai thao tác |
| Kéo lưới | 2-4 | Bấm đồng bộ theo nhịp hò; lệch nhịp mất cá | |
| Tour đoàn | 1 hướng dẫn + 1-10 khách người chơi | Như nghề hướng dẫn viên, khách là tân thủ thật | Mỗi tân thủ chỉ tính 1 lần |
| Gói bánh chưng | 4 | Bốn khâu: lá, gạo, đỗ-thịt, buộc lạt | |
| Rước đèn Trung thu | toàn server | Đi theo lộ trình đội hình, mỗi người cầm đèn tự làm; đèn sáng thêm theo số người | |
| Chuẩn bị bão và dọn dẹp sau bão | toàn server, theo phường | Thanh tiến độ phường | Đóng góp tính theo hành động, có trần mỗi người |
| Chở bạn bằng xe ôm | 2 | Một người lái, một người ngồi sau, đi tới địa danh, chụp ảnh chung | Thưởng 1 lần/cặp/ngày |

Thưởng nhóm: cộng 10%/thành viên tới tối đa +30%, **chỉ khi thành viên có đóng góp** (ở trong bán kính và hoàn thành phần việc của mình). Nhiệm vụ co-op tự co giãn mục tiêu theo số người (`count × số thành viên`).

### 3.10 Nhiệm vụ tác động lên sinh tồn và kinh tế
- Bước nhiệm vụ dùng chính nhu cầu: ăn ở quán X, mua áo mưa, ngủ nhà nghỉ → nhiệm vụ dạy hệ thống sinh tồn bằng việc làm.
- Phần thưởng ưu tiên **phiếu hiện vật** (phiếu ăn, xăng, giảm giá sửa xe) và mỹ phẩm độc quyền; tiền mặt từ nhiệm vụ ≤ 25% tổng thu nhập trung bình (bộ kiểm tra §6.3 tính "ngân sách thưởng").
- Nhiệm vụ văn hóa cho **Tinh thần** → +10% XP nghề: người chơi chỉ cày tiền sẽ kiếm ít hơn người chơi đa dạng.
- Thời tiết tạo nhiệm vụ (bão, nắng gắt phát nước), nghề tạo nhu cầu (công nhân cảng đói nhanh → khách cho hàng rong).
- Cảnh Ký ức tạm dừng sinh tồn; nhiệm vụ cốt truyện không bao giờ yêu cầu tiền để tiến (không khóa truyện sau tiền).

---

## 4. Xã hội cho hơn 1.000 người chơi

### 4.1 Kênh chat

| Kênh | Phạm vi | Ai được dùng | Giới hạn |
|---|---|---|---|
| Gần (bong bóng trên đầu + khung chat) | 40 m (tính trong ô AOI 128 m) | Mọi tài khoản; khách chỉ dùng **chat nhanh** | 140 ký tự, 1 tin/2 s, chụm 3 |
| Khu vực | 3×3 ô AOI (~384 m) | Cấp công dân ≥ 3 và đã liên kết Google | 1 tin/10 s |
| Nhóm | Thành viên nhóm | Mọi tài khoản trong nhóm (khách: chat nhanh) | |
| Bạn bè (tin riêng) | Hai người đã kết bạn hai chiều | Chỉ tài khoản liên kết, xem §4.7 về vị thành niên | |
| Hệ thống | Toàn server | Chỉ thông báo: bão, sự kiện, mốc Quỹ thành phố | Không có chat tự do toàn server |
| Rao (tùy chọn sau) | Toàn server | Cấp công dân ≥ 10, tốn 20.000₫ và hồi chiêu 60 s | Chỉ mẫu câu (rao bán sạp, gọi nhóm) |

**Chat nhanh (bánh xe câu sẵn, song ngữ):** "Xin chào!", "Cảm ơn!", "Đi cùng không?", "Theo mình!", "Chờ chút", "Đói quá, đi ăn đi!", "Trà đá không?", "Cẩn thận xe!", "Đẹp quá!", "Hẹn gặp lại!", cộng 8 biểu cảm (vẫy, cười, vỗ tay, cúi chào, chỉ đường, ngồi, chụp ảnh, nhún nhảy). Đây là chat chính trên điện thoại và cho khách.
Kiểm duyệt: theo `research_netcode.md` §10 (chuẩn hóa dấu tiếng Việt và teencode, danh sách chặn có danh sách cho phép, kiểm ML bất đồng bộ, báo cáo kèm 20 dòng ngữ cảnh, tắt tiếng bóng). Bộ lọc tên thương hiệu thật áp cho cả biệt danh.
Kỹ thuật: bong bóng chat và bảng tên dùng atlas canvas chung (không dùng `makeTextSprite`), font có hỗ trợ tiếng Việt, kiểm tra trên điện thoại (`codebase_hooks.md` §10 rủi ro 9).

### 4.2 Nhóm (party)
- Tối đa **6 người**. Mời bằng chạm vào người chơi (tương tác mới trong `nearestInteraction`) hoặc từ danh sách bạn. Trưởng nhóm chọn nhiệm vụ nhóm.
- Thành viên hiện trên bản đồ nhỏ, có la bàn chỉ hướng; mục tiêu nhiệm vụ nhóm được ưu tiên trong AOI (`research_netcode.md` §4.2: party/bạn được tăng ưu tiên).
- Chia thưởng như §3.9; tiền nghề không chia (mỗi người tự làm đơn).
- "Bàn ăn chung": cả nhóm ngồi cùng một quán nhận buff "Bữa đoàn viên".

### 4.3 Bạn bè, chặn
Kết bạn hai chiều, tối đa 200 bạn. Trạng thái online, vị trí theo **khu (phường)**, không theo tọa độ chính xác trừ khi đang chung nhóm. Chặn: ẩn chat, bong bóng, lời mời, không gặp trong ghép đoàn. Danh sách người chơi gần (≤ 30 người gần nhất) để báo cáo, chặn, mời.

### 4.4 Sạp người chơi
Có, giới hạn như §2.8. Lý do: tạo điểm hẹn xã hội về đêm ở phố đi bộ Tam Bạc, quảng trường Nhà hát lớn; giá trong dải nên không thành thị trường đầu cơ.

### 4.5 Cộng đồng và vinh danh
- **Quỹ thành phố** (§2.6) với mốc hiệu ứng thế giới.
- **Bảng xếp hạng tuần** theo nghề (số đơn, điểm văn minh, đánh giá khách), theo đóng góp sự kiện, theo khám phá codex. **Không có bảng xếp hạng tài sản** (tránh cổ vũ cày tiền).
- **Chế độ chụp ảnh** (ẩn HUD, tạo dáng), album ảnh cá nhân; cuộc thi ảnh tháng (bình chọn trong game, có kiểm duyệt).
- Danh hiệu (hiện dưới tên): "Người giữ phố", "Thực khách sành ăn", "Thợ cả bến cảng", "Người kể chuyện phố Tây"...

### 4.6 Thiết kế cho đám đông
- **Không va chạm và không tác động giữa người chơi** (không PvP, không đẩy, không trộm). Phá đám không có công cụ.
- **Nhiều điểm xuất hiện:** thay vì một `SPAWN` ở Nhà hát lớn (`main.js:213`), xuất hiện ở 6 điểm (Nhà hát lớn, ga, chợ Sắt, hồ Tam Bạc, bến tàu, công viên lớn) theo số người đang ở mỗi điểm; hoặc ở nhà nghỉ đã thuê.
- **Tài nguyên không giành nhau:** đơn, khách xe ôm, vị trí câu cá sinh **riêng theo người hoặc theo nhóm**; điểm nhặt nhiệm vụ cá nhân. Chỉ sự kiện thế giới là chung, và mục tiêu của chúng co giãn theo số người tham gia trong phường.
- **Điểm nóng:** sự kiện đặt ở nhiều địa điểm cùng lúc (Trung thu rước đèn 3 tuyến), giới hạn hiển thị theo TIER như `codebase_hooks.md` §3.2, thang suy giảm của netcode (`research_netcode.md` §4.5).
- **Xe dùng chung** (xích lô, thuyền thuê): server cấp quyền khi lên xe, nhả khi xuống hoặc mất kết nối 60 s.

### 4.7 An toàn cho trẻ vị thành niên và rủi ro pháp lý
- **Chế độ an toàn mặc định** cho mọi tài khoản khách và tài khoản khai < 16 tuổi: chỉ chat nhanh và biểu cảm; không tin riêng với người lạ; lời mời kết bạn chỉ chấp nhận qua nhóm/nhiệm vụ co-op; ẩn khu vực của bản thân; không giao dịch.
- **Không có nhắn tin riêng giữa người lớn và trẻ em chưa là bạn**; tài khoản tự khai < 18 tuổi không nhận tin riêng từ tài khoản ≥ 18 tuổi trừ khi có mã kết bạn trao tay (kiểu "mã gia đình").
- **Nhắc giờ chơi:** cảnh báo sức khỏe mỗi 30 phút, "nghỉ mắt" mỗi 60 phút. Nếu áp dụng nghĩa vụ G1 theo Nghị định 147/2024/NĐ-CP: người dưới 18 tuổi tối đa 60 phút mỗi lượt và 180 phút mỗi ngày, xác thực tài khoản bằng số điện thoại Việt Nam (tóm tắt thứ cấp trong `research_netcode.md` §11.2, **phải hỏi luật sư**). Thiết kế đã sẵn cờ "đã xác thực" để bật bắt buộc mà không đổi giao thức; giờ chơi dưới 18 được server đếm, hết giờ thì nhân vật tự về nhà nghỉ "nghỉ ngơi" (không mất gì).
- **Không yếu tố cờ bạc**: không vé số (dù có thật ngoài phố), không hộp quà ngẫu nhiên trả tiền, không cược trong đua xe. Câu cá có may rủi nhẹ nhưng không dùng tiền thật.
- **Không cồn, không thuốc lá** cho nhân vật người chơi (§1.6.2). Thông điệp "đã uống rượu bia không lái xe" ở quán bia.
- **Báo cáo và xử lý**: nút báo cáo ở mọi tên người chơi; hàng chờ quản trị viên; nhật ký lưu theo chính sách lưu trữ.
- Biệt danh: bộ lọc tục tĩu, mạo danh nhân viên, tên người thật nổi tiếng, tên thương hiệu.

---

## 5. Bảng cân bằng tổng hợp và tệp cấu hình

Mọi con số ở trên nằm trong một tệp server `balance.json` (đổi không cần deploy client; client nhận bản sao chỉ để dự đoán UI). Trích:

```json
{
  "time": { "dayLengthSec": 1440, "tz": "Asia/Ho_Chi_Minh" },
  "vitals": {
    "decayPerRealMin": { "hunger": 1.30, "thirst": 2.00, "hygiene": 0.50, "moodDriftTo50": 0.5 },
    "activityMul": {
      "idle":   { "hunger": 0.6, "thirst": 0.7, "hygiene": 0.5 },
      "walk":   { "hunger": 1.0, "thirst": 1.0, "hygiene": 1.0 },
      "run":    { "hunger": 1.6, "thirst": 1.8, "hygiene": 1.5 },
      "ride":   { "hunger": 0.8, "thirst": 0.9, "hygiene": 1.2 },
      "boat":   { "hunger": 1.0, "thirst": 1.2, "hygiene": 1.5 },
      "heavy":  { "hunger": 1.8, "thirst": 1.8, "hygiene": 3.0 },
      "sleep":  { "hunger": 0.3, "thirst": 0.3, "hygiene": 0.0 },
      "afk":    { "hunger": 0.5, "thirst": 0.5, "hygiene": 0.0 }
    },
    "stamina": { "runPerSec": -2.5, "jump": -5, "walkPerSec": 4, "restPerSec": 8, "ridePerSec": 6 },
    "health": { "regenPerMin": 1, "starvePerMin": -1, "dehydratePerMin": -2, "heatPerMin": -1, "trafficHitMax": 15, "trafficHitsPerMinCap": 2, "trafficFloor": 10 },
    "heat": { "driftOpen": 3, "driftShelter": 1, "driftRideWet": 4, "comfort": [35, 65], "hot": 66, "stroke": 80, "cold": 34, "freeze": 20 },
    "faint": { "wakeAfterSec": 10, "fee": { "pctCash": 0.05, "max": 30000, "freeBelowCitizenLevel": 5, "firstFaintPerDayFree": true },
               "after": { "health": 40, "hunger": 40, "thirst": 50 } },
    "login": { "minHunger": 60, "minThirst": 60 }
  },
  "economy": {
    "startCash": 150000,
    "fuelPricePerL": 25000,
    "repairPerPoint": 2000,
    "dailySoftCap": { "perJobHours": [[2.5, 0.7], [4.0, 0.4]], "totalVnd": 3500000, "overMul": 0.5, "newAccountCapVnd": 1500000, "newAccountHours": 72 },
    "multiJobBonus": 0.10,
    "jobs": {
      "shipper": { "base": 10000, "perKm": 6000, "onTime": 5000, "tipPctMax": 0.20, "minDistM": 400 },
      "xeom":    { "base": 10000, "perKm": 8000, "p2pSystemBonus": 5000, "p2pBonusPerDay": 10 },
      "vendor":  { "cartRent": 30000, "priceBand": [0.7, 1.3], "saturation": 0.6, "ingredientShare": 0.40 },
      "port":    { "shiftMin": 12, "shiftPay": 80000, "accuracyMax": 40000, "nightMul": 1.2 },
      "fisher":  { "boatRent30m": 20000, "bait": 5000, "priceElasticity": 1.0, "priceFloor": 0.5 },
      "guide":   { "tourPay": 150000, "tipMax": 100000, "mentorPerNewbie": 60000, "mentorPerDay": 5 }
    },
    "weatherJobMul": { "rain": { "shipper": 1.25, "xeom": 1.2, "vendorCustomers": 0.6, "fisher": 1.15 }, "hot": { "shipper": 1.1, "vendorDrinks": 1.4 }, "storm": { "essentialDelivery": 2.0, "port": 0, "fisher": 0 } }
  },
  "weather": { "stateMinutes": [20, 40], "forecastLeadMin": 10, "stormMaxPer14Days": 1, "stormMonths": [7, 8, 9, 10] }
}
```

---

## 6. Quy trình sản xuất nội dung (100+ nhiệm vụ với chi phí thấp)

### 6.1 Nội dung sinh từ dữ liệu thật có sẵn

| Nguồn dữ liệu | Số lượng **[ĐO]** | Mẫu nhiệm vụ | Số nhiệm vụ ước tính |
|---|---|---|---|
| `LANDMARKS` trong vùng chơi | 22 | (1) khám phá + chụp ảnh, (2) câu đố 3 câu từ `text/fact`, (3) chặng tour hướng dẫn viên, (4) "chuyện chưa kể" (codex, viết tay có nguồn) | 66 sinh tự động + 22 viết tay |
| `shops.json` (từ 1.154 biển) | 13 nhóm có ích, 72 điểm ăn, 94 điểm uống | Food tour theo phố, hằng ngày ăn uống, đơn shipper theo loại hàng, nhiệm vụ "tìm quán X trên phố Y" | Vô hạn (sinh theo ngày); 30 mẫu hằng ngày |
| Tên phố (OSM qua `roadgraph`, `STREETS`, vùng pano) | hàng chục phố trong đĩa (Quang Trung, Phan Bội Châu, Trần Hưng Đạo, Tô Hiệu, Điện Biên Phủ, Lê Lai, Hoàng Văn Thụ, Minh Khai, Cầu Đất, Đinh Tiên Hoàng, Tam Bạc, Thế Lữ, Hai Bà Trưng, Mê Linh, Trần Phú, Nguyễn Đức Cảnh...) | "Phố mang tên ai": đến phố, trả lời câu hỏi về danh nhân hoặc địa danh mà phố mang tên | ~20 (mỗi phố cần 1 dữ kiện có nguồn) |
| `audit/audit_enriched.json` | 551 pano; mục `special` (cây đa cổ thụ, chữ 3D lớn bờ hồ, giàn pergola đỏ, trụ cứu hỏa, cột đèn gang nhiều bóng, hành lang vòm kiểu Pháp, lan can con tiện...); phượng 101 pano, gánh hàng rong 72, chợ 73, cảng 72 | Săn ảnh, gợi ý kho báu, điểm đặt NPC hàng rong, vùng che chắn | ~100 gợi ý ảnh; 15-20 nhiệm vụ săn ảnh |
| `PARKS` | 37 | Nghỉ ngơi, picnic nhóm, tập thể dục sáng (Tinh thần) | 10 |
| NPC (5 có sẵn + 9 mới) | 14 | 20 nhiệm vụ phụ §3.6 | 20 viết tay |
| Kịch bản có sẵn `docs/KICHBAN_*`, `HOI1-4` | 4 hồi đã có phân cảnh | Chương 4 | ~25 cảnh (đã viết, cần dựng) |
| Lịch sự kiện | 10 sự kiện/năm | §3.8 | 10 chuỗi |

Tổng: **> 250 nhiệm vụ** chỉ từ dữ liệu sẵn có, trong đó khoảng 70 cần người viết tay (câu chuyện, kiểm chứng), phần còn lại là mẫu + tham số.

Lưu ý thương hiệu: một số mục `special` và biển hiệu trong pano có tên thương hiệu hoặc tên doanh nghiệp thật (ví dụ tên khách sạn, hãng taxi, showroom ô tô trong mô tả pano). **Mọi văn bản sinh ra dùng loại + phố**, và qua danh sách chặn thương hiệu (dùng lại bộ lọc của `gen_shopsigns`).

### 6.2 Công cụ (thư mục đề xuất trong repo, theo nếp `tools/`)
1. `tools/quests/gen_shops.mjs`: phân loại biển hiệu (từ khóa như bảng §1.6.1), id ổn định, `servicePoint` qua dữ liệu `findFree` xuất sẵn, giờ mở cửa theo nhóm, xuất `data/shops.json`.
2. `tools/quests/gen_shelters.mjs`: vùng che chắn từ pano (mái hiên), quanh quán, công viên → `data/shelters.json`.
3. `tools/quests/gen_templates.mjs`: sinh nhiệm vụ từ mẫu × dữ liệu (địa danh, phố, cửa hàng, pano) → `data/quests/generated/*.json` với `status: draft`.
4. **Soạn thoại có trợ lý AI, người duyệt**: mô hình ngôn ngữ soạn bản nháp lời thoại `{vi, en}` từ dữ kiện có nguồn và giọng nhân vật; người viết (hoặc chủ dự án) duyệt, chỉnh; dữ kiện lịch sử do người kiểm chứng gắn nhãn. AI không được tạo dữ kiện mới (bộ kiểm tra đánh dấu mọi câu có số, năm, tên người mà không có trong trường `facts`).
5. `tools/quests/validate.mjs` (chạy trong CI cùng `diag.mjs`): xem §6.3.
6. **Bot tự chơi**: bot giao thức headless (WebSocket, không mở Chrome, đúng lưu ý BSOD trong `codebase_hooks.md` §10 rủi ro 12) ở chế độ QA được dịch chuyển, đi qua từng bước để chứng minh nhiệm vụ hoàn thành được; chạy hằng đêm trên server thử.
7. Trang xem trước nhiệm vụ (HTML tĩnh) cho người duyệt: bản đồ đánh dấu mục tiêu, văn bản hai ngôn ngữ, nhãn dữ kiện.

### 6.3 Bộ kiểm tra nhiệm vụ (chặn phát hành nếu lỗi)
- Đúng JSON Schema §3.2; id duy nhất; mọi tham chiếu (`landmark`, `npc`, `shop`, `quest`) tồn tại.
- Mọi mục tiêu nằm trong `PLAY_RADIUS` (1588 m), trên đất liền (`landAt`), không trong footprint nhà, có đường đi trên `roadgraph` từ điểm xuất hiện.
- Có đủ `vi` và `en`, độ dài phù hợp màn hình điện thoại.
- Không chứa tên thương hiệu (danh sách chặn), không chứa từ cấm.
- Nhiệm vụ `main`/lịch sử: có `facts`, không còn `CAN_KIEM_CHUNG` khi `status: live`; nguồn không rỗng.
- **Ngân sách thưởng**: (tiền + quy đổi phiếu) / thời lượng ước tính ≤ 1,2 × thu nhập trung vị theo giờ của cấp yêu cầu.
- Không yêu cầu tiền để tiến cốt truyện; co-op có `requireContribution`.
- Bot hoàn thành được trong thời gian giới hạn.

### 6.4 Chi phí sản xuất ước tính **[ĐX]**

| Hạng mục | Công | Đầu ra |
|---|---|---|
| Bộ máy nhiệm vụ server + bus sự kiện + 15 loại bước | 3-4 tuần dev | nền tảng |
| Công cụ sinh + kiểm tra + trang xem trước | 1,5-2 tuần dev | ~250 nhiệm vụ nháp |
| Duyệt nhiệm vụ sinh tự động | 1 người, ~1 tuần | 180 nhiệm vụ `live` |
| Nhiệm vụ phụ viết tay có AI hỗ trợ | 6-10 nhiệm vụ/ngày/người viết | 20 nhiệm vụ trong 3 ngày |
| Một chương cốt truyện (viết + kiểm chứng + dựng cảnh Ký ức) | 2-4 tuần | 5-8 cảnh |
| Một sự kiện mùa | 1-2 tuần | 1 chuỗi + mỹ phẩm |

---

## 7. Thứ tự triển khai và đo lường

### 7.1 Đợt triển khai gameplay (khớp lát cắt multiplayer trong `codebase_hooks.md` §11)

| Đợt | Điều kiện trước | Nội dung gameplay |
|---|---|---|
| G0 | Mạng: kết nối, đồng bộ giờ, avatar từ xa | Biệt danh, chat nhanh, biểu cảm, nhiều điểm xuất hiện; chuyển 3 nhiệm vụ cũ sang server (hoa thành pha cá nhân) |
| G1 | Kiểm tra khả dĩ server, `worldVersion` | Đói, Khát, Thể lực, Sức khỏe; `shops.json` đồ ăn uống và y tế; ngất thân thiện; tiền; lưới an toàn; HUD |
| G2 | G1 ổn | Bộ máy nhiệm vụ JSON + hằng ngày; nghề shipper và xe ôm NPC; xăng, sửa xe; bằng lái A1; điểm văn minh (vỉa hè, vùng trường) |
| G3 | | Thời tiết (chưa bão), Thân nhiệt, Ướt, vùng che chắn; hàng rong, cảng; nhóm, bạn bè, chat khu vực; co-op giao hàng đoàn, ca cảng đôi |
| G4 | | Ngư dân, hướng dẫn viên + mentor; chương 1-3; Sạch sẽ, Tinh thần; sạp chợ đêm; Quỹ thành phố; sự kiện bão |
| G5 | Kiểm chứng lịch sử xong | Chương 4 (1946-1955) dịp 13/5 hoặc 2/9; lịch sự kiện mùa đầy đủ; chương 5-6, 8 |

### 7.2 Chỉ số cần đo (telemetry) để chỉnh `balance.json`
- Thời gian tới bữa ăn đầu tiên (mục tiêu: 80% người mới ăn trong 15 phút đầu); tỷ lệ phiên có ngất (mục tiêu < 3%, > 8% là quá khó).
- Thu nhập/giờ theo nghề và cấp (phân phối, không chỉ trung bình); tỷ lệ chi sinh hoạt/thu nhập theo cấp (mục tiêu §2.1).
- Tăng cung tiền/ngày/người hoạt động; hệ số Gini tài sản; phân bổ nghề (không nghề nào > 40% giờ làm việc).
- Phễu nhiệm vụ (nhận → xong) theo từng bước; bước bị bỏ nhiều nhất.
- Tỷ lệ người chơi vào nhóm; số tin chat bị lọc/báo cáo trên 1.000 tin.
- Mật độ người ở điểm nóng (ô 128 m có > 100 người) để chỉnh điểm xuất hiện và sự kiện.

---

## 8. Câu hỏi mở cho chủ dự án
1. Giữ ngày game 24 phút thật (hiện tại) hay kéo dài 48 phút? Thiết kế này **không phụ thuộc** vào độ dài ngày, nhưng ngày dài hơn cho quán xá theo giờ (bữa sáng, chợ đêm) rõ nét hơn.
2. Đồng ý giá đồ ăn gần giá thật (35-45k một bát) và thu nhập nén ×3-5? Hay dùng đơn vị hư cấu?
3. Mức độ "Sạch sẽ": giữ nhẹ như đề xuất hay bỏ hẳn ở bản đầu?
4. Bão: có muốn nhắc tên bão Yagi trong codex chương "Vượt bão" (kèm tri ân) hay hoàn toàn hư cấu?
5. Pháp lý G1 (Nghị định 147): có kế hoạch pháp nhân Việt Nam và giấy phép không, hay giữ ở mức thử nghiệm phi thương mại? Quyết định này ảnh hưởng tới chat tự do và xác thực số điện thoại.
6. Có mời cộng tác viên sử học hoặc Bảo tàng Hải Phòng duyệt tuyến Lịch sử (khuyến nghị của chính `KICHBAN_SANXUAT.md`)?
7. Mở rộng bản đồ ra Đồ Sơn, Cát Bà (chương 7, nghề ngư dân biển) có trong lộ trình 12 tháng không?
