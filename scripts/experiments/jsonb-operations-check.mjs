import assert from 'node:assert/strict';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createArtifact,getArtifactById,applyEditScoped} from '../../services/app/lib/artifacts.ts';
import {decodeDocument} from '../../services/app/lib/story/document-codec.ts';
import {proseOperation} from '../../services/app/lib/story/document-prose.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
const db=await getDb(),raw=db.raw();assert.equal(raw.kind,'pg');const pool=raw.pool;
try{
 const token=await mintToken('mxmx_test_jsonb_operations'),actor={tokenId:token.id,userId:null};
 const input=await publishJsx({},'<section>'+Array.from({length:32},(_,i)=>`<p id="p${i}">Text ${i}</p>`).join('')+'</section>');assert.ok(!(input instanceof Response));
 const initial=await createArtifact(token.id,null,{...input,title:'mxmx_test_operations',visibility:'unlisted'});
 const edit=(base,i,text)=>applyEditScoped(actor,initial.id,{baseEditId:base.edit_id,text:proseOperation(base.source,base.source.replace(`Text ${i}`,text))});
 const all=await Promise.all(Array.from({length:16},(_,i)=>edit(initial,i,`Changed ${i} 👩🏽‍💻 `+'long '.repeat(i))));assert.ok(all.every(r=>r?.applied));
 const verify=async()=>{
  const row=await getArtifactById(initial.id),logs=(await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[initial.id])).rows;
  let source='';const sources=new Map();
  for(const e of logs){assert.equal(source.slice(e.splice_start,e.splice_start+e.removed.length),e.removed,'log offsets');source=source.slice(0,e.splice_start)+e.inserted+source.slice(e.splice_start+e.removed.length);sources.set(sources.size+1,source);}
  assert.equal(source,row.source);const valid=await publishJsx({},source);assert.ok(!(valid instanceof Response));assert.equal(valid.source,source);assert.equal(valid.meta.compiledCss,row.meta.compiledCss);
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
 console.log((await pool.query('SELECT version()')).rows[0].version);
}finally{await resetDb();}
