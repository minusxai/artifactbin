# syntax=docker/dockerfile:1

# THE BROWSER SERVICE AS AN IMAGE — Chromium in a process of its own, for the
# split shape (`BROWSER__SERVICE_URL`). One ESM bundle over this workspace's
# own lean dependency closure: no app, no DuckDB, no build toolchain at runtime.
#
# Build from the REPO ROOT — the builder installs the whole workspace tree
# (the bundler needs the toolchain), the runtime only this package:
#   docker build -f services/browser/Dockerfile -t artifactbin-browser .

FROM node:22 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
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
RUN node scripts/build-server.mjs dist/browser.mjs services/browser/src/server.ts

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    APP__PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY services/contracts/package.json ./services/contracts/package.json
COPY services/utils/package.json ./services/utils/package.json
COPY services/app/package.json ./services/app/package.json
COPY services/sql/package.json ./services/sql/package.json
COPY services/browser/package.json ./services/browser/package.json
COPY services/proxy/package.json ./services/proxy/package.json

# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# workspace filter installs only this package's closure (measured: 8 packages,
# playwright + playwright-core and nothing else of the natives). The assertions
# are part of the image, and a filtered install that grows the wrong package
# fails the BUILD, not a boot.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --ignore-scripts -w services/browser --cache /root/.npm \
    # Playwright present — the service drives Chromium through it.
    && test -d node_modules/playwright \
    # …and the engine the sql image owns must NOT ride along.
    && test ! -e node_modules/@duckdb

# THE DRIVER FIRST, and only the driver (the root Dockerfile's cache lesson):
# keyed on the two packages the install reads, a dependency change elsewhere
# leaves this layer CACHED instead of re-downloading Chromium. The version
# guarantee is intact — the browser is installed BY the playwright that will
# drive it. `--with-deps` apt-installs the browser's shared libraries.
COPY services ./services

COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
# THE HEADLESS SHELL, and only the shell: measured (docker top, mid-render)
# the service's `chromium.launch({ headless: true })` runs
# /ms-playwright/chromium_headless_shell-*/headless_shell — the full Chromium
# `playwright install chromium` also downloads is 641MB this process never
# launches. Installing exactly what runs keeps the image under its size
# budget with room to spare; scripts/image-checks.mjs's render probe is the
# guard that what is installed is what launches.
RUN node node_modules/playwright/cli.js install --with-deps chromium-headless-shell \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist/browser.mjs ./browser.mjs

EXPOSE 8080

# /health is the shell's one GET (services/browser CONTRACT.md) — the Docker
# HEALTHCHECK and the compose `depends_on` condition.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "browser.mjs"]
