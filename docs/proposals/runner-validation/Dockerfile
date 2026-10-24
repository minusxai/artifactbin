# Build from the repository root with -f docs/proposals/runner-validation/Dockerfile.
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS build
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /validation
COPY docs/proposals/runner-validation/package.json docs/proposals/runner-validation/package-lock.json ./
COPY scripts/lib/esbuild-toolchain.mjs /toolchain/scripts/lib/esbuild-toolchain.mjs
COPY scripts/ci/prepare-esbuild.mjs /toolchain/scripts/ci/prepare-esbuild.mjs
COPY services/cli/scripts/prepare-esbuild.mjs /toolchain/services/cli/scripts/prepare-esbuild.mjs
RUN npm ci --omit=dev --no-audit --no-fund \
 && node /toolchain/scripts/ci/prepare-esbuild.mjs --root=/validation \
 && rm -rf /toolchain node_modules/.cache/esbuild-compilers
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf
COPY deploy/company/patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
WORKDIR /validation
COPY --from=build /validation/node_modules ./node_modules
COPY docs/proposals/runner-validation/worker.mjs ./
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "worker.mjs"]
