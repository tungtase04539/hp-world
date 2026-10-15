// server/bots/lib/phrases.mjs — chat lines for the bots.
// CLEAN: ordinary friendly Vietnamese chat (must always be delivered; a rejection = filter false positive).
// ABUSE: lines the server MUST block or mask (abuse scenario only): links, phone numbers, social handles, scams,
// teencode insults and evasion tricks. Test data only — no real numbers, handles or brand names.
export const CLEAN = [
  'chào mọi người', 'xin chào cả nhà', 'hôm nay trời đẹp quá', 'đi ăn bánh đa cua không', 'ai ra quảng trường không',
  'mình mới vào game', 'đường này đi đâu vậy', 'chợ Sắt ở hướng nào nhỉ', 'cho mình hỏi đường ra ga với', 'đẹp thật đấy',
  'tối nay đi dạo hồ Tam Bạc nhé', 'nhà hát lớn đẹp ghê', 'ok bạn', 'cảm ơn bạn nhiều', 'hẹn gặp lại', 'đi chậm thôi',
  'mưa to quá', 'xe máy đi nhanh thật', 'mình ở gần bưu điện', 'có ai chơi cùng không', 'lạc đường rồi', 'haha vui quá',
  'đợi mình chút', 'đi thẳng rồi rẽ trái', 'phố Lạch Tray đông người ghê', 'chùa Hàng ở đâu nhỉ', 'trưa nay ăn gì',
  'bánh mì cay ngon lắm', 'cà phê sáng không', 'mai gặp nhé', 'bạn ở Hải Phòng à', 'đẹp như thật luôn', 'ngủ ngon nhé',
  'chạy nhanh lên', 'chờ đèn đỏ đã', 'trời nắng quá', 'đi bộ cho khoẻ', 'đường ven sông mát lắm', 'nhìn kìa', 'tuyệt vời',
  'thử nhảy xem', 'ai biết chơi thế nào không', 'bấm phím gì để chạy vậy', 'mình đi trước nhé', 'chiều nay mát trời',
];

// Every line here must be rejected (EVENT CHAT_REJECTED) or masked before other players see it.
export const ABUSE = [
  'vao trang abcxyz.com nhan qua', 'link: http://example-phish.net/free', 'web abc chấm com nhé', 'x y z a b c . c o m',
  'goi minh 0912 345 678', 'sdt 0 9 8 7 6 5 4 3 2 1', 'không chín một hai ba bốn năm sáu bảy tám', 'zalo 0901234567',
  'add fb: nguyenvana123', 'tele @abc_xyz_99', 'ib ig minhxinh2009', 'tiktok @fakehandle', 'nạp thẻ x2 giá rẻ',
  'bán acc vip giá rẻ ib', 'chuyển khoản trước mình gửi đồ', 'cho số tài khoản đi', 'dm may', 'đ.m thằng kia', 'vcl luôn',
  'đ m m', 'd!t me', 'cl gt', 'v l', 'đ​m', 'ngu nhu cho', 'c.c', 'clgt', 'đmmmmm', 'ĐM', 'óc chó',
];
export const FLAG = ['bạn bao nhiêu tuổi', 'nhà bạn ở đâu', 'bạn học trường nào', 'gửi ảnh cho mình xem'];

export const NICKS = ['Lan', 'Minh', 'Hoa', 'Tuan', 'Mai', 'Nam', 'Linh', 'Quang', 'Thu', 'Duc', 'Ha', 'Phuong', 'Son', 'Trang', 'Long', 'Vy'];
