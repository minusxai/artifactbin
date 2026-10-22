import type { Comment, Profile, Snapshot, Target } from "../contracts.ts";
/** Selection owns an immutable copy of the context captured when composing starts. */
export interface CommentSelection {
  nodeId: string | null;
  quote: string;
  snapshot: Snapshot | null;
}
export interface CommentPanelData {
  comments: Comment[];
  profiles: Record<string, Profile>;
  sourceRevision: string;
  actor: string | null;
  snapshot: Snapshot | null;
  canComment: boolean;
  notice: string;
  canResolve: boolean;
  /** False while a saved view (a comment's context or another viewer's) is shown. */
  live: boolean;
}
export interface CommentPanelOptions {
  layer: HTMLElement;
  /** Trusted image loader/resource owner; omitted when no attachment transport exists. */
  attachmentResources?: import("./comment-attachments-contracts.ts").CommentAttachmentResources;
  read(): CommentPanelData;
  geometry(): { targets: Target[]; inset: number; height: number };
  actions: {
    post(
      body: string,
      selection: CommentSelection,
      parentId: string | null,
    ): string;
    resolve(comment: Comment): Promise<void>;
    /** Mark a resolved thread open again. */
    reopen(comment: Comment): Promise<void>;
    view(comment: Comment): void | Promise<void>;
    finishSelection(): void;
    error(message: string): void;
  };
}
export interface CommentPanel {
  readonly drafts: Readonly<Record<string, string>>;
  readonly active: boolean;
  /** Open the composer; a selection with nodeId null comments on the whole page. */
  open(selection: CommentSelection): void;
  close(): void;
  render(): void;
  /** A posted comment took the server's ID: an open thread and its draft follow it. */
  rename(from: string, to: string): void;
  dismissOutside(target: Node): void;
  dispose(): void;
}
