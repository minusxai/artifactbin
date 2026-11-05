/**
 * scripts/new-app.mjs: the shared-app starter set up in one call, against a fake server: copies the
 * starter files, publishes the two datasets, applies the starter's rules and fills the page; a rerun
 * reuses the datasets its companions record and changes nothing.
 */
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const server='https://example.test';
type Call={method:string;path:string;body?:any};

/** Keys sorted at every level, as the real server stores a policy (so a rerun cannot compare key order). */
const sorted=(value:any):any=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
/** A fake origin: each POST creates a dataset with a fresh id; policy GET/PUT keep one policy per id. */
function fakeServer(){
 const calls:Call[]=[],policies=new Map<string,any>();let made=0;
 const fetcher=async(url:any,init:any)=>{
  const {pathname}=new URL(String(url)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;
  calls.push({method,path:pathname,body});
  if(pathname==='/api/artifacts'&&method==='POST'){const id='DATA'+String(++made).padStart(4,'0');
   policies.set(id,{revision:1,policy:{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[]}]}});
   return Response.json({id,url:server+'/a/'+id,version:1,state:'a'.repeat(64),format:'dataset'},{status:201});}
  const policy=/^\/api\/artifacts\/(\w+)\/policy$/.exec(pathname);
  if(policy&&method==='GET')return Response.json({...policies.get(policy[1]!),source:'v3',readBack:'Table public.rows'});
  if(policy&&method==='PUT'){const saved={revision:policies.get(policy[1]!).revision+1,policy:sorted(body.policy)};policies.set(policy[1]!,saved);
   return Response.json({saved:true,revision:saved.revision,readBack:'Table public.rows\n- Everyone: see rows.'});}
  return Response.json({error:'unexpected'},{status:500});
 };
 return {calls,fetcher};
}

async function project(){
 const {newAppCommand}=await import('../../../skills/artifactbin/scripts/new-app.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'new-app-')),dir=path.join(root,'app');await mkdir(dir);
 const fake=fakeServer();
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:path.join(root,'home')},fetcher:fake.fetcher,cwd:root,log:()=>{}};
 const run=(values:Record<string,unknown>,positionals:string[]=[])=>newAppCommand({values:{server,...values},positionals},options);
 return {root,dir,run,calls:fake.calls,done:()=>rm(root,{recursive:true,force:true})};
}

it('sets up the shared app in one call: files, two datasets, the rules and the filled page',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',title:'[Household budget]'});
  expect((await readdir(p.dir)).filter(name=>!name.endsWith('.af.json')).sort()).toEqual(['budget.ts','cleanup.mjs','guest.mjs','index.html','steps.mjs','targets.csv','transactions.csv']);
  expect(result.created).toEqual(['index.html','budget.ts','steps.mjs','guest.mjs','cleanup.mjs','transactions.csv','targets.csv']);
  expect(result.kept).toEqual([]);
  expect(result.datasets).toEqual({transactions:{id:'DATA0001',rows:expect.any(Number),reused:false},targets:{id:'DATA0002',rows:1,reused:false}});
  expect(result.datasets.transactions.rows).toBeGreaterThan(200);
  // The two creates carry readable titles; the rules go on targets only, at the revision read.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','POST /api/artifacts','GET /api/artifacts/DATA0002/policy','PUT /api/artifacts/DATA0002/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Household budget transactions (sample)',visibility:'unlisted'});
  expect(p.calls[1]!.body).toMatchObject({title:'Household budget targets',dataset:'category,amount\nRent,1650\n'});
  const put=p.calls[3]!.body;expect(put.expectedPolicyRevision).toBe(1);
  expect(put.policy.tables[0].select_permissions.map((r:any)=>r.role)).toEqual(['viewer','signed_in','anonymous']);
  expect(put.policy.tables[0].insert_permissions.map((r:any)=>r.role)).toEqual(['viewer','signed_in']);
  // The page links both ids, carries the title twice and no ref: placeholder or bracketed title.
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('href="ref:DATA0002"');
  expect(html).toContain('<title>Household budget</title>');expect(html).toContain('title: "Household budget"');
  expect(html).not.toMatch(/ref:(?:DATASET|TARGETS)_ID|\[Household budget\]/);
  expect(result.next).toBe('Next: in index.html edit only APP: its [bracketed] text and defaultTargets (plausible monthly amounts); then node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs --output qa-1.json');
  expect(result.note).toContain('DATA0001');
 }finally{await p.done();}
});

it('reuses its datasets on a rerun and changes no file',async()=>{
 const p=await project();
 try{
  await p.run({dir:'app'},['Household','budget']);
  const before=await Promise.all(['index.html','targets.csv','transactions.csv'].map(name=>readFile(path.join(p.dir,name),'utf8')));
  p.calls.length=0;
  const again=await p.run({dir:path.join(p.dir),title:'Household budget'});
  expect(again.created).toEqual([]);
  expect(again.kept).toEqual(['index.html','budget.ts','steps.mjs','guest.mjs','cleanup.mjs','transactions.csv','targets.csv']);
  expect(again.datasets).toMatchObject({transactions:{id:'DATA0001',reused:true},targets:{id:'DATA0002',reused:true}});
  // No create and no rules write: the rules already hold.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['GET /api/artifacts/DATA0002/policy']);
  const after=await Promise.all(['index.html','targets.csv','transactions.csv'].map(name=>readFile(path.join(p.dir,name),'utf8')));
  expect(after).toEqual(before);
 }finally{await p.done();}
});

it('takes your CSV by relative or absolute path and refuses one that differs from the copy it made',async()=>{
 const p=await project();
 try{
  await writeFile(path.join(p.root,'bank.csv'),'date,merchant,category,amount,payer\n2026-01-02,Shop,Groceries,12.50,Ada\n');
  const result=await p.run({dir:'app',title:'Our money',data:'bank.csv'});
  expect(result.datasets.transactions).toMatchObject({rows:1,reused:false});
  expect(p.calls[0]!.body).toMatchObject({title:'Our money transactions',dataset:expect.stringContaining('Shop,Groceries')});
  // Your own rows are not sample data.
  expect(await readFile(path.join(p.dir,'index.html'),'utf8')).not.toContain('· sample data');
  expect(result.next).toContain('columns and defaultTargets (your categories)');
  // The same file again, by absolute path, is accepted.
  await p.run({dir:'app',title:'Our money',data:path.join(p.root,'bank.csv')});
  await writeFile(path.join(p.root,'other.csv'),'date,merchant,category,amount,payer\n2026-02-02,Cafe,Dining out,8,Ada\n');
  await expect(p.run({dir:'app',title:'Our money',data:'other.csv'})).rejects.toMatchObject({code:'data_conflict',exit:2,recovery:expect.stringContaining('mv transactions.csv')});
 }finally{await p.done();}
});

it('keeps a file that already exists and says so, and asks for a title with the one command',async()=>{
 const p=await project();
 try{
  await expect(p.run({dir:'app'})).rejects.toMatchObject({code:'missing_title',exit:2,recovery:'Run node scripts/new-app.mjs --title "App name"'});
  expect(p.calls).toEqual([]);
  await writeFile(path.join(p.dir,'steps.mjs'),'// mine\n');
  const result=await p.run({dir:'app',title:'Budget'});
  expect(result.kept).toEqual(['steps.mjs']);expect(result.note).toContain('kept steps.mjs');
  expect(await readFile(path.join(p.dir,'steps.mjs'),'utf8')).toBe('// mine\n');
 }finally{await p.done();}
});
