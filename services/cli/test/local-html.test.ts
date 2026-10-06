import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {prepareLocalHtml,exportLocalHtml} from '../src/local-html';
import {storyBodyFor} from '../../app/lib/story/document/body';
import {registerLocalFiles} from '../src/local-workspace';
import {loadWorkspace} from '../src/workspace';
import {localIdentities} from '../src/identities';
import {previewAnnotations} from '../src/preview/annotations';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../src/local-workspace';
import {readArtifactFileHtml,importLocalHtml} from '../src/local-html-import';

async function fixture(run:(root:string,home:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'local-html-export-'));try{await run(root,join(root,'home'));}finally{await rm(root,{recursive:true,force:true});}}
test('local HTML input snapshots real SQL rows, images and production annotation wires',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');await writeFile(join(root,'picture.png'),Buffer.from('image bytes'));await writeFile(join(root,'paper.pdf'),Buffer.from('%PDF-1.4'));
 const workspace=await loadWorkspace(root,home);await registerLocalFiles(workspace,['rows.csv','picture.png','paper.pdf']);const refs=await localIdentities(workspace),data=Object.entries(refs).find(([,path])=>path==='rows.csv')![0],image=Object.entries(refs).find(([,path])=>path==='picture.png')![0],pdf=Object.entries(refs).find(([,path])=>path==='paper.pdf')![0];
 await writeFile(join(root,'report.jsx'),`<Helmet><Import name="orders" src="ref:${data}" /><Query name="total">{\`select sum(amount) as total from orders.rows\`}</Query></Helmet><p id="words">Report</p><img src="ref:${image}" /><File src="ref:${pdf}" />`);
 await registerLocalFiles(workspace,['report.jsx']);const annotations=previewAnnotations(await localWorkspaceState(root),LOCAL_WORKSPACE_SCOPE,'report.jsx',(await readFile(join(root,'report.jsx'),'utf8')).split('---\n').at(-1)!);annotations.create({node_id:'words',body:'Review this'},'first');
 const prepared=await prepareLocalHtml({cwd:root,home,path:'report.jsx'});
 assert.deepEqual(prepared.state.tables.total!.rows,[{total:30}]);assert.equal(prepared.held.orders!.rows!.rows.length,2);assert.equal(prepared.threads[0]!.thread[0]!.body,'Review this');assert.equal(prepared.assets[image]!.base64,Buffer.from('image bytes').toString('base64'));assert.match((prepared.refData[image] as {url:string}).url,/^data:image\/png;base64,/);assert.deepEqual(prepared.refData[pdf],{kind:'pdf',url:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4').toString('base64'),name:'paper.pdf',bytes:8});
}));
test('refuses missing references and remote images before silently exporting an incomplete offline document',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'report.jsx'),'<img src="ref:Ab12Cd" />');await assert.rejects(prepareLocalHtml({cwd:root,home,path:'report.jsx'}),/unavailable locally/);
 await writeFile(join(root,'report.jsx'),'<img src="https://example.invalid/image.png" />');await assert.rejects(prepareLocalHtml({cwd:root,home,path:'report.jsx'}),/remote asset/);
}));
test('real packaged assets produce compiled self-contained HTML and safely reimport edited source',()=>fixture(async(root,home)=>{
 const runtime=resolve('../app'),cwd=process.cwd();await writeFile(join(root,'report.jsx'),'<p id="words">Packaged reader</p>');
 try{
  const bytes=await exportLocalHtml({cwd:root,home,path:'report.jsx'},runtime),file=readArtifactFileHtml(bytes.toString());
  assert.ok(file.compiled);assert.equal(file.bundle,'solid');assert.match(bytes.toString(),/id="afbin-code"/);assert.match(file.css.base,/data:font\/woff2;base64,/);assert.match(file.css.base,/font-family:'JetBrains Mono Variable'/);assert.match(file.css.base,/font-family:'IBM Plex Sans'/);assert.doesNotMatch(file.css.base,/url\(["']?\/fonts\//);
  const edited={...file,source:file.source.replace('Packaged reader','Offline edit')};const updated=bytes.toString().replace(/^(<script type="application\/json" id="afbin-file">)[\s\S]*?(<\/script>)/m,(_match,open,close)=>open+JSON.stringify(edited).replace(/</g,'\\u003c')+close);await writeFile(join(root,'report.html'),updated);await importLocalHtml(await loadWorkspace(root,home),'report.html','report.jsx');assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Offline edit/);
 }finally{process.chdir(cwd);}
}));
test('imports a remote-style downloaded file with held SQL rows and embedded image bytes into a fresh workspace',()=>fixture(async(root,home)=>{
 const workspace=await loadWorkspace(root,home);await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');await writeFile(join(root,'picture.png'),Buffer.from('image bytes'));await registerLocalFiles(workspace,['rows.csv','picture.png']);const refs=await localIdentities(workspace),data=Object.entries(refs).find(([,path])=>path==='rows.csv')![0],image=Object.entries(refs).find(([,path])=>path==='picture.png')![0];
 await writeFile(join(root,'report.jsx'),`<Helmet><Import name="orders" src="ref:${data}" /><Query name="total">{\`select sum(amount) as total from orders.rows\`}</Query></Helmet><p id="words">Report</p><img src="ref:${image}" />`);
 const cwd=process.cwd();try{
  const bytes=await exportLocalHtml({cwd:root,home,path:'report.jsx'},resolve('../app')),file=readArtifactFileHtml(bytes.toString());delete file.localWorkspace;file.origin='https://example.invalid';file.base.version=5;file.base.editId='remote_revision';
  const target=join(root,'imported');await (await import('node:fs/promises')).mkdir(target);await localWorkspaceState(target);await writeFile(join(target,'report.jsx.html'),`<script type="application/json" id="afbin-file">${JSON.stringify(file).replace(/</g,'\\u003c')}</script>`);
  const imported=await importLocalHtml(await loadWorkspace(target,join(root,'fresh-home')),'report.jsx.html');assert.equal(imported.path,'report.jsx');
  const read=await prepareLocalHtml({cwd:target,home:join(root,'fresh-home'),path:'report.jsx'});assert.deepEqual(read.state.tables.total!.rows,[{total:30}]);assert.equal(Buffer.from(read.assets[image]!.base64,'base64').toString(),'image bytes');
 }finally{process.chdir(cwd);}
}));
test('embedding image references does not replace literal reference examples in authored text',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'picture.png'),Buffer.from('image bytes'));const workspace=await loadWorkspace(root,home),assigned=await registerLocalFiles(workspace,['picture.png']),id=assigned['picture.png']!;await writeFile(join(root,'report.jsx'),`<p id="words">Literal ref:${id} is an example</p><img src="ref:${id}" />`);
 const cwd=process.cwd();try{const file=readArtifactFileHtml((await exportLocalHtml({cwd:root,home,path:'report.jsx'},resolve('../app'))).toString());assert.match(JSON.stringify(file.island.nodes),new RegExp('Literal ref:'+id+' is an example'));assert.match(JSON.stringify(file.island.refData),/data:image\/png;base64,/);}finally{process.chdir(cwd);}
}));

test('exported compiler paths and editor nodes use the same canonical HTML nesting',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'report.jsx'),'<p id="wrap">Before<div id="nested">Inside</div>After</p>');
 const cwd=process.cwd();try{
  const file=readArtifactFileHtml((await exportLocalHtml({cwd:root,home,path:'report.jsx'},resolve('../app'))).toString());
  assert.deepEqual(file.island.nodes,storyBodyFor(file.source)!.body);
  assert.match(file.compiled!.html,/data-mx-ast="/);
 }finally{process.chdir(cwd);}
}));

test('SSR-baked SQL export retains the literal carriers its offline browser module reads',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');
 const workspace=await loadWorkspace(root,home),ids=await registerLocalFiles(workspace,['rows.csv']);
 await writeFile(join(root,'report.jsx'),`<Helmet><Import name="orders" src="ref:${ids['rows.csv']}"/><Query name="total">{\`select sum(amount) as total from orders.rows\`}</Query></Helmet><h1 id="title">Report</h1><Number data="$total" col="total" agg="sum"/>`);
 const cwd=process.cwd();try{
  const html=(await exportLocalHtml({cwd:root,home,path:'report.jsx'},resolve('../app'))).toString(),file=readArtifactFileHtml(html);
  assert.match(file.compiled!.html,/aria-label="Live number">30</);
  assert.match(file.compiled!.html,/<script type="application\/json" data-mx-island-literals=/);
  assert.match(html,/<script type="application\/json" data-mx-island-literals=/);
 }finally{process.chdir(cwd);}
}));

test('a Dossier data app exports offline with its own packaged font faces',()=>fixture(async(root,home)=>{
 await writeFile(join(root,'rows.csv'),'amount\n10\n20\n');
 const workspace=await loadWorkspace(root,home),ids=await registerLocalFiles(workspace,['rows.csv']);
 await writeFile(join(root,'report.jsx'),`---\ntheme: dossier\ntemplate: app\n---\n<Helmet><Import name="orders" src="ref:${ids['rows.csv']}"/><Query name="total">{\`select sum(amount) as total from orders.rows\`}</Query></Helmet><main id="app"><h1 id="heading">Offline app</h1><Number data="$total" col="total" agg="sum"/></main>`);
 const cwd=process.cwd();try{
  const file=readArtifactFileHtml((await exportLocalHtml({cwd:root,home,path:'report.jsx'},resolve('../app'))).toString());
  assert.match(file.css.base,/font-family: "Archivo"/);
  assert.match(file.css.base,/data:font\/woff2;base64,/);
  assert.doesNotMatch(file.css.base,/fonts\.gstatic\.com/);
  assert.deepEqual(file.snapshot.state.tables.total!.rows,[{total:30}]);
 }finally{process.chdir(cwd);}
}));
