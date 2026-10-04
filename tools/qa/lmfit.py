# tools/qa/lmfit.py — TỐI ƯU KHỚP GLB địa danh ↔ footprint OSM (LM_POLY) OFFLINE (Đợt 3 W2-E; số ra = bảng LM_FIT world.js).
# Dữ liệu (thư mục --data D): D/sheets/<glb>_occ.json + D/sheets/_info.json (node tools/qa/glbsheets.mjs <port> D/sheets m1,m2 với
# OCC=0.12 — ảnh chiếu bằng của GLB GỐC bỏ 12% chiều cao dưới cùng), D/lmpoly.json + D/segs.json (node tools/qa/lmfit_prep.mjs D).
# Tìm θ (±dth độ quanh θ0 = hướng mặt tiền đã kiểm pano), sx, sz (m/đơn vị, |sx/sz| ≤ amax), dời tâm (dx,dz) cực đại
#   IoU − lam·(phần ngoài đa giác nở buf m)/A_poly − lamR·(phần trong hành lang phố: cách tim < facadeLine − 0,5 m)/A_poly
# usage: python tools/qa/lmfit.py <glb> <lmkey> <theta0_rad> --data D [--amax 1.6] [--dth 12] [--lam 0.5 --buf 2] [--lamR 4]
import sys, json, math
import numpy as np
from matplotlib.path import Path
a = sys.argv[1:]
S = (a[a.index('--data') + 1] if '--data' in a else '.').rstrip('/') + '/'
glb, key, th0 = a[0], a[1], float(a[2])
def opt(k, d):
    if '--' + k in a: return a[a.index('--' + k) + 1]
    return d
amax = float(opt('amax', '1.7')); dth = float(opt('dth', '10'))
O = json.load(open(S + f'sheets/{glb}_occ.json'))
P = np.array(json.load(open(S + 'lmpoly.json'))[key])
nx, nz, cs = O['nx'], O['nz'], O['cs']
occ = np.frombuffer(O['occ'].encode(), dtype=np.uint8).reshape(nz, nx) - 48
jj, ii = np.nonzero(occ)
# tâm bbox model (place() đặt tâm BBOX về điểm đích) — bbox thật lấy từ _info
info = json.load(open(S + 'sheets/_info.json'))[glb]
bcx = (info['min'][0] + info['max'][0]) / 2; bcz = (info['min'][2] + info['max'][2]) / 2
LX = O['x0'] + (ii + 0.5) * cs - bcx; LZ = O['z0'] + (jj + 0.5) * cs - bcz
# lấy mẫu thưa để nhanh
step = max(1, len(LX) // 40000)
LX, LZ = LX[::step], LZ[::step]
w_cell = cs * cs * step
# raster đa giác 0.25 m
x0, z0 = P[:, 0].min() - 60, P[:, 1].min() - 60; x1, z1 = P[:, 0].max() + 60, P[:, 1].max() + 60
G = 0.25
gx = np.arange(x0, x1, G) + G / 2; gz = np.arange(z0, z1, G) + G / 2
XX, ZZ = np.meshgrid(gx, gz)
pin = Path(P).contains_points(np.c_[XX.ravel(), ZZ.ravel()]).reshape(XX.shape)
polyA = pin.sum() * G * G
lam = float(opt('lam', '0')); buf = float(opt('buf', '2'))
from shapely.geometry import Polygon as SPoly
from shapely import contains_xy
PB = SPoly(P).buffer(buf, join_style=2)
pbuf = contains_xy(PB, XX.ravel(), ZZ.ravel()).reshape(XX.shape)
# hành lang phố game: điểm cách tim phố < facadeLine − 0,5 m (vỉa hè + lòng) → phạt lamR
lamR = float(opt('lamR', '0'))
road = np.zeros(XX.shape, bool)
if lamR > 0:
    for ax, az, bx, bz, fl, cl in json.load(open(S + 'segs.json')):
        if max(ax, bx) < x0 - 20 or min(ax, bx) > x1 + 20 or max(az, bz) < z0 - 20 or min(az, bz) > z1 + 20: continue
        dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1e-9
        t = np.clip(((XX - ax) * dx + (ZZ - az) * dz) / L2, 0, 1)
        d = np.hypot(XX - ax - t * dx, ZZ - az - t * dz)
        road |= d < (fl - 0.5)
# đa giác nở 3 m (claim) để phạt phần tràn
def shoelace(p): return 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(np.roll(p[:, 0], -1), p[:, 1]))
cx0 = P[:, 0].mean(); cz0 = P[:, 1].mean()
# centroid diện tích
A2 = np.dot(P[:, 0], np.roll(P[:, 1], -1)) - np.dot(np.roll(P[:, 0], -1), P[:, 1])
cr = P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]
cx0 = ((P[:, 0] + np.roll(P[:, 0], -1)) * cr).sum() / (3 * A2); cz0 = ((P[:, 1] + np.roll(P[:, 1], -1)) * cr).sum() / (3 * A2)
def score(th, sx, sz, dx, dz):
    c, s = math.cos(th), math.sin(th)
    lx = LX * sx; lz = LZ * sz
    wx = cx0 + dx + lx * c + lz * s; wz = cz0 + dz - lx * s + lz * c
    i = ((wx - x0) / G).astype(int); j = ((wz - z0) / G).astype(int)
    ok = (i >= 0) & (j >= 0) & (i < pin.shape[1]) & (j < pin.shape[0])
    inside = np.zeros(len(wx), bool); inside[ok] = pin[j[ok], i[ok]]
    inb = np.zeros(len(wx), bool); inb[ok] = pbuf[j[ok], i[ok]]
    A = len(wx) * w_cell * sx * sz; I = inside.sum() * w_cell * sx * sz
    Ob = (len(wx) - inb.sum()) * w_cell * sx * sz
    onr = np.zeros(len(wx), bool); onr[ok] = road[j[ok], i[ok]]
    Rd = onr.sum() * w_cell * sx * sz
    iou = I / (A + polyA - I) - lam * Ob / polyA - lamR * Rd / polyA
    return iou, A, I
best = None
if '--fixed' in a:
    sxs = [float(opt('fixed', '1,1').split(',')[0])]; szs = [float(opt('fixed', '1,1').split(',')[1])]
else:
    r = [float(v) for v in opt('sxr', '5,80').split(',')]; sxs = np.geomspace(r[0], r[1], 36)
    r = [float(v) for v in opt('szr', '5,80').split(',')]; szs = np.geomspace(r[0], r[1], 36)
for dt in np.arange(-dth, dth + 0.01, 2):
    th = th0 + math.radians(dt)
    for sx in sxs:
        for sz in szs:
            if max(sx / sz, sz / sx) > amax: continue
            iou, A, I = score(th, sx, sz, 0, 0)
            if not best or iou > best[0]: best = (iou, th, sx, sz, 0, 0)
# tinh chỉnh
iou, th, sx, sz, dx, dz = best
for it in range(3):
    for dt in np.arange(-2, 2.01, 0.5):
        for fx in np.linspace(0.94, 1.06, 7):
            for fz in np.linspace(0.94, 1.06, 7):
                for ddx in np.arange(-4, 4.1, 1):
                    for ddz in np.arange(-4, 4.1, 1):
                        t2, x2, z2 = th + math.radians(dt), sx * fx, sz * fz
                        if max(x2 / z2, z2 / x2) > amax or abs(t2 - th0) > math.radians(dth) + 1e-9: continue
                        r = score(t2, x2, z2, dx + ddx, dz + ddz)
                        if r[0] > iou: iou, th2, sx2, sz2, dx2, dz2 = r[0], t2, x2, z2, dx + ddx, dz + ddz; best = (iou, th2, sx2, sz2, dx2, dz2)
    iou, th, sx, sz, dx, dz = best
iou, A, I = score(th, sx, sz, dx, dz)
lamR0, lam0 = lamR, lam; lamR = 0; lam = 0; iou_raw = score(th, sx, sz, dx, dz)[0]
c, s_ = math.cos(th), math.sin(th); wx = cx0 + dx + LX * sx * c + LZ * sz * s_; wz = cz0 + dz - LX * sx * s_ + LZ * sz * c
ii = ((wx - x0) / G).astype(int); jj2 = ((wz - z0) / G).astype(int); ok = (ii >= 0) & (jj2 >= 0) & (ii < pin.shape[1]) & (jj2 < pin.shape[0])
roadM2 = road[jj2[ok], ii[ok]].sum() * w_cell * sx * sz
print('iou_raw', round(iou_raw, 3), 'roadM2', round(roadM2))
print(json.dumps({'glb': glb, 'key': key, 'iou': round(iou, 3), 'theta': round(th, 4), 'dthDeg': round(math.degrees(th - th0), 1), 'sx': round(sx, 2), 'sz': round(sz, 2),
                  'dx': dx, 'dz': dz, 'cx': round(cx0 + dx, 2), 'cz': round(cz0 + dz, 2), 'occM2': round(A), 'polyM2': round(polyA), 'outM2': round(A - I), 'lenX': round(sx * info['size'][0], 1), 'lenZ': round(sz * info['size'][2], 1), 'H@sx': round(sx * info['size'][1], 1)}))
