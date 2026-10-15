# Sổ tay vận hành máy chủ game Hải Phòng 3D

Dành cho anh (chủ dự án) — không cần biết lập trình. Mỗi việc là vài bước bấm chuột hoặc dán một dòng lệnh.
Giai đoạn thử nghiệm kín, máy chủ chạy **ngay trên máy tính này**. Người chơi vào qua **Cloudflare Tunnel**:
một "đường hầm" bảo mật đi từ máy anh ra Internet. Không cần mở cổng modem, và người ngoài không biết địa chỉ IP nhà anh.

> Ghi chú kỹ thuật cho lập trình viên: `docs/multiplayer/SERVER.md` (mục S5).

---

## 0. Tóm tắt: các "nút bấm"

Mọi script nằm trong thư mục `server\ops\` của dự án. Cách chạy: **nhấp chuột phải vào file → "Run with PowerShell"**.
Hoặc mở PowerShell trong thư mục dự án rồi dán dòng lệnh ở cột thứ hai. Chạy bằng nhấp chuột phải thì khi xong, cửa sổ
**dừng lại chờ anh nhấn Enter** để anh đọc được kết quả (trạng thái, lỗi, mã mời) rồi mới đóng.

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Mở máy chủ | `powershell -ExecutionPolicy Bypass -File server\ops\mo-may-chu.ps1` | Tự bật Docker, giữ máy thức, bật tunnel tên miền (nếu đã cài), mở trang quản trị |
| Mở máy chủ, thử nhanh qua Internet | `... mo-may-chu.ps1 -TamThoi` | Địa chỉ tạm `*.trycloudflare.com`, mỗi lần bật lại đổi địa chỉ |
| Tắt máy chủ | `... tat-may-chu.ps1` | Dừng hết trong khoảng 10 giây. Dữ liệu người chơi vẫn còn nguyên |
| Xem tình trạng | `... trang-thai.ps1` | Số người chơi, bản sao lưu gần nhất, cổng đang mở có an toàn không |
| NGẮT KHẨN CẤP | `... khoa-khan-cap.ps1` | Cắt đường vào từ Internet ngay lập tức. Dữ liệu vẫn giữ |
| Tạo mã mời | `... tao-ma-moi.ps1 -SoLuong 10` | In ra 10 mã. Mỗi mã dùng cho một người |
| Sao lưu ngay | `... sao-luu.ps1` | Máy chủ vẫn tự sao lưu mỗi đêm lúc 3 giờ 15 |
| Diễn tập khôi phục | `... khoi-phuc.ps1` | Kiểm tra bản sao lưu dùng được không, không đụng dữ liệu thật |
| Cài lịch sao lưu của Windows | `... cai-lich.ps1` | Chỉ cần chạy một lần (không bắt buộc) |

(`...` = `powershell -ExecutionPolicy Bypass -File server\ops\`)

Trang quản trị: **http://127.0.0.1:9101/admin**. Trang này chỉ mở được trên chính máy này. Mã đăng nhập là dòng
`ADMIN_TOKEN=` trong file `server\.env`.

---

## 1. Chuẩn bị (chỉ làm một lần)

1. **Docker Desktop**: mở Docker Desktop → Settings → General → bật "Start Docker Desktop when you sign in".
   Máy đã cài Docker sẵn.
2. **Node.js 24**: máy đã có. Node chỉ dùng một lần để tạo khoá bí mật.
3. **Nguồn điện**: khi mở máy chủ thì **luôn cắm sạc**. Vào Cài đặt → Hệ thống → Nguồn → "Khi đóng nắp máy (đang cắm
   sạc)" → chọn **Không làm gì**. Script tự giữ máy không ngủ, nhưng không chặn được việc ngủ khi anh gập nắp máy.
4. **Windows Update**: xem mục 9.
5. Lần đầu chạy `mo-may-chu.ps1`, script tự tạo file **`server\.env`**. File này chứa khoá bí mật: mã quản trị, mật khẩu
   cơ sở dữ liệu, khoá ký vé, "muối" của mã khôi phục. **Không gửi file này cho ai, không đưa lên mạng.**
   **Phải chép một bản vào USB và cất riêng.** Mất file này thì: người chơi phải đăng nhập lại; **mọi mã khôi phục cũ hết
   dùng được** (dòng `RECOVERY_PEPPER`); và mật khẩu cơ sở dữ liệu mới sinh ra không khớp dữ liệu cũ nên máy chủ không mở
   được — khi đó chép lại file `.env` từ USB. (Không có bản USB: nhờ lập trình viên đặt lại mật khẩu bằng
   `docker compose -p hpworld -f server\docker-compose.yml exec db psql -U hp -d hp -c "ALTER USER hp PASSWORD '<DB_PASSWORD mới>'"`.)

---

## 2. Mở máy chủ

1. Chạy `mo-may-chu.ps1` (nhấp phải → Run with PowerShell).
2. Script lần lượt làm 6 bước và ghi **[OK]** cho từng bước. Lần đầu mất vài phút vì phải dựng máy chủ. Những lần sau mất
   khoảng 10–30 giây.
3. Xong, script in:
   - **Trang quản trị**: `http://127.0.0.1:9101/admin`. Script tự mở trang này.
   - **ĐỊA CHỈ MÁY CHỦ CHO NGƯỜI CHƠI**: chỉ hiện khi đã bật tunnel. Đó là `wss://game.ten-mien-cua-anh.vn` khi đã cài tên
     miền (mục 7), hoặc `wss://...trycloudflare.com` khi dùng `-TamThoi`.
4. Nhấn Enter để đóng cửa sổ; máy chủ vẫn chạy nền.

Khi máy chủ đang mở, script báo cho các công cụ kiểm tra đồ hoạ biết để chúng **chờ** (xem mục 10).

## 3. Tắt máy chủ

Chạy `tat-may-chu.ps1`. Script làm 3 việc:
- Ngắt tunnel trước, rồi dừng game và cơ sở dữ liệu. Game lưu vị trí người chơi trước khi dừng.
- Trả máy về chế độ ngủ bình thường, và cho phép công cụ đồ hoạ chạy lại.
- Kiểm tra không còn cổng nào của máy chủ đang mở, rồi báo thời gian tắt (mục tiêu là 10 giây trở xuống).

Dữ liệu (tài khoản, nhân vật, báo cáo) **được giữ nguyên**. Lần mở sau mọi thứ vẫn còn.

## 4. Xem tình trạng

Chạy `trang-thai.ps1`. Kết quả gồm:
- Từng phần (game, cơ sở dữ liệu, sao lưu, tunnel) đang chạy hay không.
- Số người đang chơi và máy chủ đã chạy được bao lâu.
- Bản sao lưu gần nhất và cách đây bao lâu. Nếu quá 1 ngày, script báo **[CHÚ Ý]**.
- Ổ đĩa còn trống bao nhiêu.
- **AN TOÀN**: cổng nào đang mở ở địa chỉ nào. Mọi dòng phải là `127.0.0.1 (chỉ máy này)`. Thấy dòng **[LỖI] ... NGƯỜI KHÁC
  TRONG MẠNG CÓ THỂ VÀO** thì chạy `tat-may-chu.ps1` ngay và báo lập trình viên.

Trang quản trị có thêm số liệu trực tiếp: số người, độ trễ máy chủ, bản đồ người chơi, khung chat.

## 5. Mã mời (thử nghiệm kín)

Người chơi phải có **mã mời** mới tạo được tài khoản.
- Tạo bằng script: `tao-ma-moi.ps1 -SoLuong 10`. Có thể thêm `-SoLanDung 1` (mỗi mã dùng mấy lần), `-SoNgay 14` (bao lâu thì
  hết hạn) và `-GhiChu "lop 12A"` (để nhớ đã phát cho ai). Danh sách mã hiện trên màn hình và được lưu trong
  `server\data\ma-moi\`.
- Hoặc tạo trên trang quản trị bằng nút **Tạo mã mời**.
- **Gửi riêng từng mã cho từng người.** Không đăng mã lên nhóm công khai.

## 6. Báo cáo và khoá chat

Người chơi chat tự do trong bán kính 40 m. Bộ lọc tự chặn: chửi tục, số điện thoại, đường link, tài khoản mạng xã hội,
lừa nạp thẻ hoặc bán tài khoản. Bộ lọc cũng **đánh dấu** các câu hỏi dò thông tin cá nhân (tuổi, nhà ở đâu, trường nào,
xin ảnh) để anh xem.

Trên trang quản trị (`http://127.0.0.1:9101/admin`):
- **Báo cáo**: mỗi báo cáo kèm 20 dòng chat xung quanh, do máy chủ tự ghi nên người báo cáo không sửa được. Các nút:
  - **Khoá chat** 10 phút / 1 giờ / 24 giờ / vĩnh viễn.
  - **Ẩn tin**: người đó vẫn thấy tin mình gửi nhưng không ai khác thấy. Dùng cho người tái phạm.
  - **Đuổi**: ngắt kết nối ngay.
  - **Cấm**: cấm vào game, có ngày hết hạn.
  - **Bỏ qua**: báo cáo sai.
  - **Nhắc nhở**: người chơi nhận một lời nhắc, không bị khoá.
- **Tự khoá vì bị báo cáo** (đã siết lại 15/10 để vài tài khoản "hùa nhau" không khoá oan được người khác): cần **3 người
  khác nhau** báo cáo cùng một người trong 10 phút, VÀ mỗi báo cáo phải có **bằng chứng** (người bị báo cáo đã thật sự nói
  gì đó gần người báo cáo trong 10 phút qua), VÀ tài khoản báo cáo phải **cũ hơn 1 ngày, đã chơi ít nhất 30 phút**, VÀ đến
  từ **3 mạng Internet khác nhau**. Đủ thì khoá chat 10 phút; tái phạm 1 giờ, rồi 24 giờ — **báo cáo không bao giờ tự đẩy
  lên "ẩn tin"**, việc đó chỉ anh hoặc bộ lọc quyết. Báo cáo không đủ điều kiện **vẫn vào hàng chờ** cho anh xem (có nhãn
  "không tính tự khoá"). Bấm **Bỏ qua** một báo cáo thì khoá tự động do nó gây ra cũng được gỡ.
- Gửi liên tiếp nhiều câu bị chặn cũng bị tự khoá (10 phút → 1 giờ → 24 giờ → ẩn tin 7 ngày). Câu có ý **tự hại** thì
  không bao giờ bị tính lỗi, kể cả khi có chữ tục: người chơi luôn nhận lời nhắn đường dây hỗ trợ.
- **An toàn trẻ em — xem trước tiên**: các cờ "tự hại" và "dò hỏi thông tin cá nhân" (tuổi, nhà, trường, ảnh, ở nhà một
  mình…) luôn nằm **đầu danh sách** báo cáo với nhãn đỏ. Một người hỏi nhiều câu như vậy liên tiếp thì các câu được **gộp
  vào cùng một báo cáo** (nhãn "N lần bị đánh dấu"), và từ câu thứ 2 Telegram báo ngay cho anh. Xử phạt một người vì lý do
  khác (ví dụ chửi bậy) **không** đóng các cờ an toàn này — anh phải tự xem và đóng.
- Người bị **cấm** có hạn (ví dụ 1 ngày) bị ngắt ngay và không vào lại được tới khi hết hạn. Cấm vĩnh viễn khoá luôn tài
  khoản. Gỡ xử phạt: tab **Người chơi** → mở người đó → nút **Gỡ**.
  Muốn **rút ngắn** một khoá đang có (ví dụ khoá tự động 24 giờ → 10 phút): bấm **Gỡ** trước rồi khoá lại; khoá mới
  ngắn hơn không thay được khoá dài đang chạy. **Cấm** và **Ẩn tin** bắt buộc nhập số ngày (0 = vĩnh viễn, trang hỏi lại).
- **Khung chat trực tiếp**: các dòng bị đánh dấu được tô màu.
- **Thông báo**: gửi một dòng cho mọi người, ví dụ "Máy chủ bảo trì sau 5 phút". Nút **Báo khởi động lại** hiện đồng
  hồ đếm ngược cho mọi người chơi.
- **Bộ lọc chat**: thử một câu xem bị chặn hay không; sửa từng danh sách từ rồi bấm Lưu. Bản sửa được giữ lại cả khi tắt
  mở máy chủ (nằm trong ổ dữ liệu riêng của Docker, không phải thư mục của anh).
- Mọi thao tác của anh đều được ghi vào nhật ký quản trị.

**Cảnh báo qua Telegram** (không bắt buộc): khi có báo cáo mới, ai đó bị tự khoá, máy chủ khởi động lại, máy chủ quá tải
hoặc sao lưu lỗi, Telegram báo về điện thoại anh. Cách cài:
1. Trên Telegram, nhắn cho tài khoản tạo bot chính thức của Telegram (tên là "BotFather") lệnh `/newbot`. Làm theo hướng
   dẫn, cuối cùng bạn sẽ nhận một chuỗi token.
2. Nhắn một tin bất kỳ cho bot vừa tạo. Sau đó mở `https://api.telegram.org/bot<TOKEN>/getUpdates` trong trình duyệt và tìm
   số `"chat":{"id": ...}`.
3. Mở `server\.env` bằng Notepad. Điền `TELEGRAM_BOT_TOKEN=<token>` và `TELEGRAM_CHAT_ID=<số id>`. Lưu, tắt rồi mở lại
   máy chủ.

## 7. Đường vào từ Internet: tunnel tạm và tên miền riêng

### 7a. Tunnel tạm (thử nhanh, không cần tên miền)
`mo-may-chu.ps1 -TamThoi` → script in địa chỉ dạng `wss://ab-cd-ef.trycloudflare.com`.
- Địa chỉ mới cần khoảng **1 phút** để có hiệu lực trên Internet; script tự đợi (tối đa 90 giây) rồi mới in. Nếu chính máy
  này vẫn báo "không tìm thấy" địa chỉ, đợi thêm 1–2 phút (modem nhà nhớ tạm kết quả cũ) — người chơi ở mạng khác vẫn vào
  được ngay.
- Địa chỉ này **đổi mỗi lần bật lại**, nên chỉ dùng để thử với vài người. Không đăng địa chỉ này công khai.
- Để đo mạng, gửi cho người thử đường link
  `https://tungtase04539.github.io/hp-world/netprobe.html?s=wss://ab-cd-ef.trycloudflare.com` (thay đúng địa chỉ).

### 7b. Tên miền riêng (dùng lâu dài) — làm một lần, khoảng 30–60 phút
1. **Mua tên miền** ở một nhà đăng ký tên miền, khoảng 300.000 đ/năm. Ví dụ `haiphong3d.vn` hoặc một tên `.com`.
2. **Đưa tên miền lên Cloudflare** (miễn phí):
   1. Tạo tài khoản ở `dash.cloudflare.com` → **Add a domain** → nhập tên miền → chọn gói **Free**.
   2. Cloudflare đưa 2 địa chỉ "nameserver". Vào trang quản lý tên miền ở nơi đã mua, thay nameserver bằng 2 địa chỉ đó.
   3. Chờ vài phút đến vài giờ, tới khi Cloudflare báo tên miền **Active**.
3. **Tạo tunnel bằng dòng lệnh** trên máy này. Mở PowerShell rồi dán lần lượt từng dòng (thay `haiphong3d.vn` bằng tên
   miền của anh):
   ```
   cd "C:\Program Files (x86)\cloudflared"
   .\cloudflared.exe tunnel login
   .\cloudflared.exe tunnel create hpworld
   .\cloudflared.exe tunnel route dns hpworld game.haiphong3d.vn
   .\cloudflared.exe tunnel token hpworld
   ```
   - Lệnh `login` mở trình duyệt. Chọn tên miền rồi bấm **Authorize**.
   - Lệnh cuối in ra **một chuỗi rất dài**. Đó là "chìa khoá tunnel". Chọn và sao chép cả chuỗi.
4. **Điền vào `server\.env`** (mở bằng Notepad):
   ```
   TUNNEL_TOKEN=<dán chuỗi dài vừa sao chép>
   PUBLIC_WS_URL=wss://game.haiphong3d.vn/play
   PUBLIC_HTTP_URL=https://game.haiphong3d.vn
   ```
   Lưu file. **Không gửi chuỗi TUNNEL_TOKEN cho ai.** Ai có chuỗi này đều có thể giả làm máy chủ của anh.
5. Chạy `tat-may-chu.ps1` rồi `mo-may-chu.ps1`. Lần này script tự bật **tunnel tên miền** (bước 5/6 báo [OK]).
6. **Kiểm tra** bằng điện thoại, tắt Wi-Fi để dùng 4G:
   - Mở `https://game.haiphong3d.vn/healthz`. Phải thấy dòng có `"ok":true`.
   - Mở `https://game.haiphong3d.vn/admin`. Phải là **lỗi 404**. Trang quản trị không bao giờ đi qua tunnel.
7. Gửi địa chỉ `wss://game.haiphong3d.vn` cho lập trình viên để đặt vào game. Trang đo mạng dùng
   `netprobe.html?s=wss://game.haiphong3d.vn`.

Lưu ý:
- Tunnel phải tạo **bằng dòng lệnh như trên**, không tạo trên trang web Cloudflare. Tunnel tạo trên web bỏ qua luật bảo vệ
  của dự án (chỉ cho 4 đường vào game).
- Thư mục `C:\Users\<tên anh>\.cloudflared\` chứa giấy phép quản lý tunnel. Giữ kín như `server\.env`.
- Không cần mở cổng trên modem. **Đừng bao giờ mở** (không "port forwarding", không "DMZ").

## 8. Sao lưu và khôi phục

- **Tự động**: khi máy chủ mở, mỗi đêm lúc **3 giờ 15** (giờ Việt Nam) máy chủ tự sao lưu vào `server\data\backups\`.
  Các bản cũ hơn 14 ngày tự bị xoá, nên ổ đĩa không bị đầy.
- **Sao lưu ngay**: `sao-luu.ps1`. Nên chạy trước khi cập nhật game hoặc trước khi làm việc gì lớn.
- **Thêm một bản ở nơi khác** (nên làm): mở `server\.env` và thêm dòng `BACKUP_COPY_DIR=E:\SaoLuuHaiPhong3D` (ổ USB hoặc
  ổ khác của anh). Từ đó mỗi lần sao lưu, script chép thêm một bản sang đó.
  **Bản sao lưu chứa chat 30 ngày, báo cáo và tài khoản của người chơi — nhiều em còn nhỏ.** Không đặt nó trong thư mục
  đám mây có chia sẻ (OneDrive/Google Drive dùng chung), không gửi cho ai. Script cảnh báo nếu thư mục chép trông giống
  thư mục đám mây. (Mã khôi phục trong bản sao lưu đã được "muối" bằng khoá trong `.env`, nên riêng bản sao lưu không đủ để
  chiếm tài khoản — nhưng chat thì đọc được.)
- **Lịch của Windows** (lớp thứ hai, không bắt buộc): chạy `cai-lich.ps1` một lần. Windows sẽ chạy `sao-luu.ps1` lúc
  3 giờ 30 mỗi đêm. Gỡ lịch: `cai-lich.ps1 -Go`.
- Sao lưu lỗi: `trang-thai.ps1` báo **[LỖI]**, và Telegram báo về điện thoại nếu đã cài.

**Diễn tập khôi phục** (nên làm mỗi tháng một lần): chạy `khoi-phuc.ps1`. Script nạp bản sao lưu mới nhất vào một bản
**nháp** riêng, đếm dữ liệu, so với dữ liệu thật rồi xoá bản nháp. Dữ liệu thật không bị đụng tới. Kết quả phải là
"DIỄN TẬP THÀNH CÔNG".

**Khôi phục thật** (khi dữ liệu hỏng hoặc bị xoá nhầm): `khoi-phuc.ps1 -KhoiPhucThat`. Có thể thêm
`-TepSaoLuu "server\data\backups\hp-...dump"` để chọn bản cụ thể.
- Script hỏi lại. Anh phải gõ **DONG Y** thì script mới chạy tiếp.
- Script **tự sao lưu dữ liệu hiện tại trước**, để quay lại được nếu chọn nhầm bản.
- Người chơi bị ngắt khoảng nửa phút. Tiến độ chơi sau thời điểm của bản sao lưu sẽ mất. **Tài khoản tạo sau thời điểm
  của bản sao lưu cũng mất**: những người đó cần mã mời mới. Việc khôi phục thật không nằm trong nhật ký quản trị —
  anh tự ghi lại ngày giờ đã khôi phục.

**Dữ liệu giữ bao lâu:** nhật ký chat 30 ngày (xoá tự động mỗi 6 giờ). Báo cáo đã xử lý / đã bỏ qua: sau 30 ngày bị xoá
phần chat chép kèm (chỉ còn ai báo cáo ai, lý do, cách xử lý); báo cáo đã bỏ qua bị xoá hẳn sau 90 ngày. Báo cáo đang chờ
giữ nguyên tới khi anh xử lý. Lịch sử xử phạt và nhật ký quản trị được giữ (cần để biết ai tái phạm và ai đã làm gì).

## 9. Windows Update: đặt "giờ hoạt động"

Windows có thể tự khởi động lại để cập nhật, làm máy chủ tắt giữa buổi chơi. Cách tránh:
Cài đặt → Windows Update → Tuỳ chọn nâng cao → **Giờ hoạt động** → chọn "Thủ công", ví dụ **8:00 – 23:59**, sao cho bao
trọn giờ chơi thử. Trước buổi chơi lớn, vào Windows Update để cài các bản cập nhật đang chờ và khởi động lại máy sớm.
**Không tắt Windows Update**: nó vá các lỗ hổng bảo mật.

Sau khi máy khởi động lại, **người chơi không vào được** cho tới khi anh chạy lại `mo-may-chu.ps1`: tunnel và cổng
`127.0.0.1` (container "portal") không bao giờ tự bật lại (đã sửa 15/10 — trước đó tunnel tự bật lại mà không có tệp đánh
dấu GPU). Docker có thể tự dựng lại game + cơ sở dữ liệu nếu chúng đang chạy lúc máy tắt đột ngột, nhưng không ai tới
được chúng. `mo-may-chu.ps1` bật lại đủ mọi thứ, ghi tệp đánh dấu và giữ máy thức.

## 10. Không chạy kiểm tra đồ hoạ trong giờ chơi

Máy này từng bị **màn hình xanh** khi chạy nhiều trình duyệt 3D cùng lúc. Màn hình xanh giữa buổi chơi nghĩa là máy chủ
sập. Vì vậy:
- Khi máy chủ mở, `mo-may-chu.ps1` ghi một tệp đánh dấu, và các công cụ kiểm tra đồ hoạ của dự án tự **chờ** tới khi anh
  tắt máy chủ.
- Trong giờ chơi, **anh cũng đừng mở game 3D** trên máy này. Muốn xem, hãy dùng máy khác hoặc điện thoại.
- Không bật biến môi trường `HPWORLD_ALLOW_GPU_WHILE_LIVE`. Biến đó tắt cơ chế chờ này.

## 11. Giữ máy không ngủ

`mo-may-chu.ps1` bật một tiến trình nền nhỏ để máy **không tự ngủ** khi anh không dùng. Màn hình vẫn tự tắt được để tiết
kiệm điện. Khi chạy `tat-may-chu.ps1`, tiến trình này dừng và máy ngủ lại bình thường.
- Muốn tự kiểm tra: mở PowerShell **với quyền quản trị** rồi gõ `powercfg /requests`. Mục **SYSTEM** phải có một dòng
  `powershell.exe`.
- Máy này ngắt mạng khi ngủ. Nếu máy vẫn ngủ thì người chơi bị ngắt. Hãy kiểm tra lại mục 1 (cắm sạc, gập nắp máy).

**Trong giờ chơi đông người (khuyên làm, anh tự chỉnh):** Cài đặt → Hệ thống → Nguồn → Chế độ nguồn: **Hiệu suất tốt
nhất**, và tắt các ứng dụng chạy nền nặng (game, phần mềm điều khiển máy từ xa, phát video). Khi thử tải trên máy này,
máy có những "khựng" ngắn khoảng 1 lần mỗi giây kể cả khi không chạy máy chủ; lúc đông (trên ~800 người) các khựng đó
làm máy chủ tưởng là quá tải và tự giảm chất lượng. Với vài chục người chơi của buổi thử kín thì không ảnh hưởng.

**Màn hình chờ OLED Care của ASUS** (hình động chạy khi anh không dùng máy) tốn khoảng 1,5 lõi CPU suốt lúc nó chạy; khi thử
tải, máy chủ chậm đi rõ rệt trong lúc đó. Đừng tắt hẳn nó (nó bảo vệ màn OLED khỏi bị lưu ảnh). Cách tốt hơn khi để máy làm
máy chủ: Cài đặt → Hệ thống → Nguồn → **Tắt màn hình sau** 5 phút — màn hình tắt hẳn thì vừa bảo vệ màn OLED vừa không tốn CPU.
Đây là cài đặt anh tự chỉnh; các script không đổi cài đặt nào của máy.

**Ô "Trễ vòng lặp" trên trang quản trị** (từ 15/10/2026) là thời gian một tin của người chơi phải chờ trước khi máy chủ xử lý.
Bình thường dưới 5 ms; với vài chục người chơi luôn dưới 15 ms. Trên 50 ms kéo dài nghĩa là máy đang bận việc khác (đóng
bớt chương trình nặng). Trước đây ô này luôn hiện khoảng 16 ms kể cả khi máy rảnh (đó là nhịp đồng hồ của Windows, không
phải máy chủ chậm).

## 12. Đo mạng người chơi (netprobe)

Gửi cho người thử đường link `https://tungtase04539.github.io/hp-world/netprobe.html?s=<địa chỉ máy chủ>`. Người thử
chọn nhà mạng (Viettel / VNPT / FPT / Mobifone / Vinaphone / Khác) và loại mạng (Wi-Fi / 4G / 5G) rồi bấm **Bắt đầu đo**.
Sau khoảng 10 giây, trang hiện độ trễ và tự gửi kết quả về máy chủ. Trang không gửi thông tin cá nhân.
Trang quản trị có bảng tổng hợp theo nhà mạng.
Cách đọc: trung vị dưới 60 ms là **tốt**, 60–120 ms là **được**, trên 120 ms hoặc mất gói trên 5% là **kém**.

---

## 13. An toàn cho máy của anh

Không gì an toàn tuyệt đối, nên máy chủ được bảo vệ bằng **nhiều lớp chồng lên nhau**. Một lớp hỏng thì các lớp khác vẫn
chặn:

1. **Không mở cổng nào ra ngoài.** Máy chủ chỉ nghe ở `127.0.0.1`, tức là chỉ chính máy này. Người khác trong cùng Wi-Fi
   cũng không vào được. Script không sửa tường lửa, không mở cổng modem. `trang-thai.ps1` cho anh kiểm tra điều này bất cứ lúc
   nào.
2. **Chỉ một đường vào từ Internet**: Cloudflare Tunnel. Tunnel chỉ cho đúng 4 loại đường dẫn của game đi qua. Mọi thứ khác,
   kể cả trang quản trị, bị chặn ngay tại Cloudflare. IP nhà anh không lộ. Tấn công làm nghẽn mạng (DDoS) bị Cloudflare chặn
   phần lớn từ xa.
3. **Trang quản trị chỉ mở trên máy này**, cần mã dài 32 byte ngẫu nhiên, và từ chối mọi yêu cầu đến từ phía tunnel.
4. **Máy chủ không với tới được mạng nhà anh** (thêm 15/10): container game chỉ nằm trong các mạng kín của Docker — nó
   không ra được Internet, không thấy modem, không thấy các máy khác trong nhà, không thấy các dịch vụ khác đang chạy trên
   máy anh. Hai cổng `127.0.0.1` và đường gửi Telegram đi qua một container rất nhỏ tên "portal" chỉ chuyển tiếp dữ liệu
   (không đọc nội dung), và đường ra duy nhất của nó là tới máy chủ Telegram.
5. **Máy chủ bị nhốt trong "hộp" Docker**: không có quyền quản trị, không ghi được vào chính nó, không thấy file cá nhân
   của anh (Tài liệu, Ảnh...). Thư mục duy nhất của máy anh mà nó được ghi là `server\data\backups` (ngoài ra là hai ổ dữ
   liệu riêng do Docker quản lý: cơ sở dữ liệu và danh sách lọc chat). Máy chủ bị giới hạn tối đa 4 lõi CPU
   và 2 GB RAM, nên dù bị tấn công cũng không làm treo được cả máy.
6. **Cơ sở dữ liệu nằm trong mạng kín**: không ra được Internet, tunnel cũng không tới được nó.
7. **Khoá bí mật** chỉ nằm trong `server\.env` trên máy này. Khoá không bao giờ được đưa lên GitHub hay vào trong "hộp" Docker.
8. **Ổ đĩa không bị đầy**: nhật ký tự xoay vòng, sao lưu tự xoá bản cũ hơn 14 ngày.
9. **Nút khẩn cấp**: `khoa-khan-cap.ps1` cắt đường vào từ Internet trong 1–2 giây.
10. **Không tự mở lại sau khi khởi động lại máy** (mục 9): đường vào từ Internet chỉ bật khi anh chạy `mo-may-chu.ps1`.

**Anh cần luôn bật:** Windows Update, Windows Defender (Bảo mật Windows) và Tường lửa Windows.

**Đừng bao giờ:**
- Tắt tường lửa, hoặc mở cổng / bật "port forwarding" / "DMZ" trên modem.
- Gửi file `server\.env`, chuỗi `TUNNEL_TOKEN`, hay thư mục `.cloudflared` cho bất kỳ ai, kể cả người tự nhận là hỗ trợ.
- Bật `HPWORLD_ALLOW_GPU_WHILE_LIVE`, hoặc chạy game 3D / kiểm tra đồ hoạ trên máy này khi máy chủ đang mở.
- Chạy script lạ người khác gửi.

**Rủi ro còn lại (nói thật):**
- Một lỗ hổng chưa ai biết trong Docker, WSL2 hoặc cloudflared. Cách giảm rủi ro: luôn cập nhật Docker Desktop và Windows.
- Một cuộc tấn công đủ lớn có thể làm **nghẽn mạng Internet nhà anh** (chậm, rớt mạng). Lúc đó chạy `khoa-khan-cap.ps1`. Máy
  và dữ liệu không bị hại.
- Mất điện hoặc máy hỏng giữa buổi chơi: mất tối đa tiến độ của khoảng 30 giây cuối. Bản sao lưu đêm vẫn còn.
- Một người có nhiều địa chỉ mạng (IPv6) có thể giữ hàng nghìn kết nối "chưa đăng nhập" để làm người khác tạm không vào
  được (mỗi kết nối tự bị cắt sau 10 giây). Đã giới hạn theo dải mạng; nếu thấy trên trang quản trị nhiều người không vào
  được, chạy `khoa-khan-cap.ps1` rồi mở lại sau ít phút.
- Trang quản trị nhận yêu cầu từ container "portal" (đường duy nhất từ `127.0.0.1` của máy anh); vẫn cần mã quản trị.

---

## 14. Khi nào chuyển lên máy chủ thuê (VPS), và chuyển thế nào

**Nên chuyển khi có một trong các dấu hiệu:**
- Cần máy chủ chạy **24/7**, không phụ thuộc máy tính của anh.
- Thường xuyên có **trên khoảng 200–300 người** chơi cùng lúc, hoặc mạng nhà bị nghẽn khi đông người. Băng thông lên cần
  khoảng 8 Mbps cho 200 người và 30–40 Mbps cho 1.000 người.
- Anh cần dùng máy cho việc khác, như chơi game nặng hay chạy đồ hoạ, trong giờ chơi.
- Máy hay mất điện, mất mạng, hoặc Windows hay tự khởi động lại.

**Chi phí**: VPS 2–4 lõi, 4–8 GB RAM, đặt ở Singapore, khoảng 250.000–600.000 đ/tháng. Mức này nằm trong ngân sách
1 triệu đ/tháng. Trước khi chuyển, đo độ trễ tới VPS bằng `netprobe.html` để so với máy nhà.

**Cách chuyển** (khoảng 1 giờ, người chơi bị gián đoạn khoảng 15 phút). Nên nhờ lập trình viên làm cùng lần đầu:
1. Thuê VPS chạy Ubuntu 24.04. Cài Docker theo hướng dẫn chính thức. Chỉ mở cổng SSH; **không mở cổng 9100/9101**.
2. Trên VPS, tải mã dự án về (`git clone`). Chép **file `server/.env`** từ máy này sang bằng `scp`. Không gửi qua chat
   hoặc email.
3. Trên VPS, dựng máy chủ trước nhưng chưa bật tunnel:
   `docker compose -p hpworld -f server/docker-compose.yml up -d --build game db`
4. Trên máy này: chạy `sao-luu.ps1` để có bản mới nhất, rồi **chạy `tat-may-chu.ps1`**. Bước này bắt buộc: nếu hai máy
   cùng chạy một tunnel, người chơi sẽ bị chia sang hai cơ sở dữ liệu khác nhau.
5. Chép bản `server\data\backups\hp-....dump` mới nhất sang VPS rồi khôi phục:
   ```
   docker compose -p hpworld -f server/docker-compose.yml stop game
   docker compose -p hpworld -f server/docker-compose.yml exec -T db psql -U hp -d postgres -c "DROP DATABASE hp WITH (FORCE)" -c "CREATE DATABASE hp OWNER hp"
   docker compose -p hpworld -f server/docker-compose.yml exec -T db pg_restore -U hp -d hp --no-owner < hp-....dump
   docker compose -p hpworld -f server/docker-compose.yml --profile tunnel --profile backup up -d
   ```
6. Tunnel dùng **cùng TUNNEL_TOKEN**, nên tên miền giữ nguyên và người chơi không phải đổi gì. Kiểm tra lại như mục 7b
   bước 6.
7. Giữ máy nhà làm bản dự phòng: có `server\.env` và các bản sao lưu. Muốn quay về máy nhà thì làm ngược lại.

Cùng một cấu hình Docker chạy được cả trên máy nhà lẫn VPS. Không cần viết lại gì.

---

## 15. Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `mo-may-chu.ps1` báo "Docker chưa sẵn sàng" | Mở Docker Desktop, đợi biểu tượng cá voi ở khay đồng hồ đứng yên (1–2 phút), rồi chạy lại |
| Báo "Cần Node.js 24" | Cài Node.js 24 từ nodejs.org. Chỉ cần cho lần đầu |
| "Máy chủ game không trả lời ... sau 150 giây" | Chạy `tat-may-chu.ps1` rồi `mo-may-chu.ps1`. Vẫn lỗi thì mở PowerShell trong thư mục dự án, gõ `docker compose -p hpworld -f server\docker-compose.yml logs game --tail 50` và gửi kết quả cho lập trình viên. Đừng gửi file `.env` |
| Lỗi "port is already allocated" | Có chương trình khác đang dùng cổng 9100/9101, thường là máy chủ cũ chưa tắt. Chạy `tat-may-chu.ps1` rồi mở lại |
| Người chơi không vào được, nhưng `trang-thai.ps1` báo game [OK] | Xem dòng Tunnel. Nếu "không chạy": kiểm tra `TUNNEL_TOKEN` trong `server\.env`, rồi tắt và mở lại. Dùng tunnel tạm thì nhớ địa chỉ đã đổi |
| Trang `https://game.../healthz` báo lỗi 1033 / 530 | Tunnel chưa kết nối. Chạy lại `mo-may-chu.ps1`. Kiểm tra mạng nhà |
| Người chơi giật, lag | Xem trang quản trị: độ trễ máy chủ (tick) và số người. Đóng bớt chương trình nặng trên máy. Kiểm tra tốc độ mạng nhà (cần tốc độ lên đủ, xem mục 14) |
| Máy ngủ, người chơi bị ngắt | Cắm sạc. Chỉnh "Khi đóng nắp máy (đang cắm sạc): Không làm gì". Chạy `trang-thai.ps1` xem "Đang giữ máy không ngủ" |
| `trang-thai.ps1` báo sao lưu lỗi | Chạy `sao-luu.ps1` để xem lỗi. Kiểm tra ổ đĩa còn trống. Báo lập trình viên nếu vẫn lỗi |
| Quên mã quản trị | Mở `server\.env` bằng Notepad, dòng `ADMIN_TOKEN=` |
| Nghi máy bị tấn công / mạng nhà nghẽn | Chạy ngay `khoa-khan-cap.ps1`, rồi báo lập trình viên |
| Công cụ đồ hoạ của lập trình viên "chờ máy chủ tắt" mãi | Máy chủ đang mở là đúng. Tắt máy chủ bằng `tat-may-chu.ps1` khi không còn ai chơi |
