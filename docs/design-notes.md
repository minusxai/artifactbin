# Design notes

These notes retain the reasons behind constraints that are easy to lose during refactoring.
They describe current boundaries; old incident timelines and retired implementations are in Git history.
Paths below are relative to `services/app` unless they start with `services/` or `scripts/`.

## Services and request ownership

The OSS-root `server.ts` composes shared authentication, the Hono app, SQL,
browser and events in one process. `services/auth` owns login, OAuth and actor
resolution. Production pins these module interfaces through a Git submodule;
its private composition owns proxy policy, request rate limiting and separate
compute services. No proxy or rate-limit engine is shipped in OSS.

Public build admission belongs to `server/build-assets.ts`: only flat JS/CSS/woff2
paths listed in the Vite manifest return marked bytes from
`/api/internal/build-assets/*`. Authentication assembly probes that handler
anonymously with byte-request headers and accepts only marked static responses.
Unknown files, queries, writes and unverified responses retain access checks.
No document, dataset or whole `/assets/*` namespace is declared public.

Signing belongs to HTTP actor transport; in-process callers carry the resolved
actor on the request. The app owns live document streams. Construct fresh
response headers: the Node adapter may add headers.

The app shell is Vite/React (`web/`), served by `server/app.ts`; there is no Next runtime.
`web/NavigationBoundary.tsx` coordinates navigation with pending edits. Reader documents use the
shared story runtime for SSR and hydration. Author scripts do not run in the app's origin.

### Settings vs constants

A per-deployment SETTING is an environment variable, namespaced `MODULE__NAME`, and it is read in
exactly one place: `lib/config.ts` for the app, and each other service's own audited config/env
module (CLI scripts and eval harnesses have their own boundaries). A COMPILE-TIME CONSTANT that the
CLI and the app must agree on is not a setting: it lives in `services/contracts` — `SESSION_LIMITS`,
`TESTUSER_LIMITS` — so one number is shipped in the binary, the server and the teaching at once.
Nothing else reads `process.env`, and nothing hard-codes a limit beside a second copy of it: a
limit an operator can change is a setting in the owning config module, and a limit a client must
predict is a contract constant.

## Persistence and access

`lib/db.ts` owns the app database adapter. PGLite queries are serialized because it has one connection;
transactions must retain that serialization. Dataset PostgreSQL connections are a separate concern in
`lib/datasets/postgres.ts`; the auth and events services also own their database connections.

Schema declarations generate additive DDL and deployment SQL. A table addition is incomplete without
ownership checks and regenerated SQL. Treat startup migrations as concurrent and idempotent.

Artifact access distinguishes owner, editor, commenter, viewer and anonymous link access. Sharing,
visibility, and writable dataset access answer different questions. Defaults in `createArtifact` depend
on both ownership and format: owned documents are private, owned assets are unlisted, and anonymous
visibility follows the deployment's public-visibility setting. Always consult the current policy functions.

`lib/object-store` hides local files and S3. The database is the index: missing or unreadable bytes raise
`ObjectUnavailable`, never a successful empty result. Immutable keys enable caching; large files use
streams/ranges so one download does not occupy the entire read cache.

`lib/analytics.ts` currently dual-writes legacy analytics and the events log independently. `lib/workspace-analytics.ts`
can read the events log or fall back when its table is absent. Do not remove the legacy path just because
one reader uses the new log: folders and other readers must migrate together. Daily visitor bucketing is
UTC and deduplicates daily visitor fingerprints; raw IP addresses and user agents are not stored.

Activity feeds are excluded from the OSS toolkit. Event persistence, workspace listings
and view/engagement insights remain; `lib/workspace-analytics.ts` owns their event reads.
There is no feed capability flag, UI, wire contract or HTTP endpoint.

Folders use `ancestor_ids` and app chrome (`web/pages/Folder.tsx`, page data `kind: 'folder'`), not stored
listing markup. Child writes notify the parent channel so listings refresh. Trash uses `deleted_at` and
`LIVE_ARTIFACT_SQL`; retention and purge belong to `lib/trash`.

`services/cli/src/state.ts` owns the CLI's only local state: one SQLite database at
`~/.artifactbin/state.sqlite` (`ARTIFACTBIN_HOME` relocates it), whose records are keyed by workspace
root, kind and key — tracking, account resources, Markdown conversions, conflicts and recovery
journals alike. Nothing is ever written into a user's workspace: no lockfile, no tracking directory,
and a tracked file keeps the sha256 of its local bytes rather than a copy of them. Forced overwrites
keep the replaced bytes under `~/.artifactbin/backups/local` and report that absolute path.
Cross-process exclusion is a zero-byte lock database beside the store, released by the OS even after
SIGKILL.

## Documents, edits and data

`lib/story/document.ts` renders the same `StoryRuntimeApp` composition hydrated by the runtime entry.
The shell must not render a second hidden copy of document markup. The document runtime owns editing,
selection and geometry; the parent owns persistence. Node IDs identify source nodes across edits;
AST paths are transient positions, not durable identities. An annotation is a relation to a node and
must not rewrite document source merely to attach a comment.

Edits must preserve optimistic version checks, rebasing, history and atomic batches. Generated DOM
attributes must not become authored content. Author HTML, scripts and static JSX are separate paths
with different validation rules; consult the scoped markup instructions before changing any of them.

Reader rendering starts with declarations rather than waiting for SQL rows. `lib/story-runtime/store.ts`
owns query state, cancellation, debounce and stale-result suppression. Reader URL values seed typed
scalar choices through `lib/story/url-values.ts`; do not parse those parameters independently elsewhere.
Mutations run as the document's permitted writer and retain dataset access and row-scope checks.

## Builds and tests

The runtime is a gitignored build input required by SSR. Vitest global setup builds it, so invoking a
project directly does not rely on a developer's previous build. Build cost changes over time; do not
encode historical timings as guarantees. `lib/dynamic.ts` preserves client-only mounting semantics so
SSR and the first hydration pass agree while charts and editors remain lazy chunks.

For authorized markup pages, `server/reader-preloads.ts` reads Vite's production manifest once per
server and advertises Profile, Artifact and InlineStoryRuntime plus their static dependencies before
the bootstrap JSON. This overlaps downloads without executing the modules or changing the SSR handoff.
Dynamic descendants stay lazy. Development uses Vite's own HTML; missing production hints fall back to
lazy discovery. The managed-iframe gate holds the app entry and verifies reader requests start anyway.

The generated CSS candidate list belongs to markup: its inputs, its generator and its freshness test
are in [story-ui/AGENTS.md](../services/app/lib/story-ui/AGENTS.md). Font assets and manifests are
created by the asset-copy script; restored dependency caches still need that step.

Use deterministic fixture servers for third-party imports in merge gates. The Sheets fetch stub is
scoped to Sheets requests and must not bypass the SSRF-guarded fetcher's DNS checks. Real provider
availability is a separate canary concern. Browser gates use disposable servers, accounts and data.
A retry is reported evidence of an intermittent failure, not proof that the original failure was harmless.

Do not adopt remote document updates while local typing is uncommitted; an empty edit buffer is not
proof that the document is clean. Reader URL choices seed island `values`, not precomputed `state`,
so seeding the link does not suppress the initial query run.

### Selecting CI work

`scripts/lib/ci-plan.mjs` maps changed paths to service modules and expands
transitive dependents, including app composition tests and eval consumers.
The GitHub adapter (`scripts/ci.mjs`) diffs the PR merge base with renames
expanded into both paths. Node shards receive selected module roots; API,
UI and browser gates remain whole integration suites when the app is affected.
Script contract tests run with every code change because they read across modules.

Workspace manifests, shared contracts/utils, build and CI configuration,
unclassified paths or unavailable history select the full suite. Only explicitly
classified repository prose skips runtime checks; shipped skill markdown belongs
to the app. Pushes to main always run everything. Keep dependency edges current
when adding cross-module consumers; the planner tests also check workspace edges.
The required `test` job accepts a skipped job only when the plan did not select it,
and includes CLI results. Paid provider evaluations are explicit local maintainer operations.

Run `npm test -- --files scripts/__tests__/ci-plan.test.mjs` for path,
rename, dependency, workflow wiring and required-result checks. The CI plan is
printed in the Actions summary so each skipped job is reviewable.

### What each job is for

Every job other than the planner is one of the plan's outputs, and each exists because of a class
of failure the others cannot see. `checks` is the type and name guard (`npm run validate`) — the
cheapest signal there is. The Vitest projects run as their own sharded jobs; the browser set is
described in [operations](operations.md). Maintainer agent evaluations live in a private repository, checked out at `evals/` for a run.
`build` proves the production build compiles.

Three jobs exist because a green unit suite does not prove a shippable artifact:

- **`image`** builds the full `Dockerfile`, then *runs* the container and serves from it, and
  drives one page-measuring gate against that container. The build step is where a
  production-only break lives — the app's stylesheet once compiled to zero rules while every
  unit test passed — and a dev server never executes it.
- **`compose`** builds the lean per-service images, checks each one's contents and standalone
  behaviour, then boots them together and walks the split shape end to end: health, publish,
  serve, query, emit. It is the only check that the services still honour the same contracts
  across an HTTP boundary rather than in one process.
- **`cli`** runs the CLI suite and then builds and smoke-tests the standalone executable on every
  released OS and architecture. Its failures — a native helper, the PTY, executable discovery —
  are platform-shaped and invisible to a single-platform run.

## Dynamic comment identity and interaction

`lib/story/comment-target.ts` defines refinements under an independently validated
source owner. DataTable targets retain the table node ID plus typed `rowKey` and
column identity. For targets retain the source owner, typed item key and template
node ID when `keyBy` is supplied. Without `keyBy`, rendering and local DOM references
use index keys; comments retain only the For owner and optional quote, without
positional item/text/area refinements. Explicit invalid keys still fail. Nested For,
DataTable and Iframe inside For templates are currently rejected even though the target format can represent nested scopes.

Managed Iframe targets use a static source ID, hierarchical `data-comment-key`
path, or generation-scoped session handle. Missing or ambiguous targets retain
the owner and refinement for fallback/reconnection; never choose an arbitrary
matching node or claim an automatic session handle survives replacement/reload.

The managed child owns internal selection and geometry; the parent owns permissions,
composer and persistence. Layout updates must match the active draft target and
frame generation. Sidebar block picking and explicit Select are separate states:
only explicit Select suppresses native text selection/touch scrolling. Snapshot
both user-select property spellings before changing either: Chromium aliases them.

`lib/story-runtime/comment-presentation.ts` supplies inert shared icons and styles
across the realm boundary. Existing threads open from parent markers/sidebar entries;
content clicks remain native, including the first click of a word selection. Child
highlights do not intercept input or add separate dot buttons. The annotations and
comment-targets browser gates cover these interactions, repeated text/node/area
comments, keyed lifecycles, and mobile tap/long-press selection.

### Local verification evidence

This section is the MECHANISM; the rule an agent follows — the file cap, exit 2, what to do on
deferral — lives once, in [AGENTS.md](../AGENTS.md).

`scripts/test-changed.mjs` owns discovery, the combined Vitest/CLI file budget, execution and
unverified/deferred status. It reads structured Vitest output and fails closed on discovery errors.
`scripts/check-local.mjs` owns the command/environment boundary for `validate` and `test`;
`scripts/lib/check-evidence.mjs` records only successful checks with stable inputs. Normal commands
always execute. Explicit `--reuse` allows a parent in the same checkout to reuse evidence for one hour.
Fingerprints include tracked/untracked sources, selected generated inputs, environment digests,
runtime, command/ref selection (including HEAD for default changed tests) and installed lock state. They contain no raw environment values.
Dependencies must remain lockfile-managed; manual changes to ignored dependencies or external state
require a fresh check. These receipts attest to the recorded command's scope, never branch-wide
coverage. CI always executes and remains the merge authority.

PR concurrency cancels superseded runs on the same PR; main runs remain independent. Node shards
retain existing coverage, but only the integration shard provisions Chromium and Postgres. CLI
builds remain available on every Node shard because tests that execute the actual CLI can land on any shard.

### First useful content and workspace performance

The public homepage links its shared stylesheet from HTML so server-rendered
content is styled before JavaScript. Its anonymous response preloads the lazy
workshop renderer's static dependencies, scene mask, robot assets and poster
images using the same URLs and CORS modes as their consumers. Home and Examples
share bundled WebP screenshots in `public/landing/posters`; the catalog retains
canonical document links but never requests remote exports for thumbnails.
Every catalog entry includes a local screenshot. There is no development image proxy
or poster request queue. The renderer reveals the canvas
when its background is ready and updates posters and robots independently.
Pending posters show a loading ring on the paper texture; image load or failure
removes it. Reduced motion keeps the ring static, and only pending textures
are repainted during animation.

Initial Home navigation overlaps its core JSON request with its lazy route code.
The session-owned page store holds startup results until identity resolves; the
first scope adopts the startup marker and subsequent account changes revoke it.
Reader/profile SSR bootstrap remains owned by those routes.

Workspace core owns narrow SQL projections: no document metadata or engagement
queries. Shared rows retain description and role for search/access display.
Lifetime visitor counts move to insights as one grouped query with the existing
visitor semantics; Home and folder dashboards join the resulting ID map. The
current 1000-document shelf, 50-row asset pages and folder placement semantics
remain owned by workspace-inventory; aggregate totals cover the entire account.

ArtifactSurface admits DatasetCatalogView through a format-specific dynamic
import. Editor warming is limited to markup viewers with edit permission and is
cancelled on unmount or permission loss. These are intentional lazy browser
boundaries; the reader import-graph test guards the dataset split.


Export cache lookup precedes screenshot queue admission. Per-key in-flight work
coalesces storage lookup and rendering; only misses serialize, and failed keys
are released. Access checks still precede this module. Both cache layers include
the version and edit identity, so migrations that preserve versions invalidate
pre-repair screenshots without deleting immutable objects,
and volatile previews never enter durable storage.

The paired-performance workflow builds the production reference and candidate
on one runner, prepares the visible-library thumbnail cache, then records seven
cold/warm browser samples for Home and prose. Preparing thumbnails equalizes
server render work before the browser-cache comparison.
Its PGLite/local-object-store measurements are controlled lab evidence, not
production rollout results. Raw JSON includes resource timing and payload sizes.


## Standalone CLI distribution

The dedicated `cli-runtime.yml` workflow builds pinned Node source with `small-icu` (English/root
locale data) only when a maintainer requests a new runtime revision. Prepared executables and
upstream notices are versioned release assets; `runtime-lock.json` pins compressed and decoded
hashes. Ordinary CLI builds verify/download that dependency through
`services/cli/scripts/runtime.mjs`, then
use the same runtime for SEA generation. Missing or corrupt release bytes fail promptly, never
trigger source compilation. The Actions cache is an optional accelerator and may be evicted. Linux uses a digest-pinned manylinux 2.28 toolchain with
static C++ support and the official Node ET_EXEC layout;
CI rejects other ELF layouts and runtime GLIBC requirements above 2.28. Runtime preparation strips
before injection; `services/cli/scripts/binary.mjs` strips only an explicit raw-runtime override,
then signs and emits raw and gzip assets with separate transport/executable hashes. Raw assets
remain for existing installers and self-updaters; new clients prefer gzip and verify decoded bytes
before atomic replacement. Linux and Intel Mac injection use hash-pinned LIEF 0.17.6 Python wheels;
the old postject writer corrupts large ELF symbol tables and Intel TLS (postject PR #108, Node issue
#59553). The injectors follow Node’s current algorithms, verify the unique SEA fuse and exact embedded
bytes, and preserve ELF dynamic symbol names. ELF program headers move after BSS to keep load pages
disjoint on older kernels. CI emits per-platform `.sizes.json` measurements.

SQL's contract and in-process execution stay unchanged. The standalone composition redirects only
the engine's sanctioned lazy native import. Its executable embeds a package manifest, not DuckDB;
first use downloads a platform-specific binary archive with architecture-thinned/stripped native
files. `services/cli/src/native-package.ts` bounds decompression, checks every path/hash, publishes a
private cache atomically and verifies cached files before native loading. Concurrent processes can
stage independently but share the same immutable checksum directory. No user data enters download
requests. `afbin setup --service sql` prepares offline use without selecting skills or authenticating.
CLI upgrades pin their own package checksum; source/npm builds retain their installed dependencies.
`CLI__SERVICE_BASE_URL` is owned by CLI config and changes only package transport, never trust. A base URL may include a path prefix;
the local eval proxy serves the same compressed/core/native assets under `/chat/releases`.
Browser rendering remains server-side and adds no mandatory browser bytes to this release.

## Dataset SQL dialects and legacy repair

Stored catalog reads cross the SQL service boundary as an isolated logical catalog, not rewritten
PostgreSQL SQL. `services/sql/src/read-catalog.ts` owns native DuckDB AST admission, catalog relation
checks, permitted-column registration, lazy model views and typed parameter casts. The original
SQL executes without a JSON AST round trip (which would round exact integers through JavaScript).
`lib/datasets/sql.ts` remains the PostgreSQL compiler. Computed row sources use the stored path too.

Manual data migrations require server shell access (SSH or equivalent infrastructure access).
There are no migration HTTP endpoints or remote migration clients. The database-level functions
in `lib/node-identity-migration.ts` and `lib/datasets/migrate.ts` remain available for reviewed
on-server maintenance code; no standalone migration command is shipped. Stop the app before
opening its PGLite directory from a maintenance process, and use the deployment's database and
object-store configuration. Back up and preview changes before applying them.

The dataset-catalog migration retains invalid historical versions as explicit exceptions while
repairing validated heads and history. Callers must validate document data, preserve preview
snapshots before writes, pass reviewed fingerprints to apply, and audit every page afterward.
Unresolved heads remain conflicts; complete artifact/history fingerprints guard each transaction.

Legacy datasets with surviving flat JSON in `content` receive a read-time catalog adapter.
Migration plans a content-addressed object key without writing; apply uploads the original bytes
only after locking the reviewed database snapshot, then updates catalog metadata. Original inline
content and version numbers remain intact. Invalid/missing bytes remain explicit conflicts.
The complete-input dataflow path also recognizes these inline sources, so dependent aggregates
never silently use the displayed 1,000-row sample.

## Host document authorization

`createAppHost` accepts an optional `documentEditorPolicy` over authenticated account claims.
Row permissions and SQL scopes consult that same policy for markup editor access. It never
grants ownership or private dataset writes. The OSS host supplies no policy; deployment-specific
operator identities and allowlists belong to the production composition.

## Export images and refresh coordination

`/a/:id/export` remains the image front door; `mode=card` selects the saved OG
cover/framing and the default photographs the document. `refresh=1` waits for a
new result. Completed images are immutable objects, served through scoped asset
URLs with streaming reads. No completed export bytes live in app RAM caches.

The app's export cache owns one row per artifact/variant and an immutable image
record per successful render. A conditional claim grants a 60-second lease;
rendering/upload happen outside transactions. Cached images remain readable
while refreshing after one hour or a source-revision change. Cold/explicit
refresh callers wait up to 35 seconds with jittered 1/2/4/8-second polling.
Publishing checks the claim token and lease; failures retain the old image and
back off. The browser has a 30-second render budget and waits for pending chart
markers to clear, including lazy loading and Vega work. A timeout is not an image.

S3 production renders use an object-scoped signed PUT; browser returns only
image metadata. Local stores keep the same cache/asset contracts through the
existing byte renderer. A restricted upload gateway can stream PUTs to the
configured S3 export prefix while the browser stays on its internal network.

## Local artifact identities

`services/cli/src/identities.ts` owns registration, the account-scoped ID pool,
path-to-ID mappings and moves. `add`, automatic registration in `preview`/`push`,
and ID resolution use this module. IDs are independent of published snapshots:
registration creates no server artifact; first publication uses that exact ID at v1.

The selected host reserves batches of 100 IDs under an idempotency key. The CLI
stores the pool in its existing SQLite state and opportunistically refills at 20.
Cached IDs work offline; exhaustion requires a connection. SQLite transactions,
the existing file journal and process locks protect assignment and recovery.
Mappings use workspace-relative paths; `mv` moves binary files with their mapping.
JSX carries its ID, so a missing old path can be reconciled after a manual rename.

Artifact references are `ref:ID` or `/a/ID`. Preview resolves registered local IDs
first and otherwise reads the selected host. Missing registered files are errors.
Push publishes referenced unpublished files first, preserves reference IDs, and
uses existing conditional writes and recovery for published files. Bare push
includes registered drafts. Relative artifact-reference discovery, temporary
dependency IDs and publication-time path rewriting are removed. Paths remain
valid command arguments and explicit YAML content inputs.

The server owns reservation and claim checks in `artifact-identities.ts`; routes
only authenticate and translate results. Reserved and ordinary creates share one
namespace. Claims must belong to the authenticated account and commit with the
artifact transaction. Consumed IDs are never recycled. CLI write protocol 2
requires updating clients and hosts together.
