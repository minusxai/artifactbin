/** Only data operations cross the author boundary. No URLs, DOM, or account verbs. */
import type { AuthorStateDelta } from './author-state';

export type AuthorScriptReply = { id: number; ok: true } | { id: number; ok: false; error: string };
/** Initial reset precedes author execution; later packets contain changed keys only. */
export interface AuthorScriptSnapshot { type: 'state'; state: AuthorStateDelta; pending?: string[]; reset?: boolean }
export const AUTHOR_SCRIPT_INIT = 'mx:author:init';
export const AUTHOR_SCRIPT_FRAME_TITLE = 'Isolated artifact script';
