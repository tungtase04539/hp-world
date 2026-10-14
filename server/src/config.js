// config.js — environment + defaults + first-run generation of server/.env (random dev secrets, never committed).
// Precedence: explicit overrides > process.env > server/.env > defaults.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TICK_HZ, SNAP_HZ, DAY_LENGTH, CAPACITY_DEFAULT } from '../../js/shared/constants.js';
import { PROTO_VERSION } from '../../js/shared/protocol.js';

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
export const DEFAULT_ENV_FILE = path.join(SERVER_ROOT, '.env');
export const DEFAULT_DAY_EPOCH = Date.UTC(2026, 0, 1);   // stable across restarts so the shared day clock never jumps

const PKG = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));
export const VERSION = PKG.version;

// Keys generated on first run (secrets). Optional integrations stay empty until the owner fills them.
export const SECRET_KEYS = ['JWT_PRIVATE_KEY', 'JWT_KID', 'TICKET_HMAC_KEY', 'ADMIN_TOKEN', 'DB_PASSWORD'];
export const OPTIONAL_SECRET_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TURNSTILE_SECRET', 'TUNNEL_TOKEN'];

// ---- .env parsing ---------------------------------------------------------------------------------------------------
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Fresh random secrets. JWT key = Ed25519 private key, PKCS#8 DER, base64 (one line).
export function generateSecrets() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    JWT_KID: 'k' + crypto.randomBytes(4).toString('hex'),
    TICKET_HMAC_KEY: b64url(crypto.randomBytes(32)),
    ADMIN_TOKEN: b64url(crypto.randomBytes(32)),
    DB_PASSWORD: b64url(crypto.randomBytes(24)),
  };
}

// Create server/.env with random secrets if it does not exist; append any missing secret keys if it does.
// Returns { path, created, added: [keys] }. The file is written with mode 0600 (best effort on Windows).
export function ensureEnvFile(file = DEFAULT_ENV_FILE) {
  const exists = fs.existsSync(file);
  const cur = exists ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  const gen = generateSecrets();
  const missing = SECRET_KEYS.filter((k) => !cur[k]);
  if (exists && missing.length === 0) return { path: file, created: false, added: [] };
  let text = '';
  if (!exists) {
    text += '# server/.env — SINH TỰ ĐỘNG lần chạy đầu (bí mật ngẫu nhiên). KHÔNG commit, KHÔNG gửi cho ai.\n';
    text += '# Xem server/.env.example để biết mọi biến. Xoá một dòng bí mật rồi chạy lại để sinh khoá mới.\n';
    text += `# Tạo lúc ${new Date().toISOString()}\n\n`;
  } else {
    text += `\n# Bổ sung tự động ${new Date().toISOString()}\n`;
  }
  for (const k of missing) text += `${k}=${gen[k]}\n`;
  if (!exists) {
    text += '\n# Tuỳ chọn (để trống = tắt)\n';
    for (const k of OPTIONAL_SECRET_KEYS) text += `${k}=\n`;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: ACLs, ignore */ }
  return { path: file, created: !exists, added: missing };
}

// ---- typed getters --------------------------------------------------------------------------------------------------
function makeGet(src) {
  const str = (k, d) => (src[k] !== undefined && src[k] !== '' ? String(src[k]) : d);
  const int = (k, d, lo = -Infinity, hi = Infinity) => {
    const v = str(k, undefined);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`config: ${k}=${v} must be an integer in [${lo}, ${hi}]`);
    return n;
  };
  const bool = (k, d) => {
    const v = str(k, undefined);
    if (v === undefined) return d;
    if (/^(1|true|yes|on)$/i.test(v)) return true;
    if (/^(0|false|no|off)$/i.test(v)) return false;
    throw new Error(`config: ${k}=${v} must be true/false`);
  };
  const list = (k, d) => {
    const v = str(k, undefined);
    return v === undefined ? d : v.split(',').map((s) => s.trim()).filter(Boolean);
  };
  const oneOf = (k, d, allowed) => {
    const v = str(k, d);
    if (!allowed.includes(v)) throw new Error(`config: ${k}=${v} must be one of ${allowed.join('|')}`);
    return v;
  };
  return { str, int, bool, list, oneOf };
}

export const DEFAULT_ORIGINS = ['https://tungtase04539.github.io', 'http://localhost:*', 'http://127.0.0.1:*'];

// Build the frozen config object.
//   env:      variables (default process.env)
//   envFile:  path of the .env to read (default server/.env); null = do not read a file
//   overrides: plain KEY → value map applied last (tests)
export function loadConfig({ env = process.env, envFile = DEFAULT_ENV_FILE, overrides = {} } = {}) {
  let fileVars = {};
  if (envFile && fs.existsSync(envFile)) fileVars = parseEnv(fs.readFileSync(envFile, 'utf8'));
  const src = { ...fileVars, ...env, ...overrides };
  const g = makeGet(src);
  const nodeEnv = g.oneOf('NODE_ENV', 'development', ['development', 'production', 'test']);
  const inDocker = g.bool('IN_DOCKER', false);
  const anyHost = inDocker ? '0.0.0.0' : '127.0.0.1';
  const gamePort = g.int('GAME_PORT', 9100, 0, 65535);
  const adminPort = g.int('ADMIN_PORT', 9101, 0, 65535);

  // secrets: production must have them; dev/test without a file get ephemeral ones (process lifetime only)
  let secrets = {};
  const missing = SECRET_KEYS.filter((k) => !g.str(k));
  if (missing.length) {
    if (nodeEnv === 'production') throw new Error(`config: missing secrets ${missing.join(', ')} (run once in dev to generate server/.env)`);
    const gen = generateSecrets();
    for (const k of missing) src[k] = gen[k];
  }
  secrets = {
    jwtPrivateKey: g.str('JWT_PRIVATE_KEY'),
    jwtKid: g.str('JWT_KID'),
    ticketHmacKey: g.str('TICKET_HMAC_KEY'),
    adminToken: g.str('ADMIN_TOKEN'),
    dbPassword: g.str('DB_PASSWORD'),
    telegramBotToken: g.str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: g.str('TELEGRAM_CHAT_ID', ''),
    turnstileSecret: g.str('TURNSTILE_SECRET', ''),
  };
  if (secrets.adminToken.length < 24) throw new Error('config: ADMIN_TOKEN must be ≥ 24 characters');

  const dbUrl = g.str('DB_URL', '');
  const dbDriver = g.oneOf('DB_DRIVER', dbUrl ? 'pg' : 'pglite', ['pg', 'pglite']);
  if (dbDriver === 'pg' && !dbUrl) throw new Error('config: DB_DRIVER=pg needs DB_URL');

  const cfg = {
    version: VERSION,
    proto: PROTO_VERSION,
    env: nodeEnv,
    inDocker,
    serverRoot: SERVER_ROOT,
    repoRoot: REPO_ROOT,
    game: { host: g.str('GAME_HOST', anyHost), port: gamePort },
    // admin is localhost-only. Inside Docker it must listen on 0.0.0.0 of the container network; the compose file
    // publishes it on 127.0.0.1 of the host only (S5). The admin token is required on every admin API call anyway.
    admin: { host: g.str('ADMIN_HOST', anyHost), port: adminPort },
    publicWsUrl: g.str('PUBLIC_WS_URL', `ws://127.0.0.1:${gamePort}/play`),
    publicHttpUrl: g.str('PUBLIC_HTTP_URL', `http://127.0.0.1:${gamePort}`),
    allowedOrigins: g.list('ALLOWED_ORIGINS', DEFAULT_ORIGINS),
    allowNoOrigin: g.bool('ALLOW_NO_ORIGIN', true),    // bots / curl / native clients send no Origin header
    trustProxy: g.oneOf('TRUST_PROXY', 'none', ['none', 'cloudflare']),
    transport: g.oneOf('TRANSPORT', 'auto', ['auto', 'uws', 'ws']),
    db: {
      driver: dbDriver,
      url: dbUrl,
      pgliteDir: g.str('PGLITE_DIR', path.join(SERVER_ROOT, 'data', 'pglite')),   // 'memory' = in-process, volatile
      poolMax: g.int('DB_POOL_MAX', 10, 1, 200),
    },
    secrets,
    capacity: g.int('CAPACITY', CAPACITY_DEFAULT, 1, 100000),
    inviteRequired: g.bool('INVITE_REQUIRED', true),
    dayEpoch: g.int('DAY_EPOCH', DEFAULT_DAY_EPOCH, 0, Number.MAX_SAFE_INTEGER),
    dayLength: g.int('DAY_LENGTH', DAY_LENGTH, 60, 86400),
    tickHz: g.int('TICK_HZ', TICK_HZ, 1, 120),
    snapHz: g.int('SNAP_HZ', SNAP_HZ, 1, 60),
    httpBodyLimit: g.int('HTTP_BODY_LIMIT', 16 * 1024, 256, 1024 * 1024),
    logLevel: g.oneOf('LOG_LEVEL', nodeEnv === 'test' ? 'warn' : 'info', ['debug', 'info', 'warn', 'error', 'silent']),
    logFormat: g.oneOf('LOG_FORMAT', 'json', ['json', 'pretty']),
    dataDir: g.str('DATA_DIR', path.join(SERVER_ROOT, 'data')),
  };
  return deepFreeze(cfg);
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

// Redacted view for logs / the admin page.
export function publicConfig(cfg) {
  const { secrets, ...rest } = cfg;
  const red = {};
  for (const [k, v] of Object.entries(secrets)) red[k] = v ? '[set]' : '';
  return { ...rest, secrets: red, db: { ...cfg.db, url: cfg.db.url ? cfg.db.url.replace(/\/\/([^:@/]+):[^@]*@/, '//$1:***@') : '' } };
}
