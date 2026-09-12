import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {digest} from '../src/files';
import {parseResourceFile} from '../src/resource-file';
import {baselineOf,loadWorkspace} from '../src/workspace';
import {tracking} from './tracking';
import {cliHarness} from './harness';

test('YAML dataset push publishes content and access together, tracks source bytes and skips unchanged work offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-push-'));let requests=0,version=0;const writes:Record<string,unknown>[]=[];
 let head:Record<string,unknown>={};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  requests++;
  if(init?.method!=='GET'){
   const body=JSON.parse(String(init?.body));writes.push(body);version++;
   head={...head,id:'data123',format:'dataset',edit_id:`edit${version}`,version,state:digest(`state${version}`),access:body.access??head.access,shares:body.shares??head.shares,title:body.title??head.title,rows:[{score:version===1?42:43}]};
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\naccess: readwrite\nshares: []\n');
  const first=await invoke(['push','sales.yaml']);assert.equal(first.code,0,JSON.stringify(first.result));assert.equal(writes[0].dataset,'score\n42\n');assert.equal(writes[0].access,'readwrite');
  const resource=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(resource.id,'data123');
  const count=requests;assert.equal((await invoke(['push'])).code,0);assert.equal(requests,count);
  await writeFile(join(root,'sales.csv'),'score\n43\n');assert.equal((await invoke(['status'])).result.files[0].status,'modified');
  const diff=await invoke(['diff']);assert.equal(diff.code,0);assert.equal(diff.result.diffs[0].path,'sales.csv');assert.match(diff.result.diffs[0].diff,/\+43/);
  const changed=await invoke(['push']);assert.equal(changed.code,0,JSON.stringify(changed.result));assert.equal(writes[1].dataset,'score\n43\n');
  const finalCount=requests;assert.equal((await invoke(['push'])).code,0);assert.equal(requests,finalCount);
  assert.deepEqual(Object.keys((await tracking(root,root)).files),['sales.yaml']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('resource edits made during publication retain new settings while acknowledging the confirmed source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-flight-'));
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: Before\n');
  const out:string[]=[];
  const code=await runCli(['push','sales.yaml','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>{
   await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: While publishing\n');
   return Response.json({id:'data123',format:'dataset',title:'Before',version:1,edit_id:'one',state:digest('one')},{headers:{'X-Artifactbin-Account':'account'}});
  }});
  assert.equal(code,0,out.join(''));const local=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(local.id,'data123');assert.equal(local.title,'While publishing');
  const workspace=await loadWorkspace(root,root);const entry=workspace.tracking!.files['sales.yaml'];
  assert.equal(parseResourceFile((await baselineOf(workspace,'sales.yaml',entry))!.toString()).title,'Before');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('YAML metadata push reconciles an unrelated remote field before its conditional write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-resource-remote-'));let head:Record<string,unknown>={},writes=0;
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){head={id:'data123',format:'dataset',title:'Before',description:'Before',version:1,edit_id:'one',state:digest('one')};}
  if(init?.method==='PATCH'){
   writes++;const body=JSON.parse(String(init.body));if(body.expectedState!==head.state)return Response.json({error:'state_conflict'},{status:409});assert.equal(body.title,'Local title');assert.equal(body.description,undefined);head={...head,title:body.title,state:digest('three')};
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);await writeFile(join(root,'sales.csv'),'score\n42\n');await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\ntitle: Before\n');
  assert.equal((await invoke(['push','sales.yaml'])).code,0);
  await writeFile(join(root,'sales.yaml'),(await readFile(join(root,'sales.yaml'),'utf8')).replace('title: Before','title: Local title'));
  head={...head,description:'Remote description',version:2,edit_id:'two',state:digest('two')};
  const result=await invoke(['push','sales.yaml']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(writes,1);assert.equal(parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8')).description,'Remote description');
  assert.equal((await tracking(root,root)).files['sales.yaml'].source!.version,1,'metadata acknowledgement must not relabel old data as the new content version');
  await writeFile(join(root,'sales.csv'),'score\n43\n');assert.equal((await invoke(['push','sales.yaml'])).result.error.code,'merge_conflict');
 }finally{await rm(root,{recursive:true,force:true});}
});

describe('push --secret-env', () => {
   const harness=(prefix:string)=>cliHarness(prefix);

  test('push --secret-env stores a connection password once and never writes its value to YAML, definition, journal or output',async()=>{
   const h=await harness('afbin-seed-secret-env-');const calls:Array<{method:string;path:string;body:unknown}>=[];
   try{
    await writeFile(join(h.root,'orders.jsx'),'<Dataset kind="postgres">\n  <Connection host="db.example.com" port={5432} database="commerce" username="reader" ssl={true} />\n</Dataset>\n');
    await writeFile(join(h.root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\n');
    const code=await runCli(['push','orders.yaml','--secret-env','PGPASSWORD','--json','--server','https://example.com'],{cwd:h.root,home:h.root,env:{PGPASSWORD:'hunter2'},interactive:false,stdout:s=>h.out.push(s),stderr:()=>{},fetch:async(input,init)=>{
     const request=new Request(input,init);const path=new URL(request.url).pathname;const body=await request.json().catch(()=>undefined);calls.push({method:request.method,path,body});
     const response=path==='/api/secrets'?Response.json({secret:{id:'sec_new'}},{status:201}):path==='/api/artifacts/preflight'?Response.json({ok:true}):Response.json({id:'ds0003',version:1,edit_id:'e1',state:'c'.repeat(64),format:'dataset',url:'/a/ds0003'},{status:201});
     response.headers.set('X-Artifactbin-Account','usr_seed');return response;
    }});
    assert.equal(code,0,h.out.join(''));
    const secret=calls.find(c=>c.path==='/api/secrets');assert.equal((secret?.body as {value:string}).value,'hunter2');
    const publish=calls.find(c=>c.path==="/api/artifacts");assert.ok(!JSON.stringify(publish?.body).includes('hunter2'));assert.ok(JSON.stringify(publish?.body).includes('sec_new'));
    for(const file of ['orders.yaml','orders.jsx'])assert.ok(!(await readFile(join(h.root,file),'utf8')).includes('hunter2'));
    assert.ok(!h.out.join('').includes('hunter2'));
   }finally{await h.cleanup();}
  });
});

describe('push --restore and push --refresh', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com'],account:null});
   const account=(response:Response)=>{response.headers.set('X-Artifactbin-Account','usr_seed');return response;};

  test('push --restore restores explicit ids through a durable operation and a live row reports already restored',async()=>{
   const h=await harness('afbin-seed-restore-');
   try{
    let restores=0;
    const respond=({method,path}:{method:string;path:string})=>{
     if(method==='POST'&&path==='/api/artifacts/abc123/restore'){restores++;return account(restores===1?Response.json({id:'abc123',url:'/a/abc123',parent_id:null,ancestor_ids:[]}):Response.json({error:'not_found'},{status:404}));}
     if(method==='GET'&&path==='/api/artifacts/abc123')return account(Response.json({id:'abc123',deleted_at:restores?null:'2026-09-01T00:00:00Z',capabilities:{restore:true}}));
     return account(Response.json({error:'not_found'},{status:404}));
    };
    assert.equal(await h.invoke(['push','--restore','abc123'],respond),0,h.out.join(''));
    assert.equal(h.last().operations[0].status,'restored');
    assert.ok(h.calls.find(c=>c.method==='POST')?.headers['idempotency-key'],'restore is a durable operation');
    assert.equal(await h.invoke(['push','--restore','abc123'],respond),0,h.out.join(''));
    assert.equal(h.last().operations[0].status,'already_restored');
    const bare=await h.invoke(['push','--restore'],()=>{throw new Error('no network for an invalid invocation');});assert.notEqual(bare,0);
   }finally{await h.cleanup();}
  });

  test('push --refresh reports changed, unchanged and failed assets per target',async()=>{
   const h=await harness('afbin-seed-refresh-');
   try{
    const code=await h.invoke(['push','--refresh','abc123','def456'],({body})=>account(Response.json((body as {id:string}).id==='abc123'?{refreshed:['https://x/a.png'],unchanged:[],failed:[]}:{refreshed:[],unchanged:[],failed:[{url:'https://x/b.png',code:'rate_limited',fix:'Retry later.'}]})));
    assert.equal(code,0,h.out.join(''));
    const ops=h.last().operations;assert.equal(ops.length,2);assert.equal(ops[0].refreshed.length,1);assert.equal(ops[1].failed[0].code,'rate_limited');
    assert.ok(h.calls.every(c=>c.headers['idempotency-key']),'refresh is a durable operation');
   }finally{await h.cleanup();}
  });
});
