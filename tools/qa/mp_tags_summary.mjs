// tools/qa/mp_tags_summary.mjs — so sánh report.json của tools/qa/mp_tags_declutter.mjs (trước/sau), in bảng gọn.
//   node tools/qa/mp_tags_summary.mjs C:/Users/Admin/hp-world-work/mp2b/nametags/before C:/Users/Admin/hp-world-work/mp2b/nametags/after
import fs from 'fs';
import path from 'path';

const dirs = process.argv.slice(2);
const sc = (s) => s && {
  tags: s.tagsDrawnMean, people: s.onscreenPeopleMean, fps: s.fps,
  togglesPerSec: s.togglesPerSec, flickerPerSec: s.flickerPerSec,
  overlapPairs: s.overlap.pairsMean, overlappedTags: s.overlap.overlappedTagsMean, maxPairs: s.overlap.maxPairs,
  tagPassMs: s.tagPassMs.mean, tagPassP95: s.tagPassMs.p95, raFrameMs: s.raStats && s.raStats.ms,
};
const out = {};
for (const d of dirs) {
  const rep = JSON.parse(fs.readFileSync(path.join(d, 'report.json'), 'utf8'));
  for (const [q, r] of Object.entries(rep.runs)) {
    out[`${path.basename(d)}.${q}`] = {
      tier: r.tier, fatal: r.fatal, jsErrors: (r.errorsEnd || r.errors || []).length, programs: [r.programsBase, r.programsAfter],
      mpCalls: r.denseMeasure && r.denseMeasure.mpCalls.perFrame, callsMedian: r.denseMeasure && r.denseMeasure.callsMedian,
      opera: sc(r.operaStatic), walk: sc(r.denseWalkStatic), orbit: sc(r.denseWalkOrbit), high: sc(r.denseHigh),
      heap: r.heap && { windowsTotalKBs: (r.heap.windows || []).map((w) => w.allocTotalKBs), net: r.heap.allocNetKBs,
        netWindows: (r.heap.windows || []).map((w) => w.allocNetKBs), growthMB: r.heap.heapGrowthMB, top: r.heap.topNetFns.slice(0, 4) },
    };
  }
}
console.log(JSON.stringify(out, null, 1));
