import sys
from PIL import Image
SD, OUT = sys.argv[1], sys.argv[2]
ids = sys.argv[3:] or ['1','2','3','4','5','6','7','8']
TW=560
rows=[]
for i in ids:
    r = Image.open(f'C:/Users/Admin/hp-world/audit/satellite/real_{i}.png').convert('RGB')
    r = r.crop((0,0,r.width, int(r.height*0.93)))
    g = Image.open(f'{SD}/game_{i}.png').convert('RGB')
    r = r.resize((TW, int(r.height*TW/r.width))); g = g.resize((TW, int(g.height*TW/g.width)))
    h = max(r.height, g.height)
    t = Image.new('RGB', (TW*2+6, h), (255,255,255)); t.paste(r,(0,0)); t.paste(g,(TW+6,0)); rows.append(t)
M = Image.new('RGB', (TW*2+6, sum(t.height+6 for t in rows)), (255,255,255))
y=0
for t in rows: M.paste(t,(0,y)); y+=t.height+6
M.save(OUT, quality=82)
