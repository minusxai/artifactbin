import type { CollaborationCatalog } from "../persistence/document-catalog-contracts.ts";
import type {
  PresenceEntry,
  PresenceInput,
  AccessPolicy,
  SessionGrant,
} from "../contracts.ts";
import type { DocumentAuthorizationRecord } from "./document-authorization-contracts.ts";
export interface CollaborationDocument extends DocumentAuthorizationRecord {
  id: string;
  head: string;
  sequence: number;
  share: string | null;
  path: string | null;
  /** Digest of the current source: the revision live views and presence are keyed by. */
  sourceDigest?: string | null;
}
import type { IdentityAuthority } from "./identity-contracts.ts";
export type CollaborationCommand =
  | { kind: "permissions" }
  | { kind: "sharing" }
  | { kind: "change-sharing"; policy: AccessPolicy; expectedVersion: number }
  | { kind: "profiles" }
  | { kind: "presence" }
  | { kind: "update-presence"; input: PresenceInput }
  | { kind: "revoke" };
export interface CollaborationResult {
  value: unknown;
  changed?: "policy" | "revoked" | "presence";
  generation?: number;
}
export interface LiveAuthorization {
  file: Pick<CollaborationDocument, "generation">;
  actor: string | null;
  expires: number;
  sourceRevision: string;
  sourceAvailable: boolean;
}
export interface CollaborationService {
  authorizeLive(
    fileId: string,
    credential: string,
    sourceRevision: string,
  ): Promise<LiveAuthorization>;
  execute(
    fileId: string,
    credential: string,
    command: CollaborationCommand,
  ): Promise<CollaborationResult>;
}
export interface CollaborationAuthorizationContext {
  document: CollaborationDocument | null;
  session: SessionGrant | null;
  sourceExists(revision: string): Promise<boolean>;
}
export type CollaborationContext = CollaborationAuthorizationContext;
export interface CollaborationMutation<T> {
  value: T;
  documentChanges?: Partial<
    Pick<CollaborationDocument, "access" | "share" | "shareHash" | "generation">
  >;
}
/** Owns the document lock and commits sharing and presence changes. */
export interface CollaborationRepository extends CollaborationCatalog {
  authorize<T>(
    documentId: string,
    credentialHash: string,
    operation: (context: CollaborationAuthorizationContext) => Promise<T>,
  ): Promise<T>;
  run<T>(
    documentId: string,
    credentialHash: string,
    operation: (
      context: CollaborationContext,
    ) => Promise<CollaborationMutation<T>>,
  ): Promise<T>;
}
export interface CollaborationOptions {
  repository: CollaborationRepository;
  authority: IdentityAuthority;
  presence: Map<string, Record<string, PresenceEntry>>;
  now?: () => number;
}
