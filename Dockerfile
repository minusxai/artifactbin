# syntax=docker/dockerfile:1

FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
COPY services ./services
RUN --mount=type=cache,target=/root/.npm npm ci --cache /root/.npm

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
COPY services ./services
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --cache /root/.npm \
    && node -e "const {DuckDBInstance}=require('@duckdb/node-api'); DuckDBInstance.create(':memory:').then(()=>console.log('duckdb ok')).catch((e)=>{console.error(e);process.exit(1)})" \
    && node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

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
