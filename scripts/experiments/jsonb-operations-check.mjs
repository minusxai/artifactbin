import {currentStoryCss} from '../../services/app/lib/data/story/story-css.server.ts';
import assert from 'node:assert/strict';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createArtifact,getArtifactById,applyEditScoped,editorScope,refLoaderForActor} from '../../services/app/lib/artifacts.ts';
import {decodeDocument} from '../../services/app/lib/story/document-codec.ts';
import {proseOperation} from '../../services/app/lib/story/document-prose.ts';
import {prepareGraphOperation} from '../../services/app/lib/story/document-graph-admission.ts';
import {commitGraphOperation} from '../../services/app/lib/story/document-graph-write.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
const db=await getDb(),raw=db.raw();assert.equal(raw.kind,'pg');const pool=raw.pool;
try{
 const token=await mintToken('mxmx_test_jsonb_operations'),actor={tokenId:token.id,userId:null};
 const input=await publishJsx({},'<section id="root">'+Array.from({length:32},(_,i)=>`<p id="p${i}">Text ${i}</p>`).join('')+'</section>');assert.ok(!(input instanceof Response));
 const initial=await createArtifact(token.id,null,{...input,title:'mxmx_test_operations',visibility:'unlisted'});
 const edit=(base,i,text)=>applyEditScoped(actor,initial.id,{baseEditId:base.edit_id,text:proseOperation(base.source,base.source.replace(`Text ${i}`,text))});
 const all=await Promise.all(Array.from({length:16},(_,i)=>edit(initial,i,`Changed ${i} 👩🏽‍💻 `+'long '.repeat(i))));assert.ok(all.every(r=>r?.applied));
 const verify=async()=>{
  const row=await getArtifactById(initial.id),logs=(await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[initial.id])).rows;
  let source='';const sources=new Map();
  for(const e of logs){assert.equal(source.slice(e.splice_start,e.splice_start+e.removed.length),e.removed,'log offsets');source=source.slice(0,e.splice_start)+e.inserted+source.slice(e.splice_start+e.removed.length);sources.set(sources.size+1,source);}
  assert.equal(source,row.source);const valid=await publishJsx({},source);assert.ok(!(valid instanceof Response));assert.equal(valid.source,source);assert.equal(valid.meta.compiledCss,await currentStoryCss(row.meta,row.source));
  for(const v of (await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows)assert.equal(decodeDocument(v.document),sources.get(v.version));
  return row;
 };
 let head=await verify();assert.equal(head.version,17);assert.equal((await db.query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows[0].n,1);
 console.log('PASS 16 simultaneous independent Unicode writes, exact logs and one coalesced archive');
 const both=await Promise.all(['A','B'].map(t=>edit(head,20,t)));assert.equal(both.filter(r=>r?.applied).length,1);await verify();console.log('PASS overlapping concurrent operations: exactly one winner');
 // Hold a real preceding operation in an uncommitted transaction; the later
 // statement must compute offsets from the updated row after it acquires the lock.
 head=await getArtifactById(initial.id);const conn=await pool.connect(),original=db.query.bind(db);let pending;
 try{
  await conn.query('BEGIN');
  db.query=conn.query.bind(conn);const first=await edit(head,21,'Preceding 👩🏽‍💻 '+'growth '.repeat(40));assert.ok(first.applied);db.query=original;
  pending=edit(head,22,'After waiting β');
  for(let i=0;;i++){const n=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;if(n)break;assert.ok(i<200);await new Promise(r=>setTimeout(r,10));}
  await conn.query('COMMIT');assert.ok((await pending).applied);
 }finally{db.query=original;await conn.query('ROLLBACK');conn.release();}
 await verify();console.log('PASS forced row-lock wait computes offsets from the committed predecessor');
 const foreign=await mintToken('mxmx_test_jsonb_foreign');head=await getArtifactById(initial.id);
 assert.equal(await applyEditScoped({tokenId:foreign.id,userId:null},initial.id,{baseEditId:head.edit_id,text:proseOperation(head.source,head.source.replace('Text 25','Forbidden'))}),null);
 const invalid=await applyEditScoped(actor,initial.id,{baseEditId:head.edit_id,change:{oldString:'</section>',newString:'<script>run()</script></section>'}});assert.ok(invalid instanceof Response);assert.equal(invalid.status,400);
 console.log('PASS foreign writer and invalid JSX cannot commit');
 // Full operation vocabulary uses the actual application path and same edit history.
 head=await getArtifactById(initial.id);
 const parallel=await Promise.all([26,27].map(index=>applyEditScoped(actor,initial.id,{baseEditId:head.edit_id,operations:[{kind:'setAttribute',path:[0,index],name:'className',value:index===26?'font-bold':'italic'}]})));
 assert.ok(parallel.every(r=>r?.applied));await verify();console.log('PASS independent structural edits through application admission');
 head=await getArtifactById(initial.id);
 const rawHead=(await db.query('SELECT document FROM artifacts WHERE id=$1',[initial.id])).rows[0];
 const base={id:initial.id,version:head.version,document:rawHead.document,meta:head.meta};
 const structural=await prepareGraphOperation(base,[{kind:'setAttribute',path:[0,28],name:'className',value:'underline'},{kind:'insert',parent:[0],index:32,source:'<h2>New section</h2>'}],{loadRef:refLoaderForActor(actor)});assert.ok(!(structural instanceof Response));
 // Hold the predecessor, force the structural statement to wait, then assert its
 // archive and source log contain the new prose rather than the planning snapshot.
 const holding=await pool.connect();let waiting;
 try{
  await holding.query('BEGIN');db.query=holding.query.bind(holding);
  assert.ok((await edit(head,29,'Concurrent structural predecessor 👩🏽‍💻')).applied);db.query=original;
  waiting=commitGraphOperation(db,actor,editorScope(actor),structural);
  for(let i=0;;i++){const n=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;if(n)break;assert.ok(i<200);await new Promise(r=>setTimeout(r,10));}
  await holding.query('COMMIT');assert.ok(await waiting);
 }finally{db.query=original;await holding.query('ROLLBACK');holding.release();}
 await verify();console.log('PASS structural statement after row-lock wait preserves prose, exact archive and replay');
 head=await getArtifactById(initial.id);
 const composite=await applyEditScoped(actor,initial.id,{baseEditId:head.edit_id,operations:[{kind:'setText',path:[0,30,0],value:'Composite text'},{kind:'removeAttribute',path:[0,26],name:'className'},{kind:'move',path:[0,32],parent:[0],index:0},{kind:'replace',path:[0,32],source:'<p>Replacement</p>'},{kind:'delete',path:[0,31]}]});assert.ok(composite?.applied);await verify();
 console.log('PASS text/attribute/remove/move/replace/delete composite is one valid history step');
 const ref=await createArtifact(token.id,null,{format:'image',content:'',source:null,meta:{}});
 head=await getArtifactById(initial.id);const snapshot=(await db.query('SELECT document FROM artifacts WHERE id=$1',[initial.id])).rows[0];
 const referencePlan=await prepareGraphOperation({id:initial.id,version:head.version,document:snapshot.document,meta:head.meta},[{kind:'insert',parent:[],index:1,source:`<img src="ref:${ref.id}" />`}],{loadRef:refLoaderForActor(actor)});assert.ok(!(referencePlan instanceof Response));
 const refConnection=await pool.connect();
 try{
  await refConnection.query('BEGIN');await refConnection.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[ref.id]);
  const pendingReference=commitGraphOperation(db,actor,editorScope(actor),referencePlan);
  for(let i=0;;i++){const n=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()")).rows[0].n;if(n)break;assert.ok(i<200);await new Promise(r=>setTimeout(r,10));}
  await refConnection.query('COMMIT');assert.equal(await pendingReference,null);
 }finally{await refConnection.query('ROLLBACK');refConnection.release();}
 assert.equal((await getArtifactById(initial.id)).edit_id,head.edit_id);console.log('PASS reference lock wait rejects changed validation context without a partial document write');
 console.log((await pool.query('SELECT version()')).rows[0].version);
}finally{await resetDb();}
