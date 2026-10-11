// parcels_ev.mjs — BẰNG CHỨNG Ô ĐẤT cho tools/process_buildings.mjs (Đợt 3 wave 3 W3-B PARCELS).
// Hải Phòng không chỉ có 1 kiểu ô đất (KNOWLEDGE §8b V2-V4): (a) dãy nhà ống liền kề bán hàng, (b) CƠ QUAN / BIỆT THỰ
// KHUÔN VIÊN (tường rào/hàng rào sắt + cổng + nhà lùi 8-25 m, không biển hàng), (c) ĐẤT TRỐNG / công trường (rào tôn,
// tường lô, đất), (d) chợ. Generator cũ chỉ biết (a): lấp khe/lõi ô bằng nhà ống SINH ở mọi nơi có nhà thật gần,
// kéo mặt tiền biệt thự ra sát vỉa hè, công năng tầng trệt chỉ theo cấp phố → kiểm toán AUDIT3: TYPO/INFILL/GAP.
// Module này cung cấp (không import three, chạy trong node):
//   - luAt(x,z): lớp sử dụng đất (js/landuse_data.js, raster 2 m từ OSM — W2-D) + LU_VETO (lớp cấm nhà SINH/nới nhà)
//   - classifyObs(o): quan sát nhà của pano (audit_enriched.buildings[]) → {kind, walled, wall, civic, villa, col}
//   - classifyPanoText(p): chữ cấp pano (area/summary/special) → ['vacant'|'market'|...]
//   - makeEvidence(...): chỉ mục không gian → kindAt(x,z) (bỏ phiếu theo NÓN nhìn ±25° từ pano tới điểm, ≤ 40 m)
//   - zoneOf(name): bảng VÙNG (biệt thự/hành chính, đô thị mới, chợ…) theo tên phố → trần xác suất cửa hàng
//   - WallSet: gom đoạn tường/rào theo facadeLine → RB_PARCELS (js/parcels.js dựng lúc chạy)
import zlib from 'zlib';
import { LU_META, LU_CLS } from '../js/landuse_data.js';

// ---------- lớp sử dụng đất (W2-D) ----------
const LN = LU_META.n, LRES = LU_META.res, LX0 = LU_META.x0, LZ0 = LU_META.z0;
const LUC = (() => {
  const raw = zlib.inflateRawSync(Buffer.from(LU_CLS, 'base64'));
  const c = new Uint8Array(LN * LN);
  for (let i = 0; i < LN * LN; i++) c[i] = (raw[i] + (i >= LN ? c[i - LN] : 0)) & 255;
  return c;
})();
export const LU = LU_META.classes;
export function luAt(x, z) {
  const i = Math.floor((x - LX0) / LRES), j = Math.floor((z - LZ0) / LRES);
  return i >= 0 && j >= 0 && i < LN && j < LN ? LUC[j * LN + i] : 0;
}
// lớp đất KHÔNG được mọc nhà SINH / nới nhà thật vào: sân lát/quảng trường, sân chùa, khuôn viên trường-viện-cơ quan,
// bãi xe, công trường/đất trống, cỏ/công viên, cỏ dại/ruộng, sân thể thao, bể bơi, chợ (OSM — nhà THẬT trong đó giữ nguyên)
export const LU_VETO = new Set([LU.PLAZA, LU.TEMPLE, LU.CAMPUS, LU.PARKING, LU.DIRT, LU.GRASS, LU.ROUGH, LU.TURF, LU.COURT, LU.TRACK, LU.POOL, LU.MARKET]);
export const luVeto = (x, z) => LU_VETO.has(luAt(x, z));
// lớp → kiểu tường mặt phố khi lô khe bị chặn (−1 = để thoáng): khuôn viên trường/viện/cơ quan, chùa → hàng rào; đất trống → rào tôn
export const LU_WALL = { [LU.CAMPUS]: 1, [LU.TEMPLE]: 0, [LU.DIRT]: 2, [LU.TURF]: 1, [LU.COURT]: 1, [LU.TRACK]: 1, [LU.POOL]: 1 };

// ---------- phân loại chữ quan sát pano ----------
// KIỂU Ô (kind): 'compound' (cơ quan/biệt thự/trường… — không biển hàng, có thể có tường rào), 'home' (nhà ở, không bán
// hàng), 'shop', 'vacant' (đất trống/công trường/lô quây tôn), 'market' (chợ, sạp), '' (không rõ)
// Kiểu TƯỜNG (wall): 0 tường rào xây trát, 1 hàng rào sắt trên tường lửng (+ trụ), 2 rào tôn, 3 tường gạch/bê tông lô đất trống
export const WALL = { MASONRY: 0, FENCE: 1, HOARD: 2, LOTWALL: 3 };
// (chú ý: \b của JS không hiểu chữ có dấu — "chợ\b" không bao giờ khớp; dùng ranh giới tường minh)
// ĐẤT TRỐNG = lô không có nhà (rào tôn/tường lô/bãi/giải toả). "đang xây/thi công/phá dỡ/đổ nát" là NHÀ (vỏ công trình —
// W3-C), không phải lô trống.
const RX_VACANT = /đất trống|lô (đất )?trống|lô đất|bãi (đất|trống|phế|san lấp|giải)|giải t[ỏo]a|quây tôn|rào tôn|tôn quây|quây tường|phế (liệu|thải)/;
const RX_COMPOUND_T = /công sở|trụ sở|cơ quan|trường|bệnh viện|trung tâm y tế|y tế|ủy ban|uỷ ban|ubnd|nhà văn ho[áa]|mầm non|nhà trẻ|bảo tàng|khuôn viên|doanh trại|chỉ huy|công an|quân (đội|sự)|viện|biệt thự|công trình (lớn|công cộng)|nhà khách|hành chính|sau tường rào|sau hàng rào/;
const RX_STRONG = /biệt thự|trường|bệnh viện|mầm non|nhà trẻ|ủy ban|uỷ ban|ubnd|doanh trại|chỉ huy|công an|y tế|khuôn viên|sau tường rào|sau hàng rào/;
const RX_WALLWORD = /tường rào|hàng rào|rào sắt|rào sơn|con tiện|cổng|chòi gác|bốt gác|nhà bảo vệ|sân (trước|trong|vườn|cây|rộng)|sân vườn|vườn/;
const RX_SHOPT = /shophouse|cửa hàng|quán|buôn bán|kinh doanh|tiệm|showroom|nhà hàng|cà phê|cafe|coffee|salon|spa|gara|đại lý|ki-?ốt|sạp|nhà thuốc|ngân hàng|siêu thị|cửa hiệu/;
const RX_SHOPF = /biển '|biển "|biển hiệu|bày bán|bán (buôn|lẻ|hàng)|cửa hàng|quán|gội đầu|cắt tóc/;
const RX_ROWHOME = /liền kề|nhà ở|nhà dân|nhà cấp (bốn|4)|tập thể|chung cư|nhà riêng/;
const RX_MARKET = /(^|[^a-zà-ỹ])(chợ|sạp)([^a-zà-ỹ]|$)/;
export function classifyObs(o) {
  const s = String(o.style || '').toLowerCase(), f = String(o.features || '').toLowerCase(), c = String(o.color || '').toLowerCase();
  const all = s + ' | ' + f;
  const r = { kind: '', walled: false, wall: -1, civic: false, villa: false, col: -1, gate: /cổng/.test(all), booth: /chòi gác|bốt gác|nhà bảo vệ|thường trực|nhà gác/.test(all) };
  if (RX_VACANT.test(s) && !/nhà ống|nhà cao tầng|nhà \d|cao ốc|tòa|toà|chung cư|shophouse/.test(s)) { r.kind = 'vacant'; r.wall = /tường|bê tông|gạch/.test(all) && !/tôn(?!g)|container/.test(all) ? WALL.LOTWALL : WALL.HOARD; }
  else if (RX_MARKET.test(s) && !/nhà ống|shophouse/.test(s)) r.kind = 'market';
  else if (RX_COMPOUND_T.test(s) && !/shophouse|nhà ống|cửa hàng|nhà phố|liền kề/.test(s) && !(RX_SHOPF.test(f) && !RX_STRONG.test(s) && !/ủy ban|uỷ ban|sở |trụ sở|cơ quan/.test(f))) {
    r.kind = 'compound';
    r.villa = /biệt thự/.test(s);
    r.civic = !r.villa;
    r.walled = RX_WALLWORD.test(all) || RX_STRONG.test(s);
    if (r.walled) r.wall = /hàng rào sắt|rào sắt|con tiện|song sắt|hàng rào (trắng|xanh|đen|trang trí)|tường lửng/.test(all) ? WALL.FENCE
      : /tường rào|tường (vàng|trắng|bao)|phù điêu/.test(all) ? WALL.MASONRY : WALL.FENCE;
  } else if (/cao ốc|cao tầng|văn phòng|tòa nhà|toà nhà|khách sạn/.test(s) && /tường rào|hàng rào|rào sắt/.test(all)) {
    // cao ốc / văn phòng có TƯỜNG RÀO phía trước (225 h270: cụm cao ốc sau tường rào mỏ neo khu cảng) → khuôn viên (giữ kiểu kính)
    r.kind = 'compound'; r.civic = true; r.walled = true;
    r.wall = /hàng rào sắt|rào sắt|song sắt/.test(all) ? WALL.FENCE : WALL.MASONRY;
  } else if (RX_SHOPT.test(s) || RX_SHOPF.test(f)) r.kind = 'shop';
  else if (RX_ROWHOME.test(s)) r.kind = 'home';
  // MÀU: chỉ cụm chữ tả TƯỜNG/RÀO/TRỤ/CỔNG (màu nhà/chòi gác/cờ không tính — 496 "chòi gác vàng" từng nhuộm cả rào).
  // col = màu tường/trụ (bit 0-3: 0 vàng, 1 trắng kem, 2 xám, 3 xanh nhạt, 4 gạch đỏ; tôn 5-8) | màu SONG SẮT << 4 (0 đen-xanh
  // sẫm, 1 trắng, 2 xanh lá)
  if (r.wall >= 0) {
    const t = c + ' ' + f + ' ' + s;
    if (r.wall === WALL.HOARD) r.col = /tôn (sơn )?xanh (dương|lam)|tôn xanh dương/.test(t) ? 5 : /tôn (sơn )?xanh/.test(t) ? 6 : /tôn (sơn )?đỏ/.test(t) ? 7 : 8;
    else {
      const m = t.match(/(tường|rào|trụ|cổng)[^,;.()]{0,18}?(vàng|trắng|xám|kem|xanh|đỏ|hồng|gạch)/);
      const wc = m ? m[2] : '';
      r.col = wc === 'vàng' ? 0 : wc === 'trắng' || wc === 'kem' || wc === 'hồng' ? 1 : wc === 'xám' ? 2 : wc === 'xanh' ? 3 : wc === 'đỏ' || wc === 'gạch' ? 4
        : r.wall === WALL.LOTWALL ? 2 : r.wall === WALL.MASONRY ? 0 : 1;
      const rc = /sắt (sơn )?trắng|rào (sắt )?trắng|con tiện trắng|hàng rào trắng/.test(t) ? 1 : /sắt (sơn )?xanh|rào (sắt )?xanh/.test(t) ? 2 : 0;
      r.col |= rc << 4;
    }
  }
  return r;
}
// chữ cấp pano (không có hướng): đất trống/công trường, chợ — dùng kèm mặt nạ hướng PANO_SIDES (hướng không tả nhà nào)
const RX_VACANT_P = /lô đất trống|lô trống|bãi đất|đất trống|giải t[ỏo]a|quây tôn|rào tôn|tôn quây|quây tường|lô đất quây|phế liệu|phế thải/;
export function classifyPanoText(p) {
  const t = `${p.area || ''} ${p.summary || ''} ${(p.special || []).join(' ')}`.toLowerCase();
  const out = [];
  if (RX_VACANT_P.test(t)) out.push('vacant');
  if (RX_MARKET.test(t) && /sạp|ô dù|hàng rong|chợ dân sinh|cổng chợ|ngõ chợ|lối vào chợ|sân chợ/.test(t)) out.push('market');
  return out;
}

// ---------- chỉ mục bằng chứng ----------
// panos: [{x, z, mask, obs:[{h (rad la bàn), w (m), cls}], text:[...]}]
export function makeEvidence(AUD, PANO_SIDES) {
  const P = [];
  for (const p of AUD) {
    if (typeof p.X !== 'number') continue;
    const ps = PANO_SIDES.find((q) => Math.abs(q[0] - p.X) < 0.6 && Math.abs(q[1] - p.Z) < 0.6);
    const obs = (p.buildings || []).map((o) => ({ h: ((+o.heading || 0) * Math.PI) / 180, deg: +o.heading || 0, w: +o.width_m || 0, fl: +o.floors || 0, cls: classifyObs(o) }));
    const tx = `${p.area || ''} ${p.summary || ''} ${(p.special || []).join(' ')}`.toLowerCase();
    const vwall = /quây tường|tường (bê tông|gạch|bao|rào bê tông)|tường lô/.test(tx) && !/tôn(?!g)|container/.test(tx) ? WALL.LOTWALL : WALL.HOARD;
    const vcol = vwall === WALL.LOTWALL ? 2 : /tôn xanh dương|tôn xanh lam/.test(tx) ? 5 : /tôn xanh/.test(tx) ? 6 : /tôn đỏ/.test(tx) ? 7 : 8;
    P.push({ id: p.id, x: p.X, z: p.Z, mask: ps ? ps[2] : 255, obs, text: classifyPanoText(p), vwall, vcol });
  }
  const G = new Map(), CS = 40, key = (i, j) => i * 100003 + j;
  P.forEach((p, k) => { const kk = key(Math.floor(p.x / CS), Math.floor(p.z / CS)); let a = G.get(kk); if (!a) G.set(kk, (a = [])); a.push(k); });
  const near = (x, z, r, cb) => {
    for (let i = Math.floor((x - r) / CS); i <= Math.floor((x + r) / CS); i++) for (let j = Math.floor((z - r) / CS); j <= Math.floor((z + r) / CS); j++) {
      const a = G.get(key(i, j)); if (a) for (const k of a) cb(P[k]);
    }
  };
  // Bỏ phiếu theo NÓN: điểm (x,z) cách pano 3-RMAX m, hướng la bàn pano→điểm lệch hướng quan sát ≤ cone (±25°, nới theo
  // bề rộng quan sát: atan(w/2 / d)); trọng số giảm theo độ lệch góc + khoảng cách. Chữ cấp pano 'vacant'/'market' chỉ
  // áp cho hướng mà pano KHÔNG tả nhà nào (ô 45° đó + 2 ô kề tắt trong PANO_SIDES) trong 28 m.
  const RMAX = 40;
  function votes(x, z) {
    const V = { compound: 0, home: 0, shop: 0, vacant: 0, market: 0 };
    let walled = 0, wall = -1, wallW = 0, col = 0, villa = 0, civic = 0, best = null;
    near(x, z, RMAX, (p) => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 3 || d > RMAX) return;
      const brg = Math.atan2(dx, -dz);   // la bàn: 0 bắc (−z), π/2 đông (+x)
      for (const o of p.obs) {
        if (!o.cls.kind) continue;
        let da = Math.abs(brg - o.h) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da;
        const cone = Math.max(0.44, Math.min(0.9, Math.atan2(Math.max(4, o.w / 2), d)));
        if (da > cone) continue;
        const wgt = (1 - da / cone) * (1 - d / (RMAX + 5));
        V[o.cls.kind] += wgt;
        if (o.cls.kind === 'compound') {
          if (o.cls.walled) { walled += wgt; if (wgt > wallW) { wallW = wgt; wall = o.cls.wall; col = o.cls.col; } }
          if (o.cls.villa) villa += wgt; else civic += wgt;
        }
        if (o.cls.kind === 'vacant' && wgt > wallW) { wallW = wgt; wall = o.cls.wall; col = o.cls.col; }
        if (!best || wgt > best.wgt) best = { wgt, p, o };
      }
      if (p.text.length && d <= 28) {
        const sc = Math.round((((brg * 180) / Math.PI) + 360) % 360 / 45) % 8, off = (k) => !((p.mask >> ((k + 8) % 8)) & 1);
        if (off(sc) && off(sc - 1) && off(sc + 1)) for (const t of p.text) {
          const wgt = 0.5 * (1 - d / 30);
          V[t] += wgt;
          if (t === 'vacant' && wgt > wallW) { wallW = wgt; wall = p.vwall; col = p.vcol; }
        }
      }
    });
    return { V, walled, wall, col, villa, civic, best };
  }
  // kiểu ô thắng (≥ 0,15 và hơn hẳn các kiểu khác) hoặc ''
  function kindAt(x, z) {
    const r = votes(x, z);
    let k = '', top = 0, sec = 0;
    for (const [kk, v] of Object.entries(r.V)) { if (v > top) { sec = top; top = v; k = kk; } else if (v > sec) sec = v; }
    if (top < 0.15 || top < 1.4 * sec) k = '';
    return { kind: k, score: top, walled: k === 'compound' && r.walled > 0.5 * r.V.compound, wall: r.wall, col: r.col, villa: r.villa > r.civic, V: r.V };
  }
  // kiểu ô của 1 NHÀ: cộng phiếu ở tâm + trung điểm các cạnh (≤ 8) — nhà dài vắt qua 2 nón không bị quyết theo mỗi tâm
  function kindAtPoly(P, cen) {
    const pts = [cen];
    const n = P.length, step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) { const a = P[i], b = P[(i + 1) % n]; pts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
    const V = { compound: 0, home: 0, shop: 0, vacant: 0, market: 0 };
    let best = null;
    for (const [x, z] of pts) {
      const r = kindAt(x, z);
      for (const k in V) V[k] += r.V[k] / pts.length;
      if (r.kind === 'compound' && (!best || r.score > best.score)) best = r;
    }
    let k = '', top = 0, sec = 0;
    for (const [kk, v] of Object.entries(V)) { if (v > top) { sec = top; top = v; k = kk; } else if (v > sec) sec = v; }
    if (top < 0.12 || top < 1.4 * sec) k = '';
    if (k === 'compound' && best) return { ...best, kind: k, score: top, V };
    return { kind: k, score: top, walled: false, wall: -1, col: 0, villa: false, V };
  }
  // CỔNG: tia quan sát có chữ "cổng" (khuôn viên) cắt dãy tường a→b ở cự ly 3-35 m → tham số dọc dãy (m) + có chòi gác?
  function gateOn(a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) return null;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let best = null;
    near(mx, mz, L / 2 + 35, (p) => {
      for (const o of p.obs) {
        if (o.cls.kind !== 'compound' || !o.cls.gate) continue;
        const dx = Math.sin(o.h), dz = -Math.cos(o.h);
        // giao tia p + t·d với đoạn a + s·u
        const den = dx * uz - dz * ux; if (Math.abs(den) < 0.2) continue;
        const wx = a[0] - p.x, wz = a[1] - p.z;
        const t = (wx * uz - wz * ux) / den, s = (wx * dz - wz * dx) / den;
        if (t < 3 || t > 35 || s < 0 || s > L) continue;
        if (!best || t < best.t) best = { t, s, booth: o.cls.booth };
      }
    });
    return best;
  }
  // kiểu tường lô đất trống theo chữ pano GẦN NHẤT có tả đất trống (≤ 60 m) — cho đất OSM công trường (lớp DIRT)
  function vacantWallNear(x, z) {
    let best = null, bd = 60;
    near(x, z, 60, (p) => { if (!p.text.includes('vacant')) return; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } });
    return best ? [best.vwall, best.vcol] : [WALL.HOARD, 8];
  }
  return { panos: P, kindAt, kindAtPoly, votes, near, gateOn, vacantWallNear };
}

// ---------- VÙNG phố (trần xác suất mặt tiền bán hàng khi KHÔNG có bằng chứng pano trực tiếp) ----------
// Từ kiểm toán AUDIT3 §4.4 (lô 9-10: phố biệt thự/hành chính, khu đô thị mới đạt 3,0-3,2 điểm; biển hàng dày đặc trên
// dãy nhà ở là lỗi SIGN/TYPO). Chợ/phố buôn bán: giữ bảng theo cấp phố.
// (Thế Lữ, Hoàng Văn Thụ, Lý Thường Kiệt KHÔNG vào bảng: pano tả dãy quán/shophouse — để bằng chứng pano theo phố quyết định)
// (Trần Quang Khải ĐÃ BỎ khỏi bảng — review lượt 3: AUDIT3 không xếp vào vùng biệt thự, classifyObs pano của phố đo 20 shop /
//  11 nhà ở-khuôn viên = 0,65 cửa hàng; mặc định hàng rào biệt thự rào mất dãy shophouse + sạp hoa quả thật ở 355 h270, cổng
//  giữa dãy quán ăn 360 h90, rào ngang sân trước khách sạn 355 h225 → để Bayes theo phố (31 quan sát) quyết định)
export const ZONES = {
  villa: { names: ['Đinh Tiên Hoàng', 'Hồ Xuân Hương', 'Lê Đại Hành', 'Nguyễn Tri Phương', 'Cù Chính Lan'], shop: 0.2 },
  newurban: { names: ['Lê Quang Đạo'], shop: 0.3 },
};
// ô đa giác vùng (toạ độ game) không gắn được theo tên phố: khu nhà liền kề Ngõ 80 Hạ Lý, dải dân cư mới Hạ Lý
export const ZONE_POLYS = [
  { zone: 'newurban', pts: [[-660, -260], [-560, -260], [-560, -170], [-660, -170]], name: 'ngo80_haly' },
  { zone: 'newurban', pts: [[-1130, -120], [-1040, -120], [-1040, -40], [-1130, -40]], name: 'haly_moi' },
];
export function zoneOfName(nm) {
  if (!nm) return '';
  for (const [z, o] of Object.entries(ZONES)) if (o.names.some((n) => nm.includes(n))) return z;
  return '';
}
// chỉ mục tên phố từ OSM thô (tools/osm_roads_dt.json — ROADS_DT không mang tên): nameAt(x,z,d) = tên way gần nhất ≤ d m
export function makeNameIndex(osmJson, toXZ) {
  const S = [], G = new Map(), CS = 40, key = (i, j) => i * 100003 + j;
  for (const w of osmJson.elements || []) {
    const nm = w.tags && w.tags.name; if (!nm || !w.geometry) continue;
    const P = w.geometry.map((g) => toXZ(g.lon, g.lat));
    for (let i = 0; i + 1 < P.length; i++) {
      const s = [P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], nm]; S.push(s);
      for (let a = Math.floor(Math.min(s[0], s[2]) / CS); a <= Math.floor(Math.max(s[0], s[2]) / CS); a++)
        for (let b = Math.floor(Math.min(s[1], s[3]) / CS); b <= Math.floor(Math.max(s[1], s[3]) / CS); b++) {
          const k = key(a, b); let l = G.get(k); if (!l) G.set(k, (l = [])); l.push(S.length - 1);
        }
    }
  }
  const sd = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9; let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
  return function nameAt(x, z, dmax = 20) {
    let best = null, bd = dmax;
    for (let a = Math.floor((x - dmax) / CS); a <= Math.floor((x + dmax) / CS); a++) for (let b = Math.floor((z - dmax) / CS); b <= Math.floor((z + dmax) / CS); b++) {
      const l = G.get(key(a, b)); if (!l) continue;
      for (const i of l) { const s = S[i], d = sd(x, z, s[0], s[1], s[2], s[3]); if (d < bd) { bd = d; best = s[4]; } }
    }
    return best;
  };
}
const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
export function zoneAt(x, z, nameAt) {
  for (const zp of ZONE_POLYS) if (pip(zp.pts, x, z)) return zp.zone;
  return zoneOfName(nameAt ? nameAt(x, z, 24) : '');
}

// ---------- tập tường/rào mặt phố → RB_PARCELS ----------
// đoạn: {kind, col, h, a:[x,z], b:[x,z], key} — gộp đoạn nối tiếp (cùng phố/phía/kiểu, đầu chạm ≤ 0,6 m) thành polyline
export class WallSet {
  constructor() { this.segs = []; this.gates = []; this.yards = []; }
  // sg: phía của phố (như SEGS: +1 = trong ô ở pháp tuyến TRÁI n=(−uz,ux) của hướng đoạn) — dãy ra được ĐẢO cho mọi dãy có
  // phía trong (sân) ở bên TRÁI hướng polyline: renderer lấy pháp tuyến vào sân = (−uz, ux)
  add(kind, col, a, b, key, yardPoly, sg = 1) {
    this.segs.push({ kind, col, a, b, key, sg });
    if (yardPoly) this.yards.push(yardPoly);
  }
  // polyline gộp + cổng (1 cổng / dãy tường khuôn viên ≥ 10 m: chỗ tia quan sát "cổng" cắt dãy, không có thì giữa dãy;
  // rào tôn / tường lô: không cổng). Đoạn của CÙNG phố-phía-kiểu nối khi đầu chạm (≤ 0,6 m); đỉnh giữa thẳng hàng bỏ.
  build(gateOn) {
    const runs = [];
    const byKey = new Map();
    for (const s of this.segs) { const k = s.key + '|' + s.kind + '|' + s.col; let a = byKey.get(k); if (!a) byKey.set(k, (a = [])); a.push(s); }
    for (const [, L] of byKey) {
      let cur = null;
      for (const s of L) {
        const last = cur && cur.pts[cur.pts.length - 1];
        if (cur && Math.hypot(last[0] - s.a[0], last[1] - s.a[1]) < 0.6) {
          const p0 = cur.pts[cur.pts.length - 2];
          const cr = (last[0] - p0[0]) * (s.b[1] - p0[1]) - (last[1] - p0[1]) * (s.b[0] - p0[0]);
          if (Math.abs(cr) / Math.max(1e-6, Math.hypot(s.b[0] - p0[0], s.b[1] - p0[1])) < 0.05) cur.pts[cur.pts.length - 1] = s.b.slice();
          else cur.pts.push(s.b.slice());
        } else { if (cur) runs.push(cur); cur = { kind: s.kind, col: s.col, sg: s.sg, pts: [s.a.slice(), s.b.slice()] }; }
      }
      if (cur) runs.push(cur);
    }
    for (const r of runs) if (r.sg < 0) r.pts.reverse();
    const out = [], gates = [];
    const len = (P) => { let s = 0; for (let i = 0; i + 1 < P.length; i++) s += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); return s; };
    for (const r of runs) {
      const L = len(r.pts);
      if (L < 3) continue;
      out.push(r);
      if ((r.kind === WALL.FENCE || r.kind === WALL.MASONRY) && L >= 10) {
        // đoạn polyline dài nhất mang cổng
        let k = 0, bl = 0; for (let i = 0; i + 1 < r.pts.length; i++) { const l = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]); if (l > bl) { bl = l; k = i; } }
        const a = r.pts[k], b = r.pts[k + 1], ux = (b[0] - a[0]) / bl, uz = (b[1] - a[1]) / bl;
        const gw = Math.min(5.5, Math.max(3.6, L * 0.15));
        if (bl < gw + 3) continue;
        const g = gateOn ? gateOn(a, b) : null;
        const t = Math.max(gw / 2 + 1.2, Math.min(bl - gw / 2 - 1.2, g ? g.s : bl / 2));
        gates.push({ x: a[0] + ux * t, z: a[1] + uz * t, ang: Math.atan2(uz, ux), w: gw, kind: r.kind, col: r.col, booth: !!(g && g.booth), run: out.length - 1, ev: !!g });
      }
    }
    return { runs: out, gates };
  }
}
