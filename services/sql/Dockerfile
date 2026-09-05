# syntax=docker/dockerfile:1

# THE SQL SERVICE AS AN IMAGE — DuckDB in a process of its own, for the split
# shape (`SQL__SERVICE_URL`). One ESM bundle over this workspace's own lean
# dependency closure: no app, no Playwright, no build toolchain at runtime.
#
# Build from the REPO ROOT — the builder installs the whole workspace tree
# (the bundler needs the toolchain), the runtime only this package:
#   docker build -f services/sql/Dockerfile -t artifactbin-sql .

FROM node:22 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json
COPY services/app/scripts/copy-assets.mjs ./services/app/scripts/copy-assets.mjs
# THE INSTALL LAYER IS KEYED ON MANIFESTS ONLY — `npm ci` reads the root files
# and each workspace's package.json and nothing else, so copying the source
# tree above it rebuilt this layer on every edit. The tree lands AFTER; the
# image's contents are identical. The app workspace's postinstall
# (copy-assets.mjs) runs on `npm ci` and chdirs to its own package dir to read
# node_modules, so the script file is its whole requirement.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --cache /root/.npm
COPY services ./services

# The bundler and the externals list it reads — the whole `scripts/` tree is
# NOT needed, and copying it would bust the install layer's cache for nothing.
COPY scripts/build-server.mjs scripts/runtime-externals.mjs ./scripts/
RUN node scripts/build-server.mjs dist/sql.mjs services/sql/src/server.ts

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    APP__PORT=8080

COPY package.json package-lock.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/events/package.json ./services/events/package.json
COPY services/proxy/package.json ./services/proxy/package.json

# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# workspace filter installs only this package's closure (measured: 9 packages,
# 5 top-level node_modules dirs). The assertions are part of the image, and a
# filtered install that grows the wrong package fails the BUILD, not a boot.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --ignore-scripts -w services/sql --cache /root/.npm \
    # DuckDB present — the engine dlopens `libduckdb.so` beside its bindings.
    && test -d node_modules/@duckdb \
    # …and the browser the app image owns must NOT ride along.
    && test ! -e node_modules/playwright \
    # The engine must actually LOAD in the runner: prove it at build time, so a
    # missing library fails the image and never a live server.
    && node -e "const {DuckDBInstance}=require('@duckdb/node-api'); DuckDBInstance.create(':memory:').then(()=>console.log('duckdb ok')).catch((e)=>{console.error(e);process.exit(1)})"

COPY services ./services

COPY --from=builder /app/dist/sql.mjs ./sql.mjs

EXPOSE 8080

# /health is the shell's one GET (services/sql CONTRACT.md) — the Docker
# HEALTHCHECK and the compose `depends_on` condition.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "sql.mjs"]
