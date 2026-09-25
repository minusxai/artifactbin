import assert from 'node:assert/strict';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createArtifact,getArtifactById,editorScope} from '../../services/app/lib/artifacts.ts';
import {prepareClientDocumentUpdate,prepareClientDocumentReplacement} from '../../services/app/lib/story/document-update-client.ts';
import {commitDocumentUpdate} from '../../services/app/lib/story/document-update-write.ts';
import {graphIntegrity,graphSource} from '../../services/app/lib/story/document-graph.ts';
import {documentAfterOperation} from '../../services/app/lib/story/document-update-history.ts';
import {parseDocumentUpdate} from '../../services/contracts/src/document-update.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
const db=await getDb(),raw=db.raw();assert.equal(raw.kind,'pg');
try{
 const token=await mintToken('mxmx_test_trusted'),actor={tokenId:token.id,userId:null};
 const input=await publishJsx({},'<section id="root">'+Array.from({length:32},(_,i)=>`<p id="p${i}">Text ${i}</p>`).join('')+'</section>');assert.ok(!(input instanceof Response));
 const initial=await createArtifact(token.id,null,{...input,title:'mxmx_test_trusted',visibility:'unlisted'});
 const original=initial.document;
 assert.equal(original.kind,'graph');
 const prepare=(base,index,value)=>prepareClientDocumentUpdate(base,{operations:[{kind:'setText',path:[0,index,0],value},{kind:'setAttribute',path:[0,index],name:'title',value}]});
 const commit=update=>commitDocumentUpdate(db,actor,editorScope(actor),initial.id,update);
 const patches=Array.from({length:16},(_,i)=>prepare(initial,i,`Parallel ${i} 👩🏽‍💻`));
 assert.ok(patches.every(p=>parseDocumentUpdate(p)));
 const results=await Promise.all(patches.map(commit));assert.ok(results.every(r=>r?.applied));
 const verify=async()=>{
  const head=await getArtifactById(initial.id);assert.deepEqual(graphIntegrity(head.document),[]);
  let graph=original,version=initial.version;
  const logs=(await db.query("SELECT document_state FROM artifact_edits WHERE artifact_id=$1 AND document_state->>'kind'='operations' ORDER BY seq",[initial.id])).rows;
  for(const {document_state:s} of logs){graph=documentAfterOperation(graph,s);version++;assert.ok(graph);assert.deepEqual(graphIntegrity(graph),[]);}
  assert.equal(graphSource(graph),head.source);assert.equal(version,head.version);return head;
 };
 let head=await verify();assert.equal(head.version,17);console.log('PASS 16 concurrent independently prepared mixed edits and exact operation replay');
 const conflicting=await Promise.all(['A','B'].map(t=>commit(prepare(head,20,t))));assert.equal(conflicting.filter(r=>r?.applied).length,1);head=await verify();
 console.log('PASS overlapping edits have exactly one winner');
 const holder=await raw.pool.connect(),query=db.query.bind(db);let pending;
 try{
  await holder.query('BEGIN');db.query=holder.query.bind(holder);assert.ok((await commit(prepare(head,21,'Before waiting')))?.applied);db.query=query;
  pending=commit(prepare(head,22,'After waiting'));
  for(let i=0;;i++){const n=(await raw.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;if(n)break;assert.ok(i<200);await new Promise(r=>setTimeout(r,10));}
  await holder.query('COMMIT');assert.ok((await pending)?.applied);
 }finally{db.query=query;await holder.query('ROLLBACK');holder.release();}
 await verify();console.log('PASS forced PostgreSQL row-lock wait preserves both mixed edits');
 head=await verify();const old=head;
 for(let i=0;i<23;i++){
  const result=await commit(prepare(head,0,`Revision ${i}`));assert.ok(result?.applied);head=result.row;
 }
 assert.ok((await commit(prepare(old,31,'Independent after 23 versions')))?.applied);
 assert.equal((await commit(prepare(old,0,'Stale overlap')))?.applied,false);
 head=await verify();console.log('PASS independent edit 23 versions behind; stale overlap has no partial changes');
 const restored=await commit(prepareClientDocumentReplacement(initial.source,head.version));assert.ok(restored?.applied);
 head=await verify();assert.equal(head.source,initial.source);console.log('PASS whole replacement and exact forward history replay');
 const replacementOwner=await mintToken('mxmx_test_revoked_owner');
 const locker=await raw.pool.connect();
 try{
  await locker.query('BEGIN');
  await locker.query('UPDATE artifacts SET token_id=$2,sharing_revision=sharing_revision+1 WHERE id=$1',[initial.id,replacementOwner.id]);
  const waiting=commit(prepare(head,2,'Must never commit'));
  for(let i=0;;i++){const n=(await raw.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;if(n)break;assert.ok(i<200);await new Promise(r=>setTimeout(r,10));}
  await locker.query('COMMIT');assert.equal(await waiting,null);
  assert.equal((await getArtifactById(initial.id)).version,head.version);
 }finally{await locker.query('ROLLBACK');locker.release();}
 console.log('PASS permission revocation while the operation waits on the row lock refuses the entire edit');
 console.log((await raw.pool.query('SELECT version()')).rows[0].version);
}finally{await resetDb();}
