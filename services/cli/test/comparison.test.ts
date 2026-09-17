import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compare} from '../src/comparison';
import {loadWorkspace} from '../src/workspace';
import {HttpClient} from '../src/http';
import {digest} from '../src/files';
import {writeDocument} from '../src/document';
import {writeRecord,tracking} from './tracking';
import {cliHarness} from './harness';

/** A private state directory per case: the real ~/.artifactbin is never opened. */
async function fixture(run:(home:string,root:string)=>Promise<void>){
 const base=await mkdtemp(join(tmpdir(),'afbin-compare-'));
 const home=join(base,'home'),root=join(base,'work');
 await mkdir(home);await mkdir(root);
 try{await run(home,await realpath(root));}finally{await rm(base,{recursive:true,force:true});}
}
test('historical diff caches fetched immutable content without changing the accepted base or working file',()=>fixture(async(home,root)=>{
  const snapshot={id:'abc123',version:2,edit_id:'edit2',state:digest('state2'),format:'markup',markup:'<p id="p001">Current</p>'};
  const local=writeDocument({metadata:{id:'abc123',edit_id:'edit2',head_version:2,state:snapshot.state},body:snapshot.markup});
  await writeFile(join(root,'doc.jsx'),local);
  await writeRecord(home,root,'workspace',root,{server:'https://example.com',account:'user'});
  await writeRecord(home,root,'tracked','doc.jsx',{id:'abc123',url:'https://example.com/a/abc123',file:digest(local),snapshot});
  let calls=0;
  const client=new HttpClient({connection:{server:'https://example.com',token:'test'},fetch:async()=>{calls++;return Response.json({id:'abc123',version:1,format:'markup',source:'<p id="p001">Previous</p>',markup:'<p id="p001">Previous</p>',meta:{}});}});
  const first=await compare(await loadWorkspace(root,home),'doc.jsx@1','https://example.com',false,client);
  assert.match(first.diffs[0].diff,/Previous/);assert.equal(calls,1);
  const cached=await loadWorkspace(root,home);assert.deepEqual(cached.tracking!.files['doc.jsx'].snapshot,snapshot);
  assert.equal(cached.tracking!.files['doc.jsx'].file,digest(local),'the accepted hash is untouched by an observation');
  const second=await compare(cached,'doc.jsx@1','https://example.com',false);
  assert.deepEqual(second,first);assert.equal(calls,1);assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),local);
}));

test('historical binary diff reuses cached bytes without another content request',()=>fixture(async(home,root)=>{
  const snapshot={id:'abc123',version:2,edit_id:'edit2',state:digest('state2'),format:'image'};
  const local=Buffer.from([0,1,2]);
  await writeFile(join(root,'image.png'),local);
  await writeRecord(home,root,'workspace',root,{server:'https://example.com',account:'user'});
  await writeRecord(home,root,'tracked','image.png',{id:'abc123',url:'https://example.com/a/abc123',file:digest(local),snapshot});
  let calls=0;
  const client=new HttpClient({connection:{server:'https://example.com',token:'test'},fetch:async input=>{calls++;return String(input).includes('/content?')?new Response(Buffer.from([4,5,6])):Response.json({id:'abc123',version:1,format:'image',meta:{}});}});
  const first=await compare(await loadWorkspace(root,home),'image.png@1','https://example.com',false,client);
  assert.equal(calls,2);assert.match(first.diffs[0].diff,/differs/);
  const second=await compare(await loadWorkspace(root,home),'image.png@1','https://example.com',false);
  assert.deepEqual(second,first);assert.equal(calls,2);assert.deepEqual(await readFile(join(root,'image.png')),local);
  assert.equal((await tracking(home,root)).files['image.png'].file,digest(local),'no stored copy of the binary, only its hash');
}));

describe('diff over many targets, and log filters', () => {
   const harness=(prefix:string)=>cliHarness(prefix);

  test('diff accepts multiple targets and --output, and log filters by author per target',async()=>{
   const h=await harness('afbin-seed-diff-log-');
   try{
    await writeFile(join(h.root,'a.jsx'),'<p>A</p>\n');await writeFile(join(h.root,'b.jsx'),'<p>B</p>\n');
    assert.equal(await h.invoke(['diff','a.jsx','b.jsx','--output','changes.diff','--json'],()=>{throw new Error('local diff must not fetch');}),0,h.out.join(''));
    assert.equal(h.last().output.endsWith('changes.diff'),true);assert.match(await readFile(join(h.root,'changes.diff'),'utf8'),/a\.jsx[\s\S]*b\.jsx/);
    assert.equal(await h.invoke(['log','abc123','--filter','author=usr_1','--json'],({path})=>Response.json({versions:[{version:2,author:'usr_1'}],next_cursor:null,requested:path})),0,h.out.join(''));
    assert.match(h.calls[h.calls.length-1].path,/author=usr_1/);
   }finally{await h.cleanup();}
  });
});
