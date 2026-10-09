/** Durable new-human-comment feed shared by HTTP and CLI. Cursors are opaque. */
export interface CommentChangeEvent {
 type:'artifactbin.comment';event_id:string;artifact_id:string;annotation_id:string;comment_id:string;
 author:{kind:'human';label:string|null;user_id:string|null};body:string;created_at:string;
}
export interface CommentChangesPage {events:CommentChangeEvent[];next_cursor:string;has_more:boolean}
export const COMMENT_CHANGES_MAX_WAIT_SECONDS=60;
