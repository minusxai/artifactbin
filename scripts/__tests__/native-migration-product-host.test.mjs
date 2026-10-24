import {it,expect,beforeAll} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
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
import {createNativeProductMigrationHost} from '../lib/native-migration-bootstrap';
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
 const source=bytes({heads:[{id:sourceId,version:3,edit_id:'synthetic-edit',document:{kind:'graph',nodes:{}}}],versions:[]}),selection=bytes({receipts:[{id:sourceId,path:'source.json',sha256:sha(source),expectedVersion:3,bytes:source.length}]}),capture=bytes({snapshot:[{read_only:'on'}],relations:[]}),witness=bytes({snapshot:[{read_only:'on'}],relations:[{id:sourceId,version:3,edit_id:'synthetic-edit'}]});
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
   const recipe=await fixture(prefix,root);
   if(prefix==='HostSecond'){for(const [field,value] of Object.entries(recipe.membership.source))recipe.membership.source[field]={encoding:'base64',data:Buffer.from(value).toString('base64'),sha256:sha(value)};}
   const prepared=await prepareNativeProductImport(recipe);
   expect(await prepared.import(db)).toMatchObject({disposition:'created',identities:{createdUsers:1,createdTokens:1}});
   expect(await prepared.import(db)).toMatchObject({disposition:'unchanged'});
   expect((await db.query('SELECT user_id,token_id,version FROM artifacts WHERE id=$1',[recipe.history.pageId])).rows[0]).toEqual({user_id:prefix+'user',token_id:prefix+'token',version:3});
   const runtimeAssembly={key:{sourceNamespace:prefix,sourceId:recipe.history.sourceId,version:3},sha256:sha(prefix+'assembly'),result:{status:'complete',html:recipe.history.revisions[0].page.html,htmlSha256:sha(recipe.history.revisions[0].page.html),files:[]}};
   const runtimeOptions={pageId:recipe.history.pageId,actor:{userId:prefix+'user',tokenId:prefix+'token'},origin:'http://localhost:3000',visibility:'private',shares:[]};
   const runtime=await prepareNativeProductRuntime([runtimeAssembly],runtimeOptions);runtimeOptions.pageId='MutatedDestination';
   expect(runtime.prepareBundle(runtimeAssembly,recipe.history.pageId).sourceHtmlSha256).toBe(runtimeAssembly.result.htmlSha256);
   expect(()=>runtime.prepareBundle({...runtimeAssembly,key:{...runtimeAssembly.key,sourceId:'other'}},recipe.history.pageId)).toThrow('runtime_binding');
   const raw=db.raw();if(raw.kind!=='pglite')throw Error('pglite');const dump=await raw.instance.dumpDataDir('none'),html=recipe.history.revisions[0].page.html;
   const snapshot=await prepareNativeMigrationSnapshot({history:recipe.history,databaseDump:new Uint8Array(await dump.arrayBuffer()),reader:{pageId:recipe.history.pageId,version:3,accountEmail:recipe.identity.sourceInventory.users[0].email,datasetIds:[],identityPlanSha256:recipe.identity.plan.sha256},assembly:{key:{sourceNamespace:prefix,sourceId:recipe.history.sourceId,version:3},result:{status:'complete',html,htmlSha256:sha(html),files:[]}},objectsDirectory:recipe.catalog.sinkDirectory,outputDirectory:path.join(root,prefix)});
   expect(snapshot.preparedStore.reader.pageId).toBe(recipe.history.pageId);expect(snapshot.bundleFiles).toEqual([{path:'index.html',sha256:sha(html)}]);
  }
  const rolledBack=await fixture('HostRollback',root);rolledBack.history.revisions[0].sourceSha256=sha('wrong-html');
  const broken=await prepareNativeProductImport(rolledBack);await expect(broken.import(db)).rejects.toThrow('native_import_invalid');
  expect((await db.query('SELECT id FROM users WHERE id=$1',['HostRollbackuser'])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM auth."user" WHERE id=$1',['HostRollbackuser'])).rows).toEqual([]);
  const encoded=await fixture('HostEncoded',root);encoded.membership.source.capture={encoding:'base64',data:Buffer.from('wrong').toString('base64'),sha256:sha('expected')};
  await expect(prepareNativeProductImport(encoded)).rejects.toThrow('source_digest');
  const denied=await fixture('HostDenied',root);denied.schemas={};
  await expect((await prepareNativeProductImport(denied)).import(db)).rejects.toThrow('scope_required');
  expect((await db.query('SELECT id FROM users WHERE id=$1',['HostDenieduser'])).rows).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

it('one shared bootstrap imports and snapshots two source recipes through the same actual product modules',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'native-bootstrap-'));
 try{
  const db=await getDb();
  for(const prefix of ['BootstrapFirst','BootstrapSecond']){
   const publicationRecipe=await fixture(prefix,root),key={sourceNamespace:prefix,sourceId:publicationRecipe.history.sourceId,version:3};
   const html=publicationRecipe.history.revisions[0].page.html,assembly={key,sha256:sha(prefix+'assembly'),result:{status:'complete',html,htmlSha256:sha(html),files:[]}};
   const canonical=Buffer.from(publicationRecipe.membership.source.canonicalSource),row=JSON.parse(canonical).heads[0],source='<p>Synthetic</p>',recovery=bytes({key,documentSha256:digest(row.document),sourceSha256:sha(source),source});
   const probe=Buffer.from('export async function mountImportedPilot(){return {}}');
   const canonicalPath=path.join(root,prefix+'canonical.json'),recoveryPath=path.join(root,prefix+'recovery.json'),probePath=prefix+'probe.mjs',templatePath=path.join(root,prefix+'template.json'),cameraPath=path.join(root,prefix+'camera.json');
   await writeFile(canonicalPath,canonical);await writeFile(recoveryPath,recovery);await writeFile(path.join(root,probePath),probe);
   const template={format:'native-migration-pilot-v1',implementation:'html',preparedStore:{},probe:{path:probePath,sha256:sha(probe)},harnessSha256:sha('harness'),gateManifestSha256:sha('gate'),originalRevision:'a'.repeat(40),candidateRevision:'b'.repeat(40),canonicalSha256:sha(canonical),recoverySha256:sha(recovery),key,rowSha256:digest(row),documentSha256:digest(row.document),sourceSha256:sha(source),bundleFiles:[{path:'index.html',sha256:sha(html)},{path:probePath,sha256:sha(probe)}],theme:'light',viewports:[{width:390,height:844}],states:[{id:'initial',actions:[]}]};
   await writeFile(templatePath,JSON.stringify(template));await writeFile(cameraPath,JSON.stringify({format:'native-migration-camera-recipe-v1',base:'http://localhost:3000',paths:{input:templatePath,canonical:canonicalPath,recovery:recoveryPath,bundle:root,output:path.join(root,'capture')}}));
   const inputs={};for(const name of ['sourceHead','compiledHtml','datasetCatalog','identity','authSchemaCapability','membership','comments']){const content=name==='compiledHtml'?html:name==='sourceHead'?canonical:bytes(name);const relative=prefix+name;await writeFile(path.join(root,relative),content);inputs[name]={path:relative,sha256:sha(content)};}
   const reviewed={format:'native-migration-host-v1',revisionScope:'latest',key,assemblySha256:assembly.sha256,sourceRevision:'a'.repeat(40),targetRevision:'b'.repeat(40),inputs,authority:{appSchema:'public',authSchema:'auth',capabilities:['reviewed-migration']}};
   const authorityRecipePath=path.join(root,prefix+'authority.json');await writeFile(authorityRecipePath,JSON.stringify(reviewed));
   const host=createNativeProductMigrationHost({db,objectsDirectory:publicationRecipe.catalog.sinkDirectory,publication:async({prepareRuntime,publicationModules})=>{expect(publicationModules.commentNodeIds(html)).toContain('stable');const runtime=await prepareRuntime([assembly],{pageId:publicationRecipe.history.pageId,actor:{userId:prefix+'user',tokenId:prefix+'token'},origin:'http://localhost:3000',visibility:'private',shares:[]});expect(runtime.prepareBundle(assembly,publicationRecipe.history.pageId).assemblySha256).toBe(assembly.sha256);return publicationRecipe;},captureAndCompare:async()=>{throw Error('actual camera lifecycle belongs to the gate');}});
   const imported=await host.importAndPrepare({revision:{key},assembly,receiptRoot:root,outputDirectory:path.join(root,prefix+'output'),authorityRecipePath,candidateRecipePath:cameraPath});
   expect(imported).toMatchObject({key,stage:'imported',assemblySha256:assembly.sha256});
   const input=JSON.parse(await readFile(imported.pilotInputPath,'utf8'));expect(input.preparedStore.reader.pageId).toBe(publicationRecipe.history.pageId);expect(input.bundleFiles).toEqual([{path:'index.html',sha256:sha(html)},template.probe]);
  }
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
