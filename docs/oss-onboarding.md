# Set up OSS and use its features

There are two supported starting points. `afbin serve` runs the packaged,
persistent team host. A source checkout runs `npm ci`, `npm run setup -- --yes`,
then `npm run dev`. Source development requires Node.js 22+ and npm; the
standalone CLI needs neither. Both default to embedded PGLite, local objects,
email-code login, SQLite queries and local browser exports.

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
Connect the branch CLI to that account:

```sh
npm run afbin -- auth
```

Approve the connection in your signed-in browser. The development wrapper selects
this checkout's public URL and keeps credentials in `~/.artifactbin-dev/<port>`;
it does not change your released CLI configuration or installed agent skills.
Its first invocation builds the CLI and host runtime, so it takes longer than
subsequent calls.

Save this as `hello.jsx` in the checkout:

```jsx
---
title: My first document
template: editorial
theme: modernist
visibility: private
---
<div data-design="tw" className="p-8 space-y-4">
  <h1 className="text-4xl font-bold">My first document</h1>
  <p>Published from my own Artifactbin server.</p>
</div>
```

```sh
npm run afbin -- add hello.jsx --json
npm run afbin -- preview hello.jsx
# Stop preview with Ctrl+C, then publish:
npm run afbin -- push hello.jsx --json
npm run afbin -- help markup
```

Open the published document in the signed-in browser. Edit it there, or edit the
local file and push again. Push may rewrite the file with identity metadata and
persistent node IDs; read that file before editing it again. Browser edits to a
published head require `pull` before your next local edit. Preview instead saves
browser changes directly to the selected local files.

For a second checkout, use `npm run setup -- --yes --port 7445` and its own data
directory. Setup can be rerun to repair configuration while retaining existing
values and secrets. App and adjacent HMR ports must both be available.

## Packaged self-host

Follow [team hosting](extraction/team.md). Use the exact origin `serve` prints,
normally `http://app.lvh.me:7445`, with `afbin config set host <origin>` and
`afbin auth`. Local login codes appear in the server terminal and
`<dir>/data/outbox.jsonl`; `npm run dev:otp` reads only a source checkout's outbox.

Use [server.env.example](extraction/server.env.example) for `afbin serve`.
The repository's `.env.example` is for source development and contains settings
the packaged host refuses. Shared network hosting additionally needs an HTTPS
public origin, complete email/Google/OIDC login configuration, and wildcard DNS
and TLS for the document pages host. Keep settings private (mode 0600).

## Feature setup

| Feature | What a fresh OSS installation needs | Where to start |
| --- | --- | --- |
| Documents, themes, templates, browser editing, comments, sharing, history and restore | Default setup and a signed-in account. Share roles and artifact visibility still control access. | `afbin help markup`, `afbin help publishing`, [editing](editing.md) |
| CSV/JSON datasets, SQL queries, charts, Values and mutations | Register data with `afbin add rows.csv --json`; use its `ref:ID` in `<Import>`, query `name.rows`, and push the document. Push publishes unpublished registered dependencies. Mutations need the dataset's write policy. | `afbin help markup-data`, `afbin help apps`, `afbin help databases` |
| Connected PostgreSQL datasets | A reachable PostgreSQL database and credentials in its dataset definition. Private network destinations require the self-host operator's `DATASET__ALLOW_PRIVATE_NETWORKS` setting. | `afbin help databases` |
| Images, PDFs, other files and URL imports | Registered files or permitted remote URLs. Remote imports need network access and respect size limits and blocked private destinations. | `afbin help publishing-datasets` |
| PNG/JPG exports | Chromium, prepared/downloaded when needed; published exports run on the server. Local exports also prepare the CLI's preview runtime. | `afbin export <ref> --output report.png` |
| Offline HTML | A published head; use `afbin export <id> --format html --output report.html`. The result is one file that can open, edit and comment offline, within its size limit. | [CLI export reference](../services/cli/README.md) |
| Native author scripts and exported Solid components | One Helmet script; use `page` bindings and `solid-js`. Bare external npm imports use the ESM CDN and need network access. Extra hosts need declared CSP consent. | `afbin help markup-scripts`, [document format](document-format.md) |
| Lambdas and cron schedules | Source dev enables the local runner automatically. Packaged hosts need `RUNNER__SERVICE_URL` and matching `CONTRACT__ACTOR_SECRET`, plus a separate controller. Publish a Helmet script with a default-exported function. These are authenticated HTTP APIs; there is currently no `afbin run` or schedule command. | [complete runner setup and API](../services/runner/README.md) |
| AI capabilities inside runner programs | Operator-selected OpenAI-compatible endpoint and model on the runner; optional provider key. No AI provider is needed for ordinary lambda/dataflow execution. | [runner configuration](../services/runner/README.md) |
| Live browser sessions | Chromium and the browser worker's OS prerequisites. Linux server sessions require bubblewrap, user namespaces and delegated cgroup v2. `npm run dev` on macOS uses its documented development-only plain-process mode. | `afbin help live-sessions`, `.env.example` browser settings |
| Remote terminal agents and comment review | A locally installed supported agent harness, its own provider authentication, and `afbin remote`. The local machine runs it; OSS relays the terminal and comment work. | [remote review](remote-review.md), [CLI reference](../services/cli/README.md) |
| Managed server-side default agent | A custom composition explicitly opting into `createAppHost({hostedAgent: …})`, configured runner and model. The default OSS server does not enable it. | [hosted integration contract](../services/runner/README.md#hosted-conversations) |
| Google/OIDC, S3, external application PostgreSQL, custom domains and split services | Operator credentials/infrastructure. Source/custom compositions support these adapters; packaged `serve` has a deliberately narrower configuration (local objects and SQL/browser/event services). | [operations](operations.md), `.env.example`, [team hosting](extraction/team.md) |

## Verify and troubleshoot

Run `npm run validate` and focused `npm test -- --files <test paths>` while
working; broader suites and browser/container gates belong in PR CI. A deferred
suite is not a pass. See [AGENTS.md](../AGENTS.md) for the check budget.

- `approval_origin_mismatch`: point the client at the exact public origin and
  approve there, rather than mixing `localhost`, an IP address and `app.lvh.me`.
- Private document blank: check the app/pages same-site relationship and wildcard
  DNS; use the public URL setup prints.
- `Unsupported team setting`: use the team settings example, not the source `.env`.
- `runner_unavailable`: a packaged host needs the separate runner settings and
  controller. Source development should register its local runner at startup.
- `not_executable` or `invalid_lambda`: publish a default-exported function with
  supported headless imports. DOM/browser scripts do not become headless programs
  automatically; put browser-only initialization behind a DOM availability check.
- Exports or sessions cannot launch: check Chromium preparation and the server
  OS requirements. Image export and live-session sandboxing have different needs.

External provider login, paid AI reliability, DNS/TLS, remote PostgreSQL and S3
need verification against the operator's configured infrastructure. Deterministic
local tests do not prove those deployments are configured correctly.
