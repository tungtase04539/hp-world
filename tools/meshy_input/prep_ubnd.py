# -*- coding: utf-8 -*-
# UBND / Hôtel de Ville — chuẩn bị ảnh Meshy (đã theo review ChatGPT vòng 1).
#  giữ trời cream đồng đều; xoá chữ + cột cờ + bụi cây; crop ĐÚNG cả 2 cánh (x108..1240);
#  tô màu split-tone GIỮ CHI TIẾT (mái xám đá, tường kem trung tính).
from PIL import Image, ImageEnhance, ImageFilter
import numpy as np

im = Image.open('refs_raw/ubnd1.jpg').convert('RGB')
W,H = im.size
a = np.asarray(im).astype(np.float32)

# 1) Xoá chữ tiêu đề: copy trời sạch dưới chữ lên
band = a[88:97, :, :].mean(0)
for y in range(4, 82):
    for x in range(10, 572):
        a[y,x] = np.clip(band[x] + np.random.uniform(-2.5,2.5,3), 0, 255)

# 2) Xoá cột cờ — fit đo auto: xp = 534 + 0.123*(y-280). Clone TỪ TRÁI (louvers ngang bất biến
#    theo dịch ngang -> không nhoè cửa chớp)
for y in range(150, 518):
    xp = int(534 + 0.123*(y-280))
    for x in range(xp-6, xp+7):
        a[y,x] = a[y, xp-13]

# 2d) Xoá vệt dọc sót (đỉnh cột cờ) trong trời/mép tháp tại orig x~560, y6..152
for y in range(6, 152):
    src = a[y].copy()
    for x in range(548, 576):
        a[y,x] = np.clip(src[min(W-1, x+46)] + np.random.uniform(-2,2,3), 0, 255)

# 2e) Xoá vệt/đốm mờ sót trong trời góc PHẢI-TRÊN (clone trời sạch bên trái)
for y in range(8, 92):
    src = a[y].copy()
    for x in range(1108, 1230):
        a[y,x] = np.clip(src[x-120] + np.random.uniform(-2,2,3), 0, 255)

# 3) Xoá bụi/chậu cây tiền cảnh 2 bên bậc thềm (GIỮ bậc thềm giữa orig x566..662).
#    Clone nền plinth+đất từ CÁNH PHẢI sạch (dùng snapshot hàng -> không lan vệt).
for y in range(700, 900):
    src = a[y].copy()
    for x in range(322, 566):                    # cụm TRÁI
        a[y,x] = np.clip(src[min(W-1, x+540)] + np.random.uniform(-2,2,3), 0, 255)
    for x in range(662, 786):                    # cụm PHẢI + chậu
        a[y,x] = np.clip(src[min(W-1, x+322)] + np.random.uniform(-2,2,3), 0, 255)

# 3b) Xoá khối trắng sót plinth góc phải-dưới (orig x1136..1210, y816..874)
for y in range(814, 876):
    src = a[y].copy()
    for x in range(1136, 1210):
        a[y,x] = np.clip(src[x-118] + np.random.uniform(-2,2,3), 0, 255)

out = Image.fromarray(np.clip(a,0,255).astype(np.uint8))
# 4) Crop ĐÚNG: bỏ mảnh nhà kề TRÁI (crop x190) + hiên/tem PHẢI (x1232) + viền
out = out.crop((190, 6, 1232, 905))
out.save('work_ubnd_s1.png'); print('stage1', out.size)

# 5) Tô màu split-tone GIỮ CHI TIẾT: LUT hue theo tông + điều biến value theo luminance
g = np.asarray(out.convert('RGB')).astype(np.float32)
L = g.mean(2)
stops = [(0,(60,66,76)),(90,(122,124,126)),(150,(198,190,168)),(205,(226,220,200)),(255,(243,239,227))]
lut = np.zeros((256,3),np.float32)
for i in range(len(stops)-1):
    l0,c0=stops[i]; l1,c1=stops[i+1]
    for L_ in range(l0,l1+1):
        t=(L_-l0)/max(1,(l1-l0)); lut[L_]=[c0[k]*(1-t)+c1[k]*t for k in range(3)]
Li = np.clip(L,0,255).astype(int)
base = lut[Li]
# điều biến value nhẹ theo lệch luminance cục bộ (giữ độ tương phản chi tiết)
mod = np.clip(0.82 + 0.0016*L, 0.75, 1.12)[...,None]
col = np.clip(base*mod, 0, 255)
colimg = Image.fromarray(col.astype(np.uint8))
colimg = ImageEnhance.Contrast(colimg).enhance(1.05)
colimg = colimg.filter(ImageFilter.UnsharpMask(radius=2.4, percent=90, threshold=2))
colimg.save('work_ubnd_color.png'); print('stage2', colimg.size)
