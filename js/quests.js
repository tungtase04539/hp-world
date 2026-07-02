import { t, tx, onLangChange } from './i18n.js';
import { LANDMARKS } from './landmarks.js';

export const quests = {
  flowers: 0, FLOWER_GOAL: 10,
  food: false,
  discovered: new Set(),
  LANDMARK_GOAL: LANDMARKS.length,
  allDone: false,
};

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
