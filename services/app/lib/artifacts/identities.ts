/** Shared namespace for reserved and normally created identities. */
import type { AccessActor } from '@/lib/accounts';
import { getDb, type Queryable, generateFileId } from '../platform';
import {CreationReplay} from './creation-ledger';
import { accountOf, matchesWorkspaceAccount } from '../accounts';
import {reserveArtifactIdentityPool} from './reservation-pool';
import type {ArtifactReservationCandidate} from './reservation-pool-contracts';
const owner=accountOf;
export async function reserveIds(actor:AccessActor,batch:string,workspaceAccount?:string|null):Promise<string[]>{
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(batch))throw new CreationReplay({status:400,body:{error:'invalid_batch'}});
 // Preserve the original guest batch namespace after verified adoption, even
 // when the account already allocated a different pool with the same nonce.
 const current=owner(actor);
 if(workspaceAccount&&!await matchesWorkspaceAccount(workspaceAccount,current))throw new CreationReplay({status:409,body:{error:'account_mismatch',expected_account:workspaceAccount,actual_account:current}});
 const namespace=workspaceAccount||current;
 return(await getDb()).transaction(async tx=>{
  const inserted=await tx.query('INSERT INTO id_reservation_batches(owner,batch) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING batch',[namespace,batch]);
  if(!inserted.rows.length)return(await tx.query<{id:string}>('SELECT id FROM artifact_id_registry WHERE owner=$1 AND batch=$2 ORDER BY ordinal',[namespace,batch])).rows.map(row=>row.id);
  return reserveArtifactIdentityPool({generate:generateFileId,insert:async candidates=>{
   const result=await tx.query<ArtifactReservationCandidate>(`INSERT INTO artifact_id_registry(id,owner,batch,ordinal)
    SELECT candidate.id,$3,$4,candidate.ordinal FROM unnest($1::text[],$2::int[]) AS candidate(id,ordinal)
    WHERE NOT EXISTS(SELECT 1 FROM artifacts WHERE id=candidate.id) ORDER BY candidate.ordinal
    ON CONFLICT(id) DO NOTHING RETURNING id,ordinal`,[candidates.map(candidate=>candidate.id),candidates.map(candidate=>candidate.ordinal),namespace,batch]);
   return result.rows;
  }});
 });
}
/**
 * Reserve `count` ids BEFORE a transaction opens, for a creation that writes
 * several rows atomically (lib/artifacts forkArtifact's dataset copies).
 *
 * `createArtifact` normally mints inside its own transaction and retries the
 * birthday collision by starting over; a row created inside somebody ELSE's
 * transaction cannot do that, because the PK violation has already poisoned it.
 * So the collision is paid out here, where a retry is just another statement,
 * and the ids go in reserved-but-unconsumed — the state `claimArtifactId`
 * already knows how to consume. A rolled-back creation leaves its reservations
 * behind unconsumed, which costs one registry row and reveals nothing.
 */
export async function reserveArtifactIds(actor:AccessActor,count:number):Promise<string[]>{
 const db=await getDb();const ids:string[]=[];
 for(let attempt=0;ids.length<count&&attempt<count*20+20;attempt++){
  const id=generateFileId();
  const inserted=await db.query<{id:string}>('INSERT INTO artifact_id_registry(id,owner) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM artifacts WHERE id=$1) ON CONFLICT(id) DO NOTHING RETURNING id',[id,owner(actor)]);
  if(inserted.rows.length)ids.push(id);
 }
 if(ids.length!==count)throw new Error('ID allocation exhausted');
 return ids;
}
export async function claimArtifactId(tx:Queryable,id:string,actor:AccessActor,reserved:boolean):Promise<void>{
 if(!reserved){await tx.query('INSERT INTO artifact_id_registry(id,owner,consumed) VALUES($1,$2,true)',[id,owner(actor)]);return;}
 // Adoption authorizes the current account without rewriting the old pool's
 // owner. Check it inside the claim statement so consumption remains atomic.
 const owned="(registry.owner=$2 OR EXISTS(SELECT 1 FROM users WHERE users.id=registry.owner AND users.kind='guest' AND users.merged_into_user_id=$2))";
 const claimed=await tx.query(`UPDATE artifact_id_registry AS registry SET consumed=true WHERE id=$1 AND ${owned} AND consumed=false RETURNING id`,[id,owner(actor)]);
 if(claimed.rows.length)return;
 const record=(await tx.query<{owned:boolean}>(`SELECT ${owned} AS owned FROM artifact_id_registry AS registry WHERE id=$1`,[id,owner(actor)])).rows[0];
 throw new CreationReplay(record?.owned?{status:409,body:{error:'identity_consumed'}}:{status:403,body:{error:'reservation_not_owned'}});
}
