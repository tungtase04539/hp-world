# -*- coding: utf-8 -*-
# Chấm CẤU TRÚC vệ tinh: game aerial (game_N.png) vs vệ tinh thật (real_N.png) qua ChatGPT.
# usage: python score_sat.py <dir audit/satellite>
import sys, os, json, re, base64, urllib.request
from concurrent.futures import ThreadPoolExecutor

D = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\Admin\hp-world\audit\satellite'
EP = 'http://localhost:20128/v1/chat/completions'
LABELS = {
 1: 'Tây-Nam: hồ Tam Bạc / BV Quốc tế / THPT Ngô Quyền',
 2: 'An Biên / Đền Nghè', 3: 'An Biên / ga / Nguyễn Bình Khiêm',
 4: 'Tây-Bắc: Lê Hồng Phong / Trần Văn Ơn / Nhà thờ / Tam Bạc arc',
 5: 'Nhà thờ / Tam Bạc arc', 6: 'Trung-Bắc: Nhà hát / Quang Trung / Minh Khai',
 7: 'Bắc: Bạch Đằng / cầu Lạc Long / sông Cấm tây', 8: 'Bắc: Hoàng Diệu / Cảng / sông Cấm đông',
}
PROMPT = ("Ảnh 1 = ảnh VỆ TINH THẬT (Google, nhìn thẳng từ trên xuống) một khu Hải Phòng. "
          "Ảnh 2 = mô hình 3D MINH HỌA low-poly nhìn TỪ TRÊN XUỐNG cùng khu, cùng khung. "
          "Chấm mức mô hình khớp CẤU TRÚC thực địa, thang 0-10. KHÔNG trừ vì phong cách low-poly/thiếu chi tiết. "
          "Xét 4 tiêu chí: (1) MẠNG ĐƯỜNG đúng vị trí/hướng/độ rộng; (2) SÔNG-HỒ đúng vị trí & hình; "
          "(3) VỊ TRÍ & MẬT ĐỘ nhà (kín/thưa có giống thật không); (4) CÔNG TRÌNH LỚN/công cộng/công viên đúng chỗ. "
          "Mốc: 6 = cấu trúc đúng cơ bản, nhận ra đúng khu; 8 = rất khớp; 3 = sai nhiều. "
          "Trả lời DUY NHẤT 1 số thập phân, không giải thích.")

def b64(p): return base64.b64encode(open(p, 'rb').read()).decode()

def one(n):
    rp = os.path.join(D, f'real_{n}.png'); gp = os.path.join(D, f'game_{n}.png')
    if not (os.path.exists(rp) and os.path.exists(gp)):
        print(f'tile {n}: THIẾU file', flush=True); return n, None
    content = [{"type": "text", "text": PROMPT},
               {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(rp)}"}},
               {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(gp)}"}}]
    body = json.dumps({"model": "cx/gpt-5.6-sol-xhigh", "messages": [{"role": "user", "content": content}]}).encode()
    req = urllib.request.Request(EP, data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer x"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=300).read())
        m = re.search(r'(\d+(?:\.\d+)?)', r['choices'][0]['message']['content'])
        s = float(m.group(1)) if m else None
        print(f'tile {n} [{LABELS[n]}] = {s}', flush=True); return n, s
    except Exception as e:
        print(f'tile {n}: EXC {str(e)[:80]}', flush=True); return n, None

with ThreadPoolExecutor(max_workers=4) as ex:
    res = dict(ex.map(one, range(1, 9)))
vals = [v for v in res.values() if v is not None]
if vals:
    print('\n=== ĐIỂM CẤU TRÚC VỆ TINH: TB %.2f/10 (n=%d) ===' % (sum(vals) / len(vals), len(vals)))
print('SAT_DONE', flush=True)
