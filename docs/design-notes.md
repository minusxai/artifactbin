# Design notes

These notes retain the reasons behind constraints that are easy to lose during refactoring.
They describe current boundaries; old incident timelines and retired implementations are in Git history.
Paths below are relative to `services/app` unless they start with `services/` or `scripts/`.

## Services and request ownership

The OSS-root `server.ts` composes the proxy, Hono app, SQL, browser and events implementations for the full image.
Split images use the same contracts over HTTP. `services/proxy/src/parts.ts` orders session resolution,
rate limits, login/OAuth, forwarded headers and the final upstream forwarder. Deployment policy belongs
in configuration or a downstream composition, never an app special case.

Proxy rate limits come from policy files. Signing belongs to HTTP actor transport; in-process callers
carry the resolved actor on the request. The app owns live document streams, so a proxy does not need
another database subscription layer. Construct fresh response headers: the Node adapter may add headers.

The app shell is Vite/React (`web/`), served by `server/app.ts`; there is no Next runtime.
`web/NavigationBoundary.tsx` coordinates navigation with pending edits. Reader documents use the
shared story runtime for SSR and hydration. Author scripts do not run in the app's origin.

## Persistence and access

`lib/db.ts` owns the app database adapter. PGLite queries are serialized because it has one connection;
transactions must retain that serialization. Dataset PostgreSQL connections are a separate concern in
`lib/datasets/postgres.ts`; the proxy and events services also own their database connections.

Schema declarations generate additive DDL and deployment SQL. A table addition is incomplete without
ownership checks and regenerated SQL. Treat startup migrations as concurrent and idempotent.

Artifact access distinguishes owner, editor, commenter, viewer and anonymous link access. Sharing,
visibility, and writable dataset access answer different questions. Defaults in `createArtifact` depend
on both ownership and format: owned documents are private, owned assets are unlisted, and anonymous
visibility follows the deployment's public-visibility setting. Always consult the current policy functions.

`lib/object-store` hides local files and S3. The database is the index: missing or unreadable bytes raise
`ObjectUnavailable`, never a successful empty result. Immutable keys enable caching; large files use
streams/ranges so one download does not occupy the entire read cache.

`lib/analytics.ts` currently dual-writes legacy analytics and the events log independently. `lib/feed.ts`
can read the events log or fall back when its table is absent. Do not remove the legacy path just because
one reader uses the new log: folders and other readers must migrate together. Daily visitor bucketing is
UTC and deduplicates daily visitor fingerprints; raw IP addresses and user agents are not stored.

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

The CSS candidate list is extracted from string literals in kit and selected embed files after comments
are stripped. Run `npm run generate-story-ui-classes` after editing those inputs. Font assets and manifests are
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
and includes CLI results. The live-provider agent smoke remains optional/advisory.

Run `npm test -- --files scripts/__tests__/ci-plan.test.mjs` for path,
rename, dependency, workflow wiring and required-result checks. The CI plan is
printed in the Actions summary so each skipped job is reviewable.

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

`scripts/test-changed.mjs` owns discovery, the combined 50-file Vitest/CLI budget, execution and
unverified/deferred status. It reads structured Vitest output and fails closed on discovery errors.
`scripts/check-local.mjs` owns the command/environment boundary for `validate` and `test`;
`scripts/lib/check-evidence.mjs` records only successful checks with stable inputs. Normal commands
always execute. Explicit `--reuse` allows a parent in the same checkout to reuse evidence for one hour.
Fingerprints include tracked/untracked sources, selected generated inputs, environment digests,
runtime, command/ref selection and installed lock state. They contain no raw environment values.
Dependencies must remain lockfile-managed; manual changes to ignored dependencies or external state
require a fresh check. These receipts attest to the recorded command's scope, never branch-wide
coverage. CI always executes and remains the merge authority.

PR concurrency cancels superseded runs on the same PR; main runs remain independent. Node shards
retain existing coverage, but only the integration shard provisions Chromium and Postgres. CLI
builds remain available on every Node shard because `evals/__tests__/cli-kit.test.ts` executes the actual CLI and can land on any shard.
