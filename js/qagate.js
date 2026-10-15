// js/qagate.js — may this page expose the QA / debug helpers that matter in MULTIPLAYER (window.__hp.net: say/drop/
// rejoin/avatars/setBlocked…, and __hp.teleport while online)?
// Yes only on a developer's own machine (localhost, 127.0.0.1, [::1], *.localhost — every tools/qa harness serves the game
// from 127.0.0.1) or with ?qa=1 in the URL (the harnesses pass it too). NOT for navigator.webdriver: a player can start
// Chrome with --enable-automation and get it for free (codebase_hooks §9 item 17, riders fixer 15/10/2026).
// The server never trusts the client anyway (move.js validator, chat filter, rate limits); this only keeps the easy
// buttons out of production players' consoles.
export function qaAllowed(loc = (typeof location !== 'undefined' ? location : null)) {
  try {
    if (!loc) return false;
    const h = String(loc.hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')) return true;
    return new URLSearchParams(loc.search || '').get('qa') === '1';
  } catch (e) { return false; }
}
