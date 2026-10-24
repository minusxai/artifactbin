import type { Queryable } from "@artifactbin/contracts";
export interface NativeIdentityUser {
  id: string;
  email: string | null;
  kind: string;
  parent_user_id?: string | null;
  merged_into_user_id?: string | null;
  expires_at?: string | null;
  created_at: string;
  name?: string | null;
  username?: string | null;
  image_key?: string | null;
}
export interface NativeIdentityToken {
  id: string;
  user_id: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
  expires_at?: string | null;
}
export interface NativeIdentityPlan {
  sourceNamespace: string;
  sourceInventorySha256: string;
  targetInventorySha256: string;
  sha256: string;
  targets: {
    users: Readonly<Record<string, { userId: string; email: string | null }>>;
    tokens: Readonly<Record<string, { tokenId: string }>>;
    actors: Readonly<Record<string, { userId: string }>>;
  };
  users: readonly {
    sourceId: string;
    targetId: string;
    action: "create-preserved" | "reuse-verified-email";
    sourceRowSha256: string;
    targetRowSha256?: string;
  }[];
  createUsers: readonly (NativeIdentityUser & {
    sourceId: string;
    sourceRowSha256: string;
  })[];
  tokens: readonly {
    sourceId: string;
    targetId: string;
    userId: string | null;
    action: "create-disabled-provenance";
    sourceRowSha256: string;
    sourceCreatedAt: string | null;
    sourceDeletedAt: string | null;
    sourceExpiresAt: string | null;
  }[];
  blockers: readonly unknown[];
  [field: string]: unknown;
}
/** Trusted offline inputs only. The approved digest must come from the reviewed selection, never an HTTP argument. */
export interface NativeIdentityImport {
  plan: NativeIdentityPlan;
  approvedPlanSha256: string;
  sourceInventory: {
    users: readonly NativeIdentityUser[];
    tokens: readonly NativeIdentityToken[];
    [field: string]: unknown;
  };
  targetInventory: {
    users: readonly NativeIdentityUser[];
    [field: string]: unknown;
  };
  /** Host-selected timestamp for forced revocation; historical token dates remain in the durable ledger. */
  revokedAt: string;
}
export interface NativeIdentityImportResult {
  createdUsers: number;
  reusedUsers: number;
  createdTokens: number;
  replayed: number;
}
export interface NativeIdentityImportDb {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
}
