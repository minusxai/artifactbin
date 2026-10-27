import type {CommentReactionKind} from './annotation-comment';
/**
 * Durable comment feed shared by HTTP and CLI: every comment, reply, edit and reaction on the artifact, from people and
 * agents alike. Cursors are opaque. Authorship is data, never a filter: `author.kind`/`reactor.kind` say who, and
 * `you` is true when the write was made with the credential this feed is read with (hosted: the bearer token
 * watching; locally: `afbin comment` on the file), so a watcher skips its own writes itself.
 * A new comment or reply is the plain event. Rewriting a comment the monitor has already passed adds
 * `change: 'edited'` and `edited_at`, with the new `body` and its own `event_id` (`comment_id` stays the comment's);
 * edits since one checkpoint arrive as one event with the latest words.
 */
export interface CommentChangeEvent {
 type:'artifactbin.comment';event_id:string;artifact_id:string;annotation_id:string;comment_id:string;
 /** `you`: written (or last rewritten) with the credential reading this feed. */
 author:{kind:'human'|'agent';label:string|null;user_id:string|null;you?:boolean};body:string;created_at:string;
 change?:'edited';edited_at?:string;
}
/**
 * Anyone (a person or an agent) adding or removing their reaction on any comment since the reader's cursor, in the
 * same feed, cursor and replay. `count` is the comment's count of that kind right after the change. Only the net change
 * since one checkpoint arrives: a reaction added and taken back before the reader looked is no event, and taking one
 * back and adding it again is none either.
 */
export interface CommentReactionChangeEvent {
 type:'artifactbin.comment_reaction';event_id:string;artifact_id:string;annotation_id:string;comment_id:string;
 change:'added'|'removed';kind:CommentReactionKind;count:number;
 /** `user_id` is null for an agent, as on a comment author; `you`: made with the credential reading this feed. */
 reactor:{kind:'human'|'agent';label:string|null;user_id:string|null;you?:boolean};created_at:string;
}
/** Every event the comment feed carries; switch on `type`, and skip a type you do not know. */
export type CommentFeedEvent=CommentChangeEvent|CommentReactionChangeEvent;
export interface CommentChangesPage<E extends CommentFeedEvent=CommentFeedEvent> {events:E[];next_cursor:string;has_more:boolean}
export const COMMENT_CHANGES_MAX_WAIT_SECONDS=60;
