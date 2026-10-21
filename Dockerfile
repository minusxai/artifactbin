FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY installer ./installer
# The whole author skill is served at /skills/pagegi-author.tgz; its design systems are served
# at /af/v1/design-systems/ and its todo example is the home page's example.
COPY skills/pagegi-author ./skills/pagegi-author
# Migration converters are offline tooling, excluded before copying the production filesystem.
RUN npm run build && npm prune --omit=dev && rm -rf src/migration scripts/migration
# The static Docker CLI the execution service (compose.yaml) drives sandbox containers with.
FROM docker:29-cli@sha256:5ebe9898293f8e1062ed0b65078c24486fb32a99dd4895d0dba0251948a7c775 AS docker-cli
FROM node:22.22.3-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PAGEGI_PASSWORD_LOGIN=false PAGEGI_HOST=0.0.0.0 PAGEGI_PORT=8787
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "require('node:http').get('http://127.0.0.1:8787/health',{headers:process.env.PAGEGI_PLATFORM_ORIGIN?{Host:new URL(process.env.PAGEGI_PLATFORM_ORIGIN).host}:{}},r=>{r.resume();if(r.statusCode!==200)process.exitCode=1}).on('error',()=>process.exit(1))"
CMD ["node", "src/server-main.js"]
