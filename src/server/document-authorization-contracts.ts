import type { AccessPolicy, FilePermissions } from "../contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
export interface DocumentAuthorizationRecord {
  owner: string;
  shareHash: string;
  generation: number;
  access?: AccessPolicy;
}
/** Scalar document columns only; collaboration data has a separate repository owner. */
export interface DocumentHeader extends DocumentAuthorizationRecord {
  id: string;
  head: string;
  sequence: number;
  share: string | null;
  path: string | null;
  /** Digest of the current source; the revision shared page state is keyed by. */
  sourceDigest?: string | null;
}
export interface DocumentAuthorizationInput {
  fileId: string;
  document: DocumentAuthorizationRecord | null;
  session: SessionGrant | null;
  credentialHash: string | null;
  now: number;
}
export interface DocumentAuthorizationDecision {
  actor: string | null;
  owner: boolean;
  permissions: FilePermissions;
  appEdit: boolean;
}
