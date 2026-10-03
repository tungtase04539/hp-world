# montage.py <shotsdir> <out.jpg> id1 id2 ...   (id = pano_XXX_hHHH) -> real (top) vs game (bottom) pairs in a grid
import sys, os
from PIL import Image
SD, OUT, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
RP = 'C:/Users/Admin/hp-world/audit/550_pano_dai_trung_tam_hai_phong'
TW = 640
tiles = []
for i in ids:
    pano, h = i.rsplit('_h', 1)
    rf = f'{RP}/{pano}_h{h}_p0.jpg'
    g = Image.open(f'{SD}/{i}.png').convert('RGB')
    gh = int(g.height * TW / g.width); g = g.resize((TW, gh))
    if os.path.exists(rf):
        r = Image.open(rf).convert('RGB').crop((0, 34, 1912, 843))
        r = r.resize((TW, int(r.height * TW / r.width)))
    else:
        r = Image.new('RGB', (TW, 272), (40, 40, 40))
    t = Image.new('RGB', (TW, r.height + gh + 4), (255, 255, 255)); t.paste(r, (0, 0)); t.paste(g, (0, r.height + 4)); tiles.append(t)
cols = 2
rows = (len(tiles) + cols - 1) // cols
th = max(t.height for t in tiles)
M = Image.new('RGB', (cols * TW + (cols - 1) * 6, rows * th + (rows - 1) * 6), (255, 255, 255))
for k, t in enumerate(tiles):
    M.paste(t, ((k % cols) * (TW + 6), (k // cols) * (th + 6)))
M.save(OUT, quality=85)
