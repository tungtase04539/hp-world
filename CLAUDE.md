# Hải Phòng 3D

**ĐỌC `KNOWLEDGE.md` TRƯỚC KHI LÀM BẤT CỨ VIỆC GÌ.** Đó là sổ tay kỹ thuật của dự án:
hệ tọa độ & phép chiếu, công thức địa hình, quy trình Meshy photo→3D chất lượng cao,
pipeline dữ liệu OSM (`tools/`), lưu trữ asset nặng (nhánh `assets-storage`), kiểm thử, deploy.

Quy tắc nhanh:
- Mô hình địa danh: từ ẢNH THẬT, chất lượng tối đa, KHÔNG nén lossy (chỉ meshopt geometry).
- `js/mapdata.js` là file SINH TỰ ĐỘNG — sửa `tools/process_osm.mjs` rồi chạy lại, đừng sửa tay.
- Chạy `tools/diag.mjs` + `tools/waterbfs.mjs` + xem ảnh `tools/tour.mjs` trước khi push.
- Đổi asset/`ASSETS_SHA` → chạy `node tools/check_assets.mjs` (mọi URL GLB phải có cả bản gốc lẫn `assets_lite/` ở SHA ghim).
- Cảm ứng KHÔNG phải máy yếu: chất lượng theo `TIER` (js/device.js), cảm ứng chỉ cho UI. Mọi phép đo perf ghi `__hp.tier` + `__hp.gpu`.
- Có kiến thức/kỹ thuật/công thức mới → CẬP NHẬT `KNOWLEDGE.md` trong cùng commit.
- KHÔNG commit API key.
