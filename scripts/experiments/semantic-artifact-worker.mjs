/** Actual application write paths versus the semantic prose writer on the same app schema.
 * All modes return source and parsed metadata, preserve identity and annotation behavior,
 * coalesce archive snapshots, persist replayable app splice logs and notify the same channel.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createArtifact,applyEditScoped,replaceArtifactFor,revertArtifactFor,getArtifactById} from '../../services/app/lib/artifacts.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
import {installSemanticArtifactStorage,createSemanticArtifactWriter} from './semantic-artifact-adapter.mjs';
const db=await getDb();assert.equal(db.raw().kind,'pg');const pool=db.raw().pool;
const mode=process.argv.find(x=>x.startsWith('--mode='))?.slice(7)??'semantic';
const checksOnly=process.argv.includes('--checks-only');
const paragraphs=checksOnly?32:Number(process.argv.find(x=>x.startsWith('--paragraphs='))?.slice(13)??1000);
const repeats=checksOnly?1:Number(process.argv.find(x=>x.startsWith('--repeats='))?.slice(10)??3);
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9)??`/tmp/artifact-semantic-app-${mode}.json`;
assert.ok(['whole','current','semantic'].includes(mode));
const value=(i,round)=>`agent_${i}_${String(round).padStart(6,'0')} ${createHash('sha256').update('a'+i).digest('hex')} ${createHash('sha256').update('b'+i).digest('hex')}${round?' 🎉 '+('variable length '.repeat(round)):''}`;
const sourceFor=n=>'<section id="root" className="prose">'+Array.from({length:n},(_,i)=>`<p id="p${i}">${value(i,0)}</p>`).join('')+'</section>';
let metrics={queries:0,selects:0,telemetry:0,transactions:0};const counted=fn=>async(sql,params)=>{metrics.queries++;if(/INSERT INTO analytics_events/.test(sql))metrics.telemetry++;if(/^SELECT/i.test(sql.trim()))metrics.selects++;return fn(sql,params);};
const results={mode,base:'main@fa45adc',scope:'actual app services/tables; variable-length Unicode prose, 16 agents x 3 edits; direct services without HTTP; full response assembly included',runs:[],checks:[]};
const quantile=(values,q)=>{values=[...values].sort((a,b)=>a-b);return values[Math.ceil(values.length*q)-1];};
try{
 if(mode==='semantic')await installSemanticArtifactStorage(db);
 const original=db.query.bind(db),transaction=db.transaction.bind(db);db.query=counted(original);db.transaction=fn=>{metrics.transactions++;return transaction(tx=>fn({...tx,query:counted(tx.query.bind(tx))}));};
 const writer=mode==='semantic'?await createSemanticArtifactWriter({query:counted(pool.query.bind(pool))}):null;
 const token=await mintToken('mxmx_test_semantic_app'),actor={tokenId:token.id,userId:null};
 const request=(row,i,newText)=>{const slot=row.bench_semantic_state.tree.roots[0].children[i].children[0].slot;return {slot,oldText:row.bench_semantic_state.prose[slot].value,newText,baseVersion:row.version,epoch:row.bench_epoch,sharingRevision:row.sharing_revision??0};};
 const verify=async(id)=>{
  const head=await getArtifactById(id),log=(await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[id])).rows;
  let replay='';const versions=new Map();
  for(let i=0;i<log.length;i++){const e=log[i];assert.equal(replay.slice(e.splice_start,e.splice_start+e.removed.length),e.removed,'UTF-16 log preimage mismatch');replay=replay.slice(0,e.splice_start)+e.inserted+replay.slice(e.splice_start+e.removed.length);versions.set(i+1,replay);}
  assert.equal(replay,head.source);assert.equal(head.version,log.length);
  for(const row of (await db.query('SELECT version,source FROM artifact_versions WHERE artifact_id=$1',[id])).rows)assert.equal(row.source,versions.get(row.version),'archive is not its exact preimage');
  const valid=await publishJsx({},head.source);assert.ok(!(valid instanceof Response));assert.equal(valid.source,head.source);assert.equal(valid.meta.compiledCss,head.meta.compiledCss);
  assert.equal(head.meta.parsedArtifact.sourceHash,createHash('sha256').update(head.source).digest('hex'));
  if(mode==='semantic')assert.equal(head.bench_source_bytes,Buffer.byteLength(head.source));return head;
 };
 results.settings=(await pool.query("SELECT version(),current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes")).rows[0];
 for(let run=0;run<repeats;run++){
  const published=await publishJsx({},sourceFor(paragraphs));assert.ok(!(published instanceof Response));
  const initial=await createArtifact(token.id,null,{...published,title:'mxmx_test_semantic_app',visibility:'unlisted'});
  metrics={queries:0,selects:0,telemetry:0,transactions:0};const samples=[],started=performance.now();
  await Promise.all(Array.from({length:16},(_,i)=>(async()=>{
   let snapshot=initial;
   for(let round=1;round<=3;round++){
    const start=performance.now();let retries=0;
    for(;;){assert.ok(retries<128);let updated;
     if(mode==='semantic')updated=await writer(actor,initial.id,request(snapshot,i,value(i,round)));
     else if(mode==='current'){
      const result=await applyEditScoped(actor,initial.id,{baseEditId:snapshot.edit_id,change:{oldString:value(i,round-1),newString:value(i,round)}});
      assert.ok(!(result instanceof Response),result instanceof Response?await result.text():'');if(result?.applied)updated=result.row;
     }else{
      const prepared=await publishJsx({},snapshot.source.replace(value(i,round-1),value(i,round)));assert.ok(!(prepared instanceof Response));
      const result=await replaceArtifactFor(actor,initial.id,{...prepared,title:initial.title},{expectedVersion:snapshot.version});assert.ok(!(result instanceof Response));if(result&&!result.conflict)updated=result;
     }
     if(updated){JSON.stringify({id:updated.id,version:updated.version,edit_id:updated.edit_id,source:updated.source,meta:updated.meta,shares:updated.shares});snapshot=updated;break;}
     retries++;snapshot=await getArtifactById(initial.id);
    }
    samples.push({ms:performance.now()-start,retries});
   }
  })()));
  const elapsed=performance.now()-started,counts={...metrics};
  const head=await verify(initial.id);assert.equal(head.version,49);for(let i=0;i<16;i++)assert.ok(head.source.includes(value(i,3)));
  const identities=(await db.query('SELECT source_id,retired_version FROM artifact_source_ids WHERE artifact_id=$1',[initial.id])).rows;assert.equal(identities.length,paragraphs+1);assert.ok(identities.every(x=>x.retired_version==null));
  if(mode!=='whole')assert.equal((await db.query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows[0].n,1);
  if(mode==='semantic'){assert.equal(counts.queries-counts.telemetry,48);assert.equal(counts.selects,0);}
  const entry={run:run+1,sourceBytes:Buffer.byteLength(published.source),concurrency:16,accepted:48,elapsedMs:elapsed,acceptedPerSecond:48000/elapsed,p95Ms:quantile(samples.map(s=>s.ms),.95),p50Ms:quantile(samples.map(s=>s.ms),.5),clientRetries:samples.reduce((n,s)=>n+s.retries,0),...counts};
  results.runs.push(entry);console.error(JSON.stringify(entry));
  results.checks.push('all 48 changes retained; app logs replay exactly; every archive preimage matches; public IDs unchanged; source/hash/bytes/CSS agree');
  if(mode==='semantic'&&run===0){
   const probe=request(head,0,'Checked');
   for(const override of [{baseVersion:head.version+100},{sharingRevision:probe.sharingRevision+1},{slot:'unknown'}])assert.equal(await writer(actor,initial.id,{...probe,...override}),null);
   for(const newText of ['{$_row.name}','className="bg-red-500"','\0'])await assert.rejects(writer(actor,initial.id,{...probe,newText}));
   await assert.rejects(writer(actor,initial.id,{...probe,annotationOps:[]}));
   await pool.query("UPDATE artifacts SET source=jsonb_set(source,'{policy}','\"stale\"') WHERE id=$1",[initial.id]);
   assert.equal(await writer(actor,initial.id,probe),null);
   await pool.query("UPDATE artifacts SET source=jsonb_set(source,'{policy}',to_jsonb($2::text)) WHERE id=$1",[initial.id,head.bench_semantic_state.policy]);
   const foreign=await mintToken('mxmx_test_semantic_foreign');assert.equal(await writer({tokenId:foreign.id,userId:null},initial.id,request(head,0,'Foreign')),null);
   const same=await Promise.all(['A','B'].map(suffix=>writer(actor,initial.id,request(head,0,'Winner '+suffix))));assert.equal(same.filter(Boolean).length,1);
   const base=await getArtifactById(initial.id);
   const structural=await applyEditScoped(actor,initial.id,{baseEditId:base.edit_id,change:{oldString:'</section>',newString:'<p id="added">New node</p></section>'}});assert.ok(structural?.applied);
   assert.equal(await writer(actor,initial.id,request(base,1,'Stale')),null);
   let now=await getArtifactById(initial.id);assert.ok(await writer(actor,initial.id,request(now,1,'After structure 🎉 longer')));await verify(initial.id);
   now=await getArtifactById(initial.id);
   const invalid=await applyEditScoped(actor,initial.id,{baseEditId:now.edit_id,change:{oldString:'<p id="added">',newString:'<p id="added" onClick="run()">'}});assert.ok(invalid instanceof Response);assert.equal(invalid.status,400);assert.equal((await getArtifactById(initial.id)).version,now.version);
   const listener=await pool.connect(),notifications=[],channel='artifact_'+initial.id.toLowerCase();listener.on('notification',m=>notifications.push(m.payload));await listener.query(`LISTEN "${channel}"`);
   try{const notified=await writer(actor,initial.id,request(now,2,'Notify 🎉'));assert.ok(notified);for(let i=0;!notifications.includes(notified.edit_id);i++){assert.ok(i<100);await new Promise(r=>setTimeout(r,10));}}finally{await listener.query(`UNLISTEN "${channel}"`);listener.release();}
   now=await getArtifactById(initial.id);await pool.query("UPDATE artifacts SET bench_archived_at=now()-interval '3 minutes' WHERE id=$1",[initial.id]);
   const beforeCount=(await db.query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows[0].n;
   const both=await Promise.all([3,4].map(i=>writer(actor,initial.id,request(now,i,'Archive '+i))));assert.ok(both.every(Boolean));assert.equal((await db.query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows[0].n,beforeCount+1);
   await verify(initial.id);
   // Force a preceding leaf to grow while the second leaf's UPDATE waits. Its SET
   // aggregate must use current lengths, not the statement's pre-wait snapshot.
   now=await getArtifactById(initial.id);const connection=await pool.connect();const heldWriter=await createSemanticArtifactWriter({query:connection.query.bind(connection)});let pending;
   try{
    await connection.query('BEGIN');assert.ok(await heldWriter(actor,initial.id,request(now,0,'Growing first leaf 👩🏽‍💻 '+('long '.repeat(20)))));
    pending=writer(actor,initial.id,request(now,5,'After waiting 🎉'));
    for(let i=0;;i++){const n=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'WITH updated AS (%'")).rows[0].n;if(n)break;assert.ok(i<100);await new Promise(r=>setTimeout(r,10));}
    await connection.query('COMMIT');assert.ok(await pending);
   }finally{await connection.query('ROLLBACK');connection.release();if(pending)await pending;}
   await verify(initial.id);
   const previous=await getArtifactById(initial.id);await pool.query("UPDATE artifacts SET bench_archived_at=now()-interval '3 minutes' WHERE id=$1",[initial.id]);
   const replacement=await publishJsx({},previous.source.replace('id="p10"','id="p10" className="font-bold"'));assert.ok(!(replacement instanceof Response));
   const replaced=await replaceArtifactFor(actor,initial.id,{...replacement,title:previous.title},{expectedVersion:previous.version});assert.ok(replaced&&!(replaced instanceof Response)&&!replaced.conflict);
   assert.equal(await writer(actor,initial.id,request(previous,6,'Stale after replacement')),null);
   const restored=await revertArtifactFor(actor,initial.id,previous.version,{expectedVersion:replaced.version});assert.ok(restored&&'source'in restored);assert.equal(restored.source,previous.source);assert.ok(await writer(actor,initial.id,request(restored,6,'After restore 🎉')));await verify(initial.id);
   results.checks.push('foreign writer and same-leaf conflict; full app structural fallback and invalid-attribute refusal; existing live notification; one coalesced archive under contention; forced lock wait preserves UTF-16 offsets; whole replacement and restore invalidate old capabilities');
  }
  writeFileSync(output,JSON.stringify(results,null,2));
 }
}finally{await resetDb();}
