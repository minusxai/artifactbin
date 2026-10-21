FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
RUN npm install --omit=dev workerd@1.20261019.1 esbuild@0.25.12 acorn@8.15.0
# The root CAs lambdas trust for https (workerd trustedCertificates): the slim image has no CA store.
RUN node -e "require('fs').writeFileSync('/app/ca.pem', require('tls').rootCertificates.join('\n') + '\n')"
COPY supervisor.mjs entry.mjs bundle.mjs env-policy.mjs /app/
USER 10001:10001
ENTRYPOINT ["node", "/app/supervisor.mjs"]
