import * as THREE from 'three';

// Chu kỳ ngày đêm — một ngày = 300 giây, bắt đầu lúc ~9h sáng
export const DAY_LENGTH = 300;

const C = (hex) => new THREE.Color(hex);
// Keyframe theo t (0 = nửa đêm, 0.5 = giữa trưa)
const KEYS = [
  { t: 0.0,  sky: C(0x131d3a), fog: C(0x15203e), sun: C(0x2a3d66), sunI: 0.07, hemiI: 0.34, night: 1 },
  { t: 0.2,  sky: C(0x17233f), fog: C(0x1a2644), sun: C(0x3a4d77), sunI: 0.1,  hemiI: 0.38, night: 1 },
  { t: 0.26, sky: C(0xf08a5c), fog: C(0xf7b184), sun: C(0xffa055), sunI: 0.65, hemiI: 0.55, night: 0.35 },
  { t: 0.33, sky: C(0x77c4f2), fog: C(0xd2ecfa), sun: C(0xfff4da), sunI: 1.15, hemiI: 0.9,  night: 0 },
  { t: 0.5,  sky: C(0x4da3f0), fog: C(0xd8eefc), sun: C(0xfff6e6), sunI: 1.32, hemiI: 1.0,  night: 0 },
  { t: 0.68, sky: C(0x74bcec), fog: C(0xd2e6f4), sun: C(0xffefc4), sunI: 1.05, hemiI: 0.9,  night: 0 },
  { t: 0.75, sky: C(0xf58a52), fog: C(0xfab183), sun: C(0xff7a3a), sunI: 0.6,  hemiI: 0.55, night: 0.3 },
  { t: 0.81, sky: C(0x33295a), fog: C(0x403361), sun: C(0x5d4a77), sunI: 0.15, hemiI: 0.4,  night: 0.9 },
  { t: 1.0,  sky: C(0x131d3a), fog: C(0x15203e), sun: C(0x2a3d66), sunI: 0.07, hemiI: 0.34, night: 1 },
];

export function createDayNight(scene, world) {
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xa8a078, 0.95);
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

  scene.fog = new THREE.Fog(0xd8eefc, 600, 4200);
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
  const _sunDir = new THREE.Vector3();

  // buffer tái dùng — sample() chạy mỗi khung, clone Color 3 lần/khung là rác GC vô ích
  const _smp = { sky: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), sunI: 0, hemiI: 0, night: 0 };
  function sample(t) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const k = (t - a.t) / Math.max(1e-5, b.t - a.t);
    _smp.sky.copy(a.sky).lerp(b.sky, k);
    _smp.fog.copy(a.fog).lerp(b.fog, k);
    _smp.sun.copy(a.sun).lerp(b.sun, k);
    _smp.sunI = a.sunI + (b.sunI - a.sunI) * k;
    _smp.hemiI = a.hemiI + (b.hemiI - a.hemiI) * k;
    _smp.night = a.night + (b.night - a.night) * k;
    return _smp;
  }

  return {
    sun,
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

      // quỹ đạo mặt trời quanh người chơi (vector tái dùng — không cấp phát mỗi khung)
      const ang = (dayT - 0.25) * Math.PI * 2;
      _sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
      sun.position.copy(playerPos).addScaledVector(_sunDir, 250);
      sun.target.position.copy(playerPos);
      sunBall.position.copy(playerPos).addScaledVector(_sunDir, 640);
      sunBall.visible = _sunDir.y > -0.06;
      moonBall.position.copy(playerPos).addScaledVector(_sunDir, -640);
      moonBall.visible = _sunDir.y < 0.06;
      starMat.opacity = s.night * 0.9;
      stars.position.copy(playerPos);

      // đèn đường, cửa sổ, hải đăng sáng về đêm
      const glow = s.night;
      const { sharedMats } = world;
      if (sharedMats) {
        sharedMats.lampGlow.emissiveIntensity = glow * 1.6;
        sharedMats.window.emissiveIntensity = glow * 1.1;
      }
      if (world.facadeMats) {
        for (const m of world.facadeMats) m.emissiveIntensity = glow * 0.95;
      }
      if (world.lighthouseLamp) {
        world.lighthouseLamp.emissiveIntensity = 0.2 + glow * (1.2 + Math.sin(performance.now() * 0.004) * 0.8);
      }
      if (world.lighthouseBeam) {
        world.lighthouseBeam.mat.opacity = glow * 0.28;
      }
      // nước tối dần về đêm — ĐỤC XÁM-LỤC phù sa (Tam Bạc/Cấm thật), KHÔNG cyan.
      // (BÀI HỌC: vòng này GHI ĐÈ waterMat.color mỗi khung → mọi chỉnh màu ở world.js vô hiệu;
      //  đây là nguồn thật của "nước cyan" trên vệ tinh. Đổi ngày=lục-xám đục, đêm=tối đục.)
      if (world.waterMat) {
        world.waterMat.color.setHex(0x4d616c).lerp(new THREE.Color(0x101c24), glow);
      }
      return s;
    },
  };
}
