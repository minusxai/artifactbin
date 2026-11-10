/**
 * scripts/new-app.mjs: the tracker starter set up in one call, against a fake server: writes the template trimmed to
 * the chosen features (a preset minus --without), publishes the empty entries dataset with the template its features
 * start from, applies the rules they add and fills the page; --limit writes one number into the page and resolver;
 * unknown features, missing requirements and a limit without limits are refused before anything is written; a rerun
 * reuses the dataset the kept index.html links (its ref:) and changes nothing; no file is written beside another.
 */
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const server='https://example.test';
type Call={method:string;path:string;body?:any};
const USER='X-Hasura-User-Id';

/** Keys sorted at every level, as the real server stores a policy (so a rerun cannot compare key order). */
const sorted=(value:any):any=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
/** The own-rows template as the server builds it for the entries columns. */
const ownRows=(columns:string[])=>({version:3,tables:[{table:{schema:'public',name:'rows'},
 select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),
 insert_permissions:['viewer','signed_in'].map(role=>({role,permission:{columns:columns.filter(c=>c!=='created_by'),check:{},set:{created_by:USER}}})),
 update_permissions:['viewer','signed_in'].map(role=>({role,permission:{columns:columns.filter(c=>c!=='created_by'),filter:{created_by:{_eq:USER}},check:{created_by:{_eq:USER}}}})),
 delete_permissions:['viewer','signed_in'].map(role=>({role,permission:{filter:{created_by:{_eq:USER}}}}))}]});
/** A fake origin: each POST creates a dataset with a fresh id; templates come from its CSV header; policy GET/PUT keep one policy per id. */
function fakeServer(){
 const calls:Call[]=[],policies=new Map<string,any>(),headers=new Map<string,string[]>();let made=0;
 const fetcher=async(url:any,init:any)=>{
  const {pathname}=new URL(String(url)),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;
  calls.push({method,path:pathname,body});
  if(pathname==='/api/artifacts'&&method==='POST'){const id='DATA'+String(++made).padStart(4,'0');
   headers.set(id,String(body.dataset).split('\n')[0]!.split(','));
   policies.set(id,{revision:1,policy:{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[]}]}});
   return Response.json({id,url:server+'/a/'+id,version:1,state:'a'.repeat(64),format:'dataset'},{status:201});}
  const templates=/^\/api\/artifacts\/(\w+)\/policy\/templates$/.exec(pathname);
  if(templates&&method==='GET')return Response.json({revision:policies.get(templates[1]!).revision,templates:[{name:'own-rows',ok:true,policy:ownRows(headers.get(templates[1]!)!)}]});
  const policy=/^\/api\/artifacts\/(\w+)\/policy$/.exec(pathname);
  if(policy&&method==='GET')return Response.json({...policies.get(policy[1]!),source:'v3',readBack:'Table public.rows'});
  if(policy&&method==='PUT'){const saved={revision:policies.get(policy[1]!).revision+1,policy:sorted(body.policy)};policies.set(policy[1]!,saved);
   return Response.json({saved:true,revision:saved.revision,readBack:'Table public.rows\n- Everyone: see rows.'});}
  return Response.json({error:'unexpected'},{status:500});
 };
 return {calls,fetcher,policies};
}

async function project(){
 const {newAppCommand}=await import('../../../skills/artifactbin/scripts/new-app.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'new-app-')),dir=path.join(root,'app');await mkdir(dir);
 const fake=fakeServer();
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'private-fixture',ARTIFACTBIN_HOME:path.join(root,'home')},fetcher:fake.fetcher,cwd:root,log:()=>{}};
 const run=(values:Record<string,unknown>,positionals:string[]=[])=>newAppCommand({values:{server,...values},positionals},options);
 // Every file the starter writes; never a companion beside one.
 const files=async()=>{const names=(await readdir(dir)).sort();expect(names.filter(name=>name.endsWith('.af.json'))).toEqual([]);return names;};
 return {root,dir,run,files,calls:fake.calls,policies:fake.policies,done:()=>rm(root,{recursive:true,force:true})};
}
const CHECK='node scripts/publish.mjs index.html --create && node scripts/check.mjs index.html --steps steps.mjs --guest-steps guest.mjs --cleanup-steps cleanup.mjs';

it('sets up the team task tracker in one call: every feature, its dataset, rules, resolver and the filled page',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',title:'[Launch tasks]'});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs','tracker.ts']);
  expect(result).toMatchObject({kind:'tracker',preset:'tasks',features:['own-rows','team','collab','table','limits'],
   created:['index.html','tracker.ts','steps.mjs','guest.mjs','cleanup.mjs','entries.csv'],kept:[],
   datasets:{entries:{id:'DATA0001',rows:0,reused:false}}});
  // One create (the header, named entries), the own-rows template, then the team and collab rules on top.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy','GET /api/artifacts/DATA0001/policy','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Launch tasks entries',name:'entries',dataset:'name,grp,note,created_by,description\n'});
  const table=p.calls[4]!.body.policy.tables[0];
  expect(table.collaborative_columns).toEqual(['description']);
  expect(table.update_permissions.map((e:any)=>[e.role,e.permission.filter])).toEqual([['viewer',{}],['signed_in',{created_by:{_eq:USER}}]]);
  expect(table.delete_permissions.map((e:any)=>[e.role,e.permission.filter])).toEqual([['viewer',{}],['signed_in',{created_by:{_eq:USER}}]]);
  expect(p.calls[4]!.body.expectedPolicyRevision).toBe(2);
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('<title>Launch tasks</title>');
  expect(html).not.toMatch(/ref:DATASET_ID|\[Tracker name\]|@(?:feature|only|end) !/);
  expect(html).toContain('<link rel="af-resolver" data-af-name="tracker" href="./tracker.ts">');
  expect(result.rules).toBe('entries: everyone reads; signed-in people add entries and change or remove only their own; a group the page is shared with by groups.mjs share --datasets changes and removes every entry; descriptions are typed in together, live; each group holds at most 5 entries');
  expect(result.next).toBe(`Next: in index.html edit only APP: its [bracketed] text and groups (the stages entries move through); then ${CHECK}; for a team to edit every entry: node scripts/groups.mjs share PAGE --group GROUP --datasets`);
 }finally{await p.done();}
});

it('sets up the list preset (--kind list): own-rows only, tracker.ts with me alone, no rule beyond the template',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',kind:'list',title:'Riverside cleanup'});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs','tracker.ts']);
  const functions=await readFile(path.join(p.dir,'tracker.ts'),'utf8');
  expect(functions.slice(functions.indexOf('*/'))).not.toMatch(/LIMIT|async add|roles/);
  expect(result).toMatchObject({kind:'list',preset:'list',features:['own-rows'],datasets:{entries:{id:'DATA0001',rows:0,reused:false}}});
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Riverside cleanup entries',name:'entries',dataset:'name,grp,note,created_by\n',columns:[{name:'name'},{name:'grp'},{name:'note'},{name:'created_by'}]});
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain("kicker: '[Event · dates]'");expect(html).toContain("groups: ['[First choice]', '[Second choice]', '[Third choice]']");
  expect(html).toContain('<link rel="af-resolver" data-af-name="tracker" href="./tracker.ts">');
  expect(html).not.toMatch(/call\('add'|@afbin\/collab|@afbin\/data-table|@(?:feature|only) (?:team|collab|table|limits)\b/);
  expect(html).toMatch(/<p id="signin" hidden>/);
  expect(await readFile(path.join(p.dir,'steps.mjs'),'utf8')).not.toMatch(/full group|description|table view/);
  expect(result.rules).toBe('entries: everyone reads; signed-in people add entries and change or remove only their own');
  expect(result.next).toContain('groups (the options people pick from)');
  // A rerun reuses the dataset and writes nothing.
  p.calls.length=0;
  expect((await p.run({dir:'app',kind:'list',title:'Riverside cleanup'})).kept).toHaveLength(6);
  expect(p.calls).toEqual([]);
 }finally{await p.done();}
});

it('drops features with --without, keeping the read-only template when own-rows goes',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',title:'Reading list',without:'own-rows,team,limits,collab'});
  expect(result).toMatchObject({features:['table']});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs','tracker.ts']);
  // No template flag (new datasets start read-only) and no rule to add.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts']);
  expect(p.calls[0]!.body.template).toBeUndefined();
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain("import '@afbin/data-table'");expect(html).not.toContain('id="signin"');
  expect(html).toContain('insert into entries (name, grp, note)');
  expect(result.rules).toBe('entries: everyone reads; only you and editors change entries');
 }finally{await p.done();}
});

it('writes one --limit into the page and tracker.ts, and refuses bad features and limits before writing anything',async()=>{
 const p=await project();
 try{
  await expect(p.run({dir:'app',title:'X',without:'kanban'})).rejects.toMatchObject({code:'unknown_feature',exit:2,recovery:expect.stringContaining('own-rows, team, collab, table, limits')});
  await expect(p.run({dir:'app',title:'X',without:'own-rows'})).rejects.toMatchObject({code:'feature_requires',exit:2,recovery:'Drop team too (--without own-rows,team), or keep own-rows.'});
  await expect(p.run({dir:'app',title:'X',preset:'kanban'})).rejects.toMatchObject({code:'invalid_preset',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'poll'})).rejects.toMatchObject({code:'invalid_kind',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'list',preset:'tasks'})).rejects.toMatchObject({code:'preset_conflict',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'list',limit:'4'})).rejects.toMatchObject({code:'limit_without_limits',exit:2});
  await expect(p.run({dir:'app',title:'X',limit:'0'})).rejects.toMatchObject({code:'invalid_limit',exit:2});
  await expect(p.run({dir:'app'})).rejects.toMatchObject({code:'missing_title',exit:2,recovery:'Run node scripts/new-app.mjs --title NAME'});
  expect(p.calls).toEqual([]);expect(await p.files()).toEqual([]);
  const result=await p.run({dir:'app',title:'Workshop seats',without:'team,collab,table',limit:'12'});
  expect(result).toMatchObject({features:['own-rows','limits'],limit:12});
  expect(await readFile(path.join(p.dir,'index.html'),'utf8')).toMatch(/^ {2}limit: 12,/m);
  expect(await readFile(path.join(p.dir,'tracker.ts'),'utf8')).toMatch(/^const LIMIT=12;/m);
  expect(result.rules).toContain('each group holds at most 12 entries');
 }finally{await p.done();}
});

it('keeps a file that already exists and says so, and reuses the dataset and rules on a rerun',async()=>{
 const p=await project();
 try{
  await writeFile(path.join(p.dir,'steps.mjs'),'// mine\n');
  const result=await p.run({dir:'app',title:'Launch tasks'});
  expect(result.kept).toEqual(['steps.mjs']);expect(result.note).toContain('kept steps.mjs');
  expect(await readFile(path.join(p.dir,'steps.mjs'),'utf8')).toBe('// mine\n');
  const before=await readFile(path.join(p.dir,'index.html'),'utf8');
  p.calls.length=0;
  const again=await p.run({dir:path.join(p.dir),title:'Launch tasks'});
  expect(again.created).toEqual([]);expect(again.datasets).toMatchObject({entries:{id:'DATA0001',reused:true}});
  // No create and no rules write: the feature rules already hold.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['GET /api/artifacts/DATA0001/policy']);
  expect(await readFile(path.join(p.dir,'index.html'),'utf8')).toBe(before);
  // Once the page is published (its marker is in index.html) the dataset is still the one it links, and the
  // next step publishes it plainly.
  const {stampSource}=await import('../../../skills/artifactbin/scripts/toolbox-source.mjs');
  await writeFile(path.join(p.dir,'index.html'),stampSource(before,{server,id:'PAGE01',version:2,state:'a'.repeat(64),sha256:'b'.repeat(64),entryPath:'index.html'}));
  const published=await p.run({dir:'app',title:'Launch tasks'});
  expect(published.datasets).toMatchObject({entries:{id:'DATA0001',reused:true}});
  expect(published.next).toContain('then node scripts/publish.mjs index.html && node scripts/check.mjs');
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs','tracker.ts']);
 }finally{await p.done();}
});

it('sets up the API starter: the resolver aimed at --url, an empty notes dataset with own-rows rules and the filled page',async()=>{
 const p=await project();
 try{
  // A key file beside the project is never read: nothing the starter writes carries its value.
  await writeFile(path.join(p.dir,'pipeline-key.txt'),'sk-live-never-copied\n');
  const result=await p.run({dir:'app',kind:'api',title:'Open deals',url:'https://crm.example.com/v1/deals?status=open'});
  expect(await p.files()).toEqual(['api.ts','cleanup.mjs','guest.mjs','index.html','notes.csv','pipeline-key.txt','steps.mjs']);
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
  expect(result.next).toContain(CHECK);
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
