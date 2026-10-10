# Phase 2 architecture: every published document is a compiled Data→UI app

Status: shipped. This describes the compiled reader as it runs: a publish-time compiler turns each
document version into static HTML with small Solid islands, served the same way to every reader path.
Its four size targets are checked by the page-speed lab.

Targets (gzip wire bytes, checked by `scripts/build/size-targets.mjs` against the page-speed lab):

| # | Target | Before Phase 2 | Target |
|---|--------|----------------|--------|
| 1 | JS before ready, pages with nothing interactive (prose, deck) | 275 KB | ≤ 10 KB |
| 2 | JS before ready, interactive pages (kit, dashboard, every component) | 275–300 KB | ≤ 90 KB |
| 3 | Production prose page, total transferred | 481 KB | ≤ 250 KB |
| 4 | App shell JS before the document frame is ready (every page kind) | 7.6 KB (44.9 KB after #327) | ≤ 50 KB |

Design decisions: a publish-time compiler to Solid islands (Solid 1.9); a vendored interactive kit that
mirrors Radix's DOM conventions, so authored and compiled markup keep one shape (no solid-ui or
Kobalte dependency); static components compile to HTML at publish; snapshot-first data (minutes-old is
accepted), guest-only snapshots, viewer data after paint; optimistic writes with a
saving/saved/failed indicator; prefetch/prerender of linked artifacts; one output for every reader
path (`/raw` stays, no separate runtime).

## 1. Module map

One owner per module. Contracts (types and narrow interfaces) are in
`services/app/lib/compiled-page/contract.ts` (server side) and `services/app/lib/islands/contract.ts`
(browser side). Both are framework-free: `solid-js` is not a dependency of main and the reader runtime
is typed against the framework-free store (`lib/story-runtime/store`), never against Solid.

| Module | Path | Responsibility |
|--------|------|----------------|
| Compiler | `lib/compiled-page/compiler.ts` | `compilePage(input) → CompiledPage`: the parsed version → static HTML with islands spliced in, one per-document module source, island refs, data plan, link hints. Pure and deterministic for one compiler build. Static elements' attributes come from `lib/compiled-page/static-solid/attrs.ts`. |
| Codegen safety harness | `lib/compiled-page/codegen-safety.ts` | `shapeOf` (AST with every literal blanked), the hostile string set, `hostileDocument` and `structureIndependent` — the harness the compiler is proven with. |
| Shared island build | `scripts/build/build-islands.mjs` → `public/islands/` | Once per deploy: `solid-js`, the runtime and each kit module as content-addressed browser chunks, `public/islands/manifest.json` (specifier → URL, chunk graph) and the compiler build id. |
| Build reader | `lib/compiled-page/build.server.ts`, `shared-builds.server.ts` | One reader of the manifest (`loadCompilerBuild`, `parseCompilerBuild`); every build's immutable files and manifest are retained in the object store so an older build can still be bound (§3). |
| Runtime binding | `lib/compiled-page/runtime-binding.ts` | Binds a stored module's `@mx/*` specifiers to a build's chunk URLs at serve time; `preloadClosure` computes the `modulepreload` set (§3). |
| Carriers | `lib/compiled-page/carriers.ts` | The wire format of the inert data blocks at the tail of a stored compiled page (§3). |
| Module store | `lib/compiled-page/modules.server.ts` + `GET /islands/d/:sha.js` | The per-document module's bytes, content-addressed in the object store (`lib/object-store`), served immutable under `script-src 'self'`. |
| Compiled page store | `lib/publish/prepared/prepared-page.server.ts` (`PreparedPage.compiled`) | The compiled artifact is stored with the prepared page, keyed by document version. |
| Serve | `lib/publish/prepared/serve.server.ts` | `compiledPageFor`: stored compile → data (snapshot or cold path) → story → assembler. Returns `CompiledReaderAnswer` (`compiled` or `failed`), never a `Response`. |
| Data plan | `lib/compiled-page/plan.ts` | `planOf(flow, access) → DataPlan`: every query classified `shared` / `viewer` / `page` from the compiled dataflow's reads and the datasets' access facts; the datasets a snapshot depends on; the values that key a snapshot. Pure. |
| Snapshot store | `lib/publish/prepared/snapshots.server.ts` + `app.data_snapshots` | Guest snapshots keyed by version + plan + inputs; marks of every dataset read; freshness decided on read by comparing marks (the correctness rule) and eagerly by the dataset write hook (the optimisation); background revalidation; server-drawn charts stored with the snapshot. |
| Served results | `lib/publish/prepared/served-results.server.ts` | `SERVED_RESULTS_BUDGET_MS` and `marksOf`, shared by snapshots, the cold path and the plan. |
| Server chart drawing | `lib/publish/prepared/charts.server.ts` | A `<Question>` drawn to SVG from a snapshot with vega on the server; Vega loads in the browser only on interaction. |
| Reader page assembler | `lib/compiled-page/assembler.ts` | `assembleReaderPage(input) → string`: ONE function for `/a/:id` (server-rendered chrome, app loaded on idle or on intent) and `/raw` (no chrome, no app loader), custom domains, exports, the offline file and the CLI preview. |
| Island runtime | `lib/islands/rt.tsx`, `lib/islands/boot.ts` | What every island receives (`IslandContext`): data accessors, values, `mutate`, viewer overlay, write status feed, revalidation patching. Bridges the framework-free store into Solid's store. |
| Interactive kit | `lib/islands/kit/*.tsx` | Vendored Solid components with Radix DOM conventions, one file per family, the intended reader DOM pinned by component tests. Overlays share one core (§7). |
| Viewer overlay door | `GET /a/:id/viewer` | After paint: the viewer's identity, the `viewer`-scope results, mutation access, holdable imports — the same admission as `POST /a/:id/query`. |
| App handover | `web/served-frame.ts`, `solid/document/create-framed-story.ts`, `solid/pages/Document.tsx`, `lib/islands/handover.ts`, `lib/story-runtime/frame-bridge/` | The Solid app page adopts the document frame the server drew and reaches the live island document (`IslandDocument`, in `lib/islands/contract.ts`) through the frame bridge without re-rendering it (§7). |
| Link hints | `lib/compiled-page/links.ts`, `speculation.ts` | `<a href>` to same-deployment artifacts, collected at compile → `<link rel=prefetch>` and speculation rules emitted by the assembler. |
| Handover gates | `scripts/gates/gate-kit-and-fonts.mjs`, `scripts/gates/gate-editor-path.mjs` | Check that the compiled story survives island hydration in its frame (kit-and-fonts), then yields to the editor (editor-path). |
| Size targets | `scripts/build/size-targets.mjs`, `scripts/lib/document-views.mjs` (`jsBeforeReady`) | The four targets, pass/fail per target from a lab result JSON; `--strict` fails the page-speed workflow (not `ci.yml`). |

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

`warmPreparedPage` prepares the head after every commit, off the write's path; its `build()` makes the
prepared page carry `compiled`.
Compilation is pure over the prepared page's inputs (`nodes`, `glyphs`, `colorMode`, `template`,
`chrome`, the stored `CompiledDataflow`, `refData` for `ref:` sources) and the compiler build id. A
compile error is stored as `compiled: { build, error }` so the read path never retries in a loop and
the fallback is explicit.

The per-document module (`islands.jsx` + `client.jsx` in the prototype) is built with esbuild against
the shared chunk manifest (`externals`), minified, hashed and written to the object store; the compiled
page stores only its `ModuleRef`. A document with no islands has no module (prose, deck: the deck rail
is a 0.6 KB framework-free behaviour chunk from the shared build).

### 2.2 Serve

The assembler takes `AssembleInput` (contract) and returns the whole HTML document. It draws no app
chrome: the app page (Solid, `solid/document/DocumentChrome.tsx`) frames the assembled `/raw` document
on the document's own origin, and exports and the offline file are the same document without the frame. The story HTML (`AssembleInput.story`) is produced by the serve path, never by the assembler: when the
request has a snapshot, the compiled page's SSR module (`CompiledPage.ssr`, the `generate: 'ssr'` build of
the same islands, imported once per build) renders the islands WITH the snapshot's rows and drawings —
the prototype's `render(data)` — so a dashboard's first paint is its numbers, not skeletons; the result is
cached per (build, snapshot key). Without a snapshot the stored `html` (islands in their declared state)
is served. Static parts never re-render. The assembler then adds what is per request: the island data
JSON (`<script type="application/json" id="mx-story-data">`), the chart slots' `ready` state, and the
version's stored Mermaid drawings. Everything else in the page is per version and cached with it.

`/a/:id` is HTML-first: the reader sees the finished document and server-rendered chrome; the Solid
app is loaded on idle for a reader who can edit, and on intent otherwise (first interaction with the
chrome), and adopts the page (§7). `/raw` is the same assembler output without chrome and without
the app loader; it keeps its CSP sandbox.

### 2.3 Hydrate

`boot.ts` (shared chunk) reads `#mx-story-data`, starts `createDataflowStore` with
`createDocumentTransport`, seeds it from the snapshot's `results`, and hydrates each island in
place by its hydration-key prefix (`rt.island(renderId, Component)` in the prototype): the parent's
other children are handed back as the same nodes, so static siblings are never touched. The store is
the one source of document data for islands, the author's `page` signals (and a session's `window.page`), and later the app.

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
  shared manifest and server half it needs.
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
- `kit`, `unported`, `partial`: what the compile used and could not port — reported, and
  `unported.length > 0` means the compile is refused, never a page with holes.
- `behaviors`: framework-free behaviour chunks the page needs (`deck`).

Stored inside `prepared_pages.page` as `compiled`. `page_key` is only the document version (`v:<n>`)
within its head or archived slot. `compiler_version`, `island_build`, `css_version`, `ssr_bundle`,
`page_format` and `handover_contract` are separate, queryable columns. The compiler fingerprint comes
from the esbuild input graph of preparation and compilation and is emitted with the server build
assets. The island build's immutable files and manifest are retained in the object store
(`shared-builds.server`); the local output directory also accumulates content-addressed files and
reports bytes added per build.

### 3.1 Runtime binding

A stored per-document browser module names the shared runtime by specifier only (`@mx/rt`,
`@mx/kit/tabs`); the chunk URLs come from the manifest of the build that is serving
(`runtime-binding.ts` `bindModule`). A deploy therefore serves every stored page on the newest shared
chunks without recompiling, as long as `MIN_HANDOVER_CONTRACT` is unchanged. The module URL carries
the build (`?b=<build>`), so a browser's immutable cache never holds a module bound to another
build's chunks; a `?b=` naming an older build is bound to that build's retained manifest, so a tab
open across a deploy still gets one coherent runtime. The server half follows the same rule: a stored
story HTML is served only while the SSR half that rendered it is the one the browser will hydrate with
(`serve.server.ts` `storyOf`); otherwise it is rendered again through the live half. A stored module
that names a specifier the live build lacks (`unresolvedSpecifiers`) is recompiled.

### 3.2 Carriers

The compiler appends two inert `<script type="application/json">` blocks to a version's stored HTML: the
browser module's string literals (`data-mx-island-literals`) and the version's large constants
(`data-mx-module-data`, moved by the assembler into the page's one data island). `carriers.ts` is the only
reader and writer of that format (serve, the assembler, the offline file and the morph engine all go through
it). Stored pages are served unchanged, so the format is a stored contract: changing it needs a
`MIN_HANDOVER_CONTRACT` bump and a backfill.

## 4. Islands and the data plan

### 4.1 What an island receives

`IslandContext` (browser contract): `values()` (every scalar's current value), `value(name)`,
`table(name)` (fine-grained), `tableSnapshot(name)` (the whole result, for charts), `pending(name)`,
`error(name)`, `setValue(name, value, { debounce })`, `mutate(request)`, `viewer()`
(`StoryViewer | null` — the signed-in hint first, the full identity after the overlay lands),
`people()`, `writes` (the status feed), `drawings` (the version's stored Mermaid drawings),
`subscribe(fn)`. All of it is the document store's vocabulary (`lib/story-runtime/store`); the Solid bridge is an implementation
detail behind `IslandContext`.

Reactive markup (`$x`, `$_row.f`, conditionals, `<For>`) is data: the compiler emits the parser's
`ReactiveExpression` objects as JSON literals and the runtime evaluates them with `lib/jsx/reactive`. No author string ever becomes code.

### 4.2 The data plan

`planOf(flow: CompiledDataflow, access: DatasetAccessFacts) → DataPlan`, pure. For each query, in run
order, scope is the most specific of its own reads and its upstream queries' scopes:

| Reads | Scope | Why |
|-------|-------|-----|
| `_tz` (transitively) | `page` | Only the page knows the reader's zone; never served (`served-results.server servable`). |
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

Mutations: `optimistic` when the runtime can apply the write to a held copy (`placeDataflow`);
otherwise `server`. The plan records the target dataset for invalidation.

## 5. Snapshots: keys, freshness, invalidation, revalidation

### 5.1 Key

`SnapshotKey = { artifactId, slot ('head' | 'v:<n>'), planKey, inputsKey }` where `planKey` is a
digest of the `DataPlan` (so a republish that changes a query misses) and `inputsKey` a canonical
digest of the shared-scope input values. The head's default-input snapshot is the one that is
prepared eagerly; other input sets are snapshotted on first read (bounded per artifact; over the bound
the request runs its queries on the cold path).

### 5.2 Freshness — the correctness rule is decided on read

A snapshot stores `marks`: the mark of every dataset in `DataPlan.datasets`, taken BEFORE its queries
ran (`served-results.server marksOf`: `version, edit_id, visibility, link_role, sharing_revision,
policy_revision, live, md5(meta)`), plus the membership revision when the plan reads `_members`. A read
compares the stored marks with the current ones in one query (`MARK_SQL` over the dataset ids); equal
means fresh, otherwise stale. This is the same philosophy as the live stream: NOTIFY is a pointer, the
read is the truth. It catches every way a dataset changes, not only `mutateDataset`: `PUT /api/artifacts/:id`
replacing a dataset, a revert, a fork's copy, a sharing or policy change, a deletion (all of which
move `edit_id`, `version`, `sharing_revision`, `policy_revision` or `live`).

A stale snapshot is still SERVED when it is younger than `SNAPSHOT_MAX_AGE_MS` (minutes-old is the
owner's accepted staleness) and a revalidation is queued; older than that, the request waits for the
revalidation within `SERVED_RESULTS_BUDGET_MS` (250 ms) and otherwise serves declarations without rows.

### 5.3 Eager invalidation — the optimisation

`data_snapshots` carries an indexable `datasets TEXT[]` column. The dataset write path
(`mutateDataset`, after its CAS UPDATE commits and beside its `pg_notify`) calls
`invalidateSnapshots(datasetId)`: `UPDATE data_snapshots SET stale_at = now() WHERE $1 = ANY(datasets)
AND stale_at IS NULL`, then queues revalidation of the affected heads. Exactly the dependent snapshots
are marked, because the plan's dataset list is exactly what its shared queries read. The other write
paths (replace, revert, fork, sharing, policy) are covered by the marks rule; correctness never depends
on the eager call.

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

Open pages learn of it through the live stream: the `data` frame re-runs the reading queries in the
page; no separate frame carries the snapshot's drawings.

## 6. Failure and recompilation

A prepared page stores the compiled result or a recorded compile failure with its recorded build
versions. A read keeps serving that compile across deploys (§3.1 binds it to the live chunks). An edit
changes the document version and compiles again. Only a hand-raised `MIN_PAGE_FORMAT` or
`MIN_HANDOVER_CONTRACT` invalidates an older stored compile automatically; missing compiles compile
inline. `COMPILE_INLINE_BUDGET_MS` records a slow compile; it does not select another renderer.
There is no other renderer: if compilation still fails, `serve.server.ts` answers
`{ mode: 'failed', status: 500 }`, reported on every occurrence (`console.error`,
`compiledPageFailures()`, which must stay at zero); `/raw` returns the 500 and the app page raises
`CompiledPageFailed`. A successful response names `x-mx-reader: compiled`. Access is checked before
either result.

An unported component cannot produce a partial reader page: the compiler covers every registered
component through a Solid island or a static shell. A missing module leaves the served HTML readable
while its interactive parts remain inert; the runtime reports the load failure. A failed viewer overlay
leaves its neutral placeholder and can retry. If a snapshot is missing or stale, the request tries
shared queries within `SERVED_RESULTS_BUDGET_MS` and otherwise serves the declarations for the island
to refresh after paint.

Deliberate backfills use `scripts/compiled-backfill.ts`. Select versions by recorded columns, for
example `--where compiler_version!=<current>`, `--island-build <old>` or `--format-below 3`. Run
`--dry-run` first. The running server recompiles each selected version through its admitted reader
door; a repeated filtered run skips versions that no longer match. The script ends with a database
census. A deploy by itself triggers no backfill. A refreshed external asset is incorporated when its
document is edited into a new version or deliberately backfilled; the existing version stays pinned.

## 7. The app, the editor and the overlays

The page is HTML-first. The server draws the document's frame into the app page
(`lib/serving/document-frame`, `iframe[data-mx-document-frame]`) beside the Solid app shell; the frame
holds the compiled story, which runs on `APP__PAGES_HOST` and never waits for the app. The app
(`web/served-frame.ts` captures the served frame before it mounts) adopts that frame and talks to the
story only through the frame bridge.

1. Adoption without re-render. The frame side finds the island document through `IslandDocument`
   (`lib/islands/handover.ts`): `root` (the story element), `store` (the `DataflowStore` the islands
   run on), `mode`, `setMode('read' | 'edit')`, `dispose()`, `subscribe`. `lib/islands/frame-bridge.ts`
   exposes it to the page, `solid/document/create-framed-story.ts` holds the framed document and
   `solid/pages/Document.tsx` renders chrome around it; the story is never hydrated or re-rendered by the app. The islands keep running and the app's reactions (like,
   follow, comments) keep reading the store.
2. Live versions. A new published version is morphed into the adopted story in place
   (`lib/islands/morph/engine`), preserving unchanged nodes, islands, reader values and the store. The
   app refreshes its comment anchors and selections after the morph.
3. In-place editing. `setMode('edit')` unmounts the islands and the editor
   (`solid/editor/InPlaceEditor.tsx`, with the runtime's `lib/story-runtime/edit/session`) makes the
   same story element editable. Every edit is composed into the source, saved through the save-less
   protocol (`solid/editor/create-live-edits.ts`) and previewed by sending the draft (`EditDraft`,
   `solid/editor/edit-draft.ts`) through the controller to the server compiler. "Done" returns the page to
   reading in place: `setMode('read')` once the page has drawn the saved version.
4. Overlays. Island overlays portal to the trusted UI container (`solid/components/TrustedUi`) the app
   owns, or inside the story root when the story's CSS is present (`kit/trusted-overlay.tsx`); a Solid
   overlay is never nested inside another overlay's tree. One framework-free store is shared by the
   islands and the app; one context per island; refs are read after hydration, not at creation. The
   kit's overlay behaviour has one core, shared with the app's own components: `kit/popper.ts`
   (Radix Popper placement over floating-ui), `kit/popup-dismiss.ts` (document-wide dismissal),
   `kit/dialog-shell.ts` (the modal contract: Escape, Tab wrap, focus restore, scroll lock) and
   `kit/tooltip-core.ts` (hover and focus timing as Radix's provider).
5. Comments and annotations anchor on author ids and `data-mx-ast` paths, which the compiler preserves
   verbatim. The comment layer is the app's (`solid/document/AnnotationLayer.tsx`).

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
- Props are computed by `rawBuildProps` (dangerous URL schemes, handlers and denied attributes
  dropped) and a static element's attributes are written by `static-solid/attrs.ts`, which follows the
  attribute rules the kit was recorded with.
- `$` expressions travel as JSON data and are evaluated at runtime by `lib/jsx/reactive`; row
  substitution goes through `substituteRow` and the runtime's `rowAttrs` re-applies the dangerous-scheme
  filter per row.
- Structure independence is a test (`codegen-safety.ts structureIndependent`): a document compiled
  with benign strings and with hostile strings yields modules with identical ASTs once literals are
  blanked. The compiler's own tests assert it on every kit family.
- CSP: the compiled page emits NO inline script. The per-document module and the shared chunks are
  same-origin files; the data island is `application/json`. `/raw`'s `script-src` drops
  `'unsafe-inline'` for compiled responses (the history prelude lives in the shared runtime), and
  `/a/:id` keeps `APP_CSP`. `services/app/__tests__/raw-document.test.ts` pins the text.
- The module store serves only content-addressed paths it wrote; a request for an unknown hash is a
  404, never a compile.

## 10. Reader selection

Prepared documents compile with the deployed island build. Reader requests use the version's stored
compile across deployments (§3.1). Editing and commenting happen in place on the same page. Every
document response names its path with `x-mx-reader: compiled`. No deployment flag or reader query
parameter selects another runtime.

## 11. Gates and the size targets

- `scripts/gates/gate-kit-and-fonts.mjs`: checks the compiled story's served elements and island hydration in
  its frame; `scripts/gates/gate-editor-path.mjs` the edit handover. `x-mx-reader` confirms the compiled response.
- `scripts/build/size-targets.mjs <lab.json>`: target 1 from `jsBeforeReady` on prose and deck (raw route),
  target 2 from `jsBeforeReady` on kit, dashboard and kitchen (raw route), target 3 from the total
  wire bytes of prose (view route), target 4 from `jsBeforeReady` on prose, deck, kit, dashboard and kitchen
  (view route): the app shell's own script bytes, which never include the framed document's; the raw route is the document's own page, which the app page frames, and
  the view route's ready is the app shell's own; one line per target, `pass`/`fail`/`no data`; `--strict` fails on
  a missed target. `page-speed.yml` runs it on the head result into the job summary with `--strict`;
  that fails the page-speed workflow, which is informational and does not gate `ci.yml`.
- The size lab is deterministic: each cell is the median of 3 unthrottled cold views, and each view reads its
  byte totals only after no request has been in flight for 500 ms (bounded at 8 s), so target 3 counts the lazy
  chunks a reader loads after ready on every run instead of whichever had landed when sampled.
  The comment composer (ProseMirror) loads on first use, not with the document page.
- `jsBeforeReady` joins the page's resource timing (names and `responseEnd`, available at the opaque
  origin even though sizes are not) to the CDP wire bytes per URL; ready is: view → takeover, raw →
  the `mx:ready` event, or DOMContentLoaded when the page has no module script. Unit: wire bytes as the
  lab measures them (the gateway gzips only what the server did not already brotli).
- The codegen-safety harness is a library with its own tests; the compiler's tests use it.

## 12. Assumptions

A1. Solid 1.9 is the stable version used by the kit and runtime. Its measured browser cost is
    budgeted in target 2.
A2. The object store (`lib/object-store`) is the home for per-document module bytes: content-addressed,
    already used for datasets, no schema change. Module URLs are served by a route, not a static mount,
    because the bytes live in the store, not on disk.
A3. `prepared_pages.page` (JSONB) carries the compiled HTML and plan without a size problem (no node
    tree in the payload).
A4. The lab's `bytes.*.gzip` (wire bytes) is the measurement the targets are checked against; brotli
    is what the server emits for dynamic HTML and precompressed assets, gzip only where the gateway
    compressed identity responses.
A5. The dashboard fixture's `Select` (a kit control bound to `$region`) and `DataTable` are islands;
    its `Card`s are static. This is the shape target 2 is checked on.
A6. Membership changes bump `sharing_revision` on the artifact row, so the marks rule covers
    `_members` without a second source.
A7. The `x-mx-reader` header is safe to expose: it names a rendering path, never a version or a viewer.
