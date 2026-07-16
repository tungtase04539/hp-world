# -*- coding: utf-8 -*-
# Gửi ảnh -> Meshy image-to-3d, poll tới SUCCEEDED, tải GLB, chạy gltf-transform meshopt.
# Dùng: python meshy_submit.py <ảnh trong tools/meshy_input/> "<texture_prompt>"
# KEY đọc từ env MESHY_API_KEY — KHÔNG hardcode, KHÔNG commit.
import sys, os, time, json, base64, urllib.request, subprocess, pathlib

KEY = os.environ.get('MESHY_API_KEY')
if not KEY:
    sys.exit('Thiếu MESHY_API_KEY trong env. `export MESHY_API_KEY=...` rồi chạy lại.')

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent                       # hp-world/
img = sys.argv[1]
prompt = sys.argv[2] if len(sys.argv) > 2 else ''
name = pathlib.Path(img).stem
img_path = HERE / img
if not img_path.exists():
    sys.exit(f'Không thấy ảnh: {img_path}')

def api(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

b64 = base64.b64encode(img_path.read_bytes()).decode()
payload = {
    'image_url': f'data:image/jpeg;base64,{b64}',
    'ai_model': 'latest', 'topology': 'triangle',
    'target_polycount': 20000, 'should_remesh': True,
    'should_texture': True, 'enable_pbr': False,
}
if prompt:
    payload['texture_prompt'] = prompt

print(f'[submit] {name} ...')
res = api('POST', 'https://api.meshy.ai/openapi/v1/image-to-3d', payload)
task = res.get('result') or res.get('id')
print('  task:', task)

glb_url = None
for i in range(80):                              # ~60 phút tối đa
    time.sleep(45)
    st = api('GET', f'https://api.meshy.ai/openapi/v1/image-to-3d/{task}')
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
subprocess.run(['npx', 'gltf-transform', 'meshopt', str(raw), str(out)], check=True, shell=(os.name=='nt'))
raw.unlink(missing_ok=True)
print('XONG ->', out, '| đặt vào game theo KNOWLEDGE §5.5')
