/**
 * THE ISLAND RUNTIME — Phase 2's browser-side contracts (docs/phase2-architecture.md §4, §7).
 *
 * Types and constants only, browser-safe and framework-free: an island is
 * typed against the existing framework-free document store (lib/story-runtime/store),
 * and the Solid bridge that feeds it is an implementation detail of rt.ts.
 * The SPA (Solid) and the islands (Solid) share ONE store and ONE document
 * element; this file is where they agree on the handle.
 *
 * Owners: rt.ts / boot.ts (w2-runtime), kit/* (w2-kit-*), viewer + writes (w3-viewer-writes), handover (w3-handover).
 */
import type { Scalar, TableResult } from '@/lib/story/data/dataflow';
import type { MutationRequest } from '@/lib/story/datasets/mutation-request';
import type { DataflowStore, MutationAnswer } from '@/lib/story-runtime/store';
import type { ServedResults, StoredMermaidImage, StoryViewer } from '@/lib/story-runtime/contract';
import type { ColumnType, PersonCard } from '@artifactbin/contracts';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

/* ────────────────────────────────────────────────────────────────────────────
 * What an island receives
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The document's data as one island reads it. Every accessor is reactive
 * inside an island (the bridge tracks reads), and plain outside one.
 */
interface IslandData {
  /** Every declared scalar at its current value. */
  values(): Readonly<Record<string, Scalar>>;
  value(name: string): Scalar | undefined;
  /** One query's result, tracked per cell: a row that changed re-runs only what read it. */
  table(name: string): TableResult | undefined;
  /** The whole result object, replaced when a run lands — what a chart binds to. */
  tableSnapshot(name: string): TableResult | undefined;
  pending(name: string): boolean;
  error(name: string): string | undefined;
  /** People the store resolved (for `<User>`, user columns). */
  people(): Readonly<Record<string, PersonCard>>;
}

interface IslandWrites {
  /** Set a declared scalar; a continuous control (typing, a slider) passes `debounce` and waits for the store's pause. */
  setValue(name: string, value: Scalar, options?: { debounce?: boolean }): void;
  /** Run a declared `<Mutation>`. Optimistic when the plan allows; the status feed reports saving/saved/failed. */
  mutate(request: MutationRequest): Promise<MutationAnswer>;
  /** Why writes are refused on this render (an archived version, a capture), or null. */
  writesUnavailable(): string | null;
  /**
   * Why THIS `<Mutation>` cannot be made by this reader now (the store's write check: a guest's `$_me`
   * write, a closed dataset, `ACCESS_PENDING` while the check is in flight, and on the server), or null.
   * Reactive: re-read whenever the store changes.
   */
  mutationUnavailable(name: string): string | null;
  /** Whether a write of this `<Mutation>` is in flight (the store's `mutating()`). Reactive. */
  mutating(name: string): boolean;
}

/**
 * Who reads. Before the overlay lands: `null` for a guest, `{ hinted: true }`
 * on a signed-in page (the server's hint), so a viewer-scope island draws a
 * neutral placeholder instead of guest content. After: the identity.
 */
export type IslandViewer = StoryViewer | { hinted: true } | null;

/** What every island receives (rt.ts). One per document, shared by every island in it. */
export interface IslandContext extends IslandData, IslandWrites {
  /** This document's image import door, including a verified capture key when present. */
  assetsUrl(): string | null;
  viewer(): IslandViewer;
  /** The version's stored Mermaid drawings, keyed by `mermaidImageKey(code, mode)`. */
  drawings(): Readonly<Record<string, StoredMermaidImage>>;
  /** A declared scalar's type (what a control coerces its string to), or undefined when `name` declares none. */
  valueType(name: string): ColumnType | undefined;
  /** Whether a bound control may offer "All": the Value's declared default is null, or the page declares nothing. */
  nullable(name: string): boolean;
  /** Whether the document declares any query (a document without one never re-renders on its results). */
  declaresQueries(): boolean;
  writes: WriteStatusFeed;
  /**
   * The underlying store — for the SPA, the public `mx` API and the author script, and for kit islands
   * that need mutation-level handles (paging, cell writes). Islands read declarations through the
   * accessors above.
   * @internal
   */
  store(): DataflowStore | null;
  /**
   * Where an island's overlay (Dialog, Popover, Tooltip content) portals: the first-party trusted
   * UI container when the page has one — the same destination the app's
   * overlays use — else null. With null, Dialog and Popover content render in place; Tooltip content
   * portals to `document.body`, as the former story tooltip does.
   * Read when the overlay opens.
   */
  trustedPortal(): HTMLElement | null;
  /** The lazy chart module (lib/islands/chart): Vega and lib/viz load on the first call, once per page. */
  loadChart(): Promise<IslandChartModule>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Charts drawn in the browser (a `<Question>` whose table changed, or on interaction)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface IslandChartInput {
  /** The chart box (the island's `data-mx-chart-slot` element); its server drawing is replaced once the view renders. */
  element: HTMLElement;
  envelope: VizEnvelope;
  rows: TableResult['rows'];
}

export interface IslandChart {
  /** New rows for the same spec: re-fed without a rebuild. */
  update?(rows: TableResult['rows']): void;
  destroy(): void;
}

export interface IslandChartModule {
  mountChart(input: IslandChartInput): IslandChart;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Optimistic writes and the status indicator
 * ──────────────────────────────────────────────────────────────────────────── */

export type WriteState = 'saving' | 'saved' | 'failed';

export interface WriteStatus {
  /** The store's write id (dataflow-core `write` event). */
  id: number;
  mutation: string;
  state: WriteState;
  startedAt: number;
  /** Successful notifying run; stays discoverable until the reader dismisses it. */
  mutationRunId?: string;
  /** When `failed`: the server's reason and a way to try the same write again. A refused change stays visible and marked. */
  error?: { message: string; code?: string; retry(): void };
}

/** The indicator's source: every write in flight or recently settled, newest last. */
export interface WriteStatusFeed {
  current(): readonly WriteStatus[];
  subscribe(listener: (statuses: readonly WriteStatus[]) => void): () => void;
  /** The reader puts a failed status or a saved notifying run away without retrying it. */
  dismiss(id: number): void;
}

/** How long a `saved` status stays in the feed before it is dropped. */
export const SAVED_STATUS_TTL_MS = 2000;

/* ────────────────────────────────────────────────────────────────────────────
 * The SPA's handover (docs §7)
 * ──────────────────────────────────────────────────────────────────────────── */

export type IslandDocumentMode = 'read' | 'edit';

/**
 * The live island document, as the Solid app adopts it WITHOUT re-rendering:
 * the app moves `root` into its tree and renders chrome around it; the islands
 * keep running on the same store. `setMode('edit')` pauses every island (it keeps
 * its DOM and state; a bound control moves no value) and the in-place editor makes the same element editable.
 */
export interface IslandDocument {
  /** The story element (`[data-mx-inline-story]`), server-rendered, hydrated in place. */
  readonly root: HTMLElement;
  readonly store: DataflowStore | null;
  readonly context: IslandContext;
  mode(): IslandDocumentMode;
  /**
   * `edit` pauses the islands: they stay mounted, their DOM and state kept (the editor's drafts keep what they do
   * not change), and no bound control moves a value; the live stream, the public API, the author script and the
   * link's URL sync stop. `read` returns
   * to reading in place once the page has drawn the saved version on this context: the live stream, the public
   * API and the author script resume.
   */
  setMode(mode: IslandDocumentMode): void;
  /** Every island hydrated, or the page has none. */
  ready(): boolean;
  subscribe(listener: (event: IslandEvent) => void): () => void;
  /** Tear everything down (navigation away). */
  dispose(): void;
}

export type IslandEvent =
  | { type: 'ready' }
  | { type: 'mode'; mode: IslandDocumentMode }
  | { type: 'overlay'; viewer: StoryViewer | null }
  | { type: 'writes'; statuses: readonly WriteStatus[] };

/**
 * Where the SPA finds the document: a property on the story root, never on
 * `window` (the author's script shares no realm with the page, but a global is
 * still a wider door than the element the app already holds).
 */
export const ISLAND_DOCUMENT_KEY = '__mxIslands';
export type IslandHost = HTMLElement & { [ISLAND_DOCUMENT_KEY]?: IslandDocument };

/* ────────────────────────────────────────────────────────────────────────────
 * The page protocol: names the served HTML, stored pages and every reader chunk agree on
 * ──────────────────────────────────────────────────────────────────────────── */

/** The story element the islands live in (the assembler's `inlineStoryElement`). */
export const STORY_ROOT_SELECTOR = '[data-mx-inline-story]';
/** The document's live identity on `<body>` (lib/story/document's convention, read as anchor-entry reads it). */
export const LIVE_ID_ATTR = 'data-mx-live-id';
/** The version the page shows, on `<body>` beside `LIVE_ID_ATTR`. */
export const LIVE_EDIT_ATTR = 'data-mx-live-edit';
/** On `<body>` beside the live identity: the page is a document on its own origin, so it holds its own stream even when framed. */
export const LIVE_DIRECT_ATTR = 'data-mx-live-direct';
/** On the app page's story element when it holds the document's frame rather than the document (AssembleInput.frame). */
export const STORY_FRAMED_ATTR = 'data-mx-framed';
/** A compiler-generated hydration key prefix (`s<i>-`, `d-`); anything else never reaches a selector. Stateless: no `g`/`y` flag. */
export const RENDER_ID_PATTERN = /^[\w-]+$/;

/** Fired on `document` once every island has hydrated (the same event the former runtime fires after hydration). */
export const ISLANDS_READY_EVENT = 'mx:ready';

/* ────────────────────────────────────────────────────────────────────────────
 * The kit's DOM conventions (w2-kit-*): what the parity gate compares against
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every vendored interactive component renders the DOM the former Radix-based kit
 * renders: the same elements, roles, `data-state`/`data-orientation` attributes,
 * `aria-*` idrefs (generated ids may differ, their RESOLUTION may not), author
 * ids and `data-mx-ast` paths verbatim, closed content rendered (hidden), never
 * omitted. The families, one module each under lib/islands/kit/:
 */
export const KIT_FAMILIES = ['basic', 'tabs', 'accordion', 'dialog', 'disclosure', 'controls', 'upload', 'data', 'files', 'people', 'mermaid', 'embed', 'cells', 'static'] as const;
export type KitFamily = (typeof KIT_FAMILIES)[number];

/**
 * WHAT AN AUTHOR SCRIPT MAY IMPORT FROM SOLID: each specifier is an entry of the island build
 * (lib/islands/vendor/*, scripts/build/build-islands.mjs), the SAME Solid the kit runs on, and exports exactly
 * these names (the build refuses a vendor chunk whose exports differ). Curated, not `export *`: esbuild splits by
 * file, so every Solid export a vendor entry keeps alive lands in the shared chunk every interactive page loads
 * (measured: `Portal` and `Dynamic` ~600 B brotli, `produce`/`unwrap` ~120 B, context, `Index`, `createUniqueId`
 * and `createRenderEffect` ~150 B, so they are left out and rt+boot and the kit closure keep their budgets). The
 * web list covers every helper Solid's JSX transform emits for `generate: 'dom'` without hydration; the publish
 * build (lib/story/document/author-module.server) refuses an import of any other name.
 */
export const AUTHOR_VENDOR_EXPORTS = {
  'solid-js': ['For', 'Match', 'Show', 'Switch', 'batch', 'createEffect', 'createMemo', 'createRoot', 'createSignal', 'mergeProps', 'on', 'onCleanup', 'onMount', 'splitProps', 'untrack'],
  'solid-js/web': ['addEventListener', 'classList', 'className', 'createComponent', 'delegateEvents', 'effect', 'insert', 'memo', 'mergeProps', 'render', 'setAttribute', 'setAttributeNS', 'setBoolAttribute', 'setProperty', 'setStyleProperty', 'spread', 'style', 'template', 'use'],
  'solid-js/store': ['createStore', 'reconcile'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The page's data island (`<script type="application/json">`, written by the
 * assembler, read by the island runtime's boot): everything a reader's islands
 * start from before any request.
 */
export interface IslandPageData {
  values: Record<string, Scalar>;
  /** Brotli bytes of the pinned DOM factory resource; absent for older compiles. */
  templateBrBytes?: number | null;
  /** A prepared version that cannot run carries its query errors into the reader. */
  state?: import('@/lib/story/data/dataflow').DataflowState;
  results: ServedResults | null;
  queryUrl?: string;
  mutateUrl?: string;
  viewerUrl?: string;
  /**
   * The page is a document on its OWN origin (APP__PAGES_HOST), framed by the app page or not: its doors
   * are absolute, it calls them directly with its pages cookie (`credentials: 'include'`), and it holds
   * its own live stream even when framed.
   */
  direct?: boolean;
  assetsUrl?: string;
  /**
   * The request holds a credential for this document (session or held connection): the page's doors
   * carry it, and viewer-dependent islands show a neutral placeholder rather than guest content until
   * the viewer overlay names the reader. A non-secret hint, never the identity.
   */
  signedIn: boolean;
  /**
   * The imports this page may hold in full (lib/artifacts holdableImports, for the door the page queries
   * through), by name: what its own SQLite engine answers once loaded (lib/story/data/placement). Empty: the
   * page runs nothing itself.
   */
  hold: string[];
  /** The SQLite engine's wasm, content-addressed (StoryIslandData.sqliteWasm); present only when `hold` is not empty. */
  sqliteWasm?: string;
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  readOnly: string | null;
  /**
   * The version's author script (CompiledPage.authorScript), present only when it has one: `boot`
   * then loads the page runtime (`vendor['@mx/page-runtime']`), which runs it as a module of this
   * document against this page's store.
   */
  authorScript?: string | null;
  /**
   * The script's bare imports → this build's chunks (`solid-js`, `solid-js/web`, `solid-js/store`, AUTHOR_VENDOR_EXPORTS,
   * and `@mx/page-runtime` itself), present with `authorScript` or a declared dataflow: the runtime resolves the
   * module's imports against the serving build, so the script, the runtime and the kit share one Solid, and boot
   * loads the same runtime for `window.page`.
   */
  vendor?: Readonly<Record<string, string>>;
}
