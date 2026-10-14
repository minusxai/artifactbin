/**
 * Durable human-comment feed shared by HTTP and CLI. Cursors are opaque.
 * A new comment or reply is the plain event. A human rewriting a comment the monitor has already passed adds
 * `change: 'edited'` and `edited_at`, with the new `body` and its own `event_id` (`comment_id` stays the comment's);
 * edits since one checkpoint arrive as one event with the latest words.
 */
export interface CommentChangeEvent {
 type:'artifactbin.comment';event_id:string;artifact_id:string;annotation_id:string;comment_id:string;
 author:{kind:'human';label:string|null;user_id:string|null};body:string;created_at:string;
 change?:'edited';edited_at?:string;
}
export interface CommentChangesPage {events:CommentChangeEvent[];next_cursor:string;has_more:boolean}
export const COMMENT_CHANGES_MAX_WAIT_SECONDS=60;
