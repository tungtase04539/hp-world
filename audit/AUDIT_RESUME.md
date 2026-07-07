# Pano Audit — Checkpoint (tạm dừng theo yêu cầu user tại batch 72-77)

## Tình trạng
- **400 / 551 pano** đã catalog xong → `scratchpad/audit_done.json` (dữ liệu đầy đủ, an toàn, đã push git)
- **151 pano còn lại** → `scratchpad/pano_remaining.json` (đã lọc sẵn, mỗi pano 4 heading 0/90/180/270)
  - Pano số còn thiếu: **299–304, 311–420, 517–551**
- Chưa chạy: verify có mục tiêu + tổng hợp bảng chi tiết + gap-list.

## Chiến lược đã chốt với user
1. Catalog toàn bộ 551 (còn 151). Phần còn lại dùng **4 heading** (tiết kiệm ~50% quota).
2. Verify **có mục tiêu**: chỉ soi lại pano `confidence=low` + pano có `special`/công trình đặc trưng.
3. Tổng hợp **bảng chi tiết 551 pano** + **danh sách "có thật, game thiếu"** để làm Vòng 2/3.
   - Bỏ verify đại trà (quá tốn quota).

## Cách chạy tiếp (catalog 151 pano còn lại, 4 heading)
Script: `scratchpad/pano-audit-remaining.js` (đọc `pano_remaining.json`).
⚠️ Trước khi chạy: sửa `const total = 223` → **151** trong `pano-audit-remaining.js`, rồi chạy MỚI (không resume — pano_remaining.json đã đổi).
Sau khi chạy xong: harvest tất cả journal wf_* → gộp vào audit_done.json (bản đầu tiên theo id).

## Nguồn dữ liệu
- `pano_index.json` (420 pano 001–420) + `pano_index2.json` (131 pano 421–551), đều 8 heading.
- Ảnh: `scratchpad/sv_refs/streetview-refs/*.jpg` (4408 ảnh). Nếu container mất: `git archive origin/streetview-refs streetview-refs | tar -x -C scratchpad/sv_refs/`
- Bản backup git: nhánh `streetview-refs`, thư mục `audit/`.
- `game_inventory.json`: liệt kê landmark/prop/vỉa hè ĐANG CÓ trong game (để đối chiếu gap).
- Phép chiếu 1:1: LON0=106.68182 LAT0=20.85750 UX=111320·cos(LAT0) UZ=110574; X=(lng-LON0)·UX, Z=-(lat-LAT0)·UZ

## Journal workflow (nguồn harvest)
- wf_799dc677-500, wf_b5337a48-d88 (catalog 8-heading, đợt 1-2)
- wf_16265213-64a, wf_1b6a6fde-cf7 (catalog 4-heading remaining)
Harvest: đọc journal.jsonl mỗi dir, type=result → result.panos, gộp theo id (bản đầu tiên).
