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
q '[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary|tertiary|residential|pedestrian)$"](20.845,106.652,20.884,106.712);out geom;' osm_roads_dt.json

# 4. Trục vùng rộng (ra Đồ Sơn, Đình Vũ, Thủy Nguyên...)
q '[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary)$"](20.55,106.45,21.10,107.35);out geom;' osm_roads_region.json

# 5. Footprint tòa nhà trung tâm
q '[out:json][timeout:180];way["building"](20.845,106.652,20.884,106.712);out geom;' osm_buildings.json

# 6. Geometry đối tượng địa danh THẬT (id cố định — xem process_osm.mjs phần 5)
#    opera 242055606, quán hoa 242169916, quảng trường 242169920, nhà thờ 174683856,
#    bưu điện 242226546, bảo tàng 1049831208, chợ Sắt 1175766946, bãi Đồ Sơn khu 1 693082800,
#    hải đăng Hòn Dấu 967471570, cầu Hoàng Văn Thụ 738297304, cầu Bính 1002961725
q '[out:json][timeout:60];way(id:242055606,242169916,242169920,174683856,242226546,1049831208,1175766946,693082800,967471570,738297304,1002961725);out geom;' osm_lm_geom.json

echo 'Xong. Chạy: node process_osm.mjs'
