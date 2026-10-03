import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ============ HẬU KỲ ĐỢT 3 (WP5): tone mapping + grade DÙNG CHUNG mọi đường vẽ, cảnh MSAA + AO theo độ sâu ============
//
// 1) TONE MAPPING + GRADE = 1 hàm GLSL `CustomToneMapping` (ACES của three r160 + grade nhẹ) ghi đè vào
//    ShaderChunk.tonemapping_pars_fragment TRƯỚC khi bất kỳ shader nào biên dịch. Mọi đường vẽ dùng CÙNG hàm:
//    - composer (TIER ≥ 2): FinalPass gọi CustomToneMapping;
//    - vẽ thẳng ra màn hình (TIER ≤ 1, ảnh vệ tinh không qua composer): renderer.toneMapping = CustomToneMapping →
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
// Gọi 1 lần ở đầu main.js (TRƯỚC khi tạo bất kỳ material/compile nào). Đổi GRADE sau đó chỉ có tác dụng với FinalPass
// (setGrade) — các shader vẽ thẳng đã biên dịch giữ hằng số cũ (đường vẽ thẳng chỉ là TIER ≤ 1/ảnh chụp vệ tinh).
export function installToneMapping(renderer) {
  if (_origChunk === null) _origChunk = THREE.ShaderChunk.tonemapping_pars_fragment;
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
  // tinh chỉnh grade lúc chạy (chỉ đường composer) — công cụ QA: __hp.post.setGrade({power:[..], sat:..})
  setGrade(g) {
    Object.assign(GRADE, g);
    THREE.ShaderChunk.tonemapping_pars_fragment = _origChunk.replace(_STUB, gradeGLSL(GRADE));
    const m = finalMaterial();
    this.material.dispose();
    this.material = m; this.fsQuad.material = m;
  }
}

// ---------- 2) + 3) Scene + AO ----------
const AO_FS = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uFullTexel;
  uniform mat4 uProjInv;
  uniform vec2 uProjScale;      // (P[0][0], P[1][1]) · 0.5 → bán kính m → uv
  uniform float uIsOrtho;
  uniform float uRadius, uBias, uBiasZ, uIntensity;
  varying vec2 vUv;
  // Bayer 4×4 (16 mức) không cần phép bit (GLSL ES 1.0)
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  vec3 viewPos(vec2 uv, float d) {
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  vec3 posAt(vec2 uv) { return viewPos(uv, texture2D(tDepth, uv).x); }
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
    rUV *= min(1.0, 90.0 / rPx);                       // trần bán kính màn hình (cache)
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

const BLUR_FS = /* glsl */`
  uniform sampler2D tAO;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).xy;
    float z0 = c.y, s = 0.0, w = 0.0;
    float tol = z0 * 0.035 + 0.15;
    for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
      vec2 t = texture2D(tAO, vUv + vec2(float(x), float(y)) * uTexel).xy;
      float k = max(0.0, 1.0 - abs(t.y - z0) / tol);
      s += t.x * k; w += k;
    }
    gl_FragColor = vec4(w > 0.0 ? s / w : c.x, z0, 0.0, 1.0);
  }`;

const COMP_FS = /* glsl */`
  uniform sampler2D tColor, tAO, tDepth;
  uniform vec2 uHalfTexel;
  uniform mat4 uProjInv;
  uniform float uStrength, uFadeStart, uFadeEnd, uDebug;
  varying vec2 vUv;
  void main() {
    vec4 col = texture2D(tColor, vUv);
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = col; return; }
    vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    float z = -vp.z / vp.w;
    // upsample theo độ sâu: 4 texel nửa phân giải gần nhất, trọng số song tuyến × giống độ sâu
    vec2 hp = vUv / uHalfTexel - 0.5;
    vec2 f = fract(hp), base = (floor(hp) + 0.5) * uHalfTexel;
    vec2 a00 = texture2D(tAO, base).xy, a10 = texture2D(tAO, base + vec2(uHalfTexel.x, 0.0)).xy;
    vec2 a01 = texture2D(tAO, base + vec2(0.0, uHalfTexel.y)).xy, a11 = texture2D(tAO, base + uHalfTexel).xy;
    float tol = z * 0.03 + 0.1;
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    w *= vec4(1.0) / (vec4(abs(a00.y - z), abs(a10.y - z), abs(a01.y - z), abs(a11.y - z)) / tol + 0.05);
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
  persp: { radius: 1.8, bias: 0.03, biasZ: 0.02, intensity: 1.0, strength: 0.72, fadeStart: 140, fadeEnd: 320 },
  ortho: { radius: 7.0, bias: 0.15, biasZ: 0.0, intensity: 1.0, strength: 0.7, fadeStart: 1e6, fadeEnd: 2e6 },
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
      uProjScale: { value: new THREE.Vector2() }, uIsOrtho: { value: 0 }, uRadius: { value: 1 }, uBias: { value: 0 }, uBiasZ: { value: 0 }, uIntensity: { value: 1 },
    }, { AO_SAMPLES: aoSamples });
    this.blurMat = sm(BLUR_FS, { tAO: { value: this.aoRT.texture }, uTexel: { value: new THREE.Vector2() } });
    this.compMat = sm(COMP_FS, {
      tColor: { value: this.sceneRT.texture }, tAO: { value: this.blurRT.texture }, tDepth: { value: this.sceneRT.depthTexture },
      uHalfTexel: { value: new THREE.Vector2() }, uProjInv: { value: this._pi }, uStrength: { value: 1 }, uFadeStart: { value: 1 }, uFadeEnd: { value: 2 }, uDebug: { value: 0 },
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
