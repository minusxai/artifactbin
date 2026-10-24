# Build from the repository root: docker build -f services/runner/Dockerfile -t afbin-worker .
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS build
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY services/runner/worker-image/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
WORKDIR /worker
COPY --from=build /worker/node_modules ./node_modules
COPY services/runner/src/runner-worker.mjs ./runner-worker.mjs
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "runner-worker.mjs"]
