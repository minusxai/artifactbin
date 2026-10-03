import {State,HOME_SCOPE} from '../src/state';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeJsx} from '../../app/lib/jsx';
import {runCli} from '../src/dispatch';
import {startPreview} from '../src/preview/session';
import {prepareClientDocumentUpdate} from '../../app/lib/story/graph/document-update-client';
import {buildPreview} from '../scripts/build-preview.mjs';
import {readdir} from 'node:fs/promises';

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

test('inline preview comments preserve selections and accept only real body anchors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-comments-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><style>{`/* id="fake" */`}</style></Helmet><p id="words">Selected words</p>');
  session=await startPreview({root,home:join(root,'home'),files:['report.jsx']});
  const range={v:1,parts:[{rel:'',start:0,end:8,text:'Selected'}]};
  const post=(body:unknown)=>fetch(session!.url+'/comments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const comment={file:'report.jsx',node:'words',name:'Sam',text:'Clarify this',quote:'Selected',range};
  assert.equal((await post(comment)).status,200);
  await session.close();session=await startPreview({root,home:join(root,'home'),files:['report.jsx']});
  const stored=await(await fetch(session.url+'/comments?file=report.jsx')).json();
  assert.deepEqual(stored[0].range,range);assert.equal(stored[0].quote,'Selected');
  assert.equal((await post({...comment,node:'fake'})).status,400);
  assert.equal((await post({...comment,range:{v:99}})).status,400);
  assert.equal((await post({...comment,quote:123})).status,400);
  assert.equal((await post({...comment,file:'unselected.jsx'})).status,403);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('production editor protocol saves local graph edits and rejects stale file writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-editor-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'---\nid: abc123\nhead_version: 9\n---\n<p id="text">Draft</p>');
  session=await startPreview({root,home:join(root,'home'),files:['report.jsx']});
  const call=async(operation:string,args:object={})=>(await fetch(session!.url+'/editor',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',operation,...args})})).json();
  const head=await call('load');assert.ok(head.document,'loads the production document graph');
  const update=prepareClientDocumentUpdate({document:head.document,version:head.version,meta:{theme:null,template:null,colorMode:null},title:head.title},{source:'<p id="text">Edited</p>',metadata:{title:'Local title'}});
  const saved=await call('commit',{edit_id:head.edit_id,document_update:update});
  assert.equal(saved.ok,true);assert.match(await readFile(join(root,'report.jsx'),'utf8'),/head_version: 9/);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/title: Local title/);
  const thread=await call('annotations.create',{input:{node_id:'text',body:'Review this'},key:'once'});
  assert.equal(thread.thread[0].body,'Review this');
  assert.equal((await call('annotations.create',{input:{node_id:'text',body:'Review this'},key:'once'})).id,thread.id);
  const reply=await call('annotations.act',{id:thread.id,input:{reply:'Done',resolve:true}});
  assert.equal(reply.thread.length,2);assert.equal(reply.status,'resolved');
  assert.equal((await call('annotations.list',{status:'open'})).length,0);
  assert.equal((await call('annotations.list',{status:'resolved'}))[0].anchor.nodeId,'text');
  assert.equal((await call('commit',{edit_id:head.edit_id,document_update:update})).status,409);
  const fresh=await call('load');await writeFile(join(root,'report.jsx'),'<p id="text">External</p>');
  assert.equal((await call('commit',{edit_id:fresh.edit_id,document_update:update})).status,409);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/External/);
  await session.close();session=await startPreview({root,home:join(root,'home'),files:['report.jsx']});
  assert.equal((await call('annotations.list',{status:'resolved'}))[0].thread.length,2);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
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

 test('preview serves the production logo and no author wrapper',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-chrome-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'<p>Draft</p>');await writeFile(join(root,'logo-128.png'),'logo');
  session=await startPreview({root,files:['report.jsx'],home:join(root,'home'),publicAssets:root});
  const logo=await fetch(session.url+'/logo-128.png');assert.equal(logo.status,200);assert.equal(await logo.text(),'logo');
  // The author script runs in the document: the former sandboxed wrapper is not served.
  const frame=await fetch(session.url+'/author-frame');assert.notEqual(frame.status,200);await frame.arrayBuffer();
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('preview serves the compiled reader: no React, a live Select re-runs its query',async()=>{
 const appDir=join(import.meta.dirname,'../../app');
 const cwd=process.cwd();process.chdir(appDir);
 const root=await mkdtemp(join(tmpdir(),'preview-compiled-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const source='<Helmet><Value name="n" type="number" default={1} /><Query name="doubled">{`select $n * 2 as v`}</Query></Helmet><div><p id="prose">Some prose</p><Select label="Multiplier" value="$n" options={[{"label":"One","value":1},{"label":"Two","value":2}]} /><p>Doubled: <Number data="$doubled" col="v" /></p></div>';
  await writeFile(join(root,'report.jsx'),source);
  session=await startPreview({root,files:['report.jsx'],home:join(root,'home'),assets:root,publicAssets:join(appDir,'public')});
  const page=await fetch(session.url+'/workspace/report.jsx');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.doesNotMatch(html,/react-dom|"react"|from"react"/i);
  assert.match(html,/data-mx-ast/);
  assert.match(html,/Some prose/);
  assert.match(html,/"queryUrl":"\/query\?file=report\.jsx"/);
  const module=/<script type="module" src="(\/islands\/d\/[0-9a-f]{16}\.js(?:\?b=[0-9a-f]{16})?)"/.exec(html);
  assert.ok(module,html);
  const bytes=await fetch(session.url+module![1]);
  assert.equal(bytes.status,200);
  const code=await bytes.text();
  assert.match(code,/\$boot\(|_\$createComponent/);
  // Bound to the local build's chunks: no bare runtime specifier reaches the browser.
  assert.doesNotMatch(code,/from\s*["']@mx\//);
  const query=await (await fetch(session.url+'/query?file=report.jsx',{method:'POST',headers:{'content-type':'application/json',origin:session.url},body:JSON.stringify({values:{n:3}})})).json();
  assert.deepEqual(query.tables.doubled.rows,[{v:6}]);
  const draft=await fetch(session.url+'/draft',{method:'POST',headers:{'content-type':'application/json',origin:session.url},body:JSON.stringify({file:'report.jsx',source:source.replace('Some prose','Edited prose')})});
  assert.equal(draft.status,200);
  const draftHtml=(await draft.json()).html as string;
  assert.match(draftHtml,/Edited prose/);
  assert.match(draftHtml,/data-mx-inline-story/);
  const badDraft=await fetch(session.url+'/draft',{method:'POST',headers:{'content-type':'application/json',origin:session.url},body:JSON.stringify({file:'report.jsx',source:'<UnknownWidget />'})});
  assert.equal(badDraft.status,400);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});process.chdir(cwd);}
});

test('a page with an internal link serves a fetchable Speculation-Rules file, not just the header',async()=>{
 // A real browser follows the `Speculation-Rules` header and fetches its URL; nothing mocks that
 // fetch. This is the local counterpart of prepared-page.server.ts's `compiledFor`, which writes the
 // rule file to the same store the route reads back from — reproduces a bug only a real Chromium
 // load caught (the CLI compiled the page but never wrote the file the header named).
 const appDir=join(import.meta.dirname,'../../app');
 const cwd=process.cwd();process.chdir(appDir);
 const root=await mkdtemp(join(tmpdir(),'preview-speculation-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'appendix.jsx'),'<p>Appendix</p>');
  await writeFile(join(root,'report.jsx'),'<a href="/a/app001">Appendix</a><p id="prose">Some prose</p>');
  session=await startPreview({root,files:['report.jsx'],localFiles:{app001:'appendix.jsx'},home:join(root,'home'),assets:root,publicAssets:join(appDir,'public')});
  const page=await fetch(session.url+'/workspace/report.jsx');
  assert.equal(page.status,200);
  const rulesUrl=page.headers.get('speculation-rules');
  assert.ok(rulesUrl,'assembleDocument must name a Speculation-Rules header for a page with an internal link');
  const rules=await fetch(session.url+rulesUrl!.replace(/^"|"$/g,''));
  assert.equal(rules.status,200);
  assert.equal(rules.headers.get('content-type'),'application/speculationrules+json');
  assert.match(await rules.text(),/"\/a\/app001"/);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});process.chdir(cwd);}
});

test('a capture bakes its rows server-side and marks itself export-ready with no client round trip',async()=>{
 const appDir=join(import.meta.dirname,'../../app');
 const cwd=process.cwd();process.chdir(appDir);
 const root=await mkdtemp(join(tmpdir(),'preview-capture-compiled-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><Query name="two">{`select 1+1 as v`}</Query></Helmet><p>Value: <Number data="$two" col="v" /></p>');
  session=await startPreview({root,files:['report.jsx'],home:join(root,'home'),assets:root,publicAssets:join(appDir,'public'),capture:true});
  const page=await fetch(session.url+'/workspace/report.jsx?capture=1');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/<body[^>]*data-afbin-export-ready=""/);
  assert.match(html,/Live number">2</);
  assert.equal(session.failure(),undefined);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});process.chdir(cwd);}
});

test('a capture serves a row-sourced image at the compiled kit\'s own /a/<id>/raw URL, with no /query first',async()=>{
 const appDir=join(import.meta.dirname,'../../app');
 const cwd=process.cwd();process.chdir(appDir);
 const root=await mkdtemp(join(tmpdir(),'preview-capture-rowimage-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'report.jsx'),'<Helmet><Import name="books_data" src="ref:data01" /><Query name="books">{`select * from books_data.rows`}</Query></Helmet><For each={$books} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy"/></For>');
  session=await startPreview({root,files:['report.jsx'],home:join(root,'home'),assets:root,publicAssets:join(appDir,'public'),capture:true,
   dataset:async()=>({columns:[{name:'id',type:'string'},{name:'title',type:'string'},{name:'cover_ref',type:'string'}],rows:[{id:'a',title:'Book',cover_ref:'ref:red123'}]}),
   asset:async()=>({bytes:Buffer.from('image bytes'),contentType:'image/png'})});
  const page=await fetch(session.url+'/workspace/report.jsx?capture=1');
  assert.equal(page.status,200);
  const html=await page.text();
  const src=html.match(/<img[^>]*src="([^"]*)"/)?.[1];
  assert.equal(src,'/a/red123/raw');
  const image=await fetch(session.url+src);
  assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal(session.failure(),undefined);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});process.chdir(cwd);}
});

test('the preview browser bundle carries no react or react-dom',async()=>{
 const outdir=await mkdtemp(join(tmpdir(),'preview-bundle-'));
 try{
  await buildPreview(outdir);
  const files=await readdir(outdir);
  assert.ok(files.some(name=>name==='client.js'),files.join(', '));
  for(const name of files){
   if(!name.endsWith('.js'))continue;
   const code=await readFile(join(outdir,name),'utf8');
   assert.doesNotMatch(code,/from *["']react(?:-dom(?:\/client)?)?["']|require\(["']react["']\)/,`${name} pulls in react`);
  }
 }finally{await rm(outdir,{recursive:true,force:true});}
});
