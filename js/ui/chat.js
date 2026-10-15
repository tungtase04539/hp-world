// js/ui/chat.js — khung chat "nói trong 40 m" (MP-2 C1, SPEC §2 C1 Chat). Chỉ nạp khi có máy chủ (js/net/net.js).
//
// - Mở: phím T hoặc / (Enter đang là TƯƠNG TÁC), nút 💬 trên điện thoại; Esc đóng; Enter gửi. Đang gõ thì nhân vật
//   đứng yên (input.js typing() + releaseKeys() lúc mở).
// - Khung cuộn ≤ 50 dòng; khi đóng chỉ hiện vài dòng cuối rồi mờ dần. Tin hệ thống / thông báo / từ chối có màu riêng.
// - Chạm/nhấp TÊN người trong khung → menu Báo cáo (lý do) / Chặn. Báo cáo gửi msgRef của dòng đó (máy chủ tự lấy ngữ
//   cảnh — client không gửi nội dung). Chặn: ACTION BLOCK_PLAYER (máy chủ ngừng giao tin hai chiều) + ẩn ngay tại máy
//   (tin nhắn VÀ hình người đó — net.js ra.hide).
// - Bảng "Người chơi quanh đây" (nút 👥 trong ô chat / chạm biểu tượng kết nối): mọi người đang thấy (gần trước) → cùng
//   menu Báo cáo/Chặn — người KHÔNG chat (bám theo, tên xấu) cũng báo cáo/chặn được (fixer vòng 1 SAFE-3); mục "Đã chặn"
//   có nút Bỏ chặn. Danh sách chặn ở máy theo netId của PHIÊN → xoá khi vào phiên mới (resetBlocked, SAFE-2); danh sách
//   chặn theo TÀI KHOẢN ở máy chủ vẫn giữ.
// - Mọi chữ của người chơi chèn bằng textContent (không bao giờ innerHTML).
const MAX_LINES = 50;

export function createChat({ ui, t, tf, releaseKeys, onSend, onReport, onBlock, nameOf, isTouch, listPlayers }) {
  const hud = document.getElementById('hud') || document.body;
  const box = document.createElement('div');
  box.id = 'chatBox';
  box.innerHTML = '<div id="chatLog" role="log" aria-live="polite"></div>'
    + '<form id="chatForm" class="hidden" autocomplete="off"><button id="chatPeopleBtn" type="button">👥</button>'
    + '<input id="chatInput" maxlength="140" enterkeyhint="send" spellcheck="false">'
    + '<button id="chatSendBtn" type="submit"></button></form><div id="chatHint"></div>';
  hud.appendChild(box);
  const log = box.querySelector('#chatLog');
  const form = box.querySelector('#chatForm');
  const inp = box.querySelector('#chatInput');
  const sendBtn = box.querySelector('#chatSendBtn');
  const hint = box.querySelector('#chatHint');
  const peopleBtn = box.querySelector('#chatPeopleBtn');

  // menu người chơi (Báo cáo / Chặn)
  const menu = document.createElement('div');
  menu.id = 'chatMenu';
  menu.className = 'hidden';
  menu.innerHTML = '<div id="chatMenuName"></div><div id="chatMenuMain"></div><div id="chatMenuReasons" class="hidden"></div>';
  document.body.appendChild(menu);
  const menuName = menu.querySelector('#chatMenuName');
  const menuMain = menu.querySelector('#chatMenuMain');
  const menuReasons = menu.querySelector('#chatMenuReasons');
  let menuFor = null;     // {netId, name, msgRef}

  // đường dây hỗ trợ (SUPPORT_LINE)
  const sup = document.createElement('div');
  sup.id = 'supportLine';
  sup.className = 'hidden';
  sup.innerHTML = '<button class="closeX" type="button">✕</button><p></p>';
  document.body.appendChild(sup);
  sup.querySelector('.closeX').addEventListener('click', () => sup.classList.add('hidden'));

  // bảng người chơi quanh đây (+ đã chặn)
  const pp = document.createElement('div');
  pp.id = 'playersPanel';
  pp.className = 'hidden';
  pp.setAttribute('role', 'dialog');
  pp.innerHTML = '<button class="closeX" type="button">✕</button><h3></h3><div id="ppList"></div><h4></h4><div id="ppBlocked"></div>';
  document.body.appendChild(pp);
  pp.querySelector('.closeX').addEventListener('click', () => hidePlayers());

  const blocked = new Set();
  const blockedNames = new Map();   // netId → tên lúc chặn (cho mục "Đã chặn")
  let open = false;

  function label() {
    inp.placeholder = isTouch() ? t('chatPhTouch') : t('chatPh');
    sendBtn.textContent = t('chatSend');
    hint.textContent = isTouch() ? '' : t('chatHint');
    peopleBtn.title = t('ppTitle'); peopleBtn.setAttribute('aria-label', t('ppTitle'));
    pp.querySelector('h3').textContent = t('ppTitle');
    pp.querySelector('h4').textContent = t('ppBlocked');
  }
  label();

  function trim() { while (log.childElementCount > MAX_LINES) log.removeChild(log.firstElementChild); }
  function scroll() { log.scrollTop = log.scrollHeight; }

  // kind: say | self | system | admin | error | support
  function addLine({ from = -1, name = '', text = '', msgRef = 0, kind = 'say' }) {
    if (kind === 'say' && blocked.has(from)) return;
    const row = document.createElement('div');
    row.className = 'chatLine ' + kind;
    if (kind === 'say' || kind === 'self') {
      const nm = document.createElement(kind === 'say' ? 'button' : 'span');
      nm.className = 'chatName';
      nm.textContent = (kind === 'self' ? t('chatYou') : (name || ('#' + from))) + ':';
      if (kind === 'say') {
        nm.type = 'button';
        nm.title = t('chatNameTip');
        nm.addEventListener('click', (e) => { e.stopPropagation(); showMenu({ netId: from, name: name || ('#' + from), msgRef }, nm); });
      }
      row.appendChild(nm);
      row.appendChild(document.createTextNode(' '));
    } else if (kind === 'admin') {
      const b = document.createElement('b'); b.textContent = t('chatAdmin') + ': '; row.appendChild(b);
    }
    const sp = document.createElement('span');
    sp.className = 'chatText';
    sp.textContent = text;
    row.appendChild(sp);
    if (from >= 0) row.dataset.from = String(from);
    log.appendChild(row);
    trim(); scroll();
  }

  function showMenu(who, anchor) {
    menuFor = who;
    menuName.textContent = who.name;
    menuMain.innerHTML = '';
    const mk = (txt, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; if (cls) b.className = cls; b.addEventListener('click', fn); menuMain.appendChild(b); return b; };
    mk(t('chatReport'), () => showReasons(), 'warn');
    const isB = blocked.has(who.netId);
    mk(isB ? t('chatUnblock') : t('chatBlock'), () => { setBlocked(who.netId, !isB, who.name); hideMenu(); }, 'danger');
    mk(t('chatCancel'), () => hideMenu());
    menuMain.classList.remove('hidden');
    menuReasons.classList.add('hidden');
    menu.classList.remove('hidden');
    menuAnchor = anchor;
    placeMenu();
  }
  // đặt menu CẠNH dòng được chọn (bên phải nếu đủ chỗ; không thì dưới, rồi trên) — không che chính tin đang báo cáo
  let menuAnchor = null;
  function placeMenu() {
    try {
      const r = menuAnchor.getBoundingClientRect();
      const W = window.innerWidth, H = window.innerHeight;
      const mw = menu.offsetWidth || 240, mh = menu.offsetHeight || 200;
      let x, y;
      if (r.right + 8 + mw <= W - 8) { x = r.right + 8; y = r.top - 8; }
      else {
        x = Math.max(8, Math.min(W - mw - 8, r.left));
        y = r.bottom + 6 + mh <= H - 8 ? r.bottom + 6 : r.top - mh - 6;
      }
      menu.style.left = Math.round(x) + 'px';
      menu.style.top = Math.round(Math.max(8, Math.min(H - mh - 8, y))) + 'px';
    } catch (e) { }
  }
  function showReasons() {
    if (!menuFor) return;
    menuReasons.innerHTML = '';
    const h = document.createElement('div'); h.className = 'chatMenuQ'; h.textContent = tf('chatReportWhy', { NAME: menuFor.name });
    menuReasons.appendChild(h);
    for (let r = 1; r <= 6; r++) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t('chatReason_' + r);
      b.addEventListener('click', () => { const w = menuFor; hideMenu(); if (w) onReport(w.netId, r, w.msgRef >>> 0, w.name); });
      menuReasons.appendChild(b);
    }
    const c = document.createElement('button'); c.type = 'button'; c.textContent = t('chatCancel'); c.addEventListener('click', hideMenu);
    menuReasons.appendChild(c);
    menuMain.classList.add('hidden');
    menuReasons.classList.remove('hidden');
    placeMenu();
  }
  function hideMenu() { menu.classList.add('hidden'); menuFor = null; }
  function setBlocked(netId, on, name) {
    if (onBlock(netId, on, name) === false) return;   // không có kết nối: net.js đã báo, không chặn "giả" tại máy
    if (on) { blocked.add(netId); blockedNames.set(netId, name || nameOf(netId)); } else { blocked.delete(netId); blockedNames.delete(netId); }
    if (on) for (const row of [...log.querySelectorAll('.chatLine.say')]) if (row.dataset.from === String(netId)) row.remove();
    if (!pp.classList.contains('hidden')) renderPlayers();
  }
  function resetBlocked() { blocked.clear(); blockedNames.clear(); }

  function renderPlayers() {
    const listEl = pp.querySelector('#ppList'), blEl = pp.querySelector('#ppBlocked');
    listEl.innerHTML = ''; blEl.innerHTML = '';
    let rows = [];
    try { rows = (listPlayers && listPlayers()) || []; } catch (e) { rows = []; }
    rows = rows.filter((r) => !blocked.has(r.netId));
    if (!rows.length) { const e = document.createElement('div'); e.className = 'ppEmpty'; e.textContent = t('ppNone'); listEl.appendChild(e); }
    for (const r of rows.slice(0, 60)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ppRow';
      const nm = document.createElement('span'); nm.className = 'ppName'; nm.textContent = r.name || ('#' + r.netId);
      const d = document.createElement('span'); d.className = 'ppDist'; d.textContent = Number.isFinite(r.dist) ? Math.round(r.dist) + ' m' : '';
      const more = document.createElement('span'); more.className = 'ppMore'; more.textContent = '⋯';
      b.append(nm, d, more);
      b.addEventListener('click', (e) => { e.stopPropagation(); showMenu({ netId: r.netId, name: r.name || ('#' + r.netId), msgRef: 0 }, b); });
      listEl.appendChild(b);
    }
    pp.querySelector('h4').classList.toggle('hidden', !blocked.size);
    for (const id of blocked) {
      const row = document.createElement('div'); row.className = 'ppRow ppBl';
      const nm = document.createElement('span'); nm.className = 'ppName'; nm.textContent = blockedNames.get(id) || ('#' + id);
      const ub = document.createElement('button'); ub.type = 'button'; ub.textContent = t('chatUnblock');
      ub.addEventListener('click', (e) => { e.stopPropagation(); setBlocked(id, false, blockedNames.get(id)); });
      row.append(nm, ub);
      blEl.appendChild(row);
    }
  }
  function showPlayers() { hideMenu(); renderPlayers(); pp.classList.remove('hidden'); releaseKeys(); }
  function hidePlayers() { pp.classList.add('hidden'); hideMenu(); }
  peopleBtn.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); if (pp.classList.contains('hidden')) showPlayers(); else hidePlayers(); });

  ui.registerModal({ isOpen: () => !pp.classList.contains('hidden'), close: hidePlayers, blocking: true });
  ui.registerModal({ isOpen: () => !menu.classList.contains('hidden'), close: hideMenu, blocking: true });
  ui.registerModal({ isOpen: () => !sup.classList.contains('hidden'), close: () => sup.classList.add('hidden'), blocking: false });
  ui.registerModal({ isOpen: () => open, close: () => closeChat(), blocking: false });

  function openChat() {
    if (open) { inp.focus(); return true; }
    open = true;
    releaseKeys();
    box.classList.add('open');
    form.classList.remove('hidden');
    scroll();
    setTimeout(() => { try { inp.focus(); } catch (e) { } }, 0);
    return true;
  }
  function closeChat() {
    if (!open) return;
    open = false;
    box.classList.remove('open');
    form.classList.add('hidden');
    try { inp.blur(); } catch (e) { }
    hideMenu();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = inp.value.trim();
    if (txt) { if (onSend(txt)) inp.value = ''; }
    // máy tính: gửi xong đóng ô (như mọi game: T để nói tiếp). Điện thoại: GIỮ mở (bàn phím không phải bật lại cho mỗi
    // câu) — đóng bằng nút 💬
    if (!isTouch()) closeChat();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChat(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.classList.contains('hidden') && !menu.contains(e.target)) hideMenu(); });
  window.addEventListener('resize', () => { if (!menu.classList.contains('hidden') && menuAnchor) placeMenu(); });

  return {
    open: openChat, close: closeChat, toggle() { if (open) closeChat(); else openChat(); },
    get isOpen() { return open; },
    get menuOpen() { return !menu.classList.contains('hidden'); },
    add: addLine,
    system(text, kind = 'system') { addLine({ text, kind }); },
    support(text) { sup.querySelector('p').textContent = text; sup.classList.remove('hidden'); addLine({ text, kind: 'support' }); },
    isBlocked: (id) => blocked.has(id),
    setBlocked, resetBlocked,
    blockedList: () => [...blocked],
    showPlayers, hidePlayers,
    get playersOpen() { return !pp.classList.contains('hidden'); },
    relabel: label,
    showMenuFor(netId, name, msgRef) { showMenu({ netId, name, msgRef }, box); },
    show(on) { box.classList.toggle('hidden', !on); if (!on) closeChat(); },
    lines() { return [...log.querySelectorAll('.chatLine')].map((r) => ({ kind: r.className.replace('chatLine ', ''), text: r.textContent })); },
  };
}
