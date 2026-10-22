FROM node:22.22.3-bookworm-slim
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund @sqlite.org/sqlite-wasm@3.53.4-build1
COPY src/datasets/sql ./src/datasets/sql
COPY src/datasets/query/contracts.ts ./src/datasets/query/contracts.ts
COPY src/datasets/mutation/contracts.ts ./src/datasets/mutation/contracts.ts
USER 10001:10001
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/datasets/sql/container/entry.mjs"]
