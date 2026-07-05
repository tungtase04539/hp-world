# SỔ TAY KỸ THUẬT — Hải Phòng 3D

> **File này là bộ nhớ dài hạn của dự án.** Bất kỳ AI/người nào tiếp tục phát triển
> (Claude Code local, AI khác, phiên mới) PHẢI đọc file này trước khi sửa code.
> **Quy tắc cập nhật:** mỗi khi thêm kiến thức, công thức, kỹ thuật, cách xử lý mới —
> cập nhật vào đúng mục tương ứng của file này (và ghi vào mục 10. Nhật ký) trong cùng commit.

Trò chơi: thế giới 3D Hải Phòng **tỉ lệ 1:1 mét thật** (từ 2026-07-05) theo bản đồ THẬT (OpenStreetMap), chạy web thuần
(không build step), Three.js r160 vendor sẵn trong `lib/`. Live: https://tungtase04539.github.io/hp-world/

---

## 1. Yêu cầu bất di bất dịch của chủ dự án

1. **Ưu tiên chất lượng tối đa** cho mô hình 3D địa danh — KHÔNG nén mất chất lượng
   (không WebP/KTX lossy, không simplify). Chỉ được dùng **meshopt nén hình học** (không mất mát nhìn thấy).
2. **Mô hình địa danh tạo từ ẢNH THẬT** (image-to-3D), KHÔNG dùng prompt văn bản, trừ khi không có ảnh đạt chuẩn.
3. Bản đồ phải **bám dữ liệu OSM thật**: vị trí, hướng công trình, đường phố, bờ biển, sông.
4. Làm từng công trình một theo chỉ định của chủ dự án.
5. Song ngữ VI/EN (js/i18n.js), chạy tốt mobile (joystick, khuyến khích xoay ngang).
6. **KHÔNG BAO GIỜ commit API key** (Meshy key do chủ dự án đưa qua chat, chỉ dùng trong phiên).
7. Giữ attribution: OSM (ODbL), ảnh Wikimedia Commons (CC BY-SA), Meshy AI — trong README.md.

## 2. Kiến trúc code

| File | Vai trò |
|---|---|
| `index.html` | UI, importmap `three` → `./lib/three.module.js`, màn hình chờ |
| `js/mapdata.js` | **SINH TỰ ĐỘNG** bởi `tools/process_osm.mjs` — KHÔNG sửa tay |
| `js/terrain.js` | Cao độ/đất-nước thuần JS (không import three → chạy được trong node để test) |
| `js/world.js` | Dựng toàn bộ thế giới 3D, collider, spawn, `buildWorld(scene)` |
| `js/assets.js` | Đăng ký + preload + streaming GLB theo khoảng cách |
| `js/main.js` | Vòng lặp game, camera, người chơi, bloom, autoQuality, `window.__hp` |
| `js/landmarks.js` | 15 biển thông tin địa danh (vị trí suy ra từ mapdata) |
| `js/traffic.js` / `js/vehicles.js` / `js/npc.js` / `js/quests.js`... | Giao thông, xe cưỡi được, NPC, nhiệm vụ |
| `tools/` | Pipeline dữ liệu + test tự động (xem mục 7, 8) |

Quan hệ dữ liệu: `tools/fetch_osm.sh` → `osm_*.json` → `tools/process_osm.mjs` → `js/mapdata.js`
→ `terrain.js` (đọc) → `world.js`/`landmarks.js`/`traffic.js` (đọc qua terrain).

## 3. Hệ tọa độ & phép chiếu (QUAN TRỌNG NHẤT) — TỪ 2026-07-05: TỈ LỆ 1:1, KHÔNG KÍNH LÚP

- Gốc (0,0) = **tâm Nhà hát lớn thật** (OSM way/242055606): `LON0=106.68182, LAT0=20.85750`.
- **+x = Đông, +z = NAM** (z = −(lat−LAT0)·UZ → lat giảm khi z tăng).
- **Tỉ lệ 1:1 MÉT THẬT** (từ 2026-07-05): `UX = 111320·cos(LAT0°) (m/độ kinh)`, `UZ = 110574`.
  KHÔNG chia 10. 1 đơn vị game = 1 mét thật. `toXZ` KHÔNG warp (trả thẳng (lon−LON0)·UX, −(lat−LAT0)·UZ).
- ~~Kính lúp trung tâm K=2.2~~ ĐÃ BỎ (code cũ warpR/rTable còn nằm trong process_osm nhưng toXZ không gọi).
- `WORLD = {minX:-6900, maxX:48000, minZ:-6800, maxZ:24800}` (~55×32 km thật), MASK cell 40.
- Mọi polyline vẫn **chia nhỏ** (`subdiv`) để bám địa hình/khúc cong — bước lớn hơn ở 1:1 (100-300m).
- Muốn đổi gốc: sửa `tools/process_osm.mjs`, chạy lại, rồi RÀ TOÀN BỘ vị trí hardcode còn sót trong
  world/main/traffic (grep số toạ độ) — BÀI HỌC: từng sót tàu (1000,-125) & núi Lan Hạ (3600-5500)
  ở hệ 1:10 → nổi giữa phố / mọc sai chỗ. Có `tools/diag.mjs` + probe groundHeightNoDeck để kiểm.

### Tỉ lệ hiển thị 1:1 (mét thật)
- Đường lòng: p=13, s=10, t=8, r=5.5, w=3.5 (region 12). Nhà dân footprint THẬT, 3.3m/tầng.
- Địa danh GLB scale theo `LM_SIZE[key]` (cạnh dài thật OSM): opera 49, bưu điện 49, nhà thờ 45, ga 55,
  bảo tàng 36, NHNN 63, chợ Sắt 132×96, THPT NQ 80... Cầu HVT nhịp vòm 200m, trụ Bính 101m, cần cẩu 50m.
- Tốc độ THẬT (m/s): đi 5, chạy 11, xe máy 23 (~83 km/h), thuyền 19. Camera far 16000, fog 600-4200.
- Nhân vật ~1.7m. Đồ nội thất phố (ghế/đèn/biển/thùng rác) giữ TẦM NGƯỜI (~0.5-3m), KHÔNG scale theo 1:1.

### Dữ liệu xuất trong mapdata.js
- `WORLD` biên thế giới; `DT_BOX` hộp trung tâm; `MASK` lưới đất/biển bit-pack base64 (cell 40).
- `RIVERS [{w, pts}]` — rộng 620 (Cấm), 300 (Lạch Tray), 55 (Tam Bạc). Kênh Nam Triệu + hồ push trong terrain.
- `ROADS_DT [{c, pts}]` — c ∈ p(primary/trunk) s(secondary) t(tertiary) r(residential) w(pedestrian).
- `ROADS_REGION`, `BUILDINGS [{p, a, l}]` (footprint THẬT không phóng, a=diện tích, l=số tầng×10).
- `LM {key:[x,z]}` tâm công trình thật; `LM_DIR` **vector đơn vị cạnh dài** footprint;
  `LM_FACE` **hướng mặt tiền** = về **phố lớn (p/s/t) gần nhất** (bỏ ngõ r/w — sửa 2026-07-05e);
  `LM_SIZE {key:[dài,rộng]}` kích thước thật footprint (mét) để scale GLB;
  `STREETS/INTERSECTIONS/MEDIANS` cho nội thất phố;
  `EXTRAS { square, fountain, baodai, bridges[{x,zc,half,ang,rise}], dsRidge, catbaTown, lake }`.

### Công thức xoay công trình theo hướng thật (world.js)
Quy ước mô hình: trục dài = **local X**, mặt tiền = **local +Z**.
Với `rotation.y = θ`: local X → thế giới `(cosθ, −sinθ)`, local Z → `(sinθ, cosθ)`.
```js
orientLong(dir, face): θ = atan2(−dir[1], dir[0]); nếu sinθ·face[0]+cosθ·face[1] < 0 thì θ += π
orientFace(face):      θ = atan2(face[0], face[1])   // nhà thờ: mặt tiền ở ĐẦU HỒI → dùng cái này
localPt(cx,cz,lx,lz,θ) = [cx + lx·cosθ + lz·sinθ,  cz − lx·sinθ + lz·cosθ]  // collider chi tiết phụ
```
Cầu: dựng mọi chi tiết trong nhóm local (z = dọc trục), `group.position=(x,0,zc); group.rotation.y=ang`
với `ang = atan2(Δx, Δz)` của 2 đầu way thật.

## 4. Công thức địa hình (terrain.js)

- `landAt(x,z)`: giải mã MASK, nội suy song tuyến → 0..1.
- `groundHeightNoDeck`: `lerp(-4, 2, smoothstep(0.32,0.68, landAt))` + gợn nhẹ + `hills` +
  san phẳng (DT_BOX, thị trấn Cát Bà quanh `EXTRAS.catbaTown`, cảng quanh `LM.port`)
  − đào lòng sông `riverFactor` (thắng san phẳng, đáy −3).
- `riverFactor(x,z)`: max theo đoạn sông của `1 − smoothstep(w/2, w/2+sh, dist)`; shore `sh` mặc định 28,
  hồ Tam Bạc 25 (bờ hẹp để không ngập trường/chợ). BÀI HỌC: Tam Bạc từng rộng 160m → ngập Chợ Sắt/Đền Tam Kỳ.
- **Mặt cầu** `deckHeight`: với mỗi cầu `dx=x−b.x, dz=z−b.zc`;
  `along = dx·sin(ang)+dz·cos(ang)`; `across = dx·cos(ang)−dz·sin(ang)`;
  nếu `|across|<10 && |along|<half` → `y = 2 + rise·(1−(along/half)²)` (rise=25 cho HVT/Bính, tĩnh không thật).
  Đường phố băng sông nhỏ = cầu phẳng 2.05 khi gần tim đường (`nearDTRoad/nearRegionRoad`).
- `groundHeight = max(groundHeightNoDeck, deckHeight)`. **Thuyền dùng NoDeck** để chui gầm cầu;
  xe/người dùng bản có deck. `isWater = NoDeck < 0.25`.
- Đồi (1:1): sống Đồ Sơn `EXTRAS.dsRidge` (cao 62, phạm vi 220→950), đồi Vụng quanh `EXTRAS.baodai`
  (cao 32, 150→700), đồi Thủy Nguyên z<−2500, núi Cát Bà x>30000 theo mask (cao tới 110m).
- **Kênh Nam Triệu nhân tạo** (1:1): `RIVERS.push({w:1300, pts:[[7600,0],[11000,4100],[15000,7000],[20600,9700]]})`
  trong terrain.js nối sông Cấm ra biển cho thuyền. Nếu đổi gốc toạ độ phải kiểm tra lại các điểm này.

## 5. Meshy AI — tạo mô hình 3D chất lượng cao

### 5.1 Nguyên tắc chọn ảnh đầu vào (photo → 3D)
1. Ảnh THẬT, license rõ (ưu tiên Wikimedia Commons — tìm qua API search + category).
2. Chụp **thẳng mặt tiền hoặc 3/4**, ban ngày, đủ sáng đều, KHÔNG ngược sáng.
3. Độ phân giải ≥ ~1200px cạnh dài sau khi crop.
4. **Không vật cản chồng lên silhouette** (cây, xe, người, cờ, dây điện). Có thì phải XÓA trước.
5. Một ảnh tốt > nhiều ảnh xấu. Multi-image (tối đa 4, `image_urls`) chỉ khi các ảnh NHẤT QUÁN
   (cùng công trình, cùng điều kiện sáng, các góc bổ sung nhau).

### 5.2 Tiền xử lý ảnh (đã kiểm chứng: Lê Chân, Nhà hát, Bưu điện, Ga, Nhà thờ, Quán hoa, Bảo tàng)
- Crop sát công trình + lề nhỏ; bỏ watermark/chữ ký (crop hoặc đè).
- **Xóa vật cản nền trời bằng "silhouette sky-fill"**: đo đường mái theo từng đoạn x
  (vẽ grid tọa độ lên ảnh để đo — PIL ImageDraw), rồi lấp mọi pixel phía trên đường mái bằng
  gradient trời tổng hợp (trung vị màu theo hàng từ cột trời sạch + nhiễu ±2).
  → Xóa sạch cờ/cây/nhà nền sau trong MỘT lần, không lem vào kiến trúc.
- Vật cản trên nền kiến trúc: **clone-stamp** (paste vùng lân cận cùng cấu trúc — bậc thềm clone ngang,
  bóng hiên clone từ trên xuống). Lưu ý nguồn clone không được chứa chính vật cản.
- Công trình ĐỐI XỨNG bị che một bên: làm sạch nửa dễ rồi **lật gương** (`transpose(FLIP_LEFT_RIGHT)`)
  đè lên nửa kia (đã dùng: Ga - thân cau, Bảo tàng - nguyên nửa phải).
- Mái ngói phức tạp: **dò đỉnh mái theo màu** (quét từng cột tìm pixel màu ngói đầu tiên, median ±6 cột)
  thay vì ước lượng đường thẳng — tránh lấp mất mép mái cong (Quán hoa).
- Ảnh chỉ có mặt tiền phẳng → mô hình nông (bas-relief), mặt sau xấu: đặt lưng quay vào phía ít nhìn thấy;
  muốn đẹp mọi phía cần ảnh 3/4 hoặc multi-image.
- Kết thúc: `SMOOTH` + `SHARPEN` nhẹ, JPEG q93. Luôn XEM LẠI thumbnail trước khi gửi.
- Gửi API bằng **data URI** (`data:image/jpeg;base64,...`) — không cần host ảnh.

### 5.3 Tham số API (đã dùng thành công)
```
POST https://api.meshy.ai/openapi/v1/image-to-3d   (Bearer <key>)
{ image_url: <dataURI>,          // hoặc image_urls: [<tối đa 4>]
  ai_model: "latest", topology: "triangle", target_polycount: 300000,
  should_remesh: true, should_texture: true, enable_pbr: true,
  texture_prompt: "<mô tả vật liệu/màu ngắn gọn>" }
→ {"result": "<task_id>"}
GET  https://api.meshy.ai/openapi/v1/image-to-3d/<task_id>  → status SUCCEEDED + model_urls.glb
```
- Text-to-3D (chỉ khi không có ảnh): `/openapi/v2/text-to-3d` mode preview → refine.
- API có **giới hạn credit** — hỏi chủ dự án trước khi tạo task mới; 1 task ~10–20 phút, poll 30–60s/lần.

### 5.4 Hậu xử lý GLB (BẮT BUỘC theo yêu cầu max chất lượng)
```
npx gltf-transform meshopt in.glb out.glb        # CHỈ nén hình học (visually lossless)
# CẤM: gltf-transform webp/etc (lossy), simplify, texture resize
```
- Kiểm tra kích thước texture gốc giữ nguyên; so sánh render trước/sau bằng tools screenshot.

### 5.4b Lưu ý hướng mặt tiền mô hình Meshy
- Mặt tiền mô hình (photo side) KHÔNG cố định +Z hay −Z — thay đổi theo từng lần sinh.
  Sau khi đặt vào game PHẢI chụp kiểm tra rồi chỉnh `rot` (± π) nếu quay lưng ra phố.
- Ảnh chụp góc 3/4 (bưu điện, nhà thờ): mô hình ra đủ 2 mặt — đặt theo `orientLong` chuẩn.
- Ảnh chính diện phẳng (ga): mô hình nông (bas-relief) với mái phẳng lớn — vẫn ổn khi nhìn từ phố.
- Quán/kiosk nhân bản: load 1 GLB rồi `clone(true)` (share geometry/material, rẻ) — xem khối Quán hoa.

### 5.5 Đặt GLB vào game (mẫu chuẩn trong world.js)
```js
registerModel({ url:'assets/xxx.glb', name, x, z, preload:true, place: (m) => {
  scale = kích_thước_mong_muốn / max(size.x,size.z)   // hoặc /size.y với tượng
  m.rotation.y = orientLong(LM_DIR.key, LM_FACE.key)  // xoay TRƯỚC khi đo lại box
  // đo lại box → dịch tâm về (x,z); y += LAND_H − box.min.y − 0.55 (dìm nhẹ chống lơ lửng)
  // castShadow/receiveShadow; anisotropy=8 cho mọi map; envMapIntensity=0.85
  // thêm plinth (bệ) + bậc thềm che chân model
}});
```
- box.min.y có thể là tán cây/chi tiết thấp — kiểm tra bằng mắt, chỉnh độ dìm.
- PBR chỉ đẹp khi scene có `scene.environment` = PMREM RoomEnvironment (đã bật trong main.js).

### 5.6 Dập ảnh chuẩn THẲNG vào texture GLB (ảnh nhạy cảm — chân dung Bác Hồ ở Nhà hát lớn)
Yêu cầu: ảnh nhạy cảm KHÔNG BAO GIỜ để AI sinh/méo — phải là ảnh gốc, dập trực tiếp vào texture.
Quy trình đã kiểm chứng (scratchpad `bake.mjs`, dùng `@gltf-transform/core` + `meshoptimizer` + `sharp`):
1. Đọc GLB (NodeIO + ALL_EXTENSIONS + meshopt decoder), lấy POSITION/TEXCOORD_0/indices.
2. **Bake theo TỪNG TAM GIÁC** (đừng tin 1 phép affine toàn cục): lọc tam giác thuộc mảng tường
   cần dán (bbox 3D), với mỗi tam giác quét pixel trong bbox UV của nó, tính barycentric (eps −0.12
   phủ mép), nội suy ngược ra tọa độ 3D (x,y), nếu nằm trong khung ảnh 3D thì tô pixel bằng ảnh gốc.
   → Tự phủ đúng MỌI mảng chart UV (atlas Meshy vỡ thành nhiều mảnh xoay/lệch khác nhau; fit affine
   toàn cục từng làm ảnh chỉ hiện trên 1 mảng, các mảnh khác vẫn lòi texture cũ).
3. Dập đủ **4 texture**: baseColor = tối (24,23,22); **emissive = ảnh gốc** (luôn hiển thị đúng màu,
   không bị nắng trưa làm cháy trắng — như ảnh có đèn chiếu thật); normal = phẳng (128,128,255)
   (gờ nổi của bake cũ tạo "vòng sáng" quanh đầu); metallicRoughness = (255,235,0) mờ hoàn toàn.
4. baseColor có thể phóng 2048→4096 (lanczos3, JPEG q95) để ảnh dập nét gấp đôi.
5. Ghi lại texture vào doc, write GLB, `gltf-transform meshopt`. Ảnh chỉ scale ĐỀU — cấm kéo méo.
- Kiểm tra nhanh model đơn lẻ (không cần vào game): trang `glbtest.html` (?m=<tên file>) render
  2 hướng ±z bằng three.js thuần — soi mặt tiền/texture trong ~5 giây.
- Tọa độ nào là "tường nhìn thấy": tra tam giác theo VỊ TRÍ 3D rồi xem UV của chúng — đừng đoán
  từ ảnh atlas (nhà hát có ≥2 bản sao mặt tiền trong atlas, chỉ 1 bản được camera nhìn thấy).

## 6. Lưu trữ & phân phối asset nặng

- GLB nặng KHÔNG được nằm trong nhánh deploy: GitHub Pages **fail build nếu file >25MB**
  và build fail chặn MỌI cập nhật site.
- Nhánh mồ côi **`assets-storage`** chứa `assets/*.glb`; game tải qua
  `https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/` (CORS *, giới hạn 100MB/file).
- `js/assets.js`: `ASSET_BASE` = '' khi localhost (dùng assets/ local), ngược lại = raw CDN.
- `.gitignore` có `assets/*.glb` trên nhánh code. Khi thêm model mới:
  1) để file vào `assets/` local để test; 2) commit file đó vào nhánh `assets-storage` và push;
  3) code chỉ cần `registerModel(url:'assets/xxx.glb')`.
  Chuyển nhánh có file ignore: dùng `git checkout -f`, cẩn thận mất file local (backup ra scratchpad trước).
- Preload lúc màn hình chờ (`initAssets`), model xa stream theo khoảng cách (`updateAssets`, radius mặc định 900).
- Người dùng gửi file nặng cho AI: upload lên GitHub Release / nhánh assets-storage rồi đưa URL.

## 7. Sinh lại bản đồ (khi cần cập nhật dữ liệu OSM)

```bash
cd tools
bash fetch_osm.sh        # tải 6 file osm_*.json từ Overpass (PHẢI có User-Agent, không thì 406)
node process_osm.mjs     # sinh ../js/mapdata.js + mask_debug.png + log kiểm tra đất/biển
```
- Mask đất/biển: phân loại **ray-casting chẵn/lẻ** với đường bờ biển (KHÔNG dùng flood-fill —
  đã thất bại vì coastline hở ở mép bbox), lọc đa số 3×3.
- Muốn thêm địa danh mới: tìm id qua Overpass `nwr["name"~"..."]`, thêm id vào fetch_osm.sh mục 6
  và `addWay/addNode` trong process_osm.mjs phần 5.

## 8. Kiểm thử tự động (chạy trước MỌI lần push thay đổi thế giới)

```bash
python3 -m http.server 8123 --directory <repo> &   # server tĩnh
cd tools
node diag.mjs      # JS errors + mọi thực thể (NPC/xe/hoa/biển) đặt đúng chỗ & tiếp cận được
node waterbfs.mjs  # flood-fill nước: thuyền đi được từ Bến Bính tới mọi bến (in water_debug.png)
node tour.mjs      # chụp ~16 ảnh các địa danh (tour-*.png) — XEM BẰNG MẮT từng ảnh
node perf.mjs      # FPS headless (swiftshader chậm là bình thường, autoQuality sẽ hạ cấp)
node mobile.mjs    # viewport điện thoại + joystick
```
- Debug trong game: `window.__hp` = { teleport(x,z,yaw,pitch,dist), setTime(0..1), gh(x,z) *(=NoDeck!)*,
  pick(nx,ny) raycast tên mesh, diag() }.
- **QUAN TRỌNG — quy ước teleport**: camera đặt tại `(x + sin(yaw)·d, z + cos(yaw)·d)` nhìn NGƯỢC về người chơi
  ⇒ **yaw 0 = camera phía nam, NHÌN VỀ BẮC (−z); yaw π = nhìn về nam (+z)**.
  Muốn ngắm mặt nam của công trình: đứng phía nam nó và dùng yaw 0. (Đã từng nhầm ngược → tưởng model sai chỗ.)
- Chụp xong teleport phải ĐÓNG dialog/panel: nhấn E khi `#dialogue` mở, click `#infoClose` khi `#infoPanel` mở.
- Probe nhanh không cần browser: `node -e "const t = await import('./js/terrain.js'); ..." --input-type=module`
  (terrain.js không phụ thuộc three).

## 9. Deploy

- Workflow `.github/workflows/deploy-pages.yml`: push nhánh làm việc → mirror sang `gh-pages` (force).
- `.nojekyll` bắt buộc (tên file có ký tự đặc biệt làm Jekyll fail).
- GitHub Pages cache `max-age=600` → bảo người dùng Ctrl+Shift+R, đợi ~10 phút.
- Vercel (tùy chọn): import repo, không cần build command (site tĩnh).

## 10. Nhật ký cập nhật (thêm dòng mới ở TRÊN CÙNG)

- **2026-07-05 (i)**: EXTENSION CHỤP STREET VIEW (`tools/streetview-capture/`). Vì máy chủ remote
    chặn Google Maps, làm extension Chrome MV3 chạy TRÊN MÁY CHỦ DỰ ÁN: nạp `coords.js` (446 tọa độ
    bám đường thật dải trung tâm — sinh bằng `tools/gen_sv_coords.mjs`, lấy NGƯỢC phép chiếu XZ→lat/lng),
    duyệt từng điểm, `StreetViewService.getPanorama` (bỏ điểm không phủ), xoay đủ N góc × pitch,
    `chrome.tabs.captureVisibleTab` chụp từng khung → tải về `Downloads/hp-streetview/` + `manifest.json`
    (mỗi ảnh gắn tọa độ/panoId/heading/pitch/ngày/bản quyền). Dùng làm THAM CHIẾU dựng dãy phố (không
    nhúng pixel Google). Ẩn panel trước khi chụp để không lọt UI. Cần Maps JavaScript API key (free).
- **2026-07-05 (h)**: DÃY TRUNG TÂM KIỂU THẬT — MÁI NGÓI DỐC PHÁP CỔ. Nhà THẤP tầng (h≤17m,
    không kính, footprint gọn) trong vùng DT_BOX được phủ MÁI HIP 4 dốc ngói đỏ/cam
    (`hipRoofGeo`, gộp chung mesh nhà → không tốn draw-call) → đọc ngay ra "phố cổ mái ngói"
    đặc trưng dải trung tâm. LƯU Ý winding: đảo thứ tự đỉnh mỗi tam giác để pháp tuyến hướng
    LÊN (không thì mặt dốc bị cull → mái đen). Street View (instantstreetview/Google) BỊ CHẶN
    trong môi trường remote (ERR_CONNECTION_RESET qua trình duyệt) + ảnh Google có bản quyền →
    dựng theo KIẾN TRÚC THẬT (nhà Pháp cổ + nhà ống) làm chuẩn, không nhúng pixel Google.
- **2026-07-05 (g)**: CÂY PHƯỢNG "HERO" TỪ ẢNH THẬT (Meshy) + SỬA HƯỚNG VUÔNG GÓC ĐƯỜNG.
  • Cây phượng ảnh-thật: 3 dáng Meshy image-to-3d từ ảnh thật (ph4 tán tròn, ph5 dáng bình cao,
    ph1 tán ô) → `assets/phuong_a|c|d.glb`. Hậu kỳ (`tree_finish.mjs`): cắt đĩa nền trắng Meshy
    hay bịa (bỏ tam giác đáy <5% chiều cao), BỎ ĐẢO RỜI lạ (union-find theo vị trí, giữ thành
    phần lớn nhất — dọn xe đạp/người trong ảnh ph1), simplify ~85–100k tri (lá phượng vỡ vụn nên
    KHÔNG giảm thêm được), CHỈ giữ baseColor (bỏ normal 9MB + emissive + MR), 1024, meshopt.
  • Tích hợp `InstancedMesh` (world.js `loadHeroTrees`): mỗi dáng 1 draw-call dù nhiều cây. Dùng ở
    DẢI TRUNG TÂM (~46 cây, thay procedural) + 4 GÓC MỖI VƯỜN HOA. Cây nền (OSM/công viên xa) vẫn
    procedural cho nhẹ. Biến thể theo vị trí: chọn dáng + cao/thấp + xoay ngẫu nhiên.
  • ⚠️ BÀI HỌC QUAN TRỌNG: GLB Meshy nén **meshopt/quantize → buffer interleaved**. TUYỆT ĐỐI
    KHÔNG `geometry.applyMatrix4()`/`geometry.scale()` lên nó (làm hỏng vị trí → cây mọc "gai rủ"
    xuống đất). Cách đúng: giữ NGUYÊN `mesh.geometry`, gộp chuẩn-hoá (căn gốc y=0, tâm trục,
    cao=1) + `mesh.matrixWorld` vào MA TRẬN INSTANCE: `M = TRS · S(1/h)·T(-cx,-minY,-cz)·matrixWorld`.
    Viewer kiểm GLB cũng phải `setMeshoptDecoder`.
  • Hướng: cổng THPT Ngô Quyền + tượng Nữ tướng Lê Chân quay VUÔNG GÓC với đường thật cạnh mỗi
    công trình (trước quay chéo về tâm quảng trường → lệch). Lấy tiếp tuyến đường OSM gần nhất,
    mặt tiền = pháp tuyến hướng ra đường: trường [0.992,-0.126] (ra đường Bắc–Nam), tượng
    [-0.208,-0.978] (ra đường Đông–Tây).
  • LUỐNG HOA ẢNH-THẬT (Meshy): `assets/flowerbed_a.glb` (luống hồng đỏ, ảnh Wikimedia Commons
    CC BY-SA) làm bồn TRUNG TÂM 5 vườn (vườn Nhà Kèn giữ Nhà Kèn làm điểm nhấn). InstancedMesh,
    chuẩn-hoá theo ĐƯỜNG KÍNH (không theo cao — luống dẹt). Luống 4 góc vẫn procedural nhiều màu.
  • Vườn hoa/công viên ĐI ĐƯỢC (yêu cầu chủ dự án): BỎ collider giữa vườn — chỉ Nhà Kèn (công
    trình) mới chặn (r5). Luống hoa/hàng rào KHÔNG collider (đi xuyên/đi trên được), chỉ gốc cây
    còn chặn (r1.1). Công viên/vườn KHÁC công trình: người chơi dạo tự do trên mô hình.
- **2026-07-05 (f)**: DẢI VƯỜN HOA TRUNG TÂM + HƯỚNG TƯỢNG/TRƯỜNG + NÚT GỌI XE + PHƯỢNG ĐA DẠNG.
  • Dải vườn hoa: `GARDENS` (6 vườn dọc dải trung tâm An Biên→Tố Hữu, tính qua toXZ trong
    process_osm) dựng thảm cỏ + hàng rào viền + lối đi chữ thập + bồn hoa trung tâm (`flowerBed`)
    + 4 bồn góc + phượng góc. Nhà Kèn về đúng vị trí vườn hoa Nguyễn Du (nhaken 106.68639,20.85888);
    thêm Cung Văn hóa Thanh Niên procedural [947,803].
  • Hướng: Tượng Nữ tướng Lê Chân + THPT Ngô Quyền quay mặt ra quảng trường (`orientFace` theo
    vector về EXTRAS.square); rot tượng áp TRƯỚC khi recenter box (nếu áp sau sẽ lệch bệ). UBND
    thay khối đặc bằng portico hàng cột + trán tam giác + cột cờ nóc.
  • Nút 🏍️ (#btnMoto): main.js `callMoto()` gọi `spawn('motorbike',...)` cạnh người chơi rồi
    lên xe; vehicles.js thêm method `spawn(type,x,z,heading)`.
  • Phượng vĩ ĐA DẠNG (phản hồi "hoa/cây phượng không giống"): `phuongTree` sinh biến thể theo
    vị trí — cỡ 0.72–1.77 (≈5–12m), tán Ô/DÙ dẹt (canopyGeo scale.y=0.5), vòm HOA ĐỎ phủ mặt trên
    (bloom nở rộ/vừa/xanh hết mùa). GIỮ procedural cho ~480 cây: ảnh 1 tấm qua Meshy chỉ ra phù
    điêu phẳng, mà nhân bản GLB nhiều poly ×480 sẽ tụt FPS — biến thể procedural là lựa chọn đúng.
- **2026-07-05 (e)**: RÀ SOÁT & CẢI TIẾN TOÀN DIỆN 1:1 (yêu cầu chủ dự án — vị trí đúng nhưng
  hướng mặt tiền/tỉ lệ khối procedural còn sai). ĐÃ SỬA:
  • Mặt tiền: `nearestRoadPoint` bỏ qua ngõ nhỏ (r/w), chỉ quay ra phố lớn (p/s/t) → Đình Hàng Kênh,
    Đền Tam Kỳ quay đúng phố. Nhà thờ Chính tòa: bỏ `+π` sai (tháp chuông từng quay ngược ra đồng),
    dùng orientLong + kiểm tra lật để đầu -X (tháp) luôn quay về LM_FACE. Opera/bưu điện/bảo tàng/
    chùa Dư Hàng/chợ Sắt/THPT NQ xác nhận đúng bằng ảnh (camera đặt phía LM_FACE, thấy mặt tiền).
  • Nước: sông Tam Bạc rộng 160→55m, shore sông mặc định 60→28 → Chợ Sắt & Đền Tam Kỳ HẾT NGẬP
    (trước h=-1.5, nay +2.0). Kiểm bằng probe groundHeightNoDeck.
  • Tỉ lệ khối procedural: Chợ Sắt 28×18→132×96 (lấp footprint thật), quán hoa kiosk 5→9m,
    cầu HVT nhịp vòm 102→200m + mặt cầu 14→28m, trụ tháp cầu Bính 34→101m, cần cẩu cảng 16→50m +
    container 2.4m thật, tàu hàng 40-48→95-130m, biệt thự Bảo Đại ×1.8, thị trấn Cát Bà 10-16→17-30m
    (2 hàng). SỬA ĐẶT SAI TOẠ ĐỘ (còn theo hệ 1:10): tàu sông Cấm (1000,-125)→(6500,140),
    tàu ngoài khơi (2650,1450)→(16000,20000), núi đá Lan Hạ loop x 3600-5500→30000-47000 (trước
    karst mọc gần trung tâm, nay đúng quanh Cát Bà).
  • Công cụ: facecheck (đặt camera phía LM_FACE → thấy mặt tiền = đúng hướng) trong scratchpad.
  BÀI HỌC: trục mặt tiền của MỖI GLB Meshy khác nhau (+Z/−Z/−X), KHÔNG suy ra hướng từ rot thuần —
  phải kiểm bằng ảnh; nhưng nếu LM_DIR ~song song LM_FACE thì mặt tiền ở ĐẦU HỒI (nhà thờ), nếu
  ~vuông góc thì ở CẠNH DÀI (bưu điện). TỒN ĐỌNG: nhà ống/biệt thự ảnh thật (chỉ có ảnh render),
  ga có thể còn quay mặt về phía ray, FPS trung tâm chưa đo.
- **2026-07-05 (d)**: CHUYỂN TOÀN BỘ SANG TỈ LỆ 1:1 MÉT THẬT (yêu cầu chủ dự án — bỏ 1:10
  + bỏ kính lúp trung tâm). process_osm: UX/UZ không chia 10, toXZ không warp, WORLD
  {-6900..48000, -6800..24800}, CELL 40, xuất **LM_SIZE** (kích thước footprint thật từng
  địa danh, mét). world.js: ROAD_W 13/10/8/5.5/3.5 (region 12), GLB size = cạnh dài thật
  (opera 49, bưu điện 49, nhà thờ 45, ga 55, bảo tàng 36, NHNN 63, THPT NQ 80...), nhà dân
  footprint THẬT không phóng (3.3m/tầng), trường học/UBND/rạp ×~2, ghế/đèn/biển giữ cỡ người.
  terrain: kênh Nam Triệu 1:1 [[7600,0]..[20600,9700]] w1300, đồi Đồ Sơn 62m/950m,
  Cát Bà 110m, sh hồ 25/sông 60. Tốc độ THẬT: đi 5, chạy 11, xe máy 23, thuyền 19 m/s;
  camera far 16000, fog 600..4200; asset radius 1500. waterbfs seed (500,-1300), 5 bến
  TỚI ĐƯỢC ✓. TỒN ĐỌNG 1:1: soi vòm cầu HVT/Bính cận cảnh, cần cẩu/tàu cảng + biệt thự
  Bảo Đại + hải đăng + thị trấn Cát Bà chưa rà cỡ, quán hoa GLB param size, chợ Sắt/expo
  khối procedural chưa đo lại theo LM_SIZE, FPS khu trung tâm cần đo.
- **2026-07-05 (c)**: Chân dung v4 THEO YÊU CẦU chủ dự án: bản MÀU nền xanh chính thức
  (nguồn pikvip.com anh-bac-ho-chat-luong-cao-dep-psd-01, 1105×1547 sau khi cắt viền xám —
  ĐÚNG bức chủ dự án gửi). Bake 2 vùng: (a) vá tường kem quanh khung (rect ±0.108,
  y −0.018..0.235 — đáy phải TRÊN mép băng rôn y=−0.027, dò bằng pixel đỏ chiếu ngược
  affine chart); (b) bảng ảnh PW=0.14 gọn trong khung + viền ấm 0.006. Emissive 4096.
  BÀI HỌC: đổi nền phẳng bằng chroma-key/flood-fill LEM VÀO DA MẶT — cấm; phải tìm đúng
  bản gốc có nền mong muốn.
- **2026-07-05 (b)**: Chân dung Bác Hồ v3 — sửa "lồi lõm + tràn khung" (phản hồi chủ dự án):
  (1) LÀM PHẲNG HÌNH HỌC vùng bảng ảnh: mọi đỉnh trong hộp khung (x ±0.108, y −0.075..0.235,
  z 0.27..0.54) → z=0.41 — lưới Meshy vốn có gờ nổi 3D theo bake cũ, chỉ phẳng normal map là
  chưa đủ; (2) đo khung thật từ blue-frame bake gốc → thu plate về halfW 0.108 (trước 0.135 =
  tràn khung 23%); (3) phát hiện assets/img_bacho.jpg bị LỖI vết mực đen ở râu/cổ áo →
  thay bằng bản chính thức Commons "Ho Chi Minh - 1946 Portrait (cropped).jpg" 1820×2560
  (đen trắng, nguyên gốc, không chỉnh sửa). Script: scratchpad bake2.mjs. Muốn bản MÀU:
  chủ dự án gửi ảnh màu sạch rồi chạy lại bake2 (đổi tỉ lệ PH theo ảnh).
- **2026-07-05**: ĐỢT ĐỊA DANH 2 (triển khai toàn bộ backlog audit) + dập chân dung vào texture.
  (1) 5 GLB mới từ ảnh thật: **Đền Nghè** (vinwonders den-nghe-2, dọn lư hương/người/nhà nền bằng
  clone + trám trắng), **Đình Hàng Kênh** (dọn cây trên nóc bằng row-lerp có anchor "dò trời",
  clone dải hoa văn nóc lật gương), **Chùa Dư Hàng** (Commons 4220px; 2 băng rôn → copy dải viền
  hoa sen 2 bên + lan can gỗ tổng hợp), **NHNN** (mirror nửa trái + xóa dây điện lọc dọc/ngang
  5-pass + dập lại chữ), **Đền Tam Kỳ** (dulichkhampha24; xóa băng rôn/biển/cờ đuôi nheo bằng vLerp).
  Meshy id: 019f3042/3047/304c/3050/3052. Cài assets/ + assets-storage (13 GLB tổng).
  (2) **Chân dung Bác Hồ dập THẲNG vào texture nhahat.glb** (xem §5.6) — bỏ tấm overlay nổi
  trong world.js (từng bị lệch vị trí); render đúng cả ngày lẫn đêm nhờ emissive.
  (3) mapdata thêm LM nhnn (way 242192606) + export mới **STREETS(26)/INTERSECTIONS(14)/MEDIANS(3)**.
  (4) world.js: 5 placeGLB + procedural UBND/Rạp Tháng Tám (dịch +9 đông tránh lấn nhà hát)/
  Nhà Kèn bát giác; **nội thất đường phố**: biển tên phố xanh, đèn tín hiệu 3 màu lệch pha,
  dải phân cách + bụi cây, 6 nhà chờ bus, 3 thuyền thiên nga hồ Tam Bạc (trôi + nhấp nhô),
  dây đèn vàng quảng trường→hồ. landmarks.js: 26 địa danh (thêm 9 bảng song ngữ).
  (5) `glbtest.html?m=<file>`: trang soi GLB nhanh 2 hướng không cần vào game.
  CHƯA làm (thiếu ảnh thật đạt chuẩn): nhà ống Tam Bạc (chỉ có ảnh xiên no4.jpg), biệt thự Pháp,
  ảnh UBND thật. LƯU Ý tồn đọng: có vệt đường chạy dọc giữa lòng hồ Tam Bạc (data đường ven hồ?) — cần soi.
- **2026-07-04**: AUDIT toàn trung tâm. Sửa: (1) chân dung Bác Hồ neo theo khung mô hình nhà hát
  (trước cố định 5.4/y7.7 → lệch khi đổi cỡ nhà; giờ PH=0.40·bh, y=0.52·bh); (2) assets.js tải
  GLB TUẦN TỰ ưu tiên gần nhất (trước 6 model ~110MB parse cùng lúc → nghẽn luồng chính);
  (3) thêm `__hp.glbs()` liệt kê vị trí mesh GLB để audit không cần ảnh.
  Quét POI OSM trung tâm → công trình nổi tiếng CHƯA làm: Đền Nghè (ưu tiên 1, node 6380148018),
  Rạp Tháng Tám (way 868234608), UBND TP (way 1124706318), Đình Hàng Kênh (240394078),
  Chùa Hàng/Dư Hàng (236830096), Đền Tam Kỳ (961921403), Ngân hàng Nhà nước (ảnh Commons có),
  Nhà Kèn (chưa có trên OSM — cần node tay).
- **2026-07-03 (g)**: Cầu HVT nâng cấp theo kết cấu thật: dây treo ĐAN CHÉO (network arch),
  vòm cao 30, trụ dẫn đôi đỡ cầu dẫn hai phía; cầu Bính thêm trụ dẫn. Ray yard/spur trong cảng
  (bán kính 170 quanh LM.port) + sân ga (70 quanh LM.station) — 32 đoạn ray tổng. Trung tâm
  Triển lãm: hàng cột + biển tên, mặt tiền quay về tượng Lê Chân. QUYẾT ĐỊNH: KHÔNG Meshy hóa
  cầu HVT — vòm rỗng là điểm yếu chí mạng của image-to-3D (ra khối đặc), ảnh nguồn toàn panorama
  lẫn nền phố không tách được; bản thủ công theo thông số thật là lựa chọn đúng.
- **2026-07-03 (f)**: ĐƯỜNG SẮT THẬT: osm_rail.json (railway=rail, usage=main, bỏ yard/spur cảng)
  → mapdata RAIL (10 đoạn) → world vẽ nền đá balát + 2 thanh ray merge geometry.
  Tuyến chính cắt đúng mép bắc ga (đoạn (71,97)→(173,-4) qua (130,38.6) ≈ LM.station).
  Lưu ý: kiểm tra "ray có qua ga không" phải đo KHOẢNG CÁCH ĐẾN ĐOẠN THẲNG, không phải đỉnh gần nhất.
- **2026-07-03 (e)**: HIỆU CHỈNH TỈ LỆ toàn trung tâm cho khớp bản đồ thật (đối chiếu render
  mapdata vs tile OSM cùng bbox): đường p/s/t/r/w 11/9/7.5/5.5/4 → 7/6/5/4/3; footprint nhà
  phóng 1.6/1.45/1.2/1.05 (trước 2.4/2.0/1.55/1.2); mô hình địa danh ≈2.3-2.5× cạnh dài thật
  (nhà hát 27, ga 26, nhà thờ 25, bưu điện 23, bảo tàng 17, quán hoa 5×5.6); quảng trường r14.
  HỒ TAM BẠC: node tay sai vị trí (nằm trên sông) → tính trục+bề rộng từ polygon nước OSM thật
  (way 236743184), thêm tham số bờ `sh` cho RIVERS (hồ sh=6 để không ngập THCS Trần Phú mép nam).
  QUY TRÌNH đối chiếu: tools render mapdata PNG + tải tile OSM cùng bbox rồi so bằng mắt.
- **2026-07-03 (d)**: CHÂN DUNG CHỦ TỊCH HỒ CHÍ MINH trên Nhà hát lớn: thay hình AI méo bằng ảnh
  chính thức nguyên bản (tấm phẳng phủ đè, đúng tỉ lệ). QUY TẮC: chân dung/quốc kỳ/hình nhạy cảm
  KHÔNG BAO GIỜ dùng bản do AI sinh — luôn phủ ảnh gốc (assets/img_bacho.jpg).
  3 trường học thật (THPT Ngô Quyền GLB từ ảnh cổng thật; 2 THCS dựng khối chữ U + bảng tên,
  chưa có ảnh kiến trúc đạt chuẩn). mapdata thêm TREES (211 cây thật OSM) + PARKS (35 công viên)
  → trồng cây đúng vị trí thật + tô cỏ công viên + rải cây trong công viên. Trường = khuôn viên
  → bán kính chừa footprint 38 (mặc định 30).
- **2026-07-03 (c)**: Bảo tàng photo→3D (ảnh web 1024px: lấp trời + gương nửa trái sạch sang nửa phải
  vì tòa nhà đối xứng — kỹ thuật mới cho ảnh nhiều vật cản). Chợ Sắt: BỎ QUA — mọi ảnh đều dính
  giàn quảng cáo + cây che tầng trệt (tòa 1992 đã phá 2023); giữ mô hình thủ công, chờ ảnh tư liệu tốt.
- **2026-07-03 (b)**: 4 công trình trung tâm photo→3D: Bưu điện (Commons 5312px, góc 3/4),
  Ga (Commons 4032px, xóa 2 cây cau bằng mirror-clone đối xứng), Nhà thờ (Commons 1136px upscale 1.6x,
  xóa banner tháp bằng ốp tường + kéo dài cửa lam), Quán hoa (ảnh web, dò mái theo màu ngói + nhân 5 clone).
  Thêm helper `placeGLB` + `__hp.glbs` gotcha; ghi chú quy ước camera teleport. Ảnh Bảo tàng/Chợ Sắt chưa đạt chuẩn — chờ ảnh tốt.
- **2026-07-03**: Đặt toàn bộ công trình đúng vị trí + hướng thật từ OSM (LM_DIR/LM_FACE/EXTRAS,
  orientLong/orientFace, cầu xoay theo trục way). Gốc tọa độ đổi về Nhà hát lớn thật.
  Thêm tools/ vào repo + file KNOWLEDGE.md này. Bắt đầu tạo lại Nhà hát lớn từ ảnh thật
  (Wikimedia `Haiphong_Opera_House.jpg`, silhouette sky-fill xóa 9 cờ + người).
- **2026-07-02**: Tượng Lê Chân photo→3D thành công (crop + clone-stamp bó hoa); meshopt-only;
  chuẩn hóa quy trình ảnh thật. Nhà hát lớn GLB 43.8MB (text-to-3d cũ) trên assets-storage.
- **2026-07-01**: Tích hợp OSM đầy đủ (mask ray-casting, 432 phố, 1211 footprint, sông, lens 2.2x);
  audit diag/waterbfs; autoQuality; RoomEnvironment PMREM; assets-storage CDN.
