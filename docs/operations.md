# Operations

## Operational notes

- **Storage**: ONE env, `DATABASE_URL`, and the URL is the type. Unset ⇒
  embedded [PGLite](https://pglite.dev) in `./data/pglite` (no database
  server); `pglite://<path>` ⇒ PGLite there (`pglite://memory` for RAM);
  a `postgresql://…` URL ⇒ external Postgres — your database, your schema.
  Schema applies additively on boot; there are no migration scripts, ever.
- **Exactly one server process may own the PGLite directory.** CLI tools go
  through HTTP for this reason; horizontal scaling requires `DATABASE_URL`.
- **Two health URLs, answering two different questions.** `/health` on any
  process — proxy, app, sql, browser — is THAT process's own liveness, and it
  is what an orchestrator should restart a container on: it touches neither
  the database nor the object store, so a storage blip never restarts a server
  that would have recovered on its own. `/api/health` is the STACK's
  readiness: it arrives through the proxy, is answered by the app, and the app
  first asks every service it was configured with (`SQL__SERVICE_URL`,
  `BROWSER__SERVICE_URL`, `EVENTS__SERVICE_URL` — an unset one runs in-process
  and needs no probe) for its own `/health`, in parallel, with a two-second
  deadline. It is blind by design: `200 {"ok":true}` or `503 {"ok":false}`,
  never a service name, because topology is nobody's business but yours. Point
  an uptime monitor at `/api/health` and read the app's log to learn WHICH hop
  failed — `[health] upstream unhealthy: sql, events`, logged only when one
  does.
- `npm run validate` type-checks (never `npm run build` to verify);
  `npm test` runs the Vitest suite against in-memory PGLite.
- **Live editing needs LISTEN/NOTIFY**, which both storage modes provide
  (PGLite in-process, Postgres via one dedicated client). A missed
  notification is harmless: every wakeup triggers a fresh read, so the
  document converges either way.
- The browser gates need a RUNNING server and are not part of `npm test`.
  Run them as a set with `npm run test:gates -- <base>`, one with
  `--only=<name>`, and list what exists with `--list` — the runner discovers
  every `scripts/gate-*.mjs` from disk, so a new gate joins by existing and no
  hand-written list can fall behind. A gate's verdict is its exit code.
  Highlights: `app-flows` (whole app), `concurrent-edit` (a human typing while
  an agent edits), `full-kit` (every component through the served document:
  SSR, hydration, isolation, fonts, export), `script-slice` (an author
  `<script>` runs in view and is inert in the editor), `shell-seo` (a crawler
  is served the document itself, text and unfurl tags included), `visibility`
  (the ACL + pretty URLs, incl. a private artifact's sandboxed iframe carrying
  the session cookie). Gates that log in need the dev server pointed at their
  mail sink — see each file's header. To run them against a release-mode
  server, start it with
  `PROXY__RATE_LIMIT_CONFIG_FILE=services/proxy/dev_rate_limits.yml`: the
  shipped default closes anonymous minting outright, and a full pass mints far
  more than the self-host ceiling of 10 from one IP. `--servers` does it for
  you.
- **Image export needs a headless browser**: run `npx playwright install chromium`
  once per host. Renders happen on demand (lazy singleton, 60s idle shutdown)
  and persist in the object store keyed by artifact version, so one render
  serves every og unfurl and profile thumbnail for that version. Without the
  browser, `/a/:id/export` answers `503 render_unavailable`; everything else
  works.
- **Analytics stores no PII.** Every event (`view`, `export`, `create`,
  `edit`, …) is one row: event, artifact id, the signed-in viewer's user id
  (else NULL), a coarse `client` bucket, and a `visitor` fingerprint —
  `sha256(day:ip:ua:userId:ANALYTICS__SECRET)`, so no raw IP or User-Agent is ever
  stored and the embedded day kills cross-day identity. Every "views" number
  is `COUNT(DISTINCT visitor)`: **unique people per day** — a refresh never
  inflates a count (one NAT + one browser build does collapse to one visitor;
  a signed-in account splits it back out). `client` is guessed from the
  User-Agent: browsers land as `browser` (every real browser still says
  `Mozilla/`), branded agents as themselves (`claude-code`, `chatgpt`,
  `curl`…), bare runtimes (`node`, `python`) as `script` — which is where
  MCP tool calls from Claude Code land, since only the MCP `initialize`
  handshake names the client and per-request telemetry can't see it.
  Telemetry only: nothing gates on any of it.
- Dev credentials live in `.env` (see `.env.example`); nothing secret is ever
  in the repo or stored in plaintext.

## Deploying

```bash
cp .env.example .env      # set AUTH__SECRET + APP__PUBLIC_BASE_URL (and DATABASE_URL
                          # if you're bringing your own Postgres)
docker compose up -d      # web (+ the bundled postgres when DATABASE_URL is unset)
```

The app binds `127.0.0.1:3030` by default and expects a TLS-terminating proxy
in front (nginx/Caddy/Traefik); `APP__PORT` moves the host port (and the `npm run
dev` port, where it also outranks `APP__PUBLIC_BASE_URL`), `PORT_BIND=0.0.0.0`
exposes it directly on a trusted network. Chromium ships in the image, so
`/a/:id/export` works out of the box. One web replica by design — the export
browser singleton, in-memory caches, and rate limiters assume a single process.

Before an upgrade, compare the deployment environment with `.env.example`.
Production boot requires `AUTH__SECRET` and `APP__PUBLIC_BASE_URL`; identity
needs permission to create and use its `AUTH__SCHEMA`; login email needs
`EMAIL__RESEND_API_KEY`; and public listing and anonymous minting remain closed
until `ARTIFACTS__ALLOW_PUBLIC` and a `PROXY__RATE_LIMIT_CONFIG_FILE` whose
`anon_mint` is not 0 explicitly open them. Retired or misspelled names are
reported at boot but are not read.

**The rate limits are a file.** Every number lives in a policy file, and
`PROXY__RATE_LIMIT_CONFIG_FILE` says which one — it and
`RATE_LIMITER__TRUSTED_PROXY_HOPS` are the only rate-limit env names there are.
Three ship, differing only in the anonymous mint:

| file | `anon_mint` | for |
|---|---|---|
| `services/proxy/default_rate_limits.yml` | 0 (closed) | production, and what an unset env resolves to |
| `services/proxy/selfhost_rate_limits.yml` | 10/hour/ip | a self-host install (`docker-compose.yml`, the lean stack) |
| `services/proxy/dev_rate_limits.yml` | 2000/hour/ip | `npm run dev`, the browser gates, the evals |

All three are inside every image at `/app/services/proxy/`, so a deployment
points the env at one of them or at a copy of its own. A file is
`policies:` (a budget: `max` per `window`, keyed `ip` | `actor` | `ip+actor` |
`email`; `burst` multiplies `max` for a caller who proved a credential, on the
same bucket; `repeat: N` makes a hit whose exact URL was already seen inside the
window cost `1/N` — what lets one unfurl be re-fetched by every reader of a
shared link while still bounding how many DISTINCT documents an actor can have
rendered), `routes:` (FIRST MATCH WINS: a method or list, a regex over the
pathname, optionally exact `query` params, and `browser_only: true` where a
non-browser must be refused before anything is counted), and `always:` (applied
to every request first; empty in all three). All of a route's policies must
allow, each is counted in written order, and the first refusal is the `door` the
429 body and the `door.denied` event name.

It is read ONCE, at boot. A missing file, an unparseable one, an unknown policy
name in a route, a route with no policies, a path that is not a valid regex, an
unknown key or a window that does not parse REFUSES THE BOOT with the offending
line named — there is no silent fallback to built-in numbers. The boot log says
which file it read (`rate limits ← /app/services/proxy/…`), and a leftover
per-limit name from the retired door vocabulary is reported as
`RATE_LIMITER__ANON_MINT_MAX is set but nothing reads it`.

The limiter is per PROCESS: two replicas each keep their own counters, so the
effective ceiling is `max × replicas`. One web replica by design anyway.

**The images.** The default is ONE image with everything in it; the split
shape is assembled from per-service images, all built from the same commit:

| image | what it is |
|---|---|
| `full` *(the root `Dockerfile`)* | app + proxy + local SQL engine + local Chromium; the self-host image that needs nothing else — what `docker-compose.yml` builds and runs |
| `services/sql` | the standalone SQL engine (DuckDB, and nothing else) as an HTTP service — for the split shape's `SQL__SERVICE_URL` |
| `services/browser` | the standalone export browser (Chromium, and nothing else) as an HTTP service — for `BROWSER__SERVICE_URL` |
| `services/app`, `services/proxy` | the lean halves of the split shape: the app without an engine or browser in-process, the proxy (identity, doors, login, OAuth) forwarding to it at `APP__UPSTREAM_URL`. Their `Dockerfile`s live in-tree with build-time shape assertions; `docker-compose.lean.yml` builds and assembles all four locally. The release workflow publishes the app image, not the standalone proxy image. |

Which shape a process takes is decided by the SAME names in every deployment:
`SQL__SERVICE_URL`/`BROWSER__SERVICE_URL` select the sql and browser contracts
over HTTP, and the lean app refuses to boot without them (it carries neither
implementation). The full image needs nothing — unset means local. In
development the two flows mirror this: `npm run dev` composes app + proxy
in-process with local SQL and browser; `npm run dev:app` runs the app alone
(also with local sql and browser — a URL your `.env` carries for the split
shape is unset for the child, with one line saying so).

Hosted deployment orchestration does not live in this public repository. This
repository publishes the full, app, SQL, and browser images; a deployment
control plane chooses and pins the shape it runs.

**The rendered schema.** `npm run render:schema` renders both packages' table
declarations into three files at the repo root: `SCHEMA.sql` (Better Auth's
compiled fresh-database DDL followed by the app/proxy additive table DDL),
`roles.sql` (the two LOGIN roles and the schemas they own), and `grants.sql`
(the proxy's single cross-schema `SELECT` on `app.tokens`, applied after the
app's first boot). They are generated — regenerate, never edit by hand.

## Compose against the standalone proxy


`@artifactbin/proxy` exports the complete standalone boot. A self-hoster can require additional settings and
filter, replace, or insert the ordered proxy parts by `name` without copying the package's dependency or server
lifecycle wiring:

```ts
import { loadProcessConfig, runStandalone } from '@artifactbin/proxy';

const config = loadProcessConfig({
  required: ['DATABASE_URL', 'AUTH__SECRET', 'APP__PUBLIC_BASE_URL'],
});

await runStandalone(config, {
  parts: (parts) => parts, // e.g. parts.filter((part) => part.name !== 'oauthRoutes')
});
```

`runStandalone` returns `{ url, close }`; it does not install signal handlers. The caller owns its process
policy and calls the idempotent `close()` during shutdown.

| proxy setting | purpose | default |
|---|---|---|
| `UPSTREAM__DEADLINE_MS` | Maximum wait for the upstream response status and headers; streaming bodies are not timed | `30000` |
| `AUTH__GOOGLE_CLIENT_ID` | Google login client id; enabled only with `AUTH__GOOGLE_CLIENT_SECRET` | unset |
| `AUTH__GOOGLE_CLIENT_SECRET` | Google login client secret; enabled only with `AUTH__GOOGLE_CLIENT_ID` | unset |
| `AUTH__OIDC_PROVIDER_ID` | OIDC provider id; setting it enables the provider | unset |
| `AUTH__OIDC_CLIENT_ID` | OIDC client id | empty |
| `AUTH__OIDC_CLIENT_SECRET` | OIDC client secret | empty |
| `AUTH__OIDC_AUTHORIZATION_URL` | Explicit OIDC authorization endpoint | unset |
| `AUTH__OIDC_TOKEN_URL` | Explicit OIDC token endpoint | unset |
| `AUTH__OIDC_USERINFO_URL` | Explicit OIDC user-info endpoint | unset |
| `AUTH__OIDC_DISCOVERY_URL` | OIDC discovery endpoint; fetched during boot when set | unset |
