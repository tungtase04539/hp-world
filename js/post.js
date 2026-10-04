import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ============ HẬU KỲ ĐỢT 3 (WP5): tone mapping + grade DÙNG CHUNG mọi đường vẽ, cảnh MSAA + AO theo độ sâu ============
//
// 1) TONE MAPPING + GRADE = 1 hàm GLSL `CustomToneMapping` (ACES của three r160 + grade nhẹ) ghi đè vào
//    ShaderChunk.tonemapping_pars_fragment TRƯỚC khi bất kỳ shader nào biên dịch. Mọi đường vẽ dùng CÙNG hàm:
//    - composer (TIER ≥ 2, kể cả ảnh vệ tinh __hp.aerial): FinalPass gọi CustomToneMapping;
//    - vẽ thẳng ra màn hình (TIER ≤ 1): renderer.toneMapping = CustomToneMapping →
//      mọi material/vòm trời qua <tonemapping_fragment>.
//    Bỏ Grade pass cũ (sat 0,88 + ám vàng sau ACES = "be bạc màu") — kiểm toán §3 #21.
//    (Tên vẫn là CustomToneMapping vì r160 chỉ có stub này để ghi đè; nền là ACES của chính three — xem GRADE.)
// 2) ScenePass: vẽ cảnh vào RT RIÊNG có MSAA + DepthTexture (MSAA CHỈ ở đây; RT composer không MSAA, canvas
//    antialias:false khi có hậu kỳ — trước đây MSAA ×3 chỗ, kiểm toán §3 #39). AO (nếu bật) đọc depth này rồi ghép
//    vào writeBuffer; tắt AO thì chép thẳng (1 quad).
// 3) AO: SAO (McGuire 2012) nửa độ phân giải, pháp tuyến dựng lại từ depth (KHÔNG vẽ lại cảnh — SSAOPass cũ bị loại
//    vì +3000 draw call), xoay mẫu theo ma trận Bayer 4×4 + làm mờ hộp 4×4 có trọng số độ sâu (khử nhiễu đúng chu kỳ),
//    ghép full-res có upsample theo độ sâu (không quầng sáng quanh cột/mép nhà). Chạy được cả camera trực giao (vệ tinh).

// ---------- 1) Tone mapping + grade ----------
// ĐƯỜNG CONG: đã thử AgX r160 (+look CDL) và ACES (fit RRT+ODT của three) bằng phép tính số trên màu pano thật
// (scratchpad WP5/agx.mjs, tm2.mjs): AgX ép bầu trời xanh sRGB(90,140,210) thành xám-xanh (99,139,182), chân trời
// thành xám chì — đúng cái "bạc màu" chủ dự án chê; ACES giữ được (104,155,208) / (206,212,218) và tường kem nắng
// gắt (219,213,199) với cùng dữ liệu. → nền ACES, rồi GRADE NHẸ trong không gian hiển thị tuyến tính:
//   sat: bão hoà quanh luma (ACES vốn đã đậm, chỉ +3%); toe: nâng nhẹ vùng tối (bóng râm nhiệt đới không đen kịt);
//   tint: cân trắng rất nhẹ (tránh ám vàng của grade cũ). curve 'agx' vẫn giữ để A/B (GRADE.curve).
export const GRADE = { curve: 'aces', sat: 1.03, toe: 0.012, tint: [1.0, 1.0, 1.0] };

function gradeGLSL(G) {
  const v3 = (a) => `vec3(${a.map((x) => (+x).toFixed(4)).join(',')})`;
  const base = G.curve === 'agx' ? 'AgXToneMapping( color )' : 'ACESFilmicToneMapping( color )';
  return /* glsl */`vec3 CustomToneMapping( vec3 color ) {
	color = ${base};
	float gl = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = max( vec3( 0.0 ), vec3( gl ) + ${(+G.sat).toFixed(4)} * ( color - vec3( gl ) ) );
	color = color * ${v3(G.tint)};
	color = color + ${(+G.toe).toFixed(4)} * ( 1.0 - color ) * exp( - color * 24.0 );
	return clamp( color, 0.0, 1.0 );
}`;
}

const _STUB = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
let _origChunk = null;

// ---------- 1b) Vật TỰ SÁNG / KHÔNG CHIẾU SÁNG hiển thị THEO MÀN HÌNH (không theo phơi sáng thích nghi) ----------
// Phơi sáng nay thích nghi ngày/đêm (daynight: tới ×4 lúc đêm). Nếu nhân cả ánh sáng tự phát thì đèn đường, cửa sổ, biển
// hiệu MeshBasic, nhãn sprite… cháy trắng lúc đêm (đo: chân dung nhà hát loé kín mặt tiền). Pipeline cũ phơi sáng CỐ ĐỊNH
// 1,18 → mọi vật tự sáng hiển thị = giá trị × 1,18. Giữ ĐÚNG hiển thị đó ở mọi giờ: nhân phần tự phát với
// HP_UNLIT_K = 1,18 / toneMappingExposure (FinalPass/tone mapping nhân lại phơi sáng → còn × 1,18 như cũ).
//  - material CÓ chiếu sáng (Lambert/Phong/Standard/Toon): chỉ totalEmissiveRadiance (chunk emissivemap_fragment);
//  - material KHÔNG chiếu sáng (MeshBasic/LineBasic, LineDashed, Points, Sprite): toàn bộ màu ra.
// KHÔNG đổi giá trị material nào (chân dung nhà hát giữ nguyên emissive — chỉ cách HIỂN THỊ không đổi theo giờ).
// Uniform `toneMappingExposure` do renderer tự đặt cho MỌI program có khai báo (WebGLRenderer.setProgram, refreshMaterial)
// kể cả khi vẽ vào RT composer (NoToneMapping) → tự khai báo khi không có TONE_MAPPING.
// ShaderMaterial / onBeforeCompile tự viết ánh sáng tự phát: nhân với HP_UNLIT_K (có sẵn sau <emissivemap_pars_fragment>)
// hoặc tự khai báo như UNLIT_DECL.
export const UNLIT_REF_EXPOSURE = 1.18;
export const UNLIT_DECL = `
#ifndef TONE_MAPPING
uniform float toneMappingExposure;
#endif
#define HP_UNLIT_K ( ${UNLIT_REF_EXPOSURE.toFixed(3)} / max( toneMappingExposure, 1e-3 ) )
`;
function installUnlitDisplayReferred() {
  const C = THREE.ShaderChunk;
  if (C.emissivemap_pars_fragment.indexOf('HP_UNLIT_K') >= 0) return;
  C.emissivemap_pars_fragment = UNLIT_DECL + C.emissivemap_pars_fragment;
  C.emissivemap_fragment = C.emissivemap_fragment + '\ntotalEmissiveRadiance *= HP_UNLIT_K;\n';
  for (const id of ['basic', 'dashed', 'points', 'sprite']) {
    const L = THREE.ShaderLib[id];
    if (!L || L.fragmentShader.indexOf('#include <opaque_fragment>') < 0 || L.fragmentShader.indexOf('#include <common>') < 0) {
      console.warn('[post] ShaderLib.' + id + ' khác r160 — bỏ qua hiển thị-theo-màn-hình'); continue;
    }
    L.fragmentShader = L.fragmentShader.replace('#include <common>', '#include <common>' + UNLIT_DECL)
      .replace('#include <opaque_fragment>', 'outgoingLight *= HP_UNLIT_K;\n\t#include <opaque_fragment>');
  }
}

// Gọi 1 lần ở đầu main.js (TRƯỚC khi tạo bất kỳ material/compile nào). Đổi GRADE sau đó chỉ có tác dụng với FinalPass
// (setGrade) — các shader vẽ thẳng đã biên dịch giữ hằng số cũ (đường vẽ thẳng chỉ là TIER ≤ 1/ảnh chụp vệ tinh).
export function installToneMapping(renderer) {
  if (_origChunk === null) _origChunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  installUnlitDisplayReferred();
  if (_origChunk.indexOf(_STUB) < 0) { console.warn('[post] không tìm thấy stub CustomToneMapping (đổi bản three?)'); return; }
  THREE.ShaderChunk.tonemapping_pars_fragment = _origChunk.replace(_STUB, gradeGLSL(GRADE));
  renderer.toneMapping = THREE.CustomToneMapping;
}

// ---------- shader dùng chung ----------
const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// FinalPass: tone map + grade (CustomToneMapping) + sRGB + dither chống dải màu ở gradient trời.
function finalMaterial() {
  return new THREE.RawShaderMaterial({
    name: 'HPFinal',
    uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 } },
    vertexShader: `precision highp float; attribute vec3 position; attribute vec2 uv; ${VS}`,
    fragmentShader: /* glsl */`precision highp float;
      uniform sampler2D tDiffuse;
      #include <tonemapping_pars_fragment>
      #include <colorspace_pars_fragment>
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D( tDiffuse, vUv );
        c.rgb = CustomToneMapping( c.rgb );
        c = sRGBTransferOETF( c );
        float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
        c.rgb += ( n - 0.5 ) / 255.0;
        gl_FragColor = vec4( c.rgb, 1.0 );
      }`,
    depthTest: false, depthWrite: false,
  });
}

export class FinalPass extends Pass {
  constructor() {
    super();
    this.material = finalMaterial();
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  // tinh chỉnh grade lúc chạy (chỉ đường composer) — công cụ QA: __hp.post.finalPass.setGrade({sat:1.05, toe:0.01})
  setGrade(g) {
    Object.assign(GRADE, g);
    THREE.ShaderChunk.tonemapping_pars_fragment = _origChunk.replace(_STUB, gradeGLSL(GRADE));
    const m = finalMaterial();
    this.material.dispose();
    this.material = m; this.fsQuad.material = m;
  }
}

// ---------- 2) + 3) Scene + AO ----------
// Lấy mẫu KHÔNG đạo hàm trong vòng lặp (HLSL/ANGLE cảnh báo X3595 "gradient instruction used in a loop" và có thể
// không unroll) — RT không mipmap nên LOD 0 = giống hệt texture2D.
const TEX0 = /* glsl */`
#if __VERSION__ >= 300
#define HP_TEX0(t, uv) textureLod(t, uv, 0.0)
#else
#define HP_TEX0(t, uv) texture2D(t, uv)
#endif
`;
const AO_FS = /* glsl */`${TEX0}
  uniform sampler2D tDepth;
  uniform vec2 uFullTexel;
  uniform mat4 uProjInv;
  uniform vec2 uProjScale;      // (P[0][0], P[1][1]) · 0.5 → bán kính m → uv
  uniform float uIsOrtho;
  uniform float uRadius, uBias, uBiasZ, uIntensity, uMaxPx;
  varying vec2 vUv;
  // Bayer 4×4 (16 mức) không cần phép bit (GLSL ES 1.0)
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  vec3 viewPos(vec2 uv, float d) {
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  vec3 posAt(vec2 uv) { return viewPos(uv, HP_TEX0(tDepth, uv).x); }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
    vec3 P = viewPos(vUv, d);
    // pháp tuyến từ depth: mỗi trục lấy hiệu NHỎ hơn trong 2 phía (không lấy qua mép vật)
    vec3 Pr = posAt(vUv + vec2(uFullTexel.x, 0.0)), Pl = posAt(vUv - vec2(uFullTexel.x, 0.0));
    vec3 Pt = posAt(vUv + vec2(0.0, uFullTexel.y)), Pb = posAt(vUv - vec2(0.0, uFullTexel.y));
    vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
    vec3 dy = abs(Pt.z - P.z) < abs(P.z - Pb.z) ? Pt - P : P - Pb;
    vec3 N = normalize(cross(dx, dy));
    float z = -P.z;
    vec2 rUV = uRadius * uProjScale / (uIsOrtho > 0.5 ? 1.0 : max(z, 0.1));
    float rPx = rUV.y / uFullTexel.y;
    if (rPx < 1.5) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
    rUV *= min(1.0, uMaxPx / rPx);                     // trần bán kính màn hình (cache + dải tiếp xúc tường gần)
    // xoay mẫu theo Bayer 4×4 (theo pixel nửa phân giải) — mờ hộp 4×4 phía sau khử nhiễu ĐÚNG chu kỳ
    float rot = bayer4(gl_FragCoord.xy) * 6.2831853;
    float bias = uBias * (1.0 + z * uBiasZ);
    float R2 = uRadius * uRadius;
    float sum = 0.0;
    for (int i = 0; i < AO_SAMPLES; i++) {
      float a = (float(i) + 0.5) / float(AO_SAMPLES);
      float ang = a * 6.2831853 * 2.62 + rot;          // xoắn ốc ~2,6 vòng
      vec2 o = vec2(cos(ang), sin(ang)) * (a * 0.85 + 0.15) * rUV;
      vec3 Q = posAt(vUv + o);
      vec3 v = Q - P;
      float vv = dot(v, v), vn = dot(v, N);
      float f = max(R2 - vv, 0.0);
      sum += f * f * f * max((vn - bias) / (0.01 + vv), 0.0);
    }
    float ao = max(0.0, 1.0 - sum * uIntensity / (R2 * R2 * R2) * (5.0 / float(AO_SAMPLES)));
    gl_FragColor = vec4(ao, z, 0.0, 1.0);
  }`;

const BLUR_FS = /* glsl */`${TEX0}
  uniform sampler2D tAO;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).xy;
    float z0 = c.y, s = 0.0, w = 0.0;
    float tol = z0 * 0.035 + 0.15;
    // so độ sâu với MẶT PHẲNG cục bộ (độ dốc 1 phía nhỏ hơn — không lấy qua mép vật), không với z0 phẳng: tường gần nhìn
    // xiên có độ sâu đổi > tol mỗi texel → trước đây mờ bị loại gần hết → lộ nhiễu Bayer 4×4 thành mép răng cưa.
    float zr = HP_TEX0(tAO, vUv + vec2(uTexel.x, 0.0)).y, zl = HP_TEX0(tAO, vUv - vec2(uTexel.x, 0.0)).y;
    float zt = HP_TEX0(tAO, vUv + vec2(0.0, uTexel.y)).y, zb = HP_TEX0(tAO, vUv - vec2(0.0, uTexel.y)).y;
    float gx = abs(zr - z0) < abs(z0 - zl) ? zr - z0 : z0 - zl;
    float gy = abs(zt - z0) < abs(z0 - zb) ? zt - z0 : z0 - zb;
    for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
      vec2 t = HP_TEX0(tAO, vUv + vec2(float(x), float(y)) * uTexel).xy;
      float k = max(0.0, 1.0 - abs(t.y - (z0 + gx * float(x) + gy * float(y))) / tol);
      s += t.x * k; w += k;
    }
    gl_FragColor = vec4(w > 0.0 ? s / w : c.x, z0, 0.0, 1.0);
  }`;

const COMP_FS = /* glsl */`
  uniform sampler2D tColor, tAO, tDepth;
  uniform vec2 uHalfTexel, uFullTexel;
  uniform mat4 uProjInv;
  uniform float uStrength, uFadeStart, uFadeEnd, uDebug;
  varying vec2 vUv;
  float zAt(vec2 uv) { vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0); return -v.z / v.w; }
  void main() {
    vec4 col = texture2D(tColor, vUv);
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = col; return; }
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    float z = -vp.z / vp.w;
    // upsample theo độ sâu: 4 texel nửa phân giải gần nhất, trọng số song tuyến × giống độ sâu. Độ sâu kỳ vọng của
    // từng texel = mặt phẳng cục bộ (độ dốc 1 phía nhỏ hơn, theo pixel full-res) — tường nhìn xiên không thành khối 2×2.
    float zr = zAt(vUv + vec2(uFullTexel.x, 0.0)), zl = zAt(vUv - vec2(uFullTexel.x, 0.0));
    float zt = zAt(vUv + vec2(0.0, uFullTexel.y)), zb = zAt(vUv - vec2(0.0, uFullTexel.y));
    vec2 g = vec2(abs(zr - z) < abs(z - zl) ? zr - z : z - zl, abs(zt - z) < abs(z - zb) ? zt - z : z - zb);
    vec2 hp = vUv / uHalfTexel - 0.5;
    vec2 f = fract(hp), base = (floor(hp) + 0.5) * uHalfTexel;
    vec2 a00 = texture2D(tAO, base).xy, a10 = texture2D(tAO, base + vec2(uHalfTexel.x, 0.0)).xy;
    vec2 a01 = texture2D(tAO, base + vec2(0.0, uHalfTexel.y)).xy, a11 = texture2D(tAO, base + uHalfTexel).xy;
    vec2 o00 = (base - vUv) / uFullTexel, oH = uHalfTexel / uFullTexel;   // vị trí texel so với pixel (px full-res)
    vec4 ze = z + vec4(dot(g, o00), dot(g, o00 + vec2(oH.x, 0.0)), dot(g, o00 + vec2(0.0, oH.y)), dot(g, o00 + oH));
    float tol = z * 0.03 + 0.1;
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    w *= vec4(1.0) / (abs(vec4(a00.y, a10.y, a01.y, a11.y) - ze) / tol + 0.05);
    float ao = dot(w, vec4(a00.x, a10.x, a01.x, a11.x)) / max(dot(w, vec4(1.0)), 1e-5);
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, z);
    ao = mix(1.0, ao, uStrength * fade);
    gl_FragColor = uDebug > 0.5 ? vec4(vec3(ao), 1.0) : vec4(col.rgb * ao, col.a);
  }`;

const COPY_FS = /* glsl */`uniform sampler2D tColor; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tColor, vUv); }`;

function sm(fs, uniforms, defines) {
  return new THREE.ShaderMaterial({ uniforms, defines: defines || {}, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
}
function rt(w, h, opts) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), Object.assign({ type: THREE.HalfFloatType, depthBuffer: false }, opts));
}

// Cấu hình AO theo loại camera (đo/chỉnh bằng mắt ở KNOWLEDGE §10 Đợt 3 WP5)
export const AO = {
  // maxPx: trần bán kính trên màn hình (px full-res). 90 cũ: tường sát camera có dải tối tiếp xúc rộng bất thường
  // (review WP5, pano_014_h180) — 56 giữ dải ~0,5 m ở 4-5 m, không đổi gì ở xa (rPx < 56 khi z > ~8 m).
  persp: { radius: 1.8, bias: 0.03, biasZ: 0.02, intensity: 1.0, strength: 0.72, fadeStart: 140, fadeEnd: 320, maxPx: 56 },
  ortho: { radius: 7.0, bias: 0.15, biasZ: 0.0, intensity: 1.0, strength: 0.7, fadeStart: 1e6, fadeEnd: 2e6, maxPx: 90 },
};

export class SceneAOPass extends Pass {
  constructor(scene, camera, { samples = 4, ao = true, aoSamples = 10 } = {}) {
    super();
    this.scene = scene; this.camera = camera;
    this.needsSwap = true;
    this.aoEnabled = ao;
    this.sceneRT = rt(1, 1, { samples, depthBuffer: true });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.sceneRT.texture.name = 'HP.sceneRT';
    this.aoRT = rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat });
    this.blurRT = this.aoRT.clone();
    this._pi = new THREE.Matrix4();
    this.aoMat = sm(AO_FS, {
      tDepth: { value: this.sceneRT.depthTexture }, uFullTexel: { value: new THREE.Vector2() }, uProjInv: { value: this._pi },
      uProjScale: { value: new THREE.Vector2() }, uIsOrtho: { value: 0 }, uRadius: { value: 1 }, uBias: { value: 0 }, uBiasZ: { value: 0 }, uIntensity: { value: 1 }, uMaxPx: { value: 56 },
    }, { AO_SAMPLES: aoSamples });
    this.blurMat = sm(BLUR_FS, { tAO: { value: this.aoRT.texture }, uTexel: { value: new THREE.Vector2() } });
    this.compMat = sm(COMP_FS, {
      tColor: { value: this.sceneRT.texture }, tAO: { value: this.blurRT.texture }, tDepth: { value: this.sceneRT.depthTexture },
      uHalfTexel: { value: new THREE.Vector2() }, uFullTexel: { value: new THREE.Vector2() }, uProjInv: { value: this._pi }, uStrength: { value: 1 }, uFadeStart: { value: 1 }, uFadeEnd: { value: 2 }, uDebug: { value: 0 },
    });
    this.copyMat = sm(COPY_FS, { tColor: { value: this.sceneRT.texture } });
    this.quad = new FullScreenQuad(this.copyMat);
    this._clear = new THREE.Color();
  }
  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.aoRT.setSize(hw, hh); this.blurRT.setSize(hw, hh);
    this.aoMat.uniforms.uFullTexel.value.set(1 / w, 1 / h);
    this.blurMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.compMat.uniforms.uHalfTexel.value.set(1 / hw, 1 / hh);
    this.compMat.uniforms.uFullTexel.value.set(1 / w, 1 / h);
  }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.post(renderer, this.renderToScreen ? null : writeBuffer);
  }
  // phần SAU khi đã có ảnh cảnh + depth trong sceneRT: AO (nếu bật) rồi ghép/chép ra `out` — tách riêng để đo GPU
  post(renderer, out) {
    if (!this.aoEnabled) {
      this.quad.material = this.copyMat;
      renderer.setRenderTarget(out); this.quad.render(renderer);
      return;
    }
    const cam = this.camera, ortho = !!cam.isOrthographicCamera, P = ortho ? AO.ortho : AO.persp;
    this._pi.copy(cam.projectionMatrixInverse);
    const u = this.aoMat.uniforms, e = cam.projectionMatrix.elements;
    u.uProjScale.value.set(e[0] * 0.5, e[5] * 0.5);
    u.uIsOrtho.value = ortho ? 1 : 0;
    u.uRadius.value = P.radius; u.uBias.value = P.bias; u.uBiasZ.value = P.biasZ; u.uIntensity.value = P.intensity;
    u.uMaxPx.value = P.maxPx;
    const c = this.compMat.uniforms;
    c.uStrength.value = P.strength; c.uFadeStart.value = P.fadeStart; c.uFadeEnd.value = P.fadeEnd;
    this.quad.material = this.aoMat; renderer.setRenderTarget(this.aoRT); this.quad.render(renderer);
    this.quad.material = this.blurMat; renderer.setRenderTarget(this.blurRT); this.quad.render(renderer);
    this.quad.material = this.compMat; renderer.setRenderTarget(out); this.quad.render(renderer);
  }
}

// Đo GPU (ms/lần) của fn() lặp n lần: đồng bộ bằng readPixels 1 px của RT đích (gl.finish của Chrome KHÔNG chờ GPU
// xong — đo bằng finish ra 0,01 ms vô nghĩa). Công cụ QA (__hp.post.timeAO()).
const _px = new Uint16Array(4);
export function timePass(renderer, fn, n = 60, target = null) {
  const sync = () => { if (target) renderer.readRenderTargetPixels(target, 0, 0, 1, 1, _px); else renderer.getContext().finish(); };
  fn(); sync();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  sync();
  return (performance.now() - t0) / n;
}
