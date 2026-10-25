/** Disabled provenance tokens only. Called by the identity writer under its authority, namespace lock and publication transaction. */
import type {Queryable} from '@artifactbin/contracts';
import type {NativeIdentityImport} from './contracts';
import {nativeIdentityDigest,nativeIdentityTimestamp} from './model';
const plain=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
interface Ledger {source_id:string;target_id:string;action:string;source_sha256:string;target_sha256:string;created_at:string}
export async function writeDisabledNativeIdentityTokens(tx:Queryable,input:NativeIdentityImport):Promise<{createdTokens:number;replayed:number}>{
 const ns=input.plan.sourceNamespace,result={createdTokens:0,replayed:0};
 const verifyLedger=(prior:Ledger,mapping:NativeIdentityImport['plan']['tokens'][number])=>{if(prior.target_id!==mapping.targetId||prior.action!==mapping.action||prior.source_sha256!==mapping.sourceRowSha256)throw Error('native_identity_replay_mismatch');};
  const tokenMappings = [...input.plan.tokens].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
  if (tokenMappings.length) {
    const sourceIds = tokenMappings.map((mapping) => mapping.sourceId);
    const targetIds = tokenMappings.map((mapping) => mapping.targetId);
    const priorRows = (
      await tx.query<Ledger>(
        "SELECT source_id,target_id,action,source_sha256,target_sha256,original_state,to_jsonb(native_identity_imports)->>'created_at' AS created_at FROM native_identity_imports WHERE source_namespace=$1 AND kind='token' AND source_id=ANY($2::text[]) ORDER BY source_id FOR UPDATE",
        [ns, sourceIds],
      )
    ).rows;
    const currentRows = (
      await tx.query<{
        id: string; user_id: string | null; token_hash: string; name: string | null;
        created_at: string; deleted_at: string | null; expires_at: string | null;
        audience: string | null; scope: string | null; request_authority: boolean;
      }>(
        "SELECT id,user_id,token_hash,name,to_jsonb(tokens)->>'created_at' AS created_at,to_jsonb(tokens)->>'deleted_at' AS deleted_at,to_jsonb(tokens)->>'expires_at' AS expires_at,audience,scope,request_authority FROM tokens WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
        [targetIds],
      )
    ).rows;
    const priorBySource = new Map(priorRows.map((row) => [row.source_id, row]));
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    const mappingBySource = new Map(tokenMappings.map((mapping) => [mapping.sourceId, mapping]));
    const tokenInserts: {
      sourceId: string;
      targetId: string;
      action: string;
      sourceRowSha256: string;
      expected: {
        id: string; user_id: string | null; token_hash: string; name: string;
        created_at: string; deleted_at: string; expires_at: string;
        audience: null; scope: null; request_authority: false;
      };
      targetSha: string; revokedAt: string;
    }[] = [];
    for (const mapping of tokenMappings) {
      const prior = priorBySource.get(mapping.sourceId);
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
        request_authority: false as const,
      };
      const targetSha = nativeIdentityDigest(expected);
      const current = currentById.get(mapping.targetId);
      if (prior) {
        if (!current || prior.target_sha256 !== targetSha || nativeIdentityDigest({
          ...plain(current),
          created_at: nativeIdentityTimestamp(current.created_at),
          deleted_at: current.deleted_at ? nativeIdentityTimestamp(current.deleted_at) : null,
          expires_at: current.expires_at ? nativeIdentityTimestamp(current.expires_at) : null,
        }) !== targetSha) throw Error("native_identity_token_replay_changed");
        result.replayed++;
        continue;
      }
      if (current) throw Error("native_identity_token_collision");
      tokenInserts.push({
        sourceId: mapping.sourceId,
        targetId: mapping.targetId,
        action: mapping.action,
        sourceRowSha256: mapping.sourceRowSha256,
        expected,
        targetSha,
        revokedAt,
      });
    }
    if (tokenInserts.length) {
      const inserted = (
        await tx.query<{
          id: string; user_id: string | null; token_hash: string; name: string | null;
          created_at: string; deleted_at: string | null; expires_at: string | null;
          audience: string | null; scope: string | null; request_authority: boolean;
        }>(
          `INSERT INTO tokens(id,user_id,token_hash,name,created_at,deleted_at,expires_at,audience,scope,request_authority)
           SELECT item.id,item.user_id,item.token_hash,item.name,item.created_at,item.deleted_at,item.expires_at,NULL,NULL,false
           FROM jsonb_to_recordset($1::jsonb) AS item(id text,user_id text,token_hash text,name text,created_at timestamptz,deleted_at timestamptz,expires_at timestamptz)
           RETURNING id,user_id,token_hash,name,to_jsonb(tokens)->>'created_at' AS created_at,to_jsonb(tokens)->>'deleted_at' AS deleted_at,to_jsonb(tokens)->>'expires_at' AS expires_at,audience,scope,request_authority`,
          [JSON.stringify(tokenInserts.map(({expected})=>expected))],
        )
      ).rows;
      if (inserted.length !== tokenInserts.length) throw Error("native_identity_token_verification_failed");
      const insertedById = new Map(inserted.map((row) => [row.id, row]));
      for (const item of tokenInserts) {
        const current = insertedById.get(item.targetId);
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
          }) !== item.targetSha
        ) throw Error("native_identity_token_verification_failed");
      }
      const ledgerRows = tokenInserts.map((item) => ({
        source_id: item.sourceId,
        target_id: item.targetId,
        action: item.action,
        source_sha256: item.sourceRowSha256,
        target_sha256: item.targetSha,
        projection_sha256: input.plan.sha256,
        source_inventory_sha256: input.plan.sourceInventorySha256,
        target_inventory_sha256: input.plan.targetInventorySha256,
        original_state: {
          sourceCreatedAt: mappingBySource.get(item.sourceId)!.sourceCreatedAt,
          sourceDeletedAt: mappingBySource.get(item.sourceId)!.sourceDeletedAt,
          sourceExpiresAt: mappingBySource.get(item.sourceId)!.sourceExpiresAt,
          forcedRevokedAt: item.revokedAt,
        },
        created_at: item.revokedAt,
      }));
      await tx.query(
        `INSERT INTO native_identity_imports(source_namespace,kind,source_id,target_id,action,source_sha256,target_sha256,projection_sha256,source_inventory_sha256,target_inventory_sha256,original_state,created_at)
         SELECT $1,'token',item.source_id,item.target_id,item.action,item.source_sha256,item.target_sha256,item.projection_sha256,item.source_inventory_sha256,item.target_inventory_sha256,item.original_state,item.created_at
         FROM jsonb_to_recordset($2::jsonb) AS item(source_id text,target_id text,action text,source_sha256 text,target_sha256 text,projection_sha256 text,source_inventory_sha256 text,target_inventory_sha256 text,original_state jsonb,created_at timestamptz)`,
        [ns, JSON.stringify(ledgerRows)],
      );
      result.createdTokens += tokenInserts.length;
    }
  }
 return result;
}
