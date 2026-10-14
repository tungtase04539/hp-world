// server/bots/lib/netem.mjs — "netem-lite": per-bot emulation of a Vietnamese mobile link inside the bot process.
// Adds delay ± jitter to every message in each direction while keeping TCP's in-order delivery (FIFO: a message is
// never delivered before the one ahead of it). "Loss" on a reliable WebSocket shows up as a retransmission stall: with
// probability `loss` a message is held for an extra RTO-like 200–500 ms and everything behind it bunches up → a burst.
export class NetemQueue {
  constructor({ delayMs = 80, jitterMs = 30, loss = 0.02, rtoMinMs = 200, rtoMaxMs = 500 } = {}, rand = Math.random, deliver) {
    this.delayMs = delayMs; this.jitterMs = jitterMs; this.loss = loss; this.rtoMinMs = rtoMinMs; this.rtoMaxMs = rtoMaxMs;
    this.rand = rand; this.deliver = deliver;
    this.q = []; this.lastAt = 0; this.timer = null; this.stalls = 0; this.closed = false;
  }
  _delay() {
    // triangular-ish distribution in [delay − jitter, delay + jitter]
    const j = (this.rand() + this.rand() - 1) * this.jitterMs;
    let d = Math.max(0, this.delayMs + j);
    if (this.rand() < this.loss) { d += this.rtoMinMs + this.rand() * (this.rtoMaxMs - this.rtoMinMs); this.stalls++; }
    return d;
  }
  push(item) {
    if (this.closed) return;
    const now = performance.now();
    const at = Math.max(this.lastAt, now + this._delay());
    this.lastAt = at;
    this.q.push(at, item);
    if (!this.timer) this._arm(now);
  }
  _arm(now) {
    if (!this.q.length || this.closed) { this.timer = null; return; }
    this.timer = setTimeout(() => this._run(), Math.max(0, this.q[0] - now));
  }
  _run() {
    const now = performance.now();
    let i = 0;
    while (i < this.q.length && this.q[i] <= now + 0.5) { const item = this.q[i + 1]; i += 2; try { this.deliver(item); } catch { /* bot handles */ } }
    if (i) this.q.splice(0, i);
    this._arm(now);
  }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.q.length = 0; }
  get pending() { return this.q.length / 2; }
}
