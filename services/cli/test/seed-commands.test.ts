/**
 * Workstream B (New commands) seeds: fork, export, open. Each test is `todo` until its row is
 * implemented; the owner removes the todo option, never the assertion. Rendering formats
 * (png, jpg, html) are server-side for published heads only; data formats reuse pull conversion.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

const tracked=(id:string,markup:string)=>`---\nid: ${id}\nedit_id: e1\nhead_version: 1\nstate: ${'a'.repeat(64)}\nversion: 1\ntitle: Report\nvisibility: unlisted\nshares:\n  - email: a@example.com\n    role: editor\n---\n${markup}\n`;
async function harness(prefix:string){
 const root=await mkdtemp(join(tmpdir(),prefix));
 await saveConnection({server:'https://example.com',token:'test-token'},root);
 const out:string[]=[];const bytes:Buffer[]=[];const calls:string[]=[];let network=0;
 const invoke=(args:string[],respond?:(path:string)=>Response|Promise<Response>)=>runCli([...args,'--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stdoutBytes:b=>bytes.push(Buffer.from(b)),stderr:()=>{},auth:{open:async()=>{throw new Error('browser must not open');}},fetch:async(input)=>{network++;const url=new URL(String(input));calls.push(url.pathname+url.search);if(!respond)throw new Error('offline operation attempted HTTP');return respond(url.pathname+url.search);}});
 return {root,out,bytes,calls,invoke,network:()=>network,last:()=>JSON.parse(out[out.length-1]),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('fork copies a local draft offline: no identity, forked_from set, private, no shares, source untouched',async()=>{
 const h=await harness('afbin-seed-fork-');
 try{
  await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
  const code=await h.invoke(['fork','report.jsx','--output','copy.jsx','--json']);
  assert.equal(code,0,h.out.join(''));assert.equal(h.network(),0);
  const copy=await readFile(join(h.root,'copy.jsx'),'utf8');
  for(const key of ['id:','edit_id:','head_version:','state:','version:'])assert.ok(!copy.includes(`\n${key}`),`${key} must be stripped`);
  assert.match(copy,/forked_from: abc123/);assert.match(copy,/visibility: private/);assert.ok(!copy.includes('a@example.com'));assert.ok(copy.endsWith('<p>Hello</p>\n'));
  assert.equal(await readFile(join(h.root,'report.jsx'),'utf8'),tracked('abc123','<p>Hello</p>'));
  assert.notEqual(await h.invoke(['fork','report.jsx','--output','copy.jsx','--json']),0,'never overwrite an existing destination');
  assert.equal(h.last().error.code,'output_exists');
 }finally{await h.cleanup();}
});

test('fork --dry-run reports the destination and sharing defaults without writing',async()=>{
 const h=await harness('afbin-seed-fork-dry-');
 try{
  await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
  assert.equal(await h.invoke(['fork','report.jsx','--dry-run','--json']),0,h.out.join(''));
  const result=h.last();assert.equal(result.dry_run,true);assert.equal(result.operations[0].forked_from,'abc123');assert.equal(result.operations[0].visibility,'private');
  await assert.rejects(stat(join(h.root,result.operations[0].path)));
 }finally{await h.cleanup();}
});

test('export converts local data offline and renders published heads through the server export route',async()=>{
 const h=await harness('afbin-seed-export-');
 try{
  await writeFile(join(h.root,'rows.csv'),'name,n\na,1\n');
  assert.equal(await h.invoke(['export','rows.csv','--format','json','--output','rows.json','--json']),0,h.out.join(''));
  assert.equal(h.network(),0);assert.deepEqual(JSON.parse(await readFile(join(h.root,'rows.json'),'utf8')),[{name:'a',n:1}]);
  const png=Buffer.from([137,80,78,71]);
  assert.equal(await h.invoke(['export','abc123','--format','png','--page','2','--output','slide.png','--json'],path=>path.startsWith('/a/abc123/export')?new Response(png,{headers:{'Content-Type':'image/png'}}):Response.json({id:'abc123',version:3,format:'markup',capabilities:{read:true}})),0,h.out.join(''));
  assert.ok(h.calls.some(c=>/^\/a\/abc123\/export\?.*format=png/.test(c)&&/slide=2/.test(c)),h.calls.join(','));
  assert.deepEqual(await readFile(join(h.root,'slide.png')),png);assert.equal(h.last().operations[0].format,'png');
 }finally{await h.cleanup();}
});

test('export refuses to render a modified local draft or a historical version as an image, with actionable codes',async()=>{
 const h=await harness('afbin-seed-export-refuse-');
 try{
  await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Edited locally</p>'));
  assert.notEqual(await h.invoke(['export','report.jsx','--format','png','--json']),0);
  assert.equal(h.last().error.code,'renderer_unavailable');assert.equal(h.network(),0);
  assert.notEqual(await h.invoke(['export','abc123@2','--format','html','--json'],()=>Response.json({})),0);
  assert.equal(h.last().error.code,'unsupported_version_export');
  assert.notEqual(await h.invoke(['export','abc123','--format','png','--output','-','--json']),0,'stdout bytes and a JSON envelope cannot share stdout');
 }finally{await h.cleanup();}
});

test('open prints the published URL with --no-browser and refuses untracked drafts',async()=>{
 const h=await harness('afbin-seed-open-');
 try{
  await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
  assert.equal(await h.invoke(['open','report.jsx','--no-browser','--json']),0,h.out.join(''));
  assert.equal(h.network(),0);assert.equal(h.last().operations[0].url,'https://example.com/a/abc123');
  await writeFile(join(h.root,'draft.jsx'),'<p>Unpublished</p>\n');
  assert.notEqual(await h.invoke(['open','draft.jsx','--no-browser','--json']),0);assert.equal(h.last().error.code,'unpublished_draft');
 }finally{await h.cleanup();}
});
