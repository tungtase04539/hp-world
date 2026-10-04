# tools/qa/lmoutline.py — VIỀN CHIẾU BẰNG của GLB địa danh (Đợt 3 W2-E) → bảng LM_OUTLINE trong world.js.
# Từ ảnh chiếu bằng GLB GỐC (D/sheets/<glb>_occ.json, OCC=0.12 — bỏ 12% chiều cao dưới: tấm đế/bậc Meshy; xem lmfit.py) dựng
# đa giác (hợp ô chiếm → đóng khe nhỏ → đơn giản hoá Douglas-Peucker), toạ độ MODEL tương đối TÂM BBOX (placeGLB đặt tâm bbox tại
# (cx,cz)). world.js biến đổi bằng LM_FIT (scale sx/sz + xoay th) → vòng va chạm = ĐÚNG chỗ có nhà (không tường vô hình ở góc
# đa giác OSM trống / trên vỉa hè mà GLB đã được khớp tránh).
# usage: python tools/qa/lmoutline.py --data D [--tol 0.012] [--close 0.02] [--minA 0.004] glb1 glb2 ...  → in JSON {glb: [[x,z,...]...]}
import sys, json
import numpy as np
from shapely.geometry import box, Polygon, MultiPolygon
from shapely.ops import unary_union
a = sys.argv[1:]
def opt(k, d):
    if '--' + k in a: i = a.index('--' + k); v = a[i + 1]; del a[i:i + 2]; return v
    return d
S = opt('data', '.').rstrip('/') + '/'
tol = float(opt('tol', '0.012')); close = float(opt('close', '0.02')); minA = float(opt('minA', '0.004'))
info = json.load(open(S + 'sheets/_info.json'))
out = {}
for glb in a:
    O = json.load(open(S + f'sheets/{glb}_occ.json'))
    nx, nz, cs = O['nx'], O['nz'], O['cs']
    occ = np.frombuffer(O['occ'].encode(), dtype=np.uint8).reshape(nz, nx) - 48
    I = info[glb]; bcx = (I['min'][0] + I['max'][0]) / 2; bcz = (I['min'][2] + I['max'][2]) / 2
    # dải ô liên tiếp theo hàng → hình chữ nhật (nhanh hơn từng ô)
    rects = []
    for j in range(nz):
        row = occ[j]; i = 0
        while i < nx:
            if row[i]:
                k = i
                while k < nx and row[k]: k += 1
                x0 = O['x0'] + i * cs - bcx; z0 = O['z0'] + j * cs - bcz
                rects.append(box(x0, z0, x0 + (k - i) * cs, z0 + cs)); i = k
            else: i += 1
    U = unary_union(rects).buffer(close, join_style=2).buffer(-close, join_style=2)
    polys = [U] if isinstance(U, Polygon) else list(U.geoms)
    rings = []
    for p in sorted(polys, key=lambda q: -q.area):
        if p.area < minA: continue
        q = Polygon(p.exterior).simplify(tol, preserve_topology=True)
        if not q.is_valid or q.area < minA: continue
        c = list(q.exterior.coords)[:-1]
        # chiều CCW/CW giữ như shapely (đẩy va chạm không phụ thuộc chiều)
        rings.append([round(v, 3) for xy in c for v in xy])
    out[glb] = rings
    tot = sum(p.area for p in polys)
    print(f'// {glb}: {len(rings)} vòng, {sum(len(r) // 2 for r in rings)} đỉnh, phủ {sum(Polygon(np.array(r).reshape(-1, 2)).area for r in rings) / max(tot, 1e-9):.3f} diện tích ô', file=sys.stderr)
print(json.dumps(out, separators=(',', ':')))
