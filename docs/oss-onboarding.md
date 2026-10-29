# Set up OSS and use its features

A source checkout runs `npm ci`, `npm run setup -- --yes`, then `npm run dev`.
Source development requires Node.js 22+ and npm. It defaults to embedded PGLite,
local objects, email-code login, SQLite queries and local browser exports.

## First login and document from source

Open the **public URL setup prints**, normally `http://app.lvh.me:3030`.
`lvh.me` and all its subdomains resolve to loopback. Documents have their own
origins under this hostname, and the app needs to be on the same site for private
document cookies. Opening `localhost` can show the app while private documents
fail to render. If DNS filtering blocks `lvh.me`, configure a wildcard loopback
DNS name and pass it with `npm run setup -- --pages-host <hostname>`.

Request a login code, then read it in another terminal:

```sh
npm run dev:otp -- you@example.com
```

Enter it in the browser and choose a handle. No real email is sent locally.
Agents author through the artifactbin author skill, downloaded from
`<origin>/skills/artifactbin.zip` (use this checkout's public URL as `<origin>`);
its `node scripts/auth.mjs` signs in. The HTTP API guide is at `<origin>/llms.txt`.

Save this as `page.html` (the HTML page format is described in the author skill):

```html
<!doctype html>
<html>
<head><title>My first document</title></head>
<body>
  <h1>My first document</h1>
  <p>Published from my own Artifactbin server.</p>
</body>
</html>
```

```sh
node scripts/publish.mjs page.html
```

Open the published document in the signed-in browser. Edit it there, or edit the
local file and publish again. Browser edits to a published head require reading
the current head before your next local edit. Use the published artifact ID
returned by `publish.mjs`, rather than the local filename, as the reference, and
preserve any unpublished local edits in a separate copy first:

```sh
node scripts/read.mjs <published-id> --output page.html
```

For a second checkout, use `npm run setup -- --yes --port 7445` and its own data
directory. Setup can be rerun to repair configuration while retaining existing
values and secrets. App and adjacent HMR ports must both be available.

## Feature setup

| Feature | What a fresh OSS installation needs | Where to start |
| --- | --- | --- |
| Documents, themes, templates, browser editing, comments, sharing, history and restore | Default setup and a signed-in account. Share roles and artifact visibility still control access. | [editing](editing.md), [document format](document-format.md) |
| CSV/JSON datasets, SQL queries, charts, Values and mutations | Register data through the author skill or HTTP API and reference it from the page. Mutations need the dataset's write policy. | `<origin>/llms/datasets`, `<origin>/llms/dataviz` |
| Connected PostgreSQL datasets | A reachable PostgreSQL database and credentials in its dataset definition. Private network destinations require the self-host operator's `DATASET__ALLOW_PRIVATE_NETWORKS` setting. | `<origin>/llms/backends` |
| Images, PDFs, other files and URL imports | Uploaded files or permitted remote URLs. Remote imports need network access and respect size limits and blocked private destinations. | [file uploads](file-uploads.md) |
| PNG/JPG exports | Chromium, prepared/downloaded when needed; exports run on the server. | [serving and security](serving-and-security.md) |
| Offline HTML | A published head; download the HTML export. The result is one file that can open, edit and comment offline, within its size limit. | [editing](editing.md) |
| Native author scripts and exported Solid components | One Helmet script; use `page` bindings and `solid-js`. Bare external npm imports use the ESM CDN and need network access. Extra hosts need declared CSP consent. | [document format](document-format.md), `<origin>/llms/html-operations` |
| Lambdas and cron schedules | Source dev enables the local runner automatically. Hosts without the local runner need `RUNNER__SERVICE_URL` and matching `CONTRACT__ACTOR_SECRET`, plus a separate controller. Publish a Helmet script with a default-exported function. Schedules use authenticated HTTP APIs. | [runner setup and schedules](../services/runner/README.md) |
| AI capabilities inside runner programs | Operator-selected OpenAI-compatible endpoint and model on the runner; optional provider key. No AI provider is needed for ordinary lambda/dataflow execution. | [runner configuration](../services/runner/README.md) |
| Live browser sessions | Chromium and the browser worker's OS prerequisites. Linux server sessions require bubblewrap, user namespaces and delegated cgroup v2. `npm run dev` on macOS uses its documented development-only plain-process mode. | [browser sessions](mx-sessions.md), `.env.example` browser settings |
| Google/OIDC, S3, external application PostgreSQL, custom domains and split services | Operator credentials/infrastructure. Source/custom compositions support these adapters; some compositions use a narrower configuration. | [operations](operations.md), `.env.example` |

## Verify and troubleshoot

Run `npm run validate` and focused `npm test -- --files <test paths>` while
working; broader suites and browser/container gates belong in PR CI. A deferred
suite is not a pass. See [AGENTS.md](../AGENTS.md) for the check budget.

- Mixing `localhost`, an IP address and `app.lvh.me` breaks sign-in: use the exact public origin setup prints.
- Private document blank: check the app/pages same-site relationship and wildcard
  DNS; use the public URL setup prints.
- `runner_unavailable`: a host without a local runner needs the separate runner settings and
  controller. Source development should register its local runner at startup.
- `not_executable` or `invalid_lambda`: publish a default-exported function with
  supported headless imports. DOM/browser scripts do not become headless programs
  automatically; put browser-only initialization behind a DOM availability check.
- Exports or sessions cannot launch: check Chromium preparation and the server
  OS requirements. Image export and live-session sandboxing have different needs.

External provider login, paid AI reliability, DNS/TLS, remote PostgreSQL and S3
need verification against the operator's configured infrastructure. Deterministic
local tests do not prove those deployments are configured correctly.
