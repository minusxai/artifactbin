import type { Actor } from './actor';
import type { ViewerChoice } from './testusers';

/** Forces revalidation of the captured session credential on every app request. */
export const BROWSER_SESSION_HEADER = 'x-mx-browser-session';
/** Private app relay path used by the isolated session worker for supported font resources. */
export const BROWSER_FONT_RESOURCE_PATH = '/api/internal/browser-font-resource';

interface BrowserSessionPage { page_id: string; url: string; artifact_id?: string }
interface BrowserSessionAttachment { mime: 'image/png' | 'image/jpeg'; base64: string }
export interface BrowserSessionResult {
  session_id: string;
  execution_id?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'lost' | 'closed' | 'idle';
  result?: unknown;
  pages: BrowserSessionPage[];
  attachments: BrowserSessionAttachment[];
  /** A coded error on the wire. */
  error?: { code: string; message: string };
  /**
   * Development only, and only when `BROWSER__SANDBOX=none`: this session ran with NO OS
   * containment. Said on the wire because the checks that assert containment are Linux
   * facts — a gate has to know to skip them by name rather than quietly weaken them.
   */
  sandbox?: 'none';
}
/** `pageActor`: who the PAGES browse as when the app decided it (a throwaway second person); never the owner's credential. */
export type BrowserSessionRequest = { actor: Actor; pageActor?: Actor; requestScope?: string } & (
  /** `viewer` on the creating request: 'guest' browses signed out, `{testuser}` browses as one of the owner's test users; who a session browses as never changes. */
  | { op: 'script'; session_id: string; execution_id: string; create: boolean; code: string; viewer?: ViewerChoice }
  | { op: 'status'; session_id: string; execution_id?: string }
  | { op: 'close'; session_id: string }
);
export interface BrowserSessions { request(input: BrowserSessionRequest): Promise<BrowserSessionResult>; close(): Promise<void> }
