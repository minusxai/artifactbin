# Pagegi

A Pagegi page is a normal HTML file that loads one script, the core, first in `<head>`. The platform adds saving, sharing, comments, presence, design systems and history around it. How to write a page is specified by the author skill in [`skills/pagegi-author/`](skills/pagegi-author/SKILL.md); its [HTTP API reference](skills/pagegi-author/references/http-api.md) is the server's public surface, and [`src/server/af-api-contracts.ts`](src/server/af-api-contracts.ts) is the same surface as TypeScript, with status codes.

## Run a server

The server needs Node.js 22.18+ and Postgres.

```sh
npm ci
npm run build                     # builds dist/core.js, served at /af/v1/core.js
export PAGEGI_DATABASE_URL=postgres://pagegi:password@localhost:5432/pagegi
npm start                         # node src/server-main.js
```

`src/server-main.js` reads its settings through `src/config.js`:

| Variable | Meaning |
|---|---|
| `PAGEGI_HOST`, `PAGEGI_PORT` | Where to listen (default `127.0.0.1:8787`). |
| `PAGEGI_DATABASE_URL`, `PAGEGI_DATABASE_SCHEMA` | Postgres connection and schema (default `public`). |
| `PAGEGI_PLATFORM_ORIGIN`, `PAGEGI_RUNNER_ORIGIN` | Public origin, and the per-page runner origin pattern such as `https://{document}.runner.example` (see Deployment). |
| `PAGEGI_KNOWN_ORIGINS` | Comma-separated origins rewritten to this server when a page is saved, besides `https://pagegi.artifactbin.dev` and the earlier `https://artifactbin.dev`. |
| `PAGEGI_RESEND_API_KEY`, `PAGEGI_EMAIL_FROM` | Email-code sign-in through Resend. |
| `PAGEGI_PASSWORD_LOGIN` | `false` disables the password route (set it in production). |
| `PAGEGI_TEST_LOGIN` | `1` enables `POST /api/auth/test-token` for development and tests only. |
| `PAGEGI_BACKEND_EXECUTOR` and friends | Backend execution; see [`src/backend/README.md`](src/backend/README.md). |
| `PAGEGI_SECRETS_KEY` | 32 bytes, base64 or hex (`openssl rand -base64 32`), that encrypt account secrets at rest: the values an account stores on its Account page or with `scripts/secrets.mjs`, which its backend lambdas read as `env`. Without it `/api/secrets` answers 503 and every lambda gets an empty `env`; set it in production. Changing it makes stored secrets unreadable. |

Every file, page or backend, has one six-character ID. A page's address is `<origin>/a/<id>` (anything after the ID and a hyphen, such as a title, is ignored); it also opens at `<origin>/@<handle>/<path>` while it has that path in its owner's library and the owner has chosen that handle (on the Account page or `PUT /api/account/handle`; an email address is never part of an address), and at `<origin>/af/v1/ids/<id>`, which opens any file by ID. A page's address opens it in the hosted view; `?download=1` returns a file that works on its own (the core inlined, the design system embedded, the page's state kept in a `data-af="state"` block, and the server and version it came from recorded on the core tag). Opened from disk while that server is reachable, the file shows the same platform bar as the hosted view, reads the page's comments, warns when the server has a newer version, and its Connect button reuses your website sign-in, in a window on the server, to comment, share presence and call backends as in the hosted view; the platform frame it talks to keeps every credential on the server's origin, so downloads exclude account tokens and the hosted session. Without the server it keeps working: state stays in the browser and a "Download page" control saves the file again. A backend file's address, `<origin>/af/v1/ids/<id>`, shows its ID and version to its owner and is 404 for everyone else. The server also serves `/af/v1/core.js`, `/af/v1/design-systems/<name>.css` and, for downloaded files, `/runtime.js` and `/platform-frame`.

Presence settings are private to the reader’s browser on that origin and survive reopening a page. Showing other cursors or selections is independent from sharing your own; these choices are not part of document state or exported HTML. If browser storage is unavailable, they apply for the current session.

## Install the author skill

One command installs the skill for every coding agent on the machine (Claude Code always; Codex, Pi and OpenCode when they are installed), replacing an older copy:

```sh
curl -fsSL https://pagegi.artifactbin.dev/install.sh | sh
```

The script downloads `/skills/pagegi-author.tgz` from the server it came from and extracts it into each harness's skills folder (`~/.claude/skills`, `~/.agents/skills`, `~/.pi/agent/skills`, `~/.config/opencode/skills`). Restart the agent so it loads the skill. A self-hosted server serves its own `/install.sh`; its scripts then need `AF_SERVER` set to that server's origin for every script, including `auth.mjs`, which saves its token per server, since they default to `https://pagegi.artifactbin.dev`. The signed-in home page's "New page" button gives the same instructions as text to paste into an agent.

## Signing in

People sign in with an email code: `POST /api/auth/email/request` with `{ email }`, then `POST /api/auth/email/verify` with `{ email, code }`, which returns `{ token, username }`. The home page at `/` uses the same flow and keeps the session in an HttpOnly cookie. Account tokens never belong in a page, and page scripts never run on the platform origin.

### Tokens for agent harnesses

A test harness can skip the email step. Start the server with `PAGEGI_TEST_LOGIN=1` (or `testLogin: true` in `createService`), mint a token, and give the agent the server and token. The exact local start, from a checkout, against the development Postgres below (the server creates its schema if it is missing; give each run its own schema and port):

```sh
npm ci
npm run build                     # dist/core.js and the hosted runtime
npm run build:backend             # only for pages with backend files (Docker)
PAGEGI_TEST_LOGIN=1 \
PAGEGI_DATABASE_URL=postgres://pagegi:pagegi-local@127.0.0.1:55432/pagegi \
PAGEGI_DATABASE_SCHEMA=harness_1 \
PAGEGI_PORT=8787 \
PAGEGI_BACKEND_EXECUTOR=docker \
node src/server-main.js &         # prints {"server":"http://127.0.0.1:8787"}
SERVER_PID=$!
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/api/auth/test-token \
  -H 'Content-Type: application/json' -d '{"email":"agent@example.test"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
AF_SERVER=http://127.0.0.1:8787 AF_TOKEN=$TOKEN your-agent
kill $SERVER_PID                  # stop only the server this run started
```

The agent then follows the skill: `node skills/pagegi-author/scripts/add.mjs …` reserves IDs, `POST /api/publish` publishes, pages open at `$AF_SERVER/a/<id>`, and `scripts/shot.mjs` loads the core from `AF_SERVER`. Leave out `PAGEGI_BACKEND_EXECUTOR` when no page links a backend.

`POST /api/auth/test-token` with `{ email }` creates the account if needed and returns a normal session `{ token, username }`; with `browserSession: true` (same origin only) it sets the session cookie instead, like email sign-in. The route is 404 unless test login is enabled, and the server refuses to start with test login when `NODE_ENV=production`. The email-code flow stays the documented way to sign in.

## Publishing, saving and comments

`POST /api/publish` with `{ source, files?, requestId }` publishes a page and returns `{ id, version, url, path, source }`. The server adds the core tag if it is missing, rewrites known hosts to its own origin, gives every element in `<body>` a stable `data-af-id`, and writes `id`, `version` and `nextNodeId` into the page's `data-af="meta"` block; `source` in the response is the page exactly as saved. A page whose meta block names an ID the publisher reserved with `POST /api/ids` is published under that ID. Repeating a publish with the same `requestId` returns the first result.

`PUT /api/files/:id/source` with `{ source }` and `If-Match: <version>` saves the next version; a stale version is `409` with the current `version`, and a missing `If-Match` is `428`. Removed node IDs are never reassigned. Linked backend files (`<link rel="af-backend">`) are published with the page through `files`; a page and its backend versions commit together.

Comments, their context (the page version and state the commenter saw), sharing and paths work on six-character IDs; see the HTTP API reference. Top-level state written through `@afbin/apollo` belongs to each viewer (kept in their browser, never shared); data viewers share goes through backend files and their stores.

## Deployment

Configure `PAGEGI_PLATFORM_ORIGIN=https://platform.example` and `PAGEGI_RUNNER_ORIGIN=https://{document}.runner.example`. Route both hosts to this service and provision TLS for the runner subdomains; the runner domain must be separate from the platform host. Each page runs in its own runner origin (the label is the page ID in lowercase hex, since host names are case-insensitive). In local development the service starts a separate loopback runner port per page.

The `Dockerfile` builds the image and runs `node src/server-main.js` on `0.0.0.0:8787`; [`compose.yaml`](compose.yaml) runs it with Postgres and the backend execution service, the same image started as `node src/backend/execution-main.ts`. Only that service gets the host's Docker socket, to create the sandbox containers backend files run in; see [`deploy/execution-service.md`](deploy/execution-service.md).

This release is a clean break from the earlier 12-character document IDs, `/d/` and `/f/` addresses, the `pagegi` CLI and CLI pairing: start it on an empty database.

## Development and tests

```sh
npm run validate      # TypeScript and architectural policy checks
npm test              # pure tests: no browser, server, database or network
```

Database, browser and isolate tests need a disposable Postgres (default `postgres://pagegi:pagegi-local@127.0.0.1:55432/pagegi`; each test creates and drops its own schema), Playwright browsers and Docker:

```sh
docker run -d --name pagegi-postgres-dev -e POSTGRES_USER=pagegi -e POSTGRES_PASSWORD=pagegi-local -e POSTGRES_DB=pagegi -p 127.0.0.1:55432:5432 postgres:17-bookworm
npx playwright install chromium firefox webkit
npm run build:backend
npm run test:local       # also test:database, test:browser, test:isolate
npm run test:v2:all      # only the acceptance tests in test/v2, read straight from the skill
npm run check            # validation and every stage
```

Every stage includes `test/v2`. Browser journeys are ordinary `*.browser.test.js` files in the browser stage.

Define or update TypeScript interfaces first, write failing behavioral tests against them, then implement. See [the fast development loop](docs/development-validation.md) and [CI policy](docs/ci-policy.md).

Dataset image uploads require `PAGEGI_DATASET_ATTACHMENT_DIRECTORY`, a private writable directory, together with `PAGEGI_BACKEND_EXECUTOR=remote` and the authenticated execution transport. The app streams images to the controller's `/v1/image-process` endpoint; image decoding runs in an isolated container. Keep this directory separate from the readonly source dataset and media mounts. Without attachment storage configuration, upload routes remain unavailable.
