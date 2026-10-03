# Build from the repository root: docker build -f services/runner/Dockerfile -t afbin-worker .
FROM node:22.22.3-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY services/runner/worker-image/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:22.22.3-bookworm-slim
WORKDIR /worker
COPY --from=build /worker/node_modules ./node_modules
COPY services/runner/src/runner-worker.mjs ./runner-worker.mjs
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "runner-worker.mjs"]
