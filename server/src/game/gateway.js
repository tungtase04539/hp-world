// game/gateway.js — OWNER: S2. WebSocket endpoint /play: HELLO{ticket} → one session per account → WELCOME → READY →
// AOI snapshots; resume; backpressure; per-connection token buckets; decode errors → close 1008.
//
// FOUNDATION STUB (working): accepts connections on /play, decodes every client message with js/shared/codec.js,
// answers PING with PONG (clock sync works end-to-end), answers HELLO with SYSTEM NOT_IMPLEMENTED, closes the socket
// with 1008 after RATE.BAD_MSG_CLOSE malformed messages. Replace the body of register(); keep the export.
import { Writer, decodeC2S, encodePong, encodeSystem } from '../../../js/shared/codec.js';
import { C2S, SYS, CLOSE, OP_NAMES } from '../../../js/shared/protocol.js';
import { RATE } from '../../../js/shared/constants.js';

export function register(app) {
  const log = app.log.child({ mod: 'gateway' });
  const w = new Writer(2048);
  const pool = {};
  const msgIn = app.metrics.counter('ws_play_messages_in_total', 'messages received on /play');
  const bytesIn = app.metrics.counter('ws_play_bytes_in_total', 'bytes received on /play');
  const bytesOut = app.metrics.counter('ws_play_bytes_out_total', 'bytes sent on /play');
  const decErr = app.metrics.counter('ws_play_decode_errors_total', 'malformed messages on /play');
  const send = (conn, bytes) => { bytesOut.inc(bytes.length); return conn.send(bytes); };

  app.ws.route('/play', {
    open(conn) {
      conn.data = { bad: 0 };
      app.bus.emit('conn:open', { conn });
    },
    message(conn, bytes, isBinary) {
      bytesIn.inc(bytes.length);
      const m = isBinary ? decodeC2S(bytes, pool) : null;
      if (!m || m.err) {
        decErr.inc();
        if (++conn.data.bad >= RATE.BAD_MSG_CLOSE) conn.close(CLOSE.POLICY, 'malformed');
        return;
      }
      msgIn.inc(1, { op: OP_NAMES[m.op] });
      switch (m.op) {
        case C2S.PING: send(conn, encodePong(w, m.clientTime, app.nowMs())); break;
        case C2S.HELLO: send(conn, encodeSystem(w, SYS.NOT_IMPLEMENTED, 0)); break;
        default: break;
      }
    },
    close(conn, code) {
      app.bus.emit('conn:close', { conn, code });
      log.debug('play socket closed', { id: conn.id, code });
    },
  });
}
