# Phase 2 architecture: compile every published document to a tiny Data→UI app

Status: shipped. The modules below describe the compiled reader and its rollout. The approved proposal is `https://app.artifactbin.dev/a/R9gGaO`; its TL;DR and three
size targets are the scope. Its "Future work" list is out of scope.

Targets (brotli/wire bytes, checked by `scripts/size-targets.mjs` against the page-speed lab):

| # | Target | Today | Phase 2 |
|---|--------|-------|---------|
| 1 | JS before ready, pages with nothing interactive (prose, deck) | 275 KB | ≤ 10 KB |
| 2 | JS before ready, interactive pages (kit, dashboard, every component) | 275–300 KB | ≤ 85 KB |
| 3 | Production prose page, total transferred | 481 KB | ≤ 200 KB |

Owner decisions, not reopened here: publish-time compiler to Solid islands; Solid 1.9; a vendored
interactive kit with Radix DOM conventions (no solid-ui/Kobalte dependency); static components render
at publish with today's React kit until Phase 3; snapshot-first data (minutes-old is fine), guest-only
snapshots, viewer data after paint; optimistic writes with a saving/saved/failed indicator;
prefetch/prerender of linked artifacts; one output for every reader path (`/raw` stays, no separate
runtime); every milestone deletes what it replaces.

## 1. Module map

One owner per module. Contracts (types and narrow interfaces) are committed in
`services/app/lib/compiled-page/contract.ts` (server side) and `services/app/lib/islands/contract.ts`
(browser side). Both are framework-free: `solid-js` is not a dependency of main and the reader runtime
is typed against the existing react-free store (`lib/story-runtime/store`), never against Solid.

| Module | Path | Responsibility | Track |
|--------|------|----------------|-------|
| Compiler | `lib/compiled-page/compiler.ts` | `compilePage(input) → CompiledPage`: the parsed version → static HTML with islands spliced in, one per-document module source, island refs, data plan, link hints. Pure and deterministic for one compiler build. | w2-compiler |
| Codegen safety harness | `lib/compiled-page/codegen-safety.ts` | `shapeOf` (AST with every literal blanked), the hostile string set, `hostileDocument` and `structureIndependent` — the test harness the compiler is proven with. Landed in step 0. | step 0 |
| Shared island build | `scripts/build-islands.mjs` → `public/islands/` | Once per deploy: `solid-js`, the runtime and each kit module as content-addressed browser chunks + `public/islands/manifest.json` (specifier → URL) + the compiler build id. Replaces the standalone story runtime build (#175). | w1-toolchain |
| Module store | `lib/compiled-page/modules.server.ts` + `GET /islands/d/:sha.js` | The per-document module's bytes, content-addressed in the object store (`lib/object-store`), served immutable under `script-src 'self'`. | w1-assembler |
| Compiled page store | `lib/story/prepared-page.server.ts` (`PreparedPage.compiled`) | The compiled artifact is stored with the prepared page, keyed by document version. Deploys do not invalidate it. | w2-compiler |
| Reader selection | `lib/compiled-page/reader-mode.ts` | Compiled documents serve by default; editing and commenting views use their dedicated paths. | w4-flip-docs |
| Data plan | `lib/compiled-page/plan.ts` | `planOf(flow, access) → DataPlan`: every query classified `shared` / `viewer` / `page` from the compiled dataflow's reads and the datasets' access facts; the datasets a snapshot depends on; the values that key a snapshot. Pure. | w1-planners |
| Snapshot store | `lib/compiled-page/snapshots.server.ts` + `app.data_snapshots` | Guest snapshots keyed by version + plan + inputs; marks of every dataset read; freshness decided on read by comparing marks (the correctness rule) and eagerly by the dataset write hook (the optimisation); background revalidation; server-drawn charts stored with the snapshot. | w1-snapshots |
| Server chart drawing | `lib/compiled-page/charts.server.ts` | A `<Question>` drawn to SVG from a snapshot with vega on the server; Vega loads in the browser only on interaction. | w1-planners |
| Reader page assembler | `lib/compiled-page/assembler.ts` | `assembleReaderPage(input) → string`: ONE function for `/a/:id` (server-rendered chrome, SPA loaded on idle) and `/raw` (no chrome, no SPA), custom domains, exports, the offline file and the CLI preview. Replaces `lib/story/document.ts` assembly and `server/app withInitialStory`. | w1-assembler (wired by w3-serve) |
| Island runtime | `lib/islands/rt.ts(x)`, `lib/islands/boot.ts` | What every island receives (`IslandContext`): data accessors, values, `mutate`, viewer overlay, write status feed, revalidation patching. Bridges the existing react-free store into Solid's store. | w2-runtime (viewer/writes: w3-viewer-writes) |
| Interactive kit | `lib/islands/kit/*.tsx` | Vendored Solid components with Radix DOM conventions, one file per family, the intended reader DOM pinned by component tests. | w2-kit-structure, w2-kit-controls, w2-kit-data |
| Viewer overlay door | `GET /a/:id/viewer` | After paint: the viewer's identity, the `viewer`-scope results, mutation access, holdable imports — the same admission as `POST /a/:id/query`. | w3-viewer-writes |
| SPA handover | `web/initial-story.ts`, `components/ArtifactSurface.tsx`, `lib/islands/handover.ts` | The React app adopts the live island document without re-rendering it (`IslandDocument`); edit mode disposes the islands and mounts today's editor. | w3-handover |
| Link hints | `lib/compiled-page/links.ts` | `<a href>` to same-deployment artifacts, collected at compile → `<link rel=prefetch>` and speculation rules emitted by the assembler. | w1-planners |
| Handover gate | `scripts/gate-hydration.mjs` | Checks that the compiled story survives island hydration and app adoption, then yields to the editor. | w4-flip-docs |
| Size targets | `scripts/size-targets.mjs`, `scripts/lib/document-views.mjs` (`jsBeforeReady`) | The three targets, pass/fail per target from a lab result JSON; blocking in `page-speed.yml`. | step 0 → w4-flip-docs |

Routes translate results to HTTP; every module above returns data or a string and never a `Response`.

## 2. Data flow

```
publish ──► prepare (prepared-page.server build)        stored: prepared_pages.page
             │  nodes, css, glyphs, declared dataflow
             ▼
           compile (compiler.ts, off the write path, in warmPreparedPage)
             │  CompiledPage { html, islands, module?, plan, links, build }
             ├─► module bytes → object store (/islands/d/<sha>.js)
             └─► stored beside the prepared page (PreparedPage.compiled)
             ▼
           snapshot (snapshots.server put)               stored: data_snapshots
             │  shared-scope queries at default values, anonymous admission,
             │  charts drawn to SVG, marks of every dataset read
             ▼
serve  ──► assembler (one function)                      /a/:id, /raw, domains, export, offline, CLI
             │  compiled.html + snapshot results/drawings + per-request overlay
             │  (viewer hint, URL $values, stored Mermaid drawings, hints)
             ▼
hydrate ─► boot.ts loads the shared runtime + the per-doc module (only when islands exist)
             │  store seeded from the snapshot island JSON; islands hydrate in place
             │  viewer-scope data fetched from /a/:id/viewer after paint; islands patch
             ▼
revalidate ► server: dataset write → marks move → snapshot stale → background re-snapshot
             client: live stream `data`/`snapshot` frames → store.refresh(queries) → only the
             islands reading a changed table update (fine-grained Solid store diff)
```

### 2.1 Publish → compile

`warmPreparedPage` already prepares the head after every commit, off the write's path. w2-compiler extends
`build()` so that the prepared page also carries `compiled`.
Compilation is pure over the prepared page's inputs (`nodes`, `glyphs`, `colorMode`, `template`,
`chrome`, the stored `CompiledDataflow`, `refData` for `ref:` sources) and the compiler build id. A
compile error is stored as `compiled: { build, error }` so the read path never retries in a loop and
the fallback is explicit.

The per-document module (`islands.jsx` + `client.jsx` in the prototype) is built with esbuild against
the shared chunk manifest (`externals`), minified, hashed and written to the object store; the compiled
page stores only its `ModuleRef`. A document with no islands has no module (prose, deck: the deck rail
is a 0.6 KB framework-free behaviour chunk from the shared build).

### 2.2 Serve

The assembler takes `AssembleInput` (contract) and returns the whole HTML document. Chrome is an
input (`ReaderChromeInput` rendered by today's `renderReaderChrome`, or null for `/raw`, exports and
the offline file). The story HTML (`AssembleInput.story`) is produced by the serve path, never by the assembler: when the
request has a snapshot, the compiled page's SSR module (`CompiledPage.ssr`, the `generate: 'ssr'` build of
the same islands, imported once per build) renders the islands WITH the snapshot's rows and drawings —
the prototype's `render(data)` — so a dashboard's first paint is its numbers, not skeletons; the result is
cached per (build, snapshot key). Without a snapshot the stored `html` (islands in their declared state)
is served. Static parts never re-render. The assembler then adds what is per request: the island data
JSON (`<script type="application/json" id="mx-story-data">`), the chart slots' `ready` state, and the
version's stored Mermaid drawings. Everything else in the page is per version and cached with it.

The Phase 1 open items come with the rewritten route (w3-serve): one row fetch and one access check per view
(`artifactPageAnswer` and the raw route today each fetch the row and decide admission separately), and
per-version caching keyed on the compiled build.

`/a/:id` is HTML-first: the reader sees the finished document and server-rendered chrome; the React
app is loaded on idle (`requestIdleCallback`, falling back to a timer) or on the first interaction with
the chrome, and adopts the page (§7). `/raw` is the same assembler output without chrome and without
the SPA loader; it keeps its CSP sandbox.

### 2.3 Hydrate

`boot.ts` (shared chunk) reads `#mx-story-data`, starts the existing `createDataflowStore` with the
existing `createDocumentTransport`, seeds it from the snapshot's `results`, and hydrates each island in
place by its hydration-key prefix (`rt.island(renderId, Component)` in the prototype): the parent's
other children are handed back as the same nodes, so static siblings are never touched. The store is
the one source of document data for islands, the author's `window.mx`, and later the SPA.

### 2.4 Revalidate

Server side: §5. Client side: the live stream (`/a/:id/events`) already sends `data` frames naming a
written dataset; the store re-runs exactly the queries that read it (`queriesReadingDatasets`) and the
Solid store bridge applies the result with `reconcile`, so only the computations that read a changed
cell re-run. Charts drawn on the server re-draw in the browser only when their table changes or the
reader interacts (Vega loads then).

When the live stream announces a new document version, the reader fetches its compiled story from
`GET /a/:id/story` and morphs it into the running page. Unchanged nodes and islands keep their DOM and
state; changed islands are disposed and hydrated from the new version. The same path serves a public
post on its custom host. If the fragment cannot be served or morphed, the reader reloads while keeping
its place.

## 3. The compiled page artifact

`CompiledPage` (contract):

- `build`: the shared island build id recorded at compile time. The compile also records the exact
  shared manifest and server half it needs. A newer server serves this stored build unchanged.
- `html`: the story element's inner HTML, static parts final, each island rendered in its DECLARED
  state at its slot (served only when no snapshot exists), `<mx-slot>` never left in the output.
- `ssr`: `ModuleRef | null` — the server build of the same islands (`render(data) → story HTML`), stored
  like the browser module; the serve path renders the islands from a snapshot through it.
- `islands`: `IslandRef[]` — hydration key prefix, the island's root node path (`data-mx-ast`), the
  kit tags it uses, whether it reads data.
- `module`: `ModuleRef | null` — the per-document BROWSER module's content address and URL, and the
  shared chunk URLs it imports (for `<link rel=modulepreload>`), null when the page has no islands.
- `plan`: `DataPlan` (§4) or null when the version declares no data.
- `links`: `LinkHints` (§8).
- `kit`, `reactStatic`, `unported`, `partial`: what the compile used and could not port — reported,
  and `unported.length > 0` means the compile is refused (fallback), never a page with holes.
- `behaviors`: framework-free behaviour chunks the page needs (`deck`).

Stored inside `prepared_pages.page` as `compiled`. `page_key` is only the document version (`v:<n>`)
within its head or archived slot. `compiler_version`, `island_build`, `css_version`, `ssr_bundle`,
`page_format` and `handover_contract` are separate, queryable columns. The compiler fingerprint comes
from the esbuild input graph of preparation and compilation and is emitted with the server build
assets. The island build's immutable files and server half are retained in the object store; the
local output directory also accumulates content-addressed files and reports bytes added per build.

## 4. Islands and the data plan

### 4.1 What an island receives

`IslandContext` (browser contract): `values()` (every scalar's current value), `value(name)`,
`table(name)` (fine-grained), `tableSnapshot(name)` (the whole result, for charts), `pending(name)`,
`error(name)`, `setValue(name, value, { debounce })`, `mutate(request)`, `viewer()`
(`StoryViewer | null` — the signed-in hint first, the full identity after the overlay lands),
`people()`, `writes` (the status feed), `drawings` (the version's stored Mermaid drawings),
`subscribe(fn)`. All of it is the existing store's vocabulary; the Solid bridge is an implementation
detail behind `IslandContext`.

Reactive markup (`$x`, `$_row.f`, conditionals, `<For>`) is data: the compiler emits the parser's
`ReactiveExpression` objects as JSON literals and the runtime evaluates them with the interpreter's own
evaluator (`lib/jsx/reactive`). No author string ever becomes code.

### 4.2 The data plan

`planOf(flow: CompiledDataflow, access: DatasetAccessFacts) → DataPlan`, pure. For each query, in run
order, scope is the most specific of its own reads and its upstream queries' scopes:

| Reads | Scope | Why |
|-------|-------|-----|
| `_tz` (transitively) | `page` | Only the page knows the reader's zone; never served (today's rule, `served-results.server servable`). |
| `_me`, `_me.id`, `_me.role` (transitively) | `viewer` | The answer names the reader. |
| an import or Postgres `source` the ANONYMOUS reader is not admitted to through this document (the run's own admission, `tableForRef`: `grantsPermitRead` for the anonymous principal — every dataset carries grants, the defaults read to `*` — else `visibility !== 'private'`) | `viewer` | The guest's answer is the dataset's refusal; a reader who is admitted gets rows. The guest snapshot would be correct for guests and wrong for everyone else, which is why these fetch after paint. Reads carry no row-level rules today (a read grant is the whole dataset), so admitted-or-not is the whole fact. |
| a `user`-typed column or a user picker value (`people`, `userOptions`) | `viewer` | Person cards are named per viewer's visibility (`lib/datasets/user-fields`). |
| `_members` | `shared` | The artifact's accepted members are the same for every reader; the membership change is a source (`MEMBERS_SOURCE`) the snapshot's marks must cover (§5). |
| `_now` | `shared` | Time-dependent but not viewer-dependent; the snapshot's age bound covers it. |
| everything else | `shared` | In the guest snapshot. |

`DataPlan.datasets` lists every artifact the shared queries read (imports, Postgres sources, picker
sources) — the snapshot's dependency set, carried by the plan because `prepared_pages.deps.datasets`
is empty whenever the compiled dataflow is stored with the source (`compiledElsewhere` is false) and
cannot be reused. `DataPlan.inputs` names the scalar values the shared queries read; a snapshot is keyed
by their values (defaults, and the URL's `$` values when a request carries them).

Mutations: `optimistic` when the runtime can apply the write to a held copy (`placeDataflow` today);
otherwise `server`. The plan records the target dataset for invalidation.

## 5. Snapshots: keys, freshness, invalidation, revalidation

### 5.1 Key

`SnapshotKey = { artifactId, slot ('head' | 'v:<n>'), planKey, inputsKey }` where `planKey` is a
digest of the `DataPlan` (so a republish that changes a query misses) and `inputsKey` a canonical
digest of the shared-scope input values. The head's default-input snapshot is the one that is
prepared eagerly; other input sets are snapshotted on first read (bounded per artifact; over the bound
the request runs its queries as today's served results do).

### 5.2 Freshness — the correctness rule is decided on read

A snapshot stores `marks`: the mark of every dataset in `DataPlan.datasets`, taken BEFORE its queries
ran (exactly `served-results.server marksOf`: `version, edit_id, visibility, link_role, sharing_revision,
policy_revision, live, md5(meta)`), plus the membership revision when the plan reads `_members`. A read
compares the stored marks with the current ones in one query (`MARK_SQL` over the dataset ids); equal
means fresh, otherwise stale. This is the same philosophy as the live stream: NOTIFY is a pointer, the
read is the truth. It catches every way a dataset changes, not only `mutateDataset`: `PUT /api/artifacts/:id`
replacing a dataset, a revert, a fork's copy, a sharing or policy change, a deletion (all of which
move `edit_id`, `version`, `sharing_revision`, `policy_revision` or `live`).

A stale snapshot is still SERVED when it is younger than `SNAPSHOT_MAX_AGE_MS` (minutes-old is the
owner's accepted staleness) and a revalidation is queued; older than that, the request waits for the
revalidation within `SERVED_RESULTS_BUDGET_MS` (250 ms today) and otherwise serves declarations without
rows, as the page does now.

### 5.3 Eager invalidation — the optimisation

`data_snapshots` carries an indexable `datasets TEXT[]` column. The dataset write path
(`mutateDataset`, after its CAS UPDATE commits and beside its `pg_notify`) calls
`invalidateSnapshots(datasetId)`: `UPDATE data_snapshots SET stale_at = now() WHERE $1 = ANY(datasets)
AND stale_at IS NULL`, then queues revalidation of the affected heads. Exactly the dependent snapshots
are marked, because the plan's dataset list is exactly what its shared queries read. The other write
paths (replace, revert, fork, sharing, policy) are covered by the marks rule; w1-snapshots may add the same call
to them where cheap, but correctness never depends on it.

Postgres-sourced queries (`engine: 'postgres'`) read a connected database that has no mark and sends
no NOTIFY. Their snapshots are keyed by the dataset row's mark (credentials, sharing) and additionally
time-bounded: `computedAt + SNAPSHOT_MAX_AGE_MS` is a hard revalidation deadline, and a request older
than that revalidates before serving.

### 5.4 Revalidation

`revalidate(key)` re-runs the shared queries at the snapshot's inputs with anonymous admission —
`dataflowForRow(row, { only: sharedQueries, viewer: null, values })`, the same run, engine, caches,
caps and timeouts as `POST /a/:id/query` — takes fresh marks BEFORE the run (a change after the mark
is caught by the next comparison), draws the charts, and stores the new snapshot under the same key.
One worker, one pending entry per key, every failure swallowed (the same discipline as
`warmPreparedPage`): a failed revalidation is an older snapshot, never a failed read.

Open pages learn of it through the live stream: the existing `data` frame already re-runs the reading
queries in the page; w1-snapshots adds no new frame type unless the snapshot's SVG drawings must be pushed (open
question Q3).

### 5.5 Probe findings (step 0)

A throwaway test against the real dataflow and dataset code (the dashboard fixture, `compileDataflow`,
the marks query, `mutateDataset`, `PUT /api/artifacts/:id`, `setDatasetPolicy`) — run on this branch,
not committed — established:

- PROBE-1 (the marks rule, `changedSince` over the page's `since` token): a declared `<Mutation>`
  through `POST /a/:id/mutate` moved the written dataset's mark and NOTIFYed its channel
  (`subscribeToArtifact` fired once, in-process PGLite); `PUT /api/artifacts/:id` replacing a
  dataset, `updateSharingFor` (a new share) and `setDatasetPolicy` each moved the mark too. In
  every case `changedSince` named exactly the written dataset and nothing else; a document whose
  token never named the dataset reported nothing (negative control). Observed:
  `mutation → wakeups 1 changed ['RiD2xn']`, `PUT replace → changed ['9gML2X']`,
  `sharing → changed ['9gML2X']`, `policy → changed ['9gML2X']`.
- PROBE-2 (classification on the dashboard fixture plus five added queries, real `compiledForRow`
  output): `regions`, `monthly`, `by_product` → shared (they read only the public `sales` import);
  `me` (`$_me.id`) and `downstream_me` (reads `me`) → viewer; a query over a PRIVATE dataset and a
  query over a public dataset whose grants read `from: { user: '$owner' }` → viewer; `select $_tz`
  → page. The access fact that decides it is the run's own admission (`tableForRef`:
  `grantsPermitRead` for the anonymous principal through the document): `canReadArtifact(ds, null)`
  agreed in all three cases, and `!!dataset_policy` did NOT — every dataset carries the default
  grants (`read` from `*`), so "has a policy" says nothing; the contract's `DatasetAccessFacts` is
  therefore `{ anonymousRead }` alone.
- Consequences taken into the contracts: `DataPlan.datasets` carries the dependency set (the
  prepared page's `deps.datasets` is empty when the compiled dataflow is stored with the source);
  `DataSnapshot.marks` reuses the served-results mark shape verbatim; the eager hook is
  `invalidate(datasetId)` beside `pg_notify` in `mutateDataset`, and the other write paths are
  covered by the marks comparison on read.

## 6. Failure and fallback

A prepared page stores the compiled result or a recorded compile failure with its recorded build
versions. A read keeps serving that compile across deploys. An edit changes the document version and
compiles again. Only a hand-raised `MIN_PAGE_FORMAT` or `MIN_HANDOVER_CONTRACT` invalidates an older
stored compile automatically; missing compiles compile inline. `COMPILE_INLINE_BUDGET_MS` records a
slow compile; it does not select another renderer.
If compilation still fails, `/raw` returns a reported 500 and the app page raises
`CompiledPageFailed`. The response names the reason in `x-mx-reader-fallback`; a successful
response names `x-mx-reader: compiled`. Access is checked before either result.

An unported component cannot produce a partial reader page. The compiler covers registered
components through a Solid island or a static shell. A missing module leaves the served HTML
readable while its interactive parts remain inert; the runtime reports the load failure. A failed
viewer overlay leaves its neutral placeholder and can retry. If a snapshot is missing or stale,
the request tries shared queries within `SERVED_RESULTS_BUDGET_MS` and otherwise serves the
declarations for the island to refresh after paint.

Deliberate backfills use `scripts/compiled-backfill.ts`. Select versions by recorded columns, for
example `--where compiler_version!=<current>`, `--island-build <old>` or `--format-below 3`. Run
`--dry-run` first. The running server recompiles each selected version through its admitted reader
door; a repeated filtered run skips versions that no longer match. The script ends with a database
census. A deploy by itself triggers no backfill.

## 7. Coexistence with the React app and the editor

The editor keeps today's interpreter for drafts (`StoryRuntimeApp`, the registry, the in-place edit
session): the browser never compiles. What changes is how the READER page relates to the SPA:

1. The page is HTML-first. The assembler renders the reader chrome on the server (`renderReaderChrome`
   already exists for domain posts) and the compiled story; the SPA's entry is loaded on idle or on
   the first chrome interaction, exactly as the prototype's "SPA prefetched on idle, adopts live
   islands" path (warm takeover 126–139 ms at 4× CPU).
2. Adoption without re-render. The SPA finds the island document through `IslandDocument`
   (`lib/islands/handover.ts`): `root` (the story element), `store` (the same react-free
   `DataflowStore` the islands run on), `mode`, `setMode('read' | 'edit')`, `dispose()`, `subscribe`.
   `ArtifactSurface` moves `root` into its tree (the same move `adoptInitialStory` makes today) and
   renders chrome around it; it does NOT hydrate or re-render the story. The islands keep running and
   the SPA's reactions (like, follow, comments) keep reading the store.
3. Live version and edit mode. A new published version is morphed into the adopted story in place,
   preserving unchanged nodes, islands, reader values and the store. The app refreshes its comment
   anchors and selections after the morph. `setMode('edit')` disposes the islands (Solid roots
   unmounted, listeners removed) and hands the SPA the raw `nodes`; the editor mounts its interpreter over the source as it does today
   and re-renders in place. Leaving edit mode publishes, and the next read is a compiled page again;
   the SPA re-adopts on navigation, not in place (an edited draft's islands are not recompiled in the
   browser).
4. Migration rules from the Phase 3 probe that apply now: register island handlers with `on:click`
   semantics where a Solid child sits under React chrome (click order inverts otherwise); never nest a
   Solid overlay inside a React overlay or the reverse — island overlays portal to the trusted UI
   container (`components/TrustedUi`) the SPA already owns; one framework-free store shared by both;
   one context per island (no cross-island context); refs are read after hydration, not at creation.
5. Comments and annotations anchor on author ids and `data-mx-ast` paths, which the compiler preserves
   verbatim (Kobalte was rejected for rewriting ids). The comment layer stays the SPA's.

## 8. Link hints

At compile, every `<a href>` that resolves to an artifact on this deployment (`/a/<id>`,
`/@user/<id>-slug`, a verified custom domain of this deployment) is collected into `LinkHints`:
`prefetch` (all such links, emitted as `<link rel="prefetch" as="document">`) and `prerender` (the
first few in document order, as speculation rules with `eagerness: moderate` so hover/viewport
triggers them). Speculation rules ship as an EXTERNAL JSON file (`/islands/s/<sha>.json`, content-
addressed in the module store) named by the `Speculation-Rules` response header — the only way Chrome
loads external rules; an inline `<script type="speculationrules">` would need `'inline-speculation-rules'`
in the CSP, which stays `script-src 'self'`. The assembler returns the header with the page
(`AssembledPage.headers`); the route sets it.
Private documents are never prerendered (the anonymous prerender would be a 404 page cached under the
reader's URL); the hint set is computed from the compiled page and carried by the assembler input.

## 9. Security model for generated code

- Author text reaches the generated module only through `lit()` (JSON.stringify with `<`, `>`, U+2028
  and U+2029 escaped). Tag and attribute NAMES come from the validated AST and are re-checked against
  a strict grammar; a name outside it refuses the compile.
- Props are computed by the interpreter's own `rawBuildProps` (dangerous URL schemes, handlers and
  denied attributes dropped exactly as today) and serialised by React's server renderer, so a static
  element's attributes are byte-identical to today's render.
- `$` expressions travel as JSON data and are evaluated at runtime by `lib/jsx/reactive`; row
  substitution goes through `substituteRow` and the runtime's `rowAttrs` re-applies the dangerous-scheme
  filter per row.
- Structure independence is a test (`codegen-safety.ts structureIndependent`): a document compiled
  with benign strings and with hostile strings yields modules with identical ASTs once literals are
  blanked. The compiler's own tests assert it on every kit family.
- CSP: the compiled page emits NO inline script. The per-document module and the shared chunks are
  same-origin files; the data island is `application/json`. `/raw`'s `script-src` drops
  `'unsafe-inline'` for compiled responses (the history prelude moves into the shared runtime), and
  `/a/:id` keeps `APP_CSP` unchanged. `services/app/__tests__/raw-document.test.ts` pins the text and
  is updated in w3-serve.
- The module store serves only content-addressed paths it wrote; a request for an unknown hash is a
  404, never a compile.

## 10. Reader selection

Prepared documents compile with the deployed island build. Reader requests use the version's stored
compile and its recorded island build across deployments. Editing and commenting views keep their
dedicated editing paths.
Every document response names its path with `x-mx-reader`; when a compile cannot serve, the
response includes `x-mx-reader-fallback` with the reason (§6). No deployment flag or reader query
parameter selects another runtime.

## 11. What gets deleted, and when

The legacy reader was removed in wave 4. The standalone and inline deletion PRs precede
the reader flag removal. The line counts below were measured before deletion.

| What | Lines | Replaced by | Deleted in |
|------|-------|-------------|-----------|
| `lib/story/document.ts` (standalone assembly) | 665 | assembler | #175 |
| `lib/story/inline-story-html.ts` | 31 | assembler | #177 |
| `server/app.ts withInitialStory`, `withoutInlinedSheet` | ~60 | assembler | #177 |
| `lib/story-runtime/entry.tsx` (the /story runtime) | 464 | shared island build | #175 |
| `lib/story-runtime/InlineStoryRuntime.tsx` | 478 | handover | #177 |
| `lib/story-runtime/live-entry.ts`, `anchor-entry.ts`, `comment-entry.ts` | 147 + 123 + 124 | runtime chunks | #175 |
| `scripts/build-story-runtime.mjs`, `story-runtime-graph.mjs`, `lib/story/runtime-asset.ts`, `public/story/` | 420 + 112 + 158 | `scripts/build-islands.mjs` | #175 |
| `lib/story-runtime/inline-sheet.ts` (browser CSS work) | 40 | server-only isolation | #177 |
| runtime class merging in the reader (`tailwind-merge`/`clsx`/`cva` in reader chunks) | 9.0 KB gz | classes resolved at publish | #177 |
| `lib/story/served-results.server.ts` | 173 | snapshots | #175 |
| Radix wrappers used only by the reader | per component | vendored kit | #177 (the editor's use stays until Phase 3) |
| reader flag and `?reader=` selection | — | one compiled reader path | #183 |

`StoryRuntimeApp.tsx`, the interpreter and the registry stay for the editor's drafts and for
static-component rendering at publish until Phase 3.

## 12. Gates and the size targets

- `scripts/gate-hydration.mjs`: checks the compiled story's served elements, island hydration,
  app adoption and edit handover. `x-mx-reader` confirms the compiled response.
- `scripts/size-targets.mjs <lab.json>`: target 1 from `jsBeforeReady` on prose and deck (view route),
  target 2 from `jsBeforeReady` on kit, dashboard and kitchen (view route), target 3 from the total
  wire bytes of prose (view route); one line per target, `pass`/`fail`/`no data`; `--strict` fails on
  a missed target. `page-speed.yml` runs it on the head result into the job summary with `--strict`.
- `jsBeforeReady` joins the page's resource timing (names and `responseEnd`, available at the opaque
  origin even though sizes are not) to the CDP wire bytes per URL; ready is: view → takeover, raw →
  the `mx:ready` event, or DOMContentLoaded when the page has no module script. Unit: wire bytes as the
  lab measures them (the gateway gzips only what the server did not already brotli).
- The codegen-safety harness is a library with its own tests; the compiler's tests use it.

## 13. Assumptions

A1. Solid 1.9 is the stable version used by the kit and runtime. Its measured browser cost is
    budgeted in target 2.
A2. The prototype's compiler (`scripts/probe/solid/compile.mjs`, ~320 lines) ports to TypeScript with
    the same inputs; its measured parity on prose, kit, dashboard, deck and mermaid is retained by
    component and browser journey checks.
A3. React's server renderer stays available at publish for static components (`renderToStaticMarkup`
    in the compiler) until Phase 3 — the app already depends on react-dom/server.
A4. The object store (`lib/object-store`) is the right home for per-document module bytes: content-
    addressed, already used for datasets, no schema change. Module URLs are served by a route, not a
    static mount, because the bytes live in the store, not on disk.
A5. `prepared_pages.page` (JSONB) can carry the compiled HTML and plan without a size problem: the
    kitchen sink's HTML shrank from 47.6 KB to 35.1 KB in the prototype (no node tree in the payload).
A6. The lab's `bytes.*.gzip` (wire bytes) is the measurement the targets are checked against; brotli
    is what the server emits for dynamic HTML and precompressed assets, gzip only where the gateway
    compressed identity responses.
A7. The dashboard fixture's `Select` (a kit control bound to `$region`) and `DataTable` are islands;
    its `Card`s are static and render with React at publish. This is the shape target 2 is checked on.
A8. Membership changes bump `sharing_revision` on the artifact row, so the marks rule covers
    `_members` without a second source (verified in the probe; see the report).
A9. The `x-mx-reader` header is safe to expose: it names a rendering path, never a version or a viewer.

## 14. Open questions

Q1. Per-viewer overlay for the editor's own reads: does the owner's page fetch `/a/:id/viewer` before
    the SPA loads (a second request on every page) or does the SPA's session answer it? Proposed:
    the page fetches it after paint only when the plan has viewer-scope queries or the signed-in hint
    is present (a cookie the server sets at login; a guest never fetches).
Q2. Snapshot bound per artifact for non-default inputs (URL `$` values): proposed 16 keys per artifact,
    LRU by `updated_at`; beyond it the cold path runs. Owner to confirm the number.
Q3. Should a background revalidation push the new SVG drawings to open pages (a `snapshot` frame) or
    is the existing `data` frame (page re-runs and draws in the browser, loading Vega) enough? The
    proposal accepts Vega on interaction; a re-run after a write is close to an interaction.
Q4. Custom domains: the domain post today renders through `buildStoryDocument` with a footer; the
    assembler's `chrome` input covers it, but the canonical/self-canonical rules stay in
    `server/custom-host`. Confirm no separate output is wanted for domains.
Q5. Speculation rules through the `Speculation-Rules` header: Chrome only; Safari/Firefox ignore it and
    `<link rel=prefetch>` is the cross-browser floor. Confirm the CSP stance (no
    `'inline-speculation-rules'`, no inline rules script).
Q6. Exports (`/a/:id/export`) photograph `/raw?key=`: compiled output means the capture waits for
    islands to hydrate instead of React; the export route's readiness signal (`mx:painted`) must be
    emitted by the island runtime too. Owned by w3-serve; confirm no capture-specific
    output.
