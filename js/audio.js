// Âm thanh WebAudio hoàn toàn procedural — không cần file
let ctx = null;
let master = null, musicGain = null, waveGain = null;
let muted = false;
let started = false;

export function initAudio() {
  if (started) return;
  started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // --- Sóng biển: nhiễu trắng lọc thấp ---
  const bufLen = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
  waveGain = ctx.createGain(); waveGain.gain.value = 0;
  noise.connect(lp); lp.connect(waveGain); waveGain.connect(master);
  noise.start(); lfo.start();

  // --- Nhạc nền: giai điệu ngũ cung nhẹ nhàng ---
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.16;
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

// Giai điệu ngũ cung D (Rê): gợi âm hưởng dân ca
const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];
const MELODY = [0, 2, 3, 2, 4, 3, 2, 0, 1, 2, 3, 5, 4, 3, 2, 1];
let melodyIdx = 0;
let nextNoteTime = 0;

export function updateAudio(dt, env) {
  if (!ctx || muted) return;
  // sóng biển to dần khi gần nước
  const target = 0.03 + env.seaFactor * 0.3;
  waveGain.gain.value += (target - waveGain.gain.value) * Math.min(1, dt * 2);

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
    case 'splash':
      note(240, t0, 0.3, 'sine', 0.3);
      break;
  }
}
