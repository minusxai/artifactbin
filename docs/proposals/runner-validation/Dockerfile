FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS runtime-source
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates autoconf automake gettext texinfo libacl1-dev libselinux1-dev attr acl xz-utils python3 locales perl libgmp-dev libattr1-dev bison gperf libncursesw6 && rm -rf /var/lib/apt/lists/*
COPY deploy/company/runtime-source/ /runtime-source/
FROM runtime-source AS runtime-pcre2
RUN sh /runtime-source/build.sh pcre2
FROM runtime-source AS runtime-tar
RUN sh /runtime-source/build.sh tar
FROM runtime-source AS runtime-dash
RUN sh /runtime-source/build.sh dash
FROM runtime-source AS runtime-coreutils
RUN sh /runtime-source/build.sh coreutils
FROM runtime-source AS runtime-ncurses
RUN sh /runtime-source/build.sh ncurses
FROM scratch AS runtime-packages
COPY --from=runtime-pcre2 /out/pcre2.deb /out/pcre2.deb
COPY --from=runtime-tar /out/tar.deb /out/tar.deb
COPY --from=runtime-dash /out/dash.deb /out/dash.deb
COPY --from=runtime-coreutils /out/ /out/
COPY --from=runtime-ncurses /out/ /out/

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
COPY --from=runtime-packages /out/ /tmp/runtime-packages/
# Python in the builder may add a wide curses library absent from this runtime.
RUN if [ "$(dpkg-query -W -f='${db:Status-Status}' libncursesw6 2>/dev/null || true)" != installed ]; then rm -f /tmp/runtime-packages/libncursesw6.deb; fi \
 && dpkg --path-include='/usr/share/doc/tar/*' --path-include='/usr/share/doc/dash/*' -i /tmp/runtime-packages/*.deb \
 && ldconfig && rm -rf /tmp/runtime-packages
WORKDIR /validation
COPY --from=build /validation/node_modules ./node_modules
COPY docs/proposals/runner-validation/worker.mjs ./
USER 1000:1000
ENTRYPOINT ["node", "--no-node-snapshot", "worker.mjs"]
