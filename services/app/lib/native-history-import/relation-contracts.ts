import type { HtmlNodeAnchor } from "@artifactbin/contracts";
import type { CommentImageMetadata } from "../../../contracts/src/comment-image";
import type { NativeHistoryImport } from "./contracts";
/** Offline source projections only; this contract is never an authored request. */
export interface NativeAnnotationProjection {
  id: string;
  revision: number;
  rootId: string | null;
  body: string;
  authorKind: "human" | "agent";
  authorTokenId: string | null;
  authorUserId: string | null;
  authorLabel: string | null;
  authorTransport: "browser" | "http" | "mcp" | "unknown";
  status: "open" | "resolved";
  resolvedAt: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  changeSeq: number | null;
  authorRemote: unknown;
  snippet: string;
  quote: string | null;
  range: string | null;
  viewState: unknown;
  /** Retained original context/state, including explicit unavailable reasons; never executed. */
  retainedContext: unknown;
  anchor: null | {
    version: number;
    sourceNamespace: string;
    sourceNodeId: string;
    quote: string;
    range?: HtmlNodeAnchor["range"];
  };
}
interface NativeAnchorBinding {
  version: number;
  htmlSha256: string;
  sourceNamespace: string;
  sourceNodeId: string;
  nodeId: string;
}
interface NativeMemberProjection {
  userId: string;
  status: "pending" | "accepted" | "left" | "dismissed";
  direction: "request" | "invite";
  initiatedBy: string | null;
  explicitJoin: boolean;
  revision: number;
  createdAt: string;
  acceptedAt: string | null;
  deletedAt: string | null;
}
interface NativeCommentImageProjection {
  id: string;
  annotationId: string;
  tokenId: string;
  userId: string | null;
  metadata: CommentImageMetadata;
  bytes: number;
  ready: boolean;
  expiresAt: string;
}
export interface NativeRelationProjection {
  history: NativeHistoryImport;
  bindings: readonly NativeAnchorBinding[];
  /** Source thread order; replies must follow their root. */
  annotations: readonly NativeAnnotationProjection[];
  members: readonly NativeMemberProjection[];
  images: readonly NativeCommentImageProjection[];
}

/** Postgres returns Date values; retained source projections contain ISO strings. */
export type NativeStoredRelationTimestamp = string | Date;
