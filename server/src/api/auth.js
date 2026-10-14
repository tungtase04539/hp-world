// api/auth.js — OWNER: S2. Guest accounts with invite codes, refresh-token rotation, recovery codes (SPEC §3.1).
//   POST /v1/auth/guest   {nickname, deviceId, inviteCode} → {accessToken, refreshToken, recoveryCode, account}
//   POST /v1/auth/refresh {refreshToken}                    → {accessToken, refreshToken}
//   POST /v1/auth/recover {code, deviceId}                  → {accessToken, refreshToken, account}
// Access JWT: EdDSA (jose) with config.secrets.jwtPrivateKey (PKCS#8 DER base64) / jwtKid, 15 min.
// Google link = GĐ2 (leave an extension point: provider 'google' in identities).
// FOUNDATION STUB: the routes exist and answer 501 {error: 'not_implemented'}.
import { API_ERR } from '../../../js/shared/protocol.js';

export function register(app) {
  const notImpl = (req, res) => res.error(501, API_ERR.NOT_IMPLEMENTED);
  app.http.post('/v1/auth/guest', notImpl);
  app.http.post('/v1/auth/refresh', notImpl);
  app.http.post('/v1/auth/recover', notImpl);
}
