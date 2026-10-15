// js/qagate.js — may this page expose the QA / debug helpers that matter in MULTIPLAYER (window.__hp.net: say/drop/
// rejoin/avatars/setBlocked…, __hp.teleport while online, __hp.pState/world/vehicles/mount/player/traffic/footprints)?
// Yes only when the page is served from the developer's own machine:
//   * localhost, 127.0.0.1, [::1], *.localhost — always (every tools/qa harness serves the game from 127.0.0.1);
//   * a private LAN address (10.x, 192.168.x, 172.16–31.x — a phone testing the dev box over Wi-Fi) WITH ?qa=1.
// Never on a public host such as GitHub Pages, whatever the URL says (fixer round 1 MP-2b, QAGATE-BYPASS: `?qa=1` on the
// Pages link used to bring every handle back), and never for navigator.webdriver (a player can start Chrome with
// --enable-automation; codebase_hooks §9 item 17, riders fixer 15/10/2026).
// DISCOURAGEMENT ONLY, not a protection: anyone can still edit the page's JS in DevTools. The defence is the server, which
// never trusts the client (js/shared/move.js validator, chat filter, rate limits).
const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
export function qaAllowed(loc = (typeof location !== 'undefined' ? location : null)) {
  try {
    if (!loc) return false;
    const h = String(loc.hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')) return true;
    if (!PRIVATE_V4.test(h)) return false;
    return new URLSearchParams(loc.search || '').get('qa') === '1';
  } catch (e) { return false; }
}
