// server/ops/container-main.mjs — S5. Entry point INSIDE the Docker image (CMD of server/Dockerfile).
// Same as `node src/main.js` but never touches the filesystem for secrets: the image's root FS is read-only and the
// secrets arrive as environment variables from server/.env via compose `env_file` (they are never baked into the image).
// So: no ensureEnvFile(), loadConfig({envFile: null}); NODE_ENV=production refuses to start without every secret.
import { startServer } from '../src/main.js';
import { loadConfig, publicConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';

const config = loadConfig({ envFile: null });
const log = createLogger({ level: config.logLevel, format: config.logFormat, bindings: { svc: 'hp-server' } });
log.info('config', publicConfig(config));
let app;
let stopping = false;
const shutdown = async (sig) => {
  if (stopping) return;
  stopping = true;
  try { if (app) await app.stop(sig); } catch (e) { log.error('stop failed', { err: e }); } finally { process.exit(0); }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));
try {
  app = await startServer({ config, log });
} catch (e) {
  log.error('startup failed', { err: e });
  process.exit(1);
}
