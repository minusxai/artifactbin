FROM node:22-bookworm-slim
RUN npm install --prefix /smtp --no-audit --no-fund smtp-server@3.19.21
COPY ci-smtp-fixture.mjs /smtp/fixture.mjs
CMD ["node", "/smtp/fixture.mjs"]
