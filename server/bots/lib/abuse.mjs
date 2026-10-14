// server/bots/lib/abuse.mjs — attack classes for the `abuse` scenario (SPEC §3.4, ARCH §17.3 T7).
// Each class installs hooks on a Bot. The attack starts after the bot has been live (and honest) for WARMUP_MS, or right
// after the socket opens for the handshake attacks. Detection = the server-side signal listed per class, observed by the
// attacking bot; latency = first abusive byte → signal. Result goes to bot.r.abuse = {cls, t0, detected, via, latencyMs,
// sent, extra}. Chat-bypass leaks are judged by the parent from the observers' received-chat logs.
import WebSocket from 'ws';
import { Writer, encodeHello, encodeState, encodePing, encodeChat, decodeS2C } from '../../../js/shared/codec.js';
import { C2S, S2C, SYS, EVENT, CHANNEL, PROTO_VERSION, CHAT_CODE, CLOSE } from '../../../js/shared/protocol.js';
import { MODE, SPEED, NET } from '../../../js/shared/constants.js';
import { packState } from '../../../js/shared/quant.js';
import { ABUSE } from './phrases.mjs';

const WA = new Writer(8192);
const WARMUP_MS = 2000;
const TIMEOUT_MS = 5000;

// class → {weight in the scenario mix, handshake: attack starts at socket open, needsFull: needs real tickets}
export const ABUSE_CLASSES = {
  bad_opcode:      { weight: 8 },
  truncated:       { weight: 6 },
  text_frame:      { weight: 4 },
  oversize:        { weight: 6 },
  flood_ping:      { weight: 6 },
  flood_state:     { weight: 6 },
  chat_spam:       { weight: 6 },
  speed_hack:      { weight: 40 },
  teleport:        { weight: 12 },
  chat_bypass:     { weight: 8, timeoutMs: 30000 },
  forged_ticket:   { weight: 6, handshake: true },
  replayed_ticket: { weight: 6, needsFull: true },
  bad_proto:       { weight: 4, handshake: true },
  no_hello:        { weight: 4, handshake: true, timeoutMs: 13000 },
};
// signals that count as "rejected/closed" per class
const SIG = {
  close: (cls) => ['bad_opcode', 'truncated', 'text_frame', 'oversize', 'flood_ping', 'flood_state', 'chat_spam', 'speed_hack', 'teleport', 'forged_ticket', 'replayed_ticket', 'bad_proto', 'no_hello'].includes(cls),
};

function result(bot, cls) {
  if (!bot.r.abuse) bot.r.abuse = { cls, t0: 0, detected: false, via: null, latencyMs: null, sent: 0, extra: {} };
  return bot.r.abuse;
}
function detect(bot, via) {
  const a = bot.r.abuse;
  if (!a || a.detected || !a.t0) return;
  a.detected = true; a.via = via; a.latencyMs = Math.round((performance.now() - a.t0) * 10) / 10;
}
function finish(bot) {
  if (bot._abuseDone) return;
  bot._abuseDone = true;
  setTimeout(() => bot.stop(), 300);
}

export function installAbuse(bot, cls) {
  const a = result(bot, cls);
  const def = ABUSE_CLASSES[cls] || {};
  const timeout = def.timeoutMs || TIMEOUT_MS;
  const begin = () => {
    a.t0 = performance.now();
    setTimeout(() => finish(bot), timeout);
  };
  // generic: server close / kick
  bot.onCloseHook = (b, code) => {
    if (a.t0 && SIG.close(cls) && code !== CLOSE.NORMAL) detect(b, 'close' + code);
    if (a.t0) { a.extra.closeCode = code; finish(b); return false; }
    return undefined;
  };
  bot.onMessageHook = (b, m) => {
    if (!a.t0) return false;
    if (m.op === S2C.SYSTEM) {
      a.extra['sys' + m.code] = (a.extra['sys' + m.code] || 0) + 1;
      if (m.code === SYS.KICK || m.code === SYS.AUTH_FAILED || m.code === SYS.RELOAD || m.code === SYS.BANNED || m.code === SYS.MUTED) detect(b, 'system' + m.code);
    } else if (m.op === S2C.CORRECT && (cls === 'speed_hack' || cls === 'teleport')) detect(b, 'correct' + m.reason);
    else if (m.op === S2C.EVENT && m.type === EVENT.CHAT_REJECTED) {
      if (cls === 'chat_spam') detect(b, 'chat_rejected' + m.args[0]);
      if (cls === 'chat_bypass') {
        a.extra.rejected = (a.extra.rejected || 0) + 1;
        a.extra['code' + m.args[0]] = (a.extra['code' + m.args[0]] || 0) + 1;
        const t = b._bypassSent?.shift();
        if (t !== undefined && performance.now() - t <= 1000) a.extra.rejectedWithin1s = (a.extra.rejectedWithin1s || 0) + 1;
        detect(b, 'chat_rejected' + m.args[0]);
      }
    } else if (m.op === S2C.PONG && cls === 'flood_ping') a.extra.pongs = (a.extra.pongs || 0) + 1;
    return false;
  };

  if (def.handshake) {
    bot.s.abuseOnOpen = (b, ticket) => {
      begin();
      if (cls === 'forged_ticket') {
        const fake = Buffer.from(Array.from({ length: 32 }, () => Math.floor(b.rand() * 256))).toString('base64url');
        b.sendRaw(encodeHello(WA, { ticket: fake }));
      } else if (cls === 'bad_proto') {
        b.sendRaw(encodeHello(WA, { proto: PROTO_VERSION + 98, ticket: ticket || 'x' }));
      } else if (cls === 'no_hello') {
        /* send nothing: the server must close after NET.HELLO_TIMEOUT_S */
      }
      a.sent = 1;
    };
    return;
  }

  // attacks that start once the bot is live and has been honest for WARMUP_MS
  bot.onLiveHook = (b) => {
    if (a.t0 || b._abuseArmed) return;
    b._abuseArmed = true;
    setTimeout(() => { if (b.state === 'live' && !b.stopped) attack(b, cls, a, begin); }, WARMUP_MS);
  };
}

function attack(b, cls, a, begin) {
  begin();
  const raw = (bytes) => { if (b.ws && b.ws.readyState === 1) { b.ws.send(bytes); a.sent++; b.r.txBytes += bytes.length; } };
  switch (cls) {
    case 'bad_opcode': {
      let i = 0;
      const t = setInterval(() => { if (i++ >= 30 || !b.ws) return clearInterval(t); raw(Uint8Array.from([0x7f, i, 2, 3])); }, 10);
      break;
    }
    case 'truncated': {
      let i = 0;
      const t = setInterval(() => { if (i++ >= 30 || !b.ws) return clearInterval(t); raw(Uint8Array.from([C2S.STATE, 1, 2, 3, 4])); }, 10);
      break;
    }
    case 'text_frame': {
      let i = 0;
      const t = setInterval(() => { if (i++ >= 30 || !b.ws) return clearInterval(t); if (b.ws?.readyState === 1) { b.ws.send('{"op":"hello"}'); a.sent++; } }, 10);
      break;
    }
    case 'oversize': raw(new Uint8Array(NET.MAX_C2S_BYTES * 8).fill(C2S.CHAT)); break;
    case 'flood_ping': case 'flood_state': case 'chat_spam': {
      // 1,000 msg/s for up to TIMEOUT_MS: 20 messages every 20 ms
      let n = 0;
      const t = setInterval(() => {
        if (!b.ws || b._abuseDone || n >= 5000) return clearInterval(t);
        for (let k = 0; k < 20; k++, n++) {
          if (cls === 'flood_ping') raw(encodePing(WA, (Math.floor(performance.now()) + k) >>> 0));
          else if (cls === 'flood_state') raw(encodeState(WA, b.stateMsg()));
          else raw(encodeChat(WA, CHANNEL.SAY, 'spam ' + n));
        }
        if (cls === 'flood_ping' && performance.now() - a.t0 >= 1000 && !a.extra.pongRatio1s) {
          a.extra.pongRatio1s = Math.round(((a.extra.pongs || 0) / Math.max(1, a.sent)) * 1000) / 1000;
          if (a.extra.pongRatio1s < 0.1) detect(b, 'pong_dropped');
        }
      }, 20);
      break;
    }
    case 'speed_hack': {
      // walk mode at 3× walking speed in a straight line (toward the city centre)
      const dir = Math.atan2(-b.x, -b.z);
      b.tickHook = (bb, now, dt) => {
        const v = SPEED.walk * 3;
        bb.x += Math.sin(dir) * v * dt; bb.z += Math.cos(dir) * v * dt; bb.yaw = dir; bb.v = v; bb.mode = MODE.WALK;
        if (now >= bb.nextStateAt) { raw(encodeState(WA, bb.stateMsg({ state: packState(MODE.WALK, 0) }))); bb.nextStateAt = now + 1000 / 15; }
        return true;
      };
      break;
    }
    case 'teleport': {
      const d = 300, dir = Math.atan2(-b.x, -b.z);
      b.x += Math.sin(dir) * d; b.z += Math.cos(dir) * d;
      b.v = 0;
      b.tickHook = (bb, now) => {
        if (now >= bb.nextStateAt) { raw(encodeState(WA, bb.stateMsg())); bb.nextStateAt = now + 500; }
        return true;
      };
      raw(encodeState(WA, b.stateMsg()));
      break;
    }
    case 'chat_bypass': {
      b._bypassSent = [];
      a.extra.lines = [];
      let i = Math.floor(b.rand() * ABUSE.length);
      const sendOne = () => {
        if (!b.ws || b._abuseDone) return;
        const line = ABUSE[i++ % ABUSE.length];
        b._bypassSent.push(performance.now());
        a.extra.lines.push(line);
        raw(encodeChat(WA, CHANNEL.SAY, line));
      };
      sendOne();
      const t = setInterval(() => { if (!b.ws || b._abuseDone) return clearInterval(t); sendOne(); }, 2200);
      break;
    }
    case 'replayed_ticket': {
      const ticket = b.ticketForReplay;
      if (!ticket) { a.extra.skipped = 'no ticket (ping mode)'; break; }
      const ws2 = new WebSocket(b.s.wsUrl, { perMessageDeflate: false, headers: b.s.origin ? { origin: b.s.origin } : {} });
      ws2.binaryType = 'nodebuffer';
      ws2.on('open', () => { ws2.send(encodeHello(WA, { ticket })); a.sent++; });
      ws2.on('message', (data) => {
        const m = decodeS2C(data);
        if (m.op === S2C.SYSTEM && (m.code === SYS.AUTH_FAILED || m.code === SYS.KICK)) detect(b, 'replay_system' + m.code + ':' + m.arg);
        else if (m.op === S2C.WELCOME) a.extra.replayAccepted = true;
      });
      ws2.on('close', (code) => { if (!a.extra.replayAccepted && code !== CLOSE.NORMAL) detect(b, 'replay_close' + code); });
      ws2.on('error', () => {});
      setTimeout(() => { try { ws2.terminate(); } catch { /* ignore */ } }, TIMEOUT_MS);
      break;
    }
    default: break;
  }
}

export { CHAT_CODE };
