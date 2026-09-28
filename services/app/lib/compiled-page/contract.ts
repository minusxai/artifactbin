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
 *   compiler.ts         compilePage            T1
 *   modules.server.ts   ModuleStore            T1
 *   reader-mode.ts      readerModeFor          T0 (landed)
 *   plan.ts             planOf                 T4
 *   snapshots.server.ts SnapshotStore          T4
 *   charts.server.ts    drawn charts           T4
 *   assembler.ts        assembleReaderPage     T2
 *   links.ts            linkHintsOf            T6
 */
import type { JsxNode } from '@/lib/jsx';
import type { CompiledDataflow, CompiledReads } from '@/lib/story/compiled-dataflow';
import type { Scalar } from '@/lib/story/dataflow';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import type { ReaderChromeInput } from '@/lib/story/reader-chrome';
import type { ServedResults, StoredMermaidImage, StoryViewer } from '@/lib/story-runtime/contract';

/* ────────────────────────────────────────────────────────────────────────────
 * The reader mode switch and how a response names its path
 * ──────────────────────────────────────────────────────────────────────────── */

/** `FLAG__COMPILED_READER` (lib/config COMPILED_READER). */
export type CompiledReaderFlag = 'off' | 'shadow' | 'on';
export const COMPILED_READER_FLAGS: readonly CompiledReaderFlag[] = ['off', 'shadow', 'on'];

/** Which renderer answers one request. */
export type ReaderMode = 'compiled' | 'legacy';

/** The query parameter a request may carry (`?reader=compiled|legacy`), honoured only when the flag is not `off`. */
export const READER_MODE_PARAM = 'reader';

/**
 * Every document response names the path that produced it, so the parity gate
 * and the size check read a fact rather than guess from the markup. Never a
 * version, never a viewer.
 */
export const READER_MODE_HEADER = 'x-mx-reader';
/** Present only when a compiled path fell back to legacy for this request; the value is the reason (§6 of the spec). */
export const READER_FALLBACK_HEADER = 'x-mx-reader-fallback';
export type ReaderFallbackReason = 'not-compiled' | 'compile-error' | 'build-mismatch' | 'unported' | 'over-budget';

/* ────────────────────────────────────────────────────────────────────────────
 * Compile input and output
 * ──────────────────────────────────────────────────────────────────────────── */

/** What the compiler reads: the prepared page's version-owned inputs, nothing per reader. */
export interface CompileInput {
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
  /** The compiler build this compile is made with (see `CompilerBuild`). */
  build: string;
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
}

/** The compiler's identity: what a stored compile is keyed by (spec §3, §6). */
export interface CompilerBuild {
  /** Digest of the compiler bundle, the shared island manifest and the kit sources; joins `prepared_pages.page_key`. */
  id: string;
  /** The shared build's manifest: import specifier (`@mx/rt`, `@mx/kit/tabs`, `solid-js/web`) → content-addressed URL. */
  manifest: Readonly<Record<string, string>>;
}

/**
 * Everything the compiler produces for one version. Stored beside the prepared
 * page (`PreparedPage.compiled`), served by the assembler, keyed by `build`.
 */
export interface CompiledPage {
  build: string;
  /** The story element's inner HTML: static parts, and each island's server render spliced in at its slot. No `<mx-slot>` survives. */
  html: string;
  islands: IslandRef[];
  module: ModuleRef | null;
  /** Framework-free behaviour chunks the page loads (`deck`), as specifiers into the shared manifest. */
  behaviors: string[];
  plan: DataPlan | null;
  links: LinkHints;
  /** Kit components rendered by the Solid kit, by where they render. */
  kit: { skeleton: string[]; islands: string[] };
  /** Static components rendered by today's React kit at compile time (they ship no code). */
  reactStatic: string[];
  /** Registered components with no Solid port that the version needs interactive: a non-empty list refuses the compile (fallback). */
  unported: string[];
  /** Components rendered statically whose BEHAVIOUR is not ported yet (`Iframe`, `DeckGL`): served, reported. */
  partial: string[];
}

/** A stored compile that failed: the read never retries the same build in a loop. */
export interface CompileFailure {
  build: string;
  error: string;
  reason: Extract<ReaderFallbackReason, 'compile-error' | 'unported'>;
  unported?: string[];
}

/** What `PreparedPage.compiled` holds: a page, a recorded failure, or nothing yet. */
export type StoredCompile = CompiledPage | CompileFailure;
export const isCompileFailure = (stored: StoredCompile): stored is CompileFailure => 'error' in stored;

/** `compilePage`'s signature (compiler.ts, T1). Pure: the same input and build produce the same page. */
export type CompilePage = (input: CompileInput, build: CompilerBuild) => Promise<CompiledPage>;

/** The most a read may spend compiling inline on a build-id miss before it falls back to today's renderer (spec §6). */
export const COMPILE_INLINE_BUDGET_MS = 300;

/* ────────────────────────────────────────────────────────────────────────────
 * The module store
 * ──────────────────────────────────────────────────────────────────────────── */

/** The route prefix per-document modules and speculation-rule files are served under. */
export const ISLANDS_PATH = '/islands';
export const DOCUMENT_MODULE_PATH = `${ISLANDS_PATH}/d`;
/** `/islands/d/<sha>.js` — the sha is 16 hex chars; anything else is a 404, never a lookup. */
export const DOCUMENT_MODULE_RE = /^[0-9a-f]{16}$/;

/** Content-addressed module bytes (modules.server.ts, T1), backed by lib/object-store. */
export interface ModuleStore {
  /** Store the bytes; idempotent (the same bytes are the same key). Returns the ref the page imports. */
  put(bytes: Uint8Array, imports: string[]): Promise<ModuleRef>;
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

/** `planOf`'s signature (plan.ts, T4). Pure. */
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
  /** Marks equal to the current ones, and inside the age bound for a Postgres plan. */
  fresh: boolean;
}

/**
 * The snapshot store (snapshots.server.ts, T4; table `app.data_snapshots`).
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
   */
  revalidate(key: SnapshotKey): Promise<DataSnapshot | null>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The viewer overlay (after paint)
 * ──────────────────────────────────────────────────────────────────────────── */

/** `GET /a/:id/viewer?<$values>` — what only this reader decides, answered with the query door's admission (T5). */
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
  /** Same-deployment artifact URLs to prefetch (`<link rel="prefetch" as="document">`), in document order, deduplicated. */
  prefetch: string[];
  /** The first few to prerender (speculation rules, `eagerness: moderate`); never a private document. */
  prerender: string[];
}
export const EMPTY_LINK_HINTS: LinkHints = { prefetch: [], prerender: [] };
export const PRERENDER_LIMIT = 3;
/** `linkHintsOf`'s signature (links.ts, T6). Pure over the nodes and the deployment's origins. */
export type LinkHintsOf = (nodes: JsxNode[], deployment: { origins: readonly string[] }) => LinkHints;

/* ────────────────────────────────────────────────────────────────────────────
 * The reader page assembler
 * ──────────────────────────────────────────────────────────────────────────── */

/** What one request decides, over the stored version. */
export interface AssembleOverlay {
  /** The reader's URL `$` values (lib/story/url-values), already parsed against the flow. */
  values: Record<string, Scalar>;
  /** The version's stored Mermaid drawings for this surface (lib/mermaid-images), or none. */
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  /** Whether the request carries a session: the signed-in hint, never the identity (that arrives after paint). */
  signedIn: boolean;
  /** Where the page queries, writes and fetches its overlay (lib/story/markup-csp paths); absent on a capture. */
  doors: { queryUrl: string; mutateUrl?: string; viewerUrl?: string; assetsUrl: string } | null;
  /** An archived version's read-only reason (lib/archived-version); absent for the head. */
  readOnly?: string | null;
}

export interface AssembleInput {
  compiled: CompiledPage;
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
  /** Load the React app on idle and hand it the island document (§7); false for `/raw` and every path without the SPA. */
  spa: boolean;
  /** Where the shared chunks are (the manifest), so the assembler emits `modulepreload`s and the boot import. */
  build: CompilerBuild;
}

/** `assembleReaderPage`'s signature (assembler.ts, T2): ONE function for every reader path. */
export type AssembleReaderPage = (input: AssembleInput) => string;

/** The element ids and attributes the assembled page and the runtime agree on. */
export const ISLAND_DATA_ID = 'mx-story-data';
/** Set on `<html>` when every island has hydrated (or at DOMContentLoaded on a page with no module): the lab's ready marker. */
export const READER_READY_ATTR = 'data-mx-ready';
