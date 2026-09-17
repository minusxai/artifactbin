import {stateFor} from '../src/state-access';
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HttpClient} from '../src/http';
import {serverRenderer,exportResources} from '../src/export';
import {loadWorkspace} from '../src/workspace';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
import {cliHarness} from './harness';
test('list and log forward one page and resolve fenced local identity without an identity request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-read-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'test-token'},root);
  await writeFile(join(root,'doc.jsx'),'---\nid: abc123\n---\n<p />');
  for(const [args,path] of [
   [['list','--limit','2','--cursor','next'], '/api/artifacts?limit=2&cursor=next'],
   [['log','doc.jsx','--limit','3'], '/api/artifacts/abc123/versions?limit=3'],
   [['log','doc.jsx@2','--limit','3'], '/api/artifacts/abc123/versions?limit=3&version=2'],
  ] as const){
   const calls:string[]=[];const out:string[]=[];
   const code=await runCli([...args,'--server','https://example.com','--json'],{cwd:root,home:root,interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async input=>{
    calls.push(new URL(String(input)).pathname+new URL(String(input)).search);
    return Response.json({next_cursor:'another',artifacts:[],versions:[]});
   }});
   assert.equal(code,0,out.join(''));assert.deepEqual(calls,[path]);assert.equal(JSON.parse(out[0]).next_cursor,'another');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('comment selects listing, anchored creation, or a combined reply and resolution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-comment-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'test-token'},root);
  for(const [args,method,path,body] of [
   [[], 'GET','/api/artifacts/abc123/annotations?limit=2',undefined],
   [['--quote','Revenue','--body','Explain'], 'POST','/api/artifacts/abc123/annotations',{quote:'Revenue',body:'Explain'}],
   [['--thread','ann_123','--body','Done','--state','resolved'],'POST','/api/artifacts/abc123/annotations/ann_123',{reply:'Done',resolve:true}],
  ] as const){
   const out:string[]=[];let calls=0;
   const code=await runCli(['comment','abc123',...args,...(!args.length?['--limit','2']:[]),'--server','https://example.com','--json'],{cwd:root,home:root,interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
    calls++;if(method==='POST'&&init?.method==='GET')return Response.json({capabilities:{comment_receipts:true}},{headers:{'X-Artifactbin-Account':'test-account'}});assert.equal(init?.method,method);assert.equal(new URL(String(input)).pathname+new URL(String(input)).search,path);assert.deepEqual(init?.body?JSON.parse(String(init.body)):undefined,body);return Response.json({ok:true});
   }});assert.equal(code,0,out.join(''));assert.equal(calls,method==='POST'?2:1);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

describe('exporting and opening a published artifact', () => {
  const tracked=(id:string,markup:string)=>`---\nid: ${id}\nedit_id: e1\nhead_version: 1\nstate: ${'a'.repeat(64)}\nversion: 1\ntitle: Report\nvisibility: unlisted\nshares:\n  - email: a@example.com\n    role: editor\n---\n${markup}\n`;
   const harness=(prefix:string)=>cliHarness(prefix,{account:null});

  test('an export destination outside the workspace, and an image format on pull, are refused naming the fix (an agent lost five calls to these)',async()=>{
   const h=await harness('afbin-export-refusals-');
   try{
    await writeFile(join(h.root,'rows.csv'),'name,n\na,1\n');
    assert.notEqual(await h.invoke(['export','rows.csv','--format','json','--output','/tmp/afbin-outside-test.json','--json']),0);
    assert.equal(h.last().error.code,'outside_workspace');assert.match(h.last().error.fix,/inside the workspace/);
    assert.notEqual(await h.invoke(['pull','abc123','--format','png','--json']),0);
    assert.equal(h.last().error.code,'invalid_choice');assert.match(h.last().error.fix,/afbin export abc123 --format png/);
    assert.equal(h.network(),0);
   }finally{await h.cleanup();}
  });
  test('export converts local data offline and renders published heads through the server export route',async()=>{
   const h=await harness('afbin-seed-export-');
   try{
    await writeFile(join(h.root,'rows.csv'),'name,n\na,1\n');
    assert.equal(await h.invoke(['export','rows.csv','--format','json','--output','rows.json','--json']),0,h.out.join(''));
    assert.equal(h.network(),0);assert.deepEqual(JSON.parse(await readFile(join(h.root,'rows.json'),'utf8')),[{name:'a',n:1}]);
    const png=Buffer.from([137,80,78,71]);
    assert.equal(await h.invoke(['export','abc123','--format','png','--page','2','--output','slide.png','--json'],({path})=>path.startsWith('/a/abc123/export')?new Response(png,{headers:{'Content-Type':'image/png'}}):Response.json({id:'abc123',version:3,format:'markup',capabilities:{read:true}})),0,h.out.join(''));
    assert.ok(h.paths.some(c=>/^\/a\/abc123\/export\?.*format=png/.test(c)&&/slide=2/.test(c)),h.paths.join(','));
    assert.deepEqual(await readFile(join(h.root,'slide.png')),png);assert.equal(h.last().operations[0].format,'png');
   }finally{await h.cleanup();}
  });

  test('HTML still requires a published head and historical image rendering is refused, with actionable codes',async()=>{
   const h=await harness('afbin-seed-export-refuse-');
   try{
    await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Edited locally</p>'));
    assert.notEqual(await h.invoke(['export','report.jsx','--format','html','--json']),0);
    assert.equal(h.last().error.code,'renderer_unavailable');assert.equal(h.network(),0);
    assert.notEqual(await h.invoke(['export','abc123@2','--format','html','--json'],()=>Response.json({})),0);
    assert.equal(h.last().error.code,'unsupported_version_export');
    assert.notEqual(await h.invoke(['export','abc123','--format','png','--output','-','--json']),0,'stdout bytes and a JSON envelope cannot share stdout');
   }finally{await h.cleanup();}
  });

  test('open prints the published URL with --json and refuses untracked drafts',async()=>{
   const h=await harness('afbin-seed-open-');
   try{
    await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
    assert.equal(await h.invoke(['open','report.jsx','--json']),0,h.out.join(''));
    assert.equal(h.network(),0);assert.equal(h.last().operations[0].url,'https://example.com/a/abc123');
    await writeFile(join(h.root,'draft.jsx'),'<p>Unpublished</p>\n');
    assert.notEqual(await h.invoke(['open','draft.jsx','--json']),0);assert.equal(h.last().error.code,'unpublished_draft');
   }finally{await h.cleanup();}
  });
});

describe('comment, status and list over explicit refs', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com']});

  test('comment --dry-run validates anchors and permissions without posting',async()=>{
   const h=await harness('afbin-seed-comment-dry-');
   try{
    await writeFile(join(h.root,'doc.yaml'),'type: artifact\nid: abc123\n');
    const code=await h.invoke(['comment','doc.yaml','--node','n1','--body','Check this','--dry-run'],({method})=>method==='GET'?Response.json({id:'abc123',capabilities:{comment:true,comment_receipts:true},nodes:['n1']}):Response.json({error:'must not post'},{status:500}));
    assert.equal(code,0,h.out.join(''));assert.equal(h.last().dry_run,true);assert.ok(h.calls.every(c=>c.method==='GET'));
   }finally{await h.cleanup();}
  });

  test('delete --type comment --in removes a thread through the bearer door',async()=>{
   const h=await harness('afbin-seed-comment-delete-');
   try{
    const code=await h.invoke(['delete','--type','comment','--in','abc123','ann_1'],({method,path})=>method==='DELETE'&&path==='/api/artifacts/abc123/annotations/ann_1'?Response.json({ok:true}):Response.json({id:'abc123',capabilities:{comment:true}}));
    assert.equal(code,0,h.out.join(''));assert.equal(h.last().operations[0].status,'deleted');
   }finally{await h.cleanup();}
  });

  test('status and list accept explicit refs and report exact summaries',async()=>{
   const h=await harness('afbin-seed-status-ref-');
   try{
    await writeFile(join(h.root,'report.jsx'),'---\nid: abc123\n---\n<p>Hi</p>\n');
    assert.equal(await h.invoke(['status','report.jsx'],()=>{throw new Error('default status is local');}),0,h.out.join(''));
    assert.equal(h.last().files[0].id,'abc123');
    assert.equal(await h.invoke(['list','abc123','def456'],({path})=>Response.json({id:path.split('/').pop(),title:'T',format:'markup'})),0,h.out.join(''));
    assert.equal(h.last().results.length,2);
   }finally{await h.cleanup();}
  });
});

test('image exports select OG/refresh and follow only image grants without forwarding credentials',async()=>{
 const seen:{url:string;headers:Headers}[]=[];
 const grant='https://assets.example.com/assets/export/11111111-1111-4111-8111-111111111111?key=1234567890123.'+'a'.repeat(64);
 const client=new HttpClient({connection:{server:'https://example.com',token:'test-only'},fetch:async(input,init)=>{
  seen.push({url:String(input),headers:new Headers(init?.headers)});
  return seen.length===1?new Response(null,{status:302,headers:{location:grant}}):new Response('pixels',{headers:{'content-type':'image/png'}});
 }});
 const result=await serverRenderer('https://example.com',client).image('abc123',{format:'png',og:true,refresh:true});
 assert.equal(result.bytes.toString(),'pixels');
 assert.match(seen[0].url,/mode=card/);assert.match(seen[0].url,/refresh=1/);
 assert.equal(seen[0].headers.get('X-Artifactbin-Export-Delivery'),'redirect');
 assert.equal(seen[1].url,grant);assert.equal(seen[1].headers.get('authorization'),null);
 const refused=new HttpClient({connection:{server:'https://example.com',token:'test-only'},fetch:async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example/private'}})});
 await assert.rejects(refused.view('/a/abc123/export'),/redirect/i);
});

test('local images render unpublished bytes without authentication, publication or source changes',async()=>{
 const h=await cliHarness('local-image-export-',{token:null});
 try{
  const source='<p>Unpublished local edit</p>';await writeFile(join(h.root,'draft.jsx'),source);
  const workspace=await loadWorkspace(h.root,h.root);let renders=0;
  const localImage=async(options:import('../src/local-image-options').LocalImageOptions)=>{
   renders++;assert.equal(options.path,'draft.jsx');assert.equal(options.format,'png');assert.equal(options.page,2);
   assert.equal(await readFile(join(options.cwd,options.path),'utf8'),source);return Buffer.from('local-image');
  };
  const options={format:'png',page:2,output:'draft.png',server:'https://example.com',emit:()=>{},localImage};
  assert.equal(await exportResources(workspace,['draft.jsx'],{...options,dryRun:true,emit:value=>assert.equal((value as any).operations[0].requires,'local_rendering')}),true);
  assert.equal(renders,0);
  assert.equal(await exportResources(workspace,['draft.jsx'],options),true);
  assert.equal(renders,1);assert.equal(await readFile(join(h.root,'draft.png'),'utf8'),'local-image');
  assert.equal(await readFile(join(h.root,'draft.jsx'),'utf8'),source);assert.equal(h.network(),0);
  const state=await stateFor(h.root);state.put(workspace.root,'draft-identity','draft.jsx',{id:'local1'});
  assert.equal(await exportResources(workspace,['local1'],{...options,output:'by-id.png'}),true);assert.equal(renders,2);
  await assert.rejects(exportResources(workspace,['draft.jsx'],{...options,output:'failure.png',localImage:async()=>{throw Error('Render failed');}}),/Render failed/);
  await assert.rejects(readFile(join(h.root,'failure.png')),/ENOENT/);
  await assert.rejects(exportResources(workspace,['draft.jsx'],{...options,output:'draft.jsx',force:true}),/source file/);
  assert.equal(renders,2,'Refuse overwriting the source before starting a renderer');
  assert.equal(await exportResources(workspace,['https://example.com/a/local1'],{...options,output:'remote.png'}),false,'An explicit URL always selects server rendering');
 }finally{await h.cleanup();}
});
