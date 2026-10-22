import type { DocumentState, FilePermissions, Viewer } from "../contracts.ts";
import type { ConnectedIdentity } from "./connection-coordinator-contracts.ts";
import type { SessionStatus } from "./collaboration-session-contracts.ts";
import type { PublicationGate } from "./lifecycle-contracts.ts";
import type { PlatformBinding } from "./platform-contracts.ts";
import type { CommentAccessInput } from "./comment-command-contracts.ts";
export interface DocumentHostSnapshot {
  session: string | true | null;
  username: string | null;
  viewers: Viewer[];
  permissions: FilePermissions | null;
  sync: SessionStatus["sync"];
}
export interface DocumentHostOptions {
  /** Synchronously retire all prior caller observations before installing another identity. */
  invalidateCollaboration?(): void;
  readState(): DocumentState;
  updateState(reducer: (state: DocumentState) => DocumentState): void;
  gate: Pick<PublicationGate, "active">;
  source: string;
  sessionId: string;
  local: boolean;
  hosted: boolean;
  /** The server's number for the open page version, in a hosted page. */
  version?: number;
  previewToken?: string;
  origin: string;
  documentPath: string;
  initial?: Partial<
    Pick<DocumentHostSnapshot, "session" | "username" | "permissions">
  >;
}
/** Owns persisted connection binding and ephemeral authority; no transport, DOM or clock. */
export interface DocumentHost {
  read(): DocumentHostSnapshot;
  connectionBinding(): PlatformBinding & { origin?: string };
  transportConnection(): {
    origin: string;
    fileId: string;
    token: string;
    sourceRevision: string;
    version?: number;
  };
  commentAccess(): CommentAccessInput;
  /** Persist publication before installing identity. Inactive authority cannot be installed. */
  applyConnection(identity: ConnectedIdentity): { publicationChanged: boolean };
  /** Retains portable link authority while clearing actor authority and its projections. */
  disconnectIdentity(): void;
  observeCollaboration(status: SessionStatus): {
    rosterChanged: boolean;
    permissionsChanged: boolean;
  };
}
