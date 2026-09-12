import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planDependencies,substituteDependencies} from '../src/dependencies';
test('srcSet uploads each local image once and preserves its descriptors during reference substitution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-srcset-'));
 try{
  await writeFile(join(root,'small.png'),'small');await writeFile(join(root,'large.png'),'large');
  const source='<img src="./small.png" srcSet="./small.png 1x, ./large.png 2x" />';
  const plan=await planDependencies(source,'doc.jsx',root);assert.equal(plan.length,2);
  const result=substituteDependencies(source,plan,{'small.png':'abc123','large.png':'def456'});
  assert.match(result,/src="ref:abc123"/);assert.match(result,/srcSet="ref:abc123 1x, ref:def456 2x"/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('restores available local dependency paths in srcSet without rewriting literal text attributes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-restore-paths-'));
 try{
  await writeFile(join(root,'small.png'),'small');
  const module=await import('../src/dependencies');
  const restore=(module as unknown as {restoreDependencyPaths:(source:string,paths:Record<string,string>,path:string,root:string)=>Promise<string>}).restoreDependencyPaths;
  assert.equal(typeof restore,'function');
  const result=await restore('<img title="ref:abc123" srcSet="ref:abc123 1x, ref:def456 2x" />',{abc123:'./small.png',def456:'./missing.png'},'doc.jsx',root);
  assert.match(result,/title="ref:abc123"/);assert.match(result,/srcSet=".\/small.png 1x, ref:def456 2x"/);
 }finally{await rm(root,{recursive:true,force:true});}
});

// ---- Seeded by the orchestrator for workstream W3 (cli-dedupe). Turn each into a passing, non-todo test. ----
test('preflight describes each local asset by sha256, size and filename and never sends its bytes',{todo:true},async()=>{
 // Push doc.jsx referencing ./photo.png and ./rows.csv with a fetch stub. Assert the /api/artifacts/preflight body carries
 // dependencies:[{id:'local000001',sha256:<hex of photo bytes>,size:<n>,filename:'photo.png'},{id:'local000002',input:{dataset:...}}]
 // and that no base64 of the PNG appears anywhere in that request.
 assert.fail('implement');
});
test('an asset the server already owns is referenced without an upload; a miss is uploaded once and then reused',{todo:true},async()=>{
 // Preflight answers dependencies:[{id:'local000001',format:'image',existing:'img001'}]: assert no POST /api/artifacts for the image
 // and that the published markup contains ref:img001. Then answer existing:null: assert exactly one image POST, then a second push
 // of the unchanged document makes no image POST at all.
 assert.fail('implement');
});
test('dry-run reports which assets would be reused and which would be uploaded',{todo:true},async()=>{
 assert.fail('implement');
});
