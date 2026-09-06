/**
 * The react-free contract between the document builder (server), the SSR
 * bundle, and the in-iframe hydration runtime. This file is importable from
 * the Next server graph (route handlers compile under the react-server
 * condition, where client-React APIs are forbidden) — so it carries ONLY types
 * and ids. The React composition lives in StoryRuntimeApp.tsx, which reaches
 * the server exclusively as a prebuilt esbuild bundle (story-ssr.cjs) loaded
 * outside the module graph — see scripts/build-story-runtime.mjs.
 */
import type { AnnotationRange } from '@/lib/story/annotation-range';
import type { JsxNode } from '@/lib/jsx';
import type { GlyphMap } from '@/lib/story-ui/icon-contract';
import type { RefDataMap } from '@/lib/story/ref-data';
import type { Dataflow, DataflowState, Scalar } from '@/lib/story/dataflow';
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';

/** The document's data as the island carries it: what is declared, and its state at render. */
export interface StoryIslandDataflow {
  flow: Dataflow;
  /**
   * The rows, when somebody has already run them. ABSENT is the reader's
   * normal case — paint first: the document arrives with its declarations and
   * fetches its own rows, so first paint is not held behind the SQL. Present
   * for a CAPTURE (the exporter photographs that frame) and for the editor's
   * canvas, both of which need a settled document rather than a fast one.
   */
  state?: DataflowState;
  /**
   * SPIKE S1 (F2): the reader's own `<Value>` choices, carried in the URL
   * (`?$region=west`) and parsed server-side. Values WITHOUT rows — which is
   * exactly why they are their own field rather than a synthetic `state`:
   * `state` present means "somebody already ran the queries", so seeding
   * through it would cancel the document's first run and leave every chart on
   * its skeleton. These fold in as the store's starting values and the
   * paint-first run happens WITH them.
   */
  values?: Record<string, Scalar>;
}

/**
 * A dataflow that HAS been run. Running it always produces state — only the
 * island may arrive without it — so the two are different types and a caller
 * that ran the queries never has to re-check for what it just computed.
 */
export interface RanDataflow extends StoryIslandDataflow {
  state: DataflowState;
}

/** What the document's JSON island carries — everything the entry needs to hydrate. */
export interface StoryIslandData {
  nodes: JsxNode[];
  refData: RefDataMap;
  /**
   * The document's structural genre. Unlike the genre's authored layout, the
   * editorial value also opts a sectioned document into the Contents rail.
   * Null/absent means no template-specific reading chrome.
   */
  template?: string | null;
  /**
   * The `<Icon>` glyphs this document uses, resolved server-side
   * (lib/story/icon-glyphs). A separate channel from the AST on purpose: the
   * glyph is injected as raw markup, so a map an author could write into would
   * be an injection hole. Absent for a document that draws no icons.
   */
  glyphs?: GlyphMap;
  /**
   * The `<Value>`/`<Query>`/`<Mutation>` declarations and their render-time state
   * (lib/story/dataflow.ts). Absent for a document that declares nothing.
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
   * Where this document's WRITES go when it is the TOP-LEVEL page:
   * `POST <mutateUrl> { mutation, values }` (app/a/[id]/mutate), the one other
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
}

/** The GET query endpoint's one parameter: the JSON of a QueryRequest (lib/story/query-request). */
export const QUERY_REQUEST_PARAM = 'q';

/** DOM contract between the builder and the entry. */
export const STORY_ROOT_ID = 'mx-story-root';
export const STORY_ISLAND_ID = 'mx-story-data';

/**
 * The author's Helmet <script> is emitted with THIS type, which no browser
 * executes, and the runtime re-injects it as a real classic script once
 * hydration has finished (lib/story-runtime/entry).
 *
 * Ordering is the whole point: the runtime is a module (deferred), so a plain
 * inline script would run BEFORE hydration and any DOM it changed inside the
 * story root would be reconciled away — or worse, break hydration. Re-injecting
 * keeps classic-script semantics (globals, `var`, no module scope) while
 * guaranteeing the document the script sees is the hydrated one.
 */
export const AUTHOR_SCRIPT_TYPE = 'text/mx-author';

/** Fired on `document` after hydration and before the author script runs. */
export const STORY_READY_EVENT = 'mx:ready';

/**
 * Posted to the parent the moment the document's own markup has PARSED —
 * which is when it is visually ready, long before its scripts finish.
 *
 * The page shows its own copy of the text until the frame can take over, and
 * gating that on the frame's `load` event kept the fallback up until the last
 * byte of the runtime had arrived (measured: still swapped-out at 2.5s on a
 * slow link, for a document that had painted at ~700ms).
 */
export const STORY_PAINTED_MESSAGE = 'mx:painted';

/**
 * The other half of that signal: the page asking, rather than only listening.
 *
 * Announcing is a burst with an end, and the page's own listener attaches at
 * hydration — so a page that hydrates after the burst hears nothing and keeps
 * a live document hidden, transparent, forever. A question cannot be early or
 * late: the page asks until it is told.
 */
export const STORY_HELLO_MESSAGE = 'mx:hello';

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
 * A NEW VERSION OF THIS DOCUMENT, posted in by the parent page.
 *
 * The page holds the live stream (an opaque frame cannot open an EventSource
 * against our origin), and used to deliver what it heard by REPLACING the
 * frame: the document re-fetched, re-parsed and re-hydrated, every chart
 * rebuilt, the reader's scroll position and their `<Value>` choices gone —
 * once per agent write. The document is a React tree, so a new version of it
 * is a re-render, and this message is that version.
 *
 * `nodes` is the body in the same shape the island carries, because the
 * runtime deliberately ships no JSX parser. Style fields follow the stream's
 * own convention: ABSENT means "unchanged", null means "there is none".
 */
export const STORY_DOCUMENT_MESSAGE = 'mx:document';

export interface StoryDocumentUpdate {
  type: typeof STORY_DOCUMENT_MESSAGE;
  nodes: JsxNode[];
  /**
   * The declarations as a flow. `state` is OPTIONAL: a live frame carries the
   * flow and no rows (the store re-runs every query through its transport);
   * the page's own island carries both.
   */
  /**
   * Refs the document did not have when it was served — MERGED, not replaced.
   * An image inserted while editing is a brand-new artifact, so the island's
   * map cannot know it, and the interpreter renders the literal `ref:<id>`
   * string into `src` (a broken image, naturalWidth 0) until a full reload.
   */
  refData?: RefDataMap;
  /**
   * The declarations as a flow. `state` is OPTIONAL: a live frame carries the
   * flow and no rows (the store re-runs every query through its transport —
   * lib/story/frame); the page's own island and the editor carry both.
   */
  dataflow?: { flow: StoryIslandDataflow['flow']; state?: StoryIslandDataflow['state'] };
  /** The compiled per-document stylesheet (data-mx-tw). */
  compiledCss?: string | null;
  /** The author's own <Helmet> <style> (data-mx-author). */
  authorCss?: string | null;
  theme?: string | null;
  colorMode?: 'light' | 'dark';
}

/**
 * "Adopted." The page cannot assume a document can update itself: one with no
 * components ships no runtime at all, and one whose script threw never got
 * here. Silence is the signal to fall back to replacing the frame, so this ack
 * is what keeps a reader from sitting on a version that has moved on.
 */
export const STORY_DOCUMENT_ACK_MESSAGE = 'mx:document-ack';

/**
 * "I can adopt a new version." Announced by the hydration runtime as it starts,
 * so a page holding an update knows whether waiting for an ack is worth
 * anything: a document with no components ships no runtime at all, and waiting
 * three seconds to discover that is three seconds of a reader looking at an
 * edit that has already been made.
 */
export const STORY_ADOPTS_MESSAGE = 'mx:adopts';

/**
 * WHERE THE READER IS, so it survives the trip between the document's two
 * renderings (lib/story/scroll-anchor).
 *
 * The document PUSHES this as it scrolls rather than answering a request:
 * pressing edit unmounts the frame in the same commit that flips the mode, so
 * an ask has nothing left to answer it, and awaiting one would tax exactly the
 * transition this exists to make feel instant. The page simply always holds a
 * current position.
 *
 * The other direction is a request, because it can be: the page tells a freshly
 * painted document where to sit and waits for the ack before revealing it —
 * otherwise the reader watches it jump.
 */
export const STORY_ANCHOR_MESSAGE = 'mx:anchor';
export const STORY_ANCHOR_APPLY_MESSAGE = 'mx:anchor-apply';

/**
 * The runtime's private hook for adopting a new version of this document,
 * installed on `window` by the hydration entry.
 *
 * It exists because the two halves of a live update ship separately: the piece
 * that HEARS the edit is a ~1.5KB module every document loads (it also carries
 * the reading position), and the piece that can re-render a React tree is the
 * ~1.3MB runtime that only a document with components or data loads at all.
 * Deliberately not part of `window.mx`, which is the author's API.
 */
export const STORY_ADOPT_HOOK = '__mxAdoptDocument';

/**
 * The reader flipped the mode toggle (anchor-entry wires the click; the button
 * itself is server-rendered chrome). Same split as the adopt hook: the class
 * flip works without React, but chart ink follows the `colorMode` PROP, so a
 * document that hydrated must also re-render — the runtime registers this and
 * the ~1.5KB module calls it when present.
 */
export const STORY_MODE_HOOK = '__mxSetColorMode';

/** A trusted parent asks its opaque document frame to change the reader's
 * local appearance. It changes no stored document field and grants nothing. */
export const STORY_READER_MODE_MESSAGE = 'mx:reader-mode';
export interface StoryReaderModeMessage {
  type: typeof STORY_READER_MODE_MESSAGE;
  mode: 'light' | 'dark';
}

/**
 * A FRAMED document's reader chrome asks its trusted parent to act. The chrome
 * is drawn inside the document so it looks the same for everyone, but a frame
 * holds no session: like, comment, follow, edit, share and the two panels are
 * the PAGE's to perform, and it answers `share` so the frame can say "copied".
 */
export const STORY_READER_ACTION_MESSAGE = 'mx:reader-action';
export type StoryReaderActionKind = 'like' | 'comment' | 'share' | 'follow' | 'edit' | 'controls' | 'menu';
export interface StoryReaderActionMessage {
  type: typeof STORY_READER_ACTION_MESSAGE;
  kind: StoryReaderActionKind;
  author?: string | null;
}
export const STORY_READER_ACTION_RESULT_MESSAGE = 'mx:reader-action-result';
export interface StoryReaderActionResultMessage {
  type: typeof STORY_READER_ACTION_RESULT_MESSAGE;
  kind: StoryReaderActionKind;
  ok: boolean;
  /** `like`: the door's answer. */
  liked?: boolean;
  /** `follow`: the door's answer. */
  following?: boolean;
  count?: number;
}
/**
 * The parent sets the framed chrome's mode: `on` (the reveal-on-scroll rule),
 * `off` (gone), or `pinned` — held at the top for EDIT MODE, where the page's
 * editor toolbar sits under it; `inset` is that toolbar's height, which the
 * document adds under its own bar so nothing it shows is covered.
 */
export const STORY_READER_CHROME_MESSAGE = 'mx:reader-chrome';
export interface StoryReaderChromeMessage {
  type: typeof STORY_READER_CHROME_MESSAGE;
  mode: 'on' | 'off' | 'pinned';
  inset?: number;
}

/** A framed document's scroll port lives across an opaque-origin boundary
 * from the page chrome. This unprivileged sample lets the parent apply its
 * mobile bar visibility policy; the parent still checks the source window. */
export const STORY_SCROLL_MESSAGE = 'mx:reader-scroll';
export interface StoryScrollMessage {
  type: typeof STORY_SCROLL_MESSAGE;
  scrollY: number;
  /** The document's own scrollbar width, so page chrome drawn over the frame can stop where the document's does. */
  gutter?: number;
  /**
   * "I have nothing further to scroll to" — the ANSWER, not the ingredients.
   * The parent cannot measure an opaque frame's height, so it used to compare
   * this offset against its OWN metrics; on the artifact page those never move,
   * so the end-of-page rule (the bar stays up where the footer is) was lost for
   * every framed document. The document measures its own end instead, with the
   * same 4px slack the page uses for its own.
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

export const STORY_QUERY_MESSAGE = 'mx:query';
export const STORY_QUERY_RESULT_MESSAGE = 'mx:query-result';

export interface StoryQueryRequest {
  type: typeof STORY_QUERY_MESSAGE;
  id: number;
  values: Record<string, Scalar>;
  only: string[];
  /** A window of one query (a table reading past the cap) — see lib/sql/engine QueryPage. */
  page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } };
}

export type StoryQueryResult =
  | { type: typeof STORY_QUERY_RESULT_MESSAGE; id: number; tables: DataflowState['tables']; errors: DataflowState['errors']; mutationAccess?: DataflowState['mutationAccess'] }
  | { type: typeof STORY_QUERY_RESULT_MESSAGE; id: number; error: string };

/**
 * THE ASSET RELAY — the third thing a framed document cannot do for itself.
 *
 * A bound `<img src="$pick">` names a URL only the reader can compute, and the
 * document imports it through its own endpoint (`/a/<id>/assets?u=…`). Loading
 * that as an `<img>` works top-level and CANNOT work inside a parent: the frame
 * is opaque-origin, so its subresource requests carry no cookie, and the
 * endpoint therefore sees an anonymous caller from inside every framed document
 * — the owner's own copy of their PRIVATE document included, where the read ACL
 * then answers the uniform 404. That is not an edge case: a signed-in user's
 * document is born private.
 *
 * So the frame asks the PAGE, exactly as it does for a query and a write, and
 * the page — which holds the session — calls the endpoint and posts back the
 * ADDRESS of our copy. That address is `/assets/<hash>`, which needs no
 * credential at all (content-addressed from the URL, serving nothing the source
 * host does not), which is the whole reason a relay can answer this: what
 * crosses back is a public address, never bytes and never a credential.
 */
export const STORY_ASSET_MESSAGE = 'mx:asset';
export const STORY_ASSET_RESULT_MESSAGE = 'mx:asset-result';

export interface StoryAssetRequest {
  type: typeof STORY_ASSET_MESSAGE;
  id: number;
  /** The web URL the document ended up with — never a path, never ours. */
  url: string;
}

export type StoryAssetResult =
  /** Where our copy lives: `/assets/<hash>`. */
  | { type: typeof STORY_ASSET_RESULT_MESSAGE; id: number; url: string }
  /** The importer's own code (`forbidden_address`, `too_large`, `rate_limited`, …). */
  | { type: typeof STORY_ASSET_RESULT_MESSAGE; id: number; refused: string };

/**
 * THE WRITE RELAY — the same shape as the query relay, for the same reason: a
 * document inside a parent page cannot present a session, and a PRIVATE
 * document's writes must. The frame posts a mutation NAME and its values, the
 * page POSTs /a/<id>/mutate and posts the answer back.
 */
export const STORY_MUTATE_MESSAGE = 'mx:mutate';
export const STORY_MUTATE_RESULT_MESSAGE = 'mx:mutate-result';

export interface StoryMutateRequest {
  type: typeof STORY_MUTATE_MESSAGE;
  id: number;
  mutation: string;
  values: Record<string, Scalar>;
  row?: Record<string, Scalar>;
}

export type StoryMutateResult =
  | { type: typeof STORY_MUTATE_RESULT_MESSAGE; id: number; ok: true; dataset: string; version: number; affected: number }
  | { type: typeof STORY_MUTATE_RESULT_MESSAGE; id: number; ok: false; error: string };

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
 * module importing a VALUE from a route handler pulls that route — and
 * `next/headers` with it — into the browser bundle, which is a build failure,
 * not a size regression.
 */
/**
 * FRAME → PAGE: the reader changed a `<Value>`, and this is the document's
 * whole scalar state after the change.
 *
 * A document served TOP-LEVEL writes its own address through the one narrow
 * capability its history prelude leaves open (`__mxValues`). A FRAMED one
 * cannot: `location` inside the frame is the frame's, so writing there moves
 * `/a/<id>/raw?edit=1`, which nobody can see or copy — measured on the spike,
 * and the reason this message exists at all.
 *
 * Signed like every other frame → page message, because the author's script
 * shares this realm. And the page does not simply write what arrives: it
 * re-derives the address through `writeUrlValues` against the flow IT holds,
 * so a frame can never put a name the document does not declare into the
 * address bar.
 */
/**
 * The TOP-LEVEL document's own narrow URL capability, installed by the history
 * prelude (lib/story/document HISTORY_PRELUDE) — the one window left open in
 * an otherwise frozen History API. It takes `{name: string | null}`: a string
 * sets `$name`, `null` removes it, and it reads the path and hash fresh at
 * call time so no address ever arrives as an argument.
 *
 * Named here rather than only inside that string so the runtime and the
 * prelude cannot drift apart; the prelude BUILDS its `defineProperty` from
 * this constant.
 */
export const STORY_VALUES_HOOK = '__mxValues';

export const STORY_VALUES_MESSAGE = 'mx:values';

export interface StoryValuesMessage {
  type: typeof STORY_VALUES_MESSAGE;
  nonce: string;
  /** Every scalar the document declares, at its current value. */
  values: Record<string, Scalar>;
}

/** A `mx:values` carrying THIS session's nonce — anything else is author code. */
export function isValuesMessage(data: unknown, nonce: string): data is StoryValuesMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; nonce?: unknown; values?: unknown };
  return d.type === STORY_VALUES_MESSAGE && d.nonce === nonce
    && !!d.values && typeof d.values === 'object' && !Array.isArray(d.values);
}

export const STORY_DATA_EVENT = 'data';

export interface StoryDataUpdate {
  type: typeof STORY_DATA_MESSAGE;
  datasets: string[];
}

/** Shape of the prebuilt SSR bundle (lib/story-runtime/dist/story-ssr.cjs). */
export interface StorySsrBundle {
  renderStoryBody: (data: StoryIslandData) => string;
  /**
   * The document's `<Icon>` glyphs. Reached through the bundle rather than
   * imported, for the same reason renderStoryBody is: resolving one renders
   * lucide's client components, which a route handler may not do.
   */
  glyphsForNodes: (nodes: JsxNode[]) => GlyphMap;
}

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

/** First thing the runtime says to its parent: here is this session's nonce. Posted before any author code exists. */
export const STORY_SESSION_MESSAGE = 'mx:session';
export interface StorySessionMessage { type: typeof STORY_SESSION_MESSAGE; nonce: string }

/** Parent → frame: enter or leave edit mode. The frame lazy-loads its edit chunk on the first `on`. */
export const STORY_EDIT_MODE_MESSAGE = 'mx:edit-mode';
export interface StoryEditModeMessage { type: typeof STORY_EDIT_MODE_MESSAGE; on: boolean }

/** Frame → parent: edit mode is live (hosts are editable and listening). */
export const STORY_EDIT_READY_MESSAGE = 'mx:edit-ready';
export interface StoryEditReadyMessage { type: typeof STORY_EDIT_READY_MESSAGE; nonce: string }

/**
 * Frame → parent: the user finished editing a text host (blur), or is about to
 * have a format applied mid-word. `innerHtml` is the host's contenteditable
 * output — rich inline HTML, possibly hostile; the parent composes it through
 * the same sanitizing write-back the canvas used (lib/data/story/jsx-edit).
 */
export const STORY_TEXT_EDIT_MESSAGE = 'mx:text-edit';
export interface StoryTextEditMessage { type: typeof STORY_TEXT_EDIT_MESSAGE; nonce: string; path: string; innerHtml: string }

/** Frame → parent: there is uncommitted typing (from the first `input` to the commit). Gates remote adoption. */
export const STORY_TYPING_MESSAGE = 'mx:typing';
export interface StoryTypingMessage { type: typeof STORY_TYPING_MESSAGE; nonce: string; active: boolean }

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
  /** 'text': a focused editable host · 'element': a click-selected container · 'embed': a component. */
  kind: 'text' | 'element' | 'embed';
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
   * A comment stores them beside its anchor (lib/story/annotation-range).
   */
  quote?: string;
  /** Where those words are, addressed RELATIVE to `path` — never an absolute body path. */
  range?: AnnotationRange;
}

/** Frame → parent: the selection changed, or moved (re-posted on in-frame scroll, throttled to a frame). */
export const STORY_SELECTION_MESSAGE = 'mx:selection';
export interface StorySelectionMessage { type: typeof STORY_SELECTION_MESSAGE; nonce: string; selection: StoryEditSelection | null }

/**
 * Frame → parent: the owner selected readable text in view mode and chose the
 * small contextual Edit/Annotate action. The containing source node travels
 * with the request so the destination mode opens on what they were reading.
 */
export const STORY_SELECTION_ACTION_MESSAGE = 'mx:selection-action';
export interface StorySelectionActionMessage {
  type: typeof STORY_SELECTION_ACTION_MESSAGE;
  nonce: string;
  action: 'edit' | 'annotate';
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
export interface StoryImageDropMessage { type: typeof STORY_IMAGE_DROP_MESSAGE; nonce: string; file: File }

/** Frame → parent: Delete/Backspace pressed while NO text host had focus — the parent decides what it removes. */
export const STORY_EDIT_KEY_MESSAGE = 'mx:edit-key';
export interface StoryEditKeyMessage { type: typeof STORY_EDIT_KEY_MESSAGE; nonce: string; key: 'Delete' | 'Backspace' | 'Escape' }

/**
 * Parent → frame: apply a format to an element NOW, locally, without a
 * re-render — the toolbar's instant feedback. Each present field is the
 * attribute's full new value; '' removes it. The parent composes the same
 * edit into the source; the frame's DOM already shows it.
 */
export const STORY_APPLY_FORMAT_MESSAGE = 'mx:apply-format';
export interface StoryApplyFormatMessage { type: typeof STORY_APPLY_FORMAT_MESSAGE; path: string; className?: string; style?: string }

/**
 * Parent → frame: wrap the current text selection inside the host at `path`
 * in a link (or unwrap with href null). Only the frame holds the live
 * Selection; it answers with an `mx:text-edit` carrying the new innerHTML.
 */
export const STORY_APPLY_LINK_MESSAGE = 'mx:apply-link';
export interface StoryApplyLinkMessage { type: typeof STORY_APPLY_LINK_MESSAGE; path: string; href: string | null }

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
export interface StoryLayoutEditMessage {
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
export interface StorySlideTitleMessage {
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
export interface StoryCommitMessage { type: typeof STORY_COMMIT_MESSAGE }
export interface StoryCommittedMessage { type: typeof STORY_COMMITTED_MESSAGE; nonce: string }

/** Parent → frame: select an element by path (a breadcrumb click, a panel opening), or clear with null. */
export const STORY_SELECT_MESSAGE = 'mx:select';
export interface StorySelectMessage { type: typeof STORY_SELECT_MESSAGE; path: string | null }

/* ────────────────────────────────────────────────────────────────────────────
 * ANNOTATIONS — comments the owner pins to nodes; the frame only ever sees
 * ids + BODY paths (content, threads and the session stay on the page).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Parent → frame: the pin set, one idempotent message — re-posted whole
 * whenever the list changes, so the frame holds no annotation state it could
 * get out of step on. `pins` are the OPEN, non-orphaned roots by BODY path.
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
  type: typeof STORY_ANNOTATIONS_MESSAGE;
  mode: 'off' | 'on';
  /**
   * The anchored nodes: `key` is the node's opaque annotation-anchor key (the
   * durable anchor — plain tags carry it into the DOM), `path` the body path
   * fallback (components keep the attribute in source only).
   */
  pins: Array<{
    id: string;
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
}

/** Frame → parent: the owner clicked an annotated node to open its thread. */
export const STORY_ANNOTATION_PIN_MESSAGE = 'mx:annotation-pin';
export interface StoryAnnotationPinMessage {
  type: typeof STORY_ANNOTATION_PIN_MESSAGE;
  nonce: string;
  id: string;
  rect: StoryEditRect;
}

/** Frame → parent: the pointer entered or left an annotated document node. */
export const STORY_ANNOTATION_HOVER_MESSAGE = 'mx:annotation-hover';
export interface StoryAnnotationHoverMessage {
  type: typeof STORY_ANNOTATION_HOVER_MESSAGE;
  nonce: string;
  id: string | null;
}

/** Frame → parent: the current viewport geometry of every anchored open thread. */
export const STORY_ANNOTATION_LAYOUT_MESSAGE = 'mx:annotation-layout';
export interface StoryAnnotationLayoutMessage {
  type: typeof STORY_ANNOTATION_LAYOUT_MESSAGE;
  nonce: string;
  positions: Array<{ id: string; rect: StoryEditRect }>;
}

/**
 * The SSE event name an ANNOTATIONS wakeup carries on `/a/<id>/events` —
 * delivered only to owner-credentialed connections. Lives here for the same
 * reason STORY_DATA_EVENT does: both ends need the value and only one is a
 * server.
 */
export const STORY_ANNOTATIONS_EVENT = 'annotations';

export type StoryEditFrameMessage =
  | StoryEditReadyMessage | StoryTextEditMessage | StoryTypingMessage | StorySelectionMessage
  | StorySelectionActionMessage
  | StoryEditKeyMessage | StoryCommittedMessage | StoryLayoutEditMessage | StorySlideTitleMessage
  | StoryImageDropMessage | StoryAnnotationPinMessage | StoryAnnotationHoverMessage | StoryAnnotationLayoutMessage;
export type StoryEditParentMessage =
  | StoryEditModeMessage | StoryApplyFormatMessage | StoryApplyLinkMessage | StorySelectMessage | StoryCommitMessage
  | StoryAnnotationsMessage | StorySelectionActionsMessage;

const EDIT_FRAME_TYPES: ReadonlySet<string> = new Set([
  STORY_EDIT_READY_MESSAGE, STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE, STORY_SELECTION_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE,
  STORY_EDIT_KEY_MESSAGE, STORY_COMMITTED_MESSAGE,
  STORY_LAYOUT_EDIT_MESSAGE, STORY_SLIDE_TITLE_MESSAGE, STORY_IMAGE_DROP_MESSAGE,
  STORY_ANNOTATION_PIN_MESSAGE, STORY_ANNOTATION_HOVER_MESSAGE, STORY_ANNOTATION_LAYOUT_MESSAGE,
]);
const EDIT_PARENT_TYPES: ReadonlySet<string> = new Set([
  STORY_EDIT_MODE_MESSAGE, STORY_APPLY_FORMAT_MESSAGE, STORY_APPLY_LINK_MESSAGE, STORY_SELECT_MESSAGE,
  STORY_COMMIT_MESSAGE, STORY_ANNOTATIONS_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE,
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

export function isSessionMessage(data: unknown): data is StorySessionMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; nonce?: unknown };
  return d.type === STORY_SESSION_MESSAGE && typeof d.nonce === 'string' && d.nonce.length >= 16;
}
