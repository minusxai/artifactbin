/**
 * scripts/new-app.mjs: the tracker starter set up in one call, against a fake server: writes the template trimmed to
 * the chosen features (a preset minus --without), publishes the empty entries dataset with the template its features
 * start from, applies the rules they add and fills the page; unknown features and missing requirements are refused
 * before anything is written; a rerun
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

it('sets up the team task tracker in one call: every feature, its dataset, rules and the filled page',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',title:'[Launch tasks]'});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs']);
  expect(result).toMatchObject({kind:'tracker',preset:'tasks',features:['own-rows','team','collab','table'],
   created:['index.html','steps.mjs','guest.mjs','cleanup.mjs','entries.csv'],kept:[],
   datasets:{entries:{id:'DATA0001',rows:0,reused:false}}});
  // One create (the entries header), the own-rows template, then the team and collab rules on top.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy','GET /api/artifacts/DATA0001/policy','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Launch tasks entries',dataset:'name,grp,note,created_by,description\n'});
  expect(p.calls[0]!.body).not.toHaveProperty('name');
  const table=p.calls[4]!.body.policy.tables[0];
  expect(table.collaborative_columns).toEqual(['description']);
  expect(table.update_permissions.map((e:any)=>[e.role,e.permission.filter])).toEqual([['viewer',{}],['signed_in',{created_by:{_eq:USER}}]]);
  expect(table.delete_permissions.map((e:any)=>[e.role,e.permission.filter])).toEqual([['viewer',{}],['signed_in',{created_by:{_eq:USER}}]]);
  expect(p.calls[4]!.body.expectedPolicyRevision).toBe(2);
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('href="ref:DATA0001"');expect(html).toContain('<title>Launch tasks</title>');
  expect(html).not.toMatch(/ref:DATASET_ID|\[Tracker name\]|@(?:feature|only|end) !/);
  expect(html).not.toMatch(/af-resolver|\/fn\/|tracker\.ts/);
  expect(result.rules).toBe('entries: everyone reads; signed-in people add entries and change or remove only their own; a group the page is shared with by groups.mjs share --datasets changes and removes every entry; descriptions are typed in together, live');
  expect(result.next).toBe(`Next: in index.html edit only APP: its [bracketed] text and groups (the stages entries move through); then ${CHECK}; for a team to edit every entry: node scripts/groups.mjs share PAGE --group GROUP --datasets`);
 }finally{await p.done();}
});

it('sets up the list preset (--kind list): own-rows only, no rule beyond the template',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',kind:'list',title:'Riverside cleanup'});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs']);
  expect(result).toMatchObject({kind:'list',preset:'list',features:['own-rows'],datasets:{entries:{id:'DATA0001',rows:0,reused:false}}});
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts','GET /api/artifacts/DATA0001/policy/templates','PUT /api/artifacts/DATA0001/policy']);
  expect(p.calls[0]!.body).toMatchObject({title:'Riverside cleanup entries',dataset:'name,grp,note,created_by\n',columns:[{name:'name'},{name:'grp'},{name:'note'},{name:'created_by'}]});
  expect(p.calls[0]!.body).not.toHaveProperty('name');
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain('data-af-name="entries"');expect(html).toContain('href="ref:DATA0001"');
  expect(html).toContain("kicker: '[Event · dates]'");expect(html).toContain("groups: ['[First choice]', '[Second choice]', '[Third choice]']");
  expect(html).not.toMatch(/af-resolver|@afbin\/collab|@afbin\/data-table|@(?:feature|only) (?:team|collab|table)\b/);
  expect(html).toMatch(/<p id="signin" hidden>/);
  expect(await readFile(path.join(p.dir,'steps.mjs'),'utf8')).not.toMatch(/description|table view/);
  expect(result.rules).toBe('entries: everyone reads; signed-in people add entries and change or remove only their own');
  expect(result.next).toContain('groups (the options people pick from)');
  // A rerun reuses the dataset and writes nothing.
  p.calls.length=0;
  expect((await p.run({dir:'app',kind:'list',title:'Riverside cleanup'})).kept).toHaveLength(5);
  expect(p.calls).toEqual([]);
 }finally{await p.done();}
});

it('drops features with --without, keeping the read-only template when own-rows goes',async()=>{
 const p=await project();
 try{
  const result=await p.run({dir:'app',title:'Reading list',without:'own-rows,team,collab'});
  expect(result).toMatchObject({features:['table']});
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs']);
  // No template flag (new datasets start read-only) and no rule to add.
  expect(p.calls.map(c=>c.method+' '+c.path)).toEqual(['POST /api/artifacts']);
  expect(p.calls[0]!.body.template).toBeUndefined();
  const html=await readFile(path.join(p.dir,'index.html'),'utf8');
  expect(html).toContain("import '@afbin/data-table'");expect(html).not.toContain('id="signin"');
  expect(html).toContain('insert into entries (name, grp, note)');
  expect(result.rules).toBe('entries: everyone reads; only you and editors change entries');
 }finally{await p.done();}
});

it('refuses bad features, presets and kinds before writing anything',async()=>{
 const p=await project();
 try{
  await expect(p.run({dir:'app',title:'X',without:'kanban'})).rejects.toMatchObject({code:'unknown_feature',exit:2,recovery:expect.stringContaining('own-rows, team, collab, table')});
  await expect(p.run({dir:'app',title:'X',without:'own-rows'})).rejects.toMatchObject({code:'feature_requires',exit:2,recovery:'Drop team too (--without own-rows,team), or keep own-rows.'});
  await expect(p.run({dir:'app',title:'X',preset:'kanban'})).rejects.toMatchObject({code:'invalid_preset',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'poll'})).rejects.toMatchObject({code:'invalid_kind',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'list',preset:'tasks'})).rejects.toMatchObject({code:'preset_conflict',exit:2});
  await expect(p.run({dir:'app',title:'X',kind:'api'})).rejects.toMatchObject({code:'invalid_kind',exit:2});
  await expect(p.run({dir:'app'})).rejects.toMatchObject({code:'missing_title',exit:2,recovery:'Run node scripts/new-app.mjs --title NAME'});
  expect(p.calls).toEqual([]);expect(await p.files()).toEqual([]);
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
  expect(await p.files()).toEqual(['cleanup.mjs','entries.csv','guest.mjs','index.html','steps.mjs']);
 }finally{await p.done();}
});
