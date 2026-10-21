FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts=false workerd@1.20261019.1
RUN npm install --omit=dev --ignore-scripts=false esbuild@0.25.12
COPY probe.mjs cap-probe.mjs /app/
USER 10001:10001
ENTRYPOINT ["node", "/app/probe.mjs"]
