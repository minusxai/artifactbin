# syntax=docker/dockerfile:1

FROM node:22-slim AS builder
WORKDIR /repo

COPY package*.json ./
COPY services ./services
COPY scripts ./scripts
COPY tsconfig.json vite.config.mts ./
RUN --mount=type=cache,target=/root/.npm npm ci --cache /root/.npm
RUN npm run build -w services/app \
    && node scripts/build-server.mjs services/app/dist/app.mjs services/app/src/main.ts

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    APP__PORT=3000

COPY package*.json ./
COPY services/app/package.json ./services/app/package.json
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --legacy-peer-deps --ignore-scripts -w services/app --cache /root/.npm \
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/playwright-core \
    && test ! -e node_modules/@artifactbin/sql \
    && test ! -e node_modules/@artifactbin/browser \
    && test ! -e node_modules/@tailwindcss/node \
    && test ! -e node_modules/@tailwindcss/postcss \
    && test ! -e node_modules/tailwindcss \
    && test ! -e node_modules/lightningcss \
    && test ! -e node_modules/vite \
    && test -d node_modules/react \
    && test -d node_modules/@artifactbin/utils

COPY --from=builder /repo/services/app/dist/web ./dist/web
COPY --from=builder /repo/services/app/public ./public
COPY --from=builder /repo/services/app/skills ./skills
COPY --from=builder /repo/services/app/orchestrator ./orchestrator
COPY --from=builder /repo/services/app/lib/story-runtime/dist ./lib/story-runtime/dist
COPY --from=builder /repo/services/app/dist/app.mjs ./app.mjs
RUN mkdir -p /app/.artifact-objects && chown node:node /app/.artifact-objects

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node
CMD ["node", "app.mjs"]
