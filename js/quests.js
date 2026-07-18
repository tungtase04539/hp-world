import { t, tx, onLangChange } from './i18n.js';
import { LANDMARKS } from './landmarks.js';

export const quests = {
  flowers: 0, FLOWER_GOAL: 10,
  food: false,
  discovered: new Set(),
  LANDMARK_GOAL: LANDMARKS.length,
  allDone: false,
};

// ---- LƯU TIẾN TRÌNH (localStorage) ----
// Trước đây thoát ra là mất sạch: hoa đã nhặt, món đã nấu, 26 địa danh đã khám phá.
const SAVE_KEY = 'hp3d.progress.v1';
export function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      flowers: quests.flowers, food: quests.food,
      discovered: [...quests.discovered], allDone: quests.allDone,
    }));
  } catch (e) { /* chế độ riêng tư / hết quota → chơi bình thường, chỉ không lưu được */ }
}
export function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    quests.flowers = Math.min(d.flowers | 0, quests.FLOWER_GOAL);
    quests.food = !!d.food;
    quests.allDone = !!d.allDone;
    quests.discovered = new Set(Array.isArray(d.discovered) ? d.discovered : []);
    renderQuests();
    return quests.flowers > 0 || quests.food || quests.discovered.size > 0;
  } catch (e) { return false; }
}
export function resetProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
  quests.flowers = 0; quests.food = false; quests.allDone = false;
  quests.discovered = new Set();
  renderQuests();
}

let ui = null, audio = null;
export function bindQuestUI(uiMod, audioMod) { ui = uiMod; audio = audioMod; renderQuests(); }

export function renderQuests() {
  const el = document.getElementById('questList');
  if (!el) return;
  const q1done = quests.flowers >= quests.FLOWER_GOAL;
  const q2done = quests.food;
  const q3done = quests.discovered.size >= quests.LANDMARK_GOAL;
  el.innerHTML = `
    <div class="quest ${q1done ? 'done' : ''}">🌺 <span class="qname">${t('q1')}</span> —
      <span class="qprog">${quests.flowers}/${quests.FLOWER_GOAL}</span><br><small>${t('q1d')}</small></div>
    <div class="quest ${q2done ? 'done' : ''}">🍜 <span class="qname">${t('q2')}</span> —
      <span class="qprog">${q2done ? t('qDone') : '…'}</span><br><small>${t('q2d')}</small></div>
    <div class="quest ${q3done ? 'done' : ''}">🗺️ <span class="qname">${t('q3')}</span> —
      <span class="qprog">${quests.discovered.size}/${quests.LANDMARK_GOAL}</span><br><small>${t('q3d')}</small></div>`;
}
onLangChange(renderQuests);

function checkAll() {
  saveProgress();
  if (!quests.allDone && quests.flowers >= quests.FLOWER_GOAL && quests.food
      && quests.discovered.size >= quests.LANDMARK_GOAL) {
    quests.allDone = true;
    setTimeout(() => {
      ui?.banner(t('allComplete'), 5200);
      audio?.sfx('fanfare');
    }, 1400);
  }
}

export function pickFlower() {
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
  audio?.sfx('discover');
  ui?.toast(`${t('discovered')}: ${tx(lm.name)} (${quests.discovered.size}/${quests.LANDMARK_GOAL})`);
  if (quests.discovered.size === quests.LANDMARK_GOAL) {
    ui?.banner(`${t('questComplete')}: ${t('q3')}!`);
    audio?.sfx('quest');
  }
  renderQuests();
  checkAll();
}
