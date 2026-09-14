/** Only data operations cross the author boundary. No URLs, DOM, or account verbs. */
export type { AuthorScriptReply, AuthorSignalPacket } from './author-script-bridge';
export const AUTHOR_SCRIPT_INIT = 'mx:author:init';
export const AUTHOR_SCRIPT_FRAME_TITLE = 'Isolated artifact script';
