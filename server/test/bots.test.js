// S4 bot harness tests: histograms, road graph on the real map data, netem ordering, and end-to-end scenario runs
// against (a) the scripted fake server (full protocol: auth → join → HELLO → WELCOME → snapshots, abuse, resume) and
// (b) the real foundation server (ping-level mode). No Docker, no Chrome; bots run in forked worker processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { LogHist, LinHist, rng } from '../bots/lib/stats.mjs';
import { buildRoadGraph, Walker, isWater } from '../bots/lib/roadgraph.mjs';
import { NetemQueue } from '../bots/lib/netem.mjs';
import { startFakeServer } from '../bots/fakeserver.mjs';
import { runScenario } from '../bots/run.mjs';
import { buildPlan, SCENARIOS } from '../bots/scenarios.mjs';
import { SPAWNS } from '../../js/shared/spawns.js';
import { EXTRAS } from '../../js/terrain.js';
import { bootTestServer } from './helpers/client.mjs';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `hpbots-${name}-`));

test('LogHist / LinHist: quantiles and merge', () => {
  const a = new LogHist(), b = new LogHist();
  for (let i = 1; i <= 1000; i++) (i % 2 ? a : b).add(i);
  const m = LogHist.from(a.toJSON()).merge(b.toJSON());
  assert.equal(m.n, 1000);
  assert.ok(Math.abs(m.quantile(0.5) - 500) / 500 < 0.03, `p50 ${m.quantile(0.5)}`);
  assert.ok(Math.abs(m.quantile(0.99) - 990) / 990 < 0.03, `p99 ${m.quantile(0.99)}`);
  assert.equal(m.max, 1000);
  const l = new LinHist(2048);
  for (let i = 0; i < 100; i++) l.add(i);
  const l2 = LinHist.from(l.toJSON()).merge(l.toJSON());
  assert.equal(l2.n, 200);
  assert.equal(l2.quantile(0.95), 94);
  assert.equal(l2.countAbove(97), 4);
});

test('road graph: real streets, connected, dry; spawns reachable; walker stays dry', () => {
  const g = buildRoadGraph();
  assert.ok(g.nodes > 1500, `nodes ${g.nodes}`);
  assert.ok(g.lengthM > 60000, `length ${g.lengthM} m`);
  for (let i = 0; i < g.nodes; i++) assert.equal(isWater(g.x[i], g.z[i]), false, `node ${i} in water`);
  for (const s of SPAWNS) {
    const n = g.nearest(s.x, s.z);
    const d = Math.hypot(g.x[n] - s.x, g.z[n] - s.z);
    assert.ok(d < 60, `spawn ${s.id} is ${d.toFixed(1)} m from the graph`);
    for (let t = 0; t <= 1; t += 0.05) assert.equal(isWater(s.x + (g.x[n] - s.x) * t, s.z + (g.z[n] - s.z) * t), false, `spawn ${s.id}: walk to the graph crosses water`);
  }
  const w = new Walker(g, rng(7), SPAWNS[5].x, SPAWNS[5].z);
  assert.ok(w.goTo(EXTRAS.square[0], EXTRAS.square[1]), 'route from Lạch Tray to the Opera square');
  let wet = 0, moved = 0;
  for (let i = 0; i < 4000; i++) { moved += w.step(1.5); if (isWater(w.x, w.z)) wet++; }
  assert.equal(wet, 0);
  assert.ok(moved > 5000, `moved ${moved}`);
});

test('netem: FIFO order, delay within bounds, loss stalls', async () => {
  const got = [];
  const q = new NetemQueue({ delayMs: 20, jitterMs: 10, loss: 0.2, rtoMinMs: 30, rtoMaxMs: 40 }, rng(3), (x) => got.push([x, performance.now()]));
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) q.push(i);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(got.map((g) => g[0]), Array.from({ length: 50 }, (_, i) => i));
  assert.ok(got[0][1] - t0 >= 9, 'first message delayed');
  assert.ok(q.stalls > 0, 'some stalls');
  q.close();
});

test('scenarios: every scenario builds a plan; abuse mix covers all classes', () => {
  for (const name of Object.keys(SCENARIOS)) {
    const p = buildPlan(name, { n: 120, mode: 'full' });
    assert.equal(p.specs.length, 120);
    for (const s of p.specs) assert.ok(Number.isFinite(s.startAt) && s.startAt >= 0);
  }
  const ab = buildPlan('abuse', { n: 200, mode: 'full' });
  const classes = new Set(ab.specs.map((s) => s.abuse).filter(Boolean));
  assert.ok(classes.has('speed_hack') && classes.has('replayed_ticket') && classes.has('chat_bypass') && classes.size >= 14, [...classes].join());
  assert.ok(!buildPlan('abuse', { n: 200, mode: 'ping' }).specs.some((s) => s.abuse === 'replayed_ticket'));
  const ne = buildPlan('netem-lite', { n: 100 });
  assert.equal(ne.specs.filter((s) => s.netem).length, 30);
});

test('end-to-end vs fake server: smoke (full protocol), reconnect (resume), abuse', { timeout: 120000 }, async () => {
  const srv = await startFakeServer({ port: 0, adminPort: 0 });
  try {
    const base = { url: srv.url, admin: srv.adminUrl, quiet: true, scrapeMs: 1000 };
    const smoke = await runScenario({ ...base, scenario: 'smoke', n: 12, dur: 8, out: tmp('smoke'), workers: 2, dropPerMin: 0 });
    const r = smoke.report;
    assert.equal(r.meta.mode, 'full');
    assert.equal(r.decode.errors, 0);
    assert.equal(r.connect.everLive, 12);
    assert.ok(r.snapshots.count > 100, `snapshots ${r.snapshots.count}`);
    assert.ok(r.traffic.opsIn.WELCOME === 12 && r.traffic.opsIn.PONG > 20);
    assert.equal(r.corrections.honestTotal, 0);
    assert.ok(fs.existsSync(path.join(smoke.out, 'report.md')) && fs.existsSync(path.join(smoke.out, 'report.json')));

    const rc = await runScenario({ ...base, scenario: 'reconnect', n: 10, dur: 9, dropAt: 3, reconnectMax: 2, startSpread: 1, out: tmp('reconnect'), workers: 1 });
    assert.equal(rc.report.resume.attempts, 10);
    assert.equal(rc.report.resume.ok, 10, JSON.stringify(rc.report.resume));
    assert.equal(rc.report.acceptance.find((a) => a.name.startsWith('resume')).result, 'PASS');

    const ab = await runScenario({ ...base, scenario: 'abuse', n: 40, dur: 13, startSpread: 2, out: tmp('abuse'), workers: 2 });
    const cls = ab.report.abuse.classes;
    for (const k of ['bad_opcode', 'oversize', 'forged_ticket', 'replayed_ticket', 'teleport', 'bad_proto']) {
      assert.ok(cls[k] && cls[k].detected === cls[k].started && cls[k].started > 0, `${k}: ${JSON.stringify(cls[k])}`);
    }
    assert.equal(ab.report.abuse.chatBypass.leakedVerbatim, 0);
  } finally {
    await srv.stop();
  }
});

// integration: the merged server implements auth/join, so auto mode selects the full protocol; the invite comes from
// S2's createInviteBatch (same hash as S3's admin page)
test('end-to-end vs the merged game server: full mode (invite → guest → join → HELLO → snapshots)', { timeout: 90000 }, async () => {
  const s = await bootTestServer();
  try {
    const [invite] = await s.app.get('auth').createInviteBatch({ count: 1, uses: 50, batch: 'bots-test', note: 'test' });
    const run = await runScenario({ scenario: 'smoke', url: s.game, admin: s.admin, n: 6, dur: 8, out: tmp('real'), quiet: true, workers: 1, scrapeMs: 1000, dropPerMin: 0, invite });
    const r = run.report;
    assert.equal(r.meta.mode, 'full');
    assert.equal(r.decode.errors, 0);
    assert.equal(r.connect.everLive, 6, JSON.stringify(r.connect));
    assert.ok((r.traffic.opsIn.SNAPSHOT || 0) > 6 * 20, JSON.stringify(r.traffic.opsIn));
    assert.ok((r.serverCounters['hp_ws_play_messages_in_total{op="STATE"}'] || 0) > 50, JSON.stringify(r.serverCounters));
    assert.ok(r.server.scrapesOk >= 3);
    assert.equal(s.app.get('sessions').count(), 0, 'bots leave at the end');
  } finally {
    await s.app.stop('test');
  }
});
