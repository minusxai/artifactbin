import type { Server } from 'node:http';
/** Read-only, loopback-only preview. No account; its only remote requests are public platform files from the selected
 * server (platformOrigin): the core runtime and lazy modules, hosted libraries and components, their import map, one
 * design system's stylesheet and its fonts (skills/artifactbin/scripts/preview-platform.mjs). */
export interface PreviewOptions {
  root: string;
  /** Zero chooses a free port. */
  port?: number;
  /** Optional prebuilt public core/module assets, mounted at /af/. */
  runtimeDir?: string;
  /** Origin supplying the platform files a source checkout lacks; defaults to the archive's selected server, null for none. */
  platformOrigin?: string | null;
  /** Older name of platformOrigin. */
  fontOrigin?: string | null;
  /** Trusted source-owned pinned browser modules (tests); never read from page markup. */
  libraryAssets?: Readonly<Record<string,string>>;
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
/** Platform code for the preview, admitted only at closed paths (/af/<module>.js, /libraries/<name>-<semver>/index.js,
 * /af/components/<file>.js), fetched once per session; a source checkout's own build outputs come first. */
export interface PlatformModules {
  module(pathname: string): Promise<Buffer | null>;
  importMap(): Promise<Record<string, string>>;
  runtimeAssets(): Promise<Record<string, string>>;
  systemCss(name: string): Promise<string | null>;
}
export declare function platformModules(options?: { origin?: string | null; libraryAssets?: Readonly<Record<string,string>> }): PlatformModules;
/** Explicit local Save reads selected-root bytes only. The canonical HTML stays
 * unchanged; renderedHtml embeds a complete admitted dependency graph. No account,
 * network, upload or private viewer state enters this response. */
export interface PreviewSourceExport { html:string; renderedHtml:string; pathname:string }

/** Pure graph packer IO is injected; only the preview server admits file bytes. */
export interface PreviewExportResource { contentType:string; bytes:Uint8Array }
export interface PreviewExportOptions { html:string; pathname:string; load(pathname:string):Promise<PreviewExportResource> }
export declare function packPreviewExport(options:PreviewExportOptions):Promise<string>;
