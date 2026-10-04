import { t, tx, onLangChange, setVars } from './i18n.js';
import { LANDMARKS } from './landmarks.js';
import { BUILD_RADIUS } from './world.js';

// Đợt 3 (WP8): mục tiêu "Nhà thám hiểm" CHỈ tính địa danh nằm trong VÙNG CHƠI (đĩa BUILD_RADIUS − 12 = PLAY_RADIUS của
// main.js). Trước đây LANDMARK_GOAL = 26 nhưng cầu Bính, Đồ Sơn, Hòn Dấu, Cát Bà nằm ngoài → tối đa 22/26, allDone
// không bao giờ bắn (kiểm toán 2026-10-04 mục 36). Lưu theo lm.id (khoá localStorage giữ nguyên hp3d.progress.v1).
const PLAY_R = BUILD_RADIUS - 12 - 2;
export const PLAY_LANDMARKS = LANDMARKS.filter((l) => Math.hypot(l.x, l.z) <= PLAY_R);
const PLAY_IDS = new Set(PLAY_LANDMARKS.map((l) => l.id));

export const quests = {
  flowers: 0, FLOWER_GOAL: 10,
  food: false,
  discovered: new Set(),            // mọi id đã khám phá (kể cả id cũ ngoài vùng chơi — giữ cho giai đoạn sau)
  LANDMARK_GOAL: PLAY_LANDMARKS.length,
  allDone: false,
};
setVars({ N: quests.LANDMARK_GOAL, F: quests.FLOWER_GOAL });
export const discoveredCount = () => { let n = 0; for (const id of quests.discovered) if (PLAY_IDS.has(id)) n++; return n; };

// ---- LƯU TIẾN TRÌNH (localStorage) ----
// Hoa lưu theo CHỈ SỐ bông (world.flowerPickups[i]) — bản cũ chỉ lưu SỐ ĐẾM: tải lại thì 10 bông hiện lại, nhặt
// tiếp được và đếm vượt mục tiêu. Bản lưu cũ (chỉ có `flowers`) → coi N bông đầu là đã nhặt.
const SAVE_KEY = 'hp3d.progress.v1';
let pickedIdx = new Set();
let flowerObjs = null;
export function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      flowers: quests.flowers, flowerIdx: [...pickedIdx], food: quests.food,
      discovered: [...quests.discovered], allDone: quests.allDone,
    }));
  } catch (e) { /* chế độ riêng tư / hết quota → chơi bình thường, chỉ không lưu được */ }
}
export function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (Array.isArray(d.flowerIdx)) pickedIdx = new Set(d.flowerIdx.filter((i) => Number.isInteger(i) && i >= 0 && i < 64));
    else { pickedIdx = new Set(); for (let i = 0; i < Math.min(d.flowers | 0, quests.FLOWER_GOAL); i++) pickedIdx.add(i); }
    quests.flowers = Math.min(pickedIdx.size, quests.FLOWER_GOAL);
    quests.food = !!d.food;
    quests.discovered = new Set(Array.isArray(d.discovered) ? d.discovered : []);
    quests.allDone = !!d.allDone && isAllDone();
    renderQuests();
    return quests.flowers > 0 || quests.food || discoveredCount() > 0;
  } catch (e) { return false; }
}
// main.js gọi sau buildWorld: ẩn các bông đã nhặt ở lần chơi trước; mục tiêu = số bông thật sự có (≤ 10).
export function attachFlowers(list) {
  flowerObjs = list || [];
  if (flowerObjs.length) quests.FLOWER_GOAL = Math.min(10, flowerObjs.length);
  setVars({ F: quests.FLOWER_GOAL });
  for (const i of pickedIdx) if (flowerObjs[i]) flowerObjs[i].visible = false;
  quests.flowers = Math.min([...pickedIdx].filter((i) => i < flowerObjs.length).length, quests.FLOWER_GOAL);
  renderQuests();
}
export function resetProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  quests.flowers = 0; quests.food = false; quests.allDone = false;
  quests.discovered = new Set();
  pickedIdx = new Set();
  if (flowerObjs) for (const p of flowerObjs) p.visible = true;
  renderQuests();
}

let ui = null, audio = null;
export function bindQuestUI(uiMod, audioMod) { ui = uiMod; audio = audioMod; renderQuests(); }

export function renderQuests() {
  const el = document.getElementById('questList');
  if (!el) return;
  const q1done = quests.flowers >= quests.FLOWER_GOAL;
  const q2done = quests.food;
  const nd = discoveredCount();
  const q3done = nd >= quests.LANDMARK_GOAL;
  el.innerHTML = `
    <div class="quest ${q1done ? 'done' : ''}">🌺 <span class="qname">${t('q1')}</span> —
      <span class="qprog">${quests.flowers}/${quests.FLOWER_GOAL}</span><br><small>${t('q1d')}</small></div>
    <div class="quest ${q2done ? 'done' : ''}">🍜 <span class="qname">${t('q2')}</span> —
      <span class="qprog">${q2done ? t('qDone') : '…'}</span><br><small>${t('q2d')}</small></div>
    <div class="quest ${q3done ? 'done' : ''}">🗺️ <span class="qname">${t('q3')}</span> —
      <span class="qprog">${nd}/${quests.LANDMARK_GOAL}</span><br><small>${t('q3d')}</small></div>`;
}
onLangChange(renderQuests);

function isAllDone() {
  return quests.flowers >= quests.FLOWER_GOAL && quests.food && discoveredCount() >= quests.LANDMARK_GOAL;
}
function checkAll() {
  saveProgress();
  if (!quests.allDone && isAllDone()) {
    quests.allDone = true;
    saveProgress();
    setTimeout(() => {
      ui?.banner(t('allComplete'), 5200);
      audio?.sfx('fanfare');
    }, 1400);
  }
}

// i = chỉ số bông trong world.flowerPickups (bỏ qua nếu đã nhặt — chống đếm trùng)
export function pickFlower(i = -1) {
  if (i >= 0) { if (pickedIdx.has(i)) return; pickedIdx.add(i); }
  if (quests.flowers >= quests.FLOWER_GOAL) { saveProgress(); return; }
  quests.flowers++;
  audio?.sfx('pickup');
  ui?.toast(`${t('pickedFlower')} (${quests.flowers}/${quests.FLOWER_GOAL})`);
  if (quests.flowers === quests.FLOWER_GOAL) {
    ui?.banner(`${t('questComplete')}: ${t('q1')}!`);
    audio?.sfx('quest');
  }
  renderQuests();
  checkAll();
}

export function completeFood() {
  if (quests.food) return;
  quests.food = true;
  ui?.banner(`${t('questComplete')}: ${t('q2')}!`);
  audio?.sfx('quest');
  renderQuests();
  checkAll();
}

export function discoverLandmark(lm) {
  if (quests.discovered.has(lm.id)) return;
  quests.discovered.add(lm.id);
  if (!PLAY_IDS.has(lm.id)) { saveProgress(); return; }   // ngoài vùng chơi: ghi nhận im lặng, không tính
  const n = discoveredCount();
  audio?.sfx('discover');
  ui?.toast(`${t('discovered')}: ${tx(lm.name)} (${n}/${quests.LANDMARK_GOAL})`);
  if (n === quests.LANDMARK_GOAL) {
    ui?.banner(`${t('questComplete')}: ${t('q3')}!`);
    audio?.sfx('quest');
  }
  renderQuests();
  checkAll();
}
