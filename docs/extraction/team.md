# Explicit team hosting

`afbin serve --config /path/to/team/server.env` runs a foreground, multi-user server. It uses the existing public login, OAuth, session and application authorization modules in one process. It never grants a local owner implicitly.

`afbin serve --dir ./team --owner-email owner@example.com --port 7445` initializes private loopback company settings automatically. Replace the address with the designated owner’s email. The owner must sign in and confirm company setup before colleagues can join. Omitting the owner generates a private settings template and refuses startup with its path and repair command. `--owner-email` applies to newly generated settings; it never changes an existing owner, and cannot be combined with `--config`. Set `APP__DEPLOYMENT_OWNER_EMAIL` in an explicit file instead. Use `--config ./team/server.env` for an existing operator configuration. `--db-url postgres://…` or `--db-url pglite://…` overrides only the application database; objects remain in the operator directory. There is no background daemon.

For a network host, the operator configures a persistent settings file (mode 0600):

```dotenv
APP__HOST=0.0.0.0
APP__PORT=7445
APP__PUBLIC_BASE_URL=https://artifacts.example.com
APP__DEPLOYMENT_MODE=company
APP__DEPLOYMENT_OWNER_EMAIL=owner@example.com
AUTH__INVITE_ONLY=true
AUTH__ALLOWED_EMAIL_PATTERNS=*@example.com
AUTH__SECRET=<persistent random secret of at least 32 characters>
EMAIL__SMTP_HOST=smtp.example.com
EMAIL__SMTP_PORT=587
EMAIL__SMTP_SECURE=false
EMAIL__SMTP_USER=<SMTP username>
EMAIL__SMTP_PASSWORD=<SMTP password>
EMAIL__FROM=Artifactbin <login@example.com>
```

For local development, use `APP__HOST=127.0.0.1` and `APP__PUBLIC_BASE_URL=http://app.lvh.me:7445`, which `afbin serve` generates: `lvh.me` names resolve to 127.0.0.1, and documents are served on their own origins under `lvh.me`, the same site, so a signed-in browser's session reaches them. An explicit `http://127.0.0.1:7445` is kept as written but is a different site from `lvh.me`, so private documents do not render for a signed-in browser there. Existing local login delivery writes the protected operator outbox; public origins use the configured mail provider. Existing Google/OIDC settings work unchanged. A relative `EMAIL__DEV_OUTBOX_PATH` resolves beside `server.env` — not beside `--dir`, and not against the working directory the server later adopts — and startup prints the absolute path it settled on. OSS has no proxy or request-rate policy; production owns those modules. The public URL is what users reach; TLS may terminate at an operator's reverse proxy.

`--port` selects the listener for one run and is never written back to `server.env`, so a later `afbin serve --dir <path>` listens on the port that file names. The full set of settings the host accepts is [`server.env.example`](server.env.example); the repository's own `.env.example` is for `npm run dev` and is refused here (`Unsupported team setting: OBJECT_STORE__LOCAL_DIR`).

## Docker company deployment

For a repeatable external company server with PostgreSQL, HTTPS and persistent storage, use the [Docker Compose hosting bundle](../../deploy/company/README.md). It builds a pinned npm CLI image, runs `afbin serve` inside it, and documents wildcard DNS/TLS, real login, normal owner onboarding, isolated client installation, consistent backups and recovery. Colleagues install their own CLI; they do not operate the server container.

## Team on a network

`afbin serve` refuses at startup rather than serving a login page nobody can complete, so a shared host needs all of:

- **An HTTPS public URL.** afbin clients only connect over HTTPS, or HTTP on localhost, so an `http://` non-loopback `APP__PUBLIC_BASE_URL` is refused. Terminate TLS at a reverse proxy in front and set `APP__PUBLIC_BASE_URL=https://…`; `APP__HOST`/`--port` still select the local listener behind it.
- **A login method teammates can COMPLETE.** Naming one is not configuring it, and a half-configured method is refused rather than served: SMTP (`EMAIL__SMTP_HOST` + `EMAIL__FROM`, valid port/TLS, paired username/password), or `EMAIL__RESEND_API_KEY` **and** `EMAIL__FROM` (without the sender the composition falls back to `artifactbin <login@example.com>`, which no provider is verified for, so every code fails on the way out), or Google (`AUTH__GOOGLE_CLIENT_ID` + `AUTH__GOOGLE_CLIENT_SECRET`), or OIDC (`AUTH__OIDC_PROVIDER_ID` + `AUTH__OIDC_CLIENT_ID` + `AUTH__OIDC_CLIENT_SECRET`, plus either `AUTH__OIDC_DISCOVERY_URL` or all of `AUTH__OIDC_AUTHORIZATION_URL`, `AUTH__OIDC_TOKEN_URL` and `AUTH__OIDC_USERINFO_URL`). SMTP defaults to port 587 with required STARTTLS; `EMAIL__SMTP_SECURE=true` uses implicit TLS (default port 465). Server certificates are verified. Omit both username/password only for a trusted TLS relay; half-configured credentials are refused. Select one email transport, SMTP or Resend. The local `[dev-mail]` outbox serves loopback origins only. Startup says which of these teammates should use; with only Google or OIDC it says so, rather than promising an emailed code.
- **DNS and TLS for the pages host.** Every document is served on its own origin, `https://<id>.<pages host>`, which must be on the public URL's site. `APP__PAGES_HOST` names it; unset, the host serves documents under `pages.<public hostname>` (`lvh.me` for a loopback or `lvh.me` public URL, such as the generated `http://app.lvh.me:<port>`), and an IP-address public URL must set it. Point DNS and a certificate for the pages host and `*.<pages host>` at the server; startup names both.
- **`APP__PUBLIC_BASE_URL` exactly as teammates type it.** Approval and login both happen at that origin, and `http://localhost:7445` and `http://127.0.0.1:7445` are different origins: a mismatch fails with `approval_origin_mismatch`. `APP__HOST=0.0.0.0` with a loopback public URL is refused for the same reason.

## Owner setup and colleague permissions

1. Start the server, open its printed origin, and sign in with the verified `APP__DEPLOYMENT_OWNER_EMAIL` address. On a loopback host, startup names the protected outbox file where the operator reads the login code; no email is sent. On a network host, use a configured email provider or Google/OIDC.
2. In deployment setup, create a company group or select one where the owner is an editor, then explicitly confirm it. The server stores this default group; do not put a group ID in the environment. No other account can join before confirmation. If the default group becomes unavailable, new admissions stop until the owner repairs setup.
3. Invite each colleague’s email to that company group as an editor or viewer. Invite-only admission requires this group invitation, separately from any document share. Colleagues sign in as themselves on the same origin; they must also match the email patterns.
4. Publish documents to the company group for its members, or use Personal and share individual documents by email. A saved default controls where new artifacts are created; it never transfers existing ownership. Colleagues can explicitly choose Personal or another accessible group.

Group editors can create, edit and manage group artifacts; group viewers can read them. For individually shared documents:

| Document role | Read | Comment | Edit |
| --- | --- | --- | --- |
| viewer | Yes | No | No |
| commenter | Yes | Yes | No |
| editor | Yes | Yes | Yes |

A document share does not grant company admission or group management rights. Changing a share takes effect on subsequent authorized requests; do not send your own credentials to recipients.

## Colleague setup and operations

After owner confirmation and invitations:

- **Teammates select their company destination** after signing in: `afbin setup --server https://artifacts.example.com --group <company-handle> --set-default`. This verifies membership, saves their account’s default group and selects this host for future CLI commands. Replace the example origin and handle with this deployment’s values. `--personal --set-default` explicitly chooses Personal; `--inherit --set-default` clears the account override and inherits the deployment default.
- **Teammates install from the host**: `curl -fsSL <origin>/chat/install.sh | sh` downloads the CLI that server was built with and presets the origin as their client default (`~/.artifactbin/config.json`). An existing default is kept, so `afbin config set host <origin>` changes it deliberately.
- **Sharing is by email**, through the share menu in the reader or the YAML `shares:` list in a document's fence, which push applies:

  ```yaml
  shares:
    - email: a@b.c
      role: viewer     # viewer | commenter | editor
  ```

- **Company admission is invite-only by default** (`AUTH__INVITE_ONLY=true`). `AUTH__ALLOWED_EMAIL_PATTERNS` is a comma-separated list of email globs (default `*`); invitations never bypass it. The owner must match the patterns too. Setting `AUTH__INVITE_ONLY=false` permits new verified accounts matching these patterns after company setup is confirmed. Existing admitted accounts stay admitted when these settings change.
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

Only the explicit file supplies product settings. Client defaults, credentials and inherited application/storage/service settings are not read. This OSS composition uses PGLite by default or an explicit Postgres connection, filesystem objects and local SQL/browser engines; remote object storage and SQL/browser/event service URLs are rejected. For lambdas, set `RUNNER__SERVICE_URL` and a matching `CONTRACT__ACTOR_SECRET` (32+ characters) in `server.env`, and run the [separate runner controller](../../services/runner/README.md). The packaged host has no local execution worker; without that controller, execution reports `runner_unavailable`. Runner worker images and AI credentials belong to the controller, and are refused in `server.env`. Custom production adapters belong in the production composition. There is no schema/config migration and no OS service manager.

## Integration contract

- `teamSettings(configFile, inherited?)` validates settings and returns the isolated environment without mutating the caller.
- `startTeamHost(configFile, assets): Promise<void>` is a **process entry**, not an in-process client API. It takes the lifetime lock before opening the application database, installs the environment, then imports the application. It serves until SIGINT/SIGTERM and closes the listener and database before releasing ownership.
- `createTeamApplication(env, assets)` composes existing adapters around `createAppHost`; the application configuration must already be installed. No new auth logic or permission shortcuts.
- Packaging exports `startTeamHost` through the host entry. The CLI resolves the operator config path before changing its working directory. The browser executable callback reuses the pinned lazy Chromium preparation.

CI exercises real handlers with distinct owners, private access denial, email-code login, browser publication, foreground startup/stop/restart and competing-process refusal. Packaged npm and standalone executables run against real hosts, including the optional Postgres configuration.
