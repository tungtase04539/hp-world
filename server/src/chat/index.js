// chat/index.js — OWNER: S3. "Free chat, strict control" (SPEC §3.3).
//
// Service contract (FINAL — the gateway (S2) calls exactly this; S3 replaces the implementation):
//   createChat({ db, log, alerts, config, metrics, bus }) → chat
//   chat.handle(session, channel, text) → Promise<{ ok, deliverText, shadow, reason, code }>
//       session  { accountId, netId, displayName, playSeconds, … } (S2's session object; S3 reads only these fields)
//       ok           deliver to recipients (SAY: within CHAT.RADIUS m, chosen by the gateway from the AOI grid)
//       deliverText  text to send (normalised / masked)
//       shadow       true → deliver ONLY back to the sender (shadow-mute)
//       reason       machine reason ('rate', 'duplicate', 'blocked', 'muted', …) for logs
//       code         CHAT_CODE (js/shared/protocol.js) for EVENT CHAT_REJECTED when !ok
//   chat.report(reporterSession, targetAccountId, reason, chatRef) → Promise<{ ok, code }>     (REPORT_CODE)
//   chat.isMuted(accountId) → boolean (sync, cached)
//   chat.nicknameCheck(name) → { ok, reason }   (textfilter + brands + reserved names)
//   chat.blocks(accountId) → Set<accountId> | null   (per-player block list; gateway skips delivery)
//
// FOUNDATION STUB: textfilter-only, no rate limits, no persistence. register() provides service 'chat'.
import { filterChat, checkNickname } from '../../../js/shared/textfilter.js';
import { CHANNEL, CHAT_CODE, REPORT_CODE } from '../../../js/shared/protocol.js';

export function createChat({ log } = {}) {
  void log;
  return {
    async handle(session, channel, text) {
      if (channel !== CHANNEL.SAY) return { ok: false, deliverText: '', shadow: false, reason: 'channel', code: CHAT_CODE.CHANNEL };
      const f = filterChat(text);
      if (!f.ok) {
        const code = f.reasons.includes('empty') ? CHAT_CODE.EMPTY : f.reasons.includes('too_long') ? CHAT_CODE.TOO_LONG : CHAT_CODE.BLOCKED;
        return { ok: false, deliverText: '', shadow: false, reason: f.reasons[0] || 'blocked', code };
      }
      return { ok: true, deliverText: f.text, shadow: false, reason: null, code: CHAT_CODE.OK };
    },
    async report() { return { ok: false, code: REPORT_CODE.RATE }; },
    isMuted() { return false; },
    nicknameCheck: (name) => checkNickname(name),
    blocks() { return null; },
  };
}

export function register(app) {
  app.provide('chat', createChat({
    db: app.db, log: app.log.child({ mod: 'chat' }), alerts: app.has('alerts') ? app.get('alerts') : null,
    config: app.config, metrics: app.metrics, bus: app.bus,
  }));
}
