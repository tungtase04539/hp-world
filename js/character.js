import * as THREE from 'three';

function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }

// Chi (tay/chân) capsule bo tròn — gốc xoay ở khớp trên
function limb(r, len, material) {
  const g = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(r, len, 4, 10);
  geo.translate(0, -len / 2, 0);
  g.add(new THREE.Mesh(geo, material));
  return g;
}

// Nhân vật bo tròn tỉ lệ chuẩn (kiểu Animal Crossing) — không còn khối vuông
export function makeHumanoid(scheme = {}) {
  const s = {
    shirt: 0xff7a4d, shorts: 0x2e5a8f, skin: 0xf0c090,
    hair: 0x3a2a1a, cap: 0xe8402a, backpack: 0xf2c230,
    hat: null, // 'nonla' | 'cap' | null
    ...scheme,
  };
  const g = new THREE.Group();
  const skinM = mat(s.skin), shirtM = mat(s.shirt), shortsM = mat(s.shorts);

  // ---- Chân + giày ----
  const legL = limb(0.095, 0.6, shortsM);
  const legR = limb(0.095, 0.6, shortsM);
  legL.position.set(-0.13, 0.88, 0);
  legR.position.set(0.13, 0.88, 0);
  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0x42342a));
    shoe.scale.set(1, 0.62, 1.5);
    shoe.position.set(0, -0.66, 0.05);
    leg.add(shoe);
  }
  g.add(legL, legR);

  // ---- Hông ----
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.08, 4, 12), shortsM);
  hips.scale.set(1.05, 1, 0.82);
  hips.position.y = 0.95;
  g.add(hips);

  // ---- Thân áo ----
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.34, 4, 12), shirtM);
  torso.scale.set(1.12, 1, 0.76);
  torso.position.y = 1.24;
  g.add(torso);

  // ---- Cổ ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.09, 8), skinM);
  neck.position.y = 1.5;
  g.add(neck);

  // ---- Tay + bàn tay ----
  const armL = limb(0.06, 0.44, shirtM);
  const armR = limb(0.06, 0.44, shirtM);
  armL.position.set(-0.265, 1.42, 0);
  armR.position.set(0.265, 1.42, 0);
  armL.rotation.z = 0.08;
  armR.rotation.z = -0.08;
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 7), skinM);
    hand.position.y = -0.52;
    arm.add(hand);
  }
  g.add(armL, armR);

  // ---- Đầu: sọ tròn, tóc, mắt, miệng cười, má ----
  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skinM);
  skull.scale.set(1, 1.06, 0.95);
  skull.position.y = 0.15;
  head.add(skull);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 12), mat(s.hair));
  hair.scale.set(1.03, 0.92, 1.0);
  hair.position.set(0, 0.2, -0.028);
  head.add(hair);
  for (const ex of [-0.062, 0.062]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 7), mat(0x2a241e));
    eye.position.set(ex, 0.155, 0.147);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(ex + 0.008, 0.163, 0.168);
    head.add(glint);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.009, 6, 10, Math.PI), mat(0x8a5240));
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, 0.095, 0.15);
  head.add(mouth);
  for (const bx of [-0.09, 0.09]) { // má hồng
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5),
      mat(0xe89078, { transparent: true, opacity: 0.55 }));
    blush.scale.set(1, 0.7, 0.5);
    blush.position.set(bx, 0.115, 0.135);
    head.add(blush);
  }
  // ---- Mũ ----
  if (s.hat === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.178, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(s.cap));
    dome.scale.set(1.03, 0.9, 1.03);
    dome.position.y = 0.235;
    head.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.155, 0.022, 10, 1, false, -Math.PI / 2, Math.PI), mat(s.cap));
    brim.scale.set(1, 1, 1.5);
    brim.position.set(0, 0.245, 0.1);
    head.add(brim);
  } else if (s.hat === 'nonla') {
    const nonla = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.17, 14), mat(0xe0c890, { flatShading: true }));
    nonla.position.y = 0.32;
    head.add(nonla);
  }
  head.position.y = 1.54;
  g.add(head);

  // ---- Ba lô ----
  if (s.backpack) {
    const bp = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 10), mat(s.backpack));
    bp.scale.set(1.1, 1, 0.62);
    bp.position.set(0, 1.22, -0.24);
    g.add(bp);
    const pocket = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(s.backpack));
    pocket.scale.set(1, 1.1, 0.6);
    pocket.position.set(0, 1.12, -0.34);
    g.add(pocket);
  }

  // ---- Bóng đổ giả ----
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  g.add(blob);

  return {
    group: g, legL, legR, armL, armR, head, torso,
    walkT: 0,
    animate(dt, speedRatio, time) {
      if (speedRatio > 0.05) {
        this.walkT += dt * (6 + speedRatio * 7);
        const sw = Math.sin(this.walkT) * 0.62 * speedRatio;
        this.legL.rotation.x = sw;
        this.legR.rotation.x = -sw;
        this.armL.rotation.x = -sw * 0.75;
        this.armR.rotation.x = sw * 0.75;
        this.head.rotation.x = Math.sin(this.walkT * 2) * 0.03;
      } else {
        const k = 0.12;
        this.legL.rotation.x *= 1 - k;
        this.legR.rotation.x *= 1 - k;
        this.armL.rotation.x = Math.sin(time * 1.6) * 0.06;
        this.armR.rotation.x = -Math.sin(time * 1.6) * 0.06;
        this.head.rotation.x = Math.sin(time * 1.1) * 0.02;
      }
    },
    sit(on) {
      // Tư thế ngồi xe máy tự nhiên: đùi đưa ra TRƯỚC (chân đặt sàn xe), hơi dạng;
      // hai tay vươn ra trước-xuống nắm ghi-đông; thân hơi chồm.
      const a = on ? 1.0 : 0;
      this.legL.rotation.x = a; this.legR.rotation.x = a;
      this.legL.rotation.z = on ? 0.14 : 0; this.legR.rotation.z = on ? -0.14 : 0;
      this.armL.rotation.x = on ? 0.78 : 0; this.armR.rotation.x = on ? 0.78 : 0;
      this.armL.rotation.z = on ? 0.18 : 0.08; this.armR.rotation.z = on ? -0.18 : -0.08;
      this.torso.rotation.x = on ? 0.16 : 0;   // chồm nhẹ ra trước
      this.head.rotation.x = 0;
    },
  };
}
