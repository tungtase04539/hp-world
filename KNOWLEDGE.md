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
- **Dữ liệu audit 551 pano**: bản phân tích (JSON + bảng HTML, ~4MB) nằm NGAY nhánh chính
  ở `audit/`; TRỌN BỘ ẢNH pano (4.411 jpg + manifest + README ánh xạ tọa độ) cũng đã ở nhánh
  chính tại `audit/550_pano_dai_trung_tam_hai_phong/` (loại khỏi deploy bằng `.vercelignore`);
  bản gốc song song vẫn ở nhánh `streetview-refs`.
- **PUSH DỮ LIỆU LỚN qua proxy git (giới hạn ~413 khi pack quá lớn)**: `git push` chỉ loại trừ
  blob theo cây COMMIT CHA (edge), KHÔNG theo các ref khác server đã có → push 1 commit chứa cây
  lớn sẽ đóng gói lại TOÀN BỘ blob (dù server có sẵn) → HTTP 413. Cách đúng: chia nhiều commit
  nhỏ (GIT_INDEX_FILE tạm + `update-index --cacheinfo` + `commit-tree`) rồi push TUẦN TỰ — mỗi
  pack chỉ chứa phần chênh với cha (~150 file/đợt là an toàn). Ký lại lịch sử đã push: dựng chuỗi
  `commit-tree -S` cùng tree, đẩy từng commit lên NHÁNH TẠM, rồi force-with-lease swap tip
  (pack ≈ 0 vì object đã trên server). Proxy KHÔNG cho xóa nhánh (403) — nhánh tạm trùng tip
  vô hại. Worktree: bật sparse-checkout loại thư mục ảnh TRƯỚC khi checkout/pull để không
  materialize 1.7GB ra đĩa.

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

## 8b. PANO-LOOP — vòng lặp đối chiếu 551 pano thật ↔ game (V1 đã chạy trên 50 pano đầu)

Bộ công cụ: `tools/pano_loop/` (capture_gamepano.mjs + compare_panos.mjs + capture_list.json).
Mục tiêu: chụp pano trong game đúng tọa độ + heading như bộ ảnh thật (`audit/550_pano_*`),
nhờ model vision ngoài chấm từng cặp, sửa theo cụm, lặp tới khi hết lệch cấu trúc.

### Công thức chụp (đã kiểm chứng khớp khung hình)
- Nhìn theo la bàn H: `camYaw = −H·π/180` (0=Bắc, 90=Đông); `pitch 0.02`.
- **`dist = 0.1`** — camera đứng ĐÚNG điểm chụp như xe Google (dist 1.5 từng làm camera lùi
  CHUI VÀO nhà phía sau → nửa khung xám, pano_042).
- Viewport 956×474 (tỉ lệ 2.02 của ảnh SV gốc 1912×948 → FOV ngang ~98° khớp).
- `setTime(0.35)` (trưa), ẩn `#dialogue/#hud/#titleScreen`, ẩn player
  (`__hp.player.group.visible=false`), ẩn cánh hoa (InstancedMesh count 200 !frustumCulled).
- Chụp localhost → GLB địa danh KHÔNG tải (chỉ CDN) — finding loại "landmark" phải đối chiếu
  thủ công trước khi tin; muốn có GLB: chạy chromium với
  `--host-resolver-rules="MAP hp.test 127.0.0.1"` và mở `http://hp.test:8099`.

### Chấm điểm bằng model ngoài (điều phối + kiểm duyệt bởi Claude)
- Endpoint OpenAI-compatible (tunnel), model `cx/gpt-5.6-sol-xhigh` — vision rất khá, JSON
  đúng schema, ~15-30s/lượt. Key qua env `PANO_LOOP_KEY`, KHÔNG commit.
- 1 lượt/pano: 4 ảnh thật + 4 ảnh game (NÉN 640-768px JPEG q≤70 — payload to bị rate-limit/
  trả trang HTML lỗi) + context đầy đủ (entry audit_done + tọa độ + mục tiêu). Schema:
  headings{score,missing,wrong,extra} + top_fixes{what,type,severity}.
- **Variance chấm ±0.5/pano giữa các lần** → chỉ tin TRUNG BÌNH nhóm và finding lặp lại,
  không tin điểm 1 pano đơn lẻ. LUÔN tự kiểm mẫu bằng mắt (V1: phát hiện 2/2204 ảnh thật là
  rác — screenshot YouTube: pano_001_h000, pano_535_h090 — blocklist; quét bằng heuristic
  độ sáng dải trên ảnh <70).

### Quy luật lỗi nội dung rút từ V1 (48 verdict + tự kiểm mắt)
1. **TỌA ĐỘ PANO = TIM ĐƯỜNG (xe Google)** — mọi vật đặt theo tọa độ pano (quán vỉa hè FOOD,
   chữ HẢI PHÒNG, biển hiệu...) đều đứng giữa đường/trùm camera. Công thức dời: chiếu lên
   đoạn đường gần nhất → đẩy ngang (nửa lòng + 2.6m) về phía vỉa hè + guard né lòng đường.
2. **Trần đặt nhà cạn theo THỨ TỰ duyệt** → vùng cuối danh sách (khu Ga, phía đông) trống
   bất thường (pano_022/023 = 0.6/10). Kiểm cả điều kiện vòng LẪN break bên trong. Hiện:
   phố r/t 380 căn, block_infill CAPB 9500.
3. Ven hồ Tam Bạc: cây thật là xà cừ/bàng TÁN XANH + cây cắt tỉa, phượng đỏ chỉ điểm xuyết
   (lakeSD<45: phượng 12%); kè hồ thật RỢP cổ thụ — trồng theo chu vi LAKE_POLY mỗi 14m,
   cách mép nước 4.5m.
4. Biển tên phố đặt ở GIAO LỘ (tâm nhãn OSM có thể rơi giữa đường).
5. Cụm lỗi lớn nhất còn lại (chưa sửa hết): HOUSE — dãy shophouse phải LIỀN KỀ SÁT VỈA HÈ
   từng lô ~5m (thực địa hiếm khi có khoảng trống); LANDMARK — từng công trình đặc trưng
   thiếu phải dựng riêng (danh sách trong scratchpad cluster_report.txt / compare/*.json).

### Bài học V2-V4 (bổ sung)
- **Ô ĐẤT có 3 KIỂU, không phải 1**: (a) phố shophouse liền kề; (b) CƠ QUAN KHUÔN VIÊN
  (nhà chính + sân + rào sắt + cổng — dùng `compound()`); (c) đất giải tỏa/trống. Lấp
  shophouse vào kiểu (b)/(c) là REGRESSION (pano_019 −1.4 điểm). Vành 830-980m quanh cảng
  nhiều kiểu (b) → giữ shophouse trong 830m, ngoài đó chỉ đặt khi biết rõ kiểu ô.
- **Biển hiệu TÊN THẬT hàng loạt**: catalog có tên trong nháy đơn ở `features` → gen_shopsigns.mjs
  sinh js/shopsigns.js (954 biển); vẽ TEXTURE-ATLAS 4096² (408 biển/atlas, ô 512×80) → 3 draw call.
  Công thức vị trí: pano + 14m theo heading; biển quay mặt về pano (`rotY = −heading·π/180`).
- Chấm lại sau mỗi đợt sửa BẮT BUỘC có nhóm đối chứng cùng pano — mẫu nhỏ (<10) chỉ đủ bắt
  regression lớn, không đủ kết luận tăng/giảm nhẹ (variance ±0.5).
- Endpoint tunnel chịu tải kém với payload ảnh lớn: nén game PNG→JPEG 640px q68 trước khi gửi;
  lỗi trả về cả trang HTML (không phải JSON) → parse phải bọc try/catch + retry.

### Số liệu V1 (50 pano đầu, cùng thang chấm)
- v1 (camera dist1.5): TB 2.85/10 → v2 (camera chuẩn, chưa sửa nội dung): ~2.7-2.9
- v3 (sau 7 fix): trên nhóm so sánh được +0.4~0.5 điểm (+23%); pano khu Ga +0.6.
- Kết luận: pipeline vận hành đúng, lỗi chấm đã nhận diện; muốn nhảy điểm lớn cần cụm
  HOUSE (dãy phố liền kề) + LANDMARK (công trình riêng) — làm ở vòng sau.

## 9. Deploy

- Workflow `.github/workflows/deploy-pages.yml`: push nhánh làm việc → mirror sang `gh-pages` (force).
- `.nojekyll` bắt buộc (tên file có ký tự đặc biệt làm Jekyll fail).
- GitHub Pages cache `max-age=600` → bảo người dùng Ctrl+Shift+R, đợi ~10 phút.
- Vercel (tùy chọn): import repo, không cần build command (site tĩnh).

## 10. Nhật ký cập nhật (thêm dòng mới ở TRÊN CÙNG)

- **2026-07-14 (bs)** [VÒNG TINH 6-AGENT (lô 2/2): T1+T3+T6 = 29 block, XỬ TRÙNG LẶP]:
    T1 LÕI-TÂY 11 block v1* (PROMENADE 2 bờ Tam Bạc caro+lan can+hoa giấy — render pano_197 khớp
    đẹp, hết nhà lấn kè; dãy marble Thế Lữ + nhà cổ); T6 NAM 11 block v6* (HXH biệt thự Pháp, mầm
    non cổng cầu vồng, VietinBank dọn camera-lọt-khối, Cát Cụt UBND An Biên); T3 TÂY-GIỮA 7 block
    v3* (landmark đông sông). TRÙNG LẶP 6-AGENT-SONG-SONG (ranh giới ô cắt qua sông): T1+T3 CẢ HAI
    dựng promenade Tam Bạc + T3+T5 cả hai TTYT Hồng Bàng (cách 85m) → BỎ block A (promenade) + C
    (TTYT) của T3 khi tích hợp, giữ 7 landmark còn lại. BÀI HỌC: chạy nhiều agent cùng khu chồng
    lấn phải TRIAGE trùng khi tích hợp (promenade/landmark cùng địa vật) — kiểm khoảng cách tọa độ
    trước khi chèn. Cả 6 agent smoke PASS 0 lấn lòng đường. VÒNG TINH 6-AGENT XONG (57 block, 134 pano).
- **2026-07-14 (br)** [VÒNG TINH 6-AGENT (lô 1/2): T5+T4+T2 = 28 block]:
    T5 LÕI-TRUNG 7 block v5* (TT Y tế Hồng Bàng, công sở Pháp arcade, PVcomBank, lô phá dỡ cột
    Corinthian); T4 ĐÔNG-GIỮA 9 block v4* (toà Pháp cổ mansard 44m, Le Jardin, chợ N.Khuyến +
    dọn 6 camera-blocker); T2 ĐÔNG-BẮC 12 block v2* (v2-1 dọn nút ĐBP×THĐ "tường xám che camera"
    pano_195 0.9 + vườn hoa, cổng Hải Thành hải quân, VIB/GAC). Cả 3 agent smoke-run PASS 0 lấn
    lòng đường, tự tránh ~260 công trình đã có (đọc FEATURED_CLEAR trước). Render pano_195 nút giao
    mở thoáng + tháp Pullman, pano_432 TT Y tế. Diag 0 lỗi, errcheck sạch. Còn T1/T3/T6.
- **2026-07-14 (bq)** [HEATMAP LẦN 3 (sau đợt 4): TB 2.97 — tiến trình 2.12→2.84→2.97]:
    502 pano. Phân bố <3: 400→263→251; 3-5: 98→214→232; 5-8: 3→15→19. So cặp lần2→3: 2.84→2.91.
    CHƯA gồm đợt 5 (+0.41/84 pano) + vòng tinh 6 agent (v1-v6, 134 pano <3.0 đang chạy) → thực tế
    hiện ~3.1. XU HƯỚNG: mỗi vòng +0.1-0.15 toàn dải; leo 3→8 là chặng biên lợi ích giảm dần cần
    landmark tên-thật cụ thể từng pano (đang làm) + có thể GLB ảnh thật cho công trình lớn. 3 lần
    scan lưu: compare_full_sol56 (L1), compare_full2 (L2), compare_full3 (L3).
- **2026-07-14 (bp)** [PERF: CACHE MATERIAL — 6299→2645 (-58%), 0 rủi ro]:
    Sau 5 đợt: mesh 9668, material 6299, draw call 2393, tris 6-7M. mat() giờ CACHE khi opts RỖNG
    (tường đặc trùng màu = phần lớn ~250 công trình). AN TOÀN TUYỆT ĐỐI: mọi chỗ mutate material
    runtime (daynight lampGlow/window/facadeMats/lighthouseLamp) dùng sharedMats/facadeMats CÓ OPTS
    → không cache; đèn tín hiệu MeshBasicMaterial RIÊNG. Material cache chỉ-đọc, 2 mesh share vô hại.
    Materials 6299→2645. Draw call KHÔNG đổi (cache material không giảm call — cần merge geometry,
    rủi ro hơn, HOÃN). Hình ảnh không đổi (chỉ share khi cùng màu cùng loại). errcheck + diag sạch.
    CÒN: merge geometry landmark để hạ draw call 2393 (task sweep) — rủi ro cao hơn, làm khi cần.
- **2026-07-14 (bo)** [ĐỐI CHỨNG ĐỢT 5: 2.46→2.87 (+0.41, 81 cặp)]:
    LOINAM +0.63 (pano_243 2→5.5, 245 1.1→3.6, 276 1.6→4), TAYXA +0.44, DONGGIUA +0.04 (ĐBP đông
    đã đông, khó tăng). 8 ca giảm ≤0.8 (327/424/150/306...) — KHÔNG hệ thống: mỗi pano cần landmark
    RIÊNG chưa dựng (TOKY LIFE, tòa Pháp Minh Khai, Gia Huy Cát Cụt) + variance ±0.5 → không rollback
    (net dương), đưa vào danh sách tinh vòng cuối. TỔNG 5 ĐỢT: ~450 pano đã phủ+tinh; các ô còn lại
    chủ yếu cần landmark tên-thật cụ thể (đường biên lợi ích giảm dần). BƯỚC KẾ: chờ re-scan #3 chốt
    số tổng → cân nhắc SWEEP PERF (task đã hoạch định) trước khi tinh tiếp.
- **2026-07-14 (bn)** [ĐỢT 5 LÕI-NAM — chợ Nguyễn Khuyến + Hai Bà Trưng Pháp cổ + 13 landmark]:
    13 block ln* (LN1 chợ Nguyễn Khuyến ô dù+sạp — pano_468 1.0 tệ nhất, tường nâu block_infill nuốt
    camera → Z-LN-MARKET dọn; công thự Pháp đổ nát/nhà turret hồng/biệt thự Hai Bà Trưng; trụ sở
    công an Lê Chân kiểu (b); tiệm vàng SJC/PNJ Cầu Đất; F88/VietinBank Tô Hiệu) + 2 zone
    (Z-LN-MARKET chợ, Z-LN-RAIL hành lang đường sắt Mê Linh). BÀI HỌC agent áp: landmark neo tại
    tim đường CỦA CHÍNH PANO đó + along nhỏ (neo 1 pano rồi along lớn → TRÔI khỏi đường cong sang
    phố cắt). Smoke PASS 362 collider 0 lấn lòng. Render pano_468 chợ khớp. Diag 0 lỗi. ĐỢT 5 XONG
    cả 3 mặt trận (LÕI-NAM/ĐÔNG-GIỮA/TÂY-XA, 84 pano).
- **2026-07-14 (bm)** [ĐỢT 5 TÂY-XA — Chùa HBT + Phan Đình Phùng công nghiệp + An Dương]:
    8 block tx* (TX1 Chùa Hai Bà Trưng cổng tam quan vàng — pano_276 h180 0.5→khớp; dãy Cát Cụt
    tên thật, 2 trường Sao Mai/Nguyễn Văn Tố, khu công ty+X46 Phan Đình Phùng kiểu (b)/(c) KHÔNG
    corridor, Xí nghiệp KD+bồn nước, CĐ Kinh tế) + 2 corridor (Hai Bà Trưng đông + Cát Cụt bắc kéo
    bãi trống 245/275/276/277 thành phố). Agent tránh trùng bs* (cầu Lạc Long/arcade Pháp riverside
    đã có). Smoke PASS 0 lấn lòng đường. Render pano_276 chùa khớp. Diag 0 lỗi, errcheck sạch.
- **2026-07-14 (bl)** [ĐỢT 5 ĐÔNG-GIỮA — Petrolimex khỏi tim đường + 9 landmark]:
    EDIT gốc rễ: RAW cây xăng Petrolimex (world.js) 3 điểm đầu là TỌA ĐỘ PANO=tim đường (mái che
    3 cột giữa lòng đường bao lâu nay) → thay bằng trạm thật (205.4,35.1); render pano_475: camera
    đứng ĐÚNG dưới mái che, 2 cột 2 bên khớp ảnh thật. 9 block dm* (dm1 dọn khe giữa 2 park lõi
    Trần Hưng Đạo×Trần Phú che camera 021/236/431/475/535; Aha Coffee, GIABAO EDU tháp bo tròn,
    Honda HEAD+OCB, PH Hotel, LIEN A lượn sóng; biệt thự Pháp 2T thay shophouse; mép công viên
    Trần Phú lát caro + cây cắt trụi). Render pano_535 villa đúng lề, pano_475 Petrolimex khớp.
    Diag 0 lỗi, errcheck sạch. BÀI HỌC: prop hardcode theo pano (cây xăng, chữ HP, non bộ) đều
    nên rà lại — tọa độ pano = tim đường, đặt thẳng lên đó là giữa lòng đường.
- **2026-07-14 (bk)** [GIỚI HẠN THỰC TẾ: nhóm nút giao cầu HVT — KHÔNG đào thêm]:
    Cầu HVT ĐÃ CÓ vòm thép đỏ đầy đủ (2 vòm nghiêng ARCH_H=45 + dây network-arch + giằng) ở
    NHỊP CHÍNH quanh tâm (15,-1391). Nhóm 13 pano nút giao (284/285/330/329/217/282/283/346/347/
    312/348/381): camera thật đứng trên MẠNG LƯỚI RAMP cầu vượt — tính ra pano_284 cách tim cầu
    chính 117m NGANG (along -421, across 117). Mở deckHeight across 10→117 = "cao nguyên" phi thực;
    khớp đúng phải dựng cả interchange 3D (nhiều nhánh ramp cong riêng) = việc lớn hiệu quả không
    chắc. QUYẾT ĐỊNH: KHÔNG đào thêm — zone nút giao đã dọn shophouse sai (pano_330 0.5→sạch), đó
    là mức hợp lý. Cùng họ với pano trên cầu Bính/cầu Rào — giới hạn của tái tạo 1:1 mặt đất.
    Không dựng ti_hvtArch (sẽ VÒM ĐÔI với cầu sẵn có).
- **2026-07-14 (bj)** [ĐỐI CHỨNG ĐỢT 4: 2.16→2.54 (+0.39) + sửa regression che camera]:
    84 cặp: CỘT-600 BẮC +0.79 (siêu khối trị regression: pano_454 0.9→4.3, 223 2.4→5.8, 224 3.1→6.2),
    NAM +0.27, TINH -0.04 (đứng yên — nhóm cầu HVT chưa dựng vòm, bước 2). REGRESSION: SHP Plaza
    (545,707)+VNPT (519,686) che khung camera pano_057/058 (-1.9) — nhưng CHÍNH chúng cho 223/224
    +3.4 → KHÔNG vô hiệu, DỜI +11m ra xa camera theo vector; render 058 thấy cao ốc + phố thông.
    BÀI HỌC: landmark cao tầng đặt gần pano phải kiểm setback KHÔNG che chính camera pano ngay
    trước nó (khác với che pano XA — cái đó đúng). TỒN: nhóm cầu HVT (pano_284/285/330...) cần
    dựng vòm thép đỏ + mở deck/ramp = việc lớn nhất còn lại; cụm G2 nhà quá cao (351/157).
- **2026-07-14 (bi)** [ĐỢT 4 CỘT-600 — siêu khối Hải quân + Chu Văn An + 28 công trình]:
    2 agent (đều smoke-run PASS 0 collider lấn lòng): BẮC 13 block cb* (tường rào MỎ NEO + hoa
    sen quanh SIÊU KHỐI Hải quân/Cảng giữa LTT-ĐBP-THĐ — regression hệ thống nuốt pano tệ nhất
    545=0.5/454=0.9; Nhà khách Hải Quân, Công sở Hàng hải, nội thất vườn hoa giàn vòm trắng/đài
    phun nan/cau vua); NAM 15 block cn* (corridor Chu Văn An hand-fill vì đường OSM lệch 10m tây,
    SHP Plaza, tháp VNPT, cây đa 5-pano, Bossam/KFC). Z-CB1 polygon siêu khối khai báo `inSuperblock`
    SỚM (trước vòng OSM) để dùng CẢ vòng OSM lẫn openSpace không TDZ (áp bài học bh ngay). +1 corridor
    LTT nam. Render pano_545: có tường + phố thay shophouse lấp. Diag 0 lỗi, errcheck sạch.
    TỒN: đường Chu Văn An lệch 10m tây (nên nắn V0 như Tam Bạc vòng sau).
- **2026-07-14 (bh)** [VÒNG TINH bước 1 — nút giao HVT + guard openSpace OSM + 3 corridor; LẶP LỖI TDZ]:
    Agent TINH chẩn đoán 26 pano đã phủ: 13/26 THỰC RA là 1 landmark cầu HVT (camera trên cầu vượt,
    game render phố mặt đất + shophouse). Bước 1 (an toàn): openSpace += nút giao HVT
    (x -300..120, z -1045..-845) + công viên 414/420/381 + kè Tam Bạc tới (-383,-190);
    +3 corridor 'r' (Phạm Bá Trực/Cầu Đất/Cầu Đất đông — lấp trống che GLB nhà thờ).
    ⚠️ LẶP LỖI TDZ (đã có bài học aj/memory mà vẫn mắc!): thêm `if (openSpace(cx,cz)) continue`
    vào vòng OSM BUILDINGS → "Cannot access '_sqX' before initialization" (openSpace + _sqX/_majSeg
    khai báo SAU vòng OSM ~150 dòng). errcheck.mjs bắt ngay; sửa = rect INLINE nút giao thay vì
    gọi openSpace. BÀI HỌC CỦNG CỐ: guard mới cho vòng chạy SỚM (OSM BUILDINGS ~9520) chỉ được
    dùng biến/hàm khai báo TRƯỚC đó (clearedZone/nearFeatured OK; openSpace/onOtherRoad KHÔNG).
    Render: pano_330 nút giao sạch shophouse, pano_031 (điểm cao 6-7) nguyên vẹn. Bước 2 (vòm
    thép đỏ HVT ti_hvtArch) HOÃN — đụng mô hình cầu sẵn có, cần render kiểm riêng. Diag 0 lỗi.
    LƯU Ý QUY TRÌNH: world.js giờ ~12k dòng/~180 công trình → buildWorld mất ~15-25s, __hp chưa
    có KHÔNG có nghĩa lỗi; luôn dùng errcheck.mjs (bắt pageerror từ goto) khi nghi treo.
- **2026-07-14 (bg)** [S5 — biển tên thật hết treo giữa lòng đường]: khối real_shop_signs thêm
    guard `onOtherRoad(x,z)` (biển +14m từ pano rơi vào lòng phố CẮT NGANG tại ngã tư — pano_220
    "BƯU ĐIỆN"/051 "T.HOUSE"/391 "ĐỒ UỐNG"). onOtherRoad khai báo :9727 TRƯỚC khối biển :9807 nên
    dùng trực tiếp. Render pano_220: mặt đường thoáng. Diag 0 lỗi.
- **2026-07-14 (bf)** [ĐO PERF SAU 21 COMMIT — draw call 520→2173, cần SWEEP LANDMARK sau khi phủ xong]:
    Probe tại quảng trường lõi (đông nhất): mesh 6390, InstancedMesh 57, **material 4241** (base
    sweep 1230), **draw call 2173** (base 520), **tris render 7.16M** (base 5.87M), memTex 315.
    NGUYÊN NHÂN: ~150 công trình đích danh agent nháp = Group nhiều mesh KHÔNG merge + mat() tạo
    material mới mỗi lần. ĐÁNH GIÁ: chấp nhận được trên GPU desktop thật (đánh đổi có chủ đích cho
    độ giống thật); CHƯA tối ưu vội vì (a) cache mat() toàn cục RỦI RO — đèn tín hiệu world.js:11910
    setHex runtime + daynight mutate lampGlow/window/facadeMats/lighthouseLamp emissiveIntensity,
    cache trùng màu sẽ lan bug; (b) tối ưu rải rác giữa chừng dễ hỏng. KẾ HOẠCH: sau khi phủ hết
    ô (đợt 4-5) làm 1 ĐỢT SWEEP GỘP LANDMARK — merge geometry mỗi công trình theo material
    (mẫu như flushTrees/bake cầu ở sweep ak), cache material tường tĩnh (loại trừ list mutate).
    MOBILE cần chú ý: material 4241 + tris 7M — kiểm autoQuality + IS_MOBILE có đủ hạ tải không.
- **2026-07-14 (be)** [HEATMAP TOÀN DẢI LẦN 2 — 2.12 → 2.84 (+0.70), KHÔNG CÒN VÙNG CHẾT]:
    492 pano, so theo cặp 453: 2.14→2.84. Phân bố: <3 điểm 400→263; 3-5: 98→214; 5-8: 3→15.
    Ô tệ nhất giờ TB 2.0-2.3 (trước 0.9-1.5). Cụm lỗi vẫn house>landmark>tree>sidewalk.
    VÙNG TRŨNG MỚI CHO ĐỢT 4: cả CỘT x=600 chưa từng phủ — ô (600,-300) 21 pano TB 2.01,
    (600,-600) 10, (600,-900) 6, (600,300) 5 (khu giữa lõi và Lê Quang Đạo: Lạch Tray đông/
    Cầu Rào hướng/Đà Nẵng?); cùng (0,-900) 2.08 + (-300,-300) 2.32 (đã phủ nhưng cần TINH).
    Data: scratchpad compare_full2/ (492 json) + gamepano_full2/ (2204 ảnh mới).
- **2026-07-14 (bd)** [ĐỐI CHỨNG ĐỢT 3: 1.97 → 3.04 (+1.08, 117 cặp) — V0 SÔNG TRẢ LÃI +2.00]:
    TAYSONG +2.00 (1.97→3.96 — nắn sông là fix giá trị nhất 3 đợt: pano_125 0.5→5.1, 208 2→5.5,
    494 1.5→5.5); DONGLOI +0.84; BACSONG +0.74. TỔNG 3 ĐỢT: ~280 pano vùng trũng 0.3-2.5 đã kéo
    lên TB ~3.0-3.3, không còn regression hệ thống. 7 ca giảm rải rác ≤1.0 (không cùng nguyên
    nhân) → danh sách TINH CHỈNH vòng sau: pano_414 (shophouse lấp MẶT công viên — inPark chỉ
    phủ polygon, không phủ dải mặt đường ven công viên), 018/314/157/505/381/107.
    BƯỚC KẾ: re-scan toàn dải 551 (baseline mới sau 3 đợt) → sang giai đoạn TINH leo 4→8.
- **2026-07-14 (bc)** [ĐỢT 3 TÂY-SÔNG + V0 NẮN SÔNG TAM BẠC — sửa gốc rễ 16 pano]:
    PHÁT HIỆN GỐC RỄ (agent taysong): trục sông Tam Bạc OSM lệch NAM 5-30m — tim Phố Tam Bạc
    NGẬP (pano_204 gh=-1.5) còn dải ven Thế Lữ thành đất nên infill lấp nhà "phía sông".
    V0 (terrain.js): splice RIVERS đoạn x -1092..-506 về TRUNG TUYẾN 2 tim đường, w 55→38.
    KIỂM SAU NẮN: 21/21 đỉnh tim đường trong hộp khô, chợ Sắt/đền Tam Kỳ khô, hồ nguyên,
    waterbfs 5/5 ✓ (probe điểm ĐOÁN có thể rơi ngoài lòng đường — phải quét ĐỈNH POLYLINE thật).
    15 block ts* (chợ Lan Phong + lô giải tỏa PBC — cụm 0.5-1.0 tệ nhất toàn dải; kè caro 2 bờ
    sông; chợ LTK 12 nhà + sạp; công sở Công an W40 ăn 2 pano; mầm non compound) + 4 corridor
    (LTK 'r', Hạ Lý tây, Phố Tam Bạc tây, Thế Lữ tây) + zone kè sông 42m vào openSpace.
    Agent smoke-run vòng 1 bắt 16 lỗi tự sửa (đường game #31 lệch bắc 7m so tim thật!).
    Render pano_204: sông đúng chỗ, phố khô, NACHA HOTPOT đúng tên. ĐỢT 3 TÍCH HỢP XONG CẢ 3.
- **2026-07-14 (bb)** [ĐỢT 3 MẶT TRẬN BẮC-SÔNG — cầu Lạc Long + công viên ĐBP + kho Pháp]:
    15 block bs* (lan can cầu Lạc Long hoa văn vòng trắng + bó vỉa đỏ-trắng + cau vua — 6 pano
    ~14 fix sev3; công viên ĐBP tây; trường mầm non Ngôi Sao 2 + Đảng ủy KKT ăn đôi 2 pano trùng
    tọa độ; kho Pháp Cù Chính Lan + kho hoang Phà Bính; tháp 12T lưới xanh + cần cẩu) + 2 ZONE
    (Z-BS1 polygon công viên ĐBP — shophouse từng lấp; Z-BS2 hành lang cầu Lạc Long ±26m).
    Agent smoke-run tự bắt 2 lỗi thật (Mesh.position read-only; 4 collider trong lòng đường —
    đã dời). KỶ LUẬT corridor: 0 corridor mới — mọi đoạn xem ảnh đều kiểu (b)/(c); Thế Lữ tây
    NGHI shophouse nhưng chưa xem ảnh → để vòng sau (đúng bài học Thất Khê). Render kiểm
    pano_062 cầu Lạc Long khớp chi tiết. Diag 0 lỗi.
- **2026-07-14 (ba)** [ĐỢT 3 MẶT TRẬN ĐÔNG-LÕI — chuẩn quy trình agent tốt nhất tới nay]:
    15 block dl* (Legend + biệt thự rào đen pano_359 0.6đ; chợ Nguyễn Khuyến + ô dù; 4 compound
    tây Lê Đại Hành; SVĐ Lạch Tray + trường) — agent TỰ smoke-run trên three vendor + terrain
    thật (306 mesh, 90 collider, 43/43 bearing đúng bucket, 0 lấn lòng đường), TỰ bắt & sửa
    6 lỗi hướng mặt tiền và 2 vị trí lấn đường TRƯỚC khi nộp. Phân loại kiểu ô đất 22 đoạn:
    Hồ Xuân Hương THUẦN biệt thự Pháp → CẤM corridor (tránh regression Thất Khê). +3 corridor
    (chợ NK, LĐH, Lạch Tray SE) + 3 điểm MEDIAN_SKIP ĐBP giữa (pano_155-160 mặt đường liền).
    Render kiểm pano_467: phố chợ + ô dù khớp thật. Diag 0 lỗi.
- **2026-07-14 (az)** [ĐỐI CHỨNG ĐỢT 2: 1.78 → 3.12 (+1.35, 63 cặp) — CẢ 3 MẶT TRẬN DƯƠNG]:
    TTBAC +1.31 (28 cặp), DONG +1.47 (20), TAYBAC +1.25 (15). Đỉnh: pano_478 1.1→4.7,
    253 1.5→4.8, 362 3.1→6.0 (điểm cao nhất toàn dải tới nay). Regression duy nhất pano_094
    (2→1.1): đoạn BẮC Phạm Phú Thứ (z -180..-260) thiếu dãy liền kề (ảnh thật = Viettel Post
    row sát vỉa) → đã thêm corridor [[-828,-180],[-815,-460]]. Tổng 2 đợt chiến dịch:
    ~140 pano vùng trũng 0.3-2.5 kéo lên 2.9-3.3 TB; công thức ổn định +1.3..+2.0/đợt.
- **2026-07-14 (ay)** [ĐỢT 2 HOÀN TẤT TÍCH HỢP: TRUNG TÂM-BẮC (tb*) + TÂY-BẮC (tw*)]:
    TTBAC 15 block (cụm nút HVT×NTP, Bệnh viện Phụ Sản + cổng mầm non, phố công sở Pháp ĐTH,
    ELISE đế phố trước tháp Hoàng Long — agent TỰ phân tích xung đột với 5 công trình đã có,
    Agribank đã dịch tây né BIDV) + 3 ZONE khuôn viên vào openSpace (Z-TTB1 corridor xiên theo
    tim ĐTH bắc, Z-TTB2 bệnh viện, Z-TTB3 nút NTP) — trị bệnh hệ thống S1 "shophouse canyon
    nơi thật là khuôn viên" (≥14 pano). TAYBAC 12 block khu Phạm Phú Thứ/Bạch Đằng (THPT Lê
    Hồng Phong, trường Trần Văn Ơn, trạm y tế Hạ Lý, PICO + pylon cao thế, nhà hàng Gia Viên,
    dãy BIDV/Đại Phát). Diag 0 lỗi. Còn S5 (3 biển shopsigns giữa lòng đường 220/051/391) +
    S2 cây cổ thụ + S3 đèn — vòng sau. Đợt 2 đủ 5 mặt trận: DONG đã push (ax), giờ TTBAC+TAYBAC.
- **2026-07-13 (ax)** [MẶT TRẬN ĐÔNG — Lê Quang Đạo/ĐBP đông/Lê Lợi (agent nháp + kiểm hình học)]:
    12 block helper dg* (dgMedian dải phân cách cây bụi đại lộ đôi LQĐ — fix road sev3 của 2 pano
    tệ nhất 478/215; cụm công sở ĐBP Hải quan/Bảo Việt/ACB; GREE (966.6,-328.7) 1 block ăn 2 pano
    trùng tọa độ 091+444; nhà Pháp arcade W44 + Samsung villa; kho Gence; phố xe đạp Lê Lợi)
    + 5 corridor (LKT, ĐBP đông, Lê Lợi ×2, LQĐ — houseEvidence 65-80% dọc tuyến, probe.mjs của
    agent). Khu này hóa ra KHÔNG phải Lê Hồng Phong — ảnh thật xác nhận Lê Quang Đạo đại lộ đôi.
    Render kiểm pano_478: median cây + nhà mới + ô bạt xanh khớp thật. Diag 0 lỗi.
- **2026-07-13 (aw)** [ĐỐI CHỨNG BẮC: 1.33 → 1.96 (+0.63) + XỬ LÝ 3 REGRESSION]:
    30 cặp: tăng tốt pano_219 +2.8, 499 +2.5, 423 +2.3 (phố thuyền/cổng X46/corridor Tam Bạc ăn
    điểm); NHƯNG 3 regression (420 0.9→0.5, 330 1→0.5, 422 2→0.8) — corridor Thất Khê
    [[10,-785],[150,-779]] lấp shophouse sát vỉa trong khi thực địa là KHUÔN VIÊN tập thể sân
    cây nhà lùi sâu (đúng bài học "3 kiểu ô đất" pano_019). ĐÃ GỠ corridor đó, render kiểm khung
    thoáng lại. BÀI HỌC: corridor spec của agent phải phân loại kiểu ô đất TRƯỚC khi cho vào
    dãy liền kề — pano nhìn thấy "nhà 2-3 tầng" chưa chắc là shophouse sát vỉa.
- **2026-07-13 (av)** [ĐỐI CHỨNG CHIẾN DỊCH NAM+TÂY: TB 1.18 → 3.15 (+1.97), 0 REGRESSION]:
    36 cặp cùng giám khảo 5.6-sol-xhigh sau tích hợp (at). Tăng mạnh nhất: pano_278 0.9→5.2,
    279 1.5→5.5, 281 1.2→5.0 (cả khu TÂY Hai Bà Trưng lên 4.4-5.5); NAM: 185 0.6→4.2, 172 0.9→4.2.
    KẾT LUẬN: công thức "chiến dịch ô" (agent phân tích ảnh thật per-heading → hành lang dãy liền kề
    + công trình đích danh nháp sẵn → tích hợp + FEATURED_CLEAR + guard) cho +2..+4 điểm/ô một vòng,
    không regression. Nhân bản cho các ô còn lại (0,±900), (300,900), (-600,-900)... như task ghi.
- **2026-07-13 (au)** [MẶT TRẬN BẮC — Hạ Lý/Thượng Lý/nút cầu HVT (agent nháp + smoke-run)]:
    15 block helper bc* (không đụng lm*/hb*): cổng doanh trại X46 (-617.4,-782.8 — pano tệ nhất
    dải 0.4đ), PHỐ THUYỀN Tam Bạc (7 lều bạt trên bãi ướt NoDeck<1.75 — chủ đích, phủ 7 pano),
    zone cảng 5 kho + 4 cẩu chân đế cam (vá h90 các pano trên cầu), đảo hòn non bộ + tập thể 5T
    nút HVT, bể bơi Hạ Lý tường tranh, chợ ăn... Agent tự smoke-run three+terrain: 445 mesh,
    91 collider, 0 collider lấn lòng đường. +3 corridor BẮC vào EXT_CORRIDORS (Tam Bạc bờ đông,
    Ngõ 80, Thất Khê; BỎ Phan Đình Phùng — thật mật độ thấp). Cảnh báo giữ: pano_383 là nước
    (lòng Cấm lệch 80m); băng deck cầu HVT x55..90 z-860..-960 cấm dựng.
    TỒN LỚN (ngoài phạm vi nhà): vòm thép đỏ + nhánh xoắn cầu HVT nhìn từ TRÊN CẦU (~12 fix sev3)
    — phải làm ở tầng mô hình cầu.
- **2026-07-13 (at)** [MẶT TRẬN NAM + TÂY — HỒ SEN + 9 HÀNH LANG + 21 CÔNG TRÌNH (2 agent nháp)]:
    Chiến dịch phủ ô ngoài lõi đợt 1 (37 pano NAM Tô Hiệu/hồ Sen + 4 pano TÂY Hai Bà Trưng, điểm 0.3-3.0).
    (1) HỒ SEN đào mới trong terrain.js: HOSEN_POLY 8 đỉnh ~85×195m quanh (-10,950) + hoSenSD()
    (pattern LAKE_POLY) — hồ thật hoàn toàn THIẾU, 8 pano dính water sev3. Lưới thô dìm cả bbox
    + lưới mịn 5m 'hosen_ground' (bài học ô lưới 112m). Kè: lan can đỏ + NHỊP VÒM THÉP TRẮNG bờ
    tây mỗi 35m + phượng bờ đông + đài phun (-10,950) + cầu vòm bắc — khớp ảnh pano_322 rõ rệt.
    waterbfs 5/5 ✓ (hồ cô lập không gãy flood-fill).
    (2) EXT_CORRIDORS: 10 hành lang dãy liền kề NGOÀI vành 830m theo ĐOẠN TUYẾN (C1 Tô Hiệu,
    C2 Chùa Hàng, C3 Dư Hàng, C4 Hồ Sen, C5 Chợ Con, C6 Vòng Hồ Sen, C7 Hàng Kênh, C8/C9 ngõ,
    TÂY Hai Bà Trưng) — shophouse_infill nhận cả 'r' trong corridor, nhà rời né bbox 2 khu.
    Guard mới: hoSenSD<12 (slotOK) + hoSenSD<10 (openSpace) + zone chợ Cột Đèn (-427,943) r28
    + 2 cụm FOOD ô dù chợ.
    (3) 21 block công trình đích danh chèn TRONG block lô 2 (dùng chung helper lmSign/lmFacade/
    lmOK/lmTower — drafts NAM tái dùng, drafts TÂY helper hb* riêng): UBND+NVH quận Lê Chân,
    cổng công viên cánh sen, chợ Con hall 58×38 (mặt cách pano 8m ĐÚNG thật — cần cổng mở thay
    tường phẳng vòng sau), SAMNEC, Đông Dương Hotel, WinMart+, DOJI LED, chợ Kỳ Đồng (băng rôn
    đúng chữ ảnh thật), Trung Quân 5T, trụ sở vàng compound... Diag 0 lỗi, 0 JS error.
    TỒN (PLAN 2 mặt trận): median hoa giấy Hồ Sen z940-1146; cổng chợ mở; 5 biển shopsigns giữa
    lòng đường khu TÂY cần xóa ở nguồn; ngõ 326/ngõ chợ thiếu trong ROADS_DT (việc process_osm).
- **2026-07-13 (as)** [QUẢNG TRƯỜNG NHÀ HÁT V2 — nền đá + bonsai kiềng + đồ quảng trường]:
    theo PLAN corridor4056 V2 (pano_055): nền ĐÁ XÁM khổ lớn ShapeGeometry quad (12,45)-(62,58)-
    (78,140)-(20,152) +0.045 (thấp hơn sân tròn hoa văn +0.06 — không cần đục lỗ, sân vẽ đè);
    16 bonsai chậu đá + kiềng 3 cọc gỗ (2 hàng lat 12/24 dọc trục road#9); 2 cột đèn pha 14m
    cụm 4 pha (23.1,85.6)/(42.8,131.8); kiosk báo + trạm xe đạp 6 xe + biển LED HẢI PHÒNG 2 cột.
    Render kiểm: khớp cấu trúc pano_055 h270. Diag 0 lỗi.
- **2026-07-13 (ar)** [HEATMAP TOÀN BỘ 551 PANO — giám khảo 5.6-sol-xhigh, baseline sau commit 190bd65]:
    501/551 chấm được (50 parse fail). **TB TOÀN DẢI 2.12/10, median 2** — thấp hơn hẳn lô V1 lõi
    (3.4) vì 2/3 số pano nằm NGOÀI dải lõi đã làm: phân bố <3: 400 pano, 3-5: 98, 5-8: 3, 8+: 0.
    Trọng số lỗi: house 2720 > landmark 1934 > sidewalk 796 > tree 755 > road 661 > rail 331.
    8 Ô 300m TỆ NHẤT (TB 0.9-1.5) đều ở RÌA phủ sóng pano: (−300..300, ±900) = trục Tô Hiệu/
    Trần Nguyên Hãn phía nam + Hạ Lý/Tam Bạc bắc; (−600,−300) khu Thượng Lý; (−900,600) An Dương.
    KẾT LUẬN LỘ TRÌNH: muốn TB ≥8 phải phủ nội dung RA NGOÀI dải lõi theo từng ô 300m (mỗi ô là
    1 "chiến dịch Hoàng Diệu" mini: catalog per-heading + zone + dãy nhà + công trình đích danh).
    Data: scratchpad compare_full_sol56/ (501 json) + heatmap_summary.json; ảnh gamepano_full/.
- **2026-07-13 (aq)** [HÀNH LANG 040-056 (đợt 1) + LÔ 2: 19 CÔNG TRÌNH ĐÍCH DANH từ agent]:
    Theo PLAN corridor4056 (agent phân tích 11 pano điểm 2-3.1, lưu scratchpad): (V1) openSpace
    thêm ZONE QUẢNG TRƯỜNG NHÀ HÁT dọc road#9 (41,59)->(67,142): tây sâu 95m along -8..95, đông 45m
    — nguyên nhân gốc pano_055/056 (2.0/1.3): vòng r62 quanh square không phủ hành lang nên shophouse
    lấp kín quảng trường; render sau fix: quảng trường mở thoáng thấy cột cờ + skyline. (V5) rect cấm
    infill quanh mặt tiền Bảo tàng x 64..135 z -535..-466. (V3) Harbour View dời (784.7,-695.7)->
    (773.9,-732) — khối cũ chắn trục nhìn pano_042 h180; biển HARBOUR VIEW gắn LÊN mặt tiền.
    LÔ 2 công trình đích danh (agent lm_drafts nháp, đã node --check + tự tính tọa độ dời tim đường
    + kiểm bearing theo bucket heading): 12 block ≈ 19 công trình chèn cuối khối CÔNG TRÌNH ĐẶC TRƯNG
    (skyline Trần Phú 18T+12T+6T, HP BBQ + billboard, VPBank PNL, cụm Đông Mận/NT69/LC116, Victory-MSB,
    HD Bank + North Hotel, tòa y tế, VietABank, BIDV, TT Văn hóa...) — mỗi khối tự FEATURED_CLEAR.push.
    clearedZone Hoàng Diệu carve-out (636.5,-894.7) r20 cho nhà hàng bo cong. Diag 0 lỗi.
    CÒN theo PLAN (chưa làm): nền đá xám quảng trường + bonsai kiềng gỗ (V2), công viên Trần Phú bỏ
    "mô màu"/cây đỏ (V13/T4), vỉa hè đá xám khổ lớn Trần Phú (T6), đèn cần vươn thay đèn cầu (T5).
- **2026-07-13 (ap)** [PROP-HUNT AGENT: 22 finding — MEDIAN BỊA TRÊN PHỐ HẸP]: agent quét 60 ảnh
    dọc phố p/s + giám khảo 5.6-sol-xhigh → 19 finding HIGH. Mẫu lớn nhất (13/22): bồn trắng +
    cây/bụi DẢI PHÂN CÁCH chắn làn trên đoạn phố thật KHÔNG có dải (MEDIANS OSM lấy nguyên tuyến
    đại lộ nhưng dải thật chỉ có từng đoạn; đối chiếu ảnh pano_153: Điện Biên Phủ mặt đường liền).
    Sửa: `MEDIAN_SKIP` [x,z,r=90] quanh 3 điểm xác nhận (572,-451)/(667.9,-640.2)/(589.3,-204) —
    muốn thêm đoạn phải có ẢNH chứng minh. CÒN TỒN từ prop-hunt: cột điện/quầy hàng
    trong lòng đường (164.3,6.7)/(6.1,-866)/(90.3,-729.4). ĐÃ XỬ LÝ SAU ĐÓ: hòn non bộ (267,-792.7)
    tự hết nhờ clearedZone Hoàng Diệu; "2 thanh lơ lửng" (-547.6,788.8) hóa ra là BIỂN TÊN THẬT treo
    giữa đồng trống (khu >830m không có nhà sinh ra) → guard: ngoài vành 830m phải có nhà OSM <35m.
    Data: scratchpad prophunt/findings.json (22 mục, kèm 60 ảnh).
- **2026-07-13 (ao)** [DẢI HOÀNG DIỆU VEN CẢNG — vùng trũng 0.9-2.3 điểm (pano_015-021)]:
    Thực địa 10/2024 (catalog + findings 5.6-sol-xhigh): BẮC đường = bãi GIẢI TỎA trống đầy gạch
    vụn nhìn ra cần cẩu cảng (game từng lấp kín nhà); NAM = dãy showroom/gara ô tô thấp mái tôn
    xanh biển to; cây = xà cừ CẮT TRỤI, không phượng. Đã dựng trong world.js (khối sau FEATURED_CLEAR):
    (1) `clearedZone(x,z)` theo trục HD_A=(315,-809.5) u=(0.9795,-0.2012) L=360, across 7..140 bắc,
    CHỪA khuôn viên Cảng vụ r45 — cài guard vào: nhà OSM footprint, shophouse, nhà tự mọc,
    block_infill, mái hiên/biển, biển tên thật. Nền: tấm đất nâu + 260 gạch vụn instanced +
    3 mảng tường dở + xe đỗ rải rác. (2) Dãy 8 SHOWROOM procedural nam đường (TOẢN AUTO, TÙNG LÂM
    AUTO...) mái vòm tôn xanh/mái bằng + kính trệt + biển chữ to; mỗi khối tự PUSH vào
    FEATURED_CLEAR (mảng const nhưng mutable — pattern cho công trình sinh động).
    (3) Công trình đích danh mới (đã dời khỏi tim đường): Solis Hotel (424.5,-815.4), TT HỘI NGHỊ TP
    (284.2,-831.8) 66m vàng kem mái xanh + hàng cột + ĐÀI PHUN trước sân (pano_020 từng 1.1 điểm),
    biệt thự Vietcombank (300.5,-783.5), tháp EximBank 12T (391.9,-40.3) + cao ốc kính 15T
    (428.2,-61.4) nút Minh Khai (pano_021 từng 0.9). Helper `bandTower()` (thân + băng kính
    sharedMats.window mỗi tầng + biển canvas). (4) `hdTreeBelt` ±30m: streetTree ÉP shadeTree;
    vòng heroTree cũng phải qua guard này (cây phượng hero Meshy từng đứng giữa hành lang —
    heroTree KHÔNG đi qua dispatcher streetTree, nhớ guard riêng!).
    Kiểm: diag 0 lỗi, 0 JS error, render đối chiếu pano_017/020/015 khớp cấu trúc
    (bãi trống thấy cầu HVT xa, TT Hội nghị + đài phun, showroom vòm xanh).
- **2026-07-13 (an)** [PANO-LOOP V6: 4 CỤM NỘI DUNG + ENDPOINT LOCAL MỚI + BÀI HỌC ĐỒNG HỒ TRÔI]:
    ENDPOINT GIÁM KHẢO MỚI: http://localhost:20128/v1, model `cx/gpt-5.6-sol-xhigh` (KHÔNG hiện
    trong /v1/models nhưng gọi được; Bearer bất kỳ; suy luận chậm — timeout ≥600s; cx/gpt-5.5
    nhanh hơn nhưng chấm LỎNG hơn hẳn: 4.01 vs 3.32 trên cùng bộ ảnh → mọi đối chứng phải cùng
    giám khảo). Pipeline Windows trọn gói trong scratchpad: cap.mjs (chụp §8b) → score_v6.py
    (chấm 3 luồng song song, rubric V1 y nguyên) → pair_report.py (đối chứng theo cặp).
    4 CỤM SỬA (từ trọng số lỗi house>landmark>tree>sign của lô V1 50 pano):
    (1) XE ĐỖ: ô tô đỗ phủ cả phố 's'/'t' (trước chỉ 'p'), cap 200→520, né lakeSD<20 + nearFeatured;
    xe máy đỗ thêm phố 't', cap 480→620. (2) CÂY XANH: vòng cây+đèn dải trung tâm thêm nhánh
    "fill" streetTree (cap 300) phủ MỌI phố p/s/t sau khi hết quota hero/đèn — khu Ga hết trống;
    tỉ lệ phượng 27%→20% (ven hồ 12%→8%). (3) SHOPHOUSE PHỐ 'r' KHU CHỢ ĐỔ: hành lang
    R_CORRIDOR (x -520..-80, z -260..80) cho phố 'r' vào dãy liền kề (nhà cũ 2-4 tầng), nhà rời
    'r' bỏ trong hành lang (tránh chồng lô). (4) MẶT TIỀN NHÀ OSM: vân tầng 0.82→0.74, tầng trệt
    tối 0.15-3.1m, DẢI BIỂN HIỆU MÀU 3.1-4.15m (bảng màu shophouse) cho nhà trung tâm <780m —
    hết "hộp nhạt trống trơn" (pano_009). LƯU Ý TDZ: trong try-block nhà OSM có `const central`
    thứ 2 (mái ngói) — KHÔNG dùng tên đó phía trên, tính thẳng điều kiện.
    ĐỐI CHỨNG lô V1 (44 cặp, cùng giám khảo 5.6-sol-xhigh): TB 3.35→3.41 (+0.06); pano mục tiêu
    tăng rõ: 010 +1.1, 043 +1.0, 025 +0.9, 022/019 +0.7; phần giảm ≤0.5 = variance đã biết.
    BÀI HỌC PIPELINE MỚI — ĐỒNG HỒ TRÔI: setTime(0.35) chỉ đặt 1 LẦN đầu phiên chụp, mà 1 ngày
    game = 300s → lô 200 ảnh trôi sang HOÀNG HÔN/ĐÊM ở nửa cuối (pano_032 trời cam cả trước lẫn
    sau) → giám khảo chấm lệch cả cụm. Sửa: setTime TRƯỚC MỖI teleport trong script chụp.
    Vùng trũng nhất toàn lô (điểm 0.9-2.3, chưa xử lý): dải Hoàng Diệu ven cảng pano_015-021
    (đất giải tỏa + kho xưởng + Cảng vụ) — ưu tiên #1 của vòng sau cùng cụm LANDMARK hàng loạt.
- **2026-07-13 (am)** [GAMEPLAY GÃY + CÔNG TRÌNH ĐÍCH DANH GIỮA ĐƯỜNG + NƯỚC PANO_135 — phiên máy local Windows]:
    MÔI TRƯỜNG MỚI: repo clone về máy Windows của user; GLB trích thẳng từ nhánh assets-storage
    (`git show origin/assets-storage:assets/x.glb > assets/x.glb` — clone đầy đủ có sẵn object, không cần mạng);
    server `python -m http.server`; test bằng playwright-core + Chrome hệ thống
    (`executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'`, headless — công thức chụp §8b
    giữ nguyên nhưng PHẢI ẩn thêm `#touchControls` (máy có màn cảm ứng) và ẩn cánh phượng bằng
    `inst.count = 0` chứ KHÔNG phải visible=false — petals.update tự bật visible mỗi khung).
    `tools/waterbfs.mjs` sửa import hardcode `/home/user/...` → `'../js/terrain.js'` (chạy mọi máy).
    GAMEPLAY GÃY (3 lỗi từ `__hp.diag()` — trước phiên này diag chưa được chạy lại sau nhiều đợt sửa map):
    (1) THUYỀN BẾN BÍNH MẮC CẠN h=2.0: sông cong + polyline thưa → mép nước thật (z≈-952) cách shoreZ
    suy từ "điểm polyline gần nhất + w/2" (z=-798) tới ~155m. Sửa: PROBE NoDeck dọc trục bến tìm mép
    nước thật rồi mới buildPier. BÀI HỌC: mọi thứ neo theo điểm polyline sông phải probe lại mép nước.
    (2) MẤT TOÀN BỘ CỤM ĐỒ SƠN (ô dù + Bến Nghiêng + thuyền; ngư dân rơi về fallback hệ 1:10 (388,1896)):
    `findShore(searchR=320)` trả null — tâm bãi OSM (way 693082800) là ĐỒI cao 43m, dải cát thật cách
    400m về đông → searchR 320→700. Biển địa danh Đồ Sơn neo theo `world.dosonSign` (đất khô sát bãi,
    landmarks.js mutate lm.x/z nên minimap/quest theo luôn); biển Chợ Sắt offset (+5,-75) chìm sông
    Tam Bạc → (+85,0) phía đông.
    (3) CÔNG TRÌNH ĐÍCH DANH V2 ĐẶT TẠI TIM ĐƯỜNG (tọa độ pano, chưa từng áp công thức dời §8b):
    camera pano_158 CHUI VÀO TRONG tháp KS Hữu Nghị (backface culling → nhìn xuyên, tưởng thiếu tháp).
    Dời theo HƯỚNG THẤY TRONG CATALOG audit_done: Hữu Nghị (257,-452)→(257.5,-484.9) (h000=bắc);
    Hoàng Long (10.2,-269.4)→(-11.8,-256.6) GÓC NAM ngã ba (h270; đặt thẳng trục tây từng CHẶN NGANG
    đường — render kiểm chứng); nhà Pháp/Hội LHPN (236.5,-265.1)→(237,-292) + W 16→28 + `rotation.y=0`
    ép mặt vòm quay nam (faceRoad bắt nhầm phố đông gần hơn). Cột cờ pano_407 (-28,120) giữa lòng
    đường → (-18.7,118.3) đảo bonsai phía đông.
    GUARD MỚI `FEATURED_CLEAR`/`nearFeatured(x,z)` (world.js, trước khối công trình đặc trưng):
    shophouse_infill + nhà tự mọc + block_infill + mái hiên/biển + NHÀ OSM FOOTPRINT đều né vùng
    công trình đích danh — commit HOUSE 07-12 từng nuốt chửng tháp Hữu Nghị & nhà Pháp (regression
    lộ ra khi chấm lại). THÊM CÔNG TRÌNH ĐÍCH DANH MỚI → PHẢI thêm dòng vào FEATURED_CLEAR.
    MỚI: KS HARBOUR VIEW (pano_042 h45, [784.7,-695.7]): tân thuộc địa 5 tầng kem dài 66m dọc Trần Phú,
    vòm trắng tầng trệt + porte-cochère; collider 3 VÒNG dọc trục dài (1 vòng lớn sẽ trùm lòng đường).
    NƯỚC PANO_135 (tồn đọng "rủi ro cao" từ (ab)): sh sông Tam Bạc (w=55) 28→10 trong terrain.js —
    sông trong phố có kè cứng; nước hết loang lên dải phố chợ Đổ/Lý Thường Kiệt VÀ mở dải đất ven
    sông cho nhà mọc (trước cornersDry chặn sạch). Kiểm: waterbfs 5/5 bến ✓, chợ Sắt/đền Tam Kỳ khô ✓,
    lòng hồ + kênh Tam Bạc vẫn nước ✓, diag 0 lỗi ✓.
    CHẤM ĐIỂM (Claude vision so trực tiếp composite THẬT/GAME, 14 pano mẫu × 2 heading):
    TB 4.0 → ~4.9/10. Nhảy lớn: pano_158 2.5→5, 354 3→5, 358 2→5, 135 1.75→3.5, 042 3→4.5, 407 4→5.5.
    TỒN LỚN THEO THỨ TỰ ĂN ĐIỂM: (a) phố 'r' khu chợ Đổ (pano_135) vẫn hộp xám thưa — dãy liền kề
    chưa phủ phố 'r'; (b) Ô TÔ + XE MÁY ĐỖ + CÂY XANH thiếu nặng khu Ga (pano_022/023 thật kín xe đỗ
    2 bên); (c) phượng đỏ quá dày nơi thật là cây xanh (pano_019/030); (d) nhà OSM footprint = hộp
    nhạt trống trơn (pano_009 h000) — cần shopfront tầng trệt + màu như shophouse_infill; (e) vài prop
    lẻ còn ở tim đường (bàn trắng pano_158). Blocklist ảnh rác xác nhận lại: pano_001_h000 = YouTube.
- **2026-07-12 (al)** [CỤM HOUSE: DÃY SHOPHOUSE LIỀN KỀ TOÀN DẢI TRUNG TÂM]: cụm ăn điểm lớn nhất
    từ pano-loop V1 (dãy phố "đứt quãng khắp nơi"). Đổi thuật toán đặt lô trong khối shophouse_infill:
    (1) đi dọc TỪNG PHÍA phố p/s, TIẾN ĐÚNG BẰNG BỀ RỘNG LÔ (w 4.2-5.6m + 8cm) thay vì bước cố định
    4.7m → mặt tiền chạm mặt tiền như thực địa; lô bị guard chặn chỉ nhảy 2m rồi thử tiếp;
    (2) MẶT TIỀN THẲNG HÀNG: tâm nhà lùi theo dp (off = wRoad/2 + 2.3 + dp/2) để mặt trước luôn
    cách mép đường đúng 2.3m (trước đây tâm cố định + dp ngẫu nhiên → mặt tiền thụt thò ±0.75m);
    (3) buffer né nhà OSM thật 13→8.5m — nguồn khe hở lớn nhất (mỗi nhà thật khoét lỗ 26m trên dãy);
    (4) gồm cả phố 't' trong vành (đối chứng 5 pano: điểm trên phố s đổi 33-43% pixel, điểm trên
    phố t/r 0% — phố t trung tâm thực địa cũng là tường shophouse); nhà rời 'r'/'t' bỏ 't' TRONG
    vành 830m (tránh chồng lô); (5) CAP 3000→8600 (đo p/s/t trong vành = 20.9km → tối đa 8400 lô,
    trần không cạn giữa chừng — tránh lặp bài học "khu cuối danh sách trống"); guard giữ NGUYÊN
    (3 kiểu ô đất, vành 830m, panoDenies/houseEvidence/openSpace/cornersDry). Vẫn 1 mesh gộp.
    Đối chiếu trước/sau bằng snap_house.mjs (5 pano lõi × 2 heading, đúng công thức chụp §8b).
- **2026-07-12 (ak)** [SWEEP TỐC ĐỘ+CHẤT LƯỢNG 14-AGENT — 59 finding sau phản biện đối kháng]:
    Quy trình: 7 agent soi (1 ĐO runtime headless + 6 lăng kính code/ảnh) → 7 agent phản biện
    bác bỏ/xác nhận từng finding → chỉ sửa cái sống sót. SỐ ĐO TRƯỚC/SAU (probe scene):
    mesh 5.694→2.425, material 2.646→1.230, geometry 3.513→2.406.
    TỐC ĐỘ đã sửa: (1) 2 cầu lớn ~2.000 mesh rời (36% mesh scene, mat() trong vòng lặp
    ~1.220 material trùng) → merge theo material còn ~6 mesh/cầu; (2) cây hero GLB
    frustumCulled=false = 7,2 TRIỆU tam giác submit MỌI khung (70% tam giác scene) → chia ô
    250m + InstancedMesh.computeBoundingSphere() (r160 tự tính theo instance) → cull thật;
    (3) bồn hoa 524 mesh→8, nhà infill 380 nhà 760 mesh→bake ~10 (mẫu bakeTree);
    (4) freezeStatic(): matrixAutoUpdate=false ~6.400 object tĩnh, vật animate đánh dấu
    userData.dyn (11 chỗ trong world.js — thêm updater MỚI phải nhớ đánh dấu!);
    (5) shadow 8Hz (autoUpdate=false + needsUpdate theo nhịp), camera.far 16000→6000 (fog 4200),
    minimap/nearestInteraction 10Hz, daynight/petals hết cấp phát mỗi khung, petals ground
    cache so le 1/20 khung, traffic xa >700m nhịp 1/4 (dồn dt giữ tốc độ);
    (6) MOBILE: atlas biển 4096²→1024² (255MB→16MB VRAM), nửa lưu lượng traffic.
    CHẤT LƯỢNG đã sửa: lateTrees vô hình+collider ma (trồng sau flushTrees — GỠ, đã có khối
    trồng đúng); xe máy đỗ giữa lòng đường khác + xuyên cột (né đường + dịch dải 1.9-2.4m);
    vật vỉa hè lún 0.18m (mặt lát dày 0.18 — cộng bù, dùng cho MỌI vật đặt vỉa hè);
    bạt/biển lơ lửng promenade (chặn lakeSD<24); pergola lạc mũi tây hồ (cạnh >150m) + né ghế;
    FUNZ hết hộp đen/ô hồng trùm mái (mặt kính + biển + mái xám); trang compare highlight
    theo data-i. Số đo build-time đáng nhớ: groundHeightNoDeck ~330k lần dựng chỉ 0,25s,
    lakeSD 899ns/lần — KHÔNG phải điểm nóng, đừng cache; nút cổ chai load = compile shader
    + upload texture khung đầu (native, sau JS).
- **2026-07-12 (aj)** [PROMENADE HỒ "ĐIỂM 8-9" + 2 BÀI HỌC QUY TRÌNH]:
    Nâng chi tiết kè hồ theo pano_004-013/028-037: hàng CÂY CỔ THỤ dọc kè ~18m cả chu vi
    (né chu kỳ ghế 26/đèn 31), PERGOLA gỗ đỏ bờ bắc mỗi 124m (tâm ≡15.5 mod 124 → cách đèn
    ≥13m), PAVILION nghỉ chân (pano_011 x≈-877), THÙNG RÁC ĐÔI xanh lá/dương ~52m, TRẠM XE
    ĐẠP công cộng (pano_030), CỘT ÁP PHÍCH đỏ (pano_012/032), CÂY ĐA quảng trường (pano_035);
    vật trên mặt lát +0.24 (SLAB); guard: đất chuẩn + lakeSD>0.8 + cách mép nhựa ≥1m.
    BÀI HỌC 1 [NHÁNH SONG SONG]: 2 phiên cùng đẩy 1 nhánh — push rejected thì fetch+rebase,
    NHƯNG code vừa rebase có thể gọi API đã bị phiên kia THAY (LAKE_SEGS→LAKE_POLY):
    node --check vẫn qua vì chỉ là identifier chưa định nghĩa lúc parse. Sau rebase PHẢI
    grep các symbol mình dùng + smoke-test runtime rồi mới push.
    BÀI HỌC 2 [TDZ]: streetTree/heroTree đóng trên const (TREE_TILE...) khai báo SÂU dưới
    buildWorld → khối chạy sớm (kè hồ ~line 600) gọi trực tiếp là ReferenceError TRẮNG MÀN,
    node --check không bắt. Chuẩn: khối sớm push vào `lateTrees`, trồng ở CUỐI buildWorld.
    Smoke-test bắt buộc trước push: mở page headless, chờ window.__hp xuất hiện (<20s) + 0
    pageerror (scratchpad probe_err.mjs). Trang compare: grid xếp theo id 001-551 (trước xếp
    theo lô chấm nên bắt đầu 007), xanh lá = ≥8 điểm (chuẩn mới user chốt), vàng 5-8, đỏ <5.
- **2026-07-09 (ai)** [HỒ TAM BẠC = POLYGON OSM THẬT — BÀI HỌC LỚN: ĐỪNG XẤP XỈ ĐỊA VẬT CÓ DỮ LIỆU THẬT]:
    User chê "hồ thành chữ nhật, 2 đầu sai, vỉa hè thụt ra thụt vào" → nguyên nhân gốc là mọi
    phiên bản trước đều XẤP XỈ hồ bằng trục thẳng + bề rộng. Sửa đúng: tải polygon nước OSM
    way 236743184 (Overpass GET, 21 đỉnh → 20 sau dedupe), chiếu hệ game, hardcode
    `LAKE_POLY` + `lakeSD(x,z)` (khoảng cách CÓ DẤU, âm=trong hồ) trong terrain.js.
    Nước: sd<0 (taluy 2m smoothstep(-2,0)); lấp đất sd<60 & h<1.6; đông đập rect riêng.
    KÈ world.js: bám TỪNG CẠNH polygon — pháp tuyến tự lật ra ngoài (test lakeSD(mid+n*3)),
    nhịp ghế/đèn theo QUÃNG ĐƯỜNG TÍCH LŨY (tAcc) để đều qua khúc cong; mặt lát caro tới mép
    nhựa (roadD đo tới mọi đoạn p/s gần hồ); lưới mịn nắn đỉnh theo mép polygon (±2.4→mép,
    trong 2.4-6.5→chân kè). ĐO ĐẠC: polygon cách tim đường ven hồ ≥14m (KHÔNG hề lệch như
    từng nghĩ — thứ sai là phép xấp xỉ đối xứng). Sim: trong poly 0 khô / ngoài 0 ướt.
    Kẹp nghiêng nhân vật lái xe (±0.3 pitch, ±0.45 lean) — hết "người nằm bẹp cạnh xe" trên dốc.
- **2026-07-08 (ah)** [HỒ TAM BẠC SẠCH + KÈ ĐÚNG THỨ TỰ + HẾT BIỂN BAY + HẾT NHÂN VẬT NHẤP NHÁY]:
    (1) terrain.js: lòng hồ TẠO HÌNH SẠCH đè lên mask OSM nham nhở theo `LAKE_SEGS` (export) —
    GOTCHA QUAN TRỌNG: trục polygon nước OSM (EXTRAS.lake.pts) LỆCH ~15m về nam so với tim
    2 phố ven hồ trong game → carve đối xứng HALF=39 quanh trục đó NGẬP phố Quang Trung
    (render kiểm chứng mới lộ). Đường là chân lý hiển thị → trục đúng = TRUNG TUYẾN 2 tim
    đường thẳng kè cũ, nửa-rộng mỗi đoạn = gap/2 − 11m (≈35/33/30/25 tây→đông). Trong hành lang
    (x∈−1160..−205, z∈55..400): dL<half → kênh mượt lerp(−3,1.7); ngoài mép h<1.6 → LAND_H.
    (2) world.js KÈ HỒ viết lại: neo theo LAKE_SEGS (dùng CHUNG với terrain nên rail luôn đúng
    mép nước): cả 2 bờ, rail=half+1.8, đèn=half+3.2, ghế đá=half+5.2 (trên vỉa hè caro, quay ra
    hồ); chừa 9m quanh đoạn đường CẮT NGANG lòng hồ (lọc: điểm giữa đoạn cách trục <half−4 →
    cầu/đập; đường ven bờ song song KHÔNG bị tính). openSpace() ven-hồ cũng đổi sang LAKE_SEGS.
    (3) Khối MÁI HIÊN+BIỂN HIỆU chuyển xuống SAU khối bằng-chứng-nhà, thêm guard
    openSpace/onOtherRoad/houseEvidence/panoDenies — hết biển hiệu bay lơ lửng trên mặt hồ/quảng trường.
    (4) Nhân vật "lúc hiện lúc không" khi lái xe = frustum culling cắt nhầm (bounding sphere các
    khớp xoay theo animation + camera bám sát): `frustumCulled=false` cho player.group (traverse)
    và v.mesh khi mount. Bài học: MỌI vật bám camera/animate khớp phải tắt frustum culling.
    Kiểm chứng sim offline (scratchpad sim_quay2.mjs): rail 335+335/2 bờ, 66 ghế, 72 đèn; trục hồ
    100% nước; 0 đường bị ngập MỚI (59 mẫu ngập đều có sẵn từ trước = kè/cầu sông Tam Bạc, có deck).
    GOTCHA deckHeight: ROADS_REGION vẽ thô ĐÈ QUA lòng hồ → nhánh "rf>0.03 gần đường = lát mặt
    cầu" nâng LAND_H+0.05 thành DẢI ĐẤT nổi giữa nước (chỉ lộ ở render aerial, sim NoDeck không
    thấy!). Sửa: trong lòng hồ (dL<half−2 theo LAKE_SEGS) chỉ nearDTRoad(8) được lát, bỏ
    nearRegionRoad. BÀI HỌC KIỂM THỬ: sim địa hình phải chạy CẢ groundHeight (có deck) chứ
    không riêng groundHeightNoDeck.
    VỈA HÈ KÈ (user: "vỉa hè phải kéo tới rào"): vỉa hè đường ven hồ bám TIM ĐƯỜNG (rộng cố định)
    còn rào bám MÉP HỒ → hở/chồng lộn xộn. Sửa: khối kè lát thêm 'lake_promenade' (caro_do_xam,
    UV theo trục hồ, S=1/1.6 khớp hoa văn) từ mép nước (half−1) tới mép trong vỉa hè của đường
    (đo khoảng cách thật tới parSegs − wRoad/2 − 0.28·wRoad), clamp [half+2.6, half+13];
    rào/đèn/ghế nâng +0.17 đứng TRÊN mặt lát; taluy hồ thu 5m→2m (nước áp chân kè).
    GOTCHA LƯỚI NỀN (quan trọng cho MỌI địa vật hẹp): mesh nền là 1 PlaneGeometry TOÀN thế giới
    500×340 seg → ô lưới ~112m (đo thật trong page: vùng 300×110m quanh hồ chỉ có 5 đỉnh!),
    TO HƠN lòng hồ → dù hàm địa hình đúng 100% (sim + __hp.gh đều ra nước), mặt đất render vẫn
    "bắc cầu đất" qua kênh vì 2 đỉnh kề nhau cùng đứng trên 2 bờ. Nắn đỉnh KHÔNG đủ (nhiều ô
    không có đỉnh gần trục). Giải pháp chuẩn (local refinement): (1) đỉnh lưới toàn cầu trong
    hành lang dL<200 DÌM xuống −3 → không tam giác nào nhô khỏi mặt nước; (2) phủ DẢI LƯỚI MỊN
    5m (~14k đỉnh, mesh 'lake_ground') đúng cao độ + màu, +0.05 tránh z-fight rìa hộp; (3) nắn
    đỉnh dải mịn quanh mép (±2.4m→đường bờ, dải dốc→chân kè taluy 2m) cho MÉP NƯỚC THẲNG không
    răng cưa. half từng đoạn đo lại từ min-dist trục→POLYLINE đường thật −11m (19/29/27/24) —
    vỉa hè đường không bao giờ chờm mặt nước (sim: worst clearance 2.3m, sim_sw.mjs). Kênh/mương
    hẹp mới sau này dùng đúng công thức này, đừng tin mỗi hàm địa hình.
    RANH GIỚI HỒ THẬT (user xác nhận): hồ Tam Bạc chỉ có từ ĐẬP (đường r qua hồ gần tượng
    Lê Chân, (-383,150)→(-366,235)) về TÂY; phía đông đập là ĐẤT (dải vườn hoa + Triển lãm) dù
    mask nước OSM cũ kéo tới ~x=-240 → terrain lấp rect đông đập (x>-392, z 100-240, h<1.6→LAND_H).
    LAKE_SEGS format mới [ax,az,bx,bz,h1,h2] + `lakeDH(x,z)` (terrain.js): half NỘI SUY liên tục
    dọc trục — hết "bậc thụt" bờ/vỉa hè tại khớp nối đoạn. Điểm cuối trục phải LÙI TÂY nửa-rộng
    (cap tròn bán kính half) để nước không lấn qua đập. Vỉa hè kè: đo roadD tới MỌI đoạn p/s
    gần trục (bỏ lọc song song cũ — nó bỏ sót đoạn ở khúc cong → vỉa hè thụt ra thụt vào),
    lát tới MÉP NHỰA (roadD − wRoad/2), mặt lát +0.12 tâm (cao hơn vỉa hè bám-tim-đường 6cm,
    phủ hẳn) — một mặt caro liền từ mép nước tới lòng đường.
- **2026-07-08 (ag)** [CHỐNG CRASH MOBILE]: Chrome điện thoại crash khi vào (user báo) — nguyên nhân:
    texture GLB 100% (nhiều tấm 4K ≈ 67MB VRAM/tấm) + preload 4 GLB song song → hết RAM/VRAM di động.
    Vá KHÔNG đụng desktop (giữ 100% theo yêu cầu): `IS_MOBILE` (UA hoặc deviceMemory≤4) trong assets.js →
    (1) `shrinkTexturesForMobile(root)`: sau load, downscale canvas mọi texture >1024px về 1024 + `img.close()`
    giải phóng ImageBitmap khỏi RAM — áp cho CẢ 3 pipeline load GLB (assets.js registry, hero trees/beds
    world.js, moto vehicles.js); (2) PRELOAD_RADIUS 950→320, PRELOAD_PARALLEL 4→1 trên mobile;
    (3) main.js: antialias tắt trên touch + pixelRatio trần 1.2 (trước 1.5). Desktop regression: ready ✓ 0 lỗi.

- **2026-07-07 (af)** [LẤP LÒNG Ô PHỐ theo bản đồ]: đối chiếu top-down 8 ô aerial với OSM map + bản đồ
    footprint → ô phố game RỖNG RUỘT (nhà chỉ viền mép đường) trong khi thật DÀY ĐẶC. Thêm `block_infill`:
    lưới 13m quét [-1100..900]×[-900..560], nhà ống 2-3 tầng (~3200 căn, 1 mesh vertex-color, mái ngói
    đỏ/tôn xám) đặt trong LÒNG ô: cách đường lớn >17.5m/ngõ >16m/RAY >15m (segment-bucket 48m gồm cả
    RAIL), <130m tới đường gần nhất, có BẰNG CHỨNG ô (nhà OSM <60m hoặc điểm nhà pano <40m), né openSpace/
    panoDenies/nhà OSM <13m/landmark <30m/cornersDry. Aerial sau fix khớp pattern bản đồ footprint;
    vườn hoa/quảng trường/kè/ray vẫn sạch. Collider r≈3.5/căn (spatial-hash chịu được).

- **2026-07-07 (ae)** [BẢN ĐỒ NHÀ TỪ PANO + KÈ HỒ — ý tưởng của chủ dự án]: "check pano là vẽ được bản đồ
    nhà dân ở toạ độ nào". Sinh `js/housemap.js`: 1920 điểm NHÀ THẬT = vị trí pano + 14m theo heading
    từng nhà trong catalog. Luật đặt nhà procedural mới (cả shophouse + nhà tự mọc):
    (1) không đè nhà OSM (<13m); (2) PHẢI có bằng chứng: điểm nhà pano trong 20m, HOẶC vùng không pano
    (45m) thì cần nhà OSM trong 50m; (3) openSpace mở rộng: + quảng trường tượng LÊ CHÂN r55 + quảng
    trường TRUNG TÂM TRIỂN LÃM [-187.8,201.6] r50 (pano_421/428: chỉ 1 công trình, còn lại không gian mở);
    (4) KÈ HỒ: cấm tuyệt đối phía-hồ (cross<0) trong 25m dọc 2 tuyến bờ [-211,116]→[-1052,285] và
    [-1007,367]→[-20,162] (clamp x −1050..−260). Sim 780 nhà: Lê Chân/Triển lãm/QT Nhà hát = 0;
    phía hồ = 0; nhà kè bắc 100% đúng phía dãy phố thật.
    **KÈ HỒ TAM BẠC dựng theo pano** (31 pano thấy lan can, 14 đèn cổ, 4 ghế đá): `lake_railing` (lan can
    gang xanh 2 thanh + trụ mỗi 2.6m, offset 7.2m fallback 5.6m khi chạm nước), `lake_benches` (ghế đá
    granite mỗi ~26m quay ra hồ), `lake_lampposts`+`lake_lampglobes` (đèn ĐÔI hai bóng cầu kiểu Pháp mỗi
    ~31m, trụ gang đen, globes dùng sharedMats.lampGlow) dọc CẢ 2 bờ.


- **2026-07-07 (ad)** [PANO LÀM NGUỒN SỰ THẬT cho vị trí nhà — user chỉ ra vẫn sai sau (ac)]: guard (ac)
    dựa dữ liệu map tự khai (GARDENS/square/lake polyline) nên SÓT — vd polyline hồ Tam Bạc chỉ 3 điểm,
    không phủ đoạn ven hồ phía đông [-220..-310, ~120-140] → vẫn dựng nhà trên bờ hồ. Fix: sinh
    `js/panosides.js` từ catalog 551 pano (mỗi pano `[x,z,mask8]` — bit s bật nếu pano THẤY NHÀ ở hướng
    compass s·45°; 550 pano, 1920 nhà đều có heading). world.js thêm `panoDenies(x,z)`: pano gần nhất
    (<45m) phải thấy nhà ở bearing tới vị trí đặt (±1 sector); không thì bỏ. Compass: 0=Bắc=-Z,
    bearing=atan2(dx,-dz). Áp cho CẢ shophouse_infill + nhà tự mọc. Kết quả: loại thêm 132 vị trí —
    toàn ven hồ Tam Bạc đông/tây + phố đi bộ (khớp đúng chỗ user chỉ). Sanity: pano_007/004 mask chỉ
    Bắc (hồ Nam ✓), pano_201 thiếu Tây (sông ✓). QUY TRÌNH từ nay: vị trí nhà = pano quyết, map chỉ phụ.


- **2026-07-07 (ac)** [SỬA VỊ TRÍ SHOPHOUSE/NHÀ DÂN — lỗi user chỉ ra]: shophouse đặt CẢ HAI bên mọi
    phố 'p'/'s' → dựng nhầm nhà ở vỉa hè cạnh VƯỜN HOA, QUẢNG TRƯỜNG Nhà hát, VEN HỒ Tam Bạc (không
    gian mở, thực tế KHÔNG có nhà) + đè lên đường cắt ngang. Thêm helper `openSpace(x,z)` (inPark OSM +
    6 GARDENS bán kính max(w,d)/2+12 + quảng trường EXTRAS.square r62 + ven hồ EXTRAS.lake dist<w/2+16)
    và `onOtherRoad(x,z)` (dist<halfW+2.5 tới đoạn 'p'/'s'/'t' — né nhà giữa đường). Chặn đặt nhà ở đó
    cho CẢ 2 khối (shophouse_infill + nhà tự mọc 'r'/'t'). Bỏ ~116 vị trí sai (12 vườn hoa/27 quảng
    trường/4 hồ/73 đường cắt). CŨNG sửa: shophouse side=+1 quay LƯNG ra đường (bug hướng) → lật thêm
    180° (`faceAng = rotY+π/2 + (side>0?π:0)`). + chi tiết hoá: cửa sổ khung+kính từng tầng, kính+cửa
    tầng trệt, chậu cây ban công, ăng-ten nóc. Kiểm chứng: aerial + render quảng trường/vườn hoa sạch nhà.


- **2026-07-07 (ab)** [AUDIT 551 PANO + DẢI TRUNG TÂM]: vét cạn **551 pano Street View** (2 manifest:
    420 + 131) qua workflow đa-agent (catalog theo quy chuẩn 11 trường, chống bịa; 8 heading cho ~250
    pano đầu, 4 heading cho phần còn lại để tiết kiệm quota). Dữ liệu + bảng chi tiết HTML + gap-analysis
    lưu ở nhánh `streetview-refs/audit/` (audit_done.json, audit_enriched.json, hp_pano_audit.html).
    Toạ độ pano: dùng cùng phép chiếu 1:1. Gap chính (game thiếu vs thật): đài phun nước, cây xăng
    Petrolimex, tượng/phù điêu, hòn non bộ vòng xuyến, bàn ghế nhựa quán vỉa hè, ô tô đỗ.
    **ĐỢT 1 (procedural, world.js)** thêm 6 lớp đặt theo toạ độ pano thật (gap_coords.json):
    `streetside_furniture`/`streetside_parasols` (bàn ghế nhựa + ô dù, 27 cụm), `fountains`+`fountain_water`
    (8 đài phun nước), `gasstation_*` (cây xăng mái khoang cam-xanh + trụ bơm), `hp_letters` (chữ 3D
    "HẢI PHÒNG" bờ hồ — **có land-search 90m** vì pano sát mép nước bị isWater loại), `rockery_*`
    (hòn non bộ + cau vua đảo giao thông), `parked_cars` (200 ô tô đỗ instanced dọc đại lộ 'p').
    **ĐỢT 1b**: regenerate `sidewalks.js` từ TOÀN BỘ 551 pano — mỗi road 'p'/'s' khớp pano gần nhất
    (<85m) → 42 đoạn caro/con sâu (trước 11), 4 terracotta, 56 bê tông/xám; hết "gạch xám mặc định khắp nơi".
    **ĐỢT 2** (công trình đặc trưng procedural, có `faceRoad()` quay mặt tiền về đường gần nhất):
    `ks_huunghi` (tháp 12 tầng + khối ban công hộp nhô, pano_158 [257,-452]), `toa_hoanglong`
    (tân cổ điển mạ vàng + hàng cột + đầu hồi + cặp sư tử, pano_354 [10,-269]), `nha_phap_arcade`
    (nhà Pháp 2 tầng hành lang cuốn vòm + mái ngói đỏ, pano_358 [237,-265]). Helper `facadeTex()`
    sinh texture lưới cửa sổ. Test: headless render từng công trình, 0 lỗi JS, đặt đúng toạ độ.
    **ĐỢT 2.5** (rải rộng cho sống động): `shop_awnings` (mái hiên bạt nghiêng + diềm, màu vải dịu,
    protrusion hướng ra đường qua `faceRoad`-style), `shop_signs` (292 biển hiệu đứng) dọc phố 'p'/'s'
    building-side (offset wRoad/2+3.4). InstancedMesh + instanceColor.
    **ĐỢT 3 — ĐỐI CHIẾU NGƯỢC game→pano** (31 điểm rải khắp dải, workflow 8 agent so game-render vs pano
    thật + catalog). LƯU Ý PHƯƠNG PHÁP: render local (127.0.0.1) → GLB landmark KHÔNG tải (chỉ có ở CDN)
    → mọi "thiếu Nhà hát/bảo tàng/ga..." là DƯƠNG-TÍNH-GIẢ, bỏ qua; chỉ sửa lỗi PROCEDURAL. Fix đã áp:
    (1) CÂY: thêm `shadeTree` (xà cừ/bàng tán tròn xanh + ~30% biến thể cắt cụt cành/pollard) + dispatcher
    `streetTree` = 55% xanh / 35% phượng / 10% cọ (phượng vẫn là biểu tượng nhưng hết "mọi cây đều đỏ").
    (2) NHÀ generic lõi trung tâm (dist<780) nâng lên 3-5/4-7 tầng (phố thương mại thật liền mạch).
    (3) mái hiên bớt số + hạ bão hòa màu (đỡ trôi nổi sặc sỡ).
    (4) `mural` (11 panô cổ động đỏ sao vàng trên cột) + `civic_fences` (hàng rào sắt + cột cờ đỏ búa liềm
    ở 3 công sở) theo toạ độ pano. Test: headless render từng cụm fix, 0 lỗi JS, cải thiện rõ.
    (5) **DÃY SHOPHOUSE LIỀN MẠCH** `shophouse_infill`: khối "nhà tự mọc" cũ CHỈ mọc dọc ngõ 'r'/'t' nên
    phố chính 'p'/'s' trống (chỉ footprint OSM có nhiều hở) → thêm ~780 nhà ống 3-5 tầng SÁT NHAU dọc phố
    'p'/'s' lõi trung tâm (dist<830), tại building-line (offset wRoad/2+5.6, sau vỉa hè), né nước/địa danh/
    footprint thật (`nearRealBuilding`). Gộp 1 mesh vertex-color (tường sơn màu + vân tầng + mái ngói),
    có collider (spatial-hash 48m nên +780 collider không ảnh hưởng FPS). Mái hiên/biển hiệu (Đợt 2.5) giờ
    bám đúng vào mặt shophouse này → phố "kín" và thân thuộc.
    **ĐỢT 4 — CHI TIẾT HOÁ SHOPHOUSE** (soi 18 phố buôn bán game↔pano, workflow 6 agent — mọi phố "kém"
    vì shophouse còn là khối trơn). Nâng `shophouse_infill` từ khối trơn thành nhà ống chi tiết, mỗi căn:
    tầng trệt CỬA CUỐN/KÍNH tối màu, BIỂN HIỆU ngang phủ bề rộng (màu đỏ/xanh/lá/cam/đen) + BIỂN VẪY nhô
    vuông góc, BAN CÔNG + lan can sắt + ĐIỀU HOÀ cục nóng tầng trên, MÁI BẰNG bê tông + BỒN NƯỚC INOX,
    2-5 tầng SO LE, MÀU TỪNG CĂN đa dạng (bạc hà/kem/cam/hồng/vàng/xám — hết "khối xám đơn điệu"). Gộp
    parts mỗi căn → applyMatrix4 (xoay bề ngang dọc phố + đặt) → merge toàn bộ 1 mesh (167k đỉnh, 1 draw
    call). Mái hiên/biển hiệu Đợt 2.5 bám đúng mặt tiền. Test: 0 lỗi JS, render 3 phố khớp pano rõ.
    (6) TERRAIN: hồ Tam Bạc `sh` 25→14 (bờ hẹp lại) để nước không lấn ra phố đi bộ Quang Trung (pano_004);
    numeric-verified: lõi hồ w/2=39m vẫn nước, swan/bench không đổi, chỉ rút vệt tràn ~11m. LƯU Ý: vài điểm
    ven Tam Bạc (pano_135, pano_200) nước đến từ OSM WATER MASK (không phải RIVERS) → cần chỉnh mapdata,
    CHƯA sửa (rủi ro cao).
    **VÒNG 3 (sửa regression)**: đối chiếu vòng 2 lộ lỗi #1 "khối hộp xám trơn trôi nổi" (30 lần) — do nâng
    tầng đẩy nhà 5-7 tầng vượt ngưỡng `glassy = h>18` → bị tô tông KÍNH XANH-XÁM lạnh. Thực tế shophouse
    3-6 tầng là nhà SƠN MÀU. Sửa: `glassy` ngưỡng **h>18 → h>30** (chỉ cao ốc ~9+ tầng mới kính); nâng tầng
    lõi TT dịu lại **3-5/3-6** (thay 3-5/4-7). Nhà trung tâm giờ giữ tường sơn cream/vàng + lưới cửa sổ.
    BÀI HỌC: khi tăng chiều cao nhà generic phải kiểm ngưỡng `glassy` kẻo biến nhà phố thành cao ốc kính.
    CÒN TỒN (cần xử lý cẩn thận, chưa làm trong đêm vì rủi ro terrain): mặt nước sông Tam Bạc lấn lên
    promenade/mặt phố ở vài điểm ven sông (pano_200/004); dãy shophouse chưa "liền mạch" do khoảng hở
    footprint OSM; thiếu cây đa cổ thụ rễ phụ ở quảng trường Nhà hát.
    Test: headless render tại từng toạ độ gap, 0 lỗi JS, mọi mesh mới hiện diện.

- **2026-07-06 (z)** [XE MÁY]: sửa 3 lỗi người dùng nêu. (1) **Nghiêng xe khi rẽ**: vehicles.js
    `v.lean` nội suy theo turnInput → `mesh.rotateZ` quanh trục tiến (rẽ trái/phải nghiêng, đi thẳng
    thẳng); main.js cho người nghiêng theo (rotation.z=v.lean). (2) **Tư thế ngồi**: character.sit đùi
    đưa trước+dạng, tay vươn ghi-đông, thân chồm (lộ `torso` ra return object). (3) **Bánh trước ngoắc
    sang trái** = do CHÍNH GLB (ảnh gốc chụp xe bánh lệch) → dựng lại moto.glb bằng Meshy-5 từ ảnh
    Super Cub side-profile **bánh trước THẲNG** (silodrome), simplify 33k/612KB. normalizeMoto giữ
    nguyên (front→+Z đúng). moto.glb tải qua raw.githubusercontent (vehicles.js), KHÔNG qua jsDelivr SHA-pin.
- **2026-07-06 (y)** [R3 — CHI TIẾT THÂN THUỘC]: thêm 5 lớp street-life procedural (nhẹ, gộp/instanced)
    dọc phố trung tâm, né sông/cầu (groundHeight+isWater): **xe máy đỗ vỉa hè** (480 InstancedMesh 2
    phần thân-màu/bánh-tối), **cờ đỏ sao vàng** trên cột dọc đại lộ 'p', **băng rôn cổ động** đỏ chữ vàng
    (3 khẩu hiệu công), **cột điện + dây điện chằng chịt** (catenary 4 dây/nhịp, cột ~34m), **xích lô**
    (InstancedMesh gần Nhà hát/chợ/nhà thờ/ga/bưu điện/bảo tàng). Hero xe chạy vẫn moto.glb Meshy.
    Mẫu chung: RNG tất định (LCG seed) để tái lập; đặt theo ROADS_DT p/s trong bán kính ~1300–1400m.
- **2026-07-06 (x)** [VÒNG 1 — NỀN]: VỈA HÈ ĐA DẠNG ĐÚNG TỪNG NƠI (hết "caro mặc định khắp nơi").
    Nghiên cứu: map mỗi road p/s → pano gần nhất (≤60m) → agent thị giác phân loại vỉa hè từ 51 crop
    → **phần lớn phố là XÁM bê tông (gach_xam)**, ca-rô đỏ-xám chỉ ở **bờ sông Tam Bạc/quảng trường**,
    terracotta/con sâu vài đoạn. Sinh `js/sidewalks.js` (SIDEWALK_BY_ROAD theo INDEX road trong
    ROADS_DT — index PHẢI ổn định, đừng regen mapdata làm lệch). world.js: `sidewalkMaterial(type)`
    4 texture tả thực (gach_xam mặc định / caro_do_xam / terracotta / con_sau), layRoad bucket theo
    type, gộp mỗi kiểu 1 mesh. UV bake ~1 texture/1.6m → ô ~0.4m. Cách nghiên cứu vỉa hè: crop pano
    p0 lộ vỉa hè ở phần DƯỚI khung; agent phân loại theo bộ code cố định.
- **2026-07-06 (w)**: HOÀN TÁC nén texture (v) — chủ dự án yêu cầu **100% chất lượng gốc** (cả chân
    dung Bác). Trả toàn bộ GLB về full-res. Kiến trúc phân phối CUỐI:
    (1) **jsDelivr GIỚI HẠN 20MB/file** — phát hiện khi 3 công trình full-res >20MB bị 403
    ("File size exceeded the configured limit of 20 MB"): **Bảo tàng 20.1MB, Quán hoa 22.4MB,
    Lê Chân 29.4MB** → 3 cái này tải qua **raw.githubusercontent** (không giới hạn, CORS `*` ok);
    còn lại qua jsDelivr. (2) **GHIM jsDelivr theo COMMIT SHA** (`ASSETS_SHA` trong assets.js),
    KHÔNG dùng tên nhánh — vì cache nhánh trên jsDelivr **KHÔNG đồng nhất giữa các edge** (edge này
    trả bản mới, edge kia trả bản cũ) sau khi asset đổi; SHA thì immutable + đồng nhất. **Đổi asset
    → phải cập nhật `ASSETS_SHA`** = HEAD nhánh assets-storage. (3) Service Worker `v2` +
    stale-while-revalidate để xoá cache bản nén cũ trong máy người chơi. Bài học: đừng nén lossy
    khi chủ muốn 100%; jsDelivr 20MB limit; branch-ref cache jsDelivr không đáng tin khi content đổi.
- **2026-07-06 (v)**: ~~NÉN TEXTURE~~ *(ĐÃ HOÀN TÁC ở (w) — chủ dự án muốn 100% chất lượng)*. NÉN TEXTURE "nhẹ mà chất lượng tối đa" — **13 công trình 231MB → 68MB (−70%)**,
    gần như VÔ TỔN THẤT (kiểm chứng render trước/sau: tượng Lê Chân, cổng trường, chữ, chân dung Bác
    đều giữ nguyên). Phát hiện: texture chiếm **84–86%** dung lượng GLB, thủ phạm chính là **normal map
    PNG ~8MB** + vài texture **4096**. Pipeline (`tools`/scratchpad `optimize_all.mjs`, dùng
    @gltf-transform + sharp): base JPEG **q94** ≤2048; emissive JPEG q90 ≤2048; normal/MR **WebP q95**
    ≤1024 (WebP ít artifact hơn JPEG cho normal, three.js r160 đọc được qua EXT_texture_webp);
    meshopt geometry. **NGOẠI LỆ Nhà hát lớn**: base GIỮ full-res q97 để **chân dung Chủ tịch HCM chuẩn
    tuyệt đối** (quy tắc bất di bất dịch). GLB là drop-in (cùng hình học/hướng) → KHÔNG đổi world.js.
    Lê Chân 30MB→3MB (texture cũ phí cho tượng đồng tối màu). Đã đẩy assets-storage + purge jsDelivr.
- **2026-07-06 (u)**: TỐI ƯU LOAD "vào là thấy hết, không tải lại" (deploy Vercel + jsDelivr).
    (1) **CDN jsDelivr immutable** thay `raw.githubusercontent` cho GLB (`assets.js` ASSET_BASE =
    `cdn.jsdelivr.net/gh/<repo>@assets-storage/`) — edge toàn cầu, cache 7 ngày, KHÔNG tải lại.
    (2) **Preload SONG SONG cả cụm trung tâm** (mọi model trong bán kính 950m quanh gốc) ngay ở
    màn chờ, 4 cái/lúc; streaming công trình xa 1 cái/lúc (tránh giật). (3) **Thanh tiến trình %**
    dưới nút Bắt đầu (`#preloadBar`, main.js + style.css). (4) **Service Worker** (`sw.js`) cache
    cache-first file nặng (.glb/.hdr/.bin) → lần sau vào hiện đủ NGAY, offline được; KHÔNG cache
    HTML/JS/CSS để app vẫn cập nhật. (5) **vercel.json**: lib/ immutable, sw.js must-revalidate.
    Bài học: raw.githubusercontent KHÔNG phải CDN + cache ngắn = nguyên nhân "load đi load lại".
    Muốn NHẸ hơn nữa (giảm ~250MB → ~70MB): nén texture KTX2/Basis (giai đoạn sau, cân nhắc chất lượng).
- **2026-07-06 (t)**: SỬA HƯỚNG THPT NGÔ QUYỀN (trường Bonnal) — hết lệch. Trường là NHÀ GÓC ở ngã tư
    Phố Nguyễn Đức Cảnh × Phố Mê Linh. Đối chiếu OSM thật (Overpass, around 130m quanh 20.85520,106.67954):
    footprint dài 48–67m chạy theo trục [0.98,−0.20] (SONG SONG Nguyễn Đức Cảnh, tiếp tuyến [0.981,−0.195],
    đường nằm phía BẮC trường); Mê Linh (tiếp tuyến [0.104,0.995]) nằm phía ĐÔNG. Trước đây đặt
    `orientFace([0.992,−0.126])` = mặt tiền quay ĐÔNG (sai ~90°). NAY `orientFace([−0.195,−0.981])`:
    mặt tiền dài (local +Z của GLB, có cổng "NGÔ QUYỀN") quay VUÔNG GÓC ra Nguyễn Đức Cảnh, pháp tuyến
    hướng Bắc — khớp footprint + ảnh Street View "31/32 Nguyễn Đức Cảnh" (nhà vàng Pháp, chớp cửa xanh).
    Bản thân GLB thptnq.glb ĐẠT CHUẨN (kiểm tra render riêng: mặt tiền vàng, cổng NGÔ QUYỀN đúng) — chỉ
    lỗi GÓC QUAY, không cần dựng lại. Kỹ thuật xác minh: dựng trang `glbview.html` render GLB đơn top/front
    để biết trục dài (local X) + mặt tiền (local +Z); orientFace(f)=atan2(f.x,f.z) đưa +Z về hướng f.
- **2026-07-06 (s)**: VƯỜN HOA VẼ THEO ĐÚNG POLYGON Ô ĐẤT (hết lệch với ô bình hành). Min-area RECT chỉ
    đúng khi ô là chữ nhật; ô đất giữa 2 đường cắt xéo là HÌNH BÌNH HÀNH → chữ nhật không khớp, lệch ở 2
    đầu. NAY vẽ cỏ = `ExtrudeGeometry` từ CHÍNH polygon công viên (nong ×1.14 quanh tâm để ra tới vỉa hè,
    GIỮ hình dạng), `shape` toạ độ (x,−z) rồi `rotateX(−90°)` cho ra đúng XZ. Luống hoa/cây CẮT theo
    polygon bằng point-in-polygon (ray cast); lối đi chữ thập khít extent theo trục GU/GV; cây rải dọc
    BIÊN polygon thụt vào 4m. Bỏ hàng rào box (gây dáng chữ nhật). Ảnh 6 vườn: khớp ô, song song vỉa hè.
- **2026-07-06 (r)**: CHẾ ĐỘ ĐẠO DIỄN (`js/cinematic.js`) cho trailer/giới thiệu/cutscene — KHÔNG đụng
    lối chơi (off mặc định; khi bật, animate loop bỏ điều khiển nhân vật, camera do cinematic lo). API
    `window.__cine`: `free()` camera bay tự do (WASD+chuột+Q/E+Shift); `mark()`/`playMarks(sec)` ghi &
    bay qua điểm mốc; `play(keys,sec)` path tự định nghĩa; `demo(sec)` bay giới thiệu dải trung tâm
    (CatmullRom + easeInOut); `startRec()/stopRec('tên')` quay .webm từ `canvas.captureStream()` +
    MediaRecorder(VP9) rồi tải về; `recordDemo()` bay+quay+tải tự động; `stop()` trả camera cho lối chơi.
- **2026-07-06 (q)**: VỈA HÈ + VƯỜN HOA hoàn thiện.
    • Vỉa hè ca-rô: bake UV THẲNG theo hướng từng đoạn đường (rotY) thay vì chiếu phẳng trục thế giới →
      ô ca-rô chạy song song mép đường (hết "ẩu/xiên").
    • Cỏ vườn NỚI RA +8m mỗi biên tới sát vỉa hè (polygon công viên OSM lùi sau vỉa hè nên trước có khe
      đất trống). Lối đi chữ thập KÉO tới mép cỏ → LỐI VÀO lát gạch (bỏ cỏ chỗ vào). Hàng rào chừa CỬA
      giữa mỗi cạnh cho lối vào.
- **2026-07-06 (p)**: VƯỜN HOA KHỚP TỪNG Ô ĐẤT (min-area rect) + gộp container/karst.
    • Vườn vẫn xiên vì dùng CHUNG 1 góc lưới `GU=[0.992,-0.126]` cho MỌI vườn, mà mỗi ô đất có hướng
      riêng (phố cong). NAY mỗi vườn tính HÌNH CHỮ NHẬT BAO DIỆN TÍCH NHỎ NHẤT của CHÍNH polygon công
      viên (`minAreaRect`: thử mọi hướng cạnh đa giác, chọn diện tích nhỏ nhất) → GU/GV/GROT riêng từng
      vườn, cạnh song song mép ô/vỉa hè, phủ tới mép đất. Ảnh top-down: 6 vườn đều khớp ô, hết xiên.
    • Container cảng: gộp theo 5 màu (trước ~340 mesh). Đá karst Cát Bà/Lan Hạ: gộp theo 2 material
      (trước ~440 mesh). Mesh scene 5.942→5.480.
- **2026-07-06 (o)**: HIỆU NĂNG LỚN — GỘP CÂY PROCEDURAL. Trước: `phuongTree`/`shadeTree`/`palm` mỗi cây là
    1 Group ~11-14 mesh, ~8700 cây → mesh scene 13.836, ~8700 draw call = nghẽn FPS chính (review chỉ ra).
    NAY: `bakeTree(group,x,z)` nướng geometry con vào hệ THẾ GIỚI (clone→toNonIndexed→applyMatrix4, chỉ
    primitive nội bộ nên AN TOÀN, khác GLB meshopt), gom theo (material × ô lưới 500m) → `flushTrees()`
    `mergeGeometries` mỗi bucket thành 1 mesh. Kết quả: **13.836→5.942 mesh** (−7.894), draw call cây từ
    ~8700 còn vài chục, VẪN CULL theo ô 500m. Ảnh đối chiếu: cây/hoa/tán y hệt, không hụt. `palm` dùng
    chung `palmTrunkM` (trước tạo material mới mỗi cây).
- **2026-07-06 (n)**: XE MÁY MESHY (ảnh thật Honda Cub đỏ) thay xe procedural + dọn hiệu năng.
    • `assets/moto.glb` (768KB, 43k tris) từ ảnh Wikimedia → Meshy → hậu xử lý (simplify 0.35, baseColor
      1024, `gltf-transform meshopt`). Kích thước gốc 1.91m dài ≈ Honda Cub thật.
    • `vehicles.js`: nạp GLB 1 LẦN → `motoTemplate.clone(true)` mỗi xe (chia sẻ geometry, KHÔNG đụng
      buffer meshopt). `normalizeMoto`: tâm XZ + đáy y=0, xoay `π/2` (đầu xe −X → +Z tiến), scale 1.98/dài.
      Xe spawn trước khi GLB tải xong → hàng `motoPending`, gắn khi xong. Lỗi mạng → `makeMotoFallback` (khối
      tối giản, tránh xe tàng hình). `seatY:0.64 seatZ:-0.05` → nhân vật ngồi HÔNG trên yên (đã kiểm ảnh).
    • Hiệu năng (từ review): main.js hoist vector tạm (camera/mounted/onfoot — hết cấp phát mỗi khung),
      guard `modal khi đang cưỡi` để GIỮ tư thế ngồi; character.js bỏ dòng chết; vehicles.js bỏ alloc `before`.
- **2026-07-06 (m)**: BỔ SUNG PHỐ NHỎ DẢI TRUNG TÂM (thiếu đường ngang sau Nhà hát lớn). Nguyên nhân:
    bộ lọc `if (c==='r' && len<260) continue` cắt các phố residential NGẮN ở lõi (Kỳ Đồng, Đinh Tiên
    Hoàng… chạy ngang ngay sau các công trình). SỬA:
    • `fetch_osm.sh`: thêm `living_street|unclassified` vào truy vấn phố trung tâm.
    • `process_osm.mjs`: `CLS` map `living_street`/`unclassified`→'r'; bộ lọc residential thêm điều kiện
      `&& !isCentralRoad(pts)` (giữ mọi phố nhỏ trong bán kính 1600m quanh Opera).
    • `mapdata.js` `ROADS_DT` sinh lại TỪ OSM TRỰC TIẾP (Overpass, cùng bbox 20.845,106.652,20.884,106.712):
      505→608 tuyến (+103 phố nhỏ lõi). Đối chiếu overlay với OSM thật: khớp, đã có đường ngang sau Opera.
- **2026-07-06 (l)**: VƯỜN HOA KHỚP Ô THEO OBB (sửa "xiên xẹo, ra ngoài đường"). Lưới phố trung tâm
    KHÔNG song song trục XZ mà NGHIÊNG ~7° (trục dọc `GU=[0.992,-0.126]`, ngang `GV=[0.126,0.992]`).
    Trước dùng AABB (bbox theo XZ) của polygon công viên nghiêng → hộp phình to, trùm cả lòng đường.
    NAY: `nearestParkOBB` chiếu đỉnh polygon lên GU/GV để lấy extent+tâm ĐÚNG theo trục lưới; dựng vườn
    trong `THREE.Group` xoay `GROT=atan2(-GU[1],GU[0])`, mọi box con (cỏ/rào/lối) toạ độ LOCAL, còn
    bồn/luống/cây map LOCAL→world bằng `L(ox,oz)=[gx+ox*GU+oz*GV...]`. Kết quả: vườn nằm gọn TRONG ô,
    song song đường (world.js mục "DẢI VƯỜN HOA TRUNG TÂM").
- **2026-07-06 (k)**: KIỂM TOÁN ẢNH STREET VIEW THẬT (3360 ảnh/420 pano ở nhánh `streetview-refs`)
    + DỰNG DẢI TRUNG TÂM GIỐNG THẬT. Công cụ: `tools/gen_sv_coords`, bản đồ phủ (chuyển panoLat/Lng→XZ,
    chấm pano + công trình + đường), helper tìm ảnh nhìn đúng công trình (heading Google=atan2(dx,-dz)).
    ĐÃ SỬA từ đối chiếu ảnh thật:
    • Tượng Lê Chân: dựng cả QUẢNG TRƯỜNG VƯỜN HOA (lối granite đỏ, cây cắt tỉa hàng, chậu cảnh, cột cờ) — trước trơ trọi.
    • Đại lộ trung tâm: thêm CÂY XÀ CỪ tán tròn xanh lớn (`shadeTree`) dọc dải phân cách (mỗi ~22m) +
      hai bên phố lớn (mỗi ~44m, bán kính 850m, CAP 170 cây để giữ FPS) — theo ảnh rợp cây xanh.
    • Nhà ống: ~48% nhà thấp trung tâm mái ngói Pháp, còn lại MÁI BẰNG + BỒN NƯỚC mái (inox/xanh, gộp mesh).
    • Xác nhận ĐÚNG bằng ảnh: trường Ngô Quyền (Pháp vàng cửa chớp xanh), vỉa hè ca-rô đỏ, quán hoa, rạp Tháng Tám.
    TỒN ĐỌNG audit: kiểm vị trí Nhà hát/Nhà thờ (góc gần chưa thấy nhà thờ), liệt kê công trình thiếu, mặt tiền nhà ống.
- **2026-07-05 (i)**: EXTENSION CHỤP STREET VIEW (`tools/streetview-capture/`, v2). Vì máy chủ remote
    chặn Google Maps, làm extension Chrome MV3 chạy TRÊN MÁY CHỦ DỰ ÁN. v2 TƯƠNG TÁC TRỰC TIẾP
    instantstreetview.com (KHÔNG cần API key — tái dùng Google Maps trang đã nạp):
    • `coords.js` = 446 tọa độ bám ĐƯỜNG THẬT dải trung tâm (sinh bằng `tools/gen_sv_coords.mjs`,
      lấy NGƯỢC phép chiếu XZ→lat/lng), gán `window.HP_WAYPOINTS`.
    • `page.js` (world MAIN) dùng `google.maps` của trang → tạo panorama phủ toàn trang, `getPanorama`
      (bỏ điểm không phủ), xoay N góc × pitch; `bridge.js` (world ISOLATED, chỉ nó có chrome.*) chuyển
      lệnh qua postMessage → `background.js` `captureVisibleTab` + `downloads` → `Downloads/hp-streetview/`
      + `manifest.json` (mỗi ảnh gắn tọa độ/panoId/heading/pitch/ngày/bản quyền).
    • Ẩn panel trước khi chụp để không lọt UI. Dùng làm THAM CHIẾU dựng dãy phố (không nhúng pixel Google).
    BÀI HỌC: content script MAIN world dùng được biến JS của trang nhưng KHÔNG có chrome.*; ISOLATED
    world có chrome.* nhưng không thấy biến trang → phải bắc cầu bằng window.postMessage.
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
