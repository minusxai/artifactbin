# syntax=docker/dockerfile:1

FROM node:22 AS builder
WORKDIR /app

COPY package*.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/cli/package.json ./services/cli/package.json
COPY services/app/scripts/copy-assets.mjs ./services/app/scripts/copy-assets.mjs
COPY services/cli/scripts/prepare-pty.mjs ./services/cli/scripts/prepare-pty.mjs
# THE INSTALL LAYER IS KEYED ON MANIFESTS ONLY. `npm ci` reads the root files
# and each workspace's package.json and nothing else, but docker rebuilds a
# layer when anything copied above it changes — so `COPY services ./services`
# sitting here made every source edit reinstall, and made this stage's ~518 MB
# result a NEW layer that buildx re-uploaded to the Actions cache on every run
# (63.7s of the image job, and five copies of one blob against a shared 10 GB
# budget). The tree lands AFTER; the image's contents are identical.
#
# `npm ci` runs the app workspace's postinstall, which chdirs to its own
# package dir and reads only node_modules — so the script file is its whole
# requirement, and it rides up here with the manifests.
#
# `--no-audit` ON EVERY INSTALL: `npm ci` otherwise blocks on npm's advisory
# endpoint and retries twice when it fails. That endpoint degraded on
# 2026-09-04 and this repo's install went 15s → 421s, ten times over across the
# five Dockerfiles, cancelling the `image` job at its 30-minute cap. The
# lockfile is pinned, so the verdict cannot change what is installed. The repo
# `.npmrc` says the same for every install outside a build context; a Dockerfile
# gets the flag on the command, where it cannot be half-applied per stage.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --cache /root/.npm
COPY services ./services

COPY scripts ./scripts
COPY services/app/app ./app
COPY services/app/components ./components
COPY services/app/lib ./lib
COPY services/app/orchestrator ./orchestrator
COPY services/app/skills ./skills
COPY services/app/public ./public
COPY services/app/auth.ts services/app/postcss.config.mjs server.ts tsconfig.json vite.config.mts ./
COPY services/app/server ./server
COPY services/app/web ./web

RUN --mount=type=cache,target=/app/node_modules/.vite npm run build \
    && node scripts/build-server.mjs dist/server.mjs server.ts \
    && node scripts/build-server.mjs dist/sql-server.mjs services/sql/src/server.ts

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    APP__PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/cli/package.json ./services/cli/package.json
# Manifests only, for the reason the builder stage states above — this is the
# stage whose layer is the 518 MB one.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --ignore-scripts --cache /root/.npm \
    && node -e "const {DuckDBInstance}=require('@duckdb/node-api'); DuckDBInstance.create(':memory:').then(()=>console.log('duckdb ok')).catch((e)=>{console.error(e);process.exit(1)})" \
    && node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
COPY services ./services

COPY --from=builder /app/dist/server.mjs ./server.mjs
COPY --from=builder /app/dist/sql-server.mjs ./sql-server.mjs
COPY --from=builder /app/services/app/dist/web ./dist/web
COPY --from=builder /app/services/app/public ./public
COPY --from=builder /app/services/app/orchestrator ./orchestrator
COPY --from=builder /app/services/app/skills ./skills
COPY --from=builder /app/services/app/lib/story-runtime/dist ./lib/story-runtime/dist
COPY scripts/setup.mjs ./scripts/setup.mjs
COPY scripts/lib/dev-ports.mjs ./scripts/lib/dev-ports.mjs
COPY scripts/lib/setup-plan.mjs ./scripts/lib/setup-plan.mjs

RUN test -f ./sql-server.mjs \
    # The fifth service runs IN-PROCESS here (server.ts registers its writer on
    # the app's own database handle), so there is no third bundle — but the
    # workspace must be installed, or that registration cannot resolve.
    && test -d node_modules/@artifactbin/events \
    && test -d ./skills/artifactbin \
    && test -f ./public/story/manifest.json \
    && node -e "const m=require('./public/story/manifest.json');for(const u of [m.entry,...(m.lazy||[])]) require('fs').accessSync('./public'+u)" \
    && mkdir -p /app/data/pglite /app/.artifact-objects \
    && chown -R node:node /app/data /app/.artifact-objects

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node
CMD ["node", "server.mjs"]
