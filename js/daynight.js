import * as THREE from 'three';
import { GFX } from './device.js';
import { sunDirection, sunIrradiance, sunTransmittance, skyIrradiance, skyRadiance, skyK, cloudSun, skyGLSL, elevDeg } from './skymodel.js';
import { setGlbLighting } from './assets.js';

// ============ NGÀY ĐÊM / BẦU TRỜI / ÁNH SÁNG (Đợt 3 WP5 — viết lại) ============
// - Mặt trời theo THIÊN VĂN (vĩ độ HP, đầu tháng 10): mọc ~5:50 phía Đông, trưa cao 64° về phía Nam, lặn ~17:40.
// - Vòm trời = shader tán xạ (js/skymodel.js) + đĩa mặt trời/quầng + mây thủ tục trôi + sao + trăng + quầng đèn phố.
// - Đèn: BỘ ĐÈN CỐ ĐỊNH 2 cái (program key không đổi — KNOWLEDGE): HemisphereLight (màu = chiếu sáng bầu trời / mặt
//   đất suy từ CÙNG mô hình) + DirectionalLight "chủ" có bóng: ban ngày là mặt trời (cường độ 0 dưới chân trời),
//   ban đêm là TRĂNG (hướng trăng, xanh nhạt, có bóng mờ). Bỏ đèn moonGlow riêng (bớt 1 đèn cho mọi fragment).
// - Sương FogExp2 (chọn 1 lần, không đổi kiểu — đổi Fog↔FogExp2 là biên dịch lại mọi shader): mù ẩm bắt đầu thấy rõ
//   từ ~150-200 m, GIỐNG NHAU mọi tier; màu = độ chói chân trời theo hướng nhìn → mép phố xa tan liền vào trời.
// - IBL: PMREM nướng từ CHÍNH vòm trời mỗi ~3 s (MỘT RT cố định, vẽ đè — không đổi texture object) → GLB/nước phản chiếu trời
//   đúng giờ; đêm tự tối (RoomEnvironment cũ sáng như studio cả lúc nửa đêm).
// - Bóng: tâm hộp bám người chơi + hướng nhìn như cũ nhưng SNAP theo texel trong không gian đèn (hết "bò" mép bóng).
//   Chế độ vệ tinh: hộp bóng phủ cả khung ảnh trực giao, map 4096, tắt sương.

export const DAY_LENGTH = 1440;      // giây thật / 1 ngày game (24 phút — SPEC: 300 s cũ quá nhanh, 40% là đêm)
const START_HOUR = 9;                // mặc định 09:00; QA: ?time=14.5 | 14:30 | 1 (= 01:00) | 0.6 (<1 = phần của ngày), ?timefreeze=1

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
      // < 1 = phần của ngày (0.6); ≥ 1 = giờ (1 = 01:00, 14.5 = 14:30). Trước đây "1" bị hiểu là phần 1 = nửa đêm.
      else { const n = parseFloat(v); if (isFinite(n)) t = n < 1 ? n : n / 24; }
    }
    return { t: t == null ? null : ((t % 1) + 1) % 1, freeze: q.get('timefreeze') === '1' };
  } catch (e) { return { t: null, freeze: false }; }
}

// NÚM ÁNH SÁNG (một chỗ; daynight đọc lại MỖI khung → QA chỉnh sống qua __hp.dayNight.LIGHT, không cần nạp lại trang).
// Đơn vị: tuyến tính trước tone mapping, "tường trắng dưới nắng trưa ≈ 1" (skymodel.js).
export const LIGHT = {
  // Sương exp2: 150 m 1,3%, 400 m 8,6%, 800 m 30%, 1200 m 55%, 1600 m 76% (mép BUILD_RADIUS chìm), 2600 m 98%.
  // (0,00085 thử trước: góc cao 160 m nhìn xa bị "sữa" mất tương phản cả nửa khung — bản cũ tuyến tính 700→2600 m
  // chỉ 47% ở 1600 m.) Màu sương = chân trời hiển thị nên mép phố xa tan vào trời, không thành vạch.
  fogDensity: 0.00075,
  fogNearView: 1.6,          // nấc chất lượng 3 (ẩn ô > 1450 m): 1300 m ≈ 91%
  // Phơi sáng: thích nghi mắt theo độ rọi ngang so với trưa, gain = (trưa/hiện tại)^0,5, TRẦN ×4 (bản đầu ×10 làm
  // chạng vạng/đêm sáng như ngày âm u dưới bầu trời tối — sai thứ tự sáng: trời phải sáng hơn phố lúc chạng vạng).
  exposure: 0.92, maxGain: 4.0,
  aerialExposure: 0.82,      // ảnh VỆ TINH: máy ảnh vệ tinh phơi sáng thấp hơn mắt người (Google Earth tối & tương phản hơn)
  // Thang của mô hình trời (skymodel.js) → 3 nơi dùng:
  //  - vòm HIỂN THỊ: BAN NGÀY ×1,2 và bão hoà 45% — trời HP thật MÙ ẨM, xanh nhạt gần trắng: đo 160 ảnh pano ngẫu
  //    nhiên, vùng trời ở độ cao ~30-40° có trung vị sRGB(186,198,211) (p25 174,187,201 / p75 201,209,221); bản đầu
  //    (×0,76, bão hoà 100%) ra ≈(142,175,210) xanh đậm & tối hơn ảnh thật; ×1,3/40% ra (196,205,218) hơi sáng quá
  //    (mây + dải mù cộng thêm ~+12 so với mô hình). Chạng vạng/đêm (mặt trời < 3°) trở về
  //    ×0,76 + bão hoà 100% để giữ màu hoàng hôn/giờ xanh (trộn theo độ cao mặt trời skyDayEl). Số liệu: WP5/num/scan.mjs.
  //  - đèn bán cầu/IBL ×0,55 và KHỬ BÃO HOÀ còn 25% (bầu trời thật + mây + tường quanh phố dội lại → bóng râm chỉ hơi
  //    lạnh, không xanh lét; tỉ lệ nắng : bán cầu lúc trưa ≈ 3,5 : 0,8 theo SPEC);
  //  - màu sương = chân trời hiển thị khử bão hoà 35% (mù ẩm HP xám trắng).
  skyViewGain: 1.2, skyViewSat: 0.45, skyViewGainLow: 0.76, skyDayEl: [3, 15],
  hemiScale: 0.55, hemiSat: 0.25, hazeDesat: 0.35,
  groundAlbedo: [0.17, 0.155, 0.135],   // mặt phố (nhựa/gạch/mái) — màu ánh dội cho hemi.groundColor
  // ĐÊM: trăng (đèn chủ, có bóng mờ) + "nền đêm" (trời có trăng + đèn phố dội lên mù ẩm) cộng vào bán cầu. Chỉ bật
  // khi mặt trời đã xuống dưới moonFade[0]° và đầy đủ ở moonFade[1]° — giờ xanh (0..−8°) do CHÍNH bầu trời chiếu sáng,
  // trăng cộng sớm sẽ sáng hơn trời chạng vạng (bug bản đầu: phố trắng dưới trời nâu sẫm lúc 18:15).
  moonE: [0.060, 0.075, 0.112], moonAmb: [0.014, 0.018, 0.030], moonFade: [-5, -13],
  // ĐÈN PHỐ (ấm, theo `night` — bật từ chạng vạng): bộ đèn cố định nên ánh đèn đường/biển hiệu/cửa hàng hắt lên
  // mặt phố & tường là phần cộng vào bán cầu (đất ×1, trời ×0,5 — đèn ở tầm phố nên tường nhận nhiều hơn mái).
  // Thiếu nó hẻm nhỏ lúc 21:00 đen kịt (sRGB ≈ 15-20, đo pano_141 đêm) — phố HP thật về đêm sáng đèn, mắt vẫn đọc
  // được mặt tiền. Thang: Lambert three r160 = albedo/π × chiếu sáng, đêm phơi sáng ×4 → tường albedo 0,3 ≈ sRGB 40.
  cityAmb: [0.090, 0.072, 0.050],
  // W2-F: vũng sáng quanh đèn DỰNG TAY (buildLampPools; đỉnh opacity cộng sáng — cùng thang props_lamp_pools 0,2) và
  // độ tự sáng ban đêm của biển chữ thật neo mặt tiền (nền màu + chữ trắng: 0,35 đọc rõ, không loá bloom như nền trắng).
  poolOpacity: 0.2, signGlow: 0.35,
  // chia ánh đèn phố dội (cityAmb) giữa mặt NGỬA (trời: lòng đường/vỉa hè/mái) và mặt ÚP (đất). Bản WP5: 0,5 / 1,0 →
  // tường (pháp tuyến ngang = trung bình) 0,75 nhưng lòng đường chỉ 0,5 → đo 21:00 lòng đường sRGB ≈ 36-37, "phố đen".
  // W2-F: 0,7 / 0,8 → tường GIỮ 0,75 (mặt tiền không sáng thêm), mặt đường +40% (đọc được lòng đường giữa 2 vũng đèn).
  cityAmbUp: 0.7, cityAmbDown: 0.8,
  cloud: 0.40,
};

const SKY_VS = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = (modelMatrix * vec4(position, 0.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;     // đặt ĐÚNG mặt phẳng xa (depth 1) → so depth LessEqual chỉ qua ở pixel trời trống
  }`;
const SKY_FS = /* glsl */`
  uniform vec3 uSunDir, uMoonDir, uFog, uGround;
  // hằng số theo mặt trời/trăng, JS tính 1 lần/khung (skymodel.js cùng công thức): bớt ALU mỗi pixel trời
  uniform vec3 uSkyK, uSunT, uSkyUp, uCloudSun;
  uniform float uSunUp, uMoonUp;
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
    vec3 col = skyRadianceK(v, s, uSkyK);
    vec3 Ts = uSunT;
    float sunUp = uSunUp;
    float mu = dot(v, s);
    // đĩa mặt trời (r ≈ 0,5°) + chói sát đĩa — đĩa chỉ ở vòm HIỂN THỊ (vào PMREM sẽ thành đốm chói lấp lánh trên GLB)
    if (uEnv < 0.5) col += skySmooth(0.99995, 0.999972, mu) * SKY_E0 * Ts * 38.0 * sunUp;
    col += SKY_E0 * Ts * sunUp * 0.02 * pow(max(mu, 0.0), 400.0);
    // trăng
    float muM = dot(v, uMoonDir);
    float moonUp = uMoonUp;
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
        float n2 = fbm(p + s.xz * 0.10);
        float shade = clamp(0.70 + (n - n2) * 3.2, 0.30, 1.15);               // mặt quay về nắng sáng, đáy tối
        vec3 sunC = uCloudSun;
        float ph = 0.55 + 0.6 * pow(max(mu, 0.0), 8.0);                       // viền bạc phía mặt trời
        vec3 amb = uSkyUp * 1.5 + skyExtra(v, s) * 2.0;
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

// ---- VŨNG SÁNG ĐÈN cho các đèn DỰNG TAY trong world.js (đèn hồ Tam Bạc/ven hồ, đèn ô phố cells…) — Đợt 3 wave 2 (W2-F) ----
// Đèn của js/props.js (cobra/đèn cột/đèn gang 3 bóng) đã có vũng riêng ('props_lamp_pools'); đèn dựng tay chỉ có quả cầu
// sharedMats.lampGlow tự sáng nên ban đêm mặt đường quanh chúng đen kịt (đo 21:00: lòng đường pano_007 sRGB ≈ 37 dù đèn
// sáng ngay cạnh). Quét MỘT lần sau freezeStatic: mọi đỉnh của mesh dùng lampGlow (đã gộp ô — toạ độ thế giới) → gom ô
// 1,5 m liền kề = 1 đầu đèn (cầu/chao) → vũng cộng sáng (cùng kiểu props: quad nằm trên mặt lát, falloff dạng cos³,
// MeshBasic additive có sương) bán kính theo độ cao đèn. 1 InstancedMesh, ~100-150 quad, hiện khi đêm.
function buildLampPools(scene, world) {
  const LG = world.sharedMats && world.sharedMats.lampGlow;
  if (!LG || typeof document === 'undefined') return null;
  const gh = world.groundHeight || (() => 2);
  const surf = world.roadNet && world.roadNet.surfaceAt ? world.roadNet.surfaceAt : () => 0.012;
  const C = 1.5, cells = new Map(), key = (i, j) => (i + 8192) * 16384 + (j + 8192);
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.material !== LG) return;
    const p = o.geometry && o.geometry.attributes.position;
    if (!p || !p.array) return;
    o.updateMatrixWorld(true);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const k = key(Math.floor(v.x / C), Math.floor(v.z / C));
      let c = cells.get(k); if (!c) cells.set(k, (c = { i: Math.floor(v.x / C), j: Math.floor(v.z / C), x: 0, z: 0, n: 0, y: -1e9, g: -1 }));
      c.x += v.x; c.z += v.z; c.n++; if (v.y > c.y) c.y = v.y;
    }
  });
  // gom ô liền kề (8 hướng) thành đầu đèn
  const heads = [];
  for (const c of cells.values()) {
    if (c.g >= 0) continue;
    const h = { x: 0, z: 0, n: 0, y: -1e9 }, st = [c]; c.g = heads.length;
    while (st.length) {
      const q = st.pop(); h.x += q.x; h.z += q.z; h.n += q.n; if (q.y > h.y) h.y = q.y;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const r = cells.get(key(q.i + di, q.j + dj)); if (r && r.g < 0) { r.g = c.g; st.push(r); }
      }
    }
    heads.push(h);
  }
  const list = [];
  for (const h of heads) {
    const x = h.x / h.n, z = h.z / h.n, g = gh(x, z), hh = h.y - g;
    if (hh < 2.2 || hh > 16 || g < 0.5) continue;             // đèn treo thấp/cột cờ/vật trên nước — bỏ
    list.push({ x, z, y: g + Math.max(0.012, surf(x, z)) + 0.035, s: Math.max(8, Math.min(15, hh * 2.6)) });
  }
  if (!list.length) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g2 = cv.getContext('2d'); const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 10; i++) { const t = i / 10; const a = Math.pow(1 + (t / 0.55) ** 2, -1.5) * (1 - t * t * t * t); gr.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`); }
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffcf96, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  list.forEach((p, i) => mesh.setMatrixAt(i, m4.makeScale(p.s, 1, p.s).setPosition(p.x, p.y, p.z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'night_lamp_pools';
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 3; mesh.visible = false;
  mesh.matrixAutoUpdate = false; mesh.userData.noCull = true; mesh.raycast = () => {};
  scene.add(mesh);
  return { mesh, mat, n: list.length };
}

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
  scene.fog = new THREE.FogExp2(0xc4d2de, LIGHT.fogDensity);
  scene.background = new THREE.Color(0xc4d2de);   // dự phòng (vòm trời phủ kín)

  // ---- vòm trời ----
  const mkUniforms = () => ({
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uFog: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uSkyK: { value: new THREE.Vector3() }, uSunT: { value: new THREE.Vector3() }, uSkyUp: { value: new THREE.Vector3() },
    uCloudSun: { value: new THREE.Vector3() }, uSunUp: { value: 1 }, uMoonUp: { value: 0 },
    uTime: { value: 0 }, uCloud: { value: GFX.clouds ? LIGHT.cloud : 0 }, uNight: { value: 0 },
    uHaze: { value: 1 }, uGain: { value: LIGHT.skyViewGain }, uEnv: { value: 0 }, uSat: { value: 1 },
  });
  // VẼ SAU CÙNG trong nhóm đục, có so depth (z = w ở VS): shader trời (tán xạ + mây fbm) chỉ chạy ở pixel thật sự
  // thấy trời — bản đầu vẽ TRƯỚC, không so depth ⇒ trả giá shader trời cho MỌI pixel màn hình (phố/nhà che kín vẫn tính).
  // Vật trong suốt (biển, cánh hoa, sprite…) vẫn vẽ sau nó như cũ. AO coi depth = 1 là trời (post.js) — không đổi.
  const skyMat = new THREE.ShaderMaterial({
    name: 'HPSky', uniforms: mkUniforms(), vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const skyGeo = new THREE.SphereGeometry(10, 32, 16);
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'sky_dome';
  skyDome.renderOrder = 1e6;             // cuối nhóm đục (sắp theo renderOrder) — xem skyMat
  skyDome.frustumCulled = false;
  // tâm vòm = camera đang vẽ (camera chính, camera vệ tinh, cine) — ma trận cập nhật ngay trước khi vẽ
  skyDome.onBeforeRender = (r, sc, cam) => {
    skyDome.position.setFromMatrixPosition(cam.matrixWorld);
    skyDome.updateMatrixWorld(true);
    skyDome.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, skyDome.matrixWorld);
  };
  scene.add(skyDome);

  // ---- IBL: nướng PMREM từ vòm trời (scene riêng, cube 128) vào MỘT RT cố định ----
  // KHÔNG luân phiên 2 RT: đổi đối tượng texture của scene.environment làm MỌI MeshStandardMaterial (GLB, nước) đi qua
  // getProgram (materialProperties.envMap !== envMap → needsProgramChange, tính lại cache key) mỗi lần nướng = khựng
  // CPU định kỳ. Cùng 1 texture → chỉ nội dung đổi, program/uniform giữ nguyên.
  const envMat = new THREE.ShaderMaterial({
    name: 'HPSkyEnv', uniforms: mkUniforms(), vertexShader: SKY_VS, fragmentShader: SKY_FS,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  envMat.uniforms.uEnv.value = 1; envMat.uniforms.uGain.value = LIGHT.hemiScale; envMat.uniforms.uHaze.value = 0;
  envMat.uniforms.uSat.value = 0.45;   // IBL: trời khử bão hoà (khớp đèn bán cầu) — phản chiếu GLB/nước không xanh lét
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(skyGeo, envMat));
  let cubeRT = null, cubeCam = null, pmrem = null, envRT = null;
  let _envAt = -1e9, _envT = -1;
  function bakeEnv() {
    if (!_renderer) return;
    if (!pmrem) {
      cubeRT = new THREE.WebGLCubeRenderTarget(GFX.envSize, { type: THREE.HalfFloatType, generateMipmaps: false });
      cubeCam = new THREE.CubeCamera(1, 100, cubeRT);
      pmrem = new THREE.PMREMGenerator(_renderer);
    }
    cubeCam.update(_renderer, envScene);
    envRT = pmrem.fromCubemap(cubeRT.texture, envRT);   // lần đầu cấp phát, sau đó vẽ đè vào chính RT đó
    scene.environment = envRT.texture;
    _envAt = performance.now(); _envT = dayT;
  }

  // ---- trạng thái ----
  const tp = parseTimeParam();
  let dayT = tp.t != null ? tp.t : START_HOUR / 24;
  let frozen = tp.freeze;
  let _cloudT = 0;
  const CLOUD_STILL = typeof navigator !== 'undefined' && navigator.webdriver === true;
  let aerial = null, nearView = false;
  const sA = [0, 1, 0], E = [0, 0, 0], Esky = [0, 0, 0], L = [0, 0, 0], hzDir = [0, 0, 0];
  const _sun = new THREE.Vector3(), _moon = new THREE.Vector3(), _key = new THREE.Vector3();
  const _lookDir = new THREE.Vector3(0, 0, -1), _tmpDir = new THREE.Vector3(), _shCenter = new THREE.Vector3(), _plPos = new THREE.Vector3();
  const _shPos = new THREE.Vector3(1e9, 0, 1e9), _shDir = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up2 = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const COS_TURN = Math.cos(0.15);
  const _fogTarget = new THREE.Color(), _ground = new THREE.Color();
  const T3 = [0, 0, 0], UP = [0, 1, 0];
  const _skyK = new THREE.Vector3(), _sunT = new THREE.Vector3(), _skyUp = new THREE.Vector3(), _cloudSun = new THREE.Vector3();
  let _fogInit = false;
  let viewGain = LIGHT.skyViewGain, viewSat = LIGHT.skyViewSat;   // vòm hiển thị (applySky ghi, updateFog dùng)
  const out = { night: 0, sunEl: 0, hours: 0 };
  const NOON_ADAPT = (() => { sunDirection(12, sA); sunIrradiance(sA[1], E); skyIrradiance(sA, Esky); return lum(Esky) * LIGHT.hemiScale + lum(E) * sA[1]; })();
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
    const L_ = LIGHT, mA = smooth(L_.moonFade[0], L_.moonFade[1], el);   // trọng số "đêm thật" (sau giờ xanh)
    const moonW = mA * smooth(-2, 6, moonEl);
    // đèn chủ: mặt trời khi còn trên chân trời, trăng sau đó (đổi hướng lúc cường độ ≈ 0 → không giật)
    if (el > -1.5) { _key.copy(_sun); sun.color.setRGB(E[0], E[1], E[2]); }
    else { _key.copy(_moon); sun.color.setRGB(L_.moonE[0] * moonW, L_.moonE[1] * moonW, L_.moonE[2] * moonW); }
    const kmax = Math.max(sun.color.r, sun.color.g, sun.color.b, 1e-6);
    sun.intensity = kmax; sun.color.multiplyScalar(1 / kmax);
    // bán cầu: trời = chiếu sáng bầu trời (+ trăng/đèn phố đêm); đất = phố dội (nắng ngang + trời) × albedo
    const ls = lum(Esky);
    for (let c = 0; c < 3; c++) Esky[c] = (ls + L_.hemiSat * (Esky[c] - ls)) * L_.hemiScale;
    const MA = L_.moonAmb, GA = L_.groundAlbedo, CA = L_.cityAmb;
    const cU = L_.cityAmbUp * night, cD = L_.cityAmbDown * night;
    hemi.color.setRGB(Esky[0] + MA[0] * mA + CA[0] * cU, Esky[1] + MA[1] * mA + CA[1] * cU, Esky[2] + MA[2] * mA + CA[2] * cU);
    const sh = Math.max(sA[1], 0);
    _ground.setRGB(GA[0] * (E[0] * sh + Esky[0]), GA[1] * (E[1] * sh + Esky[1]), GA[2] * (E[2] * sh + Esky[2]));
    hemi.groundColor.setRGB(_ground.r + MA[0] * 0.5 * mA + CA[0] * cD, _ground.g + MA[1] * 0.5 * mA + CA[1] * cD, _ground.b + MA[2] * 0.5 * mA + CA[2] * cD);
    hemi.intensity = 1;
    // phơi sáng: thích nghi theo độ rọi ngang (trưa = 1), trần ×maxGain
    const adapt = lum(Esky) + lum(E) * sh + lum(MA) * mA;
    if (_renderer) _renderer.toneMappingExposure = L_.exposure * (aerial ? L_.aerialExposure : 1)
      * Math.min(L_.maxGain, Math.max(1, Math.sqrt(NOON_ADAPT / Math.max(adapt, 1e-4))));
    // vòm hiển thị: ngày mù ẩm (sáng + nhạt), chạng vạng/đêm giữ màu đậm (xem LIGHT.skyViewGain)
    const dayW = smooth(L_.skyDayEl[0], L_.skyDayEl[1], el);
    viewGain = L_.skyViewGainLow + (L_.skyViewGain - L_.skyViewGainLow) * dayW;
    viewSat = 1 + (L_.skyViewSat - 1) * dayW;
    skyMat.uniforms.uGain.value = viewGain;
    skyMat.uniforms.uSat.value = viewSat;
    skyK(sA, T3); _skyK.fromArray(T3);
    sunTransmittance(sA[1], T3); _sunT.fromArray(T3);
    skyRadiance(UP, sA, T3); _skyUp.fromArray(T3);
    cloudSun(sA[1], T3); _cloudSun.fromArray(T3);
    const sunUp = smooth(-1, 1, el), moonUp = smooth(-2, 3, moonEl);
    for (const m of [skyMat, envMat]) {
      const u = m.uniforms;
      u.uSunDir.value.copy(_sun); u.uMoonDir.value.copy(_moon); u.uNight.value = night;
      u.uSkyK.value.copy(_skyK); u.uSunT.value.copy(_sunT); u.uSkyUp.value.copy(_skyUp); u.uCloudSun.value.copy(_cloudSun);
      u.uSunUp.value = sunUp; u.uMoonUp.value = moonUp;
    }
    envMat.uniforms.uGround.value.copy(_ground).multiplyScalar(1 / Math.PI);
    return night;
  }

  const fogDensity = () => (aerial ? 0 : LIGHT.fogDensity * (nearView ? LIGHT.fogNearView : 1));

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

  // MÀU SƯƠNG = độ chói chân trời (cao 3°) theo hướng nhìn, ×gain + bão hoà hiển thị — trùng dải mù của vòm trời
  function updateFog(dt) {
    hzDir[0] = _lookDir.x * 0.9986; hzDir[1] = 0.052; hzDir[2] = _lookDir.z * 0.9986;
    skyRadiance(hzDir, sA, L);
    const lh = lum(L);
    const k = viewSat * (1 - LIGHT.hazeDesat), g = viewGain;
    _fogTarget.setRGB((lh + k * (L[0] - lh)) * g, (lh + k * (L[1] - lh)) * g, (lh + k * (L[2] - lh)) * g);
    if (!_fogInit || dt <= 0) { scene.fog.color.copy(_fogTarget); _fogInit = true; }
    else scene.fog.color.lerp(_fogTarget, 1 - Math.exp(-dt * 3));
    skyMat.uniforms.uFog.value.copy(scene.fog.color);
    scene.background.copy(scene.fog.color);
    scene.fog.density = fogDensity();
  }

  applySky();
  updateFog(0);
  bakeEnv();
  const lampPools = buildLampPools(scene, world);   // vũng sáng đèn dựng tay (W2-F) — 1 lần, sau freezeStatic
  if (lampPools) console.info('[daynight] vũng sáng đèn dựng tay:', lampPools.n);

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
      scene.fog.density = fogDensity();
      _shPos.set(1e9, 0, 1e9);   // ép làm mới bóng
    },
    // nấc chất lượng 3 / máy rất yếu: sương dày hơn để giấu ô thế giới bị ẩn ngoài 1450 m (CÙNG kiểu sương)
    setNearView(on) { nearView = !!on; scene.fog.density = fogDensity(); },
    LIGHT,
    bakeEnv,
    update(dt, playerPos, camera) {
      if (!frozen) dayT = (dayT + dt / DAY_LENGTH) % 1;
      const night = applySky();
      const now = performance.now();
      // mây trôi theo đồng hồ GAME (đứng yên khi ?timefreeze / frozen, và khi trình duyệt tự động hoá — ảnh QA A/B
      // so được điểm ảnh bầu trời; trước đây = performance.now() nên mây khác nhau giữa 2 lần chụp)
      if (!frozen && !CLOUD_STILL) _cloudT += dt;
      skyMat.uniforms.uTime.value = envMat.uniforms.uTime.value = _cloudT;

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

      // đèn đường, cửa sổ, hải đăng sáng về đêm. Phần TỰ PHÁT SÁNG hiển thị theo màn hình (post.js HP_UNLIT_K bù phơi
      // sáng thích nghi) → giá trị dưới đây giữ nguyên thang cũ (mốc phơi sáng 1,18) ở mọi giờ.
      const glow = night;
      const { sharedMats } = world;
      if (sharedMats) {
        sharedMats.lampGlow.emissiveIntensity = glow * 1.6;
        sharedMats.window.emissiveIntensity = glow * 1.1;
      }
      if (world.facadeMats) {
        for (const m of world.facadeMats) m.emissiveIntensity = glow * 0.95;
      }
      // biển hiệu chữ thật neo mặt tiền (world.js real_shop_signs_*): hộp đèn sáng vừa phải về đêm (W2-F)
      if (world.signMats) for (const m of world.signMats) m.emissiveIntensity = glow * LIGHT.signGlow;
      if (lampPools) { lampPools.mesh.visible = glow > 0.03; lampPools.mat.opacity = Math.min(1, glow) * LIGHT.poolOpacity; }
      if (world.lighthouseLamp) {
        world.lighthouseLamp.emissiveIntensity = 0.2 + glow * (1.2 + Math.sin(now * 0.004) * 0.8);
      }
      if (world.lighthouseBeam) {
        world.lighthouseBeam.mat.opacity = glow * 0.28;
      }
      // GLB địa danh: emissive tự phát sáng chỉ về đêm, IBL theo ngày (assets.js)
      setGlbLighting(night);
      // Nước: màu do world.js quyết (MỘT nguồn); trời/IBL tự tối về đêm nên không ghi đè màu mỗi khung nữa.
      return out;
    },
  };
}
