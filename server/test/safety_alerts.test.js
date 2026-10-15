// S3 — owner alerts (Telegram): no-op when unset, rate limits + coalescing, never logs the bot token, bus wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlerts, register, ALERT_POLICY } from '../src/alerts.js';
import { fakeClock, recordingBus } from './helpers/safety.mjs';

const TOKEN = '123456:SECRET-bot-token-value-xyz';
const cfg = (on = true) => ({ env: 'production', dataDir: '.', secrets: { telegramBotToken: on ? TOKEN : '', telegramChatId: on ? '-100777' : '' } });

function fakeFetch({ fail = false } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (fail) throw new Error('network down ' + url);
    return { ok: true, status: 200 };
  };
  fn.calls = calls;
  return fn;
}
function captureLog() {
  const lines = [];
  const rec = (level) => (msg, fields) => lines.push(JSON.stringify({ level, msg, ...fields }));
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug'), child() { return this; } };
}

test('disabled when TELEGRAM_* is unset: no network, recorded as "disabled"', async () => {
  const f = fakeFetch();
  const a = createAlerts({ config: cfg(false), fetch: f });
  assert.equal(a.enabled, false);
  assert.equal(await a.send('report', 'x'), false);
  assert.equal(f.calls.length, 0);
  assert.equal(a.recent()[0].reason, 'disabled');
});

test('sends to the Bot API; per-kind gap, coalescing, hourly cap', async () => {
  const f = fakeFetch();
  const now = fakeClock(1_000_000);
  const a = createAlerts({ config: cfg(), fetch: f, now });
  assert.equal(await a.send('report', 'Báo cáo mới #1'), true);
  assert.equal(f.calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(f.calls[0].body.chat_id, '-100777');
  assert.match(f.calls[0].body.text, /Báo cáo mới #1/);
  assert.equal(await a.send('report', 'Báo cáo mới #2'), false);   // < 60 s
  assert.equal(await a.send('report', 'Báo cáo mới #3'), false);
  assert.equal(await a.send('automute', 'tự khoá'), true);          // other kind
  assert.equal(await a.send('selfharm', 'a'), true);                // no gap for self-harm
  assert.equal(await a.send('selfharm', 'b'), true);
  now.advance(ALERT_POLICY.KIND_GAP_MS + 1);
  assert.equal(await a.send('report', 'Báo cáo mới #4'), true);
  assert.match(f.calls.at(-1).body.text, /\+2 cảnh báo cùng loại đã gộp/);
  // hourly cap
  let sent = 0;
  for (let i = 0; i < 60; i++) { if (await a.send('crash', 'c' + i)) sent++; }
  assert.ok(sent <= ALERT_POLICY.MAX_PER_HOUR - 5, String(sent));
  now.advance(3_600_001);
  assert.equal(await a.send('crash', 'sau một giờ'), true);
  assert.ok(a.recent().length <= 50);
});

test('a failing request never throws and never logs the bot token', async () => {
  const log = captureLog();
  const a = createAlerts({ config: cfg(), fetch: fakeFetch({ fail: true }), log });
  assert.equal(await a.send('backup', 'Sao lưu lỗi'), false);
  assert.ok(log.lines.length >= 1);
  assert.ok(!log.lines.join('\n').includes(TOKEN), 'token leaked into logs');
  assert.ok(!log.lines.join('\n').includes('SECRET'));
  assert.equal(a.recent()[0].reason, 'error');
});

test('register(): bus alert / degrade ≥ L2 / start / stop are forwarded', async () => {
  const bus = recordingBus();
  const provided = {};
  const stops = [];
  const app = {
    config: { env: 'test', dataDir: '.', secrets: { telegramBotToken: '', telegramChatId: '' } },
    log: captureLog(), bus, provide: (n, v) => { provided[n] = v; }, onStop: (fn) => stops.push(fn),
  };
  register(app);
  const al = provided.alerts;
  bus.emit('start', { ports: { game: 1 } });
  bus.emit('alert', { kind: 'backup', text: 'Sao lưu đêm qua lỗi' });
  bus.emit('degrade', { level: 1, prev: 0 });
  bus.emit('degrade', { level: 2, prev: 1 });
  bus.emit('degrade', { level: 3, prev: 2 });   // already ≥ 2: no new alert
  bus.emit('stop', { reason: 'test' });
  await new Promise((r) => setTimeout(r, 10));
  const kinds = al.recent().map((x) => x.kind).reverse();
  assert.deepEqual(kinds, ['start', 'backup', 'degrade', 'stop']);
});
