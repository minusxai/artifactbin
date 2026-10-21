/** Candidate semantic operations: callers cannot load partial repository rows. */
/** Authenticated identity supplied by the trusted server adapter, never a request body,
 * parent-window message, or app GraphQL claim. Strings are fixture principals here. */
export type Principal = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Access = "public" | "unlisted" | "private";
export interface Source {
  source: string;
  revision: string;
  initialState?: unknown;
}
export interface Codec {
  decode(html: string): Promise<Source>;
}
export interface Pull extends Source {
  documentId: string;
}
export interface CommentInput {
  id: string;
  sourceRevision: string;
  snapshot: unknown;
  targetId: string;
  body: string;
}
export interface Comment extends Omit<CommentInput, "snapshot"> {
  snapshot: Json;
  author: Principal;
}
export interface Context {
  comment: Comment;
  source: Source;
}
export interface Repository {
  create(
    actor: Principal,
    id: string,
    html: string,
    access: Access,
  ): Promise<Pull>;
  pull(actor: Principal | null, id: string, revision?: string): Pull;
  push(
    actor: Principal,
    id: string,
    expectedRevision: string,
    html: string,
  ): Promise<Pull>;
  comment(actor: Principal, id: string, input: CommentInput): Comment;
  inspect(actor: Principal | null, id: string): Comment[];
  context(actor: Principal | null, id: string, commentId: string): Context;
  share(
    actor: Principal,
    id: string,
    access: Access,
    editors: Principal[],
  ): void;
}
export type FaultCode =
  | "NOT_FOUND"
  | "DENIED"
  | "CONFLICT"
  | "INVALID"
  | "HISTORY_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT";
/** Active channels are monotonic generations, not identity/authorization assertions. */
export interface BridgeLifecycle {
  attach(): number;
  suspend(): void;
  accept(generation: number, effect: () => void): boolean;
}
