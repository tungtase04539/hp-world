# Danh sách lọc chat — chủ dự án được sửa (máy chủ nạp lại không cần khởi động: trang quản trị → "Bộ lọc" → "Nạp lại")
#
# Mỗi tệp một nhóm, mỗi dòng một mẫu. Dòng bắt đầu bằng # là ghi chú.
#
#   profanity.txt  từ tục nặng            → CHẶN tin
#   mild.txt       chửi nhẹ               → CHE bằng *** rồi vẫn gửi
#   sexual.txt     nội dung tình dục      → CHẶN
#   hate.txt       miệt thị, đe doạ       → CHẶN + đưa vào hàng chờ cho chủ dự án xem
#   scam.txt       lừa đảo, mua bán tiền  → CHẶN + hàng chờ
#   probe.txt      dò hỏi thông tin riêng → VẪN GỬI nhưng đưa vào hàng chờ
#   selfharm.txt   tự hại                 → VẪN GỬI, hàng chờ, và gửi cho người chơi lời nhắn đường dây hỗ trợ
#   allow.txt      cụm từ vô hại hay bị bắt nhầm (một mẫu bị bắt nằm GỌN trong cụm này thì bỏ qua)
#   ambiguous.txt  từ vô hại viết có dấu mà khi bỏ dấu trùng với từ tục (vd "các" ~ "cặc", "buổi" ~ "buồi")
#   reserved.txt   tên nhân vật cấm dùng (giả danh quản trị)
#
# Cú pháp một mẫu:
#   - các từ cách nhau bằng dấu cách: "địt mẹ"
#   - viết CÓ DẤU khi bản không dấu là một từ bình thường ("cặc", "lồn"): bộ lọc chỉ bắt bản không dấu "cac" khi nó
#     nằm trong cụm nhiều từ, khi bị viết lách (c4c, c.a.c, c a c, c*c), hoặc khi cả câu gõ có dấu mà riêng từ này
#     bị bỏ dấu.
#   - viết KHÔNG DẤU cho chữ tắt / teencode không trùng từ thường ("dm", "vcl"): bắt mọi kiểu dấu.
#   - a/b/c = một trong các từ;  _ = đúng một từ bất kỳ;  ~ = 0 đến 2 từ bất kỳ.
#   - dấu * ở đầu một mẫu một-từ không dấu = bắt cả khi dính liền trong từ dài hơn ("*ditme" bắt "ditmemay").
#   - "| mask" / "| block" / "| flag" / "| blockflag" / "| pass" ở cuối dòng = đổi hành động mặc định của tệp.
#
# Bộ lọc tự xử lý: chữ hoa/thường, bỏ dấu, chữ lặp (điiiit), chữ cách quãng (đ m, d i t), dấu chen (đ.m, d-i-t),
# số/ký hiệu thay chữ (l0n, đ!t, c@c), ký tự vô hình, chữ Kirin/Hy Lạp giả chữ Latin, chữ toàn khổ.
# Link, số điện thoại, tài khoản mạng xã hội được chặn bằng mã (không cần danh sách).
#
# Sửa xong: bấm "Nạp lại" trên trang quản trị, rồi chạy `npm test` trong server/ để chắc không bắt nhầm câu thường
# (test dùng server/test/fixtures/chat_ok.txt và chat_bad.txt). Cập nhật bản nhúng cho trình duyệt:
# `node server/scripts/filter_sync.mjs`.
