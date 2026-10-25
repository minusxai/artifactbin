import {dockerRunArgs} from '../lib/gate-container.mjs';
import {describe,it,expect} from 'vitest';
import {preparedPilotStoreDigest as digest} from '../lib/native-prepared-pilot-store.mjs';
import {admitNativeMigrationBatch,runNativeMigrationCaptureBatch} from '../lib/native-migration-batch-camera.mjs';
const seal=x=>({...x,sha256:digest(x)}),hash='a'.repeat(64);
function fixture(){const store={format:'native-prepared-store-v1',directory:'prepared-store',files:[{path:'database/PG_VERSION',sha256:hash,bytes:2},{path:'objects/object',sha256:hash,bytes:2}],directories:['database','objects']};const entries=['sourceA','sourceB'].map((id,index)=>({input:{implementation:'html',candidateRevision:'b'.repeat(40),originalRevision:'c'.repeat(40),harnessSha256:hash,gateManifestSha256:hash,key:{sourceNamespace:'synthetic',sourceId:id,version:index+1},probe:{path:'probe.mjs',sha256:hash},preparedStore:seal({...store,reader:{pageId:'target'+index,version:index+1,accountEmail:`owner${index}@example.com`,identityPlanSha256:hash,datasetIds:[]}})},paths:{input:`/private/${id}.json`,canonical:`/private/${id}-canonical.json`,recovery:`/private/${id}-recovery.json`,bundle:'/private/bundle',output:`/private/output/${id}`}}));return {manifest:seal({format:'native-migration-capture-batch-v1',revisionScope:'latest',implementation:'html',entries:entries.map(e=>({input:{path:e.input.key.sourceId+'.json',sha256:hash},canonical:{path:'canonical.json',sha256:hash},recovery:{path:'recovery.json',sha256:hash},bundle:'bundle',output:e.input.key.sourceId,mutableDatasetIds:[]}))}),entries};}
describe('same-store batch camera',()=>{
 it('captures two independently owned heads with one supplied browser/base and exact own paths',async()=>{const x=fixture(),admitted=admitNativeMigrationBatch(x.manifest,x.entries),calls=[],browser={};let tick=0;const result=await runNativeMigrationCaptureBatch(admitted,{browser,connectAgent(){},base:'http://app.lvh.me:3000',now:()=>++tick,capture:async o=>{calls.push(o);return {source:o.paths.input};}});expect(calls).toHaveLength(2);expect(calls.every(o=>o.browser===browser&&o.base==='http://app.lvh.me:3000')).toBe(true);expect(calls.map(c=>c.paths.input)).toEqual(x.entries.map(e=>e.paths.input));expect(result.entries.map(e=>e.key)).toEqual(x.entries.map(e=>e.input.key));expect(result.complete).toBe(true);});
 it('rejects different database/object/auth bytes before a capture can run',()=>{for(const change of ['file','secret','identity']){const x=fixture(),s=x.entries[1].input.preparedStore;if(change==='file')s.files=[...s.files,{path:'objects/extra',sha256:hash,bytes:1}];if(change==='secret')s.fixtureAuthSecret={path:'fixture-auth-secret',sha256:hash,bytes:32,provenance:'disposable-target-test-key'};if(change==='identity')s.reader.identityPlanSha256='b'.repeat(64);const {sha256,...body}=s;x.entries[1].input.preparedStore=seal(body);expect(()=>admitNativeMigrationBatch(x.manifest,x.entries)).toThrow('batch-store');}});
 it('rejects duplicate heads, reused output, wrong implementation/version and missing probes',()=>{for(const change of ['duplicate','output','kind','version','probe']){const x=fixture();if(change==='duplicate')x.entries[1].input.key={...x.entries[0].input.key};if(change==='output')x.entries[1].paths.output=x.entries[0].paths.output;if(change==='kind')x.entries[1].input.implementation='jsx';if(change==='version')x.entries[1].input.preparedStore.reader.version=999;if(change==='probe')delete x.entries[1].input.probe;expect(()=>admitNativeMigrationBatch(x.manifest,x.entries)).toThrow();}});
 it('retains perhead failures and continues independent cameras without claiming verified parity',async()=>{const x=fixture();let calls=0;const result=await runNativeMigrationCaptureBatch(admitNativeMigrationBatch(x.manifest,x.entries),{browser:{},base:'http://localhost:3000',connectAgent(){},capture:async()=>{if(++calls===1)throw Error('real-probe-failed');return {captured:true};}});expect(calls).toBe(2);expect(result.complete).toBe(false);expect(result.entries.map(e=>e.status)).toEqual(['failed','captured']);expect(result.entries[0].error).toBe('real-probe-failed');expect(result).not.toHaveProperty('verified');});
});

it('mounts one read-only batch and separate evidence into one server container, rejecting extra servers or mixed pilot mode',()=>{
 const base={name:'test',image:'test',volume:'test',buildKey:'test',worktree:'/worktree',cpus:4,memory:'8g',servers:1,gates:['component-baseline'],env:{NATIVE_MIGRATION_BATCH__ROOT:'/private/batch',NATIVE_MIGRATION_BATCH__OUTPUT:'/private/evidence'}};
 const args=dockerRunArgs(base);expect(args).toContain('/private/batch:/pilot-batch:ro');expect(args).toContain('/private/evidence:/pilot-batch-output:rw');expect(args).toContain('NATIVE_MIGRATION_BATCH__ROOT=/pilot-batch');
 expect(()=>dockerRunArgs({...base,servers:2})).toThrow('one server');expect(()=>dockerRunArgs({...base,env:{...base.env,NATIVE_MIGRATION_BATCH__OUTPUT:undefined}})).toThrow('explicit');
});

it('produces and reloads one sealed manifest from two exact source-bound camera inputs, refusing byte drift',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{createHash}=await import('node:crypto');
 const {prepareNativeMigrationCaptureBatch,loadNativeMigrationCaptureBatch}=await import('../lib/native-migration-batch-camera.mjs');
 const sha=b=>createHash('sha256').update(b).digest('hex'),dir=await mkdtemp(path.join(tmpdir(),'batch-camera-'));
 try{
  const root=path.join(dir,'inputs'),output=path.join(dir,'output');await mkdir(root);await mkdir(output);await mkdir(path.join(root,'bundle'));
  const x=fixture(),paths=[];
  for(const e of x.entries){const id=e.input.key.sourceId,row={version:e.input.key.version,document:{kind:'graph',nodes:{}},meta:{colorMode:'light'}},canonical=JSON.stringify({heads:[row],versions:[]}),source='<p>Retained source</p>',recovery=JSON.stringify({key:e.input.key,documentSha256:digest(row.document),sourceSha256:sha(source),source});
   const input={...e.input,format:'native-migration-pilot-v1',theme:'light',canonicalSha256:sha(canonical),recoverySha256:sha(recovery),rowSha256:digest(row),documentSha256:digest(row.document),sourceSha256:sha(source),bundleFiles:[{path:'index.html',sha256:sha('native')},{path:'probe.mjs',sha256:hash}],viewports:[{width:800,height:600}],states:[{id:'initial',actions:[]}]};
   const item={input:path.join(root,id+'.json'),canonical:path.join(root,id+'-canonical.json'),recovery:path.join(root,id+'-recovery.json'),bundle:path.join(root,'bundle'),output:path.join(output,id)};
   await writeFile(item.input,JSON.stringify(input));await writeFile(item.canonical,canonical);await writeFile(item.recovery,recovery);paths.push(item);
  }
  const manifest=await prepareNativeMigrationCaptureBatch({root,output,paths,mutableDatasetIdsBySourceId:{sourceA:[],sourceB:[]}});await writeFile(path.join(root,'batch.json'),JSON.stringify(manifest));
  expect((await loadNativeMigrationCaptureBatch({root,output})).entries).toHaveLength(2);
  await writeFile(paths[1].canonical,'tampered');await expect(loadNativeMigrationCaptureBatch({root,output})).rejects.toThrow('file-digest');
 }finally{await rm(dir,{recursive:true,force:true});}
});


it('restores and independently reads shared mutable state before the next consumer, blocking dirty groups on failure',async()=>{
 for(const succeeds of [true,false]){
  const x=fixture();for(const entry of x.entries){const {sha256,...s}=entry.input.preparedStore;entry.input.preparedStore=seal({...s,reader:{...s.reader,datasetIds:['sharedDataset']}});}
  x.manifest.entries[0].mutableDatasetIds=['sharedDataset'];x.manifest.entries[0].mutationReset={path:'reset.mjs',sha256:hash};const {sha256,...body}=x.manifest;x.manifest=seal(body);
  let value=7;const observed=[];
  const result=await runNativeMigrationCaptureBatch(admitNativeMigrationBatch(x.manifest,x.entries),{browser:{},connectAgent(){},base:'http://localhost:3000',state:{read:async()=>({sharedDataset:{value}}),restore:async(_ctx,before)=>{if(succeeds)value=before.sharedDataset.value;}},capture:async()=>{observed.push(value);if(observed.length===1)value=99;return {};}});
  expect(observed).toEqual(succeeds?[7,7]:[7]);expect(result.entries.map(e=>e.status)).toEqual(succeeds?['captured','captured']:['failed','blocked']);
  if(succeeds)expect(result.entries[0].stateRestoration.beforeSha256).toBe(result.entries[0].stateRestoration.afterSha256);else expect(result.complete).toBe(false);
 }
});
