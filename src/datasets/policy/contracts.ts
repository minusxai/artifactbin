/** Offline authorization facts. Populate from one consistent legacy snapshot, never request input. */
export interface Principal {
  userId: string | null;
  tokenId: string | null;
  groupId?: string | null;
}
export type Action = "read" | "insert" | "update" | "delete";
export interface Grant {
  actions: Action[];
  from: { user?: string; artifact?: string; artifactOwner?: string };
}
export interface DatasetSnapshot {
  id: string;
  owner: Principal;
  visibility: string;
  policyRevision: number;
  ownerIsTestUser: boolean;
  policy: unknown;
}
export interface DocumentSnapshot {
  /** Trusted exact self-binding for a generated read-only dataset page; original format remains dataset. */
  standaloneDataset?: { kind: "dataset-self-read-v1"; datasetId: string; version: number };
  id: string;
  editId: string;
  owner: Principal;
  visibility: string;
  format: string;
  deleted: boolean;
  ownerIsTestUser: boolean;
  acceptedJoinUserIds: readonly string[];
}
export interface AuthorizationFacts {
  caller: Principal;
  identity: "user" | "guest" | "testuser" | null;
  groupRoles: Readonly<Record<string, "viewer" | "editor">>;
  sharedArtifactIds: readonly string[];
}
export interface TranslatedDataset {
  id: string;
  owner: Principal;
  visibility: string;
  policyRevision: number;
  ownerIsTestUser: boolean;
  grants: readonly Grant[];
}
export type Translation =
  | { ok: true; dataset: TranslatedDataset }
  | { ok: false; reason: string };
export interface Evaluation {
  action: Action;
  facts: AuthorizationFacts;
  currentPolicyRevision: number;
  document?: DocumentSnapshot;
  requestedDocument?: { id: string; editId: string };
}
