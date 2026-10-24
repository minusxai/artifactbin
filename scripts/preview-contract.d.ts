import type { Server } from 'node:http';
/** Read-only, loopback-only preview. No account or remote service configuration. */
export interface PreviewOptions {
  root: string;
  /** Zero chooses a free port. */
  port?: number;
  /** Optional prebuilt public core/module assets, mounted at /af/v1/. */
  runtimeDir?: string;
}
export interface PreviewSession { server: Server; url: string; close(): Promise<void> }
export declare function startPreview(options: PreviewOptions): Promise<PreviewSession>;
/** A content revision covers admitted project files, including dependencies and deletions.
 * Poll GET /__af_preview/revision. It invalidates the view; it never patches the DOM.
 * Intermediate writes between polls may coalesce. Reload remains an explicit viewer action.
 */
export interface PreviewRevision { revision: string }
