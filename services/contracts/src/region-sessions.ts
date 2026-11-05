/**
 * Live co-editing of a page's declared editable regions (`data-af-editable="rich"|"text"`): the HTTP, stream and
 * frame-bridge contract between the trusted app (lib/region-sessions, the parent frame client) and the editor
 * inside the page frame (@afbin/regions). The merge core is lib/live-regions.
 *
 * Decisions this contract encodes (plan: https://app.artifactbin.dev/a/vYfqsF):
 * - Only people with edit access to the page edit regions. Everyone who may read the page reads its live text: the
 *   live state IS the document (the app's current page), followed live, with no save.
 * - Versions are checkpoints in history, created on EVENTS, never on a short timer: an author or agent write, a flush
 *   (before a comment, when the last editor leaves, on request) or the idle save after two quiet minutes. The live
 *   state between versions is durable in the region tables, so the page version rarely moves under people.
 * - Every incoming update is validated on the server against the region's schema before it is stored or relayed.
 * - Binary Yjs payloads travel base64 over HTTP/SSE and as Uint8Array over postMessage.
 */

export type RegionKind = 'rich' | 'text';

/** Postgres NOTIFY channel waking a page's region streams (wakeups say "go look", never carry content). */
export const regionsChannel = (artifactId: string): string => `regions_${artifactId.toLowerCase()}`;

/** Largest single update a client may send. */
export const REGION_UPDATE_MAX_BYTES = 262_144;
/** Largest merged region text, in UTF-16 code units. */
export const REGION_TEXT_MAX_UNITS = 1_000_000;
/**
 * A region with unsaved edits and no new update for this long is saved as a version: a checkpoint in history. Nobody
 * waits for it (readers, the title and agents follow the live text itself), so typing that never pauses is never cut.
 */
export const REGION_IDLE_SAVE_MS = 120_000;

/** `POST /api/artifacts/:id/regions/:regionId/open` */
export interface RegionOpenReply {
  regionId: string;
  kind: RegionKind;
  /** The Yjs client id this session must write with; updates from any other client id are refused. */
  clientId: number;
  /** Sequence number of the last update folded into `state`. */
  seq: number;
  /** Full merged Yjs state, base64. */
  state: string;
  /** The page version this live state was last saved as. */
  savedVersion: number;
}

/** `POST /api/artifacts/:id/regions/:regionId/updates` */
export interface RegionUpdateRequest {
  clientId: number;
  /** One Yjs update (possibly merged from several), base64. */
  update: string;
}
export interface RegionUpdateReply {
  seq: number;
  /** The update held nothing the server did not already have (a retry). */
  duplicate?: true;
}

/** `POST /api/artifacts/:id/regions/flush`: save every region with unsaved edits as one new page version. */
export interface RegionFlushReply {
  /** The page version that now holds every region's text (unchanged when nothing was unsaved). */
  version: number;
}

/**
 * AGENTS read and write a region's text over the bearer API (operations read_region, write_region, save_regions).
 * A read is the region at the page's saved head, with that version: to include unsaved typing, save first
 * (`POST /api/artifacts/:id/regions/flush`). A write is made from a version it read (`base_version`) and is merged
 * three-way from that version's snapshot into the live state, so nobody's unsaved typing is lost; it is streamed to
 * the editors and saved as a new version at once.
 *
 * `_doc` (outside the region id grammar, so never a declared id) names the page's only rich region: a doc's text.
 */
export const DOC_REGION = '_doc';
export type RegionFormat = 'markdown' | 'html';

/** `GET /api/artifacts/:id/regions/:regionId?format=markdown|html` (default markdown). Exactly one of markdown, html. */
export interface RegionContentReply {
  regionId: string;
  kind: RegionKind;
  /** The saved page version the content is from: send it back as `base_version`. */
  version: number;
  markdown?: string;
  html?: string;
}

/** `PUT /api/artifacts/:id/regions/:regionId` (Idempotency-Key honoured). Exactly one of markdown, html. */
export interface RegionWriteRequest {
  markdown?: string;
  html?: string;
  base_version: number;
}
export interface RegionWriteReply {
  regionId: string;
  kind: RegionKind;
  /** The new saved page version holding the write and everyone's typing (the head, when nothing changed). */
  version: number;
  /** The region as saved, merged. */
  html: string;
  /** The same, as Markdown, when the write was Markdown. */
  markdown?: string;
}

export type RegionRefusalCode =
  | 'region_ambiguous'
  | 'unsupported_content'
  | 'foreign_client'
  | 'outside_region'
  | 'out_of_order'
  | 'too_large'
  | 'region_not_found'
  | 'region_snapshot_missing'
  /** A cell update whose text the dataset's update rule `check` refuses (it would never save). */
  | 'check_violation';

export interface RegionRefusalBody {
  error: RegionRefusalCode;
  /** With `out_of_order`: the server's state vector, base64, so the client can resend what is missing. */
  stateVector?: string;
  /** With `unsupported_content`: each thing the region's kind cannot hold, once (`<img>`, `several blocks in one <li>`). */
  details?: string[];
  /** With an agent's `region_snapshot_missing`: the page's saved head, to read again from. */
  version?: number;
  /** With `region_not_found` and `region_ambiguous` from an agent's door: the regions the saved page declares. */
  regions?: { regionId: string; kind: RegionKind }[];
}

/** `GET /api/artifacts/:id/regions/stream?after=<regionId>:<seq>,...` — SSE `data:` frames, JSON. */
export type RegionStreamFrame =
  | { type: 'updates'; regionId: string; from: number; to: number; updates: string[] }
  | { type: 'reset'; regionId: string; seq: number; state: string }
  | { type: 'saved'; version: number; regions: Record<string, number> }
  /** `rejected` (cells): the dataset refused to save the cell's merged text; its unsaved typing was not kept. */
  | { type: 'closed'; regionId: string; reason: 'removed' | 'kind_changed' | 'access' | 'rejected' };

/** A collaborator's caret inside a region, as Yjs relative positions (base64, at most 256 bytes each). */
export interface RegionCaret {
  regionId: string;
  anchor: string;
  head: string;
}

/** Parent (trusted app) → page frame. */
export type RegionParentMessage =
  | { kind: 'regions-enabled'; regionIds: string[] }
  | { kind: 'region-session'; regionId: string; regionKind: RegionKind; clientId: number; state: Uint8Array; seq: number }
  | { kind: 'region-remote'; regionId: string; updates: Uint8Array[]; seq: number }
  /**
   * `settled` (cells): everything the frame wrote is stored — the count of its `region-update`s the page had received
   * then, so the frame knows whether what it wrote since is still pending.
   */
  | { kind: 'region-ack'; regionId: string; seq: number; settled?: number }
  | { kind: 'region-closed'; regionId: string; reason: string }
  | { kind: 'region-paint'; carets: (RegionCaret & { id: string; label: string })[] }
  | { kind: 'region-command'; regionId: string; name: string; args?: Record<string, unknown> };

/** Page frame → parent. */
export type RegionFrameMessage =
  | { kind: 'region-open'; regionId: string }
  | { kind: 'region-update'; regionId: string; update: Uint8Array }
  | ({ kind: 'region-caret'; marks: string[]; block: string } & RegionCaret)
  | { kind: 'region-blur' }
  | { kind: 'region-slash'; regionId: string; x: number; y: number }
  /** Mod-K in the editor: the parent asks for a link URL (`href` is the link at the caret, if any). */
  | { kind: 'region-link'; regionId: string; href: string | null };

/**
 * LIVE DATASET TEXT CELLS (`@afbin/collab`): a page binds one text cell of a dataset it links to an input or textarea,
 * and everyone allowed to change that cell types in it live, with the same merge as regions. A cell is a session scope
 * beside a region: its key rides every region message, route and stream cursor where a region id would.
 *
 * - The key names the PAGE's dataset link (its `data-af-name`), the row's `_id` and the column's GraphQL field name.
 *   The server resolves the link through the page's saved head; storage is keyed by the dataset, so every page
 *   linking one dataset shares one live cell.
 * - Authority is the caller's dataset role through the page and the dataset policy's update rule for that row and
 *   column (filter and columns), checked at open, on every update and on every stream wakeup. Anonymous never writes.
 *   The dataset owner opts a text column in with the policy's table key `collaborative_columns`; any other column
 *   cannot be opened (owners and editors included).
 * - The cell's live text is one Y.Text (the region root) holding the raw string, newlines included, no terminator;
 *   validated as a plain `text` region. Saves write the merged string through the dataset's mutate path (one dataset
 *   version), on events, as regions do. Another write to the dataset (GraphQL, SQL, an upload) is merged three-way into
 *   the live text from the value the cell last saw; a deleted row closes its cells (`closed`, `removed`).
 * - An update whose text the rule's `check` refuses is `check_violation` (422); a save the dataset still refuses closes
 *   the cell for everyone (`closed`, `rejected`) and drops its unsaved text, so a cell is never left silently dirty.
 * - A cell stream carries cells only (never regions); `POST …/regions/flush?scope=cells` saves the caller's cells.
 */
export interface CellScope {
  /** The page's dataset link name. */
  dataset: string;
  /** The row's `_id`. */
  rowId: string;
  /** The column's GraphQL field name. */
  column: string;
}
const CELL_KEY = /^cell:([_A-Za-z][_0-9A-Za-z]{0,63}):(r_[A-Za-z0-9_-]{1,128}):([_A-Za-z][_0-9A-Za-z]{0,63})$/;
/** A cell's session key, used wherever a region id is (messages, routes, stream cursors). */
export const cellKey = (scope: CellScope): string => `cell:${scope.dataset}:${scope.rowId}:${scope.column}`;
export const isCellKey = (value: unknown): value is string => typeof value === 'string' && CELL_KEY.test(value);
export function parseCellKey(value: unknown): CellScope | null {
  const match = typeof value === 'string' ? CELL_KEY.exec(value) : null;
  return match ? { dataset: match[1]!, rowId: match[2]!, column: match[3]! } : null;
}
/** A bound cell's state in the page: every local edit acknowledged, some not yet, no connection, or not editable here. */
export type CollabStatus = 'synced' | 'pending' | 'offline' | 'readonly';
/** `region-closed` reason the parent sends, with no request made, when this reader cannot write cells (signed out). */
export const CELL_READONLY = 'readonly';
