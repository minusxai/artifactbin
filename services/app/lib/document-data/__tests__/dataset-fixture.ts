/** Shared fixtures for the dataset write tests: a published readwrite dataset and accounts. */
import {expect} from 'vitest';
import {mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { createUser } from '@/lib/accounts/testing';
import {getArtifactById,type ArtifactRow} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets';
import {createArtifactFromBody} from '@/lib/publish';
import {isMutationRefused,mutateDataset} from '@/lib/document-data';

export type Db=Awaited<ReturnType<typeof getDb>>;
export async function account(name:string){
 const user=await createUser({email:`${name}@example.test`});const token=await mintAccountToken(name,user.id);
 return {id:user.id,email:user.email!,token:token.token,tokenId:token.id,actor:identityForUser(user.id,token.id,user.email)};
}
/** A dataset published by a fresh owner through the create pipeline (public, readwrite unless `body` says otherwise). */
export async function datasetFixture(body:Record<string,unknown>={}){
 const owner=await account('owner'),db=await getDb();
 const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:'public',...body},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
 expect(created.status,JSON.stringify(created.body)).toBe(201);
 const id=created.body.id as string;
 const row=async()=>(await getArtifactById(id))!;
 const rows=async()=>loadDatasetRows(await row());
 return {db,owner,id,row,rows};
}
export const write=(dataset:ArtifactRow,actor:AccessActor,sql:string,guard:Parameters<typeof mutateDataset>[3]={})=>mutateDataset(dataset,actor,[{sql,params:{}}],guard);
export const refusal=(result:Awaited<ReturnType<typeof mutateDataset>>)=>isMutationRefused(result)?result.reason:null;

/** A published page names the dataset as data_rows at its public SQL door. */
export async function datasetPage(owner: Awaited<ReturnType<typeof account>>, id: string) {
 const created=await createArtifactFromBody({
  html:`<html><head><link rel="af-dataset" data-af-name="data_rows" href="ref:${id}"></head><body>Dataset</body></html>`,
  visibility:'unlisted',
 },{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
 expect(created.status,JSON.stringify(created.body)).toBe(201);
 return created.body.id as string;
}
