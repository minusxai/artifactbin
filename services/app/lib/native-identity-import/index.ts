import {nativeIdentityAvatarObject} from './avatars';
import {writeDisabledNativeIdentityTokens} from './token-batch';
import {provisionNativeIdentityAuthCompanion,authorizeNativeIdentityTransaction,nativeIdentityMigrationScope,readNativeIdentityAuthCompanions,verifyNativeIdentityAuthCompanion} from './auth-companions';
export {provisionNativeIdentityAuthCompanion,authorizeNativeIdentityTransaction} from './auth-companions';
import type { Queryable } from "@artifactbin/contracts";
import type {
  NativeIdentityImport,
  NativeIdentityMigrationAuthority,
  NativeIdentityMigrationSchemas,
  NativeIdentityImportDb,
  NativeIdentityImportResult,
  NativeIdentityUser,
  NativeIdentityAvatarPreparation,
} from "./contracts";
import {
  nativeIdentityDigest,
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
  avatars?:NativeIdentityAvatarPreparation,
): Promise<NativeIdentityImportResult> {
  // Capture caller-owned input before the first await, so it cannot change during a transaction.
  const input = plain(raw);
  await nativeIdentityMigrationScope(tx,authority);
  const proof = verifyNativeIdentityInput(input),
    result = { createdUsers: 0, reusedUsers: 0, createdTokens: 0, replayed: 0 };
  const ns = input.plan.sourceNamespace;
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtext('native-identity:' || $1))",
    [ns],
  );
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
  const mappings=[...input.plan.users].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
  // One locked read per table instead of one per user: each round trip crosses the operator's network.
  const priors=new Map((await tx.query<Ledger&{source_id:string}>(
    "SELECT source_id,target_id,action,source_sha256,target_sha256,original_state,to_jsonb(native_identity_imports)->>'created_at' AS created_at FROM native_identity_imports WHERE source_namespace=$1 AND kind='user' AND source_id=ANY($2::text[]) ORDER BY source_id FOR UPDATE",
    [ns,mappings.map(m=>m.sourceId)])).rows.map(({source_id,...row})=>[source_id,row as Ledger]));
  const currents=new Map((await tx.query<NativeIdentityUser>(
    `SELECT ${userColumns} FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [mappings.map(m=>m.targetId)])).rows.map(row=>[row.id,row]));
  const companions=await readNativeIdentityAuthCompanions(tx,authority,mappings.flatMap(m=>{const e=m.action==='reuse-verified-email'?proof.targets.get(m.targetId):input.plan.createUsers.find(u=>u.sourceId===m.sourceId);return e?.kind==='account'&&e.email?[{id:m.targetId,email:e.email}]:[];}));
  for (const mapping of mappings) {
    const prior = priors.get(mapping.sourceId);
    let current = currents.get(mapping.targetId);
    const expected =
      mapping.action === "reuse-verified-email"
        ? proof.targets.get(mapping.targetId)!
        : input.plan.createUsers.find((u) => u.sourceId === mapping.sourceId)!;
    const expectedSha = nativeIdentityDigest(storedUser(expected));
    const avatar=nativeIdentityAvatarObject(input,mapping.sourceId,avatars);
    // This optional amendment permits only image changes; all other reviewed columns remain exact.
    const missingAvatar=avatar&&mapping.action==='reuse-verified-email'&&!expected.image_key;
    const currentSha=()=>nativeIdentityDigest(storedUser(plain(missingAvatar&&current?{...current,image_key:null}:current!)));
    const backfill=async()=>{if(missingAvatar&&current&&!current.image_key){
      await tx.query('UPDATE users SET image_key=$1 WHERE id=$2 AND image_key IS NULL',[avatar.key,mapping.targetId]);
    }};
    const authCompanion=expected.kind==='account'&&expected.email?{id:mapping.targetId,email:expected.email,name:expected.name??null,provisionedAt:input.revokedAt}:undefined;
    if (prior) {
      verifyLedger(prior, mapping);
      if (
        !current ||
        prior.target_sha256 !== expectedSha ||
        currentSha() !== expectedSha
      )
        throw Error("native_identity_replay_changed");
      if(missingAvatar){
        if(prior.original_state.avatarObject&&JSON.stringify(prior.original_state.avatarObject)!==JSON.stringify(avatar))throw Error('native_identity_avatar_replay');
        if(!prior.original_state.avatarObject){
          await backfill();
          await tx.query("UPDATE native_identity_imports SET original_state=original_state || $1::jsonb WHERE source_namespace=$2 AND kind='user' AND source_id=$3",[JSON.stringify({avatarObject:avatar}),ns,mapping.sourceId]);
        }
      }
      if(authCompanion)verifyNativeIdentityAuthCompanion(companions,authCompanion);
      result.replayed++;
      continue;
    }
    if (mapping.action === "reuse-verified-email") {
      if (
        !current ||
        currentSha() !== expectedSha
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
        currentSha() !== expectedSha
      )
        throw Error("native_identity_create_verification_failed");
      result.createdUsers++;
    }
    if(authCompanion)await provisionNativeIdentityAuthCompanion(tx,authCompanion,authority,mapping.action==='reuse-verified-email'?'verify-existing':'create-or-preserve');
    await backfill();
    await save("user", mapping, expectedSha, {
      ...(missingAvatar?{avatarObject:avatar}:{}),
      sourceUser: storedUser(proof.users.get(mapping.sourceId)!),
    });
  }
  const tokenResult=await writeDisabledNativeIdentityTokens(tx,input);
  result.createdTokens+=tokenResult.createdTokens;
  result.replayed+=tokenResult.replayed;
  return result;
}
/** Atomic identity preparation; compose writeNativeIdentities with page publication for one larger transaction. */
export async function importNativeIdentities(
  db: NativeIdentityImportDb,
  input: NativeIdentityImport,
  schemas:NativeIdentityMigrationSchemas,
) {
  const capturedInput=plain(input),capturedSchemas=schemas&&plain(schemas);
  return db.transaction(async(tx) => writeNativeIdentities(tx, capturedInput,await authorizeNativeIdentityTransaction(tx,capturedSchemas)));
}
