/**
 * THE ARTIFACT BACKEND — every server call the document surface makes while
 * reading, editing and commenting, behind one interface.
 *
 * Two implementations keep one set of components:
 *  - `createHttpBackend(id)` (./http.ts): today's routes, unchanged behaviour.
 *  - the offline file's backend (lib/offline/file-backend.ts): answers from
 *    the ArtifactFile, reports what it cannot do through `unavailable()`.
 *
 * Components never call `fetch`/`EventSource` for these routes themselves
 * (guarded by lib/artifact-backend/__tests__/no-direct-calls.test.ts); they
 * read the backend from ArtifactBackendProvider (./context.tsx). Hooks take
 * the backend as a parameter (the page calls some of them above the provider
 * it renders). A control whose feature is unavailable renders disabled with
 * the returned reason (components/FeatureUnavailable.tsx), never hidden
 * without saying why and never enabled only to fail.
 *
 * Every type here is the shape the call site already read before the move.
 * The module is types only: importing it adds nothing to a bundle.
 */
import type { DocumentGraph, DocumentResourcePreparation, DocumentUpdate, MembershipStatus } from '@artifactbin/contracts';
import type { AnnotationWire } from '@/lib/annotations';
import type { DataflowState } from '@/lib/story/dataflow';
import type { ArtifactDataEvent, ArtifactLiveEvent, ArtifactVersionPing } from '@/lib/story/live';
import type { StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { QueryTransport } from '@/lib/story-runtime/store';
import type { RemoteSessionInfo } from '../../../contracts/src/remote';

/** Features a backend may not offer. Online, every one is available. */
export type BackendFeature =
  | 'runQueries'      // draft query runs, the query notebook's table reads
  | 'webAssets'       // importing a web image/font/PDF, uploading an image, icons (/prepare)
  | 'versions'        // version history and restore
  | 'mentions'        // @mention lookup of members
  | 'commentImages'   // screenshots attached to comments
  | 'remoteSessions'  // agent sessions offered in the comment composer
  | 'live';           // the live event stream

/** Aborts a read whose answer nobody wants any more. */
export interface RequestOptions { signal?: AbortSignal }

/** The authoring head: GET /api/my/artifacts/<id>, as its browser readers use it. */
export interface ArtifactHead {
  document?: DocumentGraph;
  id: string;
  format?: string;
  /** Conditional-write token for non-document metadata. */
  state?: string;
  title: string | null;
  description?: string | null;
  markup: string | null;
  theme: string | null;
  version: number;
  /** Head pointer of the edit protocol — every edit this session sends carries it. */
  edit_id: string;
  template?: string | null;
  colorMode?: string | null;
  sharing_revision?: number;
  ancestor_ids?: string[];
  refs?: Array<{ id: string; kind: string; title?: string | null }>;
}

/** The editor's view of the head (ArtifactEditor), seeded or loaded. */
export interface LoadedArtifact extends ArtifactHead {
  /**
   * Present when the editor was SEEDED from the page (which holds it); the read
   * API does not return it, so on the background-load path this is undefined and
   * the draft compile supplies the sheet instead.
   */
  compiledCss?: string | null;
  /** Present when SEEDED from the page: the document's server-run dataflow (InPlaceEditor's EditorArtifact). */
  dataflow?: StoryIslandDataflow | null;
}

/** The body of an /edits (or /revert) answer, as use-live-edits reads it. */
export interface FlushResponse {
  document?: DocumentGraph;
  title?: string | null; theme?: string | null; template?: string | null; colorMode?: string | null;
  edit_id: string;
  version: number;
  markup: string | null;
  error?: string;
  /** The validator's own diagnostics — precise enough for the author to act on. */
  details?: Array<{ message?: string }>;
  source?: string;
  detail?: string;
}

/**
 * A write's answer: the status decides (ok, `identical`, a refusal with
 * diagnostics); the body is `{}` when it was not JSON. A write that never
 * reached the server REJECTS instead — that is the "offline — will retry" path.
 */
export interface EditAnswer { ok: boolean; status: number; body: FlushResponse }

/** A row of history: what changed and when, without the content. */
export interface ArtifactVersionSummary {
  version: number;
  title: string | null;
  description: string | null;
  format: string;
  /** The handle of who made this state, or null (a token, an unnamed account, an older row). */
  by: string | null;
  created_at: string;
}

/** One archived version, with everything needed to RENDER it. */
export interface ArtifactVersionSnapshot {
  version: number;
  format?: string;
  html: string;
  title?: string | null; description?: string | null;
  markup: string | null;
  meta: {
    template?: string | null;
    theme?: string | null;
    colorMode?: 'light' | 'dark' | null;
    compiledCss?: string | null;
  };
}

/** An image the editor's upload/import doors minted. */
export interface ChosenImage {
  id: string;
  rawUrl?: string;
}
/** A door's answer: the image, or the sentence to show next to what caused the refusal. */
export type ImageChoice = { ok: true; image: ChosenImage } | { ok: false; error: string };

/** A draft's query results (POST /api/query). */
export type DraftQueryResult = Pick<DataflowState, 'tables' | 'errors'>;

/** One window of a dataset's rows (POST /a/<ref>/tables), as the notebook reads it. */
export interface DatasetTableRead {
  columns?: Array<{ name: string }>;
  totalRows?: number;
}

/** A person the @mention pickers offer. */
export interface MemberPerson { user_id: string; username: string; name: string | null }
/** GET /members: `people` answers a `query`; `mentions` is the saved mentions' statuses. */
export interface MembersAnswer {
  people?: MemberPerson[];
  mentions?: Record<string, MembershipStatus>;
}

/** GET /api/remote/sessions. */
export interface RemoteSessionsAnswer { sessions?: RemoteSessionInfo[] }

/**
 * What the live stream delivers. The stream carries PINGS; the frame itself is
 * read with `liveFrame()`, and annotations with `listAnnotations('open')`.
 */
export interface LiveHandlers {
  /** A head ping (`{editId, version, by}`), parsed; the subscriber validates it. */
  onPing: (ping: ArtifactVersionPing) => void;
  /** A dataset under this document changed (a named `data` frame), parsed. */
  onData: (event: ArtifactDataEvent) => void;
  /** The annotations changed (owner-credentialed connections only). */
  onAnnotations: () => void;
}

export interface ArtifactBackend {
  /** 'offline' inside a downloaded file. */
  readonly mode: 'online' | 'offline';
  /** The reason a feature is unavailable, for display in place; null when it works. */
  unavailable(feature: BackendFeature): string | null;

  // ── the document ──────────────────────────────────────────────────────────
  /** The editor's load (GET /api/my/artifacts/<id>). Null when refused; rejects when unreachable. */
  load(): Promise<ArtifactHead | null>;
  /** Commit one edit batch (POST /edits). Resolves with the same answer shape use-live-edits reads today. */
  commitEdit(input: { edit_id: string; document_update: DocumentUpdate }): Promise<EditAnswer>;
  /** Server authoring context for edits that need it (POST /prepare). Rejects with the server's diagnostics. */
  prepare(source: string): Promise<DocumentResourcePreparation>;
  /** Compiled CSS for a draft (POST /api/preview). Rejects when there is no sheet to show. */
  previewCss(markup: string): Promise<{ css: string }>;
  /** Query results for a draft (POST /api/query). Null when refused. */
  previewQueries(markup: string): Promise<DraftQueryResult | null>;
  /** The query notebook's table read (POST /a/<ref>/tables). Rejects with a BackendRequestError naming the refusal. */
  queryTable(ref: string, body: { sql: string; limit: number; offset: number }): Promise<DatasetTableRead>;
  /** Image upload or web-image import from the editor. Refusals resolve as `{ok:false,error}`. */
  importImage(input: { imageUrl: string } | { file: Blob; name: string }): Promise<ImageChoice>;
  /** History rows (GET /versions). Null when refused. */
  versions(): Promise<ArtifactVersionSummary[] | null>;
  /** One archived version (GET /versions/<n>). Null when refused. */
  version(n: number): Promise<ArtifactVersionSnapshot | null>;
  /** Restore a non-document version on its conditional endpoint (POST /revert). */
  revert(input: { version: number; expectedVersion: number; expectedState: string }): Promise<EditAnswer>;
  /** Subscribe to live changes; returns the unsubscribe. A no-op offline. */
  live(handlers: LiveHandlers): () => void;
  /** The complete document a ping announced (GET /a/<id>/events/frame). Null when refused. */
  liveFrame(): Promise<ArtifactLiveEvent | null>;
  /** The runtime's data transport (authenticated online, snapshot offline). */
  queryTransport(): QueryTransport & { dispose(): void };

  // ── comments ──────────────────────────────────────────────────────────────
  /** Every page of annotations with this status; OPEN when `status` is omitted (the server's default). */
  listAnnotations(status?: 'open' | 'resolved', options?: RequestOptions): Promise<AnnotationWire[]>;
  /** Rejects with a BackendRequestError (`signInRequired` for a guest). */
  createAnnotation(body: Record<string, unknown>, idempotencyKey: string): Promise<AnnotationWire>;
  actOnAnnotation(annotationId: string, body: { reply?: string; resolve?: boolean; reopen?: boolean }): Promise<AnnotationWire>;
  deleteAnnotation(annotationId: string): Promise<void>;
  uploadCommentImage(form: FormData): Promise<{ id: string }>;
  /** `query` omitted reads the saved mentions' statuses; a string (even '') searches people. Null when refused. */
  members(query?: string, options?: RequestOptions): Promise<MembersAnswer | null>;
  /** The agent sessions a comment can @mention; `{sessions: []}` when refused. */
  remoteSessions(options?: RequestOptions): Promise<RemoteSessionsAnswer>;
  deleteRemoteSession(sessionId: string): Promise<void>;
}
