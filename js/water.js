import * as THREE from 'three';
import { WATER, waterSD, LAKE_POLY } from './terrain.js';

// ============ MẶT NƯỚC (Đợt 3 WP5) — vật liệu + bản đồ bờ/hồ ============
// Một plane khổng lồ duy nhất (world.js) dùng vật liệu này. MỘT NGUỒN MÀU: chính file này (daynight KHÔNG ghi đè màu
// mỗi khung — trời/IBL tự tối về đêm).
// - MeshStandardMaterial ĐỤC (phù sa): phản chiếu bầu trời bằng IBL PMREM nướng từ vòm trời (daynight.js), Fresnel/GGX
//   vật lý: nhìn thẳng xuống (vệ tinh) chỉ ~2-4% phản xạ → thấy MÀU NƯỚC; nhìn xiên ở tầm mắt → phản chiếu chân trời
//   sáng + vệt nắng lấp lánh qua normal map lăn tăn. Không trong suốt (opacity 0.82 cũ làm lộ lòng sông — kiểm toán §3 #38).
// - BẢN ĐỒ BỜ/HỒ (DataTexture 512², ô 8 m, phủ ±2048 m): R = khoảng cách CÓ DẤU tới bờ polygon nước OSM (128 = mép bờ,
//   +3,175/m vào lòng nước, kẹp ±40 m = tầm chính xác của waterSD); G = 1 trong HỒ (nước tĩnh). Shader trộn:
//     sông (mặc định): xám ô liu phù sa — ảnh vệ tinh thật sông Cấm ≈ sRGB(93,103,92);
//     hồ: sẫm hơn, ít phù sa → phản chiếu trời chiếm phần lớn (ảnh vệ tinh hồ ≈ (29,53,79) xanh sẫm);
//     dải ven bờ 1-16 m: nâu bùn nhạt + nhám hơn; viền rác/bọt rất mảnh sát kè.
//   Ngoài bản đồ / sông vẽ bằng polyline (> 1,95 km, waterSD = "đất" +40) → R = 0 → KHÔNG tô bờ (giữ màu sông).
//   Giá dựng: lọc thô 32 m (16k lần waterSD) rồi chỉ tính mịn các khối 32 m sát bờ — đo trong KNOWLEDGE §10 (WP5).

export const WATER_COL = { river: 0x5c625a, lake: 0x34443f, shore: 0x6d6a55 };
const SHORE_HALF = 2048, SHORE_N = 512, SHORE_STEP = (2 * SHORE_HALF) / SHORE_N;   // 8 m
const ENC = 127 / 40;          // đơn vị mã / mét

// Normal map nước THỦ TỤC 256² LẶP ĐƯỢC: value-noise 3 tầng (lưới 8/16/32, bọc mép → tile liền) → cao độ →
// pháp tuyến (sai phân trung tâm bọc mép) → mã hoá RGB. Ô 9 m. (Kiểm toán 2026-09: nước phẳng nhìn y hệt mặt đường nhựa.)
function makeWaterNormal(W, D) {
  const N = 256, hgt = new Float32Array(N * N);
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (const [P, amp] of [[8, 1], [16, 0.5], [32, 0.25]]) {
    const lat = new Float32Array(P * P); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const sc = P / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x * sc, fy = y * sc, x0 = fx | 0, y0 = fy | 0, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const top = lat[y0 * P + x0] + (lat[y0 * P + x1] - lat[y0 * P + x0]) * sx;
      const bot = lat[y1 * P + x0] + (lat[y1 * P + x1] - lat[y1 * P + x0]) * sx;
      hgt[y * N + x] += amp * (top + (bot - top) * sy);
    }
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g2 = cv.getContext('2d'), img = g2.createImageData(N, N), px = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N];
    const dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    const nx = -dx * 6, ny = -dy * 6, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
    px[i] = (nx / l * 0.5 + 0.5) * 255; px[i + 1] = (ny / l * 0.5 + 0.5) * 255; px[i + 2] = (1 / l * 0.5 + 0.5) * 255; px[i + 3] = 255;
  }
  g2.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);   // KHÔNG qua makeTex: normal map phải ở colorSpace tuyến tính
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 9, D / 9); t.anisotropy = 4;
  return t;
}

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// polygon "nước tĩnh": tên Hồ…/bể bơi + hồ Tam Bạc (bản 20 đỉnh của terrain.js)
const LAKE_POLYS = [LAKE_POLY].concat(WATER.filter((w) => /^(Hồ|Hô|bể)/i.test(w.n || '') && w.n !== 'Hồ Tam Bạc').map((w) => w.pts));

export function makeShoreTexture() {
  const t0 = performance.now();
  const N = SHORE_N, data = new Uint8Array(N * N * 4);
  const enc = (sd) => Math.max(0, Math.min(255, Math.round(128 - sd * ENC)));
  const B = 4, NB = N / B;                       // khối 4×4 ô = 32 m
  let fine = 0;
  for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) {
    const cx = -SHORE_HALF + (bx + 0.5) * B * SHORE_STEP, cz = -SHORE_HALF + (bz + 0.5) * B * SHORE_STEP;
    const sd = waterSD(cx, cz);
    // |sd| = 40 là "kẹp": mọi ô trong khối cách bờ ≥ 40 − 22,6 m — đủ xa để coi bão hoà (dải tô bờ chỉ 16 m)
    const far = Math.abs(sd) >= 40;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const tx = bx * B + i, tz = bz * B + j;
      const v = far ? enc(sd) : (fine++, enc(waterSD(-SHORE_HALF + (tx + 0.5) * SHORE_STEP, -SHORE_HALF + (tz + 0.5) * SHORE_STEP)));
      data[(tz * N + tx) * 4] = v;
    }
  }
  // CẠNH TRONG: waterSD đo tới cạnh GẦN NHẤT của MỌI polygon nước — 2 polygon OSM kề nhau (sông cắt đoạn) có cạnh chung
  // giữa lòng sông → vệt màu bờ chạy giữa sông nhìn từ trên cao (review WP5, game_8). Bờ THẬT thì phải có ô đất gần:
  // khoảng cách tới tâm ô đất gần nhất − nửa đường chéo ô (5,66 m) là CẬN DƯỚI của khoảng cách tới bờ thật → nâng độ
  // sâu lên ít nhất bằng nó (bờ thật: không đổi; cạnh trong không có đất trong 4 ô = 32 m → ≥ 26 m, hết tô bờ).
  // Ô lân cận xếp theo khoảng cách tăng dần → dừng ở ô đất ĐẦU TIÊN (bờ thật: 1-9 phép thử; chỉ cạnh trong duyệt hết 80).
  const LR = 4, HALFDIAG = SHORE_STEP * Math.SQRT1_2, CAP = 26 * ENC;
  const OFF = [];
  for (let j = -LR; j <= LR; j++) for (let i = -LR; i <= LR; i++) if (i || j) OFF.push([i, j, Math.hypot(i, j) * SHORE_STEP]);
  OFF.sort((a, b) => a[2] - b[2]);
  let fixed = 0;
  for (let tz = 0; tz < N; tz++) for (let tx = 0; tx < N; tx++) {
    const v = data[(tz * N + tx) * 4];
    if (v <= 128 || v - 128 >= CAP) continue;     // đất, hoặc đã đủ xa bờ để không tô
    let best = (LR + 1) * SHORE_STEP;
    for (let k = 0; k < OFF.length; k++) {
      const x2 = tx + OFF[k][0], z2 = tz + OFF[k][1];
      if (x2 < 0 || x2 >= N || z2 < 0 || z2 >= N) continue;
      if (data[(z2 * N + x2) * 4] < 128) { best = OFF[k][2]; break; }
    }
    const lo = Math.round(128 + (best - HALFDIAG) * ENC);
    if (lo > v) { data[(tz * N + tx) * 4] = Math.min(255, lo); fixed++; }
  }
  for (const poly of LAKE_POLYS) {
    let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
    for (const [x, z] of poly) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
    const i1 = Math.max(0, Math.floor((x1 + SHORE_HALF) / SHORE_STEP) - 1), i2 = Math.min(N - 1, Math.ceil((x2 + SHORE_HALF) / SHORE_STEP) + 1);
    const j1 = Math.max(0, Math.floor((z1 + SHORE_HALF) / SHORE_STEP) - 1), j2 = Math.min(N - 1, Math.ceil((z2 + SHORE_HALF) / SHORE_STEP) + 1);
    for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
      if (inPoly(-SHORE_HALF + (i + 0.5) * SHORE_STEP, -SHORE_HALF + (j + 0.5) * SHORE_STEP, poly)) data[(j * N + i) * 4 + 1] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData.buildMs = +(performance.now() - t0).toFixed(1);
  tex.userData.fineSamples = fine;
  tex.userData.innerEdgeFixed = fixed;
  return tex;
}

// Vật liệu nước + normal map (world.js giữ mesh/updater gợn trôi).
export function makeWaterMaterial(W, D) {
  const normal = makeWaterNormal(W, D);
  const shore = makeShoreTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: WATER_COL.river, roughness: 0.12, metalness: 0.0,
    normalMap: normal, normalScale: new THREE.Vector2(0.15, 0.15),
  });
  mat.name = 'water';
  const lin = (hex) => new THREE.Color(hex);   // Color(hex) = sRGB → tuyến tính (ColorManagement r160)
  mat.userData.shore = shore;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tShore = { value: shore };
    sh.uniforms.uLakeCol = { value: lin(WATER_COL.lake) };
    sh.uniforms.uShoreCol = { value: lin(WATER_COL.shore) };
    sh.vertexShader = 'varying vec2 vHpWXZ;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n\tvHpWXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = 'varying vec2 vHpWXZ;\nuniform sampler2D tShore;\nuniform vec3 uLakeCol, uShoreCol;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
	vec2 hpSuv = vHpWXZ / ${(2 * SHORE_HALF).toFixed(1)} + 0.5;
	float hpIn = step( 0.0, hpSuv.x ) * step( hpSuv.x, 1.0 ) * step( 0.0, hpSuv.y ) * step( hpSuv.y, 1.0 );
	vec4 hpSh = texture2D( tShore, clamp( hpSuv, 0.0, 1.0 ) );
	float hpDepth = ( hpSh.r * 255.0 - 128.0 ) / ${ENC.toFixed(4)};          // m tính từ mép bờ, + = vào lòng nước
	float hpLake = hpIn * hpSh.g;
	// hồ (kè đá, nước tĩnh): dải bùn hẹp + nhạt hơn sông — dải 16 m × 0,75 cũ thành quầng sáng quanh hồ nhìn từ trên cao
	float hpShoreW = hpIn * ( 1.0 - smoothstep( 1.0, mix( 16.0, 7.0, hpLake ), hpDepth ) ) * step( -4.0, hpDepth );
	diffuseColor.rgb = mix( diffuseColor.rgb, uLakeCol, hpLake );
	diffuseColor.rgb = mix( diffuseColor.rgb, uShoreCol, hpShoreW * mix( 0.75, 0.3, hpLake ) );
	diffuseColor.rgb += vec3( 0.026, 0.025, 0.022 ) * mix( 1.0, 0.4, hpLake ) * hpIn * ( 1.0 - smoothstep( 0.6, 2.2, hpDepth ) ) * step( -1.0, hpDepth );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor = mix( roughnessFactor, 0.32, hpShoreW * 0.8 );`);
  };
  return { mat, normal };
}
