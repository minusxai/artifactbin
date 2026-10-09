import type { CommentViewState } from '../../../contracts/src/comment-view-state';
import type {EditorBookmark,EditorSelectionChange} from '@/lib/editor-engine/bookmark';
import type { BlockEdit } from '@/lib/editor-engine/block-edit';
/**
 * The framework-free contract between the document builder (server), the compiler, and the browser
 * islands. BOTH sides import it, so it carries ONLY types and ids: a value
 * here would drag one side's graph into the other's bundle. The Solid
 * composition lives in lib/islands (rt.tsx, boot.ts) and the compiler in
 * lib/compiled-page.
 */
import type { AnnotationRange } from '@/lib/document/annotation-range';
import type { JsxNode } from '@/lib/jsx';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import type { RefDataMap } from '@/lib/dataflow/ref-data';
import type { DataflowState, Scalar } from '@/lib/dataflow/dataflow';
import type { StoryDesignName } from '@/lib/validation/story-theme-names';
import type { DocumentGraph, PersonCard, StoredMermaidImage } from '@artifactbin/contracts';

/** The document's data as the island carries it: what is declared, and its state at render. */
export interface StoryIslandDataflow {
  /** The compiled declarations (lib/dataflow/compiled-dataflow): what every query reads, every mutation's signature. */
  flow: import('@/lib/dataflow/compiled-dataflow').CompiledDataflow;
  /**
   * The rows, when somebody has already run them. ABSENT is the reader's
   * normal case — paint first: the document arrives with its declarations and
   * fetches its own rows, so first paint is not held behind the SQL. Present
   * for a CAPTURE (the exporter photographs that frame) and for the editor's
   * canvas, both of which need a settled document rather than a fast one.
   */
  state?: DataflowState;
  /**
   * The reader's own `<Value>` choices, carried in the URL (`?$region=west`)
   * and parsed server-side. Values WITHOUT rows — which is
   * exactly why they are their own field rather than a synthetic `state`:
   * `state` present means "somebody already ran the queries", so seeding
   * through it would cancel the document's first run and leave every chart on
   * its skeleton. These fold in as the store's starting values and the
   * paint-first run happens WITH them.
   */
  values?: Record<string, Scalar>;
  /**
   * THE FIRST RESULTS, run by the server for THIS request
   * (lib/story/prepared/served-results.server): the answers the query route would give
   * this reader for the values the page starts from — defaults and the URL's
   * `values` — for the queries it could answer inside its budget. A query
   * named here (in `tables` or `errors`) starts current, so the page paints
   * its rows and asks nothing until an input it reads changes; one absent
   * runs as it always has. PARTIAL by design, which is why it is not `state`
   * ("every query already ran"). Never stored with the version.
   */
  results?: ServedResults;
  /**
   * The imports THIS reader may hold in full — read access to the dataset's
   * own rows, stored rather than connected, under the hold cap — decided for
   * the door this render's page queries through (lib/artifacts
   * holdableImports). The runtime places every query over them in the page
   * (lib/dataflow/placement); absent, everything runs on the server. A hint: the
   * door that answers the rows decides again.
   */
  hold?: string[];
}

/**
 * What the server answered for some of a document's queries at the request's
 * starting values (StoryIslandDataflow.results): the query route's answer,
 * narrowed to those queries. `mutationAccess` is present when the document
 * declares writes — the same checks the route answers beside every run.
 */
export type ServedResults = Pick<DataflowState, 'tables' | 'errors'> & Partial<Pick<DataflowState, 'mutationAccess' | 'userOptions' | 'people'>> & {
  /**
   * Where the page's live stream picks up (`/a/<id>/events?since=`): a mark of
   * every dataset these answers were computed from, so a change between the
   * serve and the stream still arrives as a `data` frame. Opaque to the page.
   */
  since?: string;
};

/**
 * A dataflow that HAS been run. Running it always produces state — only the
 * island may arrive without it — so the two are different types and a caller
 * that ran the queries never has to re-check for what it just computed.
 */
export interface RanDataflow extends StoryIslandDataflow {
  state: DataflowState;
}

/**
 * WHO IS READING — the one fact about the reader a document is told.
 *
 * `id` is `$_me.id` (lib/dataflow/builtins), and `card` is the person the
 * SAME visibility rules already let a DataTable cell show
 * (lib/datasets/user-fields people): a display name, the public handle they
 * chose, and the address of their picture — never an email, never any other
 * profile field. Both travel on the island so the SERVER render and hydration
 * agree: a guest must never flash the signed-in branch, and a signed-in reader
 * must never flash "Unknown person" while a query lands.
 *
 * Its OWN island field rather than a value on the dataflow, for two reasons: a
 * document that declares nothing has no dataflow at all (and
 * `{$_me ? … : <SignIn/>}` is exactly such a document), and the viewer is not
 * the document's data — it is never declared, never carried in a link, never
 * written, and never among the signals the author script reads
 * (lib/islands/page-runtime).
 */
export interface StoryViewer {
  id: string;
  /** Absent when this render never needed one (the source draws no person). */
  card?: PersonCard | null;
}

/** What the document's JSON island carries — everything the entry needs to hydrate. */
export interface StoryIslandData {
  mentionStatuses?:Record<string,import("@artifactbin/contracts").MembershipStatus>;
  nodes: JsxNode[];
  refData: RefDataMap;
  /** The reader's identity (see StoryViewer). Absent or null = a guest. */
  viewer?: StoryViewer | null;
  /**
   * The document's structural genre. Unlike the genre's authored layout, the
   * editorial value also opts a sectioned document into the Contents rail.
   * Null/absent means no template-specific reading chrome.
   */
  template?: string | null;
  /**
   * The `<Icon>` glyphs this document uses, resolved server-side
   * (lib/story-ui/icon-glyphs.server). A separate channel from the AST on purpose: the
   * glyph is injected as raw markup, so a map an author could write into would
   * be an injection hole. Absent for a document that draws no icons.
   */
  glyphs?: GlyphMap;
  /**
   * Mermaid diagrams PRERENDERED to SVG after publish (Track G), keyed by
   * `mermaidImageKey(code, mode)`. Each carries its own fonts and a layout
   * fixed in SVG coordinates (lib/mermaid-images/fonts), so the client shows
   * it as served; a diagram with none stored draws with the engine as before.
   */
  mermaidImages?: Record<string, StoredMermaidImage>;
  /**
   * The `<Value>`/`<Query>`/`<Mutation>` declarations and their render-time state
   * (lib/dataflow/dataflow.ts). Absent for a document that declares nothing.
   */
  dataflow?: StoryIslandDataflow;
  colorMode: 'light' | 'dark';
  /**
   * Whether the document renders its own navigation chrome (the deck rail and
   * present bar, or a sectioned document's outline). False for capture renders — the exporter screenshots the
   * document frame, so chrome would land in every OG card. Default true.
   */
  chrome?: boolean;
  /**
   * Where this document's queries are answered when it is the TOP-LEVEL page:
   * `GET <queryUrl>?q=<JSON QueryRequest>` (QUERY_REQUEST_PARAM), served with
   * the anonymous read ACL. The sandboxed document fetches its own re-runs —
   * its CSP admits exactly this URL. Inside a parent (the owner's shell) the
   * relay below is used instead, because the page holds the session and a
   * private document's queries need it. Absent for renders that never re-run.
   */
  queryUrl?: string;
  /**
   * The SQLite engine's wasm, at the content-addressed URL the island build
   * records (public/islands/manifest.json), for a page that runs the queries
   * over what its reader holds (dataflow.hold, lib/story-runtime/page-sqlite).
   * Absent where nothing runs in the page.
   */
  sqliteWasm?: string;
  /**
   * Where this document's WRITES go when it is the TOP-LEVEL page:
   * `POST <mutateUrl> { mutation, args, row?, value? }` (app/a/[id]/mutate), the one other
   * URL its CSP admits. Present only for a document that declares a
   * `<Mutation>`; inside a parent the relay is used instead, for the same
   * reason queries relay there — the page holds the session.
   */
  mutateUrl?: string;
  /**
   * Where this document imports an image URL that only exists in the READER's
   * browser — a bound `<img src="$pick">`, a template a pick completed, a
   * column of logos: `GET <assetsUrl>?u=<url>` (app/a/[id]/assets), which
   * imports it under this document's own read ACL and caps and answers a
   * redirect to `/assets/<hash>`.
   *
   * An `<img>` LOAD, not a fetch — so unlike `queryUrl`/`mutateUrl` this needs
   * no `connect-src` entry and the document's CSP is unchanged by it
   * (`img-src 'self'` already admits a same-origin address). Absent for a
   * render that is not a served document, where a bound image renders static.
   */
  assetsUrl?: string | null;
  /**
   * WHY THIS RENDER CAN NEVER WRITE, in the words a person reads on the button.
   *
   * Absent for every ordinary document. Present for a render that is a
   * SNAPSHOT rather than the document — today that is `?version=N`, the
   * archived view (lib/archived-version), where the reason is "Version N is
   * read-only". It refuses every `<Mutation>` up front, whatever the datasets
   * would have said, so a button is disabled before it is pressed and
   * a `page` mutation rejects with it as the message.
   *
   * It is not the absence of `mutateUrl`: that is already true here, and on its
   * own it makes the runtime say "This view cannot save changes" — accurate,
   * and about the wrong thing.
   */
  readOnly?: string;
}

/** The GET query endpoint's one parameter: the JSON of a QueryRequest (lib/http/query-request). */
export const QUERY_REQUEST_PARAM = 'q';

/** DOM contract between the builder and the entry. */
export const STORY_ROOT_ID = 'mx-story-root';

/* ────────────────────────────────────────────────────────────────────────────
 * The compiled reader page: what the assembler and compiler (lib/compiled-page) write
 * and the islands (lib/islands) read
 * ──────────────────────────────────────────────────────────────────────────── */
/** The element ids and attributes the assembled page and the runtime agree on. */
export const ISLAND_DATA_ID = 'mx-story-data';
/**
 * A `<Question>` island's inner drawing box in the compiled HTML, by the question's
 * node id (or path) — the ASSEMBLER's handle only: it puts the snapshot's SVG
 * inside the box and marks it `data-mx-chart-state="ready"`. The island removes
 * the attribute when it mounts (the served DOM then matches the former render), and
 * re-draws only when its table changes or the reader interacts (Vega loads then).
 */
export const CHART_SLOT_ATTR = 'data-mx-chart-slot';
/** A chart slot's drawing state, set by the assembler and updated by the island runtime (`drawn`, `pending`, `live`). */
export const CHART_STATE_ATTR = 'data-mx-chart-state';
/** Set on `<html>` when every island has hydrated (or at DOMContentLoaded on a page with no module): the lab's ready marker. */
export const READER_READY_ATTR = 'data-mx-ready';
/** Live data widget contents belong to Solid, rather than the server-fragment morph. */
export const LIVE_DATA_ATTR = 'data-mx-live';
/** The string-literals carrier's attribute (lib/compiled-page/carriers); the module reads its literals by DOM lookup. */
export const LITERALS_ATTR = 'data-mx-island-literals';
/** The route prefix per-document modules and speculation-rule files are served under. */
export const ISLANDS_PATH = '/islands';
export const DOCUMENT_MODULE_PATH = `${ISLANDS_PATH}/d`;

/** A `<Question>` drawn on the server, keyed by the question's node id (or path when it has none). */
export interface DrawnChart {
  svg: string;
  /** The table it was drawn from and the digest of the rows, so a client re-draw can tell whether it is stale. */
  table: string;
  rows: string;
}

/** `GET /a/:id/viewer?<$values>` — what only this reader decides, answered with the query door's admission (w3-viewer-writes). */
export interface ViewerOverlay {
  viewer: StoryViewer | null;
  /** The `viewer`-scope queries' answers for this reader at these values. */
  results: ServedResults;
  /** The imports this reader may hold in full (StoryIslandDataflow.hold). */
  hold: string[];
}

/**
 * The QUERY RELAY — how a served document INSIDE A PARENT PAGE (the owner's
 * shell, the canvas, a capture) re-runs its queries after a value changes:
 * the frame posts a request to the PAGE, which holds the session, calls
 * `POST /a/<id>/query`, and posts the result back. (Top-level, the document
 * GETs its own `queryUrl` instead — see StoryIslandData.queryUrl.) The
 * page keeps identifying the frame by `event.source` (its origin is "null"),
 * and the frame accepts results only from its parent. Requests are matched by
 * `id`; a request the page never answers times out in the frame's transport.
 */
/**
 * A NEW VERSION OF THIS DOCUMENT, posted to the page's controller (lib/islands/island-controller).
 *
 * The app's editor sends an `EditDraft`: unsaved source the controller compiles on the
 * server (`/a/<id>/draft-preview`) and morphs into the running islands. The reader page sends a
 * `ReaderFrame` from the live stream: a saved version the controller morphs in from its compiled fragment
 * (lib/islands/live-update). `nodes` is the body in the shape the island carries; comments and selections
 * are classified against it.
 */
export const STORY_DOCUMENT_MESSAGE = 'mx:document';

export interface EditDraft {
  type: typeof STORY_DOCUMENT_MESSAGE;
  nodes: JsxNode[];
  /** The unsaved source the server compiles. */
  source: string;
  /** The editor's current head pointer; a page chrome snapshot may lag its own save. */
  editId: string;
  /** The theme the editor shows NOW (null: none). Always sent: the stored theme lags a pick until its save lands. */
  theme: StoryDesignName | null;
  colorMode: 'light' | 'dark';
  /**
   * A saved VERSION shown for reading while editing is paused (version history). Drawn like a draft even with
   * edit mode off; Done afterwards returns the page to the saved head.
   */
  preview?: true;
  /**
   * Everything since the previous draft was typed into prose the editor already shows: its compile
   * may only reconcile the editor, never redraw it (lib/islands/island-controller).
   */
  typing?: true;
  /** A new look (theme, colour mode): drawn by the compiler, never only reconciled into the editors. */
  redraw?: true;
}

/**
 * A saved version heard on the reader's live stream (solid/pages/Document). Only `nodes` is read: the morph
 * fetches the version's compiled fragment itself; the rest is what the frame carries.
 */
interface ReaderFrame {
  type: typeof STORY_DOCUMENT_MESSAGE;
  nodes: JsxNode[];
  source?: undefined;
  preview?: undefined;
  dataflow?: { flow: StoryIslandDataflow['flow']; state?: StoryIslandDataflow['state'] };
  compiledCss?: string | null;
  authorCss?: string | null;
  authorScript?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark';
}

/**
 * The local preview's draft (services/cli/src/preview/client): source only. Its own controller
 * (services/cli/src/preview/edit-controller) compiles the file on disk and reads nothing else.
 */
interface LocalDraft {
  type: typeof STORY_DOCUMENT_MESSAGE;
  nodes: JsxNode[];
  source: string;
  editId?: undefined;
  theme?: undefined;
  colorMode?: undefined;
  preview?: undefined;
}

export type StoryDocumentUpdate = EditDraft | LocalDraft | ReaderFrame;

/** Private page-to-document capability, shared by the compiled and legacy editor bridges. */
export interface StoryController {
  readonly nonce: string;
  send(command: unknown): void;
  update(document: StoryDocumentUpdate): void;
  invalidate(datasets: string[]): void;
  subscribe(listener: (event: unknown) => void): () => void;
  getViewportRect(): DOMRect;
  dispose(): void;
}

/** The page's handle on its adopted story root (lib/islands/island-controller), as the page shell and the frame bridge see it. */
export interface IslandStoryController extends StoryController {
  selectionReady(): void;
  /**
   * Settles once the page reads again IN PLACE after editing: the saved version drawn on the running islands
   * and the islands back in read mode (lib/islands/boot). Resolves at once when editing never froze them;
   * rejects when the version cannot be drawn here (the caller reloads, keeping the reader's place).
   */
  restored(): Promise<void>;
}

/**
 * The runtime's private hook for adopting a new version of this document,
 * installed on `window` by the hydration entry.
 *
 * It exists because the two halves of a live update ship separately: the piece
 * that HEARS the edit is a ~1.5KB module every document loads (it also carries
 * the reading position), and the piece that can re-render the document is the
 * island runtime that only a document with components or data loads at all.
 * Deliberately not part of the author script's API (lib/islands/page-runtime).
 */
export const STORY_ADOPT_HOOK = '__mxAdoptDocument';

/**
 * The reader flipped the mode toggle (anchor-entry wires the click; the button
 * itself is server-rendered chrome). Same split as the adopt hook: the class
 * flip works without the runtime, but chart ink follows the `colorMode` PROP, so a
 * document that hydrated must also re-render — the runtime registers this and
 * the ~1.5KB module calls it when present.
 */
export const STORY_MODE_HOOK = '__mxSetColorMode';

/** A trusted parent asks its opaque document frame to change the reader's
 * local appearance. It changes no stored document field and grants nothing. */
export const STORY_READER_MODE_MESSAGE = 'mx:reader-mode';
/** A framed document's scroll port lives across an opaque-origin boundary
 * from the page chrome. This unprivileged sample lets the parent apply its
 * mobile bar visibility policy; the parent still checks the source window. */
export const STORY_SCROLL_MESSAGE = 'mx:reader-scroll';
/**
 * The app page → a document framed on its own origin (APP__PAGES_HOST): the address's `#hash`, so a
 * link to a heading scrolls the frame. `{ type, hash }`, hash `#…`; the frame takes it from its parent only.
 */
export const STORY_FRAME_HASH_MESSAGE = 'mx:frame-hash';
/**
 * A document framed on its own origin → the app page: the reader moved a `<Value>` the link carries, and this is
 * what the link should now say — the `$` params ONLY (lib/dataflow/url-values `writeUrlValues('', …)`, `''` at
 * rest), never the frame's other params or hash. Posted by the document's link follower (lib/islands/url-sync,
 * debounced and compared there) to the app origin; the page's half of the bridge (frame-bridge/parent) takes it
 * only from its own frame's window and origin, and the page (solid/document/create-framed-story) puts exactly
 * those `$` pairs in its own address, so the address bar, a copied link and a reload carry the selection.
 * Unkeyed on purpose: the author's script can move every value anyway, so it gains nothing by forging one.
 */
export const STORY_URL_VALUES_MESSAGE = 'mx:url-values';
export interface StoryUrlValuesMessage { type: typeof STORY_URL_VALUES_MESSAGE; search: string }

/**
 * A document framed on its own origin → the app page: the reader followed a link to an APP path (root-relative, or
 * absolute on either origin), which would otherwise resolve against the document's origin. `{ type, href }`, `href`
 * a root-relative path with its query and hash. The app page performs the navigation on itself and answers
 * STORY_NAVIGATING_MESSAGE first; a frame that hears no answer takes the top itself (lib/story-runtime/frame-bridge/links).
 */
export const STORY_NAVIGATE_MESSAGE = 'mx:navigate';
/** The app page → its framed document: "I am taking this navigation" (`{ type, href }`, the href it was asked for). */
export const STORY_NAVIGATING_MESSAGE = 'mx:navigating';
export interface StoryNavigateMessage { type: typeof STORY_NAVIGATE_MESSAGE | typeof STORY_NAVIGATING_MESSAGE; href: string }
export interface StoryScrollMessage {
  type: typeof STORY_SCROLL_MESSAGE;
  scrollY: number;
  /** The document's own scrollbar width, so page chrome drawn over the frame can stop where the document's does. */
  gutter?: number;
  /**
   * "I have nothing further to scroll to" — the ANSWER, not the ingredients.
   * The parent cannot measure an opaque frame's height, and comparing this
   * offset against its OWN metrics gives the wrong answer on the artifact page,
   * where those never move: the end-of-page rule (the bar stays up where the
   * footer is) would be lost for every framed document. The document measures
   * its own end instead, with the same 4px slack the page uses for its own.
   */
  atBottom: boolean;
}

/**
 * The runtime's private hook for "a dataset under this document changed" —
 * the data twin of STORY_ADOPT_HOOK, and installed for the same reason: the
 * piece that HEARS the change is the ~1.5KB module every document loads, and
 * the piece that can re-run a query is the runtime, which only a document
 * with data loads at all. A document without it reloads instead.
 */
export const STORY_DATA_HOOK = '__mxInvalidateDatasets';

/**
 * PAGE → FRAME: a dataset this document reads has changed (the page heard it
 * on the live stream). Carries no rows — the document re-runs the queries that
 * read it through the transport it already has, which is what keeps one path
 * for "where do rows come from".
 */
export const STORY_DATA_MESSAGE = 'mx:data';

/**
 * The SSE event name a DATA wakeup carries on `/a/<id>/events` (the default,
 * unnamed frame stays the document). It lives HERE rather than beside the
 * route because both ends need it and only one of them is a server: a client
 * module importing a VALUE from a route handler pulls that route's whole
 * server graph (lib/db, lib/analytics, …) into the browser bundle, which is a
 * build failure, not a size regression.
 */
export const STORY_DATA_EVENT = 'data';

/* ────────────────────────────────────────────────────────────────────────────
 * IN-PLACE EDITING — edit mode is a mode the runtime enters, in the frame the
 * reader is already looking at (there is no second document).
 *
 * The PARENT keeps truth, session, network and composition; the FRAME makes
 * text hosts editable, reports what the user selected, stages what they typed,
 * and renders whatever `mx:document` says. Every frame → parent message below
 * carries the session `nonce`, minted by the runtime in ES-module scope BEFORE
 * the author's script is injected (lib/story-runtime/pristine) — the parent
 * drops anything without it, which is what makes a write relay safe beside a
 * script that shares the frame's realm. Parent → frame messages must be
 * `isTrusted`: a synthetic MessageEvent can spoof `source`, never that.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Parent → frame: enter or leave edit mode. The frame lazy-loads its edit chunk on the first `on`. */
export const STORY_EDIT_MODE_MESSAGE = 'mx:edit-mode';
interface StoryEditModeMessage { type: typeof STORY_EDIT_MODE_MESSAGE; on: boolean }

/** Frame → parent: edit mode is live (hosts are editable and listening). */
export const STORY_EDIT_READY_MESSAGE = 'mx:edit-ready';
interface StoryEditReadyMessage { type: typeof STORY_EDIT_READY_MESSAGE; nonce: string }

/**
 * Frame → parent: the user finished editing a text host (blur), or is about to
 * have a format applied mid-word. `innerHtml` is the host's contenteditable
 * output — rich inline HTML, possibly hostile; the parent composes it through
 * the same sanitizing write-back the canvas used (lib/data/story/jsx-edit).
 */
export const STORY_INLINE_MESSAGE = 'mx:inline';
export const STORY_MARKDOWN_BLOCK_MESSAGE = 'mx:markdown-block';
export type MarkdownBlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'bullet' | 'number' | 'code' | 'check' | 'hr' | 'table';
export type MarkdownTableAction = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column' | 'delete-table';
export const STORY_MARKDOWN_TABLE_MESSAGE = 'mx:markdown-table';
interface StoryMarkdownTableMessage { type: typeof STORY_MARKDOWN_TABLE_MESSAGE; action: MarkdownTableAction }
interface StoryMarkdownBlockMessage { type: typeof STORY_MARKDOWN_BLOCK_MESSAGE; block: MarkdownBlockKind }
interface StoryInlineMessage {type:typeof STORY_INLINE_MESSAGE;tag:'strong'|'em'|'u'}
export const STORY_PASTE_MESSAGE = 'mx:paste';
interface StoryPasteMessage {type:typeof STORY_PASTE_MESSAGE;value:string;kind:'markdown'|'text'}

export const STORY_BLOCK_EDIT_MESSAGE = 'mx:block-edit';
interface StoryBlockEditMessage {type:typeof STORY_BLOCK_EDIT_MESSAGE;nonce:string;command:BlockEdit}
export const STORY_HISTORY_MESSAGE = 'mx:history';
interface StoryHistoryMessage {type:typeof STORY_HISTORY_MESSAGE;nonce:string;direction:'undo'|'redo'}

interface StoryEditErrorMessage {type:'mx:edit-error';nonce:string;message:string}
export const STORY_FLOW_EDIT_MESSAGE = 'mx:flow-edit';
interface StoryFlowEditMessage { selection?:EditorSelectionChange; type: typeof STORY_FLOW_EDIT_MESSAGE; nonce: string; path: string; expected: string; replacement: string; group?:string }

export const STORY_TEXT_EDIT_MESSAGE = 'mx:text-edit';
interface StoryTextEditMessage { type: typeof STORY_TEXT_EDIT_MESSAGE; nonce: string; path: string; innerHtml: string }

/**
 * Frame → parent: the person pressed "Edit script" on a script component's mount badge (lib/story-runtime/edit/dom-mounter).
 * `component` is the mount's name; the parent opens the Helmet script in the source editor at its export.
 */
export const STORY_OPEN_SCRIPT_MESSAGE = 'mx:open-script';
interface StoryOpenScriptMessage { type: typeof STORY_OPEN_SCRIPT_MESSAGE; nonce: string; component: string }

/** Frame → parent: there is uncommitted typing (from the first `input` to the commit). Gates remote adoption. */
export const STORY_TYPING_MESSAGE = 'mx:typing';
interface StoryTypingMessage { type: typeof STORY_TYPING_MESSAGE; nonce: string; active: boolean }

/** One ancestor in the toolbar's breadcrumb: enough to label it and re-select it. */
export interface StoryEditCrumb { path: string; tag: string; hint: string }

/** A rect in the FRAME's viewport coordinates; the parent adds the iframe's own box. */
export interface StoryEditRect { x: number; y: number; width: number; height: number }

/**
 * What the user has selected, described rather than referenced: the parent
 * has no element, only this. `className`/`style` are the element's current
 * attribute values, which is what the typography toolbar reasons over.
 */
export interface StoryEditSelection {
  viewState?: CommentViewState;
  viewStateError?: string;
  /** Unclipped drag in this document viewport, separate from the node-relative anchor. */
  captureRect?: StoryEditRect;
  /** The prose engine owns formatting transactions and their source write-back. */
  editor?: 'prose' | 'markdown';
  /** Lexical block at the caret, or mixed when the range spans different block styles. */
  markdownBlock?: MarkdownBlockKind | 'mixed';
  customHeight?:boolean;
  inline?:Record<'strong'|'em'|'u',boolean|'mixed'>;
  /** Prose only: where the caret or selected words are, so link chrome can sit beside them. */
  textRect?: StoryEditRect;
  /** Prose only: the href of the link the caret is in or the selection covers. */
  link?: string;
  /** 'text': a focused editable host · 'element': a click-selected container · 'embed': a component. */
  kind: 'text' | 'element' | 'embed';
  /**
   * 'typing': a caret in text (the toolbar offers text tools). 'block': the node
   * itself is selected (grip, Esc, breadcrumb, a click on a chart) — the caret
   * is gone, so the toolbar offers block tools only. Absent from older frames:
   * treated as before.
   */
  mode?: 'typing' | 'block';
  path: string;
  /** Authored persistent DOM id of the source node. Absent until autosave has persisted one. */
  nodeId?: string;
  tag: string;
  rect: StoryEditRect;
  className: string;
  style: string;
  /** Selectable ancestors, OUTERMOST first. */
  ancestors: StoryEditCrumb[];
  /**
   * The words actually selected, canonical — present only when there IS a text
   * selection, which is why both of these are optional: the same struct rides
   * every caret move in an edit session, where nothing is selected at all.
   * A comment stores them beside its anchor (lib/story/annotations/annotation-range).
   */
  quote?: string;
  /** Where those words are, addressed RELATIVE to `path` — never an absolute body path. */
  range?: AnnotationRange;
}

/** Frame → parent: the selection changed, or moved (re-posted on in-frame scroll, throttled to a frame). */
export const STORY_SELECTION_MESSAGE = 'mx:selection';
interface StorySelectionMessage { type: typeof STORY_SELECTION_MESSAGE; nonce: string; selection: StoryEditSelection | null }

/**
 * Frame → parent: the owner selected readable text in view mode and chose the
 * small contextual Edit/Annotate action. The containing source node travels
 * with the request so the destination mode opens on what they were reading.
 */
export const STORY_SELECTION_ACTION_MESSAGE = 'mx:selection-action';
interface StorySelectionActionMessage {
  type: typeof STORY_SELECTION_ACTION_MESSAGE;
  nonce: string;
  action: 'edit' | 'annotate' | 'select';
  selection: StoryEditSelection;
}

/** Parent → frame: which contextual actions this authorized viewer may use. */
export const STORY_SELECTION_ACTIONS_MESSAGE = 'mx:selection-actions';
export interface StorySelectionActionsMessage {
  type: typeof STORY_SELECTION_ACTIONS_MESSAGE;
  edit: boolean;
  annotate: boolean;
}

/**
 * Frame → parent: an image was pasted or dropped INTO the document while
 * editing. The listeners must live in the frame, because that is the realm the
 * event fires in — the document is a separate window and the parent's own
 * `paste`/`drop` never see it. The File itself travels by structured clone, and
 * the parent hands it to the SAME insert the file picker uses, so all three
 * doors share one ingest, one size cap and one type list.
 */
export const STORY_IMAGE_DROP_MESSAGE = 'mx:image-drop';
interface StoryImageDropMessage {
  type: typeof STORY_IMAGE_DROP_MESSAGE;
  nonce: string;
  file: File;
  /**
   * The BODY path of the plain `<img>` this file REPLACES — present when it was
   * dropped onto an image, or pasted while one was selected. Absent, the file
   * is inserted as before. Either way the parent composes the source; the frame
   * only says which image the person meant.
   */
  target?: string;
  /**
   * Where a DROPPED file lands when it is not replacing: the gap between the
   * blocks nearest the pointer, as a block and a side of it. Null when the drop
   * was outside every block (the page then appends). Absent on a paste, which
   * the page places at its own selection.
   */
  at?: { path: string; side: 'before' | 'after' | 'inside' } | null;
}

/**
 * Frame → parent: an image was double-clicked in edit mode — open the replace
 * file picker for it. Handled synchronously, while the click's user activation
 * still lets the page open a picker; the chosen file takes the same replace
 * path as the toolbar's "Upload file".
 */
export const STORY_IMAGE_REPLACE_MESSAGE = 'mx:image-replace';
interface StoryImageReplaceMessage { type: typeof STORY_IMAGE_REPLACE_MESSAGE; nonce: string; path: string }

/** Frame → parent: Delete/Backspace pressed while NO text host had focus — the parent decides what it removes. */
export const STORY_EDIT_KEY_MESSAGE = 'mx:edit-key';
interface StoryEditKeyMessage { type: typeof STORY_EDIT_KEY_MESSAGE; nonce: string; key: 'Delete' | 'Backspace' | 'Escape' }

/**
 * Parent → frame: apply a format to an element NOW, locally, without a
 * re-render — the toolbar's instant feedback. Each present field is the
 * attribute's full new value; '' removes it. The parent composes the same
 * edit into the source; the frame's DOM already shows it.
 */
export const STORY_APPLY_FORMAT_MESSAGE = 'mx:apply-format';
interface StoryApplyFormatMessage { type: typeof STORY_APPLY_FORMAT_MESSAGE; path: string; className?: string; style?: string }

/**
 * Parent → frame: wrap the current text selection inside the host at `path`
 * in a link (or unwrap with href null). Only the frame holds the live
 * Selection; it answers with an `mx:text-edit` carrying the new innerHTML.
 */
export const STORY_APPLY_LINK_MESSAGE = 'mx:apply-link';
interface StoryApplyLinkMessage { type: typeof STORY_APPLY_LINK_MESSAGE; path: string; href: string | null }

/** Parent → frame: put the caret back in the text it left for page chrome (a link box closed without a change). */
export const STORY_FOCUS_TEXT_MESSAGE = 'mx:focus-text';
interface StoryFocusTextMessage { type: typeof STORY_FOCUS_TEXT_MESSAGE }

/**
 * Frame → parent: a `<GridItem>` was dragged or resized to a new rect.
 *
 * The grid is laid out in the document — only it knows the pixel width the
 * columns divide — so the drag happens there and the resulting rects come back
 * as source edits. Several arrive together: vertical compaction moves siblings,
 * so one drag repositions more than one tile.
 */
export const STORY_LAYOUT_EDIT_MESSAGE = 'mx:layout-edit';
export interface StoryLayoutRect { path: string; x: number; y: number; w: number; h: number }
interface StoryLayoutEditMessage {
  type: typeof STORY_LAYOUT_EDIT_MESSAGE;
  nonce: string;
  rects: StoryLayoutRect[];
}

/**
 * Frame → parent: a slide was renamed from the deck's own rail.
 *
 * The rail is the DOCUMENT's chrome (lib/story-runtime/slides), so the
 * affordance has to live there; the write-back is the parent's as always.
 */
export const STORY_SLIDE_TITLE_MESSAGE = 'mx:slide-title';
interface StorySlideTitleMessage {
  type: typeof STORY_SLIDE_TITLE_MESSAGE;
  nonce: string;
  path: string;
  title: string;
}

/**
 * Parent → frame: commit anything the reader has typed but not yet blurred,
 * NOW, and say when it is done.
 *
 * The document commits a text edit on BLUR, so between the last keystroke and
 * moving focus the work exists only in its DOM. Every way out of edit mode —
 * the done button, the back button, a tab being hidden — has to collect that
 * before it drains, or the last thing typed is exactly the thing that is lost.
 */
export const STORY_COMMIT_MESSAGE = 'mx:commit';
export const STORY_COMMITTED_MESSAGE = 'mx:committed';
interface StoryCommitMessage { type: typeof STORY_COMMIT_MESSAGE; restore?:EditorBookmark }
interface StoryCommittedMessage { type: typeof STORY_COMMITTED_MESSAGE; nonce: string }

/** Parent → frame: select an element by path (a breadcrumb click, a panel opening), or clear with null. */
export const STORY_SELECT_MESSAGE = 'mx:select';
interface StorySelectMessage {
  type: typeof STORY_SELECT_MESSAGE;
  path: string | null;
  /**
   * Something the page just inserted: the node may not be drawn yet (the new
   * document is still rendering), so wait briefly for it, then scroll it into view.
   */
  reveal?: boolean;
  /** Start typing in a just-inserted rich-text region once its editor mounts. */
  focusText?: boolean;
  /** With `reveal`: the id of the node meant — until the re-render lands, an OLD node sits at that path. */
  nodeId?: string;
}

/**
 * Parent → frame: SPOTLIGHT nodes by BODY path without selecting them — the
 * query notebook pointing at what a query powers. Selection would hand the
 * rail to the embed inspector and hide the notebook that asked; a spotlight
 * only outlines and scrolls the first one into view. Idempotent: the whole
 * set every time, `[]` clears. Unknown paths are ignored.
 */
export const STORY_SPOTLIGHT_MESSAGE = 'mx:spotlight';
interface StorySpotlightMessage { type: typeof STORY_SPOTLIGHT_MESSAGE; paths: string[] }

/* ────────────────────────────────────────────────────────────────────────────
 * ANNOTATIONS — comments the owner pins to nodes; the frame only ever sees
 * ids + BODY paths (content, threads and the session stay on the page).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parent → frame: the pin set, one idempotent message — re-posted whole
 * whenever the list changes, so the frame holds no annotation state it could
 * get out of step on. `pins` are the OPEN, non-orphaned roots by BODY path —
 * plus the ONE resolved root the reader has expanded in the rail, which is also
 * this message's `openId`: selecting a resolved comment is how somebody asks
 * what it was about, so its passage is painted and scrolled to like any other.
 * It travels in the SAME message as that `openId` (the frame records the scroll
 * as done on arrival and would never repeat it for a pin arriving later), and
 * leaves again when the card is collapsed, another thread is opened or the rail
 * closes. Recently resolved previews may retain `layoutOnly` pins for their
 * positions; those pins never paint or respond to document hover.
 *
 * `mode` is ON or OFF and nothing else. It used to carry a third value naming
 * which PAGE MODE was open ('pins' for view, 'annotate' for #annotate), which
 * was the wire admitting that commenting was a mode — and it made the frame
 * responsible for a decision it cannot see. Whenever the layer is on the frame
 * tints commented nodes and reports their geometry; what varies is whether it
 * may SWALLOW a click to focus a thread, and it answers that itself from
 * whether an edit session exists (a click in edit mode belongs to the caret).
 * 'off' is the hide-comments switch, and the only thing that stops either.
 */
export const STORY_ANNOTATIONS_MESSAGE = 'mx:annotations';
export interface StoryAnnotationsMessage {
  canComment?: boolean;
  /** Explicit reopen, including a restore button on the already-open thread. */
  viewStateRequest?: number;
  type: typeof STORY_ANNOTATIONS_MESSAGE;
  mode: 'off' | 'on';
  /**
   * The anchored nodes: `key` is the node's opaque annotation-anchor key (the
   * durable anchor — plain tags carry it into the DOM), `path` the body path
   * fallback (components keep the attribute in source only).
   */
  pins: Array<{
    id: string;
    viewState?: CommentViewState;
    /** Position a resolved preview without painting or interacting with its former highlight. */
    layoutOnly?: boolean;
    path: string;
    key: string | null;
    /** Persistent authored node id; absent on historical anchor-only threads. */
    nodeId?: string | null;
    /**
     * The exact words the comment is on, addressed relative to the anchored
     * node — the frame re-finds them by TEXT and paints them. Absent on a
     * comment made before selections were kept, or one made from a caret;
     * the whole-node tint is the fallback. Still ONE pin per thread.
     */
    range?: AnnotationRange | null;
  }>;
  /** The thread the page has open — its node renders highlighted. */
  openId: string | null;
  /** The thread under either pointer — transient emphasis, never document state. */
  hoverId: string | null;
  /** The node the owner is composing on; replayed so lazy annotation startup cannot lose it. */
  selectedPath?: string | null;
  selected?: StoryEditSelection | null;
  /**
   * The Select tool (`select`) combines block hover/click and area drag.
   * Legacy modes remain accepted for existing runtime callers:
   * `block` — the selectable node under the pointer carries an outline and a
   * click takes it; `area` — a dragged rectangle, whose anchor is the lowest
   * common ancestor of the blocks it touched and whose box rides the
   * selection as an area range (lib/story/annotations/annotation-range). Either answers
   * with `mx:selection` — the same report the breadcrumb widening uses — or a
   * null selection on escape. Null/absent is off. One-shot: the page clears
   * it the moment a selection arrives.
   */
  pick?: 'block' | 'area' | 'select' | null;
}

/** Frame → parent: the owner clicked an annotated node to open its thread. */
export const STORY_ANNOTATION_PIN_MESSAGE = 'mx:annotation-pin';
interface StoryAnnotationPinMessage {
  type: typeof STORY_ANNOTATION_PIN_MESSAGE;
  nonce: string;
  id: string;
  rect: StoryEditRect;
}

/** Frame → parent: the pointer entered or left an annotated document node. */
export const STORY_ANNOTATION_HOVER_MESSAGE = 'mx:annotation-hover';
interface StoryAnnotationHoverMessage {
  type: typeof STORY_ANNOTATION_HOVER_MESSAGE;
  nonce: string;
  id: string | null;
}

/** Frame → parent: the current viewport geometry of every anchored open thread. */
export const STORY_ANNOTATION_LAYOUT_MESSAGE = 'mx:annotation-layout';
interface StoryAnnotationLayoutMessage {
  viewStateError?: { id: string; message: string } | null;
  type: typeof STORY_ANNOTATION_LAYOUT_MESSAGE;
  nonce: string;
  positions: Array<{ id: string; rect: StoryEditRect; status?: 'exact' | 'missing' | 'ambiguous' }>;
}

/**
 * The SSE event name an ANNOTATIONS wakeup carries on `/a/<id>/events` —
 * delivered only to owner-credentialed connections. Lives here for the same
 * reason STORY_DATA_EVENT does: both ends need the value and only one is a
 * server.
 */
export const STORY_ANNOTATIONS_EVENT = 'annotations';

/* ────────────────────────────────────────────────────────────────────────────
 * KEYS A FRAMED DOCUMENT FORWARDS — the page's editor listens on its own window,
 * and a key pressed inside a framed document never reaches it. The frame half of
 * the bridge (lib/islands/frame-bridge) sends these instead, signed
 * like every other frame → parent message. Undo/redo travels as `mx:history`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Frame → parent: hand held typing to the document now (Enter pressed, or focus left a text host). */
export const STORY_EDIT_FLUSH_MESSAGE = 'mx:edit-flush';
interface StoryEditFlushMessage { type: typeof STORY_EDIT_FLUSH_MESSAGE; nonce: string; reason: 'enter' | 'focusout' }

/** Frame → parent: the comment shortcut (⌘⌥M / Ctrl-Alt-M) pressed inside the document while editing. */
export const STORY_COMMENT_KEY_MESSAGE = 'mx:comment-key';
interface StoryCommentKeyMessage { type: typeof STORY_COMMENT_KEY_MESSAGE; nonce: string }

/** Frame → parent: the link shortcut (⌘K / Ctrl-K) pressed in the document's text while editing. */
export const STORY_LINK_KEY_MESSAGE = 'mx:link-key';
interface StoryLinkKeyMessage { type: typeof STORY_LINK_KEY_MESSAGE; nonce: string }

/* ────────────────────────────────────────────────────────────────────────────
 * THE FRAME BRIDGE — the controller (`StoryController` above) across a window
 * boundary, for a document served on its own origin and framed by the app page
 * (lib/story-runtime/frame-bridge). Both directions are one envelope:
 *
 *   { type: 'mx:frame-bridge', key, payload }
 *
 * `key` is minted by the PAGE (its realm, its crypto) and sent in `attach`; the
 * frame's door (lib/story-runtime/frame-bridge/door, installed by lib/islands/page
 * BEFORE the author's script exists) is the only listener that ever sees an
 * envelope — it stops every one from reaching another listener — so the author's
 * script, which shares the frame's realm, never learns the key and cannot forge
 * a reply. Every frame → page envelope carries it; the page drops any without it.
 * The controller's own events ride inside (`event`) with the session `nonce`
 * exactly as the in-page controller emits them, so the page's consumers
 * (create-in-place-edit, AnnotationLayer, SelectionActions) check them unchanged.
 * Origins: the page accepts only the document's own origin (`'null'` for the
 * sandboxed `/a/<id>/raw` in development); the frame accepts only the app's.
 * Geometry in `event`s stays in the FRAME's viewport (StoryEditRect); the page
 * adds the iframe's box (StoryController.getViewportRect).
 * ──────────────────────────────────────────────────────────────────────────── */
export const STORY_FRAME_BRIDGE_MESSAGE = 'mx:frame-bridge';

/** What the page tells the frame when it attaches: the controller's inputs (createIslandController). */
export interface FrameBridgeAttach {
  kind: 'attach';
  id: string;
  /** The version's SOURCE nodes, which comments and selections are classified against. */
  nodes: JsxNode[];
  editId: string;
  source: string | null;
}

/** Page → frame. */
export type FrameBridgeParentPayload =
  | FrameBridgeAttach
  /** The live inputs the controller reads (`editId()`, `initialSource()`), when the page learns newer ones. */
  | { kind: 'context'; editId: string; source: string | null }
  /**
   * How far the page's bars reach over the frame's top edge (edit mode's toolbar, drawn over the frame rather than
   * pushing it down): the document reserves that much above itself and scrolls by the same amount in one task, so
   * nothing in it moves on screen. Absolute; 0 gives the space back.
   */
  | { kind: 'inset'; top: number }
  | { kind: 'send'; command: unknown }
  | { kind: 'update'; command: StoryDocumentUpdate }
  | { kind: 'restored'; call: number }
  /** The answer to a relayed app request (`fetch`): status, the headers the controller reads, the body as text. */
  | { kind: 'fetch-result'; call: number; status: number; headers: Record<string, string>; body: string }
  | { kind: 'fetch-result'; call: number; error: string }
  | { kind: 'detach' };

/** Frame → page. `hello` is the one unkeyed payload: the door is open and the page may attach. */
export type FrameBridgeFramePayload =
  | { kind: 'hello' }
  /** The controller runs; `nonce` is what its events carry. */
  | { kind: 'ready'; nonce: string; urlValues?: string }
  | { kind: 'event'; event: unknown }
  | { kind: 'restored'; call: number; ok: true }
  | { kind: 'restored'; call: number; ok: false; error: string }
  /** One of the controller's app requests (IslandControllerInput.appFetch), for the page to make with its session. */
  | { kind: 'fetch'; call: number; path: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null }
  /** The document scrolled: geometry the page placed over it moves. */
  | { kind: 'scroll'; scrollX: number; scrollY: number }
  | { kind: 'error'; message: string };

/** A bridge envelope at all (any key): the door swallows these so no other listener sees one. */
export function isFrameBridgeEnvelope(data: unknown): data is { type: typeof STORY_FRAME_BRIDGE_MESSAGE; key?: unknown; payload: { kind: string } } {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; payload?: unknown };
  return d.type === STORY_FRAME_BRIDGE_MESSAGE && !!d.payload && typeof d.payload === 'object' && typeof (d.payload as { kind?: unknown }).kind === 'string';
}

type StoryEditFrameMessage =
  | StoryEditErrorMessage | StoryBlockEditMessage | StoryHistoryMessage | StoryFlowEditMessage | StoryEditReadyMessage | StoryTextEditMessage | StoryTypingMessage | StorySelectionMessage
  | StorySelectionActionMessage
  | StoryEditKeyMessage | StoryCommittedMessage | StoryLayoutEditMessage | StorySlideTitleMessage
  | StoryImageDropMessage | StoryImageReplaceMessage | StoryAnnotationPinMessage | StoryAnnotationHoverMessage | StoryAnnotationLayoutMessage
  | StoryEditFlushMessage | StoryCommentKeyMessage | StoryLinkKeyMessage | StoryOpenScriptMessage;
export type StoryEditParentMessage =
  | StoryMarkdownTableMessage | StoryMarkdownBlockMessage | StoryInlineMessage | StoryPasteMessage | StoryEditModeMessage | StoryApplyFormatMessage | StoryApplyLinkMessage | StoryFocusTextMessage | StorySelectMessage | StorySpotlightMessage | StoryCommitMessage
  | StoryAnnotationsMessage | StorySelectionActionsMessage;

const EDIT_FRAME_TYPES: ReadonlySet<string> = new Set([
  'mx:edit-error', STORY_BLOCK_EDIT_MESSAGE, STORY_HISTORY_MESSAGE, STORY_FLOW_EDIT_MESSAGE, STORY_EDIT_READY_MESSAGE, STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE, STORY_SELECTION_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE,
  STORY_EDIT_KEY_MESSAGE, STORY_COMMITTED_MESSAGE,
  STORY_LAYOUT_EDIT_MESSAGE, STORY_SLIDE_TITLE_MESSAGE, STORY_IMAGE_DROP_MESSAGE, STORY_IMAGE_REPLACE_MESSAGE,
  STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE,
  STORY_EDIT_FLUSH_MESSAGE, STORY_COMMENT_KEY_MESSAGE, STORY_LINK_KEY_MESSAGE,
  STORY_OPEN_SCRIPT_MESSAGE,
]);
const EDIT_PARENT_TYPES: ReadonlySet<string> = new Set([
  STORY_MARKDOWN_BLOCK_MESSAGE, STORY_MARKDOWN_TABLE_MESSAGE,
  STORY_INLINE_MESSAGE, STORY_PASTE_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_FOCUS_TEXT_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_SPOTLIGHT_MESSAGE, STORY_COMMIT_MESSAGE, STORY_ANNOTATIONS_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE,
]);

/** A frame → parent edit message carrying THIS session's nonce. Anything else — including a forgery — is not one. */
export function isEditFrameMessage(data: unknown, nonce: string): data is StoryEditFrameMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; nonce?: unknown };
  return typeof d.type === 'string' && EDIT_FRAME_TYPES.has(d.type) && d.nonce === nonce;
}

export function isEditParentMessage(data: unknown): data is StoryEditParentMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown };
  return typeof d.type === 'string' && EDIT_PARENT_TYPES.has(d.type);
}

/** What `mutationUnavailable` answers while a write's access check is in flight; the store and the island kit share this one string. */
export const ACCESS_PENDING = 'Checking edit access…';

/**
 * THE LIVE STREAM'S WIRE — what app/a/[id]/events sends and the reader's live
 * store (solid/editor/create-live-artifact, lib/artifact-backend) reads. The
 * subscription that wakes the stream (lib/story/realtime/live) only says "go
 * look"; these are the frames the route then writes, declared here with the
 * rest of the reader wire so neither a route handler nor the server's story
 * module is where a reader has to import a shape from.
 */

/**
 * A DATA wakeup: a dataset this document reads was written, so the queries
 * that read it must re-run.
 */
export interface ArtifactDataEvent {
  /** Dataset artifact ids (today always exactly one — the one that was written). */
  datasets: string[];
  /** The version that dataset reached, for a client that wants to drop a repeat. */
  version: number;
}

/** What the stream sends on a version: the head's identity, nothing else. */
export interface ArtifactVersionPing {
  editId: string;
  version: number;
  /** The handle of the account that made this version, or null. */
  by: string | null;
}

export interface ArtifactLiveEvent {
  document?:DocumentGraph;
  editId: string;
  version: number;
  /**
   * The handle of the account that made this version, or null (a token, an
   * unnamed account, a version that predates attribution). A collaborator's
   * open document can say WHO moved it under them.
   */
  by: string | null;
  format: string;
  title: string | null;
  /** Derived by the server so readers can follow heading edits without loading source parsers. */
  heading?: string | null;
  /** markup source (the document tier) — null for other tiers. */
  source: string | null;
  /**
   * Dataset/viz preview data, which the page displays inline. Images are
   * deliberately absent: it renders straight from ./raw, so the client only
   * needs to know the document changed (the editId) to refetch.
   */
  dataPreview: string | null;
  /**
   * OMITTED when it has not changed since the last frame on this connection.
   * The compiled stylesheet is ~65KB and changes only when new Tailwind
   * classes appear, so sending it with every keystroke-sized edit would
   * dominate the stream. `null` still means "there is none"; absent means
   * "keep what you have".
   */
  compiledCss?: string | null;
  /**
   * The authored DESIGN, sent on every frame (all three are tiny scalars next
   * to the source they accompany). Without them a watcher renders new content
   * under the design it first loaded with — the start-flow moment, where a
   * themeless placeholder becomes a themed deck, arrives unthemed until a
   * reload. `colorMode` is the AUTHOR's default mode; a reader who flipped the
   * mode toggle keeps their override (document-update skips the mode class
   * while one is active) — the rest of the design still applies.
   * `template` never reaches the render — it travels so that entering edit mode
   * after a live change seeds the editor with the genre actually stored.
   */
  theme: StoryDesignName | null;
  colorMode: 'light' | 'dark' | null;
  template: string | null;
  /**
   * The document's BODY, parsed — what a reader's already-open document
   * re-renders itself from (lib/story-runtime/contract StoryDocumentUpdate).
   * The runtime ships no JSX parser, so the nodes are made here, through the
   * same door that builds the served document.
   */
  nodes?: JsxNode[];
  /** The author's own <Helmet> <style>, on the same absent/null rule as compiledCss. */
  authorCss?: string | null;
  /** Legacy Helmet script; null revokes the prior isolated realm. */
  authorScript?: string | null;
  /**
   * The data declarations and their freshly run state — sent ONLY when the
   * declarations changed. A prose edit needs no query engine, and running a
   * document's SQL for every sentence an agent writes would put a DuckDB run
   * behind each one. Absent means "the data is as you have it".
   */
  dataflow?: StoryIslandDataflow;
}
