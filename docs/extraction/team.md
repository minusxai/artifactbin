# Explicit team hosting

`afbin serve --config /path/to/team/server.env` runs a foreground, multi-user server. It uses the existing public login, OAuth, session and application authorization modules in one process. It never grants a local owner implicitly.

`afbin serve --dir ./team --port 7445` initializes private loopback settings automatically. Use `--config ./team/server.env` for an existing operator configuration. `--db-url postgres://…` or `--db-url pglite://…` overrides only the application database; objects remain in the operator directory. There is no background daemon.

For a network host, the operator configures a persistent settings file (mode 0600):

```dotenv
APP__HOST=0.0.0.0
APP__PORT=7445
APP__PUBLIC_BASE_URL=https://artifacts.example.com
AUTH__SECRET=<persistent random secret of at least 32 characters>
EMAIL__RESEND_API_KEY=<mail provider credential>
EMAIL__FROM=Artifactbin <login@example.com>
```

For local development, use `APP__HOST=127.0.0.1` and `APP__PUBLIC_BASE_URL=http://127.0.0.1:7445`. Existing local login delivery writes the protected operator outbox; public origins use the configured mail provider. Existing Google/OIDC settings work unchanged. Relative outbox paths resolve beside `server.env`. OSS has no proxy or request-rate policy; production owns those modules. The public URL is what users reach; TLS may terminate at an operator's reverse proxy.

```text
/path/to/team/
  server.env
  data/
    pglite/          # App, auth and events, one connection/process
    objects/         # Artifact bytes
    runtime/         # Downloaded runtime dependencies; no client profiles
    outbox.jsonl     # Local-origin OTP delivery only
    locks/           # Existing SQLite process ownership lock
```

Only the explicit file supplies product settings. Client defaults, credentials and inherited application/storage/service settings are not read. This OSS composition uses PGLite by default or an explicit Postgres connection, filesystem objects and local SQL/browser engines; remote object storage and service URL settings are rejected. Custom production adapters belong in the production composition. No schema/config migration or OS service manager is introduced.

## Integration contract

- `teamSettings(configFile, inherited?)` validates settings and returns the isolated environment without mutating the caller.
- `startTeamHost(configFile, assets): Promise<void>` is a **process entry**, not an in-process client API. It takes the lifetime lock before opening the application database, installs the environment, then imports the application. It serves until SIGINT/SIGTERM and closes the listener and database before releasing ownership.
- `createTeamApplication(env, assets)` composes existing adapters around `createAppHost`; the application configuration must already be installed. No new auth logic or permission shortcuts.
- Packaging must export `startTeamHost` through the extracted host entry. The CLI must resolve the operator config path before changing its working directory. The browser executable callback reuses the pinned lazy Chromium preparation.

CI exercises real handlers with distinct owners, private access denial, email-code login, browser publication, foreground startup/stop/restart and competing-process refusal. Packaged npm and standalone executables run against real hosts, including the optional Postgres configuration.
