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
  /** Optional reviewed object bytes. Keys must equal the verified source user image_key. */
  avatarObjects?: readonly NativeIdentityAvatarObject[];
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

/** Trusted, reviewed account identity only. Normal OTP must still verify the address. */
export interface NativeIdentityAuthCompanion {
 id:string;
 email:string;
 name:string|null;
 provisionedAt:string;
}

/** Host-selected operator scopes, never read from imported JSON or runtime defaults. */
export interface NativeIdentityMigrationSchemas {appSchema:string;authSchema:string}
declare const migrationAuthority:unique symbol;
/** An opaque authority bound to one actual database transaction. */
export interface NativeIdentityMigrationAuthority {readonly [migrationAuthority]:true}

interface NativeIdentityAvatarObject {
 sourceId:string;
 key:string;
 sha256:string;
 base64:string;
}
declare const avatarPreparation:unique symbol;
/** Issued only after immutable object write and digest readback. */
export interface NativeIdentityAvatarPreparation {readonly [avatarPreparation]:true}
