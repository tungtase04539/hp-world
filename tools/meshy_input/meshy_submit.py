# -*- coding: utf-8 -*-
# Gửi ảnh -> Meshy image-to-3d (1 ảnh HOẶC multi-image 2-4 ảnh), poll, tải GLB, meshopt.
# Dùng:  python meshy_submit.py "img1.jpg,img2.jpg,img3.jpg" "<texture_prompt>" [tên_output]
#   - 1 ảnh  -> image_url  (mặt trước bas-relief; hông/lưng do AI đoán)
#   - 2-4 ảnh-> image_urls (đủ mặt; PHẢI cùng công trình + CÙNG buổi/nắng, các góc bổ sung nhau)
# KEY đọc từ env MESHY_API_KEY — KHÔNG hardcode, KHÔNG commit.
import sys, os, time, json, base64, urllib.request, subprocess, pathlib

KEY = os.environ.get('MESHY_API_KEY')
if not KEY:
    sys.exit('Thiếu MESHY_API_KEY trong env. `export MESHY_API_KEY=...` rồi chạy lại.')

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent                       # hp-world/
imgs = [s.strip() for s in sys.argv[1].split(',') if s.strip()]
prompt = sys.argv[2] if len(sys.argv) > 2 else ''
name = sys.argv[3] if len(sys.argv) > 3 else pathlib.Path(imgs[0]).stem
if not (1 <= len(imgs) <= 4):
    sys.exit('Cần 1–4 ảnh (Meshy tối đa 4).')

def data_uri(fn):
    p = HERE / fn
    if not p.exists():
        sys.exit(f'Không thấy ảnh: {p}')
    return 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode()

def api(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

uris = [data_uri(f) for f in imgs]
payload = {
    'ai_model': 'latest', 'topology': 'triangle',
    'target_polycount': 20000, 'should_remesh': True,
    'should_texture': True, 'enable_pbr': False,
}
if len(uris) == 1:
    payload['image_url'] = uris[0]
    endpoint = 'image-to-3d'
else:
    payload['image_urls'] = uris          # multi-view: model đủ mặt
    endpoint = 'multi-image-to-3d'        # multi-image có ENDPOINT RIÊNG
    print(f'  (multi-image: {len(uris)} góc)')
if prompt:
    payload['texture_prompt'] = prompt

print(f'[submit] {name} ...')
res = api('POST', f'https://api.meshy.ai/openapi/v1/{endpoint}', payload)
task = res.get('result') or res.get('id')
print('  task:', task)

glb_url = None
for i in range(80):                              # ~60 phút tối đa
    time.sleep(45)
    st = api('GET', f'https://api.meshy.ai/openapi/v1/{endpoint}/{task}')
    status = st.get('status'); prog = st.get('progress', 0)
    print(f'  [{i}] {status} {prog}%')
    if status == 'SUCCEEDED':
        glb_url = (st.get('model_urls') or {}).get('glb'); break
    if status in ('FAILED', 'CANCELED'):
        sys.exit(f'Task {status}: {st.get("task_error")}')
if not glb_url:
    sys.exit('Hết giờ chờ mà chưa SUCCEEDED.')

raw = ROOT / 'assets' / f'{name}_raw.glb'
out = ROOT / 'assets' / f'{name}.glb'
print('[download]', glb_url)
urllib.request.urlretrieve(glb_url, raw)
print('[meshopt]', out)
subprocess.run(['gltf-transform', 'meshopt', str(raw), str(out)], check=True, shell=(os.name == 'nt'))
raw.unlink(missing_ok=True)
print('XONG ->', out, '| đặt vào game theo KNOWLEDGE §5.5')
