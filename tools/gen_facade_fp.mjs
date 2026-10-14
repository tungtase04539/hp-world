// gen_facade_fp.mjs — "VÂN TAY MẶT TIỀN" (Đợt 3 wave 4, W4-A): gán quan sát TỪNG NHÀ trong ảnh pano thật vào footprint RB.
//
// Nguồn: agent trích xuất đọc 3.306 ảnh pano đã cắt (551 pano × 6 hướng gần vuông góc phố, FOV ngang ≈ 98°) và ghi mỗi
// nhà thấy được: khoảng ngang x0..x1 (0 = mép trái, 1 = mép phải ảnh), độ sâu near/mid/far, số tầng, màu tường (#hex),
// kiểu, ban công, cửa sổ, tầng trệt, biển hiệu (màu nền/chữ, cỡ, số tầng phủ), mái hiên, mái, tuổi. Gộp lại (bỏ ghi chú
// chữ) thành audit/facade_fp.json (đầu vào CAM KẾT của pipeline — ảnh/JSON gốc nằm ngoài repo).
//
// Ánh xạ ảnh → nhà (mapFacadeFP): bearing(x) = heading + atan((x − 0,5)·2·tan 49°) (la bàn: 0° bắc = −z, 90° đông = +x);
// K tia (3-12) rải đều trong lõi 70% của [x0, x1] từ camera (xe Street View) → cạnh footprint ĐẦU TIÊN chạm (2D, bỏ nhà
// chứa camera) trong 80 m; lọc độ sâu (near ≤ 22 m, mid 7-48 m, far 22-80 m); nhà nhận quan sát khi ≥ max(1, 20% K) tia
// (hoặc là nhà nhiều tia nhất). Trọng số = độ sâu (near 1 / mid 0,6 / far 0,25) × tỉ lệ tia × phủ (bề rộng chạm / cạnh
// chạm dài nhất, trần 1) × chắc tầng (0,8 nếu floorsSure=false). Gộp mỗi nhà: thuộc tính rời rạc = bỏ phiếu theo trọng số;
// tầng = trung vị có trọng số (chỉ near/mid khi có); màu tường = trung bình tuyến tính các quan sát gần màu quan sát nặng
// nhất (ΔRGB < 70); biển = từ quan sát nặng nhất CÓ biển (khi phiếu cỡ biển ≠ none). Tất định (thứ tự cố định, không ngẫu nhiên).
//
// CLI (gốc repo):
//   node tools/gen_facade_fp.mjs --collect <thư mục fp_json> <fp_plan.json>   → ghi audit/facade_fp.json
//   node tools/gen_facade_fp.mjs [--dump out.json]                            → ánh xạ lên js/buildings_real.js hiện tại,
//        in độ phủ (nhà mặt phố trong 40 m quanh pano có vân tay) + phân bố; --dump ghi từng nhà (gỡ lỗi/vẽ)
// tools/process_buildings.mjs import loadFacadeFP/mapFacadeFP ở bước 10b (hình học CUỐI) → tầng/kiểu/màu/công năng + mục
// RBF1 trong buildings_real.js (js/buildings_data.js giải mã thành D.fp*; js/citygen.js dựng theo).
import fs from 'fs';

import { FP_ENUMS as FPE } from '../js/buildings_data.js';
// enum dùng chung với bộ giải mã (js/buildings_data.js FP_ENUMS) + độ sâu (chỉ dùng lúc ánh xạ)
export const FP_ENUMS = { ...FPE, depth: ['near', 'mid', 'far'] };
// cột của một dòng quan sát trong audit/facade_fp.json (obs[i] = mảng theo thứ tự này; −1 = không rõ)
export const FP_COLS = ['pano', 'heading', 'x0', 'x1', 'depth', 'floors', 'sure', 'widthM', 'wall', 'style', 'balcony', 'windows', 'ground',
  'signPresent', 'signBg', 'signFg', 'size', 'span', 'awning', 'roof', 'age'];
const C = Object.fromEntries(FP_COLS.map((k, i) => [k, i]));
const HALF_FOV = 49;   // nửa FOV ngang của ảnh cắt (ảnh 1280×634, FOV dọc 60°, tỉ lệ 2,02)

const hexInt = (h) => (typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h.trim()) ? parseInt(h.trim().replace('#', ''), 16) : -1);
const enumIdx = (list, v) => { const i = list.indexOf(typeof v === 'string' ? v.trim().toLowerCase() : v); return i; };

// ---------------- GỘP fp_json → audit/facade_fp.json ----------------
// opts.notes (W5-A herokit): trả thêm out.notes[i] = ghi chú tự do của obs[i] (KHÔNG ghi vào facade_fp.json — chỉ tools/gen_herokit.mjs dùng)
export function collectFP(dir, planFile, opts = {}) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const panoIdx = new Map(); const panos = [];
  for (const p of plan) { panoIdx.set(p.id, panos.length); panos.push([p.id, +p.X.toFixed(2), +p.Z.toFixed(2)]); }
  const files = fs.readdirSync(dir).filter((f) => /^pano_\d+_h\d+\.json$/.test(f)).sort();
  const obs = []; const notes = opts.notes ? [] : null; const st = { files: files.length, bad: 0, empty: 0, obs: 0, fixedEnum: 0, droppedObs: 0 };
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); } catch { st.bad++; continue; }
    const m = f.match(/^(pano_\d+)_h(\d+)\.json$/);
    const pi = panoIdx.get(m[1]); if (pi === undefined) { st.bad++; continue; }
    const heading = +m[2];
    const B = Array.isArray(j.buildings) ? j.buildings : [];
    if (!B.length) st.empty++;
    for (let b of B) {
      // ghi LỆCH 1 CỘT từ widthM (97 quan sát/18 ảnh, vd pano_446: widthM = '#b8a890', wallName = 'tube_old', ground = '#2060b0'…)
      // → dời lại: mất widthM, phần còn lại đúng thứ tự
      if (typeof b.widthM === 'string' && /^#[0-9a-f]{6}$/i.test(b.widthM.trim())) {
        const s = b.sign && typeof b.sign === 'object' ? b.sign : {};
        b = { x0: b.x0, x1: b.x1, depth: b.depth, floors: b.floors, floorsSure: b.floorsSure, widthM: null, wall: b.widthM, style: b.wallName,
          balcony: b.style, windows: b.balcony, ground: b.windows, sign: { present: s.present, bg: b.ground, fg: s.bg, size: s.fg, floorSpan: s.size },
          awning: s.floorSpan, roof: b.awning, age: b.roof };
        st.shiftFixed = (st.shiftFixed || 0) + 1;
      }
      let x0 = +b.x0, x1 = +b.x1;
      if (!(x0 >= 0 && x1 <= 1.0001 && x1 > x0 + 0.005)) { st.droppedObs++; continue; }
      const sg = b.sign && typeof b.sign === 'object' ? b.sign : {};
      const row = new Array(FP_COLS.length).fill(-1);
      row[C.pano] = pi; row[C.heading] = heading; row[C.x0] = +x0.toFixed(3); row[C.x1] = +Math.min(1, x1).toFixed(3);
      row[C.depth] = enumIdx(FP_ENUMS.depth, b.depth);
      const fl = Math.round(+b.floors); row[C.floors] = fl >= 1 && fl <= 60 ? fl : -1;
      row[C.sure] = b.floorsSure === false ? 0 : 1;
      const w = +b.widthM; row[C.widthM] = w > 0 && w < 400 ? +w.toFixed(1) : -1;
      row[C.wall] = hexInt(b.wall);
      for (const k of ['style', 'balcony', 'windows', 'ground', 'awning', 'roof', 'age']) {
        let v = enumIdx(FP_ENUMS[k], b[k]);
        if (v < 0 && b[k] != null && b[k] !== '') st.fixedEnum++;
        row[C[k]] = v;
      }
      // ghi lệch cột (vd ground = '#2060c0', style = 'glass_store'): giữ phần hợp lệ, phần lệch = không rõ (−1)
      if (row[C.style] < 0 && FP_ENUMS.ground.includes(b.style)) row[C.ground] = row[C.ground] >= 0 ? row[C.ground] : FP_ENUMS.ground.indexOf(b.style);
      row[C.signPresent] = sg.present === true ? 1 : sg.present === false ? 0 : -1;
      row[C.signBg] = hexInt(sg.bg); row[C.signFg] = hexInt(sg.fg);
      row[C.size] = enumIdx(FP_ENUMS.size, sg.size);
      // sửa hồi quy W4 (pano_046 h270): agent ghi 'multi'/'banner' cho biển quảng cáo DỰNG TRÊN MÁI (ghi chú "biển … trên mái")
      // → citygen dựng bảng lớn MỌI BAY tầng 1-2 thay vì 1 tấm trên mái. Ghi chú nói rõ 1 biển trên mái (không kèm '+' biển khác)
      // → 'roof' (5 quan sát: 046 h225/270, 068 h90, 177 h0, 401 h0). Ghi chú không vào facade_fp.json nên sửa ở bước gộp
      if ((row[C.size] === FP_ENUMS.size.indexOf('multi') || row[C.size] === FP_ENUMS.size.indexOf('banner')) && typeof b.notes === 'string'
        && !b.notes.includes('+') && /biển[^,;+]*trên (mái|nóc)/i.test(b.notes)) { row[C.size] = FP_ENUMS.size.indexOf('roof'); st.roofFromNotes = (st.roofFromNotes || 0) + 1; }
      const sp = Math.round(+sg.floorSpan); row[C.span] = sp >= 0 && sp <= 9 ? sp : -1;
      obs.push(row); st.obs++;
      if (notes) notes.push(typeof b.notes === 'string' ? b.notes : '');
    }
  }
  return { v: 1, note: 'W4-A: quan sát mặt tiền từng nhà trong ảnh pano thật (tools/gen_facade_fp.mjs --collect). obs[i] theo cols; −1 = không rõ; màu = số nguyên 0xRRGGBB (sRGB).',
    halfFov: HALF_FOV, enums: FP_ENUMS, cols: FP_COLS, panos, obs, stats: st, ...(notes ? { notes } : {}) };
}

export function loadFacadeFP(file = new URL('../audit/facade_fp.json', import.meta.url)) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ---------------- GHIM QUAN SÁT (duyệt ảnh) ----------------
// Một số nhà nhận nhiều quan sát CÙNG pano mâu thuẫn (khung xiên ở mép ảnh thấy nhà bên cạnh) và phiếu gần HOÀ — dịch footprint
// ~1 m là lật kết quả. FP_PIN = quan sát đã đối chiếu ảnh thật là ĐÚNG cho nhà nó chạm → trọng số × w. Khoá theo (pano, hướng,
// x0, x1) của dòng trong audit/facade_fp.json; chỉ THÊM khi có ảnh chứng minh, ghi lý do.
export const FP_PIN = [
  // 2026-10-15: 331 h90 phải = quán mở + mái bạt SỌC (ảnh thật, như dot3 bcdcacc). Ngõ 5,5 m W5-D đưa mặt lô ra sát ngõ ~1 m ⇒
  // tia h135 x 0,6-0,72 ('shutter', thật là nhà phía nam) nay chạm lô này ⇒ phiếu tầng trệt shutter 1,256 > restaurant 1,236.
  { pano: 'pano_331', heading: 90, x0: 0.58, x1: 1, w: 2 },
];
function pinWeights(FP) {
  const m = new Map();
  FP_PIN.forEach((p) => {
    const pk = FP.panos.findIndex((q) => q[0] === p.pano); let n = 0;
    FP.obs.forEach((o, oi) => { if (o[C.pano] === pk && o[C.heading] === p.heading && Math.abs(o[C.x0] - p.x0) < 1e-6 && Math.abs(o[C.x1] - p.x1) < 1e-6) { m.set(oi, p.w); n++; } });
    if (n !== 1) console.warn(`FP_PIN ${p.pano} h${p.heading} x${p.x0}-${p.x1}: khớp ${n} quan sát (cần đúng 1)`);
  });
  return m;
}

// ---------------- ÁNH XẠ quan sát → footprint ----------------
// polys: mảng đa giác [[x,z],...] (chỉ số = chỉ số nhà). Trả { fp: Map(bi → bản ghi gộp), stats, hits: [...] }.
export function mapFacadeFP(polys, FP, opts = {}) {
  const maxD = opts.maxD ?? 90, CELL = 6;
  // lưới cạnh
  const grid = new Map(); const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  const E = [];   // [ax, az, bx, bz, bi]
  const bbs = [];
  polys.forEach((P, bi) => {
    if (!P || P.length < 3) { bbs.push(null); return; }
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
      const ei = E.length; E.push([a[0], a[1], b[0], b[1], bi]);
      for (let i = Math.floor(Math.min(a[0], b[0]) / CELL); i <= Math.floor(Math.max(a[0], b[0]) / CELL); i++)
        for (let j = Math.floor(Math.min(a[1], b[1]) / CELL); j <= Math.floor(Math.max(a[1], b[1]) / CELL); j++) {
          const k2 = key(i, j); let l = grid.get(k2); if (!l) grid.set(k2, (l = [])); l.push(ei);
        }
    }
    bbs.push([x0, z0, x1, z1]);
  });
  const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  // nhà CHỨA điểm (x,z) — dùng lưới cạnh quanh điểm
  const containing = (x, z) => {
    const out = new Set(); const seen = new Set();
    for (let i = Math.floor(x / CELL) - 8; i <= Math.floor(x / CELL) + 8; i++) for (let j = Math.floor(z / CELL) - 8; j <= Math.floor(z / CELL) + 8; j++) {
      const l = grid.get(key(i, j)); if (!l) continue;
      for (const ei of l) { const bi = E[ei][4]; if (seen.has(bi)) continue; seen.add(bi); const bb = bbs[bi]; if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(polys[bi], x, z)) out.add(bi); }
    }
    return out;
  };
  // tia (ox,oz) hướng (dx,dz): DDA qua lưới, giao gần nhất → {t, bi, ei}
  const cast = (ox, oz, dx, dz, skip) => {
    let i = Math.floor(ox / CELL), j = Math.floor(oz / CELL);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : 1e30, tdz = Math.abs(dz) > 1e-12 ? CELL / Math.abs(dz) : 1e30;
    let tmx = Math.abs(dx) > 1e-12 ? ((dx > 0 ? (i + 1) * CELL - ox : ox - i * CELL) / Math.abs(dx)) : 1e30;
    let tmz = Math.abs(dz) > 1e-12 ? ((dz > 0 ? (j + 1) * CELL - oz : oz - j * CELL) / Math.abs(dz)) : 1e30;
    let best = null; const tested = new Set();
    for (let it = 0; it < 64; it++) {
      const l = grid.get(key(i, j));
      if (l) for (const ei of l) {
        if (tested.has(ei)) continue; tested.add(ei);
        const e = E[ei]; if (skip.has(e[4])) continue;
        const ex = e[2] - e[0], ez = e[3] - e[1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-12) continue;
        const wx = e[0] - ox, wz = e[1] - oz;
        const t = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
        if (t > 0.3 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, bi: e[4], ei };
      }
      const tExit = Math.min(tmx, tmz);
      if (best && best.t <= tExit) break;
      if (tExit > maxD) break;
      if (tmx < tmz) { tmx += tdx; i += si; } else { tmz += tdz; j += sj; }
    }
    return best && best.t <= maxD ? best : null;
  };
  const TAN = Math.tan(((FP.halfFov || HALF_FOV) * Math.PI) / 180);
  const DEPTH_OK = opts.depthOk || [[0, 26], [5, 52], [15, 90], [3, 60]];   // near, mid, far, không rõ
  const DEPTH_W = [1, 0.6, 0.25, 0.4];
  const per = new Map();   // bi → [{o, w, d}]
  const st = { obs: 0, assigned: 0, noHit: 0, depthReject: 0, camInside: 0, perObsBuildings: 0 };
  const hits = opts.keepHits ? [] : null;
  const camSkip = new Map();
  const PIN = pinWeights(FP);
  for (let oi = 0; oi < FP.obs.length; oi++) {
    const o = FP.obs[oi]; st.obs++;
    const pano = FP.panos[o[C.pano]]; const px = pano[1], pz = pano[2];
    const pk = o[C.pano]; let skip = camSkip.get(pk); if (!skip) { skip = containing(px, pz); camSkip.set(pk, skip); if (skip.size) st.camInside++; }
    const x0 = o[C.x0], x1 = o[C.x1], span = x1 - x0;
    const K = Math.max(3, Math.min(12, Math.round(span * 40)));
    const dIdx = o[C.depth] >= 0 ? o[C.depth] : 3;
    // lượt 1: cửa sổ độ sâu theo lớp near/mid/far; không tia nào lọt → lượt 2 nới (dữ liệu footprint/đăng ký lệch: nhà thật
    // đứng sau hàng cây/ki-ốt không có trong RB, hoặc camera lệch vài mét) với trọng số × 0,5
    let cnt = null, nOK = 0, relax = 1;
    for (const [dlo, dhi, rw] of [[...DEPTH_OK[dIdx], 1], [dIdx === 2 ? 10 : 0, dIdx === 0 ? 40 : 70, 0.5]]) {
      cnt = new Map(); nOK = 0; relax = rw;
      for (let k = 0; k < K; k++) {
        const x = x0 + span * (0.12 + 0.76 * (K === 1 ? 0.5 : k / (K - 1)));
        const brg = o[C.heading] + (Math.atan((x - 0.5) * 2 * TAN) * 180) / Math.PI;
        const a = (brg * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
        const h = cast(px, pz, dx, dz, skip);
        if (!h) continue;
        if (h.t < dlo || h.t > dhi) { if (rw === 1) st.depthReject++; continue; }
        nOK++;
        let c = cnt.get(h.bi); if (!c) cnt.set(h.bi, (c = { n: 0, ts: [], ei: new Set(), pts: [] }));
        c.n++; c.ts.push(h.t); c.ei.add(h.ei); c.pts.push([px + dx * h.t, pz + dz * h.t]);
      }
      if (nOK) break;
    }
    if (!nOK) { st.noHit++; continue; }
    if (relax < 1) st.relaxed = (st.relaxed || 0) + 1;
    let maxN = 0; for (const c of cnt.values()) maxN = Math.max(maxN, c.n);
    const need = Math.max(1, Math.ceil(0.2 * K));
    let any = false;
    for (const [bi, c] of [...cnt.entries()].sort((p, q) => p[0] - q[0])) {
      if (c.n < need && c.n < maxN) continue;
      // phủ: bề rộng chạm (2 điểm chạm xa nhất + 1 khoảng tia) / cạnh chạm dài nhất
      let wHit = 0; for (const p of c.pts) for (const q of c.pts) wHit = Math.max(wHit, Math.hypot(p[0] - q[0], p[1] - q[1]));
      const dMed = c.ts.slice().sort((p, q) => p - q)[c.ts.length >> 1];
      wHit += (span * 2 * TAN * dMed) / K;   // ~ khoảng giữa 2 tia ở độ sâu đó (xấp xỉ)
      let eL = 0; for (const ei of c.ei) { const e = E[ei]; eL = Math.max(eL, Math.hypot(e[2] - e[0], e[3] - e[1])); }
      const cover = Math.min(1, wHit / Math.max(1, eL));
      const w = relax * DEPTH_W[dIdx] * (c.n / K) * (0.35 + 0.65 * cover) * (o[C.sure] === 0 ? 0.8 : 1) * (PIN.get(oi) || 1);
      let L = per.get(bi); if (!L) per.set(bi, (L = []));
      L.push({ oi, w, d: dMed, cover });
      st.perObsBuildings++; any = true;
      if (hits) hits.push([oi, bi, +dMed.toFixed(1), +w.toFixed(3)]);
    }
    if (any) st.assigned++;
  }
  // ---- gộp từng nhà ----
  const vote = (L, col, filt = null) => {
    const m = new Map();
    for (const r of L) { const v = FP.obs[r.oi][col]; if (v < 0 || (filt && !filt(r))) continue; m.set(v, (m.get(v) || 0) + r.w); }
    let best = -1, bw = 0; for (const [v, w] of [...m.entries()].sort((p, q) => p[0] - q[0])) if (w > bw) { bw = w; best = v; }
    return best;
  };
  const toLin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const toS = (l) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
  const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const fp = new Map();
  for (const bi of [...per.keys()].sort((a, b) => a - b)) {
    const L = per.get(bi).slice().sort((p, q) => q.w - p.w || p.d - q.d || p.oi - q.oi);
    const tot = L.reduce((a, r) => a + r.w, 0);
    const top = FP.obs[L[0].oi];
    // tầng: trung vị có trọng số, ưu tiên near/mid
    const flL = L.filter((r) => FP.obs[r.oi][C.floors] > 0 && FP.obs[r.oi][C.depth] !== 2);
    const flSrc = flL.length ? flL : L.filter((r) => FP.obs[r.oi][C.floors] > 0);
    let floors = -1, flAgree = 0, flNM = 0;
    if (flSrc.length) {
      const arr = flSrc.map((r) => [FP.obs[r.oi][C.floors], r.w * (FP.obs[r.oi][C.sure] ? 1.5 : 1)]).sort((p, q) => p[0] - q[0]);
      const sumW = arr.reduce((a, p) => a + p[1], 0), half = sumW / 2; let acc = 0;
      for (const [f, w] of arr) { acc += w; if (acc >= half) { floors = f; break; } }
      // W4-A r2 (phản biện): ĐỘ ĐỒNG THUẬN = phần trọng số trong ±1 tầng quanh trung vị (16 vs 1 → ~0,5: không tin);
      // flNM = số quan sát near/mid có tầng (applyFP chỉ áp tầng khi đồng thuận đủ)
      for (const [f, w] of arr) if (Math.abs(f - floors) <= 1) flAgree += w;
      flAgree = sumW > 0 ? flAgree / sumW : 0;
      flNM = flSrc.filter((r) => FP.obs[r.oi][C.depth] === 0 || FP.obs[r.oi][C.depth] === 1).length;
    }
    // màu tường: các quan sát gần màu quan sát nặng nhất có màu
    // W4-A r2 (phản biện): bộ trích xuất đôi khi ghi MÀU BIỂN/BẠT làm màu tường (pano_193 h0: cả nhà đỏ, tường thật nhạt)
    // → bỏ quan sát có màu tường ≈ màu nền biển của CHÍNH nó (ΔRGB < 40); màu rất rực (HSV S > 0,6) trọng số × 0,3 để một
    // quan sát nhạt cùng nhà thắng làm màu tham chiếu (applyFP còn chặn S ≤ 0,45)
    let wall = -1, wallDrop = 0;
    const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / mx : 0; };
    const wl = [];
    for (const r of L) {
      const o = FP.obs[r.oi]; if (o[C.wall] < 0) continue;
      const c = rgb(o[C.wall]);
      if (o[C.signBg] >= 0 && o[C.signPresent] !== 0) { const sb = rgb(o[C.signBg]); if (Math.hypot(c[0] - sb[0], c[1] - sb[1], c[2] - sb[2]) < 40) { wallDrop++; continue; } }
      wl.push({ r, c, w: r.w * (sat(c) > 0.6 ? 0.3 : 1) });
    }
    wl.sort((p, q) => q.w - p.w || p.r.oi - q.r.oi);
    if (wl.length) {
      const ref = wl[0].c; const acc = [0, 0, 0]; let ws = 0;
      for (const { c, w } of wl) {
        if (Math.hypot(c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]) > 70) continue;
        for (let k = 0; k < 3; k++) acc[k] += toLin(c[k]) * w; ws += w;
      }
      const s = acc.map((v) => Math.max(0, Math.min(255, toS(v / ws))));
      wall = (s[0] << 16) | (s[1] << 8) | s[2];
    }
    const size = vote(L, C.size);
    let sign = null;
    if (size > 0) {
      // màu biển: ưu tiên quan sát nặng nhất có biển CÙNG cỡ đã bỏ phiếu (phản biện r1), không có thì nặng nhất có biển
      const hasS = (r) => FP.obs[r.oi][C.signPresent] === 1 && FP.obs[r.oi][C.signBg] >= 0;
      const sr = L.find((r) => hasS(r) && FP.obs[r.oi][C.size] === size) || L.find(hasS);
      if (sr) { const so = FP.obs[sr.oi]; sign = { size, bg: so[C.signBg], fg: so[C.signFg] >= 0 ? so[C.signFg] : 0xffffff, span: Math.max(1, so[C.span] > 0 ? so[C.span] : 1) }; }
    }
    const signNone = size === 0 || (vote(L, C.signPresent) === 0);
    fp.set(bi, {
      n: L.length, w: +tot.toFixed(3), cover: +Math.max(...L.map((r) => r.cover)).toFixed(2), d: +L[0].d.toFixed(1),
      floors, flAgree: +flAgree.toFixed(3), flNM, wallDrop, wall, style: vote(L, C.style), balcony: vote(L, C.balcony), windows: vote(L, C.windows), ground: vote(L, C.ground),
      sign: signNone ? { size: 0 } : sign, awning: vote(L, C.awning), roof: vote(L, C.roof), age: vote(L, C.age),
      widthM: top[C.widthM], src: FP.panos[top[C.pano]][0] + '_h' + String(top[C.heading]).padStart(3, '0'),
    });
  }
  st.buildings = fp.size;
  return { fp, stats: st, hits };
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const A = process.argv.slice(2);
  if (A[0] === '--collect') {
    const out = collectFP(A[1], A[2]);
    const f = new URL('../audit/facade_fp.json', import.meta.url);
    // 1 dòng / quan sát (diff đọc được, ~1 MB)
    const head = JSON.stringify({ ...out, panos: undefined, obs: undefined });
    const txt = head.slice(0, -1) + ',\n"panos":' + JSON.stringify(out.panos) + ',\n"obs":[\n' + out.obs.map((r) => JSON.stringify(r)).join(',\n') + '\n]}\n';
    fs.writeFileSync(f, txt);
    console.log('ghi audit/facade_fp.json', (txt.length / 1e6).toFixed(2) + ' MB', JSON.stringify(out.stats));
  } else {
    const { RB_B64 } = await import('../js/buildings_real.js');
    const { decodeRB, EDGE, FLAG } = await import('../js/buildings_data.js');
    const D = decodeRB(RB_B64);
    const FP = loadFacadeFP(); if (!FP) { console.error('thiếu audit/facade_fp.json — chạy --collect trước'); process.exit(1); }
    const polys = []; for (let b = 0; b < D.nB; b++) { const P = []; for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) P.push([D.x[v], D.z[v]]); polys.push(P); }
    const t0 = Date.now();
    const R = mapFacadeFP(polys, FP, { keepHits: A.includes('--dump') });
    console.log('ánh xạ', Date.now() - t0, 'ms', JSON.stringify(R.stats));
    // độ phủ: nhà có cạnh FRONT mà trung điểm cạnh cách camera pano ≤ 40 m
    const pg = new Map(); const PG = 40;
    for (const p of FP.panos) { const k = Math.floor(p[1] / PG) * 65536 + Math.floor(p[2] / PG); let l = pg.get(k); if (!l) pg.set(k, (l = [])); l.push(p); }
    const nearPano = (x, z, r) => { for (let i = Math.floor(x / PG) - 1; i <= Math.floor(x / PG) + 1; i++) for (let j = Math.floor(z / PG) - 1; j <= Math.floor(z / PG) + 1; j++) { const l = pg.get(i * 65536 + j); if (l) for (const p of l) if (Math.hypot(p[1] - x, p[2] - z) <= r) return true; } return false; };
    let nF = 0, nFp = 0, nF20 = 0, nFp20 = 0; const bySrc = {};
    for (let b = 0; b < D.nB; b++) {
      let hit = false, hit20 = false;
      for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) {
        if (D.edge[v] !== EDGE.FRONT) continue;
        const w = v + 1 < D.vStart[b + 1] ? v + 1 : D.vStart[b];
        const mx = (D.x[v] + D.x[w]) / 2, mz = (D.z[v] + D.z[w]) / 2;
        if (nearPano(mx, mz, 40)) hit = true; if (nearPano(mx, mz, 20)) hit20 = true;
      }
      const has = D.fpE ? D.fpE[b] >= 0 : R.fp.has(b);   // file đã có mục RBF1 → độ phủ THẬT (sau ngưỡng trọng số)
      if (hit) { nF++; if (has) nFp++; const k = D.flags[b] & FLAG.SYNTH ? 'synth' : 'real'; bySrc[k] = bySrc[k] || [0, 0]; bySrc[k][0]++; if (has) bySrc[k][1]++; }
      if (hit20) { nF20++; if (has) nFp20++; }
    }
    console.log((D.fpE ? '[RBF1 trong file] ' : '[ánh xạ thô] ') + `độ phủ: nhà mặt phố ≤ 40 m quanh pano ${nFp}/${nF} = ${(100 * nFp / nF).toFixed(1)}% · ≤ 20 m ${nFp20}/${nF20} = ${(100 * nFp20 / nF20).toFixed(1)}%`, JSON.stringify(bySrc));
    const dist = (k, list) => { const m = {}; for (const r of R.fp.values()) { const v = k === 'size' ? (r.sign ? r.sign.size : -1) : r[k]; const n = v < 0 ? '?' : list ? list[v] : v; m[n] = (m[n] || 0) + 1; } return m; };
    for (const k of ['style', 'ground', 'balcony', 'windows', 'awning', 'age']) console.log(k, JSON.stringify(dist(k, FP_ENUMS[k])));
    console.log('size', JSON.stringify(dist('size', FP_ENUMS.size)), 'floors', JSON.stringify(dist('floors')));
    const di = A.indexOf('--dump');
    if (di >= 0) fs.writeFileSync(A[di + 1], JSON.stringify({ fp: [...R.fp.entries()], hits: R.hits }));
  }
}
