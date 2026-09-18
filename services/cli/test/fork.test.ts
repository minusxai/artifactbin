/**
 * FORKING SOMEBODY ELSE'S ARTIFACT FROM THE CLI.
 *
 * `afbin fork` means one thing — a local draft that `push` publishes — and two kinds of source
 * used to break it:
 *
 *  - an APP: a page whose <Mutation> writes a dataset it does not own cannot be published by the
 *    forker at all, so the draft was a file push always refused. The server's fork door copies
 *    those datasets under this account and repoints the page; the CLI takes that copy's markup,
 *    strips the identity fields and removes the page the server made.
 *  - a dataset defined by a <Dataset> DEFINITION rather than rows: the row parser refused it with
 *    `invalid_response: Dataset content is not JSON`. It forks as the typed YAML plus its .jsx
 *    definition, which is what `afbin pull <ref> --format yaml` writes.
 */
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {cliHarness,type RecordedCall} from './harness';
import {parseResourceFile} from '../src/resource-file';

const harness=(prefix:string)=>cliHarness(prefix,{account:null});
const ORIGINAL='ds0001';
const COPY='ds0009';
const PAGE='abc123';
const SERVER_COPY='cpy001';
const APP=(dataset:string)=>`<Helmet><Query name="rows" source="ref:${dataset}">{\`select * from public.rows\`}</Query>`
 +`<Mutation name="join" source="ref:${dataset}">{\`insert into public.rows (who) select $_me\`}</Mutation></Helmet>`
 +'<div><Button run="$join">Join</Button><DataTable data="$rows" /></div>';
const snapshot=(id:string,markup:string)=>({id,version:1,edit_id:'e1',state:'a'.repeat(64),format:'markup',markup,title:'Splitwise tracker',visibility:'unlisted'});

/** A server that forks the page deeply: the dry run names the dataset, the fork copies it. */
function appServer(){
 const deleted:string[]=[];
 const respond=async(call:RecordedCall)=>{
  if(call.pathname===`/api/artifacts/${PAGE}`&&call.method==='GET')return Response.json(snapshot(PAGE,APP(ORIGINAL)));
  if(call.pathname===`/api/artifacts/${PAGE}/fork`&&call.method==='POST'){
   return (call.body as {dry_run?:boolean})?.dry_run
    ? Response.json({datasets:[{id:ORIGINAL,title:'tab'}]})
    : Response.json({id:SERVER_COPY,url:`https://example.com/a/${SERVER_COPY}`,forked_from:PAGE,datasets:[{id:COPY,forked_from:ORIGINAL}]},{status:201});
  }
  if(call.pathname===`/api/artifacts/${SERVER_COPY}`&&call.method==='GET')return Response.json(snapshot(SERVER_COPY,APP(COPY)));
  if(call.pathname===`/api/artifacts/${SERVER_COPY}`&&call.method==='DELETE'){deleted.push(SERVER_COPY);return Response.json({id:SERVER_COPY,deleted:true});}
  return new Response('not found',{status:404});
 };
 return {respond,deleted};
}

describe('forking an app',()=>{
 test('the draft writes datasets this account owns, keeps no identity, and leaves no page on the server',async()=>{
  const h=await harness('afbin-fork-app-');
  const server=appServer();
  try{
   assert.equal(await h.invoke(['fork',PAGE,'--output','tracker.jsx','--json'],server.respond),0,h.out.join(''));
   const draft=await readFile(join(h.root,'tracker.jsx'),'utf8');
   // The whole point: the <Mutation> names a dataset of the forker's, not the original's.
   assert.ok(draft.includes(`ref:${COPY}`),draft);
   assert.ok(!draft.includes(`ref:${ORIGINAL}`),'no ref may still point at the original dataset');
   for(const key of ['id:','edit_id:','head_version:','state:','version:'])assert.ok(!draft.includes(`\n${key}`),`${key} must be stripped`);
   assert.match(draft,new RegExp(`forked_from: ${PAGE}`));
   assert.match(draft,/visibility: private/);
   // The datasets stay; the page the server made was only the way to reach the repointed markup.
   assert.deepEqual(server.deleted,[SERVER_COPY]);
   const operation=h.last().operations[0];
   assert.deepEqual(operation.datasets,[{id:COPY,forked_from:ORIGINAL}]);
   assert.equal(operation.server_copy,undefined);
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
   assert.deepEqual(server.deleted,[]);
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
   assert.equal(h.last().operations[0].datasets,undefined);
   assert.deepEqual(h.calls.filter(call=>call.method==='DELETE'),[]);
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
   assert.deepEqual(server.deleted,[]);
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
