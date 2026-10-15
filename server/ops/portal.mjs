// server/ops/portal.mjs — fixer round 1 (SEC-3). A minimal TCP forwarder that runs in its own container ("portal").
// It is the ONLY container on the ordinary bridge network (hostlink: published 127.0.0.1 ports + Internet egress). The
// game container sits on internal-only networks (edge, backend, adminlink) and therefore cannot reach the home LAN, the
// router or services the Windows host binds on 127.0.0.1 — even if uWS / Node / the decoder were exploited.
//
// The portal parses nothing (no HTTP, no WebSocket): bytes are piped both ways.
//   PORTAL_MAP = "listenPort=host:port,…"   e.g. "9100=game:9100,9101=game:9101,8443=api.telegram.org:443"
// 9100 / 9101: host 127.0.0.1 → game (the admin port allows ONLY the portal's fixed adminlink address, ADMIN_ALLOW_IPS).
// 8443: the game's only way out, to ONE fixed destination (Telegram alerts; TLS is end-to-end, the game verifies the
//       api.telegram.org certificate — see src/alerts.js TELEGRAM_VIA).
import net from 'node:net';

const MAX_CONNS = Number(process.env.PORTAL_MAX_CONNS) || 20000;
const map = String(process.env.PORTAL_MAP || '').split(',').map((s) => s.trim()).filter(Boolean).map((e) => {
  const m = /^(\d+)=([A-Za-z0-9.-]+):(\d+)$/.exec(e);
  if (!m) throw new Error(`portal: bad PORTAL_MAP entry "${e}"`);
  return { listen: Number(m[1]), host: m[2], port: Number(m[3]) };
});
if (!map.length) { console.error('portal: PORTAL_MAP is empty'); process.exit(1); }

let open = 0;
for (const r of map) {
  const srv = net.createServer({ pauseOnConnect: true, noDelay: true }, (c) => {
    if (open >= MAX_CONNS) { c.destroy(); return; }
    open++;
    let done = false;
    const up = net.connect({ host: r.host, port: r.port, noDelay: true });
    const end = () => { if (done) return; done = true; open--; c.destroy(); up.destroy(); };
    c.on('error', end); up.on('error', end); c.on('close', end); up.on('close', end);
    up.setTimeout(10_000, () => { if (!up.readyState || up.connecting) end(); });   // connect timeout only
    up.once('connect', () => { up.setTimeout(0); c.pipe(up); up.pipe(c); c.resume(); });
  });
  srv.maxConnections = MAX_CONNS;
  srv.on('error', (e) => { console.error(`portal ${r.listen}: ${e.message}`); process.exit(1); });
  srv.listen(r.listen, '0.0.0.0', () => console.log(`portal: ${r.listen} → ${r.host}:${r.port}`));
}
const stop = () => process.exit(0);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
