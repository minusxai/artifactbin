FROM node:22.23.4-bookworm-slim
COPY patch-npm.mjs /tmp/patch-npm.mjs
RUN apt-get update && apt-get upgrade -y && npm install --global --no-audit --no-fund npm@11.19.1 && node /tmp/patch-npm.mjs && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/patch-npm.mjs
RUN npm install --prefix /smtp --no-audit --no-fund smtp-server@3.21.1
COPY ci-smtp-fixture.mjs /smtp/fixture.mjs
CMD ["node", "/smtp/fixture.mjs"]
