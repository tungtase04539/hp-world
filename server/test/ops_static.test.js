// S5: static checks of the self-host ops files (compose hardening, Dockerfile, tunnel ingress, PowerShell scripts).
// Runs everywhere; the PowerShell parse check runs only on Windows (Windows PowerShell 5.1 = what the owner has).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');
const read = (p) => fs.readFileSync(path.join(SERVER, p), 'utf8').replace(/\r\n/g, '\n');
const compose = read('docker-compose.yml');

// tiny indentation-based section splitter for the compose file (no YAML dependency)
function serviceBlocks(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  const out = {};
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;                       // next top-level key
    const m = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(l);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(l);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n');
  return out;
}

test('compose: every service is hardened (anchor), limited, and never privileged / docker.sock / host network', () => {
  const svcs = serviceBlocks(compose);
  assert.deepEqual(Object.keys(svcs).sort(), ['backup', 'db', 'game', 'quicktunnel', 'tunnel']);
  const anchor = compose.slice(compose.indexOf('x-hardening: &hardening'), compose.indexOf('services:'));
  for (const k of ['read_only: true', 'no-new-privileges:true', '- ALL', 'max-size: "10m"', 'max-file: "5"']) assert.ok(anchor.includes(k), k);
  for (const [name, b] of Object.entries(svcs)) {
    assert.ok(b.includes('<<: *hardening'), `${name} uses the hardening anchor`);
    assert.match(b, /\n\s+cpus: [\d.]+/, `${name} cpus`);
    assert.match(b, /\n\s+mem_limit: \d+[mg]/, `${name} mem_limit`);
    assert.match(b, /\n\s+pids_limit: \d+/, `${name} pids_limit`);
    assert.ok(!/privileged|docker\.sock|network_mode|cap_add|pid: host|ipc: host/.test(b), `${name} has no escape hatch`);
  }
  assert.match(svcs.game, /cpus: 4\b/); assert.match(svcs.game, /mem_limit: 2g/); assert.match(svcs.game, /pids_limit: 512/);
  assert.match(svcs.db, /cpus: 2\b/); assert.match(svcs.db, /mem_limit: 1g/);
  for (const t of ['tunnel', 'quicktunnel']) { assert.match(svcs[t], /cpus: 0\.5/); assert.match(svcs[t], /mem_limit: 256m/); }
  assert.ok(!/docker\.sock/.test(compose.replace(/#.*$/gm, '')));
});

test('compose: published ports are 127.0.0.1 only; only the game publishes; the only bind mount is data/backups', () => {
  const svcs = serviceBlocks(compose);
  const ports = [...compose.matchAll(/^\s+- "([^"]+):(\d+)"\s*$/gm)].map((m) => m[1]);
  assert.ok(ports.length >= 2);
  for (const p of ports) assert.ok(p.startsWith('127.0.0.1:'), `port ${p} must be 127.0.0.1-only`);
  for (const n of ['db', 'tunnel', 'quicktunnel', 'backup']) assert.ok(!/\n\s+ports:/.test(svcs[n]), `${n} publishes nothing`);
  const binds = [];
  for (const b of Object.values(svcs)) {
    const m = /\n {4}volumes:\n((?: {6}- .*\n?)+)/.exec(b + '\n');
    if (m) for (const x of m[1].matchAll(/- ([^:\s]+):/g)) if (/^[./]|^[A-Za-z]:/.test(x[1])) binds.push(x[1]);
  }
  assert.deepEqual(binds, ['./data/backups']);
  assert.ok(svcs.backup.includes('./data/backups:/backups'));
});

test('compose: networks — db only on the internal backend, cloudflared only on edge (+egress), admin denies edge+backend', () => {
  const svcs = serviceBlocks(compose);
  const nets = compose.slice(compose.indexOf('\nnetworks:\n'));
  assert.match(nets, /edge:\n\s+driver: bridge\n\s+internal: true/);
  assert.match(nets, /backend:\n\s+driver: bridge\n\s+internal: true/);
  const netsOf = (b) => { const m = /\n {4}networks:\n((?: {6}.*\n?)+)/.exec(b + '\n'); return m ? [...m[1].matchAll(/^ {6}-? ?([a-z]+)/gm)].map((x) => x[1]) : []; };
  assert.deepEqual(netsOf(svcs.db), ['backend']);
  assert.deepEqual(netsOf(svcs.backup), ['backend']);
  assert.deepEqual(netsOf(svcs.tunnel).sort(), ['cfout', 'edge']);
  assert.deepEqual(netsOf(svcs.quicktunnel).sort(), ['cfout', 'edge']);
  assert.deepEqual(netsOf(svcs.game).sort(), ['backend', 'edge', 'hostlink']);
  assert.match(svcs.game, /ADMIN_DENY_CIDRS: \$\{HPMP_EDGE_SUBNET:-[\d./]+\},\$\{HPMP_BACKEND_SUBNET:-[\d./]+\}/);
  assert.match(svcs.game, /TRUST_PROXY: cloudflare/);
  assert.match(svcs.tunnel, /TUNNEL_TOKEN: \$\{TUNNEL_TOKEN:-\}/);
});

test('images pinned by digest; Dockerfile uses trixie (uWS needs glibc ≥ 2.38), non-root, healthcheck, npm ci --ignore-scripts', () => {
  for (const m of compose.matchAll(/^\s+image: (\S+)/gm)) {
    const img = m[1];
    if (img.startsWith('${')) continue;                 // locally built images (game, tunnel)
    assert.match(img, /@sha256:[0-9a-f]{64}$/, img);
  }
  const df = read('Dockerfile');
  assert.match(df, /node:24-trixie-slim@sha256:[0-9a-f]{64}/);
  assert.ok(!/bookworm/.test(df.split('\n').filter((l) => !l.startsWith('#')).join('\n')));
  assert.match(df, /^USER node$/m);
  assert.match(df, /^HEALTHCHECK /m);
  assert.match(df, /npm ci --omit=dev --ignore-scripts/);
  assert.match(df, /container-main\.mjs/);
  const cf = read('ops/cloudflared/Dockerfile');
  assert.match(cf, /^FROM cloudflare\/cloudflared:[\d.]+@sha256:[0-9a-f]{64}$/m);
  const ign = read('Dockerfile.dockerignore');
  assert.match(ign, /^\*$/m);
  assert.match(ign, /^\*\*\/\.env$/m);
  assert.match(ign, /^\*\*\/node_modules$/m);
});

test('every file the server imports from js/ is whitelisted into the image', () => {
  const ign = read('Dockerfile.dockerignore');
  const df = read('Dockerfile');
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) walk(path.resolve(path.dirname(file), m[1]));
    for (const m of src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) walk(path.resolve(path.dirname(file), m[1]));
  };
  walk(path.join(SERVER, 'src', 'main.js'));
  walk(path.join(SERVER, 'ops', 'container-main.mjs'));
  const js = [...seen].map((f) => path.relative(REPO, f).split(path.sep).join('/')).filter((f) => f.startsWith('js/'));
  assert.ok(js.length > 0);
  for (const f of js) {
    const ok = f.startsWith('js/shared/') ? ign.includes('!js/shared/') && df.includes('COPY js/shared/') : ign.includes('!' + f) && df.includes(f.replace(/^js\//, 'js/'));
    assert.ok(ok, `${f} is imported by the server but not copied into the image (Dockerfile + Dockerfile.dockerignore)`);
  }
});

test('tunnel ingress routes only /play /probe /healthz /v1/* and ends with 404', () => {
  const cfg = read('ops/cloudflared/config.yml');
  const rules = [...cfg.matchAll(/^\s+- (?:path: (\S+)\n\s+)?service: (\S+)/gm)].map((m) => ({ path: m[1], service: m[2] }));
  assert.deepEqual(rules, [
    { path: '^/(play|probe|healthz)$', service: 'http://game:9100' },
    { path: '^/v1/', service: 'http://game:9100' },
    { path: undefined, service: 'http_status:404' },
  ]);
  assert.ok(!/9101|admin:/.test(cfg.replace(/^#.*$/gm, '')));
});

test('ops scripts: UTF-8 BOM (Windows PowerShell 5.1), test mode never writes the live marker, no secrets', () => {
  const dir = path.join(SERVER, 'ops');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ps1'));
  for (const f of ['mo-may-chu.ps1', 'tat-may-chu.ps1', 'trang-thai.ps1', 'sao-luu.ps1', 'khoi-phuc.ps1', 'tao-ma-moi.ps1', 'cai-lich.ps1', 'khoa-khan-cap.ps1', 'giu-may-thuc.ps1', 'chung.ps1']) assert.ok(files.includes(f), f);
  for (const f of files) {
    const b = fs.readFileSync(path.join(dir, f));
    assert.ok(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, `${f} must start with a UTF-8 BOM`);
    const t = b.toString('utf8');
    assert.ok(!/(ADMIN_TOKEN|TUNNEL_TOKEN|DB_PASSWORD)\s*=\s*\S{8,}/.test(t), `${f} contains no secret value`);
    assert.ok(!/trycloudflare\.com\/|[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.trycloudflare\.com/.test(t), `${f} contains no tunnel URL`);
  }
  const mo = fs.readFileSync(path.join(dir, 'mo-may-chu.ps1'), 'utf8');
  assert.match(mo, /if \(-not \$s\.Test\) \{\s*\r?\n\s*Set-Content -LiteralPath \$s\.Marker/);
  const tat = fs.readFileSync(path.join(dir, 'tat-may-chu.ps1'), 'utf8');
  assert.match(tat, /if \(-not \$s\.Test\) \{\s*\r?\n\s*Remove-Item -LiteralPath \$s\.Marker/);
  const chung = fs.readFileSync(path.join(dir, 'chung.ps1'), 'utf8');
  assert.match(chung, /hpworld_server_live\.txt/);
  assert.match(chung, /if \(\$test -and \(\$proj -eq 'hpworld'/);   // test mode refuses production project/ports
});

test('ops scripts parse in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  const dir = path.join(SERVER, 'ops');
  const ps = `$ErrorActionPreference='Stop'; $bad=0; Get-ChildItem -LiteralPath '${dir}' -Filter *.ps1 | ForEach-Object { $t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$t, [ref]$e); if ($e.Count) { $bad++; $e | ForEach-Object { Write-Output ($_.Extent.File + ':' + $_.Extent.StartLineNumber + ' ' + $_.Message) } } }; Write-Output "BAD=$bad"`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BAD=0/, r.stdout);
});

test('.env.example documents every ops variable without real values; .gitignore keeps secrets and data out', () => {
  const ex = read('.env.example');
  for (const k of ['TUNNEL_TOKEN', 'BACKUP_COPY_DIR', 'BACKUP_AT', 'HPMP_GAME_PORT', 'HPMP_ADMIN_PORT']) assert.match(ex, new RegExp('^#?\\s*' + k + '=', 'm'), k);
  for (const m of ex.matchAll(/^(ADMIN_TOKEN|TUNNEL_TOKEN|DB_PASSWORD|JWT_PRIVATE_KEY|TICKET_HMAC_KEY)=(\S*)/gm)) assert.ok(!m[2] || m[2].startsWith('#'), `${m[1]} must be empty in the example`);
  const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(gi, /^server\/\.env$/m);
  assert.match(gi, /^server\/data\/\*$/m);
});
