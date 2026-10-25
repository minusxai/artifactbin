ARG SOURCE_COMPONENT=runtime-pcre2
ARG RUNTIME_PACKAGES=runtime-packages
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
# Only packages present in the tested Chromium runtime profile enter these source overlays.
FROM node:22.23.4-trixie-slim@sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf AS browser-runtime-profile
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends libcups2t64 libxml2 libsqlite3-0 xvfb libxpm4 libxi6 libxrender1 libgl1 && rm -rf /var/lib/apt/lists/*
RUN dpkg-query -W -f='${binary:Package}\t${db:Status-Status}\t${Version}\t${Architecture}\n' | awk -F '\t' '$2 == "installed"' > /browser-runtime-profile.tsv
COPY runtime-source/browser/ /browser-source/
FROM browser-runtime-profile AS browser-xml
RUN sh /browser-source/xml/build-xml.sh /out && cp /xml-public-api-check /out/check-xml && cp /browser-runtime-profile.tsv /out/
FROM browser-runtime-profile AS browser-cups
RUN sh /browser-source/cups/build-cups.sh && cp /browser-runtime-profile.tsv /out/
FROM browser-runtime-profile AS browser-sqlite
RUN dpkg-query -W -f='${binary:Package}\n' | sed 's/:.*//' | sort -u > /sqlite-runtime-profile && SQLITE_RUNTIME_PACKAGE_LIST=/sqlite-runtime-profile sh /browser-source/sqlite/build.sh && cp /browser-runtime-profile.tsv /out/
FROM browser-runtime-profile AS browser-xorg
RUN sh /browser-source/xorg/capture-profile.sh /xorg-profile
RUN apt-get update && apt-get install -y --no-install-recommends build-essential dpkg-dev pkg-config curl ca-certificates xz-utils autoconf automake libtool xutils-dev x11proto-dev xtrans-dev libxcb1-dev libxcb-xinput-dev libx11-dev libxext-dev libxfixes-dev libxrender-dev libxpm-dev libxi-dev libxt-dev libxmu-dev libpixman-1-dev libxfont-dev libxkbfile-dev libxcvt-dev libxau-dev libxdmcp-dev libdrm-dev libepoxy-dev libgbm-dev libgl-dev libgl1-mesa-dev mesa-common-dev libxshmfence-dev libunwind-dev libselinux1-dev libaudit-dev nettle-dev libtirpc-dev libudev-dev libsystemd-dev libdbus-1-dev meson ninja-build python3 python3-mako bison flex libglib2.0-dev ncompress && rm -rf /var/lib/apt/lists/*
RUN sh /browser-source/xorg/build.sh && cp /browser-source/xorg/check-display.sh /out/ && cp /browser-runtime-profile.tsv /out/
FROM browser-runtime-profile AS browser-payloads
COPY --from=browser-xml /out/libxml2.deb /browser-packages/libxml2.deb
COPY --from=browser-cups /out/libcups2t64.deb /browser-packages/libcups2t64.deb
COPY --from=browser-sqlite /out/*.deb /browser-packages/
COPY --from=browser-xorg /out/*.deb /browser-packages/
RUN node /browser-source/write-payload-manifest.mjs /browser-packages /browser-native-payloads.json
FROM ${SOURCE_COMPONENT} AS runtime-component-source
FROM scratch AS runtime-component-output
COPY --from=runtime-component-source /out/ /

FROM scratch AS runtime-packages
COPY --from=browser-runtime-profile /browser-runtime-profile.tsv /out/browser-runtime-profile.tsv
COPY --from=runtime-pcre2 /out/pcre2.deb /out/pcre2.deb
COPY --from=runtime-expat /out/expat.deb /out/expat.deb
COPY --from=runtime-tar /out/tar.deb /out/tar.deb
COPY --from=runtime-dash /out/dash.deb /out/dash.deb
COPY --from=runtime-coreutils /out/ /out/
COPY --from=runtime-ncurses /out/ /out/
COPY --from=browser-xml /out/libxml2.deb /out/libxml2.deb
COPY --from=browser-cups /out/libcups2t64.deb /out/libcups2t64.deb
COPY --from=browser-xorg /out/*.deb /out/
COPY --from=browser-sqlite /out/*.deb /out/
COPY --from=browser-xml /out/check-xml /test-tools/check-xml
COPY --from=browser-cups /out/check-ipp /test-tools/check-ipp
COPY --from=browser-xorg /out/check-xorg /test-tools/check-xorg
COPY --from=browser-xorg /browser-source/xorg/check-display.sh /test-tools/check-display.sh
COPY --from=browser-sqlite /out/ /test-tools/sqlite/
COPY --from=browser-sqlite /out/verify-sqlite.sh /test-tools/verify-sqlite.sh
COPY --from=browser-runtime-profile /browser-source/check-browser-libraries.mjs /test-tools/check-browser-libraries.mjs
COPY --from=browser-payloads /browser-native-payloads.json /test-tools/browser-native-payloads.json


FROM ${RUNTIME_PACKAGES} AS selected-runtime-packages
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
COPY --from=selected-runtime-packages /out/ /tmp/runtime-packages/
# Python in the builder may add a wide curses library absent from this runtime.
RUN set -eu; \
 tab=$(printf '\t'); \
 while IFS="$tab" read -r package original_status original_version original_arch; do test "$(dpkg-query -W -f='${db:Status-Status}' "$package")" = "$original_status"; test "$(dpkg-query -W -f='${Version}' "$package")" = "$original_version"; test "$(dpkg-query -W -f='${Architecture}' "$package")" = "$original_arch"; done < /tmp/runtime-packages/browser-runtime-profile.tsv; \
 if [ "$(dpkg-query -W -f='${db:Status-Status}' libncursesw6 2>/dev/null || true)" != installed ]; then rm -f /tmp/runtime-packages/libncursesw6.deb; fi; \
 set -- dpkg; \
 for file in /tmp/runtime-packages/*.deb; do \
   package=$(dpkg-deb -f "$file" Package); \
   test "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)" = installed; \
   set -- "$@" "--path-include=/usr/share/doc/$package/*"; \
 done; \
 "$@" -i /tmp/runtime-packages/*.deb; \
 ldconfig; apt-get check; audit=$(dpkg --audit 2>&1); test -z "$audit"; rm -rf /tmp/runtime-packages

USER 1000:1000
WORKDIR /data
CMD ["afbin", "serve", "--config", "/config/server.env", "--dir", "/data"]
