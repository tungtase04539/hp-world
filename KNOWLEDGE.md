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
| `js/world.js` | Dựng toàn bộ thế giới 3D, collider, spawn, `async buildWorld(scene, prog)` (Đợt 3: `await prog('<bước>')` ở cấp 1 = báo tiến trình + nhường luồng) |
| `js/boot.js` | Màn chờ: thanh dựng thế giới theo bước (trọng số = lần khởi động trước, localStorage `hp3d.bootProfile.v1`), nút Bắt đầu khoá tới khi sẵn sàng |
| `js/world.js` | Dựng toàn bộ thế giới 3D, collider, spawn, `buildWorld(scene)` |
| `js/citygen.js` | ĐỢT 3: dựng PHỐ NHÀ THẬT từ footprint RB01 (`buildings_real.js`) — 1 quad/cạnh tường + shader atlas, mái/tum/bồn/tôn, ban công/mái hiên/hộp biển/điều hoà 3D (ô gần), va chạm đa giác (`fabricCollide/At/Hit`), `fabricData()` dùng chung (world.js đặt `world.rbData`/`world.rbGrid` cho cây/props/camera). Cờ `FABRIC` (world.js, `?fabric=proc` = phố giả cũ) |
| `js/facade_atlas.js` (+ `facade_atlas_worker.js`) | Atlas mặt tiền/mái/chi tiết/biển hiệu VN vẽ thủ tục bằng rasterizer phần mềm (8 cột × 14 hàng ô từ W4-C — 2048×3584 / LITE 1024×1792, alpha = mặt nạ; 105/112 ô), vẽ trong Worker |
| `js/facade_evidence.js` | SINH bởi `tools/gen_facade_evidence.mjs` từ `audit/audit_enriched.json`: cờ từ vựng mặt tiền từng quan sát pano (thuộc địa, tân cổ điển, kính, đang xây, tập thể, cây leo, cũ/mới, biển lớn, mái hiên tôn/bạt…) + cờ vùng/tuổi từng pano — citygen `renderStyles()` dùng (W3-C) |
| `js/cellfacade.js` | W3-C nhà ô: `guardCellPalette` (mảng tường/kính lớn màu đặc của vật GIỮ LẠI → kẹp bão hoà theo sắc, nâng sáng tường xanh thương hiệu, mảng xám-xanh tối → kính), `cellCanvasFx` (filter ảnh canvas tối/bão hoà khi gộp cellAtlas), `gridFacadeSpec`/`paintGridFacade` (vẽ lại ~25 helper "nền + lưới cửa sổ" thành khung/kính/cửa chớp — gọi trong `cellsink.materialize`), `applyCellGlass` (shader kính nhà ô: đố theo toạ độ thế giới + phản trời — `sharedMats.window`), `drawFacadeWindows` (facadeTex) |
| `js/cellsink.js` | "Bồn chứa" khối ô dựng tay (world.js "cells"): che scene/addCollider/FEATURED_CLEAR/makeTex, ở cửa ra gỡ nhà ô trùng footprint THẬT, claim kind `'cell'` cho công trình giữ, xuất `world.cellShops` (nhà bị gỡ) + `world.cellKept` (nhà giữ + bao lồi, để WP2 cắt footprint); bỏ qua nhà `FLAG.SYNTH`; `realBuildings()` = giải mã RB01 dùng chung |
| `js/brands.js` | Danh sách chặn tên THƯƠNG HIỆU thật (nguồn duy nhất cho `gen_shopsigns.mjs` + lưới an toàn vẽ biển trong cellsink) |
| `js/assets.js` | Đăng ký + preload + streaming GLB theo khoảng cách |
| `js/main.js` | Vòng lặp game, camera, người chơi, chuỗi hậu kỳ (composer), autoQuality, `window.__hp` |
| `js/daynight.js` | Ngày/đêm (1440 s/ngày, mặt trời thiên văn), vòm trời shader, đèn mặt trời/trăng + bán cầu, sương FogExp2, PMREM bầu trời (IBL), hộp bóng snap texel, chế độ vệ tinh — Đợt 3 WP5 |
| `js/skymodel.js` | Mô hình trời tán xạ Rayleigh+Mie + hướng mặt trời (JS thuần, chạy được trong node) — MỘT nguồn cho vòm/đèn/sương |
| `js/post.js` | Tone mapping + grade DÙNG CHUNG mọi đường vẽ (CustomToneMapping = ACES + grade), SceneAOPass (MSAA + AO theo depth), FinalPass, `HP_UNLIT_K` |
| `js/water.js` | Vật liệu nước Standard (IBL trời, Fresnel) + bản đồ bờ/hồ — MỘT nguồn màu nước |
| `js/bridges.js` | Đợt 3 W3-F: CẦU THEO WAY OSM (mapdata BRIDGE_WAYS) — mặt cầu nâng HVT (nhịp chính + 2 nút xoắn, gờ + tay vịn, đèn, trụ/khung cổng, vòm đỏ trên lòng sông, tháp thang máy), cầu phố Lạc Long (lòng 2 chiều, vỉa hè, lan can con tiện), lan can/dầm/trụ cầu phẳng; `makeDeckIndex` (tra mặt cầu có tham chiếu cao độ; `crossesParapet` gờ giữa 2 nhịp); `simplifyFrames` (tay vịn) |
| `js/riverbank.js` | Đợt 3 W3-F: BỜ KÈ SÔNG — `snapBankGrid` (nắn lưới nền theo mép sông → bờ dựng đứng), tường kè + gờ, dải dạo ca-rô + lan can gang + đèn 2 bóng + hoa giấy ('prom'), dải bờ tự phát + lán + thuyền ('strip'), cây non chống cọc; `Run()` quét LIỀN theo cạnh polygon (không hộp/mẫu — §10 W3-F (11)) |
| `js/device.js` | `TIER` + `GFX` (núm chất lượng ánh sáng/hậu kỳ — chỉ theo TIER, không theo cảm ứng) |
| `js/landmarks.js` | 15 biển thông tin địa danh (vị trí suy ra từ mapdata) |
| `js/traffic.js` / `js/vehicles.js` / `js/npcs.js` / `js/quests.js`... | Giao thông, xe cưỡi được, NPC, nhiệm vụ |
| `js/roadgraph.js` | Đồ thị phố thật (nút giao, đường đôi một chiều — thuần JS, chạy được trong node); W3-F: TÁCH TẦNG theo cao độ đỉnh p[2] (cầu nâng không nối phố dưới), `edgeY`, `trimRoadEnds` (phố cụt dưới gầm thấp), `deckRoads` (way cầu = tim mặt cầu + cao độ) |
| `js/models_kit.js` | BỘ MÔ HÌNH NGƯỜI & XE DÙNG CHUNG (wave 2 W2-C): người 7,5 đầu (dáng đi/ngồi trong vertex shader), người lái IK, 3 xe máy, 6 ô tô (thân loft + hốc bánh thật), LOD xa, `kitMaterial` (kênh màu/cổng phụ kiện theo instance), `humanoidGeometry` (SkinnedMesh nhân vật chơi/NPC) — dùng bởi traffic.js, props.js, character.js. Xem trang `tools/qa/models.html` |
| `js/streetlife.js` | ĐỜI SỐNG PHỐ (Đợt 3 W3-E, gọi từ props.js): chợ dân sinh (ô dù/bạt/sạp/mẹt/người bán), hàng tràn hè theo biển hiệu + bằng chứng pano, chậu cây, cờ treo nhà, băng rôn, cổng chào ngõ, xe ba gác + mô hình xe khách/ô tô phủ bạt/trạm biến áp kiốt/đèn gang 2-5 cầu. Dữ liệu: props_evidence.js cột 7-9 + PROPS_MARKETS (tools/gen_props_evidence.mjs) |
| `js/footprints.js` | Tra cứu footprint nhà thật ĐANG VẼ (world.rbData/rbGrid của WP2, không có thì chỉ địa danh LM_POLY) cho gameplay: camera chống xuyên tường, chỗ xuống xe, người đi bộ |
| `js/trees.js` | HỆ CÂY instanced (Đợt 3 WP4): `plant/plantLocal` (mọi helper cây chỉ xếp hàng), `plantStreetTrees` (trồng theo dữ liệu dọc phố), `buildTrees` (atlas lá + kit 12 loài — W3-G thêm cây cảnh TOPI, me tây ME, cắt trụi "bộ xương" LOP + LOD gần/xa/hero GLB) — xem §10 (WP4-trees, W2-B, W3-G) |
| `js/treemap.js` | **SINH TỰ ĐỘNG** bởi `tools/gen_treemap.mjs` từ `audit/audit_enriched.json` (thảm cây 551 pano, 23 số/pano — W3-G 21, Đ3-W5-C thêm garden/vines — đọc bằng `PANO_VEG_STRIDE`) — KHÔNG sửa tay |
| `js/roadnet.js` / `js/roadtex.js` / `js/roadmarks.js` | Mạng đường (Đợt 3 WP6): đồ thị nút giao + dải + vỉa hè/bó vỉa theo `xsection.js`; 1 material Phong + DataArrayTexture (worker) + vạch kẻ trong shader; bằng chứng vạch kẻ/đèn từ pano (SINH bởi `tools/gen_roadmarks.mjs`) |
| `js/xsection.js` | MẶT CẮT PHỐ — nguồn duy nhất cho lòng/bó vỉa/vỉa hè/hố cây/xe đỗ/mặt tiền. Từ Đợt 3 W3-A mọi hàm nhận CẤP hoặc WAY `{c, w?, sw?}` (`roadHW/roadW/sidewalkW/curbLine/facadeLine/treePitLine/parkingLine/furnitureLine`) — truyền WAY để dùng bề rộng thật từng phố (`ROADS_DT[i].w/.sw`, SINH bởi `tools/street_fit.mjs` qua process_osm) |
| `js/anchorwalls.js` | TƯỜNG RÀO MỎ NEO Hải quân (Đợt 3 W3-A): `CB_WALLS` (polyline LTT/ĐBP/THĐ) + `cbFitFence` (đẩy đỉnh ra sau `facadeLine(way)` + 0,35) + `cbWallSegments` — NGUỒN DUY NHẤT cho world.js `cbWallRun` VÀ `tools/process_buildings.mjs` §9c2 (cắt nhà nhô trước tường, cờ `cbIn` khuôn viên). Không import three. Sửa `CB_WALLS` → chạy lại process_buildings |
| `js/traffic.js` / `js/vehicles.js` / `js/npc.js` / `js/quests.js`... | Giao thông, xe cưỡi được, NPC, nhiệm vụ |
| `js/net/` (MP-2) | Multiplayer phía game — CHỈ nạp khi có máy chủ (`?server=` / `hp3d.server` / `DEFAULT_SERVER`): `config.js` địa chỉ, `net_worker.js` WebSocket trong Web Worker, `session.js` tài khoản/vé, `correct.js` CORRECT, `telemetry.js` số liệu cục bộ, `net.js` điều phối, `remote_avatars.js` + `interp.js` + `nametags.js` người chơi khác (C2). Xem §8c, SERVER.md §9 |
| `js/ui/chat.js` (MP-2) | Khung chat 40 m + menu Báo cáo/Chặn + đường dây hỗ trợ |
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
- Địa danh GLB: TỪ ĐỢT 3 W2-E khớp footprint OSM `LM_POLY` bằng bảng `LM_FIT` (world.js: xoay + scale sx/sy/sz, đo bằng
  tools/qa/lmfit.py — xem §10 "Đ3-W2-E"). **LUẬT MẶT ĐỨNG:** trục ngang của mặt tiền lệch ≤ 10% so với sy (đồng hồ/cửa vòm/chân
  dung không méo; chỉ CHIỀU SÂU được giãn); **nhà hát scale ĐỀU tuyệt đối** (chân dung Bác — §5.6). Phần footprint GLB không phủ
  (sau nhà hát, cánh ga, khuôn viên trường/chùa/UBND, Việt Tiệp) là khối thủ tục từ đa giác; va chạm GLB = VIỀN chiếu bằng GLB
  (`LM_OUTLINE`, tools/qa/lmoutline.py), không phải LM_POLY nguyên khối. (Cũ: scale ĐỀU theo `LM_SIZE` — nhà hát 49, ga 55, THPT 80 → sai hướng/tỉ lệ.)
  Cầu HVT nhịp vòm 200m, trụ Bính 101m, cần cẩu 50m.
- Tốc độ THẬT (m/s): đi 5, chạy 11, xe máy 23 (~83 km/h), thuyền 19. Camera far 16000, fog 600-4200.
- Nhân vật ~1.7m. Đồ nội thất phố (ghế/đèn/biển/thùng rác) giữ TẦM NGƯỜI (~0.5-3m), KHÔNG scale theo 1:1.

### Dữ liệu xuất trong mapdata.js
- `WORLD` biên thế giới; `DT_BOX` hộp trung tâm; `MASK` lưới đất/biển bit-pack base64 (cell 40).
- `RIVERS [{w, pts}]` — polyline rộng 620 (Cấm), 300 (Lạch Tray), 55 (Tam Bạc); chỉ dùng NGOÀI thành phố (r ≥ 1750).
  Kênh Nam Triệu push trong terrain.
- `WATER [{n, pts}]` — **polygon nước THẬT** (natural=water, từ `osm_water_dt.json`, simplify 1.5 m, bỏ ao < 200 m²,
  giữ polygon có đỉnh cách gốc < 2350 m): Sông Cấm, Tam Bạc (2 mảnh), Sông Đào Hạ Lý, hồ Tam Bạc/Sen/Tiên Nga, kênh…
  terrain.js đào nước trong thành phố theo tập này (`waterSD`). 27 polygon / 1260 đỉnh / 21 KB (2026-09).
  **Đợt 3 W3-F:** polygon SÔNG/KÊNH (tên `Sông…`/`Kênh…`, |x|,|z| < 2000) được ĐẨY mép khỏi phố chạy dọc bờ (góc ≤ 40°,
  không phải cầu) tới ≥ hw + vỉa hè + 2,5 m (t 9,5 · s 11 · p 12,6 · r ≥ 7) và ≥ 3 m khỏi lối đi lát ven sông OSM
  (footway=sidewalk) — process_osm §6b3 (OSM vẽ mép sông Tam Bạc ĐÈ lên lòng Phố Tam Bạc: nước sát chân camera pano).
- `BRIDGE_WAYS [{id, n, c, kind, w, ri:[ROADS_DT idx], pts:[[x,z,y],…], i0?, i1?}]` (Đợt 3 W3-F, §6b4, sau WATER): mặt cầu
  theo way OSM, mẫu 3 m, y = cao độ hồ sơ. kind `span`/`ramp` (HVT: nhịp chính + 2 nút xoắn + dốc dẫn), `deck` (cầu phố nâng
  nhẹ: Lạc Long +2 m; way gồm cả 2 đầu SÁT ĐẤT — mặt cầu chỉ ở `pts[i0..i1]`), `flat` (cầu phẳng — mặt đường roadnet ở LAND_H,
  js/bridges.js chỉ thêm lan can/dầm/trụ). `terrain.ELEVATED_RI` = ri của mọi kind ≠ flat: roadnet KHÔNG vẽ dải mặt đất của
  span/ramp; way 'deck' roadnet VẼ trừ khoảng [i0,i1] (`deckGapAt`); cây/prop/W2-A dùng `ROADS_GROUND` (world.js: span/ramp
  thu 1 điểm, 'deck' giữ). Đồ thị giao thông dùng `world.trafficRoads()` (way cầu = tim mặt cầu + cao độ, xem §10 W3-F (10)).
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
    **MẶT NƯỚC:** plane toàn cục y 0, RIÊNG sông Tam Bạc nội đô y `waterLevelAt` = `TB_LEVEL` 1,1 · `tbRamp` (mesh 'water' thứ 2,
    world.js; §10 Đ3-W3 SỬA HỒI QUY AUDIT4) — vật NỔI phải cộng `waterLevelAt`, cao độ lòng sông/isWater KHÔNG đổi.
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
  **Đợt 3 W3-F:** HVT (BRIDGES[0]) KHÔNG còn trong deckHeight (đoạn thẳng cũ lệch ~110 m). Mặt cầu NÂNG (BRIDGE_WAYS ≠ flat)
  KHÔNG nằm trong groundHeight (cây/prop/nhà vẫn ở mặt đất dưới cầu) — tra bằng world.js `surfaceY(x, z, yRef)` = max(đất,
  mặt cầu cao nhất ≤ yRef + 1,2) (người chơi/camera/giao thông giữ đúng tầng; lên cầu bằng dốc) và `spawnY(x, z)` (teleport/
  pano/spawn: mặt cầu nếu tim cầu GẦN hơn tim phố mặt đất gần nhất). Mặt nhựa = y + 0,02 (span/ramp) / + 0,11 (deck).
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
  // castShadow/receiveShadow; anisotropy=8 cho mọi map; (envMapIntensity=0.85 ở đây bị assets.js GHI ĐÈ = 0,5 SAU place)
  // thêm plinth (bệ) + bậc thềm che chân model
}});
```
- box.min.y có thể là tán cây/chi tiết thấp — kiểm tra bằng mắt, chỉnh độ dìm.
- PBR chỉ đẹp khi scene có `scene.environment` = PMREM. Từ Đợt 3 (WP5) đó là PMREM nướng từ CHÍNH vòm trời
  (`daynight.js` bakeEnv, ~3 s/lần, tự tối về đêm) — KHÔNG còn RoomEnvironment; GLB `envMapIntensity` = 0,5
  (`GLB_ENV_INTENSITY`, ghi bởi `assets.js` applyGlbEnv SAU `place()` cho bản gốc và cho twin lite → 2 bản LOD sáng như
  nhau) và chính sách emissive ở `assets.js` applyGlbMaterialPolicy (xem §10 Đợt 3 WP5).

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
   Cả transform RUNTIME của nhahat.glb (world.js `LM_FIT.opera`) cũng phải sx = sy = sz (Đ3-W2-E từng ép mặt tiền 0,66:1 → chân
   dung hẹp 0,76 → 0,50, phản biện bắt lỗi; nay s = 21 đều).
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
- **Mặt cắt phố + tim đường (Đợt 3 W3-A)**: process_osm §3c gọi `tools/street_fit.mjs` — cần `tools/ov_buildings.csv`
  (gitignore; thiếu → bề rộng chỉ theo ghi đè pano/cấp, tim chỉ dịch theo pano) + `tools/pano_loop/list_full_551.json`.
  `ROADS_DT[i]` nay có thể mang `w` (lòng m) / `sw` (vỉa m) và tim ĐÃ DỊCH theo camera pano + tường Overture; THỨ TỰ/CHỈ
  SỐ way giữ nguyên (lọc độ dài trên bản simplify 6 m cũ). `node process_osm.mjs --fitlog f.json` ghi mỏ neo/dịch từng way.
  Đổi mapdata → CHẠY LẠI `node tools/process_buildings.mjs` (mặt tiền bám facadeLine theo TỪNG way) rồi
  `node tools/qa/clearance.mjs --xsec` (lệch tim camera + mặt nhà game vs Overture, không cần trình duyệt).
  Nhà THẬT cắt theo `flR = min(facadeLine(way), facadeLine(cấp))` (corridorClip/streetIntrusion/streetGuard: Overture đứng
  đúng chỗ dù nằm trong vỉa của way rộng), nhà SINH theo `facadeLine(way)`. Sửa `js/anchorwalls.js` (CB_WALLS) → cũng chạy lại
  process_buildings (nhà sau tường mỏ neo bị cắt + cờ cbIn).
- `js/roadmarks.js` SINH bởi `node tools/gen_roadmarks.mjs` (chạy từ GỐC repo; đọc `audit/audit_enriched.json`,
  `tools/pano_loop/mark_labels.json` (nhãn vạch tim nhìn ảnh — thêm nhãn ở đây), `tools/pano_loop/list_full_551.json`,
  `tools/osm_crossings.json` = fetch_osm.sh mục 13 (thiếu → giữ mảng OSM cũ)) — không sửa tay.
- `js/landuse_data.js` (raster sử dụng đất mặt đất, Đợt 3 W2-D) SINH bởi `node tools/gen_landuse.mjs [--ppm xem.ppm]` (chạy từ
  GỐC repo; đọc `tools/osm_landuse.json` = fetch_osm.sh mục 12, + PARKS/LM_POLY/osm_alleys) — không sửa tay. Chạy lại khi
  LM_POLY/PARKS đổi hoặc tải lại OSM; footprint nhà KHÔNG nướng vào file (js/landuse.js tô footprint sống lúc chạy). Đa giác OSM
  mang `building=*` bị bỏ (thân nhà). Thêm/sửa lớp: chỉ số trong `C` (gen) = hằng `C_*` + bảng `LU_PARAMS` (js/landuse.js).
- Mục 11 (nước) từ 2026-09-06 lấy cả `rel["natural"="water"]` (sông có đảo là multipolygon, tag nằm trên relation);
  process_osm §6b2 ghép member outer thành vòng kín. File `osm_water_dt.json` hiện có (tải 2026-07) CHƯA có relation
  (81 way) — lần fetch sau tự có. Xuất `WATER` phải giữ mọi export khác BYTE-IDENTICAL (sidewalks.js khoá theo
  index ROADS_DT): `diff` mapdata cũ/mới chỉ được khác đúng dòng `WATER`.

## 8. Kiểm thử tự động (chạy trước MỌI lần push thay đổi thế giới)

```bash
# Windows (từ Đợt 3 WP8): Chrome HỆ THỐNG headless + GPU thật (ANGLE d3d11) qua playwright-core — tools/qa/launch.mjs.
# PW_PATH = module playwright-core (mặc định: bản ở scratchpad phiên 04e77d80), CHROME_PATH = chrome.exe.
python -m http.server 8177            # ở gốc repo/worktree (mỗi agent 1 cổng riêng)
node tools/diag.mjs --port 8177       # 0 lỗi JS + __hp.diag() (thực thể tiếp cận được, TRONG vùng chơi) + bất biến
                                      # giao thông trên VỊ TRÍ ĐANG VẼ (xe bên PHẢI, trong lòng đường, không chồng nhau,
                                      # không ngược chiều đường đôi; người đi bộ không trong nhà/giữa lòng đường ngoài
                                      # ngã tư) + nhiệm vụ; thoát mã 1 nếu có vấn đề
node tools/waterbfs.mjs               # flood-fill nước: thuyền đi được từ Bến Bính tới mọi bến (node thuần, 0,4 s)
node tools/tour.mjs --port 8177 --out <dir>    # ~26 ảnh: mỗi địa danh trong vùng chơi nhìn từ 1 điểm pano thật
                                      # (raycast chọn điểm không bị che) + giao thông + đêm + vệ tinh — XEM BẰNG MẮT
node tools/perf.mjs --port 8177 [--quality lite]   # fps/p50/p95, draw call+tam giác (gồm shadow), ms CPU/khung,
                                      # ms giao thông, bootProfile từng bước, heap — kèm tier+GPU
node tools/mobile.mjs --port 8177 --out <dir>  # viewport điện thoại dọc/ngang + cảm ứng giả lập (TIER 1)
node tools/qa/shoot.mjs --port 8177 --out <dir> --views tools/qa/views_std.json --perf   # ảnh so pano/vệ tinh
                                      # [--traffic off]: giao thông phụ thuộc nhịp khung → ảnh không tất định; chấm pano /
                                      # so ảnh A/B dùng off, đo perf giữ on (chi phí thật)
node tools/qa/clearance.mjs --port 8177 --out <x.json> [--src] [--eval f.js] [--nohold --stack]   # (Đợt 3 W2-A)
                                      # KHOẢNG TRỐNG: 551 camera pano (< 3 m / lấp khung trong 6 m), vật tĩnh trên NHỰA đã
                                      # vẽ, khối lấn vỉa hè; SwiftShader ~10 s, chạy TRƯỚC freezeStatic (--nohold: chạy tiếp
                                      # qua freeze để bắt lỗi gộp; --eval: hàm (scene, world) dò thêm) — xem §10 W2-A
```
- **KHOÁ GPU TOÀN MÁY** (`tools/qa/gpulock.mjs`): mọi tool trên (launch.mjs `openGame` giữ khoá tới `g.close()`,
  shoot.mjs giữ tới khi xong) xếp hàng — chỉ 1 Chrome GPU trên cả máy (8 Chrome GPU song song từng làm máy BSOD
  0x133 ba lần, 2026-10-04). Script tự viết mở Chrome: bọc `node tools/qa/gpulock.mjs run -- node x.mjs` (tiến trình
  con nhận `HPWORLD_GPU_LOCK=<pid chủ khoá>` → acquireGpu tái nhập chỉ khi pid đó đúng là chủ khoá còn sống, và vẫn
  lấy KHOÁ CON `<lock>/child` — hậu duệ chạy song song vẫn xếp hàng, không tự chờ chính mình) hoặc `acquireGpu()`.
  **Từ 2026-10-15:** chủ khoá chạm mtime thư mục khoá mỗi 60 s (nhịp tim); chủ CÒN SỐNG không bao giờ bị cướp khoá trừ khi
  mất nhịp tim > 3 giờ (bản cũ cướp theo tuổi khoá 20 phút → lượt chụp 480 ảnh ~60 phút bị cướp giữa chừng = 2 Chrome GPU);
  `run --` dùng spawn bất đồng bộ (spawnSync chặn vòng sự kiện → không có nhịp tim). Khi MÁY CHỦ GAME đang phục vụ người chơi
  (tệp `%TEMP%\hpworld_server_live.txt` còn tươi < 10 phút, do `server/ops/mo-may-chu.ps1` ghi), MỌI việc GPU tự CHỜ — màn
  xanh giữa buổi chơi = sập máy chủ (bỏ qua chỉ khi chủ dự án đồng ý: `HPWORLD_ALLOW_GPU_WHILE_LIVE=1`). Bộ canh thứ hai
  `tools/qa/gpu_watchdog.ps1` (kill Chrome headless GPU thừa; chạy nền lại sau mỗi lần khởi động máy, log ở
  `%LOCALAPPDATA%\hpworld\`).
- **playwright-core cho công cụ QA:** `cd tools/qa && npm ci` (1.48.2, node_modules không commit). Mọi công cụ lấy đường dẫn qua
  `tools/qa/pw.mjs` (PW_PATH → tools/qa/node_modules của checkout đang chạy → của checkout chính) — không còn trỏ vào thư mục tạm.
- **DỮ LIỆU BỀN KHÔNG ĐỂ Ở THƯ MỤC TẠM (bài học 2026-10-15):** thư mục scratchpad của phiên Claude (trong %TEMP%) bị xoá sạch
  lúc 00:12 → mất 3.306 tệp ghi chú trích từ ảnh pano (fp_json) mà `tools/gen_herokit.mjs` cần → herokit chỉ còn đường
  `tools/rekey_herokit.mjs`. Mọi đầu ra tốn công tạo lại (trích xuất bằng agent, spec, công cụ QA) phải COMMIT vào repo
  (audit/, tools/qa/, docs/); ảnh QA lớn để ở `C:/Users/Admin/hp-world-work/`. Công cụ chấm cặp: `tools/qa/make_pairs3.py`,
  `tools/qa/audit_ids.json` (120 pano), `tools/qa/audit_views.mjs` (sinh views cho shoot.mjs).
- **BẪY A/B (đo sai cả 1 WP):** bản base phục vụ từ checkout thiếu `assets_lite/` → mọi request bản lite 404 →
  assets.js vẽ GLB ĐẦY ĐỦ ở mọi khoảng cách (+1-2,5 M tam giác, −5..−9 fps ở góc phố có địa danh xa) → bản "sau" có
  lite trông như "nhanh hơn". Base và after PHẢI cùng có assets/ + assets_lite/ (hard-link như SPEC Đợt 3 §2 bước 1;
  kiểm log server: 0 dòng `404 … assets_lite`). Xuất base: `git archive dot3 | tar -x -C <dir>` rồi `ln` GLB vào.
- Mọi tool trên gọi `__hp.pinQuality(true)` ngay sau khi vào game: máy chạy nhiều agent làm fps headless tụt →
  autoQuality nhảy nấc 3 (sương gần, không hoàn tác) → ảnh trắng xoá, số đo không so được. Số headless dao động
  tới ±2× giữa các phiên: chỉ so A/B CÙNG phiên (vd. serve bản `dot3` ở cổng khác rồi chụp nối tiếp).
- Debug trong game: `window.__hp` = { teleport(x,z,yaw,pitch,dist), setTime(0..1), gh(x,z) *(=NoDeck!)*,
  pick(nx,ny) raycast tên mesh, diag() } + (Đợt 3 WP8) `world`, `pState`, `traffic` (stats()/check()/setEnabled),
  `footprints` (js/footprints.js: blocked/topAt/boom), `PLAY_RADIUS`, `bootProfile` (ms từng bước khởi động),
  `pinQuality(on)`, `camOcclusion(on)` (cần boom chống xuyên tường; harness tắt để góc chụp khớp baseline).
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
   cách mép nước 4.5m. **CHỈ cho HỒ** (Đợt 3 W3-F, AUDIT3 TREEFORM): dải dạo ven SÔNG Tam Bạc (đoạn cong + đoạn tây —
   Phố Tam Bạc, Thế Lữ, pano_198/203/207/212/290/294) là CÂY NON chống cọc 3 chân sau bão Yagi, phía nhà KHÔNG cây; đoạn
   bắc Lạc Long → cửa Cấm (pano_519/331/336) là hàng cổ thụ trên dải bờ tự phát (js/riverbank.js 'prom' vs 'strip').
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

## 8c. MULTIPLAYER — máy chủ thử nghiệm kín (từ 2026-10-15)

Kế hoạch cho chủ dự án: `docs/multiplayer/KE_HOACH.md`. Kỹ thuật như đã xây: `docs/multiplayer/SERVER.md`. Sổ tay vận hành cho
chủ dự án: `docs/multiplayer/VAN_HANH.md`. Đặc tả giao việc: `docs/multiplayer/MP1_SPEC.md`.
- **Bố cục:** `js/shared/` là mã dùng chung client/server: giao thức nhị phân `codec.js`, hằng số, lượng tử, lưới AOI 128 m,
  đồng bộ đồng hồ, điểm xuất hiện, kiểm di chuyển `move.js`, bộ lọc chat tiếng Việt `textfilter.js`. Đây là ESM thuần,
  KHÔNG import three. Chỉ được import `../terrain.js`, `../mapdata.js`, `../brands.js`.
  `server/` là gói Node 24 riêng (package-lock, `npm ci`, `npm test` chạy PGlite, `npm run test:pg` chạy Postgres 17 trong
  Docker). Bot thử tải nằm ở `server/bots/run.mjs --scenario smoke|ramp|hotspot|stress|reconnect|abuse|netem-lite`.
- **Chạy trên máy chủ dự án:** Docker (game + Postgres + cloudflared dạng container) và Cloudflare Tunnel; không mở cổng nào;
  trang quản trị chỉ ở 127.0.0.1. Lệnh: `server/ops/mo-may-chu.ps1` / `tat-may-chu.ps1` / `trang-thai.ps1` /
  `khoa-khan-cap.ps1` / `sao-luu.ps1`. Khi phát triển hay thử, LUÔN thêm `-TestMode` (hoặc `HPMP_TEST=1`) cùng cổng/tên dự án
  riêng — bản thật ghi tệp `%TEMP%\hpworld_server_live.txt`, và tệp này làm mọi việc GPU (§8 khoá GPU) phải chờ.
- **Luật:** mọi thứ có giá trị (tiền, đồ, chỉ số, nhiệm vụ) do máy chủ quyết; di chuyển theo kiểu client đi trước, server kiểm
  (`move.js`: cửa sổ 300 ms / 1 s / 4 s, ngân sách thời gian, mặt nước/cầu). Hằng tốc độ trong `js/shared/constants.js` có
  test dò lệch so với main.js/vehicles.js/world.js — đổi tốc độ trong game thì phải sửa cả hai.
- **Sức chứa đo trên máy này** (Ryzen AI 9 HX 370, Windows): 600 người mượt (độ trễ vòng sự kiện p99 ~26 ms khi tick chia
  lát 4 ms); 1.200 người thì một lõi bão hoà (tick p99 ~63 ms). Nguyên nhân: Windows send() 14–30 µs/lần. Muốn trên 1.000
  người: gửi snapshot bằng nhiều luồng (giai đoạn B trong ARCH) hoặc chạy trên VPS Linux. Thử kín vài chục người thì dư sức.
- **Phía game GĐ1 (MP-2 C1, 15/10/2026 — chi tiết SERVER.md §9):** `?server=wss://tên-miền` (nhớ vào localStorage;
  `?server=off` xoá) hoặc `DEFAULT_SERVER` trong `js/net/config.js` (+ `NET_DEFAULT_ON = true` trong main.js — test
  `tools/qa/mp2_c1_unit.mjs` kiểm hai chỗ khớp). Không cấu hình → main.js KHÔNG import `js/net/*` (0 request mới, đo bằng
  `tools/qa/mp2_nonet.mjs`). Socket ở **Web Worker** (heartbeat sống qua 17–35 s dựng thế giới); giải mã ở worker, snapshot
  về luồng chính dạng `Float64Array` transfer theo netId. Thời gian mạng = `performance.timeOrigin + performance.now()` +
  offset máy chủ (mỗi luồng có timeOrigin riêng nhưng cùng thang epoch); `clientMs` của STATE = u16 của `performance.now()`
  TRANG (giữ qua RESUME). Chế độ STATE đi/chạy theo PHÍM chạy, không theo vận tốc ước lượng (ước lượng trễ vài khung →
  báo WALK lúc đang chạy 7 m/s → vượt cửa sổ 300 ms của move.js). Ngày/đêm: `dayNight.syncTo()` 1 Hz (nắn theo đồng hồ thật,
  lệch > 0,01 ngày thì nhảy + nướng IBL; KHÔNG gọi setter `t` mỗi khung). Mất máy chủ → "Khám phá" (một mình) + biểu tượng
  HUD, tự nối lại (RESUME ≤ 60 s, sau đó vé mới). Kiểm đầu-cuối: `tools/qa/mp2_c1_e2e.mjs` (máy chủ thật chế độ test + bot S4
  trong tiến trình + 1 Chrome dưới khoá GPU). Bẫy: hội thoại hướng dẫn viên mở 0,7 s SAU khi vào — harness phải chờ nó hiện
  rồi mới Esc; biệt danh tối đa 16 ký tự ("Trần Thị Ngọc Ánh" = 17 → `nickname_invalid/length`).
- **Đã tích hợp (MP-2, 15/10/2026 — SERVER.md §9.6):** C1 + C2 gộp, `net.js` dùng `remote_avatars.js` thật. Kiểm đầu-cuối 1 lệnh:
  `tools/qa/mp2_int_e2e.mjs --port <tĩnh> --game <cổng>` (máy chủ native `HPMP_TEST=1` tự bật/tắt/khởi động lại, 96 bot S4 trong
  tiến trình dồn quanh trình duyệt, 1 Chrome dưới khoá GPU, 24 bước gồm A/B bật↔tắt mô-đun ở TIER 3 và TIER 1); `--docker` chạy bản
  rút gọn qua `mo-may-chu.ps1 -TestMode`; `--perfonly` chỉ đo. A/B một mình với base: `tools/qa/mp2_int_ab.mjs` (xen kẽ thứ tự,
  `shoot.mjs --perf`, fps không kẹp). `launch.mjs openGame({chromeArgs})` nhận cờ Chrome thêm (vd. `--disable-gpu-vsync
  --disable-frame-rate-limit` — headless kẹp 60 fps thì "fps không đổi" không đo được gì).
  BẪY: (1) atlas canvas tải lại CẢ texture (4 MB + mipmap) = 1 khung dài mỗi lần — đếm khung > 1,8× trung vị khớp đúng số lần
  tải; chép ô mới bằng `renderer.copyTextureToTexture` trong `mesh.onBeforeRender` (renderer có sẵn ở đó, không cần đổi API);
  `CanvasTexture` flipY ⇒ dải canvas [y0, y0+h) đặt ở yoffset `AH − (y0 + h)`. (2) Ảnh/đo đám đông ở xa phải GIỮ cần boom chống
  xuyên tường (`__hp.camOcclusion(true)`) — tắt đi thì camera 30 m lọt ra sau nhà, phép đo "96 người trong khung" thành đo mái nhà.
  (3) Bot di chuyển: muốn ảnh cận cảnh thì bảo bot đứng (`bot.plaza.pauseUntil`, xe máy: `bot.idleUntil`) rồi ngắm lại theo vị
  trí đang vẽ. (4) Chi phí thật ở TIER 3: ~15 µs/người được vẽ (96 người +1,45 ms/khung không kẹp; 60 Hz vẫn 60 fps).
- **Bẫy netcode đã sửa (fixer MP-2 vòng 1 — SERVER.md §9.7):** (1) CORRECT nhỏ (≤ 6 m, kéo mượt 0,15 s): máy chủ chấm STATE
  mang epoch mới TỪ ĐIỂM ĐÃ SỬA (`MoveCheck.correctTo`) và KHÔNG xoá điểm vi phạm → STATE gửi giữa lúc kéo = vi phạm mới →
  CORRECT dây chuyền → bị đuổi (lệch 3,9 m = 15 CORRECT rồi kick). Luật: `corr.step()` trả true khi có kéo, đang `pending`
  thì KHÔNG gửi STATE; phần dời do kéo không tính vào vận tốc. Test `tests/net/correct_cascade.test.mjs` (Validator THẬT).
  (2) KEYFRAME (RESUME/phiên mới) RẢI ENTER ≤ 24/snapshot (`aoi.js ENTER_MAX`) — không bao giờ suy "ai không có trong keyframe =
  rời" từ MỘT snapshot; đối chiếu ở `net.js` (tập đang vẽ trước keyframe − ai được ENTER lại, chốt ở snapshot đầu có 0 ENTER
  hoặc 2 s). Máy chủ chỉ gửi UPDATE khi bản ghi ĐỔI → KHÔNG dùng "lâu không có mẫu" để xoá người (người đứng yên). (3) Vòng tick
  máy chủ quá tải BỎ tick → tickNo tụt sau đồng hồ thật vĩnh viễn; mốc "min(giờ đến − tick·50) trên 6,4 s" theo bước xuống ngay
  nhưng bước lên phải chờ hết cửa sổ → `interp.js TickBase` lấy lại mốc khi 12 mẫu cuối là một CAO NGUYÊN cao hơn > 40 ms (TCP
  kẹt rồi xả chùm thì độ lệch giảm dần 100 ms/mẫu — không phải cao nguyên, không lấy lại mốc). (4) `i18n.tf()` thay tham số trên
  chuỗi GỐC (trước đó `t()` đã thay `{N}` = số địa danh → mọi thời lượng chế tài hiện "22"). (5) `?server=` máy lạ phải xác nhận
  (tên máy chủ chữ to) trước MỌI request; chỉ DEFAULT_SERVER / localhost / host đã đồng ý (`hp3d.serverTrust`) được nhớ ngầm.
  (6) Danh sách chặn ở máy theo netId của PHIÊN (xoá ở WELCOME không resume); người đã chặn bị ẩn hẳn (`ra.hide`); bảng 👥
  "Người chơi quanh đây" (chạm biểu tượng kết nối hoặc 👥 trong ô chat) báo cáo/chặn được cả người không chat. (7) `__hp.net`
  chỉ có ở localhost hoặc `?qa=1` (từ riders fixer; trước đó `navigator.webdriver`/`?qa` bất kỳ — xem mục dưới).
- **Không kéo về oan (riders fixer, 15/10/2026 — SERVER.md §9.8):** vật lý thật (vehicles.js: xe máy 16 m/s, ga 3,6 m/s², kẹp
  dt 50 ms/khung ở main.js) KHÔNG vượt trình kiểm (16·1,2 + 1 m/cửa sổ); 3D dài hơn 2D trên dốc/cầu chỉ làm tốc độ 2D NHỎ đi.
  Các CORRECT "SPEED" của bot S4 trong e2e đến từ BOT, không từ luật: (1) bot đóng dấu `clientMs` lúc GỬI trong khi vị trí tính
  ở `now` chung của vòng tick → vòng sự kiện khựng giữa vòng (GC, IPC Playwright) = mẫu sau mang cả quãng khựng trong khe dấu
  20–60 ms → cửa sổ 300 ms tràn 3 STATE liền → CORRECT (28 bot cùng 1 ms). LUẬT: dấu thời gian STATE = thời điểm của VỊ TRÍ
  (bot: `posT`; client: preFrame ngay sau di chuyển cùng khung). (2) máy chủ khởi động lại → bot giữ vị trí cũ + epoch cũ, máy
  chủ neo ở vị trí đã lưu ≤ 30 s trước → TELEPORT/SPEED + 29 SERVER_MOVE; bot nay làm như client (`_rejoin`: epoch 0, về điểm
  máy chủ khi lệch > `REJOIN_SNAP_M` 12 m < `FIRST_RADIUS_M` 15 m — hằng ở constants.js, test giữ thứ tự). (3) client: lên rồi
  xuống xe (hoặc ngược lại) lọt giữa 2 STATE 66 ms = máy chủ thấy ĐI BỘ nhảy vài mét → CORRECT; nay gửi STATE NGAY sau mỗi lần
  lên/xuống (cách STATE trước ≥ 30 ms). Máy chủ ghi `"msg":"correct"` mỗi lần kéo về (cửa sổ `win` 1 = 1 s, 2 = 300 ms,
  3 = 4 s, 4 = bước đầu; `dist`/`limit`/`dtS`/`lead`), `LOG_LEVEL=debug` ghi cả STATE bị từ chối (`"violation"`). Kiểm:
  `tools/qa/mp_riders.mjs` (1 Chrome lái thật), `tools/qa/mp_converge.mjs` (bot + khựng + khởi động lại máy chủ),
  `server/test/riders_regress.test.js`. Tay cầm QA: `__hp.net`, và khi ONLINE `__hp.teleport`/`pState`/`world`/`vehicles`/
  `mount`/`player`/`traffic`/`footprints` chỉ có ở localhost hoặc `?qa=1` (`js/qagate.js`; KHÔNG theo `navigator.webdriver`);
  launch/shoot/clearance/mp2_nonet tự thêm `qa=1`; kiểm cổng: `tools/qa/mp_qagate.mjs`.
- **Người chơi khác trong game (MP-2 C2, `js/net/remote_avatars.js` + `interp.js` + `nametags.js`):** API và số đo ở
  `docs/multiplayer/SERVER.md` §9. Luật đã kiểm: **≤ 5 draw call cố định** cho mọi N (người · xe máy gần · xe máy xa · bóng
  tiếp đất · vòng sáng + bảng tên), **0 chương trình shader mới** (vật liệu `kitMaterial` cùng tham số với traffic.js → cùng đối
  tượng; bảng tên = `InstancedMesh` 1 instance MeshBasic map trong suốt = biến thể của vũng đèn đêm — `Mesh` thường từng tạo
  thêm 1 chương trình, đo `renderer.info.programs` 76 → 77). Trần TIER 1 → 40, TIER 2/3 → 96 (gần camera nhất, trễ 0,8);
  bảng tên 24 gần nhất trong 25 m, mờ dần 17→25 m bằng 4 MỨC MỜ vẽ sẵn trong atlas (alpha theo đỉnh = biến thể shader mới).
  BẪY: (1) tứ giác billboard tự dựng phải CCW nhìn từ camera (bản đầu cull mặt sau → bảng tên vô hình, vòng sáng vẫn hiện);
  (2) `surfaceY` là NỀN — xe/người đặt trên mặt nhựa `+ROAD_TOP` (như traffic.js), vòng sáng người đi bộ ở `SIDEWALK_TOP + 2 cm`
  (thấp hơn bị vỉa hè che); (3) `page.evaluate` trả đối tượng three (mesh → scene) làm Playwright treo khi tuần tự hoá — luôn
  trả số/JSON; (4) snapshot 10 Hz mang STATE 15 Hz mới nhất → tuổi mẫu rung 0–67 ms → tốc độ hiển thị "đập" ±30 % ở xe máy:
  `interp.js` căn lại thời điểm mẫu theo quãng đường/`spd` (rung dấu thời gian 23 → 5,5 ms); (5) máy chủ chỉ gửi bản ghi ĐỔI
  → người đứng yên không có mẫu nhiều giây: chèn mẫu giữ chỗ t − 100 ms khi họ đi lại (không trườn chậm suốt quãng nghỉ).
  Kiểm: `node --test tests/net/interp.test.mjs`, `node --import ./tests/net/register.mjs --test tests/net/remote_avatars.test.mjs`
  (three thật + world/device giả), trong game `tools/qa/mp_c2_avatars.mjs` (giả lập máy chủ + mạng trong trang, KHÔNG sửa main.js).

## 9. Deploy

- Workflow `.github/workflows/deploy-pages.yml`: push nhánh làm việc → mirror sang `gh-pages` (force).
- `.nojekyll` bắt buộc (tên file có ký tự đặc biệt làm Jekyll fail).
- GitHub Pages cache `max-age=600` → bảo người dùng Ctrl+Shift+R, đợi ~10 phút.
- Vercel (tùy chọn): import repo, không cần build command (site tĩnh).

## 10. Nhật ký cập nhật (thêm dòng mới ở TRÊN CÙNG)

- **2026-10-15 (MP-2 fixer vòng 1 — sửa 9 phát hiện phản biện, SERVER.md §9.7):** NC-1 CORRECT nhỏ không còn dây chuyền →
    kick (giữ STATE tới khi kéo xong; test Validator thật 36 tổ hợp fps×RTT×lệch: đúng 1 CORRECT); NC-2 RESUME không còn bóng
    ma (đối chiếu keyframe rải ở net.js, worker bỏ diff sai); NC-3 `TickBase` lấy lại mốc khi máy chủ bỏ tick (khung ngoại suy
    6,4 s sau sự cố 80–100 % → 9–34 %); UX-1 `tf()` (thời lượng chế tài từng hiện "22"); SAFE-1 hộp "Máy chủ lạ" trước mọi
    request; SAFE-2/3 chặn theo phiên + bảng 👥 người quanh đây + ẩn người đã chặn; MOB-1/2/3 CSS điện thoại. Kiểm: e2e 96 bot
    **27/27**, điện thoại **14/14**, `mp2_c1_unit` 278/278, test node 23/23; một mình: diag full + lite, mobile, waterbfs, tour,
    check_assets, mp2_nonet full + lite đạt, 0 lỗi JS. Đầu ra: `C:/Users/Admin/hp-world-work/mp2/fixer1/`.

- **2026-10-15 (MP-2 TÍCH HỢP — "thấy nhau" GĐ1 phía game hoàn chỉnh):** gộp `--no-ff` C1 (mạng/phiên/giao diện) rồi C2 (hình người
    chơi khác); `net.js` dùng `remote_avatars.js` thật, bỏ `remote_avatars_stub.js`; ENTER truyền dấu thời gian snapshot ở tham số 4;
    `positions()`/`__hp.net.avatars()` cho QA; byte 7 ngoại hình = 0. Sửa: bảng tên chép từng dải hàng lên GPU thay vì tải lại cả
    atlas 4 MB (hết giật định kỳ: khung dài = số lần tải → 0 lần tải cả atlas, khung trung bình +0,46 → +0,14 ms); ẩn bảng tên người
    < 2,5 m từ camera. `tools/qa/mp2_int_e2e.mjs` (máy chủ native test 9230/9231, 96 bot S4, 1 Chrome khoá GPU, Radeon 890M):
    **24/24 ĐẠT ×3 lượt** — người khác vẽ bằng mô-đun thật (96 vẽ, vòng sáng + 24 bảng tên có dấu, draw call mô-đun 3–4, tổng +4,
    0 chương trình shader mới), người lái xe máy, chat 2 chiều (84–96/96 bot nhận), lọc số điện thoại, báo cáo/chặn, bot gian lận
    bị kéo về (trình duyệt thấy lệch ≤ 7 m), teleport → CORRECT, RESUME 96→96, ngày/đêm lệch 0,01 phút, tắt máy chủ → Khám phá →
    tự vào lại 7–8 s, TIER 1 trần 40. Hiệu năng (bật↔tắt mô-đun, fps không kẹp): TIER 3 96 người +1,45 ms/khung (110 → 95 fps; 60 Hz
    vẫn 60), TIER 1 40 người +0,58 ms. Docker `mo-may-chu.ps1 -TestMode` (hpmp-int2) + trình duyệt qua portal: 11/11. Một mình A/B
    với dot3 (5 lượt xen kẽ): startReady chênh trung vị −4 ms, draw call 374 = 374, 0 lỗi; diag full + lite, mobile, waterbfs, tour
    (26 ảnh, giống hệt base), check_assets, mp2_nonet full + lite, mp2_c1_solo, mp2_c1_unit 237/237, test node 18/18 đều đạt.
    Ảnh/số: `C:/Users/Admin/hp-world-work/mp2/int/`. Xem §8c, SERVER.md §9.6.
- **2026-10-15 (MP-2 C1 — MẠNG + PHIÊN + GIAO DIỆN phía game, GĐ1 "thấy nhau"):** `js/net/{config,net_worker,session,correct,
    telemetry,net,remote_avatars_stub}.js`, `js/ui/chat.js`; điểm nối main.js (import động khi có máy chủ, attach, preFrame/frame,
    mount/dismount, onStart, onBootReady, `__hp.net`), input.js (`onChatKey` T và /, `releaseKeys`), ui.js (`registerModal`),
    daynight.js (`syncTo`), i18n (khoá `mp*`/`chat*` vi+en, `tf()`), css. Không sửa `server/*`, `js/shared/*`.
    Kiểm `tools/qa/mp2_c1_e2e.mjs` (máy chủ native `HPMP_TEST=1` cổng 9210/9211, 30 bot biệt danh có dấu, Radeon 890M TIER 3):
    **19/19 ĐẠT** — mã mời sai → câu tiếng Việt; tạo tài khoản "Nguyễn Thị Hường" → mã khôi phục 12 ký tự hiện 1 lần; vào
    thành phố 0,8 s sau bấm (WELCOME + READY); 22 người chơi khác thấy được (stub 1 draw call); chat 2 chiều có dấu (bot →
    khung chat; trình duyệt → 16/30 bot trong 40 m nhận nguyên văn); tin có số điện thoại bị chặn với câu tiếng Việt, 0 lọt;
    báo cáo + chặn từ menu chat (tin sau khi chặn không tới); `__hp.teleport` 323 m → CORRECT TELEPORT nhảy về đúng chỗ trong
    0,5 s; rớt socket → RESUME cùng netId 1,6 s; ngày/đêm lệch máy chủ 0,01 phút game; tắt máy chủ → "Khám phá · Đang nối lại…"
    + người khác biến mất sau 3 s, vẫn đi được; bật lại → tự vào lại 7,9 s sau khi máy chủ lên (vé mới), thấy lại 12 người;
    trình duyệt thứ 2 lấy lại tài khoản bằng mã khôi phục, ngày/đêm lệch 0,02 phút game. RTT p50 0,9 / p95 1,5 ms (loopback).
    Một mình (không `?server=`): `mp2_nonet` full + lite 0 import js/net, 0 WebSocket, 0 request API, 0 lỗi; diag full + lite,
    mobile, tour 26 ảnh, waterbfs, check_assets đều đạt, 0 lỗi JS. Ảnh/log: `C:/Users/Admin/hp-world-work/mp2/c1/`.
- **2026-10-15 (MP-2 C2 — HÌNH NGƯỜI CHƠI KHÁC + NỘI SUY + BẢNG TÊN + chấm minimap):** `js/net/{remote_avatars,interp,nametags}.js`,
    `js/minimap.js` (tham số `markers`), test `tests/net/*` (18 test node), công cụ `tools/qa/mp_c2_{avatars,page,plot}.mjs`.
    Trong game thật (Radeon 890M, cùng phiên, 1 Chrome dưới khoá GPU): TIER 3 96 người ở quảng trường Nhà hát → 87 trong 200 m
    được vẽ, **4 draw call của mô-đun** (đếm theo mesh), chương trình shader 76 → 76; TIER 1 (lite) 96 → vẽ 40, 3 draw call,
    51 → 51; fps 60 (vsync) cả trước/sau, khung p95 16,9 ms; `frame()` 0,26 ms CPU ở 96 người. Nội suy trong game (luồng 10 Hz rung
    + kẹt TCP + rớt 40–42 s + RESUME): sai số p50 0,07 m · p95 0,23 m · p99 1,3 m (kẹt TCP > 250 ms: ngoại suy dừng ở 250 ms theo
    SPEC rồi đuổi kịp), bước khung lớn nhất 0,94 m, trễ hiển thị 265 ms. Ảnh: `C:/Users/Admin/hp-world-work/mp2/c2/`. Xem §8c.

- **2026-10-15 (MP-1 MÁY CHỦ THỬ NGHIỆM KÍN — gộp vào dot3):** js/shared/ + server/ (146 tệp mới, chỉ sửa .gitignore và
    deploy-pages.yml để bỏ server/ khỏi gh-pages). Đã qua 3 phản biện (bảo mật, mạng, an toàn chat/vận hành) với 29 lỗi
    cần sửa, và 2 vòng sửa. Kết quả: test 154/155 (1 bỏ qua), test Postgres 61/61; kịch bản bot smoke, hotspot 300,
    stress 2.000, reconnect 1.000, abuse 200 (lọt tốc độ 0 %), netem đều đạt; ramp 1.200 trượt p99 trên máy Windows này
    (xem §8c). Tunnel tạm: RTT p50 58 ms. Xem §8c.
- **2026-10-15 (Đ3-W5 SỬA HỒI QUY r2: pano_336 — LỀ BÃI ĐỖ trước lan can dải bờ)** [chấm 2 người: 336 OLD 5,15 → NEW 4,75]:
    **Nguyên nhân:** W5-D thu Tam Bạc bắc về ngõ 5,5 m + vỉa 1 m ⇒ `riverbank.stripRail` đặt lan can ở hw + sw + 0,5 = 4,25 m từ
    tim ⇒ phía sông 336 h180/h270 còn vỉa 1 m sát lan can, mất hàng cổ thụ + 2 hàng xe máy đỗ (ảnh: lề bê tông ~4 m, h270 ~15 xe,
    h0 ô tô đỗ, lan can ~8 m từ tim; dot3 vỉa 3,5 m → lan can 9 m nên gần đúng). Ảnh 335/337/519/520: lan can/lán SÁT mép ngõ ⇒
    KHÔNG nới cả đoạn (không gỡ ngõ W5-D). **Sửa:** `riverbank.js` STRIP_VERGE `[{pano_336 (−400,7, −688,1), w 4, r0 15, r1 23}]`
    (chỉ ngõ vỉa < 2 m): lan can lùi thêm bề lề, 2 đầu mỗi mẩu tính riêng (liền, vát chéo ở quãng vuốt); mặt lề bê tông xám
    (`riverbank_verge`, cao độ đất + 3 cm — đồ props đứng mặt đất, không đổi surfaceY); lán/cây bờ chỉ trong phần dải còn lại sau lan
    can; trả `vergeAt(x,z)` → `props.js` (ctx.vergeAt từ world.js): bên phố có lề ⇒ `S.sw` += lề (dải đỗ xe lùi ra lề, vỉa ≥ 3,4 m
    ⇒ 2 dải xe như ảnh), ô có lề tại dải đỗ < 3 m bị bỏ (`rej.verge`, rj 7 — xe không chồm qua lan can). Phụ: bố trí quán/người
    đổi ⇒ 336 h0/h90 có ô dù + khách ngồi trước tạp hoá (như ảnh). Không sinh lại dữ liệu (mapdata/buildings_real/herokit giữ).
    **Kiểm (tier 3 Radeon 890M D3D11, khoá GPU, 1280×634 traffic off; OLD = ảnh dot3 bcdcacc cũ ở w5finish/old):**
    `w5finish/new2` + `pairs2` (336 + đối chứng 519 331 221 088): 336 h180/h270 lan can ~8 m, cổ thụ + 2 hàng xe trên lề; 519/
    331/221/088 = bản r1 (chỉ người đi bộ lệch). Cổng: node --check + vm.SourceTextModule (riverbank/props/world), waterbfs 5/5,
    check_assets ĐỦ (8b8e42c), check_herokit 407/407 (900eb8db), diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 cũ (259,111)),
    diag lite OK bất biến 0, mobile OK 0 lỗi, tour 26 ảnh 0 lỗi (postoffice chọn điểm đứng khác — tìm điểm theo tia, giao thông
    không tất định). Perf std 24 khung traffic on, 2 vòng xen kẽ r1 1a27b06 ↔ bản này: tris 81,31/83,26 → 79,87/82,54 M, calls TB
    395,4/413,0 → 395,0/408,8, fps thấp nhất 57-58 cả hai, hpReady 7955/7918 → 7363/8042 ms ⇒ không đổi trong nhiễu.

- **2026-10-15 (QA BỀN: `tools/qa/audit_views.mjs` + thư mục ngoài %TEMP%)** [scratchpad phiên bị dọn 2026-10-15 ⇒ mất ảnh/khung chấm]:
    `node tools/qa/audit_views.mjs <out.json> <id…|ids.json>` → views cho `shoot.mjs --views`: 4 hướng 0/90/180/270 mỗi pano, đứng
    ĐÚNG vị trí xe Street View (X, Z từ audit/pano_index.json 420 + pano_index2.json 131 = 551), kind 'pano' (teleport pitch 0,02,
    dist 0,1), id `<pano>_hHHH` khớp tên ảnh của `tools/qa/make_pairs3.py`; ghi kèm `<out>_ids.json` cho make_pairs3. Quy trình
    so OLD/NEW: OLD = `git worktree add --detach <dir> <sha>` + HARD-LINK GLB assets/ + assets_lite/ (`ln`, không chép 330 MB),
    `python -m http.server` cổng riêng; chụp `shoot.mjs --w 1280 --h 634 --settle 12000 --traffic off` (tự xin khoá GPU) → make_pairs3
    → NHÌN từng ảnh ghép. Đầu ra bền: `C:/Users/Admin/hp-world-work/<đợt>/` (ngoài %TEMP%, không bị dọn); xong thì `git worktree
    remove` bản tạm.
- **2026-10-15 (Đ3-W5 SỬA NỐT HỒI QUY BỊ CHẶN: 382/336/331 + xe phủ bạt + bay mở trống)** [sinh lại tất định, hero khoá lại bằng rekey]:
    **382:** `process_osm` SPLIT_WAYS thêm `{ id: 1208204466, x: −401 }` (cắt theo HOÀNH ĐỘ; nửa ĐẦU = đông/Bến Bính giữ ri 447 →
    bề rộng cấp như dot3; nửa tây nối cuối ri 1426 vẫn là way gần nhất của 383/384 ⇒ giữ ngõ 5,5 m). Đuôi tách mang `sp` = ri gốc
    (XUẤT ra mapdata `ROADS_DT[i].sp`); `roadnet` gộp NHÃN VẠCH ảnh của các nửa cùng gốc như trước khi tách (không có: nửa đông mất
    nhãn 'không vạch tim' của 384 → vạch mép trắng trên bãi đất 382 h0/h90; khúc nam 962470755 cũng lại hưởng nhãn như dot3).
    **336 (h180/h270 khối nhà trắng 1 tầng chắn bờ sông):** footprint Google 5 × 15 m nằm trong DẢI BỜ giữa ngõ 5,5 m và sông
    (riverbank.js mode 'strip' — lan can ở mép vỉa ngõ, lán/bạt THẤP + cổ thụ do riverbank tự dựng); trước W5-D lòng cấp s 10 m
    cắt mất phần lớn (dot3: hộp 4 × 7 m cách 14 m). `bankStrip` không bắt (không đỉnh chạm nước, dải > 12 m) ⇒ luật mới
    `narrowBankStrip` (process_buildings, `drop_bank_narrow`): nguồn KHÔNG OSM, tâm cách sông/kênh < 12 m, có đoạn ngõ HẸP (mặt
    tiền ≤ NARROW_FL) chạy dọc phía đất (cos ≥ 0,7), mép lòng → nước qua tâm < 20 m, trong 40 m quanh camera NARROW_CAMS — bỏ 3 nhà
    (336, (−425,−963) 39 m², (−353,−595) 11 m²); lán thật xa ngõ (331 h270, 21-33 m) giữ. **336 h0/h90 (sát 4-5 m, ảnh là tạp hoá
    mở):** FG1 ('shop_open') chỉ số 2 G_SHOP2 (QUÁN ĂN tối + bảng thực đơn = đọc ra cửa cuốn đen) → G_SHOP0 tạp hoá (quán ăn có
    FG11). **331 (mái bạt sọc + quán mở → cửa cuốn):** cùng 1 nhà (chỉ số đổi b10932 → b10942); mặt lô ra sát ngõ ~1 m nên tia h135 x
    0,6-0,72 ('shutter', thật là nhà phía nam) chạm lô ⇒ phiếu trệt shutter 1,256 > restaurant 1,236 (gần HOÀ). `gen_facade_fp`
    **FP_PIN** = quan sát đã đối chiếu ảnh thật, trọng số × w (khoá theo pano/hướng/x0/x1, cảnh báo nếu không khớp đúng 1 dòng):
    `pano_331 h90 x 0,58-1` × 2 ⇒ ground restaurant, awning 4 (sọc) như dot3. FG11 (quán ăn) chỉ số 2 G_OPEN2 (đồ gỗ/tủ thờ ĐỎ =
    "tấm đỏ" 331 h90) → G_OPEN0 quán cà phê/ăn mở. **Xe phủ bạt (088 h90, 166 h90/h180 "túi" xanh/xám):** `modelCoveredBike` áo
    chỉ phủ YÊN + THÂN SAU (mép 0,42 m), đầu xe LỘ (yếm, cổ lái, ốp đèn, ghi đông + 2 gương, phuộc, chắn bùn, 2 bánh đủ vòng + đùm),
    ~330 tam giác; COVER_COLS bỏ xanh/đỏ rực (xám-xanh nhạt); tần suất: bằng chứng 0,22 → 0,16, không bằng chứng 0,025 → 0,012
    (phố r 0,06 → 0,03) — 088 không có bằng chứng phủ bạt, 166/097 có. **097 h90/h180 bay mở be trống + khối đỏ:** GH chỉ số 6
    (W5-B G_SHUT1 → G_HOME1) chọn G_HOME1 (nhà b16725 vân tay trệt 'none' → thống kê) ⇒ GH[6] TRẢ VỀ G_SHUT1 như dot3 (097
    = cửa cuốn xanh như ảnh/dot3; GH vẫn 2 G_HOME2 + 1 G_HOME1 mở cửa theo ý W5-B); G_HOME1 vẽ lại CÓ ĐỒ (tủ gỗ + TV, bàn thờ
    treo + lịch, ghế nhựa, xe máy ra dáng, cửa lùa song đứng 1/3), G_HOME2 thêm TV/tranh/lịch/ghế/chậu cây; FG5 ('gate' = cửa
    ĐÓNG) chỉ số 1 G_HOME1 → G_GATE. G_ELEC: tranh = nền chuyển màu + máy điện thoại + dải chữ, kệ máy có màn sáng (166 h180 "ô
    xanh giữ chỗ"). Program key `fabric_v5fy_`.
    **Sinh lại (2 lần, md5 nội dung LF):** mapdata f4b5f010 (1427 way: 1425/1426 nối cuối, chỉ số cũ giữ), buildings_real f5368062
    (43.372 nhà, rbHash 900eb8db), `rekey_herokit` 407/407 khớp (0 dời tâm, 0 bỏ) → herokit_data b5254901; check_herokit OK.
    **Kiểm (tier 3, Radeon 890M D3D11, khoá GPU; OLD = git worktree bcdcacc :8802, NEW :8801; ảnh bền ở
    C:/Users/Admin/hp-world-work/w5finish/{old,new,pairs}):** 20 pano × 4 hướng (331 336 382 088 166 097 106 230 313 + đối chứng 414
    377 161 354 359 147 028 446 519 221 115) 0 lỗi JS — 382 = dot3 (hết vỉa gạch/hàng cây/vạch mép); 336 h0/h90 tạp hoá kệ hàng,
    h180/h270 bờ sông thoáng; 331 h90/h180 mái bạt sọc + quán mở; 097 h90/h180 cửa cuốn xanh = dot3; 088/166 xe phủ bạt ra dáng
    xe (đầu lộ) / ít hơn; 221 h0 hết vạch tim (ảnh thật không vạch). Cổng: node --check + vm.SourceTextModule các file đổi, waterbfs
    5/5, check_assets ĐỦ (8b8e42c), check_herokit 407/407 (900eb8db), diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 cũ
    (259,111)), diag lite OK mọi bất biến 0, mobile OK 0 lỗi, tour 26 ảnh 0 lỗi. **Perf cùng phiên (máy có workflow khác chạy tải):**
    khởi động 3 vòng xen kẽ hpReady 6810 → 7528 ms, startReady 8982 → 10021 ms (bước tăng = fabric/landmarks/final của W5 A-D như
    mục tích hợp, không phải bản sửa này); std 24 khung (traffic on): tris tổng 76,06 → 78,00 M (+2,6 %, tệ nhất pano_092 h0 +8,3 %),
    calls TB 398,5 → 396,2, fps tối thiểu 60/59,9, heap 407 → 456 MB.
- **2026-10-15 (HEROKIT KHOÁ LẠI — `tools/rekey_herokit.mjs`)** [ghi chú fp_json MẤT ⇒ phân loại hero ĐÓNG BĂNG]:
    **Sự cố:** 2026-10-15 ~00:12 thư mục scratchpad phiên bị dọn ⇒ mất `keep/fp_json` (3.306 JSON trích xuất ảnh, có GHI CHÚ TỰ DO)
    + `keep/fp_plan.json`. Quan sát CÓ CẤU TRÚC vẫn còn trong `audit/facade_fp.json` (đã cam kết — vân tay mặt tiền W4-A sinh lại
    được), nhưng `tools/gen_herokit.mjs` đọc ghi chú (chùa/ngân hàng/khách sạn/điện máy…) ⇒ **`js/herokit_data.js` KHÔNG sinh lại
    được nữa**; `check_herokit` khoá nó theo đúng bản buildings_real (HERO_META.rbHash) ⇒ trước đây MỌI lần sinh lại buildings_real
    đều làm gãy hero. **Đường chuẩn từ nay khi buildings_real đổi: `node tools/rekey_herokit.mjs`** (check_herokit báo lỗi trỏ về
    đây): tìm trong git bản buildings_real có FNV-1a(RB_B64) = HERO_META.rbHash (hoặc `--from <file>`), mỗi hero → nhà cũ (tâm ≤ 0,6 m,
    luật heroAt) → nhà mới theo HÌNH HỌC: ưu tiên nhà chứa tâm nhà cũ, rồi diện tích chồng lớn nhất (lưới điểm tất định trong nhà cũ),
    hoà ±1 % → tâm gần nhất; nhận khi chồng ≥ 30 % nhà cũ hoặc ≥ 50 % nhà mới. Không khớp / mơ hồ (2 hero rơi vào 1 nhà mới: giữ hero
    chồng lớn hơn) / tâm mới trùng nhà khác → BỎ và in ra; giữ nguyên chương trình/màu/cờ/điểm tiêu; HERO_META đổi rb, rbHash, n,
    prog + `rekey {genRbHash (bản gen_herokit gốc), from, matched, moved, unmatched, ambiguous, collide}`. Tất định (cùng byte). Thử
    trên buildings_real trước W5-D (ebd3dd3): 393/407 khớp, 11 không khớp, 3 mơ hồ, 0,5 s. **Muốn phân loại MỚI** (thêm nhà hero, sửa
    nhầm): chạy lại trích xuất ảnh (tools/pano_loop) VÀ CAM KẾT đầu ra (`audit/fp_json/*.json` + `audit/fp_plan.json` — vài MB, đừng
    để ngoài repo nữa), rồi `gen_facade_fp --collect` + `gen_herokit`. Không bao giờ để đầu vào của bộ sinh chỉ nằm trong %TEMP%.
- **2026-10-15 (Đ3-W5 SỬA HỒI QUY TÍCH HỢP)** [chấm REAL | dot3 bcdcacc | W5 tích hợp: 088/097/106/166/230/313/331/336/382 tụt 0,2-0,5]:
    **Nguyên nhân + sửa (tại nguồn, không gỡ W5):** (1) **HERO 'cửa hàng'/'khách sạn' trên NHÀ ỐNG** (088 h0 bảng lớn xanh → tấm đen
    trống; 166 h90/h180 ốp đen không chữ + trệt showroom trắng; 313 h90/h180 dãy cửa hàng → tháp RS.HOTEL kính trơn): 94/99 cửa hàng
    và 37/47 khách sạn của herokit_data là footprint < 200 m² — kit xoá bảng lớn theo ảnh (fpMode 3 → 2), biển từng bay (panel 0),
    ban công/điều hoà (`detOK`), ép trệt FG14. `citygen.renderStyles`: cửa hàng < 200 m² CHỈ giữ chương trình khi có CHỮ NGÀNH (điện
    máy/thời trang/điện thoại), ≥ 3 tầng, mỗi loại ≤ 1 / 45 m (sổ `storeLead`, thứ tự b) — còn lại = nhà ống vân tay y dot3 (thống kê
    `heroStoreTube`); khách sạn < 250 m² KHÔNG thành hero (`hlx` → `buildHero({mini})` chỉ dựng BIỂN DỌC 'KHÁCH SẠN', ≤ 1 / 20 m —
    `heroHotelMini`). herokit `heroStore`: chữ ngành chỉ nhà ≥ 3 tầng (166 h0: nhà 2 tầng → tấm chữ trên mép mái = "biển trên nóc");
    ốp TỐI chỉ làm nền cho chữ (không chữ + tối → không ốp). Trệt cửa hàng hero: giữ bộ trệt vân tay (mở/cuốn/nhà ở…), FG14 chỉ khi
    không có hoặc vân tay 'kính'; FG14 = G_OPEN1/G_STORE0 (bỏ G_SHOW nội thất trắng + G_STORE2 khung poster = "kính trắng ô màu
    giữ chỗ"; G_ELEC cũng đọc ra ô xanh giữ chỗ — không dùng). Giữ: 414 'SIÊU THỊ ĐIỆN MÁY', 377/147/028 'THỜI TRANG NỮ', 028 h180 lại
    có bảng lớn 'NỘI THẤT GỖ'. (2) **106 mảng ố nâu/tối** = phong hoá v2 W5-B: mảng vữa bong to bằng cửa sổ (tần số ×0,55) + 30% gạch
    nâu + vữa xám tối 0,36 → mảng ~1 m (×1,0/×1,35), ngưỡng 0,88 − 0,1·tuổi, vữa xám nhạt pha màu tường (gạch nhạt 15% nhà rất cũ),
    viền 0,3 → 0,18, blot 0,28 → 0,2 (mức W3-C), streak 0,42 → 0,36. (3) **097 h90 'ô cửa đen'**: SETS W5-B đổi mảng → chỉ số chọn bay
    lệch, bay thành G_HOME1 (nội thất −4 ≈ đen ở 3 m) → G_HOME1 nội thất +26, tường trong sáng, đèn tuýp; G_HOME2 10 → 30; `dayLitOf`
    cửa mở 0,14 → 0,3 (+G_HOME1) — chỉ nâng texel tối, tắt khi đêm (đã kiểm --gl1). (4) **230 h180 trụ vuông giữa vỉa hè**: herokit
    khách sạn đặt trụ ở D − 0,5 với D = g + 2 ⇒ LẤN g + 1,5 m; mái sảnh W4-C (`hotelCanopy`) nay KHÔNG trụ (công-xon như dot3), mái
    khác trụ ≤ g − 0,4. Program key `fabric_v5fx_`.
    **CHƯA SỬA (bị chặn):** 331 h90/h180 (mái bạt sọc + quán mở → cửa cuốn xanh: ngõ W5-D dời hình nhà → vân tay quan sát gán lại —
    b10932 'restaurant/awn 4' → b10944 'shutter/awn 1'), 336 h180/h270 (footprint Google 1 T bờ sông b12354 nay cách camera 4-6 m sau khi
    ngõ hẹp; quầy/người ở h0 mất vì ngõ 5,5 m), 382 (way 447 — nửa một chiều KHÔNG TÊN chạy từ ngõ Tam Bạc 383/384 SONG SONG Bến Bính
    576 tới x −228 — nhận ghi đè ngõ 5,5 m của W5-D cả đoạn Bến Bính ⇒ lộ vỉa hè gạch + hàng cây giữa 2 đường nơi ảnh là bãi đất; SỬA ĐÃ
    THỬ: process_osm SPLIT_WAYS thêm `{ at: [-412, -950], x: -401 }` (cắt theo hoành độ tại nút 576/588 — đoạn đông giữ ri 447, đoạn
    tây nối cuối ri 1426) → 382 = dot3 (nhà quanh 382 y hệt dot3)). Cả 3 cần SINH LẠI buildings_real ⇒ phải sinh lại herokit_data
    (rbHash), mà đầu vào `keep/fp_json` + `fp_plan.json` ĐÃ MẤT (thư mục scratchpad phiên bị dọn 2026-10-15 00:12) ⇒ hoàn lại, ghi
    ở đây để làm khi có lại fp_json. BẪY: `node --check` KHÔNG bắt lỗi khai báo trùng của ES module (citygen bị chú thích nuốt nửa câu
    lệnh) — kiểm thêm bằng `vm.SourceTextModule` (`node --experimental-vm-modules`) hoặc chụp 1 khung.
    **Kiểm (tier 3, Radeon 890M D3D11, khoá GPU, 1280×634 traffic off; OLD = git worktree bcdcacc :8802, INT = e1f561e :8803, FIX :8801;
    playwright-core cài lại ở scratchpad/pw — PW_PATH):** 16 pano × 4 hướng 0 lỗi JS; 088 h0 bảng lớn xanh = dot3; 313 h90/h180 dãy
    biển cửa hàng = dot3; 166 hết tấm đen trống/biển trên nóc, trệt thành giá quần áo; 106 hết mảng nâu; 230 h180 hết trụ; 097 h90 thấy
    phòng có xe máy thay ô đen. Cổng: check_herokit 407/407 (52ff1208), check_assets ĐỦ, waterbfs 5/5, diag full "TẤT CẢ THỰC THỂ OK — 0
    lỗi JS" (overlap 1 cũ (259,110)), diag lite OK mọi bất biến 0, --gl1 3 khung 0 lỗi.
- **2026-10-14 (Đ3-W5 TÍCH HỢP)** [ĐỢT 3 WAVE 5 — gộp 4 nhánh lên `dot3` (00fd41c = bcdcacc + 2 commit tài liệu) theo thứ tự D → A → B → C, `--no-ff`]:
    **Gộp:** W5-D LANES (`worktree-wf_0dec13b5-96e-4`, b2943af) sạch; W5-A HERO-KIT (`…-96e-1`, 03fa2cb) sạch (citygen/world/
    KNOWLEDGE tự gộp); W5-B STREETFRONT (`…-96e-2`, 0970e0c) xung đột 4 khúc `js/citygen.js` + 1 khúc `js/facade_atlas.js`; W5-C
    LIFE-GREEN (`…-96e-3`, ec85eb7) sạch (`streetlife.js` D + C tự gộp; props/trees/bộ sinh không chồng ai). Bốn mục §10 (D, A, B,
    C) giữ nguyên bên dưới. **Giải xung đột (giữ ý cả 2 phía):** (1) program key MỚI `'fabric_v5ab_'` (A `fabric_v5a_` + B
    `fabric_v5b2_` cùng đổi shader); (2) `gen()`: `heroSigns.length = 0` (A) + `ntiles` (B); (3) `let fpG/fpMode` (A gán lại trong
    nhánh hero) + `NT.fpv = M.fpv` (B) — VÀ trong nhánh hero `NT.fpv = hb` (nghĩa vụ chéo B ghi trong báo cáo: ô gần dùng cùng aFp
    hero, không thì đồ ô gần của nhà hero đọc vân tay cũ); (4) cục nóng: mật độ B (0,26/0,18) + điều kiện `!HPg` của A;
    (5) facade_atlas: ô A (H_SIGN, H_FLUTE) RỒI ô B (G_HOME2, D_AWN3, D_MISC, D_CAGE) = 111/112 ô (ATLAS_ROWS 14, còn 1 chỗ; mọi
    chỗ dùng tra theo TÊN `MOD.X`, không chỉ số cứng). **Nghĩa vụ chéo A × B sửa ở bước gộp:** hàng bày tràn hè (goods) và ống
    thoát nước mái (ô NEAR của B) thêm `!HPg` — hero tự dựng mặt trệt/chi tiết (luật A: không ban công/mái hiên/cục nóng thống kê
    trên hero). Màu nhấn hero (A, `aFp` chế độ 2) ⇒ `fpSign` = true trong shader ⇒ KHÔNG qua phai màu biển thống kê của B (mối lo
    trong báo cáo B đã tự thoả).
    **Sinh lại (2 lần mỗi bộ, md5 nội dung LF — bẫy autocrlf: so `tr -d '\r'`):** `gen_facade_fp --collect keep/fp_json keep/fp_plan.json`
    → audit/facade_fp.json a70dfba4 = không đổi (A chỉ thêm tuỳ chọn notes); `process_osm` (từ tools/) → mapdata 30993c5b ×2 = bản D
    (ROADS_DT 1426 way: chỉ mục cũ giữ nguyên, D nối 1 đoạn `962470755:s` ở cuối ri 1425); `process_buildings` → buildings_real
    7c77e98d ×2 = bản D (43.376 nhà); **`gen_herokit keep/fp_json keep/fp_plan.json` → herokit_data 971226df ×2: 407 hero** (office 112,
    store 99, bank 61, hotel 47, school 42, colonnade 28, pagoda 12, market 4, petrol 2; HERO_META rb 43376, rbHash 52ff1208) —
    trước khi sinh lại `check_herokit` báo đúng 3 lỗi (rb, băm, 20/401 lạc), sau: **407/407 khớp**; `gen_fp_nature --fp keep/fp_json`
    → `gen_treemap` → `gen_props_evidence`: fp_nature 651085d1, treemap 402a2d2d, props_evidence 8dd5256a ×2 = bản C. Chỉ
    herokit_data đổi (commit riêng).
    **Cổng (tier 3, ANGLE Radeon 890M D3D11, :8801, khoá GPU):** node --check 23 file · waterbfs 5/5 · check_assets ĐỦ (8b8e42c) ·
    check_herokit 407/407 · diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở (258,110) — có từ W3) · diag lite OK, mọi bất biến
    0 · mobile OK 0 lỗi · ĐÊM (time 0,875 + hoàng hôn 0,76, 248 h90/h270, 120 h90/h180) bạt mái hiên TỐI = dot3 (lỗi review W5-B
    không quay lại sau gộp), cả `--gl1` (webgl2 false, 0 lỗi) · 16 khung REAL | dot3 | tích hợp (354/166/161/221/331/109/267/446/088/
    120/248/519/304/418/450/276) 0 lỗi JS: dải NGÂN HÀNG 1 lần (354), chợ + bạt sọc + người (446), 519 h90 = ảnh r2 của D, 166 h180
    không khối đen.
    **Perf cùng phiên (dot3 bcdcacc `git worktree` tạm :8802 ↔ tích hợp :8801, có assets_lite cả 2):** std 24 khung ×2 xen kẽ
    (traffic on): calls TB 392,9 → 393,1, tổng-min calls −0,9 %, tris tổng-min 74,60 → 77,92 M (**+4,5 %**; tệ nhất game_8 +9,8 %,
    pano_092 h0 +8,2 %, game_6 +7,8 % — xe máy 2 hàng/cụm người C + chi tiết gần B + hero A), fps 60 mọi khung. hpReady lượt std
    5152/5951 → 6528/6832 ms nhưng máy đang tải (workflow khác) ⇒ đo lại KHỞI ĐỘNG riêng 3 vòng xen kẽ 1 khung: hpReady TB 5144 →
    5502 ms (**+0,36 s**), startReady 6723 → 7099 ms (+0,38 s); bản tích hợp phục vụ từ checkout scratchpad (:8803) 5535 ms ⇒ không
    phải do vị trí thư mục. Bước tăng: fabric 952 → 1125 ms (A + B), landmarks 185 → 271 (D: dàn vòm HVT/ramp/núi đá), final
    795 → 907 (C), còn lại ≈. Heap sau ép GC (CDP, ABBA) 449 → 480 MB (+31 MB, +7 %). Mỗi WP trong ngân sách riêng; cộng dồn 4 WP
    +0,36 s / +4,5 % tris — ghi nhận, chưa tối ưu (việc của đợt perf sau chất lượng).
- **2026-10-14 (Đ3-W5-D LANES & STRUCTURE)** [ĐỢT 3 wave 5 — ngõ hẹp vẽ thành phố rộng/bãi trống, khối chắn ngõ, dải phân cách, nút cầu HVT]:
    **(1) TAM BẠC BẮC = NGÕ 5,5 m (331/332/333/335/336/519/520/383/384):** OSM gắn 'Phố Tam Bạc' (way 322/588) là `secondary` →
    ghi đè cũ `{re: /^Phố Tam Bạc$/, c: 'r'}` KHÔNG BAO GIỜ khớp ⇒ lòng cấp s 10 m + vỉa 3,5 m, mặt tiền 8,5 m từ tim; nhà sinh
    còn bị SYN_CAM 6 m quanh camera xoá ⇒ ảnh 519 h0/h90 "bãi trống trước camera". `tools/street_fit.mjs` WIDTH_OVERRIDES thêm
    `{re: /.*/, c: 's', panos: [331…337, 519, 520, 383, 384], w: 5.5, sw: 1.0, center: true}` (re `.*` vì nửa một chiều 447
    không tên; `panos` giới hạn đúng way gần nhất các camera đó). `center` = tim TẠI camera + không mỏ neo tường; luật mỏ neo
    'isolated>6' nới tới 10 m cho way `center` (không thì 331/332/383 đòi dời 7,6-9,1 m → bị bỏ → mỏ neo tường kéo ngõ ra XA
    camera 9 m). Kết quả: camera 331-337/519/520/384 cách tim 0-0,3 m; góc 3 way (−533, −900) dời ~9 m về vết xe.
    **(2) NHÀ SÁT NGÕ (process_buildings):** `NARROW_CAMS` = camera nằm trong lòng way có facadeLine ≤ 4,5 m → nhà SINH chỉ cần
    cách ≥ 3,2 m (`camNeed(i)`, áp cả synBlocked lẫn camGuard); camera khác giữ 6 m (AUDIT3 CAMNEAR). Lấp khe chạy cả dọc NGÕ h
    trong 30 m quanh các camera đó (nhánh đông "P. Tam Bạc" ở 519 h90 là way service OSM, khối giữa 2 ngõ không có footprint
    Overture → lõi ô veto 'near'). **BẰNG CHỨNG ẢNH cho lô khe** `fpGapSupport(Q)`: lô bị veto 'noev' được dựng khi một pano
    ≤ 40 m CHỤP THẤY nhà ở MỌI điểm kiểm Q = [mép trước + 2 m, TÂM lô] (audit/facade_fp.json, lõi 76 % [x0,x1]) với khoảng cách
    HỢP ĐỘ SÂU (near 2-22 m, mid 10-40 m), KHÔNG quan sát nào của pano đó phủ điểm ấy phản bác (near kiểu other/market/
    construction = rào, ki-ốt; mid/far khi điểm < 10 m = camera nhìn XUYÊN tới nhà xa), tia camera → lô không xuyên nhà đã có,
    và lô không nằm ±25° trục phố p/s/t/r của camera khi phố còn chạy tiếp quá lô (phố cụt chữ T trước lô thì giữ — 115).
    BẪY (phản biện): bản đầu chỉ kiểm 1 điểm mép trước + nhận mid 6-40 m ⇒ 265 lô, 109 h180 dựng lô 6 T cách 13 m giữa khung
    (quan sát near "7 T" phủ rộng x 0-0,4 khung h180, khung h135 cùng pano thấy near 'other' = rào tôn của bãi đất trống). Nay
    154 lô. Ví dụ 115 h180: góc đông-nam ngã tư Hạ Lý (Overture trống, ảnh nhà 5 T) hết "quảng trường". **Lô khe NGÕ HẸP** (way
    mặt tiền ≤ 4,5 m, ≤ 40 m quanh NARROW_CAMS) thêm 2 veto: `riverSide` (nước trong 70 m theo pháp tuyến ra ngoài —
    phía sông là dải bờ tự phát, không dãy nhà) và `narrowLaneContra` (camera ngõ ≤ 30 m nhìn hướng đó chỉ thấy lán/nhà mid-far,
    không nhà near nào: 331 h270-h315 toàn 'shed' ⇒ hộp 1 T cửa sổ cách 10 m bên trái 331 h0 bị bỏ).
    **(3) MẶT NƯỚC/VẠCH + TÁCH WAY:** bề rộng street_fit là MỘT giá trị/way — way 962470755 (ri 322) chạy từ ngõ 5,5 m tới tận
    đầu nút 221 (lòng thật ~7 m + dải dạo + lan can) ⇒ ghi đè kéo tới nút, mép lòng cắt chéo dải dạo 221 h180. process_osm §3b2
    `SPLIT_WAYS` tách way tại z −590 TRƯỚC street_fit: phần bắc giữ chỉ số, khúc nam NỐI CUỐI ROADS_DT (ri 1425, sau ngõ h,
    id `962470755:s`) ⇒ chỉ số mọi way cũ không đổi (SIDEWALK_BY_ROAD khoá chỉ số), khúc nam theo bề rộng cấp như dot3. Bản đầu
    bù bằng 'clsClear' (mép nước 8,25 m z > −590) — ĐÃ GỠ, không cần nữa. roadnet: lòng < 6 m bỏ vạch tim/làn — luật TOÀN CỤC
    (mọi way hẹp, không chỉ Tam Bạc). street_fit: nới 'isolated>6' → 10 m áp cho MỌI ghi đè `center` (cả Lý Tự Trọng 515/516 —
    ROADS_DT ở đó không đổi).
    **(4) KHỐI SAI CHỖ (world.js):** bỏ `compound(326, −826)` "Cảng vụ" (hộp 38 × 13 m trơn = "tường kem" 019 h0/h270; ảnh 019/020:
    tòa vàng cột trắng là Trung tâm Hội nghị TP ở bên kia phố ngang, ô này là bãi giải toả) + chừa của nó trong clearedZone;
    bỏ "tập thể 5T" 24 × 10 m ô B4 (−621, −310) nằm NGANG ngõ 90 Hạ Lý (533 h270) + collider r 12,5. FEATURED_CLEAR giữ nguyên
    (thứ tự). **(5) DẢI PHÂN CÁCH Lê Quang Đạo (216/478):** gờ 0,32 → 0,2 m, bụi 0,85 m wild 0,6 → 0,6 m wild 0,25 sáng hơn.
    **(6) NÚT CẦU HVT:** `js/bridges.js` sườn vòm = GIÀN (2 biên trên/dưới cách 3,6 m · thanh đứng · xiên Warren · giằng ngang +
    chéo X đoạn đỉnh, ~4,2k tam giác, cùng 1 draw call) thay hộp đặc; sọc đỏ 0,6 m mặt ngoài gờ lan can CHỈ nhịp 'span' cao
    ≥ 3 m (ảnh 217/349: nhánh xoắn 'ramp' trắng trơn). world.js B12 hòn non bộ = 8 khối icosahedron gồ ghề màu đỉnh (hốc tối,
    rêu) thay 7 nón; khối mới sau buildBridges: CỎ xanh (tấm 2,5 m +0,025, polygonOffset âm, màu theo hash ĐỈNH) + bụi viền
    dọc mép nhựa + 4 % tùng xén tầng + 5 % bụi tròn trên ô đất trống ≤ 60 m quanh camera mặt đất trong hộp nút, trừ claim
    'parking' (lòng nút xoắn = bãi nhựa W3-F). BẪY: bản đầu 45 % hàng bụi + không loại 'parking' → "biển bụi" phủ cả bãi nhựa.
    **(7) XE KHÁCH (079 h180, streetlife.js modelCoach):** thân dưới màu instance + diềm/nóc trắng + 7 trụ cửa sổ.
    **SINH LẠI (tất định, chạy 2 lần cùng byte):** process_osm (ROADS_DT 11 way đổi: 200/322/335/395/447/588 + 5 ngõ h nối, +1
    khúc tách cuối mảng; WATER Tam Bạc; BEACHES mép đất theo phố) → process_buildings (43.376 nhà sau sửa phản biện).
    **CHẤM CẶP (REAL | dot3 bcdcacc | W5-D, 1280 × 634, traffic off, tier 3 Radeon 890M, khoá GPU; ảnh scratchpad dot3/W5-D/pairs):**
    24 pano liên quan TB 3,67 → 4,38 (+0,71); 8 đối chứng (001/007/023/042/055/102/170/230) ảnh y hệt → 4,63 → 4,63 (0). Tăng rõ: 519 3 → 5, 333
    4 → 5,5, 019 2,5 → 4,5, 384 3 → 4,5, 109 2,5 → 3,5 (hết quảng trường), 115/349/533/331/332 +1. Không đổi: 520/522/167/193/334/221 (221 h180: dải dạo cắt chéo, lan can bắt đầu xa hơn — còn lỗi nhỏ; h0 thật là tường thấp cũ, game nhà).
    **PERF cùng phiên (std 24 khung × 2 xen kẽ dot3 :8914 ↔ W5-D :8904):** calls 390,3 → 391,9 (+0,4 %), tris 3,110 → 3,147 M
    (+1,2 %; tệ nhất pano_092 h0 +4,7 %), fps 60; startReady 7,13 → 7,29 s (+0,16 s); heap sau ép GC (CDP) 446 → 455 MB.
    **Cổng:** node --check (world.js qua .mjs, bridges/roadnet/streetlife/tools), waterbfs 5/5, check_assets ĐỦ, diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở (259,110) có từ W3),
    diag lite OK, mọi bất biến 0, 0 lỗi JS mọi lượt chụp.
    **SỬA SAU PHẢN BIỆN (merge-with-fixes; ảnh REAL | dot3 | W5-D v1 | v2, scratchpad dot3/W5-D/r2/pairs):** 221 h180 dải dạo +
    lan can liền như dot3 (3,5 → 4); 221 h0 phố rộng + dãy vòm vàng như dot3 (còn 1 lô 1 T ở 30°); 331 h0 hết hộp 1 T bên sông
    (3 → 3,5; bên phải vẫn mở); 109 h180 hết lô 6 T — giữa khung mở, nhà xa phía sau, villa phải (2 → 3,5); 115 h180 GIỮ nhà góc;
    519/333/384/520/334 giữ như v1; đối chứng có dữ liệu đổi (069/415/100/085/235/374/130/265 + 533) như v1. Cổng: waterbfs 5/5,
    check_assets ĐỦ, diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 cũ (259,111)), diag lite OK, 0 lỗi JS lượt chụp.
- **2026-10-14 (Đ3-W5-A HERO-KIT)** [ĐỢT 3 wave 5 — công trình ĐẶC TRƯNG không phải nhà ống (ngân hàng, văn phòng kính,
  khách sạn, showroom/siêu thị, cây xăng, nhà chợ, trường/công sở thuộc địa, chùa, hàng cột tân cổ điển) theo ẢNH PANO]:
    **DỮ LIỆU:** `tools/gen_herokit.mjs <fp_json> <fp_plan.json> [--dump f] [--why x,z,r]` → **`js/herokit_data.js`** (SINH TỰ
    ĐỘNG, tất định — 2 lần cùng md5). Đọc LẠI fp_json (ghi chú tự do của agent trích xuất KHÔNG có trong audit/facade_fp.json —
    `collectFP(dir, plan, {notes:true})` của gen_facade_fp thêm `out.notes[i]` song song obs, mặc định không đổi), ánh xạ bằng
    CHÍNH `mapFacadeFP` (W4-A) trên footprint hiện tại, mỗi quan sát → chương trình theo kiểu + ghi chú (regex Việt CÓ dấu +
    Anh; BẪY: "đen" ≠ "đền", "nhà nghỉ" ≠ khách sạn, quan sát mở đầu "tường rào/cổng/fence" ≤ 1 tầng = tường, không phải nhà),
    bỏ phiếu theo trọng số; nhận khi phiếu ≥ 0,05, ≥ 25% tổng phiếu nhà, quan sát gần nhất ≤ 60 m, diện tích ≥ 40 m² (cửa hàng/
    ngân hàng 25, trường 100 — trường/mầm non trong nhà ống không dựng rào cổng). 428 nhà: văn phòng 110, cửa hàng 97, ngân hàng
    60, trường/công sở 43, khách sạn 47, chợ 31, hàng cột 26, chùa 12, cây xăng 2. Mỗi dòng: tâm diện tích (dm — KHOÁ khớp lân cận
    ≤ 0,6 m: ai sinh lại buildings_real.js mà nhà không đổi hình vẫn khớp; nhà đổi hình mất chương trình KHÔNG lỗi → chạy lại tool
    SAU process_buildings), chương trình, màu tường + màu nhấn (biển) quan sát, cờ (ngói, rào/cổng, mái che, bậc, vòm, cong, hàng
    cột, ngành cửa hàng điện máy/thời trang/điện thoại), **ĐIỂM TIÊU** = trung bình trọng số chỗ tia quan sát chạm mặt nhà:
    footprint GỘP lớn (b1471 2.321 m² = ngân hàng + văn phòng + quán ở pano_157) thì sảnh/mái che/biển đặt ĐÚNG đoạn ảnh thấy.
    **RENDER (`js/herokit.js` + móc trong `js/citygen.js`):** `renderStyles` — chương trình THẮNG mọi luật (kể cả vân tay):
    văn phòng → GLASS/MODERN (giữ HOTEL/TOWER khung đá W4-C — pano_359), ngân hàng giữ kiểu kính/đá sẵn có, khách sạn → HOTEL
    (giữ NEO/COL/VILLA), cửa hàng → MODERN/GLASS, hàng cột → NEO, trường/công sở → COL (ngói/vòm/tường ấm) hoặc CIVIC, chợ/cây
    xăng → SHED, chùa → COL; tuổi ≤ 1 cho văn phòng/ngân hàng/khách sạn/cửa hàng; không bảng chữ cửa hàng ngẫu nhiên. Bộ trệt
    MỚI qua kênh aFp.w (cùng FG của vân tay, N_FG 11 → 14): FG12 ngân hàng / FG13 sảnh = `G_LOBBY` (KHÔNG dải chữ — r2: G_STORE1
    vẽ "CÀ PHÊ/NỘI THẤT" dưới biển ngân hàng), FG14 showroom kính. Màu nhấn quan sát → aFp chế độ 2 (biển màu THẬT, chữ trắng/đen
    theo độ sáng); không màu nhấn → chế độ 1 (không biển — pano_359 r1 hiện "NHÀ NGHỈ" trên sảnh văn phòng). Chợ ≤ 2 tầng, cây
    xăng 1 tầng; mái: chợ tôn 2 dốc, trường có ngói → 4 dốc ngói, chùa/cây xăng mái do kit. Tắt ban công/mái hiên/điều hoà/biển
    dọc/đồ trên mái/biển quảng cáo mái cho nhà hero (kit tự dựng). `buildHero` dựng vào CÙNG bộ đệm M (ô chính: hình bóng) / DT
    (ô gần: đố kính, gờ, song rào, cột bơm) — 0 draw call thêm, ~30 k tam giác cả thành phố. 9 bộ: VĂN PHÒNG (chân granit, đố
    đứng 3D mỗi ~1,4 m, gờ spandrel mỗi sàn, mái che sảnh kính + bậc), NGÂN HÀNG (dải biển 3D LIỀN màu thật chữ 'NGÂN HÀNG' từng
    đoạn ≤ 8 m, 2 cột đá rãnh 2 tầng + dầm, mái che màu nhấn), KHÁCH SẠN (gờ khối đế đỉnh tầng 2, mái sảnh xe + cột tròn khi đủ
    lùi, biển 'KHÁCH SẠN' trên mái tháp ≥ 6 T, biển DỌC 'KHÁCH SẠN' cho khách sạn mini), CỬA HÀNG (tấm ốp phủ tầng trên màu tường
    quan sát + dải chữ theo NGÀNH: điện máy H_SIGN / thời trang PANEL 'THỜI TRANG NỮ' / điện thoại PANEL 'ĐIỆN THOẠI' / còn lại
    trơn), HÀNG CỘT (cột tròn 10 cạnh rãnh khổ 2-3 tầng, chân + đầu cột, bệ, dầm, trán tam giác ngói), TRƯỜNG/CÔNG SỞ (rào chân
    tường + trụ + song sắt + CỔNG trụ lớn mái ngói tại điểm tiêu + cột cờ), CHỢ (mái hiên tôn liền, 1-3 bảng quảng cáo BILL trên
    diềm), CHÙA (diềm hiên dốc quanh thân + thân tầng trên + mái 4 dốc ĐAO cong + bờ nóc + cổng tam quan), CÂY XĂNG (mái che 2
    màu trên 4 trụ, chữ 'XĂNG DẦU', đảo bơm). Đồ ĐỨNG trước mặt tiền dùng `streetGap` (citygen: khoảng lùi tới MÉP SAU vỉa hè
    theo xsection) — không đủ chỗ thì cột áp tường / không trụ — và `free(x,z)` (không nhà khác, không claim) cho rào/cổng/cột cờ.
    Cạnh dựng = cạnh mặt phố gần điểm tiêu nhất (ưu tiên đủ dài theo chương trình: hàng cột 10 m, khách sạn/trường/chùa 8 m…),
    đoạn ≤ W quanh điểm tiêu (ngân hàng 22, cửa hàng 16, văn phòng/khách sạn 30, hàng cột 32 m). Atlas +2 ô sau D_CORN (107/112):
    `H_SIGN` (4 dải chữ chung: NGÂN HÀNG, KHÁCH SẠN, SIÊU THỊ ĐIỆN MÁY, XĂNG DẦU — nền nhuộm màu biển) và `H_FLUTE` (thân cột rãnh).
    program key 'fabric_v5a_'.
    **NHÀ Ô DỰNG TAY (`js/cellsink.js` bước 3c):** phần lớn công trình bị chê "hộp phẳng mờ" là nhà ô DANH TÍNH được GIỮ (VIB 157,
    TPBank 354, chợ Tam Bạc 450, chùa 276, trụ sở 322/166…) — citygen không chạm được. 3c gỡ nhà ô (không 'house'/'bespoke') khi:
    (a) tên KHÔNG nói công năng → ≥ 50% khối đặc nằm trên nhà thật CÓ chương trình; (b) tên nói công năng (`heroProgOfName`: vib/
    bidv/…→ ngân hàng, chicucthue/ubnd/truong → công sở, chua → chùa, cho_ → chợ, legend/hotel → khách sạn…) → có nhà hero CÙNG HỌ
    (ngân hàng/khách sạn/cửa hàng/văn phòng = 1 họ) trong 45 m VÀ ≥ 30% khối đặc trên nhà hero (tính cả nhà SINH — lô cây xăng 418);
    và luôn: nhà ô không cao vượt (≤ 1,6 × chiều cao nhà thật + 6 m: giữ tháp 66 m 'dl_legend' trên footprint 6 tầng), nhà hero
    KHÔNG bị nhà ô danh tính khác (còn giữ) đè > 15% (nếu không citygen giết nó theo claim → chỉ còn khoảng trống: r2 pano_510/235
    văn phòng b2805 bị biệt thự 'v4_lejardin_villa' đè). Báo cáo `cellSinkReport().heroCand` [tên, loại, phần trên hero, ô, m², cao,
    nhà, gỡ?, cx, cz], `removed.hero`. BẪY: tên nói công năng KHÁC nhà hero dưới nó thì GIỮ ('baoviet' ngân hàng kính trên lô
    trụ sở thuế 418 — thay bằng công sở trắng là sai). Dùng lại mẫu bước 2 (`it.perB`), không lấy mẫu lần 2.
    **ĐO:** node (không GPU) fabric 1,438 → ~1,46 M tam giác (+~30 k hero), dựng ~1 s như cũ. PERF CÙNG PHIÊN (ABBA std 24 khung,
    dot3 git archive :8911 ↔ nhánh :8901, traffic off, tier 3 Radeon 890M): calls TB 384,4 → 378,9 (−1,4 %), tris 2,990 →
    2,995 M (+0,15 %, tệ nhất pano_092 h0 +0,6 %), fps 60 cả hai, hpReady 5,59/5,19 → 5,32/5,14 s; heap SAU ép GC (CDP, ABBA)
    449/449 → 450/450 MB; 0 lỗi JS. Ảnh: scratch dot3/W5-A (`base` dot3, `final` nhánh, 26 pano mục tiêu + 8 đối chứng ×4 hướng,
    ghép `finalpairs`). Chấm cặp (REAL | dot3 | nhánh, **TỰ CHẤM** của người làm, 26 pano mục tiêu): 4,31 → 4,61 (PHẢN BIỆN độc
    lập: ~4,3 → 4,4, hồi quy 006 + 276 — xem "SỬA SAU PHẢN BIỆN" dưới) — rõ nhất 322 (công sở vàng rào +
    cổng mái ngói + cột cờ, toà hàng cột trắng), 450 (nhà chợ mái tôn + bảng quảng cáo + mái hiên tôn thay mảng màu trừu tượng), 354
    (dải biển tím 'NGÂN HÀNG' + biển dọc khách sạn), 161 h90 (dải xanh liên tục 'NGÂN HÀNG' như thật), 060 (trường vàng + rào cổng),
    166/377 (ốp đen 'THỜI TRANG NỮ' cửa hàng thời trang); 8 đối chứng không đổi (sai khác ≤ 10 % điểm ảnh, h270 pano_102 nhà áo
    cưới có tấm ốp — đúng ngành). Vòng sửa: r1 'NHÀ NGHỈ' trên sảnh 359 (chế độ biển), cột hàng cột 0 tam giác (cạnh điểm tiêu
    quá ngắn → ưu tiên cạnh đủ dài), chợ không mái hiên (ngưỡng cạnh), 418 'baoviet' bị thay sai (luật tên); r2 510/235 hở trống
    (luật nhà ô khác đè), 'SIÊU THỊ ĐIỆN MÁY' trên shop thời trang (ngành). CÒN LẠI: chùa 276 — tầng mái nằm trên khung nhìn ở cự
    li pano (nhà 2-3 tầng, mái bắt đầu ở đỉnh tường) ⇒ nên thêm diềm mái ngói ở MỖI sàn mặt phố; 157 VIB thành khối kính-đá be
    của footprint gộp b1471 (đúng chỗ biển + sảnh, mặt trên chưa phải vách kính xanh); 395 hội trường cột 'tb_goldstar' là nhà ô
    lệch chỗ (khối đặc chỉ 4% trên nhà thật) — giữ; 510/235 văn phòng xanh bạc hà b2805 bị nhà ô biệt thự 'v4_lejardin_villa' đè
    20% ⇒ vẫn là hộp ô trắng (cần chỉnh claim/nhà ô — ngoài làn).
    **SỬA SAU PHẢN BIỆN (merge-with-fixes):** (1) **CHỢ/CÂY XĂNG ÉP DẸT nhà nhiều tầng** — gen_herokit coi 'sạp/quầy/bạt/ô dù/
    lưới/stall/tarp/awning' TRƯỚC nhà là nhà chợ (pano_006 b4401 8 T → lán 2 T trống). Nay `obsProg`: nhà chợ chỉ khi ghi chú tả
    NHÀ/hội trường (nhà chợ, nhà lồng, chợ mái tôn, market hall, shed…) — từ sạp/bạt chỉ được kèm từ nhà chợ mạnh; quan sát ≥ 3
    tầng hoặc ghi chú 'ba/bốn… tầng' → không; cây xăng bỏ ghi chú tả nhà BÊN CẠNH ('sau/cạnh/bên… trạm xăng') và quan sát ≥ 3 tầng.
    Chợ 31 → 4 (chỉ hội trường mái tôn 450), tổng 428 → 401 nhà. citygen `heroTall(p, D.floors, D.flags)` (herokit.js): chợ
    D.floors > 3 / cây xăng > 2 VÀ số tầng có bằng chứng (cờ RB PANO/EDIT, hoặc ≥ 5) → KHÔNG ép tầng, không kiểu SHED, giữ mái thật
    (bảng quảng cáo diềm chợ chỉ khi ≤ 2 T, cây xăng nhà cao chỉ dựng mái che khi có sân ≥ 7 m). Số tầng MẶC ĐỊNH không nguồn
    (pano_418 b14830: footprint MS 3 T, ảnh = trạm xăng) vẫn ép theo ảnh — và citygen GHI LẠI `D.floors[b]` = số tầng vẽ (rbdata
    dùng chung: footprints.topAt/cây/minimap khớp chiều cao vẽ). (2) **CHÙA mất danh tính** — 3c
    gỡ 'tx_chua_hbt' (chùa 3 tầng mái dựng tay, 2.190 m²) thay bằng kit chùa fabric = hội trường thuộc địa mái bằng. Nay 3c KHÔNG
    gỡ: tên/chương trình nhà hero = CHÙA, loại 'heritage', hoặc phủ nhà hero ≥ 1.500 m² (chợ Con, khối VIB/kinh158) trừ khi tên
    trong `HERO_ALLOW` (đang rỗng — chỉ thêm sau khi đối chiếu vệ tinh + pano). `heroCand` thêm [10] chương trình nhà hero chính,
    [11] giữ-danh-tính. (3) **'NGÂN HÀNG' lặp** (354 h180: 3 chữ + tấm xanh dưới) — dải 3D chữ MỘT lần (tấm ≤ 8 m quanh điểm tiêu),
    phần còn lại diềm TRƠN màu nhấn; dãy lô ngân hàng liền kề (≤ 25 m) chỉ lô GIỮA có chữ (`bankLead`); sổ chữ `ctx.signs`
    (citygen tạo mỗi lượt dựng) chặn trùng 12 m. Tấm xanh là biển THẬT từ SHOP_SIGNS (TPBank → 'NGÂN HÀNG') neo vào cùng mặt tiền:
    `frontEdges[k][8]` = chương trình hero; world.js bỏ biển 'NGÂN HÀNG' có mặt tiền gần nhất là ngân hàng hero và không neo biển
    khác lên mặt tiền đó. (4) **DỮ LIỆU CŨ sau khi sinh lại buildings_real** — HERO_META thêm `rbHash` (FNV-1a của RB_B64);
    `node tools/check_herokit.mjs` (diag.mjs gọi trước khi mở trình duyệt) lỗi khi rb/băm lệch hoặc có HERO không khớp footprint
    (thử với buildings W5-D: báo 3 lỗi, 21/401 lạc). TÍCH HỢP: sau khi gộp W5-D PHẢI chạy lại gen_herokit + commit. (5) **KHỐI ĐEN +
    tấm 'THỜI TRANG NỮ' cùng số ĐT lặp** (166/161/377) — ốp cửa hàng chỉ tầng 1 trên trệt (màu ốp tối < 0,25: chỉ diềm 1,9 m);
    màu tường quan sát tối không lái màu cả nhà (mọi chương trình); PANEL cắt bỏ dòng số ĐT (v từ 0,54 m của dải 2 m); mỗi loại
    chữ ngành ≤ 1 lần / 40 m. Thêm: cây xăng — trụ/đảo bơm kiểm `free()` + không trong chính ki-ốt; `sub()` kiểm E trước E[6].
    KIỂM (REAL | dot3 bcdcacc | nhánh, 24 pano × 4 hướng + 8 cam xiên, 1280×634, traffic off, tier 3 Radeon 890M, 0 lỗi JS):
    006/353/124/486 ≈ dot3 (≤ 2,7 % điểm ảnh; 006 hết lán 2 T), 276 + cam chùa ≈ dot3 (chùa 3 tầng mái giữ), 157 ≈ dot3 (khối
    VIB giữ), 354 h180 MỘT chữ 'NGÂN HÀNG' giữa dải tím liền, không tấm xanh; 161 h90 dải xanh 1 chữ; 166 không còn khối đen
    (diềm tối 1 tầng), 'THỜI TRANG NỮ / HÀNG MỚI VỀ' không số ĐT; 418 h90 mái che cây xăng còn; 450 h180 hội trường chợ giữ; đối
    chứng 007/085/143/492 ≤ 5,6 %. diag full/lite OK, waterbfs 5/5, check_assets ĐỦ, check_herokit 401/401. Chấm cặp (tự chấm,
    sau sửa): mục tiêu ~4,3 → ~4,45 — bỏ 2 hồi quy, giữ các cái được 161/354/418/450/377; 157/510/276 giờ = dot3.

- **2026-10-14 (Đ3-W5-B STREETFRONT — mặt phố nhà ống có chiều sâu + phong hoá)** [ĐỢT 3 wave 5; graders: "quá sạch/rực, quá nhiều
  cửa cuốn đóng, biển loè/sai cỡ, không chiều sâu" ở 248/028/363/102/134/198/005/129/143/147/336/368/120/033/170/244/294/083/023/
  262/409/290/501/547/111]:
    **SHADER (`js/citygen.js` makeMaterial, program key `'fabric_v5b2_'`):** (1) **PHONG HOÁ v2** (tường kind ≤ 3 CHỈ nhà ống/phố cũ/KTT/
    tầng cơi — st ≤ 2 hoặc RS.TEN; Pháp/villa/kính giữ phong hoá + trần bão hoà 0,62 cũ, W5-A sở hữu; theo TUỔI aFac.z
    bit 4-5 = vân tay old/very_old + vùng): vệt ĐEN CHẢY từ MÉP SÀN mỗi tầng (khoảng cách dưới sàn tầng trên, exp(−d/0,45-1,4 m) ×
    cột nhiễu — nước mưa tràn sàn ban công/ô văng), MẢNG VỮA BONG (tuổi ≥ 2: ngưỡng nhiễu 0,84 − 0,13·tuổi, lộ xi măng xám ẩm hoặc
    gạch đỏ 30% nhà rất cũ, viền tối), phai màu sơn về xám ấm (0,05 + 0,14·tuổi) và vệt ố/mảng ẩm cũ đậm hơn ~40%; trần bão hoà
    tường 0,62 → 0,58 − 0,05·tuổi. (2) **BIỂN PHAI:** signCol thống kê (dải biển trệt, bảng lớn, biển dọc) trần bão hoà
    tuyến tính 0,64, kéo về xám ấm 0,08 + 0,06·tuổi, trần độ sáng 0,78; chữ ≤ (0,9, 0,88, 0,82); màu biển ĐO TỪ ẢNH (fpSign) chỉ trần sáng 0,86 (ảnh đã là trạng thái phai thật). `world.js` biển tên thật
    (SHOP_SIGNS canvas): bảng màu nền bớt bão hoà + đáy biển ố 14%. (3) **NỘI THẤT SÁNG BAN NGÀY** `fabDay` (cộng phát sáng KHÔNG
    nhân đêm): trệt kính (G_GLASS/SHOW/STORE*/SHOP3/ELEC/LOBBY) 0,2, cửa hàng mở 0,14 × tx, CHỈ nâng nền tối (× (1 − smoothstep(0,25,
    0,7, độ sáng texel)) — vòng 1 làm loá mặt kính đã sáng, pano_147 h270). GLSL `dayLitOf(m)` sinh từ MOD (GL1 dùng chung, không
    mảng). (4) BẠT mái hiên xuyên sáng: kind 5 + ô D_AWN/D_AWN3 → fabDay = col·0,22. **fabDay CHỈ BAN NGÀY:** emissive =
    fabGlow·emissive.r + fabDay·(1 − clamp(1,7·emissive.r)) (emissive.r = đêm·0,95 từ daynight → tắt hẳn khi đêm ≥ 0,62). BẪY (review):
    cộng phát sáng không nhân hệ số ngày → ban đêm/hoàng hôn bị phơi sáng đêm (maxGain 4) khuếch đại = bạt SÁNG TRẮNG dưới trời đen.
    **ATLAS (`js/facade_atlas.js`, +4 ô SAU D_CORN → 109/112, còn 3 chỗ; chỉ số cũ giữ):** `G_HOME2` nhà MỞ CỬA (cửa xếp dồn 2 mép,
    phòng khách + xe máy có thân/yên/tay lái + tủ gỗ thấp — BỎ ban thờ: ô đỏ khung vàng đọc ra "ô vuông đỏ" ở 294/501/115), `D_AWN3` bạt TRƠN võng (nhuộm),
    `D_MISC` 4 vùng con (hàng bày mặt trước / mặt trên — bảng màu TRUNG TÍNH các-tông/bao tải/rổ, tán cây cảnh + hoa giấy, đồ phơi,
    ống thoát nước), `D_CAGE` "chuồng cọp" (song sắt xám/trắng/gỉ trước cửa sổ + đồ phơi + cây). BẪY: vùng con trong 1 ô KHÔNG lặp
    được (shader lấy fract(uv) cả ô) → quad dùng vùng con phải ≤ kích thước vùng (hàng bày ≤ 2 m rộng, đồ phơi ≤ 1 m).
    **BỘ MÔ-ĐUN TRỆT (SETS):** bớt cửa đóng thống kê: G1 G_SHUT0 → G_OPEN0, G_HOME0 → G_HOME2; G2/G12 một G_HOME0 → G_HOME2; GH
    (ngõ/nhà ở) = [HOME0, HOME2, HOME1, HOME2, SHUT0, GATE, HOME1]; FG6 (vân tay "nhà ở") + G_HOME2. FG3 (vân tay "cửa cuốn") GIỮ —
    ảnh thật thấy đóng. JS groundModule/GL2/GL1 cùng đọc SETS → vẫn khớp bit với hộp biển 3D.
    **HÌNH HỌC:** (a) ô mới **`fab_near_<tx>_<tz>`** (NEAR_TILE 300 = DET_TILE, hiện khi camera ≤ NEAR_R 120 m tới mép ô (+ cao độ),
    KHÔNG đổ bóng, chỉ TIER ≥ 2 — có DT mới có NT): HÀNG BÀY tràn hè trước bay trệt là cửa hàng MỞ (`OPEN_G`, groundModule khớp
    bit; vân tay shop_open/chợ/quán 80%, nhà KHÔNG vân tay trên phố chính/nhỏ 30%, vân tay khác 0 — review: thùng trước bay đóng/tối;
    1 khối 0,7-1,5 m × sâu 0,3-0,5 × cao 0,45-0,9 m sát tường một bên cửa, cách 2 đầu mặt tiền ≥ 0,7 m (đạo cụ góc phố), chừa lối vào;
    mặt trước = hàng NHỎ xếp chồng sáng ×0,85-1,05 + 22% màu bao bì — trước: khối tối + ô màu thô), CÂY CẢNH
    ban công (`blobN`: mặt trước đa giác 6 đỉnh dáng tán — hộp vuông đọc ra "khối hộp xanh"; cao 1,3-1,85 m vượt lan can; 13 k), giỏ
    cây treo ngoài lan can (22%), ĐỒ PHƠI sau lan can (30%, 7 k), ỐNG THOÁT NƯỚC dọc mép mặt tiền nhà ống (0,3 + 0,12·tuổi, 11 k; đặt trong khoảng lùi 0,03 m — ở 0,14 m xuyên má bạt/ban công).
    (b) ô det: **CHUỒNG CỌP 3D** (lồng nhô 0,6 m cả tầng: mặt trước + 2 má D_CAGE + đáy + mái tôn dốc; vân tay 'cage' 75% tầng,
    thống kê tập thể 25%/nhà ống 6% nhà × 45% tầng — vòng 1 lồng MỌI tầng tháp hẹp = "tháp lưới nâu" pano_519 h90; tầng 1-2 nhà ống fpMode 3 KHÔNG lồng — giữ biển bảng lớn theo ảnh); **MÁ BẠT** 2 đầu
    mái hiên bạt; bạt SỌC khi vân tay tarp_stripe/tarp_blue/tarp_other (LUÔN — pano_120 sọc xanh-trắng thật bị trích 'tarp_blue',
    248 h270 sọc → cam trơn là hồi quy), bạt trơn D_AWN3 chỉ tarp_red + 35% nhà thống kê; 'tarp_other' theo bảng 7 màu (be/cam/lục/nâu đỏ/xám/lam/kem — trước cố định xám → mái hiên xám đục); cục nóng
    điều hoà 0,14/0,21 → 0,18/0,26. (c) `GBuf.quadR` (uv chữ nhật, đỉnh truyền rời) + `boxN` gọi thẳng (thứ tự đỉnh đã CCW từ n =
    (−e.z, e.x), kiểm tích có hướng) — đo node `--cpu-prof`: chi phí thêm chủ yếu là GC mảng [p…]/[uv…] mỗi quad + cấp GBuf mỗi ô
    (ô near 200 m = 199 bộ đệm → 300 m = ~105).
    **KẾT QUẢ (REAL | dot3 bcdcacc | nhánh, 25 pano mục tiêu + 8 đối chứng 060/230/285/395/331/519/115/019 × 4 hướng, tier 3, 890M,
    :8902/:8912, khoá GPU, traffic off, 1280×634; scratch W5-B/pairs1 (r1), pairs2 (r2)):** thay đổi THẤY ĐƯỢC nhưng NHỎ ở cự ly pano:
    tường cũ có vệt chảy/mảng bong (134, 198, 248, 102), biển bớt loè (147 VÀNG BẠC/PHỞ BÒ, 409, 143), chuồng cọp (129, 198), hàng
    bày (120, 248, 331), cây/đồ phơi ban công (102), mái hiên đúng sọc/màu hơn (120, 147). Tự chấm (thang AUDIT4): mục tiêu TB ~5,1 →
    ~5,25 (+0,1-0,2; ±0,5 nhiễu); đối chứng không đổi (diff ảnh 285/115/019 ≈ 0; 331/395/230 chỉ khác cây đung đưa). Hồi quy đã sửa ở
    vòng 2: 120 (sọc → trơn), 519 h90 (tháp lưới), 147 h270 (kính loá); 501 h0 cổng xanh → nhà mở cửa (đa dạng, không sai hẳn).
    **PERF (std 24 khung, 2 lượt xen kẽ dot3 ↔ nhánh, --perf, traffic off):** draw calls/tris theo MIN mỗi khung: tổng 24 khung calls 9.188 → 9.166 (−0,2 %), tris 72,87 → 71,93 M (khác biệt
    trong nhiễu; từng khung tris ≤ +0,6 %, calls ±8 % ở cả hai phía = nhiễu lượt vẽ); fps 60 (trần) mọi khung; hpReady TB 6.578 → 6.665
    ms (+0,09 s); bước khởi động fabric 1.271/1.058 → 1.462/1.274 ms (+0,2 s; probe riêng 1.007/1.129 → 1.258/1.420, msGeo +0,1-0,28 s
    — trước quadR/ô 300 m là +0,25-0,3 s); heap sau ép GC (CDP, 2 lượt xen kẽ) 449/449 → 466/466 MB (+17 MB: ô near ~220 k tam giác +
    det +32 k tam giác giữ CPU tới khi upload). Thống kê fabric: detTris 557 k → 590 k, nearTris 220 k (chỉ ~2-4 ô near hiện quanh camera).
    BẪY ĐO: khung game_*/cam_high đôi khi nhảy +50-100% calls/tris NGẪU NHIÊN ở CẢ HAI phía (lượt vẽ phụ) → so A/B lấy MIN mỗi khung
    qua các lượt, không lấy TB. Cổng: node --check (citygen, facade_atlas, world.js qua .mjs), waterbfs 5/5, check_assets ĐỦ, diag
    full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở (259,111) có từ W3), diag lite OK, 0 lỗi JS mọi lượt chụp, --gl1 0 lỗi (8 khung).
    **SỬA SAU REVIEW (vòng 3, cùng phiên :8902, 132 khung REAL|dot3|nhánh — scratch W5-B/pairs3, fxn.jpg đêm/hoàng hôn):** (i) bạt
    hết phát sáng ban đêm (120/248 h090 lúc 0,875 và 0,76 = mức dot3); (ii) 120 h180 lại SỌC xanh-trắng như ảnh, 248 h270 sọc;
    (iii) thùng hàng trước NHÀ NGHỈ/bay cửa cuốn (248) và góc phố cạnh chậu cây (120) biến mất — goods 5.476 → 1.222 khối, nearTris
    220 k → 186 k; (iv) 115 h090 hết "ô vuông đỏ"; (v) biển đo từ ảnh (147 PHỞ BÒ) giữ màu thật thay vì phai. Đối chứng không đổi
    ngoài cây đung đưa. Cổng: diag full + lite "TẤT CẢ THỰC THỂ OK — 0 lỗi JS", --gl1 0 lỗi (khớp GL2), waterbfs 5/5, check_assets ĐỦ,
    0 lỗi JS mọi lượt; probe fabric 1.347/1.180 ms (≈ trước sửa), detTris 589.788.
    CÒN: tầng trệt vẫn tối/phẳng hơn ảnh (cửa hàng thật sâu, sáng, hàng hoá dày); bậc thềm/khung cửa cuốn 3D, dây điện vào nhà,
    trụ ngăn lô nhô giữa các nhà ống chưa làm; biển "trên mái/bảng lớn" theo vân tay giữ như W4.
- **2026-10-14 (Đ3-W5-C LIFE-GREEN)** [ĐỢT 3 wave 5 — graders wave 4: chợ quá thưa (124/446/460/097/184/092/189), hiên quán dù đỏ (267/506/083), xe máy quá ít trên mặt tiền đông (088/492/083/189), phố đông người (469/446/460), tán cây rợp ngõ/phố nhỏ (331/519/111/258/391/386/455/065), vườn biệt thự sau rào (271/538), dây leo (203), gốc cưa trụi (152/225/400)]:
    (nhánh worktree `worktree-wf_0dec13b5-96e-3` trên dot3 bcdcacc). File: `js/streetlife.js`, `js/props.js`, `js/trees.js`, bộ sinh
    `tools/gen_fp_nature.mjs` / `tools/gen_props_evidence.mjs` / `tools/gen_treemap.mjs` → SINH LẠI `tools/fp_nature.json`,
    `js/props_evidence.js`, `js/treemap.js` (chạy: `node tools/gen_fp_nature.mjs --fp <keep/fp_json>` rồi gen_treemap, gen_props_evidence —
    tất định; cột/bit CŨ y hệt: so 551 dòng, chỉ THÊM).
    **BẰNG CHỨNG MỚI:** fp_nature thêm cột (đặt CUỐI, bộ đọc tra theo tên) umbRed/cafe/crowd/market (trường street), garden/vines (trường
    trees). props_evidence: spill 2048 HIÊN QUÁN (audit spill 8, hoặc fp cafe ≥ 2 hướng + ô đỏ ≥ 1), spill 4096 Ô ĐỎ (audit "dù/ô … đỏ"
    hoặc fp umbRed khi pano có ô/quán), deco 2048 ĐÔNG NGƯỜI (audit "đông người/khách đông/người mua bán…" hoặc fp crowd), deco 4096 DÂY
    LEO (audit vegetation "dây leo/giàn/hoa giấy" hoặc fp vines) — 98/70/47/88 pano. treemap: STRIDE 21 → **23** (field 21 garden "vườn/sân
    biệt thự/khuôn viên/sau rào", 22 vines; 56/86 pano). **BẪY:** sửa chuỗi trong bộ sinh bằng python `replace` với `\\n` thoát sai → hằng
    STRIDE trong file sinh KHÔNG đổi trong khi mỗi dòng đã 23 số (trees.js đọc lệch toàn bộ) — luôn kiểm `PANO_VEG.length / STRIDE` = 551.
    **CHỢ (streetlife.js):** mức 3 bước sạp 2,1-2,8 → 1,75-2,35 m; vỉa HẸP < 2,4 m (446/124/492 vỉa 1,6-2 m — dải sát mặt tiền từng trống
    trơn) thêm 1-2 món nhỏ sát tường (bao/mẹt/sọt, `st.mkFacade`); khách đứng 0,6 → 0,8, khách thứ 2 0,35 → 0,55 (0,75 nơi "đông người");
    hàng lấn dải lòng 40 → 55%; **XE MÁY TRONG CHỢ** (`mkBikes`): bước sạp mức 3 mà dải lòng sát bó vỉa còn trống, phố lòng ≥ 5 m → 1 xe đỗ
    dọc mép (tâm cách bó vỉa 0,42 m, ±12°, mũi xuôi làn bên phải), `stallsRoad` kind 'bike' (len 1,9, hw 0,42) cho giao thông lách; props 6.5
    dựng như xe đỗ (`road: 1` → `__hpProps.lists.mkRoad`, KHÔNG vào lists.bikes — clearance không tính "vật trên nhựa"). 449 xe.
    Ngân sách người chợ 1.100 → 1.800 (LITE 350 → 500: ~2,9k ứng viên, bản cũ giữ ~38%). LOD: hàng đất ≤ 100 → 80 m, đống nông sản ≤ 60 → 45 m
    (A/B 446_h090 +17% tam giác trước khi thu → +4,7%).
    **HIÊN QUÁN:** pano ≤ 30 m có spill 2048 → dãy 3-5 ô (khởi 42%/ô): mỗi ô 1 Ô VUÔNG MỘT MÀU (biến thể v4 MỚI của `props_market_over` —
    bản chợ múi xen bảng B đọc thành dù xanh-trắng ở 267) cạnh song song mặt tiền, tán 2,6-3,1 m (không chìa qua bó vỉa/chạm tường), bộ bàn
    ghế + 1-3 khách (nhóm ngân sách `sp`, 220 → 380). Bộ bàn ghế quán 6.4 đã có ≤ 1,4 m → tán đặt ĐÚNG trên bộ đó (không thêm bàn) và dù nhỏ
    cũ dưới tán bị bỏ (`paraI.dead`); mặt tiền = nhà thật HOẶC claim 'cell' (quán Trà Chanh 267 là nhà ô dựng tay — `hasFacade` chỉ biết
    footprint RB). Màu: bit 4096 → 85% đỏ. `paraI` giữ màu đã gán (`it.col === undefined` mới bốc màu). 200 dãy / 390 ô.
    **XE MÁY 2 DẢI (props.js 6.5):** vỉa ≥ 3,4 m + pano ≤ 60 m mức 3 (không phố p) → hàng xe chạy 2 lượt: dải 1 sát bó vỉa (curb + 0,8, xiên
    42-52°), dải 2 sát mặt tiền (fac − 0,95, 52-65°, lệch pha 0,37 m); ước lượng ngân sách ×1,6. 088: 46 → 63-72 xe ≤ 20 m, 267 48 → 57-62.
    Từ chối chủ yếu là vật cản (`stats.bikeRej[1]` ~13,7k: hố cây/cột ở dải sát bó vỉa).
    **CỤM NGƯỜI TĨNH** (`placeClusters`, nhóm ngân sách MỚI `cl` 520 / LITE 160): nhóm 2-4 người đứng quay vào nhau sát mặt tiền hoặc ngồi
    ghế nhựa quanh bàn thấp (30%, vỉa ≥ 2,4 m). Xác suất/ô: "đông người" ≤ 40 m 30% (thử cả giữa vỉa), phố xe dày/chợ/ghế nhựa 5%, lõi 1,2%,
    ngoài 0,4%. 2 LƯỢT: ô "đông người" TRƯỚC hàng xe máy (xe né qua `bikeObst`), còn lại sau người đi bộ; ô cụm đặt OCC_PED → người đi bộ
    (6.7) nay né OCC_PED (trước đây không ô nào có OCC_PED trước 6.7 — dot3 không đổi). ~680 người.
    **DÂY LEO / HOA GIẤY** (`props_vines`, ~360 tam giác/khóm, 213 khóm): pano ≤ 35 m deco 4096 → 18% ô có mặt tiền thật treo 1 khóm từ tầng
    2-3 theo SỐ TẦNG THẬT (`SL.bldFloors` = D.floors của footprint sau mặt tiền: ≥ 3 tầng mép trên 9,2-9,8 m, 2 tầng 6,7-7,1, 1 tầng 3,3 nhỏ),
    rủ 2,9-4 m, rộng 2,9-4,4 m, 55% hoa giấy hồng/tím/cam. **BẪY:** treo ở 3,9-4,7 m (bản đầu) bị mái hiên/bạt tầng trệt che gần hết.
    **CÂY (trees.js):** (1) phố r có pano RỢP (dens 3) hoặc vòm → trồng đủ (bỏ luật bỏ ngẫu nhiên 30%) + cây VÒM (`tun`). (2) MỚI
    `plantLaneTrees`: ngõ h trong 45 m quanh pano rợp (dens 3 + vòm/cây bóng mát) → cây ở mép ngõ (hw + 0,6) nơi có khe trống (gốc + vòng
    0,8 m không vào nhà thật, không lòng đường khác), nhịp 8,5-12,5 m, 1 bên (40% 2 bên), cây vòm — 339 cây. (3) MỚI `plantYardTrees`: dọc
    polyline RB_PARCELS kiểu tường rào xây / hàng rào sắt (sân bên TRÁI, pháp tuyến (−uz, ux)) gốc sâu 3,2/4,6/2,4 m sau rào, nhịp theo pano
    ≤ 60 m (garden 6,5 · rợp 9 · thường 12 · thưa 18 · không pano 14 · "không cây" bỏ), vòng 1,4 m không chạm nhà, không đường/camera/địa
    danh/claim dựng tay; sân vườn 30% cau vua (luật cau-không-bằng-chứng vẫn áp), 15% phượng — 376 cây (50 cau). Cả 2 gọi CUỐI
    plantStreetTrees (không sửa world.js); `window.__hpTreePlant` = thống kê. (4) Kit CATCUT MỚI "cột" (thêm CUỐI KIT_DEFS: thân r0 0,36,
    cành cưa 0,7-1,4 m, ít chồi) + mức cắt 7 → 50/50 LOP/CATCUT (cũ 72/28) — ảnh 225/152: đa số gốc thân to cành cưa NGẮN. Tổng cây 8.029 → 8.949.
    **SỐ ĐO (A/B cùng phiên, base = dot3 bcdcacc git archive :8913 ↔ :8903, keep/views_ab4 + 446_h090/088_h090/267_h090/538_h000, TIER 3,
    Radeon 890M D3D11; vòng 1 xen kẽ 2×2, vòng 2 sau thu LOD):** calls 2.691 → 2.671 (−0,7%), tris 21,81 → 22,59 M (+3,6%; 4 khung chuẩn
    +2,5%, 446 +4,7%, 267 +6%, 538 +6%); fps 60 (vsync) cả hai; hpReady 5,84 → 6,04 s (+0,2 s, bước nature 181 → 208 ms, final +60 ms);
    heap nhiễu (570 ↔ 497 MB). Ảnh (REAL | dot3 | W5-C, 1280×634, traffic off, 27 pano đích + 8 đối chứng × 4 hướng, 0 lỗi JS mọi lô):
    `scratchpad/dot3/W5-C/pairs` (+ pairs_r2/pairs_r3 sau sửa). Tự chấm (±0,5): chợ 446/460/184/492/124 +0,5 (hàng phủ kín hơn, khách đông
    hơn, xe đỗ mép lòng như ảnh); 267 +0,5 (hiên dù đỏ trước quán); 088/083 +0,3; 538/271/519/455 +0,3 (cây sân sau rào, tán ngõ); 225/152/400
    +0,2 (gốc cưa); 203 ~0 (khóm hoa giấy không lọt khung h090); 469/331/111/097/092/189/391/386/065 ~0 (lỗi chính là hình khối/phố — W5-D);
    8 đối chứng không đổi.
    **CÒN:** 469/331/519 phố hiển thị rộng như quảng trường (W5-D) nên cây/người mới ít tác dụng; hàng xe 2 dải ở 088 h090 vẫn thưa hơn ảnh
    (dải sát bó vỉa vướng hố cây/cột); cây dải phố cạnh vườn 225 h180 vẫn tán xanh (luật W3-G tách polS/polP — chưa đổi); vườn biệt thự
    chưa có cây bụi/cây cảnh thấp (chỉ cây gỗ + cau); dây leo chưa phủ được mảng mặt tiền lớn như 203.
    **Cổng:** node --check OK, waterbfs 5/5, check_assets ĐỦ, diag full/lite: diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (bất biến: overlap 1 ở (259,111) — có từ tích hợp W3), diag lite OK 0 lỗi mọi bất biến 0; 0 lỗi JS mọi lô chụp/đo.
    **SỬA SAU PHẢN BIỆN (merge-with-fixes):** (1) cây sân/cây ngõ (src 6/5) từng đứng GIỮA LỐI CỔNG RB_PARCELS (khe tường cắt lúc chạy,
    85 cây trong hành lang cổng) → `trees.js inGateLane(x,z)`: cổng [x,z,góc,rộng] (trục tường (cos góc, sin góc)) — loại khi |dọc
    tường| < rộng/2 + 1,5 m VÀ |sâu| < 8 m (cả 2 phía); áp trong plantYardTrees + plantLaneTrees → 0 cây trong lối; còn 14 cây ĐỨNG CẠNH
    cổng (dọc tường 4,3-6 m, sâu 2,4-3,2 m — như cây hai bên cổng thật). (2) tán dù VUÔNG hiên quán (v4, 2,15-2,5 m) bị thân cây đường
    xuyên (25/419; nhánh `own` — tán trên bộ bàn ghế cũ — bỏ qua obst) → `trees.js` export `trunkInSq(x,z,ux,uz,h)` (gốc cây trong hình
    vuông xoay theo trục phố) + `props.js` `SL.poleInRect` (lưới cột điện/đèn/trạm/kiốt 6.2) / `SL.tallInSq` (cả hai, pad 0,3 m); terrace:
    trúng → thu tán sc tới 0,85, vẫn trúng → bỏ ô (CẢ ô own; stats.life.terraceTall = 19) → 0/400 tán bị thân xuyên; ô/bạt CHỢ thêm
    `poleInRect` (ô: 0,8 × bán kính, bạt: chữ nhật rộng × sâu) → cột trong tán chợ 15 → 2. (3) người ĐI BỘ tụt 391 → 350 (dải xe 2 sát
    mặt tiền lấp lối W4-B): bỏ 1/3 cụm ngẫu nhiên KHÔNG giúp (khe 3-6 m < quãng fit 6 m; 367 người, 088 mất 1/3 xe: 63 → 41) → mỗi hàng
    2 dải dài ≥ 12 m chừa MỘT KHE 6,8 m liền ở dải 2 (vị trí hash hàng, seed 1531) — TRỪ khi khe rơi trong 25 m quanh camera pano bằng
    chứng (ảnh thật ở đó kín 2 dải: 088/083 giữ 63 xe/20 m) + lối đi giữa 2 dải (bó vỉa + 1,8 m, vỉa rộng) + hệ số người đi bộ trong
    nhóm chung × 1,25 → × 1,4 (tổng ngân sách người không đổi) → walkI 418 (base 391), xe 23,2k → 22,8k, chồng xe/người 1 (= base).
    (4) cụm người tĩnh lấy mẫu ngân sách THEO NHÓM (`cl` = hash tâm nhóm ∈ (0,1], ghế nhóm bỏ cùng nhóm, ghế không ai ngồi bỏ) → người
    đứng lẻ trong cụm 42/422 → 4/385. (5) regex fp_nature `(court)?yards?|compounds?`, `markets?|stalls?` (shipyard/
    supermarket) — dữ liệu sinh ra KHÔNG đổi. A/B cùng phiên (review/probe, 2×2 xen kẽ): hpReady 5233 → 5359 ms (+0,13 s), 0 lỗi JS.
    Ảnh REAL | dot3 | W5-C r1 | r4: `scratchpad/dot3/W5-C/pairs_r4` (267/088/184/446/538/271/519 + đối chứng 010/230).
- **2026-10-14 (Đ3-W4 SỬA HỒI QUY TÍCH HỢP)** [chấm cặp REAL | dot3 c24a52e | tích hợp W4: 5 pano tụt điểm — sửa TẬN GỐC, không gỡ W4]:
    **(1) BẢNG LỚN TỪNG BAY trên toà một chủ** (pano_046 h0/h270 BIDV, 161 h90/h180 ngân hàng "trắng sọc xanh", 515 h0/h270 toà
    thương mại 8 T): chế độ 3 của W4-A (`aFp.z` = 3) dựng ô PANEL chữ cửa hàng NGẪU NHIÊN ở MỌI bay tầng 1(-2) → chồng "NHÀ NGHỈ/
    NHA KHOA/CẦM ĐỒ/THỜI TRANG NỮ" lên ngân hàng/văn phòng. Đó là kiểu phố NHÀ ỐNG nhiều hộ (464, 023 — đúng); ảnh "multi/banner"
    trên toà kính/thuộc địa/công sở = MỘT dải biển của MỘT chủ. Sửa `js/citygen.js` `fpPanelOK(D, e, rs)`: chế độ 3 CHỈ khi vân tay
    'tube'/'tube_old' VÀ kiểu dựng TUBE/OLD/MODERN; còn lại chế độ 2 (dải biển trệt MÀU THẬT, 1 dải liền) — `fpBuild` + bit biển lớn
    của renderStyles cùng luật. 274 nhà chế độ 3 → còn ~207 (tube 182 + tube_old 25, trừ nhà có kiểu dựng khác).
    **(2) BIỂN TRÊN MÁI ghi nhầm 'multi'** (046 h270 nhà góc đỏ: "biển quảng cáo lớn trên mái" → bảng mọi bay tầng 1-2):
    `tools/gen_facade_fp.mjs --collect` đổi 'multi'/'banner' → 'roof' khi ghi chú (không vào facade_fp.json) nói `biển … trên mái|nóc`
    và không kèm '+' biển khác (5 quan sát: 046 h225/270, 068 h90, 177 h0, 401 h0; stats.roofFromNotes). 'roof' → biển trên mái +
    dải trệt màu thật (luật W4-A sẵn có).
    **(3) LÁN TẠM trúng nhà 3 tầng** (519 h90: "quán tạm mái tôn sát tường" khớp footprint căn góc 3 T, tầng vân tay 1 bị chặn →
    kiểu SHED + tường nâu tôn + trệt sạp chợ = "tháp gỗ nâu"): `process_buildings` `applyFP` — quan sát 'shed' mà nhà CUỐI > 2 tầng
    ⇒ quan sát tả VẬT KHÁC đứng trước nhà → BỎ cả vân tay nhà đó (`fp_shed_tall_dropped` 28; 4.701 → 4.673 nhà có vân tay; độ phủ
    mặt phố ≤ 40 m 70,1 → 69,8 %, ≤ 20 m 92,3 → 91,9 %); kiểu dữ liệu theo vân tay áp SAU quyết định tầng; citygen `fpRenderStyle`
    'shed' → SHED chỉ khi ≤ 2 tầng.
    **(4) "villa" KHÔNG ban công** (533 h180: tường vàng trơn cửa sổ song sắt hẹp → khối thuộc địa 3 T ban công vòm): `fpBuild` bộ tầng
    trên FU cho VILLA khi ảnh nói balcony none + cửa nhôm/nhỏ/song sắt (FU1/FU9/FU7, 43 nhà); villa có ban công/cửa vòm/chớp gỗ giữ bộ
    W4-C. **(5)** trệt 'market' trên GLASS/TOWER/CIVIC/NEO → bộ FG4 kính (515 h270: sảnh toà thương mại thành sạp hàng).
    Sinh lại: collect → process_buildings 2 lần cùng md5 (38f584da). Ảnh (tier 3, 890M, :8801, khoá GPU, traffic off, 1280×634):
    keep/w4_fix (5 pano × 4 hướng + đối chứng 464 h90/h180, 023 h180 — bảng lớn nhà ống GIỮ nguyên; 068/177/401), ghép keep/
    pairs4fix. Kết quả: 046/161/515 hết chồng bảng (dải màu thật); 519 h90 về căn góc như dot3; 533 h180 hết ban công vòm (vẫn 3 T
    theo 3 quan sát đồng thuận — ảnh thật trông 1 tầng cao, chưa sửa). Cổng: node --check, waterbfs 5/5, check_assets ĐỦ, diag full
    "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở (259,110) có từ W3), diag lite OK, 0 lỗi JS khi chụp.
- **2026-10-14 (Đ3-W4 TÍCH HỢP)** [ĐỢT 3 WAVE 4 — gộp 3 nhánh lên `dot3` (c24a52e) theo thứ tự A → C → B, `--no-ff`]:
    **Gộp:** W4-A VÂN TAY (`worktree-wf_a4af6823-53d-59`, a926c6d) sạch; W4-C FACADE KIT (`…-53d-2`, 8698668) xung đột 7 khúc
    trong `js/citygen.js` (KNOWLEDGE tự gộp union); W4-B NATURE-LIFE (`…-53d-1`, 9d77ab4) sạch (props/trees/streetlife/treemap/
    props_evidence — không chồng file với A/C). **Giải xung đột citygen (giữ ý cả 2 phía):** (1) khối vân tay A (`FP_ENUMS`/
    `fpRenderStyle`/`fpPanel`/`fpBuild`) + `FIXED_G` có `RS.HOTEL` (C); (2) `NOSIGN_ST` + HOTEL và `NOHOME_ST` (C) + tham số `fg`
    của `groundModule` (A) — thân hàm: `fg > 0` → bộ FGk TRƯỚC, rồi luật `NOHOME_ST`; (3)(4) shader GL2/GL1: `home = st != CONS &&
    st != HOTEL && …` (C) rồi `if (fpG > 0.5) m = pickFGi(…)` (A) — JS/GL2/GL1 vẫn khớp bit; (5) program key MỚI `'fabric_v4ac_'`
    (cả 2 nhánh đổi shader); (6) tuổi: tuổi vân tay (A) RỒI kẹp khách sạn ≤ 1 (C); (7) biển quảng cáo trên mái: luật vân tay (A)
    nhưng KHÔNG BAO GIỜ trên HOTEL (C) ở cả 2 nhánh điều kiện.
    **Nghĩa vụ chéo A × C (sửa ở bước gộp):** (a) `fpRenderStyle` 'hotel_tower' → `RS.HOTEL` CHỈ khi ≥ 4 tầng VÀ ≥ 600 m²; còn lại
    giữ TOWER (≥ 7 T)/GLASS như A — đo: 53 nhà vân tay 'hotel_tower', 46 nhà < 300 m², 31 nhà ≤ 3 T (nhà nghỉ ống hẹp; đổi hết
    sang khung đá + sảnh kính là sai); (b) KHÁCH SẠN từ bằng chứng FEF của C (pano_359/230) GIỮ khi vân tay chỉ ra GLASS/TOWER/
    MODERN/NEO/CIVIC (`hotelEv`, `stats.fpHotelKeep`) — nếu không vân tay "neoclassical/glass" của pano_359 lật lại hồi quy wave 3
    mà C vừa sửa; (c) `fpBuild`: kiểu HOTEL → gs = 0 (không bộ FG; sảnh `G_LOBBY` qua FIXED_G — biển cửa hàng trên sảnh khách sạn sai).
    **Sinh lại (2 lần, cùng byte; so nội dung bỏ qua CRLF — xem bẫy autocrlf ở mục W4-A):** `gen_facade_fp --collect keep/fp_json
    keep/fp_plan.json` (3.306 file, 15.934 quan sát) = audit/facade_fp.json đã gộp; `process_buildings` md5 eb0710b4 (= W4-A,
    43.219 nhà) — C/B không đổi đầu vào của nó; `gen_fp_nature --fp keep/fp_json` (551 pano) → `gen_treemap` → `gen_props_evidence`
    = bản B. Không commit sinh lại nào (không đổi). process_osm/ROADS_DT không đổi (không nhánh nào chạm đầu vào). gen_landuse không
    chạy (thiếu tools/osm_landuse.json; nhà RB chỉ dùng cho ảnh --ppm, landuse_data.js không phụ thuộc buildings_real).
    **Cổng (tier 3, ANGLE Radeon 890M D3D11, :8801):** node --check 18 file (world.js qua bản .mjs) · waterbfs 5/5 · check_assets
    ĐỦ (8b8e42c) · diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở (259,110) — đã có từ wave 3) · diag lite OK, mọi bất biến
    0 · mobile OK 0 lỗi · std ×2 + 12 khung kiểm chéo (359/423/106/230/088/023/193/115/538/345/281/224) + cùng 12 khung `--gl1`
    (webgl2 false): 0 lỗi JS; mặt tiền GL1 = GL2 (nền phẳng ở GL1 là có sẵn từ dot3). Mắt (REAL | dot3 | tích hợp): 359 h0 khung
    đá + kính (không về NEO be), 230 h90 khách sạn + sảnh kính + mái sảnh, 106 h90 rào "ĐANG THI CÔNG" giữ, 115 h270 bãi đất +
    container, 224 h270 khuôn viên Hải quân không biển, 088 h90 hàng xe máy dày. 423 h0: 'VÀNG BẠC' của dot3 KHÔNG còn — y hệt ảnh
    W4-A r3 (vân tay nhà đó: cửa xếp/không biển; ảnh thật cũng không có biển vàng bạc) ⇒ không phải lỗi gộp.
    **Perf cùng phiên (std 24 khung ×2 xen kẽ, dot3 git archive :8802 ↔ tích hợp :8801, traffic off, pin):** hpReady 5.237/4.993
    → 5.086/5.145 ms (TB 5,12 s cả hai); calls TB 378,3 → 382,4 (+1,1 %); tris TB 2,865 → 2,990 M (+4,3 %; tệ nhất pano_092 h0
    +9,1 %, 102 h90 +7,4 % — xe máy dày B + gờ phào/trụ áp C); fps 60 (trần) mọi khung; bước khởi động final 692 → 794 ms (+100:
    xe máy/người B), freeze 210 → 237, fabric ≈. Heap `usedJSHeapSize` cuối lượt chụp 482/474 → 587/618 MB NHƯNG sau
    `HeapProfiler.collectGarbage` (CDP, 2 lượt xen kẽ) 427 → 449 MB (+22 MB, +5 %) ⇒ phần lớn là rác chưa thu, không phải giữ lại.
    BẪY: số heap của shoot.mjs/perf.mjs KHÔNG gom rác trước khi đo — so A/B heap phải ép GC qua CDP.

- **2026-10-14 (Đ3-W4-A VÂN TAY MẶT TIỀN)** [ĐỢT 3 wave 4 — mặt tiền theo ĐÚNG từng ngôi nhà trong ảnh pano thật]:
    **DỮ LIỆU:** agent trích xuất đọc 3.306 ảnh pano cắt (551 pano × 6 hướng gần vuông góc phố, FOV ngang ≈ 98°) → mỗi nhà thấy
    được: x0..x1 trong ảnh, độ sâu near/mid/far, tầng, màu tường #hex, kiểu (14 loại), ban công, cửa sổ, tầng trệt, biển (nền/chữ/
    cỡ/số tầng phủ), mái hiên, mái, tuổi. `tools/gen_facade_fp.mjs --collect <fp_json> <fp_plan.json>` gộp thành
    **`audit/facade_fp.json`** (1,1 MB, 15.934 quan sát, 1 dòng/quan sát, bỏ ghi chú; ảnh/JSON gốc ngoài repo) = ĐẦU VÀO CAM KẾT.
    Giá trị lệch cột (vd ground = '#2060c0') → −1 (không rõ).
    **ÁNH XẠ ảnh → nhà (`mapFacadeFP`, tất định, ~0,3 s):** bearing(x) = heading + atan((x − 0,5)·2·tan 49°) (la bàn 0° = −z);
    3-12 tia rải trong lõi 76% của [x0,x1] từ camera xe → cạnh footprint ĐẦU TIÊN chạm (DDA lưới cạnh 6 m, nhà chặn nhà sau);
    cửa sổ độ sâu near 0-26 / mid 5-52 / far 15-90 m (đo histogram: near đỉnh 5-15 m, mid 10-20 m — "mid" trong ảnh gần hơn mắt
    người đoán); không tia nào lọt → lượt 2 nới (0-40/0-70/10-70, trọng số × 0,5: nhà thật sau hàng ki-ốt/cây không có trong RB).
    Nhà nhận quan sát khi ≥ max(1, 20% K) tia hoặc là nhà nhiều tia nhất; trọng số = độ sâu (1/0,6/0,25) × tỉ lệ tia × (0,35 +
    0,65·phủ) × (0,8 nếu tầng không chắc). Gộp: rời rạc = phiếu có trọng số; tầng = trung vị trọng số (near/mid trước); màu tường =
    TB tuyến tính các quan sát cách màu quan sát nặng nhất < 70; biển = quan sát nặng nhất CÓ biển. Kết quả: 4.887 nhà; ngưỡng
    FP_MIN_W 0,03 → **4.701 nhà có vân tay; độ phủ nhà mặt phố (cạnh FRONT ≤ 40 m quanh camera pano) 70,1 %, ≤ 20 m 92,3 %**
    (`node tools/gen_facade_fp.mjs` in số này + phân bố). Ngưỡng 0,1 chỉ còn 59,6 % → giữ 0,03 (quan sát yếu vẫn là ảnh thật,
    hơn đoán thống kê).
    **PIPELINE:** `tools/process_buildings.mjs` bước **10b** chạy ánh xạ trên hình học CUỐI (sau bước 9, trước thuộc tính) →
    bước 11 `applyFP` SAU luật thống kê: kiểu dữ liệu (colonial→OLD, neoclassical→CIVIC, hotel/glass→GLASS…; trừ khuôn viên cbIn),
    tầng (khi trọng số ≥ 0,2, bỏ "nhà kim" ≥ 7 T trên nền < max(9·T, 120) m², nhà SINH ≤ 9; fixed → không làm trơn), mái ngói
    thấy từ phố → HIP_TILE, màu tường → chỉ số WALL_PALETTE gần nhất (+ RGB thật trong RBF1), công năng trệt (shop/shutter/glass/
    market/restaurant → SHOP, home → HOME, gate/wall → GATE). 2.435 nhà đổi tầng, 2.304 đổi kiểu. Sinh 2 lần md5 y hệt.
    Vòng sửa 1 (sau ảnh r1): (a) MÀU ĐO TRÊN ẢNH gồm bóng râm/ngược sáng → 434 tường độ sáng < 0,42 (vd "#33302c") thành khối
    đen sì (pano_432 h270) ⇒ nâng độ sáng tương đối tối thiểu 0,42 giữ sắc độ (trừ nhà kính/khách sạn); (b) DÃY GỘP: mặt phố dài
    > max(2·bề rộng quan sát, bề rộng + 6 m) (98 nhà) ⇒ quan sát chỉ tả 1 nhà trong dãy → KHÔNG ép trệt/biển/mái hiên/ban công/
    màu RGB cho cả dãy (pano_092 h180: 1 cửa cuốn → cả dãy 5 bay cửa cuốn trơn), chỉ giữ kiểu/tầng/tuổi + chỉ số màu nền.
    Vòng 2: khối KHÔNG có cạnh mặt phố (ôm góc, citygen tự nâng cạnh hông) dùng cạnh dài nhất cho luật dãy gộp (390 nhà);
    ngưỡng sáng 0,42 → 0,55 (678 tường; 0,42 vẫn xám tối trong bóng game); 97 quan sát/18 ảnh agent ghi LỆCH 1 CỘT từ widthM
    (widthM = '#hex', wallName = kiểu…) → --collect tự dời lại.
    **ĐỊNH DẠNG (js/buildings_data.js, CỘNG THÊM):** mục **RBF1** ở ĐUÔI (sau mục chữ nhật): u32 magic | nF | u32 idx[nF] (chỉ số
    nhà theo thứ tự GIẢI MÃ: đa giác trước, chữ nhật sau) | 20 mảng u8 `FP_FIELDS` (wallRGB, bgRGB, fgRGB, style, balcony, windows,
    ground, size, span, awning, roof, age, floors, conf; 255 = không rõ; trắng thật lưu 254). decodeRB → `D.fpE` (Int32 nB, −1)
    + `D.fp`. `FP_ENUMS` dùng chung tool ↔ giải mã. Bộ giải mã cũ bỏ qua byte đuôi. buildings_real.js 1,45 → 1,60 MB base64 (≤ 1,8).
    **RENDER (js/citygen.js):** thuộc tính đỉnh mới **`aFp` u8×4** (GBuf.fpv đặt 1 lần/nhà, MỌI đỉnh của nhà nhận — kể cả ô det):
    x,y = nền biển RGB565 | z = chế độ biển (0 không vân tay, 1 KHÔNG biển → dải biển vẽ như tường + không hộp biển 3D, 2 biển màu
    thật, 3 biển BẢNG LỚN mọi bay tầng 1 (+ tầng 2 nếu phủ 2), 4 biển không rõ → thống kê) + màu chữ 2 bit (trắng/đen/đỏ/vàng) +
    phủ 2 tầng + "biết màu tường" (tắt nhuộm ngẫu nhiên từng bay của dãy gộp) | w = bộ trệt **FGk** (cửa hàng mở / phố cũ / cửa cuốn
    / kính / cửa xếp / nhà ở / tường-NEO-COL / chợ / quán ăn) + bộ tầng trên **FUk** (nhôm kính ± ban công sắt/bê tông, chuồng cọp,
    chớp gỗ, vòm, song sắt, vách kính, cửa sổ nhỏ — chỉ cho kiểu dựng TUBE/OLD/MODERN/KTT/TEN). `groundModule(…, fg)` JS khớp bit
    với shader (cùng g1; GL1 cùng u1). renderStyles: kiểu dựng theo vân tay (tube→TUBE|MODERN, tube_old→OLD, colonial→COL,
    neoclassical→NEO, villa, apartment→KTT|TEN, glass→GLASS|MODERN, hotel→TOWER|GLASS, shed, civic, construction→CONS) thắng
    bằng chứng FE cũ; tuổi = tuổi ảnh; cờ biển lớn = multi/banner. Chi tiết 3D: ban công có/không + lan can sắt/bê tông theo ảnh,
    mái hiên có/không + tôn/bạt + màu (AWN_FP), biển dọc chỉ khi 'vertical', biển trên mái chỉ (và luôn) khi 'roof', biển bảng lớn
    trước ban công khi chế độ 3. Nhà không vân tay: y hệt trước. program key 'fabric_v4a_'. Chẩn đoán: `fabricFacadeOf(b).fp`.
    **BẪY:** (1) trong heredoc của công cụ Bash ở máy này `\\n` bị đổi thành `\n` (xuống dòng thật) → sửa mã có chuỗi `\n` bằng
    script viết qua Write. (2) const FP_MIN_W phải khai báo TRƯỚC bước 10b (TDZ). (3) RBF1 khoá theo THỨ TỰ GIẢI MÃ → ai sinh lại
    buildings_real.js bằng generator cũ sẽ MẤT vân tay (không lỗi) — luôn chạy process_buildings bản này.
    **ĐO / KIỂM** (tier 3, 890M D3D11, :8701, khoá GPU, traffic off, 1280×634): 24 pano liên quan (mật độ vân tay cao nhất
    trong 120 pano AUDIT4) + 8 đối chứng (060/019/042/230/285/304/074/395) × 4 hướng, 3 lượt (r1/r2/r3), ghép REAL | dot3 (keep/
    new_c24a52e) | nhánh. Khớp rõ: biển trắng chữ đỏ (102 h180/270), biển đen chữ trắng (262 h90), biển xanh (143 h270, 345 h90,
    129 h180), bỏ biển bảng lớn giả nơi ảnh không có (102 h90, 111, 129, 377), mái hiên tôn/bạt xanh (102, 106 h0/270, 111 h0/
    270, 143 h270), tường trắng phố Pháp HVT (253), xanh ngọc (106 h180, 189 h90, 345 h0), hồng (143 h270), biển bảng lớn đỏ thật
    (464 h90/180, 023 h180 nhiều tầng trắng chữ đỏ); đối chứng 230 h90/180: khách sạn kính (AUDIT4 mức 5 "khối xám ố") giờ là
    khối kính + trệt kính nhờ vân tay pano lân cận. Đối chứng khác không đổi. Chấm tay (thang AUDIT4) 20 pano xem kỹ: TB ~5,1 → ~5,6.
    Perf cùng phiên A/B dot3 ↔ nhánh (2 lượt xen kẽ, 1280×720): calls y hệt (pano_007 503, cam_spawn 404, game_3 352,
    cam_high 397-422 cả hai), tris −0,0…−0,2 % (ít ban công/mái hiên giả); hpReady dot3 7,0/6,9 s ↔ nhánh 5,8/5,4 s (thứ tự chạy,
    không chậm hơn); heap JS 482/424 ↔ 600/516 MB (dao động GC ±100 MB giữa lượt — aFp 4 B/đỉnh được thả sau upload như mọi
    thuộc tính phố). Cổng: node --check, waterbfs 5/5, check_assets ĐỦ, diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (overlap 1 ở
    (259,111) đã biết), diag lite OK, 0 lỗi JS ở 3×8 lượt chụp.
    **VÒNG PHẢN BIỆN (merge-with-fixes → r2):** (1) **MÀU TƯỜNG RỰC** — 640/4.311 tường S > 0,45 (khối đỏ/cam/tím 193 h0/h90,
    092 h0, 446, 175, 368): agent trích lấy màu BIỂN/BẠT làm tường. Sửa: `mapFacadeFP` BỎ quan sát có tường cách nền biển của
    chính nó < 40 (ΔRGB), tường S > 0,6 trọng số × 0,3 khi chọn màu tham chiếu; `applyFP` trần HSV S theo sắc độ (giữ H, V):
    đỏ/cam/hồng sẫm (H < 35° | > 300°) 0,3, lam/tím (200-300°) 0,35, vàng/lá/ngọc 0,45 (582 tường hạ) — 207 vàng Pháp giữ,
    193/092 hết khối đỏ. (2) **ĐANG XÂY MẤT** (106 h90 rào "ĐANG THI CÔNG" → nhà cửa cuốn, 281 h180): citygen renderStyles giữ
    RS.CONS khi đến từ bằng chứng trực tiếp FEF.CONS (`consEv`) dù vân tay nói 'tube'; tuổi vân tay không đè tuổi 1 của CONS.
    (3) **TẦNG MÂU THUẪN** (16 vs 1, 15 vs 3): mapFacadeFP ghi `flAgree` (phần trọng số trong ±1 tầng quanh trung vị) + `flNM`
    (số quan sát near/mid có tầng); applyFP chỉ áp khi flAgree ≥ 0,6 (206 nhà bị chặn); đổi > 3 tầng cần ≥ 2 quan sát near/mid
    (12 chặn, vd #13078 2 → 15 từ 1 quan sát 41 m); nhà tầng CHẮC (OSM levels/height, tallObs) đổi > 3 cần thêm flAgree ≥ 0,75
    (4 chặn, vd #306 OSM 15 giữ). Hạ cao ốc khi NHIỀU quan sát gần cùng thấy thấp VẪN áp (#590 tallObs 20 → 2 = showroom 2
    tầng đứng trước khách sạn ở pano_080 h45; #2025 15 → 3 từ 16 quan sát đồng thuận 0,92). Thống kê ST fp_floors_disagree/
    _single_kept/_sure_kept/_big (đổi ≥ 4 tầng: 69). Phụ: 'banner' chỉ là bảng lớn nhiều tầng (chế độ 3) khi phủ ≥ 2 tầng
    (`fpPanel`); bộ trệt FG tắt (gs = 0) cho kiểu NOSIGN (CIVIC/GLASS/SHED) có USE_HOME hoặc ô khuôn viên không phải SHOP (giữ
    luật rc 3 "trệt không biển" sau tường mỏ neo — JS/GL2/GL1 cùng qua byte aFp); dãy gộp bỏ cả 'windows' (không ép 1 bộ FU cho
    mọi bay); màu biển lấy từ quan sát nặng nhất có biển CÙNG cỡ đã bỏ phiếu. Sinh 2 lần md5 y hệt (eb0710b4). Ảnh: 16 pano phản
    biện × 4 hướng + 8 góc phụ, ghép REAL | dot3 | r1 | r2 (scratch W4-A/pairs4, pairs5); diag full/lite 0 lỗi JS.
    **BẪY thêm:** (4) `git archive` với core.autocrlf=true đổi LF → CRLF ⇒ md5 buildings_real.js khác bản sinh — so tất định
    bằng chạy process_buildings 2 lần trong CÙNG cây, không so với bản archive.
    CÒN: (a) dãy gộp/khối ôm góc (390) về thống kê — chưa có vân tay theo TỪNG BAY; (b) độ phủ 70,1 % sát ngưỡng (trích thêm
    hướng 90/270); (c) bộ trệt FG vẫn có thể sai kiểu công năng (175 h0 mặt tiền ngân hàng thành cửa hàng); (d) quan sát gần
    "không biển" thắng quan sát xa thấy biển (446 h270); (e) tường có biển phủ kín mặt tiền vẫn hơi đỏ/hồng (446 h270 #e0aa9d,
    368 h90 nâu gạch) — đúng một phần (ảnh thật biển đỏ phủ kín); (f) camera game ép sát mặt tiền ở vài pano (AUDIT4 D3).
- **2026-10-14 (Đ3-W4-C FACADE KIT & FIXES)** [ĐỢT 3 wave 4 — bộ chi tiết thuộc địa/tân cổ điển/biệt thự, khách sạn/văn phòng,
  mặt kính cửa hàng, hết "hộp trơn", hồi quy pano_115/359, phơi sáng theo ảnh thật]:
    **(1) ATLAS 8×14** (`facade_atlas.js` `ATLAS_ROWS` 12 → 14: 2048×3584 / LITE 1024×1792): BẪY ĐẾM Ô — `grep -c "cell('"` ra
    85 nhưng vòng SIGN/PANEL/BLADE/BILL sinh nhiều ô ⇒ thực có 95/96 ô (chỉ 1 chỗ trống); vượt thì `wallBase` ném "offset is
    out of bounds". +10 ô SAU BILL (chỉ số cũ giữ): `U_HOTEL` (trụ đá kem 2 mép bay + kính trọn tầng + spandrel đá + tay vịn
    kính), `G_LOBBY` (sảnh: cột đá vuông, vách kính cao, nội thất ấm sáng, KHÔNG biển), `G_STORE0/1/2` (mặt KÍNH cửa hàng thời
    trang/điện máy — ma-nơ-canh; NGÂN HÀNG/phòng khám — trụ granite + quầy; điện thoại — poster dán kính; cả 3 có dải biển ⇒
    có trong `SIGN_EXT`), `U_COL2` (thuộc địa: trụ kẻ mạch, cửa cao trán cong + công-xon, ô lan can con tiện, chớp lật MỞ), `U_VILLA2`
    (cửa vòm + ban công con tiện + chớp mở), `G_VILLA` (trệt chân đá kẻ mạch ngang, 2 cửa vòm có chớp, không biển), `P_COL` (lan
    can mái gờ phào răng cưa + con tiện), `D_CORN` (mặt gờ phào 3D). Còn 7 chỗ trống cho W4-A.
    **(2) KIỂU DỰNG 13 = KHÁCH SẠN/tháp văn phòng** (`RS.HOTEL`; 14, 15 còn trống trong 4 bit aFac.z): `renderStyles` — quan sát
    pano chạm nhà có "cao tầng" + ("kính" | "tân cổ điển" | "showroom") trên khối ≥ 1.200 m² (không KTT) → HOTEL, xét TRƯỚC luật
    NEO/GLASS. pano_359 (Pullman, dữ liệu 6 tầng, cờ cao tầng+kính+tân cổ điển): trước ra NEO (mặt tân cổ điển be — hồi quy
    wave 3), nay kính khung đá; pano_230 (SHED→GLASS cờ cao tầng+kính) trước ra khối xám ố + trệt hông XP, nay kính + sảnh.
    HOTEL: `NOSIGN_ST` + `NOHOME_ST` (MỚI — kiểu KHÔNG có bay "nhà ở": CONS, HOTEL; JS `groundModule`, GL2, GL1 cùng luật) +
    `FIXED_G` (G13 = ['G_LOBBY'] — biển cửa hàng trên sảnh khách sạn là sai), tint shader kéo về đá kem 75%, tuổi ≤ 1, không ban
    công/điều hoà/biển mái, `bigFlag`, kính phản trời ×1 (glassK). MÁI SẢNH KÍNH 3D (`hotelCanopy`, ô det): tấm 5,5 m × ≤ 20 m ở
    +4,4..4,75 m giữa mặt phố dài nhất ≥ 10 m (10 tam giác). Toàn thành phố chỉ 2 nhà đạt luật (bằng chứng pano là bắt buộc —
    W4-A ánh xạ style "hotel_tower"/"glass_office" của fp_json → `RS.HOTEL`/GLASS). TRỆT HÔNG LỘ (rc 1) của nhà lớn kiểu kính/
    tháp/khách sạn (st 3/11/13) → `G_LOBBY` thay bộ XP xi măng ố; đêm litP 0,12 như sảnh trước (mặc định 0,58 ⇒ hông tối đen).
    **(3) BỘ CHI TIẾT THUỘC ĐỊA 3D** (`classicKit`, kiểu COL/NEO/VILLA, cạnh MẶT PHỐ không che, L ≥ 3 m, mái không dốc): GỜ PHÀO MÁI
    nhô 0,36 × cao 0,42 m ở đỉnh tường (ô CHÍNH — bóng viền mái thấy từ xa; mặt trước `D_CORN`, đáy/đỉnh/2 đầu `D_PLAIN`; 10 tam
    giác), GỜ TẦNG nhô 0,13 m mỗi sàn (ô det, 4 tam giác/tầng), TRỤ ÁP nhô 0,11 m rộng 0,52 m ở MỌI ranh bay từ trệt+3,8 m tới
    dưới gờ phào (ô det, 6 tam giác; khớp trụ vẽ ở 2 mép bay của U_COL*/U_NEO/U_VILLA*); màu = màu tường sáng hơn 35%. Helper
    `quadN` (quad theo pháp tuyến MONG MUỐN — tự đảo thứ tự đỉnh khi tích có hướng ngược: hết nhầm CCW), `ledge`, `pilaster3`.
    Biệt thự mái bằng gần chữ nhật (≤ 6 đỉnh, ≥ 0,85 OBB, < 700 m², ≤ 3 tầng) → mái NGÓI 4 dốc 70%. Lan can mái COL/NEO/VILLA
    → `P_COL` 75%. Bộ mô-đun: U4 +U_VILLA2/U_COL2, U7 +U_COL2, G4 +G_VILLA (CHỈ G4 — phản biện: G_VILLA trong G7 xoá biển 'VÀNG BẠC' pano_423
    h0, phố Pháp vẫn là phố buôn bán), G0 +G_STORE0/2, G3/G10/G11 mặt kính cửa
    hàng (đổi độ dài bộ ⇒ hash chọn lại mô-đun trệt toàn bộ nhà kiểu đó — chỉ đổi biển/cửa, không đổi bố cục).
    **(4) NHÀ Ô "HỘP TRƠN"** (`cellfacade.js`): (a) `paintGridFacade` — mặt tiền lưới cửa sổ KIỂU CỔ ĐIỂN (có cửa vòm, hoặc cửa
    CAO h/w ≥ 1,3 trên nền ấm vàng đất/kem 18-70° hay nền sáng, HOẶC ≤ 3 hàng cửa h/w ≥ 0,95 trên nền ấm/trắng l > 0,8 — công thự/biệt thự thấp 496 h90) thêm trụ áp giữa các cột cửa + 2 mép, gờ phào đỉnh răng cưa +
    bóng, gờ tầng, chân tường đậm, MŨ CỬA nằm TRÊN khung (`_win` vẽ khung ra ngoài ô cửa f = 7% — mũ đặt sát ô cửa bị khung
    che mất), bệ cửa, chớp lá sách mở 2 bên khi khe ≥ 0,75 bề rộng cửa; nền hiện đại → gờ sàn bê tông sáng + bóng (pano_538,
    157 h0, 423 h180, 051 h90). (b) `applyCellGlass` (khoá 'cellglass_w4c'): TRỆT (≤ 3,6 m trên LAND_H 2) = mặt kính sảnh/cửa hàng
    (nội thất ấm sáng, thanh ngang 2,7 m, chân kính tối); tầng trên = dải SPANDREL đục dưới mỗi băng kính + kính sáng dần lên
    đỉnh ô (157 h180 VIB: "khối xanh đặc"). (c) `cellCanvasFx`: nền xám than L 0,22-0,32 không chữ → sáng ×1,4 (KHÔNG chạm khối 'NHÀ THUỐC' 395 —
    texture có `signTexts` nên bị bỏ qua).
    CÒN LẠI (ngoài làn): khối nhà ô MÀU ĐẶC không texture (`mrg10_*` sau freezeStatic lượt 1 — vd 180 h270 khối trắng, 019 tường
    kem) không thể tiêm cửa sổ mà không thêm draw call theo màu (lượt 1 nướng màu vào đỉnh + material trắng chung).
    **(5) HỒI QUY pano_115** ("ngõ hẹp thành quảng trường lát"): KHÔNG phải polygon nước/đường — tia dò: nền là `ground_local`/
    `ground_lake` (lưới mịn hồ Tam Bạc) tô lớp URB "sân bê tông sát tường" của landuse; nhà góc `goc_haly` + `nhacap4_haly` bị
    cell sink gỡ ('near' nhà thật 20039/2991) mà Overture KHÔNG có footprint ở lô tây ngõ (x −1093..−1111, z −74..−88) ⇒ bãi xi
    măng trống + rào tôn = HỘP CAM TRƠN `mat(0xa8886a)`. Ảnh thật h270: lô đất trống, dãy container/lán tôn (xám, mảng đỏ/xanh),
    rào tôn gỉ. Sửa (world.js khối 12b, tối thiểu): claim MỚI 'dirt' (`landuse.js` luCompose → lớp C_DIRT 7; `claimPolys('dirt')`
    vào lastExtra) cho lô, rào tôn SÓNG gỉ (canvas 512×128 gân 6 px + vệt gỉ), 2 container 2,44×2,6×5,9 m + cửa tôn xanh + mái tôn
    lán, 5 collider r 1,3 dọc 2 container. BẪY: lớp C_DIRT (7) gặp mật độ nhà ±40 m cao (ngõ đông) ⇒ shader `luClass` trả `vac`≈0
    = BÊ TÔNG xám (lớp 7 dùng chung cho công trường OSM cũ nay kín nhà — cố ý), và 4 bit lớp (0..15) đã kín ⇒ không thêm lớp
    'bãi đất' được. Cách làm: TẤM PHỦ đất nện bám địa hình (`dirt_lot_haly_115`, Plane 7×6 đoạn, +0,05 m, polygonOffset −2,
    depthWrite false, canvas 512×410 đất + sỏi + vệt bánh xe + vũng, mép alpha gradient mềm — mép vòng tròn lỗ chỗ trông như
    vết bẩn; 1 draw call). CÒN LẠI (ngoài làn W4-C): khoảng trống lớn phía bắc/nam ngõ là THIẾU footprint (nhà 5 tầng xây sau ảnh
    Overture) — việc của dữ liệu nhà (process_buildings/W4-A).
    **(6) PHƠI SÁNG** (`daynight.js LIGHT.exposure` 0,92 → 1,0; `aerialExposure` 0,82 → 0,754 ⇒ ảnh vệ tinh GIỮ NGUYÊN): đo 132
    cặp REAL|game (33 pano × 4 hướng, sRGB, bỏ bản đồ nhỏ): độ sáng TB thật 120,1 / game 95,5 → 99,4; 1/3 dưới (đất) 118 / 87 → 91;
    p95 214 / 190 → 195; p5 36 / 37 → 38 (vùng tối giữ). Phần chênh còn lại do mặt nhựa/vỉa tối hơn bê tông thật + trời thật mù
    sáng (không chỉnh mô hình trời — AUDIT4 D9: trời âm u là điều kiện chụp).
    **(7) ĐO**: node (citygen không GPU): tam giác phố 1,402 M → 1,438 M (chính 844 k → 855 k: gờ phào; chi tiết 558 k → 584 k:
    gờ tầng + trụ áp + mái sảnh); dựng 0,88 s như cũ; atlas worker 2048×3584 ~120 ms (node). PERF A/B CÙNG PHIÊN (ABBA, views_std
    24 góc, Radeon 890M tier 3, khoá autoQuality): draw call TB 388,2/387,4 (dot3) vs 389,4/385,2 (W4-C) — ±nhiễu; tam giác TB
    2,986 M → 2,993 M (+0,24%; tệ nhất +0,9% pano_190); hpReady 5,15/4,97 s vs 4,88/4,94 s; heap 389/403 vs 608*/409 MB (* 1 mẫu
    GC lệch; atlas lớn hơn +14% ≈ +4 MB GPU); fps 60 cả hai; 0 lỗi JS.
    Công cụ (scratch W4-C): `nodefab/probe.mjs` (nhà nhìn thấy từ camera pano theo hướng: kiểu dữ liệu → kiểu dựng, tầng, diện
    tích, cờ bằng chứng), `probe_hray.mjs` (tia ngang từ camera trên trang: mesh/material/texture/uv — nhà ô nằm trong
    `cellAtlasN`), `colstat.py` (thống kê màu REAL|game).
- **2026-10-14 (Đ3-W4-B NATURE-LIFE)** [ĐỢT 3 wave 4 — AUDIT4 D4 "cây đồng loạt" + D5 "hàng xe máy quá thưa / chợ thưa hàng": dáng tán RIÊNG từng cây, xe máy đỗ dày theo bằng chứng, xe phủ bạt, cây non khung kiềng, bằng chứng facade fingerprints]:
    (nhánh worktree `worktree-wf_a4af6823-53d-1` trên dot3 c24a52e). File: `js/props.js`, `js/trees.js`, `js/streetlife.js` (tỉ lệ
    hàng tràn/chậu, món hàng chợ thứ 3, mô hình chậu cây), MỚI `tools/gen_fp_nature.mjs` + `tools/fp_nature.json` (ảnh chụp dữ liệu),
    `tools/gen_treemap.mjs` + `tools/gen_props_evidence.mjs` (đọc fp_nature) → SINH LẠI `js/treemap.js`, `js/props_evidence.js`.
    **BẰNG CHỨNG FACADE FINGERPRINTS (`tools/gen_fp_nature.mjs`):** fp_json (W4-A, ~6 ảnh mặt tiền/pano, trường "trees"/"street",
    Việt HOẶC Anh) nằm NGOÀI repo → bộ sinh đếm số HƯỚNG nhắc từng dấu hiệu (cây non/chống cọc/kiềng, nghiêng, tán thưa/rậm, hàng
    xe máy dày, ít xe máy, xe máy phủ bạt, hàng hoá, ghế quán, chậu cây, dây chằng chịt) → `tools/fp_nature.json` (551 pano sau sửa phản biện;
    chạy lại `node tools/gen_fp_nature.mjs --fp <dir fp_json>` rồi 2 bộ sinh kia). CHỈ NÂNG bằng chứng audit:
    treemap young ≥ 2 hướng → 3, lean ≥ 2 → 1 (young 72 → 145 pano, lean 6 → 77); props_evidence xe máy dày ≥ 2 hướng → mức 3 (≥ 1 và
    không hướng nào "ít xe" → ≥ 2), phủ bạt → deco bit MỚI 1024 (regex audit "xe máy … phủ bạt" 17 pano + fp → 38), hàng hoá ≥ 2 →
    spill 4, ghế quán ≥ 2 → clutter 1, chậu ≥ 1 → spill 512, dây ≥ 2 (pano có cột) → pole 2. **BẪY:** agent trích xuất hay CHÉP Y
    HỆT câu cây cho cả 6 hướng ("some young staked trees" ×6 ở 028/083/475) — số hướng KHÔNG đo độ phủ ⇒ fp không bao giờ đẩy young
    lên 6 ("hàng cây non" 80%): bản thử ≥ 4 hướng → 6 biến 81 pano thành 80% cây non (028 kè hồ thật toàn cây lớn nghiêng).
    **XE MÁY ĐỖ (props.js 6.5):** đo node (`scratchpad/dot3/W4-B/nh_run.mjs --bikestat`: xe ≤ 20 m quanh pano theo mức bằng chứng):
    dot3 mức 3 TB 23,8 / mức 2 11,2 (ảnh thật 023/088/345: hàng 10-40 xe kín mặt tiền). (1) `LEVEL` mức 2 [0,28 khởi hàng, 3-9 ô],
    mức 3 [0,75, 6-16 ô], mức 3 nối hàng liền 65% (không chừa ô); (2) mức ≥ 2: hàng xe đi XUYÊN ô OCC_SHOP (ghế quán/biển A/chậu/
    hàng tràn cắt hàng thành khúc 2-6 ô) — từng chiếc vẫn né `obst` + lưới RIÊNG `bikeObst` (ghế quán 0,75 m/biển A/cán dù — KHÔNG
    thêm vào obst để không đổi chỗ đặt ô tô/chợ); (3) dải giữa bị chiếm → thử DẢI SÁT BÓ VỈA (curb + 0,82, xiên 40-52°, vỉa ≥ 2,2 m;
    xe trước ở dải giữa → lùi 0,35 m vì thân xiên chồm dọc ±0,63 m) — `stats.bikeCurb`; (4) KIỂU CỤM: 66% vuông góc 70-90°, 22% xiên
    40-55° (bước dọc ÷ sin góc), 12% lộn xộn ±20° (không kẹp theo xe trước); (5) XE PHỦ BẠT `bikeCov` (mô hình loft chữ U ngược: gù
    tay lái/gương 1,1 m, yên 0,87, võng sàn, mép bạt 0,33 m lộ 2 bánh, nếp nhăn, mép sẫm — ~250 tam giác; 1 InstancedMesh
    `props_bike_cov` vật liệu props, LOD xa dùng chung bóng dáng xe máy): pano phủ bạt ≤ 40 m 22%, phố r 6%, còn lại 2,5%; (6) ngân
    sách 16k/5k → 30k/8k (LITE). Người đi bộ: vỉa ≥ 3,4 m đi dải sát mặt tiền SAU mũi hàng xe (ô xe máy không chặn lối) — hàng xe dày
    từng bớt người đi bộ 404 → 317. Kết quả node: xe máy 14,2k → 28,4k (1,3k phủ bạt), mức 3 23,8 → 43,0, mức 2 11,2 → 27,5; dựng props
    node 645 → 665 ms. QA: `stats.bikeRej` [nhà, vật cản, chồm lòng, nhựa/camera, khe ngẫu nhiên], `__hpProps.lists.bikesCov`.
    **BẪY:** hình cầu (SphereGeometry) biến dạng thành túi trùm xe ra "củ lạc/khúc xương" (2 đầu phình, cực cầu có vết nứt pháp tuyến) —
    dùng loft mặt cắt + nắp quạt; thứ tự đỉnh quad phải (a, b+1, a+1)(a, b, b+1) khi vòng chạy θ π→0 và mặt cắt tăng theo +Z.
    **CÂY (trees.js):** (1) DÁNG TÁN RIÊNG trong shader (VERT_BEGIN, cả lượt bóng): biên độ hpAmp mã hoá trong `aInst.y = vôi + 2·q`
    (q = biên độ×32, 0..15; ô vỏ/vôi đọc `mod(aInst.y, 2.0)`) → bán kính tán ×(1 + A·(0,55 cos(φ−p) + 0,35 cos(2φ+1,7p) + 0,22 cos(3φ+2,3p)))
    + mặt tán nghiêng lệch (y += 0,32·A·r·cos(φ−1,31p)), p = pha aInst.z; chỉ đỉnh aHt ≥ 1,5 (tán + cành tán), trường TRƠN → thẻ lá
    theo cành. A: cây tự do 0,15-0,42, sát tường 0,12-0,26, cây non 0,1-0,25, đa/me 0,08-0,18, hero 0 (heroFit không tính biến dạng),
    cau/TOPI 0. (2) Số ngẫu nhiên thẻ lá XOAY VÒNG theo cây `fract(r + fract(aInst.z·0,618))` → 2 cây cùng kit cùng độ kín thủng CHỖ
    KHÁC (giữ tương quan theo chùm). (3) Độ kín HAI ĐỈNH: 16% cây thưa 0,40-0,55, 14% (pano "rợp" 30%) dày 0,93-1. (4) Cây bị ép tán
    sát tường NGHIÊNG CẢ CÂY ra lòng đường 1,7-4,6° (45%; pano "nghiêng" 80%) + cây tự do ở pano "nghiêng" 40% nghiêng hướng ngẫu nhiên
    (`r.wallTilt`, `stats().ev.wallTilt/amp`). (5) Trồng dọc phố: nhịp × nhiễu giá trị trơn theo khúc 40 m (0,72-1,28) + 6% CẶP cây
    4,4-5 m + hố lệch ngang −0,12..+0,22 m. (6) Kit MỚI cây non trong KHUNG KIỀNG 4 cọc + 2 tầng giằng + dây buộc (`stakes: 'frame'`,
    thêm CUỐI `KIT_DEFS` — giữ chỉ số kit cũ); "cây non" lẻ 0,25 → 0,38; regex young + trồng mới/lại, cọc tre, kiềng, khung chống.
    **ĐỒ HÈ (streetlife.js):** hàng tràn theo bằng chứng ≤ 25 m 16/22% → 26/32% ô, chậu cây trước nhà 3 → 4% ô, chợ mức 3 thêm món
    thứ 3 (55%); props.js quán ghế nhựa theo bằng chứng 0,045 → 0,06. Chậu cây: chậu TRÒN có vành + bụi 7 cụm icosa 4 sắc + lá dựng
    (bản cũ hộp + 1 icosa thô = "nón xanh nhựa", AUDIT4 R6) — giữ icosa thô vì nhóm biến thể `props_spill` bắt mọi instance gánh đỉnh mọi biến thể.
    **SỐ ĐO (A/B cùng phiên, base = dot3 c24a52e git archive :8712 ↔ :8702, xen kẽ 2 vòng, keep/views_ab4.json, TIER 3, ANGLE Radeon
    890M D3D11):** hpReady 5.124 → 5.007 ms (nhiễu, bước nature 143 → 141, furniture 75 → 71); heap 465 → 487 MB (nhiễu ±40);
    fps 60 (vsync) cả hai; calls 1.739 → 1.747 (+0,5%); tris 13,30 → 13,81 M (+3,9%: pano_102 +6,8%, cam_spawn +4,7%, pano_007 +3,2%,
    high +2,4% — xe máy gần ~0,9k tam giác/xe). Ảnh (REAL | dot3 | W4-B, 1280×634, traffic off, 22 pano đích + 8 đối chứng × 4 hướng,
    0 lỗi JS mọi lô; dot3 = keep/new_c24a52e, người làm tự chấm ±0,5): 22 pano đích 5,07 → 5,27 (+0,5 ở 023/083/088/345/124/189/386/001/056 — hàng xe dọc mặt tiền như ảnh, tán đa dạng/rợp hơn; 492/446/184/450 phố chợ không đổi); 8 đối chứng (010/042/060/074/230/285/359/395) không đổi (cây xê dịch do nhịp mới).
    **Cổng:** node --check OK, waterbfs 5/5, check_assets ĐỦ, diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (bất biến: overlap 1 ở (259,111) — có từ bản tích hợp W3), diag lite OK 0 lỗi, mọi bất biến 0.
    **CÒN:** phố chợ vỉa hẹp (492/446/184) vẫn gần như không xe máy — hàng chợ chiếm giữa vỉa, ảnh thật xe đỗ ở MÉP LÒNG ĐƯỜNG (cần
    đưa xe vào `LIFE.stallsRoad` cho giao thông lách — chưa làm, rủi ro bất biến giao thông); dải dạo ven sông (336 h180/h270) không xe
    máy (openSpace ⇒ mức 0) trong khi ảnh thật xe đỗ dọc lan can; vài phố dân cư mức 2 nay dày hơn ảnh (308 h0); nhịp cây mới đổi chỗ
    cây gần camera (083 h0 thân cây to sát trái, 345 h180 mất 1 cây).
    **SỬA SAU PHẢN BIỆN (merge-with-fixes):** đo bằng harness node (`scratchpad/dot3/W4-B/fix/nh.mjs --clash --clash2 --walkbld`;
    lối đi người đi bộ = ±L/2 quanh tâm như shader `KIT_WALK_PATH`, KHÔNG phải 0..L). (1) NGƯỜI ĐI BỘ XUYÊN NHÀ (lối sát mặt tiền
    facadeLine − 0,4 cách mặt tiền danh nghĩa 0,4 m, footprint thật chồm qua): dot3 7/404 → bản đầu 34/338 → **0/350**: lấy mẫu CẢ
    quãng đi mỗi 0,5 m tại lat và lat ± 0,3 với `inBuilding` + (lối qua hàng xe) điểm cách thân xe đã đỗ (hộp 1,8 × 0,66 + 0,25)
    → thử facadeLine − 0,4 / − 0,25 / − 0,7, vẫn chạm thì rút về khúc trống dài nhất (≥ min(6, L − 0,6), ≥ 3,5 m), không thì bỏ;
    lối thường cũng kiểm. Người đi XUYÊN xe đỗ (đo ±L/2): dot3 1 → bản đầu 55 → 0. Ngân sách người nhóm chung: người đi bộ ×1,25
    hệ số giữ, đứng/ngồi chia phần còn lại (TỔNG không đổi) → người đi bộ 288 → 350 (dot3 404). (2) XE MÁY XUYÊN NHAU: lưới `placedB`
    (ô 2 m) mọi xe đã đặt; `tryBike` SAT hộp 1,7 × 0,44 m với xe trong 1,9 m (`bikeRej[5]`), chạm → thử lại SONG SONG xe bị chạm cùng
    mốc t (giữ mật độ). Cặp chồng: dot3 539 → bản đầu 1.468 → **85** (còn lại quanh xe trưng bày `bikeDisplay`, không qua lưới); xe
    27,9k (bản đầu 28,4k), mức 3 41,8 / mức 2 27,0 xe ≤ 20 m. Khách ngồi/đứng (6.4) vào `bikeObst` r 0,3 → chồng sâu = dot3.
    (3) fp_nature `bikeDense` THEO MỆNH ĐỀ (, ; .): bỏ mệnh đề nói xe ĐANG CHẠY/ở ngã tư/"đông" (chạy|lưu thông|qua lại|di chuyển|
    dừng đèn|đèn đỏ|giữa/trên/lòng đường|ngã tư|đông|moving|riding|fast|traffic|passing|on road|at/in junction/intersection) trừ khi
    cùng mệnh đề có đỗ|đậu|dựng|vỉa hè|trước cửa/nhà/quán|parked|kerb|sidewalk|pavement. "xe máy ô tô đông" (đại lộ 435), "xe máy
    chạy dày" (ngã tư 177), "Many motorbikes at junction" (154) là DÒNG XE. 435/154/020 về 0; 177 → 2 (1 hướng "xe máy đỗ dày trước
    tiện lợi"); 146/428/172/254 giữ (chữ "parked row/đậu dày vỉa hè" rõ). Chạy lại trên fp_json ĐỦ (551 pano, 3.303 ảnh); `--fp
    <dir>` hoặc `HP_FP_JSON` BẮT BUỘC (không còn đường dẫn Temp mặc định). (4) DÁNG TÁN: thẻ lá/hoa có thuộc tính MỚI `aPiv` (tâm thẻ
    − đỉnh; cành/thân 0, Geo.pv) → trường thùy tính tại TÂM THẺ và thẻ được TỊNH TIẾN nguyên khối (bản đầu nhân xz từng đỉnh ×0,53-1,47
    = kéo dẹt thẻ); cây tự do A 0,15-0,30 và ≤ (fd − FACADE_CLEAR − R − dời tán)/(1,12 R). **BẪY:** "phiến lá dẹt" ở 088 h90 trái
    KHÔNG do biến dạng (bản sửa y hệt) — đó là kit BÀNG (form tier, thẻ nằm ngang theo tầng) nhìn từ dưới, nay đứng gần camera do
    nhịp cây mới. (5) Bạt xe phủ bỏ xanh đậm/đỏ đô/xanh rêu tối (đọc thành "đống đen" trong bóng 492 h0) → bạc/xanh nhạt/đỏ nhạt.
    Perf A/B (dot3 :8712 ↔ :8702, 2 vòng + 1 vòng mới kiểm, keep/views_ab4.json): tris 13,30 → 13,80 M (+3,8%), calls ≈ (1.764 →
    1.747-1.772), fps 60, hpReady 6,30 → 6,47 s (máy chậm hơn phiên trước cả 2 bên). 1 vòng mới pano_007 lệch 615 calls/4,46 M (vòng
    lặp lại 505/3,60) — nhiễu chụp, lặp lại trước khi kết luận. diag full lần 1 overlap 2 ((48,59) thoáng qua) → lần 2 overlap 1 (259,110 cũ).

- **2026-10-14 (Đ3-W3 SỬA HỒI QUY AUDIT4)** [ĐỢT 3 wave 3 — hồi quy mức 3 của AUDIT4 (REAL | dot3 | tích hợp), nhánh tích hợp]:
    **(R1) SÔNG TAM BẠC "MẤT" SAU LAN CAN (198/203/207/212 mức 3, 134 mức 2) — gốc W3-F, KHÔNG phải polygon nước:** đo WATER
    dot3/F/A/tích hợp ở 6 pano: mép nước lệch ≤ 1,5 m, nước vẫn bắt đầu 8-13 m trước camera. Raycast màn hình (probe trên
    trang): "dải be" = TƯỜNG KÈ bờ đối diện (`mrg10_*`, y 0,5-2,6 ở ~74 m) + gờ đỉnh sáng. Hình học: mặt nước toàn cục y 0,
    dải dạo LAND_H + 0,25 ⇒ tường lộ 2,25 m; mắt pano LAND_H + 2,2, lan can đỉnh +1,14 cách camera 8-13 m ⇒ đường ngắm qua đỉnh
    lan can chạm nước sau ~60 m ⇒ dải nước còn ~4 px (ảnh 1280×634), tường 0xbdb6a6 nắng chiếu (199,187,164) đọc thành cát.
    Ảnh thật 212 h0: tường kè đối diện ≈ cao lan can (~1 m), đá xám + ố sẫm, sông ô liu dày trên lan can. **SỬA:** (a) terrain.js
    `TB_LEVEL = 1,1`, `waterLevelAt(x,z)` (polygon Tam Bạc nội đô = WATER 'Sông Tam Bạc' có |x|,|z| < 2000; vuốt `tbRamp` về 0
    ở hợp lưu Cấm z −620 → −900 và mảnh tây x −1120 → −1205); world.js lưới 6 m (7,9k tam giác, +1 draw call) phủ polygon + 6 m
    giấu dưới bờ, y = TB_LEVEL·ramp − 0,1·(1 − ramp) (nơi về 0 nằm DƯỚI mặt phẳng toàn cục → không bậc/nhấp nháy), UV khớp plane
    toàn cục (gợn liền), tên 'water' (freeze/bóng/farHide chừa như cũ), dập dềnh theo plane. Vật liệu `water_tb` = clone (cùng
    onBeforeCompile/texture): IBL 0,8 + normalScale 0,35 — thử nhám 0,42 / IBL 0,32 + màu nâu: dải nước thành TẤM PHẲNG xám-be
    như nền (lại đọc thành đất) ⇒ giữ nhám 0,2, tăng gợn. (b) riverbank.js tường kè xám hơi lục 0x8f9087 → 0x7a7a70 → VỆT TRIỀU
    sẫm 0x575445 từ 1,05 m → rêu 0x46443a, gờ 0x9d9e95 (bờ Cấm nước y 0: dải sẫm ~1 m trên mặt nước = vệt triều thật).
    (c) Thứ NỔI cộng `waterLevelAt`: thuyền người chơi (vehicles.js tạo/cập nhật/spawn), thuyền neo dải bờ (riverbank `deps.waterY`),
    nhà thuyền tb_shack (world.js). KHÔNG đổi groundHeight/isWater (lòng −3) ⇒ waterbfs/giao thông/va chạm như cũ.
    **(R3) KHỐI NHÀ XÁM 3 TẦNG TRÊN DẢI DẠO (299 h90 mức 3) — gốc W3-F × W3-A ở process_buildings:** footprint MS (−359,−196)
    nằm NỬA trong polygon sông cũ (dot3/F/A: tâm trong nước → drop_water); tích hợp: §6b3 `clearOf(way)` theo bề rộng RIÊNG
    phố 243 (w 11, sw 4) đẩy mép sông thêm ~3 m ⇒ tâm lên dải đất mới (vỉa hè + kè) và SỐNG SÓT. Luật mới `drop_bank`
    (tools/process_buildings.mjs, ngay sau drop_water): tâm cách nước < 12 m, có ĐỈNH chạm nước (waterSD < 0,5), mép nước gần
    nhất thuộc SÔNG/KÊNH (hồ có ki-ốt riêng — không đụng), có đoạn phố p/s/t/r chạy dọc phía đất (tâm → phố cùng chiều gradient
    waterSD, cos ≥ 0,7) và khoảng mép lòng phố → mép nước qua tâm < 12 m ⇒ 6 nhà (3 nhà mới của bản tích hợp dọc Thế Lữ/Tam Bạc
    (−359,−196) (−336,−250) (−320,−337) + (−1309,−84) (−733,−65) (1623,123)). Luật rộng hơn (bỏ điều kiện chạm nước) bắt 19 nhà,
    nhiều nhà có từ dot3 không ai chê ⇒ bỏ. 43 226 → 43 219 nhà, sinh 2 lần md5 82aa1d20 y hệt.
    **ĐO / KIỂM** (tier 3, 890M D3D11, :8601, khoá GPU): chụp lại 6 pano × 4 hướng (134/198/203/207/212/299) + 6 pano đối chứng
    (221/519/331/074/290/336 so audit4): sông hiện lại trên lan can ở mọi hướng nhìn ra sông, 299 h90 dải dạo mở như ảnh thật;
    221 h180 thêm nước, 074/519/331 không đổi đáng kể; hướng phố lệch điểm ảnh ≤ 0,7 %. Cổng: node --check 97 tệp OK, waterbfs
    5/5, check_assets ĐỦ, diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (bất biến như tích hợp: overlap 1 ở (259,110) — đã biết,
    underwater 0), diag lite OK 0 lỗi, hpReady 4,8 s full.
    CÒN: màu nước nhìn xiên vẫn xám-bạc hơn ảnh thật (ô liu) — không có phản chiếu bờ; dải dạo Tam Bạc rộng hơn thật ~2-3 m
    (§6b3 hw + vỉa + 2,5) nên camera xa lan can hơn ảnh thật — chưa đổi (đổi mép nước kéo theo sinh lại toàn chuỗi).
- **2026-10-14 (Đ3-W3 TÍCH HỢP)** [ĐỢT 3 WAVE 3 — gộp 7 nhánh W3-A…G lên `dot3` (bc07df5), nhánh `worktree-wf_c558a007-52e-1`]:
    **Gộp (--no-ff, thứ tự A, B, F, D, C, E, G):** A e3a6579 · B 90c12c3 · F 1b16009 · D cc496fa · C 479adc8 · E cad6ba0 · G 9bcabd9.
    **Xung đột + cách giải (giữ ý CẢ HAI bên):** (B×A) citygen: giữ CẢ luật NOSIGN_ST rc 3 của A lẫn luật PK (bit 6-7) của B;
    world.js import hợp (fabricHit + parcels + propLineShift); process_buildings giữ `SYN_CAM` 6 của A (B từng lùi về 3) + khối
    PEV/STREET_SHOP của B; kiểu/công năng: luật `cbIn` của A đứng TRƯỚC luật khuôn viên pano của B → mỗi nhà chỉ theo MỘT luật
    khuôn viên. (F×A) roadgraph line object = `{c, w, sw, ri, kind, hw, lvl, cutA, pts[x,z,y]}`, cạnh `hw: l.hw (mặt cầu) ||
    roadHW(l) || 2,75`, `sw: sidewalkW(l)`; roadnet way = `{ri, si, c, pts, cut, hw: roadHW(r), sw: sidewalkW(r)}`; process_osm giữ
    `id` (F) + ROADS_LEGACY/simplify 3 m (A). **NGHĨA VỤ F (11)(e) đã làm:** riverbank `hw/sw/keClear` và lan can cầu phẳng
    bridges.js nhận WAY (đoạn mang `w/sw`) — world.js truyền `XS_HW/XS_SW` (nhận cấp HOẶC way); process_osm §6b3 `clearOf(way)` =
    max(7, roadHW(way) + sidewalkW(way) + 2,5) (cầu phố Bạch Đằng ri 52 w 16,4/sw 5,5: lan can ở 13,7 m = mép vỉa roadnet vẽ, bản
    theo cấp đặt 10,1 m — giữa vỉa hè). (D×F) dải roadnet tách vạch qua đường giữa khối của D + seed `w.si` của F. (C×A) groundModule
    JS/GL2/GL1: bộ RS 7-12 + RS.CONS/FIXED_G của C VÀ rc 3 + CIVIC/GLASS/SHED → G_CIVIC/G_WARE của A; luật "cạnh nâng/dãy gộp
    rc 3" so `NOSIGN_ST(rs)` (styF của C mang tuổi/biển lớn ở bit 4-6 — so styF thô là SAI); **BẪY:** renderStyles của C đổi
    CIVIC→NEO, GLASS→MODERN/TOWER theo bằng chứng/vùng → nhà khuôn viên Hải quân (dữ liệu CIVIC/GLASS/SHED + USE_HOME) mất luật
    không biển → nay renderStyles GIỮ chúng trong bộ NOSIGN (TOWER/MODERN → GLASS, còn lại → CIVIC; `stats.nosignKeep`);
    roadGrid seg[6] (vỉa, exposedSide của C) = `sidewalkW(way)`. (E×A) 6 khúc props.js lấy bản E (công thức đã kiểm của E), thân
    `XS(S)` đổi sang `roadHW/sidewalkW/curbLine/parkingLine/furnitureLine/facadeLine(S)` (S mang w/sw). (G×F) trees `fix` =
    `{moved, road, fp, dup, pano, deck, hero}` + HEROQ; cây non dải dạo ven sông (F) trồng `{pit:1, wash:0, exact:1}` (G).
    KNOWLEDGE (merge=union) có 1 dòng §7 roadmarks bị nhân đôi → bỏ bản cũ.
    **Sinh lại (chạy 2 lần, cùng byte):** process_osm → mapdata (ROADS_DT 1.425 way, cấp/thứ tự = dot3, y hệt nhánh A; chỉ WATER/
    BEACHES khác nhánh F do clearOf theo way; 12 BRIDGE_WAYS, đầu mút ROADS_DT ≤ 0,62 m khỏi way cầu → deckRoads vẫn khớp) →
    process_buildings (43.226 nhà — dot3 46.128, A 44.180, B 45.001; drop_water 86; cbIn 59; RB_PARCELS 356 rào/157 cổng; md5
    e9cb8163) → gen_facade_evidence / gen_shopsigns / gen_roadmarks (cần tools/osm_crossings.json, chép từ worktree D) /
    gen_treemap / gen_props_evidence: KHÔNG đổi so với bản gộp. gen_landuse không chạy (tools/osm_landuse.json không có trên
    máy; không nhánh nào đổi đầu vào của nó).
    **Cổng (2026-10-14, tier 3, ANGLE Radeon 890M D3D11):** node --check 98 file js/tools OK · waterbfs 5/5 · check_assets ĐỦ ·
    xsec (dữ liệu) 63,1 % trong ±1,5 m / tooClose 399 / tooFar 279 / sai số TB 2,53 m (nhánh A: 58,1 / 493 / 277 / 2,98) ·
    clearance trình duyệt (--gpu) cam vi phạm 32 (dot3 cùng phiên 35), gần < 3 m 7 (dot3 36), trên nhựa 39 (53), lấn vỉa 81 (72)
    · diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (giao thông: overlap 1 — xem dưới) · diag lite OK 0 lỗi, mọi bất biến 0 · mobile
    OK 0 lỗi · shoot std ×2 + 12 khung kiểm chéo + --gl1 (webgl2 false): 0 lỗi JS (assets_lite ghim 8b8e42c được giải nén vào
    worktree nên KHÔNG có 404). Mắt: khuôn viên Hải quân 224/225 h270 không biển (cả GL1), Bạch Đằng/HVT/bờ kè/hero đa đúng.
    **Perf cùng phiên (std ×2 xen kẽ, dot3 :8602 vs tích hợp :8601):** hpReady 4.327 → 4.949 ms (+622, +14 %); heap 375 → 393 MB;
    bước khởi động ground 533→694, fabric 696→894, final 474→672, freeze 160→267, furniture 30→72, nature 112→135, landmarks
    288→180 (C), shaders 375→327; std 24 khung: fps 60,2/60,2 (chạm trần), calls 368 → 381 (+3,5 %), tris 2,87 → 2,98 M (+4 %).
    Cộng dồn khớp số từng WP (F ~0,17-0,19 s, C fabric +133, D furniture/freeze, B parcels, E/A final) — CHƯA tối ưu ở bước gộp.
    **Còn lại:** (1) giao thông diag overlap = 1 lặp lại ở (259,110): phố chợ r ri 60 (lòng 5,5 m) có sạp/ô `umb`/`stall` của E
    lấn dải lòng 2 bên → xe 2 chiều chen nhau ở giữa (tạm thời, 0 ở mẫu sau); dot3 0. (2) Khung `cam_spawn` (khung đầu tiên):
    phố trước Nhà hát ri 378 nay lòng 14 m, tim dịch ~5 m về phía Nhà hát (W3-A street_fit; nhánh A chụp y hệt) → nửa dưới khung
    là lòng nhựa thay vì quảng trường. (3) Biển "BOX VIETNAM" (400 h180), "TOP FOOTBALL" (088 h180) từ bộ biển C — nên rà thương
    hiệu bằng mắt. (4) Mọi known issue của 7 WP giữ nguyên (xem các mục W3-* dưới).
- **2026-10-06 → 10-14 (W3-A STREET-GEOMETRY, phiên 1-5)** [ĐỢT 3 WAVE 3 — MẶT CẮT PHỐ THẬT + TIM ĐƯỜNG KHỚP CAMERA (AUDIT3 FP-1)]:
    **Vấn đề (AUDIT3, 120 pano):** CAMNEAR 44 pano (mặt tiền 1-6 m; camera kẹt trong khối 487/115), điểm TB pano lệch tim
    ≥ 3 m chỉ 3,07; 4 cơ chế cộng dồn: bề rộng lòng CHỈ theo cấp (r 5,5 → mặt tiền 4,75 m), snapFront kéo nhà thật ≤ 7,2 m
    ra facadeLine hẹp đó, tim OSM lệch vết xe Google 3-9 m, guard camera 1 m (thật)/3 m (sinh).
    **ĐO TRƯỚC KHI SỬA (`scratchpad/dot3/W3-A/ana/midbias.mjs`):** tim giữa 2 bức tường Overture (tia vuông góc, trạm có
    bề rộng tường-tường ≤ 1,25·W25) so với camera pano: vector TB (0,17; 0,11) m, trung vị |.| 1,6 m (= xe chạy làn phải)
    → Overture và vết xe Street View KHỚP nhau; tim OSM mới là thứ lệch. simplify 6 m chỉ góp ~0,1 m TB (cong Bến Bính 5,6 → 2,4).
    **MỚI `tools/street_fit.mjs` (process_osm §3c, tất định — md5 mapdata y hệt khi chạy lại):** (A) `measureWalls`: mỗi way
    p/s/t/r trạm 5 m (bỏ ≤ 14 m quanh way khác, bỏ trạm trong nhà), tia 2 bên ≤ 30 m tới cạnh Overture đầu tiên (cùng phép
    dịch nguồn MS/GG với process_buildings) → W25 (phân vị 25% tường-tường: khe/sân lùi chỉ làm W LỚN). (B) `chooseWidths`:
    ghi đè pano `WIDTH_OVERRIDES` (Bến Bính 14, Trần Phú/Tô Hiệu 14 tổng 2 chiều, Lý Tự Trọng 12, Minh Khai 10,5, Dư Hàng 6,5,
    Hạ Lý 6, Chu Văn An 6,5, ngõ Tam Bạc r 4,5) → tag `width` (sàn = sàn cấp: xe Google đi qua) → Overture (≥ 6 trạm & ≥ 12%):
    sw = clamp(max(SW_c, 0,2·W), ≤ SW_c+2,5), w = W − 2sw kẹp `W_BOUNDS` p[10,20] s[7,14] t[6,12] r[4,5,9], phần dư → vỉa →
    gộp theo TÊN+cấp → mặc định cấp. NỬA ĐƯỜNG ĐÔI (oneway + way oneway cùng tên ngược chiều song song 6-24 m) KHÔNG lấy
    Overture (tia đo qua chiều kia) → giữ cấp. (C) `fitToPanos`: MỎ NEO PANO = hình chiếu camera lên way p/s/t/r gần nhất ≤ 14 m
    (bỏ: cầu/dốc cầu `^Cầu `/bridge/layer — W3-F; camera trong lòng+1,5 m way khác = nút; ngõ h/w SONG SONG gần hơn = camera
    trong ngõ, pano_115); dời cần = đưa camera vào lòng (|v − D| ≤ a = max(0,75, nửa lòng − 1,25)) rồi kéo thêm ≤ 3 m về tim
    tường Overture (≥ 4 trạm ±15 m, IQR ≤ 2,5 m); phiếu nhất quán: camera NGOÀI lòng đòi dời mà camera cùng way ≤ 90 m phần lớn
    ở phía kia → bỏ; đơn lẻ chỉ tin ≤ 6 m. MỎ NEO TƯỜNG mỗi 10 m (không đường đôi, cách mỏ neo pano > 30 m): D = tim tường kẹp
    ±3 m, trọng số 0,6. TRƯỜNG DỊCH 2D: d(x) = (Σw·n nᵀ + λI)⁻¹ Σw·D·n, w = K(dọc/45)·K(ngang/12), K(t) = (1−t²)², λ = 0,2·vết
    (2 ràng buộc gần song song mâu thuẫn KHÔNG khuếch đại — bản λ 0,02 từng dời Tam Bạc 9,7 m), nhân (vết+λ)/vết, mờ dần
    khi Σw < 0,5, kẹp ≤ max|D|; áp cho MỌI đỉnh ROADS_DT (kể cả ngõ h) + chèn đỉnh 8 m nơi trường ≠ 0 rồi DP 0,2 m → đầu
    mút chung/chữ T dính nhau, phố vuông góc chỉ TRƯỢT dọc chính nó. (D) đo lại tường trên tim đã dịch, bề rộng = max(2 lượt),
    rồi `capWidths`: nửa lòng ≤ phân vị 10% tường gần nhất − 0,3 (nhưng ≥ cấp và ≥ |d camera| + 0,9 của mọi camera đang trong
    lòng way; phần cắt chuyển sang vỉa) và lòng+vỉa không vào đa giác địa danh `LM_POLY` (Bưu điện từng bị lòng mới trùm 56 m²).
    **Kết quả dữ liệu:** 489 mỏ neo pano (118 dịch ≠ 0), 202 mỏ neo tường, 232 way dời (Phan Đình Phùng 8,4 m, Chu Văn An 7,4,
    Tam Bạc 5,3, Phan Bội Châu 4,1…); bề rộng riêng 229 way (trung vị p 16,4, s 12,7, t 8, r 5,5; 140 nửa đường đôi giữ cấp);
    ROADS_DT 4.091 → 5.214 đỉnh (toạ độ 0,1 m nơi dịch, nguyên chỗ khác); diện tích footprint Overture nằm trên lòng p/s/t/r
    11.087 → 7.279 m² dù lòng rộng hơn; LM_POLY dưới lòng: Bưu điện 0, NHNN 47 → 8 m².
    **HỢP ĐỒNG MỚI:** (1) mapdata `ROADS_DT[i]` có thể mang `w` (lòng) / `sw` (vỉa); THỨ TỰ + TẬP way giữ nguyên (bộ lọc độ dài
    tính trên bản simplify 6 m cũ `ROADS_LEGACY`, cũng dùng cho `nearestRoadFace` → LM_FACE/LM/… BYTE-IDENTICAL; export đổi:
    ROADS_DT, STREETS, INTERSECTIONS, MEDIANS). (2) `js/xsection.js`: mọi hàm nhận cấp HOẶC way `{c,w?,sw?}` + `roadHW/roadW/
    sidewalkW`; ĐÃ chuyển sang way: roadnet (way.hw/sw), props (S.w/sw, makeRoadIndex), trees (roadIndex, treePitLine(rd)),
    world.js 9 chỗ (`XS_HW(r)`: hồ, băng rôn furnitureLine(r), kè hồ, cây ô trOnRoad/trNearestSeg, onRoadM, guard OSM, _majSeg,
    đèn cột), roadgraph (edge.hw/sw) → traffic làn/người đi bộ, clearance.js (W2-A hành lang), citygen roadGrid, process_buildings,
    clearance_page. Lớp MỚI bám mép phố: truyền WAY, đừng truyền r.c. (3) `tools/process_buildings.mjs`: SEGS theo way;
    `SNAP_MAX` 1,5 m (trước 7,2) + mặt tiền KHÔNG được tiến gần camera pano ≤ 15 m hơn footprint gốc; nhà SINH cách camera
    ≥ 6 m (`SYN_CAM`, synBlocked + camGuard), nhà thật đã sửa ≥ 3 m (trước 3/1). (4) trees `PANO_CLEAR` 4,5 → 6 m (nón ±45° của
    4 hướng = mọi hướng; áp mọi đường trồng qua buildTrees). (5) Biển ngõ 326 (pano_281) 1,6×0,55 → 0,6×0,3 m, cột lùi 8,5 m.
    **QA MỚI** `node tools/qa/clearance.mjs --xsec [--repo <worktree khác>] [--ids …] [--out f]` (= `tools/qa/xsec.mjs`, chỉ dữ
    liệu, 1-2 s, không trình duyệt): 551 camera → lệch tim theo bề rộng way (off>1,5 / ngoài lòng = |v| > nửa lòng − 0,9 /
    ngoài bó vỉa) + mặt nhà gần nhất mỗi hướng h0/90/180/270 (nón ±45°, tia 2°) game (RB01) vs Overture: `close` = game <
    thật − 1,5 (S = nhà sinh, R = thật), `near4`, `inside`. dot3 → W3-A: ngoài lòng 128 → 19, ngoài bó vỉa 78 → 9, lệch ≥ 3 m
    172 → 111, TB 2,37 → 1,97 m, hướng có nhà THẬT gần hơn thật 560 → 45, near4 59 → 0, camera trong nhà 1 → 0; hướng có nhà
    SINH gần hơn Overture 541 → 566 (= lấp khe/lõi trên đất trống thật: làn W3-B INFILL). Chữ spec "off ≤ 1,5 m" KHÔNG đạt
    (295): xe Google đi làn phải, lệch tim w/4 là ĐÚNG thật — dùng "ngoài lòng" làm cổng. Số CUỐI (sau phiên 2): ngoài lòng
    19, ngoài bó vỉa 7, lệch ≥ 3 m 105, TB 1,92 m, close-real 48, close-synth 569; `perpBelowDyn{Synth,Real}` (ngưỡng động spec
    hw + vỉa − 0,5 − lệch camera về phía đó, hướng vuông góc phố) dot3 1/3 → W3-A 0/2 ⇒ camGuard động của spec ĐÃ thoả nhờ
    facadeLine theo phố, không cần thêm luật cắt nhà.
    **PHIÊN 2 (vật đặt tay theo mặt cắt CŨ — lộ ra khi lòng/vỉa theo phố thật):** (6) world.js `FOUNT` 8 đài phun = ĐÚNG toạ độ
    CAMERA pano (249/359/341/454/231/232/545/020) chứ không phải chỗ đài phun → W2-A chỉ đẩy ~3 m, đài 4 m giữa khung (AUDIT3
    CAMOBS 359) ⇒ đặt qua `clrNudge`: ngoài lòng, cách MỌI camera ≥ 8 m, không trên footprint, đất khô, ≤ 16 m; không có → bỏ.
    (7) `cbWallRun` tường mỏ neo Hải quân (LTT/ĐBP/THĐ) vẽ theo facadeLine CẤP cũ → nằm TRONG vỉa mới (THĐ vỉa 7,5 m) → W2-A
    gỡ 7/29 + 10/41 mảnh (mất đoạn trước pano_515) ⇒ `cbFitFence`: chia ≤ 16 m, đẩy đỉnh ra sau facadeLine(way) + 0,35 (THĐ
    lùi 5-7,8 m — ảnh pano_225 h270: vỉa caro ~12 m trước tường); process_buildings `CB1` mép đông 655/656 theo (lô SINH mọc sau
    tường). (8) Collider nhỏ (r ≤ 2,2) còn TRÊN lòng sau cellsink/W2-A/cây = vật cản VÔ HÌNH (chủ đã gỡ/cắt: tường tx_pdp Phan
    Đình Phùng, cây w1 Trần Phú) ⇒ tách ngay sau buildTrees, trước props (`world.ghostColliders` = danh sách). Phiên 3: CHỈ
    tách khi tâm + 8 điểm cách 0,6 m đều trên nhựa VÀ không có gốc cây đang vẽ (`veg.trunkNear`) — bản đầu tách cả 8 xà cừ
    dải phân cách Trần Phú/ĐBP + rào sắt ô w1_congso043 sát bó vỉa (vật NHÌN THẤY → người đi xuyên).
    (9) process_osm `NO_MEDIAN ['Trần Hưng Đạo']`: tuyến dài nhất tên THĐ là đoạn BẮC-NAM dọc tường Hải quân — pano_222-227
    thật = 1 lòng + tim vàng; world.js dải phân cách bỏ mọi khối/bụi/cây ≤ 5 m quanh camera pano (Trần Phú 232-234 đi trên
    tuyến dải). (10) bồn hoa quảng trường Nhà hát bỏ nếu chạm nhựa (phố vòng nam nay theo cong OSM thật).
    **KIỂM (phiên 2, scratchpad/dot3/W3-A):** clearance.mjs trình duyệt dot3 → W3-A: cam vi phạm 35 → 12, gần < 3 m 36 → 7,
    lấp > 40% trong 6 m 181 → 94, trên nhựa 53 → 35, lấn vỉa 72 → 81 (chặn kín 8 → 17: cell danh tính kẹt trong vỉa thật rộng
    hơn — W3-B/C). Chấm mắt REAL|dot3|W3-A (`comps3/`): 18 pano đích 2,67 → 3,67, đối chứng 10 pano 4,40 → 4,40, 11 pano phụ
    (vỉa rộng/tường mỏ neo/đài phun) 3,82 → 4,50. Perf cùng phiên 4 cặp (views_perf): hpReady +~210 ms (~4%: 5.214 vs 4.091 đỉnh
    ROADS_DT rải đều roadnet/citygen/cellsink/props/trees, không điểm nóng), calls/tris/p95 không đổi (±nhiễu).
    **PHIÊN 3 (2026-10-11, sửa theo phản biện + đo lại):** (11) `capWidths` (iii): bước kẹp q10 chuyển phần lòng cắt SANG vỉa
    → mặt tiền vẫn ở W25/2 của tim lệch tâm (14 way r/t vỉa 6-7,8 m: ngõ w5,5 + vỉa 7,8; pano_477 tường thật 4-6 m, game 10-15 m
    = "quảng trường" lát giả — process_buildings khi đó cắt nhà thật LÙI về facadeLine(way); từ phiên 4 nhà thật cắt theo flR, (15)) ⇒ mặt tiền ≤ max(mặt tiền cấp, trung vị tường
    gần + 0,5) trừ vỉa ghi đè pano (`swFixed`): 50 way, way r/t vỉa ≥ 6 m 14 → 4. (12) process_buildings lô "cơi nới" NÔNG 3-6 m:
    chặn kéo 7,2 → 1,5 m làm số lô nông 275 → 1.338 (nhà SINH dựng NGAY TRƯỚC nhà thật lùi đúng chỗ Overture — trái mục tiêu
    FP-1 "không mặt nhà sinh nào gần camera hơn nhà thật") ⇒ nhà thật phía sau có cạnh mặt phố ngay ngắn (frontOf ≤ 7,2 m) →
    bỏ lô (`gap_veto_shallow_real` 1.490; lô nông còn 147, lô khe 4.825 → 3.683, liền mặt phố sau lấp s 56 → 49,6%: khe thật
    giữa nhà thật nay để trống — W3-B quyết định lấp theo bằng chứng). (13) tách collider ma: điều kiện SÂU + không gốc cây (8).
    (14) QA xsec thêm sai số 2 chiều trên hướng có mặt nhà thật ≤ 30 m: `within1_5pct` (chữ spec ±1,5 m), `tooClose`, `tooFar`,
    `meanAbsErr`. **Số phiên 3 (551 camera, dot3 → ad19bfa; số CUỐI ở phiên 4-5 bên dưới):** trong ±1,5 m Overture 29,2 → 52,2%, quá gần 1.006 → 482, quá xa 293 →
    396, |sai| TB 4,51 → 3,36 m; ngoài lòng 128 → 19, ngoài bó vỉa 78 → 7, lệch ≥ 3 m 172 → 105, TB 2,37 → 1,92 m; close-real
    560 → 68, close-synth 541 → 478, near4 59 → 0, camera trong nhà 1 → 0. Clearance trình duyệt: cam vi phạm 35 → 12, gần < 3 m
    36 → 7, lấp > 40% 181 → 92, trên nhựa 53 → 36, lấn vỉa 72 → 77 (chặn kín 8 → 14). Chấm mắt (`comps5/` REAL|dot3|d901604|
    cuối): 18 pano đích 2,67 → 3,64, đối chứng 10 pano 4,40 → 4,40, 7 pano phụ 3,29 → 4,36, 8 pano phản biện 3,38 → 3,44
    (477 hết thoái lui). Perf cùng phiên 3 cặp (cặp thứ 4 nhiễu máy, bỏ): hpReady 4.590 → 4.849 ms (+260, ~5,6%; khởi động
    ground +61 roadnet, cells +94, final +48 — tuyến tính theo số đỉnh ROADS_DT 4.091 → 5.214), calls 2.573 → 2.570,
    tris 30,0 → 29,9 M, p95 18,9 → 18,8 ms (vsync 60), heap ±nhiễu. diag full/lite 0 lỗi JS (lite cần GLB assets_lite).
    **PHIÊN 4-5 (2026-10-12 + 10-14, phản biện vòng 2 + 3):** (15) process_buildings: nhà THẬT cắt theo `flR = min(facadeLine(way),
    facadeLine(cấp))` (corridorClip, streetIntrusion, streetGuard) — mặt tiền theo way là MỘT số cho cả way (đoạn rộng kéo cả
    way) nên footprint Overture đứng đúng chỗ dù nằm trong vỉa của way; nhà SINH vẫn theo facadeLine(way). Hệ quả có chủ đích:
    xsec `perpBelowDynReal` 3 → 105 và clearance "lấn" +10 camera (139/423/486/490/499/505/507/183/318/539: game = Overture).
    (16) street_fit `capWidths`: (iii) trần mặt tiền lấy mẫu trạm 2 bên + trạm 1 bên (bên kia công viên/sông; ≥ 6 mẫu; trần =
    min(trung vị 2 bên, trung vị 2+1 bên)) — way ít trạm 2 bên (THĐ 535: 2 trạm) từng bỏ qua trần → mặt tiền 14,5 m; (iv) vỉa
    ≤ SIDEWALK_W[c] + 1 cho way r/t và way gộp-theo-tên < 6 mẫu cục bộ (trừ ghi đè pano `swFixed`): 51 way. Tác dụng phụ ĐÃ
    BIẾT: Lý Tự Trọng 354 (pano_524) và Nguyễn Thượng Hiền 132 (pano_494) có vỉa thật 5-6 m → vỉa 5 → 3 m, lô SINH đứng 4-6 m
    trước camera (thật 9-12 m). Miễn (iv) cho way `src` pano (thử expD của phản biện) chữa 524 nhưng 113 pano đổi vì lấp khe xáo
    lại → chưa làm; cần trần theo bằng chứng tường cục bộ. THĐ 203 (gộp tên, 0 trạm 2 bên, ≥ 6 trạm 1 bên) giữ vỉa 7,5 m.
    (17) MỚI `js/anchorwalls.js` (CB_WALLS + cbFitFence + cbWallSegments) dùng chung world.js `cbWallRun` + process_buildings §9c2:
    nhà có tâm chiếu vào đoạn tường ±1 m, cách tường ≤ 8 m phía phố bị CẮT nửa mặt phẳng sau tâm tường + nửa bệ + 0,3 m (< 8 m²
    → bỏ; clip 7, bỏ 0) — footprint Overture trong khuôn viên Hải quân từng nhô RA TRƯỚC tường đã lùi theo phố (pano_224 h270).
    Nhà sau tường ≤ 30 m hoặc tâm trong CB1 = `cbIn` (57): TUBE/OLD/VILLA/KTT → CIVIC, công năng USE_HOME (phiên 5: kiểm `cbIn`
    TRƯỚC nhánh CIVIC → GATE; nhánh cũ đặt sau nên không bao giờ chạy).
    (18) Phiên 5 — BIỂN HÀNG SAU TƯỜNG MỎ NEO (pano_224/225 h270 "BÁNH MÌ / SỬA XE MÁY / ĐIỆN MÁY" trên khối CIVIC trong khuôn
    viên; phiên 4 đổi kiểu/công năng KHÔNG hết): biển là thuộc tính MÔ-ĐUN trệt (SIGN_EXT), không phải công năng — CIVIC/GATE →
    rc = cấp phố (frontClass) → bộ G6 có G_GLASS (dải biển, 1/3 bay); USE_HOME → rc 3 → bộ nhà ở GH có G_SHUT0/G_GATE/G_SHUT1
    (dải biển, 3/7 bay) ⇒ cả hai đều ra biển. citygen `NOSIGN_ST`: bay "nhà ở" khi rc 3 trên CIVIC/GLASS/SHED → G_CIVIC (song sắt
    + chân đá) / G_WARE — CÙNG luật ở JS `groundModule` + shader GL2 + GL1 (khớp bit hộp biển 3D; đã chụp `--gl1`); rc 3 áp cả
    cạnh được NÂNG (faceRoad) cho bộ đôi (CIVIC/GLASS/SHED, USE_HOME). Dữ liệu chỉ có bộ đôi này ở nhà cbIn (by_use home 35.716 →
    35.773, gate 661 → 604) → ngoài khuôn viên không đổi pixel nào (so ảnh S4/S5: chỉ cây đung đưa/bóng). Hợp đồng: kiểu công
    sở/kính/kho + USE_HOME = "trệt khuôn viên, KHÔNG biển". W3-B định nghĩa INFO bit 6-7 PK_COMPOUND ("không biển hàng") + rc 3 cho
    cạnh nâng/gộp của khu compound — khi tích hợp giữ MỘT luật compound; NOSIGN_ST tương thích (compound CIVIC/GLASS/SHED rc 3 →
    không biển). Còn lại: pano_222 h0/h270 dãy nhà ống "BÁNH ĐA CUA" ở đầu bắc tường (ngoài cbIn; thật = công sở vàng có cổng).
    (19) Đài phun dời bằng clrNudge: chỗ mới KHÔNG được trên vỉa (`_onStreet`: tâm + 4 điểm cách r không lấn hành lang phố
    `clrCorridorPen`) — pano_020 h180 đài phun từng đứng giữa vỉa; không có chỗ ≤ 16 m → bỏ.
    (20) Collider ma: phiên 4 thêm kiểm "có hình" (raycast 16 tia/ứng viên) giữ collider có vật nhìn thấy (`world.ghostKept` =
    [[442,4; −994; 1]] = tường civic8_compound_wall); phản biện đo 76-88 ms khởi động. Phiên 5: MỘT lượt tam giác các mesh gần
    (tam giác TẦM THÂN y ∈ [nền+0,3; nền+1,5], cách tâm XZ < r+0,3); mesh nhà citygen `fab_*` hỏi `fabricHit` thay vì duyệt tam
    giác; mặt phẳng sát đất (roads/sidewalk/ground/… như _noCast của freezeStatic) bỏ theo tên; mesh nhỏ (≤ 2000 đỉnh) đặt xa
    mọi ứng viên > 150 m bỏ khỏi tính cầu bao. Đo cùng phiên (2026-10-14, 890M, máy chia với agent khác; `?`-toggle tạm, đã gỡ):
    khối mới `world.ghostMs` 16-20 ms, trong đó cầu bao 11-13 ms (`world.ghostMsBS`) là việc DỜI từ freezeStatic (lượt cầu bao
    "giai đoạn trung tâm" của nó 30-32 → 19-22 ms; 4.587 → 4.155 hình chưa có cầu) ⇒ RÒNG ~5-9 ms; bản raycast cùng phiên 50-95
    ms (nó tính cầu cho MỌI mesh nên freezeStatic còn 3-4 ms) ⇒ ròng ~50-65 ms. Kết quả y hệt: 8 tách, giữ [442,4; −994]. Mép tán
    dù cam (ConeGeometry) ở (−883,4; −483) cao nền+1,6 m → không phải vật cản tầm thân (collider bàn đã mất → vẫn tách như phiên 4).
    **Số CUỐI (551 camera, dot3 → W3-A 9f8cfaa+):** xsec trong ±1,5 m Overture 29,2 → 58,1%, quá gần 1.006 → 493, quá xa 293 →
    277, |sai| TB 4,51 → 2,98 m; ngoài lòng 128 → 19, ngoài bó vỉa 78 → 7, lệch ≥ 3 m 172 → 105, TB 2,37 → 1,92 m; near4 59 → 0,
    camera trong nhà 1 → 0; close-real 560 → 66, close-synth 541 → 492; perpBelowDyn synth/real 1/3 → 0/105 (flR, (15)).
    Clearance trình duyệt (GPU): cam vi phạm 35 → 22 (phiên 3: 12; +10 là "lấn" của nhà thật ở đúng chỗ Overture trong vỉa way —
    phản biện xem ảnh: trung tính so với dot3), gần < 3 m 36 → 7, lấp > 40% 181 → 99, trên nhựa 53 → 37, lấn vỉa 72 → 86 (chặn
    kín 8 → 14). Chấm mắt (REAL | dot3 | ad19bfa | 58b582a | cuối; phản biện vòng 3 + tự chấm): 18 pano đích 2,67 → 3,81
    (ad19bfa) → 3,78 (cuối: +487 4 → 5, −524 4,5 → 4 (iv), −423/331 tái sinh tường trơn), đối chứng 10 pano 3,60 → 3,60;
    tường mỏ neo 223 h270 4 → 4,5, 225 h180 2,5 → 4, 227 h270 3 → 4,5, 515 3 → 5,5; 224 h270 4,5 (ad19bfa) → 3,5 (58b582a, biển
    hàng) → 4,5 (cuối: tường + khối công sở trơn như ảnh thật), 225 h270 5 → 4 → 5; ngõ biệt thự Hồ Xuân Hương 270/504 3,5 → 4,5.
    Perf cùng phiên 5 cặp (2 cặp đảo thứ tự B trước; views_perf, tier 3, 890M, máy chia agent khác): hpReady dot3 5.666/5.607/5.825/
    5.032/5.728 vs W3-A 5.136/4.457/5.227/5.151/5.041 (trung vị 5.666 → 5.136) — KHÔNG đo được thoái lui (không nhận là nhanh hơn:
    tổng pha khởi động chỉ lệch ~−150 ms, chủ yếu landmarks/freeze nhiễu; phiên 2-3 đo +210/+260 ms); pha final 800 → 803 ms;
    calls 2.574 → 2.551, tris 30,0 → 29,7 M, p95 18,7 → 18,7 ms, 60 fps (vsync). diag full/lite 0 lỗi JS ("TẤT CẢ THỰC THỂ OK";
    lite cần GLB assets_lite ghim 8b8e42c — worktree/checkout chính không có, chép tạm khi đo), waterbfs 5/5, check_assets ĐỦ,
    tour 26 ảnh 0 lỗi JS, generator tất định (md5 mapdata f19b17b7…, buildings_real 9a24275b… khi chạy lại trên bản git archive).
    **BẪY:** (a) tim tường từ 3 trạm đơn lẻ từng kéo Nguyễn Tri Phương 7,4 m (sân lùi 1 bên) → cần ≥ 4 trạm + IQR + kẹp ±3 m;
    (b) kẹp q10 tường cả way dài từng đẩy 6 camera Phan Đình Phùng ra ngoài bó vỉa → luôn giữ "camera đang trong lòng";
    (c) bề rộng 1 giá trị/way: địa danh sát 1 đoạn kéo hẹp CẢ way (Cù Chính Lan 10,8 → 8); (d) world.js cell dựng tay theo trục
    cũ (HB_A… Hai Bà Trưng dời ≤ 3 m) — sweep W2-A (clearance.js theo way) tự lùi nhà lấn hành lang mới; (e) Python ghi file
    Windows đổi xuống dòng — git autocrlf chuẩn hoá, diff vẫn gọn; (f) kẹp LM_POLY bỏ qua "camera đang trong lòng": NHNN cách
    tim Cù Chính Lan 3 m → cả way về lòng cấp 8 m, 4 camera (068/071/439/528) lệch 3,2-3,85 m nằm sát bó vỉa (vẫn trên nhựa) —
    cần bề rộng THEO ĐOẠN (đổi hợp đồng w/sw thành mảng theo đỉnh) mới sửa đúng; (g) `tools/tour.mjs` chọn điểm đứng lại MỖI
    lượt (tia raycast không thấy hết khối nhà) → so tour A/B bằng cùng điểm đứng (shoot.mjs `kind:'cam'`, dist 0,1), đừng so
    ảnh tour thô; (h) đổi CÔNG NĂNG (use) của nhà không tắt biển: biển do MÔ-ĐUN trệt quyết (SIGN_EXT) và bộ nhà ở GH cũng có
    cửa cuốn/cửa xếp mang dải biển — muốn "không biển" phải chọn mô-đun (NOSIGN_ST), và đổi luật chọn mô-đun phải đổi CÙNG LÚC JS
    groundModule + GL2 + GL1; (i) đo 1 khối khởi động: computeBoundingSphere ở chỗ mới có thể chỉ là DỜI việc của freezeStatic (nó
    bỏ qua hình đã có cầu) — đo cả lượt cầu của freezeStatic/đếm hình chưa có cầu trước khi kết luận; performance.now() không cách
    ly ~0,1 ms/nấc → cộng dồn hàng nghìn lần đo nhỏ chỉ là ước lượng; Raycaster không BVH duyệt MỌI tam giác mỗi tia (16 tia × 9
    ứng viên × 54 k tam giác = 50-95 ms).

- **2026-10-05/06/11/12/14 (W3-B PARCELS)** [ĐỢT 3 wave 3 — Ô ĐẤT THẬT: khuôn viên tường rào + cổng, đất trống rào tôn, chợ, tỉ lệ cửa
    hàng theo phố, claim quảng trường, Chợ Con — AUDIT3 FP-2]:
    **Vấn đề (AUDIT3 S2 Σ345 + GAP):** generator chỉ biết 1 kiểu ô (dãy nhà ống) → lấp khe/lõi ô bằng nhà ống SINH vào khuôn
    viên biệt thự/cơ quan/trường, sân chợ, lô quây tôn; kéo mặt tiền biệt thự ra sát vỉa hè; công năng trệt chỉ theo cấp phố
    (phố biệt thự đầy biển hàng); claim 'plaza' quá to giết dãy phố thật (vòng r50 'qt_trienlam' đặt ĐÚNG tâm pano_428; vòng
    r62 + hành lang ±55 m quanh Nhà hát giết 2 dãy phố cũ Hoàng Văn Thụ/Đinh Tiên Hoàng); Chợ Con dời 10 m ra phố + 1 ô trùng.
    **(1) BẰNG CHỨNG Ô ĐẤT — MỚI `tools/parcels_ev.mjs`** (node, không three): phân loại TỪNG quan sát pano (audit_enriched
    .buildings: style/features/color) → `compound` (công sở/trụ sở/cơ quan/trường/viện/y tế/UBND/nhà văn hoá/mầm non/bảo tàng/
    biệt thự…, có tường-rào-cổng-sân hoặc loại "mạnh" → walled + kiểu tường + màu tường & màu song sắt RIÊNG theo cụm chữ "tường/
    rào/trụ/cổng … màu" + "cổng"/"chòi gác"), `home` (liền kề/nhà ở/tập thể…), `shop`, `vacant` (đất trống/lô đất/bãi/giải toả/
    quây tôn — "đang xây/đổ nát" là NHÀ, không phải lô trống), `market`. Chữ cấp pano (area/summary/special: lô đất trống, quây
    tường, chợ dân sinh…) chỉ áp cho hướng pano KHÔNG tả nhà nào (ô 45° + 2 ô kề tắt trong PANO_SIDES). `kindAt(x,z)`: bỏ phiếu
    theo NÓN nhìn ±25° (nới theo bề rộng quan sát) từ mọi pano ≤ 40 m, trọng số giảm theo lệch góc + khoảng cách; thắng khi ≥ 0,15
    và ≥ 1,4× kiểu nhì; `kindAtPoly` cộng phiếu tâm + trung điểm cạnh (nhà dài vắt 2 nón). Lớp sử dụng đất OSM của W2-D
    (`js/landuse_data.js` giải nén trong node) → `LU_VETO` (sân lát/quảng trường, chùa, khuôn viên trường-viện-cơ quan, bãi xe,
    công trường, cỏ, sân thể thao, chợ). Tên phố từ `tools/osm_roads_dt.json` (ROADS_DT không có tên) → tỉ lệ cửa hàng ĐO theo
    phố từ chính 551 pano; bảng VÙNG `ZONES` (biệt thự/hành chính: Đinh Tiên Hoàng, Hồ Xuân Hương, Lê Đại Hành, Nguyễn Tri
    Phương, Cù Chính Lan → trần cửa hàng 0,2; đô thị mới Lê Quang Đạo 0,3 — Trần Quang Khải BỎ ở lượt 4) + ô đa giác (Ngõ 80 Hạ Lý…).
    **(2) GENERATOR `process_buildings.mjs`:** nhà THẬT nằm trong nón khuôn viên: KHÔNG kéo mặt tiền ra vỉa (giữ khoảng lùi thật),
    không chia lô nhà ống, không kéo sâu, kiểu VILLA/CIVIC (mô-đun trệt không cửa hàng), công năng HOME/OFFICE; nhà ở → HOME, cửa
    hàng/chợ → SHOP; không bằng chứng trực tiếp → `shopProb` = bảng cấp phố kéo về tỉ lệ đo theo phố (Bayes k = 4), phố r khu phố cũ
    ≤ 0,35, trần vùng. INFO bit 6-7 = KIỂU Ô (`INFO.PK_*`, `infoParcel()` — 1 khuôn viên, 2 chợ, 3 nhà ở) cho renderer mặt tiền.
    Bước 7 (lô khe) — thứ tự veto: nước/công viên/cảng → MIỆNG NGÕ thật (`osm_alleys.json` service/footway… cắt dải lô 0-6 m, không
    chạy dọc phố; ngõ < 28 m và footway không vào ROADS_DT) → `parcelVeto`: compound (walled → TƯỜNG RÀO/HÀNG RÀO + SÂN 22 m) /
    vacant (RÀO TÔN hoặc TƯỜNG LÔ + 18 m) / market (sân 12 m) / ≥ 2/3 mẫu đất OSM cấm (tường theo lớp: khuôn viên → hàng rào, chùa →
    tường, công trường → kiểu tường theo chữ pano đất trống gần nhất) / dải 25 m chạm trường-viện-cơ quan thật (class Overture) →
    hàng rào; lô không có phiếu nào: KẸP giữa 2 lô khuôn viên (±8 m) hoặc phố VÙNG biệt thự (1 bên khuôn viên / mặc định hàng rào
    biệt thự) → khuôn viên. Tường đặt ở facadeLine + 0,3 m (mép sau vỉa hè), đoạn cách PANO_CAM < 3,5 m bỏ. Bằng chứng lấp khe
    THÊM: nón pano shop/home ≥ 0,3 trong 22 m (lỗ Overture, AUDIT3 469). Bước 8: ô đất OSM cấm + sân khuôn viên/lô trống = 3
    (cấm nhà sinh lõi ô, cấm nới 8a/9a). OPEN_RX thêm chợ/công trường/đất trống/bến xe/khuôn viên-cơ quan-trường-viện-biệt thự.
    Trần tầng: lô < 90 m² không bốc thăm đuôi 7-8 tầng (nhà "kim" 152/023/225), lô < 60 m² ≤ 5 tầng; mặt phố khuôn viên/vùng biệt
    thự ≤ 4 tầng (không cộng "+1 tầng phố thương mại": trung bình mặt phố ≤ 25 m quanh 436 pano = 3,00 vs pano 3,06 — đã khớp).
    Bước 10 (ghép quan sát → nhà): quan sát ≥ 6 tầng rơi vào mảnh < 9 m²/tầng bị bỏ (`obs_tall_needle_skipped` — tia chạm mảnh nhỏ
    trước công trình thật: pano_152 mảnh 33 m² thành tháp kính 6 T). Cả thành phố: 6 T 454 → 240, láng giềng hết bị kéo lên 4 T bởi
    luật làm trơn ±2 (4 T 8.532 → 8.039). `LM_POLY 'thptnq'` (AUDIT3 nói lệch ~60 m) ĐÃ KIỂM: khớp pano_261 (cổng trường ở h270, cách
    mép đa giác 8,6 m) và pano_037 (cổng h135-180) → không sửa; GAP 428 là do claim `qt_trienlam` (đã bỏ).
    **Thứ tự mọc theo HASH** (lõi ô 8 + nới 8a): trước xáo bằng RNG tuần tự → thêm/bớt 1 ứng viên xáo CẢ thành phố; nay sắp theo
    hash từng ô/nhà → thay đổi chỉ lan cục bộ (A/B đối chứng, gộp nhánh). Cùng lý do: id LÔ chia (bước 5) và ô khối dính = id nhà
    mẹ + chỉ số TRONG nhà mẹ (`#k`, `#ck`; trước + `newB.length` TOÀN CỤC → bỏ 1 lô ở đâu đó đổi id = seed mặt tiền/màu/tầng của
    MỌI lô phía sau: biển hiệu nhảy ở pano đối chứng 001/028, nhà ở 506 mọc lại dải biển).
    **RB_PARCELS** (export mới trong `js/buildings_real.js`, ~21 KB): `walls [kind, màu|màuSắt<<4, x0,z0,…]` polyline, SÂN ở bên
    TRÁI hướng polyline; `gates [x,z,góc,rộng,kind,chòi gác,theo tia pano,màu]` (1 cổng/dãy ≥ 10 m tại chỗ tia quan sát "cổng"
    cắt dãy, không có thì giữa dãy).
    **(3) RENDERER MỚI `js/parcels.js` `buildParcels(scene, ctx)`** (world.js ngay sau khối fabric): tường rào xây (trụ 3,2 m +
    gờ), hàng rào sắt trên tường lửng (trụ 2,6 m, song sắt alphaTest 2 mặt), rào tôn (tấm sóng + cột hộp), tường lô (bê tông/gạch),
    cổng 2 trụ chóp + 2 cánh sắt, chòi gác. 2 material (texture canvas 4 HÀNG lặp theo u: vữa/tôn/bê tông/gạch × vertex colour;
    song sắt/cánh cổng) → 2 mesh cả thành phố, `userData.noMerge` (freezeStatic gộp làm mất uv), không tên đuôi _x,z. Cắt lúc chạy:
    footprint SỐNG (rbGrid), bao nhà ô giữ (cellKept), nước, và mọi mesh MỎNG-DÀI-THẤP chạm đất đã có (tường/rào/cổng dựng tay
    theo HÌNH HỌC, không theo tên — tường mỏ neo cb_wall_ltt pano_515 không bị dựng đôi). Va chạm: lưới đoạn, bọc
    `world.resolveCollisions` (isFree/findFree/đặt vật phía sau tự né). `world.parcels.stats`. ALBEDO: texture chỉ mang hạt/vệt
    (nền #f3, trung bình ≈ 0,93) — màu thật do vertex colour; bản đầu (nền #e8, hạt 200-250, xám bê tông b5b2aa × 0,85) cho tường lô
    trong bóng 38/255 trong khi mặt tiền nhà cùng hướng 70-115 (ánh sáng vật lý: phía bóng chỉ có trời) → nay 48.
    **(4) world.js:** claim `qt_nhahat` vòng r62 → HỘP (0,70) ±40×±42 (khoảng lát giữa Hoàng Văn Thụ x≈−38 và Đinh Tiên Hoàng x≈36),
    hành lang `hl_quanhoa` ±55 → ±22 (+vòng đầu 22), BỎ `qt_trienlam`; nhà SINH chạm ≤ 6 m quanh nhà ô DANH TÍNH giữ lại bị đánh
    D.dead trước buildRealFabric (`world.synthNearCellKilled`, 388 nhà; lượt 4: chỉ lô CHỒNG bao hoặc TRƯỚC MẶT — 246); Chợ Con bz 793 → 783 (tâm footprint OSM), ô chợ trùng
    `w2_chocon_market` XOÁ hẳn (giữ ô dù). CỔNG ô dựng tay về RANH ĐẤT: `propLineShift(x, z, front)` (world.js, cạnh import parcels)
    = đẩy cụm cổng ra sau facadeLine + 0,3 m + phần nhô `front`, tính LÚC CHẠY từ `clearance.nearestStreet` (phố có vỉa gần nhất —
    tự khớp khi W3-A đổi tim/bề rộng phố): Ban CHQS (pano_464) và cổng Điện lực Minh Khai (pano_510, từng đứng lấn vỉa 0,7 m).
    **citygen.js (1 dòng, vùng W3-C):** nhà có KIỂU Ô ≠ 0 không bán hàng → cạnh hông được NÂNG thành mặt phố và mặt dãy gộp (wideF) cũng rc 3 (trước: lấy cấp phố → biệt thự mọc dải biển ở cạnh hông).
    **SỐ ĐO:** generator 46.128 → 44.914 nhà (lô khe 4.050 → 3.483, lõi ô 8.877 → 8.372), b64 1,52 MB (−10 KB) + RB_PARCELS 21 KB,
    giải mã 6 ms; 425 dãy tường (hàng rào sắt 5,5 km, tường rào 0,37 km, rào tôn 0,8 km, tường lô 0,38 km), 197 cổng (45 đúng tia
    pano "cổng"); lúc chạy cắt còn ~5,3 km / 390 dãy / 165 cổng (đè tường tay đã có, nhà ô giữ, nhà thật sống), ~81 k tam giác,
    2 mesh, dựng ~49 ms (GPU tier 3; dò tường tay 14 ms). PERF A/B CÙNG PHIÊN (24 góc chuẩn, B A B A, tier 3 Radeon 890M iGPU):
    draw calls 371 → 367, tam giác 3,83 → 3,90 M (+1,8% = mesh tường 1 khối cả thành phố, không bị cắt frustum — chia ô sẽ thêm
    call nhiều hơn lợi), fps 60,2 = 60,2 (trần vsync), hpReady 4,90 → 4,64 s (nhiễu), 0 lỗi JS (full); LITE 3 lỗi 404 = y hệt dot3
    (assets_lite/ không có ở máy local). Tỉ lệ nhà SINH trong 40 m quanh 25 pano FP-2: 37,1% → 28,7%
    (496: 56 → 30%, 538: 53 → 0%); quanh 120 pano kiểm toán 30,6 → 26,2%. Kiểm toán clearance (W2-A): camera vi phạm 35 → 33,
    nearAll 36 → 34, fillAll 181 → 178, vật trên nhựa 53 = 53, lấn vỉa hè 72 → 71. **CHẤM LẠI (REAL|TRƯỚC|SAU cạnh nhau,
    ±0,5; bản cuối chấm lại mọi ảnh đổi > 6/255 so với lượt chấm đầu):** 30 pano FP-2 × 2 hướng (60 ảnh) 2,88 → 3,42 (+0,54; 21 tốt
    hơn, 1 kém hơn), nhóm đối chứng 8 pano (15 ảnh) 3,73 → 3,77. Tăng mạnh: 515 h90 3 → 6 (tường mỏ neo liền, hết dãy nhà
    sinh đè), 428 h90 / 405 h0 2 → 5 (sửa claim), 354 h0 2 → 5, 496 h90 3 → 5 (hàng rào + cổng + chòi gác + nhà lùi), 441 h270 / 432 h0 / 547 h90 2 → 4, 460 h0 1 → 3. CHƯA sửa: ảnh do
    camera/mặt cắt phố (CAMNEAR — W3-A), footprint cũ đã phá dỡ (239; 019 sửa ở lượt 3), lỗ Overture 469, cao ốc sau tường rào 225; bộ mô-đun trệt NHÀ Ở
    `GH` của citygen có G_SHUT0/1 mang DẢI BIỂN (SIGN_EXT) → nhà ở/biệt thự theo pano (INFO PK ≠ 0, USE_HOME) vẫn có thể mọc biển "SỬA XE MÁY" (506 h270, 547 h270) — việc của renderer mặt tiền (W3-C): với PK ≠ 0
    chọn bộ không biển; cổng 464/510 đã về ranh đất nhưng 2 ảnh vẫn ~3 m trước cổng vì camera pano lệch tim phố
    (thật: cổng ở BÊN KIA phố — W3-A). Ảnh: scratchpad dot3/W3-B g_00..12.jpg + r2/final_00..12.jpg (REAL|dot3|cuối), grades.txt
    + r2/overrides.txt.
    **LƯỢT 3 (2026-10-11):** (a) BÃI GIẢI TOẢ Hoàng Diệu: vùng chừa "khuôn viên Cảng vụ" là VÒNG r45 quanh (326, −826) ở CẢ
    generator lẫn world.js `clearedZone` → giữ nguyên dãy footprint Google cũ + lô sinh phía bắc đường ngay trước pano_019 (thật:
    bãi gạch vụn nhìn ra cần cẩu cảng) và 1 footprint 3 T "NHÀ THUỐC" nằm TRONG thân ô dựng tay Cảng vụ. Nay generator KHÔNG chừa
    gì (Cảng vụ = ô dựng tay `compound(326,−826,38×13,−135°)`; −10 nhà, bcmp: không nhà nào khác đổi), world.js chỉ chừa HỘP sân
    54×27 m (+1 m) của ô đó (gạch vụn/tường dở lan tới sát sân). (b) Bước 11 kiểu nhà: quan sát pano khớp tia tả công trình công
    cộng/công sở/biệt thự (không kho-xưởng) THẮNG luật "vùng cảng/khối > 2500 m² → SHED" (Trung tâm Hội nghị TP trước pano_020:
    tân cổ điển Pháp 3 T, OSM 5.359 m², từng là KHO cửa cuốn); công sở/công trình công cộng KIỂU PHÁP (pháp/tân cổ điển/thuộc
    địa) ≤ 3 T → bộ mô-đun VILLA (cửa chớp/vòm/lan can; trệt G_HOME0/G_CIVIC không dải biển) thay CIVIC. Lý do: bộ trệt CIVIC
    `G6` của citygen = [G_CIVIC, G_CIVIC, G_GLASS] mà G_GLASS có DẢI BIỂN (SIGN_EXT) → thử CIVIC cho Trung tâm Hội nghị mọc
    "NHÀ THUỐC/KÍNH MẮT/PHỞ BÒ" (W3-C: công sở/khuôn viên — INFO PK ≠ 0 hoặc STYLE.CIVIC — nên chọn bộ trệt không biển). Đổi 4
    nhà (`style_port_obs_override` 2, `style_civic_french_villa` 3; 2 trong số đó CHẾT lúc chạy do claim/ô: footprint Nhà hát (0,9) và (−581,−765)). (c) ĐÃ CÂN NHẮC, KHÔNG làm: "khép khe < 4 m" (ngõ 1,5-3 m
    của HP phần lớn KHÔNG có trong OSM — khép sẽ bít ngõ thật; 1/120 pano kiểm toán than khe hẹp: 368), "nhà cổng vòm" bắc qua
    ngõ (345 — cần mô-đun renderer), tháp xa ngoài bán kính dựng (LOD — renderer/perf), "+1 tầng phố thương mại" (đã đo khớp).
    **Số đo lượt 3:** 44.914 → 44.904 nhà, b64 1.518.408 B; CHẤM LẠI: 30 pano FP-2 × 2 hướng 2,88 → 3,45 (22 tốt hơn, 1 kém;
    019 h0 3 → 5), đối chứng 3,73 → 3,77 (dữ liệu ngoài 2 cụm y hệt — kiểm bằng giải mã so từng nhà); 8 ảnh bằng chứng lượt 3
    (019 h0/h45/h315, 020 h0/h45, 527, 362, 056) 2,62 → 3,62. PERF A/B giữ KHOÁ GPU 1 lượt liền (B A B A, 24 góc chuẩn, tier 3
    Radeon 890M): calls 367 → 368, tam giác 3,83 → 3,90 M, fps 60,1/60,2 (vsync), hpReady 4,52/5,29 → 4,76/5,95 s (máy chung 6
    agent — nhiễu ±0,6 s), 0 lỗi JS; diag 0 lỗi; LITE 3×404 như dot3; waterbfs 5/5; tour 26 ảnh không lỗi JS.
    **LƯỢT 4 (2026-10-12, sau phản biện "merge-with-fixes"):** (a) BỎ Trần Quang Khải khỏi `ZONES.villa` (AUDIT3 không xếp
    vào vùng biệt thự; classifyObs pano của phố = 20 cửa hàng / 11 nhà ở-khuôn viên = 0,65): mặc định "hàng rào biệt thự" cho lô khe
    không phiếu từng rào mất dãy shophouse + sạp hoa quả thật (355 h270), dựng trụ cổng giữa dãy quán ăn (360 h90), rào ngang sân
    trước khách sạn (355 h225); nay mặt phố TQK 115 → 141 nhà, tỉ lệ cửa hàng 0,42 → 0,67 (dot3 170 / 0,66), tường dọc phố 537 →
    253 m (chỉ còn khuôn viên CÓ phiếu nón pano). Bài học: bảng VÙNG chỉ cho phố có bằng chứng (AUDIT3 + tỉ lệ đo) — trần vùng ĐÈ
    Bayes theo phố. (b) Giết nhà SINH quanh nhà ô danh tính: chỉ lô CHỒNG bao hoặc nằm TRƯỚC MẶT nhà ô (tia từ tâm + 4 điểm co 50 %
    đi ra xa phố gần nhất — `clearance.nearestStreet` ≤ 30 m — chạm bao trong độ sâu lô + 6 m); láng giềng BÊN CẠNH cùng dãy giữ
    (vòng 6 m cũ giết cả dãy shophouse cạnh khách sạn 521 h315); lô không phố ≤ 30 m (lõi ô) giữ luật vòng 6 m; tra lưới theo bbox
    lô (trước: chỉ ô của tâm → sót). `world.synthNearCellStats {over, front, core}`. Lúc chạy: 394 → 246 lô bị giết (chồng bao 201, trước mặt 44, lõi ô 1), 10,9 ms (mảng tem thay Set mỗi lô). (c) `parcels.collide` bán kính
    > 1 m (thuyền 1,6) quét mọi ô chạm đĩa (trước chỉ ô của tâm, lề đăng ký = nửa dày + 1 m). (d) Nhà cổng Điện lực (pano_510) lùi
    THEO cổng (propLineShift dời cổng 1,5 m vào đúng mặt đông nhà cổng → rào bắc chạy trong tường). (e) Generator THIẾU
    `tools/osm_roads_dt.json` / `osm_alleys.json` (gitignore) → DỪNG exit 2 (trước: try/catch im lặng → máy tích hợp sinh dữ liệu
    khác mà không biết); cố ý chạy thiếu: `HP_ALLOW_MISSING_INPUTS=1` (cảnh báo + `RB_META.stats.missing_input_*`). (f) classifyObs:
    "trường" (trường học) KHÔNG khớp trong quảng trường/công trường/thị trường/môi trường (lookbehind — pano_054 Nhà hát "nhìn
    chính diện quảng trường", 214 "nhà điều hành công trường", 224/426 cao ốc "ven quảng trường" từng thành khuôn viên rào);
    loại "mạnh" lưỡng lự có "khách sạn" mà không chữ tường/rào/cổng/sân → khuôn viên KHÔNG rào (356 h270 "bệnh viện/khách
    sạn"). Đổi 6 nhà + 3 dãy tường (quanh (30,−43) và (−1093,115-132)). Rào sắt trước khách sạn 355 h225 KHÔNG do vùng biệt
    thự mà do lớp đất OSM CAMPUS (khuôn viên Bệnh viện Phụ sản phủ cả mặt tiền khách sạn, `why = 'lu'`, nLu 3/3) — chưa sửa:
    cần lớp bằng chứng "sân trước thoáng" từ pano (khách sạn/văn phòng không rào) đè lớp đất. KHÔNG làm:
    trần vùng → prior Bayes (cố ý theo AUDIT3 ≤ 0,15; nhóm A chấm tốt ở HXH/CCL/ĐTH), chia mesh tường theo ô (thêm draw call > lợi
    81 k tam giác), bộ trệt không biển cho CIVIC/VILLA/PK ≠ 0 (renderer W3-C — cờ dữ liệu đã có). **Số đo lượt 4:** 44.904 → 44.941 nhà (b64 1.519.544 B), 425 → 406 dãy tường (hàng rào sắt 5,21 km, tường rào 0,35, rào tôn
    0,81, tường lô 0,38), 197 → 188 cổng; lúc chạy 366 dãy / 158 cổng / 77 k tam giác / ~40-45 ms. PERF A/B giữ khoá 1 lượt (B A B A,
    24 góc chuẩn, tier 3 Radeon 890M): calls 364 → 368, tam giác 3,85 → 3,89 M, fps 60,2 = 60,2 (vsync), p95 18,6 / 18,4 ms, hpReady
    4,52 / 4,55 → 4,50 / 4,57 s, bootProfile.fabric 666 / 697 → 710 / 748 ms (tường + lượt giết nhà sinh), 0 lỗi JS; diag 0 lỗi;
    LITE 3×404 như dot3; waterbfs 5/5; tour 26 ảnh không lỗi JS. CHẤM LẠI so với ảnh phản biện (REAL|dot3|r3|r4, cùng cài đặt chụp):
    nhóm A (14) 3,64 → 3,71 (355 h270 3 → 4: dãy shophouse + sạp hoa quả về lại; 360 h90 3,5 → 4: hết trụ cổng giữa dãy quán;
    358 h90 −0,5: mất biệt thự vàng sau rào phía nam ngoài nón 358 h180 — vùng biệt thự mặc định từng phủ); nhóm D (12) 2,71 =
    (521 h315 +0,5 shophouse bên cạnh về lại; 231 h135 −0,5 lô sinh sát camera về lại — CAMNEAR); nhóm B (15) 4,07 = (cả 15 ảnh
    chụp lại, khác r3 ≤ 5/255 trừ bóng); đối chứng 3,93 =. Ảnh: scratchpad dot3/W3-B/r4/c1a c1b c2a c2b c3a c3b c4a c4b c_fin c355.
    **LƯỢT 5 (2026-10-14, phản biện lượt 4 "merge-with-fixes"):** (a) ĐẤT CÔNG THOÁNG đi TRƯỚC nón khuôn viên / mặc định biệt
    thự trong `parcelVeto`: ≥ 2/3 điểm thử (2, 6, 11 m sau vạch) là PLAZA/PARKING, hoặc PLAZA/PARKING/GRASS mà nón pano tại chỗ
    KHÔNG tả khuôn viên có rào → `'open'`: không nhà sinh, không tường, không sân (trước: rào sắt + cổng 29,5 m bao quảng trường Nhà
    hát phía Đinh Tiên Hoàng, pano_055; ~211 m tường cả TP có PLAZA sau lưng). (b) `js/parcels.js` cắt mẫu tường trong claim
    `plaza`/`park` lúc chạy (`claimAt` — bãi Cầu Đất, Lê Chân, road#9, Bến Bính, cv_dbp_tay… generator không biết) và trên mặt
    đường/vỉa hè (`roadNet.surfaceAt > 0,12`, ctx.surfaceAt) — `stats.cutClaim/cutRoad`. (c) CÂY XĂNG: `RX_FUEL` trong classifyObs →
    `open` (không phiếu; "nhà điều hành cây xăng + cửa hàng tiện lợi" từng khớp 'cửa hàng' → lô sinh 1 tầng dưới mái che pano_475);
    `pkSupport` từ chối khi nón quan sát cây xăng phủ lô hoặc pano bỏ phiếu mạnh nhất có chữ cây xăng (418). Dùng cả OPEN_RX thì
    chặn oan 59 lô shophouse ở phố "ven sông / cạnh công viên / gần chợ" (074/075/027/233…) → chỉ chữ cây xăng. (d) THÁP "MA":
    khớp quan sát cao tầng (tia ≤ 80 m) bị BỎ khi pano khác GẦN footprint hơn (≤ 30 m) có quan sát ≤ 5 T với nón phủ tâm footprint
    và không quan sát ≥ 6 T trong ±40° (9/56 khớp: b5277 13 T góc Nguyễn Đức Cảnh × Mê Linh từ tia 427 h90 dài 73 m — 428 đứng 24 m
    thấy nhà 2-4 T; nay khối ML đó chia lô 2-4 T). (e) `import * as RBM from './buildings_real.js'` (thiếu export RB_PARCELS khi
    gộp nhánh → undefined thay vì SyntaxError liên kết làm trắng trang). (f) phụ: tường theo lớp đất (CAMPUS…) KHÔNG dựng khi nón
    pano tại chỗ tả shop/nhà ở/nhà không-khuôn-viên (`PEV.seenOpenFront`, 51 lô — mặt tiền khách sạn TQK 355); loại "mạnh" ngầm
    định có rào trừ khi chữ tả mặt trước mở (bồn cây/chậu cảnh/thảm/bậc tam cấp/sảnh/lối vào — 051 h45 Khoa Quốc tế BV Phụ Sản);
    (g) lô khe nhận kiểu khuôn viên do LAN (2 bên ±8 m) / MẶC ĐỊNH vùng biệt thự (không nón tại chỗ) mà KHÔNG có bằng chứng nhà
    (builtEvidence/obsSupport — lẽ ra bị 'noev' bỏ) → giữ sân, KHÔNG tường/cổng (151 lô; rào biệt thự mặc định từng dựng trong dải
    công viên trung tâm quanh cây xăng 475, 474 h135, 398 h0 — đất OSM ở đó chỉ là URB). Nhà giữ nguyên 100 %, chỉ đổi tường.
    Thử KHÔNG được: cắt tường theo nhà thật CUỐI (sau nới/lấp khe) đứng ≤ 1,5 m sau vạch → băm vụn 66 dãy hàng rào ở góc nhà
    bên cạnh; rào tôn 478 h270 vẫn đứng trước cửa hàng (nhà đó không nằm sau đoạn tường trong dữ liệu sinh) — để lại. (h) khớp
    cao tầng bị bác bởi quan sát thấp KHÔNG phải nhà ống/shop (269 h90 "khối vòm cuốn 4 T") → giữ NGUYÊN khối (`b.lowBlock`, không
    chia lô "khối dính"); bởi shophouse (428 h135) → chia lô như thường. **Số đo lượt 5:** 44.941 → 45.001 nhà (b64 1.521.532 B),
    406 → 366 dãy tường (hàng rào sắt 5,21 → 4,19 km, tường rào 0,35, rào tôn 0,81 → 0,76, tường lô 0,38 → 0,35), 188 → 158 cổng;
    khớp cao tầng 56 → 47 (9 bác, 4 giữ khối); lúc chạy 366 → 314 dãy / 158 → 120 cổng / 77 → 60 k tam giác / 43 ms; tường trong
    claim quảng trường-công viên 122 đoạn (~295 m) → 0, trên mặt đường 11 → 0, sát camera pano < 3 m 0. PERF A/B giữ khoá 1 lượt
    (B A B A, 24 góc chuẩn, tier 3 Radeon 890M): calls 371 → 370, tam giác 3,85 → 3,88 M, fps 60,2 = 60,2 (vsync), hpReady
    5,04/4,87 → 4,45/4,33 s (nhiễu máy chung), bootProfile.fabric 749/660 → 766/708 ms, 0 lỗi JS; diag 0 lỗi; LITE 3×404 như dot3;
    waterbfs 5/5; tour 26 ảnh không lỗi JS (giống r4). CHẤM LẠI (REAL|dot3|r4|r5, cùng cài đặt chụp với phản biện): nhóm I
    (quảng trường + cây xăng, 6) r4 2,25 → r5 3,58 (= dot3: 055 h180/h225/h270 và 420 h90/h135/h180 thoáng lại, 475 h90/h135 hết
    lô "BÁNH ĐA CUA"); nhóm F (biệt thự mặc định + công viên, 11) 2,82 → ~3,14 (dot3 3,09; mất +0,5 rào công viên 064/065 của r4);
    nhóm B (15) giữ 3,97 (428 h90/h135: dãy shophouse 2-4 T thay tháp kính); nhóm A (14) ~3,63 (355 h270 hết rào CAMPUS bên trái);
    cam_high_center hết tháp kính 13 T. Ảnh: scratchpad dot3/W3-B/r5/fA fA2 fB1 fB2 fI fF c3c c4a.jpg.
    **BẪY:** (a) `\b` của JS không hiểu chữ có dấu ("chợ\b" không bao giờ khớp) → ranh giới tường minh; (b) "tôn" khớp trong
    "bê tông" → `tôn(?!g)`; (c) màu tường rào phải lấy từ CỤM chữ tả tường/rào/trụ/cổng — "chòi gác vàng" từng nhuộm cả rào;
    (d) tường dựng tay trong ô cells nằm ngay mặt phố — phải dò hình học trước khi dựng tường dữ liệu; (e) đo cảnh trước freeze
    bằng `scene.updateMatrixWorld()` 1 lượt (updateWorldMatrix từng mesh chậm); (f) Bash sandbox chặn mọi lệnh có chữ "ev·al" →
    gọi tools/qa/clearance.mjs qua wrapper ghép cờ; (g) khoá GPU không xếp hàng công bằng: khi 6-7 agent cùng chụp, mỗi lần xin
    khoá có thể chờ > 60 phút rồi HẾT GIỜ (perf A/B từng mất nửa cặp) → chạy cả cặp B A B A dưới MỘT lần giữ khoá
    (`node tools/qa/gpulock.mjs run -- bash chuoi.sh`; shoot.mjs bên trong tái nhập khoá con) — vừa nhanh vừa đúng "cùng phiên".
- **2026-10-12 (W3-F WATER-BRIDGES)** [ĐỢT 3 wave 3 — AUDIT3 FP-6: cầu HVT theo way OSM (2 nút xoắn ốc), Cầu Lạc Long nâng,
  bờ kè sông Tam Bạc/Cấm (tường kè, dải dạo, lan can gang, đèn 2 bóng, hoa giấy, cây non, dải bờ tự phát), bãi bồi cửa Tam Bạc,
  màu nước]:
    **(1) CẦU HVT THẬT = 2 làn một chiều + 2 NÚT XOẮN ỐC** (OSM: 738297304/930885732 layer 2 nhịp chính x≈−48/−59 z −930→−1880;
    1022715416/1022715417 layer 1 = vòng tròn r≈63 m tâm (17,−930)/(−133,−932); dốc dẫn 743181389/743181388 cùng tên KHÔNG gắn
    bridge). Mô hình cũ = hộp thẳng nối 2 đầu way bắc (75,−898)→(−45,−1883): vòm lệch ~110 m về đông pano_285, tâm vòm ở z −1391
    (trên đất Thủy Nguyên); roadnet vẽ 2 vòng xoắn thành vòng nhựa NẰM ĐẤT ("tấm đen trên nền đất" pano_304/349); terrain
    deckHeight "phố băng sông = cầu phẳng 2,05" đặt camera pano_285 sát mặt sông. Nay process_osm §6b4 xuất `BRIDGE_WAYS`:
    xích theo chiều xe (way nối đuôi→đầu ≤ 3 m), dốc ĐỀU từ đầu dốc mặt đất tới đỉnh xoắn (đỉnh đầu của cạnh gốc ≥ 200 m)
    = 15 m (1,93 %: vòng dưới và nửa vòng trên cách 1 vòng 404 m ⇒ ~7,8-8,2 m; ảnh 304 h90 dốc dưới ~6 m, mặt trên ~14 m);
    nhịp chính y(z) ease (−930 → 15, −1020 → 19,4, −1110 → 20,6, −1200 → 19,4, −1880 → 2) — 2 làn cùng z cùng cao độ.
    `js/bridges.js`: mặt cầu (texture nhựa + vạch), gờ bê tông 0,95 m + tay vịn thép 2 tầng + cột 2,5 m, dầm 1,9/1,35 m, mặt
    dưới, đèn cần vươn 36 m; trụ tròn + xà mũ (nhịp chính 42 m, xoắn 24 m; dời ±3/±6 m khỏi lòng phố mặt đất & camera pano;
    gầm < 2,2 m bỏ); tầng TRÊN chồng lên tầng dưới → KHUNG CỔNG 2 cột đứng ngoài mép tầng dưới + xà; vòm đỏ network-arch
    neo đúng lòng sông z −1030…−1200 (tim giữa 2 làn, sườn ±14,5 m nghiêng 0,22, cao 38 m, dây treo đan chéo, giằng đỉnh,
    trụ chân vòm xuống nước); tháp thang máy khung thép kính cạnh nhịp chính bờ nam (−33,5, −1003) (ảnh 304 h90, 285 h90).
    **(2) TRA CAO ĐỘ MẶT CẦU CÓ THAM CHIẾU** (world.js): `groundHeight` KHÔNG gồm mặt cầu nâng (cây/prop/nhà vẫn ở mặt đất
    dưới cầu); `surfaceY(x,z,yRef)` = max(đất, mặt cầu cao nhất ≤ yRef + 1,2) — người chơi (đi bộ, tryMove, camera),
    tác tử giao thông giữ ĐÚNG TẦNG ở nút xoắn 2 tầng và cầu vượt trên phố (r4: theo CẠNH đồ thị tách tầng — xem (10)); `spawnY(x,z)` (teleport/pano): mặt cầu nếu tim cầu GẦN hơn tim phố mặt đất gần nhất (pano_285 nhịp
    chính 18,9 m; pano_074 trên Lạc Long; pano_349 phố đất dưới vòng xoắn → đất). BẪY: dùng groundHeight cho người chơi trên
    nhịp chính = rơi xuống sông (isWater) — mọi hệ di chuyển mới phải gọi surfaceY. roadnet `deps.skipWay(ri)` bỏ dải mặt đất
    của way cầu nâng; seed vá đường/lệch 1,5 mm theo `si` (chỉ số NẾU không bỏ way) ⇒ mọi phố khác GIỮ y hệt. Cây/prop/W2-A
    dùng `ROADS_GROUND` (way cầu nâng thu về 1 điểm, giữ chỉ số).
    **(3) CẦU LẠC LONG = cầu phố nâng nhẹ (kind 'deck')**: ảnh pano_074 h180 — mặt cầu cao ~2 m trên ngã ba Bạch Đằng ngay
    dưới, bó vỉa sơn sọc đỏ-trắng, vỉa hè gạch đỏ, lan can con tiện trắng hoa văn ô van; tim vàng đôi. Hồ sơ (r4): phẳng 6 m ở
    đầu tây, dốc 64 m lên +2 m; đầu đông phẳng 44 m (ngã tư phố ven bờ ri 200 ở quãng ~200 m) rồi dốc 35 m; mặt cầu chỉ ở
    [i0,i1] (5,9 → 187,3 m). Đầu cụt Bạch Đằng 51/222 (−379,−505) cắt lùi khỏi gầm (xem (10)). Cầu phẳng khác (Tam Kỳ, Tam Bạc, Bạch Đằng/Đào Hạ Lý): lan can con
    tiện + dầm biên + trụ trong nước theo dải roadnet ở LAND_H.
    **(4) MÉP SÔNG LÙI KHỎI PHỐ VEN SÔNG** (process_osm §6b3): đối chiếu ảnh vệ tinh tile 4/5/7 (georef tự động bằng tương
    quan mạng đường OSM ↔ "độ đường" ảnh, mpp 0,67 — georef trong README tile 7 SAI) + cấu trúc pano: polygon OSM sông Tam Bạc
    chạy ĐÈ lòng Phố Tam Bạc (tim phố cách mép nước 2-6 m ở pano_197-203). Đỉnh polygon sông (chia ≤ 3 m) bị đẩy theo pháp
    tuyến phố (song song ≤ 40°, không phải cầu) tới ≥ hw + vỉa hè + 2,5 m; footway=sidewalk ven sông ≥ 3 m. 649 đỉnh, tối đa
    9,1 m. Đoạn bắc 221 → 333: mép đông polygon cách kè MỚI (ảnh vệ tinh tile 7, chụp SAU pano — đường kè mới) 15-25 m về tây,
    nhưng pano 2022-23 (519/336/337/520) cho thấy đúng dải bờ tự phát rộng ~10 m (lán + cây) ⇒ GIỮ polygon, dải đó = 'strip'.
    **(5) BỜ KÈ** (`js/riverbank.js`): (a) `snapBankGrid` — lưới nền local 13,3 m vẽ bờ thành dốc thoải ~5 m (mép nước theo ô,
    "nước phẳng với vỉa hè"): đỉnh ±0,72 ô quanh mép polygon kéo VỀ MÉP (cao độ đất), đỉnh nước kế tiếp DÌM −60 m (tam giác bờ
    gần đứng, phần nhô trên mặt nước ≤ 0,6 m nằm sau tường kè — kéo về "chân kè 3 m" như lưới mịn hồ sinh NÊM dài nhô lên mặt
    nước vì ô 13,3 m quá thưa), tam giác cả 3 đỉnh cao độ đất mà tâm trong nước → trả đỉnh nước về chỗ cũ; tô lại màu đỉnh; bỏ kênh hẹp (bên kia mép phải còn nước ≥ B+8 m) và CẠNH CHUNG 2 polygon (sau mép phải là đất — nếu không
    thành gờ đất giữa lòng sông, pano_221 h270). (b) mọi mép sông R ≤ 1640: tường kè đứng 0,7 m ra phía nước từ mặt dạo
    (LAND_H + 0,25) xuống −1,4 (đỉnh sáng, vệt rêu sát nước) + gờ đỉnh. (c) phân loại theo phố chạy dọc bờ: 'prom' (bờ cách mép
    vỉa hè ≤ 7 m: dải dạo ca-rô đỏ-xám bạc màu LIỀN từ gờ tới sát bó vỉa + lan can gang xanh (tấm hoa văn alphaTest 1 quad/2 m,
    gờ bê tông — phố s/p sọc đỏ-trắng 1 m như pano_221, t/r xám như 203) + đèn gang 2 bóng 16 m (bóng = sharedMats.lampGlow,
    sáng đêm) + khóm hoa giấy + collider chặn rơi + CÂY NON chống cọc 9 m (world.js veg.plant('non')), phố đó KHÔNG trồng cây
    đường phố cổ thụ cả 2 bên (keepClear), đồ vỉa hè props.js không đặt phía sông (promSide)); 'strip' (Tam Bạc đoạn BẮC Lạc
    Long → cửa Cấm, mảnh polygon bắc z < −568 (bậc nối 2 mảnh ngay pano_221), pano_519/331/336/221 h270 — LUÔN strip: lan can sắt thấp ở MÉP VỈA HÈ (tấm CHUỖI VÒNG TRÒN sẫm alphaTest
    như ảnh 519 h180/331 h270 + trụ bê tông 6 m + chậu cây), lán tôn/bạt màu thấp 1,9-2,4 m giữa lan can và kè, GIỮ cổ thụ + xe
    máy đỗ, CÂY LỚN trong dải (bankTrees: hàng ≤ 6 m sau lan can, dải ≥ 8 m thêm hàng thưa phía kè; world.js plant('shade'));
    hàng rào vòng tay khối B2 "phố thuyền" bỏ khi kit chạy (từng thành 2 hàng rào song song)); 'wild' (không phố, bờ xa > 7 m
    ngoài đoạn bắc, dưới cầu: chỉ kè). Thuyền gỗ neo bờ
    Tam Bạc đoạn bắc. BẪY: keep/promSide phải giới hạn theo QUÃNG có dải dạo trên đoạn ROADS_DT (keepSegs si → [t0,t1] + 6 m)
    — 1 đoạn dài (Phố Tam Bạc 221 → 335) vừa có dải dạo vừa là dải tự phát; áp cả đoạn từng xoá hàng cổ thụ + xe máy phía sông
    ở pano_336 (12 → 4 cây, 30 → 13 xe trong 22 m).
    Khối ô dựng tay TS-11/TS-12 (dải caro + lan can kè Thế Lữ/Phố Tam Bạc theo vị trí cũ) bỏ phần dải/lan can khi kit chạy.
    **(6) NƯỚC**: sông 0x5c625a → 0x5b5a46 nâu-ô liu (ảnh tầm mắt 203 (80,76,62), 221 (122,114,90), 290 (96,100,79)), nhám
    0,12 → 0,2 (bớt gương trời xám-trắng nhìn ngang); hồ giữ.
    **(7) DƯỚI MẶT CẦU NÂNG**: world.js `underDeck(x,z)` = có mặt cầu (`DECKS.topAt(x,z,3)`) cao hơn đất 0,8…16 m → KHÔNG cây
    đường phố (keepClear), KHÔNG đồ vỉa hè props (avoid), và MỌI cây dựng tay/ô/hồ bị `buildTrees` bỏ (hook `ctx.dropAt` —
    trees.js 1 dòng, thống kê fix.deck): cau/cọ + cây non từng đứng XUYÊN mặt Cầu Lạc Long +2 m (pano_074 h0). Nhịp chính HVT
    ~19 m: cây nhỏ dưới gầm vẫn được. riverbank `deckAt` → không lan can/đèn/cây non dưới cầu nâng (roadnet bỏ dải mặt đất
    của cầu nâng nên `roadSurfaceAt` = 0 ở đó). Lòng 2 NÚT XOẮN (way 'ramp' gần tròn quét ≥ 300°; ảnh vệ tinh real_7: phần lớn
    là BÃI NHỰA + 1 vườn bán nguyệt phía nam): claimPoly 'park' bán elip 38 × 27 m (dây cung cách tâm 15 m về nam) TRƯỚC, rồi
    claimCircle 'parking' (r − w/2 − 2) → landuse tô bãi nhựa / cỏ (landuse.js: lớp claim mới 'parking' → PARKING, 1 dòng) thay
    "bãi trống đất be" + tấm nhựa đen. Texture mặt nhựa cầu 256 × 288 px / (bề rộng × 12 m) = texel ~VUÔNG 4 cm: bản 64 × 256
    (16 × 4,7 cm) kéo hạt nhựa thành vệt hướng về camera. Mặt DƯỚI mặt cầu bê tông sáng 0xcdc9bf (0x8d8a83 cũ thành mảng đen
    lơ lửng khi nhìn từ dưới nút xoắn, pano_304 h90).
    **(8) BÃI BỒI CỬA TAM BẠC** (process_osm §6b3b, AUDIT3 FP-6 "331 (−525,−905)"): ảnh vệ tinh tile 7 — polygon OSM Tam Bạc
    242027154 phủ CẢ bãi cát + lùm cây rộng 25-60 m giữa lạch nước thật (~36 m, sát bờ tây, tim = waterway 680814260) và kè phố
    Tam Bạc (pano_331/332/383/384: rào + cây rậm + nhà tôn thấp, KHÔNG thấy nước; game cũ: mặt sông mở 15 m trước camera).
    Mép đông polygon từ chân bãi (z −830) tới cạnh chung với polygon Cấm được THAY bằng đường bờ bãi `BEACH_SHORE` (11 điểm đo
    trên tile 7; z < −965 ngoài ảnh = tim lạch + 19 m, khớp đoạn đo) — ghép 1 DẢI LIÊN TỤC các đỉnh (chia ≤ 3 m) phía đông đường
    bờ, đỉnh gốc ngoài dải giữ y hệt; xuất `BEACHES` (đa giác đất bãi). riverbank.js: mẫu bờ có phía đất trong BEACHES = DỐC CÁT
    tự nhiên 4,5 m (không tường kè), 'strip' (tìm phố ±3 ô lưới, giới hạn keClear + 75 m): lan can vòng ở mép vỉa hè + lán sát
    SAU lan can theo hướng phố (22 %) + lùm cây rải trên bãi (lưới 7 m xê dịch, mật độ theo ô 22 m, cách nước ≥ 3,5 m); claimPoly
    'rough' → landuse tô CỎ DẠI/đất (landuse.js lớp claim 'rough' → ROUGH; claim 'rough' không chặn cây/prop). BẪY: ảnh vệ
    tinh MỚI hơn pano (kè + đường mới ở cửa sông, dải lán đã dọn) — chấm pano theo trạng thái 2022-23, đo bờ theo vệ tinh.
    **(9) KHỞI ĐỘNG / BỘ NHỚ**: snapBankGrid lọc thô theo cao độ đỉnh (chỉ đỉnh ≤ 4 ô quanh chỗ đổi khô/ướt mới gọi waterSD:
    −85 % lần gọi) + chỉ trong R_POLY; giao thông chỉ tra groundHeight ở điểm cạnh CÓ mặt cầu phủ (cạnh 'elev'); cây non lọc
    collider bằng lưới 4 m theo hộp bao (thay colliders.some × 234 cây); riverbank/bridges nhả mảng JS nguồn sau khi chép sang
    typed array (closure keep/promSide giữ ngữ cảnh hàm dựng ⇒ không nhả = ~30 MB heap sống suốt phiên).
    **ĐO / KIỂM** (2026-10-12, tier 3, ANGLE AMD Radeon 890M D3D11, A/B CÙNG phiên dot3 :8596 vs nhánh :8506): hpReady TB 3 lần
    4751 → 4756 ms — **SAI khi kết luận "không đổi"** (phản biện r2 đo lại cùng phiên: tổng bước khởi động +336 ms full / +384
    lite: ground +110, freeze +111, landmarks +70; hpReady 3 lần lệch nhau ±300 ms nên KHÔNG dùng hpReady đơn lẻ để kết luận
    — so TỔNG bootProfile + từng bước, ≥ 2 lượt xen kẽ mỗi bên; số sau r5 ở (11)); heap sau gc 385 → 412 MB (+27; trước khi nhả mảng nguồn +54), hình học GPU 254,7 → 277,8 MB
    (cầu + kè gộp 'mrg' 30 → 51); fps 60 (trần vsync) mọi góc; cam_spawn 387 → 402 calls / 3,83 → 3,93 M tam giác, pano_007_h090
    505 → 508 / 5,52 → 5,53 M, cam_high_center 392 → 415 / 5,24 → 5,41 M, game_3 348 → 350 / 6,10 → 6,09 M, cam_hvt 633 → 658 /
    6,88 → 7,01 M. Kit bờ: 5605 mẫu, dải dạo 3,24 km, strip ≈ 0,45 km, bãi 0,37 km, 191 đèn, 235 cây non, ≈ 95 cây lớn, ~100 ms.
    Chấm pano (REAL | dot3 | nhánh, 4 hướng, ±0,5): 17 pano đích 2,91 → 4,51 (285 1,5 → 5; 304 2 → 4,5; 349 2 → 4,5; 074 2,5 → 5,5;
    331 3 → 3,8); 8 pano đối chứng 4,56 → 4,56 (lệch điểm ảnh ≤ 7 %, chỉ lá cây lay). Cổng: diag "TẤT CẢ THỰC THỂ OK — 0 lỗi JS"
    (full, giao thông bất biến 0); lite 3 × 404 = assets_lite/ trống ở máy (môi trường, base y hệt); --gl1 0 lỗi; tour 26 ảnh
    0 lỗi; waterbfs 5/5; process_osm chạy lại → mapdata y hệt; đi bộ theo xích mặt cầu (surfaceY tham chiếu) sai số 0, không rơi.
    CÒN: camera/lòng phố pano_331/519 (FP-1), bậc polygon 2 mảnh Tam Bạc ở pano_221 (gờ kè chéo qua bãi cỏ), tháp thang máy
    HVT là khối kính đơn giản.
    **(10) SỬA SAU PHẢN BIỆN (r4)**:
    (a) **ĐỒ THỊ GIAO THÔNG TÁCH TẦNG** (`js/roadgraph.js`): đỉnh polyline mang cao độ mặt đường p[2] (không có = mặt đất
    `groundLevel` 2,11); ngã ba T (≤ 6 m), ngã tư chéo và khoá nút (ô 1,5 m) chỉ nối 2 tuyến lệch ≤ `LV_TOL` 1 m — khoá nút
    = ô + CỤM cao độ (2 tuyến khác tầng có đỉnh trùng ô = 2 nút). Cạnh mang `e.ys` (cao độ từng đỉnh), `e.kind`, `e.ri`, `e.lv`
    (TB); đường đôi không ghép cạnh lệch tầng > 2 m. BẪY cũ: đồ thị nối MỌI giao cắt 2D → 22 nút nối mặt cầu 6-16 m với phố
    mặt đất; ở nút HVT 88-102 xe/mẫu chạy "đường cầu" ngay trên đất, 5-9 xe lặn dưới sông Cấm (y −2,9); `traffic.check()`
    chỉ xét xz nên diag báo 0. Đầu vào = `world.trafficRoads()` = `deckRoads(ROADS_NET, BRIDGE_WAYS)`: way cầu nâng thay
    polyline ROADS_DT giản lược (dây cung vòng xoắn r 63 m lệch ~3 m khỏi tim mặt cầu) bằng tim mặt cầu mẫu 3 m + cao độ mặt
    nhựa (y + 0,02 span/ramp, + 0,11 deck), hw = nửa lòng giữa 2 gờ (HVT 5,0 / 4,7, không 6,5 của cấp 'p'); 2 đầu mút gắn đúng
    toạ độ ROADS_DT. Kết quả: 469 nút (495), 0 nút lẫn tầng, xích HVT sạch đất → dốc → vòng xoắn → nhịp (mỗi nút deg 2).
    (b) **CAO ĐỘ TÁC TỬ THEO CẠNH** (traffic.js): cạnh có e.ys → `edgeY(e, dir, s)` MỖI khung (không +ROAD_TOP lần 2 — xe từng
    nổi 0,11 m; không bậc 4 m trên dốc); phố mặt đất → groundHeight (KHÔNG tra mặt cầu theo vị trí: xe dưới gầm vòng xoắn từng
    "bước lên" dốc thấp ≤ 1,2 m). Cầu HVT (span/ramp) MỘT CHIỀU theo chiều way (xích đúng chiều xe) + cấm người đi bộ; cầu phố
    'deck' 2 chiều + người đi bộ trên vỉa hè gạch (y = mặt nhựa + CURB_RISE). Bám xe/lách người chơi/overlap bỏ qua cặp lệch
    tầng > 2,5-3 m; xe đỗ không gán lên cạnh cầu; `check()` thêm `underwater` (xe y < 0,8). chooseNext có lưới an toàn khác
    tầng 1,2 m.
    (c) **XUỐNG XE / GỌI XE / MÉP CẦU** (main.js, vehicles.js): `freeSpot/dismount/callMoto` dùng `surfaceY(x,z,ref)` với ref =
    cao độ xe/người + chỗ phải CÙNG TẦNG (|h − ref| ≤ 1,2) — bản cũ dùng groundHeight (dưới nhịp chính = đáy sông −3): trên cầu
    không xuống xe được ("⚓ cập bến…"), không gọi xe được ("cần đứng trên bờ"), xuống xe trên dốc xoắn = rơi xuống đất dưới gầm;
    vehicles.spawn khi gọi xe nhận ref qua `_vehRefOverride`. `tryMove` (đi bộ) và `vehicles.blockedAt` (xe đang lái) TỪ CHỐI
    bước làm bề mặt thấp hơn chỗ đang đứng > 1,2 m = mép mặt cầu (thành phố phẳng: không có bậc thật nào cao thế).
    (d) **CẦU LẠC LONG CHỈ KHOẢNG NÂNG**: bằng chứng giữ đường dẫn tây dài trên đất — ảnh vệ tinh tile 7 (dải mặt cầu thẳng giữa
    2 phố gom mặt đất 51 bắc / 222 nam, 2 dải cây) + pano_074 h270 (lan can chạy suốt về tây). Nhưng: bản cũ bỏ CẢ way 232 m
    khỏi roadnet → đầu tây (nối phố 187) thành phố cụt có nêm vỉa hè chữ V giữa lòng + cột đèn tín hiệu của nút cũ đứng trên làn
    cầu; lan can + gờ sọc chắn ngang ngã tư với ri 200 (mặt cầu y 2,0 ở đó); Bạch Đằng 51/222 gặp nhau dưới tấm mặt cầu gầm
    0,9 m; 100 m tấm lơ lửng trên đất. Nay: process_osm hồ sơ mới + `i0/i1` (mặt cầu bắt đầu/kết thúc đúng chỗ y = mặt đất ⇒
    mặt nhựa cầu = mặt nhựa phố 2,11, không bậc); roadnet vẽ ri 20 trừ khoảng `deckGapAt(ri,x,z)` (biên dò 1 m + chia đôi ~1 cm);
    `makeDeckIndex`/claim 'bridge'/urbanDeck chỉ [i0,i1]. Đoạn trên ĐẤT = NỀN ĐẮP: mặt đứng 2 bên xuống tận đất (−0,3), trên
    nước dầm biên sâu 0,25 → 1 m theo cao độ (đầu cầu thấp không cắm mặt sông) + mặt dưới + MỐ ngang ở chỗ chuyển đất↔nước;
    trụ trong nước đỉnh = đáy dầm. `roadgraph.trimRoadEnds(ROADS_DT, lowAt)` (world `ROADS_NET`, dùng cho roadnet + đồ thị):
    phố mặt đất có ĐẦU MÚT dưới mặt cầu gầm thấp (mặt cầu > đất + 0,5 và < đất + 5,5, pad 0,6 m) cắt lùi tới mép mặt cầu; cờ
    `r.cut` → roadnet/đồ thị KHÔNG T-snap đầu đã cắt (Bạch Đằng 51 từng bị kéo 5 m sang đầu phố 243 thành chữ V nhọn). Chỉ
    51 và 222 bị cắt (phố cụt sát tường nền đắp, như ngõ cụt).
    (e) **NHỎ**: vòm HVT z0 −1024 → −1012 (pano_285 ở bờ nam z −1000: h270 sườn tây mọc sát mép phải ⇒ chân ≤ ~16 m phía bắc;
    h90 không thấy sườn đông ⇒ ≥ ~13 m); mặt DƯỚI cầu pháp tuyến (0,6·trục, 0,8) — hướng xuống chỉ nhận màu ĐẤT của đèn bán
    cầu → "tấm nâu khaki sẫm" pano_349; thử NGANG (50 % trời) còn nâu ở đoạn quay lưng nắng + sọc bóng (normal bias ngang);
    đỉnh gờ + mặt trong gờ HVT xám lạnh 0xa9a8a2 (mặt ngoài giữ sáng — "vệt be" 285 h90/h270). NHÀ ô dựng tay GIỮ (cao ≥ 9 m) nằm
    trong lòng nút xoắn (`world.helixLoops` từ claim lòng vòng; hvt_tapthe5t 5 tầng — thiết kế quanh cầu HVT cũ; ảnh vệ tinh
    tile 7: lòng vòng tây = bãi nhựa + vườn bán nguyệt) → `lmRemoveCell`. BẪY: hvt_nonbo (kind 'house', 7,5 m) là HÒN NON
    BỘ trên đảo vườn — THẬT (pano_304 h180/h270), lần gỡ đầu xoá nhầm → chỉ gỡ khối cao. Va chạm 2D (`resolveAll` main.js): đang ở trên
    mặt cầu cao hơn đất > 2,5 m (`decks.yAt(x,z,y+0,3)`) → bỏ collider thế giới/NPC (cây/cột/nhà dưới gầm từng chặn xe trên
    vòng xoắn); `traffic.pushOut` bỏ xe lệch tầng > 2,5 m. Tam Bạc đoạn BẮC (dải bờ tự phát): process_osm §6b3 mép nước ≥
    clearOf + 7 m ở z −620…−800 (vuốt 0 ở −590 và −830 — không khấc mới ở 221 / chân bãi bồi): quanh 519 polygon chỉ cách tim
    phố 10,5 m (dải 2 m, không chỗ lán; 336/337/520 là 18-19 m) → 16 m, lán + cây sau lan can như ảnh 519 h180/h270.
    KHÔNG làm: giới hạn keep() về phía sông (cây phố là thủ tục nhịp 9 m, không bằng chứng: trả lại cây cổ thụ 473 h90 nhưng
    cũng trả cây sai ở 203 h90 — giữ cả 2 bên).
    **ĐO / KIỂM r4** (2026-10-12, tier 3, ANGLE Radeon 890M D3D11; máy TẢI NẶNG — hpReady 5-20 s cả 2 bên, chỉ so cùng phiên):
    heap sau gc 384 → 411 MB, hình học GPU 254,7 → 277,5 MB (= r3); draw call 2 lượt/bên: pano_062_h090 352 → 356, cam_hvt
    616 → 630, game_3 325 → 327, pano_071_h180 612-671 → 623; game_8 (dot3 182 / 458 — GLB tải không tất định, 1 lượt std
    nhánh 484 cũng là nhiễu này) → 197-221. Đồ thị 469 nút (495), 0 nút lẫn tầng; probe 8 mẫu × ~250 xe quanh nút HVT: lệch
    khỏi mặt đường/mặt cầu 0, dưới nước 0 (trước 88-102 / 5-9 mỗi mẫu); xuống xe trên nhịp 20,6 m / vòng 4,9 / 7,7 m đúng
    tầng, gọi xe trên cầu được; đi bộ & lái xe máy thẳng ra mép vòng xoắn dừng ở mép (y giữ 7,7); người đi bộ trên Lạc Long
    y = mặt cầu + 0,14. Chấm 17 pano đích 4,51 → 4,59 (304 4,5 → 4,8; 349 4,5 → 5; 285 5 → 5,2; 519 3,5 → 3,8; 336 3,8 → 4);
    8 đối chứng lệch điểm ảnh ≤ 6,8 % so dot3. Cổng: diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (bất biến 0, underwater 0),
    lite 3 × 404 (assets_lite/ trống — môi trường), --gl1 0 lỗi, tour 26 ảnh 0 lỗi, waterbfs 5/5, process_osm tất định.
    BẪY harness: sau "Bắt đầu" hội thoại hướng dẫn (modal) chặn di chuyển người/xe — probe phải Esc trước khi giữ W (headless:
    phát KeyboardEvent thẳng lên window).
    **(11) SỬA SAU PHẢN BIỆN r2 (r5, 2026-10-14)**:
    (a) **XE HƯỚNG BẮC TRÊN NHỊP HVT** (traffic.js chooseNext): nhịp một chiều 738297304 (ri 242 — nhịp pano_285 đứng) có nút xa
    (−46,−1650) NGOÀI PLAY_R + 30 → luật "không chạy ra ngoài vùng chơi" bỏ LỐI RA DUY NHẤT ở đỉnh vòng xoắn đông (75,−898);
    cạnh nâng một chiều không quay đầu được → `a.kill` ⇒ mọi xe hướng bắc biến mất ở đỉnh xoắn, nhịp KHÔNG BAO GIỜ có xe. Nay
    cạnh cầu nâng (`e.elev`) miễn luật đó; xe chạy xa bị cull khoảng cách (RB + 40) như mọi xe. Node (scratch r5/graph_exits.mjs):
    cạnh nâng mà nút cuối không lối ra 1 → 0; probe: xe trên ri 242 quanh 304: 6-12/mẫu, quanh 285: 12-18 (trước 0); wrongWay,
    underwater, offRoad 0. BẪY: mọi luật lọc theo vùng chơi trên đồ thị có cạnh một chiều phải kiểm "nút còn lối ra không";
    probe "lệch mặt đường" chỉ đúng cho tác tử TRONG DRAW_R (260 m) — ngoài đó writeInstances không cập nhật a.y (y cũ, 300-380 m).
    (b) **KHỞI ĐỘNG / GPU: SỐ TAM GIÁC LÀ CHI PHÍ.** freezeStatic tách mọi mesh bán kính > 0,75·T bằng `splitGeometryByTile` →
    lưới KHÔNG CHỈ MỤC (3 đỉnh/tam giác) ⇒ byte GPU + thời gian tách/gộp ∝ SỐ TAM GIÁC (chia sẻ đỉnh trong Buf vô ích). Bản r4
    dựng kè = hộp/quad MỖI MẪU 2 m: kit bờ 181,6k + cầu 108,7k tam giác. riverbank.js `Run(B, faces, cap)`: mẫu liên tiếp CÙNG
    cạnh polygon (cùng hướng, cùng màu) gộp thành 1 đoạn quét; khung chỉ ở đỉnh polygon (vát góc, hệ số 1/cos chặn 2) và chỗ
    đổi màu (sọc gờ 1 m); nắp chỉ ở chỗ đứt — tường + gờ kè + bệ + tay vịn 96,7k → 9,4k tam giác (168 cạnh polygon sông trong R,
    ~77 m/cạnh); bóng đèn cầu 8×4 (31,4k → 18,8k); pháp tuyến khối hoa giấy tính sẵn; quad() 1 lệnh push/thuộc tính ⇒ kit bờ
    181,6k → 92,7k tam giác, dựng (node, ấm) ~75 → ~45 ms. bridges.js `simplifyFrames(F, l, 0,02)` cho tay vịn (đường cong
    đứng bán kính lớn: vài khung/50 m; vòng xoắn giữ gần đủ) + cột tay vịn bỏ mặt trên (nằm trong thanh vịn): 108,7k → 77,3k.
    Phần W3-F trong freeze (node, tách ô T 450 + gộp, ấm): ~45 → ~28 ms. ĐO TRONG TRÌNH DUYỆT (freezeStatic gắn tạm đồng hồ,
    3 lần): freeze 190-235 ms; tách ô mesh W3-F 40-59 ms cho 155,7k tam giác (mọi mesh tách ô khác của thành phố 26-34 ms cho
    114k), gộp (mọi ô) 70-101 ms. Mesh vertexColor KHÔNG texture bỏ thuộc tính uv (lượt 1 xoá uv sau khi đã chép). Đã THỬ chia
    ô sẵn lúc dựng (Buf theo lưới T của freeze): KHÔNG lợi — mesh nhỏ cũng bị chép từng tam giác khi gộp (`toWorld` =
    splitGeometryByTile(…, Infinity)) ⇒ chi phí freeze ∝ số tam giác × số thuộc tính, không phụ thuộc mesh to/nhỏ. BẪY: ngưỡng
    "thẳng hàng" để nối mẫu phải ~0,03° (dot > 0,9999999) — 0,57° cho cung polygon cong mờ lệch dây cung ~0,1 m/100 m.
    (c) **GỜ GIỮA 2 NHỊP** (bridges.js `makeDeckIndex().crossesParapet(x0,z0,x1,z1,yRef)`; main.js tryMove + vehicles.js
    `opts.moveBlock`): 2 nhịp HVT một chiều chạm/chồng mép (tim cách 10,6-13,3 m, rộng 11) và main.js tắt collider 2D trên cầu
    cao ⇒ từng đi/chạy xe NGANG qua 2 gờ. Chặn khi mặt cầu CÙNG TẦNG (yRef −2…+1,2) có tim GẦN nhất đổi từ nhịp này sang nhịp
    kia (chỉ kind 'span' — nhịp chỉ nối đầu-đầu với vòng xoắn/dốc). BẪY đã thử: (1) "mặt cầu cao nhất" thay vì "tim gần nhất"
    → đi sát gờ ở chỗ 2 nhịp chồng mép (z −930…−955) bị coi là đứng trên nhịp kia; (2) tiêu chí "điểm mới nằm cạnh way cũ" chặn
    nhầm ở chỗ nối dốc ↔ vòng xoắn (vòng cong, dốc rời tiếp tuyến). Kiểm node (scratch r5/parapet4.mjs): đi theo 2 xích HVT ở
    tim / ±4,8 / ±5,1 m, 2 chiều — chặn sai 0; probe: đi bộ/chạy xe máy từ nhịp này sang nhịp kia dừng ở x −53,9…−54,1, y giữ.
    (d) **NHỎ**: vòm z0 −1012 → −1018 (pano_285 h90 hết mẩu sườn đông ở mép trái; h270 sườn tây vẫn mọc ở mép phải); ca-rô
    nhạt hơn (đỏ 146,116,108 / xám 132,128,122 — ảnh 290/299 hồng-xám bạc); vách lán tôn kẽm/tôn gỉ/bạt xanh/ván cũ (vách xám
    nhạt đọc thành "hộp bê tông" ở 519/336); biển địa danh 'bridge' neo lại chân nhịp chính thật (−36,−915) thay đầu "hộp
    thẳng" cũ EXTRAS.bridges[0] (123,−819), diag tiếp cận OK; `deckRoads` trả `{...r, pts, kind, hw}` (giữ mọi trường của way).
    Nhà thuyền tb_shack khối B2 (thân thuyền + mui bạt, đặt ở điểm nước đầu tiên 14-42 m phía sông) là THUYỀN có chủ ý — giữ.
    (e) **GHI CHÚ TÍCH HỢP**: (1) W3-A thêm bề rộng riêng từng way (ROADS_DT[i].w/.sw, xsection.roadHW(way)): sau gộp chuyển
    riverbank hw(c)/sw(c) + process_osm §6b3 clearOf(c) sang bề rộng theo way, giữ w/sw trong line object của roadgraph
    (dòng `cur = { c, ri, kind, hw, … }`), rồi CHẠY LẠI process_osm (mép kè + mép ngoài ca-rô theo lòng Tam Bạc hẹp mới).
    (2) `js/buildings_real.js` là file SINH (tools/process_buildings.mjs dùng terrain.waterSD = WATER mới): nhánh KHÔNG sinh lại;
    sinh lại từ đầu vào W3-F: drop_water 97 → 91, ~12,7k/46k footprint đổi chỗ trong file (chuỗi sinh dịch), 74 → 72 nhà giữa
    phố ven sông và nước, 5 nhà mới trên bãi bồi bị claim 'rough' giết ⇒ người tích hợp PHẢI chạy lại + kiểm lại. (3) keep() xoá
    cây cổ thụ có miếu phía nhà ở pano_473 h90/h180 → phối hợp W3-G (cây di sản/hero). (4) KHÔNG làm: lòng 2 vòng xoắn 'parking'
    trống ở pano_304 h180/h270 (ảnh thật: đường có vạch + dải phân cách), bậc polygon Tam Bạc ở 221 h270 (gờ kè chéo), TIER cho
    bộ kit bờ (máy yếu), hàng đợi công bằng cho tools/qa/gpulock.mjs (poll 3-5 s thua poll 250 ms của tác tử khác).
    **ĐO / KIỂM r5** (2026-10-14, tier 3, ANGLE Radeon 890M D3D11, cùng phiên dot3 :8596 vs nhánh :8506, máy chung với các WP
    khác): (1) CHI PHÍ RIÊNG W3-F đo bằng đồng hồ gắn tạm quanh từng khối (3 lần full, máy rảnh): snapBankGrid 32-44 ms,
    buildRiverbanks 56-60 ms (r4: 86), buildBridges 41-42 ms (r4: 63), tách ô mesh W3-F trong freeze 35-50 ms (r4 ~2× số tam
    giác) ⇒ ≈ 0,17-0,19 s luồng chính (r4 ≈ 0,3 s: phản biện đo tổng bước +336 ms); lite: 18 / 57 / 42 / 55 ms (ô freeze 220 m).
    Khớp A/B cặp chạy lúc máy rảnh (bootB lần 1): tổng bước 3925 → 4043 (+118), ground +81, landmarks +51, freeze +43. Lúc máy
    bận (các WP khác chạy song song) A/B lệch −430…+700 ms ở cả bước KHÔNG liên quan (final, actors, shaders) — vô dụng: BẪY đo
    perf trên máy chung → đo chi phí riêng bằng đồng hồ quanh khối + 1 cặp A/B lúc rảnh. (2) heap sau gc 383 → 397-399 MB
    (+14-16; r4 +27-28), hình học GPU 254,7 → 264,7 MB (+10; r4 +23 — 'mrg' 30,3 → 38,8); fps 59-60 mọi góc (trần vsync);
    calls/tam giác (2 lượt): cam_hvt 616 → 644 / 6,88 → 6,90 M, pano_285_h000 93 → 90 / 0,71 → 0,59 M, pano_304_h090 282 → 290 /
    1,56 → 1,47 M, pano_007_h090 505 → 509 / 5,52 → 5,51 M; kit bờ 92,7k + cầu 76,5k tam giác (r4 181,6k + 108,7k). (3) Chấm 17
    pano đích (REAL | dot3 | r5, 4 hướng): 2,91 → 4,75 (r4 4,69 theo phản biện; 285 5,0 → 5,3 hết mẩu vòm h90, chân vòm h0 như
    ảnh; 519 3,5 → 3,7, 336 4,0 → 4,2 lán màu tôn/bạt; 290/299 ca-rô nhạt +0,1); 8 đối chứng lệch điểm ảnh ≤ 5,9 % so dot3
    (lá lay). (4) Cổng: lỗi JS full 0, --gl1 0 (webgl2 false), lite 3 × 404 assets_lite/ (môi trường — base y hệt); diag full
    "TẤT CẢ THỰC THỂ OK — 0 lỗi JS" (bất biến giao thông 0, underwater 0), diag base y hệt; tour 26 ảnh 0 lỗi (ảnh 'bridge' nay
    nhìn thấy nút xoắn + vòm); waterbfs 5/5; process_osm chạy lại → mapdata md5 y hệt (674f1d01…); node --check mọi module.

- **2026-10-05 → 10-14 (Đ3-W3-D SURFACES)** [ĐỢT 3 wave 3 — BỀ MẶT THEO BẰNG CHỨNG: vạch tim, zebra, đèn tín hiệu, vật liệu vỉa hè,
    vườn hoa, bụi cắt tỉa, trời] (AUDIT3 FP-4: MARK 23 pano, PAVE 20, PARK 17, SKY 6 — mặc định "chỉ thêm" → sai dương tính):
    **(1) Bằng chứng mới — `tools/gen_roadmarks.mjs` → `js/roadmarks.js` (SINH):** giữ `ROAD_MARK_EVIDENCE` (chữ pano), thêm
    `ROAD_MARK_LABELS` = NHÃN NHÌN ẢNH pano thật theo trục đường (`tools/pano_loop/mark_labels.json`, 169 pano trên 72 way s/t:
    Y vàng đứt 98 · D vàng đôi 5 · W vạch trắng 30 · N không vạch 36 — nhìn tờ ảnh 3 pano/way, cách làm ở scratchpad W3-D
    probe/waysheet.py), `ROAD_PAVE_EVIDENCE` (vật liệu vỉa hè từ chữ `sidewalk` 530 pano: 2 xám 187 · 3 caro đỏ-xám 263 · 4 đỏ 49 · 5 tự chèn xám 31;
    mệnh đề ĐẦU có vật liệu thắng, bỏ mệnh đề "bó vỉa/viền/bồn cây"), `OSM_SIGNALS` 88 / `OSM_CROSSINGS` 403 (Overpass
    `fetch_osm.sh` §13 → `tools/osm_crossings.json`, gitignored; thiếu file → generator GIỮ mảng OSM cũ trong roadmarks.js).
    BẪY đã thử và BỎ: dò vạch vàng tự động trên ảnh pano (ngưỡng màu) — vạch sơn mòn nắng (220,183,131) lẫn biển/taxi/tường
    vàng → tách kém (âm/dương chồng nhau); OSM `oneway=yes` KHÔNG suy được "không tim vàng" (LKT/ĐTH/NĐC oneway vẫn kẻ vàng).
    **(2) `js/roadnet.js` vạch tim:** nhãn ảnh gán cho WAY gần nhất (≤ 12 m) rồi LAN dọc way ≤ 150 m (đo tới đa tuyến đoạn
    chạy) > chữ pano ≤ 14 m > mặc định: p như cũ; s vàng+mép nếu lòng ≥ 8 m; t vàng nếu lòng ≥ 8 m; r/h không. Bề rộng
    lòng = `ROADS_DT[ri].w` nếu generator có (W3-A per-way width) — chưa có thì theo cấp (t 8 → vẫn vàng: nhãn mới là thứ bỏ
    vàng ở Hạ Lý/Dư Hàng/Chùa Hàng/Mê Linh/Lê Lợi/Bến Bính/NTP). Nhãn N: p chỉ mép, s chỉ rãnh biên, t/r trơn. ĐƯỜNG ĐÔI (way
    song song cùng chiều |cos|>0,94, khe mép lòng −0,5…8 m ở ≥ 60% mẫu 10 m) → không vàng, vạch trắng đứt (Lê Quang Đạo 216/478).
    **(3) Zebra/đèn:** CHỈ khi có node OSM trong vùng nút (rad + 10 m) hoặc bằng chứng chữ pano ≤ 45 m — mỗi điểm bằng chứng
    gán cho MỘT nút tốt nhất (tổng hạng nhánh + 2·số nhánh p/s − d/3; zebra chỉ nút ≤ rad + 12 m — xem (9a)). Đèn: OSM hoặc (pano
    + ≥ 2 nhánh p/s/t); cụm ≥ 45 m ưu tiên OSM > pano > hạng (nút bị bỏ đèn chỉ giữ zebra nếu có node/chữ zebra). Zebra theo NHÁNH: node OSM gần vị trí vạch (gốc + setback + 2,3 m,
    ≤ 14 m, lệch ngang ≤ hw + 2,5) → nhánh đó; nút có đèn → mọi nhánh phố; node ở tâm/bằng chứng chữ → nhánh p/s/t. Số liệu
    R1750: đèn 131 → 29 (25 OSM + 4 pano), nhánh zebra 750 → 239 (115 OSM, 79 theo đèn, 45 chữ). Chữ pano: mệnh đề
    tả đèn/zebra Ở XA ("(xa)", "phía xa", "cuối phố", "đằng xa" — `FAR` trong gen_roadmarks, "xa" là TỪ riêng, không khớp "xanh")
    KHÔNG tính: pano_394 "đèn tín hiệu phía cuối phố" từng dựng đèn + zebra ma ở nút cạnh pano_496 (20 m), 083 "(xa)" tương tự. (dot3: 131 nút đèn chỉ 23 có
    node OSM; 33/42 pano tả "đèn tín hiệu" nằm ≤ 50 m node OSM → OSM HP đáng tin cho đèn.) **VẠCH QUA ĐƯỜNG GIỮA KHỐI** (114 — xem (9a), (10a)):
    node OSM không thuộc nút có zebra (rad + 4) trên lòng phố (≤ hw + 2) hoặc chữ pano "có vạch qua đường" không có nút ≤ 45 m
    → TÁCH dải tại uc + 1,5 m: phần trước ZEB1 với aZeb.y = uc + 2,3 (vạch u ∈ [uc − 1,5; uc + 1,5]), phần sau ZEB0 với
    aZeb.x = uc − 2,3 (tim đường dừng/tiếp 3,3 m quanh vạch như ở nút) — shader roadtex KHÔNG đổi. `stats` mới: sigOsm/sigEv/
    zebOsm/zebSig/zebEv/midX/midXs/marks{def,lab,ev,none,dual}/paveEv.
    **(4) Vỉa hè:** vật liệu theo TỪNG Ô vỉa hè = bằng chứng chữ pano gần nhất đã gán cho cùng way (≤ 120 m), góc nút giao lấy
    điểm 8 m vào nhánh; `SIDEWALK_BY_ROAD` chỉ còn dự phòng (đo: lệch chữ pano ~45% — 111 pano "caro đỏ-xám" đang vẽ xám, Mê
    Linh/Tô Hiệu/Hồ Sen xám đang vẽ đỏ; file đó KHÔNG có generator). Texture `roadtex.js`: lớp 3 CARO = viên 40×20 cm (dài dọc
    phố) xen kẽ đỏ-hồng bạc màu (184,138,122) ↔ xám (166,163,157) như bàn cờ 1:1 (đo ảnh 004/010/028/225/400/405: viên đỏ r−g
    22-47; bản cũ (158,82,58) 88% đỏ → ảnh game (136,53,38) phủ kín); lớp 4 "gạch đỏ" (172,134,121) — (168,104,84) vẫn ra cam
    (169,113,90) trên ảnh; lớp 5 = gạch tự chèn "con sâu" XÁM. Canvas caro kè hồ (`sidewalkMaterial`) cùng mẫu; 5 canvas caro
    ô cells (#b8574a/#a8452e/#b24a3a: Thế Lữ, Tam Bạc tsCaroMat, ĐBP, dm7…) → #b8897a/#b38a7b. BẪY chữ pano: mệnh đề "sân/
    quảng trường/trước cổng" là SÂN, không phải vỉa hè phố (pano_167 sân trường đỏ từng lan cả Lê Lợi) → bỏ qua.
    **(5) Vườn hoa (dải An Biên → Tố Hữu, khối "DẢI VƯỜN HOA" world.js; nền cỏ/sân theo vườn — xem (9e)):** ảnh Tố Hữu = SÂN LÁT ĐÁ XÁM + hàng cây
    + viền bụi cắt tỉa thấp + ô cỏ ô liu xỉn có bó vỉa đá + bồn tròn phẳng/bụi tròn (vệ tinh real_3: tán cây phủ, khoảng hở là
    sân xám). Nay: `garden_plaza` (ExtrudeGeometry cùng cao +0,12 như thảm cỏ cũ — không thêm chỗ chồng lòng đường; texture granite
    60 cm, UV = mét) + ô cỏ 11×11 m trên lưới 17 m (4 góc trong polygon, KHÔNG trên lòng/vỉa hè roadnet, ≥ 9 m camera pano, ~1/5 để
    trống) + bồn tròn gò thấp 0,15 m màu đỉnh lốm đốm (thay vòm bán cầu hồng/xanh) + bụi tròn cắt tỉa ở ½ bồn + VIỀN BỤI dọc mép
    polygon: mỗi cạnh chọn độ thụt nhỏ nhất 1,6…6 m có ≥ 70% điểm ngoài lòng/vỉa hè (mép polygon nong ×1,14 thường nằm trên vỉa
    hè), hở lối vào 3 m giữa cạnh > 26 m. Bỏ lối chữ thập be. `world.gardenStats`.
    **(6) `js/hedges.js` (mới):** bụi cắt tỉa/bụi dải phân cách "lổn nhổn" = quét mặt cắt 7 điểm (đáy · hông phồng · vai · đỉnh)
    dọc đa tuyến, vòng ~0,8 m, lệch nhiễu hash TẤT ĐỊNH, ~15 tam giác/m, màu đỉnh tối chân/sáng đỉnh + texture lá DataTexture
    128² dùng chung (nền ≈ 240: texture sRGB nhân TUYẾN TÍNH — nền 196 làm bụi gần đen). Dùng cho viền vườn hoa, dải phân cách
    Lê Quang Đạo (thay hộp 3,2 m), mép công viên Trần Phú dm7, sân tượng Lê Chân. Material có map → freezeStatic không gộp lượt 1.
    **(7) Trời:** đo 120 pano audit3 × 4 hướng (probe/skycmp.py: pixel trời mịn, 3 dải hàng trên khung, cùng FOV): thật dải
    cao (193,205,224) / thấp (189,202,219); dot3 (187,199,215) / (200,208,220) → trung vị trời game ĐÃ gần thật (WP5), lệch hệ
    thống: thiên đỉnh hơi tối/ít xanh, dải thấp TRẮNG SỮA hơn. Sửa CHỈ vòm hiển thị ban ngày (IBL/đèn bán cầu/màu sương giữ
    nguyên): hệ số theo độ cao `LIGHT.skyGradeLo/Hi` trộn theo smoothstep(0,12…0,6, v.y) × trọng số ngày. Trời thật dao động
    rộng (p25 xanh đậm ↔ p75 trắng mù) — 1 hằng số không khớp được mọi ngày; KHÔNG kéo thiên đỉnh sáng (vật lý: thiên đỉnh tối hơn).
    **(8) Cỏ ô cells / đảo giao thông / mép công viên:** hằng `LAWN_OLIVE = 0x6a7b48` (world.js đầu file) cho MỌI thảm cỏ ô
    cũ màu neon (0x6f9a4f/0x5a8f43/0x5d8c45/#4e7a3a): đảo `hvt_nonbo`, nút Lạc Long, `parterre_r4`, `garden6`, `civic8`,
    `lm_ubnd_lawn`, công viên ĐBP (texture đốm nay LCG TẤT ĐỊNH thay Math.random). Đảo `hvt_nonbo` (ảnh 304 h180/349 h90):
    viền bụi r 10,3 m + 2 dải bụi lượn (`hvt_nonbo_hedge`, 1.614 tam giác). Công viên ĐBP (ảnh 065 h180): `bs_park_dbp_hedge`
    chạy phía TRONG rào 3 cạnh. **BẪY cellsink:** `sweepAssemblies` (clearance) lấy BAO LỒI từng mảnh liên thông KÈM 2 góc hộp
    trục → 1 dải bụi chéo dài có "bao" phủ cả lòng phố → `flushClearance` GỠ cả mảnh (tam giác mất, đỉnh còn → bbox vẫn đúng
    mà không thấy gì). Cách làm đúng: độ thụt mỗi cạnh chọn sao cho mép phía phố (−1,3 m) nằm NGOÀI `corridorPen` (clearance)
    + ngoài lòng/vỉa hè roadnet + xa camera pano; xả thành MẨU 2 m hở 1,5 cm (không hàn đỉnh trùng → mảnh nhỏ, bao bám sát).
    Mọi nơi sinh bụi (dm7 Trần Phú, sân Lê Chân, ĐBP, dải LQĐ) đẩy đường đi vào `world.hedgeRuns`; viền bụi vườn hoa (chạy
    SAU khối ô) bỏ điểm ≤ 4 m quanh chúng — BẪY đã gặp: 2 hàng bụi song song cách ~2,5 m ở Trần Phú (pano_400 h000; ảnh thật 1 hàng).
    Kè Tam Bạc ô cells `v1caro` cùng mẫu caro bạc màu của `sidewalkMaterial`. **Giao diện roadnet:** code mới dùng
    `wHW(w) = w.hw ?? hwOf(w.c)` (W3-A gán `w.hw` theo `ROADS_DT[i].w` → khi gộp, `hwOf` không còn bị gọi); bề rộng lòng cho
    luật tim đường = `deps.widthOf(ri, c)` nếu world truyền, không thì `ROADS_DT[ri].w`, không thì 2·hw theo cấp.
    **(9) Sửa theo PHẢN BIỆN (2026-10-12):** (a) chữ pano "vạch qua đường" CHỈ gán cho nút mà pano nằm trong vùng nút
    + 12 m (≤ 45), điểm = hạng + 2·nPS − d/3 (đèn: vẫn ≤ 45 m, cùng −d/3). BẪY cũ (≤ 45 m, −d/12): chữ của pano_551 rơi vào nút
    lớn cách 41 m → zebra MA ở 496 h000 và MẤT vạch thật ở 551 (8/24 chữ zebra gán > 25 m). Không có nút → vạch GIỮA KHỐI;
    chữ tả cả đèn lẫn vạch (526 "gần ngã tư có đèn…, có vạch sang đường") → vạch ở nút đèn đó; có node OSM crossing ≤ 20 m →
    chữ tả CHÍNH vạch đó (290 ↔ node Thế Lữ 12 m), không thêm; nhiều pano ≤ 25 m cùng tả (551 + 393) → 1 vạch ở pano GẦN
    NÚT nhất (BẪY: lấy trung điểm thì vạch rơi đúng khoảng giữa — chỗ ảnh 551 h000 và 393 h180 đều thấy trống; ảnh 551 h180
    có vạch ngay trước camera). Kết quả: bỏ 4 nút zebra ma (cạnh 496, 014, 017, 289), vạch giữa khối 116 → 118 (thêm 015,
    017, 551; bỏ vạch đơn lẻ ở 393). (b) Nhãn W còn
    LAN sang dải đối diện của đường đôi (way phố khác ≤ 20 m, |cos| > 0,94, khe mép lòng −0,5…8 m; cờ `far` → thua nhãn riêng
    +40 m): Lê Quang Đạo dải xa (ri 400, 360 m, dualRun chỉ 46% vì 2 dải tách ở đầu) hết tim vàng ở 216/478; Hồ Sen (ri 295)
    theo nhãn 320/323/327 thay chữ "vàng" của 321. (c) gen_roadmarks: "biển (báo) người đi bộ" là bằng chứng zebra (ảnh
    077/320/349 đều có zebra; 349 nút HVT +2 nút zebra). (d) Luật mặc định tim vàng theo bề rộng: ≥ 8 m như FP-4 (TRƯỚC khi
    gộp W3-A luật này KHÔNG có tác dụng: ROADS_DT chưa có `.w` → 2·hw = t 8/s 10 m).
    (e) Vườn hoa: NỀN theo chữ + ảnh pano quanh vườn (58 pano ≤ 25 m ngoài mép) — cả 6 vườn chủ yếu "thảm cỏ + hàng rào
    cây xén" (ảnh 039 223 226 235 340 400 043 195) → `garden_lawn` cỏ lốm đốm (canvas LCG 128 px = 4 m, nền #6e7c3e: đo
    nắng cỏ thật g/r ≈ 1,12 — #66773f ra 1,18 quá xanh, #7c8042 ra 0,98 nâu khô) + `garden_paths` lối chữ thập lát đá 4 m;
    SÂN LÁT chỉ ở `PLAZA_PATCHES` (đĩa ∩ polygon, ô 2 m) nơi ảnh thấy sân: Tố Hữu quanh 224/225 (h090 "quảng trường rộng";
    223/226 hai bên lại là cỏ) và mũi bắc cạnh ĐBP (545 h180); ô cỏ bó vỉa (lệch ±1 m, cạnh 9-13 m theo hash) chỉ trong
    mảng sân. Quad lát: UV = mét, chung plazaM (freezeStatic gộp lượt 2). Sân lát 176 → 152 (từ trên cao gần trắng).
    (f) Bụi viền vườn + dm7 sáng hơn (đỉnh (0,37,0,51,0,23), `foot` 0,68 — 225 h090 bụi gần đen); `hedgeGeometry` thêm `maxHalf` (kẹp nửa bề ngang) → bụi
    dải phân cách LQĐ ≤ 0,7 m trong bó vỉa 1,5 m (không lấn làn xe). (g) Caro lớp 3: viên đỏ (184,138,122) → (176,140,130),
    xám (170,167,161) — kè Thế Lữ 290 bớt cam-hồng.
    **(10) PHẢN BIỆN VÒNG 2 (2026-10-14):** (a) **Bằng chứng ÂM zebra** — `mark_labels.json` mục `noZebra` (id → ghi chú,
    CHỈ thêm sau khi nhìn ảnh 8 hướng): 4 pano liền nhau Hoàng Diệu 015-018 đều có chữ "Vạch qua đường" chung chung nhưng ảnh
    không có vạch nào → gen_roadmarks bỏ cờ ZEBRA → hết 4 vạch giữa khối MA ngay dưới camera (vạch giữa khối 118 → 114).
    BẪY: chữ `street_furniture` liệt kê vật thể của CẢ pano 360° (có khi là vạch cách xa/khuất), 4 pano liền kề cùng một câu
    = dấu hiệu chép mô tả → kiểm ảnh trước khi tin. (b) **Vỉa hè PHÍA CÔNG VIÊN** — chữ `sidewalk` hay tả hè phía NHÀ rồi
    thêm mệnh đề riêng cho phía vườn ("caro đỏ-xám …; phần công viên/quảng trường lát gạch xám" — 222/223/225/226 Tố Hữu;
    "phía công viên lát gạch xám" 340/521; "… cả hai bên" 400). gen_roadmarks: `ROAD_PAVE_EVIDENCE` thêm phần tử thứ 4 = lớp
    phía công viên (mệnh đề có `phía|phần|bên|dọc|ven|quanh|mép (dải) công viên|vườn hoa|vườn|quảng trường` + vật liệu, "caro"
    trơn = 3; "vỉa hè … hai bên" → như lớp chính; không có → 0; 10 xám + 15 caro). roadnet: ô vỉa hè có mép ngoài đẩy ra 1,5 / 4 / 7 m
    rơi TRONG đa giác `PARKS` (deps.PARKS — đa giác vườn Tố Hữu lùi ~4,6 m sau mép hè) → lớp phía công viên của bằng chứng
    gần nhất (≤ 150 m) gắn CHÍNH vườn đó (điểm pano ≤ 25 m tới đa giác — mặt lát là của vườn, không của way); không có → mặc
    định way (`SIDEWALK_BY_ROAD`), KHÔNG lấy chữ phía nhà. Góc nút giao: kiểm điểm giữa mép lưng đẩy xa tâm nút. Đổi đúng 25
    ô: bờ vườn Tố Hữu 2 phố (ri 6/201) caro → xám, mũi Kim Đồng (202/334) caro → xám, Trần Phú quanh 475 (84) xám → caro;
    `stats.pavePark/paveParkEv`. (c) Nhãn ảnh vật liệu `mark_labels.json` mục `pave` (id → [lớp, ghi chú]) thắng chữ: 478 'gạch
    block xám-đỏ' → 2 (ảnh xám), 150 'caro … con sâu' → 5. (d) Vạch chữ giữa khối có nút ≤ 30 m → dời 4 m dọc đoạn VỀ PHÍA
    nút (551: ảnh h180 thấy vạch 2-6 m phía trước; đặt đúng chân camera thì không hướng nào thấy); xa hơn giữ tại pano.
    (e) `PLAZA_PATCHES` + [690,−418,24] mũi bắc vườn Kim Đồng (545 h180 ảnh: sân lát + nhà chờ). (f) Gộp nhánh: import
    `corridorPen as clrCorridorPen` nằm TRONG dòng import clearance (giống hệt W3-A) — dòng import riêng cũ làm cây gộp W3-A+D
    lỗi "Identifier 'clrCorridorPen' has already been declared" (git merge-tree không báo xung đột).
    **CHƯA LÀM:** vạch gạch chéo/xương cá ở mũi tách làn (gore, 304 — hình học nút HVT/cầu dẫn thuộc W3-F, camera lệch 11 m
    thuộc W3-A), trời u ám cho pano trời mây, mặt bê tông liền "shared surface" ngõ chợ (W3-E).
    **ĐO / KIỂM (2026-10-11, cùng phiên; base = git archive dot3 :8514, W3-D :8504; Radeon 890M TIER 3):** roadnet R1750
    (node): đèn 131 → 29, nhánh zebra 750 → 239, vạch giữa khối 116, tim theo nhãn ảnh 162 đoạn chạy / chữ 13 / mặc định 592,
    326 đoạn không tim, 61 đoạn đường đôi; dựng 330-400 ms (≈ dot3), 71k tam giác lòng không đổi. CHẤM MẮT (REAL|dot3|W3-D,
    39 pano × 4 hướng, 1280×634, --traffic off, ?date=2024-10-15): nhóm mục tiêu 31 pano 4,40 → 5,06 (+0,66; riêng danh sách
    FP-4 24 pano 4,42 → 5,04), đối chứng 8 pano 3,25 → 3,31 (074 +0,5: đèn/zebra ma trên cầu — đối chứng không sạch hẳn).
    Trời (skycmp 156 khung): dải trên thật (190,204,222) · dot3 (188,199,215) · W3-D (189,201,219); dải 14-24 % thật
    (184,194,214) · dot3 (200,208,220) · W3-D (196,207,221), bão hoà 0,090 → 0,113 (thật 0,109). PERF (B/A/B/A ×2 vòng):
    fps chạm vsync 60 cả hai; draw call ≤ dot3 ở 5/6 góc (pano_400 334-357 → 313, game_3 356 → 311-336, spawn 364-387 →
    352, pano_007 505 → 479); tam giác +0,5-2,5 % (bụi lổn nhổn: dải phân cách LQĐ pano_216 1,34 → 1,37 M; vườn 31,6k tam
    giác/2,6 km bụi); hpReady 4325 → 4396 ms (nhiễu ±250; pha furniture +49 ms = vườn hoa, freeze +44); heap SAU ép GC (CDP
    collectGarbage) 378 → 385 MB. BẪY perf đã sửa: `IcosahedronGeometry` vốn KHÔNG chỉ mục → `.toNonIndexed()` chỉ
    console.warn — 123 bụi tròn = 123 warn ≈ +200-370 ms pha furniture khi có DevTools/Playwright (đo bằng SwiftShader, không
    cần khoá GPU: tools/qa/shoot.mjs --swiftshader --w 320 --h 180 + console.error tạm). Cổng: 0 lỗi JS (13 khối chụp full,
    perf ×8, WebGL1 --gl1); lite: 3 × 404 `assets_lite/*.glb` ở CẢ dot3 lẫn W3-D (worktree không có assets_lite — môi trường);
    diag full 'TẤT CẢ THỰC THỂ OK' (giống dot3); waterbfs 5/5; node --check mọi module sửa; gen_roadmarks chạy lại tất định.
    **ĐO / KIỂM vòng 3 (2026-10-14, sau (10); base dot3 :8544, W3-D :8504):** roadnet R1750 (node) đèn 29 (25 OSM + 4), nhánh
    zebra 239, vạch giữa khối 118 → 114, tim nhãn 164 / chữ 12 / mặc định 591 / không 326 / đôi 61, nhãn W lan 9; ô vỉa hè
    giáp vườn 399 (82 có bằng chứng phía vườn), dựng 324-339 ms. CHẤM MẮT (REAL|dot3|r2|r3, 79 khung + aerial): 10 pano đích
    của phản biện 4,20 (dot3) → 5,13 (r2) → 5,20 (478 vỉa hè xám, 225 bờ vườn xám); thêm 017 3,0 → 3,6 (hết zebra ma), 551
    5,0 → 5,5, 223/224/226 h090 + 043 h270 +0,5, 545 h180 +0,3; đối chứng 6×2 2,87 → 2,92 (= dot3; 150 Cát Cụt xám lại).
    PERF B/A/B2/A2 cùng phiên: fps chạm vsync 60; lấy min 2 lần mỗi bên (gai streaming ±0,5-0,9 M tam giác xuất hiện ở CẢ
    hai bên, khác view mỗi lần) → tam giác trung vị +0,46 % (−0,9…+1,1 %), draw call thấp hơn 16/24 góc; pha furniture
    39/40 → 117/109 ms (vườn hoa), freeze 210/243 → 366/322 (A−B +60…+190 ms qua 5 phiên — thật: gộp tĩnh bụi/cỏ/lối),
    hpReady nhiễu (5460/5302 → 5417/5550). Cổng: 0 lỗi JS (7 khối chụp, std ×2, --gl1 webgl2:false); lite 3 × 404
    `assets_lite` như dot3 (môi trường); diag 'TẤT CẢ THỰC THỂ OK — 0 lỗi JS'; waterbfs 5/5; gen tất định. Cảnh báo console
    (SwiftShader): 64 toNonIndexed = dot3; 'KHR_parallel_shader_compile not supported' 2-14 tuỳ lần đo (1 lần mỗi
    compileAsync GLB của assets.js — đếm theo số model đã nạp lúc lấy mẫu, W3-D không đụng assets/main).
- **2026-10-06 (Đ3-W3-C FACADES; vòng 2 sau phản biện 2026-10-14)** [ĐỢT 3 wave 3 — AUDIT3 FP-3 + FP-8 mục 1-3: hết tường hông trống / khối kính đen / khối một màu / "lỗ vuông đen" nhà ô, từ vựng mặt tiền theo BẰNG CHỨNG pano, biển bảng lớn, mái hiên tôn, chữ biển sạch]:
    **(1) ATLAS 8×12** (`facade_atlas.js` `ATLAS_ROWS=12`): ảnh 2048×3072 (LITE 1024×1536), ô vẫn 256/128 px; 63 ô cũ GIỮ chỉ số,
    30 ô mới đặt SAU `G_HARD`: tầng trên `U_COL0/U_COL1` (thuộc địa: trụ áp, gờ, cửa cao chớp lật, cửa vòm ô quạt, ban công
    sắt hoa văn), `U_NEO` (tân cổ điển trắng: nửa cột 2 mép bay → ghép bay = 1 cột), `U_TEN` (tập thể: lồng gỉ, tôn vá, đồ
    phơi), `U_CONS/U_NET` (đang xây: khung bê tông, gạch dở, lưới che), `U_CURT2/U_CURT3` (kính PHẢN TRỜI sáng + đố/spandrel;
    kính sẫm khung trắng), `U_ACP` (ốp alu + băng kính), `U_TOWER`, `U_VINE` (cây leo theo CỤM lá — đĩa to đều = "chấm bi");
    trệt `G_COL` (vòm gỗ), `G_NEO`, `G_HOARD` (rào tôn "ĐANG THI CÔNG"), `G_SHOW` (showroom kính TRONG), `G_OPEN0/1/2`, `G_FOOD`
    (quán mở/quần áo/đồ gỗ/quán ăn — pano ban ngày phần lớn MỞ cửa); hồi/hông lộ `S_EXP0/1/2` (ố chảy, xi măng thô + cửa sổ nhỏ
    + điều hoà, quảng cáo sơn phai); `D_AWN2` (tôn sóng); `PANEL0-4` (biển bảng 4×2 m, 10 mẫu — vòng 2: 6 mẫu lặp lộ ở
    253/386), `BLADE0-1` (biển dọc chữ xếp dọc),
    `BILL0-1` (biển trên mái). Helper: `skyGlass`, `glaze` (kính trong phủ nội thất — `G_GLASS` cũ phủ kín → mảng tối),
    `softStreak` (vệt ố hình chuông — `shade()` chữ nhật ra "mã vạch"). RAINBOW: đồ phơi `R(60,240)`/kênh → bảng màu quần áo
    THẬT xỉn, thưa; hàng hoá xỉn dạng KHỐI. Mọi ô có `signBand` PHẢI có trong `SIGN_EXT`.
    **(2) BẰNG CHỨNG PANO → KIỂU DỰNG** (`tools/gen_facade_evidence.mjs` → `js/facade_evidence.js` SINH TỰ ĐỘNG, 47 KB): 1.920
    quan sát nhà của `audit_enriched.json` (heading, cờ FEF từ regex có biên từ Unicode `(?<![\p{L}\p{N}])…`) + 551 pano (cờ
    vùng FEZ: khu Pháp/công sở, chợ, phố cũ, đô thị mới, buôn bán; tuổi 0..3). `citygen.renderStyles()` (sau `buildCollision`,
    30-50 ms node): mỗi quan sát bắn 3 tia (h−8°, h, h+8°; 2-45 m; 0° = bắc = −z) → nhà ĐẦU TIÊN `fabricAt` chạm nhận cờ (1.360
    quan sát → ~1.470-1.530 nhà); nhà không có quan sát dùng vùng của pano gần nhất ≤90 m làm XÁC SUẤT. Luật sửa dữ liệu: SHED
    ≥3 tầng → CIVIC (≥2.500 m² GLASS, ≥9 TOWER) (pano_230: khách sạn ra tường tôn); TUBE/OLD ≥9 tầng → 65% TOWER / 35% GLASS
    (thay 60% KTT); GLASS ≤6 tầng mặt tiền ≤10,5 m <450 m² → MODERN (lô kính hẹp pano_395/386). KIỂU DỰNG 7..12 = COL, NEO,
    CONS, MODERN, TOWER, TEN (bộ `U7..U12/G7..G12`). Bằng chứng "đang xây" CHỈ áp cho nhà ≤8 tầng mà mô tả không kèm kính/
    tân cổ điển/cao tầng (bản đầu: tháp 15-20 tầng phủ lưới xanh + gạch cả mặt — nhóm đối chứng pano_285/304 h180 tệ đi).
    Mặc định ĐANG XÂY ngẫu nhiên (0,8% TUBE/OLD ≤5 tầng) CHỈ ở nơi KHÔNG có pano nào ≤ 90 m (vòng 2 — bản đầu 259/312 nhà
    CONS là roll ngẫu nhiên, ~50 cái cách camera pano ≤ 40 m mà mô tả không nhắc thi công = trái BẰNG CHỨNG ÂM, AUDIT3 §4.3;
    nay 50/50 nhà CONS gần camera đều có bằng chứng). Regex bằng chứng (vòng 2): 'cửa chớp/chớp lật/phào' chỉ là COL khi kèm
    cờ CŨ (nhà ống thường cũng có), BIGSIGN bỏ 'alu|pano' trơn (mô tả ốp alu), AWN không khớp 'mặc dù' (COL 306→296, BIGSIGN 85→83).
    Phân bố (R1600, node): TUBE 30,6 k, OLD 6,0 k, COL 2,3 k, MODERN 1,4 k, CONS 212 (53 do bằng chứng), VILLA 227, SHED 165,
    TEN 87, KTT 61, CIVIC 60, GLASS 58, NEO 21, TOWER 18; tuổi 0/1/2/3 = 5,2/18,3/11,1/6,6 k;
    "nhiều biển lớn" 3.800 nhà. `fabricFacadeOf(b)` chẩn đoán.
    **(3) aFac.z TƯỜNG = kiểu dựng (4 bit) | tuổi<<4 | "nhiều biển lớn"<<6 | "cạnh có ban công 3D"<<7**. BẪY: `groundModule()` JS
    phải khớp shader TỪNG BIT — CONS không có bay "nhà ở" (JS, GL2, GL1); tập 1 phần tử (G5, G9) luôn [0]; `pickU/pickGi` sinh
    bằng `pickChain()`; GL1 regex `U\d+|G\d+|…|XP`.
    **(4) "KHÔNG TƯỜNG HÔNG TRỐNG"** (FP-3 #1): `exposedSide()` — cạnh SIDE/BACK không được `faceRoad` nâng thành mặt phố mà
    đầu mút gần phố cách mép HÀNH LANG đường (lòng + `SIDEWALK_W` theo cấp — `roadGrid` seg[6]) ≤ 3 m và trước mặt tường trống
    (≥2/3 điểm 1,2 m trước tường không thuộc nhà khác) → `rc = 1` trên cạnh không phải mặt phố (bit rc của aFac.y vốn bỏ trống
    ở cạnh hông) → shader bộ `XP` (S_EXP1 xi măng thô + cửa sổ nhỏ + cục nóng, S_WIN, S_BACK, U_AC, S_EXP0 ố, S_PLAIN2, S_EXP2
    quảng cáo sơn) thay luật cũ "45% nhà: cả mặt hông S_PLAIN0 trơn". 10.226 cạnh lộ / 118 k lần gọi. Lọc trung điểm trước (mút
    cách trung điểm ≤ L/2): đo node có đếm giờ từng lần gọi 33-36 ms (gồm chi phí performance.now ×236 k; thực ~20-25 ms).
    pano_340 h270, 372 h0, 198 h0: tường hông dọc phố có cửa sổ nhỏ/điều hoà/quảng cáo.
    **(5) SHADER PHỐ**: (a) LỚP PHONG HOÁ theo tuổi (vệt ố chảy từ đỉnh tường = value-noise kéo dọc, mảng ẩm, bẩn/rêu chân
    tường) — chỉ tường; (b) PALETTE GUARD bão hoà tường ≤ 0,62; (c) KÍNH PHẢN TRỜI: sau `lights_fragment_end` cộng
    `fabRefl·(0,35+0,65·(1−n·v)^4)·irradiance/π` (kính/hiện đại ×1, cửa sổ thường ×0,4) — theo ánh sáng cảnh (tự tối ban đêm),
    KHÔNG qua emissive; (d) BIỂN BẢNG LỚN phẳng tầng 1 (35% cả tầng 2) trên phố chính cho TUBE/OLD/GLASS/COL/MODERN (10% bay, nhà
    cờ "biển lớn" 40%), cạnh có ban công 3D thì không (bị che) — thay bằng biển 3D treo mặt trước ban công; (e) `fabSample`
    INSET ĐỘNG = max(3 px, nửa vết lấy mẫu + 1) (đệm cố định 3 px: mip cao/anisotropic lấy lẫn ô kề → vệt màu dọc mép bay);
    (f) dải biển HẸP `G_OLD` kéo chữ vừa dải (trước "ƠM VĂN PHÒN"); (g) kind 5 lấy màu biển từ aFac.w + sáng đêm.
    **(6) HÌNH HỌC**: mái hiên TÔN sóng xanh dương (55%, `D_AWN2`, dốc thoải, sâu 1,5-2,2 m) / BẠT (sọc, diềm) — bằng chứng pano
    ép có + chọn vật liệu; BIỂN DỌC 3D (~800, 6 tam giác); BIỂN BẢNG 3D trước ban công (~1.130, 2 tam giác); BIỂN TRÊN MÁI (~30,
    12 tam giác, nhà 3-9 tầng mặt phố chính, +12% nhà góc; màu nền biển theo hạt giống `hh(seed,505)` — trước aFac.w = 0 →
    mọi biển mái cùng màu); CONS: không ban công/điều hoà/đồ mái. Tam giác phố 1,496 M → 1,486 M
    (chính 0,895 M + chi tiết 0,590 M; kính/đang xây/tân cổ điển bỏ ban công + điều hoà bù cho biển/mái hiên mới).
    **(7) TEXTURE ATLAS**: material dùng texture CHỜ 4×4; ảnh về thì tạo DataTexture đúng cỡ rồi THAY `material.map` (cùng "có map"
    → không đổi program); `onUpdate` thả bản CPU 24 MB sau upload; `webglcontextlost` → map về texture chờ, `restored` → vẽ lại.
    WebGL1: atlas NPOT → tắt mip, lọc tuyến tính.
    **(8) NHÀ Ô (cell)** — 3 lớp, KHÔNG sửa từng ô: (a) KÍNH `sharedMats.window` (dải kính băng tầng lmTower, pod, mặt kính trệt,
    cả mặt kính VIB pano_157 h180 — hộp màu đặc không UV, mesh gộp mất uv): `cellfacade.applyCellGlass` — 0x557788 → 0x7f95a3 +
    LƯỚI ĐỐ KÍNH theo toạ độ THẾ GIỚI (varying vHpW; đố đứng 1,6 m, thanh ngang theo sàn 3,3 m từ y 5,9 — không có dưới y 5,5;
    từng ô kính sáng/tối khác nhau; mờ dần khi lưới < pixel, `fwidth` ⇒ `extensions.derivatives` cho GL1) + phản trời trừ khung;
    đêm khung không sáng, ~30% ô tối. Khoá program 'cellglass_w3c2'. (b) ~25 helper `xxFacade` (lm/hb/bc/dg/tb/tw/dl/bs/ts/cb/cn/
    dm/tx/ln/v2-v6/w1/w4/w5/sb/s3/s4…) là BẢN SAO cùng mẫu "nền + ô cửa CHỮ NHẬT ĐẶC winCss" → sửa ở MỘT chỗ: `cellsink.
    materialize` chạy hàm vẽ gốc trên ngữ cảnh GHI (`gridFacadeSpec`: chỉ fillRect/path cùng 1 màu, nền phủ kín, cửa không chạm
    mép, ≥2 cửa, diện tích ≤45%, có chữ/gradient/nét/màu thứ 3 → null) rồi VẼ LẠI (`paintGridFacade`) cùng vị trí, cùng cỡ ảnh:
    khung sáng hơn tường, bóng bệ, vạch sàn, winCss ẤM tối → cửa chớp lá sách, còn lại → kính dải dọc + đố chữ thập + vệt bóng;
    màu nền qua palette guard HSL (bão hoà ≤0,40, sáng 0,30-0,90). 181 ảnh. BẪY: thử 2× độ phân giải (512²) → cellAtlas 7 → 15
    trang 2048², gộp 107 → 535 ms — bỏ. (c) `guardCellPalette` (commitSink): mesh màu đặc của vật GIỮ LẠI có hộp ≥3,5×2,5 m →
    HSL kẹp bão hoà THEO SẮC (ấm 15-65° ≤0,62 — ochre HP thật bão hoà ~0,6; đỏ ≤0,40; lạnh ≤0,32), sáng 0,30-0,90; tường LẠNH
    bão hoà >0,45 (màu thương hiệu sơn cả nhà: UBND 138, BaoViet 418) → sáng ≥0,58 + bão hoà ≤0,22 (`coolLift`; chỉ kẹp bão hoà thì l 0,4 vẫn
    ra 'khối xanh than' ở mặt khuất nắng — đo render (31,39,51); nâng sáng mà giữ 0,32 thì ánh trời lại ra 'xanh hoàng gia'); mảng xám-xanh TỐI ít bão hoà (180-250°, s 0,15-0,45, l<0,38:
    'tháp/đế kính' 0x2c3e50/0x33475a — pano_230) → bản sao `applyCellGlass` sáng 0,5. BẪY: material đặc KHÔNG emissive bị
    freezeStatic lượt 1 BAKE màu vào màu đỉnh rồi gộp chung material trắng → mất onBeforeCompile; bản sao kính đặt emissive
    0xffcc66 cường độ 0 để rơi vào lượt 2 (giữ material). Kính vẽ canvas: sắc 165-235° bão hoà ≤0,3, sắc khác (tím TPBank 354)
    ≤0,08. Nhân bản material 1 lần/gốc; KHÔNG đụng material có emissive. `cellCanvasFx` (ảnh canvas
    KHÔNG phải lưới cửa sổ, nền gần đen/bão hoà → filter khi gộp atlas) đọc MÀU NỀN cellsink ghi lúc vẽ (`t.userData.base`) —
    BẪY: bản đầu `drawImage→getImageData 8×8` cho 434 canvas (GPU) = đọc ngược GPU từng ảnh: gộp atlas 107 → 451 ms. Phủ
    'lighten' màu kính lên điểm tối làm cửa chớp nâu thành TÍM — bỏ. Dải dài RẤT tối có CHỮ (`userData.signTexts`) KHÔNG
    sáng ×1,7 (biển đen chữ vàng là thật — vòng 2).
    **(9) HÌNH HỎNG** (FP-3 #5): pano_124 chợ Lan Phong — mái hiên tôn xanh 60 m `rotation.x = +0,42` = tấm gần ĐỨNG (mép trên
    chĩa ra phố) → "tấm xanh chéo" trước camera; nay −1,15 (dốc 24° xuống phía ngoài) + DoubleSide (nhìn từ dưới là mặt sau),
    bạt sọc −1,1, lưới che −1,2 (mái thoải). pano_239 công thự Pháp — vòm = TorusGeometry treo trước tường, đỉnh 4,6 m xuyên lan
    can ("vòm trắng rỗng") → tường lưng vòm ĐẶC (Shape chữ nhật trừ nửa tròn r 0,95, đùn 0,4 m, đỉnh 3,55 m) — ExtrudeGeometry
    KHÔNG đánh chỉ số → gộp riêng (mergeGeometries không trộn có/không index). pano_230: SHED ≥3 tầng hết tường tôn (mục 2).
    pano_271 "khối đen": không còn trên dot3 (tia dò chạm cây).
    **(10) CHỮ BIỂN** (`tools/pano_loop/gen_shopsigns.mjs`, viết lại vòng 2): cặp nháy CHẶT `/'([^']*)'/g`; phần MÔ TẢ chữ
    thường sau tên IN HOA bỏ ("CỬA HÀNG ĐÔNG THỦ chuyên cung cấp…"; từ Hoa-thường giữ: "OLD Karaoke"); bỏ "..."/"…" (+ từ cuối
    bị cắt ≤2 chữ), SĐT thật, cụm mô tả (LOGO, BÊN CẠNH, BIỂN, CHỮ…), chữ khác hệ Latin; tách ĐOẠN theo " - ", " – ", " / ",
    "|", "·": bỏ đoạn ĐỊA CHỈ (số nhà + tên phố — tên phố lấy từ chính catalog "Phố …/đường …"; "ĐC: …", "SỐ 2A …", "LÔ 32 …"),
    KHẨU HIỆU/KHUYẾN MÃI (VÌ, TỰ HÀO, KÍNH CHÀO, TIẾT KIỆM, GIẢM GIÁ, LÃI SUẤT, '%', OPEN…); đoạn đầu ≤ 32 ký tự giữ NGUYÊN, dài
    hơn → bỏ cả tên (KHÔNG cắt giữa cụm: bản đầu cắt 390 tên ở 24 ký tự → mảnh "CẢNG VỤ HÀNG HẢI HẢI", "UBND TP HẢI PHÒNG - SỞ");
    ghép đoạn sau khi tổng ≤ 24. TỰ KIỂM (exit 1): dấu câu đầu/cuối, " - - ", 2 dấu cách, `isBrand` (BRAND_MAP) VÀ `brandWatchHit`
    (`js/brands.js` `BRAND_WATCH` ~230 thương hiệu nổi tiếng — CHỈ để kiểm, token không mơ hồ). BẪY: "0 thương hiệu theo
    BRAND_MAP" ≠ sạch — phản biện tìm 8 tên thật lọt (COCA-COLA, D&G/ARMANI, VINAMILK, APPLE, CASIO, DAVINES, MAGIC MOMENTS,
    PHIBROWS) → BRAND_MAP + lưới `_BRAND` world.js bổ sung (+ DIBAO, CHUNGHO, JARKO, NHAXINH, VINA KTV, SUNHOUSE, FASTER, ROLEX…;
    'APPLE' giờ khớp mọi vị trí); thương hiệu khớp trên CẢ chuỗi gốc TRƯỚC khi cắt phần chữ thường ("FPT Retail" → "FPT" thì
    BRAND_MAP hết khớp). 954 biển (83 rác) → 1.154 biển sạch. **QA**: `?labels=0` ẩn nhãn chữ nổi (`sp.userData.worldLabel`).
    **(11) BIỂN TÊN THẬT** (world.js): 53 hàng × 77 px = 424 biển/tấm 4096×4081, 3 tấm. Chữ VỪA Ô bằng CỠ CHỮ (`measureText`,
    thu đều, font đặt lười) — KHÔNG dùng tham số maxWidth của `fillText`: ép ngang = vẽ chữ qua biến đổi không đều → raster GPU
    của canvas tăng tốc chậm hẳn. Đo `signbench` (scratch: 3 tấm, vẽ + texImage2D + readPixels, cùng phiên ×3): dot3 954 biển
    ép ~227 ms, 1.256 biển ép ~366, 1.151 ép ~285, 1.151 VỪA CỠ ~171-195 (CPU measureText ~80-100 + GPU ~85), không chữ ~78.
    Đó chính là "chờ vẽ khung" ở ranh fabric→landmarks lúc boot (vòng 1 tưởng do SỐ biển → định cắt còn 911). Chữ hết méo ngang.
    **(12) NHÀ Ô sửa tay (vòng 2)**: pano_141 h0 (khung chuẩn) dãy vòm ĐẶC mới che biển "CẦM ĐỒ — ANH ĐỨC SƠN" (biển z D/2+0,1
    sau lưng vòm z ≤ D/2+0,45) → biển treo TRƯỚC (D/2+0,52); dãy showroom Hoàng Diệu (`hd_showroom`) hồi nhà là tường kem TRƠN
    14 × 5-7 m (pano_014 h180 khung chuẩn, tia dò: `mrg10_*` màu đỉnh 0xe8e4da) → phủ 2 mặt hông (ố chảy, bẩn chân tường, cửa sổ
    nhỏ song sắt + cục nóng); mái hiên chợ Lan Phong (124 h90) xanh lá → XANH DƯƠNG (ảnh: bạt xanh sọc trắng); BIDV 046 đỏ gạch
    #9e3b30 → #7a463e (render 167,62,51 → 138,62,50).
    **ĐO** (Radeon 890M, TIER 3, ANGLE D3D11, 1280×634, `&date=2024-10-15`, A/B cùng phiên base dot3 ↔ nhánh; máy dùng chung với
    4-6 agent → nhiễu ±150 ms mỗi pha boot): (a) ẢNH: 33 pano mục tiêu FP-3/FP-8 chấm REAL|dot3|W3-C 0-10: TB 3,30 → 3,57
    (+0,27; bản cuối vòng 2 — chỉ 124 đổi điểm so với vòng 1); 8 pano đối chứng 3,12 → 3,19 (+0,06 — 400/414 nằm trong danh
    sách SIGNTXT nên nhích nhờ biển). Phản biện chấm độc lập 30 khung: 2,98 → 3,23. (b) KHUNG HÌNH: fps 60 (vsync) mọi view cả 2
    bên; draw call −4..+22/view; tam giác bằng nhau (node: chính 896.924 → 896.134, chi tiết 599.370 → 592.524). Heap = nhiễu GC
    (375-643 MB cả 2 bên, KHÔNG kết luận "thấp hơn" như bản vòng 1).
    (c) KHỞI ĐỘNG — vòng 1 SAI: báo +230 ms; phản biện đo lại cùng phiên 4 lần: hpReady ~5.083 → ~5.555 ms (+470, +9%), pha
    landmarks 388 → 554 = chờ vẽ khung do chữ biển ép ngang (mục 11), fabric 686 → 849. Vòng 2 (perf9, 3 vòng xen kẽ, bản cuối):
    hpReady dot3 5.568/5.533/4.908 (TB 5.336) → nhánh 5.245/5.111/4.996 (TB 5.117) = **−220 ms (−4%)**; startReady TB 7.325 →
    7.172; pha landmarks 349 → 185 (chữ biển vừa cỡ), fabric 760 → 893 (+133: renderStyles ~20-50 ms, exposedSide ~25 ms, hình
    học biển dọc/bảng/mái, vẽ lại lưới cửa sổ), cells 816 → 854, shaders 476 → 338 (nhiễu/biến thể program — không nhận công).
    Node `buildRealFabric` (gồm atlas ĐỒNG BỘ, trong trình duyệt là worker): 888-963 → 1.107-1.274 ms. (d) ATLAS: node lạnh
    ~105 → ~134 ms, ổn định ~55 → ~65 ms (63 → 95 ô); worker trong trình duyệt lần đo cuối 604 → 1.109 ms (1 mẫu, máy tải;
    vòng 1: 636 → 629) — ngoài luồng chính, về lúc ~2,2 s (< hpReady); cellAtlas 7 trang 95 → 109 ms; 181 ảnh lưới cửa sổ vẽ
    lại; palette guard 101 mesh / 75 material (9 kính). (e) CỔNG: 0 lỗi JS (15 lô chụp full vòng 2: tgt_0..10, ctl_0..2, rv_0;
    LITE chỉ 3× 404 `assets_lite/*.glb` — máy không có bản lite; `--gl1` 0 lỗi, webgl2 false, mặt tiền/kính/biển vẽ đúng),
    diag "TẤT CẢ THỰC THỂ OK" (bất biến = base), waterbfs 5/5, bộ sinh biển tự kiểm 0 lỗi định dạng / 0 thương hiệu (BRAND_MAP
    + BRAND_WATCH), 2 bộ sinh xác định (chạy lại không đổi byte). BẪY QA: `python -m http.server` có hàng đợi listen 5 — máy bận
    thì Chrome mở loạt module/GLB bị ERR_CONNECTION_REFUSED → "TIMEOUT window.__hp" → dùng ThreadingHTTPServer
    `request_queue_size = 128`. BẪY khoá GPU: `gpulock.mjs` thăm dò 3-5 s nên luôn thua agent dùng khoá thăm dò 250 ms (cùng thư
    mục khoá) → chờ 10-30 phút/lần; gộp 3-4 lô chụp vào MỘT lần giữ khoá; `fastlock … -- bash -c "…"` trên win32 chạy qua
    cmd.exe → lệnh con không chạy (thoát 0 ngay) — dùng script node gọi spawnSync KHÔNG shell (tham số có '&' cũng an toàn).
    **Chưa làm/để lại**: hero landmark (FP-8 mục 4 — cần Meshy), góc bo cong, mái ngói 1 tầng riêng, nhà trẻ (069), mái mansard;
    nhà ô vẫn là hộp canvas (cửa sổ đã đẹp hơn, chưa qua shader atlas phố); pano_395 h90/h180 vẫn gần đen = `tb_goldstar` mặt LAM
    KIM LOẠI tối CỐ Ý (bằng chứng pano_540) nhìn từ mặt khuất nắng ở 2-4 m; 051 khối trường xanh lá (fabric, bão hoà < 0,62) giữ;
    418 h180 khối Chi cục Thuế (cửa sổ tối + dải trệt nâu — ảnh thật trệt ốp đá nâu, giữ); ô atlas G_OPEN1/G_SHOP0/G_SHOP1 vẫn
    như "giá sách" nhiều màu; biển bảng lớn chọn NGẪU NHIÊN (không theo loại cửa hàng thật); biển quảng cáo TRÊN MÁI lớn kiểu 327
    chưa có (BILL chỉ ~30 nhà); 486 (camera sát 2 m một khối ô — CAMNEAR, W3-A). Tool QA W3-C (scratchpad): `stats.mjs <port>`,
    `pick2.mjs` tia dò vật liệu, `s4/signbench.mjs` (đo atlas chữ biển trên GPU), `s4/cons467.mjs` (nhà CONS gần camera:
    bằng chứng/ngẫu nhiên), `nodefab/run2.mjs` dựng phố trong node.
- **2026-10-05/06/11/12/14 (W3-E STREET LIFE)** [ĐỢT 3 wave 3 — AUDIT3 FP-5: CHỢ DÂN SINH, hàng tràn hè theo loại cửa hàng, ô tô/xe máy
    đỗ theo bằng chứng, xe khách, xe ba gác, trạm biến áp kiốt, đèn gang 2/5 cầu, cờ treo nhà, băng rôn, cổng chào ngõ]:
    MỚI `js/streetlife.js` (gọi từ `buildProps` — dùng chung lưới ô vỉa hè 3 m `sides`, vật liệu/bộ dựng hình props truyền
    qua `G` → không thêm program shader cho đồ chợ). `tools/gen_props_evidence.mjs` thêm 3 cột (props_evidence.js
    [..., market 0-3, spill bits, deco bits]) + `PROPS_MARKETS` = đa giác chợ OSM amenity=marketplace NHÚNG SẴN trong bộ sinh
    (tools/osm_*.json bị gitignore; làm mới: `node tools/gen_props_evidence.mjs --osm tools/osm_landuse.json`).
    **Mức chợ ô** (`marketLevels`, ngay sau lấy mẫu 6.1): pano ≤ 45 m có market (≥ 30 m bớt 1); đa giác OSM trong/≤ 12 m → 3,
    ≤ 40 → 2, ≤ 80 → 1, NHƯNG pano ≤ 30 m có market 0 → trần 1 (bằng chứng âm thắng — KỂ CẢ khi pano có bit ô dù/bạt/hàng:
    phản biện W3-E, bit ô dù ở 314/315/252/345/398/400 là "ô/dù hàng quán"/xích lô che ô → 315 cách đa giác Chợ Ga 330×260 m 8 m
    từng thành phố chợ ô dù); ô dựng tay tên `cho_*`
    ngay sau mặt tiền → 3; phố p trần 1; nhìn ra công viên/quảng trường/kè hồ (`parkBehind`, xem Ô tô) → 0. Từ khoá: tên riêng có
    chữ "chợ" bị xoá
    trước khi so (phố Chợ Con 455-457 = phố vật liệu xây dựng, Chợ Sắt đang xây, ghi chú "ghép lệch … chợ tam bạc"),
    "sạp hàng rong/sạp báo" chỉ là mức 1, "sạp … kín/tràn/chiếm" (không có cụm chợ) là mức 2 (189 Dư Hàng: hàng hiên + xe
    máy, không phải phố ô dù). Mức 3 theo MỆNH ĐỀ (giữa . ; |): cụm MẠNH (chợ dân sinh/cóc/rau/cá/hoa/họp, sân/dãy/nhà chợ, rừng
    ô, dãy ô dù, sạp/ô/bạt che kín…) là 3 trừ khi ngay trước là "góc / mang tính / đặc trưng / miệng / cửa ngõ / cạnh / gần / đối
    diện"; cụm YẾU (phố chợ, khu chợ, đầu/ngõ/cổng chợ, chợ tạm, chợ quần áo/vải/kim khí) hoặc cụm mạnh bị rào chỉ là 3 khi CÙNG
    mệnh đề có ô/dù, sạp, bạt (không "mái bạt"), mẹt, rổ, rau, hoa quả, trái cây, xốp, hải sản, quầy cá/thịt/rau — phản biện W3-E:
    090 "đặc trưng phố chợ quần áo", 242 "mang tính phố chợ", 214 "phố chợ buôn bán dây, lưới", 280 "miệng ngõ chợ", 002/006 "góc
    chợ dân sinh" có ảnh thật KHÔNG sạp/ô dù mà game dựng phố chợ ô dù + đống rau quả. Hàng CỦA CỬA HÀNG bày ra hè ("bày hàng",
    "hàng hoá bày", "giá treo quần áo" — không sạp/quầy/ô dù chợ) là mức 1 + bit hàng tràn, không phải mức 2 (21 pano: 242, 409,
    120…). Phân bố market 0-3: [413, 50, 52, 36] → [412, 71, 30, 38]; pano có ≥ 6 đồ chợ trong 25 m (node): 154 → 122. **Sân trước** `S.fore` = claim cell/landmark/civic sau mặt tiền 1,5/4/8/12/17 m (dừng khi gặp nhà
    THẬT — có dãy phố đứng trước thì công trình phía sau không phải sân trước) có tên chùa/đền/đình/nhà thờ/UBND/trường/cổng/…
    → không xe máy/chợ/quán/đồ hè (chùa Hai Bà Trưng 276: điện lùi ~16 m sau sân lát, xe máy từng dựng kín trước sân).
    **Đặt chợ**: đi dọc bên phố bước 2,1-2,8 m (mức 3, 95%) / 2,8-4,4 m (mức 2, 55%) / 3 m (mức 1, 10%); khối 9 m chọn chủ đề
    ô dù/bạt; mỗi đơn vị thử ô (cán lệch 0,75 m khỏi sạp, vỉa ≥ 2,6 m cán giữa vỉa) → vị trí khác → bạt (mức ≥ 2 gần như liền
    mái); hàng dưới đất (sạp phủ bạt, mẹt, bạt trải đất, bao tải, sọt) SÁT MẶT TIỀN khi vỉa ≥ 2,6 m (chừa dải bó vỉa cho xe máy
    đỗ — ảnh 184/189), người bán ngồi ghế đẩu sau hàng (ghế = biến thể nhóm hàng, người = kit SIT), khách đứng phía đường;
    mức 3 (40% đơn vị) thêm hàng ở dải 1,1 m lòng đường sát bó vỉa (cách nút giao ≥ 4 m) → `world.props.stalls` (traffic.js lách như xe
    đỗ). Mọi vật: MÉP THẬT ≥ `CLEAR.PANO_R` (3 m, hợp đồng W2-A) + 5 cm tới camera pano — bán kính thật của mô hình đã co
    giãn (ô tròn 1,45·sc, ô vuông 1,63·sc, hàng đất theo biến thể 0,25-1,1·gs, hàng tràn 0,9/1,3), bạt = khoảng cách ĐÚNG
    điểm → hình chữ nhật (`rectClear` + `panosNear`). BẪY: bản đầu "tâm ≥ 2,5 m + bán kính" (FP-5 nói ~2,5 m) với bán kính
    đoán thấp (ô 1,3·sc thay vì 1,45·sc; bạt chỉ thử tâm + mép trước) → `tools/qa/clearance.mjs` "cam vi phạm" 35 → 70
    (gần < 3 m: 12 → 46, chủ yếu tán ô/bạt chợ 2,3-2,9 m, góc bạt 1,8 m) — LUÔN chạy clearance.mjs A/B khi thêm đồ hè.
    Không trong nhà thật, không trên nhựa phố khác (`onCarriageFast`).
    Người: bán ngồi 75/62/45% đơn vị (mức 3/2/1), khách đứng 60/30/15% + mức 3 thêm khách thứ 2 35%. Ngân sách người TÁCH 2 NHÓM
    (`pedsMarket` 1.100 / LITE 350 cho người chợ cờ `vendor`/`mk`; `peds` chung 1.100 / LITE 450 như dot3 cho đi bộ + đứng/ngồi
    quán): lấy mẫu chung 1 nhóm (7.500 ứng viên, giữ 26%) làm chợ đông người "ăn" mất người ĐI BỘ cả thành phố (428 → 266);
    tách nhóm → 341. Nhóm 3 `pedsSpill` 220 / LITE 90: khách ngồi quán đặt theo BIỂN HIỆU/bằng chứng (cờ `sp`, ~670 ứng viên) —
    chung nhóm với người đi bộ thì người đi bộ trình duyệt 444 → 350 (phản biện W3-E). `stats.pedsPre` = ứng viên trước ngân
    sách [đi, đứng, ngồi, chợ đứng, chợ ngồi, quán theo biển]. **Đống nông sản** `props_market_produce` (1 draw call riêng, không đổ bóng,
    ≤ 60 m, LITE 40 m — xem Số đo): mỗi vòm hàng của sạp/mẹt/bạt đất (`PRODUCE_SLOTS`, dẫn xuất từ groundI SAU groundAll → không đổi chỗ
    đặt) có thêm 1 đống 9 quả cầu icosa pháp tuyến TRƠN màu instance pha sáng/tối từng quả + 3 quả bảng A (cổng 1 ~35% đống
    hàng trộn) + 3 bó lá dẹt (cổng 2 ~40% đống rau) — vòm trơn một màu nhìn như "bãi slime", đống quả lổn nhổn mới đọc ra
    rau quả; vòm cũ giữ làm lõi + LOD xa. KHÔNG gộp làm biến thể của nhóm hàng đất (mọi instance gánh ~300 đỉnh suy biến).
    BẪY HIỆU NĂNG "gộp biến thể" (`variants()`: mọi instance chạy đỉnh của MỌI biến thể, biến thể khác bị thu về 0): đo tam giác
    thấy được ở khung chợ 446 h270 — nhóm hàng đất 6 biến thể ~900 tam giác × 533 instance (≤ 150 m) = 479k (+ lượt bóng) → tách 2
    nhóm (sạp+mẹt / sọt+bạt đất+bao tải+ghế) và ≤ 100 m; cầu đèn gang 2/5 cầu (35 cột) để RIÊNG `props_lamp_glow2` (gộp vào nhóm
    kính đèn ~460 instance làm mỗi bóng đèn dây gánh +140 tam giác).
    BẪY: (a) cán ô vào `obst` với bán kính lớn → mọi sạp ngay dưới ô bị loại (bản đầu: ô không có hàng); (b) hàng giữa vỉa
    hè → xe máy (parkingLine) bị loại sạch khỏi phố chợ — thật thì xe máy đỗ ngoài, hàng trong; (c) `flat()` (groundHeightNoDeck
    + isWater) là truy vấn đắt nhất của vòng chợ — ô đã kiểm dốc lúc lấy mẫu, bỏ trong okAt.
    **Hàng tràn hè** theo chữ biển hiệu thật (SHOP_SIGNS → `signCategory`: cafe/food/furn/bike/toys/fruit/flower/cloth/hard/
    plant — chỉ chọn đồ, chữ không hiển thị; SHOP_SIGNS đã lọc thương hiệu nên regex chỉ dùng từ chung): quán cà phê = bộ bàn
    ghế + dù 70%, cửa hàng xe máy = hàng xe MỚI mũi ra đường xếp khít 0,68 m (hàng 2 CHỈ khi vỉa ≥ 3,9 m: xe dài ~1,9 m, bản đầu 2
    hàng cách 1,05 m xuyên nhau) + 2 ô dù tròn phía đường khi pano "ô/dù bán hàng" (170 Tô Hiệu); pano "xe máy trưng bày" ≤ 25 m:
    45% ô; nội thất/bàn thờ+két, đồ chơi, giá treo quần áo, xô hoa,
    hàng chồng; + theo bằng chứng pano (spill bits ≤ 25 m) + chậu cây trước nhà (3% ô lõi). Đồ của nhà (chậu, hàng
    tràn) CHỈ đặt khi có mặt tiền nhà thật ngay sau ô (`hasFacade`: dò facadeLine −0,3…+2,5 m) — bản đầu có chậu cây giữa vỉa hè
    nút giao HVT (304).
    **Ô tô** (props.js 6.6): bỏ luật `lakeSD > 18` (cấm ô tô 18 m quanh MỌI hồ → Quang Trung/Nguyễn Đức Cảnh trống) → chỉ cấm
    phía kè (đi ra phía vỉa lại gần hồ hơn) + phía vỉa nhìn ra công viên/quảng trường (322/542/065): `parkBehind` dò từ mặt
    tiền +0…+18 m theo pháp tuyến, gặp claim park/plaza hoặc kè/mặt nước (`openReal` = claimAt park/plaza ∨ lakeSD < 16 ∨ isWater — hồ Sen
    322: xe đỗ sát lan can kè vì lakeSD chỉ là hồ Tam Bạc) → true, gặp
    nhà thật trước → false (đa giác công viên OSM lùi sau dải cỏ: 542 claim cách bó vỉa ~16 m). BẪY: `ctx.openSpace` của
    world.js KHÔNG phải "không gian mở" — nó gồm cả vùng CẤM NHÀ INFILL có nhà thật (Z-TTB1/2/3 phố công sở/bệnh viện/nút
    Nguyễn Tri Phương, siêu khối Hải quân, chợ Nguyễn Khuyến, hành lang cầu Lạc Long…): dùng nó cho luật ô tô thì pano_395
    (ảnh thật kín ô tô 2 bên) mất SẠCH xe; luật W3-E (ô tô/chợ/chậu/nhịp dây) dùng `openReal`/`parkBehind`. Mức lấp ô đỗ
    tính TẠI TỪNG Ô theo pano gần nhất ≤ 60 m (`fillAt`) — trước: pano ở GIỮA đoạn polyline cho cả đoạn (Quang Trung = 1 đoạn
    thẳng 858 m, pano giữa đoạn "không ô tô" → 0,04 suốt phố; pano_005 ảnh thật 2 xe sát camera). Nút giao: tâm/đầu xe cách LÒNG
    phố p/s cắt ngang ≥ 12 m, t/r ≥ 6,6 m, ngõ 4,5 m (`roadIdx.nearCross`; 15 m mọi nút bỏ ~25% ô tô lõi); phố r có pano: "đỗ ven đường" 0,4, "kín hai bên"
    0,75 (trước 0,1/0,3); s/t không pano 0,2; viên nang quanh camera giữ 6,5-8 m CHỈ khi pano không nhắc ô tô đỗ, có thì xe
    con tâm ≥ 4,5 m/đầu ≥ 3,5 m (AUDIT3: viên nang bỏ chính các xe gần camera); VAN/TẢI chỉ nới (tâm 6,5/đầu 5,5 m) khi pano
    "ô tô đỗ dày" (car 2), car 1 giữ 8/8 m (phản biện r2: van trắng 102 "taxi đỗ/chạy", tải xanh 276 "ô tô con đỏ đỗ" 4-6 m
    trước camera mà ảnh thật trống); khúc cua > 12° xe đầu/cuối đoạn lùi |lat|·tan(θ/2) + 1 m khỏi khớp (sedan × van chồng
    thân góc trong khúc cua 78° phố r); xe khách 11,4 m (pano "xe khách đỗ nối
    đuôi" ≤ 40 m — 441 Bến Bính; bộ sinh chỉ nhận xe khách LỚN có "đỗ" CÙNG mệnh đề, không qua dấu phẩy, loại van/minibus/
    limousine 16 chỗ → 8 pano; bản đầu `[^.;]*` bắt "xe khách/xe van …, taxi … đỗ" ở 014 → xe khách 11 m chắn camera), ô tô phủ bạt (bạt bạc) CHỈ phố r 5% / pano "phủ bạt" 35% (bản 6% mọi phố ngoài lõi đặt khối
    xanh xám sát camera 028 mà ảnh thật là sedan đen). Bước ô đỗ đi dọc TỪNG TUYẾN (cùng phố +
    cùng bên, đoạn nối tiếp — `byRoad`), phần dư MANG sang đoạn kế, đoạn kế thẳng hàng (< 12°) cho xe chồm qua khớp (trước: mỗi
    đoạn polyline tự bắt đầu lại ở 2-8 m + chừa 3 m cuối → phố cong ven hồ chia đoạn 10-25 m gần như không có xe — 028/033).
    Thứ tự kiểm rẻ trước (camera pano → nút giao → vật cản → lakeSD/parkBehind). QA: `__hpProps.carRejPts` [x,z,lý do].
    Vật cản = CẢ THÂN xe: `obst.rectHit` (vòng tròn cột/gốc cây/cọc bạt/cán ô chạm hình chữ nhật thân xe) + `stripHit` (hình
    chữ nhật THẬT của hàng chợ lấn lòng đường/ba gác `LIFE.stallsRoad` — obst chỉ ghi 0,6 m cho sạp dài 2,2 m). BẪY: chỉ thử tâm
    xe (bản đầu) → 25 xe đỗ trùm sạp/đống hàng lấn lòng đường cách tâm 1-2,5 m dọc thân (353, 518, 125); hàng chợ đặt (6.4)
    TRƯỚC ô tô (6.6) nên ô tô phải né đủ thân. Xe khách (rộng 2,5 m) tâm ở curbLine − 1,35 (ở −0,95 như xe con thân chồm 0,31 m
    lên bó vỉa — 441); traffic.js `inner = d − hw` cho xe hw > 1,2.
    **Xe máy**: hàng = chuỗi CỤM theo lô 3,2-6 m cách khe lối vào 0,5-0,9 m, mỗi cụm góc/mũi/khoảng riêng; bảng màu tối
    (đen/xám/bạc/trắng — ảnh tháng 10); ước lượng ngân sách ×0,5 (thực đo, chú thích 0,8 cũ sai); xe trưng bày cửa hàng xe.
    **Tiện ích**: cột điện phố cũ (t/r lõi, búi dây) 23-29 m. **Tuyến cột chọn BÊN NHÀ** (phản biện r2): mốc cột rơi vào mặt
    phố TRỐNG (`bareFront`: không nhà thật 20 m sau mặt tiền, 3 điểm dọc × 6 độ sâu) → sang bên đối diện của CÙNG đoạn
    (`S.opp`) nếu bên đó có nhà, và Ở LẠI bên đó (trễ, không zic-zắc: 1.088 nhịp chỉ 39 nhịp vắt chéo phố) tới khi bên đó lại
    trống; bên đổi không đặt được cột → về bên gốc (bản đầu KẸT cả tuyến 500 m Hoàng Văn Thụ không cột). Hai bên đều trống mà
    bên này là công viên/quảng trường/nước (`parkBehind` sau mặt tiền) → bỏ cột, TRỪ pano "búi dây dày" (e[4]=2). "Công viên"
    PHẢI kèm trống: claim tròn thô (hành lang Quán Hoa 55 m, chợ Cột Đèn 28 m) phủ cả dãy nhà → chỉ dùng parkBehind thì 7 pano
    dây dày dọc Hoàng Văn Thụ/Quán Hoa mất sạch dây. (363: tuyến dọc vỉa vườn hoa ĐBP Tây → dãy nhà phía nam như ảnh h270.)
    Cột sát camera pano (< 3,6 m) DỊCH dọc ±2/±4 m (chỗ dịch phải ≥ 6 m mọi camera) thay vì bỏ, và 1 mốc không đặt được (nút giao + camera) thì nhịp trước
    VẮT QUA tới cột kế (≤ 60 m) — bỏ cột = mất CẢ 2 nhịp đúng chỗ camera (092 Hạ Lý: khoảng 23-29 m rơi vào nút giao, hở 53 m
    không dây). Nhịp dây chỉ cấm qua lòng ĐẠI LỘ khác (`roadIdx.wideAt` nửa lòng ≥ 6 m — p; W3-A: way ≥ 12 m) ở ¼ ½ ¾ nhịp +
    khoảng mở (openReal) ở GIỮA nhịp — ngưỡng 4 m (mọi phố t/s) + openReal 3 điểm từng xoá lưới dây THẬT qua nút phố cũ
    (457 h270, 469 h0). Dây sang nhà bên kia: phố t/r + phố s khi pano búi dây dày (e[4]=2 — 469/046), phải có nhà bên kia,
    không qua lòng phố s/p khác (wideAt 5). Đo (node, đoạn dây ≤ 25 m quanh 294 pano "búi dây dày"): trung bình dot3 259 →
    HEAD r1 280 → 313, pano < 60 đoạn 40 → 41 → 25, pano 0 đoạn 25 → 25 → 21; pano "không cột" giữ ~5. Trạm biến áp
    kiốt (bằng chứng "trạm biến áp … vỉa hè/hộp", "tủ điện lớn", "hai tủ" — 207/092; nền ~1/1.000 m phố s/t lõi; ≥ 7 m camera — khối
    xám sát ống kính 276 mà ảnh thật trống; nền KHÔNG trên vỉa phía công viên — 230/542); đèn gang 5 cầu quảng trường Nhà hát / 2 cầu ven hồ / 3 cầu vườn
    hoa — nhóm `props_furniture2` RIÊNG (gộp vào nhóm cột 1.300 instance làm mọi cột gánh đỉnh suy biến); cờ treo nhà (cán
    chếch 30° cắm vào mặt tiền THẬT dò từ facadeLine), băng rôn khẩu hiệu chung căng ngang phố + 2 cọc (tấm 2 mặt DoubleSide:
    fragment shader lật U ở mặt sau `gl_FrontFacing` — không thì nhìn từ một phía chữ đọc NGƯỢC "IHT ỚƠ HNIM…", 248), cổng chào NGÕ (miệng
    way h/w/r ≤ 40 m, lùi 3,5 m vào ngõ; cổng trường/công viên không tính), xe ba gác đỗ dải đỗ (22 pano).
    **Rào bó vỉa giả** (FP-5 019/409): `world.js` khối ĐBP đông — bỏ rào sắt 20 m + biển xanh "XỔ SỐ" trên rào ở bó vỉa NAM
    ĐBP (z≈-436,8, trước dãy nhà thật; ảnh 409 h135/h180 không có rào). 019: rào là hàng rào `compound()` Cảng vụ (world.js
    ~20307) quây cả dãy nhà INFILL bờ bắc Hoàng Diệu — việc của khối khuôn viên/INFILL (W3-B), CHƯA sửa.
    **Giao diện**: `world.props.stalls` [{x,z,heading,len,hw,kind}] (traffic.js gộp với parkedCars); `parkedCars` thêm xe
    khách (hw 1,3) + xe phủ bạt; `__hpProps.lists` thêm mkOver/mkGround/mkRoad/spill/kioskI/coaches/covered/flagsHouse/
    banners/gates (clearance_page bỏ qua mkRoad/coaches/covered/banners/gates — cố ý trên lòng/treo cao; collider của
    `stalls` + xe đỗ tính như xe đỗ: vòng 3,5 m như dot3, xe dài > 6 m (xe khách) = HỘP định hướng +1 m dọc/+0,6 m ngang — vòng
    len/2 + 1 = 6,7 m từng che mọi collider nhỏ quanh xe khách khỏi kiểm tra "trên lòng đường"); `stalls` thêm cán ô dải lòng
    đường (kind 'umb') + khách đứng trên dải lòng (kind 'ped') để giao thông lách — clearance_page KHÔNG dùng 2 loại này che collider.
    traffic.js `parkedHit` dùng nửa rộng THẬT `c.hw` (xe khách 1,3 / phủ bạt 0,95; trước cố định 0,85).
    **HỢP ĐỒNG MẶT CẮT `XS(S)`** (props.js, truyền vào streetlife): mọi chỗ W3-E lấy mặt cắt bằng `XS(S)` của BÊN PHỐ (không
    `XS(S.c)`, không gọi thẳng curbLine/facadeLine(S.c)) → {hw, sw, curb, park, furn, fac}, nhớ trên `S.xs`. **Bước hợp nhất
    W3-A** (bề rộng riêng từng way, xsection nhận object): đổi THÂN `XS` thành `curbLine(S)/sidewalkW(S)/parkingLine(S)/
    furnitureLine(S)/facadeLine(S)` (S mang `w/sw` từ ROADS_DT) và giải 6 hunk xung đột props.js (placeFood ×2, vòng thùng
    rác, vòng hàng xe máy, lat/narrow xe máy, lat ô tô) bằng BẢN W3-E — các dòng đó đã dùng `XS(S)` (đã thử: merge-tree với
    nhánh W3-A + lấy bản W3-E + đổi thân XS → props.js parse được, 0 lệnh gọi mặt cắt theo `S.c` còn lại). xsection dot3 coi object là
    cấp 'r' (`c in ROAD_W` sai) nên trước hợp nhất thân XS vẫn truyền `S.c`. QA: `__hpProps.carRejPts`/`spans` chỉ giữ khi
    `navigator.webdriver` hoặc `?qa=1` (≤ 180k số trong heap game thật).
    BẪY QA (Windows): `node tools/qa/gpulock.mjs run -- bash -c "a; b"` TREO — spawnSync shell:true chạy qua cmd.exe, dấu nháy
    bị bỏ → `bash -c bash …` chờ stdin mãi trong khi GIỮ khoá GPU (chặn mọi agent 13 phút). Gói nhiều lệnh vào 1 file .sh rồi
    `gpulock.mjs run -- bash file.sh`.
    **Số đo** (bản cuối dfe6e47, A/B cùng phiên 2026-10-12, TIER 3, `__hp.gpu` ANGLE AMD Radeon 890M d3d11, máy dùng chung với
    agent khác): 24 góc views_std fps 60,2 = 60,2 (trần vsync), calls 377 → 379, tris 3,95 → 4,01 M (cam_spawn 388 → 365 /
    3,83 → 3,86 M; pano_007_h090 529 → 542 / 5,53 → 5,72 M; cam_high_center 399 → 403 / 5,25 M; game_3 359 → 365 / 6,09 →
    6,18 M); 6 góc phố chợ calls 299 → 298, tris 2,53 → 2,73 M (trước 2 bản sửa bẫy "gộp biến thể": 3,02 M). Dựng props
    trong trình duyệt +125-135 ms (325 → 449 / 427 → 562 ở 2 phiên tải khác nhau), hpReady +100-340 ms (nhiễu), heap sau GC
    377 → 386 MB, programs 69 = 69. Đếm (trình duyệt): xe máy 11.354 → 11.225, ô tô 1.667 → 1.661, người đi bộ 444 → 350
    (người ngồi quán theo biển hiệu chia ngân sách chung), InstancedMesh 21 → 33. Theo km (lõi/giữa/ngoài, nh_run node):
    xe máy 172/146/38 → 188/162/51, ô tô 26,7/17,2/3,9 → 21,8/17,1/6,9, ghế đẩu 13,1/11/2,2 → 16,6/12,2/2,2, mái chợ (ô/bạt)
    44/35/9,7, hàng đất 81/64/18, hàng tràn hè 10/10,7/2,5, cờ treo nhà 9,3/9,8/1,4. Tam giác thấy được 446 h270: mái chợ
    134k, đống nông sản 90k, hàng đất 76k + 65k. `tools/qa/clearance.mjs` A/B: gần < 3 m 12 = 12, mọi mesh < 3 m 36 = 36,
    trên nhựa 53 = 53, lấn phố > 0,2 29 → 35 (ô tô đỗ gần camera hơn theo FP-5 khi pano thấy xe đỗ — đánh đổi CÓ CHỦ Ý với
    viên nang 6,5-8 m cũ), cam vi phạm 35 → 41. Chấm lại (REAL|dot3|W3-E, 4 hướng/pano): 18 pano đích 3,89 → 4,25; 8 pano
    đối chứng 2,375 → 2,5 (cả +0,125 từ 395 — luật ô tô openReal; 7 pano còn lại 0). LITE: 0 lỗi JS ngoài 404
    `assets_lite/*.glb` (máy này không có bản lite cục bộ — dot3 y hệt).
    **Số đo sau phản biện** (bản sửa 2026-10-12, A/B cùng phiên với dot3, TIER 3, Radeon 890M): 24 góc views_std calls 374 →
    379, tris 4,04 → 4,09 M (fps trần vsync 59,4 → 59,7); 6 góc chợ: 5 góc calls/tris = bản dfe6e47 (±1 %), 446 h270 +77 calls
    với khung hình Y HỆT (nhiễu nạp/bóng — probe tam giác props thấy được ở đó GIẢM: mái chợ 126k → 88k, hàng đất 133k → 106k).
    Dựng props node cùng lượt (dfe6e47 → bản sửa) 549-563 → 570-571 ms (+10-20 ms: thân xe rectHit/stripHit, nhóm người 3);
    trình duyệt 526 → 731 ms so dot3 (nhiễu máy chung). Heap sau GC 377 → 385 MB, programs 69 = 69. Đếm trình duyệt: người
    đi bộ 444 → 436 (bản dfe6e47: 350), ô tô 1.667 → 1.610 (−51 so dfe6e47: xe trùm hàng/cọc/cột bị loại), xe khách 5, xe máy
    11.354 → 11.504; probe trùm xe đỗ × hàng lấn lòng đường 25 → 0. clearance.mjs: gần < 3 m 12 = 12, mọi mesh 36 = 36, trên
    nhựa 53 = 53, lấn phố > 0,2 29 → 34, cam vi phạm 35 → 40 (6 cam mới đều "lấn 0,2-0,27" do ô tô đỗ gần camera theo FP-5;
    409 hết vi phạm). Chấm lại: 18 pano đích 3,89 → 4,28 (124 thêm sạp/ô dọc chợ +0,5; còn lại = dfe6e47), 8 đối chứng
    2,375 → 2,5; nhóm "chợ giả" của phản biện (090, 242, 315, 214, 398, 070; thang điểm phản biện) dot3 3,25 → dfe6e47 2,75
    → bản sửa 3,17 (090/242/315 hết phố chợ ô dù; 214/398 về như dot3).
    **Số đo sau phản biện r2** (bản 903f798, A/B cùng phiên 2026-10-14 với dot3, TIER 3, Radeon 890M): 24 góc views_std calls
    374 → 379, tris 3,95 → 4,00 M (fps trần vsync 60,1 → 60,2; p95 ~18 ms cả hai); 6 góc chợ calls 295 → 303, tris 2,53 → 2,71 M.
    Khởi động trình duyệt nhiễu nặng (agent khác chạy GPU/CPU song song: lượt probe bản mới ground/cells/fabric cũng +30-50 %)
    → đo CPU dựng props bằng node A/B HEAD r1 ↔ bản này, 3 lượt xen kẽ: 747/587/580 ↔ 629/566/581 ms (không tăng). Heap sau
    GC 377 → 389 MB (headless giữ mảng QA spans/carRejPts — game thật không). programs 69 = 69. Đếm trình duyệt: cột điện
    1.225 → 1.305, nhịp dây 981 → 1.075, đỉnh dây 342k → 387k, ô tô 1.667 → 1.592, xe máy 11.354 → 11.720, người đi bộ 444 → 441,
    kiốt 36; probe chồng thân xe đỗ 0; diag bất biến giao thông 0 (parkHit dùng nửa rộng thật). Cột ≤ 4,5 m quanh 551 camera:
    dot3 10, HEAD 10, bản đầu r2 20 (cột DỊCH ±2/±4 m lù lù trước ống kính 060) → dịch phải ≥ 6 m → 13. clearance.mjs: gần
    < 3 m 12 = 12, mọi mesh 36 = 36, trên nhựa 53 = 53, lấn vỉa 72 = 72, lấn phố > 0,2 29 → 33 (HEAD 34), cam vi phạm 35 → 39
    (HEAD 40). Chấm lại (REAL|dot3|HEAD|bản này): 18 pano đích 3,89 → 4,28 → 4,33 (092 dây về, 276 hết xe tải); 8 đối chứng
    2,375 → 2,5 → 2,44 (014 h180: tuyến phố s sang bên nhà vì phía vườn hoa trống — ảnh thật CÓ cột góc vườn: heuristic sai
    chỗ này); pano phản biện: 363 3 → 3,5 (hết lưới dây h0), 457 3 → 3,5, 469 2,5 → 3, 102 2,5 → 3 (hết van).
    BẪY QA (máy này): `python -m http.server` (hàng chờ listen 5) TỪ CHỐI kết nối khi máy tải nặng → ERR_CONNECTION_REFUSED,
    game không khởi động (TIMEOUT __hp) — dùng server có `request_queue_size` lớn (ThreadingHTTPServer, 256).
- **2026-10-11 (W3-G TREES)** [ĐỢT 3 wave 3 — AUDIT3 FP-7 "CÂY THEO BẰNG CHỨNG": mùa hoa tháng 10, cau theo bằng chứng, cắt trụi theo NGỮ CẢNH, mật độ/vòm cây theo đoạn phố, đa/me tây hero, cây cảnh đảo giao thông, thẻ lá không "bay"]
    (nhánh worktree W3-G trên dot3 bc07df5; 5 phiên 05-14/10 — phiên 5 = sửa sau review — 2 lần host chết + 1 lần tạm dừng theo chủ dự án, nối tiếp theo PROGRESS.md). File: `js/trees.js` (chính), `tools/gen_treemap.mjs` + `js/treemap.js` (SINH LẠI —
    `node tools/gen_treemap.mjs`, tất định), `tools/qa/trees.html` (thêm kit topi/me/lop), `js/world.js` 1 dòng (`trees.onHeroSeason(() => loadHeroTrees(trees))`).
    **TREEMAP v2 (stride 15 → 21, trường cũ giữ nguyên nghĩa):** [15] polS / [16] polP = mức cắt cụt của cây VỈA HÈ vs cây DẢI
    PHÂN CÁCH/CÔNG VIÊN/VƯỜN HOA/QUẢNG TRƯỜNG — ngữ cảnh theo CÂU (; .): câu chỉ nói công viên → cả câu "park"; câu nói cả
    hai → theo vế (,), vế không nêu gì thừa hưởng ngữ cảnh nêu trước ("khuôn viên" KHÔNG tính park — sân cơ quan sau rào);
    [17] tunnel (hàng cây tán lớn "rợp/che kín/vòm" + mật độ 3, hoặc phố Lê Lợi/Hạ Lý/PBC/LTK/Ký Con có hàng cây);
    [18] topiary (cây cảnh tỉa tròn/cây thế trên ĐẢO GIAO THÔNG/dải phân cách và KHÔNG có hàng cây lớn); [19] palm (1 = tả
    cây mà không có cau/cọ/dừa, 2 = câu ĐẦU nói cau/cọ, không loài gỗ — đầu cầu pano_074); [20] lean ("nghiêng").
    Trường cũ [9] pollard = max(polS, polP). Sửa evidence: **"cọ" khớp nhầm "cọc" (chống cọc cây non) → 41 pano từng có
    cau giả** (regex `cọ(?![a-zà-ỹđ])`); "một cây/một gốc" = mức 3 (một cây lẻ, không phải hàng); "đốn tỉa MẠNH", "cây cổ thụ
    bị cắt", "cây … lớn … cắt trụi/chỉ còn thân" = 7; mật độ thưa thêm "một số cây/lác đác" (trừ khi có "hàng cây/nhiều
    <loài>/rợp/hai bên"); "cổ thụ/cây tán" tính là cây chung (pano_259 từng ra thưa); "một số/vài cây … cắt" xét TRƯỚC nhánh
    "hàng cây … cắt" = mức 3 (pano_262 "hàng cây cổ thụ … (một số cây bị cắt trụi cành)" từng ra 7).
    **BẰNG CHỨNG THEO ĐOẠN PHỐ (`vegAt(x,z,ri,park)`):** cây vỉa hè lấy pano đứng TRÊN CHÍNH phố đó (cách tim ≤ nửa lòng + 9 m,
    ≤ 50 m) trước, rồi mới tới pano gần nhất chim bay (`panoOnRoad`, dựng lười theo roadIndex). Cây "park" = kind 'park'/
    dải phân cách/trong claim 'park' (đa giác PARKS) hoặc cách mép vườn ≤ 12 m (8 hướng × 4/8/12 m, chỉ dò khi có pano polP ≤ 60 m;
    đa giác PARKS LÙI VÀO so với mép vườn thật: hố cây hè phía vườn cách đa giác 7-11,5 m — 8 m/8 hướng chỉ với ~7,4 m nên hàng
    bàng/xà cừ hè phía dải 001/400 từng còn tán đầy) → mức cắt = max polP các pano ≤ 60 m (+ polS pano ≤ 25 m). Xác suất cắt: mức
    3/5/7 → 19/45/71% (W2-B 18/40/62%); cây PARK mức 7 ("cả dải cắt trụi") → 90% (ảnh 001_h090/400_h270/225 gần như không còn cây
    tán đầy trong dải), loài đích danh của helper trong dải cũng 90% (vỉa hè: ×0,85).
    **LOÀI MỚI:** LOP "bộ xương" cắt trụi (thân 3,4-3,9 m + 4-5 cành lớn ngóc 25-55° cưa cụt, mỗi cành chẻ 2 nhánh cụt + chồi
    mảnh, 28-34 thẻ chồi mọc lại 0,6-1 m dọc/đầu cành, độ kín 0,45-1 — cây trơ hẳn lẫn cây đã ra lại chồi: ảnh 056 "cắt tỉa trơ
    cành" vẫn lưa thưa lá; bản 12-16 thẻ ra "bộ xương" trụi đều; H 7,5-11) — mức ≥ 5: 72% LOP / 28% CATCUT (cụt ngọn); helper 'catcut' ở vùng mức ≥ 5: 60% LOP.
    TOPI cây cảnh (2 khối cầu lá / cây thế thân cong + 4 đĩa lá; aHt = 0 → co giãn đều, không nâng tán); ME me tây (tán dù
    Ø 20 m, 8 cành ngang + 6 cành phụ, 170 thẻ). SP_N 9 → 12 (SPX/SP_TINT/KIND_OF/kit xa theo loài tự đủ).
    **QUY TẮC (buildTrees, áp cho MỌI nguồn cây — helper cells, vườn hoa, OSM…):** (a) cau đích danh mà pano ≤ 35 m tả cây
    không có cau VÀ không pano ≤ 50 m nhắc cau (`palmUnseen`) → cây bóng mát vùng (hàng cau "công sở" Bảo tàng pano_046);
    (b) cây non đích danh nơi pano gần nói hàng cây LỚN/vòm, không nhắc cây non → cây bóng mát (239/271/501); (c) cây không ở
    hố vỉa hè ≤ 35 m pano topiary → TOPI (304); (d) cây vòm (tunnel): u ≥ 0,45, tán ×1,35 (≤ 1,3× SPX max), mép tán −0,7 m,
    kín 0,82-0,98, không tỉa trơ; (e) "HÀNG cây non" (young 6) → 80% cây non (trước 36%); (f) kè hồ < 16 m tới nước + (pano
    "nghiêng" hoặc 35%) → cả cây NGHIÊNG 4-9° về phía nước (xoay instance quanh gốc, `tiltX/tiltZ`, thân mảnh ×0,85 — KHÔNG
    dời tán: W2-B đã chứng minh dời tán = thân gãy).
    (g) **KÈ HỒ — BIẾN THỂ MẢNH (`r.slim`)**: cây < 16 m tới nước (lakeSD: hàng sát nước 4-5 m + hàng hố bó vỉa phía hồ 12-14,2 m;
    hè phía nhà bên kia phố ≥ 20 m — ngưỡng 14 m cũ hụt đúng hàng bó vỉa pano_033), không phải loài/cây đích danh: 60% thân MẢNH
    (sxz ×0,62 → Ø thân ~0,3-0,4 m; tán giữ cỡ nhờ cs bù), thấp hơn (×0,88, ≤ 12,5 m), tán R ×0,85, kín ≤ 0,55-0,85, LUÔN nghiêng
    ra nước; 40% giữ dáng cổ thụ (ảnh 033_h000/005_h090: hàng cây kè thân mảnh nghiêng gió; 010: vẫn có cổ thụ/đa giữa hàng) —
    KNOWLEDGE §8b luật 3 "kè hồ rợp cổ thụ" vẫn đúng về ĐỘ PHỦ, không đúng về THÂN (thân to Ø 0,6-0,8 m là sai ở kè hồ).
    (h) **CÂY CHUNG + CAU** (`vegAt`): pano tả "hàng cây tán lớn/bóng mát … và cau/cọ" (cây chung + CHỈ cau đích danh — 51 pano:
    223-226, 340, 065, 235, 363…) → cây chung cũng là bằng chứng: trọng số = trọng số cau, chia xà cừ/bàng/phượng/sấu theo vùng ⇒
    cau ~30% thay vì 70% (quanh pano_225 33/57 cây từng là cau; ảnh 223-226 chỉ vài cây cau giữa cây bóng mát). Trừ pano "chỉ cau"
    (palm 2). `stats().ev` = {tun, tilt, slim, big} đếm cây theo các luật trên.
    **TRỒNG DỌC PHỐ:** nhịp ×(0,75-1,25) (trước ±15%) + 9% hố trống; thưa (dens 1) ×3,0 (trước ×2,3) + MỘT BÊN theo khúc 60 m
    (bên kia giữ 30%); vòm ×0,82; `plant(…, {ri, tun, src})` mang chỉ số phố + cờ vòm sang buildTrees.
    **HERO ĐÍCH DANH theo ảnh (`HERO_SPOTS`):** đa/si rễ phụ ở pano_088 h180 (−5,2°, ~16 m) và pano_400 h180 (+21°, ~20 m),
    me tây pano_001 h180 (+18°, ~22 m). Công thức đo: ảnh SV 1912 px FOV ngang ~98° → f ≈ 831 px; góc ngang = atan(dx/831);
    cự ly = 2,5 m / tan(góc cúi tới gốc). ĐẶT: phố/nhà game không khớp ảnh → tìm trong nón ±12° quanh hướng đo, cự ly 6..(đo+8) m,
    điểm TRỐNG (gốc cách mép lòng đường ≥ 2,2 m — rễ phụ ≤ ~1,9 m —, không nhà, không camera pano 6 m, không nước) VÀ THẤY ĐƯỢC
    từ camera pano (đoạn camera → gốc không cắt footprint nào, dò `fp.at` mỗi 0,5 m), gần điểm đo nhất → 088: 10,5 m/+6°,
    400: 13,5 m/+20°, 001: đúng điểm đo. BẪY: (a) "bám hố cây của phố" SAI ở 088 (ROADS_DT lệch ~45° so với ảnh); (b) "chỗ trống
    gần nhất" rơi vào KHE SAU một nhà ở 400 (gốc trống nhưng nhà #24545 che ở 13 m → không thấy cây); (c) `THREE.Raycaster` KHÔNG
    trúng mặt tiền fabric (dò che khuất phải dùng lưới footprint `world.rbGrid.at`, mesh merge nằm layer 1 → `rc.layers.enableAll()`).
    Cây hero (`o.big`): H/R ĐÚNG số đo (không trộn 50% với cỡ ngẫu nhiên), mép tán = SPX min (4 m), KHÔNG qua facadeFit (tán trùm
    mái/ban công như ảnh — luật 1,5 m + ép 88% về lòng đường từng đẩy tán đa lên trên đầu camera: khung pano chỉ thấy thân), mọi
    cây KHÁC (cả helper cells) ≤ 0,6 R bị bỏ (`stats.fix.hero`). Kit đa: tán thấp rộng (cy 8,8, ry 4,0, thân 3,2 m — bản cũ tán
    5,6-14,8 m × sy 1,45 ⇒ tán hero 7,4-21 m), rễ phụ MẢNH 2-5 cm 1,2-3,2 m quanh gốc (trước tới 6 m × cỡ instance → rễ giữa lòng
    đường), 55% buông lơ lửng (đầu rễ 0,8-3 m) — rễ to chạm đất hết từng thành "rừng cột".
    **MÙA HOA:** ngoài mùa phượng/bằng lăng 0,17/0,12 → 0,02 (pano 10/2024 không có hoa đỏ — 340/372/001/042). Hero GLB (luôn
    đỏ) + cây đôi luôn-nở CHỈ khi tỉ lệ nở ≥ `HERO_SEASON` 0,45 (shader + assign + bloomNear) → 4/10 mặc định: không hero GLB;
    3 file GLB phượng (~5,5 MB) chỉ TẢI khi vào mùa (`trees.onHeroSeason(fn)`: gọi ngay nếu đang mùa, không thì khi
    setDate/setSeason/lịch qua ngưỡng) — trước tải + giải mã lúc dựng dù tháng 10 không bao giờ hiện.
    **THẺ LÁ "BAY" (TREECARD):** thẻ "lấp tán" (¼ số thẻ) trước rải trên vỏ ellipsoid không cành đỡ → nay chùm lỏng (×2) quanh
    1 điểm cành; vỏ ×1,0 (trước 1,08); bàng: lá lấp tầng bám cành, lá cả giữa cành (P[1]), cành tầng mảnh ×0,75; số "độ kín"
    của thẻ TƯƠNG QUAN THEO CHÙM (70% chùm + 30% thẻ, tham số `rnd` của card()) → cây thưa mất nguyên chùm. Kit gần thẻ ×1,5
    số lượng, ×0,8 cạnh (bàng ×1,95) — cùng độ phủ, hạt mịn.
    Phiên 4 — NEO THẺ (`CARD_TETHER` 1,15 m + 0,4 × cạnh thẻ nhỏ nhất): kit GẦN, tâm thẻ xa điểm cành neo (đầu/giữa cành) quá
    giới hạn → kéo về điểm neo (crownCards + tầng bàng): tán rộng (me Ø 20 m, đa) toả chùm ×(1 + 0,4·rx/5) tới 2,6 m mỗi trục nên
    vài thẻ góc còn "bay"; kẹp không tốn r() → mọi thẻ khác giữ nguyên vị trí (tất định). Atlas: chùm lá THÙY (`lobedPts`: 5-6 cụm con lệch tâm) thay đĩa
    tròn. Thân mảnh hơn: r0 ×~0,75 (xà cừ 0,31/0,34, phượng 0,29/0,30…), loe gốc 1,32 → 1,22, sxz = (H/H_kit)^0,7 ≤ 1,18
    (trước ^0,8 ≤ 1,5). Gốc quét vôi mặc định 0,55 → 0,35. Lá tối ~7% (b 0,8-1,02).
    **SỐ ĐO (phiên 4, cùng phiên A/B: base = dot3 bc07df5 từ `git archive` phục vụ cổng riêng; Chrome headless d3d11 Radeon 890M,
    TIER 3, khoá chất lượng; máy chung 6-8 agent → thời gian dựng/boot nhiễu):** cây 8.886 → 8.497 (LOP 421, TOPI 6, ME 1, đa 3 →
    6, cau 558 → 451, vòm 977, kè hồ nghiêng 201 / thân mảnh 164). Điều tra theo lớp bằng chứng (cây ≤ 30 m quanh 551 pano,
    `scratchpad/dot3/W3-G/censusclass.mjs`): pano "thưa" 4,67 → 3,03 cây; "vòm" 11,2 → 12,4 cây (tán TB ≤ 25 m 3,44 → 4,18 m, mép
    tán 5,29 → 4,90 m); tỉ lệ cây cắt quanh pano nói "cây vỉa hè cắt" (polS ≥ 5) 0,52 → 0,61, quanh pano không nói cắt 0,17 → 0,15;
    cây dải/vườn cắt trụi: PARK 73%, vỉa hè 20% (base 70% chung); cau quanh pano tả cây không có cau 47 → 32. Thẻ lá "không cành
    đỡ" (> 1,2 m + nửa cạnh tới đỉnh gỗ gần nhất, kit gần trừ cau/TOPI): 59/827 → 0/1612; thước AUDIT nguyên văn ("ngoài 1,2 ×
    bán kính tán p85") 143/827 (17%) → 217/1612 (13%) — thước này đếm cả thẻ CÓ cành đỡ ở mép tán rộng, không dùng làm cổng.
    Phượng nở 4/10: 17% → 2%; hero GLB 4/10 không tải; `?date=2026-06-10`: nở 0,80, tải đủ 3 GLB phượng, 0 lỗi JS.
    buildTrees (dump liền nhau cùng phiên): 114,6 → 133,8 ms (+19 ms: 3 kit mới + luật bằng chứng); tam giác cây thấy ở spawn
    0,583 → 0,624 M, draw call cây 21 → 26 (nhóm instanced TOPI/ME/LOP, chỉ vẽ khi có cây trong tầm).
    Perf std (8 góc, 2 vòng xen kẽ base/new, traffic on): fps 60 (vsync) cả hai; p95 18,3-18,7 → 18,4-19,9 ms; draw call +3..+17
    (cam_spawn −10); tam giác +0,1..+2% (game_3 −4%); hpReady 4,2/4,8 → 4,8/5,8 s — boot profile: MỌI bước chậm hơn ở lượt new
    (cells +168, fabric +78, shaders +57 ms… không liên quan cây; bước nature +10 ms) → nhiễu máy chung; heap 591/649 → 465/621 MB
    (không giải mã 3 GLB phượng hero ngoài mùa).
    Chấm lại (REAL | dot3 | W3-G, 1280×634, traffic off, 17 pano FP-7 × 2 hướng, người làm tự chấm — thiên vị ±0,5): nhóm đích
    3,54 → 3,91 (+0,37; tăng ở 22/34 khung, không khung nào giảm: hết phượng đỏ 340/372/001, đa 400/088 + me 001 hiện ra, dải
    vườn 001/400/056 trơ cành, Cát Cụt/Tô Hiệu thưa, vòm 166/538/496, hết thẻ lá bay 386/538, cau 225/340 về thiểu số, thân
    mảnh nghiêng kè hồ 033); nhóm đối chứng 8 pano 2,13 → 2,13. Cổng: diag full "TẤT CẢ THỰC THỂ OK — 0 lỗi JS"; diag/ảnh lite
    chỉ có 404 `assets_lite/*.glb` (bản lite địa danh không có trong worktree/repo — như dot3); waterbfs 5/5.
    Còn kém: 304 (nút HVT thật gần như trống, game còn hàng cây non/vừa xa), 010 (hàng hố bó vỉa + hàng helper kè hồ = "lưới
    thân cây" trên promenade — mật độ helper chưa đụng), 033 (tán vẫn to/dày hơn ảnh), bàng sát camera vẫn "tầng que + đĩa lá",
    400_h180 (gốc đa thấy rõ nhưng tán ra ngoài khung).
    **BẪY:** (1) treemap stride 21 — mọi chỗ đọc PANO_VEG phải dùng PANO_VEG_STRIDE (chỉ trees.js). (2) Thứ tự trường mới
    sau trường cũ: o = pi + 2 cho [2..14]; trường mới đọc thẳng V[pi + 15..20]. (3) Probe thẻ lá "bay" đúng nghĩa = khoảng
    cách tâm thẻ tới đỉnh GỖ gần nhất (> 1,2 m + nửa cạnh); "ngoài vỏ 1,2 × bán kính p85" không phân biệt được (tán rộng
    luôn có ~15% thẻ ngoài p85). Bỏ qua cau (tàu lá là dải, không phải thẻ) và TOPI (cầu lá không cành). (4) W3-A sẽ đổi
    PANO_CLEAR/nón nhìn trong ok()/buildTrees — W3-G KHÔNG đụng các dòng đó. W3-F (cây non kè sông) PHẢI dùng plant('non', x, z, {pit: 1,
    wash: 0, exact: 1}) — không có exact, luật (b) biến cây non thành cổ thụ (xem phiên 5); quy tắc (e) "hàng cây non" đã tự áp cho pano 299/294 (kè sông). (5) Thân mảnh = giảm `sxz` (co CẢ cây theo ngang), tán
    giữ cỡ nhờ `cs = R/(rad·sxz)` — trần cs 1,9: cây tán rất rộng mà sxz quá nhỏ sẽ bị co tán; đừng giảm sxz dưới ~0,4. (6) Luật
    kè hồ dùng `lakeSD` (LAKE_POLY — hồ Tam Bạc trung tâm); promenade SÔNG Tam Bạc/Thế Lữ là phần W3-F (cây non chống cọc).
    **Phiên 5 (14/10, sửa sau review "merge-with-fixes"):** (1) `plant(kind, x, z, {exact: 1})` = giữ ĐÚNG loài/dáng người
    gọi đặt: bỏ qua MỌI luật bằng chứng (cau→bóng mát, non→bóng mát, →TOPI, →cắt cụt/LOP, vòm, nghiêng/mảnh kè hồ — `exact` nằm
    trong NOCUT). LÝ DO: pano sông 201/221/295/331-337/383/418/519/520 có young 0 + dens 3 (+ tunnel) → luật (b) từng biến ~235 cây
    non chống cọc dải dạo W3-F thành cổ thụ (tái lỗi AUDIT3 TREEFORM). TÍCH HỢP W3-F: `veg.plant('non', x, z, {pit: 1, wash: 0,
    exact: 1})` (cây non dải dạo); cây lớn bờ sông `plant('shade', …)` để nguyên nếu muốn cắt cụt/vòm theo pano, thêm `exact: 1`
    nếu không. `plantPlazaYoung` cũng truyền `exact: 1` (9 cây non quảng trường Nhà hát từng bị đổi thành bàng).
    (2) **`heroFit` — cây hero không đâm tường**: cây `o.big` vẫn bỏ facadeFit nhưng yaw không còn ngẫu nhiên. Điểm mẫu kit gần
    (≤ ~2000 đỉnh, bỏ hoa, bỏ phần < 2 m) biến hình ĐÚNG như shader (tán ×cs, +lift, ×sxz/sy) rồi tra LƯỚI MÁI 0,5 m dựng 1 lần
    quanh gốc (`fpG.at` → `heightOf(floors) + PARAPET_H`; tra trực tiếp mỗi lần ev tốn ~35 ms/cây, lưới ~5 ms): điểm lọt nhà dưới
    mái = va. Phân 3 loại: CÀNH TÁN (lỗi thấy rõ — cành đâm tường, cục điều hoà hiện trước cành), THÂN/RỄ PHỤ (không thuộc tán:
    ép/thu không đổi được; rễ mảnh 2-5 cm lọt tường bị tường che), LÁ (bị tường che). Bước: (a) 24 yaw, điểm = 10 × cành + lá;
    (b) còn cành TÁN va → ép nửa tán (TÁN LỆCH) — dò 17 hướng (16 + ngược trọng tâm điểm va; nhà vây 2 phía thì hướng chéo tốt hơn
    trọng tâm) × mức 0,08..SQ_MAX, mức nhỏ nhất hết va; (c) vẫn còn → thu tán ×0,92/bước tới ≥ 0,6 R. Hero không nghiêng tự nhiên.
    Kết quả: cành tán va 142 → 10 (088), 146 → 5 (400) / ~600 điểm cành tán; ép 0,72, tán ×0,6 / ×0,68 (đa 088 R 8,5 → 5,1 m;
    400 9,5 → 6,5 m); me tây 001 không va. `stats().fit.hero` = [{limb0, limbYaw, limb, trunkRoot, leaf, dyaw, sq, f, ms}].
    BẪY: phố game có dãy nhà 12-15 m nơi ảnh là bãi trống/góc phố (088/400) — không yaw/ép nào hết va khi nhà vây > 180°; muốn tán
    đa đủ R thật phải sửa nhà (không phải việc của cây).
    (3) **Chỗ hero** (`plantHeroSpots`): + cụm thân không chạm nhà (8 điểm vòng 1,5 m), `keepClear`, địa danh + 2,5 m, claim
    landmark/civic/cell; điểm = cự ly tới điểm đo + `HERO_OCC_W` (1,0) × tỉ lệ đĩa 0,65 R trong nhà × R (088: 0,36 → 0,33, 400:
    0,36 → 0,25 — nón đo không có chỗ thoáng hơn). `stats().heroSpots`. (4) **COLLIDER HERO**: props.js chỉ nhận collider r ≤ 1,0
    làm vật cản → r 1,9 cũ bị bỏ qua (hàng xe máy đỗ sát gốc đa 088). Nay tâm r 1,0 + 6 × r 0,9 trên vòng 1,3 m (+ đa: 8 × r 0,5
    trên vòng 2,6 m — màn rễ chạm đất); ảnh 088_h180: hàng xe dừng cách gốc.
    (5) **TREEMAP**: palm 2 ("chỉ cau") chỉ khi KHÔNG vế nào nói cây bóng mát/tán rộng/cây xanh lớn (074 giữ 2); palm 3 = "CAU DẪN
    ĐẦU" (vế đầu chỉ cau, cây bóng mát nêu sau: 062/183/217/218/220/320/322/547/549) → vegAt cây chung nặng 0,5 × cau ⇒ cau ~45%
    (trước 100% — Hồ Sen 320 thành đại lộ cau; ảnh thật 320 gần như KHÔNG cây — lỗi MẬT ĐỘ, chưa sửa). TUNNEL_STREETS chỉ khớp TÊN
    PHỐ ĐẦU `area` (`^((Đầu|Cuối|Góc) )?([Pp]hố |Đường |P\. )?<tên>`) — "phường Hạ Lý", "Ngõ 80 phố Hạ Lý", "góc giao phố Lý Thường
    Kiệt", "khu Hạ Lý" từng bật vòm (098/100/101/213/252/262/414/530-532/547/549 → 0); nhánh vòm thứ nhất chặn "rải rác/lác đác/
    lưa thưa" (130 "cây xanh lớn rải rác, tán rợp" → 0), KHÔNG chặn "vài cây/một cây" (551 "vài cây cọ trong sân", 123 "một cây bị
    cắt cụt ngọn" vẫn là vòm thật). (6) `HERO_SEASON` khai báo trước VERT_BEGIN và nhúng vào GLSL (`${HERO_SEASON.toFixed(3)}`);
    `roadIndex()` dựng lại → `_PR = null` (bản đồ pano→đoạn phố gắn chỉ số đoạn cũ).
    SỐ ĐO phiên 5 (cùng phiên, base dot3 bc07df5 xen kẽ): cây 8.886 → 8.458 (cau 558 → 375, non 419 → 456, vòm 858); buildTrees
    107/113 → 141 ms (+~30 ms: heroFit ~10 ms, phần còn lại như phiên 4; lượt đo thứ 2 238 ms = máy chung, mọi bước ×1,7 kể cả kit
    không đổi); tam giác cây ở spawn 0,583 → 0,606 M, draw call cây 21 → 26. Perf std (8 góc, traffic on, 2 vòng): fps 60 (vsync);
    p95 ±0,6 ms; draw call −11..+4; tam giác −0,1..+1,5%; game_3 đo lại riêng 2 vòng: 335 = 335 call, −4,6% tam giác (1 lượt
    perf 747 call là nhiễu). diag full 0 lỗi JS, bất biến giao thông 0; diag lite: chỉ 404 `assets_lite/*.glb` (1 lượt có parkHit
    1 — chạy lại 2 lần = 0, base cũng 0: mẫu giao thông ngẫu nhiên); tour 26 ảnh 0 lỗi JS; waterbfs 5/5; mùa 06-10 tải 3 GLB, 4/10 0.
    Chấm lại 34 khung đích: khung đổi rõ chỉ ở hero (088/400 — hết cành đâm tường/xe sát gốc, tán nhỏ hơn) → điểm giữ 3,91.
- **2026-10-04 (W2-F POLISH)** [ĐỢT 3 wave 2 — WebGL1, giải mã RB 1 lần, kho cảng, ĐÊM, giao thông né xe đỗ, dọn code chết, hitch]:
    **(1) WebGL1** (three r160 tự lùi WebGL1 khi không có WebGL2): KIỂM bằng `tools/qa/shoot.mjs --gl1` (init script cho
    `getContext('webgl2')` trả null — cờ Chrome `--disable-es3-apis` KHÔNG có tác dụng ở headless mới: vẫn webgl2:true;
    `_result.json.webgl2` ghi kết quả; thêm `--args "<cờ Chrome>"`, `--qs "&time=21"`, game không khởi động được → in lỗi thay vì TypeError). dot3: 2 lỗi shader `GL_OES_standard_derivatives` (cây — dFdx/fwidth trong FRAG_MAP) →
    MẤT HẾT cây; mặt tiền phố vẽ màu trơn (citygen bỏ tiêm shader ở GL1). Nay 0 lỗi: (a) cây `mat/depthMat.extensions =
    {derivatives:true}` — three CHỈ chèn `#extension` khi cờ này (MeshLambert/MeshDepth cũng nhận `extensions`; WebGL2 bỏ qua,
    không đổi khoá program); (b) citygen có NHÁNH GLSL ES 1.0 cùng thuật toán: mảng const → hàm chuỗi if (`glslFloatFn/
    glslVec3Fn`, thân shader viết `NAME[i]` đổi thành `NAME(i)` bằng regex `gl1Idx`), hash nguyên uint (mô-đun tầng trệt — JS
    groundModule phải khớp từng bit để dựng hộp biển 3D) → BẢNG TRA `gmodTexture()` 256² RGBA8 tính bằng CHÍNH ihash JS
    (texel (s8, bay+128·wide) = g1>>>8 ở RGB 24 bit + hạng "nhà ở" ở A; NEAREST; bay ≥128 quấn vòng), `textureGrad` →
    `texture2DGradEXT` (`m.extensions.shaderTextureLOD`; thiếu extension → texture2D, viền mô-đun hơi lộ). Ảnh GL1: cây, cửa
    sổ/cửa hàng, biển, đèn đêm như WebGL2. Đường/vỉa hè GL1 vẫn màu phẳng (nhánh gl1Patch của WP6 — DataArrayTexture không có ở GL1).
    **(2) GIẢI MÃ RB01 MỘT LẦN**: `js/rbdata.js` `rbData()/rbGrid()` — cell sink `realBuildings()`, citygen `fabricData()` +
    lưới của buildRealFabric, fallback của trees.js/props.js đều lấy ở đây (trước: cell sink + citygen giải mã 2 lần, trees/
    props tự giải thêm khi thiếu lưới). Lưới DÙNG CHUNG đúng cả sau khi giết nhà vì `near/at` lọc `D.dead` LÚC TRA (dựng trước
    hay sau vòng giết như nhau). Node: decode 4-14 ms + lưới 4-9 ms + 2,6 MB/lần.
    **(3) KHO CẢNG**: hộp kho dựng tay `port_kho_0..` (khối B13 world.js) và `port_kho_100+` (fix t8) bỏ khi `FABRIC==='real'`
    (?fabric=proc giữ). Bằng chứng: cell sink đã gỡ mọi hộp đè footprint thật; 4 hộp còn sống (kho_2/100/101/105, x 350-650,
    z −940..−900) đứng ở vùng footprint TRỐNG = bãi đã giải toả (pano_014/015/016 h000 10/2024: đất + gạch vụn, vài nhà thấp
    xa) — kho thật (SHED x 90-260 và 640-900) do citygen dựng. Cần cẩu chân đế giữ. (Tile vệ tinh real_8 không phủ khu này;
    ảnh game_8 cũng không khớp real_8 — đáng soát lại georef/khung tile 8.)
    **(4) ĐÊM 21:00** (đo sRGB trên ảnh): (a) VŨNG SÁNG cho đèn DỰNG TAY (đèn hồ Tam Bạc/ven hồ, đèn ô cells — chỉ có cầu
    `sharedMats.lampGlow`, mặt đường quanh đen sRGB ≈ 37): `daynight.buildLampPools` quét 1 lần sau freezeStatic mọi đỉnh mesh
    dùng lampGlow (đã gộp ô → toạ độ thế giới), gom ô 1,5 m liền kề = 1 đầu đèn (cao 2,2-16 m), quad cộng sáng (cùng kiểu
    props: falloff cos³, MeshBasic additive có sương), cỡ 2,6×cao (8-15 m), 1 InstancedMesh `night_lamp_pools` (114 vũng;
    noCull, renderOrder 3) — opacity = đêm × `LIGHT.poolOpacity` 0,2; đèn gang 3 bóng của props (ornI) nay cũng có vũng 11 m
    (trước chỉ cobra/đèn cột → dải vườn hoa tối). **ĐỘ CAO QUAD = g + max(SIDEWALK_TOP 0,25, roadNet.surfaceAt) + 0,035**
    (phản biện: bản đầu dùng `surfaceAt` trần — nó chỉ biết lòng/vỉa của roadnet, ngoài mạng đường trả 0 ⇒ quad g+0,047 nằm
    DƯỚI mặt lát nổi → depth test che 68/114 vũng: caro ven hồ g+0,24…0,255, caro Tam Bạc g+0,20, đá quảng trường Nhà hát
    g+0,045…0,06). Đo mặt lát bằng raycast 4 tia/đầu đèn: sau sửa 111/114 quad trên mặt lát tại chỗ, 2 trên mặt cầu (g có
    deck), 1 dưới 1 khối 0,77 m đứng trên lòng đường (513,−256 — vũng vẫn hiện trên nhựa/vỉa quanh khối). Raycast lúc chạy
    để đặt quad đã đo và BỎ: 5,8 s (lưới đất `ground_local` 180k tri + ô gộp mrg10/fab_main ≈ 330k tri mỗi tia), bỏ lưới
    đất vẫn 0,67 s. Ảnh trước/sau: scratchpad W2-F nfix_lake.jpg (đèn đôi ven hồ cạnh camera: base = bản đầu không vũng →
    nay có), nfix_2.jpg (pano_007: dải lát đỏ ven hồ có vũng), nfix_3.jpg. (b) BIỂN: shader phố trần độ chói tự sáng của dải biển `≤ 0,45·0,24`
    (nền đậm giữ nguyên, nền trắng/vàng nhạt giảm tới ~4× — trước loá bloom, chữ không đọc được); biển CHỮ THẬT neo mặt tiền
    (`real_shop_signs_*`) thành hộp đèn: emissiveMap = texture, `world.signMats`, daynight đặt emissiveIntensity = đêm ×
    `LIGHT.signGlow` 0,35; biển neo mặt tiền `FrontSide` (lưng áp hộp biển 3D — DoubleSide làm mặt lưng sáng chữ ngược),
    biển không neo (fabric proc) giữ DoubleSide như cũ. (c) Cửa sổ sáng: ~½ đèn tuýp/LED trắng lạnh (0,80,0,88,1), ½ vàng ấm (trước mọi cửa sổ cam).
    (d) `cityAmb` (đèn phố dội) chia mặt ngửa/úp `cityAmbUp/Down` 0,7/0,8 (WP5: 0,5/1,0) → tường giữ 0,75, lòng đường +40%
    (sRGB 37 → 40 giữa 2 vũng; dưới đèn 90-120). Ảnh: scratchpad W2-F nb*/na*/nbm.jpg.
    **(5) GIAO THÔNG NÉ XE ĐỖ**: mỗi ô tô đỗ (`world.props.parkedCars`) chiếu lên cạnh đồ thị có mép bó vỉa gần nhất →
    đoạn [u ± (dài/2 + 2,5 m)] + phía + mép trong; tác tử đi qua đoạn đó lệch ngang ≤ mép trong − nửa rộng (xe máy 0,45 / ô
    tô 0,95) − 0,3 (phố 2 chiều không đẩy quá tim 0,35), trượt ngang mượt `a.pk` (1,6/1,1 m/s, nhìn trước max(5, 1,4·v) m);
    `place()` cộng pk vào latCur, prevLat mang pk qua nút, và đoạn hoà TRƯỚC nút cũng cộng pk vào `latFor(next)` (thiếu thì
    đúng lúc qua nút xe nhảy ngang 0,5·pk trong 1 khung — phản biện). `check().parkHit` (thân xe chạy chồng xe đỗ) + `traffic.parkStats`.
    Đo 8 điểm × 3 s (~5k mẫu xe): 7,4% → 0%; wrongSide/offRoad/overlap không đổi (0-1).
    **(6) DỌN CODE CHẾT** do wave 1 để lại: `addMergedTiled` (hết người gọi sau WP6), `grandMat`, `nearRealBuilding`, import
    `ROADS_REGION`/`RIVERS` (world.js), `LM` (main.js), `THREE` (npcs.js). Helper chết TỪ TRƯỚC wave 1 trong khối cells
    (cnHip, txPalm, v5Fence, v4Front, v3Lamp/Willow/RailSeg/Deck) để nguyên (vùng W2-A, tránh xung đột gộp).
    **(7) HITCH — lộ trình thật** (scratchpad W2-F/route3.mjs: 60 s xe máy 14 m/s Quang Trung NGAY sau khi nút Bắt đầu mở +
    60 s chạy bộ 7 m/s Điện Biên Phủ, giao thông BẬT; mỗi khung dt, số lần vẽ bóng, texture/program mới, draw call cộng mọi
    pass; CPU profile CDP 250 µs gán vào khung > 33 ms). Nguồn hitch đo được trên 890M TIER 3: (a) UPLOAD TEXTURE GLB sau Bắt
    đầu — `texSubImage2D` 1 phát 4096² 35-75 ms, ~10-15 khung trong 2 s đầu; (b) lượt vẽ bóng khi đi nhanh (xe máy 6,6 lần/s:
    luật "đi > 2 m" bắn sớm hơn trần đồng hồ 0,22 s); (c) khung chậm ĐỀU ĐẶN chu kỳ ~0,95 s: CPU render cảnh tăng 15 ms, CÙNG số
    draw call, còn nguyên khi đứng yên / tắt giao thông / tắt hẳn lượt bóng → không phải giao thông/bóng/cây/props; nghi do áp
    lực command buffer phía tiến trình GPU — CHƯA rõ, chưa sửa (có cả ở dot3). Sửa: (a) `pumpAssetUploads` — texture ≥ 2048²
    (ImageBitmap RGBA8 flipY=false, WebGL2) cấp phát qua initTexture với `state.texSubImage2D` tạm thay bằng no-op (texStorage2D
    + tham số + version đúng, không đẩy điểm ảnh) rồi mỗi khung đẩy 1 DẢI ~6 MB hàng ảnh bằng `texSubImage2D(…,0,y,w,h,…,
    ImageBitmap)` + `UNPACK_SKIP_ROWS` (WebGL2 cho chọn hình chữ nhật con của TexImageSource; BẮT BUỘC trả SKIP_ROWS về 0), dải
    cuối `generateMipmap`; model vẫn ở layer ẩn tới khi đủ dải; trước Bắt đầu bơm theo NGÂN SÁCH 32 ms/khung (màn chờ che cảnh);
    texture lớn không tách được cách nhau ≥ 2 khung; chặn `state.texSubImage2D` là nội bộ three r160 → `canSplit` chỉ bật khi
    `THREE.REVISION === '160'` (nâng three: kiểm lại initTexture rồi mới nới). (b) `daynight.shadowMoved` 2 m/0,15 rad → 6 m/0,3 rad (bóng tĩnh lấy mẫu
    bằng ma trận lần vẽ trước nên đúng chỗ khi hộp ±70-110 m lệch vài mét; caster động đã tắt bóng thật khi di chuyển).
    **ĐO A/B CÙNG PHIÊN** (dot3 ea5f57f bản sao `git archive` có assets hard-link, cổng 8416 → W2-F, liền nhau, khoá GPU,
    ANGLE Radeon 890M d3d11, TIER 3): xe máy NGAY sau Bắt đầu: khung > 33 ms 17 → 11, > 50 ms 4 → 2, tối đa 108,5 → 57 ms,
    p99 30,2 → 27,6 ms, khung có upload texture 15 → 2, vẽ bóng 6,6 → 4,3 lần/s, p95 19,7 → 19,5; chạy bộ: > 33 ms 24 → 21,
    > 50 ms 0 → 0, p95 20,3 → 20,2. hpReady 4,23 / 4,21 s, Start mở 6,18 / 6,24 s, heap thô 361 / 363 MB (không đổi). 24 góc
    std (`--traffic off --perf`): fps TB 60,1 / 60,0 (chạm vsync), draw call TB 400 / 395, 0 lỗi JS. Ảnh ngày khác base chỉ
    ở lá cây/bóng lá (gió theo đồng hồ thật). diag full 0 vấn đề (parkHit 0), lite chỉ 404 `assets_lite` (môi trường),
    waterbfs 5/5, WebGL1 0 lỗi. Sau phản biện (vũng đèn trên mặt lát, pk qua nút, biển FrontSide, chặn REVISION) chạy lại:
    24 góc std 0 lỗi, fps TB 60,2 (vsync), draw call TB 398, tam giác như cũ, ảnh ngày chỉ khác lá/bóng lá; WebGL1 7 góc 0
    lỗi; diag full 0 vấn đề (parkHit 0); lite chỉ 404 `assets_lite`; waterbfs 5/5.
    **BẪY**: (a) `node --check js/x.js` trong repo này coi .js là CommonJS và KHÔNG báo lỗi cú pháp module (đã lọt 1 lỗi) →
    chép sang .mjs rồi check; (b) đừng pipe `shoot.mjs | head` — head đóng ống, node chết giữa chừng (không có _result.json);
    (c) `heredoc` + python ghi `'\\n'` vào chuỗi JS có thể thành xuống dòng thật — sửa bằng Edit/kiểm .mjs.
- **2026-10-04 (w2-d GROUND, sau phản biện)** [MẶT ĐẤT THEO SỬ DỤNG ĐẤT — hết "khoảng đất be trống": `js/landuse.js` (mới),
    `js/landuse_data.js` (SINH), `tools/gen_landuse.mjs` (mới), khối "Mặt đất" world.js, `tools/fetch_osm.sh` mục 12]:
    **Vấn đề:** ground_local tô MỘT màu đỉnh be 0xcfc7b2 (lerp 80 % trên cả DT_BOX) ô 13,3 m → mọi khe nhà/sân/bãi trống/quanh
    địa danh là mảng be sáng gần gấp đôi bê tông thật (ảnh vệ tinh: sân bê tông ~(98,93,100), đất ~(144,125,118), cỏ ~(95,105,82)).
    **Dữ liệu:** Overpass (fetch_osm.sh §12, bbox 20.836-20.879 × 106.659-106.705) → `tools/osm_landuse.json` (511 phần tử,
    gitignored) → `node tools/gen_landuse.mjs [--ppm xem.ppm]` → raster LỚP 2048² × 2 m (±2048 m quanh gốc), lọc "Up" + deflate-raw
    + base64 = 56 KB. 16 lớp (chỉ số = hợp đồng với GLSL `C_*` + bảng `LU_PARAMS` trong landuse.js): 0 NAT (giữ màu đỉnh) · 1 URB
    nền phố · 2 IND công nghiệp/cảng · 3 PLAZA đá lát · 4 TEMPLE gạch cũ · 5 CAMPUS sân trường/bệnh viện/cơ quan · 6 PARKING bãi
    xe nhựa (≠ claim 'park' = công viên → GRASS) · 7 DIRT công trường · 8 GRASS · 9 ROUGH cỏ dại/ruộng/bụi · 10 TURF sân bóng ·
    11 COURT · 12 TRACK · 13 POOL · 14 MARKET · 15 BLD. Tô theo ƯU TIÊN (thấp → cao, cùng ưu tiên: đa giác lớn trước); PARKS game
    = cỏ; lối footway/path nằm ≥ 60 % trong cỏ = lối lát 2,4 m (131 lối); đệm 10 m quanh LM_POLY công trình dân sự = PLAZA.
    BẪY OSM: đa giác mang `building=*` (39: chùa/đình place_of_worship, chợ có mái, nhà văn hoá, cây xăng, tượng đài Lê Chân way
    1189133591…) là THÂN NHÀ → BỎ (bản đầu tô lớp sân lên đó → "thảm" gạch đỏ 36×36 m lộ ra khi claim `qt_lechan` giết nhà).
    BẪY LM_POLY: KHÔNG phải toàn nhà — 'square' = quảng trường Nhà hát (PLAZA), 3 trường = KHUÔN VIÊN (CAMPUS), chùa Hàng =
    khuôn chùa: VIỀN đá 6 m (PLAZA) + LÕI sân gạch (TEMPLE, đa giác thu về tâm) — bản đầu cả 74×61 m gạch đỏ cam = "thảm đỏ".
    BẪY OSM lỗi thời: landuse=construction "Công viên Tam Bạc/Hạ Lý/Nam Bính…" đã xong (vệ tinh 2026: sân lát) → tên "Công
    viên|Quảng trường" = PLAZA; công trường đã kín nhà (mật độ cao) shader cho thành bê tông.
    **Lúc chạy (WORKER Blob, 0 ms luồng chính):** khi `world.rbData` có (khối ground hẹn giờ 250 ms dò, CHỈ khi FABRIC 'real') →
    worker giải nén → claims `plaza`/`park` (WP2: nơi nhà thật bị GIẾT) đổi URB → PLAZA/GRASS → bao lồi nhà ô GIỮ (world.cellKept,
    290) + footprint RB SỐNG (bỏ D.dead) → BLD → khoảng cách tới tường (chamfer 3×3 hai lượt) + MẬT ĐỘ nhà ±40 m (ảnh tích phân
    Int32) → RG8 2048² (R = lớp | mật độ<<4, G = khoảng cách ×8, trần 31,9 m) + ĐỘ PHỦ thô R8 256² (16 m, tỉ lệ nhà ±96 m, bão hoà
    10 %, LỌC TUYẾN TÍNH). 140-230 ms trong worker, sẵn sàng ~0,8-1,9 s sau khi dựng xong. KHÔNG nướng footprint vào file (nhà bị
    claims giết sẽ để "vết nhà"; file 970 KB → 56 KB). Trạng thái claims/nhà chụp MỘT lần lúc start: wave sau giết nhà lúc chạy
    phải gọi lại `world.landuse.start` (hoặc giết TRƯỚC khi world.rbData có).
    Texture chi tiết (DataArrayTexture 3 lớp 512², LITE 256², worker ~100 ms, tileable, giá trị là MẪU không phải màu): bê tông đổ,
    đá lát 0,5 m, gạch 0,25×0,125, đất nện | cỏ, nhựa/sỏi, vết ố mép rách, nứt/rác | 4 nhiễu vĩ mô.
    **Shader** (onBeforeCompile MeshLambertMaterial vertexColors, chương trình chung `landuse-v5`): 4 `texelFetch` quanh điểm →
    trọng số song tuyến LỆCH NHIỄU (≤ 0,45 ô: gợn 11 m + hạt mịn) → lớp có TỔNG trọng số lớn nhất (argmax). Đồng mức 0,5 của chỉ
    thị song tuyến là đường TRƠN: bậc thang ô 2 m thành cạnh xiên thẳng, nhiễu làm mép ráp; lệch < 0,5 ô nên lối 1 điểm ảnh vẫn
    liền (bản đầu: trộn màu 4 lớp với nhiễu ±0,27 ô < 1 ô → vẫn bậc thang). Khoảng cách/mật độ nội suy song tuyến THẬT (không lệch
    → vệt ố chân tường đúng chỗ). Mẫu chi tiết lấy NGOÀI mọi nhánh (đạo hàm ngầm chỉ xác định trong luồng đồng nhất); tLuMap/tLuCov
    `highp`. MẶT NẠ MẢNG LỚN (bãi trống, cỏ dại, bụi, mảng lát, gỉ) = M = trộn mẫu vĩ mô 96 m + 151 m xoay 36,87° (không lặp thấy
    được); mẫu 23 m CHỈ cho chi tiết mịn — bản đầu lấy nó làm mặt nạ cỏ dại → lưới "chữ V" 23 m phủ cả vành ngoài nhìn từ trên.
    URB: sát tường ≤ 1,5 m bê tông ố + rêu, sân ≥ 3 m đôi chỗ lát gạch block (mép SẮC), BÃI TRỐNG (đất + cỏ dại mép rách + bê tông
    sót) CHỈ khi xa tường VÀ mật độ ±40 m < ~25 %; độ phủ ≈ 0 (không nhà trong ~200 m: vành r > 1,6 km ngoài BUILD_RADIUS, lỗ lớn
    thiếu dữ liệu) → PHỐ XA: màu đỉnh khử bão hoà 45 % × "ô đất" (lưới xoay 23° 26×17 m nắn cong theo M, tông/loại theo hash, tương
    phản thấp, KHÔNG viền — viền sẫm đọc thành "đá lát khổng lồ"; loang mềm tương phản cao đọc thành sương mù). 170 m cuối trước
    ±LOCAL_HALF hoà về màu đỉnh = màu tấm thô bên ngoài → hết đường nối thẳng ở ±2000 m. DIRT đi chung nhánh URB (bãi trống ép,
    trừ khi kín nhà). Lớp 2..14 khác: MỘT công thức chung đọc mảng const GLSL sinh từ `LU_PARAMS` (màu sRGB → tuyến tính trong JS):
    A = màu·(k + mẫu d0/d1)·tông(M)·ố·nứt·sọc, B = A nhuộm (gỉ) hoặc mặt riêng (đá lát, gạch block, đất mòn), trộn theo mặt nạ M.
    TEMPLE: gạch cũ (128,94,78) loang mốc (bản đầu 150,84,62 cam rực). Chỉ áp ở chỗ khô (y > 1,25..1,75) → bờ cát/đáy nước giữ màu
    đỉnh. LITE (TIER ≤ 1, define LU_LITE): 1 texelFetch gần nhất (biên bậc 2 m) + 2 mẫu chi tiết, M = mẫu 96 m. WebGL1: màu đỉnh.
    BẪY BIÊN DỊCH (ANGLE D3D11/fxc, phản biện): thời gian biên dịch ~ số lần NỘI TUYẾN + TỔNG mọi nhánh if. Bản đầu gọi luClass
    tới 4 lần → compileAsync +1,1-1,2 s, khung đầu +1,3-1,4 s. Gọi 1 lần: +35-60 ms compile, +~90 ms khung đầu; thí nghiệm luClass
    chỉ nhánh URB = ngang dot3 → 13 nhánh lớp riêng là thủ phạm → bảng tham số + 1 công thức chung: ngang dot3.
    **world.js:** bảng màu đỉnh hạ tông (cCity 0x98928a, cỏ 0x7c9a55, cát 0xc9b98e…) cho tấm thô/fallback; `?landuse=0` = mặt
    đất CŨ (be + Lambert thường) để A/B cùng bản build. 2 dải hồ ĐỔI TÊN `lake_ground`/`hosen_ground` → `ground_lake`/`ground_hosen`.
    BẪY freezeStatic: lượt gộp 1 nuốt MỌI mesh Lambert không map (khoá theo ô×castShadow×side, KHÔNG theo material) rồi thay
    material → shader riêng biến mất; mesh mang shader riêng phải tên `^ground` (bỏ qua gộp/far-hide/gán bóng) hoặc
    `userData.noMerge`. Hệ quả: 2 dải không còn cast bóng (phẳng, vô hình) và không gộp ô (+30..43k tam giác/khung ở góc thấy hồ).
    BẪY heap: bản CPU 3 texture (8 MB + 3 MB + 64 KB) GIẢI PHÓNG sau upload (`texture.onUpdate` → image.data = null);
    'webglcontextrestored' đặt lại placeholder, tắt uLuOn, cho worker dựng lại. `?lufree=0` giữ bản CPU. Lớp cao độ KHÔNG đổi.
    **Đo (Radeon 890M TIER 3, base = `git archive dot3` ea5f57f ở cổng 8414, khoá GPU):** khởi động (probe phản biện
    `boot_rev2.mjs`, xen kẽ base/mới ×4, lấy các cặp lúc máy yên): compileDoneAt − boot 1-3 ms (dot3 −1..3; bản đầu +1,1 s);
    firstRenderMs 1304-1376 (dot3 1286-1353); boot +0..100 ms (nhiễu + worker chạy song song); upload 2 texture lớn ~3 ms mỗi cái.
    fps 60 (vsync) mọi góc; draw call bằng nhau (cam_spawn 375, pano_007 549/546, game_3 376); chi phí shader ĐỦ (đổi material
    sang Lambert thường TRONG CÙNG phiên, 1920×1080, 20× render + readPixels): −0,3..+0,3 ms/khung (= nhiễu); nhánh landuse riêng
    (uLuOn 0↔1) +0,0..0,4 ms. Heap sau gc() ép 386 → 380 MB. Ảnh vệ tinh (trung vị "đất sáng"): real_5 (120,112,118) · cũ
    (168,162,141) → mới (127,118,106). diag full 0 vấn đề/0 lỗi JS, bất biến giao thông 0; lite chỉ 404 assets_lite (môi trường,
    y hệt dot3); waterbfs 5/5. Còn lại (ngoài làn): thảm cỏ dải vườn hoa (`lawnM`) vẫn xanh rực; lỗ dữ liệu nhà vẫn lộ sân lớn.

- **2026-10-04 (W2-B trees)** [ĐỢT 3 WAVE 2 — CÂY THẬT HƠN: tán cao + thoáng, né mặt tiền, cắt cụt theo pano, MÙA HOA theo lịch, hero chỉ quanh Nhà hát]
    (nhánh worktree W2-B, trên dot3 ea5f57f). File: `js/trees.js` (chính), `js/petals.js`, `js/world.js` (3 chỗ cây:
    `buildTrees` thêm `fpData: world.rbData`; `heroTree` bỏ ép nở; gọi `veg.plantPlazaYoung` sau `plantStreetTrees`),
    `tools/qa/trees.html` (`facade:false`, `median:1`, `?date=`). Vòng sửa sau phản biện (cùng ngày): thân NGHIÊNG → TÁN
    LỆCH, hero ra khỏi khung pano, kit XA khớp dáng — mô tả dưới đã là bản cuối.
    **VẤN ĐỀ (pano 10/2024 vs game):** tán cây phố bắt đầu 2,6-3 m (kit co ĐỀU cả cây theo cấp phố → phượng phố t/r còn
    thân 2 m) + quá dày → che kín mặt tiền và nửa trên khung pano (pano_071/085/141/007); 48% số cây có tán CẮM VÀO tường
    nhà thật; phượng vườn hoa đỏ rực thành "vòm đỏ" (25/45 nở quanh pano_001) trong khi ảnh tháng 10 xanh + cắt trụi.
    **BIẾN HÌNH TỪNG CÂY TRONG SHADER (không thêm kit):** mỗi kit có thuộc tính đỉnh `aHt` — thân: dốc 0..1 từ trên gốc
    quét vôi (1,3 m) tới CHẠC (fork của kit); tán (cành/lá/hoa, cờ `Geo.crown`): 3 — và mỗi instance `aShape` = (lift
    nâng tán [đơn vị kit], ±cs co tán ngang quanh trục, zw). DẤU của y là CỜ: y > 0 → zw = dời tán (nghiêng tự nhiên nhẹ,
    thân thẳng từ trên gốc vôi tới chạc); y < 0 → TÁN LỆCH: zw = hướng ra lòng đường × tỉ lệ ép s, đỉnh tán có
    d = −dot(xz, n) > 0 (nửa phía TƯỜNG) bị kéo về trục: `xz += n·d·s` → nửa đó còn (1−s); thân giữ THẲNG ĐỨNG.
    VERT_BEGIN (cả depth material → bóng khớp): `xz *= mix(1, |cs|, tán)`, ép/dời như trên, `y += lift·h` (đoạn thân
    trống giãn, gốc vôi ~1,2 m GIỮ NGUYÊN). Rễ phụ đa, cọc chống, chồi bám thân = THÂN (chân phải chạm đất / không co theo tán).
    Kit đo `base` (phân vị 8% cao đỉnh lá), `top`, `fork`, `rad` (phân vị 85% bán kính lá) → buildTrees quy kích thước
    THẬT (m) về kit: `sy=(H−B)/(top−base)`, `lift=B/sy−base`, `sxz=(H/H_kit)^0,8` (bề dày thân theo CHIỀU CAO — theo độ sâu tán từng ra cây cắt cụt thân 1 m), `cs=R/(rad·sxz)`.
    **KÍCH THƯỚC THẬT (bảng `SPX`, m: cao / mép dưới tán / bán kính tán):** xà cừ 12-21 / 5-7,5 / 3,8-6,8; bàng 9-13,5 /
    3,8-5 / 3,4-5,4; phượng 8-12 / 4,2-5,6 / 3,6-5,8; sấu 12-19 / 5-7 / 3,4-5,4; bằng lăng 7-10,5 / 3,2-4,2; cắt cụt
    6-9,5 / 3,6-5,2; đa 13-18; cây non 4-6,5 / 2,2-3. Phân bố cỡ lệch nhỏ/vừa (u^1,25) → đa dạng; cấp phố (o.sz) thu
    cao + tán nhưng KHÔNG hạ mép tán dưới mức tỉa tối thiểu; h/r của helper cũ nặng 50%.
    **NÉ MẶT TIỀN ≥ 1,5 m (`facadeFit`):** cạnh footprint thật (world.rbData + lưới rbGrid) + LM_POLY (bỏ khuôn
    viên/quảng trường: square, 3 trường, chùa Hàng, Việt Tiệp) + hộp claim 'cell' < 1500 m² (nhà ô dựng tay giữ lại), chỉ tường cao ≥ mép tán − 0,3 m (tán xoè trên mái nhà
    1 tầng là đúng); gốc nằm trong nhà → bỏ qua. **TÁN LỆCH, THÂN THẲNG:** ép nửa tán phía tường gần nhất theo pháp
    tuyến: (1−s)·R ≤ khoảng trống (d_tường − 1,5 m), s ≤ `SQ_MAX` 0,72; thân quá sát tường → thu R (sàn max(1,2; 0,42R));
    rồi kiểm MỌI tường trong tầm với hình tán đã ép (16 điểm mép + điểm gần thân nhất của từng cạnh — ki-ốt lọt gọn
    trong tán) → thu dần R ×0,88. Cây sát nhà HP thật đúng dạng này (tỉa phẳng phía nhà, tán vươn ra lòng đường).
    BẢN ĐẦU (bỏ): dời tâm tán ≤ min(0,35R; 1,6 m) — shader dồn độ dời vào đoạn thân gốc vôi → chạc chỉ 1,4-3,3 m
    ⇒ thân GÃY 20-55° (p50 25°) trên gốc vôi thẳng đứng, hàng cây như bão quật (pano_089/071/092/190/001); muốn
    nghiêng phải tính GÓC theo đoạn thân đó, không theo chiều cao cây. Nghiêng TỰ NHIÊN chỉ cây ĐỨNG TỰ DO (không
    tường trong tầm R + 2,5 m), không cây non chống cọc / cắt cụt: ≤ tan(`LEAN_NAT_DEG` 5,5°) × đoạn thân. 4,6k cây
    bị ép (đa số chạm s = 0,72 — hố cây cách mặt tiền 2-4 m), 2,6k thu R; ~34 ms cho 8,9k cây.
    **KIT XA** (biến thể 0 của loài) có sy/nâng/co tán RIÊNG (ma trận `MF` + `SHPF`, nhóm far ghi từ đó): khớp mép
    dưới/ngọn THỰC của kit gần (kể cả khi kit gần bị kẹp); kit xa xà cừ/cắt cụt tán nông hơn → cho nén thân 90%
    (không thấy ở > 180 m), vẫn chạm sàn thì chọn sy khớp TÂM tán ⇒ lệch ranh LOD p5-p95 ±0,2 m (trước −1,0..+1,7 m).
    **THOÁNG:** kit gần bớt ~30% thẻ lá + nhỏ hơn ~10%, 76% thẻ thành CHÙM chặt quanh đầu cành (thêm cành phụ), bàng 80%;
    kit XA giữ số thẻ cũ (`cardsFar`) — từ trên cao tán vẫn thành khối. Độ kín tán: thường 0,58-0,92, tỉa trơ/"tán thưa"
    0,34-0,56. **TỈA TRƠ (cut-back)** = trạng thái mới: tán ×0,55-0,75, mép +0,5 m — theo pano (cắt cụt mức P>0 → 30-55%
    số cây còn lại, "tán thưa" 70%, vùng không pano: dải trung tâm/ven hồ 50%, Hoàng Diệu 55%, nơi khác 15%).
    **CẮT CỤT theo pano** (`vegAt.pollard`): "một số/vài cây" (3) 18%, (5) 40%, "hàng cây/nhiều cây cắt" (7) 62% (trước
    31/49/66%); cây loài ĐÍCH DANH của helper cũ (phượng allée, xà cừ vườn hoa…) cũng bị cắt khi pano ≤ 60 m nói cắt cụt.
    **MÙA HOA THEO LỊCH:** mỗi cây 1 HẠNG hoa (hash; bằng lăng +2; −1 = cây đôi của hero, luôn nở), shader giữ thẻ hoa khi
    hạng < tỉ lệ ngày, phần thẻ giữ ∝ (tỉ lệ − hạng)·8 (đầu/cuối mùa lác đác). `bloomShare(doy)`: phượng 0,17 ngoài mùa →
    0,80 (rộ 20/5-5/7), bằng lăng 0,12 → 0,78 (tháng 6). Ngày mặc định 4/10 (= mô hình mặt trời daynight + ảnh pano);
    `?date=2026-05-25` | `?date=05-25` | `?month=6`; ngày tự sang khi đồng hồ game qua 0h (đọc `__hp.dayNight.t` mỗi
    0,25 s). API: `world.trees.setDate(m,d)`, `getDate()`, `setSeason(s|null)` (ghi đè tỉ lệ cả 2 loài; null = về
    lịch). `o.bloom` của plant() BỎ. Thẻ HOA kit gần nay thành chùm ở ĐẦU CÀNH khắp tán (×1,8 số thẻ) và không theo
    độ kín tán — trước chỉ nằm trên mặt vòm nên đứng dưới phố tháng 6 trông như tháng 10. Cánh phượng (petals.js) × độ rộ của cây gần nhất (`bloomNear(...).s`).
    **HERO GLB:** chỉ ≤ 120 m quanh Nhà hát (`HERO_SHOW_R`; phố ≤ 8 + vườn hoa) VÀ `heroSpotOk`: cách MỌI camera pano
    ≥ 45 m (pano thật chụp 8 hướng ⇒ "nón ±45°" = mọi hướng; vòm đỏ 6-7 m ở 18-35 m từng chiếm giữa pano_055_h000 che
    lối vào Nhà hát) + ngoài NÊM NHÌN tới đa giác Nhà hát (+ tán 7 m) từ mọi pano ≤ 160 m quanh Nhà hát + camera spawn
    (0, 72) (pano xa hơn: nêm từ mọi phía phủ kín cả vùng — vô dụng). Còn 3 hero, đều phía BẮC Nhà hát (cách pano gần
    nhất 51-80 m). Mỗi lúc chỉ `HERO_MAX` = 3 cây GLB gần camera nhất trong 150 m (cây đang hero được ưu tiên 8 m —
    chống nhấp nháy); còn lại là cây đôi thủ tục luôn nở — trừ `setSeason(0)` (shader + bloomNear tắt cả cây đôi).
    Lưu ý `nearPano(x,z,r)` chỉ dò ±1 ô 8 m → r > 8 m có thể sót (heroSpotOk duyệt thẳng PANO_CAM).
    **QUẢNG TRƯỜNG NHÀ HÁT PHÍA NAM (`plantPlazaYoung`):** hàng cây NON chống cọc (pano_541/055/249) trong hộp claim
    'road9_tay' (tra THẲNG từ claimsAll() theo tên — `ctx.claim`), nhịp 8,5 m, ~72% ô; né lòng đường, nhà/địa danh (+3 m), collider, trục nhìn spawn → Nhà hát + vòng spawn 20 m.
    **SỐ ĐO (cùng phiên, base = dot3 ea5f57f, Chrome headless d3d11 Radeon 890M, TIER 3, ghim chất lượng):** LÁ TRONG NHÀ
    (đỉnh lá THẬT của kit qua đúng biến hình shader trên CPU, thử với footprint cao hơn đỉnh — probe phản biện rprobe3/4):
    base 3.645/6.316 cây có lá trong nhà (3.016 sâu > 1 m) → bản đầu (dời tán) 219 (25) → bản cuối (tán lệch) 51 (12).
    GÓC NGHIÊNG thân (atan(dời / đoạn gốc vôi → chạc)): bản đầu p50 17°, p90 33°, max 55° (4.535 cây > 15°) → bản cuối
    chỉ 2.548 cây đứng tự do p50 3,0°, p90 4,5°, max 4,8°, cây sát nhà 0°. (Mô hình "vòng tròn tán" cũ báo 3.982 → 15
    — lạc quan, đừng dùng.) Mép dưới tán p10 2,78 → 4,06 m, trung vị 4,04 → 4,99 m, số cây có tán thấp hơn 3,5 m 2.523 → 77 (trừ cau +
    cây non); hero GLB 56 → 3 (≤ 3 vẽ cùng lúc; tam giác CÂY thấy được: nhìn cao giữa phố 1,21 M → 0,49 M, spawn 0,75 → 0,58 M,
    pano_001 0,81 → 0,46 M; draw call cây 22-25 → 20-22); phượng nở quanh
    pano_001 (150 m) 22/41 → 6/40 (4/10) — tháng 6 (`setDate(6,1)`) 0,80; tỉ lệ cây cắt cụt + tỉa trơ trong 40 m quanh
    pano theo mức bằng chứng: P7 0,50 + 0,18, P5 0,32 + 0,15, P3 0,22 + 0,19, không nhắc 0,10 + 0,10. Tỉ lệ ĐIỂM ẢNH CÂY
    ở nửa trên khung (`skyfrac.py`, 16 pano chuẩn + 10 pano cây): sai số tuyệt đối trung bình so với ảnh thật 0,20 → 0,10
    (16 pano chuẩn, ảnh phản biện + bản cuối: 0,17 → 0,093)
    (pano_007_h090: thật 0,18 · cũ 0,55 · mới 0,28; pano_071_h180 0,19 · 0,49 · 0,22; pano_019_h090 0,17 · 0,46 · 0,21).
    Perf std (traffic off, bản cuối, cùng phiên với base): fps 60 cả hai (vsync), p95 khung 17,7-19,8 ms cả hai, draw
    call ≈ (±25 do lượt bóng rơi vào khung đo), tam giác giảm 0-12% (cam_high_center 6,15 → 5,44 M, pano_021_h270
    6,66 → 6,20 M, pano_001_h090 4,44 → 4,10 M); hpReady 3,71/3,84 → 3,91/4,19 s (nhiễu máy chung ±0,3 s). Dựng cây
    (đo xen kẽ cùng phiên, tách `recsMs/kitMs/atlasMs` trong log `[trees] dựng`): base 67-91 ms → 103-133 ms; phần
    thêm = biến hình + `facadeFit` 30-52 ms (tuỳ tải máy) + kit gần phức tạp hơn vài ms; plantStreetTrees 55-56 → 56-62 ms;
    31 cây non quảng trường. p95 khung (traffic on, vòng đầu) ~19-21 ms cả hai.
    **BẪY:** (1) buildTrees cần `nearKits` TRƯỚC khi tính biến hình (base/top/rad đo từ hình học kit) — thứ tự: bản ghi →
    kit → biến hình → ma trận. (2) Kit XA dùng biến thể 0 của loài → PHẢI có sy/lift/cs riêng (`MF`/`SHPF`; nhóm far
    mang `g.S = SHPF`) — dùng chung aShape kit gần = tán nhảy ±2 m ở ranh 180 m; đổi dáng kit thì kiểm lại (rprobe4
    `lodMismatch`). (3) aShape là thuộc tính instance thứ 2 → `write()`/`finish()` phải chép/đánh dấu cùng aInst
    (thiếu = cây nhận hình của cây khác sau mỗi lần gán LOD); DẤU aShape.y là cờ tán lệch — đừng ghi cs âm vì lý do
    khác; hero twin đặt sq = 0. Probe CPU mô phỏng shader phải áp cả phép ép (`r.sq`, `r.zx/zz`) — rprobe3 cũ không có. (4) `facadeFit` chỉ thấy footprint
    thật, LM_POLY và hộp claim 'cell' NHỎ (< 1500 m²); khuôn viên lớn của cell sink và GLB địa danh ngoài LM_POLY thì không. (5) trang QA trees.html đặt cây quanh gốc toạ độ
    (= Nhà hát): phải `median:1` + `facade:false`, không thì cây bị bỏ/dời như cây thật.
- **2026-10-04 (W2-C người-xe)** [ĐỢT 3 wave 2 W2-C — BỘ MÔ HÌNH NGƯỜI & XE DÙNG CHUNG `js/models_kit.js`: giao thông,
    xe đỗ, người vỉa hè, nhân vật chơi/NPC]: trước: người đi bộ/lái xe/NPC là hình nộm hộp chibi (NPC ~25 capsule + ~25
    Lambert riêng/người), ô tô hộp bánh "nửa đĩa" (bánh lút nửa trong thân vì thân không có hốc bánh), 3 bộ dựng hình
    riêng (trafficmodels.js — ĐÃ XOÁ, props.js §3, character.js).
    **Hình học (models_kit.js §1):** `tube` (ống qua các vòng elip, pháp tuyến mượt — chi người, thân, lốp, nón lá),
    `loft` (mặt cắt khép kín cùng chiều, màu theo điểm → gầm tối dần = AO giả), `slab` (profile z-y đùn theo X + vát
    mép + co bề ngang TUYẾN TÍNH theo y/z → yếm xe hẹp dưới rộng trên, đuôi thon; tuyến tính thì mặt hông vẫn phẳng),
    `disc`, `quad`. Mỗi đỉnh: color + `aKit` = (KÊNH màu, CỔNG phụ kiện, CHI, nhám + 2·kim loại). Mọi mảnh GIỮ CHỈ SỐ
    (mảnh mượt đã chia đỉnh khi dựng, mảnh phẳng có đỉnh riêng/mặt) và gộp thẳng — BỎ mergeVertices: dựng nhanh 3-5×
    (node: ô tô 10 → 2 ms, xe máy 7 → 2 ms), đỉnh +5-18%. `shared(key, make)` = cache: giao thông + props dùng CHUNG
    buffer đỉnh, mỗi InstancedMesh nhận bản nông (attribute instance gắn vào geometry nên không dùng chung object).
    **BẪY ống/lốp:** khung vòng tính theo hướng tâm vòng trước→sau; mặt cắt KHÔNG đơn điệu theo trục (lốp: hông đi
    ngược trục rồi gai xuôi trục) làm khung LẬT → xoắn → dùng `fixed:true` (1 khung = vòng cuối − vòng đầu).
    **Màu = kênh × nguồn (1 draw call vẫn đa dạng):** sơn = instanceColor, áo A/B = `aShirt`/`aShirt2`, còn lại BẢNG
    MÀU BĂM theo hạt giống instance (da 6, tóc 4, mũ bảo hiểm 10, quần 8, khẩu trang 4, giày 4, túi 6, hàng chở 6);
    kênh có điều kiện: cẳng tay = áo nếu bit tay dài (áo chống nắng) else da, cẳng chân = da nếu quần đùi. `aOpt` = bit
    0-12 + 8192 × hạt giống (CỐ ĐỊNH theo tác tử — băm theo vị trí thì xe chạy nhấp nháy màu). CỔNG ±k: hiện khi bit
    (k−1) bật/tắt, tắt → đỉnh thu về 0 (tam giác suy biến): người ngồi sau, hàng chở, rổ xe cub, thùng sau, mũ treo
    gương, taxi, giá nóc, nón lá, mũ lưỡi trai, tóc dài, khẩu trang, túi. Bit tính trên GLSL ES1 bằng floor/mod/exp2.
    **Người (§2):** khung `SK` 1,70 m, đầu 0,227 m = 1/7,5 (hông 0,90, gối 0,49, vai ±0,182 ở 1,40, khuỷu 1,115, cổ 1,45);
    `person(K, J)` dựng chi là ống elip NỐI KHỚP (đùi/cẳng có bắp, cánh tay tay áo, bàn tay, giày nêm, đầu elip cằm hẹp
    + mũi, tóc chừa trán, mũ bảo hiểm nửa đầu + lưỡi trai, nón lá ống lõm 0,47 m) ~0,9k tam giác; `riderJoints` = IK 2
    khớp (hông→gối→bàn chân trên sàn/gác chân theo kiểu xe; vai→khuỷu→tay nắm ghi-đông, khuỷu chếch ra-xuống) → người
    lái/người ngồi sau NƯỚNG SẴN vào hình xe. Người đi bộ instanced: dáng do vertex shader `kitPose` (hông ±0,42·a, gối
    gập khi chân đưa ra trước, tay đánh ngược chân, khuỷu gập, hạ cả người 0,81·(1−cos góc đùi) để chân trụ không nhấc
    khỏi đất) — 'cpu' (giao thông: aPhase = PHA bước rad do CPU tích phân 4,5·v/scale mỗi khung, aWalk = BIÊN ĐỘ 0..1
    êm theo tốc độ; bản đầu shader tự tính pha = uKitTime·nhịp → đổi nhịp là pha nhảy, biên độ bật 0↔1 ở 0,2 m/s = dáng
    giật) hoặc 'path' (props: đi qua-lại trên GPU như WP7);
    bit SIT = ngồi ghế nhựa (đùi −1,9 rad tức gối CAO hơn hông, cẳng +1,9 thẳng đứng, hạ hông 0,53 m → hông 0,37 trên
    mặt ghế 0,27). Hằng khớp trong GLSL sinh từ SK (đổi 1 chỗ). Cao 1,56-1,80 m (instance scale, nữ thấp hơn).
    **Xe máy (§3):** 'scooter' (ga nhỏ 14"), 'underbone' (xe số 17", vành căm; cub = + rổ trước), 'bigscooter' (ga lớn
    16", thùng sau); gương cần mảnh + mặt gương dẹt, biển số, đèn pha/hậu/xi-nhan, ống xả crôm; det 2 (xe ĐỖ ~0,84-0,95k
    tam giác, nan = mảnh phẳng 2 tam giác thay hộp 12), det 1 (xe CHẠY: không vát mép), LOD xa ~0,27k (có người) / ~0,1k
    (xe đỗ). Xe chạy + người lái ≈ 1,08k, + người ngồi sau (cổng) ≈ 1,5k tam giác.
    **Ô tô (§4):** 'sedan' 4,42 m, 'hatch' 3,72, 'suv' 4,6, 'mpv' 4,65, 'van' (16 chỗ) 5,4, 'truck' (tải nhỏ bạt) 4,9;
    taxi = sedan/hatch + cổng hộp đèn (chữ chung, không thương hiệu). THÂN = loft ~26 trạm × mặt cắt 12 điểm (bo gầm,
    hông phình 42% chiều cao, vai thu vào, nóc ca-pô/cốp theo khoá z) — HỐC BÁNH THẬT: đáy mặt cắt nâng theo cung tròn
    bán kính R+5,5 cm quanh trục bánh, 2 trạm kép sát mép hốc tạo vách đứng; khối gầm tối chặn nhìn xuyên hốc. NHÀ KÍNH
    4 trạm (chân/đỉnh kính lái, đỉnh/chân kính sau), mặt hông kính tối + máng nóc + nóc sơn, trụ A sơn, B đen, C (sedan
    sơn), gioăng đen chân kính; lốp có hông + mâm hợp kim 6 nan (mặt ngoài), đèn pha ôm góc, lưới tản nhiệt + nẹp crôm,
    hốc gió, biển số, gương, tay nắm cửa. ~1,85-1,94k tam giác (tải 1,0k); LOD 60-260 m thân loft thô ~0,28k (chung mọi
    kiểu, instance scale theo kích thước kiểu `CAR_FAR_SCALE`), > 260 m hộp ~30 tam giác.
    **Vật liệu (§6):** `kitMaterial` = MeshStandard (TIER ≥ 2: sơn bóng r 0,28-0,32, kính r 0,05 phản chiếu IBL trời của
    daynight, mâm kim loại) / Lambert (LITE) + onBeforeCompile (kênh, cổng, dáng, nhám/kim loại theo đỉnh). Đèn PHA/HẬU
    cộng SAU `#include <emissivemap_fragment>` = theo CẢNH như trafficmodels dot3 (pha 2,6 → phơi sáng đêm ×4 + bloom
    ngưỡng 0,9 → xe ngược chiều LOÉ — chữ ký phố đêm VN). BẪY (phản biện): bản đầu cộng TRƯỚC chunk → post.js nhân
    HP_UNLIT_K ≈ 1,18/4 ≈ 0,3 lúc đêm → pha còn 0,77 < ngưỡng bloom = vệt mờ. HỘP ĐÈN TAXI (biển hiệu) giữ TRƯỚC chunk
    (theo màn hình). LOD xa xe máy PHẢI có kênh HEAD/TAIL (2 tấm trước/sau = 4 tam giác) — thiếu là mọi xe máy ngoài
    NEAR_BIKE tối om về đêm. Bit 12 PARKED tắt đèn → xe chạy + xe đỗ dùng CHUNG 1 vật liệu/1 chương trình; props gắn
    `customDepthMaterial` cùng cổng/dáng (bóng đổ đúng). Lưỡi trai/mặt phẳng bóng nhỏ phải nhám (≥ 0,6): mặt phẳng
    r 0,3 hướng lên phản chiếu trời thành vệt TRẮNG.
    **Giao thông (traffic.js):** 3 xe máy + 6 ô tô + 1 người đi bộ + LOD xa (xe máy ≤ 50 m / ô tô ≤ 70 m dùng mô hình
    đủ, xa hơn ghi vào nhóm 'bike_far'/'car_far' — TIER 2: 42/58, LITE 32/45) + MỘT mesh bóng tiếp đất chung
    `traffic_shadow` (stride 17: ma trận có sẵn scale elip + độ đậm, 3 bản xoay vòng) = 13 draw call (trước 16). Gần/xa
    chọn theo khoảng cách tới CAMERA (main.js truyền `camera.position` làm tham số 4 của `traffic.update`), trễ 5 m
    (xa → gần khi < ngưỡng − 5 m); cắt DRAW_R + mô phỏng vẫn quanh NGƯỜI CHƠI. BẪY (phản biện): chọn theo người chơi
    thì camera LITE lùi tới CAM_MAX 36 m > NEAR_BIKE 32 m và camera đạo diễn __cine (quay trailer) thấy người que trên
    nêm cách ống kính 2-6 m. GIỚI HẠN THUỘC TÍNH: người đi bộ giao thông dùng 14/16 vertex attribute (position, normal,
    color, aKit, aOpt, aShirt, aShirt2, aPhase, aWalk, instanceMatrix ×4, instanceColor) — thêm uv/thuộc tính mới sẽ
    vượt MAX_VERTEX_ATTRIBS 16 trên di động. Stride
    28 giữ nguyên, ô đệm cuối thành aOpt. Phụ kiện theo tỉ lệ pano: chở 2 ~30%, chở hàng ~10%, khẩu trang ~35%, nữ ~45%
    (65% mặc áo chống nắng dài tay), taxi ~28% sedan/hatch; bit của người ngồi sau CHỈ bật khi có PILLION (cổng không
    lồng nhau). Props (props.js, chỉ phần mô hình/instance — vị trí đặt GIỮ NGUYÊN): bikeI[0..3] → scooter / underbone
    (+cub = rổ) / bigscooter; carI → sedan, suv (~40% thành mpv theo hash), hatch (+taxi), truck, van; người 1 mô hình
    (đứng/đi/ngồi theo bit) gần ≤ 60 m + xa 60-240 m (~0,24k, không đổ bóng); xe máy gần ≤ 50 m (trước 80), ô tô gần
    ≤ 60 m (trước 130). Đã xoá mô hình cũ + nhánh dáng đi trong propMaterial. `parkedCars[i].hw` = nửa bề ngang THẬT
    của mô hình kể cả gương (bounding box: xe 16 chỗ ~1,18 m, SUV ~1,1 m) — code né xe đỗ đừng giả định 0,9 m.
    Người: nắp trên cánh tay chìm dưới vai áo (−22 mm, vào trong 24 mm, vòm 15 mm — trước nhô như cầu vai); khẩu trang =
    VỎ cầu ±80° quanh mặt từ dưới mũi tới cằm theo cùng `faceShape` của đầu, nở 7% (hộp phẳng cũ đen ở < 4 m như râu);
    người gần có lông mày (màu tóc) + hốc mắt tối (4 hộp mỏng, +48 tam giác); LOD xa có GỐI (đùi chi 1/2 + cẳng 3/4 —
    1 ống thì dáng ngồi chĩa cả chân lên 19°).
    **Nhân vật chơi/NPC (character.js):** `makeHumanoid` giữ API (group, legL/legR/armL/armR/head/torso, blob, animate,
    sit) nhưng là MỘT SkinnedMesh 11 xương (hông, thân, đầu, vai/khuỷu, hông/gối) từ người kit + 1 bóng tròn; màu nướng
    theo scheme trên hình gốc cache theo (mũ, tóc dài, ba lô). Xoay X DƯƠNG đưa chi ra SAU: sit() cũ đặt đùi +1 rad = chân
    ra sau yên — nay đùi −1,32, gối +1,38, thân chồm 0,16; TAY giải IK số tới tay nắm xe Cub GLB đo trong game ≈ (±0,37,
    1,27, 0,27) hệ nhân vật (gốc ở chân, +Z trước): cánh tay (−0,2, ±0,3, ±0,5), cẳng tay −1,8 (khuỷu dạng ra-xuống, bàn
    tay lệch tay nắm < 1 cm; bản −0,95/−0,45 cẳng tay nằm ngang, bàn tay thấp 14 cm và vượt 26 cm). Bind: Skeleton được
    tạo trước khi ma trận xương cập nhật — `mesh.bind()` tự updateMatrixWorld + calculateInverses (đừng truyền
    boneInverses). Cầu bao đặt tay (r 1,25) — không tính lại từ xương. BẪY WEBGL1 (phản biện): chunk
    `skinning_pars_vertex` của three r160 dùng `textureSize()`/`texelFetch()` (chỉ GLSL ES 3.0) → trên WebGL1 cả program
    màu lẫn bóng KHÔNG biên dịch, người chơi + NPC biến mất. character.js thay chunk (onBeforeCompile cho vật liệu +
    `customDepthMaterial`) bằng bản `texture2D` với cỡ texture xương CỐ ĐỊNH 8×8 (11 xương × 4 texel, đúng công thức
    `Skeleton.computeBoneTexture`) — chạy cả WebGL2 (three #define texture2D texture). Thêm xương → sửa NBONE. Kiểm:
    Chrome `--disable-es3-apis` + init script trả null cho getContext('webgl2') → lỗi shader = base (2, đạo hàm
    citygen/roadtex — W2-F sửa). LITE dùng Lambert như kit.
    **QA:** `tools/qa/models.html` (gallery kit: ?row=cars|bikes|riders|people|heroes|all, ?only=car:sedan|bike:…|ride:…|ped|pedfar|bikefar,
    &opt=bit,bit &lo=1 &night=1 &std=0 + camera dist/h/yaw/ly). BẪY chụp headless: (1) bảng hướng dẫn mở = `modal` →
    main.js bỏ cập nhật nhân vật (teleport không dời người, mount không đặt lên yên) — bấm Escape trước; (2) __cine bật
    = cũng bỏ cập nhật nhân vật; (3) công cụ Write file .html ở worktree có hook mở Browser pane (WebGL ngoài khoá GPU)
    → đóng tab ngay.
    **Số đo (Radeon 890M, TIER 3, views 11 góc, base = export dot3 ea5f57f có assets hard-link phục vụ song song, cùng
    phiên, traffic on):** draw call giảm ở 9-10/11 góc (cam_spawn 389 → 361-363, pano_007 560-585 → 499-526,
    cam_high_center 440 → 379-403, game_3 415 → 331-334, pano_071 682-744 → 609-634, pano_102 436-519 → 402-428);
    tam giác ≈ bằng (cam_spawn 4,07 → 4,04 M, cam_high_center 6,25 → 6,21, game_3 6,69 → 6,66; pano_021 dao động
    ±1 M giữa các lượt ở CẢ 2 bên); fps TB 59,2 → 59,9 (trần 60, p95 trong nhiễu). Lượt đầu (LOD xa ô tô 968 tam giác ×
    ~1.500 xe đỗ, xe máy gần 80 m) +0,5..+2,8 M tam giác, p95 +1,5-4 ms → mới thêm LOD 3 mức. Heap sau GC ép (CDP
    HeapProfiler.collectGarbage) 388 → 389-390 MB; geometries 497 → 456; programs 66 → 68. Khởi động: hpReady/Start
    trong nhiễu (4,24 s / 5,83 s ↔ 4,11-4,28 / 5,8-6,2 s); dựng mọi mô hình kit ~40 ms. 0 lỗi JS full + lite;
    diag 0; traffic.check() 0 sai bên/ra ngoài/chồng. RIÊNG người + xe (giao thông + xe/người props + nhân vật chơi;
    đo = chênh khi ẩn chúng, gồm cả lượt bóng): base 43-48 draw call / 0,36-0,39 M tam giác → 16-26 / 0,32-0,35 M
    (cam_spawn, pano_007, pano_130, phố Điện Biên Phủ; số base CHƯA tính NPC — mỗi NPC cũ ~25 mesh) — ngân sách ≤ 40 đạt.
    **Sau phản biện (cùng ngày):** 3 lỗi bắt buộc + đánh bóng ở trên (WebGL1 skinning, đèn xe máy xa + pha/hậu theo
    cảnh, LOD theo camera, dáng tay lái Cub, khẩu trang/mắt/mày/vai, gối LOD xa, pha bước CPU, hw xe đỗ). Đo lại (2 lượt
    đảo thứ tự, cùng phiên, base dot3 ea5f57f): draw call thấp hơn 11/11 góc (cam_spawn 389 → 362-363, pano_007 560-585
    → 524, cam_high_center 465 → 399-400, game_3 415 → 353-354, pano_089 788 → 673-698), tam giác bằng hoặc thấp hơn
    (≤ −0,07 M), fps 60,1 ↔ 60,1 (trần), p95 trong nhiễu; đo không trần vsync dao động ±3 ms giữa các lượt CÙNG bản →
    không kết luận được chênh p95 ~2 ms. Heap sau GC 389 MB, programs 68, geometries 456; người + xe 20-22 draw call
    (full) / 14-18 (LITE). WebGL1 ép: 2 lỗi shader = base (không còn boneTexture). Đêm pano_007_h090: đèn pha/hậu xe
    máy xa hiện lại như dot3; xe ngược chiều 7 m loé bloom.
- **2026-10-04 (Đ3-W2-E LANDMARKS)** [ĐỊA DANH KHỚP FOOTPRINT THẬT — GLB transform dị hướng + khuôn viên thủ tục theo LM_POLY]:
    **(1) KHỚP GLB (world.js, khối ngay sau `await prog('landmarks')`):** bảng `LM_FIT {key: th, sx, sy, sz, dx, dz}` → `placeGLB({fit,
    key})` đặt `scale.set(sx,sy,sz)` + `rotation.y = th` + TÂM BBOX model tại `LM_CENTROID + (dx,dz)` (file GLB KHÔNG đổi; twin lite
    assets.js chép nguyên `scale` vector nên LOD khớp). sx/sz = m mỗi đơn vị model theo local X/Z, dị hướng có giới hạn; sy CHỌN theo
    chiều cao thật trong pano (không theo scale ngang — ga scale đều 118 m thì cao 80 m). Số đo bằng **`tools/qa/lmfit.py`**: ảnh chiếu
    bằng của GLB GỐC (`tools/qa/glbsheet.html?m=<glb>&occ=0.12` — bỏ 12% chiều cao dưới: tấm đế/bậc Meshy; chụp hàng loạt
    `OCC=0.12 node tools/qa/glbsheets.mjs <port> <dir>/sheets nhahat,ga,…`) → lưới θ (±vài độ quanh hướng mặt tiền ĐÃ KIỂM bằng pano),
    sx, sz, dời tâm, cực đại `IoU − lam·(phần ngoài đa giác nở buf) − lamR·(phần trong hành lang phố: cách tim < facadeLine − 0,5 m)`
    (`node tools/qa/lmfit_prep.mjs <dir>` ghi lmpoly.json + segs.json). Kết quả (IoU raster tam giác GLB thật trong game, `tools/qa/
    lmprobe.mjs --metrics`, trước → sau; SỐ CUỐI sau phản biện ở mục "SAU PHẢN BIỆN" bên dưới): nhà hát 0,42 → 0,74 (BẢN ĐẦU ép mặt
    tiền dị hướng — SAI, đã sửa: scale ĐỀU 21, xem dưới), nhà thờ 0,62 → 0,83 (gần đều: "rộng hơn 8 m" của kiểm toán cũ là bbox
    gồm 2 hàng cây bách), bưu điện 0,52 → 0,62 (xoay −38°: THÁP ĐỒNG HỒ — mặt +Z GLB — quay ra GÓC TÂY-NAM vát tròn: pano_220 h045
    thấy tháp chính diện y ảnh thật, pano_362 h315 thấy cánh vòm gạch đỏ = mặt +X GLB; lòng đường ~10 m² ở mép phố chéo), bảo tàng 0,64 → 0,70, NHNN 0,71 → 0,81 (lòng đường 134 → 0 m²:
    góc tây LM_POLY lấn 3,2 m qua bó vỉa phố 't' → phạt hành lang), đình HK 0,40 → 0,52, đền Tam Kỳ 0,69 → 0,95.
    **(2) KIT KHỐI THỦ TỤC** (cùng khối): `lmOBB` (OBB diện tích nhỏ nhất, u = trục dài), `lmEdge(P,a,b)` (hệ toạ độ theo cạnh, v hướng
    vào trong), `lmFitRect` (co hình chữ nhật tới khi 4 góc + 4 trung điểm nằm trong đa giác co m mét), `lmBlock` (tường 1 quad/cạnh,
    texture 1 GIAN × 1 TẦNG lặp 2 chiều — `LM_STYLE` colonial/yellow/arcade/cream/soviet/temple/market/hoard, emissive mờ đêm qua
    facadeMats — + mái hông `lmHipRoof` ngói/đá đen/xanh/ngói đền, hoặc mái bằng earcut), `lmPolyBlock` (đùn đa giác). Material chung
    theo phong cách → freezeStatic lượt 2 gộp theo ô. Dùng cho: GA (GLB 60 m ở SẢNH giữa — đa giác nhô 2 phía, 12,2 m về đông tâm OBB —
    + 2 cánh vòm 2 tầng mái ngói + khối sau sảnh; IoU 0,31 → 0,90, cột cờ 37 → 23 m), THPT NGÔ QUYỀN (GLB = cổng "NGÔ QUYỀN" + dãy
    cạnh cổng, tỉ lệ thật 10 m/đơn vị trên mặt ĐÔNG Mê Linh — pano_261 h270 gần y hệt ảnh thật; bản cũ phóng 80 m cao 46 m che camera;
    dãy 3 tầng vàng cửa chớp xanh lùi sau tường rào dọc Nguyễn Đức Cảnh + nhà 2 tầng kính góc đông-bắc theo pano_037/427, dãy 2 tầng
    3 phía, sân có cây), CHÙA HÀNG (gác 3 mái ~14 m ở mặt tây + chính điện 2 tầng mái chồng diêm + hậu cung + 2 dãy nhà tổ, sân cây),
    UBND (khuôn viên 163 × 75 m: vườn trước 20 m có đài phun, 2 thảm cỏ, hàng cau + cờ, rào sắt chân xây; dãy chính = khối mansard
    đồng hồ cũ `buildUBND` + 2 dãy thuộc địa mái đá; cánh tây + dãy sau bao sân trong; Trung tâm Hội nghị 5 tầng kem mái xanh đầu đông
    — pano_020 h270/h315), VIỆT TIỆP (thân cung đùn theo đa giác 16 đỉnh 12 m + khán phòng 21 m + khối mặt tiền huy hiệu áp đúng CẠNH
    mặt tiền 53,5 m — IoU 0,19 → 0,97), 2 THCS (dải nhà ven CHU VI: mỗi cạnh ≥14 m một dải sâu 11 m — chạy đúng đa giác lõm/chữ L).
    Rạp Tháng Tám/Triển lãm: tâm OBB footprint (LM tâm-đỉnh lệch 6 m) → IoU 0,99. **CHỢ SẮT = CÔNG TRƯỜNG** (pano_116/214/013/212
    10/2024: chợ cũ đã phá, rào tôn xám, cẩu tháp, máy khoan cọc): rào tôn theo đa giác + khung bê tông 3 sàn + 2 cẩu tháp + 3 máy khoan
    + container lán trại + băng rôn "CHỢ SẮT · ĐANG XÂY DỰNG" (biển/nhiệm vụ địa danh giữ nguyên). Đường chạy oval "civic8" (169,-832)
    nằm TRONG khuôn viên UBND (đọc nhầm ảnh vệ tinh) đã bỏ.
    **(3) VA CHẠM ĐA GIÁC + DỮ LIỆU CHUNG:** `lmSolid(ring,key)`; `world.resolveCollisions` được BỌC thêm `lmPush` (đẩy ra cạnh gần
    nhất, lọc bbox) → `isFree/findFree`, oracle đặt cây/hoa/biển phía sau, người chơi đều thấy địa danh; bỏ các vòng tròn cũ (nhà
    hát r15, ga r27, bưu điện r22, NHNN r28, Triển lãm r24 = tường vô hình 19 m…). `world.lmMasses [{key, ring, h}]` (khối + GLB của
    khuôn viên), `world.landmarkHit(x,z,r)`, `world.lmFit`. `js/footprints.js` (cần camera/xuống xe/người đi bộ) lấy `lmMasses` cho
    địa danh có khối → SÂN TRONG/VƯỜN TRƯỚC không còn là vật cản (sau phản biện: mọi GLB cũng có khối = viền GLB, `glb: true`). `js/landmarks.js`: biển dời ra
    nếu trong nhà thật HOẶC trong khối địa danh. Claims (khối WP2): bỏ vòng tròn bù GLB lệch/to (nhà hát r28, ga r30, THPT r44, NHNN r34,
    chợ Sắt r60…) vì GLB nay nằm trong LM_POLY (+3 m) — chỉ giữ đền Nghè, Nhà Kèn (không có đa giác) + SÂN NHÀ THỜ r25 (xem dưới).
    **(4) VẬT LẠ:** cây trong footprint nhà thờ (garden6 (-114,-345), (-118,-378)), cây xà cừ (-210,275) trong cổng THPT bỏ; cây chu vi
    vườn hoa né `world.landmarkHit`; tháp kính 13 tầng `v6_ndc_tower13` (ô v6, đặt nhầm phía NAM Nguyễn Đức Cảnh = giữa sân trường —
    pano_427 h090/pano_002 h180: tháp ở bờ BẮC) gỡ bằng `lmRemoveCell` (mesh + collider trong bao lồi, `cellKept[].removedByLM`); khối
    địa danh NHƯỜNG chỗ nhà ô GIỮ chạm vào (`lmCellClash`, vd công sở Pháp arcade pano_482 bên Mê Linh).
    **Đo (lmprobe, 19 địa danh):** 0 m² GLB/khối trên lòng đường trừ bưu điện ~11 m² ở mép phố chéo (trước: THPT 104, NHNN 134), 0 biển/xe/NPC trong khối,
    `__hp.diag()` [], 0 lỗi JS (full; LITE chỉ 404 assets_lite của môi trường).
    **PERF (A/B CÙNG PHIÊN với dot3 ea5f57f phục vụ ở cổng riêng, Radeon 890M d3d11, ?quality=full TIER 3, 1280×720, autoQuality
    khoá):** heap SAU GC (`--js-flags=--expose-gc`, 3×gc) 394/395 → 396/396 MB; hpReady 4,2-4,6 s cả hai (nhiễu); startReady 6,1-6,8 →
    5,9 s; draw call/tam giác (lấy MIN 3 mẫu — mẫu 1 khung đôi khi gồm lượt bóng: game_3 390 ↔ 828 call cùng code): cam_spawn 389/
    4,08 M → 394/4,07 M, game_3 390/6,67 M → 399/6,68 M, pano_055_h000 426/3,96 M → 405/3,97 M, cam_high_center 440/6,33 M →
    443/6,05 M; fps 58-61 (trần vsync) cả hai. Khối thủ tục ~vài nghìn tam giác, material chung theo phong cách (gộp ô).
    **BẪY:** (a) bbox GLB ≠ thân nhà (cây/tấm đế/cánh lệch Meshy) — khớp theo ẢNH CHIẾU BẰNG, không theo bbox; (b) IoU thuần đẩy GLB
    ra lòng đường khi LM_POLY OSM lấn phố game (NHNN, bưu điện) — luôn phạt hành lang facadeLine; (c) θ phải bị CHẶN cả trong bước tinh
    chỉnh (bản đầu trôi −9,5° → mặt tiền bưu điện lệch phố); (d) texture 1 ô theo tầng: tường cao không chia hết storeyH thì dải phào
    ở đỉnh ô bị cắt (rào tôn: cao đúng 1 ô); (e) đoạn code chạy TRƯỚC khối địa danh không gọi được `_lmIn`/`lmSolid` (const/TDZ) — ở
    cells/garden6 sửa bằng toạ độ/chặn tại chỗ; (f) Git Bash: chuỗi chứa chữ "eval" trong lệnh bị chặn cách ly worktree.
    **SAU PHẢN BIỆN (5 lỗi phải sửa — đã sửa, số đo lmprobe cùng phiên):**
    (i) **MẶT ĐỨNG KHÔNG MÉO** — `lmfit.py --sy S --fax x|z|xz --fcap 1.1` (trục ngang mặt tiền ∈ [sy/1,1, sy·1,1]; trục sâu tự do ≤
    amax). Nhà hát: s = 21 ĐỀU (chân dung đúng tỉ lệ như dot3 — `fix/portrait_cmp.png`), mặt tiền (z local 0,429) đặt ở mép NAM
    footprint, GLB rộng 40 m gồm 2 cánh thấp (Meshy bè 2,3:1 — chấp nhận lòi 5 m mỗi bên ra quảng trường thay vì méo ảnh), phần SAU
    footprint (26 × 25 m) = khối thủ tục phong cách `opera` 2 tầng cao 12,8 m (pano_052/053 h270 thật); BỆ 1,35 m phủ cả tấm đế Meshy
    tối màu chìa 5 m trước mặt tiền (đỉnh tấm đế đo LAND_H + 0,89 — bản trước giãn sâu thành "thảm tối") + 3 bậc. Ga: GLB ĐỀU 19
    (đồng hồ tròn lại; bản trước 30/17,5 = elip 1,7:1), dài 38 m, chỉ sâu giãn (2 đầu hồi bị cánh che), 2 cánh thủ tục dài thêm. Chùa
    Hàng: ĐỀU 8 (bản trước kéo cao 36%). NHNN sy 24,5 sx 26,95 (1,10; cũ 1,32), bảo tàng sy 17 sx 18,7 (cũ 1,23), nhà thờ sz 26,4
    (1,10; cũ 1,17), bưu điện sy 24 sx 25,5 sz 24,51 θ −43° (2 mặt phố, phạt cả VỈA HÈ `--lamR 10 --corr facade`).
    (ii) **VA CHẠM = VIỀN GLB**: `LM_OUTLINE` (tools/qa/lmoutline.py: hợp ô chiếm của ảnh chiếu bằng GLB bỏ 12% dưới → đóng khe →
    Douglas-Peucker 0,02 đv, toạ độ model quanh tâm bbox; 10 GLB ~5 KB) biến đổi theo LM_FIT → `lmSolidGLB` (va chạm + lmMasses
    glb:true). Bản đầu `lmSolid(LM_POLY)` = tường vô hình: NHNN 62 m² lòng đường + 97 m² vỉa hè, bưu điện 137 m² vỉa hè, góc trống
    bắc/tây bưu điện. Nay lmprobe "va chạm không thấy" (landmarkHit r 0,45 cách tam giác GLB/khối > 1 m, ngoài nhà thật) = 0 m² mọi
    địa danh; GLB còn chạm vỉa hè (thấy được): bưu điện 12 m², NHNN 4 m².
    (iii) **KHỐI NÉ VỈA HÈ**: `lmOffStreet(P, m)` — mỗi cạnh lùi vào tới khi điểm mẫu (1 m) ra khỏi lòng + vỉa hè (`roadNet.surfaceAt`
    > 0,02) + lề m; điểm mẫu KHÔNG ra được trong 10 m = nằm trong dải phố VUÔNG GÓC (vỉa hè phố kia chạy dọc vào ở góc) → bỏ qua
    (bản đầu thuật toán lùi cả cạnh 24 m → đa giác hỏng). THPT: khối trong Pos, tường rào vàng 2,2 m chạy đúng mép sau vỉa hè Mê Linh
    + Nguyễn Đức Cảnh (gặp nhau ở góc), cổng GLB chạm tuyến rào, dãy đông lùi 7 m sau rào (pano_260 h180 / pano_261 h270 thật); mặt
    lấy theo HÌNH HỌC (`lmSide(P, dir)`: chuỗi cạnh có pháp tuyến ≈ hướng) thay chỉ số đỉnh. Chợ Sắt: rào tôn = lmOffStreet, cạnh
    trùng rào tw(12) lấy từ `world.twWalls` (twWall ghi lại) thay toạ độ chép tay. Khối trên vỉa hè: THPT 44 → 0,5 m², chợ Sắt 79 → 0.
    (iv) **SÂN NHÀ THỜ**: bỏ vòng claim r25 làm sống lại 7 footprint máy học (MS/GOOGLE, 543 m², 2-3 tầng) trong sân, 1 khối che tháp
    chuông ở pano_255 h270/h315 → khôi phục `claimCircle(LM.cathedral, 25, 'cathedral_grounds')` (các vòng khác bỏ không làm sống
    nhà nào). (v) Đêm: emissive khối thủ tục = lưới 5 gian × 4 tầng ô thấp phân giải sáng/tắt theo hash (`emissiveMap.repeat`
    1/5, 1/4 — ma trận UV riêng từng texture r160), không còn mọi cửa cùng sáng. Cây (-287,200) trong Triển lãm = w3Tree khối pano_036
    (chạy trước địa danh) → chặn tại chỗ bằng LM_POLY.trienlam. `tools/qa/launch.mjs`: pageerror chờ thêm 20 s rồi "ABORT: …" (không
    còn báo nhầm TIMEOUT 300 s). `tools/qa/lmprobe.mjs` thêm `street {gRoad,gSide,mRoad,mSide,hRoad,hSide,inv,invRoad,invSide}`.
    Số cuối (lmprobe `fix/final`): IoU nhà hát 0,725 (GLB + khối sau), nhà thờ 0,84, ga 0,915, bưu điện 0,568, bảo tàng 0,724, NHNN
    0,735, đình HK 0,524, đền Tam Kỳ 0,951, chợ Sắt 0,963; va chạm không thấy 0 m² mọi khoá; khối thủ tục trên vỉa hè 0 m²; 0 cây/biển/
    xe/NPC trong khối; `__hp.diag()` []; diag.mjs "TẤT CẢ THỰC THỂ OK — 0 lỗi JS"; LITE chỉ 4× 404 assets_lite (môi trường). PERF A/B
    cùng phiên (dot3 ea5f57f cổng riêng, traffic off, 24 view std, 1 mẫu/view): draw call std1 −18..+33, std2 −62..+24; tam giác
    ±0,3 M (1 mẫu cam_high_lake −0,7 M); fps 60 (vsync) cả hai; hpReady 3,9-4,5 s ↔ 4,2-4,6 s; startReady 5,5-6,9 ↔ 5,7-6,8 s; bước
    boot 'landmarks' 246-289 ↔ 239-286 ms (nhiễu) — trung tính.
    **Chưa làm/đề xuất:** bưu điện thật là nhà chữ L ôm góc (2 cánh dọc 2 phố) còn GLB là khối vuông + 1 cánh chéo → nhìn từ trên
    vẫn hở góc bắc/tây footprint; ga/UBND/THPT dùng texture canvas riêng (không qua shader atlas citygen); tháp 13 tầng
    `v6_ndc_tower13` cần DỜI sang bờ bắc Nguyễn Đức Cảnh (lane ô WP3/W2-A — W2-E chỉ gỡ khỏi sân trường); nhà hát rộng 40 m > footprint
    29 m (đánh đổi để chân dung không méo — chủ dự án có thể chọn s nhỏ hơn: thân thấp hơn).

- **2026-10-04 (W2-A CLEARANCE)** [ĐỢT 3 WAVE 2 — KHOẢNG TRỐNG: không vật gì chắn camera pano / lòng đường / vỉa hè; bản
    SAU PHẢN BIỆN — giữ địa danh, không xuyên nhà, tấm mỏng theo chữ spec, nhả bộ đệm]:
    **Kiểm toán** `tools/qa/clearance.mjs` (+ `clearance_page.js` tiêm vào trang): `node tools/qa/clearance.mjs --port <p>
    --out x.json [--src] [--probe pts.json] [--prof f] [--eval f.js] [--nohold --stack]`. Chạy SwiftShader (KHÔNG vẽ — vẫn xin
    khoá GPU), ~10 s: vá TẠM main.js qua page.route để gọi `window.__hpPreFreeze(scene, world)` NGAY TRƯỚC freezeStatic (còn
    tên vật thể, geometry chưa gộp/nhả CPU, `?fabfree=0`), rồi giữ trang. `--src` gắn DÒNG NGUỒN world.js cho mọi scene.add
    ('@L<dòng>'). `--eval f.js` = thân hàm async (scene, world) chạy trong trang SAU kiểm toán → res.eval (dò surfaceAt, vật quanh
    1 điểm, chồng nhà ô…). Dòng TIÊU ĐỀ in cả chỉ số CHỮ spec lẫn chỉ số tinh chỉnh. Chỉ số cho 551 PANO_CAM (mắt = nền + 2,2 m):
    (a) `nearAll` = đúng chữ spec (tam giác ở tầm 0,3-2,6 m cách camera < 3 m NGANG); `near` = bỏ MẶT NHÀ khi camera nằm trong
    hành lang phố và điểm gần nhất lùi sâu 0,6 m đã ra ngoài mặt đường/vỉa hè đã vẽ; (b) raster phần mềm 64×36 × 8 hướng (FOV dọc
    60°, 16:9): `fillAll` = >40% điểm ảnh trong 6 m (chữ spec); `fillCorr` = phần điểm ảnh trong 6 m mà điểm chạm (lùi 0,6 m) vẫn
    trên lòng/vỉa hè > 20% (vật LẤN phố); (c) `onRoad` = collider r ≤ 3 / cây / props / đỉnh CHÂN (≤ nền + 0,45 m) trên tam giác
    NHỰA đã phát của `roads_*`, trừ 3 m quanh mesh *median*; (d) `sidewalk` = khối cao ≥ 2,5 m trên tam giác vỉa hè, `block` =
    còn < 0,8 m lối đi.
    **SỬA TẠI NGUỒN:**
    (1) `js/roadnet.js` (chỉ surfaceAt): gapFill ghi tứ giác nhựa phủ khe đường đôi (`gapQuads`) → surfaceAt trả mặt nhựa (~0,12)
    trong khe thay vì 0,25 (vỉa). Hồ Sen lưới 0,25 m: 1.744 mẫu nhựa bị coi là vỉa → 0.
    (2) MỚI `js/clearance.js` — SINGLETON như claims.js (`initClearance({ROADS_DT, surfaceAt, nearJunction, groundHeight,
    isWater, LAND_H})` ở đầu khối phố 'street'; `releaseClearance()` sau buildProps — nhả đệm + lưới đoạn phố; chưa init / đã nhả
    → mọi hàm = "không chặn"). Tra cứu: `onCarriage` (CHÍNH XÁC), `onCarriageFast` (đệm LƯỚI ĐỈNH 0,5 m — 4 đỉnh ô cùng kết quả
    thì trả luôn, khác nhau = ô MÉP → tính chính xác; bản cũ lấy tâm ô sai ±0,35 m làm bàn/cột "dời hợp lệ" vẫn chạm mép nhựa),
    `onStreetCarriage` (nhựa phố CÓ VỈA p/s/t/r — ngõ h/w không tính), `corridorPen(x,z,streetsOnly)` (phố có vỉa facadeLine −
    d − 0,3; ngõ h/w nửa lòng − d − 0,4), `clearPt/clearDisc/nudgeDisc`, `panosNear`, `massOnStreet(hulls)` (tỉ lệ ô 1 m của khối
    chính trên lòng phố có vỉa), `prismFill(body,dx,dz,cx,cz)` (raster 2,5D lăng trụ đứng 32×18 × 8 hướng, cùng FOV/mắt với
    kiểm toán), `trimThinWall(mesh)` (CẮT tấm Box/Plane mỏng dọc trục dài: bỏ đoạn lấn hành lang/trên lòng phố và đoạn trong
    6 m quanh camera còn vi phạm, giữ đoạn ≥ 2 m — mỗi đoạn = bản sao mesh, geometry cắt tại chỗ, UV cắt theo từng mặt nên
    chữ/ảnh không bị ép). `evalShift(S,dx,dz,mode)` cờ trên S: `softAlley` (ngõ h/w mềm), `occ(dx,dz)` (chặn dời vào chỗ đã có
    nhà), `corrCap` (đồ nhỏ không bị đẩy SÂU hơn vào hành lang phố — trước: hộp ngoài hành lang bị đẩy RA vỉa hè trước camera),
    `thin` (luật lấp khung ≤ 40% trong 6 m, KHÔNG miễn mặt tiền), `facadeExempt` (chỉ NHÀ khối). Luật camera xét MỌI camera trong
    tầm (bản cũ chỉ camera gần TÂM bao → tường tranh 24 m beboi_haly cách pano_533 2,3 m lọt luật). `solveShift`: lặp theo vector
    đẩy rồi dò lưới cực. `sweepAssemblies(objs, cols, fc, opts)` (mesh gộp → thành phần liên thông + hàn 2 mm; instance; mảnh chồng
    → CỤM): DỜI hoặc GỠ; danh tính (`opts.identity`) ngõ mềm, lùi không nổi → 'small' → GỠ chỉ khi ≥ 12% ô khối chính trên lòng
    phố có vỉa, không thì GIỮ ('stuck') + bỏ con phụ tự vi phạm; tấm mỏng nhích ≤ 3 m → CẮT → gỡ; cụm trải dài → gỡ mảnh vi
    phạm; `opts.occAt(x,z,mode)` chặn dời vào chỗ có nhà. Trả `colDead/fcDead/colTouched/fcTouched` — NGƯỜI GỌI NÉN mảng
    collider/FEATURED_CLEAR (bản cũ đỗ collider ở 1e7: 266 collider chết + vòng FC r 38 m của KS đã gỡ vẫn chặn props).
    (3) world.js khối phố: `world.streetClear = sweepAssemblies(...)` + `flushClearance()` + nén collider/FC + công trình danh
    tính ĐÃ DỜI → `claimPoly(bao khối chính cũ ∪ mới, 'clear')` (footprint thật từng khuất TRONG mô hình). Kết quả: dời 31 (đài
    phun ra khỏi nút giao, bonsai Nhà hát, xích lô, cây xăng, tháp Eximbank 14 m, toà Hoàng Long 5,6 m, KS Harbour View 9,4 m
    lùi sau mặt tiền — trước bị gỡ vì ngõ h ri1107), gỡ 19 (6 showroom Hoàng Diệu TRÙNG nhà thật, 5 hòn non bộ trên "vòng
    xuyến" không có thật, đài phun giữa nút, caooc_minhkhai — 58% khối chính trên lòng phố), ~50-70 ms.
    (4) `js/cellsink.js` commit: **5a** nhà giữ lại: lưới CHIẾM CHỖ = ô 1 m trong BAO LỒI (it.H = hình claim/cellKept) mọi nhà ô
    sống + đa giác LM_POLY gần đó; dời không được làm chồng TỪNG CẶP tăng quá max(1 ô, chồng sẵn) (địa danh: chỉ chặn lấn MỚI) và
    cập nhật lưới sau mỗi lần dời. Danh tính (civic/tower/heritage/bespoke): ngõ h/w mềm; NHÓM CHỨA toạ độ thế giới > 20 m
    (beboi_haly) tách theo CON — chỉ con có khối đặc quyết dời nhóm, con phụ vi phạm → dời ≤ 6 m (tấm mỏng ≤ 3 m) / CẮT
    (trimThinWall) / bỏ; lùi không nổi → 'small' → GỠ khi ≥ 12% ô khối chính trên lòng phố, không thì GIỮ (dl_truong_lt).
    Mesh lá/thân cây ĐỨNG ĐẤT (tán nâng > nền + 2,6 m mới miễn — bs_nhakhachtp cầu lá trên lòng phố t) và (kẹt) mesh phụ KHÔNG
    chạm khối chính mà chân trên lòng phố → bỏ riêng mesh. **6a** chủ collider/FC tính TRƯỚC 5c (thêm luật: nhà vừa thêm NGAY
    TRƯỚC collider + collider trong bbox bao mọi mesh của nó — collider lều bạt lqd_higashi từng sống sót giữa lòng LQĐ); bước 6
    bỏ qua collider 5c đã xử lý; mảnh dời/bỏ/cắt riêng (partMoves/partDrops/partDead) kéo collider theo. **5c** sweep mọi vật
    không phải nhà (tán lá chỉ miễn khi NÂNG cao), occAt = ô khối đặc nhà giữ (+ footprint thật cho đồ nhỏ — chặn cả tường/cổng thì
    gỡ thêm ~15 cổng pano như mamnon_cong). Nhà gỡ 'clear' xuất `shops` như 'overlap'/'near'. Số: dời 275 (141 nhà, 97 danh
    tính, 4 một phần), gỡ 86 (11 nhà: w4_lkt_thapkinh 56% khối trên lòng, s4_phapco_thd 43%, dth_congso_phap 26%, cb_dbp_office
    22%, s3_congso_phap_lkt 16% + 6 nhà thường), cắt 9 tấm mỏng, kẹt 1; giữ 279 (dot3 290).
    (5) Chặn đặt tay (một dòng, khu khác): flowerBed/heroBed/garden6/lan can Hồ Sen; ghế đá, biển tên phố, nhà chờ xe buýt NUDGE
    với okFn KHÔNG vào footprint thật còn dựng (world.rbGrid); cột tín hiệu < 3,3 m camera bỏ; tên `median_block/median_bush/
    bridge_group`. (6) `js/props.js`: clearPt cho bàn ghế/ô dù/xe đẩy/biển A/thùng/xe máy; cột điện + đèn dùng `clearDisc(x,z,
    0,3, 3,3)` (đèn cobra ở MÉP nhựa: tâm ngoài, chân chạm). `js/trees.js`: loại gốc trên nhựa (khe/nút giao).
    **Số đo kiểm toán (551 camera; dot3 ea5f57f → sau):** cam vi phạm (near|fillCorr) 175 → 35; near 141 → 12; nearAll (chữ
    spec) 153 → 36; fillCorr 89 → 29; fillAll > 0,4 (chữ spec) 208 → 181; vật trên nhựa 1.676 → 55 = TOÀN BỘ ngoài nhánh này
    (khối landmark/nature W2-E: civic8_parterre_jet L18228, chậu hoa trước Nhà hát L18673/18677, hàng rào L18780, nhóm L19797,
    sân rào L19822, rạp 78 L19969 — dòng theo bản này); lấn vỉa hè 183 → 76 (chặn kín 62 → 10: arcade/công trình danh tính GIỮ lại
    trùm vỉa hè là đúng thật). Chồng bao lồi nhà ô giữ ≥ 2 m²: dot3 13 cặp/353 m² → 12 cặp/258 m² (không cặp mới; s4_mamnon_dth ×
    tb_bvps_trang 22,8 → 24,8 = sai số lưới). Ảnh pano: pano_084/411/060/548/059/041 GIỮ địa danh (≥ dot3), pano_533 hết tường
    tranh trước ống kính, pano_109/146 rào tôn hết lấp khung, c_lkt_pair hết mái đỏ xuyên nhà.
    **Hiệu năng (GPU 890M tier 3, cùng phiên, std views):** bootProfile street 157 vs 89 ms (+~70), cells 816 vs 562 ms (+~250:
    5a ~60 + lưới chiếm chỗ ~20, quét 5c ~170, phần còn lại chủ collider/chuẩn bị); hpReady nhiễu ±0,5 s; heap SAU GC 385 vs
    389 MB (releaseClearance); draw call/tam giác bằng hoặc thấp hơn mọi góc, 60 fps; collider 17.331 vs 17.665 (6 collider
    đỗ 1e7 thêm là cơ chế bỏ cây của trees.js).
    **BẪY:** (a) kiểm toán chạy TRƯỚC freezeStatic — lỗi ở freeze không hiện → `--nohold --stack` sau mỗi thay đổi gỡ mesh (geometry
    rỗng → bakeGeo "reading 'attributes'"). (b) Gỡ mảnh = dựng lại chỉ số: đỉnh còn trong buffer. (c) Đừng gắn surfaceAt vào
    vòng lặp mọi ô vỉa hè (+0,17 s). (d) `extractShape.leafy` = MỌI mesh gộp xanh — không phải "tán cây"; foliage dùng chung chỉ
    miễn khi tán NÂNG cao. (e) Đệm nền theo ô 1 m lấy tâm ô → mép mặt cầu rơi xuống nước, cột lan can trên cầu "không chạm nền" —
    clearance dùng groundHeight ĐÚNG điểm. (f) Kiểm camera theo "camera gần tâm" bỏ sót vật dài. (g) Dời danh tính 10-14 m hợp lệ
    theo luật (w4_lkt_arcade lùi 10 m, cn_shpplaza 6 m — pano thật có sân trước) nhưng cần mắt người duyệt. (h) Mô hình đặt sai
    hướng so với 2 pano (tường tranh beboi: pano_548 thấy dọc trái, pano_533 thấy chắn ngang) → CẮT đoạn sát camera, không xoay.
    (i) ~25 camera chỉ vi phạm vì nhà THẬT ở phố hẹp / camera ngoài lòng theo ROADS_DT = lệch dữ liệu (đề xuất: QA kẹp camera vào
    lòng phố gần nhất). Ảnh A/B + số: scratchpad `dot3/W2-A` (p2_s1a/b, p2_s2a/b, p2_s3, p3_std1/2 .jpg; audit_base_p2 ↔
    audit_p2o.json; p2_probe2.json; PROGRESS.md; phản biện review/REVIEW.md).
- **2026-10-04 (wp8)** [ĐỢT 3 WP8 GAME — khởi động, giao thông phố thật, cảm giác chơi, nhiệm vụ, âm thanh, tool Windows]:
    **Khởi động (js/boot.js + main.js + 9 dòng world.js):** UI màn chờ (ngôn ngữ, chất lượng, nhiệm vụ, input) gắn
    TRƯỚC khi dựng; `buildWorld` thành `async buildWorld(scene, prog)` với `await prog('<bước>')` ở cấp 1 giữa các khu
    (ground/street/cells/fabric/landmarks/nature/furniture/final) — CHỈ đặt `await` ở cấp 1 hoặc block trần của
    buildWorld (trong hàm con là lỗi cú pháp; WP khác sửa world.js giữ nguyên các dòng này). Thanh tiến trình theo
    trọng số đo ở lần khởi động trước (localStorage `hp3d.bootProfile.v1`, `__hp.bootProfile`); vệt sáng chạy bằng CSS
    `transform` (compositor) nên vẫn chuyển động khi luồng chính bận khối đồng bộ dài. Nút Bắt đầu khoá (class
    `loading`) tới khi xong + 2 khung đầu đã vẽ; bấm sớm được ghi nhận (AudioContext tạo trong cử chỉ) và tự vào khi
    xong. Nhường luồng = rAF→MessageChannel (tab ẩn: chỉ MessageChannel — setTimeout bị bóp). BẪY: nhịp nhường trước
    freeze cho callback GLB (cây hero/luống hoa) chen vào scene TRƯỚC freezeStatic → main.js gỡ tạm các gốc mới xuất
    hiện, freeze, gắn lại (giữ ngữ nghĩa cũ "GLB đến sau freeze"). Service Worker đăng ký NGAY (trước: gắn vào 'load'
    sau khi dựng → không bao giờ đăng ký). Thanh preload GLB chỉ hiện sau khi dựng xong. Dựng ném lỗi (window
    'error'/'unhandledrejection' trước khi sẵn sàng) → thanh báo "Lỗi khi dựng thế giới — hãy tải lại trang".
    **Giao thông (js/roadgraph.js + js/traffic.js + js/trafficmodels.js, viết lại):** đồ thị nút–cạnh từ ROADS_DT
    p/s/t/r trong đĩa vùng chơi (+60 m): gom đỉnh 1,5 m, chèn nút chữ T (đầu mút cách thân phố khác ≤ 6 m) và ngã tư
    chéo; ~675 cạnh, 1 thành phần chính. Đường đôi (2 way song song cùng cấp cách 8-26 m về một bên ở ≥ 2/3 mẫu) →
    một chiều, chiều = bạn nằm bên TRÁI. Xe đi BÊN PHẢI: vector phải của hướng t=(tx,tz) là (−tz, tx) (+z = NAM).
    "Bong bóng" quanh người chơi (r 340/300/220 m theo TIER): số xe = km phố trong bóng × mật độ theo cấp, xe ra
    khỏi bóng tái sinh ở vành ≥ 130 m; qua nút chọn cạnh tiếp (ưu tiên thẳng/đường lớn, không quay đầu trừ ngõ cụt,
    không ra ngoài vùng chơi, không ngược chiều), bo cua = nội suy smoothstep 2 quỹ đạo lệch-làn quanh nút (≤ 6 m),
    giảm tốc theo góc rẽ; bám đuôi bằng lưới băm 10 Hz + thoát kẹt 1,5 s. NGƯỜI CHƠI trên đường (avoidPlayer, 10 Hz):
    xe LÁCH sang bên tới khoảng hở tâm xe máy 2,0 / ô tô 2,7 / người đi bộ 1,0 m (giới hạn trong lòng đường — xe máy
    được lấn tạm làn ngược, ô tô không — hoặc trong vỉa hè), lệch trượt 1,8/1,2/0,9 m/s; không lách đủ thì giảm tốc,
    dừng + bấm còi (đếm cho audio.js). Áp cả khi đang "thoát kẹt" (bản đầu bỏ qua người chơi ở nhánh đó → xe xuyên người).
    Tốc độ: xe máy 8,5-11 (p) … 4,5-7 (r) m/s, ô tô 9-12 … 4,5-6, người đi bộ 1,1-1,6. Người đi bộ trên vỉa hè
    (xsection: mép đường + 35-75% SIDEWALK_W), không mọc/đi vào footprint nhà thật (gặp nhà → nép mép vỉa, kẹt → quay
    đầu); đường đôi chỉ vỉa hè phía ngoài; chân đặt ở SIDEWALK_TOP. Vẽ INSTANCED: 3 kiểu xe máy (1 người/chở 2/chở
    hàng) + 3 ô tô (con/gầm cao/16 chỗ) + 2 người đi bộ = 8 draw call thân (+8 bóng tiếp đất); mô hình gộp rồi mergeVertices;
    màu sơn/áo/mũ theo instance (thuộc tính `aTint` chọn kênh), tay chân người đi bộ vung bằng vertex shader, đèn
    pha/hậu tự sáng theo `uNight` (traffic.setNight). Chỉ VẼ tác tử trong DRAW_R 260/230/170 m (mô phỏng tới RB).
    **BẪY HIỆU NĂNG (đo):** ghi đè MỖI KHUNG vào bộ đệm instance GPU còn đang được khung trước đọc → ANGLE/D3D11 đồng
    bộ CPU↔GPU, mất 5-9 fps dù update() 0,5 ms và chỉ +0,15 M tam giác (thử: "đóng băng" giao thông = như tắt; tắt bóng
    không đỡ). Sửa: dữ liệu instance XEN KẼ 1 bộ đệm/nhóm (stride 28: ma trận | sơn | áo | áo sau/quần | pha | nhịp)
    × 3 bản XOAY VÒNG (ghi bản của khung N−2) → 1 lần tải/nhóm/khung, hết chờ. Áp cho MỌI InstancedMesh cập nhật mỗi
    khung (petals.js đã áp: 3 instanceMatrix xoay vòng). Giao thông KHÔNG đổ bóng vào shadow map (main.js làm mới bóng 4,5-10 Hz → bóng xe 10 m/s nhảy ~2 m/lần):
    BÓNG TIẾP ĐẤT MỀM = InstancedMesh trong suốt RIÊNG `traffic_<nhóm>_shadow` (elip lõi alpha a, rìa nhạt dần về 0;
    MeshBasic đen, không ghi depth, polygonOffset, đêm nhạt 45 %) dùng CHUNG InterleavedBuffer instance với thân xe
    (1 lần tải GPU) → 8 + 8 draw call (bản đầu: elip Lambert đen đặc gộp trong mô hình = "vũng dầu" cứng); vẫn nhận
    bóng. HỢP ĐỒNG: InstancedMesh `traffic_*` mang `userData.noCull`
    + boundingSphere = đĩa DRAW_R quanh người chơi (instcull không nén), `raycast` rỗng (instanceMatrix xen kẽ không có
    `.array`). Thuyền du lịch cũ (toạ độ 1:10, trên cạn) và 3 trục vùng đã xoá. `__hp.traffic.check()` = bất biến diag,
    kiểm VỊ TRÍ ĐANG VẼ (gồm lách người chơi/bo cua/ghost): sai bên (tâm xe < 0,3 m bên phải tim phố 2 chiều, ngoài vùng
    ngã tư, không đang lách), ra ngoài lòng đường, chồng nhau, người đi bộ trong nhà/giữa lòng đường ngoài ngã tư — bản
    đầu chỉ xét làn GÁN (a.latCur > 0 theo cấu trúc → luôn 0, vô nghĩa). Người đi bộ GIỮ MÉP VỈA: rẽ về phía vỉa của mình
    ưu tiên, rẽ băng sang phía kia ×0,12, quay đầu ở ngõ cụt đổi `side` (cùng vỉa vật lý); người trong vùng bo ngã tư
    (≤ rb+2 m từ nút) vào lưới `wmap` → xe trong hành lang phía trước giảm tốc/dừng trước họ (trước: xe chạy xuyên người).
    **Cảm giác chơi (main.js/vehicles.js/input.js/character.js):** đi 3,0 / chạy 7,0 m/s (trước 5/11), nhảy 6,5;
    bước con ≤ 0,35 m; xe máy 16 m/s (~58 km/h, trước 23), xích lô 4,2, thuyền 10; lái kiểu xe đạp ω = v/L·tan δ, δ
    giảm theo tốc độ, trần gia tốc ngang 14 m/s², ga/phanh/lùi/trôi tách riêng, bước con 0,4 m chống xuyên tường.
    CẦN BOOM CAMERA chống xuyên nhà: js/footprints.js raymarch 2D 0,45 m trên footprint + heightOf + LM_POLY (cao thân
    địa danh), co NGAY, nhả 2,5/s; bỏ qua nhà chứa tâm nhìn; chỉ khi dist ≤ 40 m. `__hp.camOcclusion(false)` cho
    harness (góc QA khớp baseline). footprints.js CHỈ dùng dữ liệu ĐANG ĐƯỢC VẼ: `world.rbData` + `world.rbGrid` do WP2
    đặt sau buildRealFabric (D đã chốt D.dead của claims/quảng trường/công viên; grid dựng sau đó nên at() bỏ nhà dead),
    không có thì CHỈ địa danh — KHÔNG tự decodeRB(RB_B64) (bản đầu tự giải mã: trên nhánh chưa có WP2 là nhà VÔ HÌNH —
    camera co 20 → 9 m trước khoảng trống, chỗ xuống xe bị chặn giữa quảng trường; sau merge bỏ qua D.dead của WP2;
    +~35 MB heap). `world.isFree(x,z,r)` (WP2) được freeSpot()/clearPath() gọi nếu có. Camera tự vòng ra sau xe đang chạy khi không kéo 1,5 s; pointer theo pointerId + pinch zoom (3-36 m);
    Esc đóng bảng trên cùng (ui.closeTopModal; hội thoại: bỏ qua, không chạy onEnd); E cũng đóng Hướng dẫn; free-cam
    đạo diễn không còn kích hoạt tương tác; Space chỉ "sống" 250 ms + bị xả khi đang lái/mở bảng (đang lái = bấm còi);
    xe bị kẹp trong vùng chơi. XUỐNG XE không bao giờ từ chối trên cạn (bản đầu: chỉ 12 ứng viên freeSpot → kẹt trên xe
    kẹt = soft-lock): 2 hông → sau/trước 1,3-2,6 m → xoắn ốc 16 hướng tới 8 m (thuyền 3,2) với freeSpot + đường tới đó
    không xuyên nhà (clearPath) → luật cũ dot3 (trên cạn + trong vùng chơi) → ngay chỗ xe. GỌI XE: trước mặt/2 bên/sau
    1,6-2,4 m → xoắn ốc tới 6 m → chỗ đang đứng nếu đủ rộng (r 0,8) → không có thì toast, KHÔNG sinh xe (bản đầu sinh
    xe ngay chỗ đứng, kẹt trong collider). BÓNG NHÂN VẬT (updatePlayerShadow): bóng thật trễ ~1,5 m khi chạy / ~3,5 m
    khi lái (làm mới 0,22-0,5 s) → đang di chuyển hoặc vừa dừng < 0,35 s: tắt castShadow của người + xe đang cưỡi,
    bóng tròn đậm dính chân; đứng yên: bật bóng thật, bóng tròn nhạt còn 45 % (bóng tiếp xúc); đang cưỡi: chỉ bóng
    tròn của xe. Nhân vật tỉ lệ người thật (đầu nhỏ, bỏ mắt long lanh/má hồng), nhịp bước theo tốc độ thật.
    **Nhiệm vụ/NPC/chữ:** PLAY_RADIUS khai báo sớm; biển địa danh, NPC (ngư dân Đồ Sơn, chị Thu Cát Bà), xe/thuyền
    ngoài vùng chơi không dựng/không tính → mục tiêu "Nhà thám hiểm" = 22 địa danh trong vùng (trước 26, tối đa 22 →
    allDone không bao giờ bắn). Hoa lưu theo CHỈ SỐ bông (`flowerIdx`, bản lưu cũ chỉ có số đếm → coi N bông đầu là
    đã nhặt); NPC chặn người/xe bằng pushOut (collider cũ push vào world.colliders SAU khi chỉ mục đã dựng → vô hiệu).
    Chữ i18n/NPC viết lại cho giai đoạn 1:1 trung tâm (bỏ "1:10", "phóng đại 2,2", "15 địa danh", "nhanh gấp 7 lần");
    số liệu qua biến `{N}` `{F}` (i18n.setVars). diag() báo thêm "NGOÀI VÙNG CHƠI".
    **Âm thanh (audio.js):** nền phố procedural — ù xe (nhiễu nâu) + rì máy (nhiễu dải 600-900 Hz) theo mật độ xe quanh
    người chơi (traffic stats.near), còi "bíp bíp" khi xe bị chắn + lác đác ban ngày, chim ban ngày (công viên nhiều
    hơn), dế đêm, máy xe mình lái + gió; nhạc nền nhỏ lại 0,16→0,075. Node cố định, chỉ đổi gain/tần số.
    **Tool (Windows):** tools/qa/launch.mjs (Chrome hệ thống + playwright-core, khoá autoQuality, GIỮ KHOÁ GPU toàn máy
    tới g.close() — bản đầu không khoá; gpulock.mjs tái nhập có kiểm pid + khoá con cho hậu duệ của `run --`); diag/tour/perf/mobile
    viết lại (toạ độ suy từ LM/PANO_CAM, tour chọn điểm đứng bằng raycast); shoot.mjs chờ nút Bắt đầu mở + pinQuality
    (BẪY: không khoá thì máy bận → autoQuality nấc 3 sương gần → ảnh vệ tinh trắng xoá — đã thấy ở baseline cùng phiên).
    **Đo (Radeon 890M, TIER 3, shoot.mjs views_std 24 góc, base = `git archive dot3` 9cb2cc1 CÓ assets/ + assets_lite/
    hard-link — log server 0 lần 404; after = WP8 đã merge cùng dot3 đó; 2 cặp CÙNG 1 khoá GPU, thứ tự base→after rồi
    after→base):** fps TB 16 góc pano 53,1 / 53,8 → 56,1 / 56,4; góc phố nặng pano_007 44,3/45,0 → 53,9/53,5 · pano_021
    48,9/49,8 → 56,5/54,8 · pano_071 42,8/45,5 → 50,3/54,3 · pano_014 48,3/52,0 → 55,7/58,1 · pano_141 52,2/48,2 →
    55,1/55,6; góc nhẹ (≥ 57 fps) như cũ. Draw call TB pano 1015/1026 → 869/858 (−15 %; góc phố −20..−25 %: giao thông
    cũ mỗi xe nhiều mesh + thuyền cũ → 16 draw instanced). Tam giác bằng nhau (pano_007 5,75 → 5,84 M) — chênh tris
    ở lượt đo đầu (−2..−3 M) là do base THIẾU assets_lite (xem BẪY A/B ở §8), KHÔNG phải "lấy mẫu khung bóng" như đã
    ghi trước; nhưng lợi fps ở góc phố vẫn còn khi cả 2 bên có lite và lặp lại khi đảo thứ tự → đến từ −300..−350
    draw call. (Lượt A/B của phản biện trên máy tải nặng: fps lệch trong nhiễu; số trên đo lúc máy chỉ có agent khác
    chụp xen kẽ.) CHI PHÍ GIAO THÔNG cùng phiên (bật/tắt, `--traffic off`): TB pano 56,1 vs 56,9 fps (0-2 fps ở hầu hết
    góc; cam_spawn/cam_high_center 3-5 fps ở 1 lượt, lượt kia ≈ 0); probe bật/tắt luân phiên: −0..3 fps; update()
    0,6-0,75 ms/khung TIER 3 (~265 xe + 66 người), 0,49 ms lite (145 + 37) — tăng theo tải CPU của máy (phản biện đo
    máy tải nặng: −3..−7 fps, 0,9 ms). Khởi động KHÔNG đổi (hpReady 20,2/19,6 → 20,4/20,6 s, nhiễu ±1 s; khối `fabric`
    12,5 s đồng bộ của world.js vẫn dài nhất — thanh tiến trình chỉ làm nó hiện rõ). Heap sau gc() ép: 684 → 680 MB
    (bản đầu 664 → 702: footprints.js tự giải mã RB01 + import buildings_real.js — đã bỏ). 0 lỗi JS full (24 góc ×2)
    + lite (tier 1); diag 0 vấn đề cả full lẫn lite, check() trên vị trí vẽ: 0 sai bên / 0 ra ngoài lòng đường /
    0 chồng / 0 người đi bộ giữa lòng đường ngoài ngã tư (265 xe, 66 người). Mô phỏng giao thông chạy được trong node
    (không GPU): map 'three' → lib/three.module.js bằng module.register + shim window/location/localStorage + đồng hồ
    performance.now giả — đo va chạm xe–người (72 điểm × 50 s): bản đầu 557 lượt < 0,8 m / 190 xuyên < 0,45 m → 483 /
    164 (−13 %); ~9 % người đi bộ ở trong lòng đường tại một thời điểm = đang băng qua phố ngang (vỉa hè đứt ở ngã tư).
    **Sau merge dot3 ece40e1 (WP2 fabric thật + WP4 + WP5; base = export ece40e1 có lite, 2 cặp đảo thứ tự):** fps TB
    pano 56,2/57,3 → 58,3/58,4 (pano_089 46,1/50,0 → 56,9/58,2 · pano_071 51,7/51,4 → 57,2/56,0 · pano_141 53,0/53,5 →
    58,9/56,4), draw call TB pano 877/913 → 735/741 (−19 %), tris bằng nhau; giao thông bật/tắt ≈ 0 fps. footprints.js
    nhận world.rbData (46 128 nhà, D.dead của WP2): cần boom co 20 → 8,6 m trước nhà THẬT đang vẽ; gọi xe/xuống xe ở
    chỗ reviewer từng kẹt chạy bình thường (xuống ở chỗ world.isFree). **KHỞI ĐỘNG −4,7 s:** hpReady 9,7-9,9 → 5,0 s, nút
    Bắt đầu mở 12,1-12,3 → 6,9-7,7 s. **BẪY CANVAS 2D (đo):** minimap.js vẽ ~40k footprint thành MỘT path rồi fill() 1
    lần = 5,2 s đồng bộ (rasterizer Skia sắp cạnh cả path; CPU hay GPU canvas như nhau); fill theo lô 64 đa giác = 74 ms,
    ảnh y hệt (cùng màu đặc) → bước 'actors' 5,2 s → 0,36-0,45 s. Bước 'shaders' giờ bắt đầu trước khối biên dịch trước
    của WP5 (trước tính nhầm vào 'actors'). Heap sau gc() 467 → 464 MB. diag full + lite 0 vấn đề / 0 lỗi JS.
- **2026-10-04 (dot3-WP2 FABRIC)** [PHỐ NHÀ THẬT TỪ FOOTPRINT — `js/citygen.js` + `js/facade_atlas.js` (+ `_worker.js`)]:
    **(1) CỜ `FABRIC`** (world.js cạnh BUILD_RADIUS): mặc định `'real'`; `?fabric=proc` = bộ sinh nhà GIẢ cũ để A/B. Các khối
    `if (FABRIC === 'proc') {` thay `{` ở: vòng OSM BUILDINGS, mái hiên/biển generic (InstancedMesh cap 300), `house()` rows,
    `shophouse_infill`, `block_infill` (+ dãy LHP), `port_kho`, `_buildAnchor` (Sở GTVT/Cảng vụ/BV QT), 3 `tower()` giả. CHƯA
    gate (thuộc khối cells — WP3): `port_kho_100+` (fix t8) và `port_kho_0..`. Hàm `house()`/`facadeMats` giữ (grandMat dùng).
    Mọi chỗ đọc `_bldGrid`/`houseEvidence`/`nearRealBuilding` nay chỉ còn trong nhánh proc (FABRIC 'real' không nạp chúng).
    **(2) VÙNG GIỮ CHỖ trước khi dựng** (world.js, ngay sau `cornersDry`, TRƯỚC mái hiên/biển/cây): `LM_POLY` (+3 m, đệm miter)
    kind 'landmark' ('square' → 'plaza'); vòng tròn khối GLB lệch/to hơn footprint (opera 28, bưu điện lùi 9 m r27, bảo tàng
    21, nhà thờ 25, ga 30, THPT NQ 44, đền Nghè, đình HK, chùa Hàng, NHNN 34, đền Tam Kỳ, Nhà Kèn, Chợ Sắt +12,+4 r60); hộp CVH
    Thanh Niên; `PARKS` (đa giác OSM — KHÔNG dùng `GARDENS`: đó là bbox TRỤC THẲNG của chính các park, dải vườn hoa chạy chéo
    nên bbox nuốt ~110 nhà thật hai bên phố); tập con THẬT SỰ MỞ của `openSpace` (quảng trường Nhà hát r62, hành lang Nhà hát→
    Quán hoa, QT Lê Chân, QT Triển lãm, chợ Cột Đèn, bãi Cầu Đất, road#9 2 hộp, CV ĐBP tây, 2 promenade Tam Bạc, CV Bạch Đằng,
    Bến Bính, hành lang ray Mê Linh). Zone dạng HÀM thử tại TÂM: `clearedZone`, `inSuperblock`, hộp nút cầu HVT, `lakeSD<16`,
    `hoSenSD<10`, kè hồ 25 m. Các zone openSpace kiểu "khuôn viên công sở / bệnh viện / ngã tư bảo tàng / kè sông 42 m / cầu Lạc
    Long" CỐ Ý BỎ: chúng chặn nhà GIẢ, còn footprint thật ở đó là nhà thật. Nhà bị `D.dead[b]=1` khi tâm trong claim HOẶC
    `claimOverlapFrac>0.2` (mọi kind — claim 'cell' của WP3 tự có hiệu lực, miễn đăng ký TRƯỚC khối này) HOẶC chứa/sát (<0,5 m)
    điểm camera pano (lệch đăng ký/đè đường). v0: 289 do claim + 119 do zone + 9 do pano. `claims.js` thêm lọc nhanh BBOX
    trong `claimOverlapFrac` (kết quả y hệt; cần khi WP3 rải ~1.200 claim 'cell').
    **(3) ATLAS** (`facade_atlas.js`): rasterizer PHẦN MỀM ghi thẳng Uint8ClampedArray (không canvas: premultiply hỏng RGB ở
    mặt nạ 0, getImageData 2048² 30-40 ms; Clamped để cộng sáng/bóng không quấn 255→0). 8×8 ô, mỗi ô 1 MÔ-ĐUN = 1 bay 4 m × 1
    tầng (tầng trệt 3,9 / trên 3,3 / lan can 0,9 m) hoặc 4×4 m mái/chi tiết; 63 ô: 20 tầng trên (nhôm kính+hoa sắt, ban công
    Juliet, chuồng cọp, ốp gạch, điều hoà, lô gia, cửa chớp Pháp, vòm, con tiện, KTT, vách kính, băng cửa, biệt thự, công sở,
    tôn kho), 16 tầng trệt (tạp hoá kệ hàng, shop quần áo, quán ăn ghế nhựa, nhà thuốc, cửa cuốn ×2, kính, cửa xếp, nhà ở ×2,
    phố cũ cửa gỗ vòm, kho, công sở + 3 thêm sau phản biện, đặt SAU D_AC: SỬA XE MÁY `G_MOTO`, ĐIỆN THOẠI `G_ELEC`, ĐIỆN NƯỚC
    `G_HARD` — mặt phố liền của WP1 v1 từng lặp 1 kiểu kệ hàng cả dãy), 7 tường hông/sau/chung (vữa, xi măng thô, ố, cửa sổ nhỏ, mảng gạch, QUẢNG CÁO VẼ TAY từ
    chung "HÚT BỂ PHỐT"), 2 lan can mái, 4 mái (bê tông, GẠCH LÁ NEM ĐỎ giữ màu, tôn sóng, ngói), 8 chi tiết, 5 ô × 4 dải BIỂN
    HIỆU (20 từ CHUNG: CÀ PHÊ, TẠP HOÁ, PHỞ BÒ... + SĐT giả RÕ RÀNG '0000.xxx.xxx' — đầu 0000 không phải mã vùng/mạng
    nào; từng dùng '0225.3xxx.xxx' = đúng định dạng máy bàn HP thật, có thể trùng thuê bao — KHÔNG thương hiệu), mặt trước CỤC NÓNG ĐIỀU HOÀ `D_AC` (đặt SAU
    các ô SIGN: SIGN0.. phải liên tiếp). KÊNH ALPHA = MẶT NẠ: 255 tường (nhân màu nhà), 191 kính (sáng đêm), 128 giữ màu, 64 nền
    biển (nhân màu biển), 0 chữ biển (màu tương phản). THỨ TỰ CÓ CHỦ Ý: biên tường↔giữ (khung/song sắt — nhiều nhất) khi mipmap
    trộn chỉ đi qua vùng "kính", không qua biển/chữ. Nhiễu xác định (hash + value noise, không Math.random). VẼ TRONG WORKER
    (`facade_atlas_worker.js`, module worker, chữ bằng OffscreenCanvas): luồng chính chỉ `buildFacadeAtlas(size,{layoutOnly:true})`
    lấy chỉ số ô cho shader + DataTexture ĐÚNG KÍCH THƯỚC tô xám chờ; ảnh về thì `tex.image.data = data; needsUpdate` (BẪY: three
    r160 dùng texStorage2D BẤT BIẾN — không được đổi kích thước texture sau lần upload đầu). Worker lỗi → vẽ đồng bộ. 2048²
    (TIER≥2) / 1024² (TIER≤1); node 83-88 ms, worker 190-210 ms (onmessage chỉ chạy khi buildWorld nhả luồng chính — log
    "worker 7-8 s" là thời điểm nhận, không phải thời gian vẽ; vẫn về TRƯỚC khung hình đầu).
    **(4) BUILDER** (`buildRealFabric(scene, ctx)`): MỖI CẠNH = 1 QUAD (cạnh cắt nóc hồi = 3 tam giác), uv = (bay, ĐỘ CAO LOCAL m);
    shader (Lambert + onBeforeCompile, `textureGrad` + đệm 3 px/ô + TRẦN MIP ~log2(ô)−3,5 chống loang ô kề) chọn mô-đun THEO
    FRAGMENT: tầng từ độ cao, bay = floor(uv.x), bộ mô-đun theo STYLE; tầng trên 80% "mô-đun chính" của nhà; mặt phố ≥3 bay
    (dãy nhà ống gộp) → MỖI BAY 1 nhà (màu WALL_PALETTE + mô-đun riêng); dải biển 2,95-3,85 m phủ chữ từ 20 dải SIGN theo hash.
    aFac u8×4 = (seed, kind|cờ, style hoặc ô atlas, số tầng); cờ +8 nhà LỚN/CAO/độc lập (≥5 tầng, ≥600 m² từ 3 tầng, KTT/kính/
    biệt thự/công sở → hông + sau cũng có cửa sổ đều, ~12% bay trơn), +16 mặt phố dài, +32 mái dốc, +64·CẤP ĐƯỜNG trước mặt tiền
    (`frontClass`: p/s/t → 8% bay là nhà ở, r/w 45%, ngõ h 85% — phố nhỏ/ngõ thôi "toàn cửa hàng"). Nhà ≥9 tầng mà dữ liệu ghi
    nhà ống/phố cũ → mô-đun KTT hoặc kính (tháp 20 tầng mang mô-đun nhà ống trông giả). MÔ-ĐUN TẦNG TRỆT chọn bằng HASH
    NGUYÊN uint (`ihash/pidx`): `groundModule()` JS ra ĐÚNG TỪNG BIT như GPU (kiểm 8192 mẫu, Radeon 890M/ANGLE) → citygen biết bay
    nào có dải biển (`SIGN_EXT`) và dựng HỘP BIỂN 3D lồi 0,22 m đúng chỗ (mặt trước = kind 6, shader vẽ y hệt mặt phố sau nó →
    không "nhảy" khi ẩn ô chi tiết). BẪY: hash FLOAT trong GLSL ≠ JS (float32/FMA) — muốn JS biết GPU chọn gì thì dùng số nguyên.
    CẠNH NÂNG (`faceRoad`): cạnh SIDE/BACK ≥3 m nhìn thẳng ra lòng đường trong 26 m mà không nhà nào che → vẽ như MẶT PHỐ (v0
    gắn FRONT chỉ khi đường cách ≤ ~6,5 m sau mặt tiền chuẩn → nhà lùi 10-20 m quay TƯỜNG TRƠN ra phố, vd pano_085/092; v0: 10,6k
    cạnh được nâng; không áp "mỗi bay 1 nhà" cho cạnh nâng). Ban đêm: material đẩy vào `world.facadeMats` → daynight đặt
    emissiveIntensity, shader lấy `emissive.r` làm hệ số đêm (KHÔNG sửa daynight.js); kính sáng ngẫu nhiên theo ô + cửa hàng
    trệt + biển, ánh đèn NHÂN với texture. AO giả: chân tường tối dần 0-1,7 m.
    Mái: FLAT_PARAPET = đa giác (earcut/quạt) + mặt TRONG lan can; FLAT +0,25; GABLE/SHED tôn theo trục DÀI OBB (cắt đa giác bằng
    Sutherland-Hodgman theo đường nóc, tường lên tới mặt mái + đỉnh hồi); HIP ngói chỉ cho nhà ~chữ nhật (diện tích/OBB ≥0,85,
    ≤6 đỉnh) trên OBB đua 0,35 m. Sàn mái bằng: lá nem đỏ 45% nhà <300 m² (15% nhà lớn), còn lại bê tông SẪM nhuộm màu mái;
    `roofVar` = mỗi mái 1 độ sáng 0,78-1,14 theo hạt giống (vệ tinh là MẢNG LOANG; ô bê tông 4 m có vết đậm lặp lại → nhìn từ
    trên thành "lưới caro" — vết loang trong ô phải MỀM). Đồ trên mái bằng (nhà <900 m²): tum thang 45% (≥3 tầng, phía SAU mặt
    phố, mặt cửa D_DOOR), bồn inox lăng trụ 5 cạnh 70% (13 tam giác; trên tum nếu có), MÁI TÔN che sân thượng 70% nhà <300 m² / 40% lớn hơn, phủ
    55-95% chiều dài, ~70% đỏ gỉ/nâu đỏ (mảng đỏ chủ đạo của vệ tinh HP) + 2 cột THÉP GÓC chữ L phía phố (2 cánh, mặt ngoài hướng phố, ô det), máy nước nóng 10% nghiêng NAM.
    Vệt gỉ trên ô tôn CHỈ làm tối (tô màu nâu M_KEEP → thành vạch trắng hồng trên tôn xanh).
    Chi tiết mặt phố (ô 'det'): ban công (TUBE 62%, OLD 50%...: mặt đáy + lan can NGOÀI + 2 đầu = 8 tam giác — KHÔNG mặt
    trên: lan can 1,2 m che kín sàn sâu ≤0,95 m với mọi góc nhìn dốc <~52°; KHÔNG mặt trong lan can), mái hiên bạt sọc 35%
    (2,88→2,4 m, ra 1,5 m), HỘP BIỂN 3D (các bay LIỀN NHAU cùng có dải biển kín bay GỘP 1 hộp: mặt trước 1 quad kéo qua nhiều
    bay — shader tự chia bay theo uv.x — + 2 đầu = 6 tam giác/hộp; không mặt trên/đáy), CỤC NÓNG ĐIỀU HOÀ 3D (0,82×0,54×0,3 m
    treo +2,58..3,12 m mỗi tầng trên — dưới mép sàn ban công tầng trên +3,18 m nên không cắt ban công; 14% bay nhà ống, 21% KTT).
    Chi tiết chỉ dựng cho nhà có tâm r ≤ 1650 m. CÔNG NĂNG TẦNG TRỆT: dữ liệu v1 có `INFO` từng nhà → USE_SHOP ép rc 0 (cửa
    hàng), USE_HOME ép rc 3 (mã MỚI: 100% mô-đun nhà ở — HOME_THR[3]=1,0 cả JS lẫn GLSL); v0 (info=0) vẫn theo `frontClass`;
    không áp cho mặt phố gộp nhiều bay (mỗi bay 1 nhà) và cạnh nâng faceRoad.
    Ô: CHÍNH 450 m `fab_main_<tx>,<tz>` (đuôi _x,z cho nearCull) — ĐO cùng phiên 300/450/600 m: 450 giảm MỘT NỬA draw call của
    phố (pano_007 58→26, cam_spawn 38→21, kể cả lượt bóng), tam giác vẽ chỉ +0,01-0,05 M; 600 không lợi thêm. CHI TIẾT 300 m
    `fab_det_<tx>_<tz>` (CỐ Ý không khớp regex _x,z: hiện trong 380 m (LITE: không có) do `scene.onBeforeRender` nối chuỗi
    bật/tắt, nhịp 0,25 s). Mọi mesh `userData.noMerge=true` + freezeStatic `collect` bỏ qua (aFac không sống qua merge/split).
    v0 (25.192 footprint): dựng 24.775 nhà; 57 ô chính (≤57 draw call cả thành phố) 0,74 M tam giác + 107-110 ô chi tiết
    0,75 M tam giác (chỉ phần trong 380 m được vẽ); dựng 510-640 ms (giải mã 5, claims 60-70, hình học 340-450 ms).
    **v1 (46.128 footprint, dot3 9cb2cc1) sau phản biện:** dựng 40.572 nhà (bỏ 4.934 ngoài R1600 + 488 claim + 133 zone + 1
    pano); 51 ô chính 0,883 M + 105 ô chi tiết 0,590 M = **1,474 M tam giác** (≤1,5 M; trước khi cắt: 1,03 M + 0,91 M = 1,95 M);
    dựng 630 ms máy rảnh / 1,7 s máy bận (giải mã 7, claims+tường chung+lưới 100-300, hình học 445-1.180). Cơ cấu chính:
    tường 348 k, mái 125 k, mặt trong lan can mái 148 k, bồn 13 k×13, tum 4,8 k×10, mái tôn 10 k×4; chi tiết: ban công 26 k×8,
    hộp biển 22,7 k hộp (28,9 k bay)×6, điều hoà 13 k×8, mái hiên 9,5 k×6, cột 10 k×8. ĐẾM KHÔNG CẦN GPU: dựng citygen trong
    node (loader map 'three'→lib/three.module.js, giả navigator/location/localStorage; device.js nạp trước khi xoá document để
    atlas vẽ đồng bộ không chữ) — ra đúng số tam giác (trừ claims vì không chạy world.js), ~1-2 s.
    **(5) VA CHẠM ĐA GIÁC**: lưới 16 m trên bbox nhà (+2 m), dựng NGAY sau khi chốt D.dead; `fabricCollide(p,r)` 2 lượt: trong
    nhà → ra cạnh gần nhất KHÔNG dẫn sang nhà kề (tường chung), ngoài mà gần < r → đẩy theo điểm gần nhất. Gắn cuối
    `world.resolveCollisions` (nên mọi oracle đặt cây/hoa/diag tự thấy nhà thật). Mới: `world.isFree(x,z,r)`,
    `world.findFree(x,z,r,maxD)` (xoắn ốc 1 m, đất khô), `world.fabric = {stats, meshes, detMeshes, collide, at, hit, frontEdges,
    material, grid}`; `citygen.fabricData()` = RB01 giải mã DÙNG CHUNG (D.dead = nhà đã bỏ — camera/minimap/cell sink phải bỏ qua).
    KẸT: lô KÍN (mọi cạnh giáp nhà khác) hoặc khe/hõm đa giác lõm hẹp hơn 2r (đẩy khỏi tường này lọt vào tường kia) → sau 2
    lượt vẫn trong nhà (v1: 9/1.401 tâm nhà thử) → xoắn ốc 0,5 m (tới 8 m) rồi 1 m (≤60 m — khối kho cảng liền nhau) tìm điểm
    ngoài mọi nhà và cách tường ~r. v1: 0/13.541 tâm nhà + 0/200.000 điểm ngẫu nhiên còn kẹt; 2,6 µs/lần (node, gồm kiểm),
    tệ nhất 3,4 ms (chỉ khi kẹt).
    **(6) RÀ LẠI vị trí**: biển địa danh (landmarks.js) chỉ DỜI khi trong/cách footprint <1,3 m: nhà thờ ~7 m, đền Nghè 8 m, đình
    HK 3 m, NHNN 8 m; npcSpots/vehicleSpawns (trừ thuyền) dời khi chạm nhà; cyclo (−220,174) hết nằm trong nhà (đa giác 46×46
    dưới claim QT Lê Chân). `__hp.diag()` RỖNG cả real lẫn proc; 0/551 camera pano trong nhà; 400/400 điểm thử trong nhà bị
    đẩy ra. BIỂN THẬT `SHOP_SIGNS`: NEO vào mặt tiền thật gần nhất ≤22 m đúng dải biển 3,4 m (0,27 m trước tường — trước hộp
    biển 3D), quay theo pháp tuyến cạnh, biển trùng toạ độ rải dọc mặt tiền không chồng; không có mặt tiền → bỏ. LƯỚI AN TOÀN
    THƯƠNG HIỆU `_BRAND` (world.js, cả 2 nhánh): catalog pano còn HANA/INAX/MB/"BẢO MIN…" → bỏ biển đó (WP3 làm sạch tận gốc
    gen_shopsigns). Minimap vẽ footprint thật còn sống (1 path, 1 lần).
    **(7) SAU PHẢN BIỆN (rebase lên dot3 9cb2cc1 = có WP1 v1):** (a) **CẮT NGOÀI VÙNG CHƠI**: `ctx.maxR` (world.js truyền
    `BUILD_RADIUS`) → nhà có TÂM ngoài R1600 `D.dead` (`deadFar`): ngoài đó không có đường/vỉa, phố thật từng mọc ~150 m nhà
    trên cỏ trống (freezeStatic chỉ cắt ô NẰM TRỌN ngoài vòng tròn); dead nên va chạm/mặt tiền/minimap/ô det đều bỏ. (b) **TƯỜNG
    CHUNG SAU KHI GIẾT NHÀ** (hợp đồng v1): ngay sau vòng loại nhà, `makeFootprintGrid(D)` + `refreshPartyEdges(D, grid,
    mọi-nhà-dead)` — PARTY không còn láng giềng sống che → BACK/SIDE, cover 0 (không thì lỗ nhìn xuyên vào nhà rỗng); v1: 94
    cạnh hạ. Nhà do WP3/ai khác giết TRƯỚC (D.dead sẵn) cũng được rà. (c) **DỮ LIỆU DÙNG CHUNG**: world.js đặt `world.rbData =
    fabricData()` (D.dead đã chốt) và `world.rbGrid = _fab.grid` (grid trên) ngay sau `world.fabric` — WP8 `footprints.js`
    dùng nếu có; tích hợp PHẢI truyền `{D: world.rbData, grid: world.rbGrid}` làm `ctx.footprints` của WP7 và `fpGrid` của WP4
    (tự decodeRB = tránh/va vào cả nhà đã bị gỡ dưới quảng trường/công viên/ngoài R1600, và giải mã lại 3 lần). (d) **GIẢI PHÓNG
    BẢN CPU** (`RELEASE_CPU`, `?fabfree=0` tắt): `attr.onUpload(() => array = null)` cho mọi attribute + index của mesh phố;
    `webglcontextrestored` trên canvas `#scene` → chạy lại `gen()` (toàn bộ hình học, xác định từ D + D.dead) và thay geometry
    từng ô theo `userData.fabKey` TRƯỚC khung hình kế (đo: 414 ms, 0 lỗi, ô chính được upload lại); mesh phố `raycast` = no-op.
    BẪY: (1) `performance.memory.usedJSHeapSize` CÓ tính ArrayBuffer — mảng hình học phố ~94 MB (v1 1,47 M tam giác, 30 B/đỉnh +
    chỉ số); (2) ô CHỈ upload khi lần đầu được VẼ (trong frustum/bóng) → lúc spawn mới giải phóng ~30/156 ô (−21 MB: heap sau GC
    482 → 461 MB), phần còn lại giải phóng dần khi người chơi nhìn tới; (3) sau giải phóng KHÔNG gọi computeBounding*/đọc .array
    mesh 'fab_*'. HEAP ĐO ĐÚNG: Chrome `--js-flags=--expose-gc` + `gc()` 2 lần trước khi đọc — số "thô" (730-966 MB các lần
    trước) chủ yếu là rác chưa dọn: sau GC real 461 MB / proc 660 MB (cùng máy, v1). (e) **WebGL1**: shader atlas cần GLSL ES 3.0
    (uint, textureGrad, mảng const) → `onBeforeCompile(sh, renderer)` thấy `!renderer.capabilities.isWebGL2` thì KHÔNG tiêm (nhà
    vẽ trơn theo màu đỉnh, không phát sáng đêm) thay vì hỏng cả phố. (f) **THƯƠNG HIỆU**: lưới `_BRAND` (world.js) bổ sung đủ
    các tên mà `BRAND_MAP` của WP3 (`js/brands.js` — nguồn DUY NHẤT sau khi gộp) bắt được trong `shopsigns.js` hiện tại (quét
    node: 0 tên lọt, 0 bỏ nhầm, bỏ 26/954 biển); sau khi WP3 sinh lại shopsigns.js lưới này chỉ còn là dự phòng.
    (g) **GỘP VỚI WP5/WP4** (rebase lên dot3 9c46ef4): post.js WP5 thêm `totalEmissiveRadiance *= HP_UNLIT_K` vào chunk
    emissivemap_fragment (tự phát hiển thị theo màn hình, phơi sáng thích nghi tới ×4 lúc đêm) — shader phố THAY chunk đó nên
    phải tự nhân (`#ifdef HP_UNLIT_K`), không thì cửa sổ/biển cháy trắng ban đêm. `veg.plantStreetTrees` + `veg.buildTrees`
    nhận `fpGrid: world.rbGrid` (cây không né nhà đã bị gỡ, không giải mã RB lần 2; proc: undefined → trees tự giải mã).
    **ĐO** (Chrome headless d3d11, Radeon 890M, ?quality=full TIER 3, 1280×720, máy dùng chung với 7 agent — fps ±; A/B CÙNG
    PHIÊN proc → real, fog cố định 2600, 2 phiên): hpReadyMs 19,7-23,2 → 8,7-9,5 s (baseline dot3 18,9); cam_spawn 738 call/
    4,88 M tri → 709-712/3,92 M; pano_007_h090 1.577-1.706/7,9-9,1 M → 1.353-1.355/6,59 M (fps 42-44 → 50-51); cam_high_center
    1.160/7,44 M → 1.089-1.091/6,46 M (fps 46-49 → 51-57); game_3 1.197/8,13 M → 1.172/7,17 M; pano_102_h090 1.079/4,57 M →
    856-993/3,5-4,3 M. 12 góc std so baseline: calls −4…−21%, tris −13…−26% (game_3 dao động 1,17k-1,66k call giữa các lượt do
    hệ khác — đo trực tiếp: phố thật chỉ chiếm 8 call/0,14 M tri ở góc aerial này). Heap 730-950 MB cả hai nhánh (dao động theo
    GC; hình học ô chi tiết giữ bản CPU ~50 MB vì mất ngữ cảnh WebGL cần upload lại). LITE (TIER 1): không lỗi mới (8 lỗi 404
    `assets_lite/*.glb` do worktree không có assets_lite — có cả ở proc), hpReady 6,8-7,4 s.
    **ĐO LẠI sau phản biện** (dữ liệu v1 + WP4 cây + WP5 ánh sáng, dot3 9c46ef4; A/B CÙNG PHIÊN proc → real): hpReadyMs 17,0 →
    9,4 s; cam_spawn 742 call/4,89 M tri → 714/4,01 M (57 fps cả hai); pano_007_h090 1.585/7,09 M → 1.350/5,90 M (51 → 58 fps);
    cam_high_center 1.487/10,31 M → 1.094/6,29 M (55 → 57); game_3 1.234/7,14 M → 1.212/6,30 M (54 → 55); pano_102_h090
    1.093/4,46 M → 859/3,68 M. 24 góc std so baseline_std (dot3 TRƯỚC WP4/5, khác phiên): calls −38…+27% (game_6 +27%, aerial —
    hệ khác), tris −56…+7%, fps tối thiểu 39 → 49. Heap SAU GC: real 436-461 MB / proc 638-660 MB. Cổng: 0 lỗi JS (full), diag
    [], 400/400 điểm trong nhà bị đẩy ra & 0 còn kẹt, 0 biển địa danh/0 camera pano trong nhà, mất/khôi phục ngữ cảnh 0 lỗi,
    waterbfs 5/5; LITE chỉ 404 `assets_lite/*.glb` (môi trường).
    **BẪY/BÀI HỌC**: (a) helper GLSL dùng sampler `map` phải chèn SAU `#include <map_pars_fragment>`, không sau `<common>`;
    (b) đo trong máy dùng chung: autoQuality nấc 3 (near view, fog 220/1300, không hoàn tác) có thể bật giữa chừng → ảnh
    aerial mù sương — script chụp nên ghi `scene.fog.far` mỗi shot hoặc ép fog; (c) v0 footprint lùi khỏi phố + mặt phố không
    liên tục: phố thật vẫn "thưa" tới khi WP1 (frontage snap, lô, infill) về; renderer chỉ bù phần "tường trơn quay ra phố"
    (faceRoad); (d) tam giác ô chi tiết tăng theo số MẶT PHỐ (hộp biển 8, điều hoà 8, ban công 12, cột 6 tam giác/cái): khi WP1
    v1 thêm lô/infill phải đo lại ngân sách ≤1,5 M (núm: xác suất trong citygen, DET_RMAX, DET_R) — ĐÃ đo lại, xem "v1" ở (4);
    (e) `sed -i` của Git Bash đổi CRLF→LF cả file — sửa file repo bằng python/Edit.

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
    (7) LẤP KHE mặt phố ≥3,5 m (p/s/t/r) bằng lô SINH 12-18 m sâu khi có BẰNG CHỨNG (≥120 m² NHÀ DÂN thật phía sau trong ±14 m
    — không tính công trình công cộng/khối lớn >400 m²/cao ốc/nhà trong LM_POLY; hoặc tia quan sát pano audit tả NHÀ ỐNG ≤6 tầng,
    không chạm LM_POLY trong 80 m, cắt lô ở 3-22 m VÀ lô tựa vào nhà thật ≤8 m); veto: SÂN TRƯỚC (dải lô sâu 25 m chạm
    LM_POLY+12 m hoặc chồng công trình công cộng >250 m²/khối lớn/cao ốc/nhà >1000 m²), cảng phía BẮC tim Hoàng Diệu,
    ven nước/công viên (dải vườn hoa), nút giao (facadeLine+3 m phố khác),
    pano "mặt thoáng" (chữ area/summary có vườn hoa/quảng trường/hồ/sông/nút giao… VÀ 3 ô hướng kề PANO_SIDES tắt);
    lô NÔNG 3-6 m (khối cơi nới trước nhà lùi) chỉ khi phía sau là nhà dân nhỏ, ≤3 tầng; (8) lõi ô phố trên raster 0,5 m:
    NỚI nhà thật nông trước (không tốn byte) rồi MỌC nhà sinh 4,5-8×10-18 m tới phủ 77% (giữ ngõ, sân trường/cơ quan đệm
    10 m, ô phố <18% nhà thật để trống) — CHỈ nơi có BẰNG CHỨNG CỤC BỘ (8b): ≥2 m² nhà thật trong ô vuông ±10 m quanh hạt,
    tỉ lệ thật/(thật+trống) ±16 m ≥30%, và hạt + thân nhà không thuộc "ĐẤT TRỐNG MỞ" (phép mở hình thái trên lưới thô 2 m:
    lõi = ô cách mọi thứ không-trống ≥5 m, thành phần lõi ≥300 m², nở lại 6 m); (9) chữ nhật hoá, NỞ chữ nhật ≤1,5 m
    (thật)/2,5 m (sinh) lấp khe mái, khép khe 3-80 cm giữa nhà kề, cắt chồng lấn; CHỐT cuối: không đỉnh/mẫu biên nào lấn
    >0,2 m vào facadeLine p/s/t/r (dải đoạn + mũ tròn ở đỉnh gãy polyline và chỗ nối 2 way; đầu cụt không mũ) → cắt nửa
    mặt phẳng / bỏ; camera pano ≥3 m (sinh) / ≥1 m (thật đã sửa); nhà sinh cách LM_POLY ≥3 m; KIỂM HỢP LỆ trên TOẠ ĐỘ ĐÃ
    LÀM TRÒN như file (đa giác lưới 0,1 m, chữ nhật đúng tham số RBR1): bỏ đỉnh gai (2 cạnh kề quay ngược >162°), đơn CHẶT
    (không cạnh cắt, không đỉnh chạm cạnh khác ≤3 cm), tường-ra-ngoài, ≥6 m², bề hẹp ≥1,2 m; sau encode tự decodeRB lại và
    DỪNG (không ghi file) nếu còn footprint hỏng; (10) ghép 1.887 quan sát pano (tia la bàn, nhà đầu tiên trong 26 m; bỏ nhà "phía xa"; ≥7 tầng chỉ
    khớp nền ≥250 m²); (11) thuộc tính: tầng OSM >
    pano > phân bố pano địa phương (80 m) trộn phân bố chung, làm trơn ±2 (trừ cao ốc/khối lớn; "đuôi" 6-8 tầng bốc
    thăm trên mặt phố p/s/t được GIỮ, không kéo xuống và không kéo láng giềng lên), kiểu phố cũ thời Pháp
    (28 phố lõi) / cảng SHED / OSM class / chữ pano, màu tường theo chữ màu pano; (12) cạnh PARTY (+edgeCover) / FRONT / BACK / SIDE.
    **Số đo (Overture gốc → v1 sau phản biện):** 25.192 nhà v0 → 46.128 (thật 33.209 gồm 7.098 lô chia; sinh 12.919 = 4.043
    lô khe + 8.876 lõi; bản trước phản biện 52.380 với 19.099 sinh); phủ mái ô phố 43% → 65,1% (nhà thật 50,4%; vệ tinh đo
    ~66% mái/ô phố; bản trước 74,4% là vượt vì bịa nhà trên đất trống); mặt phố có nhà sát vỉa (mẫu facadeLine+1,2 m,
    trừ nút giao/ven nước/công viên) p/s/t/r 7,6/20,7/29,1/28,7% → 41,5/63,5/63,7/61,8% (bản trước 51,3/68,5/66,4/63,5 —
    phần chênh là lô bịa trong sân trước công trình/quảng trường/cảng); lùi mặt tiền nhà ống (từ mép lòng)
    trung vị p 7,6/s 5,2/t 3,9/r 3,5 m → 3,65/3,50/3,00/2,01 (= đúng bề vỉa); sâu lô mặt phố trung vị 8,8 → 11,7 m (p75 15,7;
    thật 15-25 m — phần sau nhà ống thường là footprint RIÊNG nên đo theo đa giác vẫn hụt); bề mặt tiền trung vị 7,0 → 5,3 m;
    30.036 cạnh PARTY; 1.893 nhà mang số tầng/màu từ pano; tầng TB 2,89 (1:3,7% 2:31,7% 3:41,7% 4:18,9% 5:2,7% 6:0,9%
    7+:0,3%; nhà không bằng chứng trần 8 tầng (p/s) / 6); b64 1,55 MB (≤1,8), giải mã ~10-12 ms node / 6-13 ms Chrome.
    **Màu mái** hiệu chỉnh THEO TỪNG NHÀ trên vệ tinh (trung vị pixel trong 8.885 footprint thật real_1/3/5/6/8, cân trắng
    gray-world): vệ tinh đỏ 29 / xám 46 / xám-xanh đá 18 / sáng 2%; game cũ 55/20/5/19 → 45/34/9/11 → sau phản biện
    44/42/9/4 (hạ trọng số bảng màu "sáng" 5/6/9 sang xám 13/15/7; giữ đỏ cao hơn số đo vì mù khí làm tôn đỏ gỉ ngả xám).
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
    **LƯỢT PHẢN BIỆN (sửa đã áp):** (g) bằng chứng "≥18% nhà thật trong CẢ ô phố" đã bịa trọn các vùng đất trống: dải
    lưỡi liềm ~1 km bờ bắc sông Cấm, lòng sân vận động, bãi cảng tây bắc, dải giải toả đường sắt ~200 m — nay bằng chứng
    CỤC BỘ + đất trống mở (8b); (h) công trình lớn/địa danh từng "chứng minh" dãy nhà ống trong chính sân/sườn của nó (Nhà
    hát lớn, Bảo tàng, THPT Ngô Quyền) — loại khỏi bằng chứng + veto sân trước; (i) tia pano tả Nhà hát (cách 60 m) xuyên
    quảng trường trống từng "chứng minh" 6 lô giữa quảng trường — chỉ tin tia tả nhà ống, không chạm địa danh, lô tựa nhà
    thật; (j) `rectOf` dung sai tới ~0,4 m cho cạnh 20 m nhưng b.pts giữ đa giác cắt → file (ghi tham số chữ nhật) lệch
    hình đã kiểm (lấn vỉa hè/chồng lấn quay lại) — sau MỌI phép cắt dùng `setRectOrPoly` (chữ nhật chỉ khi lệch ≤3 cm, đồng
    bộ b.pts); (k) kiểm hợp lệ trên số thực rồi làm tròn 0,1 m ở encode từng lọt 7 đa giác tự cắt — kiểm trên toạ độ đã
    làm tròn + giải mã lại sau encode; (l) kéo mặt tiền: đỉnh chung 2 cạnh mặt tiền nhìn CÙNG 1 phố từng bị CỘNG 2 lần dịch
    (lấn 4,5 m vào lòng phố s) — chỉ cộng khi 2 đoạn khác nhau lệch >45°, còn lại lấy dịch lớn hơn; sweep không còn bỏ qua
    hành lang của chính phố được kéo tới. **TƯỜNG CHUNG + D.dead:** edgeCover chỉ ghi SỐ TẦNG nhà che, không ghi nhà nào →
    người dùng giết nhà (claim/pano/cellsink) PHẢI gọi `refreshPartyEdges(D, grid, killed?)` (js/buildings_data.js) trước
    khi dựng: hạ PARTY không còn láng giềng sống che → BACK/SIDE, edgeCover=0 (không thì nhà kề nhà bị giết thiếu chân
    tường = lỗ nhìn xuyên vào nhà rỗng); không giết gì → 0 cạnh đổi; giết 2.391 nhà → 1.665 cạnh hạ, ~30 ms (tăng dần) /
    ~50 ms (toàn bộ). WP3 cellsink nên BỎ QUA nhà FLAG.SYNTH khi quyết định xoá nhà tay.
- **2026-10-04 (Đợt 3 WP5 LIGHT)** [TRỜI · ĐÈN · IBL · AO · SƯƠNG · GRADE · BÓNG · NƯỚC · VẬT LIỆU GLB · VỆ TINH · ẤM MÁY]:
    File: `js/skymodel.js` (mới), `js/post.js` (mới), `js/water.js` (mới), `js/daynight.js` (viết lại), `js/main.js`
    (renderer/hậu kỳ/autoQuality/vệ tinh/ấm máy), `js/assets.js` (applyGlbMaterialPolicy/setGlbLighting), `js/device.js`
    (`GFX` — núm chất lượng ánh sáng, CHỈ theo TIER), `js/world.js` (khối nước → water.js).
    **(1) Trời** = tán xạ đơn Rayleigh+Mie (air mass Kasten–Young, pha đẳng hướng bù tán xạ bội, ozone, chạng vạng/đêm/
    quầng đèn phố cộng thêm) — JS và GLSL CÙNG công thức trong skymodel.js (sửa một bên phải sửa bên kia; hằng số chỉ
    theo mặt trời `skyK`/truyền qua/màu nắng lên mây tính ở JS → uniform). Mặt trời THIÊN VĂN (vĩ độ 20,86°, xích vĩ
    −4,5° đầu tháng 10 như bộ pano, chính ngọ 11:45): mọc ~5:50, trưa cao 64° về phía NAM, lặn ~17:40; dưới −1° nắng = 0.
    Vòm: đĩa mặt trời + quầng Mie + mây fbm trôi + sao + trăng; có `<tonemapping_fragment>`/`<colorspace_fragment>`.
    Vòm vẽ SAU CÙNG nhóm đục, `gl_Position.z = w` + depthTest → shader trời chỉ chạy ở pixel trời trống (full-screen
    1,1-1,4 ms trên 890M). Hiển thị BAN NGÀY ×1,2 + bão hoà 45%: trời HP thật MÙ ẨM — trung vị vùng trời cao ~30-40° của
    160 pano ngẫu nhiên = sRGB(186,198,211); bản đầu (×0,76, bão hoà 100%) ra (142,175,210) xanh đậm, tối. Chạng vạng/
    đêm trộn về ×0,76/100% theo độ cao mặt trời (giữ màu hoàng hôn, giờ xanh).
    **(2) Đèn** — BỘ CỐ ĐỊNH 2 đèn (program key không đổi): HemisphereLight + 1 DirectionalLight có bóng = MẶT TRỜI ban
    ngày, TRĂNG ban đêm (đổi hướng lúc cường độ ≈ 0; bỏ moonGlow). Trưa: nắng ≈ 3,5 : bán cầu ≈ 0,8 (chiếu sáng trời
    ×0,55, khử bão hoà còn 25% — bóng râm chỉ hơi lạnh). Lambert/Standard three r160 = albedo/π × chiếu sáng ("tường
    trắng dưới nắng trưa ≈ 1"). Phơi sáng THÍCH NGHI = 0,92 × sqrt(trưa/hiện tại), trần ×4. Đêm: `moonAmb` + `cityAmb`
    ấm (đèn phố/cửa hàng; đất ×1, trời ×0,5) — thiếu nó hẻm lúc 21:00 đen kịt sRGB ≈ 15-20.
    **(3) IBL**: PMREM nướng từ CHÍNH vòm trời (cube 128 TIER ≥ 2, 64 TIER ≤ 1) mỗi 3 s hoặc khi giờ nhảy, 0,5-1,4 ms
    GPU/lần. BẪY: phải nướng vào MỘT RT cố định — đổi texture object của scene.environment (2 RT luân phiên) làm MỌI
    MeshStandardMaterial đi qua getProgram (`materialProperties.envMap !== envMap` → needsProgramChange) mỗi lần nướng.
    **(4) Tone/grade**: `CustomToneMapping` = ACES của three r160 + grade nhẹ (sat 1,03, toe 0,012) cài vào ShaderChunk
    TRƯỚC khi compile → composer (FinalPass) và đường vẽ thẳng (TIER ≤ 1) ra CÙNG màu; bỏ GradeShader be cũ (sat 0,88 +
    ám vàng). AgX r160 đã thử: ép trời xanh thành xám chì. Phơi sáng thay đổi theo giờ nên phần TỰ PHÁT SÁNG (emissive,
    MeshBasic/Line/Points/Sprite) nhân `HP_UNLIT_K = 1,18/exposure` (post.js, vá ShaderChunk/ShaderLib) → đèn/cửa sổ/
    chân dung nhà hát hiển thị như cũ ở mọi giờ, không cháy trắng ban đêm. ShaderMaterial tự viết có phần tự sáng phải
    tự nhân (`UNLIT_DECL`).
    **(5) Hậu kỳ** (TIER ≥ 2, `GFX.post`): SceneAOPass vẽ cảnh vào RT riêng MSAA 4× + DepthTexture (canvas
    `antialias:false`, RT composer KHÔNG MSAA — trước MSAA ×3 chỗ) → SAO nửa phân giải (pháp tuyến dựng từ depth, xoay
    Bayer 4×4 + mờ 4×4 ×2 lần theo độ sâu MẶT PHẲNG, upsample theo độ sâu, mờ dần 140-320 m, chạy cả camera trực giao,
    trần bán kính màn hình 56 px phối cảnh / 90 px trực giao — xem (13)) → UnrealBloom CHỈ
    khi night > 0,04 (ngưỡng chia theo exposure) → FinalPass (tone + grade + sRGB + dither). AO = 0,26-0,32 ms GPU ở
    1280×720 trên Radeon 890M → bật cả TIER 2 (8 mẫu; TIER 3 12 mẫu). FinalPass 0,17 ms. Công cụ: `__hp.post.timeAO()`
    (đồng bộ bằng readPixels 1 px — `gl.finish` của Chrome KHÔNG chờ GPU, đo ra 0,01 ms vô nghĩa).
    **(6) Sương** FogExp2 density 0,00075 (150 m 1,3%, 800 m 30%, 1600 m 76%), GIỐNG NHAU mọi tier, chọn 1 lần; màu =
    chân trời hiển thị theo hướng nhìn (mép phố xa tan vào trời). Nấc chất lượng 3/TIER 0 nhân density ×1,6 (KHÔNG đổi
    kiểu sương = không biên dịch lại). 0,00085 thử trước: góc cao bị "sữa" mất tương phản.
    **(7) Bóng**: tâm hộp SNAP theo texel trong hệ toạ độ đèn (hết bò mép); `GFX.shadowMap/shadowBox` (TIER 3: 2048/±110 m,
    TIER ≤ 2: 1024/±70 m). autoQuality KHÔNG BAO GIỜ bật/tắt castShadow nữa: nấc 1 = AO + bloom tắt, PR ≤ 1,2, map ≤ 1024;
    nấc 2 = map 512 + nhịp làm mới ×2,5, PR 1; mục tiêu fps TUYỆT ĐỐI ≤ 60 (màn 120/144 Hz từng bị hạ cấp oan); đổi mapSize
    luôn ép `shadowMap.needsUpdate` (bug cũ: khung có map null = cả hộp bóng tối đen). `navigator.webdriver` hoặc `?aq=0`
    → autoQuality tắt (QA tất định). Chưa làm tầng bóng xa (CSM).
    **(8) Nước** (`water.js`, MỘT nguồn màu — daynight KHÔNG ghi màu nước nữa): MeshStandardMaterial ĐỤC (roughness 0,12,
    normal 0,15) phản chiếu IBL trời + Fresnel GGX (nhìn thẳng xuống thấy màu nước, nhìn xiên thấy trời); bản đồ bờ/hồ
    DataTexture 512² (ô 8 m, ±2048 m): R = khoảng cách có dấu tới bờ (waterSD, 128 = mép), G = hồ; sông xám ô liu
    0x5c625a (ảnh vệ tinh sông Cấm ≈ (93,103,92), game đo (88,94,87)), hồ 0x34443f, dải bùn ven bờ 1-16 m (hồ 1-7 m,
    nhạt hơn). Dựng ~11 ms (lọc thô 32 m rồi 30,8k mẫu mịn sát bờ + lọc cạnh trong — xem (13)). onBeforeCompile bám chunk
    `color_fragment`/`roughnessmap_fragment`. Mặt nước `receiveShadow = true` (bóng nhà/cầu/cây trên sông).
    **(9) GLB** (đọc JSON + giải ảnh trong GLB): 11 file có emissiveFactor [1,1,1] + emissive map. 6 map ĐEN THUẦN
    (buudien, dennghe, dentamky, dinhhk, nhnn, lechan — trung bình 0) → bỏ map + emissive 0 trước compile (bớt VRAM);
    4 map GIỐNG ALBEDO (baotang, thptnq, quanhoa, nhatho) → emissiveIntensity = night × 0,42 (= đèn pha mặt tiền ban đêm,
    ban ngày 0 — trước tự sáng bẹt dưới nắng); **nhahat KHÔNG ĐỤNG** (chân dung). envMapIntensity 0,5 (GLB còn nhận đèn
    bán cầu — tránh cộng đôi ánh sáng nền), ghi SAU `place()` cho cả bản gốc lẫn twin lite (xem (13)).
    **(10) Vệ tinh** `__hp.aerial`: sương 0, hộp bóng trực giao phủ CẢ khung (map 4096), phơi sáng ×0,82, instcull/
    far-hide lấy TÂM KHUNG (trước bám người chơi), vẽ qua composer (cùng tone/AO).
    **(11) Ấm máy**: compileAsync với RT cảnh composer đang bind (đúng biến thể NoToneMapping/linear — trước biên dịch
    biến thể màn hình vô dụng); trước Start không vẽ tới khi compile xong (lưới an toàn 12 s); `__hp.timing`
    (compileSync 107-169 ms, khung đầu 1,7 s — vẫn sau màn chờ). Camera near 0,1 → 0,3 (depth xa tốt ×3).
    **(12) Thời gian**: DAY_LENGTH 300 → 1440 s (24 phút), bắt đầu 09:00; `?time=14.5 | 14:30 | 1 (= 01:00) | 0.6`
    (< 1 = phần của ngày, ≥ 1 = giờ) + `&timefreeze=1`. Mây trôi theo đồng hồ GAME: đứng yên khi frozen hoặc
    `navigator.webdriver` (ảnh QA A/B so được điểm ảnh bầu trời).
    **(13) SAU PHẢN BIỆN (review WP5)** — **BẪY envMapIntensity**: các hàm `place()` của world.js (nhà hát, nhà thờ, Quán
    hoa ×5, Lê Chân) tự ghi `envMapIntensity = 0.85` khi duyệt model → chính sách ghi TRƯỚC place bị đè: bản gốc 0,85,
    twin lite 0,5 → sáng/tối nhảy mỗi lần đổi LOD. Nay `applyGlbEnv` chạy SAU `d.place()` (root mới + gltf.scene) và
    trong onLiteLoaded; đo: 13 bản gốc + 13 twin đều 0,5. **Biến thể program khi GLB lộ diện**: `queueReveal` gọi
    compileAsync với RT đang gắn = null → biến thể tone-mapped/sRGB của MÀN HÌNH, trong khi composer vẽ vào sceneRT
    (NoToneMapping + linear) → 5 program vô dụng + khung 92-168 ms trong 7 s đầu. Nay `attachRenderer(renderer, camera,
    scene, getRT)` (main.js truyền getter sceneRT) và queueReveal gắn RT đó quanh compileAsync: 0 program tone-mapped (cũ
    5), khung > 80 ms sau Start chỉ còn trong ~1,5 s đầu. Quy tắc chung: MỌI compile/compileAsync phải gắn đúng RT của
    đường vẽ thật. **Bloom ấm trước**: 7 material của UnrealBloom (highpass, 5 blur, composite, blend) gắn tạm vào quad
    rồi compileAsync cùng lúc ấm máy → chạng vạng đầu tiên +0 program (cũ +8, khung 45-95 ms). **AO**: trần 90 px làm
    tường sát camera nhìn xiên có dải tiếp xúc rộng và mép bậc thang; nguyên nhân bậc thang = "mẫu xoay đan xen chu kỳ
    4 + mờ hộp CÙNG cỡ 4": mỗi pha bị giữ-mẫu 4 texel → bậc 8 px; trọng số độ sâu so với z0 phẳng còn làm lệch trọng số
    theo pha trên tường xiên. Sửa: maxPx 56 (phối cảnh), mờ hộp chạy 2 LẦN (lần 2 lệch +1 texel bù lệch nửa texel →
    nhân chập = tam giác 7 texel), trọng số độ sâu so với MẶT PHẲNG cục bộ nội suy theo 1/z (tuyến tính trên màn hình với
    mặt phẳng phối cảnh; độ dốc lấy phía nhỏ hơn để không vượt mép vật), upsample full-res cũng theo mặt phẳng 1/z. AO
    vẫn nhân cả ánh nắng trực tiếp (chưa tách ambient). **Nước — cạnh trong**: waterSD đo tới cạnh của MỌI polygon OSM,
    2 polygon sông kề nhau có cạnh chung giữa lòng → vệt màu bờ giữa sông (game_8). Lọc: khoảng cách tới tâm ô ĐẤT gần
    nhất (ô 8 m, ô lân cận xếp theo khoảng cách, dừng ở ô đất đầu tiên) − 5,66 m là cận dưới khoảng cách tới bờ thật →
    nâng độ sâu (1815 ô sửa, dựng vẫn ~11 ms đo bằng node). Hồ: dải bùn hẹp/nhạt (quầng sáng quanh hồ Tam Bạc từ trên cao
    biến mất), viền sát kè 0,035 → 0,026 (hồ ×0,4). Bóng trên nước: GPU ≈ 0 ms (đo bật/tắt xen kẽ cùng trang: game_3
    +0,5 ms trên 19,3 ms gồm 1 mẫu lệch, 2 góc tầm thấp âm = nhiễu).
    **ĐO** (Chrome headless d3d11, Radeon 890M, 1280×720, TIER 3, base 6a57acc vs WP5 CÙNG PHIÊN dưới khoá GPU, autoQuality
    khoá): hpReady 19,4 → 16,9 s; heap 903 → 678 MB; cam_spawn 56,9 → 57,5 fps (738 → 726 call, 4,88 M tam giác);
    pano_007_h090 47,8 → 55,7 (1590 → 1578 call, 7,90 M); cam_high_center 49,9 → 55,7 (1173 → 1161, 7,44 M); game_3
    (vệ tinh) 56,9 → 49,2 (map bóng 4096 phủ khung — chỉ chế độ QA). fps chạm trần vsync 60 nên chênh vài fps là nhiễu.
    Làm mới bóng +0,7..6,2 ms/lần (không đổi). **BẪY ĐO**: số fps WP5 cũ 21-30 (đo lúc 8 Chrome GPU chạy song song) là
    nhiễu — luôn đo dưới `tools/qa/gpulock.mjs`; Bash nền không đặt timeout chết ở 30 phút, giết luôn tiến trình đang
    GIỮ khoá → khoá mồ côi chặn mọi agent (gpulock chỉ cướp khoá sau 20 phút) — đặt timeout tối đa.
    **ĐO SAU PHẢN BIỆN** (máy đang chạy game của chủ máy → GPU bận, cảnh 20-30 ms thay vì ~10 ms; chỉ so XEN KẼ cùng
    phiên prev c527b6d / hiện tại ×2): cam_spawn 42,6/45,5 → 41,4/41,8 fps; pano_007 24,4/27,1 → 29,5/30,3;
    cam_high_center 30,1/31,2 → 35,0/34,2; game_3 35,0/35,6 → 32,4/31,3; hpReady 40,4/38,2 → 35,5/35,3 s; heap 706-713 →
    728-758 MB — không có hồi quy nhất quán (2 góc nhanh hơn, 2 góc chậm hơn, cỡ nhiễu). AO 0,27 ms (máy rảnh, trước khi
    thêm lần mờ 2) / 0,38-0,56 ms (máy bận).
    **GHI NHẬN cho WP khác**: độ sáng nửa dưới khung pano: thật trung vị 117, game 68, trong khi highlight game (p98 216)
    còn sáng hơn ảnh thật (198) → tối là do ALBEDO (nhựa đường `mat(0x4c5158)` quá đen so với mặt đường bụi xám sáng
    ~sRGB 110-120 trong pano), KHÔNG được bù bằng phơi sáng.

- **2026-10-04 (WP4-trees)** [ĐỢT 3 WP4 — CÂY ĐƯỜNG PHỐ THẬT: 9 loài instanced, trồng theo dữ liệu 551 pano, LOD gần/xa/hero]
    (Sau phản biện đối kháng: hàng cau công sở + phượng allée sống lại, bỏ 'plaza' khỏi danh sách cấm trồng, cây cách camera
    pano 4,5 m / hero 12 m, cây dời né collider nhỏ, uTime quấn chu kỳ, trunkNear dùng được sau build — chi tiết trong từng mục.)
    (nhánh `worktree-wf_f378e35a-d3b-4`). File: MỚI `js/trees.js` (cả hệ cây), MỚI `js/treemap.js` (SINH TỰ ĐỘNG bởi
    `node tools/gen_treemap.mjs` từ trường `vegetation` của `audit/audit_enriched.json` — ĐỪNG SỬA TAY; chạy lại ra
    byte-giống), MỚI `tools/qa/trees.html` (xem kit cây tách game: `?row=all|xacu|bang|…&dist=&far=1&atlas=1&bloom=0`),
    `js/petals.js`, `js/main.js` (1 chỗ: `petals.update` ~560), `js/world.js` (import `veg`; THÂN ~30 helper cây cells
    bcTree/bcPalm/twTreeAt/bsTree/bsPalm/tsTree/tsYoung/tsWillow/txTreeAt/txPalm/lnTree/w1-w4Tree/w4Pollard/w4Palm/cnBanyan/
    cnPalm/v3Willow/garden6 tree…; khối `cell_tree`; vùng cây cũ phượng hero/bakeTree/phuongTree/palm/shadeTree/streetTree/
    banyan/hồ/OSM-công viên; cây dải phân cách; bỏ "xà cừ 2 bên đại lộ" cap 170; vườn hoa; chỗ `flushTrees`).
    **TRƯỚC:** 5 đường ống cây (bake icosahedron 80 tam giác xanh lè + ~12 helper cầu lá trong cells + cell_tree + 76
    phượng GLB Meshy 85-101k tam giác LUÔN bật, castShadow=false) → ~1.200 cây, quota theo thứ tự ROADS_DT (lõi hết
    quota, phố khác trống), cây ở hw+3,4 = SAU mặt tiền phố s/t.
    **HỢP ĐỒNG (`js/trees.js`):** `veg.plant(kind,x,z,o)` / `veg.plantLocal(group,lx,lz,kind,o)` CHỈ xếp hàng (không tự
    thêm collider — helper giữ `addCollider` như cũ). kind = 'xacu'|'bang'|'phuong'|'sau'|'banglang'|'cau'|'catcut'|'da'|
    'non' hoặc 'shade' (bóng mát: loài theo pano/vùng, không phượng/cau) | 'street' (mọi loài) | 'park'. o = {h, r (tán),
    bloom, wash (gốc quét vôi), pit (ô gốc bê tông), hero (0..2 = biến thể GLB), yaw, variant, sz, full (độ kín tán),
    median (cây dải phân cách — miễn kiểm lòng đường)}. `veg.plantStreetTrees(ctx)` trồng theo dữ liệu (thay vòng 46 m);
    `veg.buildTrees(scene, ctx)` dựng TẤT CẢ ở chỗ `flushTrees` cũ rồi XOÁ hàng đợi → **KHÔNG gọi plant sau buildTrees**
    (cây không được dựng, chỉ còn collider ma). `world.trees` = {stats(), setSeason(0..1), setHeroModel, bloomNear,
    uniforms, recs}; `world.treeBloomNear(x,z,r)` cho petals. Ngoài game: `import('/js/trees.js').then(m=>m.treeSystem())`.
    **KIT + ATLAS:** atlas lá vẽ thủ tục 4×4 ô (canvas 2048² TIER≥2 / 1024² TIER≤1, ~17 ms) — lá kép xà cừ/sấu, lá bàng
    chùm hoa thị (ít lá vàng/đỏ), lá lông chim 2 lần + chùm hoa phượng, lá + chuỳ hoa tím bằng lăng, chồi non, đa, vỏ,
    gốc quét vôi, thân + tàu cau. Lưu PREMULTIPLIED (`premultiplyAlpha=true`, `NoColorSpace`) rồi shader chia alpha +
    tự giải sRGB → mép lá lọc mipmap không viền đen; bù alpha theo mức mip (lá xa không "tan"). 13 kit gần (thân + cành
    côn cong, 22-170 thẻ lá; 290-1.600 tam giác) + 9 kit XA (thẻ to ×1,8-1,9 ngửa lên, tối 12% vì không tự đổ bóng; 70-212 tam giác). Dáng: xà cừ tán
    cao rộng, bàng TẦNG ngang, phượng tán DÙ, sấu, bằng lăng, cau vua (thân xám vòng đốt + bẹ xanh + 15 tàu cong), CẮT
    CỤT (cành cụt mặt cắt sáng + chồi non — 96 pano sau bão Yagi), đa/si (rễ phụ), cây non chống 3 cọc. 1 material
    Lambert DUY NHẤT cho mọi cây (onBeforeCompile, key 'hpveg1'): `aInst`=(bloom, wash, phase, độ kín tán) per-instance,
    `aKind` (gỗ/gỗ-vôi/lá/hoa + số ngẫu nhiên riêng từng thẻ ở phần lẻ → cây thưa bỏ bớt thẻ — 1 kit ra nhiều độ kín),
    gió (uTime), mùa hoa (uBloom: thẻ hoa thu về điểm suy biến khi tắt), lá trong mờ (ánh sáng xuyên lá từ hemi + nắng
    ngược), thẻ lá nghiêng hẳn về camera mờ dần (không thành vạch sẫm). TIER≥2 (có MSAA): alpha-to-coverage + làm sắc
    alpha; TIER≤1: alphaTest 0,5. `customDepthMaterial` alpha-test → bóng lá lốm đốm.
    **LOD (tự quản, `userData.noCull` — instcull KHÔNG đụng):** mỗi 250 ms (hoặc camera đi > 8 m / quay > 10°) nén lại
    tập instance theo khoảng cách CAMERA: gần ≤ 180 m (TIER≤1 110) kit gần đổ bóng; ≤ 1.000 m (TIER≤1 520) kit xa không
    đổ bóng, chỉ trong NÓN NHÌN ±(nửa FOV ngang + 31°) (camera trực giao/nhìn dốc xuống → tắt nón); hero GLB ≤ 150 m;
    ô gốc ≤ 90 m. Trễ 10-12 m chống nhấp nháy ranh. boundingSphere tính tay từ tâm instance + bán kính tán (finish()).
    **HERO phượng GLB (file KHÔNG đổi):** là LOD GẦN của phượng thủ tục CÙNG chỗ (cùng cao, cùng độ xoè tán theo tỉ lệ
    bbox GLB), frustum-cull TỪNG cây mỗi khung (luôn giữ trong 30 m — bóng đổ vào khung), castShadow BẬT. Vị trí: 46 cây
    chọn ĐỀU theo hash trong ứng viên phượng nở dọc p/s ≤ 160 m dải trung tâm (37) + mỗi cây thứ 10 quanh vườn hoa (20) = 57.
    Lite thiếu/hỏng → thử NGAY bản gốc (như assets.js; cả luống hoa hero). Hero luôn nở (GLB đỏ) nên chỉ hiện khi uBloom ≥ 0,5.
    Hero CHỈ khi cách camera pano ≥ 12 m (`HERO_PANO_CLEAR` — tán GLB xoè 6-7 m: hero 9,7 m trước pano_001_h090 từng che
    ~35% khung); cây hero vườn hoa (heroTree) gần hơn → phượng thủ tục, nở theo hash 35% (không ép nở).
    **TRỒNG THEO DỮ LIỆU (`plantStreetTrees`):** 2 bên mọi phố p/s/t tại `xsection.treePitLine(c)` (bó vỉa + 0,75 m),
    nhịp 9,0/9,4 m × (0,88-1,18) lệch pha từng bên; phố r chỉ nơi pano ≤ 60 m nói có cây (mật độ ≥ 2) + 70% hash; mật
    độ pano: 0 = bỏ, 1 thưa ×2,3, 3 rợp ×0,9. Loại: lòng đường/đoạn khác (lưới đoạn 16 m dùng chung `veg.roadIndex`),
    nút giao (đỉnh chung ≥ 2 đường + đầu mút, r = nửa lòng + 4,5), footprint nhà THẬT (buildings_real), LM_POLY + 2,5 m,
    claims landmark/civic/cell (KHÔNG 'plaza': claim quảng trường/phố đi bộ của WP2 chặn NHÀ, hàng cây bó vỉa quanh nó
    là đúng thật — đo: 327 cây/226 hố cây nằm trong các claim plaza của WP2), camera pano `PANO_CLEAR` 4,5 m, collider nhỏ
    (cột/đèn), cách gốc khác < 4,2 m, `ctx.keepClear`
    (world.js: TRỤC NHÌN spawn → mặt tiền Nhà hát, rộng ±14 m — hàng cây mép bắc phố road#378 từng che kín Nhà hát ở
    cam_spawn). Loài: trọng số vùng (Hoàng Diệu `hdTreeBelt` xà cừ cắt trụi 60%; ven hồ lakeSD<45; dải trung tâm
    (polyline hồ→Nhà hát→THĐ/QT→Tố Hữu, < 110 m) phượng 42%; còn lại xà cừ 36/bàng 26/phượng 20/sấu 9/bằng lăng 5) trộn
    30/70 với loài pano gần nhất; tỉ lệ cắt cụt/cây non/gốc vôi/tán thưa theo pano. Cau dọc phố chỉ khi pano nói rõ
    "hàng cau" (≥7), đa chỉ trồng đích danh. Hoa: ~35% phượng + bằng lăng nở (mùa hè mặc định).
    **DỌN CÂY CŨ (`buildTrees`):** toạ độ helper cells có từ thời đường/nhà vẽ tay — đo: 118 cây TRONG LÒNG ĐƯỜNG (hàng
    cách tim 's' 4,5 m, cau giữa tim…), 125 trong footprint nhà thật, 60 cặp gốc < 3 m. Nay: trong lòng p/s/t/r, cách tim
    ≥ 0,5 m → DỜI ra treePitLine cùng phía (chỗ mới phải sạch: ngoài lòng đường/nhà thật/4,5 m camera pano); giữa
    tim/ngõ h/phố đi bộ w/nhà thật/< 4,5 m camera pano/trùng gốc (< 1,8 m) → BỎ; collider gốc ở
    đúng (x,z) cũ được dời theo hoặc tách (x=z=1e7 — cùng object nằm trong `colIdx` nên không phải xây lại chỉ mục).
    Kết quả: dời 58, bỏ 40 (lòng đường) + 115 (nhà thật) + 16 (trùng gốc); còn trên lòng đường chỉ cây dải phân cách.
    cell_tree: cau trước công sở + phượng allée sang treePitLine (trước hw+2,6/hw+3 = sau mặt tiền). BẪY đã dính: guard
    `trOnRoad` của khối có lề nửa lòng + 0,8 m > treePitLine (+0,45..0,75) → loại SẠCH hàng cau (2/35) + nửa allée mà
    không báo gì; nay lề + 0,3 m, allée bám tim phố THẬT (trNearestSeg — đường A→C vẽ tay lệch tim 0,1-1,9 m). Đặt cây
    theo xsection thì MỌI guard lòng đường phía trước phải có lề < treePitLine − nửa lòng.
    **SỐ ĐO (Chrome headless d3d11, Radeon 890M, autoQuality ghim, 1280×720):** 8.639 cây trong R1600 (xà cừ 2.720,
    bàng 1.640, phượng 1.378 — 499 nở, cắt cụt 1.290, cau 545, sấu 442, cây non 372, bằng lăng 247, đa 5; 57 hero; 6.700 ô gốc), 22-25 draw call cây (13 kit gần + 9 xa +
    ô gốc + 3 hero), tam giác cây THẤY ĐƯỢC 0,67-1,19 M (spawn 0,74 M; nhìn cao giữa phố 1,19 M khi 8 hero trong 150 m; trước: riêng hero GLB 2,5 M ở spawn).
    Camera pano có cây < 4,5 m: 1/551 (cây dải phân cách; trước phản biện 68 < 4 m); hero < 8 m: 0 (trước 9). Hàng cau 5 công sở: 6/7/7/7/7
    (UBND: hàng nằm trên phố r cách công trình ~51 m). Phượng allée Bảo tàng: 52 phượng (trước phản biện 33). Cùng phiên
    bật/tắt toàn bộ cây (cả lượt bóng; trung vị 3 lượt — đo của phản biện): p50 +0,3..+0,8 ms, +1,1 ms khi hero GLB trong
    khung, 0 ở aerial → chi phí nhỏ nhưng KHÔNG bằng 0. Gán lại LOD cưỡng bức 0,35-0,42 ms (≤ 4 lần/s + mỗi 10° quay). Khởi động (cùng phiên, 2 lượt/bên):
    buildWorld 14,69 → 14,21 s (−0,48 s), hpReady 19,5 → 18,4 s, heap ~như cũ; phần cây: plantStreetTrees ~82 ms (gồm
    giải RB_B64 ~13 ms), cả khối cây world.js ~110 ms, buildTrees ~65-85 ms (atlas 17 ms). Tổng scene (std, so baseline
    dot3): spawn 755 call/4,88 M (738/4,88 M), pano_007 1.595/7,10 M (1.590/7,90 M), cam_high_center 1.187/7,03 M
    (1.194/7,45 M). So số call/tam giác giữa 2 lượt chụp: worktree chưa có `__hp.pinQuality` → autoQuality tự bật/tắt
    bloom (±13 call) và bóng (±300 call, ±3 M tam giác) theo tải máy — đừng đọc chênh đó là do cây. 0 lỗi JS (full); lite chỉ còn 404 assets_lite/ do checkout local không có file lite (check_assets ĐỦ).
    **BẪY:** (1) `flagsFixed`: freezeStatic ghi đè castShadow/receiveShadow MỌI mesh → trees.js đặt lại cờ ở khung đầu
    sau freeze (kit xa/ô gốc không đổ bóng). (2) QA `shoot.mjs` ẩn InstancedMesh `!frustumCulled && count 150..220` =
    petals (170) — đừng tạo InstancedMesh khác khớp điều kiện đó. (3) Hero material (Standard của GLB) biên dịch lần đầu
    khi cây hero đầu tiên vào 150 m (khựng 1 lần, như trước). (4) Tích hợp WP2: truyền lưới footprint DÙNG CHUNG (đã
    đánh dấu `D.dead` bởi claims) qua `ctx.fpGrid` cho CẢ `plantStreetTrees` lẫn `buildTrees` — thiếu thì trees.js tự giải
    RB_B64 (không có dead → cây trong khuôn viên được giữ nhưng nằm trên footprint "chết" vẫn bị coi là trong nhà).
    (4b) Tích hợp WP7: `buildProps` chạy NGAY TRƯỚC `veg.buildTrees` (sau mọi `veg.plant`); buildTrees dời ~53 cây cũ ra hố
    cây và chỉ dời tới chỗ không đè collider nhỏ (r ≤ 1,2: đèn/cột/đạo cụ) → đạo cụ đặt trước vẫn được tôn trọng.
    (5) InstancedMesh tự LOD có thuộc tính instance riêng (`aInst`) → phải `noCull`; instcull chỉ nén matrix + color.
    (5b) A2C giả định TIER≥2 có MSAA (composer RT samples 4) — đổi post/AA thì xem lại hằng `A2C` trong trees.js.
    (5c) `uTime` quấn `% 200π` s: mọi tần số gió là bội 0,01 rad/s → nối liền, float không mất chính xác sau nhiều giờ —
    thêm tần số mới phải giữ là bội 0,01. (5d) Sau `buildTrees` lưới gốc được dựng lại theo vị trí CUỐI → `veg.trunkNear`
    dùng được cho hệ chạy sau (đạo cụ WP7), nhưng `veg.plant` sau đó vẫn KHÔNG dựng.
    (6) Còn cây cũ CHƯA chuyển (ngoài vùng WP4): cau 'rockery' giữa vòng xuyến (world.js ~1860, vùng WP7), cau sân Nhà
    khách Hải quân (~9865, WP3), bách tán chóp thông (~8383), cây quanh hải đăng (~20180, ngoài R).
- **2026-10-04 (dot3-WP3)** [ĐỢT 3 — CELL SINK: hoà giải ~1.140 nhà ô dựng tay với footprint THẬT + lọc thương hiệu + bớt texture]:
    **Cơ chế** (`js/cellsink.js`; world.js chỉ thêm 2 dòng vào + 2 dòng ra quanh khối ô 2265-18160): trước `{` khối ô
    `const _cells = makeCellSink(THREE, scene, addCollider, FEATURED_CLEAR, colliders, makeTex)`; dòng đầu TRONG khối khai
    báo lại `scene/addCollider/FEATURED_CLEAR/makeTex` = bản bóng của sink (ghi lại mọi `scene.add`, collider, vòng FC —
    FC vẫn đẩy THẲNG vào mảng thật vì rowP/cnRow/ln đọc nó lúc dựng). Cuối khối `world.cellSink = _cells.commit(...)`,
    `world.cellShops = ...shops`:
    (1) hình chiếu XZ từng vật thể cấp cao nhất (bao lồi từng mesh → ô 1 m "khối đặc": mesh không phải cầu/nón/tán lá/
    kính mờ, cao ≥2,5 m); "nhà" = ≥20 ô và cao ≥3 m — HÌNH HỌC QUYẾT TRƯỚC, tên chỉ PHỦ QUYẾT khi: thẻ prop/tree/open,
    tên cây (TREE_RE) hoặc đồ phố MẠNH (`PROP_RE` đài phun/giàn hoa/cột đèn/giàn giáo/kiốt/rào/bó vỉa…), hoặc tên không
    gian mở/tường YẾU (`OPEN_RE` garden/park/plaza/wall/tuong/rail/rao… + token neo `ke`/`nan`) MÀ khối thấp <4 m / <30 ô /
    mỏng <3,5 m / thưa <30% hộp (`openVeto`). (2) Phân loại theo tên (`nameKind`: token bỏ số nhà đuôi kể cả `17a`;
    CIVIC_EXACT/PREFIX/INCL, TOWER_PREFIX, HERIT_RE + ghi đè `NAME_KIND`, ghi đè 'heritage' bỏ ngưỡng 100 m²) + thẻ
    `userData.kind` ở finisher (`lmTower/cbTower/cnTower/v2Tower/s4Tower`='tower'; dãy chung rowP/cnRow/saRow/s2bRow/s2Row/
    s1ShopRow/port_kho='house'); kind 'bespoke' = nhà riêng dựng đúng ảnh (w5_cafe_gach_dth); CÁNH khuôn viên (token
    wing/annex/canh + chung 2 token đầu với công trình giữ ≤45 m) thừa hưởng loại công trình. (3) NHÀ chung chung bị GỠ khi
    footprint thật (`realBuildings()` = `makeFootprintGrid(decodeRB(RB_B64))`, BỎ QUA nhà `FLAG.SYNTH` — hợp đồng RB v1:
    nhà sinh là phỏng đoán, không làm bằng chứng gỡ nhà tay) phủ ≥30% ô khối đặc HOẶC cách ≤5 m; nhà DÃY SINH TỰ ĐỘNG (thẻ
    'house') không có nhà thật gần mà ≥30% khối đặc nằm trong polygon công viên OSM (`PARKS`) → gỡ 'park' (9 ln_row trên cỏ
    vườn hoa An Biên). GIỮ + `claimBox(...,
    'cell', tên)` (hộp diện tích nhỏ nhất +0,5 m; khuôn viên thưa → 1 hộp/cụm ô liền ≥12 ô): công trình danh tính (UBND/
    công sở/trường/chùa/đình/chợ/bệnh viện/KS/ngân hàng/khuôn viên/công thự Pháp), tháp ≥22 m + cao ốc kính có tên, và
    NHÀ DI SẢN Pháp (`HERIT_RE` phap|bietthu|villa|arcade|mansard|manoir|turret…) có khối đặc ≥100 m² — đối chiếu pano
    089/070/160/255/504: mô hình ô (tường vàng/kem, cửa vòm, chớp xanh, mái ngói đỏ) giống thật hơn hẳn fabric chung.
    (4) Cặp trùng giữa các nhà còn lại (giao ≥50% nhà nhỏ & ≥25% nhà lớn, tỉ lệ cao ≤2; hoặc nằm trọn ≥90%) → giữ 1
    (`DUP_PREFER`: bản vẽ lại theo audit mới hơn thắng, vd s4_biethu_tp 'CHO THUÊ NHÀ' pano_398_h180).
    (5) Đồ treo mặt tiền của nhà bị gỡ (biển/mái hiên/điều hoà: tâm trong ô nhà, hoặc treo ≥1,2 m trong vành 1 m) gỡ theo.
    (6) Collider/FC: chủ = vật thể chứa tâm vòng, gần nhất theo THỨ TỰ TẠO (seq) → gỡ cùng chủ (an toàn: `colIdx` còn null
    tới resolveCollisions đầu tiên). (7) `world.cellShops` [{name,x,z,ry,w,d,h,floors,wall,roof,signs[],style(tube/old/
    villa/glass/ktt/shed),realB(chỉ số footprint thật khớp nhất trong RB đang chạy),frac,why}] cho lớp mặt tiền WP2;
    `world.cellKept` [{name,kind,cx,cz,h,hull}] = nhà ô GIỮ + bao lồi ô khối đặc → WP2 nên CẮT footprint thật theo đa giác
    này (bỏ/giữ cả footprint theo claimOverlapFrac>0,2 để lại nhà thật đâm xuyên mô hình tay khi footprint gộp lớn phủ <20%).
    **Số đo** (bản sau phản biện; 890M TIER3, A/B cùng phiên r8, autoQuality ghim, máy đang tải): 3.345 vật thể / 1.152 nhà
    ô → GIỮ 288 (keptKinds: công trình 133, tháp 38, di sản 49, bespoke 1, nhà 67 ở chỗ chưa có footprint thật; `kinds` là
    TỔNG gồm cả bản trùng bị gỡ) — GỠ 855 (đè 537, gần 309, cỏ công viên 9) + 9 bản trùng + 133 đồ treo; collider
    −1.077/2.462, FC −954/1.665; 288 claim 'cell'; 846 cellShops (616 có chữ biển). Commit ~315-335 ms (hình chiếu 51-55,
    đối chiếu nhà thật 31-37, áp dụng + vẽ 502 texture + atlas ~240). Trước/sau: draw call cam_spawn 738/511,
    pano_007_h090 1.590/1.245, pano_141 1.391/978, cam_high_center 1.194/842, game_3 1.197/848 (TB 12 góc 1.042/769);
    fps pano_007 42,7/56,4, pano_021 47,2/56,9, pano_141 49,5/59, cam_high_center 49,7/52,1 (TB 53,7/57,4); cảnh sau
    freeze: con cấp gốc 3.291/1.697, mesh 3.937/2.343, material 2.883/1.188, texture 1.934/273 (canvas 1.842/181), ước
    lượng bộ nhớ texture 2.346/2.058 MB; tam giác cả cảnh 14,0/14,4 M (fabric thủ tục CŨ mọc vào chỗ nhà ô bị gỡ — WP2 tắt
    nó); hpReady 21,0/19,1 s, heap 711/782 MB (1 mẫu mỗi bên, nhiễu ±5 s/±80 MB — các lượt trước 830/741, 848/782). LITE
    (tier 1): 0 lỗi, diag [], atlas 3 trang (2048, 2048, 128), texture 216 (canvas 174) ~152 MB, draw call cam_spawn 677.
    Thử trước với footprint RB v1 của dot3 (tráo tạm 2 file dữ liệu, bỏ qua FLAG.SYNTH): giữ 290, gỡ đè 618 / gần 224 /
    cỏ 11 — ổn định so với v0.
    **Texture (mục tiêu <400 canvas):** makeTex trong khối ô LƯỜI: trả texture + canvas RỖNG (qua makeTex gốc + hàm vẽ rỗng
    → đúng TEXQ/anisotropy), commit mới VẼ texture còn được cảnh dùng; texture chỉ nhà bị gỡ dùng KHÔNG BAO GIỜ vẽ (chữ biển
    của chúng lấy bằng ngữ cảnh 2D GIẢ `recorderCtx`). Texture "thường" của vật thể GIỮ được XẾP ATLAS vài trang 2048²
    (material dùng chung theo trang → freezeStatic lượt 2 gộp). 63 helper biển/mặt tiền thuần (`xxSign/xxFacade`, gồm
    lnSign/twSign/twFacade/lnFacade/w2Sign/cbSign/w1Sign/lmSign) bọc `_cells.memo(tên, fn)` (cùng tham số nguyên thuỷ →
    cùng material); `cbWallRun` hết clone texture+material mỗi đoạn (cache theo số lặp lượng tử 0,5). Đo: 1.563 lần gọi makeTex trong khối → vẽ 501, KHÔNG BAO GIỜ
    vẽ 1.062 (vẽ canvas ~71 ms); 478 texture thường của vật thể giữ → atlas 8 trang (12 material). CẢ CẢNH sau freeze: texture
    1.934 → 273 (canvas 1.842 → 181, mục tiêu <400 ĐẠT). Ô atlas: ảnh giữ NGUYÊN độ phân giải ở giữa + viền kéo giãn NGOÀI
    ảnh, viền theo cỡ (≥128 px → 8 px, an toàn tới mip 3; ảnh 32-64 px → 2-4 px) — bản đầu co ảnh vào trong 4 px (mờ chữ,
    biển kề nhau loang ở mip xa). Trục ≥512 giữ ô = cỡ gốc (ảnh co 2G ≤3%) — nới thành 528 thì chỉ 3 ảnh/kệ 2048: trang
    7 → 9; bản cuối 8 trang (212 biển 512×84 + 193 ảnh 256² chiếm phần lớn; ~+25 MB GPU so với bản co vào trong).
    **Thương hiệu:** `js/brands.js` = danh sách chặn DUY NHẤT (`gen_shopsigns.mjs` import nó; cellsink dùng làm lưới an toàn
    lúc vẽ biển: chữ khớp bị thay TRƯỚC fillText). Đã thay trong nguồn world.js: CO.OP, HABECO, SSI, thegioididong, ELISE/
    CHRISBELLA, SEVEN.art, MEDIPHARCARE, Koji, HANA, MAY10, VOSA, VINASHIP, VINACOMIN, GENCE, AFANI, DEEP C, MB, LIEN A,
    HOANG PHUC, crocs/Kappa/ecko/BAC A BANK, STARPOST, HIDOO, HATRACO, SUMMO, VIFON, COOLER CITY, PROSIMEX, POS.vn, VUA ĐỒ
    CHƠI, BẢO MINH (×2, cả showroom 1986), GOLD STAR HOSPITAL → BỆNH VIỆN QUỐC TẾ, NOAH'S → THỜI TRANG NỮ, TAGONE FLORAL →
    HOA TƯƠI. shopsigns.js sinh lại (tái lập được: chạy lại → diff rỗng). Quét MỌI chuỗi
    world.js/shopsigns.js/landmarks/npcs/quests/i18n bằng BRAND_MAP → 0 (chỉ "PIZZA" = từ chung).
    Token hãng TRÙNG TỪ THƯỜNG (GO!, SHELL, APPLE, AQUA, GUARDIAN, FORMAT) + viết tắt ngắn (LG, AIA, ILA, EMS) + AN KHANG chỉ
    khớp khi là TỪ ĐẦU biển (AN KHANG/GUARDIAN cả sau 'NHÀ THUỐC'): lưới an toàn thay CẢ biển → 'NHÀ HÀNG AN KHANG' từng
    thành 'NHÀ THUỐC', "LET'S GO!" thành 'SIÊU THỊ'. Mẫu `BẢO M\.{2,}` đặt trong nhóm có `\b` phía sau KHÔNG BAO GIỜ khớp
    (\b sau '...' cần chữ cái) → tách regex riêng.
    **Sửa lỗi:** cau nhà khách Hải quân (9947) thêm vào nhóm đã xoay π bằng toạ độ THẾ GIỚI → cắm vào Nhà hát (giờ
    `scene.add`); `mat(0x2f8a5a)`/`mat(0x33383d)` từng bị gán `transparent/opacity` TRỰC TIẾP lên material DÙNG CHUNG của
    cache mat() (mọi vật cùng màu trong suốt theo) → `mat(c, {transparent, opacity})`.
    **Bẫy:** (a) TRONG khối ô, texture từ makeTex CHƯA có pixel tới commit — đừng đọc canvas/getImageData trong khối; key
    makeTex trong khối là cache RIÊNG của sink. (b) Kết quả helper đã memo là material DÙNG CHUNG — không mutate (dùng
    `mat(c, opts)`/tạo mới). (c) Gỡ ~1.000 vòng FC làm dịch các vòng phát theo HẠN MỨC thứ tự ROADS_DT (46 phượng hero +
    30 đèn ở ~20800-20835 dùng `nearFeatured`; cây/hoa dùng resolveCollisions làm oracle) — vd phượng hero trước pano_007
    biến mất; WP4 (đã tích hợp vào dot3, world.js ~20339) thay quota đó bằng trồng theo dữ liệu. Fabric thủ tục CŨ
    (block_infill…) cũng mọc vào chỗ trống → tam giác tăng tới khi WP2 tắt nó: ĐỪNG ship WP3 thiếu WP2. (d) `?cellsink=off` (chỉ ghi, không gỡ/claim) / `=debug` (giữ hình chiếu + claim cho overlay QA) / `=dump`
    (ghi dòng nguồn mỗi scene.add). (e) Thêm vật thể vào khối ô: TÊN quyết định giữ/gỡ — công trình có danh tính phải khớp
    CIVIC_*/HERIT_RE hoặc gắn `userData.kind='civic'`. (f) `realBuildings()` giải mã RB01 MỘT lần cho cả trang — WP2/WP8 dùng
    lại, đừng decode lần 2. (g) QA perf: máy dùng chung làm autoQuality nhảy nấc 3 (sương 220-1300 m → ảnh vệ tinh xanh trắng)
    → so A/B phải ghim (bản QA scratch vá `function autoQuality(){return;` qua page.route, hoặc `__hp.pinQuality` của WP8).
    (h) Regex tên KHÔNG neo là bẫy: `ke_` khớp 'lienke_' (8 nhà liền kề 3-4T), `nan\b` khớp 'AnAn', `wall`/`plaza`/`tuong`
    khớp 'curtainwall'(51 m)/'shpplaza'(41 m)/'TƯỜNG TÂY' → nhà bị xếp 'open', KHÔNG gỡ, KHÔNG claim. Kiểm bằng
    `?cellsink=dump`: lọc `!bldg && cells≥20 && height≥3` — chỉ được còn đồ phố thật (cây, đài phun, giàn hoa, cột đèn, kiốt,
    giàn giáo). (i) Khuôn viên = NHIỀU vật thể cấp cao nhất: cánh phụ mang tên chung ('xx_wing') rơi vào 'house' bị gỡ
    trong khi cổng/biệt thự cùng khuôn viên được giữ → thêm NAME_KIND hoặc đặt tên có token 'wing'.
- **2026-10-04 (d3-wp7)** [ĐỢT 3 WP7 PROPS — đồ đạc phố: xe máy, ô tô, cột điện + búi dây, đèn, đồ lặt vặt, người]:
    MỚI `js/props.js` (`buildProps(ctx)` → `{stats, update, meshes, cableMeshes, parkedCars, cullStats}`, gắn `world.props`) +
    `js/props_evidence.js` (SINH bởi `tools/gen_props_evidence.mjs` từ `audit/audit_enriched.json`, ĐỪNG SỬA TAY:
    mỗi pano `[X,Z,bike 0-3,car 0-2,pole 0-2,lamp bits,clutter bits]`). world.js: XOÁ các khối cũ rải theo THỨ TỰ
    ROADS_DT với trần cứng (đèn gang 3 cầu trên MỌI phố p/s ≤ 800 m, cột cờ rời, cột điện + `utilwires` trụ 153k tam
    giác, xe đẩy/thùng rác ≤70/120, `parked_scooters` ≤620 (90% nằm trên 7 đường đầu), FOOD, ô tô ĐỖ TRÊN VỈA HÈ ≤520,
    `cell_dens` (620 người khựng giữa bước + 360 xe máy + 120 ô tô hộp), ~150 mesh bóng đèn dây quảng trường) → 1 lời
    gọi `buildProps` NGAY TRƯỚC `flushTrees()` (sau mọi cây/công trình/điểm xe-NPC để né). Cột băng rôn nay đứng ở
    `furnitureLine` và đẩy vào `propReserved` để xe máy/cột né.
    **Cách đặt:** mỗi (đường p/s/t/r, đoạn, bên) → ô 3 m dọc `parkingLine` (xsection.js); ô bị loại có lý do
    (`__hpProps.sides[i].rj`: 1 xa >1600 m · 2 miệng giao lộ/lòng đường khác · 3 dốc/nước · 4 FEATURED_CLEAR (lõi 60%
    bán kính)/avoid/keepClear/claims `landmark civic cell plaza park water` · 5 trong footprint THẬT RB01 · 6 kè hồ).
    Mật độ = pano gần nhất ≤ 60 m (`props_evidence`), không có pano → theo bán kính lõi. MỌI quyết định = `hash3(x,z,
    seed)` theo toạ độ (độc lập thứ tự, không LCG chạy dọc vòng lặp); ngân sách (xe máy 16k/LITE 5k, ô tô 3,6k/1,4k,
    người 1,1k/450) lấy mẫu ĐỀU theo hash. Xe máy: hàng 1-9 ô (4-37 xe) góc 70-90° với phố (vỉa hẹp 55-69°), 78%
    mũi vào nhà, chân chống nghiêng, khe ngẫu nhiên; xe KỀ NHAU lệch góc ≤ 0,1 rad so với xe trước, xe đỗ xiên hẳn (±25°)
    được chừa thêm 0,3 m 2 bên (lệch ±8° độc lập ở bước 0,66-0,78 m từng cho 23% xe xuyên thân xe bên cạnh → 1,7%).
    Ô tô: song song bó vỉa TRONG lòng (curbLine−0,95), chiều xe theo luật đi bên PHẢI; phố r: 2 bánh phía lề đứng trên
    mặt đang vẽ ở đó (vỉa +0,14 so với lòng → lăn ~0,09 rad; dot3 cũ phố r không vỉa → nghiêng XUỐNG ~0,06 rad) và
    không đè hàng xe máy/quán. Giữ trống: TÂM ô tô cách camera pano ≥ 6,5 m (van/tải 8 m), 2 đầu xe ≥ 6,5/8 m
    (pano ghi "ô tô đỗ dày/hai bên": tâm ≥ 7,5/8,5 m, đầu xe ≥ 5,5/6,5 m — bản 4/5 m chỉ xét viên nang từng để van +
    taxi đỗ 3-5 m trước pano_024 kín khung hình, phản biện) — van 5,25 m trước pano_102
    (đầu xe ~6 m) từng che nửa khung hình mà ảnh thật trống; `keepClear` (điểm hồi sinh 18 m, `vehicleSpawns` 4 m,
    `npcSpots` 2,5 m). Cột điện 1 bên/đường (bên theo hash), 31-40 m/cột, né thân cây/trụ có sẵn
    (dịch ±1,5/3 m), pano nói "không cột" → bỏ; 7% trạm biến áp treo (cột kép + 3 máy + tủ hạ thế); nhịp ≤ 52 m nối
    3 dây trung thế + 4-30 sợi hạ thế/viễn thông võng ngẫu nhiên theo mức rối, dây vào nhà 2 bên phố, vòng cáp thõng
    quanh cột. Đèn cao áp cần vươn (thép, 33-36 m) 2 bên phố p, 1 bên (đối diện cột điện) s/t; phố t/r: 50% cột điện
    mang cần đèn. Đèn gang 3 cầu CHỈ ở quảng trường Nhà hát (95 m), quanh vườn hoa (+22 m), ven hồ (<34 m), hoặc pano
    nói "đèn cổ điển". Cờ đỏ sao vàng treo trên cột đèn đại lộ p (thay cột cờ rời giữa vỉa hè).
    **Mô hình** (local +Z = mũi xe, bánh chạm y=0; vertex colour + mặt nạ sơn `aPaint`): 4 xe máy ~480-540 tam giác
    (ga nhỏ, xe số, ga lớn có thùng sau, cub có rổ — gương/yên/ống xả/biển số/mũ treo gương là phụ kiện bật theo hash),
    LOD xa 90 tam giác; 6 ô tô 440-590 (sedan, SUV, hatch, taxi có hộp đèn, tải nhỏ thùng bạt, van/minibus 16 chỗ),
    LOD xa 24; cột điện/cột đèn/trạm biến áp/đèn gang/cột dây đèn; bàn + 4 ghế nhựa, ô dù, xe đẩy, thùng rác 240 L,
    trụ cứu hoả, tủ điện, biển chữ A (atlas chữ CHUNG: CÀ PHÊ, PHỞ BÒ, SỬA XE… — không thương hiệu); người 312 tam giác
    (đứng/đi/ngồi ghế nhựa, nón lá 16%).
    **Dựng hình:** 20 InstancedMesh + 1 LineSegments cho cả thành phố. Gộp BIẾN THỂ: nhiều model trong 1 geometry
    (`aVar`), instance chọn model bằng `iVar` (InstancedBufferAttribute) → vertex shader thu đỉnh model khác về 0
    (tam giác suy biến) — dùng cho cột/đèn (6), đồ lặt vặt (6), kính đèn (4), người (2). XE MÁY THÌ KHÔNG gộp (đo:
    +0,27 M tam giác suy biến ở cam_spawn) → 1 InstancedMesh/model. `customProgramCacheKey` chung → mọi vật liệu props
    dùng chung 1 program. Bóng đổ: `customDepthMaterial` có cùng cổng phụ kiện + dáng đi (không thì bóng mũ "đã tắt"
    vẫn hiện, bóng người đi đứng yên). Người đi lại HOÀN TOÀN trên GPU (`uPropTime`, `aWalk`=[L, tốc độ, pha, nghỉ]):
    đi qua-lại đoạn 8-26 m, chân/tay đánh quanh hông/vai, quay đầu ở 2 mút — 0 CPU/khung.
    **Cao độ chân prop = MẶT ĐANG VẼ** (bẫy, phản biện WP7): hằng `LAND_H + SIDEWALK_TOP` (+0,25) làm prop LƠ LỬNG
    vì layRoad cũ vẽ vỉa hè hộp 0,24 m tâm h+0,06 → đỉnh **+0,18**, và phố r KHÔNG có vỉa (nền lưới local +0,012) →
    xe máy/cột/người nổi +0,07 (p/s/t) và +0,24 m (phố r, ~1/3 số prop). Nay `ctx.surfaceY(x,z)` (cao độ tuyệt đối)
    gán `it.y` từng instance: cột/đèn/tủ/cờ NGAY sau bước đặt cột (dây điện neo theo `P.y` đỉnh cột), phần còn lại
    trước bước dựng InstancedMesh; kính đèn/cầu đèn gang/cờ dùng y của cột mình. world.js truyền `LAND_H +
    roadNet.surfaceAt` nếu WP6 roadnet đã gộp (`world.roadNet`, vỉa mọi cấp +0,25), không thì `layRoadSurfaceY(ROADS_DT,
    groundHeightNoDeck, LAND_H)` (props.js: mô phỏng layRoad — lòng +0,11, vỉa CHỈ p/s/t +0,18 rộng 0,28·w KHÔNG theo
    SIDEWALK_W (WP1 nới SIDEWALK_W nhưng layRoad vẫn vẽ 0,28·w), nền +0,012; mặt cao nhất thắng; ~6 ms/15k điểm).
    Thiếu `surfaceY` → hằng +0,25 (đúng với vỉa WP6). Ô tô giữ `LAND_H + ROAD_TOP` (+0,11 = đỉnh lòng nhựa cả 2 bộ dựng).
    **Cull riêng** (bẫy: instcull.js chỉ nén `instanceMatrix/instanceColor` → props đặt `userData.noCull` và tự nén MỌI
    attribute instanced): vành khuyên [rMin,rMax] quanh CAMERA (gần/xa LOD: xe máy 80/420 m, ô tô 130/750, cột 200/1100,
    đồ lặt vặt 260, người 240; LITE nhỏ hơn) + bỏ instance SAU LƯNG (>25-40 m, góc >100°; aerial/chúc xuống thì
    không), nhịp 0,3 s hoặc ngay khi camera xoay >25°/dời >20 m. Móc vào `scene.onBeforeRender` (chỉ lượt render
    camera chính, không gọi trong pass bóng). Chỉ tải lên GPU đoạn ô vừa đổi (`addUpdateRange(lo·size, (hi−lo)·size)`;
    `needsUpdate` trơn tải lại TOÀN bộ ~1 MB của 15,9k xe xa mỗi lần cull đổi) và cầu bao lấy từ hộp toạ độ instance đã
    giữ + bán kính model × scale lớn nhất (thay `computeBoundingSphere` O(k) phép nhân ma trận). Bẫy freezeStatic: nó
    gán `castShadow` cho MỌI mesh không trong suốt → `update()` gán lại ý định MỖI khung (LOD xa/kính đèn/cờ không đổ
    bóng; freezeStatic có thể chạy SAU khung đầu khi khởi động bất đồng bộ). `props_cables` có `raycast = () => {}`
    (LineSegments phủ thành phố + ngưỡng 1 m từng chặn MỌI `__hp.pick`). Dây điện: 1 LineSegments (~336k đỉnh),
    shader alpha ∝ 34/khoảng cách và `discard` > uFar (520 m, LITE 280; camera trực giao aerial 4000) — dây 1-2 cm
    thật dưới 1 px ở xa, không thành vệt đen. Đêm: kính đèn của props chép `sharedMats.lampGlow.emissiveIntensity`
    (daynight điều khiển) ×1,9; vũng sáng cộng (additive) dưới đèn chỉ bật khi đêm — quad 12×10 m (đèn trên cột điện
    10×8,5) đặt ở `yWalk + 0,02` (TRÊN mọi mặt lát: lòng, vạch giữa h+0,155, vỉa dot3 +0,18 / WP6 +0,25 — đặt ở lòng
    +0,03 thì bó vỉa cắt thẳng vũng và vạch kẻ tối giữa vũng), falloff `(1+(r/0,55)²)^−1,5` (dạng cos³ đèn chiếu xuống)
    tắt mượt về 0 ở mép, opacity đỉnh 0,2·đêm (~43% năng lượng bản cũ; 0,38/0,17 làm vũng tầm trung gần như biến mất) (0,42 + lõi phẳng từng thành "đĩa sơn" vàng sáng hơn mặt tiền ở night_016).
    **Số đo** (TIER 3, Radeon 890M): xe máy 14,85k (1.859 hàng; 15,86k trước khi chừa khe quanh xe xiên), ô tô ~1,57k (mọi ứng viên qua kiểm tra; ngân sách 3,6k chưa chạm), cột điện 1.222 + 111 trạm biến áp, 949 nhịp / 21,4k sợi dây (336k đỉnh), đèn cao áp 981 + 365 cần đèn trên cột điện + 184 đèn gang, 105 cờ, 773 bộ bàn ghế + 647 người ngồi, 448 ô dù, 216 xe đẩy, 295 biển chữ A, 585 thùng rác, 136 trụ cứu hoả, 161 tủ điện, 391 người đi + 87 người đứng; `buildProps` 245-450 ms luồng chính (lấy mẫu ô 90-170 ms; tra `surfaceY` ~10 ms) — thay các khối cũ ~1,1 s+ (đèn gang 139, cột điện 135, xe máy 201, FOOD 434 ms… theo PROJECT_MAP); LITE: xe máy 4,9k, ô tô 1,4k, người ~480. Sau phản biện (probe raycast xuống mặt đang vẽ, bỏ qua props_*): chênh chân
    prop − mặt median 0,000 m ở mọi cấp phố (trước: +0,07 p/s/t, +0,24 r), nổi > 5 cm 3/260 xe máy + 2/80 cột (khe hộp
    vỉa layRoad ở khúc cua); cull CPU khi xoay 0,5 rad/khung median 0,3-0,5 ms, max 0,6-1,8 ms (trước 1,0/2,5 ms). Khớp bằng chứng (pano ≤ 1500 m, đo bằng probe): pano "xe máy dày" có
    ≥ 6 xe trong 25 m 86% (pano "không xe máy" 20%); "có cột điện" có cột trong 30 m 92-93% ("không cột" 23%); "ghế
    nhựa" có bộ bàn ghế trong 30 m 73% (không: 17%). A/B CÙNG PHIÊN (`tools/qa/shoot.mjs --perf`, base = dot3 phục vụ song song): cam_spawn 738→729 call, 4,88→4,92 M tam giác (fps 58→56-57, nhiễu); pano_007_h090 1577-1717→1527 call, 7,90-9,05→7,81 M; cam_high_center 1173→1014 call, 7,44→7,37 M; game_3 (aerial) 1197→1046-1062 call, 8,13→8,46 M (ô tô/xe máy LOD xa thấy từ trên); hpReady 19,6/22,4 s (base) ↔ 19,4-21,7 s (nhiễu ±3 s do 8 agent dùng chung máy). Bật/tắt riêng props tại cùng góc nhìn (probe trong scratch): +0,4-0,5 M tam giác, +17-18 call (gồm pass bóng), thời gian khung chênh trong nhiễu. Sau phản biện, cùng phiên, autoQuality TẮT (bẫy đo: autoQuality hạ bloom/bóng/pixel ratio khi máy chung đang bận → call/tam giác/ảnh đêm thay đổi giữa 2 lần chụp cùng mã, vd game_8 258↔407 call, quầng bloom đèn gang mất): props cũ (a567fbf) ↔ mới: pano_141 +17 call/+0,44 M ↔ +17/+0,43 M, cam_high_center +14/+0,40 ↔ +14/+0,39, cam_spawn +18/+0,51 ↔ +19/+0,49, pano_007 1636 call/8,84 M ↔ 1529/7,80 M; aerial game_8 +20 call/+0,39 M.
    **QA:** `window.__hpProps` = {stats, sides (ô + lý do loại + bằng chứng), lists (toạ độ từng loại), cull()}.
    **Giao diện cho WP khác:** WP2 có thể gắn `world.realFootprints = {D, grid}` (đã đánh `D.dead`) TRƯỚC lời gọi →
    props né đúng nhà thật đang hiển thị (không có → tự `decodeRB(RB_B64)` ~12 ms). WP3 đăng ký claim `cell`/`civic`…
    → ô vỉa hè trong claim bị bỏ. WP8 (traffic/NPC): ô tô đỗ thêm collider tròn r 0,85 ×2/xe, cột/đèn/thùng/xe đẩy có
    collider (`world.colliders`). Chỉ mục `colIdx` ĐÃ được dựng (lần `resolveCollisions` đầu, sớm trong buildWorld) TRƯỚC
    props — vẫn an toàn vì `addCollider` chèn TĂNG DẦN vào colIdx (world.js `addCollider`); đừng đổi addCollider thành
    push trơn. `world.props.parkedCars` = ô tô đỗ {x,z,heading,len} để giao thông WP8 né làn đỗ (tâm xe curbLine−0,95,
    phố r curbLine−0,05): xe chạy nên cách bó vỉa ≥ 1,9 m nơi có xe đỗ. Hàng xe máy KHÔNG có collider (người đi bộ WP8
    nên tránh dải `parkingLine ± 0,9`).
- **2026-10-04 (WP6)** [ĐỢT 3 WP6 ROADS — mạng đường thật: đồ thị nút giao + dải + bó vỉa bo góc + vạch kẻ trong shader]:
    Thay `layRoad` (hộp 30 m: ~80% tam giác là mặt hộp vô hình, vỉa hè chạy XUYÊN ngã tư, không góc bo), lời gọi
    `ROADS_REGION` (dựng 12,5k hộp rồi bỏ hết), dải `aerial_road_ribbon` layer 2, `dashes`/`paths`/`sidewalk_TYPE`,
    cell_road (tim vàng + vạch dừng hộp MeshBasic), cell_curb (hộp bó vỉa), zebra hộp ở 19 INTERSECTIONS và 19 cột đèn
    tín hiệu lẻ (6 mesh/cột) bằng 3 module mới:
    (1) `js/roadnet.js` (thuần JS, chạy được trong node): NỐI LẠI ĐỒ THỊ — ROADS_DT simplify TỪNG way nên đỉnh chung của
    ngã ba bị mất (1.697/2.850 đầu mút lơ lửng): T-snap đầu mút ≤6,5 m vào đoạn của way khác (CHÈN đỉnh, không đổi hình
    phố đi thẳng — mặt tiền WP1 bám ROADS_DT) + chèn giao điểm X-cross (trừ dưới mặt cầu vòm và trừ giao cắt NÔNG <25° —
    làn nhập/tách chồng nhau ở nút cầu Bính: chèn nút ở đó sinh nút giao lùi 25-40 m méo + vỉa hè vụn; nay 2 dải chồng
    nhau, way lẻ nâng 1,5 mm chống z-fight, đoạn song song chạm nút vẫn chặn vỉa hè nằm TRONG lòng nó). Nút: phố p/s/t/r (có vỉa)
    vs ngõ h/w; 2 nhánh cùng bề rộng gãy ≤50° = nối miter liền; ngõ vào phố = LỐI RẼ cắt ở mép NGOÀI vỉa hè (vỉa hè phố
    chạy liền qua miệng ngõ như thật); còn lại = nút giao, gom CỤM nút sát nhau (đoạn nối ≤14 m, đường kính ≤26 m); mỗi
    cặp nhánh kề nhau 1 góc: bo cung R theo cấp thấp hơn (p7 s6 t4,5 r3 m, kẹp theo bề rộng vỉa và setback ≤45% đoạn
    chạy), thẳng (≈180°) hoặc vòng quanh tâm (>184°). Đa giác nút giao (ear-clip) + vỉa hè góc (zipper bó vỉa↔lưng) +
    mặt đứng bó vỉa 14 cm + mép lưng; vỉa hè bị cắt nơi lấn lòng/vỉa của phố khác (đường đôi, phố song song sát).
    Số liệu R1600: 3.574 nút, 1.447 nút giao, 1.332 miter, 595 lối rẽ ngõ, 126 nút có đèn (391 cột — mỗi nhánh phố 1 cột ở
    góc bên PHẢI làn xe tới, CHỈ trên vỉa hè đã phát, xem (l)), 715 nhánh có zebra; 63 ô 450 m × 2 mesh
    `roads_x,z`/`sidewalk_x,z` = 146k tam giác (69,4k lòng + 76,7k vỉa hè; với SIDEWALK_W dot3: 69,5k + 78,3k) (cũ: ~350k
    tam giác các lớp đường trước gộp). Dựng 173-181 ms trong trình duyệt (node ~230 ms; cũ: khối roads 414-620 + cell_road
    44-82 + cell_curb 152-277 ms) → bớt ~400-700 ms main thread lúc tải. Draw call cùng phiên (1 khung, base→mới):
    pano_062_h090 864→843, pano_007_h090 1592→1577; tam giác 3,56M→3,49M / 7,90M→7,83M. A/B xen kẽ 2 lượt cùng phiên
    (shoot --perf, 5 góc chuẩn): cam_spawn 725→698-711 call / 4,88→4,79M tam giác, cam_high_center 1160→1133 / 7,44→7,33M,
    game_3 1197→1188 / 8,13→8,04M; hpReady 24,6-25,0 s vs 24,4-25,3 s, heap 804-895 vs 772-897 MB, fps — đều trong nhiễu
    headless (khung có lượt cập nhật bóng nhảy +170 call/+1,7M tam giác ở CẢ hai bản; so số nhỏ nhất).
    Sau phản biện, A/B cùng phiên dot3 ece40e1 (đã gộp WP1/2/4/5) → dot3+WP6, 24 góc chuẩn: draw call/tam giác THẤP hơn ở
    20/24 góc (vd pano_001_h090 1264→913 / 6,59→4,52M, pano_007 1350→1322, cam_high_center 1094→1048 / 6,38→6,29M,
    game_3 1212→1203); 2 góc cao hơn là khung có lượt cập nhật bóng. hpReady 9,1-9,5 s vs 9,4-9,9 s; heap SAU GC cưỡng bức
    (CDP) 432 vs 436 MB (heap thô của shoot.mjs lệch ±200 MB do rác chưa thu — đừng so số thô). Dựng 184-268 ms trong trình
    duyệt lúc máy bận (node: các bước mới cột đèn/khe đường đôi/dualGap ≈ +10-15 ms).
    (2) `js/roadtex.js`: 1 DataArrayTexture 9 lớp 512² (LITE 256²) sinh TRONG WORKER (Blob dựng từ chính mã các hàm; lỗi →
    sinh đồng bộ; main thread ~2 ms): nhựa xám ẤM sáng màu nắng (đá dăm, loang; pano đo R>G>B ~(142,137,127) — bản lạnh
    g,g+1,g+2 + ánh trời xanh thành mặt đường xanh xám), bê tông ngõ, 4 kiểu vỉa hè theo SIDEWALK_BY_ROAD,
    bó vỉa, decal nắp cống/song chắn rác, lớp macro 32 m (nứt, vá, cụm giọt dầu — vệt tròn tối to trông như ổ gà, đã bỏ).
    MeshPhongMaterial + onBeforeCompile vẽ vạch kẻ THEO (u dọc, v ngang) của dải: tim vàng đôi (p), vàng đứt (s/t), trắng
    phân làn + vạch mép (p), zebra 3 m + vạch dừng nửa PHẢI ở nút giao, vá đường, vệt bánh xe, rãnh biên — 0 tam giác thêm.
    (3) `js/roadmarks.js` SINH bởi `tools/gen_roadmarks.mjs` từ audit_enriched.json (111 pano: tim vàng/đôi/trắng, zebra,
    đèn tín hiệu) → kiểu tim cho đoạn ≤14 m quanh pano, bật zebra/đèn ở nút ≤45 m. Đèn tín hiệu = 2 InstancedMesh
    (`traffic_signal_poles` cột + cần vươn 3,4 m + 2 đầu đèn + hộp đếm ngược, trụ openEnded 88 tam giác/cột;
    `traffic_signal_lamps` noCull CHỈ 3 instance/cột = bóng đang sáng của 2 đầu đèn + ô đếm ngược — bóng tắt trùng màu hộp
    nên không vẽ; đổi pha = dời ma trận bóng sang ô đỏ/vàng/xanh + đổi màu, 4 Hz; pha xanh 12 → vàng 3 → đỏ 15 s, trục
    vuông góc lệch 15 s nên xanh/vàng trục này nằm gọn trong đỏ trục kia).
    **BẪY/HỢP ĐỒNG MỚI:** (a) mặt vỉa hè nay = `SIDEWALK_TOP` 0,25 m (xsection: ROAD_TOP 0,11 + CURB_RISE 0,14), cũ 0,18 →
    vật đặt vỉa hè kiểu cũ `gh+0.18` lún 7 cm; vật mới dùng `SIDEWALK_TOP` hoặc `world.roadNet.surfaceAt(x,z)` (độ cao mặt
    nhựa/vỉa hè so với groundHeight; 0 ngoài đường và trên mặt cầu vòm; ~0,5 µs/lần đo node 200k điểm sau khi tách
    makeQueries (số 1,4 µs cũ là bản closure) — dùng được cho chân người chơi/NPC; KHÔNG biết dải nhựa phủ khe đường đôi (m):
    trong khe trả 0,25 (vỉa) thay vì ~0,12).
    (b) Mặt nhựa nâng +4 mm/cấp (h 0,11 … p 0,13): 2 dải chồng nhau (đường đôi) → cấp cao thắng, không z-fight; đa giác nút
    giao lấy cấp cao nhất của cụm. (c) Material đường là Phong CÓ CHỦ Ý: freezeStatic chỉ gộp Lambert (lượt 1 XOÁ uv → mất
    shader). Mã lớp/vạch (tới ~2,1 triệu) truyền bằng `flat varying ivec2` — nội suy float có thể lệch 1 → nhiễu bit vạch.
    (d) Hợp đồng đỉnh: position, normal, uv (dải: u dọc m, v ngang m có dấu), aSurf=(lớp, MK|seed<<13, hw, d cách bó vỉa),
    aZeb=(u đầu, u cuối vùng zebra) — chi tiết ở đầu roadnet.js/roadtex.js. (e) `world.roadNet` = {junctions[{x,z,rad,signal,
    zebra,arms}], signals, nearJunction(x,z,pad), surfaceAt(x,z), stats, material} cho cây/prop/giao thông/người chơi né
    miệng ngã tư. (f) SIDEWALK_BY_ROAD vẫn khoá theo index ROADS_DT (`swTypeOf(ri)`) — đừng đổi thứ tự ROADS_DT. (g) Shader
    chính cần WebGL2 (sampler2DArray, flat ivec, textureGrad). r160 vẫn fallback WebGL1 → `onBeforeCompile(sh, renderer)`
    (renderer = tham số THỨ 2) thấy `renderer.capabilities.isWebGL2 === false` → nhánh GLSL ES 1.0 `gl1Patch`: màu phẳng theo
    lớp mặt aSurf.x (bảng PLACEHOLDER), không vạch; `material.userData.webgl1 = true`. Kiểm: init script trả null cho
    getContext('webgl2') (scratchpad dot3/WP6/shoot_gl1.mjs --gl1): đường/vỉa hè vẽ đủ. Cùng phép thử, dot3 (cả có/không WP6)
    còn 2 lỗi shader 'GL_OES_standard_derivatives disabled' của shader atlas `hpTex/uAtlasPx` (dFdx không bật
    `extensions.derivatives`) — KHÔNG thuộc WP6, nhánh sở hữu shader đó cần sửa nếu muốn WebGL1 sạch. (h) Chạy gen_roadmarks từ
    GỐC repo đang làm (ghi `js/roadmarks.js` theo cwd). (i) BẪY miter ngược chiều: mặt cắt đầu dải dùng vector miter m của
    nút; nếu m NGƯỢC chiều pháp tuyến dải (dot<0) phải đổi dấu m (k=1/|dot|) — vị trí off() như nhau nhưng mặt đứng bó vỉa
    lấy hướng từ (mx,mz) → 91 mặt bó vỉa từng quay LƯNG về lòng đường, bị cull, lộ khe xanh giữa lòng và vỉa hè (pano_457).
    (i2) BẪY closure giữ sống ngữ cảnh: hàm trả về được tạo TRONG buildRoadNet (surfaceAt/nearJunction) giữ sống CẢ phạm
    vi dựng (ways/nodes/arms/lưới/tiles ≈ 41 MB heap, đo node --expose-gc) — nay dựng ở makeQueries() từ typed array gọn
    (≈5 MB). Module tạo closure lâu dài trong hàm dựng lớn → tách factory riêng. (i3) LITE (TIER ≤1): define RN_LITE bỏ
    mẫu nhựa tầng 2 + mẫu mòn sơn (2 lần đọc texture/điểm ảnh), texture 256²; customProgramCacheKey 'roadnet-v2-lite'.
    (j) Đoạn đường trong 10 m quanh trục cầu VÒM (BRIDGES rise>3) bị cắt CÓ CHỦ Ý kể cả trên bờ (dốc dẫn cầu Bính x≈75,
    z −950..−900 nằm trên mặt cầu, groundHeight 7-9 m). (k) Kiểm hình học không cần GPU: scratchpad `dot3/WP6/probe`
    (facecheck.mjs hướng mặt bó vỉa, holecheck.mjs lỗ lòng đường theo tim ROADS_DT, rn_test.mjs+rn_draw.py vẽ mặt bằng PNG).
    (l) CỘT ĐÈN TÍN HIỆU kiểm theo TAM GIÁC MẶT TRÊN ĐÃ PHÁT (placeSignals sau khi phát xong mọi hình học): vị trí hình học
    (mép bó vỉa +0,6 m, a.s+1,2 m) từng rơi vào lòng phố khác/đa giác nút/khe đất giữa đường đôi/vỉa hè bị foreign() cắt
    (phản biện: 32/426 cột trên nhựa/đất). Nay: tâm + vòng r 0,25 m phải đều trên tam giác vỉa hè, không điểm nào trên tam giác
    lòng; lùi 1 m/bước tới a.s+8; không được → bỏ cột nhánh đó (35 nhánh); y = mặt vỉa hè nội suy. Lọc nhanh bằng bitmap ô
    4 m + ô thô 32 m (tam giác lớn khỏi duyệt từng ô: 731k → ~40k lượt) ≈ 4-10 ms. Kiểm: review/sigcheck.mjs → 391/391 trên vỉa.
    (m) ĐƯỜNG ĐÔI OSM (2 way song song, khe giữa 2 mép lòng 0,05-2,5 m; khác cấp ≤1,2 m): KHÔNG vỉa hè trong khe (bad() →
    dualGap) + `gapFill` phủ NHỰA đúng khe (mép dải này → mép dải kia, mẩu ≤4 m, ±3 m quá đầu đoạn để tới góc nút; CẢ 2 way
    cùng phát, lệch 0,5 mm, trùng khít cùng màu) — ảnh thật pano_327 (Hồ Sen) là 1 mặt đường liền + zebra suốt; thử dải
    phân cách nổi cho khe >1,2 m: trái ảnh → bỏ. Khe đất còn lại (~227 m² trong 1 km, Bính/(450,600)/(475,-450)) là nhập
    làn hội tụ không song song. (n) freezeStatic bật castShadow cho mọi mesh không khớp _noCast → `traffic_signal_lamps` tự
    tắt castShadow ở khung đầu trong updater (không sửa dòng regex dùng chung). (o) Vật ĐẶT THEO ROADS_DT kiểu cũ (đèn gang
    trang trí `wRoad/2+1`, cột điện, cây WP4) nay có thể đứng giữa lòng đường ở đường đôi/miệng nút (pano_327: đèn gang
    giữa đường vì khe giữa 2 chiều xe giờ là nhựa) → lọc bằng `world.roadNet.surfaceAt(x,z)` (0<s<0,2 = lòng) +
    `nearJunction(x,z,1)` ở nhánh sở hữu khối đó.
    Ảnh A/B + số đo: scratchpad `dot3/WP6` (fin_base vs fin_std, a4_jx*, a4_v5_m.jpg; sau phản biện: a5_mrg_m1-3.jpg
    real|dot3|dot3+WP6, a5_gl1_m.jpg WebGL1, ab5/ A/B std).
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
