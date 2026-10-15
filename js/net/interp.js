// js/net/interp.js — NỘI SUY / NGOẠI SUY vị trí người chơi khác (MP-2 C2). ESM THUẦN: không three, không DOM, không
// đồng hồ riêng → chạy được trong node (`node --test js/net/interp.test.mjs`) và trong trình duyệt.
//
// Mô hình (ARCH §6, SPEC MP-2 §2 C2):
//  - Mỗi người chơi khác có 1 `Track` = vòng đệm mẫu {t (ms GIỜ MÁY CHỦ), x, y, z, yaw, spd, state}.
//  - Vẽ ở thời điểm renderT = nowServerMs − delay, delay 100–150 ms (tự chỉnh theo nhịp mẫu thật của track: 10 Hz → ~120,
//    tầng xa 5 Hz / suy giảm → 150) → thường luôn có 2 mẫu kẹp 2 bên → nội suy tuyến tính (yaw theo cung ngắn nhất).
//  - Hết mẫu (gói trễ / mất gói): NGOẠI SUY theo vận tốc 2 mẫu cuối, tối đa 250 ms, rồi đứng.
//  - Mẫu mới lệch > 8 m so với quỹ đạo dự đoán (dịch chuyển / CORRECT / hồi sinh) → NHẢY (xoá đệm).
//  - Mẫu mới làm quỹ đạo tại renderT đổi (đang ngoại suy rồi gói trễ tới) → không giật: chênh lệch được giữ thành
//    "độ lệch hiển thị" rồi tắt dần theo hàm mũ (τ 90 ms).
//  - Máy chủ CHỈ gửi UPDATE khi bản ghi đổi → người đứng yên không có mẫu nào trong nhiều giây. Khi họ đi lại, mẫu mới
//    cách mẫu cũ cả mấy giây: chèn mẫu "giữ chỗ" tại t − 100 ms (vị trí cũ) để họ bắt đầu đi ĐÚNG lúc, không trườn chậm
//    suốt quãng nghỉ. Chỉ chèn khi mẫu cũ là ĐỨNG (spd ≈ 0): người đang chạy mà mất vài gói thì nội suy thẳng qua lỗ.
//  - `createSnapClock()` / `TickBase`: đổi (tick máy chủ, giờ nhận) → dấu thời gian mẫu ít rung: tick·50 ms + độ lệch nhỏ
//    nhất trong cửa sổ (rung mạng chỉ làm TRỄ gói → đường bao dưới là ước lượng đúng); bước lên bền vững (máy chủ bỏ tick)
//    được lấy lại mốc trong ~1,2 s. net_worker.js dùng TickBase.
// Thời gian: luôn GIỜ MÁY CHỦ (ms) = đồng hồ thật + offset (js/shared/clock.js), KHÔNG dùng time/dt đã kẹp của vòng frame.

export const INTERP = Object.freeze({
  DELAY_MIN_MS: 100,      // SPEC: nội suy 100–150 ms sau snapshot
  DELAY_MAX_MS: 150,
  DELAY_DEFAULT_MS: 120,
  DELAY_SLEW: 0.05,       // delay đổi tối đa 5 % thời gian trôi (không "tua" hình)
  EXTRAP_MAX_MS: 250,     // SPEC: ngoại suy ≤ 250 ms
  SNAP_M: 8,              // SPEC: nhảy khi lệch > 8 m
  NOMINAL_MS: 100,        // nhịp snapshot danh định 10 Hz
  GAP_MS: 250,            // khoảng trống mẫu coi là "nghỉ" (đứng yên, máy chủ không gửi gì)
  MOVING_SPD: 0.3,        // m/s — dưới mức này coi là đứng
  SMOOTH_TAU_MS: 90,      // tắt dần độ lệch hiển thị
  CAP: 16,                // mẫu giữ trong vòng đệm (1,6 s ở 10 Hz)
  MAX_V: 40,              // m/s — vận tốc ngoại suy tối đa (xe máy 16, lượng tử spd tối đa 31,9)
});

const TWO_PI = Math.PI * 2;
export function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}
export function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Track {
  constructor(cap = INTERP.CAP) {
    this.cap = cap;
    this.t = new Float64Array(cap);
    this.x = new Float64Array(cap); this.y = new Float64Array(cap); this.z = new Float64Array(cap);
    this.yaw = new Float64Array(cap); this.spd = new Float64Array(cap);
    this.st = new Uint8Array(cap);
    this.reset();
  }
  reset() {
    this.n = 0; this.head = 0;               // mẫu i (0 = cũ nhất) ở vị trí (head + i) % cap
    this._ts = NaN;                          // giờ tick của mẫu cuối (t[] là thời điểm HIỆU DỤNG sau căn theo tốc độ)
    this.ox = 0; this.oy = 0; this.oz = 0; this.oyaw = 0;   // độ lệch hiển thị (tắt dần)
    this.lastRenderT = NaN;                  // renderT của lần sample() gần nhất
    this.snapped = true;                     // lần sample() kế tiếp báo "nhảy" (renderer đặt lại nghiêng/pha bước)
    this.ivEma = INTERP.NOMINAL_MS;          // khoảng cách mẫu trung bình (khi đang chuyển động)
    this.delay = INTERP.DELAY_DEFAULT_MS;
    this.nSnap = 0; this.nStale = 0; this.nHold = 0;
  }
  get size() { return this.n; }
  _k(i) { return (this.head + i) % this.cap; }
  get lastT() { return this.n ? this.t[this._k(this.n - 1)] : -Infinity; }
  _append(t, x, y, z, yaw, spd, st) {
    let k;
    if (this.n < this.cap) { k = this._k(this.n); this.n++; }
    else { k = this.head; this.head = (this.head + 1) % this.cap; }
    this.t[k] = t; this.x[k] = x; this.y[k] = y; this.z[k] = z; this.yaw[k] = yaw; this.spd[k] = spd; this.st[k] = st;
  }
  // vận tốc ước lượng từ 2 mẫu cuối (m/s, chặn MAX_V); 0 nếu mẫu cuối là đứng hoặc chỉ có 1 mẫu
  _vel(out) {
    out.vx = 0; out.vy = 0; out.vz = 0;
    if (this.n < 2) return out;
    const a = this._k(this.n - 2), b = this._k(this.n - 1), dt = this.t[b] - this.t[a];
    if (this.spd[b] < INTERP.MOVING_SPD || !(dt > 15 && dt < 1000)) return out;
    let vx = (this.x[b] - this.x[a]) / dt * 1000, vz = (this.z[b] - this.z[a]) / dt * 1000;
    const v = Math.hypot(vx, vz);
    if (v > INTERP.MAX_V) { vx *= INTERP.MAX_V / v; vz *= INTERP.MAX_V / v; }
    out.vx = vx; out.vz = vz; out.vy = clamp((this.y[b] - this.y[a]) / dt * 1000, -10, 10);
    return out;
  }
  // Thêm mẫu. Trả 0 = nhận, 1 = NHẢY (đệm xoá), −1 = cũ/lặp (bỏ).
  push(t, x, y, z, yaw, spd, st) {
    if (!(t === t) || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
    if (this.n === 0) { this._append(t, x, y, z, yaw, spd, st); this._ts = t; this.snapped = true; return 1; }
    // lt = giờ TICK của mẫu trước (cũ/lặp/khoảng trống tính theo nó); lte = thời điểm HIỆU DỤNG của nó (trục vẽ)
    const L = this._k(this.n - 1), lt = this._ts, lte = this.t[L];
    if (t < lt) { this.nStale++; return -1; }
    if (t === lt) {   // cùng snapshot (ENTER + UPDATE trùng / gửi lặp): ghi đè
      this.x[L] = x; this.y[L] = y; this.z[L] = z; this.yaw[L] = yaw; this.spd[L] = spd; this.st[L] = st;
      return 0;
    }
    // dự đoán vị trí ở t theo quỹ đạo cũ (ngoại suy không chặn 250 ms — mất gói lâu khi đang chạy xe vẫn hợp lệ)
    const v = this._vel(_v);
    const gap = t - lt, gp = Math.min(gap, 2000) / 1000;
    const px = this.x[L] + v.vx * gp, pz = this.z[L] + v.vz * gp;
    if (Math.hypot(x - px, z - pz) > INTERP.SNAP_M || Math.abs(y - this.y[L]) > INTERP.SNAP_M) {
      this.n = 0; this.head = 0;
      this.ox = this.oy = this.oz = this.oyaw = 0;
      this._append(t, x, y, z, yaw, spd, st); this._ts = t;
      this.snapped = true; this.nSnap++;
      return 1;
    }
    // vị trí đang hiển thị (quỹ đạo cũ tại lastRenderT) — để giữ liền mạch sau khi chèn mẫu
    const haveR = this.lastRenderT === this.lastRenderT;
    if (haveR) this._raw(this.lastRenderT, _b);
    let te = Math.max(t, lte + 5);   // thời điểm HIỆU DỤNG của mẫu (trục thời gian dùng để vẽ), luôn tăng
    if (gap > INTERP.GAP_MS && this.spd[L] < INTERP.MOVING_SPD && t - INTERP.NOMINAL_MS > lte) {
      // nghỉ dài rồi đi lại: mẫu giữ chỗ (vị trí cũ, đứng) ngay trước mẫu mới
      this._append(t - INTERP.NOMINAL_MS, this.x[L], this.y[L], this.z[L], this.yaw[L], 0, this.st[L]);
      this.nHold++;
    } else {
      if (gap <= 600 && spd >= INTERP.MOVING_SPD) this.ivEma += (clamp(gap, 40, 600) - this.ivEma) * 0.15;
      // CĂN LẠI THỜI ĐIỂM THEO TỐC ĐỘ: snapshot 10 Hz mang STATE mới nhất mà người kia gửi 15 Hz → tuổi mẫu rung 0–67 ms
      // ⇒ tốc độ hiển thị "đập" ±30 % ở xe máy (đo interp_sim: p50 lỗi 0,3–0,5 m). Mẫu có tốc độ báo kèm (spd): khoảng
      // thời gian thật ≈ quãng đường / tốc độ. Kéo về giờ tick 12 %/mẫu để không trôi. Chỉ khi chạy nhanh (> 2 m/s —
      // đi bộ: lỗi lượng tử 5 cm làm ước lượng nhiễu hơn cái lợi) và cùng chế độ.
      const vAvg = 0.5 * (spd + this.spd[L]);
      if (vAvg > 2 && st === this.st[L] && gap <= 600) {
        const dTrue = Math.hypot(x - this.x[L], z - this.z[L]) / vAvg * 1000;
        const w = clamp((vAvg - 2) / 4, 0, 1);
        const dEff = gap + w * (clamp(dTrue, 0.3 * gap, 2 * gap) - gap);
        te = lte + dEff;
        te += (t - te) * 0.12;
        if (te < lte + 5) te = lte + 5;
      }
    }
    this._append(te, x, y, z, yaw, spd, st);
    this._ts = t;
    if (haveR) {
      this._raw(this.lastRenderT, _a);
      const dx = _b.x - _a.x, dy = _b.y - _a.y, dz = _b.z - _a.z;
      if (Math.hypot(dx, dz) <= INTERP.SNAP_M) {
        this.ox += dx; this.oy += dy; this.oz += dz; this.oyaw = wrapAngle(this.oyaw + wrapAngle(_b.yaw - _a.yaw));
      }
    }
    return 0;
  }
  // Quỹ đạo THÔ (không độ lệch hiển thị) tại thời điểm T. out: {x,y,z,yaw,spd,state,extrap}
  _raw(T, out) {
    const n = this.n;
    out.extrap = 0;
    if (!n) { out.x = out.y = out.z = out.yaw = out.spd = 0; out.state = 0; return out; }
    const f = this._k(0), L = this._k(n - 1);
    if (T >= this.t[L]) return this._extrap(T, L, out);
    if (T <= this.t[f]) {
      out.x = this.x[f]; out.y = this.y[f]; out.z = this.z[f]; out.yaw = this.yaw[f]; out.spd = this.spd[f]; out.state = this.st[f];
      return out;
    }
    // tìm đoạn [i, i+1] chứa T (từ mới về cũ — renderT thường ở 1–2 đoạn cuối)
    for (let i = n - 2; i >= 0; i--) {
      const a = this._k(i);
      if (this.t[a] <= T) {
        const b = this._k(i + 1), u = (T - this.t[a]) / (this.t[b] - this.t[a]);
        out.x = this.x[a] + (this.x[b] - this.x[a]) * u;
        out.y = this.y[a] + (this.y[b] - this.y[a]) * u;
        out.z = this.z[a] + (this.z[b] - this.z[a]) * u;
        out.yaw = lerpAngle(this.yaw[a], this.yaw[b], u);
        out.spd = this.spd[a] + (this.spd[b] - this.spd[a]) * u;
        out.state = u < 1 ? this.st[a] : this.st[b];
        return out;
      }
    }
    return out;
  }
  _extrap(T, L, out) {
    const e = Math.min(T - this.t[L], INTERP.EXTRAP_MAX_MS);
    const v = this._vel(_v), s = e / 1000;
    out.x = this.x[L] + v.vx * s; out.y = this.y[L] + v.vy * s; out.z = this.z[L] + v.vz * s;
    out.yaw = this.yaw[L]; out.spd = this.spd[L]; out.state = this.st[L];
    out.extrap = T - this.t[L];
    return out;
  }
  // Mẫu hiển thị tại giờ máy chủ nowMs (renderT = nowMs − delay tự chỉnh). out thêm: renderT, snapped, delay.
  sample(nowMs, out) {
    // delay theo nhịp mẫu thật: 10 Hz → ~120 ms, 5 Hz (tầng xa) → 150 ms; trượt chậm (không tua hình)
    const target = clamp(this.ivEma + 20, INTERP.DELAY_MIN_MS, INTERP.DELAY_MAX_MS);
    const prevR = this.lastRenderT;
    const el = prevR === prevR ? clamp(nowMs - this.delay - prevR, 0, 200) : 0;
    const step = INTERP.DELAY_SLEW * el + 0.01;
    this.delay += clamp(target - this.delay, -step, step);
    const T = nowMs - this.delay;
    return this.sampleAt(T, out);
  }
  sampleAt(T, out) {
    this._raw(T, out);
    const prevR = this.lastRenderT;
    if (prevR === prevR && T > prevR) {
      const k = Math.exp(-(T - prevR) / INTERP.SMOOTH_TAU_MS);
      this.ox *= k; this.oy *= k; this.oz *= k; this.oyaw *= k;
      if (Math.abs(this.ox) + Math.abs(this.oz) < 1e-4) { this.ox = this.oz = 0; }
    }
    if (Math.hypot(this.ox, this.oz) > INTERP.SNAP_M) { this.ox = this.oy = this.oz = this.oyaw = 0; this.snapped = true; }
    out.x += this.ox; out.y += this.oy; out.z += this.oz; out.yaw = wrapAngle(out.yaw + this.oyaw);
    out.renderT = T; out.delay = this.delay;
    out.snapped = this.snapped; this.snapped = false;
    this.lastRenderT = T;
    return out;
  }
}
const _v = { vx: 0, vy: 0, vz: 0 }, _a = {}, _b = {};

// Đồng hồ snapshot: tick máy chủ (20 Hz → 50 ms) + giờ nhận (giờ máy chủ ước lượng) → dấu thời gian mẫu.
// Độ lệch = giờ nhận − tick·tickMs; lấy NHỎ NHẤT trong cửa sổ `windowMs` (rung mạng chỉ cộng thêm trễ). Tick nhảy
// lùi / lệch > 10 s (máy chủ khởi động lại) → đặt lại.
// Mốc tick → giờ máy chủ, đường bao dưới của (giờ đến − tick·tickMs) trên `n` mẫu gần nhất (rung mạng chỉ làm TRỄ gói).
// Bước XUỐNG (gói nhanh hơn) theo ngay; bước LÊN bền vững (fixer vòng 1, NC-3: vòng tick máy chủ bỏ K tick khi quá tải →
// tickNo tụt sau đồng hồ thật K·50 ms VĨNH VIỄN) thì cửa sổ min cũ giữ dấu thời gian sớm K·50 ms suốt cả cửa sổ (6,4 s)
// → mọi người khác bị ngoại suy/khựng-nhảy. Sửa: nếu min của `recentN` mẫu cuối vượt mốc > `stepMs` → lấy lại mốc từ
// nửa mới hơn của các mẫu đó (hồi trong ~recentN snapshot ≈ 1,2 s ở 10 Hz). Tick lùi (máy chủ khởi động lại) / nhảy > 10 s → đặt lại.
// Dùng ở js/net/net_worker.js (tickServerMs) và createSnapClock() bên dưới. Không cấp phát mỗi lần gọi.
export class TickBase {
  constructor({ tickMs = 50, n = 64, recentN = 12, stepMs = 40, plateauMs = 60 } = {}) {
    this.tickMs = tickMs; this.n = n; this.recentN = Math.min(recentN, n); this.stepMs = stepMs; this.plateauMs = plateauMs;
    this.ring = new Float64Array(n);
    this.keep = new Float64Array(this.recentN);
    this.reset();
  }
  reset() { this.count = 0; this.head = 0; this.base = NaN; this.lastTick = -1; this.rebases = 0; }
  // → giờ máy chủ (ms) của tick, hoặc NaN nếu arrivalMs không hữu hạn
  stamp(tick, arrivalMs) {
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(tick)) return NaN;
    const off = arrivalMs - tick * this.tickMs;
    if (this.count && (tick < this.lastTick || Math.abs(off - this.base) > 10000)) this.reset();
    this.lastTick = tick;
    const n = this.n, R = this.ring;
    R[this.head] = off; this.head = (this.head + 1) % n; if (this.count < n) this.count++;
    let mn = Infinity;
    for (let i = 0; i < this.count; i++) if (R[i] < mn) mn = R[i];
    if (this.count > this.recentN) {
      let rm = Infinity, rx = -Infinity;
      for (let k = 1; k <= this.recentN; k++) { const v = R[(this.head - k + n) % n]; if (v < rm) rm = v; if (v > rx) rx = v; }
      // bước lên BỀN VỮNG = cao nguyên (recentN mẫu cuối cùng mức, rung ≤ plateauMs); TCP kẹt rồi xả chùm thì độ lệch
      // giảm dần 100 ms/mẫu (không phải cao nguyên) → không lấy lại mốc (mẫu sau chùm lại về đường bao cũ)
      if (rm - mn > this.stepMs && rx - rm <= this.plateauMs) {   // chỉ giữ recentN mẫu cuối
        // giữ NỬA mới hơn (chân dốc khi tick bị bỏ rải qua vài snapshot không kéo mốc xuống giữa chừng)
        const keep = this.keep, h = Math.max(2, this.recentN >> 1);
        mn = Infinity;
        for (let k = 0; k < h; k++) { const v = R[(this.head - h + k + n) % n]; keep[k] = v; if (v < mn) mn = v; }
        for (let k = 0; k < h; k++) R[k] = keep[k];
        this.count = h; this.head = h % n; this.rebases++;
      }
    }
    this.base = mn;
    return mn + tick * this.tickMs;
  }
}

export function createSnapClock({ tickMs = 50, windowMs = 5000 } = {}) {
  // windowMs giữ cho tương thích; cửa sổ tính theo số mẫu (10 Hz → 50 mẫu = 5 s)
  const tb = new TickBase({ tickMs, n: Math.max(16, Math.round(windowMs / 100)) });
  return {
    time(tick, arrivalMs) { return tb.stamp(tick, arrivalMs); },
    reset() { tb.reset(); },
    get rebases() { return tb.rebases; },
  };
}
