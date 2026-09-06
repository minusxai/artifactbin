/** Only data operations cross the author boundary. No URLs, DOM, or account verbs. */
import type { DataflowState, Scalar } from '@/lib/story/dataflow';

export type AuthorScriptRequest =
  | { id: number; op: 'set'; name: string; value: Scalar }
  | { id: number; op: 'refresh'; names?: string[] }
  | { id: number; op: 'mutate'; name: string; values?: Record<string, Scalar> };
export type AuthorScriptReply = { id: number; ok: true } | { id: number; ok: false; error: string };
export interface AuthorScriptSnapshot { type: 'state'; state: DataflowState; pending: string[] }
export const AUTHOR_SCRIPT_INIT = 'mx:author:init';
export const AUTHOR_SCRIPT_FRAME_TITLE = 'Isolated artifact script';
