// js/net/nametags.js — BẢNG TÊN + VÒNG SÁNG dưới chân người chơi khác (MP-2 C2). MỘT draw call cho tất cả.
//
// Vì sao không dùng world.makeTextSprite: mỗi nhãn 1 canvas 512×128 + 1 texture + 1 vật liệu + 1 draw call. Ở đây:
//  - MỘT ATLAS canvas 1024×1024 (ô 256×64, 4 cột × 16 hàng). Hàng 0 là ô TĨNH (vòng sáng xanh / xám, "vắng mặt" vi/en);
//    60 ô còn lại cấp phát LRU theo (bản ghi người, MỨC MỜ). Tên vẽ 1 lần khi cần; ô mới tải lên GPU theo DẢI HÀNG
//    (copyTextureToTexture trong onBeforeRender — tích hợp MP-2), không tải lại cả atlas 4 MB.
//  - MỘT Mesh (không instanced) với hình học ĐỘNG: mỗi khung CPU ghi tứ giác quay về camera cho ≤ 24 bảng tên + tứ giác
//    nằm phẳng cho mỗi vòng sáng. 3 bộ đệm đỉnh xoay vòng (như traffic.js NSET — không ghi vào bộ đệm GPU đang vẽ).
//  - Vật liệu MeshBasicMaterial({map, transparent}) CHUẨN của three (không onBeforeCompile) → cùng biến thể chương trình
//    với vật liệu sẵn có (vũng đèn đêm daynight.js: map + transparent + fog) — KHÔNG thêm shader program (đo bằng
//    renderer.info.programs trong tools/qa/mp_c2_avatars.mjs). Không có alpha theo đỉnh (sẽ là biến thể mới) → "mờ dần
//    theo khoảng cách" và HIỆN/ẨN DẦN = 4 MỨC MỜ vẽ sẵn trong atlas (1 · 0,75 · 0,5 · 0,25).
//  - Hiển thị theo MÀN HÌNH: post.js nhân HP_UNLIT_K cho MeshBasic → sáng như nhau ngày/đêm.
//  - Tiếng Việt: chuỗi chuẩn hoá NFC, font hệ thống có đủ dấu (Segoe UI / Roboto / Noto Sans / SF qua system-ui), ô cao
//    64 px cho dấu chồng (Ệ, Ẫ, Ữ) không bị cắt; chữ co lại vừa ô (không bao giờ tràn sang ô bên cạnh).
//
// GỠ CHỒNG TRÊN MÀN HÌNH (đám đông dày — 96 người trong 13 m từng ra 24 bảng tên đè nhau ~15 cặp):
//  - Người gọi (remote_avatars) gọi tag() theo THỨ TỰ ƯU TIÊN (gần trước; đang hiện ×0,7; bạn bè ×0,25). Mỗi bảng tên chiếu
//    ra hình chữ nhật trên màn hình (đơn vị nửa-chiều-cao NDC, không cần kích thước canvas) và tham gia xếp chỗ THAM LAM:
//    chỗ gốc trên đầu trống → giữ; bị chiếm → thử 1 nấc XẾP CHỒNG (nâng đúng 1 bảng); vẫn không → ẩn. Tối đa maxTags chỗ.
//  - TRỄ (chống nháy): đang hiện thì chấp nhận chồng ≤ ~15 % và chỉ ẩn khi bị chiếm liên tục ≥ 0,3 s; đã bị ẩn vì chồng thì
//    phải có chỗ trống (+ lề 4 px) liên tục ≥ 0,6 s mới hiện lại; hạ từ nấc chồng về chỗ gốc sau 0,5 s trống. Bảng mới vào
//    tầm (quay camera, người đi tới) hiện NGAY. Hiện/ẩn mờ dần 0,2/0,25 s (mức mờ atlas) + co giãn 85 → 100 %.
//  - KHÔNG CẤP PHÁT trong vòng nóng: bản ghi theo netId (Map số → đối tượng, tái dùng qua kho), ô atlas tra bằng mảng số
//    (bỏ khoá chuỗi `netId|badge|level|name`), UV ghi thẳng vào bộ đệm (bỏ mảng [u0,v0,u1,v1] mỗi tứ giác), hàng chờ tải là
//    mảng số (bỏ Set + iterator). Chỉ cấp phát khi VẼ Ô MỚI vào canvas (chuỗi font) — không phải trạng thái ổn định.
//    BẪY V8: số thực TRUYỀN LÀM THAM SỐ cho hàm không được inline bị đóng hộp (HeapNumber 16 B mỗi số mỗi lần gọi) — bản cũ
//    quad(12 số) + tag(6 số) + ring(6 số) ≈ 0,3 MB/s rác. Số thực đi qua KHỐI THAM SỐ Float64Array (`args`, Q, B, HB):
//    remote_avatars ghi tags.args rồi gọi ringA(away) / tagA(netId, name, badge, away). ring()/tag() cũ vẫn giữ cho test/công
//    cụ. Bộ đệm đỉnh tải theo `_updateRange` (r160) thay vì addUpdateRange (đẩy 1 đối tượng {start, count} mỗi khung).
import * as THREE from 'three';
import { lang } from '../i18n.js';

const CW = 256, CH = 64, COLS = 4, ROWS = 16, AW = CW * COLS, AH = CH * ROWS, NCELL = COLS * ROWS;
const STATIC = { RING: 0, RING_AWAY: 1, AWAY_VI: 2, AWAY_EN: 3 };   // ô hàng 0
export const TAG_LEVELS = [1, 0.75, 0.5, 0.25];
const FONT = '"Segoe UI", "Noto Sans", Roboto, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const UPLOAD_MS = 100;
const MAX_DRAW_PER_FRAME = 8;
const PILL = (CH - 20) / CH;          // viên thuốc chiếm 44/64 chiều cao ô
// gỡ chồng (giây / đơn vị nửa-chiều-cao màn hình)
export const DECLUTTER = {
  HIDE_S: 0.3, SHOW_S: 0.6, LIFT_DOWN_S: 0.5, FADE_IN_S: 0.2, FADE_OUT_S: 0.25, LIFT_S: 0.18,
  KEEP: 0.85,      // bảng đang hiện: hình chữ nhật thu 85 % khi thử va chạm (chấp nhận chồng nhẹ — trễ)
  PAD: 0.012,      // bảng đang ẩn: nới thêm lề (≈ 4 px ở 720p) mới được hiện lại
  GAP: 0.12,       // khe giữa 2 nấc xếp chồng (× chiều cao viên thuốc)
};

export function cleanName(s) {
  // chuẩn hoá NFC (dấu tổ hợp → ký tự dựng sẵn), bỏ ký tự điều khiển / định hướng, giới hạn độ dài hiển thị
  let t = String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
  if (t.length > 40) t = t.slice(0, 40);
  return t;
}

export function createNameTags({ scene, maxTags = 24, maxRings = 96, renderOrder = 6, declutter = true } = {}) {
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
  // ô: {owner (bản ghi người | null), level, used (khung cuối dùng), ready (đã tải lên GPU), w (bề rộng nội dung px)}
  const cells = [];
  for (let i = 0; i < NCELL; i++) cells.push({ owner: null, level: -1, used: -1, ready: false, w: CW });
  let nCellsUsed = 0;
  let dirty = false, lastUpload = -1e9, frameNo = 0, drawnThisFrame = 0, uploads = 0, drawsTotal = 0, subUploads = 0, subFail = 0;
  // (tích hợp MP-2) TẢI LÊN TỪNG DẢI Ô thay vì cả atlas 4 MB: mỗi lần tải cả atlas (+ mipmap) = 1 khung dài (đo 96 người, TIER 3:
  // số khung > 1,8× trung vị = đúng số lần tải, 0 khi tắt mô-đun). Ô mới vẽ → hàng chờ; ngay trước khi vẽ mesh (onBeforeRender có
  // renderer) chép DẢI HÀNG chứa các ô đó bằng renderer.copyTextureToTexture (texSubImage2D, ≤ 64 KB/ô) + 1 lần mipmap.
  const pendFlag = new Uint8Array(NCELL), pendList = new Int16Array(NCELL);
  let pendN = 0;
  const bands = [];
  let pendAge = 0;
  function pendAdd(i) { if (!pendFlag[i]) { pendFlag[i] = 1; pendList[pendN++] = i; } }
  function pendClear() { for (let k = 0; k < pendN; k++) pendFlag[pendList[k]] = 0; pendN = 0; pendAge = 0; }

  function pill(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }
  // vẽ bảng tên vào ô i: nick đậm trắng + "#1234" nhạt; huy hiệu 1 = vàng (chủ dự án/điều hành)
  function drawTag(i, name, badge, alpha) {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
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
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
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
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
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
  for (let i = 0; i < 4; i++) { cells[i].level = -2; cells[i].used = Infinity; cells[i].ready = true; }
  // ô tĩnh: lần tải ĐẦU của texture (CanvasTexture mới = needsUpdate) mang cả atlas lên GPU

  // ---------- bản ghi theo người (netId) — tạo 1 lần, tái dùng qua kho ----------
  const recs = new Map();   // netId → bản ghi
  const pool = [];
  function newRec() {
    // trường số thực khởi tạo bằng SỐ THỰC (0.5, không phải Smi 0): biểu diễn Double ngay từ đầu → không đổi hidden class
    // (Smi → Double làm map cũ bị bỏ, mã tối ưu của tagA khử tối ưu "wrong map" rồi chạy Maglev — đóng hộp số thực = rác)
    return {
      netId: 0, name: '', badge: 0, cell: new Int16Array(4), seen: -10, lastCell: -1,
      f: 0.5, vis: false, wasBlocked: false, blockT: 0.5, freeT: 0.5, lift: 0.5, liftTo: 0, downT: 0.5, res: false,
      // tham số vẽ của khung này (ghi ở tag(), tứ giác phát ở end())
      x: 0.5, cy: 0.5, z: 0.5, h: 0.5, w: 0.5, ci: -1, away: false, scale: 0.5, step: 0.5,
    };
  }
  function recFor(netId) {
    let r = recs.get(netId);
    if (r === undefined) {
      r = pool.length ? pool.pop() : newRec();
      r.netId = netId; r.name = ''; r.badge = 0; r.cell.fill(-1); r.seen = -10; r.lastCell = -1;
      recs.set(netId, r);
    }
    return r;
  }
  function releaseCells(r) {
    for (let l = 0; l < 4; l++) {
      const i = r.cell[l];
      if (i >= 0 && cells[i].owner === r) { const c = cells[i]; c.owner = null; c.level = -1; c.used = -1; c.ready = false; nCellsUsed--; }
      r.cell[l] = -1;
    }
    r.lastCell = -1;
  }
  const owned = (r, i) => i >= 0 && cells[i].owner === r;
  // dọn bản ghi người đã khuất lâu (≥ 600 khung) — mỗi 300 khung, không phải vòng nóng
  function sweep() {
    for (const [id, r] of recs) {
      if (r.seen < frameNo - 600) { releaseCells(r); recs.delete(id); r.name = ''; pool.push(r); }
    }
  }

  // ô cho (bản ghi, mức) — -1 nếu chưa sẵn sàng (vẽ ở khung sau / chờ tải lên)
  function cellFor(r, level) {
    let i = r.cell[level];
    if (i >= 0 && cells[i].owner === r && cells[i].level === level) { cells[i].used = frameNo; return cells[i].ready ? i : -1; }
    if (drawnThisFrame >= MAX_DRAW_PER_FRAME) return -1;
    // LRU: ô cũ nhất không dùng ở khung này LẪN khung trước (ô bảng tên đang hiện không bao giờ bị lấy → không nháy)
    let best = -1, bu = Infinity;
    for (let k = 4; k < NCELL; k++) {
      const c = cells[k];
      if (c.owner === null) { best = k; break; }
      if (c.used < bu && c.used < frameNo - 1) { bu = c.used; best = k; }
    }
    if (best < 0) return -1;
    const c = cells[best];
    if (c.owner !== null) { const o = c.owner; if (o.cell[c.level] === best) o.cell[c.level] = -1; if (o.lastCell === best) o.lastCell = -1; }
    else nCellsUsed++;
    c.owner = r; c.level = level; c.used = frameNo; c.ready = false;
    c.w = drawTag(best, r.name, r.badge, TAG_LEVELS[level]);
    r.cell[level] = best;
    drawnThisFrame++; drawsTotal++; pendAdd(best);
    return -1;
  }

  function flush(renderer) {
    if (!pendN) return;
    try {
      let r0 = ROWS, r1 = -1;
      for (let k = 0; k < pendN; k++) { const r = Math.floor(pendList[k] / COLS); if (r < r0) r0 = r; if (r > r1) r1 = r; }
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
      for (let k = 0; k < pendN; k++) cells[pendList[k]].ready = true;
      subUploads++;
    } catch (e) {
      subFail++; dirty = true;   // lỗi (mất context…) → quay về tải cả atlas
    }
    pendClear();
  }
  const _pos = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => flush(renderer);

  // ---------- ghi tứ giác ----------
  let P = null, U = null, nq = 0;
  const R = new THREE.Vector3(), UP = new THREE.Vector3(), F = new THREE.Vector3(), C = new THREE.Vector3();
  let persp = true;
  // tanH, aspect, dt của khung: Float64Array (gán số thực vào biến closure `let` = 1 HeapNumber mới mỗi lần)
  const K = new Float64Array([0.577, 1.78, 1 / 60]);
  // UV (u0, v0 dưới, u1, v1 trên) của ô i, phần nội dung rộng wpx ở giữa ô (CanvasTexture flipY) — ghi vào _uv, không cấp phát
  const _uv = new Float64Array(4);
  function cellUV(i, wpx, sq) {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    const w = sq ? 64 : wpx, x0 = sq ? cx : cx + (CW - w) / 2;
    _uv[0] = x0 / AW; _uv[1] = 1 - (cy + CH) / AH; _uv[2] = (x0 + w) / AW; _uv[3] = 1 - cy / AH;
    return _uv;
  }
  // tứ giác từ khối Q (12 số: a = dưới-trái, b = dưới-phải, c = trên-trái, d = trên-phải — xyz mỗi đỉnh)
  const Q = new Float64Array(12);
  function quad(uv) {
    if (nq >= MAXQ) return;
    const o = nq * 12, t = nq * 8;
    for (let k = 0; k < 12; k++) P[o + k] = Q[k];
    U[t] = uv[0]; U[t + 1] = uv[1]; U[t + 2] = uv[2]; U[t + 3] = uv[1];
    U[t + 4] = uv[0]; U[t + 5] = uv[3]; U[t + 6] = uv[2]; U[t + 7] = uv[3];
    nq++;
  }
  // billboard (quay về camera) từ khối B: tâm (x, y, z), rộng w, cao hh (m)
  const B = new Float64Array(5);
  function board(uv) {
    const x = B[0], y = B[1], z = B[2], w = B[3], hh = B[4];
    const rx = R.x * w / 2, ry = R.y * w / 2, rz = R.z * w / 2, ux = UP.x * hh / 2, uy = UP.y * hh / 2, uz = UP.z * hh / 2;
    Q[0] = x - rx - ux; Q[1] = y - ry - uy; Q[2] = z - rz - uz; Q[3] = x + rx - ux; Q[4] = y + ry - uy; Q[5] = z + rz - uz;
    Q[6] = x - rx + ux; Q[7] = y - ry + uy; Q[8] = z - rz + uz; Q[9] = x + rx + ux; Q[10] = y + ry + uy; Q[11] = z + rz + uz;
    quad(uv);
  }
  let nRings = 0, nTags = 0, nAway = 0, nHidden = 0, nLifted = 0, nRes = 0, hideEv = 0, showEv = 0;
  const ringUV = [Float64Array.from(cellUV(STATIC.RING, 64, true)), Float64Array.from(cellUV(STATIC.RING_AWAY, 64, true))];

  // ---------- xếp chỗ trên màn hình ----------
  // hình chữ nhật đã giữ chỗ khung này: tâm (sx, sy), nửa rộng, nửa cao — đơn vị nửa-chiều-cao màn hình (y ∈ [−1, 1])
  const ACC = new Float64Array(maxTags * 4);
  let nAcc = 0;
  const HB = new Float64Array(4);   // khối tham số của hit(): sx, sy, hw, hh
  function hit() {
    const sx = HB[0], sy = HB[1], hw = HB[2], hh = HB[3];
    for (let k = 0; k < nAcc; k++) {
      const o = k * 4;
      if (Math.abs(sx - ACC[o]) < hw + ACC[o + 2] && Math.abs(sy - ACC[o + 1]) < hh + ACC[o + 3]) return true;
    }
    return false;
  }
  const frameRecs = [];   // bản ghi có trong khung (thứ tự ưu tiên) — mảng tái dùng, chỉ ghi tham chiếu
  let nFrame = 0;

  function emit(r) {
    const s = r.scale, h = r.h * s, hh = h / PILL;
    const y = r.cy + r.lift * r.step;
    const ci = r.ci;
    B[0] = r.x; B[1] = y; B[2] = r.z; B[3] = r.w * s; B[4] = hh;
    board(cellUV(ci, cells[ci].w, false));
    nTags++;
    if (r.away) {
      const ai = lang === 'en' ? STATIC.AWAY_EN : STATIC.AWAY_VI, ah = h * 0.8 * (CH / (CH - 28));
      B[1] = y + hh * 0.5 + ah * 0.32; B[3] = h * 0.8 * (cells[ai].w / (CH - 28)); B[4] = ah;
      board(cellUV(ai, cells[ai].w, false));
      nAway++;
    }
  }
  // tải 1 đoạn bộ đệm KHÔNG cấp phát: _updateRange của three r160 (renderer tự đặt lại count = −1 sau khi tải);
  // bản three khác (không có _updateRange) → addUpdateRange
  function markRange(attr, n) {
    const u = attr._updateRange;
    if (u) { u.offset = 0; u.count = n; } else { attr.clearUpdateRanges(); attr.addUpdateRange(0, n); }
    attr.needsUpdate = true;
  }

  // KHỐI THAM SỐ số thực cho ringA()/tagA() (xem đầu tệp: tránh đóng hộp số thực khi gọi hàm)
  const A = new Float64Array(8);

  // vòng sáng nằm phẳng — A: x, y, z, yaw (0 = +Z), sx ngang, sz dọc (m); away → màu xám
  function ringA(away) {
    const x = A[0], y = A[1], z = A[2], yaw = A[3];
    const fx = Math.sin(yaw), fz = Math.cos(yaw), ax = Math.cos(yaw), az = -Math.sin(yaw);
    const hx = A[4] / 2, hz = A[5] / 2;
    // thứ tự đảo: mặt trước hướng LÊN (CCW nhìn từ trên)
    Q[0] = x + ax * hx - fx * hz; Q[1] = y; Q[2] = z + az * hx - fz * hz; Q[3] = x - ax * hx - fx * hz; Q[4] = y; Q[5] = z - az * hx - fz * hz;
    Q[6] = x + ax * hx + fx * hz; Q[7] = y; Q[8] = z + az * hx + fz * hz; Q[9] = x - ax * hx + fx * hz; Q[10] = y; Q[11] = z - az * hx + fz * hz;
    quad(ringUV[away ? 1 : 0]);
    nRings++;
  }

  // bảng tên — A: x, yBottom (đáy bảng), z, d (khoảng cách tới camera: cỡ + mức mờ), fadeStart, fadeEnd. Gọi THEO THỨ TỰ ƯU
  // TIÊN (cao trước). Trả true nếu bảng được vẽ ở khung này (đang hiện hoặc đang mờ dần). Tứ giác phát ở end().
  function tagA(netId, name, badge, away) {
    if (!name) return false;
    const x = A[0], yBottom = A[1], z = A[2], d = A[3], fadeStart = A[4], fadeEnd = A[5];
    const tanH = K[0], aspect = K[1], dt = K[2];
    const r = recFor(netId);
    if (r.name !== name || r.badge !== badge) { releaseCells(r); r.name = name; r.badge = badge; }
    if (r.seen !== frameNo - 1) {   // mới vào tầm (hoặc khuất ≥ 1 khung): bắt đầu ẩn, hiện ngay nếu có chỗ (mờ dần vào)
      r.f = 0; r.vis = false; r.wasBlocked = false; r.blockT = 0; r.freeT = 0; r.lift = 0; r.liftTo = 0; r.downT = 0;
    }
    r.seen = frameNo; r.res = false; r.ci = -1;
    const distLevel = d <= fadeStart ? 0 : Math.min(3, 1 + Math.floor(((d - fadeStart) / Math.max(0.1, fadeEnd - fadeStart)) * 3));
    // kích thước theo ô (bề rộng nội dung px của ô đang dùng / ô mức rõ; chưa có ô → ước theo độ dài tên)
    const lc = owned(r, r.lastCell) ? r.lastCell : owned(r, r.cell[0]) ? r.cell[0] : -1;
    const wpx = lc >= 0 ? cells[lc].w : Math.min(CW - 16, 40 + name.length * 13);
    const h = 0.26 + 0.011 * d, w = h * (wpx / (CH - 20)), hh = h / PILL;
    r.x = x; r.z = z; r.h = h; r.w = w; r.away = !!away;
    r.cy = yBottom + hh / 2;
    // hình chữ nhật va chạm (viên thuốc + dấu "vắng mặt" phía trên nếu có), theo trục camera
    const oy = away ? 0.54 * h : 0, rh = away ? 1.04 * h : 0.5 * h;
    r.step = 2 * rh + DECLUTTER.GAP * h;   // 1 nấc xếp chồng
    if (declutter && persp) {
      const vx = x - C.x, vy = r.cy + oy - C.y, vz = z - C.z;
      const depth = vx * F.x + vy * F.y + vz * F.z;
      const k = depth > 0.3 ? 1 / (depth * tanH) : 0;
      const sx = (vx * R.x + vy * R.y + vz * R.z) * k, sy = (vx * UP.x + vy * UP.y + vz * UP.z) * k;
      const hw0 = (w / 2) * k, hh0 = rh * k, ls = r.step * k;
      if (k === 0 || !(Math.abs(sx) - hw0 < aspect && Math.abs(sy) - hh0 - ls < 1)) {   // sau lưng / ngoài màn hình: không giữ chỗ, hiện ngay khi vào lại
        r.f = 0; r.vis = false; r.wasBlocked = false; r.lift = 0; r.liftTo = 0;
        return false;
      }
      const sh = r.vis ? DECLUTTER.KEEP : 1, pad = r.vis ? 0 : DECLUTTER.PAD;
      HB[0] = sx; HB[1] = sy; HB[2] = hw0 * sh + pad; HB[3] = hh0 * sh + pad;
      const freeA = !hit();
      HB[1] = sy + ls;
      const freeL = sy + ls + hh0 < 1 && !hit();   // nấc chồng phải nằm TRỌN trong màn hình
      let slot;
      if (r.liftTo === 1) {
        if (freeA) { r.downT += dt; slot = r.downT >= DECLUTTER.LIFT_DOWN_S || !freeL ? 0 : 1; }
        else { r.downT = 0; slot = freeL ? 1 : -1; }
      } else { r.downT = 0; slot = freeA ? 0 : freeL ? 1 : -1; }
      const want = slot >= 0 && nRes < maxTags;
      if (want) {
        r.freeT += dt; r.blockT = 0; r.liftTo = slot;
        if (!r.vis && (!r.wasBlocked || r.freeT >= DECLUTTER.SHOW_S)) { r.vis = true; showEv++; }
        const o = nAcc * 4;
        ACC[o] = sx; ACC[o + 1] = sy + slot * ls; ACC[o + 2] = hw0; ACC[o + 3] = hh0; nAcc++;
        nRes++; r.res = true;
      } else {
        r.blockT += dt; r.freeT = 0;
        if (r.vis && r.blockT >= DECLUTTER.HIDE_S) { r.vis = false; hideEv++; }
        if (!r.vis) { r.wasBlocked = true; nHidden++; }   // bị chiếm khi đang ẩn → lần hiện sau cũng phải chờ SHOW_S
      }
    } else {   // không gỡ chồng (camera trực giao / tắt): như bản cũ — maxTags đầu tiên hiện
      r.vis = nRes < maxTags; r.liftTo = 0;
      if (r.vis) { nRes++; r.res = true; }
    }
    // mờ dần (hiện 0,2 s / ẩn 0,25 s) + trượt nấc xếp chồng
    r.f = r.vis ? Math.min(1, r.f + dt / DECLUTTER.FADE_IN_S) : Math.max(0, r.f - dt / DECLUTTER.FADE_OUT_S);
    if (r.f <= 0) { r.lift = r.liftTo; return false; }
    const dl = dt / DECLUTTER.LIFT_S;
    r.lift = r.lift < r.liftTo ? Math.min(r.liftTo, r.lift + dl) : Math.max(r.liftTo, r.lift - dl);
    if (r.liftTo === 1) nLifted++;
    // mức mờ = mức theo khoảng cách × độ hiện, lượng tử về 4 mức atlas
    const alpha = TAG_LEVELS[distLevel] * r.f;
    if (alpha < 0.125) return false;
    const level = Math.min(3, Math.round((1 - alpha) / 0.25));
    let ci = cellFor(r, level);
    if (ci < 0) {   // chưa sẵn: dùng ô vừa vẽ khung trước (không nháy), không thì mức gần nhất đã sẵn
      if (owned(r, r.lastCell) && cells[r.lastCell].ready) ci = r.lastCell;
      else for (let dd = 1; dd < 4 && ci < 0; dd++) {
        for (let sgn = 1; sgn >= -1 && ci < 0; sgn -= 2) {
          const l = level + sgn * dd, j = l >= 0 && l < 4 ? r.cell[l] : -1;
          if (owned(r, j) && cells[j].level === l && cells[j].ready) ci = j;
        }
      }
      if (ci < 0) return false;
      cells[ci].used = frameNo;
    }
    r.ci = ci; r.lastCell = ci; r.w = h * (cells[ci].w / (CH - 20));
    r.scale = 0.85 + 0.15 * r.f;
    frameRecs[nFrame++] = r;
    return true;
  }

  return {
    mesh, texture: tex, material: mat,
    // bắt đầu khung: hướng camera (bảng tên quay mặt về màn hình); dtS = giây từ khung trước (mờ dần, trễ ẩn/hiện)
    begin(camera, dtS) {
      frameNo++; drawnThisFrame = 0; nq = 0; nRings = 0; nTags = 0; nAway = 0; nHidden = 0; nLifted = 0; nRes = 0; nAcc = 0; nFrame = 0;
      K[2] = Number.isFinite(dtS) ? Math.min(Math.max(dtS, 0), 0.1) : 1 / 60;
      si = (si + 1) % NSET; P = sets[si].p.array; U = sets[si].u.array;
      R.set(1, 0, 0).applyQuaternion(camera.quaternion);
      UP.set(0, 1, 0).applyQuaternion(camera.quaternion);
      F.set(0, 0, -1).applyQuaternion(camera.quaternion);
      C.copy(camera.position);
      persp = !!camera.isPerspectiveCamera;
      K[0] = persp ? Math.tan((camera.fov * Math.PI) / 360) / (camera.zoom || 1) : 1;
      K[1] = camera.aspect || 1;
      if (frameNo % 300 === 0) sweep();
    },
    args: A, ringA, tagA,
    // bản tham số rời (test / công cụ; vòng nóng dùng args + ringA/tagA)
    ring(x, y, z, yaw, sx, sz, away) { A[0] = x; A[1] = y; A[2] = z; A[3] = yaw; A[4] = sx; A[5] = sz; ringA(away); },
    tag(netId, name, badge, x, yBottom, z, d, away, fadeStart, fadeEnd) {
      A[0] = x; A[1] = yBottom; A[2] = z; A[3] = d; A[4] = fadeStart; A[5] = fadeEnd;
      return tagA(netId, name, badge, away);
    },
    end() {
      // phát tứ giác bảng tên: chỗ đã giữ trước, rồi bảng đang mờ dần ra — tổng ≤ maxTags
      for (let k = 0; k < nFrame; k++) { const r = frameRecs[k]; if (r.res && nTags < maxTags) emit(r); }
      for (let k = 0; k < nFrame; k++) {
        const r = frameRecs[k];
        if (r.res) continue;
        if (nTags < maxTags) emit(r); else { r.f = 0; r.vis = false; }
      }
      for (let k = 0; k < nFrame; k++) frameRecs[k] = null;
      const s = sets[si];
      geo.setAttribute('position', s.p); geo.setAttribute('uv', s.u);
      if (nq) { markRange(s.p, nq * 12); markRange(s.u, nq * 8); }
      geo.setDrawRange(0, nq * 6);
      mesh.visible = nq > 0;
      if (pendN) { if (++pendAge > 3) dirty = true; } else pendAge = 0;   // mesh không được vẽ (không có renderer) → cả atlas
      // (performance.now() chỉ khi cần: số thực trả về = 1 HeapNumber mới)
      if (dirty && performance.now() - lastUpload >= UPLOAD_MS) {   // chỉ khi tải từng dải lỗi (fallback): cả atlas ≤ 10 lần/s
        tex.needsUpdate = true; dirty = false; lastUpload = performance.now(); uploads++;
        for (let i = 0; i < NCELL; i++) if (cells[i].owner !== null || i < 4) cells[i].ready = true;
        pendClear();
      }
    },
    forget(netId) {   // tên đổi / người rời hẳn: nhả ô (LRU sẽ dùng lại)
      const r = recs.get(netId);
      if (r !== undefined) { releaseCells(r); r.name = ''; }
    },
    ringCount: () => nRings,
    tagCount: () => nTags,
    // QA / chẩn đoán (cấp phát — không gọi mỗi khung)
    stats() {
      return { quads: nq, rings: nRings, tags: nTags, away: nAway, reserved: nRes, hiddenByDeclutter: nHidden, lifted: nLifted,
        hideEvents: hideEv, showEvents: showEv, cellsUsed: nCellsUsed, people: recs.size, uploads, subUploads, subFail, draws: drawsTotal };
    },
    canvas: cv,
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      geo.dispose(); mat.dispose(); tex.dispose();
      for (const b of bands) if (b) b.tex.dispose();
    },
  };
}
