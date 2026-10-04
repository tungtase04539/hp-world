import * as THREE from 'three';
import { humanoidGeometry, SK } from './models_kit.js';

// NHÂN VẬT CHƠI / NPC (Đợt 3 wave 2, W2-C): người kit (js/models_kit.js — tỉ lệ 7,5 đầu, cao 1,70 m, chi là ống elip
// bo tròn, mặt/tóc/nón lá thật) dựng thành MỘT SkinnedMesh 11 xương (hông, thân, đầu, vai/khuỷu, hông/gối) → 1 draw
// call + 1 bóng tròn mỗi nhân vật (trước: ~25 mesh capsule + ~25 Lambert riêng/người, dáng chibi).
// API giữ nguyên: { group, legL, legR, armL, armR, head, torso, blob, walkT, animate(dt, speedRatio, time, speedMs), sit(on) }
// — legL/armL/... là Bone (Object3D) nên mã cũ gán .rotation vẫn chạy. Quy ước: nhìn +Z; xoay X DƯƠNG đưa chi về SAU.
let _mat = null;
const mat = () => (_mat || (_mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.7, name: 'hp_humanoid' })));
const v = (a, b) => new THREE.Vector3(a[0] - (b ? b[0] : 0), a[1] - (b ? b[1] : 0), a[2] - (b ? b[2] : 0));

export function makeHumanoid(scheme = {}) {
  const s = {
    shirt: 0xff7a4d, shorts: 0x2e5a8f, skin: 0xf0c090,
    hair: 0x3a2a1a, cap: 0xe8402a, backpack: 0xf2c230,
    hat: null, // 'nonla' | 'cap' | null
    ...scheme,
  };
  if (s.skin === 0xf0c090) s.skin = 0xe2b48c;   // da người Việt (bảng cũ hồng-cam kiểu hoạt hình)
  const geo = humanoidGeometry(s);
  // ---- xương (vị trí nghỉ = khớp SK; con đặt tương đối với cha) ----
  const W = {
    hips: [0, 0.93, 0], torso: [0, SK.waistY, 0], head: [0, SK.neckY, -0.005],
    armL: [SK.shX, SK.shY, SK.shZ], armR: [-SK.shX, SK.shY, SK.shZ], foreL: [SK.elX, SK.elY, SK.elZ], foreR: [-SK.elX, SK.elY, SK.elZ],
    legL: [SK.hipX, SK.hipY, 0], legR: [-SK.hipX, SK.hipY, 0], shinL: [SK.knX, SK.knY, SK.knZ], shinR: [-SK.knX, SK.knY, SK.knZ],
  };
  const parent = { torso: 'hips', head: 'torso', armL: 'torso', armR: 'torso', foreL: 'armL', foreR: 'armR', legL: 'hips', legR: 'hips', shinL: 'legL', shinR: 'legR' };
  const order = ['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];   // = chỉ số xương trong models_kit
  const B = {};
  for (const k of order) {
    const b = new THREE.Bone(); b.name = k;
    b.position.copy(v(W[k], parent[k] ? W[parent[k]] : null));
    if (parent[k]) B[parent[k]].add(b);
    B[k] = b;
  }
  const mesh = new THREE.SkinnedMesh(geo, mat());
  mesh.name = 'humanoid';
  mesh.add(B.hips);
  mesh.bind(new THREE.Skeleton(order.map((k) => B[k])));
  // cầu bao rộng (chi xoay vẫn nằm trong) — frustum cull đúng, không tính lại từ xương
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.25);
  const g = new THREE.Group();
  g.add(mesh);

  // ---- Bóng đổ giả ----
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  g.add(blob);

  const rig = {
    group: g, mesh, legL: B.legL, legR: B.legR, armL: B.armL, armR: B.armR, head: B.head, torso: B.torso, blob,   // blob: main.js updatePlayerShadow
    shinL: B.shinL, shinR: B.shinR, foreL: B.foreL, foreR: B.foreR, hips: B.hips,
    tris: (geo.index ? geo.index.count : geo.attributes.position.count) / 3,
    walkT: 0,
    // dáng đi (cùng công thức với vertex shader đám đông — models_kit kitPose): hông ±0,42·a, gối gập khi chân
    // đang đưa ra trước, tay đánh ngược chân, khuỷu gập nhẹ; hạ hông theo cos góc đùi để chân trụ không nhấc khỏi đất
    pose(ph, a) {
      const sn = Math.sin(ph), cs = Math.cos(ph);
      B.legL.rotation.set(-0.42 * a * sn, 0, 0); B.legR.rotation.set(0.42 * a * sn, 0, 0);
      B.shinL.rotation.x = a * (0.06 + 0.62 * Math.pow(Math.max(0, cs), 1.5));
      B.shinR.rotation.x = a * (0.06 + 0.62 * Math.pow(Math.max(0, -cs), 1.5));
      B.armL.rotation.set(0.34 * a * sn, 0, 0.06); B.armR.rotation.set(-0.34 * a * sn, 0, -0.06);
      B.foreL.rotation.x = -(0.16 + 0.32 * a * Math.max(0, -sn)); B.foreR.rotation.x = -(0.16 + 0.32 * a * Math.max(0, sn));
      B.torso.rotation.set(0.04 * a, 0.05 * a * sn, 0);
      B.hips.position.y = 0.93 - 0.81 * (1 - Math.cos(0.42 * a * sn));
    },
    // speedMs (tuỳ chọn, m/s): nhịp bước theo tốc độ THẬT — 1 chu kỳ 2π = 2 bước, bước 0,7 m (đi) → 1,3 m (chạy);
    // không có speedMs (NPC) giữ công thức cũ. Biên độ lớn dần khi chạy.
    animate(dt, speedRatio, time, speedMs) {
      if (speedRatio > 0.05) {
        if (speedMs > 0.05) {
          const stepLen = 0.7 + Math.min(1, Math.max(0, (speedMs - 1.5) / 5)) * 0.6;
          this.walkT += dt * (speedMs / stepLen) * Math.PI;
        } else this.walkT += dt * (6 + speedRatio * 7);
        this.pose(this.walkT, Math.min(1.25, 0.55 + speedRatio * 0.6));
        B.head.rotation.x = Math.sin(this.walkT * 2) * 0.02;
      } else {
        // đứng: thở nhẹ + dồn trọng tâm (không cứng đơ)
        const k = 0.12;
        for (const b of [B.legL, B.legR, B.shinL, B.shinR, B.torso]) { b.rotation.x *= 1 - k; b.rotation.y *= 1 - k; }
        B.hips.position.y += (0.93 - B.hips.position.y) * k;
        B.armL.rotation.set(Math.sin(time * 1.6) * 0.04, 0, 0.07); B.armR.rotation.set(-Math.sin(time * 1.6) * 0.04, 0, -0.07);
        B.foreL.rotation.x = -0.14; B.foreR.rotation.x = -0.14;
        B.head.rotation.x = Math.sin(time * 1.1) * 0.02;
        B.head.rotation.y = Math.sin(time * 0.37) * 0.12;
      }
    },
    sit(on) {
      // ngồi xe máy: đùi đưa ra TRƯỚC gần ngang (hơi dạng), cẳng chân thả xuống sàn/gác chân, thân chồm nhẹ,
      // 2 tay vươn tới ghi-đông (khuỷu hơi gập). (Bản cũ xoay đùi +1 rad = chân ra SAU.)
      if (on) {
        B.hips.position.y = 0.93;
        B.legL.rotation.set(-1.32, 0, 0.12); B.legR.rotation.set(-1.32, 0, -0.12);
        B.shinL.rotation.x = 1.38; B.shinR.rotation.x = 1.38;
        B.torso.rotation.set(0.16, 0, 0);
        B.armL.rotation.set(-0.95, 0, 0.16); B.armR.rotation.set(-0.95, 0, -0.16);
        B.foreL.rotation.x = -0.45; B.foreR.rotation.x = -0.45;
        B.head.rotation.set(-0.1, 0, 0);
      } else {
        for (const b of [B.legL, B.legR, B.shinL, B.shinR, B.torso, B.armL, B.armR, B.foreL, B.foreR, B.head]) b.rotation.set(0, 0, 0);
        B.armL.rotation.z = 0.07; B.armR.rotation.z = -0.07;
        B.hips.position.y = 0.93;
      }
    },
  };
  rig.sit(false);
  return rig;
}
