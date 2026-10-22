import type { AcceptedComment, Snapshot } from "../contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
import type {
  SourceHeader,
  SourceRequest,
  StoredSource,
} from "./source-repository-contracts.ts";
export interface CommentHeader extends SourceHeader {
  sequence: number;
}
export interface CommentAccess {
  document: CommentHeader | null;
  session: SessionGrant | null;
}
export interface SnapshotInsert {
  id: string;
  value: Snapshot;
}
export interface CommentInsertContext extends CommentAccess {
  existing: AcceptedComment | null;
  parentExists: boolean;
  sourceExists: boolean;
}
/** An Idempotency-Key on a comment write, scoped to the page and `prepare`'s actor. */
export interface CommentIdempotency {
  key: string;
  fingerprint: string;
  now: number;
}
export interface CommentRepository {
  /**
   * Every comment in creation order, or with `since` (a page change counter)
   * only those created or edited after it, in change order. `cursor` is the
   * counter of the last change listed, or `since` (else 0) when none is.
   */
  list<T>(
    request: SourceRequest,
    work: (
      context: CommentAccess & { comments: AcceptedComment[]; cursor: number },
    ) => T,
    since?: number | null,
  ): Promise<T>;
  thread<T>(request: SourceRequest, prepare:(context:CommentAccess)=>{commentId:string}, work:(context:CommentAccess & {selected:AcceptedComment|null;root:AcceptedComment|null;comments:AcceptedComment[]})=>T):Promise<T>;
  /**
   * With `idempotency`, a live stored response for the key is returned
   * instead of running `work` (another fingerprint is 422), and a new
   * comment's `value` is stored in the same transaction as the comment.
   */
  add<T>(
    request: SourceRequest,
    prepare: (context: CommentAccess) => {
      commentId: string;
      parentId: string | null;
      sourceRevision: string;
      /** The account the key is scoped to. */
      actor: string;
    },
    work: (context: CommentInsertContext) => {
      value: T;
      insert?: { comment: AcceptedComment; snapshot: SnapshotInsert | null };
    },
    idempotency?: CommentIdempotency | null,
  ): Promise<T>;
  /** An edit advances the page change counter, so `list(…, since)` returns the comment again. */
  edit<T>(
    request: SourceRequest,
    prepare: (context: CommentAccess) => { commentId: string },
    work: (context: CommentAccess & { comment: AcceptedComment | null }) => {
      value: T;
      comment: AcceptedComment;
    },
  ): Promise<T>;
  context<T>(
    request: SourceRequest,
    prepare: (context: CommentAccess) => { commentId: string },
    work: (
      context: CommentAccess & {
        comment: AcceptedComment | null;
        source: StoredSource | null;
        snapshot: Snapshot | null;
      },
    ) => T,
  ): Promise<T>;
  capture<T>(
    request: SourceRequest,
    prepare: (context: CommentAccess) => Snapshot,
    work: (
      context: CommentAccess & {
        source: StoredSource | null;
        snapshot: Snapshot;
      },
    ) => { value: T; snapshot: SnapshotInsert },
  ): Promise<T>;
}
