import type { CommentImageWire } from './comment-image';
import type { RemoteColor } from './remote';

/** Who wrote a comment. Ownership is an ACL relationship, not an author kind. */
export interface AnnotationAuthor {
  kind: 'human' | 'agent';
  sessionId?:string;
  /** Connected program snapshot; independent of the user-chosen session name. */
  harness?:string;
  color?:RemoteColor;
  /** Display snapshot (username, token name…); stored beside the row so reads never join. */
  label: string | null;
  /**
   * How this individual comment arrived; stored per comment because one token
   * can use several transports. Nothing writes `'mcp'` any more — it is a value
   * stored rows still carry, and the rail renders its own chip for it.
   */
  transport: 'browser' | 'http' | 'mcp' | 'unknown';
}

/**
 * An author as a reader receives it: who wrote it, plus the face to draw. Both
 * are READ, never written — the id is the row's `author_user_id`, the picture
 * the account's current one — so a caller creating a comment never names them.
 * Null for an agent (drawn as its product mark) and for a person without an
 * account; public by construction (the handle is already a /@link, the avatar
 * route is public by id) and never the email or the token.
 */
export interface AnnotationWireAuthor extends AnnotationAuthor {
  /** Verified migrated source identity used only to preserve avatar colour, never authorization. */
  avatar_seed?: string;
  user_id: string | null;
  image: string | null;
}

/** One comment of a thread as every reader receives it: the store answers it, remote mentions and the offline backend build it. */
export interface AnnotationCommentWire {
  id: string;
  body: string;
  author: AnnotationWireAuthor;
  created_at: string;
  /** The one image this comment carries — a root's or a reply's own. */
  image?: CommentImageWire;
  /** When its author last rewrote the text; absent on a comment never edited. There is no edit history. */
  edited_at?: string;
}

/**
 * Why a new comment cannot attach: the element it names is not in the SAVED document — added in an edit that has
 * not saved yet, or carrying no id yet. Every surface that refuses on that ground says this one true, actionable
 * thing: the composer before it sends, hosted's `bad_path` refusal, the offline file and the local preview.
 * "Your draft" is the comment being written, which the composer keeps.
 */
export const COMMENT_TARGET_UNSAVED = "This element isn't in the saved document yet, so a comment can't attach to it. If you just added it, comment once your edit saves. Your draft is still here.";
