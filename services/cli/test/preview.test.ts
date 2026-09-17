import {State,HOME_SCOPE} from '../src/state';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeJsx} from '../../app/lib/jsx';
import {runCli} from '../src/dispatch';
import {startPreview} from '../src/preview/session';

test('file session HTTP saves reject stale revisions, preserve published metadata, query real data and persist comments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-http-'));
 let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const source='---\nid: abc123\nhead_version: 3\n---\n<Helmet><Value name="minimum" type="number" default={0} /><Query name="sales" source="ref:data01">{`select sum(amount) as total from public.rows where amount > $minimum`}</Query></Helmet><a href="/a/app001">Appendix</a><p id="text">Draft</p>';
  await writeFile(join(root,'appendix.jsx'),'<p>Appendix</p>');await writeFile(join(root,'report.jsx'),source); await writeFile(join(root,'sales.csv'),'amount\n10\n20\n');
  session=await startPreview({root,files:['report.jsx'],localFiles:{data01:'sales.csv',app001:'appendix.jsx'},home:join(root,'home')});
  const request=(path:string,body?:unknown)=>fetch(session!.url+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',origin:session!.url},...(body?{body:JSON.stringify(body)}:{})});
  const current=await (await request('/document?file=report.jsx')).json();
  assert.equal(current.metadata.head_version,3);
  assert.match(serializeJsx(current.data.nodes),/href="\/a\/app001"/);
  const untouched=await readFile(join(root,'report.jsx'),'utf8');
  assert.equal((await request('/save',{file:'report.jsx',revision:current.revision,body:'<UnknownWidget />'})).status,400);
  await writeFile(join(root,'unselected.csv'),'amount\n99\n');
  assert.equal((await request('/save',{file:'report.jsx',revision:current.revision,body:current.body.replace('ref:data01','ref:data02')})).status,403);
  assert.equal(await readFile(join(root,'report.jsx'),'utf8'),untouched);
  const save=await request('/save',{file:'report.jsx',revision:current.revision,body:current.body.replace('Draft','Edited')}); assert.equal(save.status,200);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/head_version: 3/);
  assert.equal((await request('/save',{file:'report.jsx',revision:current.revision,body:'<p>Stale</p>'})).status,409);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Edited/);
  const query=await (await request('/query',{file:'report.jsx',values:{minimum:15},only:['sales']})).json();
  assert.ok(query.tables,JSON.stringify(query)); assert.deepEqual(query.tables.sales.rows,[{total:20}]);
  assert.equal((await request('/document?file=home/state.sqlite')).status,403);
  assert.equal((await fetch(session.url+'/save',{method:'POST',headers:{origin:'https://unrelated.example','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/comments',{file:'report.jsx',node:'text',name:'Sam',text:'Review'})).status,200);
  await session.close(); session=await startPreview({root,files:['report.jsx'],localFiles:{data01:'sales.csv',app001:'appendix.jsx'},home:join(root,'home')});
  const comments=await (await request('/comments?file=report.jsx')).json(); assert.equal(comments[0].text,'Review');
  const fresh=await (await request('/document?file=report.jsx')).json();
  await writeFile(join(root,'report.jsx'),(await readFile(join(root,'report.jsx'),'utf8')).replace('Edited','External'));
  assert.equal((await request('/save',{file:'report.jsx',revision:fresh.revision,body:'<p>Overwrite</p>'})).status,409);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/External/);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('preview dispatch selects a foreground file session without a server connection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-command-'));
 try{
  await writeFile(join(root,'draft.jsx'),'<p>Draft</p>');
  const canonical=await realpath(root);const state=await State.open(root);state.put(canonical,'workspace',canonical,{server:'https://example.com',account:'usr_preview'});state.put(HOME_SCOPE,'identity-pool',JSON.stringify(['https://example.com','usr_preview']),{ids:Array.from({length:100},(_,i)=>'T'+String(i).padStart(5,'0'))});state.close();
  const output:string[]=[];let invoked=false;
  const code=await runCli(['preview','draft.jsx','--port','7446','--share','--json'],{cwd:root,home:root,env:{},stdout:value=>output.push(value),stderr:()=>{},preview:async options=>{invoked=true;assert.equal(options.port,7446);assert.equal(options.share,true);assert.deepEqual(options.paths,['draft.jsx']);return 0;},fetch:async()=>assert.fail('preview dispatch does not authenticate')});
  assert.equal(code,0,output.join(''));assert.equal(invoked,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('capture sessions run local queries but refuse file saves and comments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'capture-http-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const source='<Helmet><Query name="bad" source="ref:data01">{`select missing from public.rows`}</Query></Helmet><p>Capture</p>';
  await writeFile(join(root,'report.jsx'),source);await writeFile(join(root,'rows.csv'),'amount\n10\n');
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{data01:'rows.csv'},capture:true});
  const post=(path:string,body:unknown)=>fetch(session!.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/save',{file:'report.jsx',body:'<p>Overwrite</p>'})).status,403);
  assert.equal((await post('/comments',{file:'report.jsx',name:'Writer',text:'Write',node:'x'})).status,403);
  const result=await(await post('/query',{file:'report.jsx',values:{}})).json();
  assert.ok(result.errors.bad);assert.match(session.failure()!,/missing/);
  assert.equal(await readFile(join(root,'report.jsx'),'utf8'),source);
  const doc=await(await fetch(session.url+'/document')).json();assert.equal(doc.data.chrome,false);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});
