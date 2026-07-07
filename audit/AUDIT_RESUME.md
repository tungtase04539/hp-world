# Pano Audit — Checkpoint (tạm dừng theo yêu cầu)

## Tình trạng
- **328 / 551 pano** đã catalog xong → `scratchpad/audit_done.json` (dữ liệu đầy đủ, an toàn)
- **223 pano còn lại** → `scratchpad/pano_remaining.json` (đã lọc sẵn, mỗi pano 4 heading 0/90/180/270)
  - Pano số còn thiếu: **233–420, 517–551**
- Chưa chạy: verify có mục tiêu + tổng hợp bảng chi tiết + gap-list.

## Chiến lược đã chốt với user
1. Catalog toàn bộ 551 (đang dở, còn 223). Phần còn lại dùng **4 heading** (tiết kiệm ~50% quota).
2. Verify **có mục tiêu**: chỉ soi lại pano `confidence=low` + pano có `special`/công trình đặc trưng.
3. Tổng hợp **bảng chi tiết 551 pano** + **danh sách "có thật, game thiếu"** để làm Vòng 2/3.
   - Bỏ verify đại trà (quá tốn quota, gấp đôi chi phí).

## Cách chạy tiếp (catalog 223 pano còn lại, 4 heading)
Script sẵn: `scratchpad/pano-audit-remaining.js` (đọc `pano_remaining.json`, total tự = độ dài file? — KHÔNG, total đang hardcode 301).
⚠️ Trước khi chạy lại: sửa `const total = 301` → `223` trong `pano-audit-remaining.js`, HOẶC resume run cũ:
- Resume run 4-heading (giữ cache 250→328): `Workflow({scriptPath:'.../pano-audit-remaining.js', resumeFromRunId:'wf_16265213-64a'})`
  - LƯU Ý: run cũ dùng pano_remaining.json bản 301. File này vừa bị GHI ĐÈ thành bản 223.
    → Để resume sạch, tốt nhất chạy MỚI với total=223 trên pano_remaining.json hiện tại (không resume).

## Nguồn dữ liệu
- `pano_index.json` (420 pano 001–420, 8 heading) + `pano_index2.json` (131 pano 421–551, 8 heading)
- Ảnh: `scratchpad/sv_refs/streetview-refs/*.jpg` (4408 ảnh, đủ 551 pano × 8 heading)
- Phép chiếu 1:1: LON0=106.68182 LAT0=20.85750 UX=111320·cos(LAT0) UZ=110574; X=(lng-LON0)·UX, Z=-(lat-LAT0)·UZ

## Journal workflow (nguồn harvest)
- wf_799dc677-500 (index1, catalog)
- wf_b5337a48-d88 (index2, catalog)
- wf_16265213-64a (remaining 4-heading, catalog)
Harvest: đọc `journal.jsonl` mỗi dir, lấy `type=result` → `result.panos`, gộp theo id (bản đầu tiên).
