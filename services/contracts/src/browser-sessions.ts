import type { Actor } from './actor';
import type { MxError } from './mx';

/** Forces revalidation of the captured session credential on every app request. */
export const BROWSER_SESSION_HEADER = 'x-mx-browser-session';

export interface BrowserSessionPage { page_id: string; url: string; artifact_id?: string }
export interface BrowserSessionAttachment { mime: 'image/png' | 'image/jpeg'; base64: string }
export interface BrowserSessionResult {
  session_id: string;
  execution_id?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'lost' | 'closed' | 'idle';
  result?: unknown;
  pages: BrowserSessionPage[];
  attachments: BrowserSessionAttachment[];
  error?: MxError;
}
export type BrowserSessionRequest = { actor: Actor } & (
  | { op: 'script'; session_id: string; execution_id: string; create: boolean; code: string }
  | { op: 'status'; session_id: string; execution_id?: string }
  | { op: 'close'; session_id: string }
);
export interface BrowserSessions { request(input: BrowserSessionRequest): Promise<BrowserSessionResult>; close(): Promise<void> }
export const SESSION_LIMITS = { scriptBytes: 65536, outputBytes: 8 * 1024 * 1024, scriptMs: 20000, idleMs: 30 * 60 * 1000, sessions: 2, executions: 16, pages: 8 } as const;
