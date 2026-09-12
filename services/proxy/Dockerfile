# syntax=docker/dockerfile:1
# syntax=docker/dockerfile:1


# THE PROXY AS AN IMAGE — the split shape's lean front: identity (Better Auth
# THE PROXY AS AN IMAGE — the split shape's lean front: identity (Better Auth
# over Postgres), the doors, the MCP OAuth provider, and ONE forwarder to the
# over Postgres), the doors, the MCP OAuth provider, and ONE forwarder to the
# app over HTTP. No engine, no browser, no app tree — the assertions below
# app over HTTP. No engine, no browser, no app tree — the assertions below
# fail the BUILD if the lean closure ever grows one.
# fail the BUILD if the lean closure ever grows one.
#
#
# Build from the REPO ROOT — the builder installs the whole workspace tree
# Build from the REPO ROOT — the builder installs the whole workspace tree
# (the bundler needs the toolchain), the runtime only this package:
# (the bundler needs the toolchain), the runtime only this package:
#   docker build -f services/proxy/Dockerfile -t artifactbin-proxy .
#   docker build -f services/proxy/Dockerfile -t artifactbin-proxy .


FROM node:22 AS builder
FROM node:22 AS builder


WORKDIR /app
WORKDIR /app


COPY package.json package-lock.json ./
COPY package.json package-lock.json ./
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


# The bundler and the externals list it reads — the whole `scripts/` tree is
# The bundler and the externals list it reads — the whole `scripts/` tree is
# NOT needed, and copying it would bust the install layer's cache for nothing.
# NOT needed, and copying it would bust the install layer's cache for nothing.
COPY scripts/build-server.mjs scripts/runtime-externals.mjs ./scripts/
COPY scripts/build-server.mjs scripts/runtime-externals.mjs ./scripts/
RUN node scripts/build-server.mjs dist/proxy.mjs services/proxy/src/main.ts
RUN node scripts/build-server.mjs dist/proxy.mjs services/proxy/src/main.ts


FROM node:22-slim
FROM node:22-slim


WORKDIR /app
WORKDIR /app


ENV NODE_ENV=production \
ENV NODE_ENV=production \
    APP__PORT=3000
    APP__PORT=3000


COPY package.json package-lock.json ./
COPY package.json package-lock.json ./
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


# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# workspace filter installs only this package's closure. The assertions are
# workspace filter installs only this package's closure. The assertions are
# part of the image, and a filtered install that grows the wrong package
# part of the image, and a filtered install that grows the wrong package
# fails the BUILD, not a boot.
# fails the BUILD, not a boot.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --legacy-peer-deps --ignore-scripts -w services/proxy --cache /root/.npm \
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --omit=dev --legacy-peer-deps --ignore-scripts -w services/proxy --cache /root/.npm \
    # identity is present — Better Auth is the login surface this image serves
    # identity is present — Better Auth is the login surface this image serves
    && test -d node_modules/better-auth \
    && test -d node_modules/better-auth \
    # the engine and the browser are the OTHER images' weight, never this one's
    # the engine and the browser are the OTHER images' weight, never this one's
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/@electric-sql/pglite \
    && test ! -e node_modules/@electric-sql/pglite \
    && test ! -e node_modules/kysely-pglite \
    && test ! -e node_modules/kysely-pglite \
    # Better Auth exposes optional React and Vitest peers; the proxy runs neither
    # Better Auth exposes optional React and Vitest peers; the proxy runs neither
    && test ! -e node_modules/react-dom \
    && test ! -e node_modules/react-dom \
    && test ! -e node_modules/vitest \
    && test ! -e node_modules/vitest \
    && test ! -e node_modules/vite
    && test ! -e node_modules/vite


COPY services ./services
COPY services ./services


COPY --from=builder /app/dist/proxy.mjs ./services/proxy/proxy.mjs
COPY --from=builder /app/dist/proxy.mjs ./services/proxy/proxy.mjs


EXPOSE 3000
EXPOSE 3000


# /health is answered by the proxy itself (main.ts's composition), never
# /health is answered by the proxy itself (main.ts's composition), never
# forwarded — the Docker HEALTHCHECK and the compose `depends_on` condition
# forwarded — the Docker HEALTHCHECK and the compose `depends_on` condition
# both ask it, and a probe that dies with the app it fronts reports the
# both ask it, and a probe that dies with the app it fronts reports the
# wrong process's health.
# wrong process's health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"


USER node
USER node
CMD ["node", "services/proxy/proxy.mjs"]
CMD ["node", "services/proxy/proxy.mjs"]
