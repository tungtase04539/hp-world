# Hải Phòng 3D — KẾ HOẠCH CHƠI NHIỀU NGƯỜI, SINH TỒN "ĐỜI SỐNG THÀNH PHỐ" VÀ NHIỆM VỤ

Bản chốt ngày 14/10/2026. Gộp từ hai bản nháp `ARCH.md` (kỹ thuật) và `GAMEDESIGN.md` (lối chơi) sau một vòng phản biện. Viết cho chủ dự án, không cần biết lập trình. Chi tiết kỹ thuật vẫn nằm trong hai bản nháp; khi hai bản nháp khác với tài liệu này thì **theo tài liệu này**.

Ký hiệu: **[ƯT]** = ước tính, phải đo lại bằng thử nghiệm trước khi tiêu tiền lớn.

---

## 1. Mục tiêu

1. **Nhiều người chơi cùng một thành phố**: hơn 1.000 người online cùng lúc (CCU) trong cùng một Hải Phòng, nhìn thấy nhau, nói chuyện, đi chung xe. Kiến trúc mở rộng được tới 3.000 người trên một máy, tới 10.000 khi thêm máy.
2. **Sinh tồn kiểu "đời sống thành phố"**: đói, khát, thể lực, sức khỏe, thân nhiệt, tiền. Ăn uống ở đúng quán có thật trên phố. Có nghề để kiếm tiền: shipper, xe ôm, bán hàng rong, bốc xếp cảng, ngư dân, hướng dẫn viên. Có thời tiết, có bão.
3. **Vào chơi ngay**: gõ biệt danh là chơi. Muốn giữ tiến trình trên máy khác thì bấm "Đăng nhập Google".
4. **Nhiệm vụ và cốt truyện** về lịch sử, văn hóa Hải Phòng, làm sau, trên nền chơi nhiều người.
5. **Thân thiện, an toàn**: không đánh nhau giữa người chơi, không mất đồ khi ngất, không cờ bạc, không bán lợi thế. An toàn cho trẻ em là mặc định.

**Một sự thật cần nói trước:** 1.000 người online cùng lúc nghĩa là mỗi ngày cần khoảng 10.000–20.000 người vào chơi [ƯT]. Đây là bài toán thu hút người chơi chứ không phải bài toán kỹ thuật. Kế hoạch này làm phần kỹ thuật **sẵn sàng** cho 1.000+ người, thử bằng người chơi giả (bot). **Chỉ thuê máy lớn khi có người thật.** Lúc đầu chỉ tốn khoảng 1–2 triệu đồng/tháng.

---

## 2. Các quyết định chính

| # | Vấn đề | Đề xuất (chọn) | Phương án khác | Vì sao |
|---|---|---|---|---|
| 1 | Máy chủ game viết bằng gì | **Tự viết bằng JavaScript (Node.js), dùng chung mã với game hiện tại** | Colyseus (khung có sẵn); Cloudflare Durable Objects (không phải tự quản máy) | Không sản phẩm nào có sẵn kiểu "một thành phố liền mạch 1.000 người". Dùng chung mã thì máy chủ tính đất, nước, cầu giống hệt trò chơi. Vài nền tảng game đã đóng cửa trong năm 2026, nên tự giữ mã và chỉ thuê máy thường là an toàn hơn. |
| 2 | Đặt máy chủ ở đâu | **Thử nghiệm kín: chạy ngay trên máy của chủ dự án** (mục 2b). Khi cần chạy 24/7 hoặc đông người: **Singapore** (Vultr / DigitalOcean / Hetzner, CPU riêng), có Cloudflare đứng trước | **Hà Nội** (Viettel IDC, BizFly) nếu đo thấy mạng ra quốc tế xấu, hoặc nếu luật yêu cầu dữ liệu ở trong nước | Từ Hải Phòng tới Singapore mất 50–75 ms, chơi tốt. Rủi ro là cáp biển hỏng (tháng 8/2026 mất 30% dung lượng). Vì vậy đo thật 2 tuần rồi mới chốt. |
| 3 | Ai quyết cái gì | **Máy chủ quyết mọi thứ có giá trị**: tiền, đồ, chỉ số sinh tồn, nghề, nhiệm vụ. Di chuyển thì trò chơi tự đi trước cho mượt, máy chủ kiểm và kéo lại nếu gian lận | Máy chủ mô phỏng cả di chuyển (cần khi có đua xe ăn thưởng hoặc đánh nhau, hiện chưa có) | Trình duyệt sửa được hết, nên không tin trình duyệt về tiền. Di chuyển kiểu "đi trước, kiểm sau" mượt với người chơi thật và rẻ. |
| 4 | Mở rộng | **1 máy chạy tới khoảng 3.000 người.** Chia thành phố thành nhiều vùng trên nhiều máy **chỉ khi** đỉnh thật vượt 1.500 người trong 2 tuần | Làm sẵn nhiều máy từ đầu | Chia vùng là phần khó nhất (3 tháng công). Chưa có người thật thì chưa làm. Mã viết sẵn "khe cắm" để chia sau không phải viết lại. |
| 5 | Đăng nhập | **Khách = tài khoản lưu trên máy chủ** (gõ biệt danh) + **Liên kết Google** + **mã khôi phục 12 ký tự** cho ai không dùng Google | Xác thực số điện thoại, nếu luật sư yêu cầu | Tiến trình nằm ở máy chủ từ đầu nên không ai sửa được. Có mã khôi phục vì iPhone tự xoá dữ liệu trang web sau 7 ngày không mở, và Google chặn đăng nhập trong trình duyệt của Zalo/Facebook. |
| 6 | Cơ sở dữ liệu | **Postgres tự chạy ngay từ ngày đầu**, sao lưu hằng đêm lên Cloudflare R2 | Supabase Singapore (khoảng 2–3 triệu đồng/tháng, đỡ việc quản trị) | Không dùng tạm SQLite/tệp rồi chuyển sau: chuyển dữ liệu là việc thừa. |
| 7 | Tệp mô hình 3D nặng | **Chuyển lên Cloudflare R2** (gần như miễn phí băng thông) | Giữ GitHub + jsDelivr | GitHub Pages giới hạn 1 GB, trang hiện đã 1,77 GB; mỗi người chơi mới tải 100–270 MB. Phải làm trước khi mời quá 200 người. |
| 8 | Phạm vi sinh tồn bản đầu | **4 chỉ số: Đói, Khát, Thể lực, Sức khỏe, cộng Tiền.** Thân nhiệt và độ ướt đi cùng thời tiết ở giai đoạn sau. Sạch sẽ và Tinh thần làm cuối | Làm cả 7 chỉ số ngay | Bảy chỉ số cùng lúc thì quá nhiều cho người mới và cho đội nhỏ. |
| 9 | Người chơi chạm nhau | **Không va chạm, không đánh nhau, không cướp** | Có PvP | Đông người thì phá đám là vấn đề số 1. Không có công cụ phá thì không phải xử lý. |
| 10 | Chat | **Chủ dự án chốt (14/10/2026): chat gõ tự do cho mọi người trong 40 m, kiểm soát chặt**: lọc tiếng Việt (bỏ dấu, teencode), chặn link/số điện thoại/nick mạng xã hội/lừa đảo, giới hạn tần suất, báo cáo + tự khoá chat khi 3 người báo, khoá chat ẩn cho người tái phạm, chủ dự án duyệt trực tiếp trên trang quản trị. Không có chat toàn server | Chỉ chat nhanh cho khách | Thử nghiệm kín theo lời mời nên người chơi đã được chọn lọc; kiểm soát chặt thay cho cấm. |
| 11 | Khi máy chủ sập | Trò chơi **vẫn chơi một mình được** (chế độ "Khám phá", không có tiền, không lưu nghề) | Báo lỗi và không cho chơi | Không làm hỏng trải nghiệm hiện có. |

## 2b. Giai đoạn thử nghiệm: máy chủ chạy ngay trên máy của chủ dự án (chốt 14/10/2026)

Máy hiện tại (AMD Ryzen AI 9 HX 370, 12 lõi / 24 luồng, 31 GB RAM, Docker có sẵn) **dư sức** làm máy chủ game cho thử nghiệm kín. Theo ước tính, máy chủ chỉ cần 1–2 lõi cho 1.000 người. Giới hạn thật không nằm ở CPU mà ở **mạng gia đình** và việc **máy phải luôn bật**.

| Hạng mục | Cách làm |
|---|---|
| Kết nối ra Internet | **Cloudflare Tunnel** (`cloudflared` đã cài sẵn). Không cần mở cổng modem, **giấu IP nhà**, có sẵn `wss://` bảo mật, chạy được cả khi nhà mạng dùng CGNAT. Miễn phí. Cần 1 tên miền trên Cloudflare (khoảng 300.000 đ/năm). Khi thử nhanh thì dùng địa chỉ tạm `trycloudflare.com`. |
| Cô lập | Máy chủ game + Postgres chạy trong **Docker**. Chỉ cổng game đi qua tunnel; không mở cổng nào khác; container không đọc được tệp cá nhân. Trang quản trị chỉ mở trên chính máy này (`localhost`). |
| Băng thông lên | Khoảng 3–5 KB/giây mỗi người: 50 người ≈ 2 Mbps, 200 người ≈ 8 Mbps, 1.000 người ≈ 30–40 Mbps. Cáp quang gia đình gánh tốt vài trăm người. **Trang game và mô hình 3D vẫn tải từ GitHub Pages/jsDelivr, không tải từ máy nhà** (mỗi người mới tải 100–270 MB). |
| Độ trễ | Người chơi ở Việt Nam → Cloudflare → máy nhà, nhiều khả năng **nhanh hơn Singapore**. Đo bằng trang `netprobe.html` trên điện thoại các nhà mạng. |
| Chi phí | Máy chủ 0 đ. Điện laptop khoảng 50–90 W, chỉ đáng kể nếu bật 24/7 (khoảng 150.000–250.000 đ/tháng). Nằm trong ngân sách 1 triệu đ/tháng. |
| Phải lưu ý | (1) Máy **không được ngủ**: chế độ chờ của máy này tự ngắt mạng ("Standby S0 — Network Disconnected"), nên khi mở server phải cắm sạc và tắt ngủ (script "Mở máy chủ" tự giữ máy thức). (2) **Không chạy kiểm tra đồ hoạ nặng trong giờ chơi thử**: máy từng sập màn xanh khi mở nhiều Chrome 3D; công cụ kiểm tra dùng chung khoá `gpulock`. (3) Windows Update có thể tự khởi động lại: đặt "giờ hoạt động" buổi tối. (4) Sao lưu Postgres mỗi đêm ra ổ khác/đám mây. (5) Điều khoản dịch vụ Internet gia đình thường không dành cho máy chủ công cộng; thử nghiệm kín, ít người thì không đáng lo. |
| Khi nào chuyển lên VPS | Cần chạy 24/7, hoặc thường xuyên trên ~200–300 người cùng lúc, hoặc anh cần dùng máy cho việc khác. Mọi thứ chạy trong Docker nên chuyển = chạy cùng cấu hình trên VPS + khôi phục bản sao lưu + đổi đích tunnel (khoảng 1 giờ). |

Hệ quả: **Giai đoạn 0 gần như không tốn tiền** (không cần thuê 3 máy đo); bước đo độ trễ Singapore/Hà Nội chỉ làm khi sắp chuyển lên VPS.

---

## 3. Sơ đồ kiến trúc

### 3.1 Bản đầu (tới 3.000 người): MỘT máy chủ game

```
  Người chơi (điện thoại / máy tính, trình duyệt)
  ┌────────────────────────────────────────────┐
  │ Trò chơi 3D (như hiện nay, tải từ           │
  │ GitHub Pages + mô hình 3D từ Cloudflare R2) │
  │  + mô-đun mạng chạy nền (Web Worker)        │
  └──────┬───────────────────────┬─────────────┘
         │ đăng nhập (HTTPS)     │ chơi (WebSocket bảo mật, 10 lần/giây)
         ▼                       ▼
  ┌──────────────────────────────────────────────┐
  │        Cloudflare (lá chắn, giấu IP máy)      │
  └──────┬───────────────────────┬───────────────┘
         ▼                       ▼
  ┌──────────────────────────────────────────────┐
  │   MÁY CHỦ GAME (Singapore, 1 máy 8 lõi)       │
  │                                                │
  │  Cổng kết nối ×5  ── nhận/gửi tin, chống spam, │
  │                       chọn ai nhìn thấy ai     │
  │  Bộ mô phỏng      ── kiểm di chuyển, sinh tồn, │
  │   (20 lần/giây)      tiền, nghề, quán, nhiệm vụ│
  │  Đồng hồ thế giới ── ngày/đêm, thời tiết, bão  │
  │  Cổng đăng nhập   ── khách, Google, mã khôi phục│
  └──────────────────────┬───────────────────────┘
                         ▼
  ┌──────────────────────────────────────────────┐
  │ Cơ sở dữ liệu Postgres: tài khoản, nhân vật,  │
  │ ví tiền + sổ cái, đồ, nhiệm vụ, báo cáo vi phạm│
  │ Sao lưu mỗi đêm → Cloudflare R2                │
  └──────────────────────────────────────────────┘
  Bên cạnh: trang quản trị (ẩn sau Cloudflare Access), biểu đồ giám sát,
  cảnh báo qua Telegram/email cho chủ dự án.
```

### 3.2 Khi vượt 3.000 người: chia thành phố cho nhiều máy

```
  Người chơi ──► Cloudflare ──► Cổng kết nối 1..N (mỗi máy ~2.000 người)
                                  │  mỗi cổng giữ "bản sao toàn thành phố"
                                  │  nên người chơi nhìn xuyên ranh giới vùng
                          đường truyền nội bộ (NATS)
                  ┌───────────────┼────────────────┐
              Vùng 1          Vùng 2   ...      Vùng M     Đồng hồ thế giới
         (ví dụ bờ hồ    (ví dụ ga, cảng)       (chia theo mật độ người,
          Tam Bạc)                               ranh giới theo sông/đường lớn)
                  └───────────────┬────────────────┘
                              Postgres
```

Đi từ vùng này sang vùng khác **không giật, không mất kết nối** (mục tiêu dưới 50 ms).

### 3.3 Ba nguyên tắc giữ cho game chạy nổi với 1.000 người

1. **Mỗi người chỉ nhận thông tin về người ở gần** (bán kính khoảng 120–160 m, tối đa 96 người). Nhờ vậy 1.000 người online mà mỗi người chỉ tốn khoảng 3–5 KB/giây, tức 10–20 MB mỗi giờ chơi.
2. **Người chơi khác được vẽ chung một lượt** (cùng kỹ thuật vẽ xe cộ hiện nay), nên vẽ 10 người hay 96 người thì tốn gần như nhau. Điện thoại yếu chỉ vẽ 40 người gần nhất, người xa hơn hiện chấm trên bản đồ nhỏ.
3. **Xe cộ và người đi đường NPC là trang trí riêng trên từng máy**, không đồng bộ, và không gắn với nhiệm vụ hay tiền.

---

## 4. Cách sinh tồn và kinh tế chạy trên máy chủ (luật chung cho cả hai bản nháp)

Phần này sửa các chỗ hai bản nháp nói khác nhau.

| Chủ đề | Luật chốt |
|---|---|
| Chỉ số tính thế nào | Máy chủ dùng **công thức theo thời gian** (đói giảm X điểm/phút nhân hệ số hoạt động). Chỉ tính lại khi có sự kiện: ăn, đổi hoạt động, đổi thời tiết, vào chỗ trú. Không tính từng nhịp nên 1.000 người hay 10.000 người đều nhẹ. Cùng một tệp công thức dùng cho trò chơi và máy chủ. |
| Gửi chỉ số cho người chơi | Một tin "chỉ số" **tối đa 1 lần/giây**, kèm tốc độ thay đổi để thanh HUD chạy mượt. Vượt ngưỡng (ví dụ "đói") thì báo ngay. |
| Thể lực (đổi theo từng giây khi chạy) | Trò chơi tự tính để cảm giác mượt; máy chủ tính song song bằng cùng công thức và cho phép lệch ±10 điểm. Gian lận "chạy mãi không mệt" bị máy chủ coi là đi bộ. |
| Hoạt động (đi, chạy, lái xe, việc nặng, ngồi, ngủ, treo máy) | Máy chủ tự suy ra từ chuyển động đã kiểm, lấy trung bình 5 giây để không đổi liên tục. Trò chơi không được tự khai. |
| Offline | **Chỉ số đóng băng** khi thoát. Vào lại thì Đói/Khát tối thiểu 60. |
| Tiền | Chỉ máy chủ đổi tiền. Mọi giao dịch có mã chống bấm hai lần và ghi **sổ cái hai bên** (tổng luôn khớp, đối soát mỗi đêm). Giao dịch giữa hai người chơi hoặc trên 1 triệu đồng game thì ghi ngay mới báo thành công. Không có lệnh chuyển tiền tự do. |
| Mini-game (nấu ăn, câu cá, cần cẩu) | Điểm mini-game ra tiền nên **máy chủ ra đề, trò chơi gửi lời giải, máy chủ chấm**, kèm thời gian chơi tối thiểu. Bản nháp kỹ thuật chưa có phần này, nay bổ sung. |
| NPC có ảnh hưởng gameplay (khách xe ôm, đoàn du khách, khách mua hàng rong) | Là **thực thể của máy chủ**, tính vào giới hạn 96 thứ nhìn thấy, cập nhật 2–5 lần/giây. Mỗi người tối đa 8 NPC đi theo. |
| Va chạm với xe NPC | Chỉ trừ máu nhỏ do trò chơi báo, tối đa 2 lần/phút, không bao giờ làm ngất. |
| Bão | Thời tiết thường đổi mỗi 20–40 phút theo mùa, có báo trước 10 phút. **Bão là sự kiện có lịch**: báo trước 24 giờ, rơi vào 20–22 giờ tối, tối đa 1 lần/2 tuần, tháng 7–10. Bão không tự kéo nhân vật chạy; chỉ cảnh báo và không cho máu xuống dưới 10. |
| Ngất | Tỉnh lại sau 10 giây ở trạm y tế gần nhất, mất phí nhỏ (lần đầu mỗi ngày và người mới thì miễn phí). Không mất đồ, không mất cấp. |
| Cửa hàng | Sinh tự động từ biển hiệu thật (con số chính xác do công cụ đếm; hai bản nháp ghi 954 và 1.154). Giao diện ghi **loại + phố** ("Quán phở · phố Quang Trung"), **không ghi tên thương hiệu**. |

---

## 5. Lộ trình theo giai đoạn

Giả định **1 lập trình viên chính làm toàn thời gian, có Claude hỗ trợ**. Làm bán thời gian thì nhân 1,5–2 lần. Mỗi giai đoạn có **cổng nghiệm thu**: chưa đạt thì chưa sang giai đoạn sau. Mọi thay đổi phía trò chơi vẫn chạy bộ kiểm tra cũ của dự án (`diag`, `waterbfs`, ảnh `tour`) và cập nhật `KNOWLEDGE.md` trong cùng lần lưu.

**Làm song song với Đợt 3 đang chạy:** Giai đoạn 0 (đo mạng, luật sư, R2, thử 1.000 bot) làm được ngay mà không đụng mã trò chơi. Việc tách mã dùng chung (sửa `main.js`, `vehicles.js`) **đợi Đợt 3 gộp xong** để tránh xung đột, và bắt đầu từ một bản thành phố đã "đóng băng" (có gắn nhãn phiên bản).

### Giai đoạn 0 — Chuẩn bị và đo trước khi tiêu tiền (2–3 tuần)

| Làm gì | Kết quả bàn giao |
|---|---|
| Hẹn **luật sư** về Nghị định 147/2024 (game nhiều người) và luật dữ liệu cá nhân | Biên bản tư vấn: được thử nghiệm kín không, cần gì để mở công khai |
| Mua tên miền; thuê 3 máy thử rẻ (Singapore, Hồng Kông, Hà Nội); thêm chế độ đo mạng vào trang hiện có | Bảng độ trễ thật theo nhà mạng (Viettel, VNPT, FPT, Mobifone, Vinaphone) giờ cao điểm 19–23 h, đo cả đi thẳng lẫn qua Cloudflare |
| Chuyển mô hình 3D lên Cloudflare R2, giữ cơ chế ghim phiên bản và cổng `check_assets` | Trang tải từ R2, GitHub Pages dưới 1 GB |
| Dựng thử máy chủ tối giản + **1.000 người chơi giả** trên 1 máy 2 lõi | Số đo CPU, RAM, băng thông thật |
| Đo **điện thoại thật** (2–3 máy Android tầm trung + 1 iPhone): khung hình, bộ nhớ, thời gian vào game, kèm `__hp.tier` + `__hp.gpu` | Mốc hiệu năng "trước multiplayer" |

**Nghiệm thu:** chốt Singapore hay Hà Nội bằng số liệu; 1.000 bot chạy được trên 1 máy nhỏ (tick dưới 25 ms); có ý kiến luật sư bước đầu. **Chi phí:** khoảng 400.000–800.000 đồng.

### Giai đoạn 1 — "Thấy nhau": thử nghiệm kín (5–7 tuần)

| Làm gì | Kết quả bàn giao |
|---|---|
| Máy chủ một tiến trình: kết nối, kiểm di chuyển (tốc độ, đất/nước, trong vùng chơi), kéo lại khi gian lận | Người chơi thấy nhau đi bộ, chạy, lái xe máy mượt |
| Tài khoản khách trên máy chủ (Postgres ngay từ đầu), biệt danh `Ten#1234`, lọc tên tục/thương hiệu | Gõ biệt danh là chơi |
| Người chơi khác vẽ chung một lượt, **có dấu hiệu phân biệt người thật với NPC** (bảng tên, vòng sáng dưới chân) | Không nhầm người chơi với người đi đường |
| Chat nhanh + biểu cảm; chat gõ trong 40 m cho người được mời; nút báo cáo, chặn | Nói chuyện được |
| Ngày/đêm chung cho mọi người; 6–8 điểm xuất hiện rải khắp phố | Cả server cùng giờ, không dồn một chỗ |
| Giới hạn số người + hàng chờ có thời gian dự kiến; đo đạc từ trò chơi; chế độ "chơi một mình" khi mất máy chủ | Không sập khi quá tải |

**Nghiệm thu:** 300 bot + 5 trình duyệt thật chạy 8 giờ liền không sập; độ trễ từ Hải Phòng (cáp quang) dưới 70 ms; "A bước, B thấy" dưới 300 ms; điện thoại tầm trung tụt khung hình không quá 5% khi có 40 người quanh mình; **20–50 người thật (bạn bè, người được mời) chơi một buổi tối**. **Chi phí:** khoảng 0,7–1,3 triệu đồng/tháng.

### Giai đoạn 2 — Tài khoản thật và sức chứa 1.000+ (5–7 tuần)

| Làm gì | Kết quả bàn giao |
|---|---|
| Liên kết Google; **mã khôi phục**; phát hiện trình duyệt trong Zalo/Facebook và hướng dẫn mở bằng Chrome/Safari; nhắc liên kết sau 20 phút chơi | Không mất tiến trình khi đổi máy |
| Rớt mạng vào lại trong 60 giây thì giữ nguyên chỗ; 1 tài khoản 1 phiên | Điện thoại đổi sóng không mất game |
| Tách việc gửi/nhận ra nhiều luồng trên 1 máy 8 lõi; nén dữ liệu chỉ gửi phần thay đổi; **"thang giảm tải"** khi đông | 1 máy gánh 1.000–3.000 người |
| Trang quản trị: tìm người chơi, xem báo cáo, khoá chat, đuổi, cấm có thời hạn; nhật ký thao tác | Người kiểm duyệt làm việc được |
| Sao lưu mỗi đêm + diễn tập khôi phục hằng tháng; cảnh báo qua Telegram | Mất máy không mất dữ liệu |
| **Quy trình phát hành**: máy chủ lên trước, trò chơi lên sau, máy chủ hiểu cả bản cũ lẫn bản mới; khi bản đồ thành phố đổi (nhà mới, đường mới) thì tự dời người chơi đang đứng "trong tường" ra chỗ trống gần nhất | Sửa thành phố không làm hỏng tài khoản |
| Nhập tiến trình cũ trên máy (hoa, địa danh) thành **huy hiệu**, không đổi ra tiền | Người chơi cũ không mất thành tích |

**Nghiệm thu:** 1.200 bot chạy ổn (tick dưới 25 ms); 2.000 bot thì giảm tải đúng thứ tự, không sập; 300 bot dồn vào quảng trường Nhà hát lớn vẫn chạy; 1.000 người rớt mạng cùng lúc vào lại hết trong 30 giây; giết máy chủ giữa chừng không mất tiền; beta kín 200 người thật cùng lúc. **Chi phí** ở mức sẵn sàng 1.000 người: khoảng 8,6 triệu đồng/tháng, nhưng **chỉ thuê khi có lịch beta lớn**.

### Giai đoạn 3 — Sinh tồn cơ bản và 2 nghề đầu (6–8 tuần)

| Làm gì | Kết quả bàn giao |
|---|---|
| 4 chỉ số (Đói, Khát, Thể lực, Sức khỏe) + HUD 4 vòng tròn (điện thoại: 1 vòng, chạm để xem); ngất thân thiện | Sinh tồn chạy trên máy chủ |
| Sổ cửa hàng từ biển hiệu thật (ăn, uống, thuốc, tạp hoá); thực đơn giá gần giá thật; giờ mở cửa | Ăn bánh đa cua ở quán thật |
| Ví tiền + sổ cái hai bên + đối soát mỗi đêm; tiền khởi đầu 150.000₫ | Kinh tế không gian lận được |
| Lưới an toàn: bếp cơm từ thiện chùa Dư Hàng, vòi nước miễn phí, việc vặt khi hết tiền | Không ai bị kẹt |
| **Shipper** (đơn riêng cho từng người, tính quãng đường theo đường phố thật); **xe ôm chở khách NPC**; xăng, hao xe; "xe công vụ" cho người mới | 2 nghề kiếm tiền |
| Điểm vi phạm, trần thu nhập ngày, cảnh báo thu nhập bất thường | Chống bot cày |

**Nghiệm thu:** bot gian lận tốc độ bị bắt trên 99%; sổ cái khớp 14 đêm liên tiếp; mỗi nghề có bot chạy hết vòng; trong beta, 80% người mới ăn bữa đầu trong 15 phút và dưới 3% phiên chơi bị ngất. **Chi phí:** không tăng đáng kể (thêm dưới 10%).

### Giai đoạn 4 — Thời tiết, nhiệm vụ, chơi nhóm (6–8 tuần)

| Làm gì | Kết quả bàn giao |
|---|---|
| Thời tiết (nắng, mưa, dông, gió mùa, sương), **Thân nhiệt + Ướt**, chỗ trú (mái hiên, quán, tán cây), áo mưa | Mọi người thấy cùng một cơn mưa |
| **Bộ máy nhiệm vụ** đọc tệp dữ liệu (không cần sửa mã khi thêm nhiệm vụ); chương mở đầu + chương 1 (Lê Chân) + 10 nhiệm vụ phụ; 3 nhiệm vụ ngày | Có cốt truyện |
| Nhóm tối đa 6 người, bạn bè, chặn; 1 nhiệm vụ nhóm ("Mâm cỗ cưới") | Chơi cùng nhau |
| **Bán hàng rong** (mini-game nấu do máy chủ chấm); **xe ôm chở người chơi thật** (cần dáng ngồi sau) | Thêm 2 nghề xã hội |

**Nghiệm thu:** hai máy khác nhau thấy cùng thời tiết cùng lúc; mọi nhiệm vụ có bot tự chơi hết; nhiệm vụ lịch sử không còn dữ kiện "cần kiểm chứng" khi phát hành; nhiệm vụ nhóm hoàn thành được khi có người rớt mạng giữa chừng.

### Giai đoạn 5 — Nội dung và sự kiện (liên tục, mỗi đợt 2–4 tuần)

Theo thứ tự: bốc xếp cảng → ngư dân → hướng dẫn viên (kèm dẫn tân thủ) → **sự kiện bão cả thành phố** → chương 2–3 → Sạch sẽ, Tinh thần → sạp chợ đêm, Quỹ thành phố → chương 4 "1946–1955" (chỉ phát hành khi sử gia đã duyệt; mốc gợi ý 13/5 hoặc 2/9) → sự kiện mùa (Tết, Hoa Phượng Đỏ, Trung thu). **Để sau cùng hoặc bỏ:** đua xe có xếp hạng, điểm "văn minh giao thông" kiểu vượt đèn đỏ (chưa có đèn đồng bộ), cảnh "Ký ức" đổi giao diện thời kỳ (tốn công vẽ rất nhiều).

### Giai đoạn 6 — Chia thành phố cho nhiều máy (6–8 tuần, chỉ khi cần)

**Điều kiện bắt đầu:** đỉnh thật vượt 1.500 người trong 2 tuần liền, hoặc máy chủ dùng quá 60% CPU giờ cao điểm. Nội dung: đường truyền nội bộ, chia vùng theo mật độ, chuyển người giữa vùng, triển khai lần lượt từng máy không làm rớt người chơi. **Nghiệm thu:** 3.000 bot đi qua lại 4 vùng không giật; 10.000 bot trên máy thuê theo giờ (khoảng 130.000 đồng một lần thử) **trước bất kỳ chiến dịch quảng bá lớn nào**.

### Tổng thời gian

| Mốc | Tích luỹ (toàn thời gian) |
|---|---|
| Thấy nhau, thử nghiệm kín (GĐ 0–1) | khoảng 2–2,5 tháng |
| Sẵn sàng 1.000 người, có tài khoản Google (GĐ 2) | khoảng 3,5–4 tháng |
| Đời sống thành phố chơi được: ăn uống, 2 nghề (GĐ 3) | khoảng 5–6 tháng |
| Thời tiết + nhiệm vụ + nhóm (GĐ 4) | khoảng 6,5–8 tháng |

---

## 6. Chi phí hằng tháng

Tỷ giá 26.000 đồng/USD. Giá máy Vultr Singapore đọc ngày 14/10/2026. Đã tính băng thông kèm máy (giá vượt mức chỉ khoảng 10 USD/TB). Số người là **đỉnh cùng lúc**; trung bình cả tháng giả định bằng 40% đỉnh. Tất cả là [ƯT] cho tới khi thử tải.

### 6.1 Theo giai đoạn (trước khi có đông người)

| Giai đoạn | Máy | USD/tháng | Đồng/tháng |
|---|---|---|---|
| GĐ 0: đo đạc (2–4 tuần) | 3 máy thử nhỏ | 15–30 | 0,4–0,8 triệu |
| GĐ 1: thử nghiệm kín, dưới 200 người | 1 máy 2 lõi + Cloudflare miễn phí + R2 | 25–50 | 0,7–1,3 triệu |

### 6.2 Theo quy mô

| Mức | 1.000 người | 3.000 người | 10.000 người |
|---|---|---|---|
| **Tiết kiệm** (máy chung lõi, không máy dự phòng, Cloudflare miễn phí/Pro) | khoảng **$130** (3,4 triệu) | khoảng **$600** (15,6 triệu) | khoảng **$2.000** (52 triệu) |
| **Khuyến nghị** (CPU riêng, có máy dự phòng, giám sát, Cloudflare Pro, chống DDoS cơ bản) | khoảng **$330** (8,6 triệu), dải $300–380 | khoảng **$1.000** (26 triệu), dải $930–1.150 | khoảng **$3.000** (78 triệu), dải $2.800–3.800 |
| **Cao cấp** (máy chính ở Hà Nội, dự phòng TP.HCM + Singapore, CSDL dự phòng nóng, Cloudflare Business, chống DDoS thuê riêng) | **$1.500–2.200** (39–57 triệu) | **$3.300–4.800** (86–125 triệu) | **$7.000–10.000** (182–260 triệu), cần báo giá |
| Ghi chú | 1 máy 8 lõi đủ | 1 máy chính + 1 dự phòng; cân nhắc Cloudflare Business | **cần làm xong Giai đoạn 6** |

Để so sánh: đặt trên AWS/Google Singapore thì riêng băng thông đã đắt gấp 4–10 lần; các nền tảng game dựng sẵn (Nakama Cloud, SpacetimeDB Maincloud) đắt gấp 4–15 lần.

### 6.3 Chi phí ngoài máy chủ (hay bị quên)

| Khoản | Ước tính |
|---|---|
| Tên miền | khoảng 300.000–400.000 đồng/năm |
| Đăng nhập Google, Cloudflare Turnstile (chống bot) | miễn phí |
| Luật sư (tư vấn ban đầu) | xin báo giá; khoản một lần |
| Người kiểm duyệt chat buổi tối (từ khoảng 300 người online trở lên) | 1–2 người bán thời gian [ƯT] |
| Duyệt nội dung lịch sử (sử gia, Bảo tàng Hải Phòng) | theo chương; khoản một lần |
| Thử tải 10.000 bot | khoảng 130.000 đồng mỗi lần (thuê máy theo giờ) |

---

## 7. Rủi ro và cách đỡ

| # | Rủi ro | Mức | Cách đỡ |
|---|---|---|---|
| 1 | **Pháp lý**: Nghị định 147/2024 xếp game nhiều người qua máy chủ vào loại G1. Loại này cần doanh nghiệp Việt Nam, giấy phép, **xác thực số điện thoại Việt Nam**, lưu dữ liệu trong nước, giới hạn giờ chơi dưới 18 tuổi. Điều này **mâu thuẫn với "vào chơi ngay bằng biệt danh"** nếu mở công khai. Luật bảo vệ dữ liệu cá nhân cũng có thể đặt điều kiện khi lưu dữ liệu ở Singapore. Nội dung lịch sử 1946–1955 có thể phải qua duyệt. | Rất cao | Hỏi luật sư ở GĐ 0. Trong lúc chờ: chỉ **thử nghiệm kín theo lời mời, phi thương mại**. Hệ thống làm sẵn cờ "đã xác thực", bộ đếm giờ chơi, xuất/xoá dữ liệu, và có thể chuyển cả cụm máy về Hà Nội. *Đây không phải tư vấn pháp lý.* |
| 2 | **Không đủ người chơi**: thành phố rộng 8 km² mà chỉ có 30 người thì trông trống trải. Các tính năng "cả server" (bão, Quỹ thành phố, xe ôm chở người thật) không vận hành được. | Cao | Mọi tính năng phải chơi được khi **chỉ có 20 người** (mục tiêu tự co giãn theo số người; có khách NPC thay khi thiếu người). Giờ chơi chung buổi tối. Có kế hoạch thu hút người chơi riêng (câu hỏi số 5). |
| 3 | **Vào game nặng trên điện thoại**: tải lần đầu 100–270 MB, dựng thế giới 17–35 giây. Điện thoại yếu có thể tràn bộ nhớ. Mất người chơi ngay từ cửa. | Cao | R2 + bộ nhớ đệm; bản nhẹ cho điện thoại theo TIER (không theo màn cảm ứng); đo trên máy thật ở GĐ 0 và GĐ 1; màn chờ có tiến độ; không thêm gánh nặng đồ hoạ cho người chơi khác. |
| 4 | **Đăng nhập trên điện thoại hỏng âm thầm**: Google chặn đăng nhập trong trình duyệt của Zalo/Facebook (cách người Việt hay chia sẻ link); iPhone xoá dữ liệu trang sau 7 ngày không mở nên khách mất tài khoản. | Cao | Mã khôi phục; phát hiện trình duyệt trong ứng dụng và hướng dẫn mở bằng Chrome/Safari; nhắc liên kết Google sớm. |
| 5 | **Đội quá nhỏ**: 1 lập trình viên vừa viết mã vừa trực máy chủ lúc 21 giờ; kế hoạch dài 6–8 tháng. | Cao | Cắt phạm vi (2 nghề trước, không chia vùng sớm); chỉ dùng máy thường + dịch vụ hệ thống đơn giản, không dùng hệ thống phức tạp; cảnh báo tự động; khởi động lại có thông báo trước; tài liệu vận hành trong `KNOWLEDGE.md`. |
| 6 | **Cáp biển quốc tế hỏng** làm máy Singapore chậm vào giờ cao điểm. | Trung bình | Đo 2 tuần ở GĐ 0; nếu xấu thì chuyển cả cụm về Hà Nội (kiến trúc cho phép). Bộ đệm làm mượt tự giãn khi mạng xấu. |
| 7 | **Gian lận kinh tế bằng tài khoản phụ**: thưởng "chở tân thủ", "dẫn tân thủ", mua hàng rong của chính mình để chuyển tiền. | Trung bình | Tài khoản khách không gửi/nhận tiền và không mua của người chơi khác; thưởng tân thủ chỉ tính khi tân thủ đã chơi đủ 30 phút, khác thiết bị, đã liên kết; trần ngày; cảnh báo bất thường. Thưởng tân thủ do hệ thống trả **để sau giai đoạn beta**. |
| 8 | **Chat độc hại, an toàn trẻ em** | Trung bình | Mặc định chat nhanh cho khách và tài khoản dưới 16 tuổi; bộ lọc tiếng Việt (bỏ dấu, teencode) do người Việt duyệt danh sách; báo cáo kèm 20 dòng chat; tự khoá chat tạm khi 3 người báo; người kiểm duyệt buổi tối. |
| 9 | **Thành phố đổi liên tục (Đợt 3)** làm vị trí quán, nhiệm vụ, chỗ đứng của người chơi bị lệch | Trung bình | Mã cửa hàng ổn định theo vị trí + tên kèm bảng ánh xạ khi sinh lại; máy chủ và trò chơi phát hành cùng phiên bản; tự dời người chơi ra chỗ trống; bộ kiểm tra nhiệm vụ chạy mỗi lần sinh lại thành phố. |
| 10 | **Chi phí Cloudflare** khi lưu lượng game lớn (hàng chục TB/tháng) có thể buộc lên gói Business ($250) | Thấp–TB | Đã tính trong bảng 3.000+; đo lượng thật; có thể cho cổng game đi thẳng, chỉ trang web qua Cloudflare. |
| 11 | Thư viện kết nối uWebSockets.js ít người bảo trì | Thấp | Bọc sau một lớp riêng; có bản thay thế `ws` dùng ngay. |
| 12 | Máy của chủ dự án **sập màn xanh khi mở nhiều Chrome 3D** | Thấp | Thử tải chỉ bằng bot không đồ hoạ; tối đa 1 trình duyệt thật mỗi lần (khoá `gpulock`). |

---

## 8. Câu hỏi cần chủ dự án trả lời (5 câu)

1. **Mục tiêu phát hành:** giữ ở mức **thử nghiệm kín, phi thương mại** trong năm đầu, hay muốn **mở công khai tại Việt Nam** (cần pháp nhân, giấy phép G1, xác thực số điện thoại, có thể đổi cách đăng nhập)? Có đồng ý chi tiền tư vấn luật sư ở Giai đoạn 0 không?
2. **Ngân sách tháng tối đa** cho máy chủ: đề xuất 1 triệu đồng/tháng tới hết Giai đoạn 1, khoảng 9 triệu/tháng (mức Khuyến nghị 1.000 người) **chỉ trong các đợt beta đông người**. Có trần nào anh muốn đặt không?
3. **Chat cho khách và trẻ em:** chỉ cho chat nhanh/biểu cảm (an toàn, đề xuất), hay mở chat gõ tự do cho khách sau 10 phút chơi?
4. **Người vận hành:** ai nhận cảnh báo khi máy chủ sập buổi tối, và ai làm kiểm duyệt chat khi có từ khoảng 300 người online? Có mời sử gia hoặc Bảo tàng Hải Phòng duyệt tuyến lịch sử không?
5. **Kéo người chơi:** có kế hoạch nào (trường học, cộng đồng người Hải Phòng, ra mắt dịp 13/5 hoặc Lễ hội Hoa Phượng Đỏ) và mốc thời gian không? Câu trả lời quyết định khi nào thuê máy lớn và khi nào cần Giai đoạn 6.


**Trả lời của chủ dự án (14/10/2026):**
1. Chỉ **thử nghiệm kín, phi thương mại** → chưa thuê luật sư; giữ chế độ **chỉ vào bằng mã mời**; xem lại pháp lý trước khi mở công khai.
2. Khởi động với **1 triệu đ/tháng** là hợp lý → giai đoạn thử nghiệm chạy máy chủ trên máy của chủ dự án (mục 2b), chi phí gần như 0.
3. **Chat gõ tự do nhưng kiểm soát chặt chẽ** (xem quyết định số 10).
4. **Người vận hành là chủ dự án**: cảnh báo (Telegram, tuỳ chọn) và trang quản trị đều cho chủ dự án; trang quản trị chạy trên chính máy chủ.
5. Kế hoạch kéo người chơi: **chủ dự án đã có**.

Các điểm còn lại đã chọn mặc định, đổi được sau mà không ảnh hưởng kiến trúc: ngày game giữ 24 phút thật; giá đồ ăn gần giá thật (bát phở 45.000₫), thu nhập nén gấp 3–5 lần đời thực; bão dùng tên hư cấu "bão số N"; chỉ số đóng băng khi offline; không PvP; không "lớp" chia người ở điểm nóng trừ khi anh đồng ý.

---

## Phụ lục A — Kết quả phản biện hai bản nháp (đã sửa trong kế hoạch này)

**Sai giả định**
- Coi 1.000 người online là việc kỹ thuật. Thực tế cần khoảng 10.000–20.000 người chơi mỗi ngày. Đã thêm rủi ro số 2, câu hỏi số 5, và nguyên tắc "chỉ thuê máy lớn khi có người".
- Băng thông lập kế hoạch 3 KB/s/người tính theo mật độ đều (khoảng 19 người trong tầm nhìn). Người chơi thực tế dồn về bờ hồ, Nhà hát lớn nên nên lấy 5 KB/s. Chi phí gần như không đổi vì băng thông kèm máy còn dư, nhưng mức "căng" trong bảng phải giữ.
- Đo độ trễ chỉ đi thẳng. Cloudflare có thể đưa nhà mạng Việt Nam qua Hồng Kông rồi mới tới Singapore, nên phải đo cả hai đường.
- Giới hạn kết nối theo IP (50/IP) có thể chặn nhầm người dùng 4G vì nhà mạng cho hàng nghìn máy chung một IP. Giới hạn chính phải theo thiết bị/tài khoản.

**Thiếu**
- Đăng nhập trên điện thoại: Google chặn trong trình duyệt Zalo/Facebook; iPhone xoá dữ liệu khách sau 7 ngày. Đã thêm mã khôi phục và phát hiện trình duyệt trong ứng dụng.
- Mini-game ra tiền nhưng chưa được máy chủ chấm. Đã thêm.
- NPC có ảnh hưởng gameplay (khách xe ôm, đoàn du khách, khách hàng rong) chưa có trong ngân sách tầm nhìn/CPU. Đã thêm.
- Thành phố được sinh lại liên tục, nhưng chưa có cách xử lý dữ liệu cũ: mã cửa hàng đổi, người chơi kẹt trong nhà mới, phiên bản trò chơi lệch máy chủ. Đã thêm quy trình phát hành và dời vị trí.
- Chưa có chế độ chơi khi máy chủ sập. Đã thêm chế độ "Khám phá".
- Người chơi khác vẽ bằng mẫu người đi đường nên trông giống NPC. Đã thêm dấu hiệu phân biệt.
- Chưa thử trên điện thoại thật, chưa có buổi chơi thử với người thật. Đã thêm vào nghiệm thu GĐ 0–1.
- Chưa tính chi phí ngoài máy (luật sư, kiểm duyệt, duyệt lịch sử). Đã thêm 6.3.
- Bản nháp kỹ thuật cho dùng SQLite/tệp ở GĐ 1 rồi chuyển Postgres sau, tức chuyển dữ liệu thừa. Đã chốt Postgres từ đầu.

**Hai bản nháp mâu thuẫn nhau**
- Số chỉ số và cách gửi: bản kỹ thuật có 5 chỉ số, gửi tin riêng ≤ 1 Hz; bản lối chơi có 7 chỉ số + độ ướt, gửi trong gói vị trí 2 Hz. Chốt: 1 tin chỉ số ≤ 1 Hz, mở rộng theo giai đoạn (mục 4).
- Thể lực đổi theo giây, trong khi bản kỹ thuật tính "lười" và kiểm 1 Hz. Chốt: hai bên tính cùng công thức, cho lệch ±10.
- Thời tiết: bản kỹ thuật lập lịch 2–6 giờ, báo bão trước 10 phút game; bản lối chơi đổi mỗi 20–40 phút, báo bão trước 24 giờ thật. Chốt: thời tiết thường theo chuỗi mùa, bão là sự kiện có lịch.
- Thứ tự: bản lối chơi làm nhiệm vụ ở G2 (trước thời tiết); bản kỹ thuật để nhiệm vụ ở P4 cùng việc chia nhiều máy. Chốt lộ trình mục 5: nhiệm vụ ở GĐ 4, tách khỏi việc chia máy.
- Chat cho khách: bản kỹ thuật "10 phút đầu chỉ chat nhanh"; bản lối chơi "khách luôn chỉ chat nhanh". Đưa vào câu hỏi số 3.
- Đua xe "Rally" có xếp hạng trong bản lối chơi, trong khi bản kỹ thuật nói đua có thưởng thì cần máy chủ mô phỏng di chuyển. Chốt: hoãn đua có xếp hạng.
- Bão "tự đưa nhân vật chạy vào chỗ trú" cần máy chủ điều khiển di chuyển, mô hình "đi trước, kiểm sau" không có. Chốt: chỉ cảnh báo, máu không xuống dưới 10.
- Số biển hiệu (954 và 1.154) và số điểm xuất hiện (8 và 6): để công cụ đếm và chốt.

**Ôm quá nhiều**
- Bản kỹ thuật dồn cả 6 nghề + thời tiết + bão + chống xuyên tường vào 6–8 tuần (P3). Đã chia lại: 2 nghề ở GĐ 3, 2 nghề ở GĐ 4, phần còn lại ở GĐ 5.
- Chia nhiều máy (3.000–10.000 người) gộp chung với nhiệm vụ ở P4. Đã tách thành GĐ 6, chỉ làm khi đủ điều kiện.
- Bản lối chơi có 7 chỉ số, 6 nghề có mini-game, bằng lái, 12 điểm giao thông, uy tín, cấp công dân, cảnh "Ký ức" đổi thời kỳ, sạp chợ đêm, Quỹ thành phố. Bản đầu giữ 4 chỉ số + 2 nghề. Phần còn lại vào GĐ 5, có mục "để sau cùng hoặc bỏ".

## Phụ lục B — Tài liệu chi tiết

`ARCH.md` (giao thức, máy chủ, bảo mật, kế hoạch thử tải), `GAMEDESIGN.md` (bảng số chỉ số, món ăn, nghề, mẫu nhiệm vụ, `balance.json`), `research_backends.md`, `research_hosting.md`, `research_netcode.md`, `codebase_hooks.md`. Tất cả cùng thư mục với tài liệu này.
