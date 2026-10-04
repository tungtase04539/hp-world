// trafficmodels.js — MÔ HÌNH XE/NGƯỜI cho giao thông INSTANCED (Đợt 3 WP8). Mỗi biến thể = 1 BufferGeometry
// gộp từ khối cơ bản, màu cố định ở vertex color + thuộc tính `aTint` chọn kênh nhuộm theo instance:
//   0 giữ màu đỉnh · 1 sơn xe = instanceColor · 2 áo người lái = aShirt · 3 mũ bảo hiểm = bảng màu băm từ aShirt
//   4 áo người ngồi sau / quần người đi bộ = aShirt2 · 5 đèn pha · 6 đèn hậu (giữ màu đỉnh; đêm tự sáng theo uNight)
// → mọi xe máy cùng kiểu chung 1 draw call nhưng mỗi chiếc màu sơn/áo/mũ khác nhau (ảnh pano HP: xe số, xe ga đủ
// màu, mũ bảo hiểm trắng/đen/đỏ/xanh, rất nhiều xe chở 2 người, xe chở hàng thùng sau).
// Người đi bộ: dáng người thật (~1,65 m, đầu 1/7,5 thân — KHÔNG chibi), tay chân vung bằng VERTEX SHADER
// (aLimb + aPhase/aWalk theo instance) → đám đông đi lại thật mà CPU không phải cập nhật xương.
// Trục mô hình: tiến = +Z, lên = +Y, bề ngang = X; gốc ở mặt đường dưới tâm xe.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
// Thêm 1 khối: geo (đã đặt vị trí), màu hex (sRGB), kênh nhuộm, chi (người đi bộ) → non-indexed + attribute đủ bộ
function part(list, geo, hex, tint = 0, limb = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  _c.setHex(hex);
  const col = new Float32Array(n * 3), ti = new Float32Array(n), li = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; ti[i] = tint; li[i] = limb; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(ti, 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(li, 1));
  list.push(g);
  return g;
}
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return g.translate(x, y, z);
};
// khối dài nối 2 điểm (tay người lái nắm ghi-đông)
function beam(list, ax, ay, az, bx, by, bz, t, hex, tint) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  const g = new THREE.BoxGeometry(t, t, L);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / L, dy / L, dz / L));
  g.applyQuaternion(q).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  part(list, g, hex, tint);
}
const wheel = (r, w, x, y, z, seg = 10) => {
  const g = new THREE.CylinderGeometry(r, r, w, seg, 1);
  g.rotateZ(Math.PI / 2);
  return g.translate(x, y, z);
};
// Gộp + ĐÁNH CHỈ SỐ lại (mergeVertices): khối rời ở trên phải non-indexed để gộp chung (Icosahedron vốn non-indexed),
// nhưng vẽ instanced thì số đỉnh × số xe × 2 lượt (màu + bóng) mới là chi phí — đỉnh trùng (cùng vị trí/pháp tuyến/màu/
// kênh) gộp lại ≈ 2× ít lần chạy vertex shader + tận dụng cache sau biến đổi.
const finish = (list) => {
  const m = mergeGeometries(list, false); list.forEach((x) => x.dispose());
  const g = mergeVertices(m, 1e-4); if (g !== m) m.dispose();
  g.computeBoundingSphere(); return g;
};

// BÓNG TIẾP ĐẤT: elip mềm sát mặt đường dưới xe/người (thay bóng đổ thật — xem traffic.js: bản đồ bóng chỉ làm mới
// 4-10 Hz nên bóng thật của xe 10 m/s "giật" từng bước ~2 m; elip đi liền với xe, không tốn lượt bóng). Hình học RIÊNG
// (không gộp vào thân xe): traffic.js vẽ bằng 1 InstancedMesh trong suốt dùng CHUNG bộ đệm instance với thân xe.
// Lõi r ≤ 0,5 đậm đều (alpha a), rìa 0,5 → 1 nhạt dần về 0 (trước: elip Lambert đen đặc → "vũng dầu" cứng dưới xe).
// Kích thước + alpha khai báo ở geometry.userData.shadow = [rx, rz, a] của từng mô hình.
export function contactShadowGeometry(rx, rz, a) {
  const g = mergeGeometries([new THREE.CircleGeometry(0.5, 18), new THREE.RingGeometry(0.5, 1, 18, 2)], false);
  const P = g.attributes.position, n = P.count, al = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(P.getX(i), P.getY(i));
    al[i] = r <= 0.501 ? a : a * Math.pow(Math.max(0, (1 - r) / 0.5), 1.3);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.setAttribute('aSA', new THREE.BufferAttribute(al, 1));
  g.rotateX(-Math.PI / 2).scale(rx, 1, rz).translate(0, 0.02, 0);
  g.computeBoundingSphere();
  return g;
}

const SKIN = 0xc8976f, PANTS = 0x2e3644, SHOE = 0x2a2420, DARK = 0x232427, METAL = 0x9a9ea3, SEAT = 0x1d1d1f;

// người ngồi trên xe máy: z0 = vị trí hông, hy = độ cao hông, tay tới ghi-đông (hz) nếu grip
function seatedRider(L, z0, hy, shirtTint, grip, hz = 0.44) {
  part(L, box(0.36, 0.16, 0.44, 0, hy, z0 + 0.12), PANTS);                               // đùi
  for (const sx of [-0.17, 0.17]) {
    part(L, box(0.11, 0.42, 0.12, sx, hy - 0.3, z0 + 0.32, -0.12), PANTS);               // cẳng chân
    part(L, box(0.1, 0.07, 0.22, sx, hy - 0.52, z0 + 0.38), SHOE);                         // dép
  }
  part(L, box(0.38, 0.56, 0.22, 0, hy + 0.34, z0 - 0.02, 0.14), 0xffffff, shirtTint);    // thân
  part(L, box(0.1, 0.08, 0.1, 0, hy + 0.66, z0 + 0.02), SKIN);                           // cổ
  part(L, new THREE.IcosahedronGeometry(0.105, 1).translate(0, hy + 0.78, z0 + 0.03), SKIN);   // đầu
  part(L, new THREE.SphereGeometry(0.132, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56).translate(0, hy + 0.8, z0 + 0.02), 0xffffff, 3);   // mũ bảo hiểm
  for (const sx of [-0.21, 0.21]) {
    if (grip) beam(L, sx, hy + 0.56, z0, sx * 1.3, 1.08, hz, 0.085, 0xffffff, shirtTint);   // tay nắm ghi-đông
    else beam(L, sx, hy + 0.56, z0, sx * 0.9, hy + 0.18, z0 + 0.22, 0.085, 0xffffff, shirtTint);   // tay đặt đùi
  }
}

// kind: 'single' | 'pillion' (chở 2 người) | 'cargo' (thùng hàng sau yên)
export function motorbikeGeometry(kind = 'single') {
  const L = [];
  // bánh + vành (bánh 17" xe số ~0,29 m)
  for (const z of [0.66, -0.6]) {
    part(L, wheel(0.29, 0.09, 0, 0.29, z), 0x1b1c1e);
    part(L, wheel(0.14, 0.1, 0, 0.29, z, 8), METAL);
  }
  part(L, box(0.06, 0.48, 0.06, 0, 0.55, 0.6, -0.32), METAL);                 // phuộc trước
  part(L, box(0.36, 0.3, 0.78, 0, 0.6, -0.34), 0xffffff, 1);                   // ốp thân sau (sơn)
  part(L, box(0.31, 0.1, 0.64, 0, 0.8, -0.3), SEAT);                           // yên
  part(L, box(0.3, 0.07, 0.4, 0, 0.37, 0.12), 0x38393c);                       // sàn để chân
  part(L, box(0.42, 0.62, 0.13, 0, 0.7, 0.42, -0.22), 0xffffff, 1);            // ốp chân trước (sơn)
  part(L, box(0.14, 0.06, 0.42, 0, 0.6, 0.68), 0xffffff, 1);                   // chắn bùn trước
  part(L, box(0.22, 0.17, 0.2, 0, 1.03, 0.5), 0xffffff, 1);                    // đầu đèn
  part(L, box(0.15, 0.09, 0.03, 0, 1.0, 0.6), 0xf3f0dc, 5);                    // đèn pha
  part(L, box(0.64, 0.05, 0.05, 0, 1.08, 0.44), DARK);                         // ghi-đông
  for (const sx of [-0.25, 0.25]) {
    part(L, box(0.02, 0.2, 0.02, sx, 1.18, 0.42), DARK);                       // cần gương
    part(L, box(0.1, 0.06, 0.02, sx * 1.06, 1.29, 0.42), DARK);                // gương
  }
  part(L, new THREE.CylinderGeometry(0.045, 0.05, 0.55, 6).rotateX(Math.PI / 2).translate(0.17, 0.33, -0.42), METAL);   // ống xả
  part(L, box(0.17, 0.06, 0.04, 0, 0.77, -0.73), 0xa01818, 6);                 // đèn hậu
  part(L, box(0.17, 0.11, 0.01, 0, 0.6, -0.8), 0xe8e8e2);                      // biển số
  seatedRider(L, -0.12, 0.92, 2, true);
  if (kind === 'pillion') seatedRider(L, -0.5, 0.96, 4, false);
  if (kind === 'cargo') {
    part(L, box(0.06, 0.05, 0.56, 0.2, 0.84, -0.66), DARK);                    // baga
    part(L, box(0.06, 0.05, 0.56, -0.2, 0.84, -0.66), DARK);
    part(L, box(0.62, 0.5, 0.52, 0, 1.13, -0.7), 0xb08a5a, 0);                 // thùng các-tông / thùng xốp
    part(L, box(0.64, 0.04, 0.54, 0, 1.39, -0.7), 0x6a7d8c);                   // dây chằng / nắp
  }
  const g = finish(L); g.userData.shadow = [0.42, 1.1, 0.5]; return g;
}

// kind: 'sedan' | 'suv' | 'van' (xe 16 chỗ — rất phổ biến ở HP) — sơn = instanceColor
export function carGeometry(kind = 'sedan') {
  const L = [];
  const W = kind === 'van' ? 1.98 : kind === 'suv' ? 1.85 : 1.76;
  const len = kind === 'van' ? 5.4 : kind === 'suv' ? 4.7 : 4.45;
  const r = kind === 'van' ? 0.34 : kind === 'suv' ? 0.36 : 0.31;
  const wz = len / 2 - (kind === 'van' ? 0.95 : 0.85);
  for (const sx of [-1, 1]) for (const z of [wz, -wz]) {
    part(L, wheel(r, 0.22, sx * (W / 2 - 0.13), r, z, 12), 0x161718);
    part(L, wheel(r * 0.55, 0.23, sx * (W / 2 - 0.12), r, z, 8), METAL);
  }
  if (kind === 'van') {
    part(L, box(W, 1.55, len, 0, 0.35 + 0.78, 0), 0xffffff, 1);                    // thân hộp
    part(L, box(W + 0.02, 0.52, len - 1.4, 0, 1.6, -0.35), 0x26313a);               // dải kính hông
    part(L, box(W - 0.12, 0.62, 0.05, 0, 1.45, len / 2 - 0.42, -0.45), 0x26313a);   // kính lái nghiêng
    part(L, box(W - 0.04, 0.5, 0.5, 0, 0.82, len / 2 - 0.2), 0xffffff, 1);          // mũi xe
  } else {
    const hb = kind === 'suv' ? 0.78 : 0.6;
    part(L, box(W, hb, len, 0, 0.28 + hb / 2, 0), 0xffffff, 1);                      // thân dưới
    const cl = kind === 'suv' ? 2.7 : 2.25, ch = kind === 'suv' ? 0.62 : 0.5;
    const cz = kind === 'suv' ? -0.25 : -0.2;
    part(L, box(W - 0.16, ch, cl, 0, 0.28 + hb + ch / 2, cz), 0x26313a);             // khoang kính
    part(L, box(W - 0.2, 0.06, cl - 0.35, 0, 0.28 + hb + ch + 0.02, cz), 0xffffff, 1);   // nóc (sơn)
    for (const sx of [-1, 1]) part(L, box(0.06, ch, 0.12, sx * (W / 2 - 0.1), 0.28 + hb + ch / 2, cz + cl / 2 - 0.1), 0xffffff, 1);   // cột A
  }
  const fz = len / 2;
  for (const sx of [-1, 1]) {
    part(L, box(0.32, 0.12, 0.04, sx * (W / 2 - 0.28), 0.82, fz + 0.01), 0xf1efe2, 5);   // đèn pha
    part(L, box(0.3, 0.12, 0.04, sx * (W / 2 - 0.26), 0.86, -fz - 0.01), 0xa31616, 6);  // đèn hậu
  }
  part(L, box(W + 0.02, 0.18, 0.12, 0, 0.42, fz), 0x2b2c2f);                     // cản trước
  part(L, box(W + 0.02, 0.18, 0.12, 0, 0.42, -fz), 0x2b2c2f);                    // cản sau
  part(L, box(0.52, 0.12, 0.02, 0, 0.5, -fz - 0.07), 0xe8e8e2);                  // biển số
  const g = finish(L); g.userData.shadow = [W / 2 + 0.2, len / 2 + 0.22, 0.58]; return g;
}

// Người đi bộ dáng thật (~1,65 m). aLimb: 1/2 chân trái/phải (khớp hông y 0,9), 3/4 tay trái/phải (khớp vai y 1,42).
export function walkerGeometry(kind = 'plain') {
  const L = [];
  for (const [sx, limb] of [[-0.095, 1], [0.095, 2]]) {
    part(L, box(0.13, 0.84, 0.14, sx, 0.47, 0), 0xffffff, 4, limb);           // chân (quần = aShirt2)
    part(L, box(0.11, 0.07, 0.25, sx, 0.035, 0.03), SHOE, 0, limb);            // giày dép
  }
  part(L, box(0.34, 0.14, 0.2, 0, 0.9, 0), 0xffffff, 4);                       // hông
  part(L, box(0.37, 0.55, 0.21, 0, 1.17, 0), 0xffffff, 2);                     // thân áo
  part(L, box(0.1, 0.08, 0.1, 0, 1.47, 0.01), SKIN);                           // cổ
  part(L, new THREE.IcosahedronGeometry(0.104, 1).translate(0, 1.57, 0.01), SKIN);   // đầu
  part(L, new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 1.59, -0.005), 0x1c1712);   // tóc
  for (const [sx, limb] of [[-0.23, 3], [0.23, 4]]) {
    part(L, box(0.085, 0.3, 0.09, sx, 1.27, 0), 0xffffff, 2, limb);            // bắp tay (tay áo)
    part(L, box(0.075, 0.32, 0.08, sx, 0.97, 0.01), SKIN, 0, limb);            // cẳng tay
  }
  if (kind === 'nonla') part(L, new THREE.ConeGeometry(0.25, 0.15, 12).translate(0, 1.73, 0), 0xd9c48c);   // nón lá
  const g = finish(L); g.userData.shadow = [0.3, 0.26, 0.42]; return g;
}

// Vật liệu Lambert + nhuộm theo kênh. walk=true: thêm vung tay chân (uniform uTime dùng chung).
// uNight 0..1 (traffic.setNight ← daynight): đèn pha/đèn hậu tự phát sáng (bloom đêm làm loé) — phố đêm VN là
// một dòng đèn xe máy; ban ngày chỉ là màu đỉnh.
export const trafficUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
const TINT_VERT = /* glsl */`
  vColor = vec3(1.0);
  #ifdef USE_COLOR
    vColor *= color;
  #endif
  vec3 tintC = vec3(1.0);
  vLamp = aTint > 5.5 ? 2.0 : aTint > 4.5 ? 1.0 : 0.0;
  #ifdef USE_INSTANCING_COLOR
    if (aTint > 0.5 && aTint < 1.5) tintC = instanceColor.xyz;
  #endif
  if (aTint > 1.5 && aTint < 2.5) tintC = aShirt;
  else if (aTint > 4.5) tintC = vec3(1.0);
  else if (aTint > 3.5) tintC = aShirt2;
  else if (aTint > 2.5) {
    // mũ bảo hiểm: băm (áo người lái, áo/quần phụ) → 144 tổ hợp; tỉ lệ theo pano: trắng/kem, đen, xám, rồi màu
    float hh = fract(sin(dot(aShirt + aShirt2 * 1.73, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    tintC = hh < 0.3 ? vec3(0.78, 0.77, 0.72) : hh < 0.5 ? vec3(0.015) : hh < 0.62 ? vec3(0.22)
      : hh < 0.72 ? vec3(0.42, 0.03, 0.025) : hh < 0.82 ? vec3(0.03, 0.08, 0.32) : hh < 0.9 ? vec3(0.65, 0.42, 0.04) : vec3(0.5, 0.2, 0.28);
  }
  vColor *= tintC;
`;
const WALK_VERT = /* glsl */`
  #include <begin_vertex>
  if (aLimb > 0.5) {
    float sw = sin(uTime * aWalk + aPhase);
    float lr = (aLimb == 1.0 || aLimb == 3.0) ? 1.0 : -1.0;          // trái/phải ngược pha
    bool leg = aLimb < 2.5;
    float amp = aWalk > 0.01 ? (leg ? 0.42 : -0.34) : 0.0;          // tay vung NGƯỢC chân cùng bên
    float ang = sw * amp * lr;
    float py = leg ? 0.9 : 1.42;
    float yy = transformed.y - py, zz = transformed.z;
    float cA = cos(ang), sA = sin(ang);
    transformed.y = py + yy * cA - zz * sA;
    transformed.z = yy * sA + zz * cA;
  }
  transformed.y += aWalk > 0.01 ? abs(sin(uTime * aWalk + aPhase)) * 0.035 : 0.0;
`;
function patch(shader, walk) {
  shader.uniforms.uTime = trafficUniforms.uTime;
  shader.uniforms.uNight = trafficUniforms.uNight;
  shader.vertexShader = 'attribute float aTint;\nattribute float aLimb;\nattribute vec3 aShirt;\nattribute vec3 aShirt2;\n'
    + 'attribute float aPhase;\nattribute float aWalk;\nuniform float uTime;\nvarying float vLamp;\n' + shader.vertexShader;
  if (shader.vertexShader.includes('#include <color_vertex>')) shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', TINT_VERT);
  if (walk) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', WALK_VERT);
  // đèn xe ban đêm: cộng bức xạ tự phát (đèn pha trắng ấm, đèn hậu đỏ) — chỉ đổi uniform, không đổi chương trình
  shader.fragmentShader = 'uniform float uNight;\nvarying float vLamp;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n  if (vLamp > 0.5) totalEmissiveRadiance += (vLamp > 1.5 ? vec3(1.4, 0.06, 0.04) : vec3(2.4, 2.25, 1.9)) * uNight;');
}
// Bóng tiếp đất: đen, alpha theo đỉnh (aSA) — không ghi depth, đẩy offset đa giác lên trên mặt đường (khỏi z-fight ở
// xa), đêm nhạt bớt 45 % (ánh sáng tán xạ đèn đường/ánh trăng, không còn nắng gắt).
export function trafficShadowMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = trafficUniforms.uNight;
    sh.vertexShader = 'attribute float aSA;\nvarying float vSA;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSA = aSA;');
    sh.fragmentShader = 'uniform float uNight;\nvarying float vSA;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.a *= vSA * (1.0 - 0.45 * uNight);');
  };
  m.customProgramCacheKey = () => 'hp-traffic-shadow';
  return m;
}
export function trafficMaterial(walk = false) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = walk ? (s) => patch(s, true) : (s) => patch(s, false);
  m.customProgramCacheKey = () => (walk ? 'hp-traffic-walk' : 'hp-traffic');
  return m;
}
