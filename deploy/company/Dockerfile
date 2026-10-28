FROM node:22-bookworm-slim
ARG AFBIN_VERSION=0.5.55
ARG AFBIN_PACKAGE=@afbin/cli@0.5.55
ENV ARTIFACTBIN_SKILLS=off CLI__AUTO_UPDATE=0 ARTIFACTBIN_HOME=/data/client PLAYWRIGHT_BROWSERS_PATH=/data/chromium
COPY packages/ /packages/
RUN npm install --global --no-audit --no-fund "$AFBIN_PACKAGE" \
 && test "$(node -p 'require("/usr/local/lib/node_modules/@afbin/cli/package.json").version')" = "$AFBIN_VERSION" \
 && node /usr/local/lib/node_modules/@afbin/cli/node_modules/playwright/cli.js install-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /packages
USER 1000:1000
WORKDIR /data
CMD ["afbin", "serve", "--config", "/config/server.env", "--dir", "/data"]
