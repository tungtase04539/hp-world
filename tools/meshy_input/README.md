# Meshy input — landmark photo→3D (Hải Phòng 3D)

Ảnh đã TIỀN XỬ LÝ sạch để nạp Meshy **image-to-3d**. Quy trình gốc: `KNOWLEDGE.md §5`.
Mỗi ảnh đã: crop tách công trình, xoá vật cản (cột cờ/cây/chữ/tem), nền đồng đều, tô màu hợp chất liệu.
Đã qua **đồng duyệt ChatGPT (gpt-5.6)** nhiều vòng cho tới khi hết lỗi đáng kể.

## Trạng thái
| File | Công trình | Nguồn (license) | Duyệt | Ghi chú |
|---|---|---|---|---|
| `ubnd_hotel_de_ville.jpg` | UBND TP (Hôtel de Ville) | Wikimedia — *Tonkin-Haïphong-Hôtel de Ville* (Public Domain) | ✅ ChatGPT OK (5 vòng) | bưu thiếp cổ B&W → tô màu colonial; chính diện 3/4, mặt sau ẩn (bas-relief). |

## Tham số Meshy (chốt cùng ChatGPT — low-poly game)
```jsonc
POST https://api.meshy.ai/openapi/v1/image-to-3d      // Bearer $MESHY_API_KEY
{
  "image_url": "<data:image/jpeg;base64,...>",
  "ai_model": "latest",
  "topology": "triangle",
  "target_polycount": 20000,     // low-poly game (KHÔNG 300k)
  "should_remesh": true,
  "should_texture": true,
  "enable_pbr": false            // game low-poly: tắt PBR cho nhẹ & đồng bộ style
}
```

### texture_prompt theo công trình
- **ubnd_hotel_de_ville**:
  `French colonial civic building, neutral warm cream lime-stucco walls, cool gray slate mansard roof, off-white stone architectural trim, muted dark gray-green wooden louvered shutters, weathered gray stone foundation, subtle age and patina, matte low-contrast PBR, consistent material scale, no vegetation, no flags, no signage, no text, no baked shadows, no dramatic lighting`

## Chạy (máy chủ dự án có sẵn key)
```bash
export MESHY_API_KEY=...        # KHÔNG commit key
python tools/meshy_input/meshy_submit.py ubnd_hotel_de_ville.jpg \
  "French colonial civic building, ..."   # texture_prompt ở trên
```
Script tự: gửi task → poll 45s/lần → tải GLB về `assets/<tên>.glb` → `gltf-transform meshopt`.
Sau đó đặt vào game theo mẫu `KNOWLEDGE.md §5.5` (registerModel + orientLong + plinth).

## Hậu xử lý (BẮT BUỘC)
`npx gltf-transform meshopt in.glb out.glb`  — CHỈ nén hình học (visually lossless). CẤM webp/simplify/resize texture.
