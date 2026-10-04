// Âm thanh WebAudio hoàn toàn procedural — không cần file
//
// Đợt 3 (WP8): NỀN ÂM PHỐ THẬT thay cho vòng nhạc 16 nốt là thứ duy nhất nghe được giữa phố:
//  - tiếng ù xe cộ (nhiễu nâu lọc thấp) + rì rì máy xe máy (nhiễu băng 600-900 Hz) theo MẬT ĐỘ XE QUANH người chơi
//    (traffic.js trả `near` 0..1);
//  - còi xe: "bíp bíp" khi xe bị người chơi chắn đường (traffic.js đếm `honk`) + còi lác đác theo mật độ ban ngày;
//  - chim hót ban ngày (nhiều hơn trong công viên/vườn hoa, ít khi phố ồn), dế/côn trùng ban đêm;
//  - máy xe máy của chính người chơi: sóng răng cưa lọc thấp, cao độ theo tốc độ; gió rít khi chạy nhanh;
//  - nhạc ngũ cung giữ lại nhưng nhỏ hơn (nền, không lấn tiếng phố).
// CPU thấp: các nguồn liên tục là node cố định (chỉ đổi gain/tần số mỗi khung); sự kiện (chim, còi) tạo vài
// oscillator ngắn mỗi giây. Ngẫu nhiên ở đây là Math.random — chỉ âm thanh, không ảnh hưởng vị trí/ảnh QA.
let ctx = null;
let master = null, musicGain = null, waveGain = null;
let humGain = null, buzzGain = null, buzzFilter = null, insectGain = null, windGain = null;
let engOsc = null, engOsc2 = null, engGain = null, engFilter = null;
let muted = false;
let started = false;
let noiseBuf = null;

function makeNoise(seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}
function loopSrc(buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }

export function initAudio() {
  if (started) return;
  started = true;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; return; }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);

  // --- Sóng biển: nhiễu trắng lọc thấp ---
  noiseBuf = makeNoise(2, false);
  const noise = loopSrc(noiseBuf);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
  waveGain = ctx.createGain(); waveGain.gain.value = 0;
  noise.connect(lp); lp.connect(waveGain); waveGain.connect(master);
  lfo.start();

  // --- Ù phố: nhiễu nâu lọc thấp ---
  const brown = loopSrc(makeNoise(3, true));
  const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 300;
  humGain = ctx.createGain(); humGain.gain.value = 0;
  brown.connect(hl); hl.connect(humGain); humGain.connect(master);
  // --- Rì rì máy xe máy (nhiều xe xa gộp lại): nhiễu trắng qua bộ lọc dải, tần số trôi chậm ---
  const n2 = loopSrc(noiseBuf);
  buzzFilter = ctx.createBiquadFilter(); buzzFilter.type = 'bandpass'; buzzFilter.frequency.value = 700; buzzFilter.Q.value = 1.3;
  const bl = ctx.createOscillator(); bl.frequency.value = 0.07;
  const blg = ctx.createGain(); blg.gain.value = 160; bl.connect(blg); blg.connect(buzzFilter.frequency); bl.start();
  buzzGain = ctx.createGain(); buzzGain.gain.value = 0;
  n2.connect(buzzFilter); buzzFilter.connect(buzzGain); buzzGain.connect(master);
  // --- Dế đêm: 2 sóng sin ~4,4/4,9 kHz, điều biên xung 25-30 Hz (tiếng "rỉ rả") ---
  insectGain = ctx.createGain(); insectGain.gain.value = 0; insectGain.connect(master);
  for (const [f, am, slow] of [[4400, 27, 0.55], [4920, 31, 0.37]]) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0;
    const m = ctx.createOscillator(); m.type = 'square'; m.frequency.value = am;
    const mg = ctx.createGain(); mg.gain.value = 0.5; m.connect(mg); mg.connect(g.gain);
    const s = ctx.createOscillator(); s.frequency.value = slow;          // ngắt quãng từng đợt
    const sg = ctx.createGain(); sg.gain.value = 0.35; s.connect(sg); sg.connect(g.gain);
    o.connect(g); g.connect(insectGain); o.start(); m.start(); s.start();
  }
  // --- Gió khi chạy xe nhanh ---
  const n3 = loopSrc(noiseBuf);
  const wh = ctx.createBiquadFilter(); wh.type = 'bandpass'; wh.frequency.value = 900; wh.Q.value = 0.5;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  n3.connect(wh); wh.connect(windGain); windGain.connect(master);
  // --- Máy xe máy người chơi: 2 răng cưa lệch nhẹ + lọc thấp ---
  engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 520; engFilter.Q.value = 2;
  engGain = ctx.createGain(); engGain.gain.value = 0;
  engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 40;
  engOsc2 = ctx.createOscillator(); engOsc2.type = 'square'; engOsc2.frequency.value = 20.3;
  const e2g = ctx.createGain(); e2g.gain.value = 0.4;
  engOsc.connect(engFilter); engOsc2.connect(e2g); e2g.connect(engFilter);
  engFilter.connect(engGain); engGain.connect(master);
  engOsc.start(); engOsc2.start();

  // --- Nhạc nền: giai điệu ngũ cung nhẹ nhàng (nhỏ — nền cho tiếng phố) ---
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.075;
  musicGain.connect(master);
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}
export function isMuted() { return muted; }

function note(freq, when, dur, type = 'triangle', vol = 1, dest = null) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(g); g.connect(dest || master);
  osc.start(when); osc.stop(when + dur + 0.05);
}

// Còi xe máy "bíp": 2 sóng vuông hợp âm ~ quãng 3 trưởng qua lọc dải (loa còi nhỏ)
function horn(when, vol, dur = 0.22, base = 430) {
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.015);
  g.gain.setValueAtTime(vol, when + dur - 0.03); g.gain.linearRampToValueAtTime(0, when + dur);
  bp.connect(g); g.connect(master);
  for (const f of [base, base * 1.26]) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    o.connect(bp); o.start(when); o.stop(when + dur + 0.02);
  }
}
// Chim: chuỗi 2-5 tiếng "chíp" quét tần số nhanh
function birdCall(when, vol) {
  const n = 2 + Math.floor(Math.random() * 4), f0 = 2600 + Math.random() * 1800;
  for (let i = 0; i < n; i++) {
    const t = when + i * (0.09 + Math.random() * 0.07);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.4), t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
  }
}

// Giai điệu ngũ cung D (Rê): gợi âm hưởng dân ca
const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];
const MELODY = [0, 2, 3, 2, 4, 3, 2, 0, 1, 2, 3, 5, 4, 3, 2, 1];
let melodyIdx = 0;
let nextNoteTime = 0;
let _hornAt = 0, _birdAt = 0;
const lerpTo = (param, v, k) => { param.value += (v - param.value) * k; };

// env: {seaFactor 0..1, night 0..1, traffic 0..1, honk (số còi phát sinh), engine (0..1 | −1 không lái), green 0/1}
export function updateAudio(dt, env) {
  if (!ctx || muted) return;
  const k = Math.min(1, dt * 2);
  const night = env.night || 0, traffic = env.traffic || 0, day = 1 - night;
  // sóng biển to dần khi gần nước
  lerpTo(waveGain.gain, 0.03 + env.seaFactor * 0.3, k);
  // phố: ù + rì máy theo mật độ xe (đêm vắng hơn)
  lerpTo(humGain.gain, (0.03 + 0.16 * traffic) * (1 - 0.45 * night) * (1 - env.seaFactor * 0.6), k);
  lerpTo(buzzGain.gain, 0.05 * traffic * (1 - 0.5 * night), k);
  lerpTo(insectGain.gain, 0.022 * Math.max(0, night - 0.25) * (1 - 0.6 * traffic) * (1 + (env.green || 0)), k * 0.5);
  // máy xe mình đang lái
  const eng = env.engine;
  if (eng >= 0) {
    lerpTo(engGain.gain, 0.09 + 0.05 * eng, Math.min(1, dt * 5));
    const f = 34 + 78 * eng;
    lerpTo(engOsc.frequency, f, Math.min(1, dt * 4)); lerpTo(engOsc2.frequency, f * 0.507, Math.min(1, dt * 4));
    lerpTo(engFilter.frequency, 380 + 900 * eng, Math.min(1, dt * 4));
    lerpTo(windGain.gain, 0.06 * eng * eng, k);
  } else { lerpTo(engGain.gain, 0, Math.min(1, dt * 4)); lerpTo(windGain.gain, 0, k); }

  const now = ctx.currentTime;
  // còi: xe bị chắn (traffic.js) + lác đác theo mật độ ban ngày
  if (now - _hornAt > 0.45) {
    const pAmb = dt * 0.35 * traffic * (0.3 + 0.7 * day);
    if (env.honk > 0 || Math.random() < pAmb) {
      _hornAt = now;
      const vol = 0.05 + 0.08 * Math.random() * (env.honk > 0 ? 1.6 : traffic);
      const b = 380 + Math.random() * 160;
      horn(now + 0.02, vol, 0.12 + Math.random() * 0.12, b);
      if (Math.random() < 0.55) horn(now + 0.22, vol, 0.12 + Math.random() * 0.1, b);   // "bíp bíp"
    }
  }
  // chim ban ngày (công viên nhiều hơn, phố ồn ít hơn)
  if (day > 0.4 && now - _birdAt > 0.6 && Math.random() < dt * 0.5 * day * (1 - 0.7 * traffic) * (1 + 2 * (env.green || 0))) {
    _birdAt = now;
    birdCall(now + 0.03, 0.025 + 0.03 * Math.random());
  }

  // lên lịch nốt nhạc (lookahead 0.3s)
  while (nextNoteTime < ctx.currentTime + 0.3) {
    if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime + 0.1;
    const f = SCALE[MELODY[melodyIdx % MELODY.length]];
    note(f, nextNoteTime, 1.6, 'triangle', 0.5, musicGain);
    note(f / 2, nextNoteTime, 2.2, 'sine', 0.35, musicGain);
    if (melodyIdx % 4 === 0) note(SCALE[0] / 2, nextNoteTime, 2.8, 'sine', 0.3, musicGain);
    melodyIdx++;
    nextNoteTime += 1.05;
  }
}

let lastHorn = -60;
export function tryHorn(time, portFactor) {
  if (!ctx || muted) return;
  if (portFactor > 0.15 && time - lastHorn > 34) {
    lastHorn = time;
    const t0 = ctx.currentTime + 0.1;
    const vol = 0.35 * portFactor;
    note(87, t0, 2.4, 'sawtooth', vol);
    note(110, t0, 2.4, 'square', vol * 0.5);
  }
}

export function sfx(kind) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  switch (kind) {
    case 'pickup':
      note(880, t0, 0.18, 'sine', 0.5);
      note(1318, t0 + 0.09, 0.3, 'sine', 0.45);
      break;
    case 'discover':
      note(523, t0, 0.16, 'triangle', 0.5);
      note(659, t0 + 0.1, 0.16, 'triangle', 0.5);
      note(784, t0 + 0.2, 0.34, 'triangle', 0.55);
      break;
    case 'quest':
      [523, 659, 784, 1046].forEach((f, i) => note(f, t0 + i * 0.11, 0.4, 'triangle', 0.55));
      break;
    case 'fanfare':
      [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => note(f, t0 + i * 0.14, 0.5, 'triangle', 0.6));
      break;
    case 'talk':
      note(440 + Math.random() * 120, t0, 0.08, 'square', 0.12);
      break;
    case 'click':
      note(660, t0, 0.06, 'square', 0.15);
      break;
    case 'error':
      note(220, t0, 0.2, 'square', 0.3);
      note(185, t0 + 0.14, 0.3, 'square', 0.3);
      break;
    case 'mount':
      note(392, t0, 0.12, 'triangle', 0.4);
      note(587, t0 + 0.08, 0.2, 'triangle', 0.4);
      break;
    case 'horn':   // còi xe của người chơi (Space khi đang lái)
      horn(t0, 0.22, 0.28, 460);
      break;
    case 'splash':
      note(240, t0, 0.3, 'sine', 0.3);
      break;
  }
}
