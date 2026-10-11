FROM caddy:2.11.7-builder AS builder
ARG DNS_MODULE
RUN test -n "$DNS_MODULE" && xcaddy build v2.11.7 --with "$DNS_MODULE"
FROM caddy:2.11.7
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY caddy-entrypoint.sh /usr/local/bin/company-caddy
ENTRYPOINT ["/usr/local/bin/company-caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
