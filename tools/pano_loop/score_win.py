# Chấm 50 pano V1 bằng cx/gpt-5.5 (endpoint local) — rubric + schema y hệt tools/pano_loop/compare_panos.mjs
# usage: python score_v6.py <gamedir> <outdir>
import base64, json, os, sys, time, io
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

GAME = sys.argv[1] if len(sys.argv) > 1 else 'gamepano_v6'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'compare_v6'
EP = 'http://localhost:20128/v1'
MODEL = sys.argv[3] if len(sys.argv) > 3 else 'cx/gpt-5.6-sol-xhigh'
REAL = r'C:\Users\Admin\hp-world\audit\550_pano_dai_trung_tam_hai_phong'
HS = ['000', '090', '180', '270']
os.makedirs(OUT, exist_ok=True)
os.makedirs('realsmall', exist_ok=True)

LIST = json.load(open(sys.argv[4] if len(sys.argv) > 4 else 'list_v1_50.json'))
AUDIT = {a['id']: a for a in json.load(open(r'C:\Users\Admin\hp-world\audit\audit_done.json', encoding='utf-8'))}

SYS = ('Bạn là chuyên gia đối chiếu ảnh thực địa với thế giới game 3D low-poly "Hải Phòng 3D" '
       '(tái tạo 1:1 trung tâm TP Hải Phòng bằng Three.js từ dữ liệu OSM + Street View). '
       'MỤC TIÊU DỰ ÁN: game giống thực tế hết mức về CẤU TRÚC — đúng loại công trình, số tầng, vị trí, '
       'vỉa hè, cây, rào, đèn, biển hiệu; KHÔNG chấm điểm độ chân thực texture/style (low-poly là chủ đích). '
       'Xe cộ/người qua lại là động, bỏ qua. Ảnh Street View chụp 10/2024; game tái tạo trạng thái đó.')


def small_jpg(src, dst, width=640, q=68):
    if os.path.exists(dst):
        return dst
    im = Image.open(src).convert('RGB')
    im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, quality=q)
    return dst


def b64(f):
    return 'data:image/jpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode()


def call_model(messages):
    body = json.dumps({'model': MODEL, 'messages': messages}).encode()
    for a in range(4):
        try:
            req = urllib.request.Request(EP + '/chat/completions', data=body,
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer x'})
            r = json.loads(urllib.request.urlopen(req, timeout=600).read())
            if r.get('choices'):
                return r['choices'][0]['message']['content']
            print('ERR', json.dumps(r)[:200], flush=True)
        except Exception as e:
            print('EXC', str(e)[:150], flush=True)
        time.sleep(5 * (a + 1))
    return None


def one_pano(p):
    pid = p['id']
    out = os.path.join(OUT, pid + '.json')
    if os.path.exists(out):
        return pid, 'skip'
    # đợi đủ ảnh game (capture chạy song song)
    for _ in range(240):
        if all(os.path.exists(os.path.join(GAME, f'{pid}_h{h}.png')) for h in HS):
            break
        time.sleep(15)
    else:
        return pid, 'timeout_game'
    imgs = []
    for h in HS:
        rp = os.path.join(REAL, f'{pid}_h{h}_p0.jpg')
        if not os.path.exists(rp):
            return pid, 'no_real'
        imgs.append(small_jpg(rp, os.path.join('realsmall', f'{pid}_h{h}.jpg')))
    for h in HS:
        gp = os.path.join(GAME, f'{pid}_h{h}.png')
        imgs.append(small_jpg(gp, gp.replace('.png', '.jq.jpg')))
    a = AUDIT.get(pid, {})
    text = (f"PANO {pid} — tọa độ game (x={p['X']}, z={p['Z']}).\n"
            f"MÔ TẢ THỰC ĐỊA (đã catalog từ ảnh thật): {json.dumps(a, ensure_ascii=False)}\n"
            '8 ảnh theo thứ tự: THẬT h0 (nhìn Bắc), THẬT h90 (Đông), THẬT h180 (Nam), THẬT h270 (Tây), '
            'rồi GAME h0, GAME h90, GAME h180, GAME h270 — cùng vị trí cùng hướng.\n'
            'NHIỆM VỤ: so từng cặp heading, rồi tổng hợp. CHỈ trả về JSON đúng schema:\n'
            '{"headings":{"0":{"score":0-10,"missing":[],"wrong":[],"extra":[]},"90":{...},"180":{...},"270":{...}},\n'
            '"score":0-10 (tổng),\n'
            '"top_fixes":[{"what":"mô tả sửa gì cụ thể","type":"house|sidewalk|tree|rail|lamp|sign|water|road|landmark|other","severity":1-3,"heading":0|90|180|270}]}\n'
            'score 10 = cấu trúc khớp hoàn toàn. Ghi missing/wrong/extra NGẮN GỌN cụ thể '
            '(vd "thiếu dãy nhà ống 3-4 tầng bên trái", "vỉa hè caro nhưng thật là gạch xám"). '
            'Tối đa 6 mục top_fixes, ưu tiên severity cao.')
    content = [{'type': 'text', 'text': text}]
    for f in imgs:
        content.append({'type': 'image_url', 'image_url': {'url': b64(f)}})
    res = call_model([{'role': 'system', 'content': SYS}, {'role': 'user', 'content': content}])
    if not res:
        return pid, 'fail'
    parsed = None
    try:
        parsed = json.loads(res.strip().removeprefix('```json').removesuffix('```').strip())
    except Exception:
        pass
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'id': pid, 'X': p['X'], 'Z': p['Z'], 'raw': res, 'parsed': parsed}, fh, ensure_ascii=False, indent=1)
    return pid, ('ok score=%s' % (parsed or {}).get('score'))


with ThreadPoolExecutor(max_workers=3) as ex:
    for pid, st in ex.map(one_pano, LIST):
        print(pid, st, flush=True)
print('SCORE_DONE', flush=True)
