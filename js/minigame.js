import { t, lang, onLangChange } from './i18n.js';
import { completeFood } from './quests.js';

// Nguyên liệu bánh đa cua — 5 đúng, 4 sai
const INGREDIENTS = [
  { id: 'banhda', emo: '🍜', vi: 'Bánh đa đỏ', en: 'Red rice noodles', ok: true },
  { id: 'cua', emo: '🦀', vi: 'Cua đồng', en: 'Field crab', ok: true },
  { id: 'raumuong', emo: '🥬', vi: 'Rau muống', en: 'Water spinach', ok: true },
  { id: 'chalalot', emo: '🍢', vi: 'Chả lá lốt', en: 'Betel leaf rolls', ok: true },
  { id: 'hanhphi', emo: '🧅', vi: 'Hành phi', en: 'Fried shallots', ok: true },
  { id: 'phomai', emo: '🧀', vi: 'Phô mai', en: 'Cheese', ok: false },
  { id: 'xucxich', emo: '🌭', vi: 'Xúc xích', en: 'Sausage', ok: false },
  { id: 'kem', emo: '🍦', vi: 'Kem', en: 'Ice cream', ok: false },
  { id: 'socola', emo: '🍫', vi: 'Sô cô la', en: 'Chocolate', ok: false },
];

let selected = new Set();
let onDone = null;
let audio = null;

export function initMinigame(audioMod) {
  audio = audioMod;
  renderGrid();
  document.getElementById('mgCook').addEventListener('click', cook);
  document.getElementById('mgClose').addEventListener('click', closeMinigame);
  onLangChange(renderGrid);
}

function renderGrid() {
  const grid = document.getElementById('mgGrid');
  grid.innerHTML = '';
  for (const ing of INGREDIENTS) {
    const div = document.createElement('div');
    div.className = 'mgItem' + (selected.has(ing.id) ? ' sel' : '');
    div.innerHTML = `<span class="emo">${ing.emo}</span><span class="nm">${lang === 'en' ? ing.en : ing.vi}</span>`;
    div.addEventListener('click', () => {
      audio?.sfx('click');
      if (selected.has(ing.id)) selected.delete(ing.id);
      else selected.add(ing.id);
      div.classList.toggle('sel');
    });
    grid.appendChild(div);
  }
}

export function openMinigame(done) {
  onDone = done;
  selected = new Set();
  document.getElementById('mgMsg').textContent = '';
  document.getElementById('mgMsg').className = '';
  renderGrid();
  document.getElementById('minigame').classList.remove('hidden');
}

export function closeMinigame() {
  document.getElementById('minigame').classList.add('hidden');
  if (onDone) { const f = onDone; onDone = null; f(false); }
}

export function isMinigameOpen() {
  return !document.getElementById('minigame').classList.contains('hidden');
}

function cook() {
  const msg = document.getElementById('mgMsg');
  if (selected.size !== 5) {
    msg.textContent = t('mgNeed5');
    msg.className = 'bad';
    audio?.sfx('error');
    return;
  }
  const allGood = INGREDIENTS.every((ing) => ing.ok === selected.has(ing.id));
  if (allGood) {
    msg.textContent = t('mgWin');
    msg.className = 'good';
    audio?.sfx('quest');
    completeFood();
    setTimeout(() => {
      document.getElementById('minigame').classList.add('hidden');
      if (onDone) { const f = onDone; onDone = null; f(true); }
    }, 1800);
  } else {
    msg.textContent = t('mgLose');
    msg.className = 'bad';
    audio?.sfx('error');
  }
}
