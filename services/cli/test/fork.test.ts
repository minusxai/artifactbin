import {createDocumentGraph} from '../../app/lib/story/document-graph';
/**
 * FORKING SOMEBODY ELSE'S ARTIFACT FROM THE CLI.
 *
 * `afbin fork` writes a local draft that `push` publishes, and two kinds of source used to break
 * it:
 *
 *  - an APP: a page whose <Mutation> writes a dataset it does not own cannot be published by the
 *    forker at all, so a draft keeping the original `ref:` was a file push always refused. The
 *    server's fork door copies those datasets under this account and repoints the page — and
 *    they are PUBLISHED the moment it answers, so that is the fork. The local file is the
 *    server's copy, pulled with its identity and tracked, and the next push updates it.
 *  - a dataset defined by a <Dataset> DEFINITION rather than rows: the row parser refused it with
 *    `invalid_response: Dataset content is not JSON`. It forks as the typed YAML plus its .jsx
 *    definition, which is what `afbin pull <ref> --format yaml` writes.
 */
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cliHarness,type RecordedCall} from './harness';
import {parseResourceFile} from '../src/resource-file';

// A tracked pull needs the server's account identity, which the harness stamps on every answer.
const harness=(prefix:string)=>cliHarness(prefix,{account:null});
const trackedHarness=(prefix:string)=>cliHarness(prefix);
const ORIGINAL='ds0001';
const COPY='ds0009';
const PAGE='abc123';
const SERVER_COPY='cpy001';
const APP=(dataset:string)=>`<Helmet><Query name="rows" source="ref:${dataset}">{\`select * from public.rows\`}</Query>`
 +`<Mutation name="join" source="ref:${dataset}">{\`insert into public.rows (who) select $_me\`}</Mutation></Helmet>`
 +'<div><Button run="$join">Join</Button><DataTable data="$rows" /></div>';
const snapshot=(id:string,markup:string)=>({id,document:createDocumentGraph(markup,1),version:1,edit_id:'e1',state:'a'.repeat(64),format:'markup',markup,title:'Splitwise tracker',visibility:'unlisted'});

/** A server that forks the page deeply: the dry run names the dataset, the fork copies it. */
function appServer(){
 const forks:unknown[]=[];
 const respond=async(call:RecordedCall)=>{
  if(call.pathname===`/api/artifacts/${PAGE}`&&call.method==='GET')return Response.json(snapshot(PAGE,APP(ORIGINAL)));
  if(call.pathname===`/api/artifacts/${PAGE}/fork`&&call.method==='POST'){
   if((call.body as {dry_run?:boolean})?.dry_run)return Response.json({datasets:[{id:ORIGINAL,title:'tab'}]});
   forks.push(call.body);
   return Response.json({id:SERVER_COPY,url:`https://example.com/a/${SERVER_COPY}`,visibility:'unlisted',forked_from:PAGE,datasets:[{id:COPY,forked_from:ORIGINAL}]},{status:201});
  }
  if(call.pathname===`/api/artifacts/${SERVER_COPY}`&&call.method==='GET')return Response.json(snapshot(SERVER_COPY,APP(COPY)));
  return new Response('not found',{status:404});
 };
 return {respond,forks};
}

describe('forking an app',()=>{
 test('the local file IS the server copy: tracked, repointed, and pushed as an update',async()=>{
  const h=await trackedHarness('afbin-fork-app-');
  const server=appServer();
  try{
   assert.equal(await h.invoke(['fork',PAGE,'--output','tracker.jsx','--json'],server.respond),0,h.out.join(''));
   const file=await readFile(join(h.root,'tracker.jsx'),'utf8');
   // The whole point: the <Mutation> names a dataset of the forker's, not the original's.
   assert.ok(file.includes(`ref:${COPY}`),file);
   assert.ok(!file.includes(`ref:${ORIGINAL}`),'no ref may still point at the original dataset');
   // Registered, not a draft: the identity a HEAD pull writes is present and names the COPY.
   // (`version:` is the historical-pull field; a head pull carries head_version alone.)
   for(const key of ['id:','edit_id:','head_version:','state:'])assert.ok(file.includes(`\n${key}`),`${key} must be kept`);
   assert.ok(!file.includes('\nforked_from:'),'lineage is the server copy\'s own row, not a draft field');
   assert.match(file,new RegExp(`id: ${SERVER_COPY}`));
   const operation=h.last().operations[0];
   assert.equal(operation.status,'created');
   assert.equal(operation.id,SERVER_COPY);
   assert.equal(operation.url,`https://example.com/a/${SERVER_COPY}`);
   assert.equal(operation.forked_from,PAGE);
   assert.equal(operation.visibility,'unlisted','whatever the server fork gave the copy');
   assert.deepEqual(operation.datasets,[{id:COPY,forked_from:ORIGINAL}]);
   assert.equal(operation.server_copy,undefined,'no page is left behind to name');
   // Nothing was deleted, and the page was forked exactly once.
   assert.deepEqual(h.calls.filter(call=>call.method==='DELETE'),[]);
   assert.deepEqual(server.forks,[{}]);
   // Tracked: the workspace knows this file is that artifact, so status is clean...
   assert.equal(await h.invoke(['status','--json'],server.respond),0,h.out.join(''));
   assert.deepEqual(h.last().files.filter((f:{status:string})=>f.status!=='unchanged'),[],JSON.stringify(h.last()));
   // ...and a push after an edit UPDATES that id instead of publishing another page.
   await writeFile(join(h.root,'tracker.jsx'),file.replace('<Button','<Button title="Join the tab"'));
   const edited=APP(COPY).replace('<Button','<Button title="Join the tab"');
   const pushed=await h.invoke(['push','tracker.jsx','--json'],async call=>{
    if(call.pathname.startsWith(`/api/artifacts/${SERVER_COPY}`)&&['POST','PUT'].includes(call.method))
     return Response.json({...snapshot(SERVER_COPY,edited),version:2,edit_id:'e2',state:'c'.repeat(64)});
    return server.respond(call);
   });
   assert.equal(pushed,0,h.out.join(''));
   // The write names the COPY, so nothing was published a second time.
   const write=h.calls.filter(call=>['PUT','POST'].includes(call.method)&&call.pathname.startsWith('/api/artifacts')&&!call.pathname.endsWith('/fork')).pop()!;
   assert.match(write.pathname,new RegExp(`^/api/artifacts/${SERVER_COPY}`));
   assert.deepEqual(h.calls.filter(call=>call.method==='POST'&&call.pathname==='/api/artifacts'),[],'never a second create');
   assert.equal(h.last().operations[0].id,SERVER_COPY);
   assert.equal(h.last().operations[0].version,2);
  }finally{await h.cleanup();}
 });

 test('--dry-run names the datasets it would copy and forks nothing',async()=>{
  const h=await harness('afbin-fork-app-dry-');
  const server=appServer();
  try{
   assert.equal(await h.invoke(['fork',PAGE,'--dry-run','--json'],server.respond),0,h.out.join(''));
   const result=h.last();
   assert.equal(result.dry_run,true);
   assert.deepEqual(result.operations[0].datasets,[{id:ORIGINAL,title:'tab'}]);
   await assert.rejects(stat(join(h.root,result.operations[0].path)));
   assert.deepEqual(server.forks,[],'a dry run forks nothing');
   // Only the read-only preflight reached the fork door.
   const forks=h.calls.filter(call=>call.pathname===`/api/artifacts/${PAGE}/fork`);
   assert.deepEqual(forks.map(call=>call.body),[{dry_run:true}]);
  }finally{await h.cleanup();}
 });

 test('a page that copies nothing is still forked offline-style: asked once, never forked server-side',async()=>{
  const h=await harness('afbin-fork-plain-');
  try{
   const respond=async(call:RecordedCall)=>{
    if(call.pathname===`/api/artifacts/${PAGE}`&&call.method==='GET')return Response.json(snapshot(PAGE,'<div><p>Hello</p></div>'));
    if(call.pathname===`/api/artifacts/${PAGE}/fork`&&call.method==='POST')return Response.json({datasets:[]});
    return new Response('not found',{status:404});
   };
   assert.equal(await h.invoke(['fork',PAGE,'--output','plain.jsx','--json'],respond),0,h.out.join(''));
   assert.match(await readFile(join(h.root,'plain.jsx'),'utf8'),/<p>Hello<\/p>/);
   const operation=h.last().operations[0];
   assert.equal(operation.datasets,undefined);
   assert.equal(operation.id,undefined,'nothing is published: it is a draft push will create');
   assert.match(await readFile(join(h.root,'plain.jsx'),'utf8'),/visibility: private/);
   assert.deepEqual(h.calls.filter(call=>['PUT','DELETE'].includes(call.method)),[]);
  }finally{await h.cleanup();}
 });

 test('a version of an app names the head fork rather than repointing an old source by hand',async()=>{
  const h=await harness('afbin-fork-app-version-');
  const server=appServer();
  try{
   const respond=async(call:RecordedCall)=>{
    if(call.pathname===`/api/artifacts/${PAGE}/versions/1`)return Response.json({markup:APP(ORIGINAL),format:'markup'});
    if(call.pathname===`/api/artifacts/${PAGE}`&&call.method==='GET')return Response.json({...snapshot(PAGE,APP(ORIGINAL)),version:2});
    return server.respond(call);
   };
   assert.notEqual(await h.invoke(['fork',`${PAGE}@1`,'--output','old.jsx','--json'],respond),0);
   assert.equal(h.last().error.code,'unsupported_fork_version');
   assert.deepEqual(server.forks,[],'nothing was forked server-side');
  }finally{await h.cleanup();}
 });
});

describe('forking a dataset defined by a <Dataset> definition',()=>{
 const DEFINITION='<Dataset>\n <Table name="rows">\n  <Column name="who" type="string" />\n </Table>\n</Dataset>';
 test('writes the typed resource plus its .jsx definition instead of refusing the rows',async()=>{
  const h=await harness('afbin-fork-definition-');
  try{
   const respond=async(call:RecordedCall)=>{
    if(call.pathname===`/api/artifacts/${ORIGINAL}`)return Response.json({id:ORIGINAL,version:2,edit_id:'e1',state:'b'.repeat(64),format:'dataset',title:'tab',visibility:'unlisted'});
    if(call.pathname===`/api/artifacts/${ORIGINAL}/content`)return new Response(DEFINITION,{headers:{'Content-Type':'text/plain'}});
    return new Response('not found',{status:404});
   };
   assert.equal(await h.invoke(['fork',ORIGINAL,'--output','tab.yaml','--json'],respond),0,h.out.join(''));
   const resource=parseResourceFile(await readFile(join(h.root,'tab.yaml'),'utf8')) as {type:string;forked_from?:string;visibility?:string;source?:string};
   assert.equal(resource.type,'dataset');
   assert.equal(resource.forked_from,ORIGINAL);
   assert.equal(resource.visibility,'private');
   assert.ok(resource.source?.endsWith('.jsx'),`${resource.source} names the definition`);
   const definition=await readFile(join(h.root,resource.source!),'utf8');
   assert.ok(definition.startsWith('<Dataset>'),definition);
  }finally{await h.cleanup();}
 });

 test('rows still fork as CSV beside their resource file',async()=>{
  const h=await harness('afbin-fork-rows-');
  try{
   const respond=async(call:RecordedCall)=>{
    if(call.pathname===`/api/artifacts/${ORIGINAL}`)return Response.json({id:ORIGINAL,version:1,edit_id:'e1',state:'b'.repeat(64),format:'dataset',title:'tab',visibility:'unlisted'});
    if(call.pathname===`/api/artifacts/${ORIGINAL}/content`)return Response.json([{who:'ada',amount:2}]);
    return new Response('not found',{status:404});
   };
   assert.equal(await h.invoke(['fork',ORIGINAL,'--output','rows.yaml','--json'],respond),0,h.out.join(''));
   const resource=parseResourceFile(await readFile(join(h.root,'rows.yaml'),'utf8')) as {source?:string};
   assert.ok(resource.source?.endsWith('.csv'),`${resource.source} names the rows`);
   assert.match(await readFile(join(h.root,resource.source!),'utf8'),/who,amount/);
  }finally{await h.cleanup();}
 });
});
