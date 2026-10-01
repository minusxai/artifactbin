/** Only data operations cross the managed frame's boundary. No URLs, DOM, or account verbs. */
export type { AuthorScriptReply, AuthorSignalPacket } from './author-script-bridge';
export const AUTHOR_SCRIPT_INIT = 'mx:author:init';
