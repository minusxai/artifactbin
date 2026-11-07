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
  const templates=/^\/api\/artifacts\/(\w+)\/policy\/templates$/.exec(pathname);
  if(templates&&method==='GET')return Response.json({revision:policies.get(templates[1]!).revision,templates:[{name:'own-rows',ok:true,policy:{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'anonymous'}],insert_permissions:[{role:'signed_in'}]}]}}]});
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
  expect((result.datasets as any).transactions.rows).toBeGreaterThan(200);
  // The two creates carry readable titles; the rules go on targets only, at the revision read.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','POST /api/artifacts','GET /api/artifacts/DATA0002/policy','PUT /api/artifacts/DATA0002/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Household budget transactions (sample)',visibility:'unlisted'});
  expect(p.calls[1]!.body).toMatchObject({title:'Household budget targets',dataset:'category,amount\nRent,1650\n'});
  const put=p.calls[3]!.body;expect(put.expectedPolicyRevision).toBe(1);
  expect(put.policy.tables[0].select_permissions.map((r:any)=>r.role)).toEqual(['viewer','signed_in','anonymous']);
  expect(put.policy.tables[0].insert_permissions.map((r:any)=>r.role)).toEqual(['viewer','signed_in']);
  // The page links both ids, carries the title and no ref: placeholder or bracketed title.
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('href="ref:DATA0002"');
  expect(html).toContain('<title>Household budget</title>');
  expect(html).not.toMatch(/ref:(?:DATASET|TARGETS)_ID|\[App name\]/);
  expect(result.next).toBe('Next: in index.html edit only APP: its [bracketed] text and defaultTargets (plausible monthly amounts); then node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs');
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
  expect((result.datasets as any).transactions).toMatchObject({rows:1,reused:false});
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
  await expect(p.run({dir:'app'})).rejects.toMatchObject({code:'missing_title',exit:2,recovery:'Run node scripts/new-app.mjs --title NAME'});
  expect(p.calls).toEqual([]);
  await writeFile(path.join(p.dir,'steps.mjs'),'// mine\n');
  const result=await p.run({dir:'app',title:'Budget'});
  expect(result.kept).toEqual(['steps.mjs']);expect(result.note).toContain('kept steps.mjs');
  expect(await readFile(path.join(p.dir,'steps.mjs'),'utf8')).toBe('// mine\n');
 }finally{await p.done();}
});

it('sets up the list starter: its files, an empty entries dataset with own-rows rules and the filled page',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',kind:'list',title:'Riverside cleanup'});
  expect((await readdir(p.dir)).filter(name=>!name.endsWith('.af.json')).sort()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs']);
  expect(result.datasets).toEqual({entries:{id:'DATA0001',rows:0,reused:false}});
  // One create (the header only, named entries), then the own-rows template stamped on created_by.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Riverside cleanup entries',name:'entries',dataset:'name,choice,note,created_by\n',columns:[{name:'name'},{name:'choice'},{name:'note'},{name:'created_by'}]});
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('<title>Riverside cleanup</title>');
  expect(html).not.toMatch(/ref:DATASET_ID|\[List name\]/);
  expect(result.next).toBe('Next: in index.html edit only APP: its [bracketed] text and choices (the options people pick from); then node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs');
  // A rerun reuses the dataset and writes nothing.
  p.calls.length=0;
  expect((await p.run({dir:'app',kind:'list',title:'Riverside cleanup'})).kept).toHaveLength(5);
  expect(p.calls).toEqual([]);
  await expect(p.run({dir:'app',kind:'list',title:'X',data:'rows.csv'})).rejects.toMatchObject({code:'data_not_for_list',exit:2});
  await expect(p.run({dir:'app',kind:'poll',title:'X'})).rejects.toMatchObject({code:'invalid_kind',exit:2});
 }finally{await p.done();}
});

it('sets up the API starter: the resolver aimed at --url, an empty notes dataset with own-rows rules and the filled page',async()=>{
 const p=await project();
 try{
  // A key file beside the project is never read: nothing the starter writes carries its value.
  await writeFile(path.join(p.dir,'pipeline-key.txt'),'sk-live-never-copied\n');
  const result=await p.run({dir:'app',kind:'api',title:'Open deals',url:'https://crm.example.com/v1/deals?status=open'});
  expect((await readdir(p.dir)).filter(name=>!name.endsWith('.af.json')).sort()).toEqual(['api.ts','cleanup.mjs','guest.mjs','index.html','notes.csv','pipeline-key.txt','steps.mjs']);
  expect(result.created).toEqual(['index.html','api.ts','steps.mjs','guest.mjs','cleanup.mjs','notes.csv']);
  expect(result.datasets).toEqual({notes:{id:'DATA0001',rows:0,reused:false}});
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Open deals notes',name:'notes',dataset:'item,note,created_by\n'});
  // The resolver reads that address, and the key goes only to its host, as a secret the owner sets.
  const resolver=await readFile(path.join(p.dir,'api.ts'),'utf8');
  expect(resolver).toContain("const HOST = 'crm.example.com';");expect(resolver).toContain("const PATH = '/v1/deals?status=open';");
  expect(resolver).toContain('export const secrets = { API_KEY: HOST };');expect(resolver).not.toContain('api.example.com');
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('<link rel="af-resolver" data-af-name="api" href="./api.ts">');
  expect(html).toContain('<title>Open deals</title>');expect(html).not.toMatch(/ref:DATASET_ID|\[Dashboard name\]/);
  for(const name of await readdir(p.dir))if(name!=='pipeline-key.txt')expect(await readFile(path.join(p.dir,name),'utf8'),name).not.toContain('sk-live');
  expect(JSON.stringify(result)).not.toContain('sk-live');
  expect(result.rules).toBe('notes: everyone reads; signed-in people add notes and change or remove only their own');
  // The next step: edit APP, publish and check, and send the owner to Resolvers for the key.
  expect(result.next).toMatch(/^Next: in index\.html edit only APP: fields \(the API's field names\)/);
  expect(result.next).toContain('node scripts/publish.mjs index.html && node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs');
  expect(result.next).toMatch(/API_KEY[^.]*Resolvers/);expect(result.next).toContain('Not tested');
  // A rerun keeps every file and the dataset, and writes nothing.
  p.calls.length=0;
  const again=await p.run({dir:'app',kind:'api',title:'Open deals',url:'https://crm.example.com/v1/deals?status=open'});
  expect(again.kept).toEqual(['index.html','api.ts','steps.mjs','guest.mjs','cleanup.mjs','notes.csv']);
  expect(again.datasets).toEqual({notes:{id:'DATA0001',rows:0,reused:true}});expect(p.calls).toEqual([]);
 }finally{await p.done();}
});

it('refuses an API starter without an HTTPS address on port 443, or with --data, before writing anything',async()=>{
 const p=await project();
 try{
  await expect(p.run({dir:'app',kind:'api',title:'Deals'})).rejects.toMatchObject({code:'missing_url',exit:2,recovery:expect.stringContaining('--kind api --url https://')});
  for(const url of ['http://crm.example.com/v1/deals','https://crm.example.com:8443/v1/deals','https://user:pw@crm.example.com/v1','https://127.0.0.1/v1','https://localhost/v1','not a url'])
   await expect(p.run({dir:'app',kind:'api',title:'Deals',url}),url).rejects.toMatchObject({code:'invalid_url',exit:2,recovery:expect.stringContaining('HTTPS on port 443')});
  await expect(p.run({dir:'app',kind:'api',title:'Deals',url:'https://crm.example.com/v1',data:'rows.csv'})).rejects.toMatchObject({code:'data_not_for_api',exit:2});
  await expect(p.run({dir:'app',title:'Budget',url:'https://crm.example.com/v1'})).rejects.toMatchObject({code:'url_not_for_kind',exit:2});
  expect(p.calls).toEqual([]);expect(await readdir(p.dir)).toEqual([]);
 }finally{await p.done();}
});
