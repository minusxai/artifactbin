/**
 * THE COMPILED PAGE — Phase 2's server-side contracts (docs/phase2-architecture.md).
 *
 * Types and constants only. Every module that builds, stores, snapshots or
 * assembles a compiled document version imports its shape from here, and no
 * two of them may agree privately on a second one. Framework-free on purpose:
 * `solid-js` is a dependency of the island build, never of the server's type
 * graph, and the reader runtime is typed against the existing react-free store
 * (lib/story-runtime/store), not against Solid.
 *
 * Owners (one per module; see the parallel plan):
 *   compiler.ts         compilePage            w2-compiler
 *   modules.server.ts   ModuleStore            w1-assembler
 *   reader-mode.ts      compiledReaderForView w4-flip-docs
 *   plan.ts             planOf                 w1-planners
 *   snapshots.server.ts SnapshotStore          w1-snapshots
 *   charts.server.ts    drawn charts           w1-planners
 *   assembler.ts        assembleReaderPage     w1-assembler
 *   links.ts            linkHintsOf            w1-planners
 */
import type { JsxNode } from '@/lib/jsx';
import type { CompiledDataflow, CompiledReads } from '@/lib/story/compiled-dataflow';
import type { Scalar } from '@/lib/story/dataflow';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import type { ReaderChromeInput } from '@/lib/story/reader-chrome';
import type { OutlineEntry } from '@/lib/story-runtime/outline';
import type { ServedResults, StoredMermaidImage, StoryViewer } from '@/lib/story-runtime/contract';
import type { AgentDiscovery } from '@/lib/agent-discovery-tags';

/* ────────────────────────────────────────────────────────────────────────────
 * How a response names its reader path
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every document response names the path that produced it, so the parity gate
 * and the size check read a fact rather than guess from the markup. Never a
 * version, never a viewer.
 */
export const READER_MODE_HEADER = 'x-mx-reader';
/** Present only when a compiled path fell back to legacy for this request; the value is the reason (§6 of the spec). */
export const READER_FALLBACK_HEADER = 'x-mx-reader-fallback';
/**
 * Why a compiled read could not be served as stored (spec §6). While today's renderer exists
 * (serve.server `fallbackPolicy()` = `legacy`) each one serves it for the request. After Wave 4
 * (`compiled-only`, spec §6): a missing compile or one below a compatibility minimum compiles inline,
 * `over-budget` is never an answer (the budget only marks a slow compile), `compile-error` is a
 * reported 500, and `unported` is never reached (every registered component compiles).
 */
export type ReaderFallbackReason = 'not-compiled' | 'compile-error' | 'build-mismatch' | 'unported' | 'over-budget';

/* ────────────────────────────────────────────────────────────────────────────
 * Compile input and output
 * ──────────────────────────────────────────────────────────────────────────── */

/** What the compiler reads: the prepared page's version-owned inputs, nothing per reader. */
export interface CompileInput {
  /** Research probe: render static skeleton content with Solid SSR. Production defaults to React. */
  nodes: JsxNode[];
  colorMode: 'light' | 'dark';
  template: string | null;
  /** Whether the document draws its own navigation chrome (deck rail, outline); false for captures. */
  chrome: boolean;
  glyphs?: GlyphMap;
  /** Server-resolved `ref:` sources (recipes, images), as the interpreter's `resolveRefProps` consumes them. */
  refData: RefDataMap;
  /** The stored compiled dataflow, or null for a document that declares no data. */
  flow: CompiledDataflow | null;
  /**
   * The anonymous reader's admission to the datasets `flow` reads (snapshots.server
   * `anonymousAccessFacts`), so the stored plan is the one snapshots key on. Absent: no dataset is
   * admitted, and every query that reads one plans as `viewer`.
   */
  access?: DatasetAccessFacts;
  /** The compiler build this compile is made with (see `CompilerBuild`). */
  build: string;
  /**
   * The version's own `<Helmet><script>` (prepared page `authorScript`), or null/absent for none. It is
   * carried through to `CompiledPage.authorScript`, and a version with one always gets a browser module
   * (`ISLANDS = []` when it has no island): the page's store and the author's session start in `boot`.
   */
  authorScript?: string | null;
}

/** One island: a subtree that runs in the browser. */
export interface IslandRef {
  /** The hydration key prefix Solid renders the island's root with (`s<i>-`); the runtime finds the root by it. */
  renderId: string;
  /** The island root's AST path (`data-mx-ast`), so comments, edits and the parity gate can name it. */
  path: string;
  /** Kit components the island uses (import graph, size accounting). */
  kit: string[];
  /** Whether the island reads the document's data (a page with none boots without a transport). */
  readsData: boolean;
}

/** The per-document browser module, content-addressed. Null when a version has no islands. */
export interface ModuleRef {
  /** `sha256` of the minified module bytes, hex, 16 chars — the identity the URL and the store key carry. */
  sha: string;
  /** Same-origin URL the page imports (`/islands/d/<sha>.js`); served immutable under `script-src 'self'`. */
  url: string;
  bytes: number;
  /** Shared chunk URLs the module imports (its static closure), for `<link rel="modulepreload">` and byte accounting. */
  imports: string[];
  /**
   * The shared import specifiers the stored bytes name (`@mx/rt`, `@mx/kit/tabs`), UNRESOLVED: the bytes
   * carry no chunk URL. The runtime's URLs are bound at serve time from the live manifest
   * (runtime-binding.ts), so a deploy that changes a shared chunk reaches stored pages without a recompile.
   */
  specifiers?: readonly string[];
}

/** The exact shared assets a stored compile uses (spec §3, §6). */
export interface CompilerBuild {
  /** Digest of the shared island build; recorded separately from `prepared_pages.page_key`. */
  id: string;
  /** The shared build's manifest: import specifier (`@mx/rt`, `@mx/kit/tabs`, `solid-js/web`) → content-addressed URL. */
  manifest: Readonly<Record<string, string>>;
  /** Content-addressed SQLite engine fetched only when the reader runs a page query. */
  sqliteWasm?: string;
  /** Content-addressed server half and its exported namespaces, retained with this build. */
  ssr?: { url: string; exports: Readonly<Record<string, string>> };
  /** Chunk URL → the chunk URLs it statically imports (manifest.json `files`), for a module's preload closure. */
  graph?: Readonly<Record<string, readonly string[]>>;
}

/** Manually raise these only when an older stored page cannot be read or handed over safely. */
export const MIN_PAGE_FORMAT = 3;
/**
 * THE RUNTIME <-> STORED-MODULE CONTRACT. A stored page pins its own compiled output (module bytes with
 * unresolved `@mx/*` specifiers, the SSR module, the story HTML); the shared runtime chunks are resolved
 * from the live manifest on every serve. Any deploy that keeps this contract reaches every stored page
 * with no recompile. Raise it (a stored page is then recompiled lazily on its next read, or selected by
 * `compiled-backfill --where handover_contract<N`) only when the runtime can no longer run modules or
 * story markup compiled under the older number: a changed boot/rt call signature, a removed or renamed
 * specifier, a kit component whose server-rendered markup the browser tree no longer hydrates, or a
 * compiler change whose output an old page cannot take. 2: unresolved specifiers.
 */
export const MIN_HANDOVER_CONTRACT = 2;

/**
 * Everything the compiler produces for one version. Stored beside the prepared
 * page (`PreparedPage.compiled`), served by the assembler, keyed by `build`.
 */
export interface CompiledPage {
  build: string;
  /** Only an offline file pins the build it was exported with (lib/offline); the reader binds the live one. */
  sharedBuild?: CompilerBuild;
  /** App adoption contract; an app that does not know this version leaves navigation as full loads. */
  handoverContract?: number;
  /** Version-owned navigation, decided from the same nodes and template as the legacy reader. */
  outline: readonly OutlineEntry[];
  /** The plan template uses the wider reading wrapper. */
  outlinePlan: boolean;
  /**
   * The story element's inner HTML with every island rendered in its DECLARED
   * state (no rows): static parts final, islands as skeletons. Served only when
   * no snapshot exists; a request with a snapshot renders the islands WITH its
   * rows through `ssr` (spec §2.2). No `<mx-slot>` survives in either.
   */
  html: string;
  islands: IslandRef[];
  /** The browser module (`generate: 'dom'`), or null when the version has no islands. */
  module: ModuleRef | null;
  /** Brotli bytes of this version's inert template resource, for a small-resource reader hint. */
  templateBrBytes?: number | null;
  /**
   * The SERVER module (`generate: 'ssr'`, hydratable) of the same islands, stored
   * like the browser module: `export function render(data: IslandRenderData): string`
   * returns the whole story HTML with the islands rendered from `data` (the
   * prototype's render.mjs). Imported by the serve path, cached per build; the
   * output is cached per (build, snapshot key). Null with `module`.
   *
   * It holds the whole page's HTML (private documents included), so it is stored under an object-store
   * prefix NO route serves (`islands-ssr/<sha>`, lib/compiled-page/bundle.server `createSsrModuleStore`);
   * its `url` is that object key, never a path a browser can fetch.
   */
  ssr: ModuleRef | null;
  /** Framework-free behaviour chunks the page loads (`deck`), as specifiers into the shared manifest. */
  behaviors: string[];
  plan: DataPlan | null;
  links: LinkHints;
  /** Kit components rendered by the Solid kit, by where they render. */
  kit: { skeleton: string[]; islands: string[] };
  /** Legacy reporting field. Solid renders all static components, so this is empty. */
  reactStatic: string[];
  /**
   * Registered components the compile could not place: a non-empty list refuses the compile (fallback).
   * Empty for every stored document since w3-compiler-coverage (a component with no Solid port compiles
   * as a React shell around its children, spec §6); kept as the refusal's door.
   */
  unported: string[];
  /** Components rendered statically whose BEHAVIOUR is not ported yet (`Iframe`, `DeckGL`): served, reported. */
  partial: string[];
  /**
   * The version's author script, or null. DATA, never code of this page: the assembler writes it into
   * the page's JSON data island (`IslandPageData.authorScript`, inert under `script-src 'self'`), and
   * `boot` loads the lazy author host only then, which hands it to the sandboxed `allow-scripts`
   * frame over a MessagePort (lib/story-runtime/author-script). It is never part of a module, so it is
   * never served under `/islands/d/` nor runs in the top-level document. A compile carrying no
   * author-script field (an older one) must not serve a version that has a script (serve.server).
   */
  authorScript: string | null;
}

/**
 * A stored compile that failed: the read never retries the same build in a loop. After Wave 4 a read
 * of one is a reported 500 (spec §6.1); `unported` is no longer produced by the compiler.
 */
export interface CompileFailure {
  build: string;
  error: string;
  reason: Extract<ReaderFallbackReason, 'compile-error' | 'unported'>;
  unported?: string[];
}

/** What `PreparedPage.compiled` holds: a page, a recorded failure, or nothing yet. */
export type StoredCompile = CompiledPage | CompileFailure;
export const isCompileFailure = (stored: StoredCompile): stored is CompileFailure => 'error' in stored;

/** What the SSR module renders the islands from: the declared dataflow plus a snapshot's answers, and the version's drawings. */
export interface IslandRenderData {
  colorMode?: 'light' | 'dark';
  values: Record<string, Scalar>;
  state?: import('@/lib/story/dataflow').DataflowState;
  assetsUrl?: string;
  results: ServedResults | null;
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  /** The snapshot's server-drawn charts, by chart slot id. */
  drawings: Readonly<Record<string, DrawnChart>>;
}

/** `compilePage`'s signature (compiler.ts, w2-compiler). Pure: the same input and build produce the same page. */
export type CompilePage = (input: CompileInput, build: CompilerBuild) => Promise<CompiledPage>;

/**
 * The most a read may spend compiling inline on a build-id miss before it falls back to today's renderer
 * (spec §6). After Wave 4 (spec §6.1) a read always waits for the compile, and this only decides whether
 * the inline compile is logged as slow.
 */
export const COMPILE_INLINE_BUDGET_MS = 300;

/* ────────────────────────────────────────────────────────────────────────────
 * The module store
 * ──────────────────────────────────────────────────────────────────────────── */

/** The route prefix per-document modules and speculation-rule files are served under. */
export const ISLANDS_PATH = '/islands';
export const DOCUMENT_MODULE_PATH = `${ISLANDS_PATH}/d`;
/** `/islands/d/<sha>.js` — the sha is 16 hex chars; anything else is a 404, never a lookup. */
export const DOCUMENT_MODULE_RE = /^[0-9a-f]{16}$/;

/** Content-addressed module bytes (modules.server.ts, w1-assembler), backed by lib/object-store. */
export interface ModuleStore {
  /** Store the bytes; idempotent (the same bytes are the same key). Returns the ref the page imports. */
  put(bytes: Uint8Array, imports: string[], specifiers?: readonly string[]): Promise<ModuleRef>;
  /** The bytes for a sha the store wrote, or null. */
  get(sha: string): Promise<Uint8Array | null>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The data plan
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Where a query's answer may come from (spec §4.2):
 *   shared — in the guest snapshot; the same for every reader.
 *   viewer — depends on who reads (`_me`, a policy-scoped or non-public dataset, person cards);
 *            fetched from the viewer door after paint, never snapshotted.
 *   page   — only the page can answer it (`_tz`); never served.
 */
export type QueryScope = 'shared' | 'viewer' | 'page';

export interface PlannedQuery {
  name: string;
  scope: QueryScope;
  /** The compiled reads (imports by NAME, upstream queries, values, builtins) — the graph the runtime and the invalidator walk. */
  reads: CompiledReads;
  /** Why the scope is what it is, for the compile report and a test's message (`reads _me.id`, `import sales is private`). */
  because: string;
}

export interface PlannedValue {
  name: string;
  default: Scalar;
  /** Whether the value keys a snapshot: a shared query reads it. */
  keysSnapshot: boolean;
}

export interface PlannedMutation {
  name: string;
  /** The dataset artifact it writes, or null for a local table. */
  dataset: string | null;
  /** `optimistic`: applied to a held copy before the server answers; `server`: waits for the server (lib/story/placement). */
  placement: 'optimistic' | 'server';
}

/**
 * The access facts `planOf` needs about the datasets a version reads, decided
 * by the caller with the run's OWN admission for the anonymous principal
 * through THIS document (lib/artifacts tableForRef: `grantsPermitRead` when
 * the dataset carries grants — every dataset does, the default grants read to
 * `*` — else `visibility !== 'private'`). Reads carry no row-level rules today:
 * a read grant is the whole dataset, so "admitted or not" is the whole fact.
 */
export interface DatasetAccessFacts {
  /** By artifact id: whether the anonymous reader is admitted to its rows through this document. */
  datasets: Readonly<Record<string, { anonymousRead: boolean }>>;
}

/** The version's data half, classified. Stored with the compiled page; the snapshot store is keyed by its digest. */
export interface DataPlan {
  queries: PlannedQuery[];
  values: PlannedValue[];
  mutations: PlannedMutation[];
  /** Every artifact the SHARED queries read (imports, Postgres sources, picker sources): the snapshot's dependency set. */
  datasets: string[];
  /** Whether a shared query reads `_members`, so the snapshot's marks must cover the membership. */
  readsMembers: boolean;
  /** Whether any shared query runs inside a connected Postgres (no mark, no NOTIFY): the snapshot is time-bounded (spec §5.3). */
  postgres: boolean;
}

/** `planOf`'s signature (plan.ts, w1-planners). Pure. */
export type PlanOf = (flow: CompiledDataflow, access: DatasetAccessFacts) => DataPlan;

/* ────────────────────────────────────────────────────────────────────────────
 * Snapshots
 * ──────────────────────────────────────────────────────────────────────────── */

export type SnapshotSlot = 'head' | `v:${number}`;

export interface SnapshotKey {
  artifactId: string;
  slot: SnapshotSlot;
  /** Digest of the DataPlan: a republish that changes a query misses. */
  planKey: string;
  /** Canonical digest of the values of every `keysSnapshot` input (defaults, or a request's URL `$` values). */
  inputsKey: string;
}

/** A `<Question>` drawn on the server, keyed by the question's node id (or path when it has none). */
export interface DrawnChart {
  svg: string;
  /** The table it was drawn from and the digest of the rows, so a client re-draw can tell whether it is stale. */
  table: string;
  rows: string;
}

export interface DataSnapshot {
  key: SnapshotKey;
  /** The mark of every dataset in `DataPlan.datasets`, taken BEFORE the run (served-results.server marksOf shape). */
  marks: Readonly<Record<string, string>>;
  /** The membership revision when the plan reads `_members`. */
  membersMark?: string;
  /** The shared queries' answers, as the query route answers them to the anonymous door. */
  results: ServedResults;
  drawings: Readonly<Record<string, DrawnChart>>;
  computedAt: number;
  /** The compiler build the plan came from (a plan digest is per build). */
  build: string;
}

/** A snapshot served while a revalidation runs may be this old (the owner's accepted staleness). */
export const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
/** Non-default input sets snapshotted per artifact before the cold path answers instead (open question Q2). */
export const SNAPSHOT_INPUT_SETS_PER_ARTIFACT = 16;

export interface SnapshotRead {
  snapshot: DataSnapshot;
  /** Marks (datasets and the document) equal to the current ones, and inside SNAPSHOT_MAX_AGE_MS. */
  fresh: boolean;
}

/**
 * The snapshot store (snapshots.server.ts, w1-snapshots; table `app.data_snapshots`).
 * Freshness is decided on READ by comparing marks — the correctness rule; the
 * write hook is an optimisation that lets the head revalidate before anyone asks.
 */
export interface SnapshotStore {
  /** The stored snapshot and whether it is fresh; null when none is stored. Never runs a query. */
  get(key: SnapshotKey): Promise<SnapshotRead | null>;
  put(snapshot: DataSnapshot): Promise<void>;
  /**
   * A dataset was written: mark exactly the snapshots whose plan lists it and
   * queue their revalidation. Returns the keys it marked. Called by the write
   * path after commit, beside its NOTIFY.
   */
  invalidate(datasetId: string): Promise<SnapshotKey[]>;
  /**
   * Re-run the shared queries at this key's inputs with anonymous admission
   * (the same run as `POST /a/:id/query`), draw the charts, store and return
   * the new snapshot; null when the version cannot be snapshotted any more.
   * `recipe` is the plan and input values the key was made from, when the
   * caller holds them (else the store's own record of the key), and the
   * compiler build the plan came from, which the snapshot records (else the
   * build already stored for the key).
   */
  revalidate(key: SnapshotKey, recipe?: { plan: DataPlan; values: Record<string, Scalar>; build?: string }): Promise<DataSnapshot | null>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The viewer overlay (after paint)
 * ──────────────────────────────────────────────────────────────────────────── */

/** `GET /a/:id/viewer?<$values>` — what only this reader decides, answered with the query door's admission (w3-viewer-writes). */
export interface ViewerOverlay {
  viewer: StoryViewer | null;
  /** The `viewer`-scope queries' answers for this reader at these values. */
  results: ServedResults;
  /** The imports this reader may hold in full (StoryIslandDataflow.hold). */
  hold: string[];
}
export const VIEWER_OVERLAY_PATH = (id: string): string => `/a/${id}/viewer`;
/** The cookie-free hint the server sets at login so a guest page never fetches the overlay and a signed-in one shows placeholders, not guest content. */
export const SIGNED_IN_HINT_ATTR = 'data-mx-signed-in';

/* ────────────────────────────────────────────────────────────────────────────
 * Link hints
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LinkHints {
  /** Same-deployment artifact URLs to prefetch (a speculation-rules `prefetch` list, `eagerness: moderate` — hover/press intent, never on load), in document order, deduplicated. */
  prefetch: string[];
  /** The first few to prerender (speculation rules, `eagerness: moderate`); never a private document. */
  prerender: string[];
}
export const EMPTY_LINK_HINTS: LinkHints = { prefetch: [], prerender: [] };
export const PRERENDER_LIMIT = 3;
/** `linkHintsOf`'s signature (links.ts, w1-planners). Pure over the nodes and the deployment's origins. */
export type LinkHintsOf = (nodes: JsxNode[], deployment: { origins: readonly string[] }) => LinkHints;

/* ────────────────────────────────────────────────────────────────────────────
 * The reader page assembler
 * ──────────────────────────────────────────────────────────────────────────── */

/** What one request decides, over the stored version. */
export interface AssembleOverlay {
  /** The reader's URL `$` values (lib/story/url-values), already parsed against the flow. */
  values: Record<string, Scalar>;
  state?: import('@/lib/story/dataflow').DataflowState;
  /** The version's stored Mermaid drawings for this surface (lib/mermaid-images), or none. */
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  /** Whether the request carries a session: the signed-in hint, never the identity (that arrives after paint). */
  signedIn: boolean;
  /** Where the page queries, writes and fetches its overlay (lib/story/markup-csp paths); absent on a capture. */
  doors: { queryUrl: string; mutateUrl?: string; viewerUrl?: string; assetsUrl: string } | null;
  /** A capture's verified image import door, even though it has no query or mutation door. */
  assetsUrl?: string;
  /**
   * The managed `<Iframe>`'s asset door for this request (islands contract `IslandPageData.managedAssets`):
   * beside `doors` because a capture has no doors and still resolves its frames' assets with its key.
   * Absent or null without an asset origin.
   */
  managedAssets?: { origin: string; resolveUrl: string } | null;
  /** An archived version's read-only reason (lib/archived-version); absent for the head. */
  readOnly?: string | null;
  /** The imports the page may hold for the door it queries through (IslandPageData.hold); absent: none. */
  hold?: string[];
  /** The page's SQLite engine wasm (IslandPageData.sqliteWasm), when `hold` is not empty. */
  sqliteWasm?: string | null;
}

export interface AssembleInput {
  compiled: CompiledPage;
  /** False for captures that intentionally omit the document's own navigation. */
  documentChrome?: boolean;
  /**
   * The story HTML for THIS request: `compiled.html` when no snapshot exists,
   * else the SSR module's render with the snapshot's rows (serve.server.ts,
   * cached per build + snapshot key). The assembler never renders islands.
   */
  story: string;
  /** Section navigation discovered from the prepared source; empty for captures, decks and dashboards. */
  outline?: readonly OutlineEntry[];
  /** An export capture uses the full image variant and no responsive srcset. */
  capture?: boolean;
  /** The version's isolated stylesheet and font preloads, from the prepared page. */
  css: string;
  fontPreloads: readonly string[];
  title: string;
  theme: string | null;
  colorMode: 'light' | 'dark';
  /** The guest snapshot for these inputs, or null (the cold path ran inside its budget, or nothing is servable). */
  snapshot: DataSnapshot | null;
  overlay: AssembleOverlay;
  /** Reader chrome to render on the server (`/a/:id`, a domain post); null for `/raw`, captures, the offline file. */
  chrome: ReaderChromeInput | null;
  /**
   * Load the React app on idle (or first chrome interaction) and hand it the
   * island document (§7): the SPA's entry and the chunks to `modulepreload`
   * (server/reader-preloads). Null for `/raw` and every path without the SPA.
   */
  spa: { entry: string; preload: readonly string[] } | null;
  /** Where the shared chunks are (the manifest), so the assembler emits `modulepreload`s and the boot import. */
  build: CompilerBuild;
  /**
   * Document head metadata the page carries today: description, canonical link,
   * social (Open Graph / Twitter) card and the agent-discovery head and tail.
   * Null where a path emits none (captures, the offline file).
   */
  head: AssembleHead | null;
  /**
   * The document's live identity, written on `<body>` as `data-mx-live-id` / `data-mx-live-edit`: the
   * island runtime holds the document's live stream only when both are present. Null or absent on a
   * capture, an archived version and the offline file.
   */
  live?: { id: string; editId: string } | null;
  /**
   * A line of page furniture after the story root (and after the chrome), never inside it: a domain
   * post's attribution back to the app. Its CSS joins the head's styles.
   */
  footer?: { html: string; css: string } | null;
  /**
   * A document served BY ITSELF (`/raw`, a domain post, a capture) carries today's standalone
   * document's stylesheets, byte for byte (lib/story/document-styles), in place of `css`: the story is
   * the page, and Mermaid reads `--font-mono`'s text into the palette that names a stored drawing.
   */
  sheets?: ReadonlyArray<{ attr: string; css: string }> | null;
}

/** The head metadata of an assembled page (see AssembleInput.head). */
export interface AssembleHead {
  description?: string | null;
  canonical?: string | null;
  social?: { title: string; description?: string | null; image: string } | null;
  help?: AgentDiscovery | null;
}

/** The assembled page and the response headers that belong to it. */
export interface AssembledPage {
  html: string;
  /**
   * `Speculation-Rules: "<url>"` when the page prerenders links: Chrome loads
   * EXTERNAL rules only through this header (an inline `<script
   * type="speculationrules">` would need `'inline-speculation-rules'` in the
   * CSP, which stays `script-src 'self'`). The route sets it verbatim.
   */
  headers: Readonly<Record<string, string>>;
}
/** `assembleReaderPage`'s signature (assembler.ts, w1-assembler): ONE function for every reader path. */
export type AssembleReaderPage = (input: AssembleInput) => AssembledPage;
export const SPECULATION_RULES_HEADER = 'Speculation-Rules';

/** The element ids and attributes the assembled page and the runtime agree on. */
export const ISLAND_DATA_ID = 'mx-story-data';
/**
 * A `<Question>` island's inner drawing box in the compiled HTML, by the question's
 * node id (or path) — the ASSEMBLER's handle only: it puts the snapshot's SVG
 * inside the box and marks it `data-mx-chart-state="ready"`. The island removes
 * the attribute when it mounts (the served DOM then matches today's), and
 * re-draws only when its table changes or the reader interacts (Vega loads then).
 */
export const CHART_SLOT_ATTR = 'data-mx-chart-slot';
/** A chart slot's drawing state, set by the assembler and updated by the island runtime (`drawn`, `pending`, `live`). */
export const CHART_STATE_ATTR = 'data-mx-chart-state';
/** The idle loader's marker on the SPA's script tag, so gates can tell the HTML-first page from today's. */
export const SPA_IDLE_ATTR = 'data-mx-spa-idle';
/** Set on `<html>` when every island has hydrated (or at DOMContentLoaded on a page with no module): the lab's ready marker. */
export const READER_READY_ATTR = 'data-mx-ready';
