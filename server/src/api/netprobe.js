// api/netprobe.js — OWNER: S5. Network probe for netprobe.html (SPEC §3.5):
//   WS /probe          answers PING with PONG only (no ticket, no session); anything else closes the socket.
//   POST /v1/netprobe  {carrier, netType, samples…} → stored for the admin page (rate-limited, no personal data).
// FOUNDATION STUB: /probe works (PING → PONG); POST /v1/netprobe answers 501.
import { Writer, decodeC2S, encodePong } from '../../../js/shared/codec.js';
import { C2S, CLOSE, API_ERR } from '../../../js/shared/protocol.js';

export function register(app) {
  const w = new Writer(64);
  const pool = {};
  app.ws.route('/probe', {
    message(conn, bytes, isBinary) {
      const m = isBinary ? decodeC2S(bytes, pool) : null;
      if (!m || m.op !== C2S.PING) { conn.close(CLOSE.POLICY, 'probe: PING only'); return; }
      conn.send(encodePong(w, m.clientTime, app.nowMs()));
    },
  });
  app.http.post('/v1/netprobe', (req, res) => res.error(501, API_ERR.NOT_IMPLEMENTED));
}
