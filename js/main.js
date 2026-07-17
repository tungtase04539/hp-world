import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, groundHeight, groundHeightNoDeck, landAt, WORLD_BOUNDS, LM, EXTRAS } from './world.js';
import { createTraffic } from './traffic.js';
import { makeHumanoid } from './character.js';
import { createVehicles } from './vehicles.js';
import { buildNPCs } from './npcs.js';
import { buildLandmarkSigns } from './landmarks.js';
import { createDayNight } from './daynight.js';
import { createPetals } from './petals.js';
import { initInput, input, consumeInteract, consumeJump } from './input.js';
import { t, tx, setLang } from './i18n.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import * as quests from './quests.js';
import { initMinimap, drawMinimap } from './minimap.js';
import { initMinigame, openMinigame, isMinigameOpen } from './minigame.js';
import { initAssets, updateAssets } from './assets.js';
import { initCinematic } from './cinematic.js';

// ============ Khởi tạo đồ họa ============
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: !isTouchDevice,              // mobile: tắt MSAA (VRAM + ổn định)
  powerPreference: 'high-performance',            // laptop 2 GPU: ép dGPU (trước hay rơi vào iGPU → lag)
});
// KHỞI ĐỘNG ở 1.5 (đỡ khựng lúc vào); máy mạnh được autoQuality NÂNG lên full DPR sau khi đo FPS tốt
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.2 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
// bóng đổ thời gian thực (tắt trên di động để giữ mượt)
renderer.shadowMap.enabled = !isTouchDevice;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// far 6000: sương mù kết thúc ~4200 nên mọi thứ xa hơn đều chìm trong sương — 16000 chỉ tốn cull/vẽ thừa
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 6000);

// Môi trường phản chiếu cho vật liệu PBR (mô hình GLB không bị xỉn/tối)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// Hậu kỳ bloom (tắt trên di động để giữ mượt)
const usePost = !isTouchDevice;
let composer = null, bloomPass = null;
const cine = initCinematic({ renderer, camera });   // chế độ đạo diễn (trailer/cutscene) — off mặc định
// GRADE: giảm bão hòa + ấm nhẹ (bớt "trời xanh gắt/washed HDR" — dấu hiệu game rõ nhất). ChatGPT + cell_render.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 0.88 }, tint: { value: new THREE.Color(1.0, 0.985, 0.945) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float saturation; uniform vec3 tint; varying vec2 vUv;' +
    'void main(){ vec4 c=texture2D(tDiffuse,vUv); float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722)); c.rgb=mix(vec3(l),c.rgb,saturation); c.rgb*=tint; gl_FragColor=c; }',
};
if (usePost) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.15, 0.5, 0.9);  // threshold 0.82->0.9: chỉ đèn/emissive bloom
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));                 // grade pass cuối
  composer.renderTarget1.samples = 4; composer.renderTarget2.samples = 4;   // MSAA 4x (EffectComposer bỏ antialias khi post)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ============ Thế giới ============
const world = buildWorld(scene);
// đóng băng ma trận local của thế giới tĩnh (NPC/xe/traffic tạo SAU nên không bị ảnh hưởng)
world.freezeStatic();
const dayNight = createDayNight(scene, world);
const petals = createPetals(scene);
const signs = buildLandmarkSigns(scene, world);
const { npcs, update: updateNPCs } = buildNPCs(scene, world);
const { vehicles, update: updateVehicle, spawn: spawnVehicle } = createVehicles(
  scene, groundHeight, groundHeightNoDeck, world.vehicleSpawns, world.resolveCollisions);
// người đi bộ thêm ở bãi biển Đồ Sơn & thị trấn Cát Bà
if (world.dosonBeach) {
  world.walkPaths.push([[world.dosonBeach[0] - 30, world.dosonBeach[1] - 20], [world.dosonBeach[0] + 10, world.dosonBeach[1] + 20]]);
}
world.walkPaths.push([
  [EXTRAS.catbaTown[0] - 40, EXTRAS.catbaTown[1] - 8],
  [EXTRAS.catbaTown[0] + 40, EXTRAS.catbaTown[1] - 2],
]);
const traffic = createTraffic(scene, world);

// bật đổ bóng cho mọi vật thể đặc (đất nhận bóng, nước & vật trong suốt bỏ qua)
// PERF (Lô B): mesh PHẲNG sát đất (đường/vỉa hè/vạch/ray/ballast/ribbon) KHÔNG cast (bóng phẳng-trên-phẳng
// vô hình) → giảm mạnh shadow pass; VẪN receiveShadow (nhận bóng nhà/cây). 0 đổi visual.
const _noCast = /^(roads|dashes|paths|rails|railballast|aerial_road_ribbon|caro_do_xam|lake_promenade)(_|$)|^sidewalk/;
if (renderer.shadowMap.enabled) {
  scene.traverse((o) => {
    if (!o.isMesh || o.name === 'ground' || o.name === 'water') return;
    if (o.material && o.material.transparent) return;
    o.castShadow = !_noCast.test(o.name);
    o.receiveShadow = true;
  });
}

// ============ Người chơi ============
const player = makeHumanoid({ hat: 'cap' });
// KHÔNG frustum-cull nhân vật: chi tiết tay/chân xoay theo animation làm bounding sphere
// lệch → bị cull nhầm khi camera bám sát lúc lái xe ("người lúc hiện lúc không")
player.group.traverse((o) => { o.frustumCulled = false; });
scene.add(player.group);
const SPAWN = { x: EXTRAS.square[0] - 5, z: EXTRAS.square[1] + 23 }; // mép quảng trường Nhà hát lớn
const pState = {
  pos: new THREE.Vector3(SPAWN.x, groundHeight(SPAWN.x, SPAWN.z), SPAWN.z),
  yaw: Math.PI, // nhìn về Nhà hát lớn (hướng bắc)
  vy: 0,
  onGround: true,
  mounted: null,
};
player.group.position.copy(pState.pos);
if (renderer.shadowMap.enabled) {
  player.group.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; } });
}

// ============ Camera bám theo nhân vật ============
const cam = { yaw: 0, pitch: 0.34, dist: 13 };
let dragging = false, lastPX = 0, lastPY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastPX = e.clientX; lastPY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cam.yaw -= (e.clientX - lastPX) * 0.0052;
  cam.pitch = Math.min(1.25, Math.max(-0.15, cam.pitch + (e.clientY - lastPY) * 0.004));
  lastPX = e.clientX; lastPY = e.clientY;
});
window.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (e) => {
  cam.dist = Math.min(36, Math.max(5, cam.dist + e.deltaY * 0.012));
}, { passive: true });

// vector tạm dùng lại mỗi khung hình (tránh cấp phát → GC giật)
const UP = new THREE.Vector3(0, 1, 0);
const _tgt = new THREE.Vector3(), _off = new THREE.Vector3(), _des = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _seat = new THREE.Vector3();
function updateCamera(dt) {
  if (pState.mounted) _tgt.copy(pState.mounted.pos).setY(pState.mounted.pos.y + 3);
  else _tgt.copy(pState.pos).setY(pState.pos.y + 2.2);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  _off.set(Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp).multiplyScalar(cam.dist);
  _des.copy(_tgt).add(_off);
  const gy = groundHeight(_des.x, _des.z);
  _des.y = Math.max(_des.y, gy + 1.2, 1.2);
  camera.position.lerp(_des, Math.min(1, dt * 7));
  camera.lookAt(_tgt);
}
camera.position.set(SPAWN.x, 10, SPAWN.z + 14);
updateCamera(1);

// ============ Di chuyển nhân vật ============
const WALK = 5, RUN = 11, GRAV = 26, JUMP = 7.5;  // 1:1 — m/s thật

function tryMove(nx, nz) {
  if (nx < WORLD_BOUNDS.minX + 30 || nx > WORLD_BOUNDS.maxX - 30
    || nz < WORLD_BOUNDS.minZ + 30 || nz > WORLD_BOUNDS.maxZ - 30) return false;
  return groundHeight(nx, nz) > 0.32;
}

function resolveColliders(p) {
  world.resolveCollisions(p, 0.45);
}

function updatePlayerOnFoot(dt, time) {
  const f = input.forward, r = input.right;
  const mag = Math.min(1, Math.hypot(f, r));
  const speed = (input.run ? RUN : WALK) * mag;

  if (mag > 0.05) {
    _fwd.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    _rgt.set(-_fwd.z, 0, _fwd.x);
    const dir = _fwd.multiplyScalar(f).add(_rgt.multiplyScalar(r)).normalize();
    const nx = pState.pos.x + dir.x * speed * dt;
    const nz = pState.pos.z + dir.z * speed * dt;
    if (tryMove(nx, nz)) { pState.pos.x = nx; pState.pos.z = nz; }
    else if (tryMove(nx, pState.pos.z)) pState.pos.x = nx;
    else if (tryMove(pState.pos.x, nz)) pState.pos.z = nz;
    const targetYaw = Math.atan2(dir.x, dir.z);
    let diff = targetYaw - pState.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    pState.yaw += diff * Math.min(1, dt * 10);
  }
  resolveColliders(pState.pos);

  const gy = groundHeight(pState.pos.x, pState.pos.z);
  if (consumeJump() && pState.onGround) { pState.vy = JUMP; pState.onGround = false; }
  pState.vy -= GRAV * dt;
  let y = pState.pos.y + pState.vy * dt;
  if (y <= gy) { y = gy; pState.vy = 0; pState.onGround = true; }
  pState.pos.y = y;

  player.group.position.copy(pState.pos);
  player.group.rotation.y = pState.yaw;
  player.group.rotation.x = 0;
  player.animate(dt, mag * (input.run ? 1 : 0.7), time);
}

// ============ Lên / xuống phương tiện ============
function mount(v) {
  pState.mounted = v;
  v.mounted = true;
  v.mesh.traverse((o) => { o.frustumCulled = false; });   // xe đang cưỡi không được cull (nhấp nháy khi lái)
  player.sit(true);
  audio.sfx('mount');
}
function dismount() {
  const v = pState.mounted;
  const angles = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
  for (const a of angles) {
    const nx = v.pos.x + Math.sin(v.heading + a) * 2.6;
    const nz = v.pos.z + Math.cos(v.heading + a) * 2.6;
    if (groundHeight(nx, nz) > 0.32) {
      pState.mounted = null;
      v.mounted = false;
      v.vel = 0;
      pState.pos.set(nx, groundHeight(nx, nz), nz);
      pState.vy = 0;
      player.sit(false);
      audio.sfx('mount');
      return true;
    }
  }
  ui.toast(tx({ vi: '⚓ Hãy cập bến hoặc vào gần bờ rồi mới rời thuyền!', en: '⚓ Reach a pier or shallow shore before leaving the boat!' }));
  return false;
}

// ============ Nút "Gọi xe máy" ============
let personalMoto = null;
function callMoto() {
  if (pState.mounted) { dismount(); return; }   // đang cưỡi → bấm lần nữa để xuống
  // đặt xe ngay trước mặt nhân vật, trên cạn
  let bx = pState.pos.x, bz = pState.pos.z;
  const fx = pState.pos.x + Math.sin(pState.yaw) * 3.2;
  const fz = pState.pos.z + Math.cos(pState.yaw) * 3.2;
  if (groundHeight(fx, fz) > 0.35) { bx = fx; bz = fz; }
  if (groundHeight(bx, bz) < 0.35) {   // đang trên nước/thuyền
    ui.toast(tx({ vi: '🏍️ Cần đứng trên bờ mới gọi được xe máy!', en: '🏍️ Stand on land to call a motorbike!' }));
    return;
  }
  if (!personalMoto) {
    personalMoto = spawnVehicle('motorbike', bx, bz, pState.yaw);
  } else {
    personalMoto.pos.set(bx, groundHeight(bx, bz), bz);
    personalMoto.mesh.position.copy(personalMoto.pos);
    personalMoto.heading = pState.yaw;
    personalMoto.vel = 0;
    personalMoto.mesh.rotation.set(0, pState.yaw, 0);
  }
  if (personalMoto) {
    mount(personalMoto);
    ui.toast(tx({ vi: '🏍️ Lên xe! WASD để chạy, bấm lại để xuống.', en: '🏍️ Hop on! WASD to ride, tap again to get off.' }));
  }
}
document.getElementById('btnMoto').addEventListener('click', (e) => { e.currentTarget.blur(); callMoto(); });

function updateMounted(dt, time) {
  const v = pState.mounted;
  player.sit(true);   // áp lại MỖI khung: mọi animate() lỡ chạy trước đó không làm "đứng trên yên" nữa
  updateVehicle(v, dt, input.forward, input.right, time);
  _seat.set(0, v.seatY, v.seatZ).applyAxisAngle(UP, v.heading);
  pState.pos.copy(v.pos).add(_seat);
  pState.pos.y -= 0.86;   // hạ nhân vật xuống: HÔNG ngồi trên yên (gốc nhân vật ở CHÂN, hip ~0.9 local)
  player.group.position.copy(pState.pos);
  pState.yaw = v.heading;
  player.group.rotation.y = v.heading;
  // KẸP độ nghiêng: trên dốc/taluy, pitch xe có thể rất lớn → nhân vật xoay quanh gốc CHÂN
  // thành "nằm bẹp ra đất cạnh xe" (user báo). Người thật chỉ ngả theo xe một phần.
  player.group.rotation.x = Math.max(-0.3, Math.min(0.3, v.mesh.rotation.x));
  player.group.rotation.z = Math.max(-0.45, Math.min(0.45, v.lean || 0));   // nghiêng theo xe khi rẽ
}

// ============ Tương tác ============
function nearestInteraction() {
  if (pState.mounted) {
    return { kind: 'dismount', label: `<b>E</b> — ${t('dismount')} ${t('v' + cap(pState.mounted.type))}` };
  }
  let best = null;
  for (const n of npcs) {
    const d = Math.hypot(pState.pos.x - n.data.x, pState.pos.z - n.data.z);
    if (d < 4 && (!best || d < best.d)) best = { kind: 'npc', npc: n, d, label: `<b>E</b> — ${t('talkTo')} ${tx(n.data.name).split('—')[0].trim()}` };
  }
  for (const s of signs) {
    const d = Math.hypot(pState.pos.x - s.lm.x, pState.pos.z - s.lm.z);
    if (d < 9 && (!best || d < best.d)) best = { kind: 'info', lm: s.lm, d, label: `<b>E</b> — ${t('read')}: ${tx(s.lm.name)}` };
  }
  for (const v of vehicles) {
    const d = Math.hypot(pState.pos.x - v.pos.x, pState.pos.z - v.pos.z);
    if (d < 5 && (!best || d < best.d)) best = { kind: 'mount', v, d, label: `<b>E</b> — ${t('mount')} ${t('v' + cap(v.type))}` };
  }
  return best;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function handleInteract() {
  if (isMinigameOpen()) return;
  if (ui.isDialogueOpen()) { ui.advanceDialogue(); return; }
  if (ui.isInfoOpen()) { document.getElementById('infoPanel').classList.add('hidden'); return; }
  const act = nearestInteraction();
  if (!act) return;
  if (act.kind === 'dismount') dismount();
  else if (act.kind === 'mount') mount(act.v);
  else if (act.kind === 'info') { ui.showInfo(act.lm); quests.discoverLandmark(act.lm); }
  else if (act.kind === 'npc') {
    ui.startDialogue(act.npc, (npc) => {
      if (npc.data.action === 'minigame' && !quests.quests.food) openMinigame(() => {});
    });
  }
}

// ============ Vòng lặp chính ============
const clock = new THREE.Clock();
let time = 0, clockUITimer = 0, minimapTimer = 1, interactTimer = 1, shadowTimer = 0;
// bóng đổ render theo nhịp riêng (xem cuối animate) — tắt autoUpdate mỗi khung
if (renderer.shadowMap.enabled) renderer.shadowMap.autoUpdate = false;
let started = false;
// AUTO-QUALITY ĐA-BƯỚC + LIÊN TỤC: máy MẠNH được NÂNG lên full DPR sau khi chứng minh FPS;
// máy yếu hạ DẦN theo tải bền. 3 cửa sổ đầu đo NHANH (2s) để phản ứng sớm ngay sau "Bắt đầu".
// FIX QUAN TRỌNG: đổi pixelRatio phải đổi CẢ composer (EffectComposer giữ _pixelRatio riêng từ lúc
// khởi tạo — trước đây chỉ setPixelRatio(renderer) nên bloom/MSAA vẫn render đủ phân giải → hạ bước vô dụng).
let fpsFrames = 0, fpsStart = 0, _qStep = 0, _qChecks = 0;
const _DPR = Math.min(window.devicePixelRatio || 1, 2);
function setPR(v) {
  renderer.setPixelRatio(v);
  if (composer) { composer.setPixelRatio(v); composer.setSize(window.innerWidth, window.innerHeight); }
}
function autoQuality() {
  if (!fpsStart) { fpsStart = time; fpsFrames = 0; }
  fpsFrames++;
  const win = _qChecks < 3 ? 2 : 4;
  if (time - fpsStart > win) {
    const fps = fpsFrames / (time - fpsStart);
    fpsStart = time; fpsFrames = 0; _qChecks++;
    if (fps < 24 && _qStep < 2) {
      _qStep++;
      if (_qStep === 1) { if (bloomPass) bloomPass.enabled = false; setPR(Math.min(_DPR, 1.2)); }
      else { dayNight.sun.castShadow = false; renderer.shadowMap.autoUpdate = false; setPR(1); }
    } else if (fps >= 50 && _qStep === 0 && renderer.getPixelRatio() < _DPR) {
      setPR(_DPR);   // máy mạnh: lên full độ phân giải (không mất chất lượng lâu dài)
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  if (started) {
    const modal = ui.isAnyModalOpen();

    if (consumeInteract()) handleInteract();

    if (cine.active) {
      // CHẾ ĐỘ ĐẠO DIỄN: không điều khiển nhân vật, camera do cinematic lo
    } else if (!modal) {
      if (pState.mounted) updateMounted(dt, time);
      else updatePlayerOnFoot(dt, time);
    } else if (!pState.mounted) {
      player.animate(dt, 0, time);   // mở modal khi đang cưỡi → GIỮ tư thế ngồi (không animate lại)
    }

    if (!modal && !cine.active) {
      // 10Hz là đủ cho prompt tương tác (trước: quét mọi ứng viên + dựng chuỗi label 60 lần/s)
      interactTimer += dt;
      if (interactTimer > 0.1) {
        interactTimer = 0;
        const act = nearestInteraction();
        ui.setPrompt(act ? (input.isTouch ? act.label.replace('<b>E</b>', '✦') : act.label) : null);
      }
    } else {
      ui.setPrompt(null);
    }

    // nhặt hoa phượng
    for (const p of world.flowerPickups) {
      if (!p.visible) continue;
      if (Math.hypot(pState.pos.x - p.position.x, pState.pos.z - p.position.z) < 2.4
          && Math.abs(pState.pos.y - p.position.y) < 3.5) {
        p.visible = false;
        quests.pickFlower();
      }
    }
    // khám phá địa danh khi tới gần
    for (const s of signs) {
      if (Math.hypot(pState.pos.x - s.lm.x, pState.pos.z - s.lm.z) < 18) {
        quests.discoverLandmark(s.lm);
      }
    }

    updateNPCs(dt, time, pState.pos);
    for (const fn of world.updaters) fn(dt, time);
    for (const v of vehicles) {
      if (!v.mounted && !v.land) updateVehicle(v, dt, 0, 0, time);
    }

    traffic.update(dt, time, pState.pos);
    if (window.__hp && window.__hp._aerialCam) { /* chế độ vệ tinh: giữ camera top-down, không cập nhật */ }
    else if (cine.active) cine.update(dt); else updateCamera(dt);   // đạo diễn lo camera khi bật
    const sky = dayNight.update(dt, pState.pos);
    // đêm bloom mạnh hơn cho đèn phố & cửa sổ rực rỡ
    if (bloomPass) bloomPass.strength = 0.025 + sky.night * 0.55;   // ban ngày gần tắt bloom

    // cánh phượng quanh dải trung tâm (tâm ~ giữa hồ Tam Bạc và Nhà hát lớn)
    const dCity = Math.hypot(
      pState.pos.x - (LM.lake[0] + LM.opera[0]) / 2,
      pState.pos.z - (LM.lake[1] + LM.opera[1]) / 2);
    const petalStrength = 1 - Math.min(1, Math.max(0, (dCity - 170) / 150));
    petals.update(dt, time, pState.pos, petalStrength, groundHeight);

    // âm thanh môi trường: sóng biển gần mép nước (theo lưới đất/biển thật), còi tàu gần cảng
    const onWater = pState.mounted && !pState.mounted.land;
    const gy = groundHeightNoDeck(pState.pos.x, pState.pos.z);
    const lv = landAt(pState.pos.x, pState.pos.z);
    const seaFactor = onWater || gy < 0.5 ? 1 : 1 - Math.min(1, Math.max(0, (lv - 0.72) / 0.26));
    audio.updateAudio(dt, { seaFactor });
    const dPort = Math.hypot(pState.pos.x - world.portAnchor[0], pState.pos.z - world.portAnchor[1]);
    audio.tryHorn(time, 1 - Math.min(1, Math.max(0, (dPort - 70) / 180)));

    autoQuality();
    updateAssets(dt, pState.pos); // streaming mô hình xa theo khoảng cách
    clockUITimer += dt;
    if (clockUITimer > 0.5) { clockUITimer = 0; ui.setClock(dayNight.clockString); }

    // minimap canvas 2D: 10Hz là đủ mượt (trước vẽ lại 60Hz)
    minimapTimer += dt;
    if (minimapTimer > 0.1) {
      minimapTimer = 0;
      drawMinimap(pState.pos.x, pState.pos.z, pState.mounted ? pState.mounted.heading : pState.yaw);
    }

    // shadow map: mặt trời trôi rất chậm — render bóng 8Hz thay vì mỗi khung
    // (PCFSoft 2048² từng tốn ~745 draw call + ~2M tam giác PHỤ mỗi khung)
    if (renderer.shadowMap.enabled && dayNight.sun.castShadow) {
      shadowTimer += dt;
      if (shadowTimer > 0.12) { shadowTimer = 0; renderer.shadowMap.needsUpdate = true; }
    }
  }

  if (window.__hp && window.__hp._aerialCam) renderer.render(scene, window.__hp._aerialCam);
  else if (composer) composer.render();
  else renderer.render(scene, camera);
}

// Service Worker: cache file nặng (GLB) → lần sau vào hiện đủ NGAY, không tải lại
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ============ Bắt đầu ============
initInput();
ui.initUI();
// preload cụm trung tâm ngay ở màn chờ + hiển thị tiến trình % dưới nút Bắt đầu
(() => {
  const btn = document.getElementById('startBtn');
  const bar = document.createElement('div');
  bar.id = 'preloadBar';
  bar.innerHTML = '<div id="preloadFill"></div><span id="preloadTxt"></span>';
  btn.parentNode.insertBefore(bar, btn.nextSibling);
  const fill = bar.querySelector('#preloadFill');
  const txt = bar.querySelector('#preloadTxt');
  initAssets(ui.toast, (done, total) => {
    if (!total) return;
    const pct = Math.round((done / total) * 100);
    fill.style.width = pct + '%';
    txt.textContent = pct < 100 ? `Đang tải dải trung tâm… ${pct}%` : '✓ Sẵn sàng — đã tải đủ dải trung tâm';
    bar.classList.toggle('done', pct >= 100);
  });
})();
initMinigame(audio);
quests.bindQuestUI(ui, audio);
initMinimap();
setLang('vi');

// Chế độ đạo diễn (trailer/giới thiệu/cutscene) — dùng qua console: __cine.free(), __cine.demo(), __cine.recordDemo()...
window.__cine = cine;

// Hook gỡ lỗi / chụp ảnh tour (không ảnh hưởng gameplay)
window.__hp = {
  renderer, scene,   // chẩn đoán hiệu năng (draw calls / triangles)
  cine,
  vehicles, mount, player,   // chẩn đoán/thử nghiệm cưỡi xe
  // Chẩn đoán: mọi thực thể tương tác có đứng đúng chỗ & tiếp cận được không
  diag() {
    const items = [];
    for (const s of signs) items.push({ kind: 'landmark', id: s.lm.id, x: s.lm.x, z: s.lm.z, reach: 9 });
    for (const n of npcs) items.push({ kind: 'npc', id: n.data.id, x: n.data.x, z: n.data.z, reach: 4 });
    vehicles.forEach((v, i) => items.push({ kind: 'vehicle', id: v.type + i, x: v.pos.x, z: v.pos.z, reach: 5, water: !v.land }));
    world.flowerPickups.forEach((p, i) => items.push({ kind: 'flower', id: 'f' + i, x: p.position.x, z: p.position.z, reach: 2.4 }));
    const out = [];
    for (const it of items) {
      const h = groundHeightNoDeck(it.x, it.z);
      const hd = groundHeight(it.x, it.z);
      let reachable = false;
      for (let a = 0; a < 16 && !reachable; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (const rr of [it.reach * 0.5, it.reach * 0.85, 4, 6, 8].filter((r) => r <= Math.max(8, it.reach))) {
          const p = { x: it.x + Math.cos(ang) * rr, z: it.z + Math.sin(ang) * rr };
          world.resolveCollisions(p, 0.45);
          const ph = groundHeight(p.x, p.z);
          if (Math.hypot(p.x - it.x, p.z - it.z) <= it.reach && ph > 1.2 && ph < 12) { reachable = true; break; }
        }
      }
      const problems = [];
      if (it.water) {
        if (h > -0.6) problems.push(`thuyền mắc cạn h=${h.toFixed(1)}`);
      } else if (hd < 1.2 || hd > 14) problems.push(`cao độ lạ h=${hd.toFixed(1)}`);
      if (!reachable && !it.water) problems.push('KHÔNG TIẾP CẬN ĐƯỢC');
      if (problems.length) out.push(`${it.kind}/${it.id} (${it.x | 0},${it.z | 0}): ${problems.join(', ')}`);
    }
    return out;
  },
  teleport(x, z, camYaw = 0, pitch = 0.3, dist = 14) {
    if (pState.mounted) { pState.mounted.mounted = false; pState.mounted = null; player.sit(false); }
    x = Math.max(WORLD_BOUNDS.minX + 31, Math.min(WORLD_BOUNDS.maxX - 31, x));   // clamp vào biên đi-được (tránh kẹt ngoài map — tryMove chặn mọi bước khi ở ngoài)
    z = Math.max(WORLD_BOUNDS.minZ + 31, Math.min(WORLD_BOUNDS.maxZ - 31, z));
    pState.pos.set(x, Math.max(groundHeight(x, z), 0), z);
    pState.vy = 0;
    cam.yaw = camYaw; cam.pitch = pitch; cam.dist = dist;
    const cp = Math.cos(pitch);
    camera.position.set(
      x + Math.sin(camYaw) * cp * dist,
      pState.pos.y + Math.sin(pitch) * dist + 2,
      z + Math.cos(camYaw) * cp * dist
    );
  },
  setTime(v) { dayNight.t = v; },
  _aerialCam: null,
  // Chụp "VỆ TINH": camera TRỰC GIAO nhìn thẳng xuống tâm (cx,cz), phủ ±half mét,
  // Bắc (−z) hướng LÊN, Đông (+x) sang PHẢI — đúng chiều bản đồ. Để so cấu trúc đường/vị trí nhà.
  aerial(cx, cz, half = 400, alt = 1200) {
    const el = renderer.domElement;
    const asp = (el.width / el.height) || 1;   // khớp tỉ lệ viewport (half = NỬA chiều DỌC)
    const c = new THREE.OrthographicCamera(-half * asp, half * asp, half, -half, 1, alt + 500);
    c.position.set(cx, alt, cz);
    c.up.set(0, 0, -1);
    c.lookAt(cx, 0, cz);
    c.layers.enable(2);   // AERIAL-ONLY overlay (dải đường/nước rộng): layer 2 CHỈ hiện top-down, pano không thấy
    c.updateProjectionMatrix();
    this._aerialCam = c;
    return { cx, cz, half };
  },
  aerialOff() { this._aerialCam = null; },
  // liệt kê cụm mesh GLB (material PBR của Meshy) + vị trí thế giới — công cụ audit
  glbs() {
    const out = new Map();
    scene.traverse((o) => {
      if (o.isMesh && o.material && o.material.type === 'MeshStandardMaterial') {
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        const k = `${Math.round(p.x / 10) * 10},${Math.round(p.z / 10) * 10}`;
        out.set(k, (out.get(k) || 0) + 1);
      }
    });
    return [...out.entries()].map(([k, n]) => k + ' x' + n);
  },
  gh(x, z) { return groundHeightNoDeck(x, z); },
  // bắn tia từ camera qua điểm màn hình (NDC) -> vật thể đầu tiên chạm
  pick(nx, ny) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = rc.intersectObjects(scene.children, true);
    if (!hits.length) return null;
    const h = hits[0];
    return {
      name: h.object.name || h.object.type,
      mat: h.object.material?.type,
      dist: Math.round(h.distance),
      point: [Math.round(h.point.x), Math.round(h.point.y), Math.round(h.point.z)],
    };
  },
};

document.getElementById('startBtn').addEventListener('click', () => {
  audio.initAudio();
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  started = true;
  setTimeout(() => {
    const guide = npcs.find((n) => n.data.id === 'guide');
    if (guide) ui.startDialogue(guide);
  }, 700);
});

// ẤM MÁY sau màn chờ: compile TOÀN BỘ shader của scene (song song, KHR_parallel_shader_compile)
// + render bóng 1 lần. Trước đây Three chỉ compile vật thể LỌT KHUNG NHÌN ở frame đầu → bấm
// "Bắt đầu" camera quét ra toàn cảnh = bão compile shader → khựng vài giây.
if (renderer.compileAsync) {
  renderer.compileAsync(scene, camera)
    .then(() => { if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true; })
    .catch(() => {});
}

animate();
