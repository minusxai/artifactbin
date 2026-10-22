import type { Target } from "./page-message-contracts.ts";
import type { Comment, DocumentState, Snapshot } from "../contracts.ts";
import type { ActivityReason } from "./activity-contracts.ts";
export interface DocumentViewContext {
  source: string | null;
  snapshot: Snapshot | null;
}
export interface DocumentViewChange {
  kind: "live" | "history" | "return" | "saved-context";
  snapshotChanged: boolean;
  hadSnapshot: boolean;
}
export interface DocumentViewOptions {
  source: string;
  revision: string;
  snapshot: Snapshot | null;
  contextOnly?: boolean;
  contexts: {
    cached(): Pick<DocumentState, "sources" | "snapshots">;
    comment(id: string): Promise<DocumentViewContext>;
    viewer(sessionId: string): Promise<DocumentViewContext>;
  };
  surface: {
    mount(
      source: string,
      snapshot: Snapshot | null,
      revision: string,
      historical: boolean,
    ): void;
    suspend(): void;
  };
  activity: {
    suspend(reason: ActivityReason): void;
    resume(reason: ActivityReason): void;
  };
  changed(change: DocumentViewChange): void;
}
/** Owns live versus historical selection; stale asynchronous selections cannot publish. */
export interface DocumentView {
  readonly snapshot: Snapshot | null;
  readonly revision: string;
  readonly historical: boolean;
  readonly targets: Target[];
  start(): void;
  receiveView(message: { snapshot?: unknown; targets?: unknown }): boolean;
  showComment(
    comment: Pick<Comment, "id" | "appStateId" | "sourceRevision" | "context">,
  ): Promise<void>;
  showViewer(sessionId: string): Promise<void>;
  returnLive(): boolean;
  /** Metadata stays current while export/save always uses the preserved live snapshot. */
  envelope(state: DocumentState): DocumentState;
  dispose(): void;
}
