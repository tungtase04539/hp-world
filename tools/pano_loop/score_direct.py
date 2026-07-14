# -*- coding: utf-8 -*-
# Scorer trực tiếp: gửi ảnh THẬT + GAME cho ChatGPT, lấy điểm 0-10. Dùng ask_gpt (đã chứng minh 9s/req).
# usage: python score_direct.py <list.json> <gamedir> <outdir> [headings=0,180]
import sys, os, json, re, base64, urllib.request
from concurrent.futures import ThreadPoolExecutor

REAL = r'C:\Users\Admin\hp-world\audit\550_pano_dai_trung_tam_hai_phong'
EP = 'http://localhost:20128/v1/chat/completions'
LIST = json.load(open(sys.argv[1]))
GAMEDIR = sys.argv[2]
OUT = sys.argv[3]
os.makedirs(OUT, exist_ok=True)
HEADS = [int(x) for x in (sys.argv[4].split(',') if len(sys.argv) > 4 else ['0', '180'])]

PROMPT = ("Ảnh 1 = Google Street View THẬT một phố Hải Phòng. Ảnh 2 = mô hình 3D MINH HỌA low-poly tái tạo CÙNG vị trí/hướng. "
          "Đây là mô hình MINH HỌA, KHÔNG nhằm giống ảnh chụp thật — TUYỆT ĐỐI KHÔNG trừ điểm vì phong cách low-poly, "
          "thiếu texture ảnh-thực, hay thiếu chi tiết nhỏ. Chấm mức ĐẠT của bản minh họa, thang 0-10, theo 3 tiêu chí ngang nhau: "
          "(1) ĐÚNG CẤU TRÚC — bố cục phố, vị trí & khối nhà, số tầng, đường/vỉa hè/cây khớp thực địa; "
          "(2) ĐÚNG MÀU SẮC — tông màu nhà/cây/đường gần đúng; "
          "(3) NHẬN DIỆN — nhìn vào có nhận ra đúng kiểu phố/đặc trưng Hải Phòng không. "
          "Mốc: 6 = minh họa TỐT, nhận ra được, đúng cấu trúc & màu cơ bản; 8 = rất khớp cấu trúc/màu; 3 = sai nhiều/khó nhận ra. "
          "Bỏ qua giao diện Google (bản đồ, thanh tìm kiếm). Trả lời DUY NHẤT 1 số thập phân, không giải thích.")

def b64(p):
    return base64.b64encode(open(p, 'rb').read()).decode()

def ask_score(real_path, game_path):
    content = [{"type": "text", "text": PROMPT},
               {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64(real_path)}"}},
               {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64(game_path)}"}}]
    body = json.dumps({"model": "cx/gpt-5.6-sol-xhigh", "messages": [{"role": "user", "content": content}]}).encode()
    req = urllib.request.Request(EP, data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer x"})
    r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    txt = r['choices'][0]['message']['content']
    m = re.search(r'(\d+(?:\.\d+)?)', txt)
    return float(m.group(1)) if m else None

def one(p):
    pid = p['id']
    scores = []
    for h in HEADS:
        hs = f'{h:03d}'
        rp = os.path.join(REAL, f'{pid}_h{hs}_p0.jpg')
        gp = os.path.join(GAMEDIR, f'{pid}_h{hs}.png')
        if not (os.path.exists(rp) and os.path.exists(gp)):
            continue
        try:
            s = ask_score(rp, gp)
            if s is not None:
                scores.append(s)
        except Exception as e:
            print(pid, hs, 'EXC', str(e)[:80], flush=True)
    if scores:
        avg = sum(scores) / len(scores)
        json.dump({'id': pid, 'score': avg, 'per_head': scores}, open(os.path.join(OUT, pid + '.json'), 'w'))
        print(pid, 'score=%.2f' % avg, flush=True)
        return pid, avg
    return pid, None

with ThreadPoolExecutor(max_workers=6) as ex:
    for _ in ex.map(one, LIST):
        pass
print('DIRECT_DONE', flush=True)
