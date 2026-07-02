# Hải Phòng 3D — Thành phố Hoa Phượng Đỏ 🌺

Thế giới 3D tương tác về thành phố Hải Phòng, Việt Nam — chạy ngay trên trình duyệt, không cần cài đặt.
Nhập vai một du khách trẻ khám phá thành phố Cảng: dạo dải trung tâm, qua cầu Hoàng Văn Thụ,
tắm biển Đồ Sơn và giong thuyền ra vịnh Lan Hạ — Cát Bà.

An interactive 3D world of Hai Phong, Vietnam, running entirely in the browser (Three.js, no build step).

## Chơi thử / Run

```bash
# bất kỳ static server nào, ví dụ:
python3 -m http.server 8000
# rồi mở http://localhost:8000
```

Hoặc deploy thẳng lên GitHub Pages (toàn bộ là file tĩnh, Three.js đã kèm sẵn trong `lib/`).

## Tính năng

- **Bản đồ tỉ lệ ~1:10 theo bố cục thật**: trung tâm → Đồ Sơn ~2km trong game (20km thật),
  Cát Bà ngoài khơi đông nam, sông Cấm phía bắc với cảng và hai cây cầu.
- **15 địa danh** thiết kế theo kiến trúc thực: Nhà hát lớn, Quán hoa, tượng đài Lê Chân,
  hồ Tam Bạc, chợ Sắt, nhà thờ chính tòa, bưu điện, bảo tàng, ga Hải Phòng,
  cầu Hoàng Văn Thụ, cầu Bính, cảng Hải Phòng, bãi biển Đồ Sơn + biệt thự Bảo Đại,
  hải đăng Hòn Dấu, Cát Bà & vịnh Lan Hạ — mỗi nơi có bảng thông tin song ngữ Việt-Anh.
- **7 NPC** với hội thoại kể chuyện thành phố; mini-game **nấu bánh đa cua**.
- **3 nhiệm vụ**: nhặt hoa phượng, nấu ăn, khám phá đủ 15 địa danh.
- **Phương tiện**: xe máy, xích lô, thuyền (Bến Bính & Bến Nghiêng) — thuyền chui qua gầm cầu được.
- **Chu kỳ ngày/đêm** với hoàng hôn trên sông Cấm, đèn đường & cửa sổ sáng về đêm, trời sao.
- **Cánh phượng rơi** quanh dải trung tâm, chim hải âu, tàu thủy qua lại, đài phun nước.
- **Âm thanh procedural** (WebAudio): nhạc nền ngũ cung, sóng biển, còi tàu cảng — không cần file âm thanh.
- **Minimap**, bóng đổ thời gian thực, tone mapping điện ảnh, bầu trời gradient.
- **Chơi được trên điện thoại**: joystick ảo, nút tương tác, gợi ý xoay ngang màn hình.

## Điều khiển

| Phím | Hành động |
|------|-----------|
| `W A S D` / phím mũi tên | Di chuyển |
| `Shift` | Chạy |
| `Space` | Nhảy |
| `E` / `Enter` | Nói chuyện, xem địa danh, lên/xuống xe |
| Kéo chuột | Xoay camera |
| Lăn chuột | Zoom |

Trên điện thoại: joystick bên trái, nút `✦` tương tác, `⤒` nhảy, kéo màn hình xoay camera.

## Cấu trúc

```
index.html          giao diện + màn hình chờ
css/style.css       toàn bộ style, responsive mobile
lib/three.module.js Three.js r160 (vendored)
js/
  main.js           vòng lặp game, di chuyển, camera, tương tác
  world.js          địa hình 1:10, 15 địa danh, cây cối, tàu thuyền
  landmarks.js      dữ liệu địa danh song ngữ + biển thông tin
  npcs.js           7 NPC + hội thoại
  vehicles.js       xe máy, xích lô, thuyền
  character.js      nhân vật low-poly + animation
  daynight.js       chu kỳ ngày đêm, bầu trời, mặt trời/trăng/sao
  petals.js         cánh phượng rơi (instanced)
  quests.js         hệ thống nhiệm vụ
  minigame.js       mini-game bánh đa cua
  minimap.js        bản đồ nhỏ
  audio.js          nhạc & hiệu ứng WebAudio procedural
  input.js          bàn phím + joystick cảm ứng
  i18n.js           song ngữ Việt - Anh
  ui.js             HUD, hội thoại, panel
```
