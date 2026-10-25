import {it,expect} from 'vitest';
import {openNativePipelineLifecycle} from '../lib/native-migration-disposable-provider';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const digest=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)).digest('hex');
const signed=body=>({...body,sha256:digest(body)}),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(directory,key){
 const receiptRoot=path.join(directory,key,'receipts'),output=path.join(directory,key,'output');await mkdir(receiptRoot,{recursive:true});await mkdir(output,{recursive:true});
 const sourceUser={id:'source_person',email:'mxmx_test_fixture@example.test',kind:'account',created_at:'2020-01-01T00:00:00.000Z',name:'Fixture'},targetUser={...sourceUser,id:'target_person'},additional={...sourceUser,id:'source_added',email:'mxmx_test_added@example.test'};
 const inventory={users:[sourceUser,additional],tokens:[]},target={users:[targetUser]},plan=signed({sourceNamespace:'disposable-fixtures',sourceInventorySha256:digest(inventory),targetInventorySha256:digest(target),targets:{users:{source_person:{userId:'target_person',email:targetUser.email},source_added:{userId:'source_added',email:additional.email}},tokens:{},actors:{}},users:[{sourceId:'source_person',targetId:'target_person',action:'reuse-verified-email',sourceRowSha256:digest(sourceUser),targetRowSha256:digest(targetUser)},{sourceId:'source_added',targetId:'source_added',action:'create-preserved',sourceRowSha256:digest(additional)}],createUsers:[{...additional,sourceId:'source_added',sourceRowSha256:digest(additional)}],tokens:[],blockers:[]});
 const identity={plan,approvedPlanSha256:plan.sha256,sourceInventory:inventory,targetInventory:target,revokedAt:'2020-01-01T00:00:00.000Z'},bytes=Buffer.from(JSON.stringify(identity));await writeFile(path.join(receiptRoot,'identity.json'),bytes);
 const configuration=signed({format:'native-disposable-lifecycle-v1',origin:'http://localhost:3000',fixture:{kind:'reviewed-target-identities',identity:{path:'identity.json',sha256:sha(bytes)},schemas:{appSchema:'public',authSchema:'auth'}},camera:{kind:'disabled'}}),configBytes=Buffer.from(JSON.stringify(configuration));await writeFile(path.join(receiptRoot,'lifecycle.json'),configBytes);
 const revision=(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
 return {request:{receiptRoot,output,stage:'import'},context:{receiptRoot,outputDirectory:output},configuration:{targetRoot:root,targetRevision:revision,lifecycleConfiguration:{path:'lifecycle.json',sha256:sha(configBytes)}}};
}
const child=`const fs=await import('node:fs/promises');const path=await import('node:path');const {openNativePipelineLifecycle}=await import('./scripts/lib/native-migration-disposable-provider.ts');const input=JSON.parse(await fs.readFile(process.argv[1],'utf8'));let life;try{life=await openNativePipelineLifecycle(input.request,input.context,input.configuration);if(life.db.raw().kind!=='pglite')throw Error('wrong engine');await life.db.query('CREATE TABLE owned_fixture(value text)');await life.db.query('INSERT INTO owned_fixture VALUES ($1)',[input.key]);const count=(await life.db.query('SELECT count(*)::int AS count FROM users')).rows[0].count;await fs.stat(path.join(input.context.outputDirectory,'disposable-target/database/PG_VERSION'));let refused=false;try{await openNativePipelineLifecycle(input.request,input.context,input.configuration)}catch{refused=true}await life.dispose();await life.dispose();let removed=false;try{await fs.stat(path.join(input.context.outputDirectory,'disposable-target'))}catch(error){removed=error.code==='ENOENT'}console.log(JSON.stringify({key:input.key,count,removed,refused,objects:life.objectsDirectory.endsWith('/disposable-target/objects')}));}finally{await life?.dispose();}`;
it('uses the same concrete provider for two unrelated keys in isolated processes, with real PGlite/auth and complete cleanup',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'native-disposable-provider-'));
 try{for(const key of ['calendar-key','research-key']){const input={...await fixture(directory,key),key},file=path.join(directory,key+'.json');await writeFile(file,JSON.stringify(input));const result=await execute(process.execPath,['--import','tsx','--input-type=module','-e',child,file],{cwd:root,env:{...process.env,TSX_TSCONFIG_PATH:path.join(root,'tsconfig.json'),DATABASE_URL:'postgres://must-never-connect.invalid/db',S3_URL:'s3://must-never-use',AUTH__SECRET:'ambient-secret-must-be-replaced'},timeout:45000,maxBuffer:1024*1024});expect(JSON.parse(result.stdout.trim().split('\n').at(-1))).toEqual({key,count:1,removed:true,refused:true,objects:true});}}
 finally{await rm(directory,{recursive:true,force:true});}
},90000);
it('refuses changed lifecycle evidence before creating storage or importing the app',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'native-disposable-invalid-'));
 try{const input=await fixture(directory,'invalid');input.configuration.lifecycleConfiguration.sha256='0'.repeat(64);await expect(openNativePipelineLifecycle(input.request,input.context,input.configuration)).rejects.toThrow('native_disposable_file_digest');}
 finally{await rm(directory,{recursive:true,force:true});}
});

it('never reuses or erases an occupied lifecycle directory',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'native-disposable-busy-'));
 try{const input=await fixture(directory,'busy'),storage=path.join(input.context.outputDirectory,'disposable-target');await mkdir(storage);await writeFile(path.join(storage,'sentinel'),'occupied');await expect(openNativePipelineLifecycle(input.request,input.context,input.configuration)).rejects.toThrow('EEXIST');expect(await readFile(path.join(storage,'sentinel'),'utf8')).toBe('occupied');}
 finally{await rm(directory,{recursive:true,force:true});}
});
