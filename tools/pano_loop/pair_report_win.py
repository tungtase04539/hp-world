# Đối chứng theo CẶP cùng pano cùng giám khảo: compare_v6_sol56 (trước) vs compare_v7_sol56 (sau)
import json, glob, os, collections

def load(d):
    out = {}
    for f in glob.glob(os.path.join(d, '*.json')):
        j = json.load(open(f, encoding='utf-8'))
        p = j.get('parsed')
        if p and p.get('score') is not None:
            out[j['id']] = p
    return out

A = load('compare_v6_sol56')
B = load('compare_v7_sol56')
common = sorted(set(A) & set(B))
if not common:
    print('chưa đủ dữ liệu'); raise SystemExit
da = [A[i]['score'] for i in common]
db = [B[i]['score'] for i in common]
print(f'cặp so được: {len(common)} pano (cùng giám khảo cx/gpt-5.6-sol-xhigh)')
print(f'TRƯỚC: TB {sum(da)/len(da):.2f}  |  SAU: TB {sum(db)/len(db):.2f}  |  DELTA {sum(db)/len(db)-sum(da)/len(da):+.2f}')
diffs = sorted(((B[i]["score"] - A[i]["score"], i) for i in common), reverse=True)
print('--- tăng nhiều nhất:')
for d, i in diffs[:8]: print(f'  {i}: {A[i]["score"]} -> {B[i]["score"]} ({d:+.1f})')
print('--- GIẢM (regression cần soi):')
for d, i in [x for x in diffs if x[0] < 0]: print(f'  {i}: {A[i]["score"]} -> {B[i]["score"]} ({d:+.1f})')
# cụm lỗi còn lại theo trọng số (bản SAU)
types = collections.Counter()
for i in common:
    for tf in B[i].get('top_fixes', []):
        types[tf.get('type', '?')] += tf.get('severity', 1)
print('--- cụm lỗi CÒN LẠI (sau):', dict(types.most_common()))
