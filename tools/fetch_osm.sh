#!/bin/bash
# Tải dữ liệu OpenStreetMap cho tools/process_osm.mjs (chạy trong thư mục tools/)
# Overpass BẮT BUỘC có User-Agent, không thì trả 406.
# Sau khi tải xong: node process_osm.mjs  ->  sinh ../js/mapdata.js
set -e
UA='hp-world-3d/1.0 (educational project)'
API='https://overpass-api.de/api/interpreter'
q() { curl -s -H "User-Agent: $UA" --data-urlencode "data=$1" "$API" -o "$2"; echo "$2 -> $(du -h "$2" | cut -f1)"; }

# 1. Đường bờ biển (phân loại đất/biển) — bbox rộng quanh Hải Phòng + Cát Bà
q '[out:json][timeout:120];way["natural"="coastline"](20.55,106.45,21.10,107.35);out geom;' osm_coast.json

# 2. Sông (chỉ dùng Cấm / Tam Bạc / Lạch Tray, lọc theo tên trong process_osm.mjs)
q '[out:json][timeout:120];way["waterway"~"^(river|canal)$"](20.55,106.45,21.10,107.35);out geom;' osm_rivers.json

# 3. Phố trung tâm (mọi cấp đường trong hộp trung tâm)
q '[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary|tertiary|residential|living_street|unclassified|pedestrian)$"](20.845,106.652,20.884,106.712);out geom;' osm_roads_dt.json

# 3b. Ngõ/hẻm lõi trung tâm (service/alley/footway — query roads_dt cũ lọc mất; class 'h' trong mapdata)
q '[out:json][timeout:120];way["highway"~"^(service|footway|path|track)$"](20.845,106.652,20.884,106.712);out geom;' osm_alleys.json

# 4. Trục vùng rộng (ra Đồ Sơn, Đình Vũ, Thủy Nguyên...)
q '[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary)$"](20.55,106.45,21.10,107.35);out geom;' osm_roads_region.json

# 5. Footprint tòa nhà trung tâm
q '[out:json][timeout:180];way["building"](20.845,106.652,20.884,106.712);out geom;' osm_buildings.json

# 6. Geometry đối tượng địa danh THẬT (id cố định — xem process_osm.mjs phần 5)
#    opera 242055606, quán hoa 242169916, quảng trường 242169920, nhà thờ 174683856,
#    bưu điện 242226546, bảo tàng 1049831208, chợ Sắt 1175766946, bãi Đồ Sơn khu 1 693082800,
#    hải đăng Hòn Dấu 967471570, cầu Hoàng Văn Thụ 738297304, cầu Bính 1002961725
q '[out:json][timeout:60];way(id:242055606,242169916,242169920,174683856,242226546,1049831208,1175766946,693082800,967471570,738297304,1002961725);out geom;' osm_lm_geom.json

# 7. Geometry 3 trường học (THPT Ngô Quyền 242169921, THCS Ngô Quyền 240463141, THCS Trần Phú 1120513525)
q '[out:json][timeout:60];way(id:242169921,240463141,1120513525);out geom;' osm_school_geom.json

# 7b. Đợt địa danh 2 (UBND TP 1124706318, rạp Tháng Tám 868234608, đình Hàng Kênh 240394078,
#     chùa Dư Hàng 236830096, đền Tam Kỳ 961921403)
q '[out:json][timeout:60];way(id:1124706318,868234608,240394078,236830096,961921403,242192606);out geom;' osm_lm2_geom.json

# 8. Cây thật (node natural=tree) trung tâm
q '[out:json][timeout:90];node["natural"="tree"](20.845,106.652,20.884,106.712);out;' osm_trees.json

# 9. Công viên / thảm cỏ thật trung tâm
q '[out:json][timeout:90];(way["leisure"~"^(park|garden|playground)$"](20.845,106.652,20.884,106.712);way["landuse"~"^(grass|recreation_ground)$"](20.845,106.652,20.884,106.712););out geom;' osm_parks.json

# 10. Đường sắt (tuyến chính vào ga Hải Phòng)
q '[out:json][timeout:90];way["railway"="rail"](20.82,106.55,20.90,106.75);out geom;' osm_rail.json

# 11. Nước downtown (polygon hồ Tam Bạc way 236743184 — process_osm §6b cần). CHÚ Ý Overpass hay 406/busy → retry mirror.
q '[out:json][timeout:90];(way["natural"="water"](20.845,106.652,20.884,106.712);way(id:236743184););out geom;' osm_water_dt.json

echo 'Xong. Chạy: node process_osm.mjs'
