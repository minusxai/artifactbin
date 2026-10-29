/** Shared fixtures for the dataset write tests: a published readwrite dataset, accounts, and saved documents. */
import {expect} from 'vitest';
import {mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {createUser,identityForUser,type AccessActor} from '@/lib/accounts';
import {getArtifactById,type ArtifactRow} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {createArtifactFromBody} from '@/lib/publish/publish/requests';
import {isMutationRefused,mutateDataset} from '@/lib/document-data';

export type Db=Awaited<ReturnType<typeof getDb>>;
export async function account(name:string){
 const user=await createUser({email:`${name}@example.test`});const token=await mintAccountToken(name,user.id);
 return {id:user.id,email:user.email!,tokenId:token.id,actor:identityForUser(user.id,token.id,user.email)};
}
/** A dataset published by a fresh owner through the create pipeline (public, readwrite unless `body` says otherwise). */
export async function datasetFixture(body:Record<string,unknown>={}){
 const owner=await account('owner'),db=await getDb();
 const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:'public',...body},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
 expect(created.status,await created.clone().text()).toBe(201);
 const id=(await created.json()).id as string;
 const row=async()=>(await getArtifactById(id))!;
 const rows=async()=>loadDatasetRows(await row());
 return {db,owner,id,row,rows};
}
export const write=(dataset:ArtifactRow,actor:AccessActor,sql:string,guard:Parameters<typeof mutateDataset>[4]={})=>mutateDataset(dataset,actor,sql,{},guard);
export const refusal=(result:Awaited<ReturnType<typeof mutateDataset>>)=>isMutationRefused(result)?result.reason:null;
/** A saved document row owned by `owner`, public, at a known edit id. */
export async function document(db:Db,id:string,owner:{id:string;tokenId:string},format='markup'){
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,edit_id) VALUES($1,$2,$3,$4,'public',$5)",[id,owner.tokenId,owner.id,format,`${id}-edit`]);
 return {id,editId:`${id}-edit`};
}
