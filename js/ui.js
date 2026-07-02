import { t, tx, lang, setLang } from './i18n.js';
import * as audio from './audio.js';

let toastTimer = null, bannerTimer = null;

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function banner(msg, ms = 3400) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function setPrompt(html) {
  const el = document.getElementById('prompt');
  if (!html) { el.classList.add('hidden'); return; }
  el.innerHTML = html;
  el.classList.remove('hidden');
}

// ---------- Hội thoại ----------
const dlg = {
  npc: null, idx: 0, onEnd: null,
  get open() { return !document.getElementById('dialogue').classList.contains('hidden'); },
};
export function isDialogueOpen() { return dlg.open; }

export function startDialogue(npc, onEnd) {
  dlg.npc = npc; dlg.idx = 0; dlg.onEnd = onEnd || null;
  showLine();
  document.getElementById('dialogue').classList.remove('hidden');
  audio.sfx('talk');
}
function showLine() {
  document.getElementById('dlgName').textContent = tx(dlg.npc.data.name);
  document.getElementById('dlgText').textContent = tx(dlg.npc.data.lines[dlg.idx]);
}
export function advanceDialogue() {
  if (!dlg.open) return;
  dlg.idx++;
  if (dlg.idx >= dlg.npc.data.lines.length) {
    document.getElementById('dialogue').classList.add('hidden');
    const npc = dlg.npc, end = dlg.onEnd;
    dlg.npc = null; dlg.onEnd = null;
    if (end) end(npc);
  } else {
    showLine();
    audio.sfx('talk');
  }
}

// ---------- Bảng thông tin địa danh ----------
export function showInfo(lm) {
  document.getElementById('infoTitle').textContent = tx(lm.name);
  document.getElementById('infoText').textContent = tx(lm.text);
  document.getElementById('infoFact').textContent = tx(lm.fact);
  document.getElementById('infoPanel').classList.remove('hidden');
  audio.sfx('click');
}
export function isInfoOpen() { return !document.getElementById('infoPanel').classList.contains('hidden'); }

export function isAnyModalOpen() {
  return dlg.open || isInfoOpen()
    || !document.getElementById('minigame').classList.contains('hidden')
    || !document.getElementById('helpModal').classList.contains('hidden');
}

export function setClock(str) {
  document.getElementById('clock').textContent = str;
}

// ---------- Khởi tạo nút bấm ----------
export function initUI() {
  document.getElementById('infoClose').addEventListener('click', () =>
    document.getElementById('infoPanel').classList.add('hidden'));
  document.getElementById('helpClose').addEventListener('click', () =>
    document.getElementById('helpModal').classList.add('hidden'));
  document.getElementById('btnHelp').addEventListener('click', () => {
    document.getElementById('helpBody').innerHTML = t('helpBody');
    document.getElementById('helpModal').classList.remove('hidden');
    audio.sfx('click');
  });
  document.getElementById('btnSound').addEventListener('click', (e) => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    e.target.textContent = m ? '🔇' : '🔊';
  });
  document.getElementById('btnLang').addEventListener('click', (e) => {
    const next = lang === 'vi' ? 'en' : 'vi';
    setLang(next);
    e.target.textContent = next === 'vi' ? '🌐 VI' : '🌐 EN';
    audio.sfx('click');
  });
  // bấm vào hộp thoại để tiếp tục
  document.getElementById('dialogue').addEventListener('click', advanceDialogue);
  // chọn ngôn ngữ ở màn hình chờ
  document.querySelectorAll('.langPick').forEach((b) => {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang);
      document.getElementById('btnLang').textContent = b.dataset.lang === 'vi' ? '🌐 VI' : '🌐 EN';
      document.querySelectorAll('.langPick').forEach((x) => x.classList.toggle('active', x === b));
    });
  });
  document.querySelector('.langPick[data-lang="vi"]').classList.add('active');

  // Gợi ý xoay ngang trên điện thoại (màn hình dọc)
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let rotateDismissed = false;
  function checkOrientation() {
    const el = document.getElementById('rotateHint');
    const portrait = window.innerHeight > window.innerWidth;
    if (isTouch && portrait && !rotateDismissed) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  document.getElementById('rotateDismiss').addEventListener('click', () => {
    rotateDismissed = true;
    document.getElementById('rotateHint').classList.add('hidden');
  });
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
  checkOrientation();
}
