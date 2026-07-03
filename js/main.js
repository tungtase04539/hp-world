import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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

// ============ Khởi tạo đồ họa ============
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.26;
// bóng đổ thời gian thực (tắt trên di động để giữ mượt)
renderer.shadowMap.enabled = !isTouchDevice;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1800);

// Môi trường phản chiếu cho vật liệu PBR (mô hình GLB không bị xỉn/tối)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// Hậu kỳ bloom (tắt trên di động để giữ mượt)
const usePost = !isTouchDevice;
let composer = null, bloomPass = null;
if (usePost) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 0.82);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ============ Thế giới ============
const world = buildWorld(scene);
const dayNight = createDayNight(scene, world);
const petals = createPetals(scene);
const signs = buildLandmarkSigns(scene, world);
const { npcs, update: updateNPCs } = buildNPCs(scene, world);
const { vehicles, update: updateVehicle } = createVehicles(
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
if (renderer.shadowMap.enabled) {
  scene.traverse((o) => {
    if (!o.isMesh || o.name === 'ground' || o.name === 'water') return;
    if (o.material && o.material.transparent) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

// ============ Người chơi ============
const player = makeHumanoid({ hat: 'cap' });
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

function updateCamera(dt) {
  const target = pState.mounted
    ? pState.mounted.pos.clone().setY(pState.mounted.pos.y + 3)
    : pState.pos.clone().setY(pState.pos.y + 2.2);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const off = new THREE.Vector3(Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp)
    .multiplyScalar(cam.dist);
  const desired = target.clone().add(off);
  const gy = groundHeight(desired.x, desired.z);
  desired.y = Math.max(desired.y, gy + 1.2, 1.2);
  camera.position.lerp(desired, Math.min(1, dt * 7));
  camera.lookAt(target);
}
camera.position.set(SPAWN.x, 10, SPAWN.z + 14);
updateCamera(1);

// ============ Di chuyển nhân vật ============
const WALK = 7, RUN = 13, GRAV = 26, JUMP = 9;

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
    const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize();
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

function updateMounted(dt, time) {
  const v = pState.mounted;
  updateVehicle(v, dt, input.forward, input.right, time);
  const seat = new THREE.Vector3(0, v.seatY, v.seatZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.heading);
  pState.pos.copy(v.pos).add(seat);
  player.group.position.copy(pState.pos);
  pState.yaw = v.heading;
  player.group.rotation.y = v.heading;
  player.group.rotation.x = v.mesh.rotation.x;
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
let time = 0, clockUITimer = 0;
let started = false;
// tự hạ chất lượng trên máy yếu: đo FPS 5 giây đầu, dưới 26 thì tắt bóng đổ + bloom
let fpsFrames = 0, fpsStart = 0, qualityChecked = false;
function autoQuality() {
  if (qualityChecked) return;
  if (!fpsStart) { fpsStart = time; fpsFrames = 0; }
  fpsFrames++;
  if (time - fpsStart > 5) {
    qualityChecked = true;
    const fps = fpsFrames / (time - fpsStart);
    if (fps < 26) {
      dayNight.sun.castShadow = false;
      renderer.shadowMap.autoUpdate = false;
      if (bloomPass) bloomPass.enabled = false;
      renderer.setPixelRatio(1);
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

    if (!modal) {
      if (pState.mounted) updateMounted(dt, time);
      else updatePlayerOnFoot(dt, time);
    } else {
      player.animate(dt, 0, time);
    }

    if (!modal) {
      const act = nearestInteraction();
      ui.setPrompt(act ? (input.isTouch ? act.label.replace('<b>E</b>', '✦') : act.label) : null);
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
    updateCamera(dt);
    const sky = dayNight.update(dt, pState.pos);
    // đêm bloom mạnh hơn cho đèn phố & cửa sổ rực rỡ
    if (bloomPass) bloomPass.strength = 0.1 + sky.night * 0.6;

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

    drawMinimap(pState.pos.x, pState.pos.z, pState.mounted ? pState.mounted.heading : pState.yaw);
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// ============ Bắt đầu ============
initInput();
ui.initUI();
initAssets(ui.toast); // preload các mô hình GLB ngay từ màn hình chờ
initMinigame(audio);
quests.bindQuestUI(ui, audio);
initMinimap();
setLang('vi');

// Hook gỡ lỗi / chụp ảnh tour (không ảnh hưởng gameplay)
window.__hp = {
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

animate();
