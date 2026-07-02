import * as THREE from 'three';
import { buildWorld, groundHeight, groundHeightNoDeck, coastX, WORLD_BOUNDS } from './world.js';
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

// ============ Khởi tạo đồ họa ============
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
// bóng đổ thời gian thực (tắt trên di động để giữ mượt)
renderer.shadowMap.enabled = !isTouchDevice;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1800);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============ Thế giới ============
const world = buildWorld(scene);
const dayNight = createDayNight(scene, world);
const petals = createPetals(scene);
const signs = buildLandmarkSigns(scene, world);
const { npcs, update: updateNPCs } = buildNPCs(scene, world);
const { vehicles, update: updateVehicle } = createVehicles(scene, groundHeight, groundHeightNoDeck);

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
const SPAWN = { x: 14, z: 34 };
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
  for (const c of world.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + 0.45;
    if (d < min && d > 0.001) {
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
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

    updateCamera(dt);
    dayNight.update(dt, pState.pos);

    // cánh phượng quanh dải trung tâm (tâm ~ hồ Tam Bạc - Nhà hát lớn)
    const dCity = Math.hypot(pState.pos.x + 70, pState.pos.z - 10);
    const petalStrength = 1 - Math.min(1, Math.max(0, (dCity - 130) / 130));
    petals.update(dt, time, pState.pos, petalStrength, groundHeight);

    // âm thanh môi trường: sóng biển gần mép nước, còi tàu gần cảng
    const shoreDist = Math.abs(coastX(pState.pos.z) - pState.pos.x);
    const onWater = pState.mounted && !pState.mounted.land;
    const gy = groundHeightNoDeck(pState.pos.x, pState.pos.z);
    const seaFactor = onWater || gy < 0.5 ? 1 : 1 - Math.min(1, Math.max(0, (shoreDist - 40) / 120));
    audio.updateAudio(dt, { seaFactor });
    const dPort = Math.hypot(pState.pos.x - 95, pState.pos.z + 140);
    audio.tryHorn(time, 1 - Math.min(1, Math.max(0, (dPort - 60) / 160)));

    clockUITimer += dt;
    if (clockUITimer > 0.5) { clockUITimer = 0; ui.setClock(dayNight.clockString); }

    drawMinimap(pState.pos.x, pState.pos.z, pState.mounted ? pState.mounted.heading : pState.yaw);
  }

  renderer.render(scene, camera);
}

// ============ Bắt đầu ============
initInput();
ui.initUI();
initMinigame(audio);
quests.bindQuestUI(ui, audio);
initMinimap();
setLang('vi');

// Hook gỡ lỗi / chụp ảnh tour (không ảnh hưởng gameplay)
window.__hp = {
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
