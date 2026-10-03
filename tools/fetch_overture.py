#!/usr/bin/env python3
"""Tải footprint TOÀ NHÀ THẬT từ Overture Maps (gộp OpenStreetMap + Google Open Buildings + Microsoft ML Buildings)
cho hộp trung tâm Hải Phòng → tools/ov_buildings.csv (gitignore, ~21 MB, ~98k footprint).

    pip install duckdb
    python tools/fetch_overture.py            # mặc định release mới nhất đã kiểm (xem RELEASE)
    python tools/fetch_overture.py 2026-09-23.0

Sau đó: node tools/process_buildings.mjs  → sinh js/buildings_real.bin (footprint đã lọc/cắt theo đường-nước-địa danh).
Overture phân phối GeoParquet công khai trên S3 (không cần khoá). Hộp lọc theo cột bbox (đẩy xuống parquet → chỉ đọc
vài row-group, ~1,5 phút). Giấy phép: ODbL (phần OSM) + CDLA-Permissive-2.0 (Microsoft) + CC-BY-4.0/ODbL (Google) — ghi
attribution trong README.
"""
import sys, time, os
import duckdb

RELEASE = sys.argv[1] if len(sys.argv) > 1 else '2026-09-23.0'
# Hộp ~8 × 6 km quanh Nhà hát lớn (gốc toạ độ game 106.68182, 20.85750)
BBOX = dict(xmin=106.645, xmax=106.72, ymin=20.83, ymax=20.885)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ov_buildings.csv')

t = time.time()
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
con.execute(f"""
COPY (
  SELECT id, names.primary AS name, height, num_floors, class, subtype, roof_shape, facade_color, roof_color,
         facade_material, roof_material, sources[1].dataset AS src, ST_AsText(geometry) AS wkt
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
  WHERE bbox.xmin > {BBOX['xmin']} AND bbox.xmax < {BBOX['xmax']} AND bbox.ymin > {BBOX['ymin']} AND bbox.ymax < {BBOX['ymax']}
) TO '{OUT.replace(os.sep, '/')}' (HEADER, DELIMITER ',');
""")
n = con.execute(f"SELECT src, count(*) FROM read_csv_auto('{OUT.replace(os.sep, '/')}') GROUP BY src ORDER BY 2 DESC").fetchall()
print(f'{OUT}: {n}  ({time.time() - t:.0f}s)')
