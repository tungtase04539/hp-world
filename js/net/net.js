// js/net/net.js — điều phối multiplayer phía game (MP-2 C1): màn tiêu đề online, phiên, worker mạng, STATE, CORRECT,
// người chơi khác (js/net/remote_avatars*.js của C2), chat, ngày/đêm chung, trạng thái kết nối trên HUD.
//
// main.js CHỈ nạp file này (dynamic import) khi có cấu hình máy chủ — không có thì 0 request mới (SPEC §1.3).
// Mọi hàm công khai KHÔNG BAO GIỜ ném lỗi (bọc try/catch): lỗi mạng không được làm hỏng vòng frame.
//
// Vòng đời: createNet() (trước khi dựng thế giới) → dựng panel tiêu đề + làm mới token sớm → người chơi bấm "Vào thành
// phố" (tạo tài khoản nếu cần: biệt danh + mã mời → mã khôi phục hiện 1 lần) → /v1/join → worker mở WS, HELLO{vé} →
// WELCOME (đặt người chơi ở điểm máy chủ trả) → attach() khi thế giới xong → onStart() gửi READY → mỗi khung
// preFrame() (CORRECT + STATE 15 Hz đi / 2 Hz đứng) và frame() (người khác + ngày/đêm + HUD).
// Rớt mạng: worker RESUME trong 60 s (backoff 1-2-4-8 s); quá hạn/máy chủ khởi động lại → vé mới. Trong lúc mất máy
// chủ: chế độ "Khám phá" (game chạy như chơi một mình) + biểu tượng trạng thái, tự nối lại.
import { createSession } from './session.js';
import { createCorrector } from './correct.js';
import { createTelemetry } from './telemetry.js';
import { createRemoteAvatars } from './remote_avatars_stub.js';   // ← C2: đổi thành './remote_avatars.js' (cùng API)
import { createChat } from '../ui/chat.js';
import { SYS, EVENT, CHANNEL, ACTION, ACTION_RESULT, SANCTION_KIND, CLOSE } from '../shared/protocol.js';
import { MODE, SFLAG, STATE_HZ_MOVING, STATE_HZ_IDLE } from '../shared/constants.js';
import { packState } from '../shared/quant.js';
import { dayTAt } from '../shared/clock.js';

// bố cục gói SNAPSHOT từ worker (js/net/net_worker.js — sửa cả hai)
const SNAP_HDR = 11, ENTER_F = 9, UPD_F = 7;
const REJOIN_SNAP_M = 12;      // vào lại sau khi mất máy chủ: lệch vị trí đã lưu hơn thế → về vị trí máy chủ
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// deps: { cfg (config.parseServer), ui, i18n: {t, tf, onLangChange}, input: {input, releaseKeys, onChatKey},
//         audioGesture(), tier }
export function createNet(deps) {
  try { return build(deps); } catch (e) { console.warn('[net] tắt multiplayer:', e); return null; }
}

function build(deps) {
  const { cfg, ui, tier } = deps;
  const { t, tf, onLangChange } = deps.i18n;
  const session = createSession(cfg);
  const tel = createTelemetry();
  const log = (...a) => { try { console.info('[net]', ...a); } catch (e) { } };

  let mode = 'idle';           // idle (màn tiêu đề) | online | solo
  let conn = 'off';            // off | joining | queue | connecting | live | lost | closed
  let worker = null;
  let started = false, attached = false;
  let G = null;                // tham chiếu game (attach)
  let ra = null, corr = null, chat = null;
  let netId = -1, dayEpoch = NaN, dayLength = 1440, clockOff = NaN;
  let corrEpoch = 0, seq = 0;
  let pendingSpawn = null;     // {x, z, yaw, rejoin}
  let everLive = false, lostShown = false, joinBusy = false, joinTimer = 0, joinBackoff = 2000, noRejoin = false;
  let queueInfo = null;
  const names = new Map();     // netId → tên hiển thị
  const visible = new Set();   // netId đang thấy
  const pendingAct = new Map();// reqId → {type, target, cb}
  let reqId = 1;
  let statsWait = null;

  const serverNow = () => (Number.isFinite(clockOff) ? performance.timeOrigin + performance.now() + clockOff : NaN);

  // ---------------------------------------------------------------------------------------------------------------
  // HUD: trạng thái kết nối + nút chat (điện thoại)
  const topRight = document.getElementById('topRight');
  const pill = document.createElement('button');
  pill.id = 'netStatus'; pill.type = 'button'; pill.className = 'hidden';
  const btnChat = document.createElement('button');
  btnChat.id = 'btnChat'; btnChat.type = 'button'; btnChat.textContent = '💬'; btnChat.className = 'hidden';
  if (topRight) { topRight.insertBefore(pill, topRight.firstChild); topRight.insertBefore(btnChat, document.getElementById('btnMoto')); }
  pill.addEventListener('click', (e) => { e.currentTarget.blur(); if (mode === 'online' && conn !== 'live' && conn !== 'connecting') { noRejoin = false; joinBackoff = 2000; doJoin(); } });
  btnChat.addEventListener('click', (e) => { e.currentTarget.blur(); if (chat) chat.toggle(); });

  function renderPill() {
    if (mode !== 'online') { pill.classList.add('hidden'); btnChat.classList.add('hidden'); return; }
    pill.classList.remove('hidden');
    btnChat.classList.toggle('hidden', !started);
    let cls = 'off', txt = t('mpStClosed');
    if (conn === 'live') {
      cls = 'on';
      const n = ra ? ra.stats().count : 0;
      const rtt = tel.rttMs;
      txt = `${t('mpStOnline')} · 👥 ${n}${Number.isFinite(rtt) ? ` · ${Math.round(rtt)} ms` : ''}`;
    } else if (conn === 'joining' || conn === 'connecting') { cls = 'wait'; txt = t('mpStConnecting'); }
    else if (conn === 'queue') { cls = 'wait'; txt = tf('mpStQueue', { POS: queueInfo ? queueInfo.position : '?' }); }
    else if (conn === 'lost') { cls = 'lost'; txt = `${t('mpStExplore')} · ${t('mpStReconnect')}`; }
    else if (conn === 'closed') { cls = 'off'; txt = `${t('mpStExplore')} · ${t('mpStClosed')}`; }
    pill.dataset.state = cls;
    pill.textContent = txt;
    pill.title = conn === 'live' ? cfg.label : t('mpStTip');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // màn tiêu đề: biệt danh + mã mời, mã khôi phục, "Vào thành phố" / "Chơi một mình"
  const startBtn = document.getElementById('startBtn');
  const titleEl = document.getElementById('titleScreen');
  const panel = document.createElement('div');
  panel.id = 'mpPanel';
  panel.innerHTML = `
    <div id="mpWho" class="hidden"></div>
    <div id="mpForm">
      <input id="mpNick" maxlength="16" autocomplete="nickname" spellcheck="false">
      <input id="mpInvite" maxlength="24" autocomplete="off" spellcheck="false" autocapitalize="characters">
    </div>
    <button id="mpRecLink" type="button" class="mp-link"></button>
    <div id="mpRecBox" class="hidden">
      <input id="mpRecCode" maxlength="20" autocomplete="off" spellcheck="false" autocapitalize="characters">
      <button id="mpRecBtn" type="button"></button>
    </div>
    <div id="mpErr" role="alert"></div>`;
  const soloBtn = document.createElement('button');
  soloBtn.id = 'mpSolo'; soloBtn.type = 'button';
  const srvLabel = document.createElement('div');
  srvLabel.id = 'mpServer';
  if (startBtn && startBtn.parentNode) {
    startBtn.parentNode.insertBefore(panel, startBtn);
    startBtn.parentNode.insertBefore(soloBtn, startBtn.nextSibling);
    soloBtn.parentNode.insertBefore(srvLabel, soloBtn.nextSibling);
  }
  const $ = (id) => document.getElementById(id);
  const errEl = $('mpErr');
  function setErr(msg, ok = false) { errEl.textContent = msg || ''; errEl.classList.toggle('ok', !!ok); }
  function labelTitle() {
    $('mpNick').placeholder = t('mpNickPh');
    $('mpInvite').placeholder = t('mpInvitePh');
    $('mpRecLink').textContent = t('mpHaveCode');
    $('mpRecCode').placeholder = t('mpRecoverPh');
    $('mpRecBtn').textContent = t('mpRecoverBtn');
    soloBtn.textContent = t('mpSolo');
    srvLabel.textContent = tf('mpServer', { HOST: cfg.label });
    const who = $('mpWho');
    if (session.hasAccount) {
      who.innerHTML = tf('mpHello', { NAME: esc(session.displayName) });
      who.classList.remove('hidden');
      $('mpForm').classList.add('hidden');
    } else {
      who.classList.add('hidden');
      $('mpForm').classList.remove('hidden');
    }
    if (startBtn && !startBtn.classList.contains('loading')) { startBtn.setAttribute('data-i18n', 'mpEnter'); startBtn.textContent = t('mpEnter'); }
  }
  labelTitle();
  // ô nhập trên màn tiêu đề: phím không lọt vào game (input.js typing()), Enter = bấm "Vào thành phố"
  for (const id of ['mpNick', 'mpInvite']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startBtn && startBtn.click(); } });
  $('mpRecCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('mpRecBtn').click(); } });
  $('mpRecLink').addEventListener('click', () => $('mpRecBox').classList.toggle('hidden'));
  $('mpRecBtn').addEventListener('click', async () => {
    const code = $('mpRecCode').value.trim();
    if (!code) return;
    $('mpRecBtn').disabled = true; setErr(t('mpWorking'));
    const r = await session.recover(code);
    $('mpRecBtn').disabled = false;
    if (!r.ok) { setErr(errText(r)); return; }
    $('mpRecBox').classList.add('hidden'); $('mpRecCode').value = '';
    labelTitle();
    setErr(tf('mpRecovered', { NAME: session.displayName }), true);
  });

  let bypass = false;           // click lập trình (sau khi tạo tài khoản / chơi một mình) đi thẳng tới boot.js
  function proceedStart() { bypass = true; try { startBtn.click(); } finally { bypass = false; } }
  if (titleEl) titleEl.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('#startBtn') : null;
    if (!b || bypass || mode === 'solo') return;
    try { deps.audioGesture && deps.audioGesture(); } catch (err) { }
    if (mode === 'online') return;                // đã chọn (bấm lại) → để boot.js xử lý
    if (session.hasAccount) { goOnline(); return; }
    e.stopPropagation(); e.preventDefault();     // chưa có tài khoản: tạo trước, rồi mới vào
    createAccount();
  }, true);
  soloBtn.addEventListener('click', () => {
    try { deps.audioGesture && deps.audioGesture(); } catch (err) { }
    goSolo();
    proceedStart();
  });

  async function createAccount() {
    const nick = $('mpNick').value.trim();
    if (!nick) { setErr(t('mpNeedNick')); $('mpNick').focus(); return; }
    startBtn.disabled = true; soloBtn.disabled = true;
    setErr(t('mpWorking'));
    const r = await session.guest(nick, $('mpInvite').value);
    startBtn.disabled = false; soloBtn.disabled = false;
    if (!r.ok) { setErr(errText(r)); return; }
    setErr('');
    labelTitle();
    showRecoveryCode(r.recoveryCode, r.account ? r.account.displayName : nick, () => { goOnline(); proceedStart(); });
  }

  function showRecoveryCode(code, name, done) {
    const ov = document.createElement('div');
    ov.id = 'mpCode';
    ov.innerHTML = `<div class="mpCodeCard"><h3></h3><p class="mpCodeBody"></p><div class="mpCodeVal"></div>
      <div class="mpCodeBtns"><button type="button" class="mpCopy"></button><button type="button" class="mpOk"></button></div></div>`;
    ov.querySelector('h3').textContent = t('mpCodeTitle');
    ov.querySelector('.mpCodeBody').innerHTML = tf('mpCodeBody', { NAME: esc(name) });
    ov.querySelector('.mpCodeVal').textContent = code;
    const cp = ov.querySelector('.mpCopy'), ok = ov.querySelector('.mpOk');
    cp.textContent = t('mpCopy'); ok.textContent = t('mpCodeOk');
    cp.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); cp.textContent = t('mpCopied'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(ov.querySelector('.mpCodeVal')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
    ok.addEventListener('click', () => { ov.remove(); done(); });
    document.body.appendChild(ov);
  }

  function durText(sec) {
    if (sec >= 0xffffffff || sec < 0) return t('mpForever');
    if (sec < 90) return tf('mpSec', { N: Math.max(1, Math.round(sec)) });
    if (sec < 5400) return tf('mpMin', { N: Math.round(sec / 60) });
    if (sec < 172800) return tf('mpHour', { N: Math.round(sec / 3600) });
    return tf('mpDay', { N: Math.round(sec / 86400) });
  }
  function errText(r) {
    const code = r.error || 'network';
    if (code === 'nickname_invalid' && r.reason) { const k = 'mpErr_nick_' + r.reason; if (t(k) !== k) return t(k); }
    if (code === 'rate_limited') return tf('mpErr_rate_limited', { S: Math.max(1, Math.ceil(r.retryAfterS || 5)) });
    if (code === 'banned') return tf('mpErr_banned', { FOR: '' });
    if (code === 'no_account') return t('mpErr_unauthorized');
    const k = 'mpErr_' + code;
    if (t(k) !== k) return t(k);
    if (/^http_5/.test(code)) return t('mpErr_network');
    return tf('mpErr_default', { CODE: code });
  }

  // tạo phiên sớm: làm mới access token song song với dựng thế giới (luồng chính nhường ở các bước của boot)
  if (session.hasAccount) {
    session.ensureAccess().then((r) => {
      if (!r.ok && (r.status === 401 || r.error === 'no_account')) { labelTitle(); setErr(errText(r)); }
      else if (!r.ok && r.error === 'banned') setErr(errText(r));
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------------------------------------------
  // worker + vé
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./net_worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => { try { onWorker(ev.data); } catch (e) { console.warn('[net] lỗi xử lý tin:', e); } };
    worker.onerror = (e) => { console.warn('[net] worker lỗi:', e.message || e); };
    return worker;
  }
  const wpost = (m) => { try { if (worker) worker.postMessage(m); } catch (e) { } };

  function goOnline() {
    if (mode === 'online') return;
    mode = 'online';
    ensureWorker();
    doJoin();
    renderPill();
  }
  function goSolo() {
    mode = 'solo';
    if (worker) wpost({ t: 'close' });
    if (ra) { try { ra.dispose(); } catch (e) { } ra = null; }   // một mình: không giữ nhóm vẽ người khác
    conn = 'off';
    renderPill();
  }

  async function doJoin() {
    if (mode !== 'online' || joinBusy || noRejoin) return;
    clearTimeout(joinTimer); joinTimer = 0;
    joinBusy = true;
    if (conn !== 'lost') conn = 'joining';
    renderPill();
    let r;
    try { r = await session.join(tier); } catch (e) { r = { ok: false, error: 'network' }; }
    joinBusy = false;
    if (mode !== 'online') return;
    if (r.ok && r.ticket) {
      queueInfo = null;
      if (conn !== 'lost') conn = 'connecting';
      wpost({ t: 'connect', url: cfg.ws, ticket: r.ticket, tier });
      renderPill();
      return;
    }
    if (r.ok && r.queue) {
      queueInfo = r.queue;
      conn = 'queue';
      if (!lostShown) ui.toast(tf('mpQueue', { POS: r.queue.position, ETA: durText(r.queue.etaS || 30) }), 6000);
      retryJoin(Math.max(2, Math.min(30, r.queue.retryAfterS || 5)) * 1000);
      renderPill();
      return;
    }
    tel.inc('joinErrors');
    const code = r.error;
    log('join lỗi', code, r.status || '');
    if (code === 'proto_mismatch') { conn = 'closed'; noRejoin = true; showReload(); }
    else if (code === 'banned' || code === 'unauthorized' || code === 'no_account' || code === 'refresh_reused' || code === 'origin_not_allowed') {
      conn = 'closed'; noRejoin = true; ui.toast(errText(r), 8000); if (chat) chat.system(errText(r), 'error');
    } else {
      if (!started && conn !== 'lost') setErr(errText(r));
      enterExplore();
      retryJoin(code === 'rate_limited' ? Math.max(2, r.retryAfterS || 5) * 1000 : joinBackoff);
      joinBackoff = Math.min(15000, joinBackoff * 2);
    }
    renderPill();
  }
  function retryJoin(ms) { clearTimeout(joinTimer); joinTimer = setTimeout(() => { joinTimer = 0; doJoin(); }, ms + Math.random() * 1000); }

  // mất máy chủ → chế độ Khám phá (người khác biến mất, game chạy một mình), tự nối lại. Rớt NGẮN (RESUME < 3 s) chỉ đổi
  // biểu tượng trạng thái: không báo, không xoá người khác (khung KEYFRAME sau resume tự khớp lại) → không nhấp nháy.
  let exploreTimer = 0;
  function enterExplore() {
    if (conn === 'live' || conn === 'connecting' || conn === 'joining' || conn === 'off') conn = 'lost';
    tel.offline(true);
    renderPill();
    if (!everLive) { clearRemotes(); return; }
    if (!exploreTimer && !lostShown) exploreTimer = setTimeout(() => {
      exploreTimer = 0;
      if (conn === 'live') return;
      lostShown = true;
      ui.toast(t('mpLost'), 5000); if (chat) chat.system(t('mpLost'), 'error');
      clearRemotes();
      renderPill();
    }, 3000);
  }
  function clearRemotes() {
    if (ra) for (const id of visible) { try { ra.leave(id); } catch (e) { } }
    visible.clear();
  }
  function showReload() {
    const b = document.createElement('div');
    b.id = 'mpReload';
    b.innerHTML = '<p></p><button type="button"></button>';
    b.querySelector('p').textContent = t('mpNewVersion');
    const btn = b.querySelector('button'); btn.textContent = t('mpReload');
    btn.addEventListener('click', () => location.reload());
    document.body.appendChild(b);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // tin từ worker
  function onWorker(m) {
    switch (m.t) {
      case 'status': return onStatus(m);
      case 'welcome': return onWelcome(m);
      case 'snap': return onSnap(new Float64Array(m.buf));
      case 'names':
        for (const n of m.names) names.set(n.netId, n.name);
        if (ra) ra.names(m.names);
        return;
      case 'chat': return onChat(m);
      case 'event': return onEvent(m.type, m.args);
      case 'system': return onSystem(m.code, m.arg);
      case 'correct': return onCorrect(m);
      case 'clock':
        clockOff = m.off;
        tel.rtt(m.rtt, m.rttMed);
        return;
      case 'world':
        if (Number.isFinite(m.dayEpoch)) { dayEpoch = m.dayEpoch; dayLength = m.dayLength || dayLength; }
        return;
      case 'needTicket':
        log('cần vé mới:', m.reason);
        if (m.reason === 'resume_rejected' || m.reason === 'expired') tel.inc('rejoins');
        if (conn === 'live') enterExplore();
        doJoin();
        return;
      case 'stats': if (statsWait) { statsWait(m.st); statsWait = null; } return;
      case 'error': console.warn('[net] worker:', m.msg); return;
      default: return;
    }
  }

  function onStatus(m) {
    if (m.s === 'wait' || m.s === 'resuming') {
      if (conn === 'live') { tel.inc('reconnects'); enterExplore(); }
    } else if (m.s === 'closed') {
      if (m.code === CLOSE.NORMAL && mode !== 'online') { conn = 'off'; renderPill(); return; }
      conn = 'closed';
      if (m.code === CLOSE.KICKED || m.code === CLOSE.BANNED || m.code === CLOSE.DUPLICATE || m.code === CLOSE.PROTO) noRejoin = true;
      if (m.code === CLOSE.PROTO) showReload();
      clearRemotes();
      tel.offline(true);
    }
    renderPill();
  }

  function onWelcome(m) {
    tel.inc('welcomes');
    if (m.resumed) tel.inc('resumes');
    netId = m.netId;
    dayEpoch = m.dayEpoch; dayLength = m.dayLength || 1440;
    if (!Number.isFinite(clockOff) && Number.isFinite(m.serverTime)) clockOff = m.serverTime - (performance.timeOrigin + performance.now());
    const wasLost = conn === 'lost' || lostShown;   // (thông báo "đã nối lại" chỉ khi đã báo mất)
    conn = 'live';
    joinBackoff = 2000;
    tel.offline(false);
    if (ra) ra.self(netId);
    if (!m.resumed) {
      corrEpoch = 0;                                   // phiên mới: máy chủ đếm epoch lại từ 0
      pendingSpawn = { x: m.spawn.x, z: m.spawn.z, yaw: m.spawn.yaw, rejoin: everLive };
      applySpawn();
    }
    clearTimeout(exploreTimer); exploreTimer = 0;
    if (wasLost && everLive && lostShown) { ui.toast(t('mpBack'), 3000); if (chat) chat.system(t('mpBack')); }
    else if (!everLive && started) ui.toast(t('mpJoined'), 3000);
    everLive = true; lostShown = false;
    syncDay(true);
    renderPill();
  }

  function applySpawn() {
    if (!pendingSpawn || !attached || !started) return;
    const sp = pendingSpawn; pendingSpawn = null;
    const p = G.pState.mounted ? G.pState.mounted.pos : G.pState.pos;
    const d = Math.hypot(p.x - sp.x, p.z - sp.z);
    if (sp.rejoin && d <= REJOIN_SNAP_M) return;     // vào lại gần chỗ cũ → giữ nguyên (không giật)
    G.place(sp.x, sp.z, sp.yaw);
    resetVel();
    if (sp.rejoin) ui.toast(t('mpMoved'), 3500);
  }

  function onSnap(b) {
    tel.inc('snapsIn');
    if (!ra) return;
    const nL = b[8], nE = b[9], nU = b[10];
    let sMs = b[2];
    if (!Number.isFinite(sMs)) sMs = serverNow();
    let p = SNAP_HDR;
    for (let i = 0; i < nL; i++) { const id = b[p++]; visible.delete(id); ra.leave(id); }
    for (let i = 0; i < nE; i++) {
      const id = b[p], abs = { x: b[p + 1], z: b[p + 2], y: b[p + 3], yaw: b[p + 4], spd: b[p + 5], state: b[p + 6], serverMs: sMs };
      const a0 = b[p + 7], a1 = b[p + 8];
      const app = new Uint8Array([a0 & 255, (a0 >>> 8) & 255, (a0 >>> 16) & 255, (a0 >>> 24) & 255, a1 & 255, (a1 >>> 8) & 255, (a1 >>> 16) & 255, (a1 >>> 24) & 255]);
      p += ENTER_F;
      if (id === netId) continue;
      visible.add(id);
      ra.enter(id, abs, app);
    }
    for (let i = 0; i < nU; i++) {
      const id = b[p];
      if (id !== netId) ra.update(id, { x: b[p + 1], z: b[p + 2], y: b[p + 3], yaw: b[p + 4], spd: b[p + 5], state: b[p + 6] }, sMs);
      p += UPD_F;
    }
    tel.inc('snapRecords', nE + nU);
  }

  function nameOf(id) { return names.get(id) || ('#' + id); }

  function onChat(m) {
    tel.inc('chatIn');
    if (!chat) return;
    if (m.from === 0 && m.channel === CHANNEL.SYSTEM) { chat.add({ text: m.text, kind: 'admin' }); ui.banner('📢 ' + m.text, 5000); return; }
    if (m.from === netId) { chat.add({ from: m.from, text: m.text, msgRef: m.msgRef, kind: 'self' }); return; }
    chat.add({ from: m.from, name: nameOf(m.from), text: m.text, msgRef: m.msgRef, kind: 'say' });
  }

  function onEvent(type, a) {
    switch (type) {
      case EVENT.ACTION_RESULT: {
        const p = pendingAct.get(a[0]);
        if (p) { pendingAct.delete(a[0]); try { p.cb(a[1]); } catch (e) { } }
        return;
      }
      case EVENT.CHAT_REJECTED: {
        tel.inc('chatRejected');
        const code = a[0] | 0, ms = a[1] | 0;
        const k = 'chatRej_' + code;
        const txt = t(k) !== k ? tf(k, { S: Math.max(1, Math.ceil(ms / 1000)), FOR: ms > 0 ? ` (${durText(ms / 1000)})` : '' }) : tf('mpErr_default', { CODE: 'chat ' + code });
        if (chat) chat.system(txt, 'error');
        return;
      }
      case EVENT.REPORT_RESULT: {
        const k = 'chatRep_' + (a[0] | 0);
        const txt = t(k) !== k ? t(k) : t('chatRep_0');
        if (chat) chat.system(txt, (a[0] | 0) === 0 ? 'system' : 'error');
        ui.toast(txt, 3000);
        return;
      }
      case EVENT.SUPPORT_LINE: if (chat) chat.support(t('chatSupport')); return;
      case EVENT.SANCTION: {
        const kind = a[0] | 0, sec = a[1] >>> 0;
        let txt = null;
        if (kind === SANCTION_KIND.MUTE) txt = sec > 0 ? tf('chatMuted', { FOR: durText(sec) }) : t('chatUnmuted');
        else if (kind === SANCTION_KIND.WARN) txt = t('chatWarned');
        else if (kind === SANCTION_KIND.BAN) txt = tf('chatBanned', { FOR: durText(sec) });
        if (txt) { if (chat) chat.system(txt, 'error'); ui.banner(txt, 5000); }
        return;
      }
      default: return;
    }
  }

  function onSystem(code, arg) {
    switch (code) {
      case SYS.KICK: {
        noRejoin = true;
        const k = 'mpKick_' + arg;
        const txt = tf('mpSys_kick', { WHY: t(k) !== k ? t(k) : '' });
        ui.banner(txt, 6000); if (chat) chat.system(txt, 'error');
        return;
      }
      case SYS.RESTART_IN: { const txt = tf('mpSys_restart', { S: arg }); ui.banner(txt, 5000); if (chat) chat.system(txt); return; }
      case SYS.QUEUE_POS: case SYS.SERVER_FULL:
        queueInfo = { position: code === SYS.QUEUE_POS ? arg : '?', etaS: code === SYS.SERVER_FULL ? arg : 30 }; renderPill(); return;
      case SYS.RELOAD: noRejoin = true; showReload(); return;
      case SYS.BANNED: { noRejoin = true; const txt = tf('chatBanned', { FOR: durText(arg) }); ui.banner(txt, 6000); if (chat) chat.system(txt, 'error'); return; }
      case SYS.MUTED: { const txt = tf('mpSys_muted', { FOR: durText(arg) }); if (chat) chat.system(txt, 'error'); return; }
      case SYS.DUPLICATE_SESSION: { noRejoin = true; const txt = t('mpSys_duplicate'); ui.banner(txt, 6000); if (chat) chat.system(txt, 'error'); return; }
      case SYS.RESUMED: return;
      default: return;
    }
  }

  function onCorrect(m) {
    tel.inc('corrections');
    corrEpoch = m.epoch & 255;
    if (attached && corr) {
      const r = corr.apply(m);
      log(`CORRECT lý do ${m.reason} lệch ${r.dist.toFixed(1)} m${r.snapped ? ' (nhảy)' : ''}`);
      resetVel();
    }
    nextStateAt = 0;               // gửi STATE mang epoch mới ngay
  }

  // ---------------------------------------------------------------------------------------------------------------
  // STATE (15 Hz đi / 2 Hz đứng) — ĐỒNG HỒ THẬT, không dùng dt đã kẹp
  let nextStateAt = 0, lastT = 0, lx = NaN, lz = NaN, vx = 0, vz = 0, lastMode = -1;
  function resetVel() { lx = NaN; vx = 0; vz = 0; }
  function curMode() {
    const ps = G.pState, v = ps.mounted;
    if (v) return v.type === 'boat' ? MODE.BOAT : v.type === 'cyclo' ? MODE.CYCLO : MODE.MOTO;
    if (!ps.onGround) return MODE.AIR;
    const inp = deps.input.input;
    return inp.run && Math.hypot(inp.forward, inp.right) > 0.05 ? MODE.RUN : MODE.WALK;
  }
  function vehicleRef(v) {
    if (!v || !G.vehicles) return 0;
    const i = G.vehicles.indexOf(v);
    return i >= 0 && i < G.sharedCount ? i + 1 : 0;    // xe dùng chung của thế giới; xe máy gọi riêng = 0
  }
  function sendState(now) {
    const ps = G.pState, v = ps.mounted;
    const p = v ? v.pos : ps.pos;
    const mode = curMode();
    const busy = (ui.isAnyModalOpen && ui.isAnyModalOpen()) || (chat && chat.isOpen);
    const st = {
      seq: seq = (seq + 1) & 0xffff,
      clientMs: Math.floor(now) & 0xffff,
      x: p.x, z: p.z, y: v ? v.pos.y : ps.pos.y,
      yaw: v ? v.heading : ps.yaw,
      vx, vz,
      state: packState(mode, busy ? SFLAG.BUSY : 0),
      corrEpoch, vehicleRef: vehicleRef(v),
    };
    wpost({ t: 'state', s: st });
    tel.inc('stateSent');
    const moving = Math.hypot(vx, vz) > 0.15 || mode !== lastMode;
    lastMode = mode;
    nextStateAt = now + 1000 / (moving ? STATE_HZ_MOVING : STATE_HZ_IDLE);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // ngày/đêm chung (~1 Hz)
  let nextDayAt = 0;
  function syncDay(force) {
    if (!attached || !G.dayNight || !G.dayNight.syncTo) return;
    const now = performance.now();
    if (!force && now < nextDayAt) return;
    nextDayAt = now + 1000;
    const sn = serverNow();
    if (!Number.isFinite(sn) || !Number.isFinite(dayEpoch)) return;
    G.dayNight.syncTo(dayTAt(sn, dayEpoch, dayLength), dayLength);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // hành động (lên xe dùng chung, chặn)
  function action(type, target, arg, cb) {
    const id = reqId = (reqId % 65535) + 1;
    if (cb) pendingAct.set(id, { type, target, cb });
    if (pendingAct.size > 64) pendingAct.delete(pendingAct.keys().next().value);
    wpost({ t: 'action', reqId: id, type, target, arg: arg || 0 });
  }

  function makeChat() {
    if (chat) return;
    chat = createChat({
      ui, t, tf, releaseKeys: deps.input.releaseKeys,
      isTouch: () => !!deps.input.input.isTouch,
      nameOf,
      onSend(text) {
        if (conn !== 'live') { chat.system(t('chatOffline'), 'error'); return false; }
        wpost({ t: 'chat', channel: CHANNEL.SAY, text });
        tel.inc('chatSent');
        return true;
      },
      onReport(target, reason, chatRef) {
        if (conn !== 'live') { chat.system(t('chatOffline'), 'error'); return; }
        wpost({ t: 'report', target, reason, chatRef });
      },
      onBlock(target, on, name) {
        if (conn !== 'live') return;
        action(on ? ACTION.BLOCK_PLAYER : ACTION.UNBLOCK_PLAYER, target, 0, (code) => {
          if (code === ACTION_RESULT.OK) chat.system(tf(on ? 'chatBlocked' : 'chatUnblocked', { NAME: name || nameOf(target) }));
        });
      },
    });
    deps.input.onChatKey(() => {
      // mở được cả khi đang có hội thoại NPC/bảng thông tin (chat không khoá điều khiển); không mở chồng lên menu chat
      if (mode !== 'online' || !started || !chat || chat.menuOpen) return false;
      return chat.open();
    });
  }

  onLangChange(() => { try { labelTitle(); renderPill(); if (chat) chat.relabel(); } catch (e) { } });

  // ---------------------------------------------------------------------------------------------------------------
  // API cho main.js (không bao giờ ném)
  const api = {
    cfg,
    get mode() { return mode; },
    get conn() { return conn; },
    get online() { return mode === 'online'; },
    // nút Bắt đầu đã mở (boot.finish): đổi chữ thành "Vào thành phố"
    onBootReady() { try { labelTitle(); } catch (e) { } },
    // thế giới đã dựng + người chơi tồn tại
    // g: {scene, world, camera, pState, player, vehicles, dayNight, surfaceY, place(x, z, yaw), dismountNow()}
    attach(g) {
      try {
        G = { ...g, sharedCount: g.vehicles ? g.vehicles.length : 0 };
        corr = createCorrector({ pState: g.pState, surfaceY: g.surfaceY });
        if (mode !== 'solo') {
          ra = createRemoteAvatars({ scene: g.scene, world: g.world, camera: g.camera, tier });
          if (netId >= 0) ra.self(netId);
        }
        attached = true;
      } catch (e) { console.warn('[net] attach lỗi:', e); }
    },
    // startGame(): vào game
    onStart() {
      try {
        started = true;
        if (mode !== 'online') { renderPill(); return; }
        if (!ra && G) ra = createRemoteAvatars({ scene: G.scene, world: G.world, camera: G.camera, tier });
        makeChat();
        wpost({ t: 'ready' });
        applySpawn();
        syncDay(true);
        if (conn === 'live') ui.toast(t('mpJoined'), 3000);
        renderPill();
      } catch (e) { console.warn('[net] onStart lỗi:', e); }
    },
    // mỗi khung, sau khi nhân vật di chuyển + kẹp vùng chơi (trước camera): CORRECT mượt + STATE
    preFrame(dt) {
      if (!attached || mode !== 'online') return;
      try {
        corr.step(dt);
        const now = performance.now();
        const ps = G.pState, p = ps.mounted ? ps.mounted.pos : ps.pos;
        const dtR = (now - lastT) / 1000;
        if (Number.isFinite(lx) && dtR > 0.004 && dtR < 1) {
          const ix = (p.x - lx) / dtR, iz = (p.z - lz) / dtR;
          const k = Math.min(1, dtR * 12);
          vx += (ix - vx) * k; vz += (iz - vz) * k;
        } else if (!Number.isFinite(lx)) { vx = 0; vz = 0; }
        lx = p.x; lz = p.z; lastT = now;
        if (conn === 'live' && started && now >= nextStateAt) sendState(now);
      } catch (e) { console.warn('[net] preFrame lỗi:', e); }
    },
    // mỗi khung, sau camera: người chơi khác + ngày/đêm + HUD
    frame(dt, camPos) {
      if (!attached || mode !== 'online') return;
      try {
        if (ra) ra.frame(dt, serverNow(), camPos);
        syncDay(false);
        const now = performance.now();
        if (now - (api._pillAt || 0) > 1000) { api._pillAt = now; renderPill(); }
      } catch (e) { console.warn('[net] frame lỗi:', e); }
    },
    markers() { try { return ra && ra.markers ? ra.markers() : null; } catch (e) { return null; } },
    // lên/xuống xe DÙNG CHUNG: giữ chỗ trên máy chủ; xe đang có người → xuống lại + báo
    onMount(v) {
      try {
        if (mode !== 'online' || conn !== 'live') return;
        const ref = vehicleRef(v);
        if (!ref) return;
        action(ACTION.MOUNT, ref, 0, (code) => {
          if (code !== ACTION_RESULT.OK && G.pState.mounted === v) { G.dismountNow(); ui.toast(t('vehicleBusy'), 3000); }
        });
      } catch (e) { }
    },
    onDismount(v) {
      try { if (mode === 'online' && conn === 'live') { const ref = vehicleRef(v); if (ref) action(ACTION.DISMOUNT, ref, 0, null); } } catch (e) { }
    },
    // ---- QA (window.__hp.net) ----
    qa: {
      status: () => ({ mode, conn, netId, corrEpoch, started, attached, clockSynced: Number.isFinite(clockOff), visible: visible.size,
        names: names.size, serverNow: serverNow(), dayT: G && G.dayNight ? G.dayNight.t : null,
        serverDayT: Number.isFinite(dayEpoch) && Number.isFinite(serverNow()) ? dayTAt(serverNow(), dayEpoch, dayLength) : null,
        tel: tel.snapshot(), correct: corr ? corr.stats() : null, ra: ra ? ra.stats() : null, account: session.displayName }),
      workerStats: () => new Promise((res) => { statsWait = res; wpost({ t: 'stats' }); setTimeout(() => { if (statsWait === res) { statsWait = null; res(null); } }, 2000); }),
      say: (text) => { if (!chat) return false; return chat && conn === 'live' ? (wpost({ t: 'chat', channel: CHANNEL.SAY, text }), tel.inc('chatSent'), true) : false; },
      chatLines: () => (chat ? chat.lines() : []),
      openChat: () => chat && chat.open(),
      closeChat: () => chat && chat.close(),
      players: () => (ra && ra.positions ? ra.positions() : []),
      names: () => [...names.entries()],
      drop: () => wpost({ t: 'drop' }),
      rejoin: () => { noRejoin = false; doJoin(); },
    },
  };
  return api;
}
