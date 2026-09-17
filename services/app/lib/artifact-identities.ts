/** Shared namespace for reserved and normally created identities. */
import type {TokenActor} from './artifacts';
import {getDb,type Queryable} from './db';
import {generateFileId} from './ids';
import {CreationReplay} from './creation-ledger';
const owner=(actor:TokenActor)=>actor.userId??actor.tokenId;
export async function reserveIds(actor:TokenActor,batch:string):Promise<string[]>{
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(batch))throw new CreationReplay({status:400,body:{error:'invalid_batch'}});
 return(await getDb()).transaction(async tx=>{
  const inserted=await tx.query('INSERT INTO id_reservation_batches(owner,batch) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING batch',[owner(actor),batch]);
  if(!inserted.rows.length)return(await tx.query<{id:string}>('SELECT id FROM artifact_id_registry WHERE owner=$1 AND batch=$2 ORDER BY ordinal',[owner(actor),batch])).rows.map(row=>row.id);
  const ids:string[]=[];
  for(let attempt=0;ids.length<100&&attempt<1000;attempt++){
   const id=generateFileId();
   const result=await tx.query('INSERT INTO artifact_id_registry(id,owner,batch,ordinal) SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM artifacts WHERE id=$1) ON CONFLICT(id) DO NOTHING RETURNING id',[id,owner(actor),batch,ids.length]);
   if(result.rows.length)ids.push(id);
  }
  if(ids.length!==100)throw new Error('ID allocation exhausted');return ids;
 });
}
export async function claimArtifactId(tx:Queryable,id:string,actor:TokenActor,reserved:boolean):Promise<void>{
 if(!reserved){await tx.query('INSERT INTO artifact_id_registry(id,owner,consumed) VALUES($1,$2,true)',[id,owner(actor)]);return;}
 const claimed=await tx.query('UPDATE artifact_id_registry SET consumed=true WHERE id=$1 AND owner=$2 AND consumed=false RETURNING id',[id,owner(actor)]);
 if(claimed.rows.length)return;
 const record=(await tx.query<{owner:string}>('SELECT owner FROM artifact_id_registry WHERE id=$1',[id])).rows[0];
 throw new CreationReplay(record?.owner===owner(actor)?{status:409,body:{error:'identity_consumed'}}:{status:403,body:{error:'reservation_not_owned'}});
}
