# Build from the repository root with -f docs/proposals/runner-validation/Dockerfile.
FROM node:22.23.4-bookworm-slim AS build
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /validation
COPY docs/proposals/runner-validation/package.json docs/proposals/runner-validation/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:22.23.4-bookworm-slim
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
WORKDIR /validation
COPY --from=build /validation/node_modules ./node_modules
COPY docs/proposals/runner-validation/worker.mjs ./
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "worker.mjs"]
