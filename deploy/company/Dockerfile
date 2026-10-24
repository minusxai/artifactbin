FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS runtime-source
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates autoconf automake gettext texinfo libacl1-dev libselinux1-dev attr acl xz-utils python3 locales perl libgmp-dev libattr1-dev bison gperf libncursesw6 libexpat1 && rm -rf /var/lib/apt/lists/*
COPY runtime-source/ /runtime-source/
FROM runtime-source AS runtime-pcre2
RUN sh /runtime-source/build.sh pcre2
FROM runtime-source AS runtime-tar
RUN sh /runtime-source/build.sh tar
FROM runtime-source AS runtime-dash
RUN sh /runtime-source/build.sh dash
FROM runtime-source AS runtime-expat
RUN sh /runtime-source/build.sh expat
FROM runtime-source AS runtime-coreutils
RUN sh /runtime-source/build.sh coreutils
FROM runtime-source AS runtime-ncurses
RUN sh /runtime-source/build.sh ncurses
FROM scratch AS runtime-packages
COPY --from=runtime-pcre2 /out/pcre2.deb /out/pcre2.deb
COPY --from=runtime-expat /out/expat.deb /out/expat.deb
COPY --from=runtime-tar /out/tar.deb /out/tar.deb
COPY --from=runtime-dash /out/dash.deb /out/dash.deb
COPY --from=runtime-coreutils /out/ /out/
COPY --from=runtime-ncurses /out/ /out/

FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf
COPY patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
ARG AFBIN_VERSION=0.5.56
ARG AFBIN_PACKAGE=@afbin/cli@0.5.56
ENV ARTIFACTBIN_SKILLS=off CLI__AUTO_UPDATE=0 ARTIFACTBIN_HOME=/data/client PLAYWRIGHT_BROWSERS_PATH=/data/chromium
COPY packages/ /packages/
RUN npm install --global --no-audit --no-fund "$AFBIN_PACKAGE" \
 && test "$(node -p 'require("/usr/local/lib/node_modules/@afbin/cli/package.json").version')" = "$AFBIN_VERSION" \
 && node /usr/local/lib/node_modules/@afbin/cli/node_modules/playwright/cli.js install-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /packages
COPY --from=runtime-packages /out/ /tmp/runtime-packages/
# Python in the builder may add a wide curses library absent from this runtime.
RUN if [ "$(dpkg-query -W -f='${db:Status-Status}' libncursesw6 2>/dev/null || true)" != installed ]; then rm -f /tmp/runtime-packages/libncursesw6.deb; fi \
 && dpkg --path-include='/usr/share/doc/tar/*' --path-include='/usr/share/doc/dash/*' -i /tmp/runtime-packages/*.deb \
 && ldconfig && rm -rf /tmp/runtime-packages
USER 1000:1000
WORKDIR /data
CMD ["afbin", "serve", "--config", "/config/server.env", "--dir", "/data"]
