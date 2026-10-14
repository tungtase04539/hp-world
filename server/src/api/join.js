// api/join.js — OWNER: S2. POST /v1/join {accessToken, proto, tier} → {wsUrl, ticket (HMAC, 60 s, single use),
// spawnHint} or {queue: {position, etaS}} when at capacity; proto mismatch → 409 {error: 'proto_mismatch'}.
// Ticket key: config.secrets.ticketHmacKey; wsUrl: config.publicWsUrl.
// FOUNDATION STUB: answers 501 {error: 'not_implemented'}.
import { API_ERR } from '../../../js/shared/protocol.js';

export function register(app) {
  app.http.post('/v1/join', (req, res) => res.error(501, API_ERR.NOT_IMPLEMENTED));
}
