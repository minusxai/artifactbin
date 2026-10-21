import type { DocumentState } from "../contracts.ts";
import type { CommentSelection } from "./comment-panel-contracts.ts";
export interface CommentAccessInput {
  active: boolean;
  placement: "hosted" | "portable";
  authenticated: boolean;
  permission: boolean | null;
}
export interface CommentAccess {
  allowed: boolean;
  notice: string;
}
export interface CommentCommand {
  body: string;
  selection: CommentSelection;
  parentId: string | null;
}
export interface CommentCommandContext {
  access: CommentAccessInput;
  sourceRevision: string;
  connected: boolean;
  now: number;
  id(): string;
}
/** Apply state and mark persistence dirty exactly once; sync is only a follow-up effect. */
export interface PreparedComment {
  state: DocumentState;
  id: string;
  synchronize: boolean;
}
