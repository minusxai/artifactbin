/** Test-only historical head seed. Public creation must never accept legacy editor heads. */
import {createArtifact,type ArtifactInput} from '@/lib/artifacts';
import {canonicalizeHtmlPage} from '@/lib/html-page';
import {getDb} from '@/lib/platform';
export async function createHistoricalPage(tokenId:string|null,userId:string|null,input:ArtifactInput){
 const page=canonicalizeHtmlPage(input.source!);
 const row=await createArtifact(tokenId,userId,{...input,source:'<p>Historical placeholder</p>'});
 const meta={...row.meta,...input.meta,htmlIdentity:page.ledger};
 const db=await getDb();
 await db.transaction(async tx=>{
  await tx.query('UPDATE artifacts SET source=$2,meta=$3 WHERE id=$1',[row.id,page.html,JSON.stringify(meta)]);
  await tx.query('DELETE FROM artifact_source_ids WHERE artifact_id=$1',[row.id]);
  for(const id of page.nodeIds)await tx.query("INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version) VALUES($1,$2,'authored',$3)",[row.id,id,row.version]);
 });
 return {...row,source:page.html,meta};
}
