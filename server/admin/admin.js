// Admin page — server/admin/admin.js (served by server/src/admin/index.js under a strict CSP: no inline script,
// no external resources). Every piece of player text is inserted as a text node (h() / textContent), never as HTML.
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(3)) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : String(kid)); }
  return el;
}
const clear = (el, ...kids) => { el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false)); return el; };

// ---- labels -----------------------------------------------------------------------------------------------------
const REPORT_REASON = { 0: 'bộ lọc tự đánh dấu', 1: 'chửi bới', 2: 'quấy rối', 3: 'gian lận', 4: 'spam', 5: 'tên xấu', 6: 'khác' };
const WHY = { profanity: 'tục', profanity_mild: 'chửi nhẹ', sexual: 'tình dục', hate: 'miệt thị / đe doạ', scam: 'lừa đảo', personal_info: 'dò thông tin riêng',
  self_harm: 'tự hại', url: 'link', phone: 'số điện thoại', handle: 'nick mạng xã hội', evasion: 'lách luật', mixed_script: 'chữ lạ', flood: 'lặp ký tự',
  caps: 'viết hoa', flag: 'đánh dấu', control: 'ký tự ẩn' };
const ACTION_VI = { pass: 'cho qua', mask: 'che từ xấu rồi gửi', flag: 'gửi + đưa vào hàng chờ', block: 'CHẶN', system: 'hệ thống' };
const KIND_VI = { mute: 'khoá chat', shadow: 'khoá chat ẩn', ban: 'cấm vào game', kick: 'đuổi khỏi game', warn: 'nhắc nhở' };
const SOURCE_VI = { admin: 'quản trị', auto_report: 'tự động (báo cáo)', auto_filter: 'tự động (bộ lọc)', system: 'hệ thống' };
const why = (arr) => (arr || []).filter((r) => r !== 'control' && r !== 'flood' && r !== 'caps').map((r) => WHY[r] || r).join(', ');
const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const dt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function left(ms) {
  if (ms == null) return 'vĩnh viễn';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 86400) return `${Math.round(s / 86400)} ngày`;
  if (s >= 3600) return `${Math.round(s / 3600)} giờ`;
  if (s >= 60) return `${Math.round(s / 60)} phút`;
  return `${s} giây`;
}
function sanctionPills(s) {
  if (!s) return [];
  const out = [];
  const now = Date.now();
  for (const k of ['ban', 'shadow', 'mute']) {
    const u = s[k];
    if (u === 0 || u === undefined) continue;
    out.push(h('span', { class: 'pill bad' }, `${KIND_VI[k]} ${u === null ? 'vĩnh viễn' : 'còn ' + left(u - now)}`));
  }
  return out;
}
const fmtPlay = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} giờ` : `${Math.round((s || 0) / 60)} phút`);

// ---- api --------------------------------------------------------------------------------------------------------
let csrf = '';
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['content-type'] = 'application/json'; opts.headers['x-csrf-token'] = csrf; opts.body = JSON.stringify(body ?? {}); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && url !== '/admin/api/login') { showLogin('Phiên đăng nhập đã hết, hãy đăng nhập lại.'); throw new Error('unauthorized'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'http ' + res.status), { data, status: res.status });
  return data;
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
const fail = (e) => { if (e.message !== 'unauthorized') toast('Lỗi: ' + (e.data?.detail || e.message)); };

// ---- login ------------------------------------------------------------------------------------------------------
function showLogin(msg = '') {
  stopLive();
  $('#app').hidden = true; $('#login').hidden = false;
  $('#loginMsg').textContent = msg;
  $('#tokenInput').focus();
}
async function showApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  startLive();
  initMap();
}
$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $('#tokenInput').value.trim();
  try {
    const r = await api('POST', '/admin/api/login', { token });
    csrf = r.csrf;
    $('#tokenInput').value = '';
    showApp();
  } catch (e) {
    $('#loginMsg').textContent = e.status === 429 ? `Sai quá nhiều lần. Thử lại sau ${Math.ceil((e.data?.retryAfterS || 60) / 60)} phút.` : 'Mã quản trị không đúng.';
  }
});
$('#logoutBtn').addEventListener('click', async () => { try { await api('POST', '/admin/api/logout'); } catch { /* ignore */ } csrf = ''; showLogin('Đã đăng xuất.'); });

// ---- tabs -------------------------------------------------------------------------------------------------------
const loaders = {};
let currentTab = 'overview';
function openTab(name) {
  currentTab = name;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === 'tab-' + name);
  if (loaders[name]) loaders[name]();
  if (name === 'overview') requestAnimationFrame(() => { resizeMap(); });
}
$('#tabs').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-tab]'); if (b) openTab(b.dataset.tab); });

// ---- live -------------------------------------------------------------------------------------------------------
let liveTimer = 0, seq = 0, livePlayers = [], liveBusy = false;
function startLive() { stopLive(); seq = 0; clear($('#feed')); tickLive(); liveTimer = setInterval(tickLive, 1500); }
function stopLive() { clearInterval(liveTimer); liveTimer = 0; }
async function tickLive() {
  if (document.hidden || liveBusy) return;
  liveBusy = true;
  try {
    const r = await api('GET', '/admin/api/live?since=' + seq);
    seq = r.seq;
    renderChips(r.stats, r.alerts);
    livePlayers = r.players || [];
    drawPlayers();
    appendFeed(r.chat || []);
    const open = r.open || { reports: 0, flags: 0 };
    $('#badgeReports').textContent = open.reports + open.flags ? String(open.reports + open.flags) : '';
  } catch (e) { if (e.message !== 'unauthorized') renderChips(null); } finally { liveBusy = false; }
}
function chip(label, value, cls = '') { return h('span', { class: 'chip ' + cls }, label + ' ', h('b', {}, value)); }
function renderChips(s, alertsOn) {
  const c = $('#chips');
  if (!s) return clear(c, chip('Máy chủ', 'mất kết nối', 'bad'));
  const kb = (b) => (b == null ? '…' : (b / 1024).toFixed(1) + ' KB/s');
  clear(c,
    chip('Người chơi', String(s.ccu) + (s.sockets !== s.ccu ? ` (${s.sockets} kết nối)` : '')),
    chip('Tick p50/p99', s.tickP50 == null ? '…' : `${s.tickP50.toFixed(1)} / ${s.tickP99.toFixed(1)} ms`, s.tickP99 > 50 ? 'bad' : s.tickP99 > 25 ? 'warn' : ''),
    chip('Gửi đi', kb(s.bytesOutPerS) + (s.bytesOutPerClient != null ? ` · ${(s.bytesOutPerClient / 1024).toFixed(1)}/người` : '')),
    chip('Giảm tải', 'L' + (s.degrade || 0), s.degrade >= 2 ? 'bad' : s.degrade >= 1 ? 'warn' : ''),
    chip('CPU', s.cpu == null ? '…' : Math.round(s.cpu) + ' %', s.cpu > 300 ? 'warn' : ''),
    chip('RAM', s.rssMB + ' MB', s.rssMB > 1400 ? 'bad' : s.rssMB > 1000 ? 'warn' : ''),
    chip('Trễ vòng lặp', s.loopP99 == null ? '…' : s.loopP99.toFixed(1) + ' ms', s.loopP99 > 50 ? 'warn' : ''),
    chip('Telegram', alertsOn ? 'bật' : 'tắt'),
  );
}

// ---- chat lines (feed + report context) --------------------------------------------------------------------------
function lineEl(l, { onName } = {}) {
  const cls = ['line', l.action === 'system' ? 'system' : l.shadow ? 'shadow' : l.action === 'block' ? 'block' : l.flagged || l.action === 'flag' ? 'flag' : l.action === 'mask' ? 'mask' : '',
    l.who === 'target' ? 'target' : '', l.mark ? 'mark' : ''].filter(Boolean).join(' ');
  const name = l.action === 'system' ? (l.name || 'Hệ thống') : (l.name || 'người chơi');
  const nameEl = h('span', { class: 'n', title: l.accountId || '' }, name);
  if (l.accountId && onName) nameEl.addEventListener('click', () => onName(l.accountId));
  const reasons = why(l.reasons);
  return h('div', { class: cls, title: l.raw ? 'Câu gốc: ' + l.raw : null },
    h('span', { class: 't' }, hhmmss(l.at)), nameEl,
    h('span', { class: 'x' }, l.text),
    l.raw && l.action === 'mask' ? h('span', { class: 'why' }, '(gốc: ', l.raw, ')') : null,
    reasons ? h('span', { class: 'why' }, '· ' + reasons) : null,
    l.shadow ? h('span', { class: 'why' }, '· khoá ẩn, chỉ người gửi thấy') : null,
    l.who === 'reporter' ? h('span', { class: 'why' }, '· người báo cáo') : null);
}
function appendFeed(lines) {
  const feed = $('#feed');
  const only = $('#feedOnlyFlag').checked;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  for (const l of lines) {
    const el = lineEl(l, { onName: openPlayer });
    el.dataset.bad = l.action === 'block' || l.flagged ? '1' : '';
    if (only && !el.dataset.bad) el.hidden = true;
    feed.append(el);
  }
  while (feed.childElementCount > 400) feed.firstElementChild.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}
$('#feedOnlyFlag').addEventListener('change', () => {
  const only = $('#feedOnlyFlag').checked;
  for (const el of $('#feed').children) el.hidden = only && !el.dataset.bad;
});

// ---- map --------------------------------------------------------------------------------------------------------
let roads = null, mapReady = false;
const view = { cx: 0, cz: 0, scale: 0.2 };
let roadLayer = null, roadKey = '';
const canvas = $('#map');
async function initMap() {
  if (mapReady) return;
  mapReady = true;
  try {
    const mod = await import('/admin/mapdata.js');
    roads = mod.ROADS_DT || [];
    $('#mapInfo').textContent = `${roads.length} đoạn đường · lăn chuột để phóng to, kéo để di chuyển`;
  } catch { roads = []; $('#mapInfo').textContent = 'Không tải được bản đồ đường phố (js/mapdata.js).'; }
  resizeMap(true);
}
function resizeMap(fit = false) {
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  if (fit) view.scale = (Math.min(r.width, r.height) / 2) / 1700;
  roadKey = '';
  drawPlayers();
}
window.addEventListener('resize', () => resizeMap());
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function toScreen(x, z) {
  const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
  return [((x - view.cx) * view.scale + canvas.width / dpr / 2) * dpr, ((z - view.cz) * view.scale + canvas.height / dpr / 2) * dpr];
}
function drawRoads() {
  const key = `${canvas.width}x${canvas.height}|${view.cx}|${view.cz}|${view.scale}`;
  if (key === roadKey && roadLayer) return roadLayer;
  roadKey = key;
  roadLayer = roadLayer || document.createElement('canvas');
  roadLayer.width = canvas.width; roadLayer.height = canvas.height;
  const g = roadLayer.getContext('2d');
  g.clearRect(0, 0, roadLayer.width, roadLayer.height);
  const dpr = canvas.width / (canvas.getBoundingClientRect().width || 1);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? css('--road-main') : css('--road');
    g.lineWidth = Math.max(0.6, Math.min(4, view.scale * (pass ? 9 : 5))) * dpr;
    g.beginPath();
    for (const r of roads || []) {
      const main = r.c === 'p' || r.c === 't' || r.c === 's';
      if (!!pass !== main) continue;
      const p = r.pts;
      if (!p || p.length < 2) continue;
      const [x0, y0] = toScreen(p[0][0], p[0][1]);
      g.moveTo(x0, y0);
      for (let i = 1; i < p.length; i++) { const [x, y] = toScreen(p[i][0], p[i][1]); g.lineTo(x, y); }
    }
    g.stroke();
  }
  // play area (PLAY_RADIUS 1588 m)
  const [cx, cy] = toScreen(0, 0);
  g.strokeStyle = css('--muted'); g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = dpr;
  g.beginPath(); g.arc(cx, cy, 1588 * view.scale * dpr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  return roadLayer;
}
function drawPlayers() {
  if (!canvas.width || currentTab !== 'overview') return;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(drawRoads(), 0, 0);
  const dpr = canvas.width / (canvas.getBoundingClientRect().width || 1);
  g.fillStyle = css('--dot');
  g.font = `${12 * dpr}px system-ui, sans-serif`;
  const showNames = view.scale > 0.6;
  for (const p of livePlayers) {
    if (p.x == null) continue;
    const [x, y] = toScreen(p.x, p.z);
    if (x < -10 || y < -10 || x > canvas.width + 10 || y > canvas.height + 10) continue;
    g.beginPath(); g.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); g.fill();
    if (showNames && p.name) { g.fillStyle = css('--ink'); g.fillText(p.name, x + 6 * dpr, y - 6 * dpr); g.fillStyle = css('--dot'); }
  }
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.cx = drag.cx - dx / view.scale; view.cz = drag.cz - dy / view.scale; drawPlayers();
    return;
  }
  const p = nearestPlayer(e);
  const tip = $('#mapTip');
  if (p) { tip.textContent = `${p.name || '?'} · ${Math.round(p.x)}, ${Math.round(p.z)}`; tip.style.left = (e.offsetX + 12) + 'px'; tip.style.top = (e.offsetY + 8) + 'px'; tip.hidden = false; }
  else tip.hidden = true;
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved) { const p = nearestPlayer(e); if (p?.accountId) openPlayer(p.accountId); }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
  const wx = view.cx + mx / view.scale, wz = view.cz + my / view.scale;
  view.scale = Math.max(0.05, Math.min(8, view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
  view.cx = wx - mx / view.scale; view.cz = wz - my / view.scale;
  drawPlayers();
}, { passive: false });
function nearestPlayer(e) {
  const r = canvas.getBoundingClientRect();
  const wx = view.cx + (e.clientX - r.left - r.width / 2) / view.scale, wz = view.cz + (e.clientY - r.top - r.height / 2) / view.scale;
  let best = null, bd = (10 / view.scale) ** 2;
  for (const p of livePlayers) { if (p.x == null) continue; const d = (p.x - wx) ** 2 + (p.z - wz) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

// ---- sanction buttons (reports + player detail) ------------------------------------------------------------------
function actionBar(onAction) {
  const days = h('input', { type: 'number', min: '0', max: '3650', value: '7', title: 'Số ngày cho "Khoá ẩn" / "Cấm" (0 = vĩnh viễn)' });
  const btn = (label, action, cls = '', ask = null) => h('button', { class: cls, onclick: async (ev) => {
    if (ask && !confirm(ask)) return;
    ev.target.disabled = true;
    try { await onAction(action, Number(days.value)); } finally { ev.target.disabled = false; }
  } }, label);
  return h('div', { class: 'actions' },
    btn('Khoá chat 10 phút', 'mute10m'), btn('1 giờ', 'mute1h'), btn('24 giờ', 'mute24h'),
    btn('Khoá chat vĩnh viễn', 'mute_forever', 'danger', 'Khoá chat vĩnh viễn người này?'),
    btn('Khoá ẩn', 'shadow', '', 'Khoá ẩn: người này vẫn gõ được nhưng không ai thấy. Đồng ý?'),
    btn('Đuổi khỏi game', 'kick', 'danger'),
    btn('Cấm vào game', 'ban', 'danger', 'Cấm người này vào game (số ngày ở ô bên cạnh, 0 = vĩnh viễn)?'),
    h('label', { class: 'small' }, 'ngày ', days));
}
const ACTION_DONE = { mute10m: 'Đã khoá chat 10 phút', mute1h: 'Đã khoá chat 1 giờ', mute24h: 'Đã khoá chat 24 giờ', mute_forever: 'Đã khoá chat vĩnh viễn',
  shadow: 'Đã khoá ẩn', kick: 'Đã đuổi khỏi game', ban: 'Đã cấm vào game', warn: 'Đã nhắc nhở', dismiss: 'Đã bỏ qua báo cáo' };

// ---- reports ----------------------------------------------------------------------------------------------------
loaders.reports = async () => {
  const box = $('#reportList');
  try {
    const r = await api('GET', '/admin/api/reports?status=' + $('#reportStatus').value);
    if (!r.reports.length) return clear(box, h('p', { class: 'muted' }, 'Không có báo cáo nào.'));
    clear(box, r.reports.map(reportCard));
  } catch (e) { fail(e); }
};
$('#reportStatus').addEventListener('change', () => loaders.reports());
$('#reportsRefresh').addEventListener('click', () => loaders.reports());
function reportCard(rep) {
  const ctx = (rep.context || []).map((l) => lineEl(l, { onName: openPlayer }));
  const act = async (action, days) => {
    try {
      await api('POST', `/admin/api/reports/${rep.id}/action`, { action, days });
      toast(ACTION_DONE[action] || 'Xong');
      loaders.reports();
    } catch (e) { fail(e); }
  };
  return h('div', { class: 'card report' },
    h('div', { class: 'meta' },
      h('b', {}, '#' + rep.id), h('span', { class: 'muted small' }, dt(rep.at)),
      h('span', { class: 'pill ' + (rep.source === 'player' ? 'warn' : '') }, rep.source === 'player' ? 'người chơi báo cáo' : 'bộ lọc tự đánh dấu'),
      rep.source === 'player' ? h('span', {}, rep.reporter_name || 'ai đó', ' → ') : null,
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); openPlayer(rep.target_id); } }, rep.target_name || rep.target_id),
      h('span', {}, '· ', REPORT_REASON[rep.reason] || 'khác'),
      rep.detail ? h('span', { class: 'muted small' }, '(' + why(rep.detail.split(',')) + ')') : null,
      rep.safety ? h('span', { class: 'pill bad' }, 'AN TOÀN TRẺ EM — xem trước') : null,
      rep.hits > 1 ? h('span', { class: 'pill bad' }, `${rep.hits} lần bị đánh dấu`) : null,
      rep.source === 'player' && !rep.counts ? h('span', { class: 'pill', title: 'Không có bằng chứng người bị báo cáo đã nói gì gần người báo cáo, hoặc tài khoản báo cáo còn quá mới — không tính vào tự động khoá chat' }, 'không tính tự khoá') : null,
      rep.open_on_target > 1 ? h('span', { class: 'pill bad' }, `${rep.open_on_target} báo cáo đang chờ về người này`) : null,
      sanctionPills(rep.sanction)),
    ctx.length ? h('div', { class: 'ctx' }, ctx) : h('p', { class: 'muted small' }, 'Không có dòng chat nào quanh thời điểm báo cáo.'),
    rep.status === 'open'
      ? h('div', { class: 'actions' }, actionBar(act), h('button', { onclick: () => act('dismiss') }, 'Bỏ qua'))
      : h('p', { class: 'muted small' }, `Đã ${rep.status === 'dismissed' ? 'bỏ qua' : 'xử lý'} (${rep.resolution || ''}) lúc ${dt(rep.resolved_at)} bởi ${rep.resolved_by || '?'}`));
}

// ---- players ----------------------------------------------------------------------------------------------------
loaders.players = async () => searchPlayers();
$('#playerSearch').addEventListener('submit', (e) => { e.preventDefault(); searchPlayers(); });
async function searchPlayers() {
  try {
    const r = await api('GET', '/admin/api/players?q=' + encodeURIComponent($('#playerQ').value.trim()));
    const box = $('#playerList');
    if (!r.players.length) return clear(box, h('p', { class: 'muted' }, 'Không tìm thấy ai.'));
    clear(box, r.players.map((p) => h('div', { class: 'prow', onclick: () => openPlayer(p.id) },
      h('span', {}, p.online ? '● ' : '○ ', h('b', {}, p.display_name || '(chưa có nhân vật)'), ' ', h('span', { class: 'muted small' }, p.kind === 'guest' ? 'khách' : 'tài khoản')),
      h('span', {}, p.status !== 'active' ? h('span', { class: 'pill bad' }, p.status) : null, sanctionPills(p.sanction),
        h('span', { class: 'muted small' }, ' ' + fmtPlay(p.play_seconds))))));
  } catch (e) { fail(e); }
}
async function openPlayer(id) {
  if (currentTab !== 'players') openTab('players');
  const box = $('#playerDetail');
  clear(box, h('p', { class: 'muted' }, 'Đang tải…'));
  try {
    const r = await api('GET', '/admin/api/players/' + encodeURIComponent(id));
    const a = r.account;
    const act = async (action, days) => {
      try { await api('POST', `/admin/api/players/${a.id}/sanction`, { action, days }); toast(ACTION_DONE[action] || 'Xong'); openPlayer(a.id); } catch (e) { fail(e); }
    };
    const revoke = async (sid) => { try { await api('POST', `/admin/api/sanctions/${sid}/revoke`); toast('Đã gỡ'); openPlayer(a.id); } catch (e) { fail(e); } };
    const now = Date.now();
    clear(box,
      h('h2', {}, a.display_name || '(chưa có nhân vật)', ' ', r.online ? h('span', { class: 'pill ok' }, 'đang chơi') : h('span', { class: 'pill' }, 'không online')),
      h('p', { class: 'small muted' }, `Mã tài khoản ${a.id} · ${a.kind === 'guest' ? 'khách' : 'tài khoản'} · trạng thái ${a.status} · tạo ${dt(a.created_at)} · lần cuối ${dt(a.last_seen)} · đã chơi ${fmtPlay(a.play_seconds)}`),
      h('div', { class: 'meta' }, sanctionPills(r.sanction), h('span', { class: 'small muted' }, ` chặn ${r.blocks?.blocking ?? 0} người · bị ${r.blocks?.blocked_by ?? 0} người chặn`)),
      actionBar(act),
      h('h3', {}, 'Xử phạt'),
      r.sanctions.length ? h('div', { class: 'scroll-x' }, h('table', {}, h('tr', {}, h('th', {}, 'Lúc'), h('th', {}, 'Loại'), h('th', {}, 'Đến'), h('th', {}, 'Nguồn'), h('th', {}, 'Lý do'), h('th', {}, '')),
        r.sanctions.map((s) => {
          const live = !s.revoked_at && ['mute', 'shadow', 'ban'].includes(s.kind) && (!s.until || new Date(s.until).getTime() > now);
          return h('tr', {}, h('td', {}, dt(s.starts_at)), h('td', {}, KIND_VI[s.kind] || s.kind), h('td', {}, s.until ? dt(s.until) : (['kick', 'warn'].includes(s.kind) ? '—' : 'vĩnh viễn')),
            h('td', {}, SOURCE_VI[s.source] || s.source), h('td', {}, s.reason || ''),
            h('td', {}, s.revoked_at ? h('span', { class: 'muted small' }, 'đã gỡ') : live ? h('button', { onclick: () => revoke(s.id) }, 'Gỡ') : ''));
        }))) : h('p', { class: 'muted small' }, 'Chưa bị xử phạt lần nào.'),
      h('h3', {}, 'Bị báo cáo'),
      r.reports.length ? h('div', { class: 'scroll-x' }, h('table', {}, r.reports.map((x) => h('tr', {}, h('td', {}, dt(x.at)), h('td', {}, x.source === 'player' ? (x.reporter_name || '?') : 'bộ lọc'),
        h('td', {}, REPORT_REASON[x.reason] || ''), h('td', {}, x.status === 'open' ? h('span', { class: 'pill warn' }, 'đang chờ') : (x.resolution || x.status)))))) : h('p', { class: 'muted small' }, 'Không có.'),
      h('h3', {}, 'Chat gần đây'),
      r.chat.length ? h('div', { class: 'ctx' }, r.chat.slice().reverse().map((l) => lineEl({ ...l, name: a.display_name, accountId: null }))) : h('p', { class: 'muted small' }, 'Chưa chat.'));
  } catch (e) { clear(box, h('p', { class: 'muted' }, 'Không tải được.')); fail(e); }
}

// ---- invites ----------------------------------------------------------------------------------------------------
loaders.invites = async () => {
  try {
    const r = await api('GET', '/admin/api/invites');
    const box = $('#inviteBatches');
    if (!r.batches.length) return clear(box, h('p', { class: 'muted' }, 'Chưa có mã mời nào.' + (r.inviteRequired ? ' Người chơi mới cần mã mời để vào.' : '')));
    clear(box, h('div', { class: 'scroll-x' }, h('table', {},
      h('tr', {}, h('th', {}, 'Lô'), h('th', { class: 'num' }, 'Số mã'), h('th', { class: 'num' }, 'Lượt còn / tổng'), h('th', {}, 'Tạo lúc'), h('th', {}, 'Hết hạn'), h('th', {}, 'Ghi chú')),
      r.batches.map((b) => h('tr', {}, h('td', {}, b.batch), h('td', { class: 'num' }, b.codes), h('td', { class: 'num' }, `${b.uses_left} / ${b.uses_total}`),
        h('td', {}, dt(b.created_at)), h('td', {}, b.expires_at ? dt(b.expires_at) + (b.expired ? ' (đã hết)' : '') : 'không'), h('td', {}, b.note || ''))))));
  } catch (e) { fail(e); }
};
$('#inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('POST', '/admin/api/invites', { count: Number(f.get('count')), uses: Number(f.get('uses')), days: Number(f.get('days')), note: f.get('note') || null });
    $('#inviteCodes').value = r.codes.join('\n');
    $('#inviteOut').hidden = false;
    toast(`Đã tạo ${r.codes.length} mã (lô ${r.batch})`);
    loaders.invites();
  } catch (err) { fail(err); }
});
$('#copyCodes').addEventListener('click', async () => {
  const t = $('#inviteCodes');
  try { await navigator.clipboard.writeText(t.value); toast('Đã sao chép'); } catch { t.select(); document.execCommand('copy'); toast('Đã sao chép'); }
});

// ---- notify -----------------------------------------------------------------------------------------------------
$('#broadcastForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = new FormData(e.target).get('text');
  try { await api('POST', '/admin/api/broadcast', { text }); e.target.reset(); toast('Đã gửi thông báo'); } catch (err) { fail(err); }
});
$('#restartForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const minutes = Number(new FormData(e.target).get('minutes'));
  if (!confirm(`Báo cho mọi người chơi: máy chủ khởi động lại sau ${minutes} phút?`)) return;
  try { await api('POST', '/admin/api/restart', { seconds: minutes * 60 }); toast('Đã báo cho người chơi'); } catch (err) { fail(err); }
});
loaders.notify = async () => {
  try {
    const r = await api('GET', '/admin/api/alerts');
    clear($('#alertsBox'),
      h('p', {}, r.enabled ? 'Đang BẬT: cảnh báo được gửi về Telegram.' : 'Đang TẮT. Muốn nhận cảnh báo trên điện thoại: điền TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID trong server/.env rồi khởi động lại máy chủ.'),
      r.recent.length ? h('div', { class: 'scroll-x' }, h('table', {}, r.recent.map((a) => h('tr', {}, h('td', {}, dt(a.at)), h('td', {}, a.kind), h('td', {}, a.text),
        h('td', {}, a.sent ? h('span', { class: 'pill ok' }, 'đã gửi') : h('span', { class: 'pill' }, a.reason === 'rate_limited' ? 'gộp (chống spam)' : a.reason === 'disabled' ? 'chưa bật' : 'lỗi')))))) : h('p', { class: 'muted small' }, 'Chưa có cảnh báo nào.'));
  } catch (e) { fail(e); }
};

// ---- filter -----------------------------------------------------------------------------------------------------
let filterData = null;
const LIST_VI = { profanity: 'Tục nặng (chặn)', mild: 'Chửi nhẹ (che)', sexual: 'Tình dục (chặn)', hate: 'Miệt thị / đe doạ (chặn + hàng chờ)', scam: 'Lừa đảo (chặn + hàng chờ)',
  probe: 'Dò thông tin riêng (hàng chờ)', selfharm: 'Tự hại (hàng chờ + hỗ trợ)', allow: 'Cụm vô hại (bỏ qua)', ambiguous: 'Từ vô hại trùng chữ tục', reserved: 'Tên cấm dùng' };
loaders.filter = async () => {
  try {
    filterData = await api('GET', '/admin/api/filter');
    $('#filterVersion').textContent = 'Phiên bản ' + filterData.version;
    const sel = $('#listName');
    const cur = sel.value || 'profanity';
    clear(sel, filterData.names.map((n) => h('option', { value: n }, LIST_VI[n] || n)));
    sel.value = cur;
    $('#listText').value = filterData.lists[sel.value] || '';
    clear($('#filterAudit'), h('div', { class: 'scroll-x' }, h('table', {}, filterData.audit.map((a) => h('tr', {}, h('td', {}, dt(a.at)), h('td', {}, a.action === 'load' ? 'khởi động' : 'nạp lại'),
      h('td', {}, a.actor), h('td', {}, a.ok ? '' : 'LỖI ' + (a.error || '')),
      h('td', { class: 'small' }, Object.entries(a.changes || {}).map(([k, c]) => `${k}: +${c.nAdded} −${c.nRemoved}`).join(' · ') || 'không đổi'))))));
  } catch (e) { fail(e); }
};
$('#listName').addEventListener('change', () => { if (filterData) $('#listText').value = filterData.lists[$('#listName').value] || ''; });
$('#listSave').addEventListener('click', async () => {
  const name = $('#listName').value;
  if (!confirm(`Lưu danh sách "${LIST_VI[name] || name}"? Bộ lọc áp dụng ngay.`)) return;
  try { const r = await api('PUT', '/admin/api/filter/' + name, { text: $('#listText').value }); $('#listMsg').textContent = 'Đã lưu · phiên bản ' + r.version; loaders.filter(); } catch (e) { fail(e); }
});
$('#filterReload').addEventListener('click', async () => {
  try { const r = await api('POST', '/admin/api/filter/reload'); $('#listMsg').textContent = 'Đã nạp lại · phiên bản ' + r.version; loaders.filter(); } catch (e) { fail(e); }
});
$('#filterTest').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('POST', '/admin/api/filter/test', { text: $('#filterTestInput').value });
    const out = $('#filterTestOut');
    clear(out, h('b', {}, ACTION_VI[r.action] || r.action), r.action === 'mask' ? ` → "${r.text}"` : '', why(r.reasons) ? ` (${why(r.reasons)})` : '', r.support ? ' · gửi lời nhắn hỗ trợ' : '');
  } catch (err) { fail(err); }
});

// ---- netprobe / audit --------------------------------------------------------------------------------------------
loaders.net = async () => {
  try {
    const r = await api('GET', '/admin/api/netprobe');
    const box = $('#netBox');
    if (!r.available || !r.rows.length) return clear(box, h('p', { class: 'muted' }, 'Chưa có dữ liệu đo mạng. Nhờ người chơi mở trang netprobe.html trên điện thoại rồi chọn nhà mạng.'));
    clear(box, h('div', { class: 'scroll-x' }, h('table', {},
      h('tr', {}, h('th', {}, 'Nhà mạng'), h('th', {}, 'Kiểu mạng'), h('th', { class: 'num' }, 'Số lần đo'), h('th', { class: 'num' }, 'Trễ giữa (ms)'), h('th', { class: 'num' }, 'Trễ p95 (ms)'),
        h('th', { class: 'num' }, 'Dao động (ms)'), h('th', { class: 'num' }, 'Mất gói (%)'), h('th', {}, 'Lần cuối')),
      r.rows.map((x) => h('tr', {}, h('td', {}, x.carrier), h('td', {}, x.net), h('td', { class: 'num' }, x.n), h('td', { class: 'num' }, x.medianMs ?? '—'),
        h('td', { class: 'num' }, x.p95Ms ?? '—'), h('td', { class: 'num' }, x.jitterMs ?? '—'), h('td', { class: 'num' }, x.lossPct ?? '—'), h('td', {}, dt(x.lastAt)))))));
  } catch (e) { fail(e); }
};
$('#netRefresh').addEventListener('click', () => loaders.net());
const AUDIT_VI = { login: 'đăng nhập', login_failed: 'đăng nhập SAI', logout: 'đăng xuất', sanction: 'xử phạt', sanction_revoke: 'gỡ xử phạt', report_dismiss: 'bỏ qua báo cáo',
  invites_create: 'tạo mã mời', broadcast: 'gửi thông báo', restart_notice: 'báo khởi động lại', filter_reload: 'nạp lại bộ lọc', filter_save: 'sửa danh sách lọc', alert: 'cảnh báo' };
loaders.audit = async () => {
  try {
    const r = await api('GET', '/admin/api/audit');
    clear($('#auditBox'), h('div', { class: 'scroll-x' }, h('table', {},
      h('tr', {}, h('th', {}, 'Lúc'), h('th', {}, 'Ai'), h('th', {}, 'Việc'), h('th', {}, 'Đối tượng'), h('th', {}, 'Chi tiết'), h('th', {}, 'Từ')),
      r.rows.map((a) => h('tr', {}, h('td', {}, dt(a.at)), h('td', {}, a.actor), h('td', {}, AUDIT_VI[a.action] || a.action), h('td', { class: 'small' }, a.target || ''),
        h('td', { class: 'small' }, a.detail ? JSON.stringify(a.detail) : ''), h('td', { class: 'small' }, a.ip || ''))))));
  } catch (e) { fail(e); }
};
$('#auditRefresh').addEventListener('click', () => loaders.audit());

// ---- boot -------------------------------------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => { if (!document.hidden && liveTimer) tickLive(); });
(async () => {
  try {
    const s = await api('GET', '/admin/api/session');
    if (s.ok) { csrf = s.csrf; showApp(); } else showLogin();
  } catch { showLogin('Không kết nối được máy chủ.'); }
})();
