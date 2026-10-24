FROM node:22.23.4-bookworm-slim
RUN npm install --prefix /smtp --no-audit --no-fund smtp-server@3.21.1
COPY ci-smtp-fixture.mjs /smtp/fixture.mjs
CMD ["node", "/smtp/fixture.mjs"]
