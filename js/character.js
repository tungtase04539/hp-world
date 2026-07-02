import * as THREE from 'three';

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

// Nhân vật kiểu low-poly: chân/tay xoay quanh khớp trên
function limb(w, h, d, color) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = -h / 2;
  g.add(m);
  return g;
}

// scheme: màu sắc từng bộ phận
export function makeHumanoid(scheme = {}) {
  const s = {
    shirt: 0xff7a4d, shorts: 0x2e5a8f, skin: 0xf0c090,
    hair: 0x3a2a1a, cap: 0xe8402a, backpack: 0xf2c230,
    hat: null, // 'nonla' | 'cap' | null
    ...scheme,
  };
  const g = new THREE.Group();

  const legL = limb(0.22, 0.8, 0.26, s.shorts); legL.position.set(-0.16, 0.8, 0);
  const legR = limb(0.22, 0.8, 0.26, s.shorts); legR.position.set(0.16, 0.8, 0);
  g.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.34), mat(s.shirt));
  torso.position.y = 1.11;
  g.add(torso);

  const armL = limb(0.16, 0.62, 0.2, s.shirt); armL.position.set(-0.4, 1.42, 0);
  const armR = limb(0.16, 0.62, 0.2, s.shirt); armR.position.set(0.4, 1.42, 0);
  g.add(armL, armR);

  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), mat(s.skin));
  face.position.y = 0.21;
  head.add(face);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.42), mat(s.hair));
  hair.position.set(0, 0.4, -0.02);
  head.add(hair);
  if (s.hat === 'cap') {
    const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.44), mat(s.cap));
    capTop.position.y = 0.48;
    head.add(capTop);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.26), mat(s.cap));
    brim.position.set(0, 0.44, 0.3);
    head.add(brim);
  } else if (s.hat === 'nonla') {
    const nonla = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.3, 10), mat(0xe0c890));
    nonla.position.y = 0.52;
    head.add(nonla);
  }
  head.position.y = 1.44;
  g.add(head);

  if (s.backpack) {
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.2), mat(s.backpack));
    bp.position.set(0, 1.12, -0.3);
    g.add(bp);
  }

  // bóng đổ giả
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  g.add(blob);

  return {
    group: g, legL, legR, armL, armR, head,
    walkT: 0,
    // anim: 0 đứng yên, tăng dần theo tốc độ
    animate(dt, speedRatio, time) {
      if (speedRatio > 0.05) {
        this.walkT += dt * (6 + speedRatio * 7);
        const sw = Math.sin(this.walkT) * 0.65 * speedRatio;
        this.legL.rotation.x = sw;
        this.legR.rotation.x = -sw;
        this.armL.rotation.x = -sw * 0.8;
        this.armR.rotation.x = sw * 0.8;
      } else {
        // đứng thở nhẹ
        const k = 0.12;
        this.legL.rotation.x *= 1 - k; this.legR.rotation.x *= 1 - k;
        this.armL.rotation.x = Math.sin(time * 1.6) * 0.05;
        this.armR.rotation.x = -Math.sin(time * 1.6) * 0.05;
      }
    },
    sit(on) {
      const a = on ? 1.15 : 0;
      this.legL.rotation.x = a; this.legR.rotation.x = a;
      this.armL.rotation.x = on ? 0.5 : 0; this.armR.rotation.x = on ? 0.5 : 0;
    },
  };
}
