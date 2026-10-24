import {provisionNativeIdentityAuthCompanion,authorizeNativeIdentityTransaction,nativeIdentityMigrationScope} from './auth-companions';
export {provisionNativeIdentityAuthCompanion,authorizeNativeIdentityTransaction} from './auth-companions';
import type { Queryable } from "@artifactbin/contracts";
import type {
  NativeIdentityImport,
  NativeIdentityMigrationAuthority,
  NativeIdentityMigrationSchemas,
  NativeIdentityImportDb,
  NativeIdentityImportResult,
  NativeIdentityUser,
} from "./contracts";
import {
  nativeIdentityDigest,
  nativeIdentityTimestamp,
  storedUser,
  verifyNativeIdentityInput,
} from "./model";
export type {
  NativeIdentityImport,
  NativeIdentityMigrationAuthority,
  NativeIdentityMigrationSchemas,
  NativeIdentityImportResult,
} from "./contracts";
const userColumns =
  "id,email,kind,parent_user_id,merged_into_user_id,to_jsonb(users)->>'expires_at' AS expires_at,to_jsonb(users)->>'created_at' AS created_at,name,username,image_key";
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface Ledger {
  target_id: string;
  action: string;
  source_sha256: string;
  target_sha256: string;
  original_state: Record<string, unknown>;
  created_at: string;
}
/** Operates within the caller's publication transaction if supplied; never exposes a credential. */
export async function writeNativeIdentities(
  tx: Queryable,
  raw: NativeIdentityImport,
  authority:NativeIdentityMigrationAuthority,
): Promise<NativeIdentityImportResult> {
  await nativeIdentityMigrationScope(tx,authority);
  // Capture caller-owned input before the first await, so it cannot change during a transaction.
  const input = plain(raw),
    proof = verifyNativeIdentityInput(input),
    result = { createdUsers: 0, reusedUsers: 0, createdTokens: 0, replayed: 0 };
  const ns = input.plan.sourceNamespace;
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('native-identity:' || $1))",
    [ns],
  );
  const ledger = async (kind: string, id: string) =>
    (
      await tx.query<Ledger>(
        "SELECT target_id,action,source_sha256,target_sha256,original_state,to_jsonb(native_identity_imports)->>'created_at' AS created_at FROM native_identity_imports WHERE source_namespace=$1 AND kind=$2 AND source_id=$3 FOR UPDATE",
        [ns, kind, id],
      )
    ).rows[0];
  const save = async (
    kind: string,
    m: {
      sourceId: string;
      targetId: string;
      action: string;
      sourceRowSha256: string;
    },
    targetSha: string,
    state: Record<string, unknown>,
  ) =>
    tx.query(
      "INSERT INTO native_identity_imports(source_namespace,kind,source_id,target_id,action,source_sha256,target_sha256,projection_sha256,source_inventory_sha256,target_inventory_sha256,original_state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)",
      [
        ns,
        kind,
        m.sourceId,
        m.targetId,
        m.action,
        m.sourceRowSha256,
        targetSha,
        input.plan.sha256,
        input.plan.sourceInventorySha256,
        input.plan.targetInventorySha256,
        JSON.stringify(state),
        input.revokedAt,
      ],
    );
  const verifyLedger = (
    prior: Ledger,
    m: { targetId: string; action: string; sourceRowSha256: string },
  ) => {
    if (
      prior.target_id !== m.targetId ||
      prior.action !== m.action ||
      prior.source_sha256 !== m.sourceRowSha256
    )
      throw Error("native_identity_replay_mismatch");
  };
  for (const mapping of [...input.plan.users].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  )) {
    const prior = await ledger("user", mapping.sourceId);
    let current = (
      await tx.query<NativeIdentityUser>(
        `SELECT ${userColumns} FROM users WHERE id=$1 FOR UPDATE`,
        [mapping.targetId],
      )
    ).rows[0];
    const expected =
      mapping.action === "reuse-verified-email"
        ? proof.targets.get(mapping.targetId)!
        : input.plan.createUsers.find((u) => u.sourceId === mapping.sourceId)!;
    const expectedSha = nativeIdentityDigest(storedUser(expected));
    const authCompanion=expected.kind==='account'&&expected.email?{id:mapping.targetId,email:expected.email,name:expected.name??null,provisionedAt:input.revokedAt}:undefined;
    if (prior) {
      verifyLedger(prior, mapping);
      if (
        !current ||
        prior.target_sha256 !== expectedSha ||
        nativeIdentityDigest(storedUser(plain(current))) !== expectedSha
      )
        throw Error("native_identity_replay_changed");
      if(authCompanion)await provisionNativeIdentityAuthCompanion(tx,authCompanion,authority,'verify-existing');
      result.replayed++;
      continue;
    }
    if (mapping.action === "reuse-verified-email") {
      if (
        !current ||
        nativeIdentityDigest(storedUser(plain(current))) !== expectedSha
      )
        throw Error("native_identity_target_changed");
      result.reusedUsers++;
    } else {
      if (current) throw Error("native_identity_user_collision");
      const u = storedUser(expected);
      await tx.query(
        "INSERT INTO users(id,email,kind,parent_user_id,merged_into_user_id,expires_at,created_at,name,username,image_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          u.id,
          u.email,
          u.kind,
          u.parent_user_id,
          u.merged_into_user_id,
          u.expires_at,
          u.created_at,
          u.name,
          u.username,
          u.image_key,
        ],
      );
      current = (
        await tx.query<NativeIdentityUser>(
          `SELECT ${userColumns} FROM users WHERE id=$1`,
          [mapping.targetId],
        )
      ).rows[0];
      if (
        !current ||
        nativeIdentityDigest(storedUser(plain(current))) !== expectedSha
      )
        throw Error("native_identity_create_verification_failed");
      result.createdUsers++;
    }
    if(authCompanion)await provisionNativeIdentityAuthCompanion(tx,authCompanion,authority,mapping.action==='reuse-verified-email'?'verify-existing':'create-or-preserve');
    await save("user", mapping, expectedSha, {
      sourceUser: storedUser(proof.users.get(mapping.sourceId)!),
    });
  }
  for (const mapping of [...input.plan.tokens].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  )) {
    const prior = await ledger("token", mapping.sourceId);
    if (prior) verifyLedger(prior, mapping);
    const revokedAt = prior
      ? nativeIdentityTimestamp(prior.created_at)
      : nativeIdentityTimestamp(input.revokedAt);
    // Deliberately NOT a SHA256 credential hash: no bearer plaintext can hash to this marker.
    const tokenHash =
      "!native-provenance:v1:" +
      nativeIdentityDigest([ns, mapping.sourceId, mapping.sourceRowSha256]);
    const expected = {
      id: mapping.targetId,
      user_id: mapping.userId,
      token_hash: tokenHash,
      name: "imported provenance (disabled)",
      created_at: nativeIdentityTimestamp(mapping.sourceCreatedAt ?? revokedAt),
      deleted_at: revokedAt,
      expires_at: revokedAt,
      audience: null,
      scope: null,
      request_authority: false,
    };
    const targetSha = nativeIdentityDigest(expected);
    const read = async () =>
      (
        await tx.query<typeof expected>(
          "SELECT id,user_id,token_hash,name,to_jsonb(tokens)->>'created_at' AS created_at,to_jsonb(tokens)->>'deleted_at' AS deleted_at,to_jsonb(tokens)->>'expires_at' AS expires_at,audience,scope,request_authority FROM tokens WHERE id=$1 FOR UPDATE",
          [mapping.targetId],
        )
      ).rows[0];
    let current = await read();
    if (prior) {
      if (
        !current ||
        prior.target_sha256 !== targetSha ||
        nativeIdentityDigest({
          ...plain(current),
          created_at: nativeIdentityTimestamp(current.created_at),
          deleted_at: current.deleted_at
            ? nativeIdentityTimestamp(current.deleted_at)
            : null,
          expires_at: current.expires_at
            ? nativeIdentityTimestamp(current.expires_at)
            : null,
        }) !== targetSha
      )
        throw Error("native_identity_token_replay_changed");
      result.replayed++;
      continue;
    }
    if (current) throw Error("native_identity_token_collision");
    await tx.query(
      "INSERT INTO tokens(id,user_id,token_hash,name,created_at,deleted_at,expires_at,audience,scope,request_authority) VALUES($1,$2,$3,$4,$5,$6,$6,NULL,NULL,false)",
      [
        expected.id,
        expected.user_id,
        expected.token_hash,
        expected.name,
        expected.created_at,
        revokedAt,
      ],
    );
    current = await read();
    if (
      !current ||
      nativeIdentityDigest({
        ...plain(current),
        created_at: nativeIdentityTimestamp(current.created_at),
        deleted_at: current.deleted_at
          ? nativeIdentityTimestamp(current.deleted_at)
          : null,
        expires_at: current.expires_at
          ? nativeIdentityTimestamp(current.expires_at)
          : null,
      }) !== targetSha
    )
      throw Error("native_identity_token_verification_failed");
    await save("token", mapping, targetSha, {
      sourceCreatedAt: mapping.sourceCreatedAt,
      sourceDeletedAt: mapping.sourceDeletedAt,
      sourceExpiresAt: mapping.sourceExpiresAt,
      forcedRevokedAt: revokedAt,
    });
    result.createdTokens++;
  }
  return result;
}
/** Atomic identity preparation; compose writeNativeIdentities with page publication for one larger transaction. */
export function importNativeIdentities(
  db: NativeIdentityImportDb,
  input: NativeIdentityImport,
  schemas:NativeIdentityMigrationSchemas,
) {
  return db.transaction(async(tx) => writeNativeIdentities(tx, input,await authorizeNativeIdentityTransaction(tx,schemas)));
}
