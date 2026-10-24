import {it,expect,beforeAll} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createHumanAuth} from '@artifactbin/auth';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {canonicalizeHtmlPage} from '@/lib/html-page';
import {pageSourceDigest} from '@/lib/registered-page-queries/registry';
import {nativeIdentityDigest as digest} from '@/lib/native-identity-import/model';
import {prepareNativeProductImport,prepareNativeProductRuntime} from '../lib/native-migration-product-host';
import {prepareNativeMigrationSnapshot} from '../lib/native-migration-snapshot.mjs';
useAppHarness();
const bytes=v=>Buffer.from(JSON.stringify(v)),sha=v=>createHash('sha256').update(v).digest('hex'),at='2020-01-01T00:00:00.000Z';
beforeAll(async()=>{const raw=(await getDb()).raw();if(raw.kind!=='pglite')throw Error('pglite required');await createHumanAuth({pglite:raw.instance,secret:'synthetic-host-auth'.padEnd(32,'0'),baseURL:'http://localhost:3000',mail:{send:async()=>{}}});});
async function fixture(prefix,root){
 const sourceId=prefix+'source',pageId=prefix+'Target',userId=prefix+'user',tokenId=prefix+'token';
 const user={id:userId,email:prefix.toLowerCase()+'@example.test',kind:'account',parent_user_id:null,merged_into_user_id:null,expires_at:null,created_at:at,name:'Synthetic',username:null,image_key:null};
 const token={id:tokenId,user_id:userId,created_at:at,deleted_at:null,expires_at:null};
 const sourceInventory={users:[user],tokens:[token]},targetInventory={users:[]};
 const body={sourceNamespace:prefix,sourceInventorySha256:digest(sourceInventory),targetInventorySha256:digest(targetInventory),targets:{users:{[userId]:{userId,email:user.email}},actors:{[user.email]:{userId}},tokens:{[tokenId]:{tokenId}}},users:[{sourceId:userId,targetId:userId,action:'create-preserved',sourceRowSha256:digest(user)}],createUsers:[{...user,sourceId:userId,sourceRowSha256:digest(user)}],tokens:[{sourceId:tokenId,targetId:tokenId,userId,action:'create-disabled-provenance',sourceRowSha256:digest(token),sourceCreatedAt:at,sourceDeletedAt:null,sourceExpiresAt:null}],blockers:[],artifactIds:{[sourceId]:pageId}};
 const plan={...body,sha256:digest(body)},identity={plan,approvedPlanSha256:plan.sha256,sourceInventory,targetInventory,revokedAt:at};
 const source=bytes({heads:[{id:sourceId,version:3,edit_id:'synthetic-edit'}]}),selection=bytes({receipts:[{id:sourceId,path:'source.json',sha256:sha(source),expectedVersion:3,bytes:source.length}]}),capture=bytes({snapshot:[{read_only:'on'}],relations:[]}),witness=bytes({snapshot:[{read_only:'on'}],relations:[{id:sourceId,version:3,edit_id:'synthetic-edit'}]});
 const canonical=canonicalizeHtmlPage('<html><head></head><body><p data-af-id="stable">Synthetic</p></body></html>');
 const history={sourceNamespace:prefix,sourceId,selectionSha256:sha(selection),projectionSha256:sha(prefix),pageId,owner:{userId,tokenId},visibility:'private',linkRole:'viewer',shares:[],headVersion:3,revisions:[{page:{pageId,version:3,revision:'3',html:canonical.html,nextNodeId:canonical.ledger.nextNodeId,links:[]},ledger:canonical.ledger,sourceSha256:pageSourceDigest(canonical.html),title:prefix,description:null,createdAt:at,actorUserId:userId,actorTokenId:tokenId,queries:[],mutations:[]}]};
 const membership={history,identityPlan:plan,source:{capture,selectionManifest:selection,canonicalSource:source,headWitness:witness},approved:{captureSha256:sha(capture),selectionManifestSha256:sha(selection),headWitnessSha256:sha(witness),identityPlanSha256:plan.sha256}};
 await writeFile(path.join(root,'objects.json'),'[]');
 const payload={revisionScope:'latest',identityPlanSha256:plan.sha256,imports:[],identities:{users:{[userId]:userId},tokens:{[tokenId]:tokenId},groups:{},artifacts:{[sourceId]:pageId}},sourceNamespace:prefix,selectionSha256:history.selectionSha256,sourceManifestSha256:sha('closure'),objectManifestSha256:sha('[]'),datasets:[],objects:[]};
 return {revisionScope:'latest',history,identity,schemas:{appSchema:'public',authSchema:'auth'},membership,relations:{history,bindings:[],annotations:[],members:[],images:[]},catalog:{projection:{...payload,sha256:digest(payload)},root,ledgerPath:'objects.json',receipts:{},sinkDirectory:path.join(root,'sink')}};
}
it('runs actual adapters for two unrelated reviewed source identities, verifies replay and denies empty schema authority',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'product-host-'));
 try{
  const db=await getDb();
  for(const prefix of ['HostFirst','HostSecond']){
   const recipe=await fixture(prefix,root),prepared=await prepareNativeProductImport(recipe);
   expect(await prepared.import(db)).toMatchObject({disposition:'created',identities:{createdUsers:1,createdTokens:1}});
   expect(await prepared.import(db)).toMatchObject({disposition:'unchanged'});
   expect((await db.query('SELECT user_id,token_id,version FROM artifacts WHERE id=$1',[recipe.history.pageId])).rows[0]).toEqual({user_id:prefix+'user',token_id:prefix+'token',version:3});
   const runtimeAssembly={key:{sourceNamespace:prefix,sourceId:recipe.history.sourceId,version:3},sha256:sha(prefix+'assembly'),result:{status:'complete',html:recipe.history.revisions[0].page.html,htmlSha256:sha(recipe.history.revisions[0].page.html),files:[]}};
   const runtime=await prepareNativeProductRuntime([runtimeAssembly],{pageId:recipe.history.pageId,actor:{userId:prefix+'user',tokenId:prefix+'token'},origin:'http://localhost:3000',visibility:'private',shares:[]});
   expect(runtime.prepareBundle(runtimeAssembly,recipe.history.pageId).sourceHtmlSha256).toBe(runtimeAssembly.result.htmlSha256);
   expect(()=>runtime.prepareBundle({...runtimeAssembly,key:{...runtimeAssembly.key,sourceId:'other'}},recipe.history.pageId)).toThrow('runtime_binding');
   const raw=db.raw();if(raw.kind!=='pglite')throw Error('pglite');const dump=await raw.instance.dumpDataDir('none'),html=recipe.history.revisions[0].page.html;
   const snapshot=await prepareNativeMigrationSnapshot({databaseDump:new Uint8Array(await dump.arrayBuffer()),reader:{pageId:recipe.history.pageId,version:3,accountEmail:recipe.identity.sourceInventory.users[0].email,datasetIds:[],identityPlanSha256:recipe.identity.plan.sha256},assembly:{key:{sourceNamespace:prefix,sourceId:recipe.history.sourceId,version:3},result:{status:'complete',html,htmlSha256:sha(html),files:[]}},objectsDirectory:recipe.catalog.sinkDirectory,outputDirectory:path.join(root,prefix)});
   expect(snapshot.preparedStore.reader.pageId).toBe(recipe.history.pageId);expect(snapshot.bundleFiles).toEqual([{path:'index.html',sha256:sha(html)}]);
  }
  const rolledBack=await fixture('HostRollback',root);rolledBack.history.revisions[0].sourceSha256=sha('wrong-html');
  const broken=await prepareNativeProductImport(rolledBack);await expect(broken.import(db)).rejects.toThrow('native_import_invalid');
  expect((await db.query('SELECT id FROM users WHERE id=$1',['HostRollbackuser'])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM auth."user" WHERE id=$1',['HostRollbackuser'])).rows).toEqual([]);
  const denied=await fixture('HostDenied',root);denied.schemas={};
  await expect((await prepareNativeProductImport(denied)).import(db)).rejects.toThrow('scope_required');
  expect((await db.query('SELECT id FROM users WHERE id=$1',['HostDenieduser'])).rows).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
