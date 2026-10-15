# MP-2 SPEC — GĐ1 phía game: "Thấy nhau" (người chơi khác hiện trong thành phố, biệt danh + mã mời, chat)

Base: branch `dot3` (đã gộp Đợt 5 đồ hoạ + MP-1 máy chủ). Đọc trước: `KNOWLEDGE.md` (§1 luật chủ dự án, §8 kiểm thử + khoá
GPU, **§8c multiplayer**), `docs/multiplayer/SERVER.md` (giao thức và API như đã xây — nguồn sự thật, ĐÈ lên ARCH khi khác),
`docs/multiplayer/codebase_hooks.md` (§1 trạng thái người chơi, §3 vẽ người khác rẻ, §5 ngày/đêm, §8 UI, **§9 bảng điểm nối
file:dòng** — số dòng có thể lệch sau Đợt 5, tìm theo tên hàm), `server/CONTRACT.md`, `js/shared/*.js`.

## 0. Mục tiêu (nghiệm thu GĐ1 phía game)
Bạn bè chủ dự án mở link game (GitHub Pages) + mã mời → gõ biệt danh → vào cùng thành phố, **thấy nhau đi bộ/chạy/đi xe máy
mượt**, phân biệt được với người đi đường NPC (bảng tên + vòng sáng dưới chân), **chat gõ tự do trong 40 m** (bộ lọc ở máy
chủ), báo cáo/chặn người khác, cùng giờ ngày/đêm. Không có máy chủ (hoặc rớt mạng) → **game chạy như hiện nay** ở chế độ
"Khám phá" (chơi một mình) và tự nối lại khi máy chủ có lại.

## 1. Luật cứng
1. Chất lượng đồ hoạ theo `TIER` (js/device.js), KHÔNG theo cảm ứng. Không thêm shader program mới (dùng lại `kitMaterial`
   / vật liệu sẵn có của traffic/models_kit). Người chơi khác = **một số cố định lệnh vẽ, không phụ thuộc N** (instanced,
   ≤ +6 draw calls tổng cộng, kể cả bảng tên). Trần hiển thị: TIER1 40, TIER2 96, TIER3 96; bảng tên cho 24 người gần nhất.
2. Không tin client: client chỉ gửi trạng thái/ý định; mọi kết quả chat/chế tài/vị trí sửa (CORRECT) là của máy chủ.
3. Không phá chế độ chơi một mình: mọi đường mạng bọc try/catch, lỗi mạng không bao giờ làm hỏng vòng frame; `?server=` trống và
   không có cấu hình → không mở socket nào, không có request mạng mới nào.
4. Socket nằm trong **Web Worker** (`js/net/net_worker.js`) để không lỡ heartbeat trong lúc dựng thế giới 17–35 s; giải mã ở
   worker bằng `js/shared/codec.js`, chuyển ArrayBuffer (transferable) về luồng chính. Thời gian mạng dùng đồng hồ thật +
   offset máy chủ (`js/shared/clock.js`), KHÔNG dùng `time/dt` đã kẹp của vòng frame.
5. Tiếng Việt có dấu: nhãn/tên/chat dùng font hỗ trợ tiếng Việt (canvas atlas; kiểm ảnh chụp có dấu không vỡ); khoá i18n
   vi/en đầy đủ.
6. Không tên thương hiệu thật trong nội dung sinh ra. Không commit bí mật (token chỉ trong localStorage người chơi).
7. Không sửa `js/shared/*` và `server/*` trừ khi thật cần cho tích hợp (khi đó sửa tối thiểu, có test, ghi vào SERVER.md).
   Không sửa tệp sinh tự động (mapdata.js, buildings_real.js, …).
8. Khoá GPU cho mọi Chrome (`tools/qa/gpulock.mjs`), một Chrome mỗi lúc; máy chủ thử chạy chế độ test (`-TestMode` /
   `HPMP_TEST=1`, cổng riêng) — KHÔNG ghi tệp `hpworld_server_live.txt`. Đầu ra QA bền ở `C:/Users/Admin/hp-world-work/mp2/`
   (không để ở %TEMP%). Không bao giờ xoá đệ quy thư mục không do mình tạo.
9. KNOWLEDGE.md: thêm mục §10 + cập nhật §8c trong cùng commit. Trước khi xong: `node tools/diag.mjs` (full + lite),
   `tools/waterbfs.mjs`, `tools/mobile.mjs`, `tools/tour.mjs` (xem ảnh), `tools/check_assets.mjs` — 0 lỗi JS.

## 2. Phần việc
### C1 MẠNG + PHIÊN + GIAO DIỆN (sở hữu: js/net/{net.js, net_worker.js, session.js, config.js, correct.js, telemetry.js},
js/ui/chat.js, index.html, css/style.css, js/i18n.js (khoá mới), js/input.js (phím chat), js/ui.js (đăng ký modal),
js/daynight.js (`syncTo`), js/main.js (mọi điểm nối))
- Cấu hình máy chủ: `?server=wss://…` (lưu localStorage), hoặc hằng mặc định trong `js/net/config.js` (để trống bây giờ; chủ
  dự án điền khi có tên miền). HTTP API suy ra từ cùng gốc (https://…/v1/…).
- Màn tiêu đề: ô **Biệt danh**, ô **Mã mời** (lần đầu), nút **Vào thành phố** (online) và **Chơi một mình**; hiện **mã khôi
  phục 12 ký tự** đúng một lần sau khi tạo tài khoản (nút sao chép + lời nhắc giữ kỹ); mục "Có mã khôi phục?" để lấy lại tài
  khoản trên máy khác; nhớ refresh token; thông báo lỗi bằng tiếng Việt cho mọi mã lỗi API (mã mời sai/hết lượt, tên bị
  chặn, máy chủ đầy + vị trí hàng chờ/ETA, bị cấm có hạn, sai phiên bản → tải lại).
- Vòng đời: tạo phiên sớm (song song dựng thế giới), `join` khi bấm Start, WELCOME → đặt người chơi ở điểm xuất hiện máy chủ
  trả; gửi READY khi thế giới xong; STATE 15 Hz khi di chuyển / 2 Hz khi đứng (từ `pState`, chế độ đi/chạy/xe máy/xích lô/
  thuyền, vehicleRef); CORRECT → kéo về mượt (lerp ngắn, nhảy hẳn nếu lệch lớn), tôn trọng `corrEpoch`; PING 1 Hz + đồng bộ
  đồng hồ; RESUME khi rớt mạng ≤ 60 s (backoff 1-2-4-8 s + ngẫu nhiên); SYSTEM (kick, cấm, khởi động lại sau N giây, hàng chờ,
  reload) hiện thông báo; mất máy chủ → chuyển "Khám phá" + biểu tượng trạng thái kết nối trên HUD, tự nối lại.
- Ngày/đêm chung: `dayNight.syncTo(dayT)` nắn nhẹ theo `dayEpoch` máy chủ (không gọi setter `t` mỗi frame — nó ép bake IBL).
- Chat: phím `T` hoặc `/` mở ô chat (Enter đang là tương tác — không dùng để mở chat), Esc đóng; nút chat trên điện thoại;
  ô nhập không làm nhân vật di chuyển khi gõ (`input.js typing()`); khung chat cuộn (≤ 50 dòng), tin hệ thống màu riêng; lời
  từ chối của máy chủ (bị chặn/lọc/tốc độ/đang bị khoá chat) hiện bằng tiếng Việt; chạm/nhấp tên người trong khung chat →
  menu **Báo cáo** (lý do) / **Chặn**; EVENT chế tài (bị khoá chat N phút, cảnh cáo) hiện rõ; SUPPORT_LINE hiện nổi bật.
- Trạng thái "bận": khi mở bảng (chat trên điện thoại, menu) không làm mất STATE.
### C2 HÌNH NGƯỜI CHƠI KHÁC (sở hữu: js/net/remote_avatars.js, js/net/interp.js, js/net/nametags.js, js/minimap.js (tham số
`markers`), test riêng) — KHÔNG sửa main.js; C1 gọi API dưới đây.
```
createRemoteAvatars({ scene, world, camera, tier }) → {
  enter(netId, abs, appearance), update(netId, rec, serverMs), leave(netId), names(list), self(netId),
  frame(dt, nowServerMs, camPos),   // nội suy 100–150 ms sau snapshot, ngoại suy ≤ 250 ms, nhảy khi lệch > 8 m
  markers() → [{x, z, kind}],        // cho minimap (bạn bè/nhóm sau này; người lạ mặc định ẩn)
  stats() → { count, drawn, drawCalls }, dispose() }
```
- Dùng lại `pedestrianGeometry`/`motorbikeGeometry`/`kitMaterial`/`optWord` (models_kit.js) và sơ đồ buffer xoay vòng 3 bộ của
  traffic.js (`NSET`) — giữ hợp đồng instcull (`userData.noCull`, `raycast = () => {}`, `matrixAutoUpdate = false`, bounding
  sphere đặt tay quanh người chơi). Bóng tiếp xúc dùng mesh instanced sẵn có; không đổ bóng vào shadow map.
- Phân biệt người thật: vòng sáng mảnh dưới chân (instanced, màu riêng) + bảng tên (atlas canvas chung, LRU, 24 gần nhất trong
  ~25 m, mờ dần theo khoảng cách) có dấu tiếng Việt đúng; dấu "vắng mặt" khi người đó đang rớt mạng.
- y suy từ `surfaceY`/mặt cầu theo cờ level; ngồi xe máy dùng kiểu "rider" của kit; hướng/lean suy từ yaw + tốc độ.

## 3. Kiểm chứng (bắt buộc, ghi số vào SERVER.md §client + KNOWLEDGE)
- Máy chủ thật chạy chế độ test (native hoặc Docker test mode, cổng riêng) + **bot** (`server/bots/run.mjs`) đứng/đi quanh
  điểm xuất hiện của trình duyệt (30–96 bot) + **MỘT** Chrome headless dưới khoá GPU chơi thật: ảnh chụp thấy người chơi khác
  có bảng tên + vòng sáng, xe máy, chat khứ hồi (gửi từ trình duyệt → bot nhận; bot nói → khung chat hiện), báo cáo/chặn,
  CORRECT (bot gian lận tốc độ không ảnh hưởng trình duyệt; trình duyệt dịch chuyển bằng `__hp.teleport` bị kéo về), rớt mạng
  rồi RESUME, máy chủ tắt → chế độ Khám phá → máy chủ bật lại → tự nối lại.
- Hiệu năng A/B cùng phiên với dot3 (không máy chủ) và (máy chủ + 96 bot trong tầm nhìn): draw calls tăng ≤ 6, fps không đổi
  ở TIER 3, thời gian vào game không tăng > 0,2 s ở chế độ một mình; TIER 1 (lite) kiểm riêng với 40 người.
- Một ảnh có dấu tiếng Việt khó ("Nguyễn Thị Hường", "Đặng Quốc Việt") phóng to kiểm không vỡ dấu.
- Chế độ một mình (không `?server=`): diag full + lite, mobile, waterbfs, tour, check_assets đều đạt, 0 request mạng mới.
