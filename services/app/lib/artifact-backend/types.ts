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
 * read the backend from ArtifactBackendProvider (./context.tsx). A control
 * whose feature is unavailable renders disabled with the returned reason
 * (components/Tooltip.tsx), never hidden without saying why and never
 * enabled only to fail.
 *
 * STARTING CONTRACT: method names, grouping and the `unavailable` rule are
 * fixed; parameter and result types should be the exact types the current
 * call sites already use (FlushResponse, AnnotationWire, DocumentResourcePreparation,
 * ArtifactVersionSummary, ...), refined during the move.
 */
import type { DocumentUpdate } from '@artifactbin/contracts';
import type { AnnotationWire } from '@/lib/annotations';
import type { QueryTransport } from '@/lib/story-runtime/store';

/** Features a backend may not offer. Online, every one is available. */
export type BackendFeature =
  | 'runQueries'      // draft query runs, the query notebook's table reads
  | 'webAssets'       // importing a web image/font/PDF, uploading an image, icons (/prepare)
  | 'versions'        // version history and restore
  | 'mentions'        // @mention lookup of members
  | 'commentImages'   // screenshots attached to comments
  | 'remoteSessions'  // agent sessions offered in the comment composer
  | 'live';           // the live event stream

export interface ArtifactBackend {
  /** 'offline' inside a downloaded file. */
  readonly mode: 'online' | 'offline';
  /** The reason a feature is unavailable, for display in place; null when it works. */
  unavailable(feature: BackendFeature): string | null;

  // ── the document ──────────────────────────────────────────────────────────
  /** The editor's load (GET /api/my/artifacts/<id>). */
  load(): Promise<unknown>;
  /** Commit one edit batch (POST /edits). Resolves with the same answer shape use-live-edits reads today. */
  commitEdit(input: { edit_id: string; document_update: DocumentUpdate }): Promise<unknown>;
  /** Server authoring context for edits that need it (POST /prepare). */
  prepare(source: string): Promise<unknown>;
  /** Compiled CSS for a draft (POST /api/preview). */
  previewCss(markup: string): Promise<{ css: string }>;
  /** Query results for a draft (POST /api/query). */
  previewQueries(markup: string): Promise<unknown>;
  /** The query notebook's table read (POST /a/<ref>/tables). */
  queryTable(ref: string, body: { sql: string; limit: number; offset: number }): Promise<unknown>;
  /** Image upload or web-image import from the editor. */
  importImage(input: { imageUrl: string } | { file: Blob; name: string }): Promise<unknown>;
  versions(): Promise<unknown>;
  version(n: number): Promise<unknown>;
  /** Subscribe to live changes; returns the unsubscribe. A no-op offline. */
  live(handlers: unknown): () => void;
  /** The runtime's data transport (authenticated online, snapshot offline). */
  queryTransport(): QueryTransport & { dispose(): void };

  // ── comments ──────────────────────────────────────────────────────────────
  listAnnotations(status?: 'open' | 'resolved'): Promise<AnnotationWire[]>;
  createAnnotation(body: Record<string, unknown>, idempotencyKey: string): Promise<AnnotationWire>;
  actOnAnnotation(annotationId: string, body: { reply?: string; resolve?: true; reopen?: true }): Promise<AnnotationWire>;
  deleteAnnotation(annotationId: string): Promise<void>;
  uploadCommentImage(form: FormData): Promise<{ id: string }>;
  members(query: string): Promise<unknown>;
}
