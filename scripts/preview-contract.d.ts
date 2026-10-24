import type { Server } from 'node:http';
/** Read-only, loopback-only preview. No account or remote service configuration. */
export interface PreviewOptions {
  root: string;
  /** Zero chooses a free port. */
  port?: number;
  /** Optional prebuilt public core/module assets, mounted at /af/v1/. */
  runtimeDir?: string;
  /** Short shared content-scan cache; tests may set zero. */
  revisionIntervalMs?: number;
  /** Trusted embedding/test options; never supplied by page markup or request JSON. */
  sessionOptions?: { now?: () => number; ttlMs?: number; maxSessions?: number; createDatasets?: unknown };
  operationTimeoutMs?: number;
}
export interface PreviewSession { server: Server; url: string; close(): Promise<void> }
export declare function startPreview(options: PreviewOptions): Promise<PreviewSession>;
/** A content revision covers admitted project files, including dependencies and deletions.
 * Poll GET /__af_preview/revision. It invalidates the view; it never patches the DOM.
 * Intermediate writes between polls may coalesce. Reload remains an explicit viewer action.
 */
export interface PreviewRevision { revision: string }
export interface PreviewLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }
export interface RevisionSource { current(options?: {fresh?: boolean}): Promise<string> }
/** Concurrent clients share one scan; a monotonic test clock controls the cache. */
export declare function createRevisionSource(root: string, options?: { now?: () => number; scan?: () => Promise<string>; intervalMs?: number }): RevisionSource;
/** Local declaration sessions are scoped to one HTML path and disk revision.
 * Requests use an opaque per-session endpoint, bounded JSON bodies and exact Origin.
 * Mutations affect memory only; export is an explicit JSON download.
 */
export interface PreviewLocalDatasetConfig { endpoint: string; schema: unknown }
/** Exact code-only runtime admission, validated against each content-addressed path. */
export declare function runtimeAssetManifest(assets: Readonly<Record<string, string | undefined>>): ReadonlyMap<string, string>;
