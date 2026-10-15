// js/net/telemetry.js — số liệu mạng CỤC BỘ cho HUD và QA (`__hp.net.stats()`). KHÔNG gửi đi đâu (MP-2 C1).
// Đếm theo đồng hồ THẬT (performance.now), không theo `time/dt` đã kẹp của vòng frame.
export function createTelemetry() {
  const t0 = performance.now();
  const c = {
    stateSent: 0, snapsIn: 0, snapRecords: 0, corrections: 0, chatSent: 0, chatIn: 0, chatRejected: 0,
    reconnects: 0, resumes: 0, rejoins: 0, welcomes: 0, joinErrors: 0, offlineMs: 0,
  };
  let rtt = NaN, rttMed = NaN, offlineSince = 0;
  const rttWin = [];
  return {
    c,
    inc(k, n = 1) { c[k] = (c[k] || 0) + n; },
    rtt(v, med) {
      if (Number.isFinite(v)) { rtt = v; rttWin.push(v); if (rttWin.length > 60) rttWin.shift(); }
      if (Number.isFinite(med)) rttMed = med;
    },
    offline(on) {
      const now = performance.now();
      if (on && !offlineSince) offlineSince = now;
      else if (!on && offlineSince) { c.offlineMs += now - offlineSince; offlineSince = 0; }
    },
    get rttMs() { return Number.isFinite(rttMed) ? rttMed : rtt; },
    snapshot() {
      const s = rttWin.slice().sort((a, b) => a - b);
      const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null);
      return { ...c, upS: Math.round((performance.now() - t0) / 1000), rttLast: Number.isFinite(rtt) ? +rtt.toFixed(1) : null,
        rttP50: q(0.5), rttP95: q(0.95) };
    },
  };
}
