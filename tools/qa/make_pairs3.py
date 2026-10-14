# make_pairs3.py <old_shots_dir> <new_shots_dir> <out_dir> [ids_json]
# Ghép mỗi pano thành 1 ảnh 4 hàng (h0/90/180/270), mỗi hàng: REAL | OLD (dot3 trước) | NEW (bản tích hợp)
# (dựng lại 2026-10-15 sau khi thư mục scratchpad bị mất — cùng nội dung bản gốc)
import json, os, sys
from PIL import Image, ImageDraw
OLD, NEW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SP = os.path.dirname(os.path.abspath(__file__))
ids = json.load(open(sys.argv[4] if len(sys.argv) > 4 else os.path.join(SP, 'audit_ids.json')))
RP = 'C:/Users/Admin/hp-world/audit/550_pano_dai_trung_tam_hai_phong'
os.makedirs(OUT, exist_ok=True)
TW = 560
def load(p, w):
    if not os.path.exists(p): return None
    im = Image.open(p).convert('RGB'); return im.resize((w, int(im.height * w / im.width)))
n = 0
for pid in ids:
    rows = []
    for h in (0, 90, 180, 270):
        rf = f'{RP}/{pid}_h{h:03d}_p0.jpg'
        r = None
        if os.path.exists(rf):
            r = Image.open(rf).convert('RGB').crop((0, 34, 1912, 843)); r = r.resize((TW, int(r.height * TW / r.width)))
        o = load(f'{OLD}/{pid}_h{h:03d}.png', TW); g = load(f'{NEW}/{pid}_h{h:03d}.png', TW)
        H = max(x.height for x in (r, o, g) if x is not None)
        row = Image.new('RGB', (TW * 3 + 12, H + 18), (255, 255, 255))
        for k, im in enumerate((r, o, g)):
            if im is not None: row.paste(im, (k * (TW + 6), 18))
        ImageDraw.Draw(row).text((4, 2), f'{pid} heading {h}:  REAL (left)  |  OLD game (middle)  |  NEW game (right)', fill=(0, 0, 0))
        rows.append(row)
    M = Image.new('RGB', (rows[0].width, sum(x.height for x in rows)), (255, 255, 255)); y = 0
    for x in rows: M.paste(x, (0, y)); y += x.height
    M.save(f'{OUT}/{pid}.jpg', quality=80); n += 1
print('composites', n)
