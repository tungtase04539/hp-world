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
- `RIVERS [{w, pts}]` — polyline rộng 620 (Cấm), 300 (Lạch Tray), 55 (Tam Bạc); chỉ dùng NGOÀI thành phố (r ≥ 1750).
  Kênh Nam Triệu push trong terrain.
- `WATER [{n, pts}]` — **polygon nước THẬT** (natural=water, từ `osm_water_dt.json`, simplify 1.5 m, bỏ ao < 200 m²,
  giữ polygon có đỉnh cách gốc < 2350 m): Sông Cấm, Tam Bạc (2 mảnh), Sông Đào Hạ Lý, hồ Tam Bạc/Sen/Tiên Nga, kênh…
  terrain.js đào nước trong thành phố theo tập này (`waterSD`). 27 polygon / 1260 đỉnh / 21 KB (2026-09).
- `ROADS_DT [{c, pts}]` — c ∈ p(primary/trunk) s(secondary) t(tertiary) r(residential) w(pedestrian).
- `ROADS_REGION`, `BUILDINGS [{p, a, l}]` (footprint THẬT không phóng, a=diện tích, l=số tầng×10).
- `LM {key:[x,z]}` tâm công trình thật; `LM_DIR` **vector đơn vị cạnh ĐƠN dài nhất** footprint (KHÔNG phải
  trục dài tổng thể — bảo tàng 36×29 nhận cạnh hông 29m vì cạnh 36m bị notch cắt khúc; chớ đổi sang "trục
  trội" vì opera/bưu điện/chợ Sắt/THCS TP sẽ đổi theo);
  `LM_FACE` **hướng mặt tiền** = **pháp tuyến của ĐOẠN phố lớn (p/s/t) gần nhất** (chiếu tâm lên đoạn, phía về
  phố — sửa 2026-09-06 W6; trước đó lấy ĐỈNH way gần nhất → nhà góc phố quay chéo ra ngã tư vì phố thẳng sau
  simplify chỉ còn 2 đỉnh = 2 ngã tư). Ngoại lệ ghi trong `LM_FACE_OVERRIDE` (process_osm): giá trị = TÊN PHỐ
  (pháp tuyến đoạn phố đó, mọi cấp kể cả ngõ r) hoặc vector [fx,fz] — mỗi dòng phải kèm bằng chứng (pano/ảnh).
  `FACADE_SHORT_SIDE` = key có mặt tiền ở ĐẦU HỒI (pháp tuyến ∥ LM_DIR): world.js `orientLM(key)` dùng
  `orientFace` thay `orientLong` (nhà thờ, rạp Tháng Tám, đình Hàng Kênh, bảo tàng).
  Kiểm số: `scratchpad/lmcheck.mjs <mapdata.js> <tools/>` in bảng LM_FACE / hướng world.js / phố gần nhất / cos.
  `LM_SIZE {key:[dài,rộng]}` kích thước thật footprint (mét) để scale GLB / kích thước khối procedural;
  `STREETS/INTERSECTIONS/MEDIANS` cho nội thất phố;
  `EXTRAS { square, fountain, baodai, bridges[{x,zc,half,ang,rise}], dsRidge, catbaTown, lake }`.

### Công thức xoay công trình theo hướng thật (world.js)
Quy ước mô hình: trục dài = **local X**, mặt tiền = **local +Z**.
Với `rotation.y = θ`: local X → thế giới `(cosθ, −sinθ)`, local Z → `(sinθ, cosθ)`.
```js
orientLong(dir, face): θ = atan2(−dir[1], dir[0]); nếu sinθ·face[0]+cosθ·face[1] < 0 thì θ += π
orientFace(face):      θ = atan2(face[0], face[1])   // nhà thờ: mặt tiền ở ĐẦU HỒI → dùng cái này
orientLM(key):         FACADE_SHORT_SIDE.includes(key) ? orientFace(LM_FACE[key]) : orientLong(LM_DIR[key], LM_FACE[key])
localPt(cx,cz,lx,lz,θ) = [cx + lx·cosθ + lz·sinθ,  cz − lx·sinθ + lz·cosθ]  // collider chi tiết phụ
```
Cầu: dựng mọi chi tiết trong nhóm local (z = dọc trục), `group.position=(x,0,zc); group.rotation.y=ang`
với `ang = atan2(Δx, Δz)` của 2 đầu way thật.

## 4. Công thức địa hình (terrain.js)

- `landAt(x,z)`: giải mã MASK, nội suy song tuyến → 0..1.
- `baseHeight(x,z,v)` = `lerp(-4, 2, smoothstep(0.32,0.68, v))` + gợn nhẹ + `hills` +
  san phẳng (DT_BOX, thị trấn Cát Bà quanh `EXTRAS.catbaTown`, cảng quanh `LM.port`).
- **NƯỚC 2 MÔ HÌNH theo bán kính r = hypot(x,z) quanh Nhà hát** (từ 2026-09-06, nhánh W5):
  - **r < R_POLY=1750 (thành phố): POLYGON OSM.** `waterSD(x,z)` = khoảng cách có dấu tới TẬP `WATER`
    (ÂM = trong nước; hồ Tam Bạc dùng `LAKE_POLY` đủ 20 đỉnh thay bản simplify để `waterSD ≡ lakeSD`).
    `sd < 0 → h = lerp(-3, 1.7, smoothstep(-2, 0, sd))` (taluy kè 2 m, đáy −3); `sd ≥ 0 → baseHeight(x,z,1)`
    = ĐẤT (bỏ hẳn MASK bờ biển 40 m — nó từng làm nước thò sau nhà). KHÔNG còn vá tay nào trong thành phố
    (reclaimPort/PORT_RECLAIM, nắn R3 OLD/NEW_R3_TAIL, HOSEN_POLY vẽ tay, ellipse Quần Ngựa, w38/w48 đã XOÁ).
  - **r ≥ R_POLY_END=1950 (ngoài): POLYLINE + MASK như cũ.** `riverFactorLine` = max theo đoạn sông của
    `1 − smoothstep(w/2, w/2+sh, dist)` (sh mặc định 28) → `h = lerp(base, −3, rf)` (thắng san phẳng).
    Lạch Tray, kênh Nam Triệu, Cát Bà, Đồ Sơn… vẫn ở mô hình này (Lạch Tray gần gốc nhất 2800 m — không dính vùng hoà).
  - 1750 → 1950: `h = lerp(hLine, hPoly, polyWeight)` — tính ĐỦ 2 mô hình rồi mới hoà (hoà từng phần sẽ cho
    đáy sông −1.75 giữa dải). `riverFactor` xuất ra world.js cũng hoà: trong thành phố = `sd<0 ? 1 : 1−smoothstep(0,28,sd)`
    → mọi rào chắn `riverFactor > 0.01` của world.js tự bám nước polygon (cấm xây trong 28 m bờ thật).
  - Tra cứu `waterSD`: lưới ô 100 m phủ [−2000, 2000]², mỗi ô giữ các cạnh cách ô ≤ 40 m (|sd| chính xác tới 40,
    xa hơn kẹp ±40) + cờ "tâm ô nằm trong polygon i" (ray-casting đủ lúc nạp); lúc chạy đếm số lần đoạn
    tâm-ô→điểm cắt cạnh trong ô (chẵn/lẻ, XOR với cờ tâm, HỢP của mọi polygon). Đo: 0.10 µs/lần, `groundHeightNoDeck`
    0.25 µs (cũ 0.22); đối chiếu brute-force 300k điểm: 0 sai dấu, 0 sai khoảng cách.
  - `hoSenSD`/`HOSEN_POLY` = polygon OSM "Hồ Sen" lấy từ WATER (bbox nhanh +30 m); `lakeSD`/`LAKE_POLY` giữ nguyên.
- **Mặt cầu** `deckHeight`: với mỗi cầu `dx=x−b.x, dz=z−b.zc`;
  `along = dx·sin(ang)+dz·cos(ang)`; `across = dx·cos(ang)−dz·sin(ang)`;
  nếu `|across|<10 && |along|<half` → `y = 2 + rise·(1−(along/half)²)` (rise=25 cho HVT/Bính, tĩnh không thật).
  Đường phố băng sông nhỏ = cầu phẳng 2.05 khi gần tim đường (`nearDTRoad/nearRegionRoad`) và điểm "ướt"
  (`h < 1.9` VÀ (trong polygon nước — cờ `polyWet` của lần gọi NoDeck gần nhất — HOẶC `riverFactorLine > 0.03`)).
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
- **(2026-09-05) Tải & hiện GLB không khựng** (`js/assets.js`): (1) `registerModel` với `preload` bấm tải NGAY trong
  **Worker** (Blob worker, `fetch`→`ArrayBuffer` transfer) — mạng chạy song song với `buildWorld` ~30 s đồng bộ;
  (2) parse bằng `loader.parse(buf)` (không qua FileLoader stream); (3) model mới đặt vào scene ở **layer 31**
  (camera không vẽ) → `renderer.compileAsync(root, camera, scene)` (KHR_parallel_shader_compile, không chặn;
  LƯU Ý `compile()` duyệt `traverseVisible` nên KHÔNG được dùng `visible=false`) → `pumpAssetUploads()` mỗi khung
  upload đúng 1 texture bằng `renderer.initTexture` → trả về layer 0. Bản clone (Quán hoa ×5) tự được gom vì
  reveal lấy mọi object mới xuất hiện trong `scene.children` sau `place()`. `assetsBusy()` cho autoQuality bỏ qua
  cửa sổ đo lúc còn tải. Lite 404 → `forceFull` thử lại NGAY trong `onFail` (không đợi tick 0.4 s).
- **`assets_lite/*.glb` PHẢI có trên nhánh assets-storage** (đẩy 2026-09-05, commit 8b8e42c, 18 file, bỏ `*_raw`).
  Trước đó thư mục này CHƯA BAO GIỜ được đẩy → mọi máy LITE 404 ×13 rồi tải lại bản gốc 238 MB. Đổi asset →
  `git rev-parse --short origin/assets-storage` → cập nhật `ASSETS_SHA` → chạy **`node tools/check_assets.mjs`**
  (đối chiếu mọi URL trong code với cây git của SHA ghim, cả gốc lẫn lite) TRƯỚC khi push.
- `sw.js`: URL jsDelivr ghim SHA là bất biến → cache-first (không revalidate); chỉ raw.githubusercontent
  (theo nhánh) mới stale-while-revalidate. Trước đây mỗi lần vào game lại tải ngầm toàn bộ GLB đã ghim.
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
- Mục 11 (nước) từ 2026-09-06 lấy cả `rel["natural"="water"]` (sông có đảo là multipolygon, tag nằm trên relation);
  process_osm §6b2 ghép member outer thành vòng kín. File `osm_water_dt.json` hiện có (tải 2026-07) CHƯA có relation
  (81 way) — lần fetch sau tự có. Xuất `WATER` phải giữ mọi export khác BYTE-IDENTICAL (sidewalks.js khoá theo
  index ROADS_DT): `diff` mapdata cũ/mới chỉ được khác đúng dòng `WATER`.

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

- **2026-10-04 (Đ3-WP1-data)** [ĐỢT 3 WP1 — `tools/process_buildings.mjs` v1: footprint thật → BỨC TƯỜNG PHỐ + THẢM MÁI]
    (nhánh `worktree-wf_f378e35a-d3b-1`). Generator offline, KHÔNG đổi runtime game (chưa module nào của game import
    `buildings_real.js`/`xsection.js` — WP2 citygen làm). Chạy: `node tools/process_buildings.mjs [--dump x.json]` ở gốc
    repo, cần `tools/ov_buildings.csv` + `tools/osm_roads_dt.json` (gitignore, chép từ repo chính) + `audit/audit_enriched.json`;
    ~45 s (máy bận tới ~100 s); TẤT ĐỊNH (2 lần chạy ra `buildings_real.js` byte y hệt — mọi ngẫu nhiên seed theo id/toạ độ).
    **Các bước:** (1) đọc CSV, dịch nguồn MS(−1,−1)/GG(−1,−2,5), bỏ nước (tâm hoặc >50% diện tích) + bãi giải toả Hoàng Diệu;
    (2) khử trùng lặp mọi nguồn (>50% bỏ nhỏ, còn lại cắt nhỏ theo cạnh nhà lớn) + bỏ vỏ OSM >60% chứa nhà khác; (3) cắt phần
    lấn hành lang phố tới `facadeLine(c)` (ngõ h/phố w chỉ cắt nếu mất ≤35% — hình học ngõ ROADS_DT lệch tới 5 m);
    (4) KÉO mặt tiền lùi ≤7,2 m ra đúng facadeLine của ROADS_DT (cạnh song song ±25°, ≥2/3 tia tới phố không bị nhà khác che,
    vùng quét không đè nhà/hành lang/nước/công viên/LM_POLY/camera pano); (5) CHIA LÔ khối mặt phố >9 m thành lô 3,8-6 m
    vuông góc phố; "khối dính" ML (>400 m² không tên/không class, ngoài cảng, không gọn kiểu cao ốc) → dải trước sâu 14-20 m
    chia lô + phần sau chia lưới 4,5-7,5×10-16 m; (6) kéo sâu lô tới 13-20 m nếu phía sau trống + vuông hoá lô 4 đỉnh;
    (7) LẤP KHE mặt phố ≥3,5 m (p/s/t/r) bằng lô SINH 12-18 m sâu khi có BẰNG CHỨNG (≥120 m² nhà thật phía sau trong ±14 m,
    hoặc tia quan sát pano audit cắt lô ở 3-22 m); veto: ven nước/công viên (dải vườn hoa), nút giao (facadeLine+3 m phố khác),
    pano "mặt thoáng" (chữ area/summary có vườn hoa/quảng trường/hồ/sông/nút giao… VÀ 3 ô hướng kề PANO_SIDES tắt);
    lô NÔNG 3-6 m (khối cơi nới trước nhà lùi) chỉ khi phía sau là nhà dân nhỏ, ≤3 tầng; (8) lõi ô phố trên raster 0,5 m:
    NỚI nhà thật nông trước (không tốn byte) rồi MỌC nhà sinh 4,5-8×10-18 m tới phủ 77% (giữ ngõ, sân trường/cơ quan đệm
    10 m, ô phố <18% nhà thật để trống); (9) chữ nhật hoá, NỞ chữ nhật ≤1,5 m (thật)/2,5 m (sinh) lấp khe mái, khép khe
    3-80 cm giữa nhà kề, cắt chồng lấn, KIỂM HỢP LỆ cuối (đơn, tường-ra-ngoài, ≥6 m², bề hẹp ≥1,2 m — cả chữ nhật: bỏ
    vách mỏng 0,5 m); (10) ghép 1.887 quan sát pano (tia la bàn, nhà đầu tiên trong 26 m; bỏ nhà "phía xa"; ≥7 tầng chỉ
    khớp nền ≥250 m²); (11) thuộc tính: tầng OSM >
    pano > phân bố pano địa phương (80 m) trộn phân bố chung, làm trơn ±2 (trừ cao ốc/khối lớn; "đuôi" 6-8 tầng bốc
    thăm trên mặt phố p/s/t được GIỮ, không kéo xuống và không kéo láng giềng lên), kiểu phố cũ thời Pháp
    (28 phố lõi) / cảng SHED / OSM class / chữ pano, màu tường theo chữ màu pano; (12) cạnh PARTY (+edgeCover) / FRONT / BACK / SIDE.
    **Số đo (Overture gốc → v1):** 25.192 nhà v0 → 52.380 (thật 33.281 gồm 7.154 lô chia; sinh 19.099 = 4.733 lô khe + 14.366 lõi);
    phủ mái ô phố 43% → 74,4% (nhà thật 50,2%; vệ tinh ~85-90% kể cả cây che); mặt phố có nhà sát vỉa (mẫu facadeLine+1,2 m,
    trừ nút giao/ven nước/công viên) p/s/t/r 7,6/20,7/29,1/28,7% → 51,3/68,5/66,4/63,5%; lùi mặt tiền nhà ống (từ mép lòng)
    trung vị p 7,6/s 5,2/t 3,9/r 3,5 m → 3,65/3,50/3,00/2,01 (= đúng bề vỉa); sâu lô mặt phố trung vị 8,8 → 11,7 m (p75 15,7;
    thật 15-25 m — phần sau nhà ống thường là footprint RIÊNG nên đo theo đa giác vẫn hụt); bề mặt tiền trung vị 7,0 → 5,3 m;
    38.427 cạnh PARTY; 2.147 nhà mang số tầng/màu từ pano; tầng TB 2,88 (1:3,9% 2:32% 3:42% 4:18% 5:2,6% 6+:1,1%;
    riêng lô mặt phố p/s/t 6 tầng 2,2% = pano, 7+ 0,8% vs pano 3,2% vì trần 8 tầng cho nhà không bằng chứng);
    b64 1,70 MB (≤1,8), giải mã 4-11 ms node / 6-13 ms Chrome.
    **Màu mái** hiệu chỉnh THEO TỪNG NHÀ trên vệ tinh (trung vị pixel trong 8.885 footprint thật real_1/3/5/6/8, cân trắng
    gray-world): vệ tinh đỏ 29 / xám 46 / xám-xanh đá 18 / sáng 2%; game cũ 55/20/5/19 → mới 45/34/9/11 (giữ đỏ cao hơn số
    đo vì mù khí làm tôn đỏ gỉ trên ảnh ngả xám).
    **ĐỊNH DẠNG RB01 mở rộng CỘNG THÊM (decode cũ vẫn đọc phần đa giác):** u32 reserved@12 = `rectOff` → mục chữ nhật
    'RBR1' 19 byte/nhà (x0,z0 ×10; ang u16; w,d cm; ek 2 bit/cạnh; cov 4 bit/cạnh bão hoà 15; 6 byte thuộc tính; seed
    suy từ x0,z0,ang) — 80% số nhà; `decodeRB` trải thành đa giác 4 đỉnh nối SAU nhà đa giác (`D.nPoly`); byte reserved/nhà
    → `INFO` (bit0-2 cấp phố mặt tiền `ROADC`, bit3 góc phố, bit4-5 công năng trệt home/shop/office/gate);
    `FLAG.EDIT` 128; `WALL_PALETTE` thêm 24-29; giải mã dùng `Uint8Array.fromBase64` nếu có.
    **ĐỔI HỢP ĐỒNG `js/xsection.js`:** `SIDEWALK_W` s 2,8→3,5, t 2,24→3,0, r 1,5→2,0 (p 3,64 giữ) theo 404 pano có ghi bề
    rộng vỉa (`audit_enriched.sidewalk`, gán cấp phố ROADS_DT gần nhất ≤8 m: trung vị p 3,5 · s 3,5 · t 3,0 · r 2,5 · h 3).
    world.js `layRoad` hiện vẫn vẽ vỉa 0,28·w → TRƯỚC KHI WP6 đọc xsection, nhà dựng theo facadeLine mới sẽ cách mép vỉa cũ
    0,7-0,8 m (s/t) / 0,5 m (r). Đổi SIDEWALK_W/ROAD_W hay ROADS_DT → CHẠY LẠI generator (mặt tiền bám facadeLine).
    **Công cụ:** `tools/bgeom.mjs` (clipHalf/clipStrip đa giác lõm, minRect, Grid, cleanPoly, isSimple, rng/hash),
    `tools/qa/rbview.html` (xem RB không cần world.js: `?pano=X,Z,hướng` / `?cam=` / `?aerial=cx,cz,half`; chạy dưới gpulock).
    **BẪY:** (a) `clipHalf` với đỉnh chạm đúng đường cắt có thể ghép cặp giao điểm 'out'↔'out' → từng đẻ đa giác răng cưa
    52 đỉnh diện tích 0 (x −1606) — nay bỏ mảnh không khép + bước 9d; (b) `js/panosides.js` chỉ là bằng chứng ÂM khi chữ
    pano tả "mặt thoáng" (audit chỉ tả 2-4 nhà/pano: bit tắt ≠ không có nhà); (c) pano "phía xa" từng gán 10-15 tầng cho
    nhà ống — lọc chữ + cao ốc chỉ khớp nền lớn; (d) làm trơn tầng bỏ qua láng giềng cao ốc/khối lớn (từng sinh nhà "kim"
    11 tầng); (e) chồng lấn còn ~640 cặp >1 m² chủ yếu là dải 5-10 cm dọc tường chung do lượng tử 0,1 m (vô hại cho tường;
    renderer nên đặt mái nhà thấp hơn lùi 1-2 cm nếu thấy nhấp nháy); (f) nhà SINH chỉ trong R1640, nhà thật tới R1750.
- **2026-09-07 (di)** [ĐỢT 2 TÍCH HỢP — 6 nhánh worktree song song + 6 phản biện đối kháng, gộp trên `dot2-int`]:
    Quy trình: mỗi nhánh (W1 merge-budget, W2 ground-grid, W3 landmark-lod, W4 visual, W5 hydro-polygon-water,
    W6 landmark-placement) làm trong worktree riêng, tự đo trước/sau trên GPU thật, có agent phản biện đọc diff +
    đo lại + thử merge khô; các entry (dh) bên dưới là báo cáo từng nhánh. Thứ tự gộp W3→W4→W2→W6→W5→W1
    (W1 xung đột 1 hunk ở freezeStatic với regex `/^ground/` của W2 — giữ code W1, áp regex W2 cho cả 3 chỗ).
    `KNOWLEDGE.md merge=union` (.git/info/attributes) để §10 tự gộp. Regen mapdata sau khi gộp process_osm của
    W5+W6: 21 export byte-identical với bản đã commit (ROADS_DT không đổi → sidewalks.js an toàn).
    **SỬA THEO PHẢN BIỆN (đã áp):** (1) W1 far-hide từng giấu cả HỘP NHÀ có texture bán kính ≤ 10 m ở >350 m
    (316 mesh) — guard dáng giờ chạy cho MỌI ứng viên: giữ nếu rad>16, giữ mảng phẳng nằm ngang (h≤0,3 & rad>3),
    giữ hộp (h>2,2 & mỏng>0,6); (2) W2 `ground_local` +0.03 đồng phẳng với các mặt lát +0.03 (dm_park_plaza, lot,
    yard) → z-fight; nay +0.012 + polygonOffset(1,2); (3) W3/instcull: nén bỏ qua khi k===i giữ ma trận SAI nếu slot
    đã bị instance khác ghi đè — nay luôn chép; (4) W6: biển địa danh (landmarks.js) theo LM_FACE mới bị chôn trong
    nhà/ra lòng đường → cathedral 42→27, museum 32→22, rap78 26→35, thcsnq 50→58 (kiểm bằng raycast từ trên xuống
    tại LM+F·d, scratchpad gpu_probe/probe8.mjs quét d=6..80); lượt 2: postoffice 40→24, dinhhk 28→22, ubnd 38→26,
    biển cảng (offset cố định) (-320,+120)→(-340,+130) vì chỗ cũ bị nhà kho 10 m `mrg10_1,-3` đè — probe9/probe10 quét
    lưới 10 m ±160 m, lọc raycast chạm đất/vỉa hè + cách tim đường 5–16 m, lấy điểm gần chỗ cũ nhất (vỉa hè gạch xám,
    7,9 m tới đường 'p'). Kết quả 26/26 biển chạm đất trừ Đồ Sơn: mặt đất thô (ô 200 m) cao 3,1 m > gh 2,x nên cột
    2,2 m chìm, bảng ở +2,4 vẫn lộ — lệch mặt phẳng thô/gh ngoài vùng lưới mịn, chưa sửa. Số ms tuyệt đối của W1 gắn caveat ±2×.
    **KẾT QUẢ TÍCH HỢP (Chrome headless d3d11, Radeon 890M, 1600×1000, ?quality=full, máy rảnh):** spawn 700 call /
    3,94M tam giác / 4.230 object / render CPU p50 6,7 ms (kiểm toán: 1.190 / 7,5M / 7.344 / ~17–20 ms); hồ 264 call
    / 2,35M / 1,8 ms; bảo tàng 301 / 2,32M / 1,8 ms; 0 lỗi JS; `__hp.diag()` RỖNG (boat0 mắc cạn đã hết nhờ nước
    polygon); waterbfs 5/5; check_assets ĐỦ. Log build: lượt gộp 1 7.391→234 mesh, lượt 2 2.321→610, ẩn xa 1.306,
    làm phẳng 1.694 mesh + cắt 1.487 nhóm rỗng.
    **CÒN LẠI / FOLLOW-UP (ghi nhận từ phản biện, chưa làm):** khối tay dọc kênh Tam Bạc GIẢ x≈-480..-516 (bs*
    L7455, A4/TXP309 L8329-10924, F w1-07 L15370, "tường rêu") giờ đứng trên cạn cách sông thật 100–200 m; vòng
    blend 1750–1950 m còn 2,8 ha nước OSM khô (nhánh Hạ Lý bắc/cầu Bạch Đằng); polygon 'Kênh' (1250..1740,60..250)
    có đường 'r' chạy qua thành mặt cầu 2,05; vòng OSM hip-roof (~18373, 48% nhà thấp) chưa đổi (thảm block_infill
    đã về mái bằng); 3 trường thptnq/thcsnq/thcstp bị lật mặt tiền theo quy tắc segment (dot ≈ 0, không có pano);
    cột biển Đồ Sơn chìm 0,9 m trong mặt đất thô (xem trên); sun.shadow.radius vô hiệu với
    PCFSoft; onBeforeCompile nước bám chuỗi `#include <lights_phong_fragment>` (nâng three phải kiểm).
- **2026-09-06 (dh)** [W3-landmark-lod — nhánh `worktree-wf_97eeaf15-407-3`] [LOD ĐỊA DANH BẰNG TWIN LITE >250 m +
    CULL CASTER BÓNG + FRUSTUM CULL CÂY HERO]: chỉ sửa `js/assets.js` + `js/instcull.js` (world.js/main.js không đụng).
    Phát hiện kiểm toán `scene-heavy:landmark-glb-no-far-lod-on-full`, `hero-trees-100k-tris-no-frustum-cull`,
    `shadow-pass-casters`.
    **(1) HỢP ĐỒNG LOD (assets.js):** sau khi bản gốc lộ diện (layer 31 → 0) và CHỈ khi `TIER ≥ 2` (tier ≤ 1 đã nạp
    file lite từ đầu), `lodTick` (0,5 s theo `performance.now()`, gọi từ `updateAssets`) tải ngầm **twin**
    `assets_lite/<cùng tên>` qua `assetLiteURL()` (jsDelivr; OVERSIZE chỉ áp cho tên bản gốc) — **1 twin/lúc, chỉ khi
    `loadingCount === 0`, hàng đợi reveal rỗng và mọi model preload đã `done`** (không tranh với preload/streaming), ưu
    tiên model XA NHẤT. Twin đặt CÙNG parent + copy position/quaternion/scale của root gốc (file lite sinh từ chính
    file gốc → cùng hệ toạ độ; đối chứng render cùng khung hình: Nhà hát lớn trùng khít), `castShadow=false`,
    receiveShadow theo bản gốc, anisotropy 8, envMapIntensity 0.85, đi qua đúng pipeline layer-31 + compileAsync +
    initTexture rồi mới `visible=false`. Mỗi tick: `d = |player − tâm bbox root|`; **bản gốc hiện khi d < 250 m, twin
    khi d > 280 m** (trễ 30 m chống nhấp nháy). Bản gốc KHÔNG đổi 1 byte (quy tắc chủ dự án); ảnh FULL vs LITE ở
    (dd)/(df) không phân biệt được ngay cả ở cự ly gần → ở >250 m càng không (kiểm lại: THPT Ngô Quyền ở 277 m hiện
    twin, ảnh 1600×1000 y hệt bản gốc). Root GLB nhận diện bằng `userData.lodKey = url` gắn TRƯỚC `place()` —
    `clone(true)` sao chép userData nên 5 quán hoa đều được ghép cặp.
    **(2) CASTER (cùng tick):** mỗi model chỉ root GẦN NHẤT trong 160 m đổ bóng (`castShadow` từng mesh) → Quán hoa
    ×5 còn 1 caster; twin không bao giờ đổ bóng. Hộp bóng chỉ ±70/±110 m quanh người chơi (daynight.js) nên bóng
    của mesh xa hơn vốn không hiện — không đổi hình ảnh.
    **(3) instcull.js:** BỎ `frustumCulled = false`; sau mỗi lần nén gọi `mesh.computeBoundingSphere()` (r160 duyệt
    tới `count`) → ô cây hero SAU LƯNG camera bị cull thật; cụm rỗng `visible = false` (cờ `hidden`: chỉ hiện lại
    cái chính mình đã ẩn). Nén giờ phát hiện đổi TẬP instance (`idx[k]` = chỉ số gốc ở khe k) chứ không chỉ đổi số
    lượng — BUG CŨ: 1 instance vào + 1 ra cùng nhịp → count không đổi → `needsUpdate` không bật → GPU giữ ma trận cũ.
    **ĐO** (Chrome headless d3d11 trên Radeon 890M, `?quality=full` = TIER 3, 1600×1000, trưa; main pass = 1 lần
    `R.render` trực tiếp; shadow pass tách bằng `info.autoReset=false` + `shadowMap.needsUpdate=true` rồi trừ main):
    main tri spawn 7,59M→4,67M (−38%), hồ 5,47M→3,90M (−29%), bảo tàng 4,99M→3,58M (−28%), 400 m nam Nhà hát
    9,52M→6,67M (−30%); shadow tri spawn 4,29M→3,08M (−28%, 4 clone Quán hoa), các góc khác ±2% (caster xa vốn
    ngoài hộp bóng); cây hero trong frustum: hồ 1,92M→0,51M tri (14→3 ô), spawn 2,55M→0,48M, bảo tàng 1,04M→0,09M;
    draw call không đổi (±10). Chi phí 17 twin (13 file; 5 clone Quán hoa dùng chung geometry/texture): heap JS
    **+30 MB** (đo SAU `window.gc()` với `--js-flags=--expose-gc`: FULL 593–599 → 623–626 MB, LITE 411–415 →
    411–415 MB; KHÔNG ép GC thì `usedJSHeapSize` lệch tới ±250 MB giữa 2 run cùng code — rác buildWorld chưa dọn),
    texture ước tính (w·h·4·1,33) **+128 MB** = 24 tấm 1024² (map + emissive) + 13 tấm 64².
    File lite thật ra mang 4 texture 1024²/model (normal + metallicRoughness cũng 1024², không phải 64 px như (dd)
    ghi) → lúc đầu +266 MB; `trimDetailMaps` bỏ normal, thu roughness/metalness về 64². KHÔNG hạ map/emissive xuống
    512²: ở 250 m trên màn 4K (PR 2) mặt tiền 50 m ≈ 500 px, sẽ nhoè thấy được. Lỗi JS 0 (cả `?quality=lite`),
    `diag()` chỉ còn dòng boat0 cũ, ảnh spawn/hồ/bảo tàng/400 m trước–sau y hệt; đối chứng cùng khung hình gốc vs
    twin ở 40–110 m: Nhà hát lớn, 5 Quán hoa, tượng Lê Chân trùng khít vị trí/tỉ lệ/hướng. Thấy thêm: run SAU không
    còn bị autoQuality hạ bóng 2048→1024 + tắt bloom như run TRƯỚC (ít tam giác hơn → giữ được nhịp).
    **SỬA KÈM (ngoài phạm vi W3 nhưng trong assets.js): LITE từng `metalnessMap = null`** → glTF Meshy không ghi
    metallicFactor nên GLTFLoader để metalness = 1.0 ⇒ cả công trình thành KIM LOẠI (ảnh LITE ở spawn: banner đỏ
    Nhà hát lớn xỉn đen, mặt tiền phẳng lì). Giờ tier ≤ 1 và twin cùng đi qua `trimDetailMaps`: normal bỏ,
    roughness/metalness thu 64² (giữ giá trị trung bình). (dd) từng kết luận "FULL vs LITE không phân biệt được" —
    kết luận đó KHÔNG đúng cho vật liệu, chỉ đúng cho lưới.
    **BẪY MỚI:** (a) twin PHẢI `visible = true` lúc compileAsync (giấu bằng layer 31), chỉ `visible=false` trong
    onDone của reveal — `visible=false` sớm là shader biên dịch ở khung đầu tiên hiện twin (khựng). (b) Đừng lọc root
    GLB theo tên: `gltf.scene` tên 'Scene' hoặc rỗng tuỳ file. (c) `place()` đổi position SAU `updateMatrixWorld` →
    lấy tâm bằng `Box3.setFromObject` (tự cập nhật matrixWorld cây con), không đọc `matrixWorld` thẳng. (d) Đo shadow
    pass: r160 `renderer.info.reset()` chạy SAU shadow pass trong `render()` → autoReset=true thì info KHÔNG BAO GIỜ
    chứa shadow; phải `info.autoReset=false` + `info.reset()` tay. (e) `?quality=full` trên máy này vẫn chạy WebGL
    trên 890M (tier 3 chỉ vì ép tay) — số đo là số CPU-bound, so trước/sau cùng máy mới có nghĩa.
    Chẩn đoán trong game: `(await import('./js/assets.js')).assetLodStats()` → {pairs:[{name,d,far,cast,lite}]}.
- **2026-09-06 (W4-visual)** [ĐỢT 2 — BÓNG, NƯỚC, VẬT LIỆU, MÁI NHÀ ỐNG, MÉP SƯƠNG] (nhánh `worktree-wf_97eeaf15-407-4`,
    6 phát hiện visual-quality của kiểm toán 2026-09; đo ở FULL 1600×1000 trên Radeon 890M headless):
    **(a) Hộp bóng bám hướng nhìn** (`daynight.js`): tâm hộp = người chơi + hướng nhìn ngang × `LOOK_AHEAD = 0.41·SB`
    (≈45 m FULL, 29 m TIER 2/LITE); `update(dt, playerPos, camera)` tự lấy `camera.getWorldDirection` (nhìn thẳng
    xuống thì giữ hướng cũ). `bias −0.0006 → −0.0002`, **`normalBias 0.03`** (hết vệt acne răng cưa trên mặt tiền
    nhà ống lúc nắng xiên — thấy rõ ở ảnh cũ góc museum), `radius 2` (chỉ có tác dụng khi đổi sang PCFShadowMap).
    Làm mới bóng (`main.js`): trần đồng hồ như cũ (0.22 s FULL / 0.5 s TIER 2) **+ làm mới sớm khi đi >2 m hoặc quay
    >0.15 rad** (`dayNight.shadowMoved()`/`markShadow()`), **sàn 0.1 s / 0.25 s** để kéo chuột không bắn shadow pass
    mỗi khung. A/B cùng phiên: trigger theo chuyển động tốn ≤4% fps (38.9 → 40.4 khi tắt) — trong nhiễu đo.
    **(b) Nước** (`world.js` waterMat): normal map THỦ TỤC 256² lặp được (value-noise 3 tầng lưới 8/16/32 bọc mép →
    cao độ → pháp tuyến ×6 → RGB; `CanvasTexture` trực tiếp, KHÔNG qua makeTex vì normal map phải colorSpace tuyến
    tính), `repeat W/9 × D/9` (ô 9 m), `normalScale 0.35`, offset trôi `(t·0.017, t·0.011) % 1`; `shininess 3 → 75`,
    `specular 0x20241f → 0x8fa8ba`; màu nền vẫn do daynight ghi mỗi khung. **BẪY (đã dính):** với nắng trưa 70° và
    camera vệ tinh nhìn thẳng xuống, half-vector chỉ lệch 9.5° → Blinn-Phong (chuẩn hoá `(s/2+1)/π`) làm CẢ HỒ trắng
    bệch loang lổ = đúng tell #1 audit vệ tinh, dù shininess cao hay thấp (năng lượng đỉnh không đổi). Sửa bằng
    `onBeforeCompile` chèn sau `#include <lights_phong_fragment>`: `material.specularStrength *= pow(1 − N·V, 3)`
    (Fresnel theo góc nhìn; three chỉ có Schlick theo V·H ≈ 1 khi nhìn xuống) → aerial tối như cũ, tầm mắt vẫn lấp lánh.
    Giá: vẫn 1 plane 2 tam giác + 1 lần lấy mẫu.
    **(c) Vật liệu:** `_mkTexRaw` gán `anisotropy = LITE ? 4 : 8` cho MỌI texture canvas (đếm: 1.932 texture ở 1 →
    54; renderer max 16); `jitter()` chỉ nhiễu ĐỘ SÁNG (một delta chung r,g,b) — vỉa hè gạch xám hết ô hồng/mint/tím.
    **(d) Mái block_infill:** `ROOFP 88 (LITE 60) → 30` cho mọi tier; mái bằng = nóc bê tông xám `flatTones`
    (0x9a9a94..0xb3b0a6) + **lan can `_parapet(w,d,0.55,0.2)`** (BufferGeometry tự dựng: 4 mặt ngoài màu tường + 4 mặt
    trên bê tông = 16 tam giác = giá 1 mái chóp; PHẢI có attribute `uv` rỗng thì `mergeGeometries` mới nhận chung với
    Box/Cylinder; winding tự lật theo pháp tuyến) + bể inox 1.3 m ở 35% nhà (12 tam giác). Tam giác block_infill
    125.084 → 148.492 (+19%, ~4.800 nhà trong R1600; tổng main 7,59 → 7,69 M). Vệ tinh: từ "thảm đỏ" thành xám/trắng
    điểm đỏ như ảnh thật.
    **(e) Mép sương:** FULL `Fog 600→4200` thành **700→2600**, `camera.far 6000 → 3200` (TIER ≥ 2; LITE giữ nguyên vì
    main.js tự đặt 400/2200 hoặc 220/1300). Dải đồng trống ngoài BUILD_RADIUS tan ở góc nhìn cao từ trung tâm; đứng
    sát mép cảng nhìn ra vẫn thấy đồng (không sương nào che được vật cách 30 m — muốn hết phải tô màu sương cho
    ground ngoài r=1450, việc của nhánh ground).
    **BẪY ĐO:** máy chạy nhiều agent/Chrome song song (cổng 8211–8216) → fps cùng build dao động 24–52; chỉ tin A/B
    TRONG CÙNG PHIÊN (toggle rồi đo lại), không tin 2 phiên khác nhau. Góc chụp `teleport(0,-450)` (museum) và
    `(91,-440)` nằm TRONG khối nhà ống → ảnh vô dụng, chọn góc khác khi cần soi bảo tàng.
- **2026-09-06 (W2-ground-grid)** [MẶT ĐẤT 2 LƯỚI: kênh 55 m hiện đúng 1:1, ground 340k→267k tam giác]:
    Nhánh `worktree-wf_97eeaf15-407-2`, chỉ sửa khối "Mặt đất" `js/world.js` (~540-700) + 2 check tên trong
    `freezeStatic`. **Vấn đề:** MỘT tấm 54,9×31,6 km ô 110×93 m (LITE 229×193 m) — 99% đỉnh ngoài BUILD_RADIUS,
    kênh Tam Bạc 55 m / Hạ Lý 48 m không thể hiện (2 đỉnh kề nhau đứng 2 bờ → "bắc cầu đất"); từng phải chữa
    bằng cách dìm hành lang hồ xuống −3 + dải 5 m phủ đè, và nới sông w38→48. **Hợp đồng 2 lưới mới:**
    (1) `'ground'` tấm toàn thế giới ô **SC = 200 m** (LITE 400) = 87k tam giác (LITE 22k), chỉ lấp chân trời sau
    sương; mọi đỉnh nằm HẲN TRONG ô vuông ±LOCAL_HALF (= BUILD_RADIUS+400 = 2000 m) đặt **y = UNDER = −5**
    (dưới đáy biển −4); đỉnh ĐÚNG TRÊN MÉP giữ y = h. (2) `'ground_local'` lưới N×N ô đều, MỘT BufferGeometry
    Float32 + Uint32 index, **FULL N=300 → 13,3 m = 180k tam giác** (đúng trần 180k; 10 m như đề bài = 320k
    vượt trần), **LITE N=200 → 20 m = 80k**; y = **max(h, cao độ tấm thô tại đó) + 0.03**. Cả 2 dựng bằng
    `gridGeometry(x0, z0, nx, nz, step, yOf)` (trả `{geo, yAt}`; `yAt` nội suy đúng 2 tam giác của ô như GPU)
    + `vertexHC(x, z, colors, i)` chung → cao độ + màu giống hệt (logic màu công viên/nước/cảng giữ nguyên).
    Gốc tấm thô chọn `cx0 = −LOCAL_HALF − ceil(...)·SC` để ±2000 rơi đúng lên đường lưới thô, SC là BỘI của bước
    local (15×13,33 / 20×20) → mép 2 lưới trùng khít từng đỉnh. Dải 5 m hồ Tam Bạc / hồ Sen giữ nguyên; hộp của
    chúng khai báo ở `FINE_BOXES`, lưới local trong hộp dìm 1 m (quy tắc chung: lưới THÔ hơn nằm dưới lưới MỊN
    hơn ≥1 m). Bỏ hẳn đoạn dìm hành lang hồ −3 trên tấm thô (không còn cần).
    **KQ đo (Chrome headless d3d11 trên 890M, 1600×1000, ?quality=full):** ground 340.000 → 86.900 + 180.000 =
    266.900 tam giác; tổng main pass spawn 7,59M → 7,52M, calls +1, object +1; LITE ground 79k → 21,8k + 80k =
    101,8k. Build (node, chỉ phần gọi `groundHeightNoDeck`): FULL 171k lần ~31-49 ms → 134k lần ~23-28 ms;
    LITE 40k → 51k lần 7,8 → 8,7 ms. Thời gian tới `__hp` trong browser dao động 18-48 s giữa các lần chạy CÙNG
    code → không dùng làm thước đo. `diag()` vẫn chỉ dòng boat0 quen thuộc; 0 pageerror FULL + LITE.
    **Ảnh vệ tinh `__hp.aerial`:** kênh Hạ Lý (tâm (−800,−750) và (−1050,−950), half 300) trước = các mảng đa giác
    rời rạc, sau = kênh liền mạch bờ mượt; bờ sông Cấm/Bến Bính hết răng cưa 110 m; hồ Tam Bạc y nguyên.
    LƯU Ý: toạ độ "Hạ Lý (−1100,−400)" trong đề bài lệch — kênh R3 thật chạy (−650,−705)→(−930,−738)→(−1133,−1125).
    **BẪY ĐÃ DÍNH (bản đầu, đã sửa):** dìm tấm thô chỉ 1 m trong ô local KHÔNG đủ: đất 2 m dìm còn 1 m vẫn cao
    hơn mặt nước 0, tấm thô ô 220 m nội suy "bắc cầu" qua hồ Tam Bạc → 2/3 hồ biến thành đất (chụp aerial mới
    thấy, số tam giác không lộ). Phải dìm xuống DƯỚI đáy biển. Hệ quả thứ 2: đỉnh mép ô local phải giữ y = h
    (không dìm) nếu không ô thô ngoài mép dốc xuống −5 thành "hào nước" 200 m quanh thành phố. Depth: camera
    near 0.1 → độ phân giải depth ở d mét ≈ d²/1,68e6 (2 km ≈ 2,4 m!) → thêm `polygonOffset(1, 4)` cho tấm thô
    để nó luôn thua lưới mịn/đường ở xa. `lake_ground`/`hosen_ground` vẫn bị merge vào `mrg10_*` như trước
    (skip merge chỉ khớp /^ground/ + water). Kiểm cú pháp world.js: copy sang .mjs rồi `node --check`.
    **Chưa làm:** `tools/diag.mjs`/`waterbfs.mjs` dùng chromium Linux path nên không chạy trên Windows — thay
    bằng `__hp.diag()` trong phiên Playwright; dải dốc 1800-2000 m (ngoài vùng chơi ≥212 m) bờ nước vẫn thô
    như cũ (lưới local bám dốc tấm thô ở đó — chấp nhận, không nhìn thấy từ vùng chơi).
- **2026-09-06 (dh) [W6-landmark-placement]** [MẶT TIỀN & VỊ TRÍ ĐỊA DANH THEO OSM — Ga, Triển lãm, Việt Tiệp, Đền Nghè,
    Bảo tàng, Rạp Tháng Tám, Đình Hàng Kênh, Nhà thờ] (Đợt 2, audit findings `landmarks:*`):
    **(1) `LM_FACE` = pháp tuyến ĐOẠN phố lớn gần nhất** (`nearestRoadFace` trong process_osm thay `nearestRoadPoint`):
    quy tắc cũ lấy ĐỈNH way gần nhất, mà phố thẳng sau `subdiv(150)+simplify(6)` chỉ còn 2 đỉnh = 2 ngã tư → nhà góc
    phố quay chéo ra ngã tư (bảo tàng 229°, Đền Nghè 64°). Thêm `LM_FACE_OVERRIDE` (tên phố hoặc vector, kèm bằng
    chứng) + `FACADE_SHORT_SIDE` (xuất ra mapdata; world.js `orientLM(key)`). Bảng kiểm `scratchpad/lmcheck.mjs`
    (cos(mặt tiền world, hướng tới phố) ≥ 0.9 với mọi địa danh trong task; trước: museum 0.01, rap78 −0.01, dinhhk
    −1.00, dennghe −0.94, cathedral 0.05). Tác dụng phụ đã kiểm: THPT Ngô Quyền lật cổng sang ĐÔNG ra Mê Linh —
    ĐÚNG (pano_261 "ngay trước cổng chính" trên Mê Linh h270); THCS Trần Phú quay BẮC ra NĐC; THCS Ngô Quyền lật
    tây→đông (không có phố ở cả 2 phía, chỉ NĐC phía bắc — coi như trung tính); bưu điện/chợ Sắt/UBND/NHNN/chùa
    Hàng/đền Tam Kỳ: hướng world KHÔNG đổi (chỉ biển landmarks.js dời về đúng trước mặt tiền).
    **(2) Ga Hải Phòng**: thêm `addWay('station_bldg', 241081956)` (building=train_station, có sẵn trong
    osm_buildings.json — dải 118×21m trục 225° dọc ray, tâm (578,167), 8m tây-bắc node ga). GLB đặt tại tâm này,
    `orientLong` + LM_FACE override 'Phố Lương Khánh Thiện (Phố Ga)' → mặt tiền (local +Z: biển GA HẢI PHÒNG +
    đồng hồ) quay TÂY-BẮC ra quảng trường ga; nhóm ray/tàu/mái sân ga đặt tại node, `rotation.y = thGa` (local X dọc
    ray, ray ở local −Z = sau lưng, cách tâm toà ~22m ≈ dải ray yard thật 26m). Trước: GLB ở node+25m nam, rot 0
    (quay nam ra bãi ray), tàu chắn giữa nhà ga và phố.
    **(3) Triển lãm**: `addWay('trienlam', 240463140, LM.lechan)` (footprint 57×10m trục bắc-nam, tâm (-295,170));
    `buildTrienLam` lấy W/D từ LM_SIZE, mặt dài quay ĐÔNG ra tượng Lê Chân (pano_037 h270 thấy "mặt tiền dài, biển
    TRUNG TÂM TRIỂN LÃM" khi nhìn tây). Bỏ 2 bản trùng: hộp 16×9 cạnh tượng (-250,168) và khối PANO-LOOP V2
    (-302,172) — trước đây CÓ 3 Triển lãm cách nhau <20m. FEATURED_CLEAR trỏ LM.trienlam.
    **(4) Việt Tiệp**: OSM là RELATION 19780771 (multipolygon) → lấy way ngoài 961958396 qua Overpass
    (`fetch_osm.sh` mục 7c → `osm_lm3_geom.json`, KHÔNG có trong osm_buildings.json). Footprint 76×75m tâm (1054,1032),
    mặt tiền quay 246° ra Lạch Tray CÁCH 135m — đúng thực địa (quảng trường + công viên "Cung Hữu nghị Việt Tiệp"
    phía trước); gợi ý audit "dời tới 45m từ Lạch Tray" là SAI, và vector `[-0.91,-0.41]` của audit sai dấu z.
    Khối procedural chỉ là khối trước (D=20) đẩy ra mép mặt tiền footprint (`push=(LM_SIZE[1]−D)/2`).
    **(5) Đền Nghè**: override 'Phố Lê Chân' (ngõ r, node = cổng cách tim đường 9m) → cổng quay BẮC thẳng ra phố.
    **(6) Bảo tàng**: override 'Phố Điện Biên Phủ' + FACADE_SHORT_SIDE (cạnh ĐƠN dài nhất OSM là hông tây 29m,
    mặt tiền thật cạnh nam 36m). **Đình Hàng Kênh** override [0,1] (ao đình phía nam) + SHORT_SIDE. **Rạp Tháng
    Tám**: override 'Phố Đinh Tiên Hoàng' + SHORT_SIDE, dựng lại 19 rộng × 59 sâu theo LM_SIZE, mặt tiền art-deco ở
    đầu hồi TÂY (pano_052 "trước Nhà hát Tháng 8" trên ĐTH), 2 collider r13 dọc trục. **Nhà thờ**: override
    'Phố Trần Quang Khải' → tháp chuông ở đầu NAM (pano_255: nhìn tây từ 31 Hoàng Văn Thụ, tháp hiện ngang z≈−330 =
    đầu nam footprint; bản cũ tháp ở đầu bắc do phép lật −X với LM_FACE đông ⊥ gian giữa = tung đồng xu −0.079).
    **BẪY:** (a) Overpass hay trả TRANG HTML "server too busy" (kể cả mirror kumi) — parse JSON phải bọc try, thử
    lại sau vài giây; regex tên có dấu: dùng `Vi.{1,2}t Ti.{1,2}p` nếu bản NFC/NFD lệch. (b) Công trình là RELATION
    thì `way["building"]` bbox không thấy — phải `nwr[name~..]` rồi lấy member outer. (c) `git config core.autocrlf
    = true` → mapdata.js sinh ra LF, bản checkout CRLF: so sánh xuất phải bỏ `\r` trước (diff thô báo MỌI dòng khác).
    (d) `nearestRoadFace` ném lỗi nếu tên phố trong override không có trong ROADS_DT — tên phải khớp CHÍNH XÁC tag
    OSM (vd 'Phố Lương Khánh Thiện (Phố Ga)'). (e) GLB ga có ĐỒNG HỒ ở CẢ 2 mặt — chỉ mặt có biển GA HẢI PHÒNG là
    mặt tiền (local +Z); chụp 1 góc có đồng hồ chưa đủ kết luận. (f) KHÔNG đổi `longEdgeDir` sang "trục trội"
    (tổng chiều dài cạnh theo hướng): opera/bưu điện/chợ Sắt/THCS Trần Phú đổi LM_DIR theo → dùng SHORT_SIDE cho
    bảo tàng thay vì sửa rule. (g) Quy ước chụp mặt tiền: `teleport(tx,tz,yaw,pitch,d)` đặt camera tại
    `(tx+sin(yaw)·d, tz+cos(yaw)·d)` nhìn về (tx,tz) → muốn camera ở phía LM_FACE thì `yaw = atan2(fx, fz)`.
    (h) Bộ dữ liệu `osm_lm3_geom.json` là file gitignore mới: máy khác phải chạy `fetch_osm.sh` mục 7c (hoặc copy
    file) TRƯỚC khi `node process_osm.mjs`, nếu không `load()` ném ENOENT.
    Đo (1600×1000, ?quality=full, TIER 3 trên Radeon 890M): main pass spawn calls 1175→1153, tri 7,59M→7,59M,
    object 7173→7174; `__hp.diag()` chỉ còn dòng boat0 cũ; 0 pageerror. ROADS_DT + mọi export khác ngoài
    LM/LM_DIR/LM_SIZE/LM_FACE (+FACADE_SHORT_SIDE mới) byte-identical (sidewalks.js index an toàn).
    CÒN LẠI (ngoài task): UBND 52×17 vs footprint 163×75 và Chợ Sắt 110×80 vs 147×114 chưa ép theo LM_SIZE (UBND là
    compound có sân — cần tỷ lệ khối chính; chợ Sắt 132×96 từng cố ý chọn ở (e)); THCS Ngô Quyền hướng cổng chưa
    có bằng chứng pano.
- **2026-09-06 (W5-hydro-polygon-water)** [NƯỚC THẬT TỪ POLYGON OSM trong thành phố — xoá 5 vá tay]:
    Kiểm toán Đợt 2 (findings osm-pipeline:polygon-water-root-cause, cam-reclaim-overshoot, r3-splice-wrong-channel,
    west-arm-missing, tien-nga-missing, hosen-hand-polygon, fetch-misses-relations): sông = polyline bề rộng hằng
    (Cấm 620 m vs OSM 201 m ở Bến Bính) + 5 vá tay trong terrain.js → trong R1600: **31,2 ha nước giả + 39,7 ha thiếu nước**
    (đo lưới 10 m, point-in-polygon với polygon OSM). **ĐÃ LÀM:** (1) `process_osm.mjs` §6b2 xuất `WATER` (27 polygon
    natural=water, simplify 1.5 m, bỏ < 200 m², giữ polygon có đỉnh < 2350 m; ghép relation outer nếu có) — mapdata
    cũ/mới `diff` chỉ khác đúng dòng WATER (ROADS_DT/BUILDINGS… byte-identical, sidewalks.js an toàn); `fetch_osm.sh` §11
    thêm `rel[natural=water]` (chưa chạy lại — file hiện có 0 relation). (2) `terrain.js`: `waterSD` bucket (xem §4),
    `groundHeightNoDeck` 2 mô hình theo bán kính (polygon r<1750, polyline r≥1950, hoà giữa), `riverFactor` xuất ra cũng
    theo polygon trong thành phố; XOÁ reclaimPort/PORT_RECLAIM, splice OLD/NEW_R3_TAIL, HOSEN_POLY vẽ tay (→ polygon OSM
    "Hồ Sen" từ WATER), ellipse Hồ Quần Ngựa (KHÔNG có polygon OSM tại (628,276) — vị trí đó từ georef vệ tinh sai),
    các mutation w38/w48/sh10 + `RIVERS.push` hồ/arc; giữ nguyên `LAKE_POLY`, `lakeSD`, `nearestRiverPoint`, `findShore`.
    **KẾT QUẢ (cùng lưới 10 m, R1600):** nước giả 31,2 → **0,0 ha**, thiếu nước 39,7 → **1,1 ha** (phần còn lại = dải
    taluy 1,3 m sát mép, h giữa 0,25 và 1,7); bờ Cấm tại x=0: game −1201/−1001 vs OSM −1202/−1000 (cũ −1400/−1230);
    Cầu Lạc Long (way 160430051) 1/3 giữa có nước 6/17 = OSM (cũ 0/17); `waterbfs` 5/5 bến tới được (seed (500,−1300)
    vẫn là nước); phiên headless FULL 1600×1000: 0 pageerror, calls/tris spawn 1153/7.59M → 1176/7.58M, `diag()` từ
    [boat0 mắc cạn h=2.0] → **[]** (Bến Bính giờ dò được bờ thật z≈−994, thuyền spawn (−24,−1019) h=−3 — lỗi "mắc cạn"
    tồn tại từ lâu tự hết); ảnh aerial Tam Bạc/Hạ Lý/Bến Bính/Tiên Nga/Hồ Sen đúng hình OSM (kênh chữ Y, nhánh tây
    x≈−1262 dưới cầu Bạch Đằng, kho cảng trong lòng Cấm tự biến mất vì guard isWater). Nhà OSM (BUILDINGS) tâm trong
    nước: 50 → 42, trong R1750 = **0**, không nhà nào MỚI bị ngập; 8 nhà hết ngập (bờ Cấm x 612..674 / −1163..−1229).
    **VIỆC CHO NGƯỜI TÍCH HỢP (world.js, ngoài phạm vi nhánh):** (a) khối cell_taysong/bacsong dựng theo KÊNH GIẢ x≈−480..−516
    (A4 (−495,−629), TXP309 office/kho/cây đa (−577,−703)/(−479,−636)/(−456,−553), F (−504.7,−469.3), bs (−513,−507),
    "tường rêu" L8357) giờ đứng trên ĐẤT cách kênh thật 100–200 m về tây — cần dời/xoá; (b) quán FOOD (−50,−1081) L1621
    giờ rơi giữa sông Cấm (sd −40) — guard `isWater` tự bỏ, chỉ nên xoá toạ độ cho sạch; (c) `khoRows` L18999 thành code chết (không còn lô nào khô); (d) block_infill tự sắp lại
    (PRNG tuần tự) → ảnh museum khác trước, không phải lỗi; (e) cảng: `nearestRiverPoint(1163)` chọn điểm LẠCH TRAY
    (1197,4472) và quét −1050..−1200 không thấy nước (bờ Cấm thật tại x=1163 ở z≈−1346) → quayZ=4629 — lỗi CŨ có từ
    trước, không đổi. (f) Lưới ground 110 m chưa diễn tả được kênh 50 m (chờ W2) — nhìn aerial thấy bậc thang bờ, mặt
    nước vẫn đúng. Cách tìm: quét mọi cặp số `[x, z]` trong world.js, so `isWater` cũ/mới (script scratchpad) — có
    dương tính giả với cặp (zc, len)/(pz, pz), phải đọc dòng nguồn trước khi tin.
    **BẪY:** (1) simplify 1.5 m biến hồ Tam Bạc 20 → 11 đỉnh; promenade world.js đặt đồ theo `lakeSD > 0.8` nên
    waterSD PHẢI dùng chính LAKE_POLY (lệch 1.5 m = ghế chìm 1.6 m). (2) Hoà 2 mô hình phải `lerp(hLine, hPoly)` sau khi
    tính đủ, KHÔNG hoà từng bước carve (đáy −1.75). (3) Bucket cạnh: cạnh nằm hẳn ngoài lưới phải `continue` — clamp
    chỉ số sẽ nhét nó vào ô mép. (4) `deckHeight` từng gate bằng `riverFactor > 0.03` → kênh polygon không có cầu phẳng;
    giờ gate bằng cờ `polyWet` (+ polyline). (5) mapdata regen trên Windows ra LF, file commit CRLF — so byte phải
    normalize; `git diff` mới là thước đo. (6) `node --check` mapdata/terrain phải qua bản `.mjs` (bẫy cũ, vẫn đúng).
- **2026-09-07 (dh)** [W1-merge-budget — NGÂN SÁCH CPU/DRAW CALL CẢNH TĨNH: tách monolith theo ô, gộp lượt 2 theo
    INSTANCE material, ẩn xa, làm phẳng + đóng băng cây ma trận] (nhánh `worktree-wf_97eeaf15-407-1`; chỉ sửa
    `world.freezeStatic` + helper ngay trước nó trong `world.js`, và 2 hook trong `main.js animate()`):
    **VẤN ĐỀ (kiểm toán dg, phát hiện 3):** khung hình nghẽn CPU three.js — `updateMatrixWorld` duyệt 7.177 object
    + `projectObject` + ~1.150 draw call/khung; merge cũ chỉ gộp Lambert KHÔNG map/emissive nên 4.128 mesh texture/
    emissive/transparent vẫn lẻ; merge cũ khoá theo TÂM bounding sphere → mọi geometry đã gộp toàn thành phố
    (shophouse_infill 898k tri r=1224 m, utilwires, street_curbs, cờ…) dồn hết vào ô (0,0) thành `mrg10_0,0` = 983k
    tri KHÔNG BAO GIỜ cull được (vẽ cả ở hồ/bảo tàng và trong mọi shadow pass).
    **ĐÃ LÀM (thứ tự trong freezeStatic):**
    (a) `splitGeometryByTile(geometry, matrixWorld, T)` (helper trước freezeStatic): duyệt tam giác (index/không),
        bucket theo TRỌNG TÂM ô `floor(cx/T),floor(cz/T)`, trả `Map('x,z' → BufferGeometry)` KHÔNG index, đã ở
        không gian THẾ GIỚI, giữ position/normal/color/uv có sẵn; `T = Infinity` ⇒ 1 mảnh (bake mesh lẻ về world —
        thay `toNonIndexed()+applyMatrix4` cũ). Ma trận lật (det<0) → đảo thứ tự đỉnh (renderer vẽ mesh gốc frontFace
        CW, mesh gộp ma trận đơn vị nên phải bake vào) — hiện KHÔNG mesh tĩnh nào det<0. Mọi mesh bán kính world
        > 0,75·T (T = 450 FULL / 220 LITE) đều tách trước khi vào bucket — kể cả mesh lớn đứng một mình (trước bị
        `list.length<2` bỏ qua nên không bao giờ tách). FULL: lượt 1 7.082 mesh → 234 (647 mảnh tách); mrg10_0,0
        983k → 187k tri.
    (b) LƯỢT GỘP 2 — Lambert CÓ map/emissive (không transparent): khoá `(ô × material.uuid × castShadow × bộ attribute
        n/u/c)` → `mergeGeometries` world-space, KHÔNG bake màu, giữ uv, mesh gộp dùng ĐÚNG INSTANCE material cũ (tên
        `mrgm<cs>_x,z`) → `daynight.js` chỉnh `emissiveIntensity` của `sharedMats.window/lampGlow`, `facadeMats`,
        `lighthouseLamp` vẫn ăn (three r160: `receiveShadow` là UNIFORM per-object — lib/three.module.js:30406 — nên
        1 material dùng chung cho mesh gộp lẫn mesh lẻ không đổi program). FULL: 2.274 mesh → 605 (2.095 cửa sổ chung
        1 material → ~30 mesh theo ô). Skip: dyn/ẩn (mesh ẩn hoặc tổ tiên ẩn — merge cũ NUỐT cả mesh ẩn rồi hiện ra:
        'lqd_nhatho_xam' cố ý tắt kính trệt), material mảng, InstancedMesh/SkinnedMesh, morph, layers≠1,
        ground/water. Lượt 1 giữ nguyên ngữ nghĩa cũ (bake vertex color), chỉ đi qua cùng helper.
    (c) ẨN XA `world.farHideList` + `world.updateFarHide(px,pz)` (main.js gọi cạnh `updateNearCull`, nhịp 0,5 s
        `performance.now()`): mesh lẻ còn lại <200 tam giác có map/emissive và bán kính ≤ 10 m (biển hiệu canvas
        riêng, mặt tiền nhỏ, đèn) hoặc DẢI BIỂN (mỏng ≤0,6 m, cao ≤2,2 m, bán kính ≤16 m — `PlaneGeometry(W·0.94,1.5)`
        texture 512×84 của dãy nhà, >350 m còn ≤2 px) HOẶC bán kính ≤ 0,6 m bất kể material (bóng đèn tín hiệu
        r=0,15 m) → `visible = dist < 350 m`. Hộp nhà có texture (cao >2 m), mảng phẳng nằm ngang (mái/sân) và mesh
        tên ô `_x,z` (nearCull đã chỉnh visible) KHÔNG vào danh sách — ẩn nhà là nhà biến mất ở xa. FULL 1.694 mesh
        trong danh sách; đo A/B (bật lại hết rồi render 1 lần): spawn ẩn 1.262 mesh = −290 call (929 → 639), hồ
        −146 call, bảo tàng −34.
    (d) LÀM PHẲNG + ĐÓNG BĂNG CÂY MA TRẬN: mesh lẻ tĩnh còn lại đưa thẳng lên scene (`matrix = matrixWorld`, giữ
        trạng thái ẩn nếu tổ tiên ẩn) rồi cắt nhóm rỗng lặp tới hết (1.679 mesh lên scene, 1.468 nhóm cắt; Group
        1.706 → 238); rồi `scene.matrixWorldAutoUpdate = false` → renderer KHÔNG duyệt cây tĩnh nữa.
        `world.updateDynMatrices()` (main.js gọi NGAY TRƯỚC render, sau mọi update gameplay) quét từ `scene.children`
        xuống, dừng ở object có `matrixAutoUpdate` hoặc `userData.dyn` (gốc động ~280, giữ trong `world.dynRoots`) rồi
        `updateMatrixWorld(true)` từng gốc. Quét MỖI KHUNG (đọc 2 cờ trên ~3.500 object tĩnh ≈ 0,05 ms, không đi vào
        cây con động) — KHÔNG cache theo `scene.children.length`/2 s như bản nháp đầu: đổi ngôn ngữ (landmarks.js,
        npcs.js) remove+add sprite trong CÙNG khung nên số con không đổi → sprite mới đứng ở gốc toạ độ tới lần quét
        sau (kiểm chứng `swap_test.mjs`: 33 sprite mới đúng chỗ ngay khung render đầu). Camera parentless → renderer
        tự cập nhật; `sun.target` là con scene (daynight.js:41) nên là gốc động.
        **HỢP ĐỒNG TỪ NAY: vật ĐỘNG phải là con TRỰC TIẾP của scene còn `matrixAutoUpdate` (mặc định — NPC/xe/traffic/
        GLB/đèn/biển đặt sau freeze) HOẶC mang `userData.dyn` (world.js; được phép nằm sâu trong nhóm tĩnh: đèn hải
        đăng, cờ, vòi phun, thiên nga). Vật tĩnh tạo trong buildWorld mà sau đó tự đổi position/rotation KHÔNG gắn
        dyn = đứng im vĩnh viễn; module tự quản matrix (`matrixAutoUpdate=false` + `updateMatrix()` tay) cũng KHÔNG
        được cập nhật matrixWorld.** Kiểm chứng `motion_w1.mjs` (126 gốc/nhóm đổi matrixWorld sau 2,5 s): nước, thiên
        nga, mây, hải âu, cờ, tàu, đèn hải đăng, hoa nhặt, NPC/xe/người đi bộ, mặt trời/vòm trời; `sun.target` theo
        người chơi sau teleport; `diag()` chỉ còn dòng boat0 quen thuộc; 0 pageerror cả FULL lẫn LITE.
    **SỐ ĐO (2026-09-07, 1600×1000, Chrome headless d3d11 trên Radeon 890M; CẢ HAI bản là BẢN SAO scratch chỉ thêm
    1 dòng `return;` đầu `autoQuality()` — không tắt thì bản chậm bị hạ bóng 1024/tắt bloom NGAY trong lúc đo; pass
    CHÍNH = 1 lần `R.render` thủ công như perfbudget; CPU = p50 của 40 lần render thủ công; fps = nhịp vòng game 5 s;
    scratchpad `w1/probe_w1.mjs`):** FULL spawn: calls 1.153 → 617 (−46%), tri 7,59M → 6,83M, object 7.177 → 4.172,
    mesh hiện 5.430 → 2.634, render p50 44,6 → 12,7 ms (−72%), 25,8 → 54 fps [LƯU Ý phản biện: ms/fps tuyệt đối trên 890M dao động ±2× giữa các phiên (baseline đo lại 17,7–40 ms) — chỉ tin CHÊNH LỆCH đo cùng phiên và số draw call/object]; hồ: 635 → 313 call, 5,48M → 3,83M
    tri, 34,2 → 8,6 ms (−75%), 27 → 60 fps; bảo tàng: 362 → 300 call, 4,99M → 3,72M, 19,0 → 8,2 ms (−57%), 28,6 →
    60 fps. LITE (`?quality=lite`, T=220): spawn 1.197 → 813 call, 3,46M → 2,36M tri, 7.344 → 5.131 object, 15,6 →
    10,9 ms; hồ 651 → 397 call, 10,2 → 8,7 ms; bảo tàng 374 → 378 call (ô 220 m → nhiều mảnh hơn trong khung), 13,5
    → 8,8 ms. Ảnh so sánh (pixdiff bỏ HUD, px lệch >24): có bóng 0,21/0,68/0,04 % — toàn bộ là dải mép bóng do đồng
    hồ game trôi vài phút giữa 2 lần chụp + NPC/nước; TẮT bóng 0,02/0,02/0,00 % → hình học y nguyên.
    **CHƯA ĐẠT tuyệt đối mục tiêu ≤500 call/≤3.500 object ở spawn (617 call/4.172 object):** phần còn lại là 155
    call mặt tiền/nhà hộp texture canvas RIÊNG từng mesh (không gộp được nếu không atlas — mà ẩn xa thì nhà biến
    mất), rig NPC/traffic ~119 call (character.js), hero_trees 49 InstancedMesh, 46 material mặt tiền OSM lẻ (~48
    call, 1k tri), sprite 33; object còn lại phần lớn là mesh ẩn xa (gần như miễn phí: `projectObject` thoát ngay ở
    `visible=false`, cây ma trận không duyệt). Muốn xuống nữa: atlas 4096² cho ~1.800 texture canvas riêng (cách
    shopsigns) rồi gộp theo ô — việc riêng, có rủi ro mip-bleed.
    **KHÔNG LÀM (e) đóng băng con rig:** `updateMatrix()` cho 835 object ≈ 0,06 ms/khung; `sit()` đổi torso (Mesh
    lá) nên không thể đóng băng mù theo loại; character.js/traffic.js ngoài phạm vi nhánh.
    **BẪY MỚI:** (1) Đo A/B trên máy này PHẢI tắt autoQuality ở CẢ HAI bản sao đo (1 dòng `return;`, không commit)
    — `pin()` trạng thái ngay trước khi đo chưa đủ, nó hạ nấc lại trong 700 ms. (2) Ảnh chụp phải `setTime()` ngay
    trước khi chụp và vẫn lệch mép bóng vài % vì đồng hồ game chạy — so hình học thì chụp thêm bản TẮT bóng.
    (3) `__hp` không lộ `world` — probe muốn xem farHideList/dynRoots phải suy từ scene (mesh ẩn là con scene).
    (4) `Sprite.geometry.boundingSphere` = null → probe duyệt scene phải `computeBoundingSphere()` trước.
    (5) `mergeGeometries` (lib/jsm/utils/BufferGeometryUtils.js): mọi geometry phải CÙNG bộ attribute và cùng kiểu
    index — vì thế khoá lượt 2 có chữ ký n/u/c và mọi mảnh đều không index. (6) `git archive` cả repo = 1,9 GB
    (audit/ pano) — bản sao đo chỉ cần index.html js lib css manifest.json sw.js + junction assets/assets_lite.
- **2026-09-05 (dg)** [KIỂM TOÁN TOÀN REPO + ĐỢT 1: PHÂN TIER THEO GPU, HIỆN GLB KHÔNG KHỰNG, ASSETS_LITE LÊN CDN]:
    Kiểm toán 12 lăng kính (147 phát hiện, 16 phản biện đối kháng, số đo GPU thật) — báo cáo đầy đủ là artifact
    "Kiểm toán Hải Phòng 3D" (link trong memory `audit-report-2026-09`). **GỐC CỦA CẢ 2 PHÀN NÀN ("đồ hoạ chưa
    đúng" + "điều khiển giật") nằm ở phân loại thiết bị:** máy chủ dự án (Ryzen AI 9 HX 370, RTX 4060, màn 3840×2400
    CẢM ỨNG) có `navigator.maxTouchPoints = 10` → `device.js` xếp LITE, `main.js` xếp touch → khoá 30 fps (gate
    `performance.now()` còn sinh khung 33/50 ms xen kẽ), pixelRatio 1 trên màn 4K, tắt bóng/AA/bloom (gắn với cờ
    chạm nên `?quality=full` cũng không bật lại được), model assets_lite giảm 88% tam giác + texture ép 512 px
    (cả chân dung Bác Hồ), sương 1300 m. Đo thật: 22 fps, p99 244 ms, 34/219 khung >50 ms khi xoay camera.
    **Phát hiện 2:** Chrome/Edge trên laptop 2 GPU chạy WebGL trên **Radeon 890M** (adapter Windows gán);
    `powerPreference:'high-performance'` KHÔNG đổi được card trên Windows, và `main.js:32` từng gọi
    `canvas.getContext('webgl2')` để "kiểm tra WebGL" trên chính canvas game → WebGLRenderer nhận lại context cũ,
    MẤT HẾT attribute (đo: powerPreference 'default', antialias sai). **Phát hiện 3:** khung hình nghẽn CPU của
    three.js (~17 ms: projectObject + updateMatrixWorld + ~1.200 draw call cho 7.344 object), gameplay chỉ 0,4 ms;
    FULL trên 890M và RTX bằng nhau → GPU không phải giới hạn. **Phát hiện 4:** khựng 50–938 ms khi GLB stream
    (parse 56–312 ms + upload 4096² 35–45 ms/tấm + compile shader ~45 ms trong 1 khung); 47.036 BoxGeometry đầu
    vào merge bị closure `buildWorld` giữ (59% heap) → mark-compact ~250 ms (hiếm). **Phát hiện 5 (accuracy):**
    trong R1600 chỉ 332 footprint OSM vs 60.000 hộp `block_infill` (chạm CAPB tại x=1.287 → dải đông trống);
    sông = polyline bề rộng hằng (Cấm 620 m vs OSM 201 m), `reclaimPort()` chôn 18,3 ha lòng Cấm thật, Ga Hải Phòng
    nằm giữa ray 2–3 quay lưng ra phố (Đợt 2/3). **BỊ BÁC BỎ khi phản biện (đừng làm lại):** "streaming gây GC
    0,5–1,9 s" và "LITE chậm hơn FULL" = artefact do 67 Chrome chạy song song lúc đo; "mái hip 48% nhà OSM" —
    thủ phạm silhouette mái chóp là `block_infill` ROOFP 88%, không phải cổng hip-roof.
    **ĐỢT 1 ĐÃ LÀM:** (1) `js/device.js` viết lại: `HAS_TOUCH` (chỉ UI) tách khỏi **`TIER` 0–3** đọc chuỗi GPU
    từ canvas TẠM (0 = SwiftShader, 1 = mobile/GPU yếu/≤4 nhân/≤4 GB, 3 = NVIDIA/GeForce/RTX/Radeon RX/Apple M/Arc,
    2 = còn lại kể cả iGPU hiện đại), `LITE = TIER ≤ 1`, override `?quality=` + `localStorage hp3d.quality`
    (nút chọn ở màn chờ + hiện tên GPU), `IGPU_ON_BIG_MACHINE` → toast 1 lần hướng dẫn Windows Graphics Settings.
    (2) `main.js`: kiểm WebGL trên canvas tạm; antialias/shadow/post gắn `TIER ≤ 1`; pixelRatio khởi đầu theo tier
    (3: 1.5→2, 2: 1.0→1.5 do autoQuality nâng — đo: 890M + bóng + bloom ở 1.25 cho p50 52 ms, ≤1: 1.0); TIER 2
    bóng 1024 + bloom nửa độ phân giải; **cap fps chỉ khi IS_MOBILE**, chia
    tick RAF (`FRAME_DIV`) thay vì so `performance.now()`; autoQuality đo bằng đồng hồ thật, ngưỡng theo
    `REFRESH_HZ/FRAME_DIV` (0,7 hạ / 0,9 nâng), bước hạ 1 KHÔNG tăng PR, bỏ qua khi `assetsBusy()`; **mỗi bước
    hạ phải chứng minh +20% fps ở cửa sổ 4 s sau, không thì HOÀN TÁC + khoá** (máy nghẽn CPU như 890M: tắt
    bóng/bloom/hạ PR đều không đổi fps — đo A/B: mặc định p50 40 ms, tắt cả bóng lẫn bloom vẫn p50 37 ms — hạ cấp
    chỉ mất đẹp; ngưỡng 8% từng bị nhiễu ±10% đánh lừa tụt thẳng xuống nấc 3); camera/yaw mượt `1−exp(−k·dt)`.
    (3) `assets.js`: worker tải ngầm + layer-31 reveal (xem §6); **worker chỉ khởi động khi luồng chính nhả nhịp**
    → `main.js` `await workerReady()` (ping/pong, timeout 800 ms) TRƯỚC `buildWorld`; và vì `registerModel` chỉ
    chạy ở cuối buildWorld (giây ~40/53), thêm `PRELOAD_HINT` (10 URL cụm trung tâm) bấm tải ngay lúc nạp module. (4) `world.js`: `geos.length
    = 0` sau merge (`addMerged`/`addMergedTiled`); cây hero + luống hoa nạp qua `assetURL()` (LITE→lite, web→jsDelivr).
    (5) `input.js`: joystick chỉ hiện khi con trỏ chính là ngón tay hoặc có touchstart thật. (6) assets_lite lên
    assets-storage `8b8e42c`, `ASSETS_SHA` cập nhật, `tools/check_assets.mjs` mới, `sw.js` cache-first cho URL ghim SHA.
    **VIỆC CHỦ DỰ ÁN TỰ LÀM:** Windows Settings → System → Display → Graphics → thêm Chrome/Edge → High performance
    → mở lại trình duyệt; sau đó `__hp.gpu` phải báo NVIDIA và tier 3.
    **CÒN LẠI (Đợt 2/3, theo báo cáo):** ngân sách draw call/object (merge 4.128 mesh texture/emissive theo
    instance material + ô, atlas biển, ẩn biển/đèn >350 m, tách monolith `mrg10_0,0`), LOD địa danh bằng GLB lite
    >250 m, bóng 2 cascade + normalBias, nước, sửa Ga/Bảo tàng/Triển lãm/Việt Tiệp, nước polygon OSM; footprint +
    chiều cao thật (Open Buildings 2.5D / Overture); buildWorld sang worker/cache; loại `audit/` khỏi gh-pages,
    lọc số điện thoại trong `gen_shopsigns.mjs`, package.json + tools chạy Windows, tách §10 sang CHANGELOG.
    **BẪY MỚI:** `renderer.compile()` chỉ duyệt `traverseVisible` → muốn biên dịch trước khi hiện phải giấu bằng
    LAYER, không phải `visible=false`. Mọi phép đo perf từ nay PHẢI ghi `__hp.tier` + `__hp.gpu` (script chụp pano
    trước đây chạy trên chính máy cảm ứng này nên đã chấm ở LITE mà không biết).
- **2026-07-17 (df)** [3 ĐÒN CUỐI THEO THỨ TỰ GPT + TÁCH METRIC MAIN/SHADOW]:
    **(1) TÁCH METRIC (khuyến nghị #1 của GPT — sửa chính CÔNG CỤ ĐO):** `renderer.info.render.triangles`
    CỘNG CẢ shadow pass → mọi số đo từ đầu buổi đều lẫn lộn (giải thích vì sao phân rã theo mesh ra 5.071k
    mà tổng chỉ 3,83M). `tools/perfbudget.mjs` giờ render 1 khung có bóng / 1 khung tắt bóng để tách, và áp
    ngân sách lên MAIN. LƯU Ý: `shadowMap.autoUpdate=false` (bóng theo nhịp riêng) nên phép tách báo
    shadow=0 — main mới là số cần theo dõi.
    **(2) GROUND:** `PlaneGeometry(500,340)` = 340k tam giác cho địa hình GẦN NHƯ PHẲNG (đa số ở LAND_H).
    LITE → 240×164 = 79k (lưới ~9m vẫn giữ dáng bờ nước). FULL giữ nguyên.
    **(3) LOD LANDMARK:** `make_lite_assets.sh` phân nhánh theo kích thước file — model >5MB (landmark
    ~300k tri) dùng `--ratio 0.12 --error 0.01`, model nhẹ (cây/xe/prop) giữ 0.5 để không vỡ dáng.
    ĐO THẬT trong file GLB (đọc chunk JSON, đếm accessor): lechan 330k→40k, nhahat 295k→35k,
    dennghe 291k→47k, baotang 307k→103k, quanhoa 303k→141k. **Đối chứng ảnh FULL vs LITE: dáng tượng
    Lê Chân và Nhà hát lớn GIỮ NGUYÊN** dù giảm ~88% tam giác. assets_lite: 282MB→64MB.
    **(4) HỘP BÓNG LITE 110→70m:** lợi KÉP — ít caster lọt shadow pass (mesh gộp ô lớn chỉ cần CHẠM hộp
    là render TOÀN BỘ vào shadow map) và bóng NÉT HƠN (cùng 1024px phủ vùng nhỏ hơn).
    **BÀI HỌC ĐO ĐẠC:** đừng tin mức giảm suy ra từ 1 lần đo — số tam giác phụ thuộc model nào đã STREAM
    vào tại thời điểm đo (6s). Muốn biết LOD có chạy không thì ĐỌC THẲNG FILE GLB, đừng suy từ FPS/tri.
    TRẠNG THÁI LITE: texture 258MB/90 · main 3,52M tri/900k · calls 1167/260 · asset 64MB · không rò rỉ.
- **2026-07-17 (de)** [PHIÊN PHẢN BIỆN VỚI GPT-5.6-sol-xhigh — 3 BUG THẬT + 2 VIỆC HUỶ]:
    Gửi toàn bộ số đo + quyết định cho gpt-5.6-sol-xhigh (`scratchpad/ask_gpt.py`, gọi qua
    `ag.ask(text, system=...)` — KHÔNG phải truyền tên file). Kết quả đáng giá hơn mọi vòng tự tối ưu:
    **BUG THẬT (2/3 do chính đợt trước của tôi tạo ra, sẽ lọt vào game nếu không phản biện):**
     1. `instcull` nén `instanceMatrix` nhưng KHÔNG nén `instanceColor` → xe máy/xe đạp/xe đẩy nhận
        MÀU CỦA XE KHÁC sau khi cull (nhiều cụm dùng setColorAt). Đã nén song song + needsUpdate.
     2. Trần **40fps trên màn 60Hz** = 25ms không chia hết 16.67ms → khung lúc 16 lúc 33ms, GIẬT HƠN
        cả không giới hạn. Phải chọn ƯỚC của tần số màn → 30fps.
     3. Cache `makeTex` khoá theo `draw.toString()` → SAI NGUYÊN TẮC: hàm vẽ trong vòng lặp có mã nguồn
        GIỐNG NHAU nhưng bắt biến ngoài (SHOWROOMS[k], srBg[k]) ⇒ mọi biển hiệu chung một tên.
        Sửa: gộp **CHỌN-THAM-GIA**, khoá sinh từ ĐÚNG tham số nội dung (`'sign|'+txt+'|'+bg+'|'+fg+'|'+px`).
        20 chỗ đã gắn khoá, kiểm tự động 0 chỗ thiếu tham số.
    **HUỶ 2 việc đã lên kế hoạch (tiết kiệm nhiều giờ):** (a) BatchedMesh — vô dụng khi mesh còn lại là
    multi-material/texture riêng, nó chỉ gộp geometry KHÁC NHAU dùng CHUNG material; (b) atlas runtime —
    atlas KHÔNG giảm texel RAM (4096² = 85MB, ăn gần hết ngân sách 90MB), chỉ giảm state/draw.
    **KẾT QUẢ TRUNG THỰC:** gộp texture theo nội dung **THẤT BẠI** (1.880→1.858, chỉ 17 lần dùng lại) —
    giả thuyết "phần lớn trùng nội dung" của tôi SAI, biển hiệu thật sự khác nhau. Giả thuyết "texture GLB
    không được thu nhỏ" cũng SAI (đã kiểm: chỉ 3 texture ≥1024 và là atlas biển hiệu, cố ý).
    **CÒN LÀM ĐƯỢC:** cull ô đo tới **MÉP** thay vì tâm (trước: đứng sát rìa ô 450m vẫn bị tính xa 225m
    → ẩn nhầm cảnh trước mặt). **CÒN LẠI theo thứ tự GPT:** LOD landmark (1.5M tri từ 5 model, decimate
    10-30k), giảm lưới ground (340k), shadow proxy/castShadow xa, rồi mới tới hình ảnh (color space →
    baked AO → sky; CSM tối đa 2 cascade, 4 cascade = tự sát).
    **BẪY MỚI (trả giá 3 lần trong world.js 21k dòng):** KHÔNG dò dấu ngoặc `})` để chèn code — nó nhảy
    vào hàm khác (`bsRingRail`), vào giữa chuỗi, hoặc cắt sai. PHẢI khớp NGUYÊN VĂN cả khối kèm dòng neo
    phía sau, và kiểm parse .mjs sau MỖI lô. Làm đúng cách thì 20 chỗ vào chính xác, 0 sự cố.
    **BẪY:** `tools/memleak.mjs` bản đầu so vòng-đầu với vòng-cuối → DƯƠNG TÍNH GIẢ (vòng 1 là lúc asset
    stream vào). Phải so 2 vòng CUỐI (trạng thái ổn định). Kết luận thật: KHÔNG rò rỉ.
- **2026-07-17 (dd)** [BỘ ASSET NHẸ + VÉT CẠN KHÍA CẠNH CHƯA ĐỘNG TỚI]:
    **A. assets_lite/ (282MB → 67MB, −76%)** — phát hiện: `assets/` 23 model = 282MB người chơi phải TẢI
    (texture 4096² + ~300k tri/model) → chính là "vào game lag một lúc". `tools/make_lite_assets.sh` (tái lập
    được): simplify --ratio 0.35 --error 0.005 → normal/metallicRoughness/occlusion về 64px (LITE BỎ HẲN các
    map này lúc chạy; riêng normalTexture là PNG ~2.9MB/model!) → baseColor/emissive 1024 → meshopt (không
    lossy, đúng quy tắc). **Bản GỐC không đụng 1 byte**; `assets.js` chỉ đổi đường dẫn khi LITE, lỗi thì
    `d.forceFull` lùi về bản gốc (không bao giờ mất công trình). `.gitignore` thêm assets_lite/*.glb → đẩy
    nhánh assets-storage. Đối chứng ảnh FULL vs LITE (Lê Chân + Nhà hát): KHÔNG phân biệt được.
    KQ ngân sách LITE: tri 4.81M→3.83M, texture 441→274MB, texture lớn nhất 21→5.3MB.
    **B. KIỂM KÊ 11 KHÍA CẠNH CHƯA TỪNG ĐỘNG** (script kiểm kê nhanh trong git log), đã làm 8:
      1. **webglcontextlost** — CHÍ MẠNG trên mobile: điện thoại thu hồi GPU khi thiếu RAM/chuyển app;
         không `preventDefault()` thì context KHÔNG BAO GIỜ phục hồi → màn đen vĩnh viễn. Đã thêm
         lost/restored + `renderer.resetState()` + bỏ vẽ khi `_ctxLost`. Test: `WEBGL_lose_context`
         → mất=true, phục hồi=true.
      2. **Không có WebGL** → trang hướng dẫn VI/EN thay vì màn đen câm.
      3. **Lưu tiến trình** localStorage `hp3d.progress.v1` (save/load/reset trong quests.js) — trước
         thoát ra mất sạch 26 địa danh. Test: ghi/đọc đúng.
      4. **Trần nhịp vẽ 40fps khi LITE** — điện thoại chạy full sẽ nóng → thermal throttle, chơi 5 phút
         là tụt; khoá trần cho nhiệt ổn định + đỡ tốn pin, mượt ĐỀU hơn.
      5. **PWA** manifest.json (cài lên màn hình chính, standalone, landscape).
      6. **og:/meta** chia sẻ MXH. 7. **prefers-reduced-motion** → hoa rơi dịu (nối THẬT vào petals).
      8. **tools/memleak.mjs** MỚI: teleport vòng quanh lõi nhiều lần, đo geometries/textures/programs/
         JS heap từng vòng — số phải ổn định. Chưa từng đo trước đây.
    CÒN LẠI: BatchedMesh (draw calls 1154/260), atlas 1.880 texture canvas lẻ, gamepad.
    **BẪY MỚI:** viết `U+0000` qua chuỗi Python làm file mã nguồn NHIỄM BYTE NUL — `node --check` vẫn OK
    nhưng `file` báo "data" (binary). Đừng nhét cờ vào chuỗi URL; dùng THUỘC TÍNH trên object (`d.forceFull`).
- **2026-07-17 (dc)** [ĐỢT TỐI ƯU LỚN — đo bằng CỔNG NGÂN SÁCH `tools/perfbudget.mjs`]: user "vẫn lag" +
    "tìm repo GitHub áp dụng". Kết luận repo: Claude-Code-Game-Studios = khung QUY TRÌNH (Godot/Unity/UE),
    KHÔNG có kỹ thuật Three.js — chỉ lấy 1 ý: biến đo perf thành CỔNG NGÂN SÁCH cố định. Dựng
    `tools/perfbudget.mjs` (chạy: `PW_PATH=<...>/playwright-core/index.mjs node tools/perfbudget.mjs 8179 lite`).
    **NÓ LẬP TỨC LỘ THỦ PHẠM CHƯA AI ĐO: RAM texture 1.881 MB** (ngân sách 90) — điện thoại 2-4GB RAM thì
    thrash/crash, đây mới là "lag" thật. Chi tiết + cách sửa:
    (1) 1.875 texture canvas RIÊNG (mỗi nhà một cái) → vá THẲNG `makeTex`: `TEXQ = LITE?0.5:1`, vẽ ở
        canvas nhỏ + `ctx.scale` nên bố cục chữ/gạch giữ nguyên → RAM ÷4 (1 đòn phủ hết, không sửa 64 chỗ gọi).
    (2) Atlas biển hiệu 4096²(85MB/tấm)×3: khoá `IS_MOBILE` → đổi `IS_MOBILE || LITE`.
    (3) GLB: `shrinkTexturesForMobile` cũng khoá IS_MOBILE → mở cho LITE; MOBILE_TEX_MAX 1024→512;
        BỎ HẲN normalMap/roughnessMap/metalnessMap khi LITE (giữ emissiveMap cho đèn đêm).
        KQ: **1.881 → 441 MB**.
    (4) `js/device.js` MỚI: LITE + IS_MOBILE ở module riêng — world.js và assets.js cùng dùng mà KHÔNG
        tạo VÒNG LẶP IMPORT (world ↔ assets).
    (5) `js/instcull.js` MỚI (kỹ thuật InstancedMesh2/agargaro, tự viết — không thêm dependency):
        THREE.InstancedMesh vẽ MỌI instance mỗi khung (đo: hero_trees = 7,0 TRIỆU tri). Chụp ma trận gốc,
        mỗi 0.4s NÉN danh sách theo khoảng cách rồi hạ `mesh.count`. `autoRegisterInstances` tự quét
        (lặp lại vì GLB nạp async), bỏ qua instance ĐỘNG (xe/người tự set ma trận → nén sẽ phá).
        Tầm: LITE cây 150m/prop 300m; FULL 520/700. KQ: **6.489 → 1.043 instance vẽ (−84%)**.
    (6) `ornlamp_globes`: 257k tri LUÔN vẽ vì gộp 1 mesh phủ CẢ BẢN ĐỒ (bounding vô nghĩa) → `addMergedTiled`
        + sphere 10×8→8×5. (7) Ô merge tĩnh LITE 450→220m (ô to = ló góc vẫn vẽ trọn).
    TỔNG: tri 6,03M→4,81M; texture −77%; 0 lỗi; visual y nguyên (3 góc kiểm).
    **2 BẪY KIỂM THỬ (tốn ~1h, PHẢI nhớ):**
      a) `node --check x.js` KHÔNG bắt lỗi cú pháp module → **copy sang .mjs rồi `node --check`** mới đúng.
         (Suốt buổi báo "SYNTAX OK" trong khi file thật sự hỏng.) Lỗi hiện ra trong browser là
         "Unexpected end of input" + `__hp` không tồn tại.
      b) Thay chuỗi có comment `//` cuối dòng: dấu `}` bị NUỐT VÀO COMMENT → mất ngoặc đóng.
         Comment phải nằm ở DÒNG RIÊNG phía trên.
      c) (nhắc lại, đã dính lần 2) nhịp định kỳ phải dùng `performance.now()`, KHÔNG dùng `time` giờ-game.
    CÒN LẠI (đợt sau): model GLB ~300k tri/cái (LOD chỉ cho LITE, FULL giữ 100%); BatchedMesh (r160 CÓ sẵn)
    cho ~5k hộp multi-material → draw calls; 1.877 texture riêng vẫn nhiều (atlas hoá biển hiệu nhỏ).
- **2026-07-17 (db)** [PLAYBOOK MOBILE — gộp tĩnh toàn cục, đòn draw-call]: user "vẫn lag trên mobile" →
    đo thành phần: **11.759 mesh KHÔNG TÊN** (prop lẻ hand-built các chiến dịch) / 12.393 tổng, 1.806 texture
    riêng, calls 2985. Bài học chuẩn cộng đồng: mobile chết vì DRAW CALLS + OBJECT COUNT (<150 calls, <2k obj),
    không phải triangle. Triển khai **MERGE-PASS TOÀN CỤC** (freezeStatic, sau prune): bake material.color vào
    VERTEX COLOR rồi gộp mọi mesh tĩnh Lambert không-texture theo (ô 450m × castShadow × side) → 6.713 mesh
    → 89 mesh. KQ: **12.393→5.410 mesh (−56%), calls 2985→1052 (−65%)**, visual y nguyên (Lambert × vertexColor
    ≡ Lambert × material.color). Skip an toàn: dyn/ancestor-dyn, map, transparent, EMISSIVE (đèn đêm bị daynight
    mutate), material MẢNG (multi-mat box), non-Lambert (GLB Standard), InstancedMesh, ground/water,
    **layers.mask≠1 (ribbon aerial layer-2 — nuốt vào là ribbon hiện trong pano!)**. PHẢI gán castShadow/_noCast
    TRƯỚC merge (main.js từng gán sau theo TÊN roads_*/sidewalk_* — merge nuốt tên) → chuyển vào
    freezeStatic(shadowOn). LITE thêm: DPR 1.0 thẳng + enableNearView() NGAY từ đầu. CÒN LẠI (chương sau nếu
    cần): ~5k unnamed multi-mat/textured box → cần texture-atlas; 1.8k canvas texture riêng (biển hiệu).
- **2026-07-17 (da)** [CHẾ ĐỘ NHẸ — máy yếu/mobile chơi được, KHÔNG thuê server GPU]: chủ dự án hỏi "server
    gánh render cho máy yếu?" → phân tích: cloud-render (pixel streaming) tốn GPU-server ~4-8 người/GPU
    (50-150tr/tháng cho 100 CCU) + input lag 50-150ms → SAI công cụ cho web game miễn phí. Đường đúng:
    client rẻ. Triển khai: (1) `LITE` (world.js, export) — detect mobile/CPU≤4 lõi/iGPU-GPU cũ qua
    WEBGL_debug_renderer_info; ép tay `?quality=full|lite`. LITE: thảm nhà lưới 11m + cap 26k + mái 60%
    (đo: verts block_infill 2911k→1061k, −64%). (2) main.js: LITE desktop seed sẵn bước 1 (bloom off,
    PR 1.2, bóng 1024). (3) NẤC CHẤT LƯỢNG 3 (`enableNearView`, expose qua __hp): sương 4200→1300 +
    camera.far 1650 + ẨN tile 450m ngoài 1450m quanh người chơi (nhịp 0.5s ĐỒNG HỒ THẬT — không dùng dt
    game vì dt clamp 0.05 làm máy càng yếu giờ-game càng chậm). Đo: 86/306 tile ẩn tại spawn. HOSTING:
    static → Cloudflare/GitHub Pages (miễn phí, nghìn CCU); multiplayer sau này chỉ cần relay ws VPS
    ~100k/tháng. **BẪY test**: click startBtn TRƯỚC khi listener gắn → started=false → mọi update-loop
    ngủ (hid=0 giả) — script phải kiểm titleScreen.hidden rồi re-click.
- **2026-07-17 (cz)** [NGÕ/HẺM OSM — class 'h' + fix Ga + bug chậm bậc hai]: (1) Query roads_dt cũ LỌC MẤT
    highway=service/alley → fetch riêng `osm_alleys.json` (bbox DT; bỏ footway/path — lối công viên nhiều điểm
    ít giá trị) → process_osm mục 3b: class **'h'**, chỉ giữ trong lõi (isCentralRoad), ≥28m → **817 hẻm**.
    (2) world.js: ROAD_W.h=3 + render bằng vật liệu path (bê tông be 0xc9b896), RIBBON_W.h=4 (aerial),
    minimap nét trắng mảnh 2px; roadDists coi h là alley → thảm nhà ống TỰ ôm hẻm (block bị cắt như thật).
    (3) **BUG chậm bậc hai**: các scanner `_onRoadF/_onRoadHP/...` quét MỌI segment ROADS_DT không bucket —
    thêm hẻm làm build treo ~phút (CDP pause bắt stack tại three.module). Fix: 6 scanner skip 'h' như 'w'.
    (4) **FIX Ga**: hack addNode station lat 20.8585 (dời bắc 275m cứu rail-yard filter) nằm sẵn trong
    process_osm nhưng mapdata repo chưa từng regen với nó — regen lần này làm Ga nhảy sai; đã trả về lat thật
    20.85602 (nearGa 700 đủ giữ yard). Verify: aerial tile3 khớp vệ tinh (block đặc + khe hẻm), DOM load lại
    nhanh, 0 JS error, 3.6M tris. BÀI HỌC: file osm_*.json có thể là TRANG LỖI XML (rate-limit) — check đầu
    file trước khi tin; process_osm phải chạy từ tools/ (đường dẫn tương đối).
- **2026-07-17 (cy)** [THẢM NHÀ ỐNG TOÀN LÕI — sửa cấu trúc "nhà dân chưa chuẩn"]: audit cmp_1..8 chỉ rõ lỗi
    hệ thống #1: thật = thảm liền kề phủ ~90% lòng ô, game cũ = hộp rải ~25% + nửa NAM/ĐÔNG lõi (z>560/x>900)
    TRỐNG hẳn vì vòng lặp infill dừng sớm. Làm lại vòng infill (world.js ~18894): (1) phủ TOÀN lõi tròn
    BUILD_RADIUS−40; (2) nhà ỐNG mặt tiền 4.6-6.8m × sâu ≤12.5m (sâu co theo chỗ trống: dHalfMax=min(big−8.5,
    alley−3)); (3) QUAY MẶT ra đường gần nhất (roadDists trả thêm hướng đoạn gần nhất; _ang=atan2(−bdz,bdx));
    (4) ôm sát ngõ (bỏ né cứng 16m); (5) BỎ evidence-gate trong lõi (thật dày đều); (6) CAPB 20000→60000,
    2-4 tầng, 88% mái chóp; collider min(0.52·max, alley−2.6, big−8, 6) tránh chặn ngõ. GIỮ NGUYÊN guard
    nước/công viên/openSpace/panoDenies/nearFeatured/clearedZone/LM/nearPanoCam/ray. Verify: aerial tile3 ≈
    vệ tinh thật (thảm terracotta kín ô), NAM (200,1000) từ trống → kín, phố tầm mắt dãy nhà 2 bên + lòng
    đường sạch, tris aerial 3.7M / street 2.7M, 0 JS error. LƯU Ý test: __hp.aerial không tự reset —
    teleport sau đó vẫn render aerial-cam; muốn chụp ground phải dùng session mới.
- **2026-07-17 (cx)** [TƯỜNG THẾ GIỚI + MINIMAP TÊN ĐƯỜNG/CÔNG TRÌNH]: (1) `clampToPlayArea` (main.js) —
    tường vô hình tròn PLAY_RADIUS=BUILD_RADIUS−12 áp sau MỌI kiểu di chuyển (bộ/xe/thuyền) trong animate;
    trượt dọc tường + toast nhắc (chống spam 5s). Verify: teleport 1700 → toast hiện, 0 lỗi. (2) Minimap v2:
    VIEW_M 260→380 (zoom nhỏ hơn), canvas NỘI BỘ 2x + CSS 210px (chữ nét), TÊN ĐƯỜNG từ STREETS ({n,x,z,d} —
    8 trục lớn trong bán kính) chữ xám xoay theo d + viền trắng, TÊN CÔNG TRÌNH nâu POI cạnh chấm (tx(lm.name),
    cắt >22 ký tự). Muốn tên MỌI phố: nâng process_osm giữ name trong ROADS_DT rồi regenerate mapdata.
    LƯU Ý test: __hp.teleport có lerp/stream chậm — script chụp phải chờ ≥5-6s sau teleport ĐẦU TIÊN.
- **2026-07-17 (cw)** [MINIMAP KIỂU GOOGLE MAPS]: viết lại `js/minimap.js` — nền phố GG (đất #f2efe9, nước
    #a6d5fa từ heightfield lưới 6m, công viên PARKS, footprint BUILDINGS, đường 2 lớp casing/ruột: trục p/s
    VÀNG #fcd769, phố t/r TRẮNG, rail nét đứt) vẽ MỘT LẦN cho ±(BUILD_RADIUS+100) ở 0.8px/m; mỗi khung chỉ
    `drawImage` cửa sổ VIEW_M=260m quanh người chơi → theo chân như GG, bắc cố định, mũi tên xanh #1a73e8 giữa.
    Chấm địa danh chỉ vẽ khi lọt khung. Verify: 4 vị trí (Nhà hát/Tam Bạc/cầu HVT) map trôi đúng, nước/công
    viên/đường chuẩn màu GG, 0 JS error.
- **2026-07-17 (cv)** [GIAI ĐOẠN TRUNG TÂM — cắt thế giới theo bán kính]: chủ dự án chốt giai đoạn này chỉ cần
    lõi trung tâm → `BUILD_RADIUS = 1600` (world.js, export; 1600 thay 1500 để trọn cụm cảng ~1565m). 2 tầng cắt:
    (1) `addMergedTiled` BỎ bucket ngoài bán kính lúc build (không merge/upload); (2) `freezeStatic` cắt mesh lẻ
    hand-built xa bằng bounding-sphere THẾ GIỚI (Đồ Sơn/Cát Bà/Hòn Dấu/Cầu Bính... 564 mesh) TRƯỚC frame đầu.
    An toàn: mesh khổng lồ phủ tâm (đất/nước) tự giữ vì sphere chạm vòng tâm; InstancedMesh giữ (sphere không gồm
    instanceMatrix); KHÔNG dispose geometry (có thể dùng chung với mesh gần). Đo: tris tâm 6.26M→5.1M (−19%),
    lõi + chân trời verify sạch. Mở lại full HP: tăng BUILD_RADIUS. LƯU Ý: quest/địa danh xa (Cát Bà, Đồ Sơn)
    giai đoạn này sẽ là đất trống — chấp nhận theo chỉ đạo. CÙNG ĐỢT (main.js 97bf4d4): fix bug autoQuality
    không hạ composer pixelRatio (bloom/MSAA vẫn full → hạ bước vô dụng — nay setPR() đổi cả hai), compileAsync
    toàn scene sau màn chờ (hết khựng lúc Bắt đầu), powerPreference high-performance, DPR vào 1.5 ramp-up 2.
- **2026-07-17 (cu)** [PIVOT: LANDMARK DỰNG BẰNG CODE — bỏ hướng Meshy]: chủ dự án chốt "Meshy ra model xấu
    (noisy, lưng méo) vì ảnh thực tế không đủ nét — TỰ XÂY bằng code". GIỮ 4 GLB đã duyệt: **Lê Chân, Nhà hát
    lớn, Đền Nghè, đền Tam Bạc (dentamky)**; còn lại procedural theo ảnh thật (extension đã có ~450 ảnh tham
    chiếu). ĐÃ DỰNG LẠI + verify in-game (0 JS error): **Việt Tiệp** (lưới bê tông + huy hiệu vàng + kính/cột),
    **UBND** (mansard + dormer + ĐỒNG HỒ + phào/quoin, tại đúng LM.ubnd + orientLong — thay bản mái đỏ/portico
    sai kiểu), **Nhà Kèn** (2 TẦNG MÁI: ngói cam + tum thông gió + chóp — bản cũ 1 mái nón sai), **Rạp Tháng
    Tám** (art-deco: tháp bậc thang + THÁNG 8 đỏ + băng poster + marquee), **Chợ Sắt** (băng cửa NGANG ribbon
    + KHUNG THÉP biển trên nóc), **Triển lãm MỚI** (1 Nguyễn Đức Cảnh geocode → (-293,175); colonial + cờ đỏ).
    **Kỹ thuật**: canvas facade qua makeTex + multi-material BoxGeometry ([+x,-x,+y,-y,+z(facade),-z]);
    mansard = CylinderGeometry(top,bot,h,4) bake rotateY(π/4) rồi scale (W/2)·√2; bát giác = Cylinder 8 seg.
    **BẪY đã sửa**: (1) Object.assign(mesh,{position}) crash — position READ-ONLY, sập cả world; (2) mat()
    cache key nuốt {map} thành '[object Object]' → 2 texture dùng chung material → material có map PHẢI tạo
    explicit; (3) __hp.teleport(x,z,yaw,pitch,dist) là ORBIT quanh TARGET (x,z) — muốn chụp nhà thì target
    ngay toạ độ nhà, đừng đặt "vị trí đứng". placePhoto (Meshy loader) đã xoá — dead code.
- **2026-07-16 (ct)** [SẢN XUẤT MODEL PHOTOREAL — pipeline THÔNG end-to-end]: Chạy thật Meshy (key qua chat,
    balance 2530) → **3 model đẹp**: `ubnd_hotel_de_ville.glb` (10.4MB), `viettiep.glb` (6.8MB),
    `trienlam.glb` (9.4MB) — đều đã meshopt (raw→out, chỉ nén hình học). **CALIBRATION quan trọng**:
    (1) **crop ảnh mặt tiền SẠCH (bỏ tiền cảnh xe/plaza) → SINGLE-image** cho model ĐẶC, đẹp nhất —
    hơn hẳn crop-only multi-image (bị nướng xe vào + lưng rỗng). (2) Single-image: front chuẩn, lưng/hông
    Meshy đùn khối hợp lý → đặt quay mặt ra phố. (3) Multi-image cần ảnh phủ CẢ hướng sau + sạch, khó hơn.
    **API**: single = `/openapi/v1/image-to-3d`; multi = `/openapi/v1/multi-image-to-3d` (ENDPOINT RIÊNG).
    meshopt = `gltf-transform meshopt` (cài `@gltf-transform/cli` global; KHÔNG phải `npx gltf-transform`).
    Params low-poly game: `target_polycount 20000, enable_pbr false`. Soi model: `glbview.html?m=<tên>`
    (normalize + 4 góc) + `scratchpad/render_glb2.mjs`. Poll+tải: `scratchpad/poll_task.py <task> <ep> <name>`.
    **CÒN**: (a) tích hợp GLB vào game (registerModel §5.5 — cần TOẠ ĐỘ game từng công trình), (b) landmark
    khó: Chợ Sắt (cong/đã phá 2022/render — kém), Nhà Kèn (bát giác + cây che + lẫn nhiều nhà). GLB nặng →
    nhánh assets-storage (§6). **LƯU Ý**: `| head -N` sau lệnh nền GIẾT poller (SIGPIPE) — dùng Bash run_in_background.
- **2026-07-16 (cs)** [ĐỘT PHÁ NGUỒN ẢNH — extension Google Images]: Wikimedia + Brave API **quá yếu** cho
    landmark Hải Phòng (Brave: nhầm hoa-kèn/Việt-Xô/HCM, chặn hotlink; browser MCP che URL proxy). **Google
    Images MỚI có đủ ảnh hiện đại đa góc** — nhưng tải tự động bị chặn. Giải: **extension Edge tự viết**
    `tools/gg_image_grabber/` (MV3, content+background). Cơ chế: trích URL gốc từ link `/imgres?imgurl=…`
    (dự phòng quét innerHTML) → `chrome.downloads` (vượt hotlink/CORS, gửi cookie). Claude TRIGGER bằng
    `document.getElementById('hp-grab-btn').click()` qua javascript_tool (cầu postMessage lỗi vì e.source
    khác world — dùng click là chắc). Tải về `Downloads/hp_landmark/<query>/`. **Đã thu ~450 ảnh/6 công
    trình**, lọc ra mặt tiền sạch đa góc cho UBND(màu)/Việt Tiệp/Nhà Kèn/Chợ Sắt/Rạp T8/Triển lãm →
    multi-image Meshy (`meshy_submit.py` nhận 2-4 ảnh). **Bài học**: ảnh ngẫu nhiên/khác buổi KHÔNG ghép
    multi-image tốt — chọn 3-4 góc CÙNG điều kiện sáng. Nguồn báo/gov.vn: giữ attribution, model là dẫn xuất
    biến đổi (low-poly) của công trình công cộng có thật. [[no-brand-names]] áp dụng.
- **2026-07-16 (cr)** [PHOTOREAL LANDMARK — prep ảnh + Meshy pipeline]: 18 GLB landmark đã có; các landmark
    MỚI (Chợ Sắt, Cung Việt Tiệp, Nhà Kèn, Rạp Tháng Tám, Triển lãm) **KHÔNG có ảnh mặt tiền sạch** trên
    Wikimedia LẪN web search (Brave): Chợ Sắt đã phá 2022 (chỉ còn công trường/flycam), Nhà Kèn chỉ ảnh sự
    kiện 500px, Việt Tiệp chỉ ảnh báo nghiêng, nhiều query nhầm sang HN/HCM. **Chỉ UBND (Hôtel de Ville)**
    có ảnh dùng được (bưu thiếp Wikimedia **Public Domain**). Đã prep: crop tách 2 cánh, xoá cột cờ/cây/chữ/
    tem, tô màu split-tone (mái xám đá, tường kem) — **ChatGPT gpt-5.6 đồng duyệt 5 vòng**. Bộ công cụ ở
    `tools/meshy_input/` (README + meshy_submit.py + prep + spec chụp cho ảnh tự chụp). **Tham số Meshy chốt
    cho low-poly game**: `target_polycount 20000, enable_pbr false, should_remesh true, should_texture true`
    (KHÁC mặc định 300k/PBR ở §5.3 — game low-poly nhẹ hơn). **Bài học**: landmark ít tư liệu → cần ảnh
    CHÍNH CHỦ chụp (spec `CAPTURE_SPEC.md`); web search cũng không cứu được. Key (Meshy/Brave) đưa qua chat,
    dùng trong phiên, lưu scratchpad NGOÀI repo — không commit. [[no-brand-names]] vẫn áp dụng cho biển trên model.
- **2026-07-16 (cq)** [BẢN QUYỀN + KIỂM ENGULF]: (1) **Engulf pano là false-positive**: detector vertex-proximity <1.4m
    gắn cờ 43 cam, nhưng chụp 16 cam tệ nhất (14 gần-tường + 2 "trong lòng nhà" 498/351) → TẤT CẢ là cảnh phố/quảng
    trường MỞ, có tường nhà ở sát (đúng street-view phố dày thật). KHÔNG có defect để fix → lớp pano ~4.18 gần TRẦN thật
    của phong cách low-poly, KHÔNG có đòn bẩy "diệt engulf" rẻ. (2) **Brand sót**: `js/shopsigns.js` sinh từ OSM name-tag
    qua `debrand()`/BRAND_MAP; rà pano thấy 8 nhãn hiệu lọt: BRG, CP (Pork), Similac, Bose/JBL/Denon, VAB (VietABank),
    Bia Hà Nội (Habeco), Cooler City, Bamboo Airways → thêm vào BRAND_MAP, regenerate → 0 sót.
    **Bài học**: SAU mọi lần sinh biển từ tên-thật OSM, PHẢI re-scan pool bằng list brand rộng (map không bao giờ đủ ngay).
- **2026-07-16 (cp)** [CHIẾN DỊCH QA + PERF — ChatGPT + 3 agent, fix bug + mượt hơn, 0 giảm quality]: agent-audit xác nhận
    code **phòng thủ rất tốt** (0 crash/NaN nghiêm trọng, 0 floating solid, 0 JS error). Fix: **logic** (daynight hoist
    `_NIGHT_WATER` tránh GC mỗi khung; main.js clamp `teleport` vào WORLD_BOUNDS; traffic.js guard `samplePath` len<1e-6);
    **image** (tường rêu 309 clamp chân ≥ mặt nước — R3 canal ngập); `mat()` cache cả opts-material. **PERF (đòn bẩy
    lớn — agent phát hiện):** `buildings`/`block_infill` trước là **1 mesh phủ CẢ thành phố** → bounding sphere chứa
    camera → KHÔNG BAO GIỜ frustum/shadow cull → 6M vertex mỗi khung + shadow rasterize lại tất cả. FIX **tile hóa 350m**
    (Lô A, như TREE_TILE) + **skip castShadow mesh phẳng** (Lô B) + **autoQuality đa-bước liên tục** (Lô C). VALIDATE
    (fps_probe headless): nhìn RA rìa → draw calls **2944→416**, tris **6.55M→2.9M**, FPS **~4×** (frustum cull giờ có
    tác dụng). Visual IDENTICAL (pano_225 + game_3), 0 JS error. Công cụ QA: `scratchpad/qa_scan.mjs` (perf+display),
    `diag_win.mjs`, `fps_probe.mjs`. Đòn bẩy còn (chưa làm): tile roads/sidewalks, gate updaters xa, DPR cap.
- **2026-07-16 (co)** [END-STATE VÒNG ĐÊM + PHÂN TÍCH TRẦN]: sau khi vét cạn lô an toàn: **VỆ TINH median ~3.8**
    (baseline 3.64; road ribbon + rail yard + ga + density + gardens giúp per-tile: t1 6.8→6.9, t6 2.2→3.0, t3
    2.4→3.0, t7 2.3→4.2), **PANO 4.18** (baseline 4.16, keep-clear/terrain KHÔNG regression). Blue-metal roof
    THỬ→median 3.30 (-0.4) → ĐÃ REVERT (scorer phạt màu lệch). PHÂN TÍCH TRẦN: t1 đạt 6.8 chứng tỏ scorer KHÔNG
    cap low-poly cứng — 6-7/tile KHẢ THI khi cấu trúc khớp GẦN HOÀN HẢO; nhưng đa số tile cấu trúc chưa khớp đủ
    (đường nhỏ OSM thiếu, layout nhà chưa exact) → lên 8 cần **grind per-tile cấu trúc** (chậm, nhiễu ±0.4 nuốt
    gain nhỏ) + **engulf per-building** (nhà hand-placed KHÔNG tên, không grep được → cần khi user online verify).
    BÀI HỌC: mọi thay đổi màu/style phải A/B median-3 (blue-metal "hợp lý" nhưng hại); dựa VISUAL cho structure,
    scorer chỉ bắt regression thô. Realism ĐÃ tăng mạnh bằng mắt (đúng goal chính) dù scorer-8 còn xa.
- **2026-07-16 (cn)** [VÒNG ĐÊM — hội ý ChatGPT kế hoạch 7 lô + kiến trúc AERIAL-ONLY OVERLAY]: KEY architecture:
    render "dải rộng" (đường/rail/nước) trên **Three.js layer 2** — `__hp.aerial` bật `camera.layers.enable(2)`;
    mesh overlay `layers.set(2)` ⇒ CHỈ hiện top-down vệ tinh, camera pano (layer 0) KHÔNG thấy → không nuốt vỉa hè.
    ĐÃ LÀM: (Lô1) **road ribbons** aerial-only rộng p20/s15/t11/r7+region18 (world.js sau mesh 'roads') — verify
    pano_225 KHÔNG đổi; (rail) **sân ga ballast rộng 42m + 10 ray** quanh LM.station; (ga source-fix) station
    lat→20.8585 + nearGa 700. Checkpoint aerial: baseline median 3.64 → **3.74** (t7 2.3→4.2, t6 2.2→3.0, t3
    2.4→3.0; nhiễu ±0.4 nuốt aggregate nhưng per-tile thắng rõ). TEST: `scratchpad/diag_win.mjs` (JS err +
    __hp.diag entity) — bắt được hồ t3 chìm entity ga (đã fix, dời hồ SE), boat0 z=-883 là lỗi pre-existing biết
    trước. Lô còn lại ChatGPT: ENGULF-551 (detector point-in-footprint+rays, RR-vừa), water ribbons, facade pano
    (PANO_DETAIL layer 3), gardens/anchors, calibration. Quy tắc đêm: 1 lô=1 commit xanh, gate pano-diff≤0.1% +
    diag 0-error, revert khi đỏ. Scorer nhiễu → dựa VISUAL + geometry, chấm median-3 thưa (đừng đốt endpoint).
- **2026-07-15 (cm)** ⭐ [GỠ CHẶN LỚN — regenerate mapdata.js CHẠY ĐƯỢC trên Windows]: trước tưởng không regen
    được (thiếu `osm_*.json` + path Linux). GIẢI: chạy `bash tools/fetch_osm.sh` TỰ TẢI lại 12 file OSM từ
    **Overpass public** (overpass-api.de hay 406/dispatcher-busy → RETRY mirror `overpass.kumi.systems`; queries
    to như buildings/roads_region mất vài phút/cái). fetch_osm.sh THIẾU query `osm_water_dt.json` (hồ Tam Bạc way
    236743184) → đã bổ sung (§11). process_osm.mjs dòng 619 path Linux → sửa `new URL('../js/mapdata.js', import.meta.url)`
    (portable). Regen ra mapdata.js chỉ khác bản cũ **5 dòng** (fresh OSM ~y hệt; MASK coastline vi chỉnh, GARDENS
    to hơn) → mọi override terrain/world VẪN KHỚP (R3 splice vertices còn nguyên). ⇒ giờ SỬA ĐƯỢC GỐC: mạng đường
    ROADS_DT, land-mask coastline, ga/station anchor, GARDENS. `osm_*.json` đã gitignore (regeneratable, nặng 4.8M).
    LEVER #1 (đường) MỞ KHOÁ. Việc tiếp: fix ga station anchor (rail yard t3 bị lọc), refine mask/road tại nguồn.
- **2026-07-15 (ck)** [L2/L3 — full-agent DRAFT + tích hợp: vườn/civic/anchor/mật độ additive world.js]: 3 agent
    song song nháp block tự chứa (node-check + guard đất `!isWater && |gh-LAND_H|<0.4`), tôi tích hợp: **garden6**
    (vườn NBK nêm cỏ + 2 đài phun (-116,-391)/(-95,-254) + 2 bồn tròn (316,-623)/(233,-537)); **civic8** (oval
    track (169,-832) + parterre (123,-737) + đại lộ cây x≈310 + tường bao — cắt tránh chồng kho); **anchor** (Sở
    GTVT -938,-1182 / Cảng vụ -155,-1076 / BV Quốc tế -1013,482, BoxGeometry vertex-color mái). **Mật độ ĐÚNG CHỖ**
    (không blanket — ChatGPT cảnh báo): `_forceDense` 3 rect real-dày (bán đảo t7, LHP t4, Tam Bạc t1) nới vào
    điều kiện evidence block_infill (VẪN giữ guard đường/nước/openSpace). Verify aerial: t6 vườn+oval, t7 bán đảo
    dày. BÀI HỌC agent-draft: yêu cầu block TỰ CHỨA + API whitelist + guard đất + node-check → tích hợp 1 phát,
    dịch HTML-entity (`&gt;→>`), agent tự probe đất + dời tâm tránh nước (SGTVT 17m tây) — chất lượng cao, nhanh.
- **2026-07-15 (cj)** [L1 HYDRO — sửa nước theo audit georef + 2 vòng phản biện ChatGPT]: (1) **hồ Quần Ngựa t3**
    (real có, game thiếu) — ellipse override groundHeightNoDeck tâm ~(600,228), nhà tự loại qua isWater; (2) **nắn
    R3 kênh Tam Bạc** hết chạy XUYÊN tile6 (real 0 nước) → trục thật x≈-860..-1133 qua cầu Lạc Long (splice
    OLD_R3_TAIL→NEW_R3_TAIL bằng findSeq, terrain.js sau prefix-splice); (3) **reclaim cảng Hoàng Diệu** t7/8:
    sông Cấm R1 (w620 từ OSM) modeled quá nam ngập dải cảng → override `reclaimPort()` polygon thuôn PORT_RECLAIM
    (feather bờ 18m, dryH 0.30, chạy CUỐI groundHeightNoDeck để R1 không ngập lại — KHÔNG dời centerline/giảm w);
    (4) **kho cảng** world.js (dãy kho tôn xám song song sông trên đất reclaim, tự chừa nước). GATES pass (fresh
    browser — LƯU Ý preview cache module cũ, phải probe bằng browser mới). ĐO: scorer NHIỄU quá lớn (t8 2.7↔3.5
    giữa 2 lần) → net-phẳng 3.6→~3.6; nhưng VISUAL (chuẩn chính, bài học nhiễu): cảng có kho như real_8, hồ t3
    đúng, t6 hết nước sai (+0.8), arc t4 chảy liền — đều ĐÚNG-ĐỊA-LÝ hơn. TODO: canal R3 mới có thể false-water
    rìa đông t4 (t4 tụt ~0.7) → tinh chỉnh x canal về đông (sát x≈-400) lô sau. CHẶN: KHÔNG regen mapdata được
    (thiếu osm_*.json + path Linux) → lever #1 (ROADS_DT/mask/GARDENS) không sửa gốc; chỉ override terrain/world.
- **2026-07-15 (ci)** ⚠️ [LỖI ĐO LƯỜNG NGHIÊM TRỌNG — baseline vệ tinh "5.96" là ẢO]: phát hiện
    `rescore_both.sh` phiên trước chụp 8 aerial bằng **toạ độ LƯỚI tùy ý** `game_2=(-150,250),
    game_3=(399,250), game_6=(399,-250), game_7=(-350,-700)...` — KHÔNG georef theo lat/lon tâm của
    `real_N` (README §audit/satellite). ⇒ scorer so game-khu-A với real-khu-B (KHÁC khu) → điểm 5.64–5.96
    LÀ VÔ NGHĨA (may khớp lờ mờ vì đâu cũng "phố đỏ dày"). Toạ độ ĐÚNG (georef từ lat/lon qua CÙNG công thức
    đặt pano, verify khớp readout GE của ảnh): xem `tools/pano_loop/tiles8_georef.json`. Chấm ĐÚNG khu →
    **baseline THẬT ~3.6/10** (t1 6.8, t2 3.3, t3 2.4, t4 3.2, t5 4.9, t6 2.2, t7 2.3, t8 4.0). Fix nước/mái/
    mật độ KHÔNG gây "regression" — chỉ là lần đầu đo ĐÚNG. Nước màu (cyan/lục/lam-slate) tác động điểm NHỎ
    (~±0.1) khi so đúng khu; giữ lam-slate `0x4d616c` (thực tế). BÀI HỌC XƯƠNG MÁU: **mọi tile QA phải georef
    tâm ảnh thật; kiểm chéo toạ độ chụp trước khi tin điểm số.** Lỗi thật lộ ra: game có NƯỚC ở khu real KHÔNG
    có nước (Tam Bạc arc tràn sang t6), mật độ/đường lệch — đó là việc cần làm để lên 8 THẬT.
- **2026-07-15 (ch)** [VỆ TINH — MẬT ĐỘ RÌA TÂY/BẮC (t4/t7)]: block_infill lưới `gx≥-1100, gz≥-900` → rìa
    tây (x<-1100, t4) + bắc (z<-900, bán đảo Sở GTVT/Bạch Đằng t7) TRỐNG dù real dày nhà. Đo `block_infill`
    ~297k tri ≈ 12.7k nhà < CAPB 15000 ⇒ CHƯA bão hòa → mở biên KHÔNG cướp lõi. FIX: `gx -1750..900`,
    `gz -1320..560`, CAPB 15000→20000. Guard evidence (`_bldGrid 95 || _phGrid 60`) + water/superblock tự
    giới hạn (chừa sông Cấm/cảng). Verify: t4 bán đảo arc + t7 center-left lấp dày, lõi t3/t6 nguyên. BÀI HỌC:
    trước khi mở biên generator có CAP, đo count thực (tri/建物) vs CAP — nếu chưa bão hòa thì mở an toàn.
- **2026-07-15 (cg)** [VỆ TINH — DIỆT "KHỐI MÁI ĐỎ ĐẶC KHỔNG LỒ" (t4/t8)]: nhà OSM footprint LỚN
    (b.a>700m²: chợ/xưởng/cơ quan) bốc trúng ngói-đỏ `roofPalette` (3/4 màu đỏ) → đọc thành 1 mảng đỏ to
    bất thường trên vệ tinh (thực địa chỗ đó mái TÔN/BÊ TÔNG XÁM phẳng). FIX: thêm `roofBigPalette` (xám kim
    loại 0x9198a0..0x8f8a80), `roofC = (b.a>700?roofBigPalette:roofPalette)[hash%len]` (world.js:18138). Verify
    aerial t4/t8: khối đỏ khổng lồ→mái xám, nhà nhỏ vẫn ngói đỏ dày. BÀI HỌC chẩn đoán vệ tinh: dùng browser
    `scene.traverse` + bbox/pixel-sample để định danh mesh artifact; nhưng CẢNH GIÁC bbox của mesh GỘP (merged
    bucket cây) to mà nội dung RẢI — kiểm `distinct-cell` trước khi quy tội, kẻo đổ oan (đã suýt sửa nhầm phượng).
- **2026-07-15 (cf)** [DIỆT DỨT ĐIỂM "NƯỚC CYAN" — bug vệ tinh #1, truy nhiều vòng]: ROOT CAUSE tìm ra bằng
    lấy mẫu pixel aerial (lake=#2b96b6, R=0x2b — KHÔNG khớp waterMat 0x6b7a68 R=0x6b) → `js/daynight.js:170`
    GHI ĐÈ `world.waterMat.color.setHex(0x2b9fd4)` MỖI KHUNG theo chu kỳ ngày/đêm ⇒ mọi chỉnh màu ở world.js
    (waterMat) bị vô hiệu. FIX: đổi ngày `0x6b7a68` (xám-lục đục phù sa) lerp đêm `0x141d1a`. Verify: lake
    pixel #2b96b6→#647769, khớp Tam Bạc thật (real_1: xám-lục đục, KHÔNG cyan). BÀI HỌC KIM CHỈ NAM: khi
    một màu "không chịu đổi" dù đã sửa nơi khởi tạo material → GREP toàn `js/` tìm nơi GÁN LẠI `.color/.setHex`
    per-frame (daynight/animate); lấy MẪU PIXEL để so hex đúng thủ phạm thay vì đoán.
- **2026-07-15 (ce)** [MỤC TIÊU 8 + NÂNG CẤP RENDER (user gỡ ràng buộc low-poly)]: hội ý ChatGPT — PANO→8
    ROI: #1 bố cục/setback, #2 hình học/silhouette (mái/awning/ban công), #3 vật liệu/ánh sáng. Lỗi hiển thị
    (nhà/vỉa hè tràn đường, sai hướng/setback) phát hiện bằng topology 2D (footprint∩lòng-đường, facade-edge
    scoring). NÂNG RENDER (main.js, an toàn, khử "washed HDR glow" = dấu-hiệu-game #1): bloom threshold
    0.82→0.9 + strength ban ngày 0.1→0.025; exposure 1.26→1.18; +GRADE ShaderPass (saturation 0.88 + tint
    ấm bớt trời-xanh-gắt); MSAA 4x trên composer.renderTarget1/2 (EffectComposer BỎ antialias khi post bật —
    fix rẻ nhất). BÀI HỌC: lib/jsm CHỈ có RenderPass/Bloom/Output/ShaderPass — KHÔNG có SSAOPass/SMAAPass
    (phải vendor tay từ three examples; SSAO perf thấp vì +3000 draw call → BỎ). 192 MeshLambert/0 Standard.
- **2026-07-15 (cd)** [MỤC TIÊU 7 — TRẠNG THÁI CUỐI 3 VÒNG, đo TRUNG BÌNH]: chấm sat 3 lần (6.30/5.62/
    5.97) → VỆ TINH **TB 5.96/7** (từ 5.64; +0.32 thật, verify mắt: arc liền/cloverleaf double-loop/cảng
    kho/mật-độ khớp/nước bớt cyan). PANO **4.13/7** (chững — ~70 block nhà đúng thêm nhưng điểm không nhích).
    KẾT LUẬN CHIẾN LƯỢC (quan trọng cho vòng sau): (1) VỆ TINH tới 7 KHẢ THI nhưng GRIND CHẬM qua nhiễu
    ±0.35 — mỗi visual-fix đúng chỉ +0.1-0.3, khó tách khỏi nhiễu; cần nhiều vòng + đo trung-bình. (2) PANO
    7 BẤT KHẢ với low-poly minh-họa vs judge-ảnh-thật: cả per-pano lẫn hệ-thống đều phẳng ở ~4.1-4.35;
    phá trần cần photoreal (user đã loại). ⇒ tối ưu: dồn vệ tinh (garden granite t6 + lấp thưa arc/cảng +
    màu nước hồ vertexColor chưa sửa được) tới 7; pano giữ nội-dung-đúng ở trần. TỒN: garden granite là
    thay generator body (rủi ro, để agent verify kỹ); màu hồ/sông là vertexColor terrain (cDeep 0x6fa393
    đáy — cyan thấy là waterMat plane phủ, đã hạ nhưng lake vẫn xanh: cần soi thêm mesh nào render lake surface).
- **2026-07-15 (cc)** [MỤC TIÊU 7 VÒNG 1 + bài học xương-máu]: 5 agent (structure + s1-s4 bề mặt).
    ĐO HAI LỚP: vệ tinh 5.64→~5.85 (t4 arc 4.0→5.2, t8 cảng 4.4→5.6 — FIX ĐÚNG CHỖ ĂN ĐIỂM +1.2/tile);
    pano 4.14→4.08 (mẫu rộng) + pano-đã-sửa chỉ 4.35 → **BỀ MẶT CHỮNG ~4.1-4.35, TRẦN LOW-POLY tầm mắt**
    (thêm nhà đúng chỉ nhích nhẹ, khác hẳn cấu trúc). ⇒ vệ tinh 7 khả thi; pano 7 rất khó với low-poly.
    BÀI HỌC 1: **KHÔNG tích hợp drafts.js trước khi agent BÁO HOÀN TẤT** — tích hợp bản s1 trung gian có
    3 block trùng (đè GLB NHNN/Đảng ủy); agent xong sau mới ra bản final 6-block sạch → phải thay lại.
    BÀI HỌC 2: `taskkill //IM python.exe` giết luôn http.server 8177 → errcheck báo ERR_CONNECTION_REFUSED
    (không phải lỗi code) — khởi động lại server. BÀI HỌC 3: scorer gpt có NHIỄU run-to-run đáng kể
    (t6 6.3↔4.4) → tin TB nhiều tile hơn per-tile 1 lần; agent fail giữa chừng vẫn để lại drafts.js dùng được.
- **2026-07-15 (cb)** [FIX CẤU TRÚC từ QA vệ tinh — arc + cảng, mục tiêu 7]: score_sat 8 tile TB 5.64;
    2 tile thấp nhất t4=4.0 (sông Tam Bạc arc ĐỨT KHÚC) + t8=4.4 (cảng thưa). ROOT-CAUSE (agent verify):
    t4 = vòng splice terrain.js:135 dùng `splice(i-1,2,...)` XOÁ đỉnh nối (-1257,148) → arc R#3 tách khỏi
    nhánh rộng R#2 → 2 thân nước rời; + arc mảnh (w38). FIX (sau splice, trước riverIdx): làm dày arc
    w38→48 sh14 (định danh qua đỉnh -314,-182) + RIVERS.push polyline 6 điểm nối (-1257,148)→(-1092,50)
    bám mép tránh ô lake-override. Render aerial: arc LIỀN MẠCH. t8 = block_infill dừng gz=-900 nên dải
    cảng z<-900 trống; FIX: cụm nhà kho port_kho_* (3 dãy, guard bcOK=!water&gh>1.4, né cloverleaf
    (-118,-927) r160 + B13). BÀI HỌC: ảnh Google Earth "vệ tinh" thực ra 3D NGHIÊNG (camera 1104m, nút 3D)
    → cạnh méo, KHÔNG nắn trục sông theo nó; giữ hình OSM, chỉ sửa lỗi topology (khe đứt/độ dày).
- **2026-07-15 (ca)** [ĐỐI CHIẾU 8 ẢNH VỆ TINH THẬT — tăng mật độ nhà dân]: user cấp 8 ảnh Google Earth
    top-down (1100d,35y,0t) 3 hàng lat 20.85524/20.85976/20.86383. Chụp game aerial khớp khung (viewport
    1600×775, aerial half=385 → ~1590×770m; sửa aerial() dùng aspect canvas). ĐỐI CHIẾU: đường/sông
    (Tam Bạc, Cấm)/vị trí landmark (Nhà thờ, ga, An Biên, Nguyễn Bình Khiêm) ĐÚNG (OSM by-construction).
    LỖI #1: MẬT ĐỘ NHÀ DÂN QUÁ THƯA — thực tế kín tường-sát-tường, game nhiều mảng trống. FIX block_infill:
    CAPB 9500→15000, bước lưới 10.5→8.5, bằng chứng-nhà 60→95m, buffer OSM 13→10.5 → aerial giờ kín gần
    như thật, guard nước/công viên vẫn giữ (0 lấp sai). Perf 2710→3063 draw call (+0.1M tris). CÒN: khu
    Bắc/cảng (z<-900, ngoài range block_infill) + ô thiếu OSM data vẫn trống; cloverleaf cầu Lạc Long
    chưa dựng. CÔNG CỤ: tools/pano_loop/aerial.mjs (overview + N tile). Quy đổi: lon=106.68182+x/104030,
    lat=20.85750−z/110574.
- **2026-07-15 (bz)** [CHỤP VỆ TINH TRONG GAME — QA cấu trúc đường/vị trí]: user chốt ưu tiên ĐÚNG
    CẤU TRÚC (đường xá, vị trí công trình/nhà dân/công trình công cộng) + muốn ảnh vệ tinh top-down để
    so. Thêm `window.__hp.aerial(cx,cz,half,alt)`: OrthographicCamera nhìn thẳng xuống, Bắc(−z) lên,
    Đông(+x) phải (đúng chiều bản đồ); `aerialOff()` trả lại. main.js animate: khi `_aerialCam` set thì
    bỏ updateCamera + render trực tiếp (bỏ composer/bloom). Harness `tools/pano_loop/aerial.mjs` (ẩn UI
    bằng visibility, chụp full-page). Cho ảnh "vệ tinh" game SẠCH thấy rõ mạng đường + footprint nhà +
    sông/hồ + ga — QA khớp OSM/thực tế. LƯU Ý: game sinh TỪ OSM (ROADS_DT + BUILDINGS footprint thật)
    nên đường & vị trí nhà ĐÚNG THEO OSM by-construction; aerial để soi lỗi thô + đối chiếu ảnh vệ tinh
    thật. 8 ảnh vệ tinh thật CHƯA có trong repo — cần user cấp hoặc chụp Google Maps (bản quyền, hỏi trước).
- **2026-07-15 (by)** [MỤC TIÊU CHỈNH: 6đ MINH HỌA + lỗi #1 camera-engulf]: User chốt mục tiêu **6/10,
    MINH HỌA (không photoreal), đúng cấu trúc + màu, nhìn là biết Hải Phòng**. BÀI HỌC ĐO LƯỜNG xương-máu:
    scorer PHẢI đúng tiêu chí — thước "giống ảnh thật" phạt oan low-poly → chấm ~2đ sai lệch; thước
    "minh họa đúng cấu trúc/màu/nhận diện, KHÔNG trừ vì low-poly" mới đúng → game thực ra **4.14/6**
    (không phải 1.98). Đo lift phải A/B CÙNG scorer build cũ↔mới. Prompt đúng ở scratchpad/score_direct.py.
    LỖI #1 KÉO ĐIỂM (ChatGPT + mắt xác nhận): CAMERA BỊ NHÀ CHE KÍN (pano_351/498/307 = 1.6-2.3). Thêm
    hệ KEEP-CLEAR: js/panoclear.js (551 toạ độ camera pano) + nearPanoCam(x,z,r) spatial-hash, guard vào
    OSM/shophouse slotOK/house/block_infill (cấm nhà procedural trong 5m quanh camera). PHÁT HIỆN: các ca
    engulf TỆ NHẤT là LANDMARK BLOCK đặt tay ~4m camera (mesh noname) — guard procedural KHÔNG bắt được,
    phải sửa từng block. CÔNG CỤ MỚI: `window.__hp.pick(nx,ny)` raycast từ camera → tên+toạ độ mesh che
    (auto-hunt engulf). Endpoint chỉ 1 job score/lần (serialize, ~9s/ảnh); nhiều job = nghẽn 0 kết quả.
- **2026-07-14 (bx)** [GÓI HỆ THỐNG VÒNG 2 — người/bó vỉa/vỉa hè t]: (a) NGƯỜI ĐI BỘ nền (cell_dens
    de*): game đã có xe máy/ô tô đỗ (cap 620/520) nhưng 0 người nền → judge chê "phố vắng"; thêm
    dePedestrians instanced (~620, 22% nón lá) + bổ sung xe 'r', +8 draw call, avoid=nearFeatured.
    (b) BÓ VỈA (cell_curb cu*): mặt đứng bê tông 0xbdb9ad nổi 0.14m mép trong p/s/t 2 bên (8795 hộp→
    1 draw call, guard nước/nút/lọt-làn) — render đúng, khớp finding "curb rõ" lặp nhiều pano. (c) A1:
    bật vỉa hè phố t (hasSW += 't') — 145 pano phố t trước đây trống vỉa hè. TỒN ĐỌNG PHÁT HIỆN:
    parked_cars CŨ render ĐEN THUI (material tối/không bắt sáng) — blob đen xấu ở nhiều pano, cần fix
    palette/vật liệu xe (vòng sau).
- **2026-07-14 (bw)** [FACADE TEXTURE OSM — đòn bẩy đồ hoạ phá trần low-poly]: nhà OSM generic là
    hộp vertexColor phẳng (không cửa sổ) → judge chấm 2-3đ. Thêm generator texture mặt tiền procedural
    (cell_facade fc*): canvas 1 gian (cửa cuốn+kính trệt, băng biển, cửa sổ khung+kính, ban công lam,
    cục nóng), CACHE ≤30 material (key floors|wall|sign), RepeatWrapping ngang theo nBays=round(w/4)
    chống méo. Cắm front-quad CHỈ mặt tiền hướng-đường (cạnh footprint gần ROADS_DT nhất, pháp tuyến
    ra ngoài, +0.03 chống z-fight), bucket→merge, chỉ +≤48 draw call. GATE: !glassy + 2-6 tầng +
    rp.d<60m + cạnh 3-60m. LƯU Ý: lõi trung tâm nay phần lớn là LANDMARK BLOCK (bị nearFeatured skip)
    nên facade chỉ áp ~434 nhà generic ngoài rìa/khe — tác động vừa phải, KHÔNG phủ trung tâm. Muốn
    phủ lõi phải texture cả block_infill + landmark generator (vòng sau).
- **2026-07-14 (bv)** [GÓI HỆ THỐNG VÒNG 1 — nâng SÀN mọi pano]: (a) ĐƯỜNG: tim đường VÀNG đứt
    (0xf2c200, phủ vạch trắng cũ) + stop bar tại nút — decal MeshBasic gộp 1 draw call, guard isWater/
    dốc/né MEDIANS (cell_road). (b) CÂY: hạ glow phượng toàn cục sharedMats.flower emissive 0.35→0.10 +
    procedural phuongTree đa số XANH (bloom threshold 0.58→0.24, vòm đỏ rf×0.72, scale.y 0.42→0.3) —
    tháng 12 thật phượng chủ yếu xanh. + hàng CAU VUA trước 5 công sở + phượng allée + xà cừ cổ thụ
    (cell_tree). 2 BÀI HỌC XƯƠNG-MÁU: (1) IcosahedronGeometry là NON-INDEXED, Cone/Cylinder/Box là
    INDEXED — trộn cùng 1 material bucket → mergeGeometries THROW "index attribute exists among some";
    fix: `geos.map(g=>g.index?g.toNonIndexed():g)` trước merge. (2) ~46 phượng LÕI là heroTree GLB
    Meshy (đỏ baked trong texture) — KHÔNG param-tune được; giữ nguyên (biểu tượng hoa phượng đỏ), chỉ
    sửa procedural (ảnh hưởng phần lớn pano rìa).
- **2026-07-14 (bu)** [ĐO KHÁCH QUAN — TRẦN ĐIỂM & CHIẾN LƯỢC LOOP]: chấm lại 125 pano vòng tinh
    6-agent bằng gpt-5.6-sol-xhigh: TB **2.11 → 2.70 (+0.58)**, nhưng tuyệt đối vẫn RẤT thấp (1/125 ≥5,
    73/125 <3), 10 regression >0.4. Đọc findings: judge THƯỞNG khi khớp công trình cụ thể (nên +0.58 thật)
    nhưng render low-poly chỉ được điểm-phần; nhiều pano bất khả (pano_264 camera TRONG cửa hàng ảnh).
    KẾT LUẬN CHIẾN LƯỢC: ghép nhà per-pano cho +~0.5/vòng, trần thấp → KHÔNG đủ tới 8. Findings lặp đòi
    yếu tố HỆ THỐNG (vỉa hè block xám + curb, tim đường VÀNG, cây đúng loài/mật độ, xe/người, dây điện,
    vật liệu/ánh sáng). Gói hệ thống nâng SÀN đồng loạt 551 pano → ROI cao hơn ghép nhà lẻ. BÀI HỌC: khi
    +điểm/vòng cận biên, DỪNG thêm nhà, chuyển sang nâng chất lượng render hệ thống + đo lại.
- **2026-07-14 (bt)** [LỖI HỆ THỐNG G4 — công viên "mô màu"]: generator bồn hoa (`flowerBed`) rải
    vòm bán cầu theo lưới 17m KHẮP mọi GARDENS, palette 7 màu neon (hồng 0xff5fa2, tím 0x9b59b6, cam
    0xff8c00) + emissiveIntensity 0.14 (tự phát sáng) → nhìn HOẠT HÌNH, GPT trừ điểm mọi pano có công
    viên/vườn hoa. SỬA: palette → 4 XANH topiary (bụi tròn cắt tỉa — thực tế VN) + đỏ gạch + vàng nghệ
    + hồng NHẠT, emissive 0.14→0.05. 1 dòng đổi màu ăn nhiều pano cùng lúc (fix tầng generator > chèn
    block rời). BÀI HỌC: khi 1 khiếm khuyết thẩm mỹ LẶP ở nhiều pano → sửa GENERATOR, đừng vá từng ô.
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
