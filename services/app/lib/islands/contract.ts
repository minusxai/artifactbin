/**
 * THE ISLAND RUNTIME — Phase 2's browser-side contracts (docs/phase2-architecture.md §4, §7).
 *
 * Types and constants only, browser-safe and framework-free: an island is
 * typed against the existing react-free document store (lib/story-runtime/store),
 * and the Solid bridge that feeds it is an implementation detail of rt.ts.
 * The SPA (React) and the islands (Solid) share ONE store and ONE document
 * element; this file is where they agree on the handle.
 *
 * Owners: rt.ts / boot.ts (w2-runtime), kit/* (w2-kit-*), viewer + writes (w3-viewer-writes), handover (w3-handover).
 */
import type { Scalar, TableResult } from '@/lib/story/dataflow';
import type { MutationRequest } from '@/lib/story/mutation-request';
import type { DataflowStore, MutationAnswer } from '@/lib/story-runtime/store';
import type { ServedResults, StoredMermaidImage, StoryViewer } from '@/lib/story-runtime/contract';
import type { PersonCard } from '@artifactbin/contracts';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

/* ────────────────────────────────────────────────────────────────────────────
 * What an island receives
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The document's data as one island reads it. Every accessor is reactive
 * inside an island (the bridge tracks reads), and plain outside one.
 */
export interface IslandData {
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

export interface IslandWrites {
  /** Set a declared scalar; a continuous control passes `debounce`. */
  setValue(name: string, value: Scalar, options?: { debounce?: number }): void;
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
  viewer(): IslandViewer;
  /** The version's stored Mermaid drawings, keyed by `mermaidImageKey(code, mode)`. */
  drawings(): Readonly<Record<string, StoredMermaidImage>>;
  writes: WriteStatusFeed;
  /** The underlying store — for the SPA and the author script; islands read through the accessors above. */
  store(): DataflowStore | null;
  /**
   * Where an island's overlay (Dialog, Popover, Tooltip content) portals: the first-party trusted
   * UI container (components/TrustedUi) when the page has one — the same destination today's React
   * kit uses — else null. With null, Dialog and Popover content render in place; Tooltip content
   * portals to `document.body`, as today's story tooltip (components/Tooltip, Radix's Portal) does.
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
  /** When `failed`: the server's reason and a way to try the same write again. A refused change stays visible and marked. */
  error?: { message: string; code?: string; retry(): void };
}

/** The indicator's source: every write in flight or recently settled, newest last. */
export interface WriteStatusFeed {
  current(): readonly WriteStatus[];
  subscribe(listener: (statuses: readonly WriteStatus[]) => void): () => void;
  /** The reader puts a `failed` status away without retrying it; a status in any other state is left alone. */
  dismiss(id: number): void;
}

/** How long a `saved` status stays in the feed before it is dropped. */
export const SAVED_STATUS_TTL_MS = 2000;
/** The indicator's element attribute, for gates and the SPA to find it. */
export const WRITE_STATUS_ATTR = 'data-mx-write-status';

/* ────────────────────────────────────────────────────────────────────────────
 * The SPA's handover (docs §7)
 * ──────────────────────────────────────────────────────────────────────────── */

export type IslandDocumentMode = 'read' | 'edit';

/**
 * The live island document, as the React app adopts it WITHOUT re-rendering:
 * the app moves `root` into its tree and renders chrome around it; the islands
 * keep running on the same store. `setMode('edit')` disposes every island and
 * the editor mounts today's interpreter over the source in the same element.
 */
export interface IslandDocument {
  /** The story element (`[data-mx-inline-story]`), server-rendered, hydrated in place. */
  readonly root: HTMLElement;
  readonly store: DataflowStore | null;
  readonly context: IslandContext;
  mode(): IslandDocumentMode;
  /** `edit` unmounts the islands (their roots stay as static DOM until the editor replaces them); `read` is not re-entered in place. */
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

/** Fired on `document` once every island has hydrated (the same event today's runtime fires after hydration). */
export const ISLANDS_READY_EVENT = 'mx:ready';

/* ────────────────────────────────────────────────────────────────────────────
 * The kit's DOM conventions (w2-kit-*): what the parity gate compares against
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every vendored interactive component renders the DOM today's Radix-based kit
 * renders: the same elements, roles, `data-state`/`data-orientation` attributes,
 * `aria-*` idrefs (generated ids may differ, their RESOLUTION may not), author
 * ids and `data-mx-ast` paths verbatim, closed content rendered (hidden), never
 * omitted. The families, one module each under lib/islands/kit/:
 */
export const KIT_FAMILIES = ['basic', 'tabs', 'accordion', 'dialog', 'disclosure', 'controls', 'data', 'files', 'people', 'mermaid', 'embed', 'cells'] as const;
export type KitFamily = (typeof KIT_FAMILIES)[number];

/**
 * The page's data island (`<script type="application/json">`, written by the
 * assembler, read by the island runtime's boot): everything a reader's islands
 * start from before any request.
 */
export interface IslandPageData {
  values: Record<string, Scalar>;
  results: ServedResults | null;
  queryUrl?: string;
  mutateUrl?: string;
  viewerUrl?: string;
  assetsUrl?: string;
  /**
   * The managed `<Iframe>`'s asset door (lib/story-runtime/managed-assets ManagedAssetsConfig): the
   * deployment's asset origin and this page's absolute import door (with a capture's verified export key),
   * exactly as today's island carries it. Absent without an asset origin; a frame then refuses external assets.
   */
  managedAssets?: { origin: string; resolveUrl: string };
  /**
   * The request holds a credential for this document (session or held connection): the page's doors
   * carry it, and viewer-dependent islands show a neutral placeholder rather than guest content until
   * the viewer overlay names the reader. A non-secret hint, never the identity.
   */
  signedIn: boolean;
  /**
   * The imports this page may hold in full (lib/artifacts holdableImports, for the door the page queries
   * through), by name: what its own SQLite engine answers once loaded (lib/story/placement). Empty: the
   * page runs nothing itself.
   */
  hold: string[];
  /** The SQLite engine's wasm, content-addressed (StoryIslandData.sqliteWasm); present only when `hold` is not empty. */
  sqliteWasm?: string;
  mermaidImages: Readonly<Record<string, StoredMermaidImage>>;
  readOnly: string | null;
  /**
   * The version's author script (CompiledPage.authorScript), present only when it has one: `boot`
   * then loads the lazy author host, which runs it in the sandboxed author frame against this page's
   * store — never in this document.
   */
  authorScript?: string | null;
}
