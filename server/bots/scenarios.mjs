// server/bots/scenarios.mjs — load-test scenarios (SPEC §3.4, ARCH §17.3). Each scenario returns default N/duration,
// a per-bot spec builder (start time, behaviour, chat, drops, netem, abuse class) and timeline events.
// Acceptance checks live in lib/report.mjs (they read the merged results).
import { EXTRAS } from './lib/roadgraph.mjs';
import { ABUSE_CLASSES } from './lib/abuse.mjs';

const SQUARE = { x: EXTRAS.square[0], z: EXTRAS.square[1], r: 50 };

// allocate `n` slots over weighted classes (largest remainder), deterministic
function allocate(n, weights) {
  const keys = Object.keys(weights), tot = keys.reduce((s, k) => s + weights[k], 0);
  const raw = keys.map((k) => (weights[k] / tot) * n), base = raw.map(Math.floor);
  let left = n - base.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) base[order[k % order.length][1]]++;
  const out = [];
  keys.forEach((k, i) => { for (let j = 0; j < base[i]; j++) out.push(k); });
  return out;
}

export const SCENARIOS = {
  smoke: {
    desc: '50 bot đi/chạy/xe máy trên đồ thị đường thật, chat sạch, rớt mạng ngẫu nhiên (T0)',
    n: 50, durS: 60, steadyS: 10,
    bot: (i, n, o) => ({ startAt: (i / n) * 5000, behavior: 'road', chat: true, chatEveryS: [15, 45], dropPerMin: o.dropPerMin ?? 0.2 }),
  },
  ramp: {
    desc: '0 → 1.200 bot trong 5 phút rồi giữ 5 phút (T1)',
    n: 1200, durS: 600, rampS: 300,
    bot: (i, n, o, sc) => ({ startAt: (i / n) * (o.rampS ?? sc.rampS) * 1000, behavior: 'road', chat: true, chatEveryS: [30, 120], dropPerMin: o.dropPerMin ?? 0.02 }),
  },
  hotspot: {
    desc: '300 bot dồn về quảng trường Nhà hát lớn (EXTRAS.square), đi xe máy tới rồi đi bộ lang thang bán kính 50 m (T2)',
    n: 300, durS: 300, steadyS: 150,
    bot: (i, n) => ({ startAt: (i / n) * 30000, behavior: 'plaza', target: SQUARE, chat: true, chatEveryS: [30, 90], dropPerMin: 0 }),
  },
  stress: {
    desc: '2.000 bot (1,7 × trần 1.200) trong 2 phút rồi giữ 3 phút — thang suy giảm + hàng đợi (T3)',
    n: 2000, durS: 300, rampS: 120,
    bot: (i, n, o, sc) => ({ startAt: (i / n) * (o.rampS ?? sc.rampS) * 1000, behavior: 'road', chat: true, chatEveryS: [30, 120], dropPerMin: 0 }),
  },
  reconnect: {
    desc: '1.000 bot vào trong 30 s; ở giây 60 tất cả rớt mạng cùng lúc và nối lại trong 0,5–30 s (resume) (T5)',
    n: 1000, durS: 150,
    bot: (i, n) => ({ startAt: (i / n) * 30000, behavior: 'road', chat: false, dropPerMin: 0 }),
    events: (o) => [{ at: (o.dropAtS ?? 60) * 1000, kind: 'dropAll', minMs: 500, maxMs: 30000 }],
  },
  abuse: {
    desc: 'gói sai, quá cỡ, spam 1.000 tin/s, speed-hack, teleport, vé giả/vé dùng lại, lách bộ lọc chat (T7)',
    n: 200, durS: 60,
    bot: (i, n, o, sc, plan) => {
      const cls = plan[i];
      if (cls === 'observer') return { startAt: (i / n) * 3000, behavior: 'idle', chat: false, recordChat: true, dropPerMin: 0 };
      const quiet = cls === 'chat_bypass' || ABUSE_CLASSES[cls]?.handshake;
      return { startAt: 5000 + (i / n) * 10000, behavior: quiet ? 'idle' : 'road', abuse: cls, chat: false, dropPerMin: 0 };
    },
    plan: (n, o) => {
      const nObs = Math.max(4, Math.round(n * 0.2));
      const weights = Object.fromEntries(Object.entries(ABUSE_CLASSES).filter(([k, v]) => o.mode === 'full' || !v.needsFull).map(([k, v]) => [k, v.weight]));
      return [...Array(nObs).fill('observer'), ...allocate(n - nObs, weights)];
    },
  },
  'netem-lite': {
    desc: 'bot thêm trễ 80 ± 30 ms mỗi chiều + "mất gói" 2 % (dồn cục kiểu TCP) trên 30 % bot (T4)',
    n: 300, durS: 180, steadyS: 30,
    bot: (i, n, o) => {
      const frac = o.netemFrac ?? 0.3;
      const on = ((i * 37) % 100) < frac * 100;   // spread over the start order
      return { startAt: (i / n) * 20000, behavior: 'road', chat: true, chatEveryS: [30, 90], dropPerMin: 0.05, netem: on ? { delayMs: 80, jitterMs: 30, loss: 0.02 } : null };
    },
  },
};

export function buildPlan(name, o) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}; known: ${Object.keys(SCENARIOS).join(', ')}`);
  const n = o.n ?? sc.n, durS = o.durS ?? sc.durS;
  const plan = sc.plan ? sc.plan(n, o) : null;
  const specs = [];
  for (let i = 0; i < n; i++) specs.push({ idx: i, ...sc.bot(i, n, o, sc, plan) });
  const events = sc.events ? sc.events(o) : [];
  return { name, desc: sc.desc, n, durS, specs, events, plan };
}
