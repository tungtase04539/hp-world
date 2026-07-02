import * as THREE from 'three';

// Chu kỳ ngày đêm — một ngày = 300 giây, bắt đầu lúc ~9h sáng
export const DAY_LENGTH = 300;

const C = (hex) => new THREE.Color(hex);
// Keyframe theo t (0 = nửa đêm, 0.5 = giữa trưa)
const KEYS = [
  { t: 0.0,  sky: C(0x0a1428), fog: C(0x0c1830), sun: C(0x223355), sunI: 0.05, hemiI: 0.22, night: 1 },
  { t: 0.2,  sky: C(0x0e1c34), fog: C(0x101f38), sun: C(0x334466), sunI: 0.08, hemiI: 0.26, night: 1 },
  { t: 0.26, sky: C(0xe8825a), fog: C(0xeda276), sun: C(0xff9a55), sunI: 0.55, hemiI: 0.5,  night: 0.35 },
  { t: 0.33, sky: C(0x8fd0ee), fog: C(0xbfe2f2), sun: C(0xfff2d8), sunI: 1.0,  hemiI: 0.85, night: 0 },
  { t: 0.5,  sky: C(0x6fbdf0), fog: C(0xcfe8f8), sun: C(0xffffff), sunI: 1.15, hemiI: 0.95, night: 0 },
  { t: 0.68, sky: C(0x8fc8ea), fog: C(0xc8e0f0), sun: C(0xfff0c8), sunI: 0.95, hemiI: 0.85, night: 0 },
  { t: 0.75, sky: C(0xf0885a), fog: C(0xf2a878), sun: C(0xff7a3a), sunI: 0.5,  hemiI: 0.5,  night: 0.3 },
  { t: 0.81, sky: C(0x2a2248), fog: C(0x342a52), sun: C(0x554466), sunI: 0.12, hemiI: 0.3,  night: 0.9 },
  { t: 1.0,  sky: C(0x0a1428), fog: C(0x0c1830), sun: C(0x223355), sunI: 0.05, hemiI: 0.22, night: 1 },
];

export function createDayNight(scene, world) {
  const hemi = new THREE.HemisphereLight(0xbfe8ff, 0x8a9a6a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(100, 150, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const moonGlow = new THREE.DirectionalLight(0x8fa8d8, 0);
  moonGlow.position.set(-80, 120, -60);
  scene.add(moonGlow);

  scene.fog = new THREE.Fog(0xcfe8f8, 150, 620);
  scene.background = new THREE.Color(0x6fbdf0);

  // Vòm trời gradient (đẹp hơn màu phẳng)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f8fd8) },
      horizonColor: { value: new THREE.Color(0xcfe8f8) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 horizonColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
        h = pow(h, 0.72);
        gl_FragColor = vec4(mix(horizonColor, topColor, h), 1.0);
      }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(760, 24, 12), skyMat);
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  // Mặt trời / mặt trăng nhìn thấy được
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(14, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe9a0, fog: false })
  );
  scene.add(sunBall);
  const moonBall = new THREE.Mesh(
    new THREE.SphereGeometry(9, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xe8eef8, fog: false })
  );
  scene.add(moonBall);

  // Sao đêm
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.08;
    const r = 700;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, transparent: true, opacity: 0, fog: false, sizeAttenuation: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  let dayT = 0.3; // ~9h sáng

  function sample(t) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const k = (t - a.t) / Math.max(1e-5, b.t - a.t);
    return {
      sky: a.sky.clone().lerp(b.sky, k),
      fog: a.fog.clone().lerp(b.fog, k),
      sun: a.sun.clone().lerp(b.sun, k),
      sunI: a.sunI + (b.sunI - a.sunI) * k,
      hemiI: a.hemiI + (b.hemiI - a.hemiI) * k,
      night: a.night + (b.night - a.night) * k,
    };
  }

  return {
    get t() { return dayT; },
    set t(v) { dayT = v; },
    get clockString() {
      const hours = (dayT * 24) % 24;
      const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
      const icon = dayT > 0.28 && dayT < 0.78 ? '☀️' : '🌙';
      return `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
    update(dt, playerPos) {
      dayT = (dayT + dt / DAY_LENGTH) % 1;
      const s = sample(dayT);
      scene.background.copy(s.sky);
      scene.fog.color.copy(s.fog);
      skyMat.uniforms.topColor.value.copy(s.sky);
      skyMat.uniforms.horizonColor.value.copy(s.fog);
      skyDome.position.copy(playerPos);
      hemi.intensity = s.hemiI;
      sun.color.copy(s.sun);
      sun.intensity = s.sunI;
      moonGlow.intensity = s.night * 0.22;

      // quỹ đạo mặt trời quanh người chơi
      const ang = (dayT - 0.25) * Math.PI * 2;
      const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
      sun.position.copy(playerPos).addScaledVector(sunDir, 250);
      sun.target.position.copy(playerPos);
      sunBall.position.copy(playerPos).addScaledVector(sunDir, 640);
      sunBall.visible = sunDir.y > -0.06;
      moonBall.position.copy(playerPos).addScaledVector(sunDir.clone().negate(), 640);
      moonBall.visible = sunDir.y < 0.06;
      starMat.opacity = s.night * 0.9;
      stars.position.copy(playerPos);

      // đèn đường, cửa sổ, hải đăng sáng về đêm
      const glow = s.night;
      const { sharedMats } = world;
      if (sharedMats) {
        sharedMats.lampGlow.emissiveIntensity = glow * 1.6;
        sharedMats.window.emissiveIntensity = glow * 1.1;
      }
      if (world.lighthouseLamp) {
        world.lighthouseLamp.emissiveIntensity = 0.2 + glow * (1.2 + Math.sin(performance.now() * 0.004) * 0.8);
      }
      // nước tối dần về đêm
      if (world.waterMat) {
        world.waterMat.color.setHex(0x2f8fbe).lerp(new THREE.Color(0x0d2438), glow);
      }
      return s;
    },
  };
}
