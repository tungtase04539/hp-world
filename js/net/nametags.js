// js/net/nametags.js — BẢNG TÊN + VÒNG SÁNG dưới chân người chơi khác (MP-2 C2). MỘT draw call cho tất cả.
//
// Vì sao không dùng world.makeTextSprite: mỗi nhãn 1 canvas 512×128 + 1 texture + 1 vật liệu + 1 draw call. Ở đây:
//  - MỘT ATLAS canvas 1024×1024 (ô 256×64, 4 cột × 16 hàng). Hàng 0 là ô TĨNH (vòng sáng xanh / xám, "vắng mặt" vi/en);
//    60 ô còn lại cấp phát LRU theo khoá (netId, tên, huy hiệu, MỨC MỜ). Tên vẽ 1 lần khi cần; ô mới tải lên GPU theo DẢI
//    HÀNG (copyTextureToTexture trong onBeforeRender — tích hợp MP-2), không tải lại cả atlas 4 MB.
//  - MỘT Mesh (không instanced) với hình học ĐỘNG: mỗi khung CPU ghi tứ giác quay về camera cho ≤ 24 bảng tên + tứ giác
//    nằm phẳng cho mỗi vòng sáng. 3 bộ đệm đỉnh xoay vòng (như traffic.js NSET — không ghi vào bộ đệm GPU đang vẽ).
//  - Vật liệu MeshBasicMaterial({map, transparent}) CHUẨN của three (không onBeforeCompile) → cùng biến thể chương trình
//    với vật liệu sẵn có (vũng đèn đêm daynight.js: map + transparent + fog) — KHÔNG thêm shader program (đo bằng
//    renderer.info.programs trong tools/qa/mp_c2_avatars.mjs). Không có alpha theo đỉnh (sẽ là biến thể mới) → "mờ dần
//    theo khoảng cách" = 4 MỨC MỜ vẽ sẵn trong atlas (1 · 0,75 · 0,5 · 0,25), chọn theo khoảng cách.
//  - Hiển thị theo MÀN HÌNH: post.js nhân HP_UNLIT_K cho MeshBasic → sáng như nhau ngày/đêm.
//  - Tiếng Việt: chuỗi chuẩn hoá NFC, font hệ thống có đủ dấu (Segoe UI / Roboto / Noto Sans / SF qua system-ui), ô cao
//    64 px cho dấu chồng (Ệ, Ẫ, Ữ) không bị cắt; chữ co lại vừa ô (không bao giờ tràn sang ô bên cạnh).
import * as THREE from 'three';
import { lang } from '../i18n.js';

const CW = 256, CH = 64, COLS = 4, ROWS = 16, AW = CW * COLS, AH = CH * ROWS;
const STATIC = { RING: 0, RING_AWAY: 1, AWAY_VI: 2, AWAY_EN: 3 };   // ô hàng 0
export const TAG_LEVELS = [1, 0.75, 0.5, 0.25];
const FONT = '"Segoe UI", "Noto Sans", Roboto, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const UPLOAD_MS = 100;
const MAX_DRAW_PER_FRAME = 8;

export function cleanName(s) {
  // chuẩn hoá NFC (dấu tổ hợp → ký tự dựng sẵn), bỏ ký tự điều khiển / định hướng, giới hạn độ dài hiển thị
  let t = String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
  if (t.length > 40) t = t.slice(0, 40);
  return t;
}

export function createNameTags({ scene, maxTags = 24, maxRings = 96, renderOrder = 6 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  mat.name = 'mp_tags';

  // ---------- hình học động: tứ giác ----------
  const MAXQ = maxRings + maxTags * 2;
  const idx = new Uint16Array(MAXQ * 6);
  for (let q = 0; q < MAXQ; q++) { const v = q * 4, o = q * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2; }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const NSET = 3, sets = [];
  for (let k = 0; k < NSET; k++) {
    const p = new THREE.BufferAttribute(new Float32Array(MAXQ * 12), 3); p.setUsage(THREE.DynamicDrawUsage);
    const u = new THREE.BufferAttribute(new Float32Array(MAXQ * 8), 2); u.setUsage(THREE.DynamicDrawUsage);
    sets.push({ p, u });
  }
  let si = 0;
  geo.setAttribute('position', sets[0].p); geo.setAttribute('uv', sets[0].u);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  // InstancedMesh 1 instance (ma trận đơn vị): CÙNG biến thể chương trình 'basic + map + trong suốt + sương + instancing'
  // với vũng đèn đêm (daynight.js night_lamp_pools) → không biên dịch chương trình mới (Mesh thường = 1 biến thể mới:
  // đo renderer.info.programs 76 → 77 ở lượt đầu).
  const mesh = new THREE.InstancedMesh(geo, mat, 1);
  mesh.name = 'mp_nametags';
  mesh.frustumCulled = false;       // 1 draw call luôn quanh camera; tứ giác ngoài khung tự bị cắt ở GPU
  mesh.matrixAutoUpdate = false;    // gốc (0,0,0) — chỉ dữ liệu đỉnh đổi (hợp đồng world.updateDynMatrices)
  mesh.userData.noCull = true;
  mesh.raycast = () => {};
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.renderOrder = renderOrder;
  if (scene) scene.add(mesh);

  // ---------- atlas ----------
  // ô: {key, used (khung cuối dùng), ready (đã tải lên GPU), w (bề rộng nội dung px)}
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) cells.push({ key: null, used: -1, ready: false, w: CW });
  const byKey = new Map();
  let dirty = false, lastUpload = -1e9, frameNo = 0, drawnThisFrame = 0, uploads = 0, drawsTotal = 0, subUploads = 0, subFail = 0;
  // (tích hợp MP-2) TẢI LÊN TỪNG DẢI Ô thay vì cả atlas 4 MB: mỗi lần tải cả atlas (+ mipmap) = 1 khung dài (đo 96 người, TIER 3:
  // số khung > 1,8× trung vị = đúng số lần tải, 0 khi tắt mô-đun). Ô mới vẽ → `pend`; ngay trước khi vẽ mesh (onBeforeRender có
  // renderer) chép DẢI HÀNG chứa các ô đó bằng renderer.copyTextureToTexture (texSubImage2D, ≤ 64 KB/ô) + 1 lần mipmap.
  const pend = new Set();
  const bands = [];
  let pendAge = 0;
  const cellXY = (i) => [(i % COLS) * CW, Math.floor(i / COLS) * CH];

  function pill(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }
  // vẽ bảng tên vào ô i: nick đậm trắng + "#1234" nhạt; huy hiệu 1 = vàng (chủ dự án/điều hành)
  function drawTag(i, name, badge, alpha) {
    const [cx, cy] = cellXY(i);
    g.save();
    g.clearRect(cx, cy, CW, CH);
    g.beginPath(); g.rect(cx, cy, CW, CH); g.clip();
    g.globalAlpha = alpha;
    const hash = name.lastIndexOf('#');
    const nick = hash > 0 && /^#\d{1,6}$/.test(name.slice(hash)) ? name.slice(0, hash) : name;
    const disc = nick.length < name.length ? name.slice(nick.length) : '';
    let fs = 30;
    let wN = 0, wD = 0;
    for (; fs >= 14; fs -= 2) {
      g.font = `600 ${fs}px ${FONT}`; wN = g.measureText(nick).width;
      g.font = `500 ${Math.round(fs * 0.7)}px ${FONT}`; wD = disc ? g.measureText(disc).width + 4 : 0;
      if (wN + wD <= CW - 36) break;
    }
    const w = Math.min(CW - 16, Math.ceil(wN + wD + 24));
    const x0 = cx + (CW - w) / 2;
    g.fillStyle = 'rgba(14,20,30,0.62)';
    pill(x0, cy + 10, w, CH - 20, (CH - 20) / 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = badge === 1 ? 'rgba(255,211,77,0.9)' : 'rgba(80,215,255,0.75)'; g.stroke();
    // đường cơ sở: căn giữa theo khung chữ thực tế (gồm dấu chồng phía trên)
    g.font = `600 ${fs}px ${FONT}`;
    const m = g.measureText(nick + 'ẤỆ');
    const asc = m.actualBoundingBoxAscent || fs * 0.95, desc = m.actualBoundingBoxDescent || fs * 0.25;
    const base = cy + CH / 2 + (asc - desc) / 2 - 1;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    let tx = cx + (CW - (wN + wD)) / 2;
    g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.strokeText(nick, tx, base);
    g.fillStyle = badge === 1 ? '#ffd34d' : '#ffffff';
    g.fillText(nick, tx, base);
    if (disc) {
      g.font = `500 ${Math.round(fs * 0.7)}px ${FONT}`;
      tx += wN + 4;
      g.fillStyle = '#a9bfd6';
      g.fillText(disc, tx, base);
    }
    g.restore();
    return w;
  }
  function drawRing(i, rgb, alpha) {
    const [cx, cy] = cellXY(i);
    g.save();
    g.clearRect(cx, cy, CW, CH);
    const r = 26, x = cx + 32, y = cy + 32;
    const gr = g.createRadialGradient(x, y, 14, x, y, 31);
    gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(0.45, `rgba(${rgb},${0.35 * alpha})`);
    gr.addColorStop(0.62, `rgba(${rgb},${alpha})`); gr.addColorStop(0.78, `rgba(${rgb},${0.35 * alpha})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  function drawAway(i, text) {
    const [cx, cy] = cellXY(i);
    g.save(); g.clearRect(cx, cy, CW, CH);
    g.font = `500 24px ${FONT}`;
    const w = Math.min(CW - 16, Math.ceil(g.measureText(text).width + 50));
    const x0 = cx + (CW - w) / 2;
    g.fillStyle = 'rgba(70,74,82,0.78)'; pill(x0, cy + 14, w, CH - 28, (CH - 28) / 2); g.fill();
    // biểu tượng "tạm dừng" (2 vạch) — không phụ thuộc phông emoji
    g.fillStyle = '#e8edf3'; g.fillRect(x0 + 14, cy + 22, 5, 20); g.fillRect(x0 + 23, cy + 22, 5, 20);
    g.textBaseline = 'middle'; g.fillText(text, x0 + 36, cy + CH / 2 + 1);
    g.restore();
    return w;
  }
  drawRing(STATIC.RING, '64,220,255', 1);
  drawRing(STATIC.RING_AWAY, '170,176,186', 0.8);
  cells[STATIC.AWAY_VI].w = drawAway(STATIC.AWAY_VI, 'vắng mặt');
  cells[STATIC.AWAY_EN].w = drawAway(STATIC.AWAY_EN, 'away');
  for (let i = 0; i < 4; i++) { cells[i].key = 'static' + i; cells[i].used = Infinity; cells[i].ready = true; }
  // ô tĩnh: lần tải ĐẦU của texture (CanvasTexture mới = needsUpdate) mang cả atlas lên GPU

  // ô cho (netId, tên, huy hiệu, mức) — null nếu chưa sẵn sàng (vẽ ở khung sau / chờ tải lên)
  function cellFor(netId, name, badge, level) {
    const key = netId + '|' + badge + '|' + level + '|' + name;
    let i = byKey.get(key);
    if (i !== undefined) { cells[i].used = frameNo; return cells[i].ready ? i : -1; }
    if (drawnThisFrame >= MAX_DRAW_PER_FRAME) return -1;
    // LRU: ô cũ nhất không dùng ở khung này
    let best = -1, bu = Infinity;
    for (let k = 4; k < cells.length; k++) {
      const c = cells[k];
      if (c.key === null) { best = k; break; }
      if (c.used < bu && c.used < frameNo) { bu = c.used; best = k; }
    }
    if (best < 0) return -1;
    const c = cells[best];
    if (c.key !== null) byKey.delete(c.key);
    c.key = key; c.used = frameNo; c.ready = false;
    c.w = drawTag(best, name, badge, TAG_LEVELS[level]);
    byKey.set(key, best);
    drawnThisFrame++; drawsTotal++; pend.add(best);
    return -1;
  }

  function flush(renderer) {
    if (!pend.size) return;
    try {
      let r0 = ROWS, r1 = -1;
      for (const i of pend) { const r = Math.floor(i / COLS); if (r < r0) r0 = r; if (r > r1) r1 = r; }
      const y0 = r0 * CH, h = (r1 - r0 + 1) * CH;
      const nr = r1 - r0 + 1;
      let b = bands[nr];   // 1 canvas nguồn cho mỗi số hàng (đổi cỡ canvas mỗi khung = cấp phát lại)
      if (!b) { const c = document.createElement('canvas'); c.width = AW; c.height = h; b = bands[nr] = { cv: c, tex: new THREE.CanvasTexture(c), g: c.getContext('2d') }; }
      const bandTex = b.tex, bg = b.g;
      bg.clearRect(0, 0, AW, h);
      bg.drawImage(cv, 0, y0, AW, h, 0, 0, AW, h);
      // flipY (như tải cả atlas): hàng canvas y0 → hàng texture AH − 1 − y0 ⇒ dải đặt ở yoffset = AH − (y0 + h)
      _pos.set(0, AH - (y0 + h));
      renderer.copyTextureToTexture(_pos, bandTex, tex);   // tự tải cả atlas lần đầu (version), rồi chép dải + mipmap
      for (const i of pend) cells[i].ready = true;
      subUploads++;
    } catch (e) {
      subFail++; dirty = true;   // lỗi (mất context…) → quay về tải cả atlas
    }
    pend.clear(); pendAge = 0;
  }
  const _pos = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => flush(renderer);

  // ---------- ghi tứ giác ----------
  let P = null, U = null, nq = 0;
  const R = new THREE.Vector3(), UP = new THREE.Vector3();
  function uvRect(i, wpx, hpx, sq) {
    const [cx, cy] = cellXY(i);
    const w = sq ? 64 : wpx, x0 = sq ? cx : cx + (CW - w) / 2;
    const y0 = cy, y1 = cy + (sq ? 64 : hpx);
    return [x0 / AW, 1 - y1 / AH, (x0 + w) / AW, 1 - y0 / AH];   // u0, v0 (dưới), u1, v1 (trên) — CanvasTexture flipY
  }
  function quad(ax, ay, az, bx, by, bz, cxv, cyv, czv, dx, dy, dz, uv) {
    // a = dưới-trái, b = dưới-phải, c = trên-trái, d = trên-phải
    if (nq >= MAXQ) return;
    const o = nq * 12, t = nq * 8;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
    P[o + 6] = cxv; P[o + 7] = cyv; P[o + 8] = czv; P[o + 9] = dx; P[o + 10] = dy; P[o + 11] = dz;
    U[t] = uv[0]; U[t + 1] = uv[1]; U[t + 2] = uv[2]; U[t + 3] = uv[1];
    U[t + 4] = uv[0]; U[t + 5] = uv[3]; U[t + 6] = uv[2]; U[t + 7] = uv[3];
    nq++;
  }
  let nRings = 0, nTags = 0, nAway = 0;
  const ringUV = [uvRect(STATIC.RING, 64, 64, true), uvRect(STATIC.RING_AWAY, 64, 64, true)];

  return {
    mesh, texture: tex, material: mat,
    // bắt đầu khung: hướng camera (bảng tên quay mặt về màn hình)
    begin(camera) {
      frameNo++; drawnThisFrame = 0; nq = 0; nRings = 0; nTags = 0; nAway = 0;
      si = (si + 1) % NSET; P = sets[si].p.array; U = sets[si].u.array;
      R.set(1, 0, 0).applyQuaternion(camera.quaternion);
      UP.set(0, 1, 0).applyQuaternion(camera.quaternion);
    },
    // vòng sáng nằm phẳng: tâm (x, y, z), hướng yaw (0 = +Z), sx ngang, sz dọc (m); away → màu xám
    ring(x, y, z, yaw, sx, sz, away) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), ax = Math.cos(yaw), az = -Math.sin(yaw);
      const hx = sx / 2, hz = sz / 2;
      quad(x + ax * hx - fx * hz, y, z + az * hx - fz * hz, x - ax * hx - fx * hz, y, z - az * hx - fz * hz,   // thứ tự đảo: mặt trước hướng LÊN (CCW nhìn từ trên)
        x + ax * hx + fx * hz, y, z + az * hx + fz * hz, x - ax * hx + fx * hz, y, z - az * hx + fz * hz, ringUV[away ? 1 : 0]);
      nRings++;
    },
    // bảng tên: đáy bảng ở (x, yBottom, z); d = khoảng cách tới camera (cỡ + mức mờ); trả true nếu đã vẽ
    tag(netId, name, badge, x, yBottom, z, d, away, fadeStart, fadeEnd) {
      if (!name) return false;
      const level = d <= fadeStart ? 0 : Math.min(3, 1 + Math.floor(((d - fadeStart) / Math.max(0.1, fadeEnd - fadeStart)) * 3));
      let i = cellFor(netId, name, badge, level);
      if (i < 0 && level > 0) { const k = netId + '|' + badge + '|0|' + name, j = byKey.get(k); if (j !== undefined && cells[j].ready) i = j; }   // mức chưa sẵn → dùng tạm mức rõ
      if (i < 0) return false;
      const h = 0.26 + 0.011 * d, wpx = cells[i].w, w = h * (wpx / (CH - 20));
      const hh = h * (CH / (CH - 20));   // ô gồm lề trên/dưới 10 px
      const cy = yBottom + hh / 2;
      const rx = R.x * w / 2, ry = R.y * w / 2, rz = R.z * w / 2, ux = UP.x * hh / 2, uy = UP.y * hh / 2, uz = UP.z * hh / 2;
      quad(x - rx - ux, cy - ry - uy, z - rz - uz, x + rx - ux, cy + ry - uy, z + rz - uz,
        x - rx + ux, cy - ry + uy, z - rz + uz, x + rx + ux, cy + ry + uy, z + rz + uz, uvRect(i, wpx, CH, false));
      nTags++;
      if (away) {
        const ai = lang === 'en' ? STATIC.AWAY_EN : STATIC.AWAY_VI, aw = h * 0.8 * (cells[ai].w / (CH - 28)), ah = h * 0.8 * (CH / (CH - 28));
        const ay = cy + hh * 0.5 + ah * 0.32;
        const arx = R.x * aw / 2, ary = R.y * aw / 2, arz = R.z * aw / 2, aux = UP.x * ah / 2, auy = UP.y * ah / 2, auz = UP.z * ah / 2;
        quad(x - arx - aux, ay - ary - auy, z - arz - auz, x + arx - aux, ay + ary - auy, z + arz - auz,
          x - arx + aux, ay - ary + auy, z - arz + auz, x + arx + aux, ay + ary + auy, z + arz + auz, uvRect(ai, cells[ai].w, CH, false));
        nAway++;
      }
      return true;
    },
    end() {
      const s = sets[si];
      geo.setAttribute('position', s.p); geo.setAttribute('uv', s.u);
      if (nq) {
        s.p.clearUpdateRanges(); s.p.addUpdateRange(0, nq * 12); s.p.needsUpdate = true;
        s.u.clearUpdateRanges(); s.u.addUpdateRange(0, nq * 8); s.u.needsUpdate = true;
      }
      geo.setDrawRange(0, nq * 6);
      mesh.visible = nq > 0;
      const now = performance.now();
      if (pend.size) { if (++pendAge > 3) dirty = true; } else pendAge = 0;   // mesh không được vẽ (không có renderer) → cả atlas
      if (dirty && now - lastUpload >= UPLOAD_MS) {   // chỉ khi tải từng dải lỗi (fallback): cả atlas ≤ 10 lần/s
        tex.needsUpdate = true; dirty = false; lastUpload = now; uploads++;
        for (const c of cells) if (c.key !== null) c.ready = true;
        pend.clear(); pendAge = 0;
      }
    },
    forget(netId) {   // tên đổi / người rời hẳn: nhả ô (LRU sẽ dùng lại)
      const p = netId + '|';
      for (const [k, i] of byKey) if (k.startsWith(p)) { byKey.delete(k); cells[i].key = null; cells[i].used = -1; cells[i].ready = false; }
    },
    stats() { return { quads: nq, rings: nRings, tags: nTags, away: nAway, cellsUsed: byKey.size, uploads, subUploads, subFail, draws: drawsTotal }; },
    canvas: cv,
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      geo.dispose(); mat.dispose(); tex.dispose();
    },
  };
}
