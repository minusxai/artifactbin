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
  const source='---\nid: abc123\nhead_version: 3\n---\n<Helmet><Value name="minimum" type="number" default={0} /><Import name="sales_data" src="ref:data01" /><Query name="sales">{`select sum(amount) as total from sales_data.rows where amount > $minimum`}</Query></Helmet><a href="/a/app001">Appendix</a><p id="text">Draft</p>';
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
  // Compiles (the dry run has no rows to evaluate), fails when it runs over the file's rows.
  const source='<Helmet><Import name="bad_data" src="ref:data01" /><Query name="bad">{`select json_extract(\'not json\', \'$.a\') as v from bad_data.rows`}</Query></Helmet><p>Capture</p>';
  await writeFile(join(root,'report.jsx'),source);await writeFile(join(root,'rows.csv'),'amount\n10\n');
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{data01:'rows.csv'},capture:true});
  const post=(path:string,body:unknown)=>fetch(session!.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/save',{file:'report.jsx',body:'<p>Overwrite</p>'})).status,403);
  assert.equal((await post('/comments',{file:'report.jsx',name:'Writer',text:'Write',node:'x'})).status,403);
  const result=await(await post('/query',{file:'report.jsx',values:{}})).json();
  assert.ok(result.errors.bad);assert.match(session.failure()!,/malformed JSON/i);
  assert.equal(await readFile(join(root,'report.jsx'),'utf8'),source);
  const doc=await(await fetch(session.url+'/document')).json();assert.equal(doc.data.chrome,false);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('preview resolves image refs only from selected dataset inputs and refreshes that scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-row-images-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 const fetched:string[]=[];let cover='ref:red123';
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><Import name="books_data" src="ref:data01" /><Query name="books">{`select * from books_data.rows`}</Query></Helmet><For each={$books} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy"/></For>');
  session=await startPreview({root,home:root,files:['report.jsx'],capture:true,
   dataset:async()=>({columns:[{name:'id',type:'string'},{name:'title',type:'string'},{name:'cover_ref',type:'string'}],rows:[{id:'a',title:'Book',cover_ref:cover}]}),
   asset:async id=>{fetched.push(id);return {bytes:Buffer.from('image bytes'),contentType:id==='wrong1'?'application/json':'image/png'};}});
  const doc=await(await fetch(session.url+'/document')).json();
  assert.equal(doc.data.assetsUrl,'/image?file=report.jsx');
  const image=(ref:string)=>fetch(session!.url+doc.data.assetsUrl+'&u='+encodeURIComponent(ref));
  assert.equal((await image('ref:red123')).status,403);
  const query=()=>fetch(session!.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})});
  assert.equal((await query()).status,200);assert.deepEqual(fetched,[],'query resolves no original image bytes');
  const red=await image('ref:red123');assert.equal(red.status,200);assert.equal(red.headers.get('content-type'),'image/png');
  for(const ref of ['ref:hidden','ref:bad','','https://example.com/a.png'])assert.equal((await image(ref)).status,403);
  assert.deepEqual(fetched,['red123']);
  cover='ref:blue12';await query();assert.equal((await image('ref:red123')).status,403);assert.equal((await image(cover)).status,200);
  cover='ref:wrong1';await query();assert.equal((await image(cover)).status,404);
  const source=await readFile(join(root,'report.jsx'),'utf8');
  await writeFile(join(root,'report.jsx'),source.replace('select * from books_data.rows',"select id, title, 'ref:hidden' as cover_ref from books_data.rows"));
  const computed=await(await query()).json();assert.equal(computed.tables.books.rows[0].cover_ref,'ref:hidden');
  assert.equal((await image('ref:hidden')).status,403,'SQL cannot grant access to another reference');
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('a dataset tracked as typed YAML resolves through its source file, not the YAML bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-yaml-dataset-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 const remote:string[]=[];
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><Import name="stored_data" src="ref:data01" /><Query name="stored">{`select sum(amount) as total from stored_data.rows`}</Query><Import name="connected_data" src="ref:conn01" /><Query name="connected">{`select count(*) as n from connected_data.rows`}</Query></Helmet><p>Report</p>');
  await writeFile(join(root,'feedback.yaml'),'shares:\n  - email: reviewer@example.com\n    role: editor\ntype: dataset\nid: data01\nhead_version: 1\nsource: feedback.json\n');
  await writeFile(join(root,'feedback.json'),JSON.stringify([{amount:10},{amount:32}]));
  await writeFile(join(root,'orders.yaml'),'type: dataset\nid: conn01\nhead_version: 1\nsource: orders.jsx\n');
  await writeFile(join(root,'orders.jsx'),'<Dataset></Dataset>\n');
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{data01:'feedback.yaml',conn01:'orders.yaml'},capture:true,
   dataset:async id=>{remote.push(id);return {columns:[{name:'x',type:'number'}],rows:[{x:1},{x:2}]};}});
  const result=await(await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})})).json();
  assert.equal(session.failure(),undefined,JSON.stringify(result));
  assert.deepEqual(result.tables.stored.rows,[{total:42}]);
  assert.deepEqual(result.tables.connected.rows,[{n:2}]);
  // Compiling reads its shape (once per revision), the query its rows: both from the host.
  assert.deepEqual(remote,['conn01','conn01'],'a definition-backed dataset has no local rows and reads the host');
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('an unreadable local dataset names its file instead of leaking a parser error',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-bad-dataset-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><Import name="rows_data" src="ref:data01" /><Query name="rows">{`select * from rows_data.rows`}</Query></Helmet><p>Report</p>');
  await writeFile(join(root,'rows.json'),'shares:\n  - not json\n');
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{data01:'rows.json'},capture:true});
  const response=await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})});
  assert.equal(response.status,422);
  assert.match(session.failure()!,/rows\.json/);assert.match(session.failure()!,/data01/);
  assert.doesNotMatch(session.failure()!,/Unexpected token|is not valid JSON/);
  await session.close();
  await writeFile(join(root,'rows.yaml'),'- not\n- a mapping\n');
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{data01:'rows.yaml'},capture:true});
  assert.equal((await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})})).status,422);
  assert.match(session.failure()!,/data01/);assert.match(session.failure()!,/rows\.yaml/);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('an image tracked as typed YAML serves its source bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-yaml-image-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
  await writeFile(join(root,'report.jsx'),'<img src="ref:img001" alt="Cover" />');
  await writeFile(join(root,'cover.yaml'),'type: file\nid: img001\nhead_version: 1\nsource: cover.png\n');
  await writeFile(join(root,'cover.png'),png);
  session=await startPreview({root,home:root,files:['report.jsx'],localFiles:{img001:'cover.yaml'},capture:true,asset:async()=>assert.fail('a local image is not fetched from the host')});
  const response=await fetch(session.url+'/remote/img001');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});
