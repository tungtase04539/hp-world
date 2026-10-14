// server/ops/healthcheck.mjs — S5. Docker HEALTHCHECK: GET http://127.0.0.1:$GAME_PORT/healthz inside the container.
// Exit 0 when {ok: true}, 1 otherwise (3 s timeout). No dependencies, no output on success.
const port = Number(process.env.GAME_PORT || 9100);
try {
  const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
  const j = await r.json();
  process.exit(r.ok && j.ok ? 0 : 1);
} catch (e) {
  console.error('healthcheck failed:', e.message);
  process.exit(1);
}
