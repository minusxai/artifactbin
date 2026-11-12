import type {RegionFrameMessage, RegionParentMessage, UploadContext} from '@artifactbin/contracts';
/**
 * The framework-free contract between the document builder (server), the compiler, and the browser
 * islands. BOTH sides import it, so it carries ONLY types and ids: a value
 * here would drag one side's graph into the other's bundle. The Solid
 * composition lives in lib/islands (rt.tsx, boot.ts) and the compiler in
 * lib/compiled-page. The in-place editing and annotation messages are lib/html-bridge/selection-contract's.
 */
/** Live data widget contents belong to Solid, rather than the server-fragment morph. */
export const LIVE_DATA_ATTR = 'data-mx-live';

/** Native frame capability used by comments, presence and live dataset wakeups. */
export interface StoryController {
 readonly nonce:string;send(command:unknown):void;invalidate(datasets:string[]):void;
 subscribe(listener:(event:unknown)=>void):()=>void;getViewportRect():DOMRect;dispose():void;
}
export type IslandStoryController=StoryController;

/** A trusted parent asks its opaque document frame to change the reader's
 * local appearance. It changes no stored document field and grants nothing. */
export const STORY_READER_MODE_MESSAGE = 'mx:reader-mode';

/** Where the app origin keeps the reader's explicit light/dark pick: storage (the shell's pre-paint stamp) and a cookie (its server). */
export const THEME_KEY = 'mx_theme';
/** The query parameter a framed document's first URL carries the reader's stored pick in (lib/document-serving/artifact-page writes it). */
export const READER_MODE_PARAM = 'mx-mode';

/** `search` carrying exactly `mode` as the reader's pick, or none of it (null). Every other param is kept, in order. */
export function withReaderMode(search: string, mode: 'light' | 'dark' | null): string {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part && part.split('=')[0] !== READER_MODE_PARAM);
  if (mode) kept.push(`${READER_MODE_PARAM}=${mode}`);
  return kept.length ? `?${kept.join('&')}` : '';
}

/** The pick a URL's search carries, if any. */
export function readerModeOf(search: string): 'light' | 'dark' | null {
  const value = new URLSearchParams(search).get(READER_MODE_PARAM);
  return value === 'light' || value === 'dark' ? value : null;
}
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
 * `push: true` asks for a new history entry instead of a replaced one (lib/html-runtime/page-route `route.set`).
 * The other way, the app page → its frame, the same `{ type, search }` says what its address holds after the reader's
 * Back or Forward, and the page's route follows it.
 */
export const STORY_URL_VALUES_MESSAGE = 'mx:url-values';

/**
 * A document framed on its own origin → the app page: the reader followed a link to an APP path (root-relative, or
 * absolute on either origin), which would otherwise resolve against the document's origin. `{ type, href }`, `href`
 * a root-relative path with its query and hash. The app page performs the navigation on itself and answers
 * STORY_NAVIGATING_MESSAGE first; a frame that hears no answer takes the top itself (lib/islands/frame-links).
 */
export const STORY_NAVIGATE_MESSAGE = 'mx:navigate';
/** The app page → its framed document: "I am taking this navigation" (`{ type, href }`, the href it was asked for). */
export const STORY_NAVIGATING_MESSAGE = 'mx:navigating';
export interface StoryNavigateMessage { type: typeof STORY_NAVIGATE_MESSAGE | typeof STORY_NAVIGATING_MESSAGE; href: string }

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

/**
 * The SSE event name an ANNOTATIONS wakeup carries on `/a/<id>/events` —
 * delivered only to owner-credentialed connections. Lives here for the same
 * reason STORY_DATA_EVENT does: both ends need the value and only one is a
 * server.
 */
export const STORY_ANNOTATIONS_EVENT = 'annotations';

/* ────────────────────────────────────────────────────────────────────────────
 * THE FRAME BRIDGE — the controller (`StoryController` above) across a window
 * boundary, for a document served on its own origin and framed by the app page
 * (lib/story-runtime/frame-bridge). Both directions are one envelope:
 *
 *   { type: 'mx:frame-bridge', key, payload }
 *
 * `key` is minted by the PAGE (its realm, its crypto) and sent in `attach`; the
 * frame's door (lib/islands/frame-door, installed by lib/islands/page
 * BEFORE the author's script exists) is the only listener that ever sees an
 * envelope — it stops every one from reaching another listener — so the author's
 * script, which shares the frame's realm, never learns the key and cannot forge
 * a reply. Every frame → page envelope carries it; the page drops any without it.
 * The controller's own events ride inside (`event`) with the session `nonce`
 * exactly as the in-page controller emits them, so the page's consumers
 * (create-in-place-edit, AnnotationLayer, SelectionActions) check them unchanged.
 * Origins: the page accepts only the document's own origin (`'null'` for the
 * sandboxed `/a/<id>/raw` in development); the frame accepts only the app's.
 * Geometry in `event`s stays in the FRAME's viewport (lib/html-bridge/selection-contract StoryEditRect); the page
 * adds the iframe's box (StoryController.getViewportRect).
 * ──────────────────────────────────────────────────────────────────────────── */
export const STORY_FRAME_BRIDGE_MESSAGE = 'mx:frame-bridge';

/** PAGE → FRAME: a newer published version (lib/html-runtime/live-morph draws it); the frame answers with one of the three below. */
export const HTML_VERSION_MESSAGE = 'mx:version';
export const HTML_VERSION_APPLIED = 'mx:version-applied';
export const HTML_VERSION_REFUSED = 'mx:version-refused';
/** The frame could not draw the version in place and is rebuilding its document from it, the reader's place kept. */
export const HTML_VERSION_REBUILT = 'mx:version-rebuilt';

/** What the page tells the frame when it attaches: the controller's inputs (createIslandController). */
export interface FrameBridgeAttach {
  kind: 'attach';
  uploadContext?: UploadContext;
  id: string;
  /** The version's SOURCE nodes, which comments and selections are classified against. */
  editId: string;
  source: string | null;
}

/** Page → frame. */
export type FrameBridgeParentPayload =
  | FrameBridgeAttach
  | {kind:'upload-context';context:UploadContext}
  /** The live inputs the controller reads (`editId()`, `initialSource()`), when the page learns newer ones. */
  | { kind: 'context'; editId: string; source: string | null }
  /**
   * How far the page's bars reach over the frame's top edge (edit mode's toolbar, drawn over the frame rather than
   * pushing it down): the document reserves that much above itself and scrolls by the same amount in one task, so
   * nothing in it moves on screen. Absolute; 0 gives the space back.
   */
  | { kind: 'inset'; top: number }
  | { kind: 'send'; command: unknown }
  /**
   * The tree for a session attached without one (`attach.nodes` `[]`), once the page has it: the running controller
   * classifies against it from now on, and a selection made before it arrived is described again (its bubble shown).
   */
  /** The answer to a relayed app request (`fetch`): status, the headers the controller reads, the body as text. */
  | { kind: 'fetch-result'; call: number; status: number; headers: Record<string, string>; body: string }
  | { kind: 'fetch-result'; call: number; error: string }
  | { kind: 'detach' }
  /** Live co-editing of the page's editable regions (contracts region-sessions): bytes only, never a credential. */
  | RegionParentMessage;

/** Frame → page. `hello` is the one unkeyed payload: the door is open and the page may attach. */
export type FrameBridgeFramePayload =
  | { kind: 'hello' }
  /** The controller runs; `nonce` is what its events carry. */
  | { kind: 'ready'; nonce: string; urlValues?: string }
  | { kind: 'event'; event: unknown }
  /**
   * The reader first pressed, touched, typed or selected in a document attached without its tree: the page may ask
   * for the tree now. Once per session. The frame says it itself because a press into a frame on another origin is
   * not otherwise visible to the page (a touch may never even move the page's focus).
   */
  | { kind: 'pressed' }
  /** One of the controller's app requests (IslandControllerInput.appFetch), for the page to make with its session. */
  | { kind: 'upload-file'; call:number; datasetId:string; filename:string; contentType:string; requestId:string; bytes:Uint8Array }
  | { kind: 'fetch'; call: number; path: string; method: 'GET' | 'POST'; headers: Record<string, string>; body: string | null }
  /** The document scrolled: geometry the page placed over it moves. */
  | { kind: 'scroll'; scrollX: number; scrollY: number }
  | { kind: 'error'; message: string }
  /** Live co-editing of the page's editable regions (contracts region-sessions). */
  | Flat<RegionFrameMessage>;
/** Each member of a union as a plain object type (an interface member has no implicit index signature). */
type Flat<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

/** A bridge envelope at all (any key): the door swallows these so no other listener sees one. */
export function isFrameBridgeEnvelope(data: unknown): data is { type: typeof STORY_FRAME_BRIDGE_MESSAGE; key?: unknown; payload: { kind: string } } {
  if (!data || typeof data !== 'object') return false;
  const d = data as { type?: unknown; payload?: unknown };
  return d.type === STORY_FRAME_BRIDGE_MESSAGE && !!d.payload && typeof d.payload === 'object' && typeof (d.payload as { kind?: unknown }).kind === 'string';
}

/**
 * THE LIVE STREAM'S WIRE — what app/a/[id]/events sends and the reader's live
 * store (solid/editor/create-live-artifact, lib/artifact-backend) reads. The
 * subscription that wakes the stream (lib/publish/realtime/live) only says "go
 * look"; these are the frames the route then writes, declared here with the
 * rest of the reader wire so neither a route handler nor the server's story
 * module is where a reader has to import a shape from.
 */

/**
 * A DATA wakeup: a dataset this document reads was written, so the queries
 * that read it must re-run.
 */
export interface ArtifactDataEvent {
  /** Native shared resource names to authoritative committed revisions; wakeups carry no values. */
  revisions?: Record<string, string>;
  /** Dataset artifact ids (today always exactly one — the one that was written). */
  datasets: string[];
  /** The version that dataset reached, for a client that wants to drop a repeat. */
  version: number;
}

/**
 * What the stream sends on a version, and on live text: the head's identity and name, nothing else. A LIVE ping is the
 * same version with a higher `live` (its regions' unsaved typing moved; lib/artifacts current-page): readers follow it
 * exactly as a version, fetching the current page. Sent at most every LIVE_PING_MS per page.
 */
export interface ArtifactVersionPing {
  editId: string;
  version: number;
  /** The page's live revision within `version` (an HTML page); (version, live) orders every ping. */
  live?: number;
  /** The handle of the account that made this version, or null (null for live text, which has no single author). */
  by: string | null;
  /** The current page's title (a doc is named by its heading, live): the page's header follows it. */
  title: string | null;
}

/** Native version metadata; page bytes are read through the HTML door. */
export interface ArtifactLiveEvent {
 editId:string;version:number;by:string|null;format:string;title:string|null;heading?:string|null;
 source:string|null;dataPreview:string|null;theme:import('@/lib/validation/story-theme-names').StoryDesignName|null;
 colorMode:'light'|'dark'|null;template:string|null;
}
