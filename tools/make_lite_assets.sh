#!/usr/bin/env bash
# Sinh bộ ASSET NHẸ (assets_lite/) cho máy yếu & điện thoại — bản GỐC assets/ KHÔNG bị đụng tới.
#
# Vì sao cần: assets/ nặng 282 MB (23 model, texture 4096²). Điện thoại phải tải + giải nén toàn bộ
# → chờ lâu, RAM đỉnh cao, chính là "vào game lag một lúc". Bản lite chỉ dùng khi LITE=true.
#
# Nguyên tắc CHẤT LƯỢNG (theo quy tắc dự án): file gốc giữ 100%, máy mạnh vẫn dùng bản gốc.
#   1. simplify   — hình học 300k → ~35% (error 0.005: sai lệch < 0.5% kích thước, mắt không thấy)
#   2. normal/metallicRoughness → 64px: chế độ LITE BỎ HẲN các map này lúc chạy, tải về là phí
#      (normalTexture là PNG ~2.9 MB/model!). Không xoá hẳn để giữ cấu trúc material hợp lệ.
#   3. baseColor/emissive → 1024px (màn điện thoại + cự ly chơi không phân biệt được với 4096)
#   4. meshopt    — nén hình học (KHÔNG lossy, đúng quy tắc dự án)
#
# Chạy:  bash tools/make_lite_assets.sh
# Cần:   npm i -g @gltf-transform/cli
set -u
cd "$(dirname "$0")/.."
mkdir -p assets_lite
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

n=0
for f in assets/*.glb; do
  b="$(basename "$f")"
  # Model NẶNG (>5MB = landmark ~300k tri) siết mạnh: 0.12 (~35k tri) — đo được 5 model chiếm 1.5M
  # tam giác NGAY tại chỗ đứng. Model nhẹ (cây/xe/prop) giữ 0.5 để không vỡ dáng.
  SZ=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$SZ" -gt 5000000 ]; then RATIO=0.12; ERR=0.01; else RATIO=0.5; ERR=0.005; fi
  gltf-transform simplify "$f" "$TMP/a.glb" --ratio "$RATIO" --error "$ERR" >/dev/null 2>&1 || cp "$f" "$TMP/a.glb"
  gltf-transform resize "$TMP/a.glb" "$TMP/b.glb" --width 64 --height 64 \
      --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" >/dev/null 2>&1 || cp "$TMP/a.glb" "$TMP/b.glb"
  gltf-transform resize "$TMP/b.glb" "$TMP/c.glb" --width 1024 --height 1024 >/dev/null 2>&1 || cp "$TMP/b.glb" "$TMP/c.glb"
  gltf-transform meshopt "$TMP/c.glb" "assets_lite/$b" >/dev/null 2>&1 || cp "$TMP/c.glb" "assets_lite/$b"
  n=$((n+1))
  printf "%-26s %6s → %6s\n" "$b" "$(du -h "$f" | cut -f1)" "$(du -h "assets_lite/$b" | cut -f1)"
done

echo "---"
echo "$n model | gốc: $(du -sh assets | cut -f1) | lite: $(du -sh assets_lite | cut -f1)"
