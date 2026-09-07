# syntax=docker/dockerfile:1

# THE EVENTS SERVICE AS AN IMAGE — the log of what happened in a process of its
# own, for the split shape (`EVENTS__SERVICE_URL`). One ESM bundle over this
# workspace's own lean dependency closure: no app, no DuckDB, no Playwright, no
# build toolchain at runtime — a `pg` client and an HTTP shell.
#
# The ONE stateful lean image: it owns its schema and is the log's only writer,
# so it boots against `DATABASE_URL` as its own role and fails loudly when it
# cannot reach it.
#
# Build from the REPO ROOT — the builder installs the whole workspace tree
# (the bundler needs the toolchain), the runtime only this package:
#   docker build -f services/events/Dockerfile -t artifactbin-events .

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
COPY services/cli/package.json ./services/cli/package.json
COPY services/app/scripts/copy-assets.mjs ./services/app/scripts/copy-assets.mjs
COPY services/cli/scripts/prepare-pty.mjs ./services/cli/scripts/prepare-pty.mjs
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
RUN node scripts/build-server.mjs dist/events.mjs services/events/src/server.ts

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
COPY services/cli/package.json ./services/cli/package.json

# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# workspace filter installs only this package's closure. The assertions are part
# of the image, and a filtered install that grows the wrong package fails the
# BUILD, not a boot.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --ignore-scripts -w services/events --cache /root/.npm \
    # `pg` is the ONE runtime dependency the bundle leaves external (it resolves
    # its own files from real paths) — without it the server dies at line one.
    && test -d node_modules/pg \
    # …and neither native the other images own may ride along.
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/@duckdb

COPY services ./services

COPY --from=builder /app/dist/events.mjs ./events.mjs

EXPOSE 8080

# /health is the shell's one GET (services/events CONTRACT.md), answered before
# the secret guard — the Docker HEALTHCHECK and the compose `depends_on`
# condition.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "events.mjs"]
