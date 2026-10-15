// MP-2b fixer round 1 (15/10/2026) — regressions for the review findings that are not movement rules
// (EXPLOIT-MOUNT-TOGGLE lives in riders_regress.test.js):
//   OPS-STALE-TUNNEL-URL     quick tunnel = a NEW container, its URL read only from logs since that start
//   DEPLOY-VERSION-GAP       build SHA in the image + /healthz; version.json on the Pages mirror; scripts compare
//   OPS-NONPROGRAMMER-STEP1  double-click .cmd wrappers (right-click "Run with PowerShell" cannot pass -TamThoi)
//   QAGATE-BYPASS            ?qa=1 only on the developer's own machine / a private LAN address
//   nickname "Zalgo"         ≤ 2 combining marks per letter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qaAllowed } from '../../js/qagate.js';
import { checkNickname } from '../../js/shared/textfilter.js';
import { bootTestServer, getJson } from './helpers/client.mjs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');
const ops = (f) => fs.readFileSync(path.join(SERVER, 'ops', f), 'utf8').replace(/\r\n/g, '\n');
const noComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('quick tunnel: fresh container + URL from the logs of THIS start only (no dead address after a reboot)', () => {
  const chung = noComments(ops('chung.ps1'));
  const fn = chung.slice(chung.indexOf('function Get-QuickTunnelUrl'), chung.indexOf('function Start-QuickTunnelFresh'));
  assert.match(fn, /'inspect', '-f', '\{\{\.State\.Running\}\}\|\{\{\.State\.StartedAt\}\}'/);
  assert.match(fn, /'logs', '--since'/);
  assert.ok(!/'compose'[^\n]*'logs'/.test(fn), 'no full compose logs (they keep the previous run)');
  assert.match(chung, /function Start-QuickTunnelFresh[\s\S]*?'rm', '-f', '-s', 'quicktunnel'[\s\S]*?'up', '-d', '--force-recreate', '--no-deps', 'quicktunnel'/);
  const mo = noComments(ops('mo-may-chu.ps1'));
  assert.ok(!/@\('--profile', 'quicktunnel', 'up', '-d', 'quicktunnel'\)/.test(mo), 'mo-may-chu never restarts the old container');
  assert.match(mo, /Start-QuickTunnelFresh \$s/);
  assert.match(mo, /GIỮ NGUYÊN địa chỉ cũ/);                      // a running quick tunnel is kept (friends keep the link)
  assert.match(mo, /ĐỊA CHỈ ĐÃ ĐỔI so với lần trước/);
  assert.match(mo, /Tunnel tạm vẫn đang chạy — địa chỉ KHÔNG đổi/); // plain re-run mid-evening repeats the address
  const kp = noComments(ops('khoi-phuc.ps1'));
  assert.ok(!/'stop'[^\n]*'quicktunnel'/.test(kp), 'a restore does not stop the quick tunnel (new URL)');
  assert.ok(!/@\('--profile', 'quicktunnel', 'up', '-d', 'quicktunnel'\)/.test(kp));
});

test('build version: image ARG → /healthz build; Pages mirror gets version.json; scripts compare the three', async () => {
  const df = fs.readFileSync(path.join(SERVER, 'Dockerfile'), 'utf8');
  assert.match(df, /^ARG HPMP_BUILD=dev$/m);
  assert.match(df, /^ENV HPMP_BUILD=\$\{HPMP_BUILD\}$/m);
  const compose = fs.readFileSync(path.join(SERVER, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /args:\s*\r?\n(\s*#.*\r?\n)*\s*HPMP_BUILD: \$\{HPMP_BUILD:-dev\}/);
  const wf = fs.readFileSync(path.join(REPO, '.github/workflows/deploy-pages.yml'), 'utf8');
  assert.match(wf, /> version\.json/);
  assert.match(wf, /git add -f version\.json\s*\r?\n\s*TREE=\$\(git write-tree\)/);
  const mo = noComments(ops('mo-may-chu.ps1'));
  assert.match(mo, /\$env:HPMP_BUILD = \$repo\.Short/);
  assert.match(mo, /Test-BuildVersions \$s \$h \$repo/);
  assert.match(noComments(ops('trang-thai.ps1')), /Test-BuildVersions/);
  const s = await bootTestServer({ HPMP_BUILD: 'abc1234' });
  try {
    const h = await getJson(s.game + '/healthz');
    assert.equal(h.body.build, 'abc1234');
  } finally { await s.app.stop(); }
});

test('double-click wrappers: ASCII, CRLF, call an existing script; the tunnel one passes -TamThoi', () => {
  const dir = path.join(SERVER, 'ops');
  const cmds = fs.readdirSync(dir).filter((f) => f.endsWith('.cmd'));
  for (const f of ['mo-may-chu-tam-thoi.cmd', 'trang-thai.cmd', 'tat-may-chu.cmd', 'khoa-khan-cap.cmd', 'tao-ma-moi-buoi-choi.cmd']) assert.ok(cmds.includes(f), f);
  for (const f of cmds) {
    const b = fs.readFileSync(path.join(dir, f));
    assert.ok(b.every((c) => c < 128), `${f} is ASCII (cmd.exe code page)`);
    const t = b.toString('ascii');
    const m = /-File "%~dp0([a-z-]+\.ps1)"/.exec(t);
    assert.ok(m && fs.existsSync(path.join(dir, m[1])), `${f} calls an existing .ps1`);
    assert.match(t, /\r\npause\r\n/, `${f} keeps the window open`);
  }
  assert.match(fs.readFileSync(path.join(dir, 'mo-may-chu-tam-thoi.cmd'), 'ascii'), /mo-may-chu\.ps1" -TamThoi/);
  assert.match(fs.readFileSync(path.join(dir, '.gitattributes'), 'ascii'), /\*\.cmd text eol=crlf/);
});

test('QA gate: ?qa=1 only on the developer machine / private LAN — never on a public host', () => {
  const L = (href) => { const u = new URL(href); return { hostname: u.hostname, search: u.search }; };
  assert.equal(qaAllowed(L('http://127.0.0.1:8826/index.html')), true);
  assert.equal(qaAllowed(L('http://localhost:8080/')), true);
  assert.equal(qaAllowed(L('http://dev.localhost/')), true);
  assert.equal(qaAllowed(L('http://192.168.1.20:8080/?qa=1')), true);
  assert.equal(qaAllowed(L('http://10.0.0.5/?qa=1')), true);
  assert.equal(qaAllowed(L('http://172.20.1.1/?qa=1')), true);
  assert.equal(qaAllowed(L('http://192.168.1.20:8080/')), false);
  assert.equal(qaAllowed(L('https://tungtase04539.github.io/hp-world/?qa=1&server=wss://x.trycloudflare.com')), false);
  assert.equal(qaAllowed(L('http://qa-off.example:8821/?qa=1')), false);
  assert.equal(qaAllowed(L('http://172.32.0.1/?qa=1')), false);
  assert.equal(qaAllowed(L('http://8.8.8.8/?qa=1')), false);
  assert.equal(qaAllowed(null), false);
  // main.js: production handles are null always (not only while online — a reference taken offline stayed live)
  const main = fs.readFileSync(path.join(REPO, 'js/main.js'), 'utf8');
  assert.match(main, /if \(net && !net\.qaOn\) \{\s*\r?\n\s*for \(const k of \['pState', 'world', 'vehicles', 'mount', 'player', 'traffic', 'footprints'\]\) \{\s*\r?\n\s*Object\.defineProperty\(window\.__hp, k, \{ get: \(\) => null,/);
});

test('nickname: ≤ 2 combining marks per letter (Vietnamese ok, "Zalgo" refused)', () => {
  for (const ok of ['Lan Lê Chân', 'Nguyễn Thị Hường', 'Nguyễn Văn', 'Phạm Đức']) assert.equal(checkNickname(ok).ok, true, ok);
  for (const bad of ['Z̀́̂̃̄̅algo', 'Ab́̂̃c', '1́abc']) {
    const r = checkNickname(bad);
    assert.equal(r.ok, false, bad); assert.equal(r.reason, 'chars');
  }
});
