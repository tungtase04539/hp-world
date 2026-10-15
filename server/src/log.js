// log.js — minimal structured logger (JSON lines by default, `pretty` for a terminal). No dependencies.
// log.info('msg', {fields}); log.child({mod: 'gateway'}).warn(...). Keys that look secret are redacted.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /token|ticket|password|secret|authorization|cookie|private/i;

function redact(v, depth = 0) {
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack, code: v.code };
  if (!v || typeof v !== 'object' || depth > 4) return v;
  if (ArrayBuffer.isView(v)) return `<${v.length} bytes>`;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1);
  return out;
}

export function createLogger({ level = 'info', format = 'json', stream = process.stdout, bindings = {} } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const rec = { t: new Date().toISOString(), lvl, msg, ...bindings, ...(fields ? redact(fields) : {}) };
    let line;
    if (format === 'pretty') {
      const extra = Object.entries(rec).filter(([k]) => !['t', 'lvl', 'msg'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      line = `${rec.t.slice(11, 23)} ${lvl.toUpperCase().padEnd(5)} ${msg}${extra ? ' ' + extra : ''}\n`;
    } else {
      try { line = JSON.stringify(rec) + '\n'; } catch { line = JSON.stringify({ t: rec.t, lvl, msg, note: 'unserialisable fields' }) + '\n'; }
    }
    try { stream.write(line); } catch { /* closed stream */ }
  };
  const log = {
    level,
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (b) => createLogger({ level, format, stream, bindings: { ...bindings, ...b } }),
    isLevel: (l) => LEVELS[l] >= min,
  };
  return log;
}

export const nullLogger = createLogger({ level: 'silent' });
