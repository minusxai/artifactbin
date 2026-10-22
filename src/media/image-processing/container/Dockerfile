FROM node:22.22.3-bookworm-slim
WORKDIR /app
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1 MALLOC_ARENA_MAX=2 VIPS_BLOCK_UNTRUSTED=1
COPY src/media/image-processing/container/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src/media/image-processing ./src/media/image-processing
USER 10001:10001
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/media/image-processing/container/entry.mjs"]
