/** Local controls contain provenance and viewer choices, never account credentials or remote authority. */
export type PortableChromeState = 'offline' | 'connecting' | 'connected' | 'signin-required' | 'permission-required' | 'blocked' | 'stale' | 'unavailable' | 'unknown-outcome';
export interface PortableChromeIdentity {
  platformOrigin: string;
  artifactId: string;
  baseRevision: string;
  sourceDigest: string;
}
export interface PortablePreviewStatus { changed: boolean; connected: boolean; dirty?: boolean; conflict?: boolean; error?: string; }
export interface PortableChromeUpdate {
  state: PortableChromeState;
  mode?: 'light' | 'dark';
  title?: string;
  previewStatus?: PortablePreviewStatus;
  kind?: 'unpublished' | 'linked';
  identity?: PortableChromeIdentity;
  notice?: string;
  sourceStatus?: string;
}
export interface SavePortableOptions { includePrivateState: boolean; }
export interface PortableChromeOptions {
  win: Window;
  /** The bundled, compiled hosted stylesheet. Never fetched by the local renderer. */
  stylesheet: string;
  title: string;
  kind: 'unpublished' | 'linked';
  identity?: PortableChromeIdentity;
  state: PortableChromeState;
  mode?: 'light' | 'dark';
  /** Local viewer choice only; the renderer updates data-af-dark without remote work. */
  onMode?: (mode: 'light' | 'dark') => void;
  /** Delegated to the private preview's dirty-safe reload flow. */
  onReloadPreview?: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onStayOffline: () => void;
  onSave: (options: SavePortableOptions) => void | Promise<void>;
  /** An explicit destination hint for unpublished files; never used as authorization. */
  publishOrigin?: string;
  onPublish: (options: { platformOrigin: string }) => void;
  onOpenHosted: () => void;
}
export interface PortableChromeHandle {
  /** Hide the actual overlay, including top-layer paint and interaction; retain viewer choices. */
  setVisible(visible: boolean): void;
  update(next: PortableChromeUpdate): void;
  dispose(): void;
}
/**
 * AN EXPORTED COPY WITH NO ROWS FOR ITS `sql`: it carries none (it links no dataset, or its rows were past the export's
 * 16 MiB) and a table it computes would be empty with no word why. Its `sql` (./browser-client, ./offline-sql) rejects
 * with this sentence, marks the document and says so, and the copy's local controls (./portable-session) show it.
 */
export const OFFLINE_SQL_NO_DATA = 'This copy carries no data for its sql tables: open the original page to see them.';
export const OFFLINE_SQL_NO_DATA_EVENT = 'af:offline-sql-no-data';
export const OFFLINE_SQL_NO_DATA_ATTRIBUTE = 'data-af-offline-sql-no-data';
export function offlineSqlNoData(): { error: 'unavailable'; message: string } {
  globalThis.document?.documentElement?.setAttribute(OFFLINE_SQL_NO_DATA_ATTRIBUTE, '');
  globalThis.dispatchEvent?.(new Event(OFFLINE_SQL_NO_DATA_EVENT));
  return { error: 'unavailable', message: OFFLINE_SQL_NO_DATA };
}
/** The runtime reserves this inset; the local renderer never rewrites authored layout. */
export const PORTABLE_CHROME_HEIGHT = 76;

/** Accept a platform origin only, with local HTTP reserved for explicit loopback development. */
export function portablePublishOrigin(input: string): string | null {
  try {
    const url = new URL(input.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
