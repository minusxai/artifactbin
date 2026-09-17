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

For local development, use `APP__HOST=127.0.0.1` and `APP__PUBLIC_BASE_URL=http://127.0.0.1:7445`. Existing local login delivery writes the protected operator outbox; public origins use the configured mail provider. Existing Google/OIDC settings work unchanged. A relative `EMAIL__DEV_OUTBOX_PATH` resolves beside `server.env` — not beside `--dir`, and not against the working directory the server later adopts — and startup prints the absolute path it settled on. OSS has no proxy or request-rate policy; production owns those modules. The public URL is what users reach; TLS may terminate at an operator's reverse proxy.

`--port` selects the listener for one run and is never written back to `server.env`, so a later `afbin serve --dir <path>` listens on the port that file names. The full set of settings the host accepts is [`server.env.example`](server.env.example); the repository's own `.env.example` is for `npm run dev` and is refused here (`Unsupported team setting: OBJECT_STORE__LOCAL_DIR`).

## Team on a network

`afbin serve` refuses at startup rather than serving a login page nobody can complete, so a shared host needs all of:

- **An HTTPS public URL.** afbin clients only connect over HTTPS, or HTTP on localhost, so an `http://` non-loopback `APP__PUBLIC_BASE_URL` is refused. Terminate TLS at a reverse proxy in front and set `APP__PUBLIC_BASE_URL=https://…`; `APP__HOST`/`--port` still select the local listener behind it.
- **A login method teammates can COMPLETE.** Naming one is not configuring it, and a half-configured method is refused rather than served: `EMAIL__RESEND_API_KEY` **and** `EMAIL__FROM` (without the sender the composition falls back to `artifactbin <login@example.com>`, which no provider is verified for, so every code fails on the way out), or Google (`AUTH__GOOGLE_CLIENT_ID` + `AUTH__GOOGLE_CLIENT_SECRET`), or OIDC (`AUTH__OIDC_PROVIDER_ID` + `AUTH__OIDC_CLIENT_ID` + `AUTH__OIDC_CLIENT_SECRET`, plus either `AUTH__OIDC_DISCOVERY_URL` or all of `AUTH__OIDC_AUTHORIZATION_URL`, `AUTH__OIDC_TOKEN_URL` and `AUTH__OIDC_USERINFO_URL`). There is no SMTP option, and the local `[dev-mail]` outbox serves loopback origins only. Startup says which of these teammates should use; with only Google or OIDC it says so, rather than promising an emailed code.
- **`APP__PUBLIC_BASE_URL` exactly as teammates type it.** Approval and login both happen at that origin, and `http://localhost:7445` and `http://127.0.0.1:7445` are different origins: a mismatch fails with `approval_origin_mismatch`. `APP__HOST=0.0.0.0` with a loopback public URL is refused for the same reason.

Then:

- **Teammates install from the host**: `curl -fsSL <origin>/chat/install.sh | sh` downloads the CLI that server was built with and presets the origin as their client default (`~/.artifactbin/config.json`). An existing default is kept, so `afbin config set host <origin>` changes it deliberately.
- **Sharing is by email**, through the share menu in the reader or the YAML `shares:` list in a document's fence, which push applies:

  ```yaml
  shares:
    - email: a@b.c
      role: viewer     # viewer | commenter | editor
  ```

- **Anyone who can reach the server can create an account.** There is no allowlist or domain restriction yet; put the host where only the team can reach it.
- **Datasets and images are born `unlisted`**: not listed anywhere, but readable by anyone with the ID and no login. Documents are private to their owner until shared. See [serving and security](../serving-and-security.md).
- **Changing the public URL later strands clients.** A working directory tracks one server and account, and credentials are saved per origin, so teammates must re-authenticate and re-point workspaces bound to the old origin. Choose the final name before inviting people.
- **Back up by stopping the server and copying `<dir>`.** The database, uploaded objects and settings all live under it; a running server owns its PGLite directory, so a copy taken while it runs is not a consistent backup. An external `--db-url postgres://…` moves only the database; `<dir>` still holds the objects.

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

Only the explicit file supplies product settings. Client defaults, credentials and inherited application/storage/service settings are not read. This OSS composition uses PGLite by default or an explicit Postgres connection, filesystem objects and local SQL/browser engines; remote object storage and service URL settings are rejected. Custom production adapters belong in the production composition. There is no schema/config migration and no OS service manager.

## Integration contract

- `teamSettings(configFile, inherited?)` validates settings and returns the isolated environment without mutating the caller.
- `startTeamHost(configFile, assets): Promise<void>` is a **process entry**, not an in-process client API. It takes the lifetime lock before opening the application database, installs the environment, then imports the application. It serves until SIGINT/SIGTERM and closes the listener and database before releasing ownership.
- `createTeamApplication(env, assets)` composes existing adapters around `createAppHost`; the application configuration must already be installed. No new auth logic or permission shortcuts.
- Packaging exports `startTeamHost` through the host entry. The CLI resolves the operator config path before changing its working directory. The browser executable callback reuses the pinned lazy Chromium preparation.

CI exercises real handlers with distinct owners, private access denial, email-code login, browser publication, foreground startup/stop/restart and competing-process refusal. Packaged npm and standalone executables run against real hosts, including the optional Postgres configuration.
