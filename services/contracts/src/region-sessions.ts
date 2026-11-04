/**
 * Live co-editing of a page's declared editable regions (`data-af-editable="rich"|"text"`): the HTTP, stream and
 * frame-bridge contract between the trusted app (lib/region-sessions, the parent frame client) and the editor
 * inside the page frame (@afbin/regions). The merge core is lib/live-regions.
 *
 * Decisions this contract encodes (plan: https://app.artifactbin.dev/a/vYfqsF):
 * - Only people with edit access to the page edit regions. Readers see region text at saved versions.
 * - Versions are created on EVENTS, never on a short timer: an author or agent write, a flush (before a comment,
 *   when the last editor leaves, on request) or a slow idle save. The live state between versions is durable in
 *   the region tables, so a version is a reader-visible checkpoint, and the page version rarely moves under people.
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
/** A region with unsaved edits and no new update for this long is saved as a version. */
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
  | 'region_snapshot_missing';

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
  | { type: 'closed'; regionId: string; reason: 'removed' | 'kind_changed' | 'access' };

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
  | { kind: 'region-ack'; regionId: string; seq: number }
  | { kind: 'region-closed'; regionId: string; reason: string }
  | { kind: 'region-paint'; carets: (RegionCaret & { id: string; label: string })[] }
  | { kind: 'region-command'; regionId: string; name: string; args?: Record<string, unknown> };

/** Page frame → parent. */
export type RegionFrameMessage =
  | { kind: 'region-open'; regionId: string }
  | { kind: 'region-update'; regionId: string; update: Uint8Array }
  | ({ kind: 'region-caret'; marks: string[]; block: string } & RegionCaret)
  | { kind: 'region-blur' }
  | { kind: 'region-slash'; regionId: string; x: number; y: number };
