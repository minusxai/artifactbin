FROM node:22.22.3-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /validation
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:22.22.3-bookworm-slim
WORKDIR /validation
COPY --from=build /validation/node_modules ./node_modules
COPY worker.mjs ./
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "worker.mjs"]
