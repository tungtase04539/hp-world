// server/bots/lib/bot.mjs — one headless player. Speaks the real wire protocol through js/shared/codec.js (no Chrome).
//
// Connection modes
//   full : POST /v1/auth/guest (or /refresh with cached creds) → POST /v1/join → WS /play HELLO{ticket} → WELCOME →
//          READY → snapshots. Queue answers are honoured. Resume = HELLO{RESUME, resumeToken} within 60 s.
//   ping : foundation stub (auth answers 501): WS /play, HELLO (→ SYSTEM NOT_IMPLEMENTED), then the same STATE / PING /
//          CHAT traffic so the transport + decode path is loaded exactly like a real client would load it.
// Behaviours: road (walk/run/moto on the ROADS_DT graph), plaza (ride to a target, then wander on foot around it),
// idle, and the abuse classes (abuse.mjs). Every bot reports into the worker-wide stats object `W` plus its own record.
import WebSocket from 'ws';
import {
  Writer, encodeHello, encodeReady, encodeState, encodePing, encodeChat, decodeS2C,
} from '../../../js/shared/codec.js';
import { S2C, SYS, CLOSE, CHANNEL, EVENT, PROTO_VERSION, SNAP_FLAG, CHAT_CODE } from '../../../js/shared/protocol.js';
import { MODE, SPEED, ACCEL, MODE_VMAX, STATE_HZ_MOVING, STATE_HZ_IDLE, AOI, PING_FAST_S } from '../../../js/shared/constants.js';
import { packState } from '../../../js/shared/quant.js';
import { ClockSync } from '../../../js/shared/clock.js';
import { pickSpawn } from '../../../js/shared/spawns.js';
import { Walker, isWater, groundHeight } from './roadgraph.mjs';
import { NetemQueue } from './netem.mjs';
import { CLEAN, NICKS } from './phrases.mjs';

const W8 = new Writer(1024);      // one writer per process: ws copies on send (client frames are masked into a new buffer)
const SPEED_MUL = 0.9;            // honest bots stay 10 % under the mode's max speed
const SWITCH_SETTLE_MS = 1200;    // after slowing for a slower mode, wait > the 1 s validation window before switching

export class Bot {
  constructor(spec, ctx) {
    this.s = spec; this.ctx = ctx; this.W = ctx.W; this.rand = ctx.rand;
    this.r = {                       // per-bot record (sent to the parent at the end)
      idx: spec.idx, behavior: spec.behavior, netId: -1, netIds: [], connects: 0, connectFails: 0, reconnects: 0,
      resumeOk: 0, resumeFail: 0, corrects: 0, correctReasons: {}, rxBytes: 0, txBytes: 0, connectedMs: 0,
      peak5sBps: 0, maxRecords: 0, maxVisible: 0, decodeErrors: 0, closes: {}, queued: 0, snaps: 0,
      chatSent: 0, chatRejected: 0, abuse: null, lastError: null, netem: !!spec.netem,
    };
    this.ws = null; this.state = 'idle';      // idle | auth | join | queue | open | hello | live | wait | done
    this.creds = spec.creds || null;          // {refreshToken, accessToken?}
    this.t0 = performance.now();
    this.mode = MODE.WALK; this.pendingMode = -1; this.slowSince = 0;
    this.v = 0; this.vTarget = 0;
    this.seq = 0; this.corrEpoch = 0;
    this.nextStateAt = 0; this.nextPingAt = 0; this.nextChatAt = 0; this.nextLegAt = 0; this.dropAt = Infinity;
    this.idleUntil = 0; this.liveSince = 0; this.lastTick = 0;
    this.slots = new Map();
    this.clock = new ClockSync();
    this.pings = new Map();   // clientTime u32 → local send time
    this.win = [0, 0, 0, 0, 0]; this.winI = 0; this.secBytes = 0;
    this.resumeToken = null; this.wantResume = false; this.reconnectAt = 0; this.backoffMs = 1000;
    this.walker = null; this.x = 0; this.z = 0; this.y = 2; this.yaw = 0;
    this.plaza = null;        // {x, z, r, tx, tz} when wandering on foot around a point
    this.recv = null;         // abuse scenario: received chat log
    this.onMessageHook = null; this.onLiveHook = null; this.onCloseHook = null;   // abuse.mjs hooks
    this.netemOut = null; this.netemIn = null;
    this.stopped = false;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // connection
  // ---------------------------------------------------------------------------------------------------------------
  async start() {
    if (this.stopped) return;
    const W = this.W;
    try {
      let ticket = '';
      if (this.s.mode === 'full' && !this.wantResume) {
        ticket = await this._authAndJoin();
        if (ticket == null) return;            // queued / failed → retry already scheduled
      }
      this._open(ticket);
    } catch (e) {
      W.err(e.code || e.message);
      this.r.lastError = String(e.message || e);
      this.r.connectFails++; W.c.connectFail++;
      this._scheduleReconnect();
    }
  }

  async _http(path, body) {
    const W = this.W;
    const t = performance.now();
    const res = await fetch(this.s.httpUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.s.origin ? { origin: this.s.origin } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    let j = null;
    try { j = await res.json(); } catch { /* non-JSON */ }
    W.httpMs.add(performance.now() - t);
    W.bump(W.http, path + ' ' + res.status);
    return { status: res.status, body: j || {}, headers: res.headers };
  }

  async _authAndJoin() {
    const W = this.W;
    this.state = 'auth';
    const t0 = performance.now();
    // like a real client: keep the 15-minute access token and re-poll /v1/join with it (queue, reconnects) instead of
    // rotating the refresh token on every attempt (integration: 800 queued bots refreshed ~160 times/s in `stress`)
    let access = this.access && this.access.exp - performance.now() > 60000 ? this.access.token : null;
    const keep = (tok, expS) => { this.access = { token: tok, exp: performance.now() + (Number(expS) || 900) * 1000 }; };
    if (!access && this.creds?.refreshToken) {
      const r = await this._http('/v1/auth/refresh', { refreshToken: this.creds.refreshToken });
      if (r.status === 200 && r.body.accessToken) {
        access = r.body.accessToken;
        keep(access, r.body.accessExpiresIn);
        this.creds = { ...this.creds, refreshToken: r.body.refreshToken || this.creds.refreshToken };
        W.c.authRefresh++;
      }
    }
    if (!access) {
      const nick = NICKS[this.s.idx % NICKS.length] + (this.s.idx % 10000);
      const r = await this._http('/v1/auth/guest', { nickname: nick, deviceId: this.s.deviceId, inviteCode: this.s.invite || undefined });
      if (r.status !== 200 && r.status !== 201) {
        const ra = +(r.headers.get('retry-after') || 0);
        throw Object.assign(new Error(`guest ${r.status} ${r.body.error || ''}`), { code: 'guest_' + r.status, retryAfterS: ra });
      }
      access = r.body.accessToken;
      keep(access, r.body.accessExpiresIn);
      this.creds = { refreshToken: r.body.refreshToken, deviceId: this.s.deviceId, account: r.body.account?.id ?? null, displayName: r.body.account?.displayName ?? nick };
      W.c.authGuest++;
    }
    W.authMs.add(performance.now() - t0);
    this.state = 'join';
    const tj = performance.now();
    const j = await this._http('/v1/join', { accessToken: access, proto: PROTO_VERSION, tier: this.s.tier ?? 2 });
    W.joinMs.add(performance.now() - tj);
    const q = j.body.queue || (j.body.position != null ? j.body : null);
    if (q && !j.body.ticket) {
      this.state = 'queue'; this.r.queued++; W.c.queued++;
      W.queuePos.add(q.position || 0);
      const waitS = Math.min(30, Math.max(2, q.etaS || 5));
      this.reconnectAt = performance.now() + waitS * 1000 * (0.8 + 0.4 * this.rand());
      this.state = 'wait';
      return null;
    }
    if (j.status === 401) this.access = null;   // stale cached access token → next attempt refreshes
    if (j.status !== 200 || !j.body.ticket) throw Object.assign(new Error(`join ${j.status} ${j.body.error || ''}`), { code: 'join_' + j.status });
    if (j.body.spawnHint) this.spawnHint = j.body.spawnHint;
    this.ticketForReplay = j.body.ticket;
    return j.body.ticket;
  }

  _open(ticket) {
    const W = this.W;
    this.state = 'open';
    const tOpen = performance.now();
    const headers = this.s.origin ? { origin: this.s.origin } : {};
    const ws = new WebSocket(this.s.wsUrl, { headers, perMessageDeflate: false, handshakeTimeout: 15000, maxPayload: 1 << 20 });
    ws.binaryType = 'nodebuffer';
    this.ws = ws;
    const resume = this.wantResume && this.resumeToken;
    this.resuming = !!resume;
    if (resume) { W.c.resumeAttempt++; this.resumeT0 = performance.now(); }
    ws.on('open', () => {
      if (ws !== this.ws) return;
      W.connectMs.add(performance.now() - tOpen);
      this.state = 'hello';
      this.helloAt = performance.now();
      this._setupNetem();
      if (this.s.abuseOnOpen) { this.s.abuseOnOpen(this, ticket); return; }
      this.sendRaw(encodeHello(W8, { proto: PROTO_VERSION, worldVersion: 0, tier: this.s.tier ?? 2, ticket: resume ? '' : ticket, resumeToken: resume ? this.resumeToken : null }));
    });
    ws.on('message', (data, isBinary) => {
      if (ws !== this.ws) return;
      if (this.netemIn) this.netemIn.push(isBinary ? data : null);
      else this._onMessage(isBinary ? data : null);
    });
    ws.on('close', (code) => { if (ws === this.ws) this._onClose(code); });
    ws.on('error', (e) => { if (ws === this.ws) { this.r.lastError = String(e.message || e); W.err('ws_' + (e.code || 'error')); } });
    ws.on('unexpected-response', (req, res) => {
      if (ws !== this.ws) return;
      W.err('upgrade_' + res.statusCode);
      this.r.lastError = 'upgrade ' + res.statusCode;
      try { ws.terminate(); } catch { /* ignore */ }
    });
  }

  _setupNetem() {
    const n = this.s.netem;
    if (!n) return;
    this.netemOut = new NetemQueue(n, this.rand, (b) => { if (this.ws && this.ws.readyState === 1) this.ws.send(b); });
    this.netemIn = new NetemQueue(n, this.rand, (b) => this._onMessage(b));
  }

  sendRaw(bytes) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    this.r.txBytes += bytes.length; this.W.c.txBytes += bytes.length; this.W.c.msgsOut++;
    if (this.netemOut) this.netemOut.push(Buffer.from(bytes)); else ws.send(bytes);
    return true;
  }

  _onLive(m) {
    const W = this.W;
    const now = performance.now();
    if (this.resuming) {
      const same = m && m.netId === this.r.netId;
      if (same) { this.r.resumeOk++; W.c.resumeOk++; W.resumeMs.add(now - (this.dropT || this.resumeT0)); W.resumeHsMs.add(now - this.resumeT0); }
      else { this.r.resumeFail++; W.c.resumeFail++; }
      this.resuming = false;
    }
    this.wantResume = false;
    this.state = 'live'; this.liveSince = now; this.lastTick = now; this.backoffMs = 1000;
    this.r.connects++; W.c.connectOk++;
    if (m && m.op === S2C.WELCOME) {
      if (m.proto !== PROTO_VERSION) W.err('welcome_proto');
      this.r.netId = m.netId;
      if (!this.r.netIds.includes(m.netId)) this.r.netIds.push(m.netId);
      this.resumeToken = m.resumeToken;
      if (!this.placed) this._place(m.spawn.x, m.spawn.z, m.spawn.yaw);
      this.sendRaw(encodeReady(W8));
    } else if (!this.placed) {
      const sp = this.spawnHint && Number.isFinite(this.spawnHint.x) ? this.spawnHint : pickSpawn(null, this.rand);
      this._place(sp.x, sp.z, sp.yaw || 0);
    }
    this.slots.clear();
    this.nextStateAt = now + this.rand() * 66;
    this.nextPingAt = now + this.rand() * 500;
    if (!this.nextChatAt) this.nextChatAt = now + this._chatGap();
    if (this.s.dropPerMin > 0 && this.dropAt === Infinity) this.dropAt = now + this._expo(60000 / this.s.dropPerMin);
    if (this.onLiveHook) this.onLiveHook(this, m);
  }

  _place(x, z, yaw) {
    this.placed = true;
    this.x = x; this.z = z; this.yaw = yaw; this.y = groundHeight(x, z);
    const g = this.ctx.graph;
    if (this.s.behavior === 'road' || this.s.behavior === 'plaza') {
      this.walker = new Walker(g, this.rand, x, z);
      if (this.s.target) {
        this.walker.goTo(this.s.target.x, this.s.target.z);
        this._setMode(this.s.travelMode ?? MODE.MOTO);
      } else this._newLeg(performance.now());
    }
  }

  _onClose(code) {
    const W = this.W;
    const now = performance.now();
    if (this.state === 'live') this.r.connectedMs += now - this.liveSince;
    W.bump(W.closes, code);
    this.r.closes[code] = (this.r.closes[code] || 0) + 1;
    if (this.netemOut) { this.netemOut.close(); this.netemOut = null; }
    if (this.netemIn) { this.netemIn.close(); this.netemIn = null; }
    const wasLive = this.state === 'live';
    this.ws = null;
    if (this.onCloseHook && this.onCloseHook(this, code) === false) { this.state = 'done'; return; }
    if (this.stopped) { this.state = 'done'; return; }
    if (this.resuming) { this.r.resumeFail++; W.c.resumeFail++; this.resuming = false; this.wantResume = false; }
    // unexpected close → reconnect with backoff (resume if we had a session)
    if (wasLive && this.resumeToken && code !== CLOSE.KICKED && code !== CLOSE.BANNED && code !== CLOSE.DUPLICATE) this.wantResume = true;
    if (code === CLOSE.AUTH) this.wantResume = false;
    this._scheduleReconnect();
  }

  _scheduleReconnect(ms) {
    if (this.stopped) return;
    const d = ms ?? this.backoffMs + this.rand() * 1000;
    this.backoffMs = Math.min(8000, this.backoffMs * 2);
    this.reconnectAt = performance.now() + d;
    this.state = 'wait';
    this.r.reconnects++;
  }

  // network drop (scenario or random): kill the socket without a close frame, come back after `afterMs`
  drop(afterMs) {
    if (this.state !== 'live' || !this.ws) return false;
    const now = performance.now();
    this.r.connectedMs += now - this.liveSince;
    this.dropT = now;
    const ws = this.ws; this.ws = null;
    if (this.netemOut) { this.netemOut.close(); this.netemOut = null; }
    if (this.netemIn) { this.netemIn.close(); this.netemIn = null; }
    try { ws.terminate(); } catch { /* ignore */ }
    this.wantResume = this.s.mode === 'full' && !!this.resumeToken;
    this.state = 'wait';
    this.reconnectAt = now + afterMs;
    this.r.reconnects++;
    this.W.c.drops++;
    return true;
  }

  stop() {
    this.stopped = true;
    const now = performance.now();
    if (this.state === 'live') this.r.connectedMs += now - this.liveSince;
    this.state = 'done';
    if (this.netemOut) this.netemOut.close();
    if (this.netemIn) this.netemIn.close();
    if (this.ws) { try { this.ws.close(CLOSE.NORMAL, 'bye'); } catch { /* ignore */ } setTimeout(() => { try { this.ws?.terminate(); } catch { /* ignore */ } }, 1500).unref?.(); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // inbound
  // ---------------------------------------------------------------------------------------------------------------
  _onMessage(data) {
    const W = this.W;
    if (!data) { W.c.textFrames++; return; }
    const n = data.length;
    this.r.rxBytes += n; this.secBytes += n; W.c.rxBytes += n; W.c.msgsIn++;
    const m = decodeS2C(data, this.ctx.pool);
    if (m.err) {
      this.r.decodeErrors++; W.c.decodeErrors++;
      W.bump(W.decodeErr, `${m.err}:op${data[0]}:len${n}`);
      return;
    }
    W.opsIn[m.op] = (W.opsIn[m.op] || 0) + 1;
    if (this.onMessageHook && this.onMessageHook(this, m, n) === true) return;
    switch (m.op) {
      case S2C.WELCOME: this._onLive(m); break;
      case S2C.SNAPSHOT: this._onSnapshot(m, n); break;
      case S2C.PONG: {
        const sent = this.pings.get(m.clientTime);
        if (sent !== undefined) {
          this.pings.delete(m.clientTime);
          const rtt = this.clock.addSample(sent, m.serverTime, performance.now());
          (this.s.netem ? W.rttNetem : W.rtt).add(rtt);
        }
        break;
      }
      case S2C.CORRECT: {
        this.r.corrects++; W.c.corrects++;
        this.r.correctReasons[m.reason] = (this.r.correctReasons[m.reason] || 0) + 1;
        W.bump(W.correctReasons, m.reason);
        this.corrEpoch = m.epoch;
        this.x = m.x; this.z = m.z; this.y = m.y; this.v = 0;
        if (this.walker) { this.walker.x = m.x; this.walker.z = m.z; }
        break;
      }
      case S2C.SYSTEM: {
        W.bump(W.system, m.code);
        if (m.code === SYS.NOT_IMPLEMENTED && this.state === 'hello') this._onLive(null);
        else if (m.code === SYS.RESUMED && this.resuming) { /* WELCOME follows or this is the ack */ }
        else if (m.code === SYS.BACKOFF) this.backoffMs = Math.max(1000, Math.min(60000, m.arg));
        else if (m.code === SYS.QUEUE_POS || m.code === SYS.SERVER_FULL) { this.r.queued++; W.c.queued++; W.queuePos.add(m.arg); }
        else if (m.code === SYS.AUTH_FAILED && this.resuming) { /* close follows; full rejoin */ }
        break;
      }
      case S2C.CHAT: {
        W.c.chatRecv++;
        if (this.recv && this.recv.length < 400) this.recv.push([m.from, m.text]);
        break;
      }
      case S2C.EVENT: {
        if (m.type === EVENT.CHAT_REJECTED) {
          this.r.chatRejected++; W.c.chatRejected++;
          W.bump(W.chatRejected, m.args[0]);
        }
        break;
      }
      case S2C.NAMES: W.c.names += m.names.length; break;
      default: break;
    }
  }

  _onSnapshot(m, n) {
    const W = this.W;
    this.r.snaps++; W.c.snaps++;
    W.snapBytes.add(n);
    const recs = m.enters.length + m.updates.length;
    W.snapRecords.add(recs);
    if (recs > this.r.maxRecords) this.r.maxRecords = recs;
    if (recs > AOI.CAP) W.c.capViolations++;
    if (n > AOI.SNAPSHOT_MAX_BYTES) W.c.snapOverBudget++;
    if (m.flags & SNAP_FLAG.KEYFRAME) { this.slots.clear(); W.c.keyframes++; }
    for (const s of m.leaves) if (!this.slots.delete(s)) W.c.badSlot++;
    for (const e of m.enters) this.slots.set(e.slot, e.netId);
    for (const u of m.updates) if (!this.slots.has(u.slot)) W.c.badSlot++;
    if (this.slots.size > this.r.maxVisible) this.r.maxVisible = this.slots.size;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per-tick behaviour (called by the worker loop every ~20 ms)
  // ---------------------------------------------------------------------------------------------------------------
  tick(now) {
    if (this.state === 'wait') {
      if (now >= this.reconnectAt && !this.stopped) { this.state = 'idle'; this.start(); }
      return;
    }
    if (this.state !== 'live') return;
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.tickHook && this.tickHook(this, now, dt) === true) return;
    this._move(now, dt);
    if (now >= this.nextStateAt) this._sendState(now);
    if (now >= this.nextPingAt) {
      this._sendPing(now);
      const fast = now - this.liveSince < PING_FAST_S * 1000;
      this.nextPingAt = now + (fast ? 500 : 1000);
    }
    if (this.s.chat && now >= this.nextChatAt) {
      this.sendChat(CLEAN[Math.floor(this.rand() * CLEAN.length)]);
      this.nextChatAt = now + this._chatGap();
    }
    if (now >= this.dropAt) {
      this.dropAt = now + this._expo(60000 / this.s.dropPerMin);
      this.drop(1000 + this.rand() * 4000);
    }
  }

  // one second elapsed (worker): bandwidth window
  second() {
    this.win[this.winI] = this.secBytes; this.winI = (this.winI + 1) % 5; this.secBytes = 0;
    if (this.state === 'live' && performance.now() - this.liveSince > 5000) {
      const bps = (this.win[0] + this.win[1] + this.win[2] + this.win[3] + this.win[4]) / 5;
      if (bps > this.r.peak5sBps) this.r.peak5sBps = bps;
    }
  }

  _chatGap() { const [a, b] = this.s.chatEveryS || [30, 90]; return (a + this.rand() * (b - a)) * 1000; }
  _expo(mean) { return -Math.log(1 - this.rand()) * mean; }

  _setMode(mode) {
    // switching to a slower mode while fast: slow down first, switch after the validation window has passed
    if (mode === this.mode) { this.pendingMode = -1; return; }
    if (mode === this.pendingMode) return;
    if (MODE_VMAX[mode] < MODE_VMAX[this.mode] && this.v > 0.05) {
      this.pendingMode = mode; this.slowSince = 0; this.vTarget = MODE_VMAX[mode] * SPEED_MUL;
      return;
    }
    this.mode = mode; this.pendingMode = -1;
  }

  _modeSpeed(mode) {
    return mode === MODE.WALK ? SPEED.walk * SPEED_MUL : mode === MODE.RUN ? SPEED.run * SPEED_MUL : mode === MODE.MOTO ? SPEED.moto * SPEED_MUL : 0;
  }

  _newLeg(now) {
    const mix = this.s.mix || { walk: 0.5, run: 0.25, moto: 0.25 };
    if (this.rand() < (this.s.idleProb ?? 0.15)) { this.idleUntil = now + (3 + this.rand() * 12) * 1000; this.nextLegAt = this.idleUntil; this.vTarget = 0; return; }
    const r = this.rand() * (mix.walk + mix.run + mix.moto);
    const mode = r < mix.walk ? MODE.WALK : r < mix.walk + mix.run ? MODE.RUN : MODE.MOTO;
    this._setMode(mode);
    this.nextLegAt = now + (20 + this.rand() * 70) * 1000;
  }

  _move(now, dt) {
    const b = this.s.behavior;
    if (b === 'idle' || !this.walker && !this.plaza) { this.v = 0; return; }
    // pending slower mode
    if (this.pendingMode >= 0) {
      const vmaxNew = MODE_VMAX[this.pendingMode] * SPEED_MUL;
      if (this.v <= vmaxNew + 0.05) {
        if (!this.slowSince) this.slowSince = now;
        else if (now - this.slowSince >= SWITCH_SETTLE_MS) { this.mode = this.pendingMode; this.pendingMode = -1; this.slowSince = 0; }
      }
    }
    if (this.plaza) return this._movePlaza(now, dt);
    if (!this.walker.routing && this.s.target && b === 'plaza') {
      // arrived near the target: get off the bike and wander on foot
      if (Math.hypot(this.x - this.s.target.x, this.z - this.s.target.z) < 60 || !this.walker.routing) {
        this._setMode(MODE.WALK);
        if (this.mode === MODE.WALK) { this.plaza = { x: this.s.target.x, z: this.s.target.z, r: this.s.target.r || 50, tx: this.x, tz: this.z, pauseUntil: 0 }; return; }
        this.vTarget = this._modeSpeed(MODE.WALK);
      }
    } else if (b === 'road' && !this.s.target && now >= this.nextLegAt) this._newLeg(now);
    else if (b === 'road' && this.s.target && !this.walker.routing && now >= this.nextLegAt) { this.s.target = null; this._newLeg(now); }
    if (now < this.idleUntil) this.vTarget = 0;
    else if (this.pendingMode < 0) this.vTarget = this._modeSpeed(this.mode);
    this._accel(dt);
    const d = this.walker.step(this.v * dt);
    this.x = this.walker.x; this.z = this.walker.z; this.yaw = this.walker.yaw;
    if (d < this.v * dt * 0.5 && this.v > 0.5) this.v = d / dt;
    this.y = groundHeight(this.x, this.z);
  }

  _accel(dt) {
    const a = this.mode === MODE.MOTO ? ACCEL.moto : 20;
    const dv = this.vTarget - this.v;
    const lim = (dv > 0 ? a : a * 2) * dt;
    this.v += dv > lim ? lim : dv < -lim ? -lim : dv;
  }

  _movePlaza(now, dt) {
    const p = this.plaza;
    if (now < p.pauseUntil) { this.vTarget = 0; this._accel(dt); return; }
    let dx = p.tx - this.x, dz = p.tz - this.z, L = Math.hypot(dx, dz);
    if (L < 0.5) {
      // new target inside the circle, on land
      for (let k = 0; k < 8; k++) {
        const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * p.r;
        const tx = p.x + Math.sin(a) * r, tz = p.z + Math.cos(a) * r;
        if (!isWater(tx, tz)) { p.tx = tx; p.tz = tz; break; }
      }
      if (this.rand() < 0.4) p.pauseUntil = now + (2 + this.rand() * 8) * 1000;
      this._setMode(this.rand() < 0.8 ? MODE.WALK : MODE.RUN);
      return;
    }
    if (this.pendingMode < 0) this.vTarget = this._modeSpeed(this.mode);
    this._accel(dt);
    const step = Math.min(L, this.v * dt);
    this.yaw = Math.atan2(dx, dz);
    this.x += (dx / L) * step; this.z += (dz / L) * step;
    this.y = groundHeight(this.x, this.z);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // outbound
  // ---------------------------------------------------------------------------------------------------------------
  stateMsg(over) {
    const moving = this.v > 0.05;
    const st = {
      seq: this.seq = (this.seq + 1) & 0xffff,
      clientMs: Math.floor(performance.now() - this.t0) & 0xffff,
      x: this.x, z: this.z, y: this.y, yaw: this.yaw,
      vx: moving ? Math.sin(this.yaw) * this.v : 0, vz: moving ? Math.cos(this.yaw) * this.v : 0,
      state: packState(this.mode, 0), corrEpoch: this.corrEpoch, vehicleRef: 0,
    };
    return over ? Object.assign(st, over) : st;
  }
  _sendState(now) {
    this.sendRaw(encodeState(W8, this.stateMsg()));
    const moving = this.v > 0.05 || this.pendingMode >= 0;
    this.nextStateAt = now + 1000 / (moving ? STATE_HZ_MOVING : STATE_HZ_IDLE);
  }
  _sendPing(now) {
    const ct = Math.floor(now) >>> 0;
    this.pings.set(ct, now);
    if (this.pings.size > 16) this.pings.delete(this.pings.keys().next().value);
    this.sendRaw(encodePing(W8, ct));
  }
  sendChat(text, channel = CHANNEL.SAY) {
    if (this.sendRaw(encodeChat(W8, channel, text))) { this.r.chatSent++; this.W.c.chatSent++; return true; }
    return false;
  }
}

export { CHAT_CODE };
