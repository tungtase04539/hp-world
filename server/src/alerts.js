// alerts.js — OWNER: S3. Owner alerts via Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in server/.env); a no-op
// (logged only) when unset. Rate-limited so a flood of reports or a crash loop cannot spam the owner's phone.
//
// Service contract (FINAL): createAlerts({ config, log, fetch?, now? }) → alerts
//   alerts.enabled                       boolean (Telegram configured)
//   alerts.send(kind, text) → Promise<boolean>     true = delivered to Telegram now
//     kind: 'report' | 'automute' | 'flag' | 'selfharm' | 'start' | 'stop' | 'crash' | 'degrade' | 'backup' | 'restart' | …
//   alerts.recent() → last 50 alerts (also the suppressed ones) for the admin page
//
// Rate limits: per kind one message per KIND_GAP_MS (default 60 s; 'selfharm' / 'crash' / 'backup' 0 s), at most
// MAX_PER_HOUR (30) overall. Suppressed alerts are counted and summarised in the next message of that kind.
// Wiring (register): bus 'alert' {kind, text} → send; 'start' → "máy chủ đã chạy" (+ "khởi động lại sau sự cố" when the
// previous run did not stop cleanly: <dataDir>/run.marker); 'stop' → "máy chủ dừng"; 'degrade' {level ≥ 2} → alert.
import fs from 'node:fs';
import path from 'node:path';

export const ALERT_POLICY = Object.freeze({
  KIND_GAP_MS: 60_000,
  KIND_GAP_OVERRIDE: Object.freeze({ selfharm: 0, crash: 0, backup: 0, start: 0, stop: 0, degrade: 300_000 }),
  MAX_PER_HOUR: 30,
  TIMEOUT_MS: 5000,
  MAX_TEXT: 1000,
});

export function createAlerts({ config, log, fetch: fetchFn = globalThis.fetch, now = () => Date.now(), policy = ALERT_POLICY } = {}) {
  const token = config?.secrets?.telegramBotToken || '';
  const chatId = config?.secrets?.telegramChatId || '';
  const enabled = !!(token && chatId);
  const lastByKind = new Map();
  const suppressed = new Map();
  const sentTimes = [];
  const history = [];
  const prefix = config?.env === 'production' ? '' : `[${config?.env || 'dev'}] `;

  const remember = (e) => { history.push(e); if (history.length > 50) history.shift(); };

  async function post(text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(policy.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`telegram http ${res.status}`);
    return true;
  }

  return {
    enabled,
    recent: () => history.slice().reverse(),
    async send(kind, text) {
      const t = now();
      kind = String(kind || 'info').slice(0, 32);
      text = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, policy.MAX_TEXT);
      const entry = { at: new Date(t).toISOString(), kind, text, sent: false, reason: null };
      remember(entry);
      if (!enabled) { entry.reason = 'disabled'; log?.info('alert (Telegram not configured)', { kind, text }); return false; }
      const gap = policy.KIND_GAP_OVERRIDE[kind] ?? policy.KIND_GAP_MS;
      const last = lastByKind.get(kind);
      while (sentTimes.length && t - sentTimes[0] > 3_600_000) sentTimes.shift();
      if ((last != null && t - last < gap) || sentTimes.length >= policy.MAX_PER_HOUR) {
        suppressed.set(kind, (suppressed.get(kind) || 0) + 1);
        entry.reason = 'rate_limited';
        return false;
      }
      lastByKind.set(kind, t);
      sentTimes.push(t);
      const n = suppressed.get(kind) || 0;
      suppressed.delete(kind);
      const body = `${prefix}Hải Phòng 3D — ${text}${n ? ` (+${n} cảnh báo cùng loại đã gộp)` : ''}`;
      try {
        await post(body);
        entry.sent = true;
        return true;
      } catch (e) {
        entry.reason = 'error';
        // never log the URL / token (an error message may quote the request URL)
        log?.warn('alert send failed', { kind, err: String(e?.message || e).split(token).join('[token]').split(chatId).join('[chat]') });
        return false;
      }
    },
  };
}

export function register(app) {
  const log = app.log.child({ mod: 'alerts' });
  const alerts = createAlerts({ config: app.config, log });
  app.provide('alerts', alerts);
  const send = (k, t) => alerts.send(k, t).catch(() => {});

  // crash detection: a marker file lives while the server runs; still there at the next start = unclean stop
  const marker = app.config.env === 'test' ? null : path.join(app.config.dataDir, 'run.marker');
  app.bus.on('start', ({ ports } = {}) => {
    let crashed = false;
    if (marker) {
      try { crashed = fs.existsSync(marker); fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, String(Date.now())); } catch { /* read-only FS */ }
    }
    if (crashed) send('crash', 'Máy chủ vừa KHỞI ĐỘNG LẠI sau một lần dừng bất thường (sập hoặc mất điện). Kiểm tra nhật ký.');
    else send('start', `Máy chủ đã chạy (cổng game ${ports?.game ?? '?'}).`);
  });
  app.bus.on('stop', ({ reason } = {}) => { send('stop', `Máy chủ đang dừng (${reason || 'stop'}).`); });
  app.onStop(() => { if (marker) { try { fs.rmSync(marker, { force: true }); } catch { /* ignore */ } } });
  app.bus.on('degrade', ({ level, prev } = {}) => {
    if (level >= 2 && !(prev >= 2)) send('degrade', `Máy chủ quá tải: giảm chất lượng mức L${level}. Xem trang quản trị.`);
  });
  app.bus.on('alert', ({ kind, text } = {}) => send(kind || 'info', text || ''));
}
