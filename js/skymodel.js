// ============ MÔ HÌNH BẦU TRỜI + MẶT TRỜI (JS thuần, KHÔNG import three — chạy được trong node để test) ============
// Đợt 3 WP5. MỘT nguồn số liệu cho: shader vòm trời (daynight.js nhúng SKY_GLSL bên dưới), màu/cường độ nắng, đèn
// bán cầu (hemi), màu sương — chân trời, sương và ánh sáng khớp nhau ở mọi giờ. Hàm JS và GLSL dưới đây là CÙNG
// một công thức (sửa một bên phải sửa bên kia; node test: scratchpad WP5/skytest.mjs).
//
// Mô hình: tán xạ ĐƠN Rayleigh + Mie (aerosol) trong lớp khí quyển phẳng, độ sâu quang học theo KHỐI KHÍ (air mass
// Kasten–Young) của tia nhìn và của tia nắng; Rayleigh cộng 1 pha ĐẲNG HƯỚNG bù tán xạ bội (thiếu nó trời phía ngược
// nắng tối như chạng vạng); chạng vạng + nền đêm + quầng đèn thành phố là số hạng cộng thêm. Không phải Hosek/
// Bruneton — đủ đúng xu hướng: thiên đỉnh xanh đậm, chân trời trắng sữa (tia dày → mọi kênh bão hoà), quầng sáng
// quanh mặt trời (Mie), nắng chiều vàng-cam, hoàng hôn đỏ. Đơn vị: tuyến tính, "tường trắng dưới nắng trưa ≈ 1";
// đèn mặt trời ≈ 3, đèn bán cầu ≈ 0,7–0,8 lúc trưa (tỉ lệ 3 : 0,7 theo SPEC — bóng đổ có chiều sâu, không bệt).
//
// Toạ độ: +x Đông, +y lên, +z NAM (KNOWLEDGE §3). Giờ = giờ đồng hồ địa phương (UTC+7).

export const LAT_DEG = 20.86;          // vĩ độ Hải Phòng
export const DECL_DEG = -4.5;          // xích vĩ mặt trời đầu tháng 10 (bộ pano thật chụp tháng 10/2024)
export const SOLAR_NOON = 11.75;       // giờ đồng hồ của chính ngọ (kinh độ 106,68° vs múi 105° + phương trình thời gian)

// Tham số khí quyển — tinh chỉnh bằng mắt so với pano thật (trời xanh vừa, chân trời trắng sữa, nắng gắt hơi ấm).
export const ATM = {
  tauR: [0.065, 0.160, 0.420],   // Rayleigh thiên đỉnh HIỆU DỤNG R/G/B (phổ ~λ⁻⁴ cho dải rộng sRGB; khớp pano bằng skyfit.mjs)
  aod: 0.04,                      // aerosol 550 nm (Mie, xám) — mù ẩm phần lớn do số hạng tán xạ bội + sương exp2
  aerosolTint: [0.85, 1.0, 1.12], // phổ aerosol (Ångström ≈ 1)
  g: 0.74,                        // bất đối xứng Mie (Henyey–Greenstein)
  iso: 0.020,                     // pha đẳng hướng cộng vào Rayleigh (1/sr)
  ms: 0.090,                      // tán xạ BỘI xám (bão hoà ở chân trời → chân trời trắng sữa, ít ảnh hưởng thiên đỉnh)
  msTint: [0.96, 1.0, 1.06],
  constB: [0.017, 0.057, 0.140],  // tán xạ bội "nền" màu Rayleigh, KHÔNG bão hoà theo tia → thiên đỉnh xanh đậm như pano
  msTau: 0.10,                    // độ sâu "xám" của số hạng tán xạ bội (nhỏ → thiên đỉnh gần như không bị pha trắng)
  E0: [4.25, 4.35, 5.20],         // nắng ngoài khí quyển (tương đối) → nắng trưa ≈ (3,8 ; 3,5 ; 3,1) hơi ấm
  skyGain: 1.00,                  // thang chung (daynight: ×0,76 khi HIỂN THỊ, ×0,55 + khử bão hoà cho đèn bán cầu/IBL)
  sunCapDeg: -1.0,                // dưới độ cao này đèn nắng = 0 (khuất chân trời)
  ozone: [0.021, 0.030, 0.0012],  // hấp thụ ozone (dải Chappuis) — chỉ HẤP THỤ: làm trời chạng vạng xanh tím thay vì nâu đục
};

const D2R = Math.PI / 180;
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Hướng mặt trời (vector đơn vị) cho giờ đồng hồ h (0..24). Công thức thiên văn chuẩn (góc giờ, xích vĩ, vĩ độ).
// Đầu tháng 10 ở HP: mọc ~5:50, chính ngọ ~11:45 cao 64° về phía NAM, lặn ~17:40.
export function sunDirection(hours, out = [0, 0, 0]) {
  const H = (hours - SOLAR_NOON) * 15 * D2R, phi = LAT_DEG * D2R, dec = DECL_DEG * D2R;
  const east = -Math.cos(dec) * Math.sin(H);
  const up = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H);
  out[0] = east; out[1] = up; out[2] = -north;   // +z = NAM
  return out;
}
export const elevDeg = (sinEl) => Math.asin(Math.max(-1, Math.min(1, sinEl))) / D2R;

// Khối khí Kasten–Young theo sin(độ cao); kẹp ở -1° (tia dưới chân trời bị phố che, chỉ cần liên tục)
export function airMass(sinEl) {
  const e = Math.max(elevDeg(sinEl), -1.0);
  return 1 / (Math.max(Math.sin(e * D2R), 0) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}
const tauR = (c) => ATM.tauR[c];
const tauM = (c) => ATM.aod * ATM.aerosolTint[c];

// Truyền qua của tia nắng tới mặt đất (theo kênh)
export function sunTransmittance(sinEl, out = [0, 0, 0]) {
  const m = airMass(sinEl);
  for (let c = 0; c < 3; c++) out[c] = Math.exp(-(tauR(c) + tauM(c) + ATM.ozone[c]) * m);
  return out;
}

// Chiếu sáng trực xạ của mặt trời trên mặt vuông góc tia (= màu×cường độ DirectionalLight).
// Mờ dần quanh chân trời rồi = 0 (SPEC: KHÔNG còn nắng chiếu từ dưới chân trời như bản cũ).
export function sunIrradiance(sinEl, out = [0, 0, 0]) {
  sunTransmittance(sinEl, out);
  const f = smooth(ATM.sunCapDeg, ATM.sunCapDeg + 3.0, elevDeg(sinEl));
  for (let c = 0; c < 3; c++) out[c] *= ATM.E0[c] * f;
  return out;
}

const PR = (mu) => 3 / (16 * Math.PI) * (1 + mu * mu);
function PM(mu) { const g = ATM.g, d = 1 + g * g - 2 * g * mu; return (1 - g * g) / (4 * Math.PI * d * Math.sqrt(d)); }

// Chạng vạng + đêm (cộng thêm, theo kênh) — cùng công thức với GLSL skyExtra()
const TW_HZ = [0.150, 0.065, 0.026], TW_ZEN = [0.014, 0.024, 0.060];
const NIGHT_ZEN = [0.0030, 0.0042, 0.0080], CITY = [0.0150, 0.0100, 0.0055];   // nền đêm + quầng đèn phố (mù ẩm hắt sáng cam)
function skyExtra(v, s, c) {
  const el = elevDeg(s[1]);
  const tw = smooth(-10, -1.5, el) * (1 - smooth(-1.5, 5, el));          // "giờ xanh" quanh lúc mặt trời lặn/mọc
  const vy = Math.max(v[1], 0);
  const hz = Math.exp(-vy * 5);
  const hl = Math.hypot(s[0], s[2]) || 1, vl = Math.hypot(v[0], v[2]) || 1;
  const toward = Math.max(0, (v[0] * s[0] + v[2] * s[2]) / (hl * vl));
  const night = 1 - smooth(-12, -3, el);
  return tw * (TW_HZ[c] * hz * (0.25 + 0.75 * toward * toward) + TW_ZEN[c] * (1 - 0.5 * hz))
    + night * (NIGHT_ZEN[c] + CITY[c] * Math.exp(-vy * 7));
}

// Độ chói vòm trời theo hướng nhìn v (đơn vị), mặt trời s (đơn vị). KHÔNG gồm đĩa mặt trời/trăng, mây, sao
// (shader cộng) — dùng cho màu sương / đèn bán cầu / chân trời.
export function skyRadiance(v, s, out = [0, 0, 0]) {
  const mu = v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
  const mV = airMass(Math.max(v[1], 0.0));
  // nắng tới ĐIỂM TÁN XẠ (trên cao) thường mạnh hơn nắng tới mặt đất → dùng T^0,55 (bớt tối lúc hoàng hôn)
  const mS = airMass(s[1]);
  const lit = smooth(-4, 1, elevDeg(s[1]));
  const pr = PR(mu) + ATM.iso, pm = PM(mu);
  for (let c = 0; c < 3; c++) {
    const tr = tauR(c), tm = tauM(c), t = tr + tm;
    const tsc = Math.exp(-(t + ATM.ozone[c]) * mS * 0.55);
    const ms = ATM.ms * ATM.msTint[c] * (1 - Math.exp(-ATM.msTau * mV));
    out[c] = ATM.skyGain * ATM.E0[c] * tsc * lit * ((tr * pr + tm * pm) / t * (1 - Math.exp(-t * mV)) + ms + ATM.constB[c]) + skyExtra(v, s, c);
  }
  return out;
}

// Chiếu sáng của bầu trời lên mặt phẳng nằm ngang (tích phân cosin, 24 hướng). E = π·L̄cos. Trả [r,g,b].
const _dirs = (() => {
  const d = [];
  for (const [cz, n] of [[0.22, 8], [0.6, 8], [0.92, 8]]) {
    const sz = Math.sqrt(1 - cz * cz);
    for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; d.push([Math.cos(a) * sz, cz, Math.sin(a) * sz]); }
  }
  return d;
})();
const _L = [0, 0, 0];
export function skyIrradiance(s, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  let wsum = 0;
  for (const v of _dirs) {
    skyRadiance(v, s, _L);
    out[0] += _L[0] * v[1]; out[1] += _L[1] * v[1]; out[2] += _L[2] * v[1]; wsum += v[1];
  }
  for (let c = 0; c < 3; c++) out[c] = out[c] / wsum * Math.PI;
  return out;
}

// GLSL cùng công thức (uniform: uSunDir vec3). Dùng trong shader vòm trời; daynight.js ghép thêm mây/sao/trăng.
export function skyGLSL() {
  const v3 = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(',')})`;
  return /* glsl */`
const vec3 SKY_TAU_R = ${v3(ATM.tauR)};
const vec3 SKY_TAU_M = ${v3(ATM.aerosolTint.map((t) => t * ATM.aod))};
const vec3 SKY_E0 = ${v3(ATM.E0)};
const float SKY_G = ${ATM.g.toFixed(4)};
const float SKY_ISO = ${ATM.iso.toFixed(4)};
const float SKY_GAIN = ${ATM.skyGain.toFixed(4)};
const vec3 SKY_MS = ${v3(ATM.msTint.map((t) => t * ATM.ms))};
const vec3 SKY_CB = ${v3(ATM.constB)};
const vec3 SKY_OZ = ${v3(ATM.ozone)};
float skySmooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float skyElev(float sinEl) { return degrees(asin(clamp(sinEl, -1.0, 1.0))); }
float skyAirMass(float sinEl) {
  float e = max(skyElev(sinEl), -1.0);
  return 1.0 / (max(sin(radians(e)), 0.0) + 0.50572 * pow(e + 6.07995, -1.6364));
}
vec3 skyExtra(vec3 v, vec3 s) {
  float el = skyElev(s.y);
  float tw = skySmooth(-10.0, -1.5, el) * (1.0 - skySmooth(-1.5, 5.0, el));
  float vy = max(v.y, 0.0);
  float hz = exp(-vy * 5.0);
  float toward = max(0.0, dot(normalize(v.xz + 1e-5), normalize(s.xz + 1e-5)));
  float night = 1.0 - skySmooth(-12.0, -3.0, el);
  return tw * (${v3(TW_HZ)} * hz * (0.25 + 0.75 * toward * toward) + ${v3(TW_ZEN)} * (1.0 - 0.5 * hz))
    + night * (${v3(NIGHT_ZEN)} + ${v3(CITY)} * exp(-vy * 7.0));
}
vec3 skyRadiance(vec3 v, vec3 s) {
  float mu = dot(v, s);
  float mV = skyAirMass(max(v.y, 0.0));
  float mS = skyAirMass(s.y);
  float lit = skySmooth(-4.0, 1.0, skyElev(s.y));
  float pr = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu) + SKY_ISO;
  float d = 1.0 + SKY_G * SKY_G - 2.0 * SKY_G * mu;
  float pm = (1.0 - SKY_G * SKY_G) / (4.0 * 3.14159265 * d * sqrt(d));
  vec3 t = SKY_TAU_R + SKY_TAU_M;
  vec3 tsc = exp(-(t + SKY_OZ) * mS * 0.55);
  vec3 ms = SKY_MS * (1.0 - exp(-${ATM.msTau.toFixed(3)} * mV));
  return SKY_GAIN * SKY_E0 * tsc * lit * ((SKY_TAU_R * pr + SKY_TAU_M * pm) / t * (1.0 - exp(-t * mV)) + ms + SKY_CB) + skyExtra(v, s);
}
vec3 skySunTransmittance(float sinEl) { return exp(-(SKY_TAU_R + SKY_TAU_M + SKY_OZ) * skyAirMass(sinEl)); }
`;
}
