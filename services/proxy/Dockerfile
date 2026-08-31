# syntax=docker/dockerfile:1

# THE PROXY AS AN IMAGE — the split shape's lean front: identity (Better Auth
# over Postgres), the doors, the MCP OAuth provider, and ONE forwarder to the
# app over HTTP. No engine, no browser, no app tree — the assertions below
# fail the BUILD if the lean closure ever grows one.
#
# Build from the REPO ROOT — the builder installs the whole workspace tree
# (the bundler needs the toolchain), the runtime only this package:
#   docker build -f services/proxy/Dockerfile -t artifact-bin-proxy .

FROM node:22 AS builder

WORKDIR /app

# Workspace packages must be present before install: npm links them from here.
COPY package.json package-lock.json ./
COPY services ./services
# The app workspace's postinstall (copy-assets.mjs, from its own package dir)
# runs on `npm ci`; it lives inside `services/` — the tree above is the whole
# install's needs.
RUN --mount=type=cache,target=/root/.npm npm ci --cache /root/.npm

# The bundler and the externals list it reads — the whole `scripts/` tree is
# NOT needed, and copying it would bust the install layer's cache for nothing.
COPY scripts/build-server.mjs scripts/runtime-externals.mjs ./scripts/
RUN node scripts/build-server.mjs dist/proxy.mjs services/proxy/src/main.ts

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    APP__PORT=3000

COPY package.json package-lock.json ./
COPY services ./services

# THE LEAN INSTALL, by npm's own resolution — never a hand-written list: the
# workspace filter installs only this package's closure. The assertions are
# part of the image, and a filtered install that grows the wrong package
# fails the BUILD, not a boot.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --legacy-peer-deps --ignore-scripts -w services/proxy --cache /root/.npm \
    # identity is present — Better Auth is the login surface this image serves
    && test -d node_modules/better-auth \
    # the engine and the browser are the OTHER images' weight, never this one's
    && test ! -e node_modules/@duckdb \
    && test ! -e node_modules/playwright \
    && test ! -e node_modules/@electric-sql/pglite \
    && test ! -e node_modules/kysely-pglite \
    # Better Auth exposes optional React and Vitest peers; the proxy runs neither
    && test ! -e node_modules/react-dom \
    && test ! -e node_modules/vitest \
    && test ! -e node_modules/vite

COPY --from=builder /app/dist/proxy.mjs ./services/proxy/proxy.mjs

EXPOSE 3000

# /health is answered by the proxy itself (main.ts's composition), never
# forwarded — the Docker HEALTHCHECK and the compose `depends_on` condition
# both ask it, and a probe that dies with the app it fronts reports the
# wrong process's health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "services/proxy/proxy.mjs"]
