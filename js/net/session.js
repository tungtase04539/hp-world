// js/net/session.js — tài khoản + vé vào game qua HTTP API của máy chủ (MP-2 C1). Không import three.
//
// API máy chủ (docs/multiplayer/SERVER.md §2.2): POST /v1/auth/guest {nickname, deviceId, inviteCode, appearance}
//   → {accessToken, accessExpiresIn, refreshToken, refreshExpiresAt, recoveryCode, account}; /v1/auth/refresh
//   {refreshToken} (XOAY VÒNG mỗi lần dùng); /v1/auth/recover {code, deviceId}; /v1/join {accessToken, proto, tier}
//   → {ticket, spawnHint} | {queue: {position, etaS, retryAfterS}}.
// Lưu trên máy người chơi (localStorage, KHÔNG BAO GIỜ commit/ghi log): `hp3d.device` (mã thiết bị ngẫu nhiên) và
// `hp3d.mp.v1` = { [gốc máy chủ]: {refreshToken, account} }. Access token chỉ trong RAM (15 phút).
// Mọi hàm KHÔNG ném lỗi: trả {ok:false, error:<mã API | 'network' | 'timeout'>, ...}.
import { PROTO_VERSION } from '../shared/protocol.js';

const STORE = 'hp3d.mp.v1';
const DEVICE = 'hp3d.device';
const TIMEOUT_MS = 10000;

function readStore() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } }
function writeStore(o) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { } }

function randomId(n) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(n);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0; }
  let s = '';
  for (let i = 0; i < n; i++) s += A[b[i] % A.length];
  return s;
}
export function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE);
    if (!d || !/^[A-Za-z0-9_-]{8,64}$/.test(d)) { d = 'web-' + randomId(20); localStorage.setItem(DEVICE, d); }
    return d;
  } catch (e) { return 'web-' + randomId(20); }
}
// 8 byte ngoại hình ngẫu nhiên (16 hex) — máy chủ lưu, gửi trong SNAPSHOT ENTER; js/net/remote_avatars.js diễn giải.
export function randomAppearance() {
  const b = new Uint8Array(8);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 8; i++) b[i] = (Math.random() * 256) | 0; }
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function createSession(cfg) {
  const base = cfg.http;
  const key = cfg.origin;
  let saved = readStore()[key] || null;           // {refreshToken, account}
  let access = null;                              // {token, exp (performance.now ms)}
  let refreshing = null;

  function save(rt, account) {
    const all = readStore();
    if (rt) { saved = { refreshToken: rt, account: account || (saved && saved.account) || null }; all[key] = saved; }
    else { saved = null; delete all[key]; }
    writeStore(all);
  }

  async function post(path, body) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ac ? setTimeout(() => ac.abort(), TIMEOUT_MS) : 0;
    try {
      const r = await fetch(base + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: ac ? ac.signal : undefined, cache: 'no-store', credentials: 'omit',
      });
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      const ra = +(r.headers.get('retry-after') || 0) || (j && j.retryAfterS) || 0;
      if (r.ok && j) return { ok: true, status: r.status, body: j };
      return { ok: false, status: r.status, error: (j && j.error) || ('http_' + r.status), reason: j && j.reason, retryAfterS: ra, body: j || {} };
    } catch (e) {
      return { ok: false, status: 0, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally { if (tm) clearTimeout(tm); }
  }

  function keepAccess(b) {
    access = { token: b.accessToken, exp: performance.now() + (Number(b.accessExpiresIn) || 900) * 1000 };
  }

  async function refresh() {
    if (!saved || !saved.refreshToken) return { ok: false, error: 'no_account' };
    if (refreshing) return refreshing;
    refreshing = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await post('/v1/auth/refresh', { refreshToken: saved.refreshToken });
        if (r.ok) {
          keepAccess(r.body);
          save(r.body.refreshToken || saved.refreshToken, r.body.account || saved.account);
          return { ok: true, account: saved.account };
        }
        if (r.error === 'refresh_race') { await new Promise((res) => setTimeout(res, 800)); continue; }
        // refresh hỏng hẳn (bị thu hồi / dùng lại / hết hạn) → tài khoản trên máy này mất: cần mã khôi phục
        if (r.status === 401) save(null);
        return r;
      }
      return { ok: false, error: 'refresh_race' };
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }

  async function ensureAccess() {
    if (access && access.exp - performance.now() > 60000) return { ok: true, token: access.token };
    const r = await refresh();
    return r.ok ? { ok: true, token: access.token } : r;
  }

  return {
    get hasAccount() { return !!(saved && saved.refreshToken); },
    get account() { return saved ? saved.account : null; },
    get displayName() { return saved && saved.account ? saved.account.displayName : ''; },
    get hasAccess() { return !!(access && access.exp - performance.now() > 60000); },
    // Tạo tài khoản khách (biệt danh + mã mời). Trả recoveryCode — CHỈ hiện một lần.
    async guest(nickname, inviteCode) {
      const body = { nickname: String(nickname || '').trim(), deviceId: deviceId(), appearance: randomAppearance() };
      const inv = String(inviteCode || '').trim();
      if (inv) body.inviteCode = inv;
      const r = await post('/v1/auth/guest', body);
      if (!r.ok) return r;
      keepAccess(r.body);
      save(r.body.refreshToken, r.body.account);
      return { ok: true, recoveryCode: r.body.recoveryCode, account: r.body.account };
    },
    async recover(code) {
      const r = await post('/v1/auth/recover', { code: String(code || ''), deviceId: deviceId() });
      if (!r.ok) return r;
      keepAccess(r.body);
      save(r.body.refreshToken, r.body.account);
      return { ok: true, account: r.body.account };
    },
    refresh, ensureAccess,
    // Xin vé vào (hoặc vị trí hàng chờ). tier = TIER đồ hoạ (máy chủ chỉ ghi nhận).
    async join(tier) {
      let a = await ensureAccess();
      if (!a.ok) return a;
      let r = await post('/v1/join', { accessToken: a.token, proto: PROTO_VERSION, tier: tier | 0 });
      if (!r.ok && r.status === 401) {                  // access hết hạn sớm (máy chủ khởi động lại với khoá mới…) → làm mới 1 lần
        access = null;
        a = await ensureAccess();
        if (!a.ok) return a;
        r = await post('/v1/join', { accessToken: a.token, proto: PROTO_VERSION, tier: tier | 0 });
      }
      if (!r.ok) return r;
      if (r.body.queue) return { ok: true, queue: r.body.queue };
      if (!r.body.ticket) return { ok: false, error: 'bad_response' };
      return { ok: true, ticket: r.body.ticket, spawnHint: r.body.spawnHint || null, serverTime: r.body.serverTime };
    },
    forget() { access = null; save(null); },
  };
}
