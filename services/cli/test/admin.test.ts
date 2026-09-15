import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cliHarness} from './harness';
test('admin pull/repair is explicit, preserves expected head and never changes local bytes on conflict',async()=>{
 const h=await cliHarness('afbin-admin-');
 try {
  const doc={id:'abc123',title:'Private',source:'<p id="intro">Before</p>',version:1,edit_id:'first'};
  assert.equal(await h.invoke(['admin','pull','abc123','--output','repair.jsx','--json'],call=>{
   assert.equal(call.pathname,'/api/admin/documents/abc123');assert.equal(call.headers['x-artifactbin-admin'],'1');return Response.json(doc);
  }),0,JSON.stringify(h.last()));
  const path=join(h.root,'repair.jsx');let source=await readFile(path,'utf8');source=source.replace('Before','After');await writeFile(path,source);
  assert.equal(await h.invoke(['admin','push','repair.jsx','--reason','Fix widget','--json'],call=>{
   assert.equal(call.method,'PUT');assert.deepEqual(call.body,{source:'<p id="intro">After</p>',edit_id:'first',reason:'Fix widget'});return Response.json({error:'version_conflict'},{status:409});
  }),3);
  assert.equal(await readFile(path,'utf8'),source);
  assert.equal(await h.invoke(['admin','push','repair.jsx','--reason','Fix widget','--json'],()=>Response.json({...doc,source:'<p id="intro">After</p>',version:2,edit_id:'second'})),0);
  assert.match(await readFile(path,'utf8'),/edit_id: second/);
 }finally{await h.cleanup();}
});
