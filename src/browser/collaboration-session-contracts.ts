import type {
  AcceptedComment,
  Capture,
  CommentsResponse,
  Context,
  Cursor,
  DocumentState,
  FilePermissions,
  PresenceInput,
  Profile,
  Viewer,
} from "../contracts.ts";
import type { PublicationGate } from "./lifecycle-contracts.ts";
import type { PlatformOperation } from "./platform-contracts.ts";
export interface OperationResults {
  permissions: FilePermissions;
  "comments.list": CommentsResponse;
  "comments.create": AcceptedComment;
  "comments.resolve": AcceptedComment;
  "context.get": Context;
  "profiles.list": Record<string, Profile>;
  "presence.capture": Capture;
}
export interface LiveCallbacks {
  ready(): void;
  viewers(value: Viewer[]): void;
  changed(): void;
  status(status: string, error?: string): void;
}
export interface SessionTransport {
  request<O extends PlatformOperation>(
    operation: O,
    signal: AbortSignal,
  ): Promise<OperationResults[O["kind"]]>;
  connect(callbacks: LiveCallbacks): {
    close(): void;
    send(presence: PresenceInput): boolean | void;
    /** Optional lightweight cursor channel; supplied by browser transports. */
    cursor?(cursor: Cursor | null): boolean | void;
  };
}
export interface SessionStatus {
  /** Fresh permissions settlement, separate from comment synchronization. */
  access?: "pending" | "allowed" | "denied" | "disconnected" | "disposed";
  mode: "active" | "suspended" | "disposed";
  sync: "disconnected" | "syncing" | "pending" | "synced" | "error";
  permissions: FilePermissions | null;
  viewers: Viewer[];
  message: string;
}
export interface SessionClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface CollaborationSessionOptions {
  gate: PublicationGate;
  readState(): DocumentState;
  /** Must synchronously apply the reducer to the latest state; never a captured snapshot. */
  updateState(
    reducer: (current: DocumentState) => DocumentState,
    change: "comments" | "profiles",
  ): void;
  authenticated(): boolean;
  /** Read-only historical navigation may continue while publication is suspended. */
  contextReadsAllowed?(): boolean;
  onChange?(status: SessionStatus): void;
  onReady?(): void;
  /** Authorized server change, before the collaboration snapshot refresh. */
  onInvalidated?(): void;
  /** A posted comment was accepted under the server's ID; called before its state update. */
  onAcknowledged?(localId: string, serverId: string): void;
  clock?: SessionClock;
  timeoutMs?: number;
}
export interface CollaborationSession {
  getStatus(): SessionStatus;
  attach(transport: SessionTransport): void;
  restart(): void;
  synchronize(): Promise<void>;
  request<O extends PlatformOperation>(
    operation: O,
  ): Promise<OperationResults[O["kind"]]>;
  /** Only context retrieval; authority changes, lifecycle denial and disposal invalidate results. */
  readContext<
    O extends Extract<
      PlatformOperation,
      { kind: "context.get" | "presence.capture" }
    >,
  >(
    operation: O,
  ): Promise<OperationResults[O["kind"]]>;
  refreshProfiles(): Promise<void>;
  /** Resolve a thread; resolved false reopens it. */
  resolveComment(
    id: string,
    revision: number,
    resolved?: boolean,
  ): Promise<void>;
  publishPresence(presence: PresenceInput): void;
  publishCursor(cursor: Cursor | null): void;
  /** Cancel outstanding operations without changing publication or transport placement. */
  invalidate(): void;
  suspend(): void;
  resume(): void;
  disconnect(): void;
  dispose(): void;
}
