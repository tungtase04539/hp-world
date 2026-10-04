// tools/qa/clearance_page.js — KIỂM TOÁN "KHÔNG GÌ CHẮN CAMERA PANO / LÒNG ĐƯỜNG / VỈA HÈ" (Đợt 3 W2-A).
// Tiêm vào trang bằng tools/qa/clearance.mjs (addInitScript); main.js được vá TẠM (page.route, chỉ trong QA) để gọi
// `await window.__hpPreFreeze(scene, world)` NGAY TRƯỚC world.freezeStatic → còn đủ tên vật thể (freeze gộp mất tên),
// geometry chưa bị nhả CPU (citygen RELEASE_CPU nhả khi upload GPU — ở đây chưa vẽ khung nào).
// Không import three: chỉ đọc mảng thuộc tính + matrixWorld. Không vẽ gì (chạy được cả trên SwiftShader).
//
// Kết quả window.__clearResult = {
//   cams: [{i,id,x,z,gh, near:[[tên,d]…], fill:[[h,frac,[[tên,px]…]]…], bad}] (chỉ cam vi phạm + tóm tắt),
//   onRoad: [{src, name, x, z, cls, frac?}]  vật tĩnh đứng trên NHỰA lòng đường (theo TAM GIÁC mặt đường ĐÃ PHÁT),
//   sidewalk: [{name, x, z, area, block, pen}] khối nhà lấn vỉa hè (diện tích, chặn kín = còn < 0,8 m lối đi),
//   stats }
// Định nghĩa vi phạm (spec W2-A): (a) lưới/mesh nhà/prop cách camera < 3 m (khoảng cách NGANG tới tam giác có phần
// ở độ cao 0,3-2,6 m trên mặt đất); (b) mesh đục lấp > 40% khung nhìn (FOV dọc 60°, 16:9, pitch −0,02) trong 6 m ở
// 1 trong 8 hướng 0..315°; (c) vật tĩnh có chân trên nhựa lòng đường; (d) khối nhà lấn vỉa hè.
(() => {
  const CFG = window.__clearCfg || {};
  window.__hpPreFreeze = async (scene, world) => {
    const T0 = performance.now();
    window.__clrScene = scene; window.__clrWorld = world;   // cho --eval (clearance.mjs) tra cứu sau kiểm toán
    const base = new URL('.', location.href).href;
    const { PANO_CAM } = await import(base + 'js/panoclear.js');
    const { groundHeight } = await import(base + 'js/terrain.js');
    const { ROADS_DT } = await import(base + 'js/mapdata.js');
    const XS = await import(base + 'js/xsection.js');
    let treeRecs = [];
    try { const T = await import(base + 'js/trees.js'); const s = T.treeSystem && T.treeSystem(); if (s && s.recs) treeRecs = s.recs; } catch (e) { console.warn('[clear] trees', e); }
    const ids = CFG.ids || [];
    const R_CAP = 7.2, NEAR = CFG.near || 3, FILL_D = CFG.fillD || 6, FILL_MAX = CFG.fillMax || 0.4;
    const EYE = 2.2;
    scene.updateMatrixWorld(true);

    // ---------- camera ----------
    const cams = PANO_CAM.map(([x, z], i) => ({ i, id: ids[i] || "cam" + i, x, z, gh: Math.max(groundHeight(x, z), 0), tri: [], obj: [] }));
    for (const [x, z, id] of CFG.probe || []) cams.push({ i: -1, id, x, z, probe: true, gh: Math.max(groundHeight(x, z), 0), tri: [], obj: [] });
    const CC = 16, camGrid = new Map();
    for (const c of cams) { const k = Math.floor(c.x / CC) * 100003 + Math.floor(c.z / CC); let a = camGrid.get(k); if (!a) camGrid.set(k, (a = [])); a.push(c); }
    const camsInBox = (x0, z0, x1, z1, pad, out) => {
      out.length = 0;
      for (let i = Math.floor((x0 - pad) / CC); i <= Math.floor((x1 + pad) / CC); i++)
        for (let j = Math.floor((z0 - pad) / CC); j <= Math.floor((z1 + pad) / CC); j++) {
          const a = camGrid.get(i * 100003 + j); if (!a) continue;
          for (const c of a) if (c.x >= x0 - pad && c.x <= x1 + pad && c.z >= z0 - pad && c.z <= z1 + pad) out.push(c);
        }
      return out;
    };

    // ---------- vật thể ----------
    const objs = [];   // {name, kind}
    const objIdx = new Map();
    const objId = (name, kind) => { const k = kind + '|' + name; let i = objIdx.get(k); if (i === undefined) { i = objs.length; objs.push({ name, kind }); objIdx.set(k, i); } return i; };
    const topOf = (o) => { let t = o; while (t.parent && t.parent !== scene) t = t.parent; return t; };
    const anon = (o) => { const m = o.isMesh ? o : null; if (!m) return '#' + o.type; const q = Array.isArray(m.material) ? m.material[0] : m.material; return '#' + (m.geometry.type || 'G').replace('Geometry', '') + ':' + (q && q.color ? q.color.getHexString() : '-') + ':' + m.geometry.attributes.position.count; };
    const nameOf = (top, m) => (top.name || (top === m ? anon(m) : anon(top) + '>' + (m.name || anon(m)))) + (top.userData && top.userData.__src ? '@L' + top.userData.__src : '');
    const visChain = (o) => { for (let p = o; p && p !== scene; p = p.parent) if (!p.visible) return false; return true; };
    const EXCL = /^(bridge_group|ground|water|roads_|sidewalk_|lake|tree_pits|props_lamp_pools|props_cables|props_people|props_bikes_far|props_cars_far|props_furniture_far|props_lamp_glow|traffic_signal_lamps|aerial|sky|trees_|hero_trees|rail)|_ground$|ground_/i;
    const exclName = (o) => { for (let p = o; p && p !== scene; p = p.parent) if (p.name && EXCL.test(p.name)) return true; return false; };
    const kept = new Set((world.cellKept || []).map((k) => k.name).filter(Boolean));
    const rbGrid = world.rbGrid;
    const fabAt = (x, z) => {
      if (!rbGrid) return -1;
      let b = rbGrid.at(x, z); if (b >= 0) return b;
      for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]) { b = rbGrid.at(x + dx, z + dz); if (b >= 0) return b; }
      return -1;
    };
    const tmpC = [];
    const E = new Float32Array(16);
    const mul = (a, b, out) => {   // out = a·b (cột chính)
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return out;
    };
    let nTri = 0, nMesh = 0;
    // ghi tam giác (toạ độ thế giới) vào mọi camera trong R_CAP
    const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, id) => {
      // tam giác suy biến (mảnh đã bị gỡ bằng cách thu đỉnh về 1 điểm, ma trận instance 0) — không vẽ, bỏ qua
      if (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz) < 1e-6 && Math.abs(ax - cx) + Math.abs(ay - cy) + Math.abs(az - cz) < 1e-6) return;
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      camsInBox(x0, z0, x1, z1, R_CAP, tmpC);
      if (!tmpC.length) return;
      const y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
      for (const c of tmpC) {
        if (y1 < c.gh + 0.35 || y0 > c.gh + EYE + 4.2) continue;   // thấp (bó vỉa, luống) / quá cao
        c.tri.push(ax, ay, az, bx, by, bz, cx, cy, cz); c.obj.push(id); nTri++;
      }
    };
    const P = new Float32Array(9);
    function meshTris(m, me, id, varSel) {
      const g = m.geometry, pos = g.attributes.position, idx = g.index;
      const aVar = varSel !== undefined && g.attributes.aVar ? g.attributes.aVar : null;
      const n = idx ? idx.count : pos.count;
      const fab = /^fab_/.test(m.name);
      for (let t = 0; t + 2 < n; t += 3) {
        let skip = false;
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(t + k) : t + k;
          if (aVar && k === 0 && Math.round(aVar.getX(vi)) !== varSel) { skip = true; break; }
          const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
          P[k * 3] = me[0] * x + me[4] * y + me[8] * z + me[12];
          P[k * 3 + 1] = me[1] * x + me[5] * y + me[9] * z + me[13];
          P[k * 3 + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
        }
        if (skip) continue;
        let oid = id;
        if (fab) { const b = fabAt((P[0] + P[3] + P[6]) / 3, (P[2] + P[5] + P[8]) / 3); oid = objId('fab#' + b, 'fab'); }
        pushTri(P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], P[8], oid);
      }
    }
    const bbW = (bb, me, out) => {   // hộp thế giới của bbox local
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let k = 0; k < 8; k++) {
        const x = k & 1 ? bb.max.x : bb.min.x, y = k & 2 ? bb.max.y : bb.min.y, z = k & 4 ? bb.max.z : bb.min.z;
        const X = me[0] * x + me[4] * y + me[8] * z + me[12], Y = me[1] * x + me[5] * y + me[9] * z + me[13], Z = me[2] * x + me[6] * y + me[10] * z + me[14];
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
      out.x0 = x0; out.x1 = x1; out.z0 = z0; out.z1 = z1; out.y0 = y0; out.y1 = y1; return out;
    };
    const BB = {};
    const meshesAll = [];
    scene.traverse((m) => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      if (!visChain(m) || (m.layers.mask & 3) === 0) return;
      meshesAll.push(m);
    });
    for (const m of meshesAll) {
      if (exclName(m)) continue;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((q) => q && q.transparent && q.opacity < 0.35)) continue;
      if (mats.every((q) => q && q.colorWrite === false)) continue;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const top = topOf(m);
      const tname = nameOf(top, m);
      const kind = /^props_/.test(m.name) ? 'prop' : /^fab_/.test(m.name) ? 'fab' : kept.has(top.name) ? 'cellKept' : 'obj';
      const id = objId(kind === 'prop' ? m.name : tname + (m.name && m.name !== tname ? '/' + m.name : ''), kind);
      nMesh++;
      if (m.isInstancedMesh) {
        const im = m.instanceMatrix.array, iv = g.attributes.iVar;
        for (let i = 0; i < m.count; i++) {
          if (!im[i * 16 + 15]) continue;   // ma trận 0 = instance đã gỡ
          mul(m.matrixWorld.elements, im.subarray(i * 16, i * 16 + 16), E);
          bbW(g.boundingBox, E, BB);
          if (!camsInBox(BB.x0, BB.z0, BB.x1, BB.z1, R_CAP, tmpC).length) continue;
          meshTris(m, E, id, iv ? Math.round(iv.getX(i)) : undefined);
        }
      } else {
        bbW(g.boundingBox, m.matrixWorld.elements, BB);
        if (!camsInBox(BB.x0, BB.z0, BB.x1, BB.z1, R_CAP, tmpC).length) continue;
        meshTris(m, m.matrixWorld.elements, id);
      }
    }
    // thân cây (InstancedMesh cây chưa có instance trước khung đầu): lăng trụ 8 cạnh r 0,32 m cao 3,2 m
    for (const r of treeRecs) {
      camsInBox(r.x, r.z, r.x, r.z, R_CAP, tmpC); if (!tmpC.length) continue;
      const id = objId('tree@' + r.x.toFixed(1) + ',' + r.z.toFixed(1), 'tree'), rr = 0.32, h = 3.2;
      for (let k = 0; k < 8; k++) {
        const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2;
        const x0 = r.x + Math.cos(a0) * rr, z0 = r.z + Math.sin(a0) * rr, x1 = r.x + Math.cos(a1) * rr, z1 = r.z + Math.sin(a1) * rr;
        pushTri(x0, r.y, z0, x1, r.y, z1, x1, r.y + h, z1, id); pushTri(x0, r.y, z0, x1, r.y + h, z1, x0, r.y + h, z0, id);
      }
    }
    const tCollect = performance.now();

    // ---------- (a) gần < 3 m, (b) lấp khung trong 6 m ----------
    const W = CFG.w || 64, H = CFG.h || 36, tanV = Math.tan(30 * Math.PI / 180), tanH = tanV * 16 / 9, PITCH = -0.02;
    const depth = new Float32Array(W * H), pid = new Int32Array(W * H);
    const HEADS = [0, 45, 90, 135, 180, 225, 270, 315];
    const out = [];
    let QX = 0, QZ = 0;   // điểm gần nhất của lần gọi d2tri cuối
    const d2tri = (px, pz, a, b, c, T) => {   // khoảng cách NGANG từ điểm tới hình chiếu XZ tam giác
      const ax = T[a], az = T[a + 2], bx = T[b], bz = T[b + 2], cx = T[c], cz = T[c + 2];
      const s1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), s2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx), s3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) { QX = px; QZ = pz; return 0; }
      let best = 1e9;
      const sd = (x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = x1 + t * dx, qz = z1 + t * dz, d = Math.hypot(px - qx, pz - qz); if (d < best) { best = d; QX = qx; QZ = qz; } };
      sd(ax, az, bx, bz); sd(bx, bz, cx, cz); sd(cx, cz, ax, az);
      return best;
    };
    const V = [];   // đỉnh sau cắt mặt phẳng gần: [sx, sy, z]
    const clipNear = (A, B, C, zn) => {
      V.length = 0;
      const pts = [A, B, C];
      for (let i = 0; i < 3; i++) {
        const p = pts[i], q = pts[(i + 1) % 3];
        const pin = p[2] >= zn, qin = q[2] >= zn;
        if (pin) V.push(p);
        if (pin !== qin) { const t = (zn - p[2]) / (q[2] - p[2]); V.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, zn]); }
      }
      return V;
    };
    const proj = (v) => [(v[0] / v[2] / tanH * 0.5 + 0.5) * W, (0.5 - v[1] / v[2] / tanV * 0.5) * H, v[2]];
    const raster = (a, b, c, id) => {
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) return;
      const ia = 1 / a[2], ib = 1 / b[2], ic = 1 / c[2];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = 1 / (w0 * ia + w1 * ib + w2 * ic);
        const p = y * W + x;
        if (z < depth[p]) { depth[p] = z; pid[p] = id; }
      }
    };
    const summ = { cams: cams.length, near: 0, nearAll: 0, fillCorr: 0, fillAll: 0, bad: 0 };
    const surfAt = world.roadNet && world.roadNet.surfaceAt;
    const FILL_C = CFG.fillCorr || 0.2;
    // điểm chạm lùi SÂU thêm DEEP m theo tia: hợp đồng WP1 cho footprint lấn facadeLine ≤ 0,3 m → 0,6 m để mặt tiền hợp lệ
    // (và mép đa giác vỉa hè vẽ hơi rộng hơn giải tích) không bị tính là lấn phố
    const DEEP = CFG.deep || 0.6;
    for (const c of cams) {
      const T = c.tri, O = c.obj, nT = O.length;
      const ex = c.x, ey = c.gh + EYE, ez = c.z;
      // (a) gần
      // nearAll = đúng chữ spec (mọi mesh < 3 m); near = đã loại MẶT NHÀ đứng sau facadeLine khi camera nằm trong hành lang
      // phố (camera trên vỉa hè/phố hẹp do lệch dữ liệu — nhà thật đúng chỗ): nhà chỉ tính khi điểm gần nhất lùi sâu 0,3 m
      // vẫn trên lòng/vỉa hè đã vẽ (roadNet.surfaceAt > 0) hoặc camera ngoài hành lang. Đồ phố/cây: luôn tính.
      const nearBy = new Map(), nearAllBy = new Map();
      const camIn = surfAt ? surfAt(ex, ez) > 0 : false;
      for (let t = 0; t < nT; t++) {
        const o = t * 9, y0 = Math.min(T[o + 1], T[o + 4], T[o + 7]), y1 = Math.max(T[o + 1], T[o + 4], T[o + 7]);
        if (y1 < c.gh + 0.3 || y0 > c.gh + 2.6) continue;
        const d = d2tri(ex, ez, o, o + 3, o + 6, T);
        if (d >= NEAR) continue;
        const id = O[t], k = objs[id].kind;
        { const cur = nearAllBy.get(id); if (cur === undefined || d < cur) nearAllBy.set(id, d); }
        const bldg = k === 'fab' || k === 'cellKept' || (k === 'obj' && y1 - y0 > 2.0);
        if (bldg && camIn && d > 0.05) {
          const qx = QX + (QX - ex) / d * DEEP, qz = QZ + (QZ - ez) / d * DEEP;
          if (!(surfAt(qx, qz) > 0)) continue;
        }
        const cur = nearBy.get(id); if (cur === undefined || d < cur) nearBy.set(id, d);
      }
      const near = [...nearBy.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([id, d]) => [objs[id].name, objs[id].kind, +d.toFixed(2)]);
      const nearAll = [...nearAllBy.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id, d]) => [objs[id].name, objs[id].kind, +d.toFixed(2)]);
      // (b) lấp khung
      const fills = [];
      let worst = 0, worstC = 0;
      for (const h of HEADS) {
        const hr = h * Math.PI / 180, cp = Math.cos(PITCH);
        const dx = Math.sin(hr) * cp, dy = Math.sin(PITCH), dz = -Math.cos(hr) * cp;
        // phải = d × lên(0,1,0) = (−dz, 0, dx)/|..|; lên' = phải × d
        let rx = -dz, rz = dx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
        const ux = -rz * dy, uy = rz * dx - rx * dz, uz = rx * dy;   // (rx,0,rz) × (dx,dy,dz)
        depth.fill(1e9); pid.fill(-1);
        for (let t = 0; t < nT; t++) {
          const o = t * 9; const cs = [];
          let anyIn = false, allFar = true;
          for (let k = 0; k < 3; k++) {
            const vx = T[o + k * 3] - ex, vy = T[o + k * 3 + 1] - ey, vz = T[o + k * 3 + 2] - ez;
            const zc = vx * dx + vy * dy + vz * dz;
            cs.push([vx * rx + vz * rz, vx * ux + vy * uy + vz * uz, zc]);
            if (zc >= 0.3) anyIn = true; if (zc < FILL_D) allFar = false;
          }
          if (!anyIn || allFar) continue;
          const poly = clipNear(cs[0], cs[1], cs[2], 0.3);
          if (poly.length < 3) continue;
          const pp = poly.map(proj);
          for (let k = 1; k + 1 < pp.length; k++) raster(pp[0], pp[k], pp[k + 1], O[t]);
        }
        let cov = 0, corr = 0; const per = new Map(), perC = new Map();
        for (let p = 0; p < W * H; p++) {
          if (depth[p] > FILL_D) continue;
          cov++; per.set(pid[p], (per.get(pid[p]) || 0) + 1);
          // điểm chạm (lùi SÂU thêm 0,3 m theo tia) nằm trong HÀNH LANG PHỐ (lòng/vỉa hè/nút giao theo roadNet) và thấp
          // hơn 2,7 m trên nền → vật LẤN phố (mặt tiền đúng chỗ ở facadeLine thì điểm sâu hơn nằm ngoài hành lang)
          const xn = ((p % W) + 0.5) / W * 2 - 1, yn = 1 - (Math.floor(p / W) + 0.5) / H * 2;
          const vx = rx * xn * tanH + ux * yn * tanV + dx, vy = uy * yn * tanV + dy, vz = rz * xn * tanH + uz * yn * tanV + dz;
          const t2 = depth[p] + DEEP / Math.hypot(vx, vy, vz);
          const hx = ex + vx * depth[p], hy = ey + vy * depth[p], hz = ez + vz * depth[p];
          if (hy > c.gh + 2.7) continue;
          const sA = surfAt ? surfAt(ex + vx * t2, ez + vz * t2) : 0;
          if (sA > 0 || Math.hypot(hx - ex, hz - ez) < NEAR) { corr++; perC.set(pid[p], (perC.get(pid[p]) || 0) + 1); }
        }
        const frac = cov / (W * H), fc = corr / (W * H);
        if (frac > worst) worst = frac;
        if (fc > worstC) worstC = fc;
        if (frac > 0.12) fills.push([h, +frac.toFixed(3), [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => [objs[id].name, objs[id].kind, +(n / (W * H)).toFixed(3)]),
          +fc.toFixed(3), [...perC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, n]) => [objs[id].name, objs[id].kind, +(n / (W * H)).toFixed(3)])]);
      }
      const badNear = !c.probe && near.length > 0, badFill = !c.probe && worstC > FILL_C;
      if (!c.probe && nearAll.length) summ.nearAll++;
      if (!c.probe) { if (badNear) summ.near++; if (badFill) summ.fillCorr++; if (worst > FILL_MAX) summ.fillAll++; if (badNear || badFill) summ.bad++; }
      out.push({ i: c.i, id: c.id, x: c.x, z: c.z, gh: +c.gh.toFixed(2), worst: +worst.toFixed(3), worstC: +worstC.toFixed(3), near, nearAll, fill: fills, bad: badNear || badFill, probe: !!c.probe });
      // mặt bằng gỡ lỗi cho cam vi phạm: bao lồi XZ từng vật thể (tam giác trong R_CAP)
      if ((badNear || badFill || c.probe || CFG.plans) && CFG.plan !== false) {
        const per = new Map();
        for (let t = 0; t < nT; t++) { const id = O[t]; let a = per.get(id); if (!a) per.set(id, (a = { p: [], y0: 1e9, y1: -1e9 })); for (let k = 0; k < 3; k++) { a.p.push([T[t * 9 + k * 3], T[t * 9 + k * 3 + 2]]); const y = T[t * 9 + k * 3 + 1]; if (y < a.y0) a.y0 = y; if (y > a.y1) a.y1 = y; } }
        const hull2 = (pts) => { if (pts.length < 3) return pts; const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } lo.pop(); up.pop(); return lo.concat(up); };
        out[out.length - 1].plan = [...per.entries()].map(([id, a]) => ({ n: objs[id].name, k: objs[id].kind, y: [+(a.y0 - c.gh).toFixed(1), +(a.y1 - c.gh).toFixed(1)], h: hull2(a.p).map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]) }));
      }
      c.tri = null; c.obj = null;
    }
    const tCams = performance.now();

    // ---------- (c) vật tĩnh trên nhựa: mặt đường THẬT = tam giác mặt trên đã phát của roads_*/sidewalk_* ----------
    const RG = new Map(), RC = 4, rtri = [];
    for (const m of meshesAll) {
      const isRoad = /^roads_/.test(m.name), isSw = /^sidewalk_/.test(m.name);
      if (!isRoad && !isSw) continue;
      const g = m.geometry, pos = g.attributes.position, idx = g.index, sf = g.attributes.aSurf, me = m.matrixWorld.elements;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < n; t += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
        const p = v.map((vi) => [pos.getX(vi) + me[12], pos.getY(vi) + me[13], pos.getZ(vi) + me[14]]);
        const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2], vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
        const ny = uz * vx - ux * vz, nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
        if (!nl || Math.abs(ny) < 0.6 * nl) continue;   // chỉ mặt nằm
        const L = sf ? Math.round(sf.getX(v[0])) : 0;
        const cls = isRoad ? (L === 0 ? 'A' : L === 1 ? 'C' : 'A') : (L === 6 ? 'K' : 'S');
        const ti = rtri.length;
        rtri.push({ x: [p[0][0], p[1][0], p[2][0]], z: [p[0][2], p[1][2], p[2][2]], y: (p[0][1] + p[1][1] + p[2][1]) / 3, cls });
        const x0 = Math.min(...rtri[ti].x), x1 = Math.max(...rtri[ti].x), z0 = Math.min(...rtri[ti].z), z1 = Math.max(...rtri[ti].z);
        for (let i = Math.floor(x0 / RC); i <= Math.floor(x1 / RC); i++) for (let j = Math.floor(z0 / RC); j <= Math.floor(z1 / RC); j++) {
          const k = i * 100003 + j; let a = RG.get(k); if (!a) RG.set(k, (a = [])); a.push(ti);
        }
      }
    }
    const surfCls = (x, z) => {   // lớp mặt CAO NHẤT tại (x,z): 'A' nhựa · 'C' bê tông ngõ · 'S' vỉa hè · 'K' bó vỉa · '' ngoài
      const a = RG.get(Math.floor(x / RC) * 100003 + Math.floor(z / RC)); if (!a) return '';
      let best = '', by = -1e9;
      for (const ti of a) {
        const T = rtri[ti], X = T.x, Z = T.z;
        const s1 = (X[1] - X[0]) * (z - Z[0]) - (Z[1] - Z[0]) * (x - X[0]), s2 = (X[2] - X[1]) * (z - Z[1]) - (Z[2] - Z[1]) * (x - X[1]), s3 = (X[0] - X[2]) * (z - Z[2]) - (Z[0] - Z[2]) * (x - X[2]);
        if (!((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0))) continue;
        if (T.y > by) { by = T.y; best = T.cls; }
      }
      return best;
    };
    window.__clearSurf = surfCls;
    // đường quanh cam vi phạm (tam giác mặt trên đã phát trong 16 m) cho mặt bằng gỡ lỗi
    for (const c of out) {
      if (!c.plan) continue;
      const seen = new Set(), rr = [];
      for (let i = Math.floor((c.x - 16) / RC); i <= Math.floor((c.x + 16) / RC); i++) for (let j = Math.floor((c.z - 16) / RC); j <= Math.floor((c.z + 16) / RC); j++) {
        const a = RG.get(i * 100003 + j); if (!a) continue;
        for (const ti of a) { if (seen.has(ti)) continue; seen.add(ti); const T = rtri[ti]; rr.push([T.cls, ...T.x.map((x, k) => [+x.toFixed(2), +T.z[k].toFixed(2)])]); }
      }
      c.roads = rr;
    }
    const onRoad = [];
    const roadCls = CFG.roadCls || 'A';
    // dải phân cách (mesh tên *median*) là đồ ĐÚNG trên lòng → mọi vật trong 3 m quanh nó (cây xà cừ dải phân cách,
    // collider cây, bụi) không tính "trên lòng đường"
    const MG = new Map();
    for (const m of meshesAll) {
      if (!/median/i.test(m.name || '') && !(m.parent && /median/i.test(m.parent.name || ''))) continue;
      const e = m.matrixWorld.elements, k = Math.floor(e[12] / 8) * 100003 + Math.floor(e[14] / 8);
      let a = MG.get(k); if (!a) MG.set(k, (a = [])); a.push(e[12], e[14]);
    }
    const nearMedian = (x, z) => { const ci = Math.floor(x / 8), cj = Math.floor(z / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = MG.get(i * 100003 + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < 9) return true; } return false; };
    const isRoadK0 = (k) => !!k && roadCls.includes(k);
    let medianSkip = 0;
    const isRoadAt = (k, x, z) => { if (!isRoadK0(k)) return false; if (nearMedian(x, z)) { medianSkip++; return false; } return true; };
    const isRoadK = isRoadK0;
    // (c1) collider tròn nhỏ (cây/cột/đèn/thùng/…)
    const carG = new Map();
    for (const pc of (world.props && world.props.parkedCars) || []) { const k = Math.floor(pc.x / 8) * 100003 + Math.floor(pc.z / 8); let a = carG.get(k); if (!a) carG.set(k, (a = [])); a.push(pc); }
    const nearCar = (x, z) => { const ci = Math.floor(x / 8), cj = Math.floor(z / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = carG.get(i * 100003 + j); if (!a) continue; for (const pc of a) if ((pc.x - x) ** 2 + (pc.z - z) ** 2 < 3.5 * 3.5) return true; } return false; };
    for (const c of world.colliders || []) {
      if (c.x > 1e6 || c.r > 3 || nearCar(c.x, c.z)) continue;
      const k = surfCls(c.x, c.z); if (isRoadAt(k, c.x, c.z)) onRoad.push({ src: 'collider', name: 'r' + c.r.toFixed(2), x: +c.x.toFixed(1), z: +c.z.toFixed(1), cls: k });
    }
    // (c2) cây
    for (const r of treeRecs) { const k = surfCls(r.x, r.z); if (isRoadAt(k, r.x, r.z)) onRoad.push({ src: 'tree', name: 'sp' + r.sp, x: +r.x.toFixed(1), z: +r.z.toFixed(1), cls: k }); }
    // (c3) props (trừ ô tô: đỗ trong lòng là đúng; người)
    const PL = (window.__hpProps && window.__hpProps.lists) || {};
    for (const key of Object.keys(PL)) {
      if (key === 'cars' || key === 'walkI' || key === 'standI' || key === 'sitI') continue;
      for (const it of PL[key] || []) { const k = surfCls(it.x, it.z); if (isRoadAt(k, it.x, it.z)) onRoad.push({ src: 'props.' + key, name: key + (it.v !== undefined ? ':' + it.v : ''), x: +it.x.toFixed(1), z: +it.z.toFixed(1), cls: k }); }
    }
    // (c4) mọi vật thể cấp cao nhất khác (cell/streetscape/địa danh thủ tục…): đỉnh CHÂN (≤ mặt đất + 0,45 m), gom theo
    //      ô 2 m × vật thể cấp cao nhất (mesh gộp nhiều bản sao trải cả thành phố → từng cụm chân riêng)
    const ghC = new Map();
    const ghAt = (x, z) => { const k = Math.floor(x) * 100003 + Math.floor(z); let v = ghC.get(k); if (v === undefined) { v = groundHeight(Math.floor(x) + 0.5, Math.floor(z) + 0.5); ghC.set(k, v); } return v; };
    const cl = new Map();
    for (const m of meshesAll) {
      if (exclName(m) || /^(props_|fab_|traffic_)/.test(m.name) || /median/i.test(m.name || "") || /median/i.test(topOf(m).name || "")) continue;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const top = topOf(m);
      const pos = g.attributes.position;
      if (m.isInstancedMesh) {
        const im = m.instanceMatrix.array;
        for (let i = 0; i < m.count; i++) {
          if (!im[i * 16 + 15]) continue;
          mul(m.matrixWorld.elements, im.subarray(i * 16, i * 16 + 16), E);
          const x = E[12], z = E[14], k = surfCls(x, z);
          if (isRoadAt(k, x, z)) onRoad.push({ src: 'inst', name: (top.name || m.name || '?') + '#' + i, x: +x.toFixed(1), z: +z.toFixed(1), cls: k });
        }
        continue;
      }
      const me = m.matrixWorld.elements;
      bbW(g.boundingBox, me, BB);
      if (BB.y1 - BB.y0 < 0.3) continue;            // mảng phẳng (nền sân, vạch) không chắn
      const nm = nameOf(top, m);
      const step = Math.max(1, Math.floor(pos.count / 3000));
      // chỉ đỉnh CÒN được chỉ số tham chiếu (mảnh gỡ bằng dựng lại index vẫn để đỉnh trong buffer)
      let used = null;
      if (g.index) { used = new Uint8Array(pos.count); const ix = g.index; for (let q = 0; q < ix.count; q++) used[ix.getX(q)] = 1; }
      for (let vi = 0; vi < pos.count; vi += step) {
        if (used && !used[vi]) continue;
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        const X = me[0] * x + me[4] * y + me[8] * z + me[12], Y = me[1] * x + me[5] * y + me[9] * z + me[13], Z = me[2] * x + me[6] * y + me[10] * z + me[14];
        if (Y > ghAt(X, Z) + 0.45) continue;
        const key = nm + '|' + Math.floor(X / 2) + ',' + Math.floor(Z / 2);
        let r = cl.get(key); if (!r) cl.set(key, (r = { name: nm, mesh: m.name || '', n: 0, A: 0, x: 0, z: 0 }));
        const k = surfCls(X, Z); r.n++; if (isRoadK(k)) r.A++; r.x += X; r.z += Z;
      }
    }
    for (const r of cl.values()) {
      if (r.n < 2 || r.A / r.n < 0.5) continue;
      onRoad.push({ src: 'obj', name: r.name, mesh: r.mesh, x: +(r.x / r.n).toFixed(1), z: +(r.z / r.n).toFixed(1), cls: 'A', frac: +(r.A / r.n).toFixed(2), n: r.n });
    }
    // ---------- (d) khối nhà lấn vỉa hè: ô 0,5 m dưới bao lồi từng mesh khối (cao ≥ 2,5 m, ≥ 1,2 m mỗi chiều) ----------
    const SWW = XS.SIDEWALK_W, HW = XS.ROAD_HW;
    const segIdx = new Map(), SC2 = 16, segs = [];
    ROADS_DT.forEach((rd) => { if (!(SWW[rd.c] > 0)) return; for (let i = 0; i + 1 < rd.pts.length; i++) { const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1]; const s = { ax, az, bx, bz, c: rd.c }; const id = segs.length; segs.push(s); const pad = HW[rd.c] + SWW[rd.c] + 2; for (let gi = Math.floor((Math.min(ax, bx) - pad) / SC2); gi <= Math.floor((Math.max(ax, bx) + pad) / SC2); gi++) for (let gj = Math.floor((Math.min(az, bz) - pad) / SC2); gj <= Math.floor((Math.max(az, bz) + pad) / SC2); gj++) { const k = gi * 100003 + gj; let a = segIdx.get(k); if (!a) segIdx.set(k, (a = [])); a.push(id); } } });
    const swPen = (x, z) => {   // độ lấn vào vỉa hè (m, tính từ mặt tiền facadeLine vào trong) của phố gần nhất có vỉa
      const a = segIdx.get(Math.floor(x / SC2) * 100003 + Math.floor(z / SC2)); if (!a) return null;
      let best = null;
      for (const id of a) { const s = segs[id], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1; let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(x - s.ax - t * dx, z - s.az - t * dz); const fl = HW[s.c] + SWW[s.c]; if (d < fl && (!best || fl - d > best.pen)) best = { pen: fl - d, sw: SWW[s.c], c: s.c }; }
      return best;
    };
    const sidewalk = [];
    const swByTop = new Map();
    for (const m of meshesAll) {
      if (m.isInstancedMesh || exclName(m) || /^(props_|traffic_|fab_)/.test(m.name)) continue;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      bbW(g.boundingBox, m.matrixWorld.elements, BB);
      if (BB.y1 - BB.y0 < 2.5 || BB.x1 - BB.x0 < 1.2 || BB.z1 - BB.z0 < 1.2) continue;
      if ((BB.x1 - BB.x0) * (BB.z1 - BB.z0) > 3e4) continue;
      const top = topOf(m);
      // bao lồi 8 góc bbox (gần đúng hộp xoay)
      const me = m.matrixWorld.elements, bb = g.boundingBox, H8 = [];
      for (let k = 0; k < 8; k++) { const x = k & 1 ? bb.max.x : bb.min.x, y = k & 2 ? bb.max.y : bb.min.y, z = k & 4 ? bb.max.z : bb.min.z; H8.push([me[0] * x + me[4] * y + me[8] * z + me[12], me[2] * x + me[6] * y + me[10] * z + me[14]]); }
      const inside = (px, pz) => { // điểm trong bao lồi (thô: kiểm hình bình hành 4 góc đáy = H8[0,1,5,4])
        const Q = [H8[0], H8[1], H8[5], H8[4]]; let s = 0;
        for (let i = 0; i < 4; i++) { const a = Q[i], b = Q[(i + 1) % 4]; const cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]); if (cr !== 0) { if (!s) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } }
        return true;
      };
      let rec = swByTop.get(top);
      // mesh lớn (thường là mesh GỘP nhiều vật: dãy cột đèn, tường + trụ…) → hộp bao trùm cả khoảng trống giữa chúng; dùng
      // ô 0,5 m dưới các MẶT NẰM cao ≥ đáy + 1,5 m (mái/đỉnh — như cellsink.rasterUp) thay cho hộp
      let cells = null;
      if ((BB.x1 - BB.x0) * (BB.z1 - BB.z0) > 150) {
        cells = new Set();
        const pos = g.attributes.position, ix = g.index, n = ix ? ix.count : pos.count;
        const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let t = 0; t + 2 < n; t += 3) {
          for (let k = 0; k < 3; k++) { const vi = ix ? ix.getX(t + k) : t + k; const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi); P[k * 3] = me[0] * x + me[4] * y + me[8] * z + me[12]; P[k * 3 + 1] = me[1] * x + me[5] * y + me[9] * z + me[13]; P[k * 3 + 2] = me[2] * x + me[6] * y + me[10] * z + me[14]; }
          if (Math.min(P[1], P[4], P[7]) < BB.y0 + 1.5) continue;
          const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
          const ny = uz * vx - ux * vz, nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
          if (!nl || Math.abs(ny) < 0.5 * nl) continue;
          const tx0 = Math.min(P[0], P[3], P[6]), tx1 = Math.max(P[0], P[3], P[6]), tz0 = Math.min(P[2], P[5], P[8]), tz1 = Math.max(P[2], P[5], P[8]);
          for (let x = Math.floor(tx0 * 2) / 2 + 0.25; x < tx1; x += 0.5) for (let z = Math.floor(tz0 * 2) / 2 + 0.25; z < tz1; z += 0.5) {
            const s1 = (P[3] - P[0]) * (z - P[2]) - (P[5] - P[2]) * (x - P[0]), s2 = (P[6] - P[3]) * (z - P[5]) - (P[8] - P[5]) * (x - P[3]), s3 = (P[0] - P[6]) * (z - P[8]) - (P[2] - P[8]) * (x - P[6]);
            if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) cells.add(Math.round((x - 0.25) * 2) * 100003 + Math.round((z - 0.25) * 2));
          }
        }
      }
      for (let x = Math.floor(BB.x0 * 2) / 2 + 0.25; x < BB.x1; x += 0.5) for (let z = Math.floor(BB.z0 * 2) / 2 + 0.25; z < BB.z1; z += 0.5) {
        if (cells ? !cells.has(Math.round((x - 0.25) * 2) * 100003 + Math.round((z - 0.25) * 2)) : !inside(x, z)) continue;
        const k = surfCls(x, z); if (k !== 'S') continue;
        const p = swPen(x, z); if (!p) continue;
        if (!rec) swByTop.set(top, (rec = { name: nameOf(top, m), area: 0, pen: 0, sw: 0, x: 0, z: 0, n: 0 }));
        rec.area += 0.25; rec.n++; rec.x += x; rec.z += z; if (p.pen > rec.pen) { rec.pen = p.pen; rec.sw = p.sw; }
      }
    }
    for (const r of swByTop.values()) if (r.area >= 1) sidewalk.push({ name: r.name, x: +(r.x / r.n).toFixed(1), z: +(r.z / r.n).toFixed(1), area: +r.area.toFixed(1), pen: +r.pen.toFixed(2), sw: r.sw, block: r.pen >= r.sw - 0.8 });
    sidewalk.sort((a, b) => b.area - a.area);
    const tEnd = performance.now();
    const res = {
      stats: { ...summ, medianSkip, onRoad: onRoad.length, sidewalk: sidewalk.length, sidewalkBlock: sidewalk.filter((s) => s.block).length, meshes: nMesh, camTris: nTri, roadTris: rtri.length, trees: treeRecs.length,
        ms: { collect: Math.round(tCollect - T0), cams: Math.round(tCams - tCollect), rest: Math.round(tEnd - tCams) } },
      cams: out.filter((c) => c.bad || c.probe || c.worst > 0.4 || c.worstC > 0.1 || CFG.allCams),
      worstAll: out.map((c) => +c.worst.toFixed(2)),
      onRoad, sidewalk,
      streetClear: world.streetClear || null, cellClear: (world.cellSink && world.cellSink.clear) || null,
    };
    window.__clearResult = res;
    console.log('[clear] xong', JSON.stringify(res.stats));
    if (CFG.hold) await new Promise(() => {});   // giữ trang trước freeze (driver đọc kết quả rồi đóng)
  };
})();
