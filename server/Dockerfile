# syntax=docker/dockerfile:1
# server/Dockerfile — S5. Game server image for the owner's PC (and later a VPS). Build context = REPO ROOT:
#   docker compose -f server/docker-compose.yml build      (compose sets context: .. and this dockerfile)
# Only whitelisted files enter the context (server/Dockerfile.dockerignore): server code + the pure shared modules
# from js/ that the server imports. No secrets, no .env, no node_modules from the host, no user files.
#
# Base image: node:24-trixie-slim (Debian 13, glibc 2.41). NOT bookworm: the uWebSockets.js v20.71.0 linux binary
# needs glibc >= 2.38 and silently falls back to `ws` on bookworm (glibc 2.36). Pinned by digest (multi-arch index).
ARG NODE_IMAGE=node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

FROM ${NODE_IMAGE} AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# npm ci = exact lockfile (uWS tarball checked against its sha512); --ignore-scripts = no install script runs at all
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    IN_DOCKER=true \
    GAME_PORT=9100 \
    ADMIN_PORT=9101 \
    NODE_OPTIONS=--max-old-space-size=1536
WORKDIR /app/server
# shared pure modules (no three, no DOM) — copied at build time, never bind-mounted
COPY js/shared/ /app/js/shared/
COPY js/terrain.js js/mapdata.js js/brands.js js/xsection.js /app/js/
COPY --from=deps /app/server/node_modules ./node_modules
# server code (+ admin page / chat filter lists when present; see the .dockerignore whitelist)
COPY server/ ./
# Fail the BUILD (not the first start) if an import is missing from the image: linking main.js resolves the whole
# static import graph; main.js only starts a server when run directly, so importing it has no side effect.
# Also prints whether uWebSockets.js loads (it must on trixie; otherwise the server uses the ws fallback).
RUN node --input-type=module -e "await import('/app/server/src/main.js'); const { createRequire } = await import('node:module'); try { createRequire('/app/server/package.json')('uWebSockets.js'); console.log('uWS: OK'); } catch (e) { console.log('uWS: NOT LOADABLE, ws fallback:', e.message); }" \
 && chmod -R a-w /app
USER node
EXPOSE 9100 9101
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 CMD ["node", "/app/server/ops/healthcheck.mjs"]
STOPSIGNAL SIGTERM
CMD ["node", "/app/server/ops/container-main.mjs"]
