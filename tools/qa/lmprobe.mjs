// tools/qa/lmprobe.mjs — KIỂM ĐỊA DANH (Đợt 3 W2-E): raster tam giác GLB (userData.lodKey/lmKey) + khối thủ tục (world.lmMasses)
// so với LM_POLY (IoU, phủ, phần ngoài, phần trên LÒNG ĐƯỜNG theo roadNet.surfaceAt), cây/collider nhỏ ĐÂM trong khối, nhà thật
// (rbGrid) trong đa giác, nhà ô GIỮ chạm đa giác, biển địa danh/xe/NPC trong khối, __hp.diag(); + chụp views (pano/cam/aerial).
// usage: node tools/qa/lmprobe.mjs --port 8405 --out <dir> [--views views.json] [--metrics] [--perf] [--quality full] [--settle 4000]
//        [--js file.js]  (biểu thức chạy trong trang, in kết quả) — giữ KHOÁ GPU qua launch.mjs
// Chạy qua tools/qa/launch.mjs (giữ KHOÁ GPU toàn máy tới close()).
import fs from 'fs';
const { openGame, args } = await import('./launch.mjs');
const a = args();
const PORT = +a.get('port', '8405');
const OUT = a.get('out', 'out');
const Q = a.get('quality', 'full');
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = a.get('views') ? JSON.parse(fs.readFileSync(a.get('views'), 'utf8')) : [];
const g = await openGame({ port: PORT, quality: Q, extra: a.get('extra', '') });
const res = { errors: g.errors, hpReadyMs: g.hpReadyMs, startReadyMs: g.startReadyMs, tier: g.tier, gpu: g.gpu };
try {
  await g.cleanUI();
  const pg = g.pg;
  await pg.evaluate(() => { const hp = window.__hp; if (hp.traffic && hp.traffic.setEnabled) hp.traffic.setEnabled(false); hp.setTime(0.35); if (hp.camOcclusion) hp.camOcclusion(false); });
  // chờ GLB địa danh nạp xong (assetsBusy false + đủ root)
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    const st = await pg.evaluate(async () => {
      const A = await import('./js/assets.js');
      let n = 0; window.__hp.scene.traverse((o) => { if (o.userData.lodKey) n++; });
      return { busy: A.assetsBusy(), n };
    });
    if (!st.busy && st.n >= 16) break;
    await pg.waitForTimeout(1000);
  }
  res.glbWaitMs = Date.now() - t0;
  await pg.waitForTimeout(+a.get('settle', '4000'));
  if (a.has('metrics')) {
    res.metrics = await pg.evaluate(async () => {
      const hp = window.__hp, W = hp.world, scene = hp.scene;
      const { LM_POLY } = await import('./js/landmark_polys.js');
      const LMS = await import('./js/landmarks.js');
      const URLKEY = { nhahat: 'opera', nhatho: 'cathedral', buudien: 'postoffice', baotang: 'museum', ga: 'station_bldg', thptnq: 'thptnq',
        chuahang: 'chuahang', nhnn: 'nhnn', dinhhk: 'dinhhk', dentamky: 'dentamky', quanhoa: 'quanhoa', dennghe: 'dennghe', lechan: 'lechan' };
      const roots = {};
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        let k = null;
        if (o.userData.lodKey) k = URLKEY[o.userData.lodKey.replace(/^.*\//, '').replace('.glb', '')];
        if (o.userData.lmKey) k = o.userData.lmKey;
        if (k) (roots[k] = roots[k] || []).push(o);
      });
      const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
      const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz; let t = l ? ((px - ax) * dx + (pz - az) * dz) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
      const edgeD = (x, z, P) => { let d = 1e9; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; d = Math.min(d, segD(x, z, p[0], p[1], q[0], q[1])); } return d; };
      const LAND = 2, CS = 0.5;
      const out = {};
      const v = new hp.THREE.Vector3();
      for (const key of Object.keys(roots).concat(Object.keys(LM_POLY)).filter((k, i, A) => A.indexOf(k) === i)) {
        const P = LM_POLY[key] || null;
        const R = roots[key] || [];
        let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
        if (P) for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const box = new hp.THREE.Box3();
        for (const r of R) box.expandByObject(r);
        if (R.length) { x0 = Math.min(x0, box.min.x); z0 = Math.min(z0, box.min.z); x1 = Math.max(x1, box.max.x); z1 = Math.max(z1, box.max.z); }
        x0 -= 4; z0 -= 4; x1 += 4; z1 += 4;
        const nx = Math.ceil((x1 - x0) / CS), nz = Math.ceil((z1 - z0) / CS);
        if (nx * nz > 4e6) { out[key] = { err: 'grid too big' }; continue; }
        const occ = new Uint8Array(nx * nz);
        let tris = 0, ymax = -1e9;
        const mark = (x, z) => { const i = Math.floor((x - x0) / CS), j = Math.floor((z - z0) / CS); if (i >= 0 && j >= 0 && i < nx && j < nz) occ[j * nx + i] = 1; };
        for (const r of R) r.traverse((o) => {
          if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
          const pa = o.geometry.attributes.position, ix = o.geometry.index, M = o.matrixWorld;
          if (!pa.array && !pa.data) return;
          const n = ix ? ix.count : pa.count;
          const X = new Float32Array(pa.count), Y = new Float32Array(pa.count), Z = new Float32Array(pa.count);
          for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(M); X[i] = v.x; Y[i] = v.y; Z[i] = v.z; }
          for (let t = 0; t < n; t += 3) {
            const a1 = ix ? ix.getX(t) : t, b1 = ix ? ix.getX(t + 1) : t + 1, c1 = ix ? ix.getX(t + 2) : t + 2;
            const ym = Math.max(Y[a1], Y[b1], Y[c1]);
            if (ym < LAND + 1.2) continue;
            tris++; if (ym > ymax) ymax = ym;
            const ax = X[a1], az = Z[a1], bx = X[b1], bz = Z[b1], cx = X[c1], cz = Z[c1];
            const mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx), mnz = Math.min(az, bz, cz), mxz = Math.max(az, bz, cz);
            mark((ax + bx + cx) / 3, (az + bz + cz) / 3);
            if (mxx - mnx < CS && mxz - mnz < CS) continue;
            const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
            for (let i = Math.floor((mnx - x0) / CS); i <= Math.floor((mxx - x0) / CS); i++) for (let j = Math.floor((mnz - z0) / CS); j <= Math.floor((mxz - z0) / CS); j++) {
              const px = x0 + (i + 0.5) * CS, pz = z0 + (j + 0.5) * CS;
              const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
              if (l1 >= -0.02 && l2 >= -0.02 && l1 + l2 <= 1.02 && i >= 0 && j >= 0 && i < nx && j < nz) occ[j * nx + i] = 1;
            }
          }
        });
        // khối thủ tục địa danh (world.lmMasses) cùng key
        for (const M of (W.lmMasses || [])) {
          if (M.key !== key) continue;
          let mx0 = 1e9, mz0 = 1e9, mx1 = -1e9, mz1 = -1e9; for (const [x, z] of M.ring) { mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); mz0 = Math.min(mz0, z); mz1 = Math.max(mz1, z); }
          for (let i = Math.max(0, Math.floor((mx0 - x0) / CS)); i <= Math.min(nx - 1, Math.floor((mx1 - x0) / CS)); i++) for (let j = Math.max(0, Math.floor((mz0 - z0) / CS)); j <= Math.min(nz - 1, Math.floor((mz1 - z0) / CS)); j++)
            if (inPoly(x0 + (i + 0.5) * CS, z0 + (j + 0.5) * CS, M.ring)) occ[j * nx + i] = 1;
          if (M.h + LAND > ymax) ymax = M.h + LAND;
        }
        const occAt = (x, z) => { const i = Math.floor((x - x0) / CS), j = Math.floor((z - z0) / CS); return i >= 0 && j >= 0 && i < nx && j < nz && occ[j * nx + i] === 1; };
        // so với đa giác
        let A = 0, B = 0, I = 0, road = 0, fabIn = 0, fabCells = 0;
        const RN = W.roadNet, FG = W.rbGrid;
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const px = x0 + (i + 0.5) * CS, pz = z0 + (j + 0.5) * CS;
          const o = occ[j * nx + i], p = P ? inPoly(px, pz, P) : false;
          if (o) A++; if (p) B++; if (o && p) I++;
          if (o && !p && RN && RN.surfaceAt) { const s = RN.surfaceAt(px, pz); if (s > 0.02 && s < 0.2) road++; }
          if (p && FG && FG.at(px, pz) >= 0) fabIn++;
        }
        const cell2 = CS * CS;
        // vật lạ: cây (recs) + collider nhỏ trong đa giác (lùi 0,5 m vào trong)
        const trees = [], cols = [];
        if (P || R.length) {
          if (W.trees && W.trees.recs) for (const r of W.trees.recs) if (occAt(r.x, r.z)) trees.push([+r.x.toFixed(1), +r.z.toFixed(1), r.sp]);
          for (const c of W.colliders) if (c.r <= 1.3 && occAt(c.x, c.z)) cols.push([+c.x.toFixed(1), +c.z.toFixed(1), c.r]);
        }
        const cellIn = P && W.cellKept ? W.cellKept.filter((c) => inPoly(c.cx, c.cz, P) || (c.hull && c.hull.some(([x, z]) => inPoly(x, z, P) && edgeD(x, z, P) > 2))).map((c) => `${c.name}:${c.kind}:${(c.h || 0).toFixed(0)}`) : [];
        const sign = LMS.LANDMARKS.find((l) => l.id === (key === 'station_bldg' ? 'station' : key));
        let signIn = null;
        if (sign) { const i = Math.floor((sign.x - x0) / CS), j = Math.floor((sign.z - z0) / CS); signIn = { x: +sign.x.toFixed(1), z: +sign.z.toFixed(1), inLM: !!(i >= 0 && j >= 0 && i < nx && j < nz && occ[j * nx + i]), inPoly: P ? inPoly(sign.x, sign.z, P) : null, inFab: W.fabric ? W.fabric.hit(sign.x, sign.z, 0.6) : null, inLmSolid: W.landmarkHit ? W.landmarkHit(sign.x, sign.z, 0.6) : null }; }
        out[key] = { roots: R.length, tris, h: +(ymax - LAND).toFixed(1), occM2: +(A * cell2).toFixed(0), polyM2: +(B * cell2).toFixed(0),
          iou: +(I / Math.max(1, A + B - I)).toFixed(3), cover: +(I / Math.max(1, B)).toFixed(3), outsideM2: +((A - I) * cell2).toFixed(0), roadM2: +(road * cell2).toFixed(0),
          fabInM2: +(fabIn * cell2).toFixed(0), cellIn, trees: trees.length, treeList: trees.slice(0, 8), smallCols: cols.length, colList: cols.slice(0, 8), sign: signIn };
      }
      const spots = [];
      if (W.landmarkHit) {
        for (const v of (W.vehicleSpawns || [])) if (W.landmarkHit(v.x, v.z, 0.6)) spots.push(['veh', +v.x.toFixed(1), +v.z.toFixed(1)]);
        for (const [n, p] of Object.entries(W.npcSpots || {})) if (W.landmarkHit(p[0], p[1], 0.5)) spots.push(['npc', n, p[0], p[1]]);
        for (const l of LMS.LANDMARKS) if (W.landmarkHit(l.x, l.z, 0.6)) spots.push(['sign', l.id]);
      }
      out._spots = spots;
      out._diag = hp.diag ? hp.diag() : null;
      return out;
    });
  }
  if (a.get('js')) { res.jsres = await pg.evaluate(fs.readFileSync(a.get('js'), 'utf8')).catch((e) => 'ERR ' + e.message); console.log('JSRES', JSON.stringify(res.jsres).slice(0, 3000)); }
  // ảnh
  res.shots = [];
  let first = true;
  for (const v of VIEWS) {
    await pg.evaluate((v) => {
      const hp = window.__hp;
      hp.setTime(v.time ?? 0.35);
      if (v.kind === 'aerial') hp.aerial(v.x, v.z, v.half || 80, v.alt || 600);
      else {
        hp.aerialOff();
        if (v.kind === 'pano') hp.teleport(v.X, v.Z, -v.h * Math.PI / 180, v.pitch ?? 0.02, 0.1);
        else hp.teleport(v.x, v.z, v.yaw ?? 0, v.pitch ?? 0.1, v.dist ?? 8);
      }
      hp.player.group.visible = false;
    }, v);
    await pg.waitForTimeout(first ? 3500 : +(v.wait || 1600));
    first = false;
    const f = `${OUT}/${v.id}.png`;
    await pg.screenshot({ path: f, timeout: 30000 });
    res.shots.push(v.id);
  }
  if (a.has('perf')) {
    res.perf = await pg.evaluate(async () => {
      const r = window.__hp.renderer; const ts = []; let last = performance.now();
      for (let i = 0; i < 90; i++) { await new Promise((res) => requestAnimationFrame(res)); const n = performance.now(); ts.push(n - last); last = n; }
      ts.sort((x, y) => x - y);
      r.info.autoReset = false; r.info.reset(); await new Promise((res) => requestAnimationFrame(res));
      const o = { fps: +(1000 / (ts.reduce((x, y) => x + y, 0) / ts.length)).toFixed(1), p95: +ts[85].toFixed(1), calls: r.info.render.calls, tris: r.info.render.triangles };
      r.info.autoReset = true; return o;
    });
  }
  res.heapMB = await pg.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
} catch (e) {
  res.fatal = String(e && e.stack || e);
} finally {
  res.errors = g.errors;
  fs.writeFileSync(`${OUT}/_probe.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ errors: res.errors.slice(0, 10), fatal: res.fatal, hpReadyMs: res.hpReadyMs, glbWaitMs: res.glbWaitMs, shots: res.shots && res.shots.length }, null, 1));
  if (res.metrics) for (const [k, m] of Object.entries(res.metrics)) console.log(k.padEnd(13), JSON.stringify(m).slice(0, 400));
  await g.close();
}
