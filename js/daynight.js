import * as THREE from 'three';
import { GFX } from './device.js';
import { sunDirection, sunIrradiance, skyIrradiance, skyRadiance, skyGLSL, elevDeg } from './skymodel.js';
import { setGlbLighting } from './assets.js';

// ============ NGÀY ĐÊM / BẦU TRỜI / ÁNH SÁNG (Đợt 3 WP5 — viết lại) ============
// - Mặt trời theo THIÊN VĂN (vĩ độ HP, đầu tháng 10): mọc ~5:50 phía Đông, trưa cao 64° về phía Nam, lặn ~17:40.
// - Vòm trời = shader tán xạ (js/skymodel.js) + đĩa mặt trời/quầng + mây thủ tục trôi + sao + trăng + quầng đèn phố.
// - Đèn: BỘ ĐÈN CỐ ĐỊNH 2 cái (program key không đổi — KNOWLEDGE): HemisphereLight (màu = chiếu sáng bầu trời / mặt
//   đất suy từ CÙNG mô hình) + DirectionalLight "chủ" có bóng: ban ngày là mặt trời (cường độ 0 dưới chân trời),
//   ban đêm là TRĂNG (hướng trăng, xanh nhạt, có bóng mờ). Bỏ đèn moonGlow riêng (bớt 1 đèn cho mọi fragment).
// - Sương FogExp2 (chọn 1 lần, không đổi kiểu — đổi Fog↔FogExp2 là biên dịch lại mọi shader): mù ẩm bắt đầu thấy rõ
//   từ ~150-200 m, GIỐNG NHAU mọi tier; màu = độ chói chân trời theo hướng nhìn → mép phố xa tan liền vào trời.
// - IBL: PMREM nướng từ CHÍNH vòm trời mỗi ~3 s (2 RT luân phiên, không cấp phát lại) → GLB/nước phản chiếu trời
//   đúng giờ; đêm tự tối (RoomEnvironment cũ sáng như studio cả lúc nửa đêm).
// - Bóng: tâm hộp bám người chơi + hướng nhìn như cũ nhưng SNAP theo texel trong không gian đèn (hết "bò" mép bóng).
//   Chế độ vệ tinh: hộp bóng phủ cả khung ảnh trực giao, map 4096, tắt sương.

export const DAY_LENGTH = 1440;      // giây thật / 1 ngày game (24 phút — SPEC: 300 s cũ quá nhanh, 40% là đêm)
const START_HOUR = 9;                // mặc định 09:00; QA: ?time=14.5 | 14:30 | 0.6 (≤1 = phần của ngày), ?timefreeze=1

// Uniform DÙNG CHUNG cho shader của module khác (mặt tiền/cây...): `shader.uniforms.uNight = NIGHT_U` trong
// onBeforeCompile — daynight ghi .value mỗi khung, không cần đăng ký material.
export const NIGHT_U = { value: 0 };                          // 0 ngày … 1 đêm (đèn bật dần quanh hoàng hôn)
export const SUN_DIR_U = { value: new THREE.Vector3(0, 1, 0) }; // hướng TỚI mặt trời (thế giới, đơn vị)

let _renderer = null;
// main.js gọi ngay sau khi tạo renderer (vùng renderer/môi trường) — để nướng PMREM bầu trời.
export function attachSkyRenderer(r) { _renderer = r; }

function parseTimeParam() {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('time');
    let t = null;
    if (v) {
      if (v.includes(':')) { const [h, m] = v.split(':').map(Number); t = (h + (m || 0) / 60) / 24; }
      else { const n = parseFloat(v); if (isFinite(n)) t = n <= 1 ? n : n / 24; }
    }
    return { t: t == null ? null : ((t % 1) + 1) % 1, freeze: q.get('timefreeze') === '1' };
  } catch (e) { return { t: null, freeze: false }; }
}

// Sương: exp2 — 150 m 1,6%, 400 m 11%, 800 m 37%, 1200 m 65%, 1600 m 84% (mép BUILD_RADIUS tan), 2600 m 99%.
const FOG_DENSITY = 0.00085;
const FOG_NEAR_VIEW = 1.6;           // nấc chất lượng 3 (ẩn ô > 1450 m): 1300 m ≈ 95%
// Phơi sáng: thích nghi mắt nhẹ theo độ rọi ngang (trưa = 1) — chiều/tối mở thêm, đêm tối đa ×NIGHT.
const EXPOSURE = 0.92, EXPOSURE_MAX_GAIN = 10.0;
// Ảnh VỆ TINH: máy ảnh vệ tinh phơi sáng thấp hơn mắt người (ảnh Google Earth tối & tương phản hơn) — chỉ áp ở aerial().
const AERIAL_EXPOSURE = 0.82;
// Thang của mô hình trời (skymodel.js) → 3 nơi dùng:
//  - vòm HIỂN THỊ ×0,76 (khớp màu pano thật qua tone mapping: thiên đỉnh ≈ sRGB(90,140,210), chân trời ≈ (196,210,228));
//  - đèn bán cầu/IBL ×0,55 và KHỬ BÃO HOÀ còn 25% (bầu trời thật + mây + tường quanh phố dội lại → bóng râm chỉ hơi
//    lạnh, không xanh lét; tỉ lệ nắng : bán cầu lúc trưa ≈ 3,5 : 0,8 theo SPEC);
//  - màu sương = chân trời hiển thị khử bão hoà 35% (mù ẩm HP xám trắng).
const SKY_VIEW_GAIN = 0.76;
const HEMI_SCALE = 0.55, HEMI_SAT = 0.25, HAZE_DESAT = 0.35;
const GROUND_ALBEDO = [0.17, 0.155, 0.135];   // mặt phố (nhựa/gạch/mái) — màu ánh dội cho hemi.groundColor
const MOON_E = [0.090, 0.110, 0.160];        // trăng (đèn chủ ban đêm — có bóng mờ)
const MOON_AMB = [0.040, 0.052, 0.085];      // bầu trời đêm có trăng + ánh đèn phố dội (hemi) — đêm vẫn đọc được phố
const CLOUD_COVER = 0.40;

const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 0.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SKY_FS = /* glsl */`
  uniform vec3 uSunDir, uMoonDir, uFog, uGround;
  uniform float uTime, uCloud, uNight, uHaze, uGain, uEnv, uSat;
  varying vec3 vDir;
  ${skyGLSL()}
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return s / 0.96875;
  }
  void main() {
    vec3 v = normalize(vDir);
    vec3 s = uSunDir;
    vec3 col = skyRadiance(v, s);
    vec3 Ts = skySunTransmittance(s.y);
    float sunUp = skySmooth(-1.0, 1.0, skyElev(s.y));
    float mu = dot(v, s);
    // đĩa mặt trời (r ≈ 0,5°) + chói sát đĩa — đĩa chỉ ở vòm HIỂN THỊ (vào PMREM sẽ thành đốm chói lấp lánh trên GLB)
    if (uEnv < 0.5) col += skySmooth(0.99995, 0.999972, mu) * SKY_E0 * Ts * 38.0 * sunUp;
    col += SKY_E0 * Ts * sunUp * 0.02 * pow(max(mu, 0.0), 400.0);
    // trăng
    float muM = dot(v, uMoonDir);
    float moonUp = skySmooth(-2.0, 3.0, skyElev(uMoonDir.y));
    col += uNight * moonUp * vec3(0.62, 0.64, 0.68) * (skySmooth(0.99993, 0.99996, muM) * 1.6 + 0.0035 * pow(max(muM, 0.0), 40.0));
    // sao (mù đô thị: thưa, mờ dần về chân trời)
    if (uEnv < 0.5 && uNight > 0.02 && v.y > 0.0) {
      vec3 sp = v * 170.0, cell = floor(sp);
      float h = hash13(cell);
      if (h > 0.972) {
        vec3 c = cell + 0.5 + (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5) * 0.6;
        col += uNight * vec3(0.85, 0.9, 1.0) * smoothstep(0.24, 0.0, length(sp - c)) * (h - 0.972) * 2.2 * skySmooth(0.03, 0.3, v.y);
      }
    }
    // mây tầng thấp (mặt phẳng ở độ cao 1, chiếu theo tia nhìn) — trôi chậm theo gió
    if (v.y > 0.0 && uCloud > 0.0) {
      float t = 1.0 / (v.y + 0.05);
      vec2 p = v.xz * t * 0.85 + uTime * vec2(0.0045, 0.0018);
      float n = fbm(p);
      float dens = skySmooth(1.0 - uCloud, 1.0 - uCloud + 0.30, n);
      if (dens > 0.002) {
        float n2 = fbm(p + s.xz * 0.10 + vec2(0.0, 0.0));
        float shade = clamp(0.70 + (n - n2) * 3.2, 0.30, 1.15);               // mặt quay về nắng sáng, đáy tối
        vec3 sunC = SKY_E0 * exp(-(SKY_TAU_R + SKY_TAU_M) * skyAirMass(s.y) * 0.6) * sunUp;
        float ph = 0.55 + 0.6 * pow(max(mu, 0.0), 8.0);                       // viền bạc phía mặt trời
        vec3 amb = skyRadiance(vec3(0.0, 1.0, 0.0), s) * 1.5 + skyExtra(v, s) * 2.0;
        vec3 cc = sunC * 0.15 * shade * ph + amb * (0.75 + 0.25 * shade);
        cc = mix(col, cc, exp(-t * 0.07));                                     // mây xa nhạt vào mù
        col = mix(col, cc, dens * skySmooth(0.0, 0.16, v.y));
      }
    }
    col *= uGain;
    col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat);
    if (uEnv < 0.5) {
      col = mix(col, uFog, exp(-max(v.y, 0.0) * 10.0) * uHaze);              // dải mù chân trời = màu sương
      col = mix(col, uFog, skySmooth(0.0, -0.05, v.y));
    } else {
      col = mix(col, uGround, skySmooth(0.03, -0.10, v.y));                    // nửa dưới IBL = mặt phố dội sáng
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export function createDayNight(scene, world) {
  // ---- đèn (bộ cố định) ----
  const hemi = new THREE.HemisphereLight(0xffffff, 0x808080, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
  // Hộp bóng: TIER 3 ±110 m / map 2048, TIER ≤ 2 ±70 m / 1024 (ít caster hơn, bóng nét hơn — device.js GFX).
  const SB = GFX.shadowBox;
  const SH = sun.shadow.camera;
  SH.left = -SB; SH.right = SB; SH.top = SB; SH.bottom = -SB;
  SH.near = 20; SH.far = SB >= 100 ? 600 : 400;
  SH.updateProjectionMatrix();
  // bias nhỏ + normalBias chống acne mặt xiên (Đợt 2 W4); radius chỉ tác dụng với PCFShadowMap.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  const LOOK_AHEAD = SB * 0.41;
  const SUN_DIST = 250;
  scene.add(sun);
  scene.add(sun.target);

  // ---- sương + nền ----
  scene.fog = new THREE.FogExp2(0xc4d2de, FOG_DENSITY);
  scene.background = new THREE.Color(0xc4d2de);   // dự phòng (vòm trời phủ kín)

  // ---- vòm trời ----
  const mkUniforms = () => ({
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uFog: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uTime: { value: 0 }, uCloud: { value: GFX.clouds ? CLOUD_COVER : 0 }, uNight: { value: 0 },
    uHaze: { value: 1 }, uGain: { value: SKY_VIEW_GAIN }, uEnv: { value: 0 }, uSat: { value: 1 },
  });
  const skyMat = new THREE.ShaderMaterial({
    name: 'HPSky', uniforms: mkUniforms(), vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const skyGeo = new THREE.SphereGeometry(10, 32, 16);
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'sky_dome';
  skyDome.renderOrder = -1e6;            // vẽ ĐẦU TIÊN, không ghi/so depth → mọi thứ vẽ đè lên
  skyDome.frustumCulled = false;
  // tâm vòm = camera đang vẽ (camera chính, camera vệ tinh, cine) — ma trận cập nhật ngay trước khi vẽ
  skyDome.onBeforeRender = (r, sc, cam) => {
    skyDome.position.setFromMatrixPosition(cam.matrixWorld);
    skyDome.updateMatrixWorld(true);
    skyDome.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, skyDome.matrixWorld);
  };
  scene.add(skyDome);

  // ---- IBL: nướng PMREM từ vòm trời (scene riêng, cube 128, 2 RT luân phiên) ----
  const envMat = new THREE.ShaderMaterial({
    name: 'HPSkyEnv', uniforms: mkUniforms(), vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  envMat.uniforms.uEnv.value = 1; envMat.uniforms.uGain.value = HEMI_SCALE; envMat.uniforms.uHaze.value = 0;
  envMat.uniforms.uSat.value = 0.45;   // IBL: trời khử bão hoà (khớp đèn bán cầu) — phản chiếu GLB/nước không xanh lét
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(skyGeo, envMat));
  let cubeRT = null, cubeCam = null, pmrem = null;
  const envRTs = [null, null];
  let envNext = 0, _envAt = -1e9, _envT = -1;
  function bakeEnv() {
    if (!_renderer) return;
    if (!pmrem) {
      cubeRT = new THREE.WebGLCubeRenderTarget(GFX.envSize, { type: THREE.HalfFloatType, generateMipmaps: false });
      cubeCam = new THREE.CubeCamera(1, 100, cubeRT);
      pmrem = new THREE.PMREMGenerator(_renderer);
    }
    cubeCam.update(_renderer, envScene);
    const rt = pmrem.fromCubemap(cubeRT.texture, envRTs[envNext]);   // 2 lần đầu cấp phát, sau đó tái dùng
    envRTs[envNext] = rt;
    scene.environment = rt.texture;
    envNext ^= 1;
    _envAt = performance.now(); _envT = dayT;
  }

  // ---- trạng thái ----
  const tp = parseTimeParam();
  let dayT = tp.t != null ? tp.t : START_HOUR / 24;
  let frozen = tp.freeze;
  let aerial = null, nearView = false;
  const sA = [0, 1, 0], E = [0, 0, 0], Esky = [0, 0, 0], L = [0, 0, 0], hzDir = [0, 0, 0];
  const _sun = new THREE.Vector3(), _moon = new THREE.Vector3(), _key = new THREE.Vector3();
  const _lookDir = new THREE.Vector3(0, 0, -1), _tmpDir = new THREE.Vector3(), _shCenter = new THREE.Vector3(), _plPos = new THREE.Vector3();
  const _shPos = new THREE.Vector3(1e9, 0, 1e9), _shDir = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up2 = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const COS_TURN = Math.cos(0.15);
  const _fogTarget = new THREE.Color(), _ground = new THREE.Color();
  let _fogInit = false;
  const out = { night: 0, sunEl: 0, hours: 0 };
  const NOON_ADAPT = (() => { sunDirection(12, sA); sunIrradiance(sA[1], E); skyIrradiance(sA, Esky); return lum(Esky) * HEMI_SCALE + lum(E) * sA[1]; })();
  function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

  // tính toàn bộ đèn/trời cho giờ hiện tại (không phụ thuộc camera)
  function applySky() {
    const hours = dayT * 24;
    sunDirection(hours, sA);
    const el = elevDeg(sA[1]);
    sunIrradiance(sA[1], E);
    skyIrradiance(sA, Esky);
    const night = 1 - smooth(-5, 4, el);
    out.night = night; out.sunEl = el; out.hours = hours;
    NIGHT_U.value = night;
    _sun.set(sA[0], sA[1], sA[2]);
    SUN_DIR_U.value.copy(_sun);
    // trăng: gần đối diện mặt trời (trăng tròn), lệch Nam một chút cho đẹp bóng
    _moon.set(-sA[0], -sA[1], -sA[2] + 0.25).normalize();
    const moonEl = Math.asin(_moon.y) * 180 / Math.PI;
    const moonW = smooth(-1, -7, el) * smooth(-2, 6, moonEl);
    // đèn chủ: mặt trời khi còn trên chân trời, trăng sau đó (đổi hướng lúc cường độ ≈ 0 → không giật)
    if (el > -1.5) { _key.copy(_sun); sun.color.setRGB(E[0], E[1], E[2]); }
    else { _key.copy(_moon); sun.color.setRGB(MOON_E[0] * moonW, MOON_E[1] * moonW, MOON_E[2] * moonW); }
    const kmax = Math.max(sun.color.r, sun.color.g, sun.color.b, 1e-6);
    sun.intensity = kmax; sun.color.multiplyScalar(1 / kmax);
    // bán cầu: trời = chiếu sáng bầu trời (+ trăng/đèn phố đêm); đất = phố dội (nắng ngang + trời) × albedo
    const mA = smooth(-1, -8, el);
    const ls = lum(Esky);
    for (let c = 0; c < 3; c++) Esky[c] = (ls + HEMI_SAT * (Esky[c] - ls)) * HEMI_SCALE;
    hemi.color.setRGB(Esky[0] + MOON_AMB[0] * mA, Esky[1] + MOON_AMB[1] * mA, Esky[2] + MOON_AMB[2] * mA);
    const sh = Math.max(sA[1], 0);
    _ground.setRGB(GROUND_ALBEDO[0] * (E[0] * sh + Esky[0]), GROUND_ALBEDO[1] * (E[1] * sh + Esky[1]), GROUND_ALBEDO[2] * (E[2] * sh + Esky[2]));
    hemi.groundColor.setRGB(_ground.r + MOON_AMB[0] * 0.5 * mA, _ground.g + MOON_AMB[1] * 0.5 * mA, _ground.b + MOON_AMB[2] * 0.5 * mA);
    hemi.intensity = 1;
    // phơi sáng: thích nghi theo độ rọi ngang (trưa = 1)
    const adapt = lum(Esky) + lum(E) * sh + 0.03 * mA;
    if (_renderer) _renderer.toneMappingExposure = EXPOSURE * (aerial ? AERIAL_EXPOSURE : 1)
      * Math.min(EXPOSURE_MAX_GAIN, Math.max(1, Math.pow(NOON_ADAPT / Math.max(adapt, 1e-4), 0.5)));
    for (const m of [skyMat, envMat]) {
      const u = m.uniforms;
      u.uSunDir.value.copy(_sun); u.uMoonDir.value.copy(_moon); u.uNight.value = night;
    }
    envMat.uniforms.uGround.value.copy(_ground).multiplyScalar(1 / Math.PI);
    return night;
  }

  function fitShadow(playerPos) {
    let SBx = SB;
    if (aerial) {
      _shCenter.set(aerial.cx, 2, aerial.cz);
    } else {
      _shCenter.copy(playerPos).addScaledVector(_lookDir, LOOK_AHEAD);
    }
    // SNAP theo texel trong hệ toạ độ đèn (trục giống camera bóng của three: up = +Y, nhìn theo −key)
    _right.crossVectors(_Y, _key);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); else _right.normalize();
    _up2.crossVectors(_key, _right);
    if (aerial) SBx = aerial.R;
    const texel = (2 * SBx) / sun.shadow.mapSize.x;
    const a = Math.round(_shCenter.dot(_right) / texel) * texel;
    const b = Math.round(_shCenter.dot(_up2) / texel) * texel;
    const c = _shCenter.dot(_key);
    _shCenter.copy(_right).multiplyScalar(a).addScaledVector(_up2, b).addScaledVector(_key, c);
    const dist = aerial ? 2500 : SUN_DIST;
    sun.position.copy(_shCenter).addScaledVector(_key, dist);
    sun.target.position.copy(_shCenter);
  }

  // MÀU SƯƠNG = độ chói chân trời (cao 3°) theo hướng nhìn, ×gain hiển thị — trùng dải mù của vòm trời
  function updateFog(dt) {
    hzDir[0] = _lookDir.x * 0.9986; hzDir[1] = 0.052; hzDir[2] = _lookDir.z * 0.9986;
    skyRadiance(hzDir, sA, L);
    const lh = lum(L);
    _fogTarget.setRGB((lh + (1 - HAZE_DESAT) * (L[0] - lh)) * SKY_VIEW_GAIN, (lh + (1 - HAZE_DESAT) * (L[1] - lh)) * SKY_VIEW_GAIN,
      (lh + (1 - HAZE_DESAT) * (L[2] - lh)) * SKY_VIEW_GAIN);
    if (!_fogInit || dt <= 0) { scene.fog.color.copy(_fogTarget); _fogInit = true; }
    else scene.fog.color.lerp(_fogTarget, 1 - Math.exp(-dt * 3));
    skyMat.uniforms.uFog.value.copy(scene.fog.color);
    scene.background.copy(scene.fog.color);
  }

  applySky();
  updateFog(0);
  bakeEnv();

  return {
    sun, hemi, skyDome,
    get t() { return dayT; },
    set t(v) { dayT = ((v % 1) + 1) % 1; applySky(); updateFog(0); _envT = -1; },
    get hours() { return dayT * 24; },
    get frozen() { return frozen; },
    set frozen(v) { frozen = !!v; },
    get clockString() {
      const hours = (dayT * 24) % 24;
      const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
      const icon = out.sunEl > -3 ? '☀️' : '🌙';
      return `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
    // bóng đã lệch so với lần làm mới cuối? (đi > 2 m hoặc quay > 0.15 rad)
    shadowMoved() {
      return _shPos.distanceToSquared(_plPos) > 4 || _shDir.dot(_lookDir) < COS_TURN;
    },
    markShadow() { _shPos.copy(_plPos); _shDir.copy(_lookDir); },
    // CHẾ ĐỘ VỆ TINH: a = {cx, cz, half, asp} → hộp bóng phủ khung ảnh (map 4096), tắt sương; null → trả lại.
    setAerial(a) {
      const sm = sun.shadow;
      if (a) {
        aerial = { ...a, R: Math.hypot(a.half * (a.asp || 1), a.half) + 30 };
        SH.left = -aerial.R; SH.right = aerial.R; SH.top = aerial.R; SH.bottom = -aerial.R; SH.near = 100; SH.far = 5000;
        if (sm.mapSize.x !== 4096) { sm.mapSize.set(4096, 4096); if (sm.map) { sm.map.dispose(); sm.map = null; } }
      } else if (aerial) {
        aerial = null;
        SH.left = -SB; SH.right = SB; SH.top = SB; SH.bottom = -SB; SH.near = 20; SH.far = SB >= 100 ? 600 : 400;
        if (sm.mapSize.x !== GFX.shadowMap) { sm.mapSize.set(GFX.shadowMap, GFX.shadowMap); if (sm.map) { sm.map.dispose(); sm.map = null; } }
      }
      SH.updateProjectionMatrix();
      scene.fog.density = aerial ? 0 : FOG_DENSITY * (nearView ? FOG_NEAR_VIEW : 1);
      _shPos.set(1e9, 0, 1e9);   // ép làm mới bóng
    },
    // nấc chất lượng 3 / máy rất yếu: sương dày hơn để giấu ô thế giới bị ẩn ngoài 1450 m (CÙNG kiểu sương)
    setNearView(on) { nearView = !!on; if (!aerial) scene.fog.density = FOG_DENSITY * (nearView ? FOG_NEAR_VIEW : 1); },
    bakeEnv,
    update(dt, playerPos, camera) {
      if (!frozen) dayT = (dayT + dt / DAY_LENGTH) % 1;
      const night = applySky();
      const now = performance.now();
      skyMat.uniforms.uTime.value = envMat.uniforms.uTime.value = now * 0.001;

      // hướng nhìn ngang (hộp bóng + màu sương theo phương nhìn)
      camera.getWorldDirection(_tmpDir);
      _tmpDir.y = 0;
      const lh = _tmpDir.length();
      if (lh > 1e-3) _lookDir.copy(_tmpDir).divideScalar(lh);
      _plPos.copy(playerPos);
      fitShadow(playerPos);

      updateFog(dt);

      // IBL: nướng lại mỗi 3 s đồng hồ thật hoặc khi giờ nhảy (setTime / tua nhanh)
      if (now - _envAt > 3000 || Math.abs(dayT - _envT) > 0.004) bakeEnv();

      // đèn đường, cửa sổ, hải đăng sáng về đêm. Phơi sáng đêm nay MỞ tới ×5 (thích nghi mắt) → chia lại cho phơi
      // sáng để độ sáng HIỂN THỊ của đèn giữ như cũ (emissive × exposure ≈ hằng số, mốc cũ exposure 1.18) — không thì
      // cửa sổ vàng ấm cháy thành trắng. Bloom threshold cũng theo phơi sáng (main.js).
      const glow = night;
      const ek = 1.18 / (_renderer ? _renderer.toneMappingExposure : 1.18);
      const { sharedMats } = world;
      if (sharedMats) {
        sharedMats.lampGlow.emissiveIntensity = glow * 1.6 * ek;
        sharedMats.window.emissiveIntensity = glow * 1.1 * ek;
      }
      if (world.facadeMats) {
        for (const m of world.facadeMats) m.emissiveIntensity = glow * 0.95 * ek;
      }
      if (world.lighthouseLamp) {
        world.lighthouseLamp.emissiveIntensity = (0.2 + glow * (1.2 + Math.sin(now * 0.004) * 0.8)) * ek;
      }
      if (world.lighthouseBeam) {
        world.lighthouseBeam.mat.opacity = glow * 0.28;
      }
      // GLB địa danh: emissive tự phát sáng chỉ về đêm, IBL theo ngày (assets.js)
      setGlbLighting(night, ek);
      // Nước: màu do world.js quyết (MỘT nguồn); trời/IBL tự tối về đêm nên không ghi đè màu mỗi khung nữa.
      return out;
    },
  };
}
