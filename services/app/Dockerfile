# syntax=docker/dockerfile:1
# syntax=docker/dockerfile:1


FROM node:22 AS builder
FROM node:22 AS builder
WORKDIR /repo
WORKDIR /repo


COPY package*.json ./
COPY package*.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/cli/package.json ./services/cli/package.json
COPY services/test-support/package.json ./services/test-support/package.json
COPY services/app/scripts/copy-assets.mjs ./services/app/scripts/copy-assets.mjs
COPY services/app/scripts/copy-assets.mjs ./services/app/scripts/copy-assets.mjs
COPY services/cli/scripts/prepare-pty.mjs ./services/cli/scripts/prepare-pty.mjs
COPY services/cli/scripts/prepare-pty.mjs ./services/cli/scripts/prepare-pty.mjs
# THE INSTALL LAYER IS KEYED ON MANIFESTS ONLY — `npm ci` reads the root files
# THE INSTALL LAYER IS KEYED ON MANIFESTS ONLY — `npm ci` reads the root files
# and each workspace's package.json and nothing else, so copying the source
# and each workspace's package.json and nothing else, so copying the source
# tree above it rebuilt this layer on every edit. The tree lands AFTER; the
# tree above it rebuilt this layer on every edit. The tree lands AFTER; the
# image's contents are identical. The app workspace's postinstall
# image's contents are identical. The app workspace's postinstall
# (copy-assets.mjs) runs on `npm ci` and chdirs to its own package dir to read
# (copy-assets.mjs) runs on `npm ci` and chdirs to its own package dir to read
# node_modules, so the script file is its whole requirement.
# node_modules, so the script file is its whole requirement.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --cache /root/.npm
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --cache /root/.npm
COPY services ./services
COPY services ./services
COPY scripts ./scripts
COPY scripts ./scripts
COPY tsconfig.json vite.config.mts ./
COPY tsconfig.json vite.config.mts ./
RUN npm run build -w services/app \
RUN npm run build -w services/app \
    && node scripts/build-server.mjs services/app/dist/app.mjs services/app/src/main.ts
    && node scripts/build-server.mjs services/app/dist/app.mjs services/app/src/main.ts


FROM node:22-slim AS runtime
FROM node:22-slim AS runtime
WORKDIR /app
WORKDIR /app


ENV NODE_ENV=production \
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    HOSTNAME=0.0.0.0 \
    APP__PORT=3000
    APP__PORT=3000


COPY package*.json ./
COPY package*.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/cli/package.json ./services/cli/package.json
COPY services/test-support/package.json ./services/test-support/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --legacy-peer-deps --ignore-scripts -w services/app --cache /root/.npm \
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --legacy-peer-deps --ignore-scripts -w services/app --cache /root/.npm \
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/playwright-core \
    && test ! -e node_modules/playwright-core \
    && test ! -e node_modules/@artifactbin/sql \
    && test ! -e node_modules/@artifactbin/sql \
    && test ! -e node_modules/@artifactbin/browser \
    && test ! -e node_modules/@artifactbin/browser \
    && test ! -e node_modules/@tailwindcss/node \
    && test ! -e node_modules/@tailwindcss/node \
    && test ! -e node_modules/@tailwindcss/postcss \
    && test ! -e node_modules/@tailwindcss/postcss \
    && test ! -e node_modules/tailwindcss \
    && test ! -e node_modules/tailwindcss \
    && test ! -e node_modules/lightningcss \
    && test ! -e node_modules/lightningcss \
    && test ! -e node_modules/mermaid \
    && test ! -e node_modules/mermaid \
    && test ! -e node_modules/vite \
    && test ! -e node_modules/vite \
    && test ! -e node_modules/monaco-editor \
    && test ! -e node_modules/monaco-editor \
    && test ! -e node_modules/prettier \
    && test ! -e node_modules/prettier \
    && test -d node_modules/react \
    && test -d node_modules/react \
    && test -d node_modules/@artifactbin/utils
    && test -d node_modules/@artifactbin/utils


COPY --from=builder /repo/services/app/dist/web ./dist/web
COPY --from=builder /repo/services/app/dist/web ./dist/web
COPY --from=builder /repo/services/app/public ./public
COPY --from=builder /repo/services/app/public ./public
COPY --from=builder /repo/services/app/skills ./skills
COPY --from=builder /repo/services/app/skills ./skills
COPY --from=builder /repo/services/app/orchestrator ./orchestrator
COPY --from=builder /repo/services/app/orchestrator ./orchestrator
COPY --from=builder /repo/services/app/lib/story-runtime/dist ./lib/story-runtime/dist
COPY --from=builder /repo/services/app/lib/story-runtime/dist ./lib/story-runtime/dist
COPY --from=builder /repo/services/app/dist/app.mjs ./app.mjs
COPY --from=builder /repo/services/app/dist/app.mjs ./app.mjs
RUN mkdir -p /app/.artifact-objects && chown node:node /app/.artifact-objects
RUN mkdir -p /app/.artifact-objects && chown node:node /app/.artifact-objects


EXPOSE 3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node
USER node
CMD ["node", "app.mjs"]
CMD ["node", "app.mjs"]
