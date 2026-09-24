/** Research only: current app write boundary versus a restricted same-row JSONB text operation.
 * Run via single-row-benchmark.mjs, which provisions native PostgreSQL before static app imports.
 * The prototype is NOT a general JSX editor: topology/attributes stay fixed and only plain text changes.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {serializeJsx} from '../../services/app/lib/jsx/serialize.ts';
import {createArtifact,applyEditScoped,replaceArtifactFor,revertArtifactFor,getArtifactById} from '../../services/app/lib/artifacts.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
import {installJsonbStorage} from './jsonb-storage-adapter.mjs';
import {createReadFreeWriter} from './read-free-prose.mjs';
import {encodeSource} from './validated-operations.mjs';

const db=await getDb();assert.equal(db.raw().kind,'pg');
const pool=db.raw().pool;
const jsonbApp=process.argv.includes('--jsonb-app');
const certified=process.argv.includes('--certified');
const readFree=process.argv.includes('--read-free');
assert.ok(!readFree||(jsonbApp&&certified),'--read-free requires --jsonb-app --certified');
assert.ok(!jsonbApp||process.argv.includes('--sustained-only'),'--jsonb-app requires --sustained-only');
const storageCounts=jsonbApp?await installJsonbStorage(db,{certified}):null;
const readFreeQueries={total:0,selects:0};
const readFreeWriter=readFree?await createReadFreeWriter({query:async(sql,params)=>{readFreeQueries.total++;if(/^SELECT/i.test(sql.trim()))readFreeQueries.selects++;return pool.query(sql,params);}}):null;
const contexts=new AsyncLocalStorage();
const query=db.query.bind(db);
db.query=async(sql,params)=>{const result=await query(sql,params);const ctx=contexts.getStore();if(ctx&&/WITH updated AS \(/.test(sql)&&sql.includes('UPDATE artifacts SET')){ctx.commitAttempts++;if(!result.rows.length)ctx.casMisses++;}return result;};
const quantile=(values,q)=>{if(!values.length)return null;const xs=[...values].sort((a,b)=>a-b);return +xs[Math.ceil(xs.length*q)-1].toFixed(2);};
const stats=(samples,elapsed)=>({requests:samples.length,accepted:samples.filter(x=>x.ok).length,conflicts:samples.filter(x=>!x.ok).length,acceptedPerSecond:+(samples.filter(x=>x.ok).length/elapsed*1000).toFixed(2),p50Ms:quantile(samples.map(x=>x.ms),.5),p95Ms:quantile(samples.map(x=>x.ms),.95),casMisses:samples.reduce((n,x)=>n+x.casMisses,0),commitAttempts:samples.reduce((n,x)=>n+x.commitAttempts,0),errors:[...new Set(samples.filter(x=>!x.ok).map(x=>x.reason))]});
const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['start','end'].includes(k)).map(([k,x])=>[k,clean(x)])):v;
function normalize(source){const parsed=parseJsx(source);assert.equal(parsed.ok,true);let n=0;const nodes={};const textKeys={};const visit=(node,parent)=>{const id=`k${++n}`;const attrs=node.type==='element'?node.attributes:[];const authored=attrs.find(a=>a.name==='id')?.value.json;nodes[id]={...clean(node),lastEdit:1,...(node.type==='element'?{children:node.children.map(c=>visit(c,authored))}:{})};if(node.type==='text'&&parent)textKeys[parent]=id;return id;};return {document:{schemaVersion:1,roots:parsed.nodes.map(x=>visit(x,null)),nodes},textKeys};}
function restore(doc){const visit=id=>{const {lastEdit,...node}=doc.nodes[id];return {...node,start:0,end:0,...(node.type==='element'?{attributes:node.attributes.map(a=>({...a,start:0,end:0})),children:node.children.map(visit)}:{})};};return serializeJsx(doc.roots.map(visit));}
const makeSource=count=>'<section id="root" className="prose">'+Array.from({length:count},(_,i)=>`<p id="p${i}">agent_${i}_000000 ${createHash('sha256').update('a'+i).digest('hex')} ${createHash('sha256').update('b'+i).digest('hex')}</p>`).join('')+'</section>';
const marker=(i,round)=>`agent_${i}_${String(round).padStart(6,'0')}`;
const patchSql=`WITH updated AS (
 UPDATE bench_json AS b SET document=jsonb_set(document,ARRAY['nodes',$2],(document#>ARRAY['nodes',$2])||jsonb_build_object('value',$3::text,'lastEdit',version+1),false),version=version+1
 WHERE id=$1 AND owner_id=$7 AND $4::int<=version
 AND document#>>ARRAY['nodes',$2,'type']='text'
 AND (document#>>ARRAY['nodes',$2,'lastEdit'])::int<=$4
 AND document#>>ARRAY['nodes',$2,'value']=$5
 RETURNING version
), logged AS (
 INSERT INTO bench_json_edits SELECT $1,version,$2,$5,$3,$6 FROM updated RETURNING version
) SELECT version FROM logged`;
const results={base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:{engine:'native PostgreSQL',app:'actual applyEditScoped / publishJsx + replaceArtifactFor; direct service calls, no HTTP/CLI/network transport',validatedPrototype:'same restricted text operation, plus read + restore JSX + actual publishJsx before every update; verifies CSS unchanged; no source cache maintained; this validation commutes only for fixed topology and equal-length plain text workload',prototype:'single JSONB row; stable node IDs, same-row node revision and expected-text predicate, atomic edit log; plain-text changes only, fixed structure/classes; no per-edit full publish/stylesheet compile, snapshot archive, annotation/identity updates or full-document response',concurrency:'simultaneous burst from one shared base; four measured bursts after one warmup; default app pool max 10 connections; no caller retries',latency:'includes current full-replacement publish compilation; excludes initial snapshot read common to agents before a burst',sizes:'actual canonical JSX UTF-8 bytes and normalized JSONB UTF-8 bytes; no per-node rows',validation:'assert all accepted changes survive, versions/logs agree, rejected changes absent; prototype full publish validation after run'},app:[],storage:[],correctness:[]};
if(jsonbApp)results.method={
 engine:'native PostgreSQL; one artifact row',
 app:readFree?'read-free-prose writer on actual artifacts/artifact_versions/artifact_edits tables; actual editorScope ACL; existing full-source paths retained for fallback':'actual applyEditScoped, full publisher, source identity, archive/log/notification machinery; storage adapter lowers the validated delta to JSONB',
 admission:readFree?'fixed-source-width ASCII prose, certified plain HTML, local operation checks plus same-row SQL guards; no application document SELECT or full republish per operation':certified?'full application preparation once, certified operation guard at commit':'full application preparation and original head CAS/retry protocol',
 state:'JSONB AST + canonical JSX cache + capabilities/revisions in the SAME artifact row; SHA256, log, archive and notification updated atomically',
 workload:'16 closed-loop agents, 3 independent paragraph edits each; pool max 10; caller retries counted; initial creation/read excluded; no HTTP/network transport',
 checks:'log replay, every snapshot preimage, identities, final actual publish/CSS; AST/cache/hash on returned rows; certified modes additionally exercise permissions, conflicts, general fallback, coalescing and notifications',
 sizeNote:'jsonBytes is the older normalized fixture for historical comparability; actualStorage reports this adapter codec and canonical cache separately; capability/revision and CSS metadata are additional',
};
try{
results.settings=(await query("SELECT version(),current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes,current_setting('default_toast_compression') compression")).rows[0];
await pool.query('CREATE TABLE bench_json(id text PRIMARY KEY,owner_id text NOT NULL,version int NOT NULL,document jsonb NOT NULL); CREATE TABLE bench_json_edits(id text,version int,node_id text,old_text text,new_text text,operation_id text,PRIMARY KEY(id,version)); CREATE TABLE bench_storage(id int PRIMARY KEY,source text,document jsonb)');
const token=await mintToken('mxmx_test_single_row');const actor={tokenId:token.id,userId:null};
const quick=process.argv.includes('--quick');
const validatedOnly=process.argv.includes('--validated-only');
const sustainedOnly=process.argv.includes('--sustained-only');
for(const count of sustainedOnly?[]:quick?[32]:[100,1000,5000]){
 const published=await publishJsx({},makeSource(count));assert.ok(!(published instanceof Response));
 const original=published.source;const {document,textKeys}=normalize(original);
 for(const concurrency of quick?[4]:[1,4,16]){
  for(const mode of validatedOnly?['jsonb_validated_text_operation']:['whole_jsx_replace','current_jsx_edit','jsonb_text_operation']){
   const row=await createArtifact(token.id,null,{...published,title:'mxmx_test_benchmark',visibility:'unlisted'});
   const id=row.id;await query('INSERT INTO bench_json VALUES($1,$2,1,$3::jsonb)',[id,token.id,JSON.stringify(document)]);
   let currentText=original;let currentJson=document;let version=row.version;let editId=row.edit_id;
   const measured=[];let elapsed=0;let totalAccepted=0;
   for(let round=1;round<=5;round++){
    const baseText=currentText,baseVersion=version,baseEditId=editId;
    const tasks=Array.from({length:concurrency},(_,i)=>{const key=textKeys[`p${i}`];const before=currentJson.nodes[key].value;const old=before.match(/agent_\d+_\d{6}/)[0];const next=marker(i,round);return {i,key,before,old,next,after:before.replace(old,next)};});
    const started=performance.now();
    const batch=await Promise.all(tasks.map(task=>contexts.run({commitAttempts:0,casMisses:0},async()=>{
     const ctx=contexts.getStore();const t=performance.now();let ok=false,reason;
     try{
      if(mode.startsWith('jsonb_')){
       if(mode==='jsonb_validated_text_operation'){
        const observed=(await query('SELECT document FROM bench_json WHERE id=$1',[id])).rows[0].document;
        const candidate={...observed,nodes:{...observed.nodes,[task.key]:{...observed.nodes[task.key],value:task.after}}};
        const prepared=await publishJsx({},restore(candidate));assert.ok(!(prepared instanceof Response));
        assert.equal(prepared.meta.compiledCss,published.meta.compiledCss);
       }
       ctx.commitAttempts++;
       const r=await query(patchSql,[id,task.key,task.after,baseVersion,task.before,`${round}-${task.i}`,token.id]);ok=r.rows.length===1;
      }else if(mode==='current_jsx_edit'){
       const r=await applyEditScoped(actor,id,{baseEditId,change:{oldString:task.old,newString:task.next}});ok=r?.applied===true;reason=r instanceof Response?`http_${r.status}`:r?.reason;
      }else{
       const p=await publishJsx({},baseText.replace(task.old,task.next));assert.ok(!(p instanceof Response));
       const r=await replaceArtifactFor(actor,id,{...p,title:'mxmx_test_benchmark'},{expectedVersion:baseVersion});ok=!!r&&!(r instanceof Response)&&!r.conflict;reason=r instanceof Response?`http_${r.status}`:r?.reason??'version_conflict';
      }
     }catch(error){reason=`exception:${error.message}`;}
     return {...ctx,ok,reason:ok?undefined:reason??'node_conflict',ms:performance.now()-t,task};
    })));
    const took=performance.now()-started;if(round>1){elapsed+=took;measured.push(...batch);}
    totalAccepted+=batch.filter(x=>x.ok).length;
    if(mode.startsWith('jsonb_')){
     const head=(await query('SELECT * FROM bench_json WHERE id=$1',[id])).rows[0];version=head.version;currentJson=head.document;currentText=restore(currentJson);
     assert.equal((await query('SELECT count(*)::int n FROM bench_json_edits WHERE id=$1',[id])).rows[0].n,totalAccepted);
    }else{const head=await getArtifactById(id);version=head.version;editId=head.edit_id;currentText=head.source;currentJson=normalize(currentText).document;assert.equal((await query('SELECT count(*)::int n FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0].n,totalAccepted+1);}
    assert.equal(version,row.version+totalAccepted);
    for(const item of batch)assert.equal(currentText.includes(item.task.next),item.ok,`${mode}: wrong final result for ${item.task.next}`);
   }
   const validated=await publishJsx({},currentText);assert.ok(!(validated instanceof Response));assert.equal(validated.meta.compiledCss,published.meta.compiledCss);
   const entry={paragraphs:count,jsxBytes:Buffer.byteLength(original),jsonBytes:Buffer.byteLength(JSON.stringify(document)),concurrency,mode,...stats(measured,elapsed)};results.app.push(entry);console.error(JSON.stringify(entry));
  }
 }
}
// Hold the row lock while later operations start: forces EvalPlanQual to see a changed row.
const collision=normalize(makeSource(2));await query('INSERT INTO bench_json VALUES($1,$2,1,$3::jsonb)',['race',token.id,JSON.stringify(collision.document)]);
const locked=await pool.connect();await locked.query('BEGIN');
const key=collision.textKeys.p0,otherKey=collision.textKeys.p1;const old=collision.document.nodes[key].value;const other=collision.document.nodes[otherKey].value;
await locked.query(patchSql,['race',key,old+' A',1,old,'winner',token.id]);
const conflict=query(patchSql,['race',key,old+' B',1,old,'loser',token.id]);
const independent=query(patchSql,['race',otherKey,other+' C',1,other,'independent',token.id]);
for(let attempt=0;;attempt++){const waiting=(await query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'WITH updated AS (%'")).rows[0].n;if(waiting>=2)break;assert.ok(attempt<100,'both concurrent operations must wait on the held row lock');await new Promise(resolve=>setTimeout(resolve,10));}
await locked.query('COMMIT');locked.release();
assert.equal((await conflict).rows.length,0);assert.equal((await independent).rows.length,1);
assert.equal((await query('SELECT count(*)::int n FROM bench_json_edits WHERE id=$1',['race'])).rows[0].n,2);
results.correctness.push('same-node overlap rejected and independent stale edit accepted after another connection holds row lock');
// Storage-only baseline includes actual JSX TEXT replacement, full JSONB replacement, and JSONB path update.
for(const count of validatedOnly||sustainedOnly?[]:quick?[100]:[1000,10000,60000]){
 const source=makeSource(count);const {document,textKeys}=normalize(source);const json=JSON.stringify(document);const key=textKeys.p0;
 await query('INSERT INTO bench_storage VALUES(1,$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET source=$1,document=$2::jsonb',[source,json]);
 const variants=['A','B'].map(x=>source.replace('agent_0_000000',`agent_0_00000${x}`));
 const jsons=['A','B'].map(x=>JSON.stringify({...document,nodes:{...document.nodes,[key]:{...document.nodes[key],value:document.nodes[key].value.replace('agent_0_000000',`agent_0_00000${x}`)}}}));
 const arms={whole_jsx_text: i=>query('UPDATE bench_storage SET source=$1 WHERE id=1',[variants[i%2]]),whole_jsonb:i=>query('UPDATE bench_storage SET document=$1::jsonb WHERE id=1',[jsons[i%2]]),jsonb_path:i=>query("UPDATE bench_storage SET document=jsonb_set(document,ARRAY['nodes',$1,'value'],$2::jsonb,false) WHERE id=1",[key,JSON.stringify(document.nodes[key].value.replace('agent_0_000000',`agent_0_00000${i%2?'B':'A'}`))])};
 const times={};for(const [mode,fn] of Object.entries(arms)){const samples=[];for(let i=0;i<12;i++){const t=performance.now();await fn(i);if(i>=2)samples.push(performance.now()-t);}times[mode]={p50Ms:quantile(samples,.5),p95Ms:quantile(samples,.95)};}
 const entry={paragraphs:count,jsxBytes:Buffer.byteLength(source),jsonBytes:Buffer.byteLength(json),...times};results.storage.push(entry);console.error(JSON.stringify(entry));
}
// Closed-loop agents reread and retry conflicts; count completed logical edits, not rejected attempts.
if(sustainedOnly){
 const paragraphs=Number(process.argv.find(x=>x.startsWith('--paragraphs='))?.split('=')[1]??1000);
 assert.ok(Number.isSafeInteger(paragraphs)&&paragraphs>=16&&paragraphs<=10000);
 const published=await publishJsx({},makeSource(paragraphs));assert.ok(!(published instanceof Response));
 const initial=normalize(published.source);results.sustained=[];
 for(const mode of jsonbApp?['current_jsx_edit']:process.argv.includes('--app-only')?['whole_jsx_replace','current_jsx_edit']:['whole_jsx_replace','current_jsx_edit','jsonb_validated_text_operation','jsonb_text_operation']){
  const row=await createArtifact(token.id,null,{...published,title:'mxmx_test_sustained',visibility:'unlisted'});
  await query('INSERT INTO bench_json VALUES($1,$2,1,$3::jsonb)',[row.id,token.id,JSON.stringify(initial.document)]);
  readFreeQueries.total=0;readFreeQueries.selects=0;
  const t=performance.now();const samples=[];
  await Promise.all(Array.from({length:16},(_,i)=>contexts.run({commitAttempts:0,casMisses:0},async()=>{
   let ownText=initial.document.nodes[initial.textKeys[`p${i}`]].value,ownVersion=row.version;
   for(let op=1;op<=3;op++){
    const start=performance.now();const ctx=contexts.getStore();ctx.commitAttempts=0;ctx.casMisses=0;
    let retries=0;
    for(;;){
     assert.ok(retries<128,'bounded client retry budget');
     const next=marker(i,op),key=initial.textKeys[`p${i}`];let ok=false;
     if(readFree){
      const after=ownText.replace(/agent_\d+_\d{6}/,next);ctx.commitAttempts++;
      const changed=await readFreeWriter(actor,row.id,{path:['roots','0','children',String(i),'children','0','value'],oldText:ownText,newText:after,baseVersion:ownVersion,epoch:row.bench_epoch,sharingRevision:row.sharing_revision??0});
      ok=!!changed;if(ok){ownText=after;ownVersion=changed.version;}
     }else if(mode.startsWith('jsonb_')){
      const head=(await query('SELECT * FROM bench_json WHERE id=$1',[row.id])).rows[0];
      const before=head.document.nodes[key].value;const after=before.replace(/agent_\d+_\d{6}/,next);
      if(mode==='jsonb_validated_text_operation'){
       const candidate={...head.document,nodes:{...head.document.nodes,[key]:{...head.document.nodes[key],value:after}}};
       const validated=await publishJsx({},restore(candidate));assert.ok(!(validated instanceof Response));assert.equal(validated.meta.compiledCss,published.meta.compiledCss);
      }
      ctx.commitAttempts++;ok=(await query(patchSql,[row.id,key,after,head.version,before,`${i}-${op}`,token.id])).rows.length===1;
     }else{
      const head=await getArtifactById(row.id);const old=head.source.match(new RegExp(`agent_${i}_\\d{6}`))[0];
      if(mode==='current_jsx_edit'){const r=await applyEditScoped(actor,row.id,{baseEditId:head.edit_id,change:{oldString:old,newString:next}});assert.ok(!(r instanceof Response));ok=r?.applied===true;}
      else{const p=await publishJsx({},head.source.replace(old,next));assert.ok(!(p instanceof Response));const r=await replaceArtifactFor(actor,row.id,{...p,title:'mxmx_test_sustained'},{expectedVersion:head.version});assert.ok(!(r instanceof Response));ok=!!r&&!r.conflict;}
     }
     if(ok)break;retries++;
    }
    samples.push({...ctx,ok:true,ms:performance.now()-start,clientRetries:retries});
   }
  })));
  const elapsed=performance.now()-t;const result={mode:readFree?'jsonb_read_free_certified_prose':jsonbApp?(certified?'current_service_jsonb_certified_prose':'current_service_jsonb_ast'):mode,concurrency:16,jsxBytes:Buffer.byteLength(published.source),jsonBytes:Buffer.byteLength(JSON.stringify(initial.document)),...stats(samples,elapsed),clientRetries:samples.reduce((n,x)=>n+x.clientRetries,0),...(storageCounts?{storageCounts:{...storageCounts}}:{})};
  if(readFree){assert.equal(readFreeQueries.total,48);assert.equal(readFreeQueries.selects,0);result.serverQueries={...readFreeQueries};}
  const head=mode.startsWith('jsonb_')?(await query('SELECT * FROM bench_json WHERE id=$1',[row.id])).rows[0]:await getArtifactById(row.id);
  const final=mode.startsWith('jsonb_')?restore(head.document):head.source;assert.equal(head.version,49);for(let i=0;i<16;i++)assert.ok(final.includes(marker(i,3)));
  if(!mode.startsWith('jsonb_')){
   // Replay the actual app log and compare EVERY archived snapshot, not merely the head.
   const log=(await query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[row.id])).rows;
   assert.equal(log.length,49);let replay='';const versions=new Map();
   for(let i=0;i<log.length;i++){
    const edit=log[i];assert.equal(replay.slice(edit.splice_start,edit.splice_start+edit.removed.length),edit.removed,'log preimage mismatch');
    replay=replay.slice(0,edit.splice_start)+edit.inserted+replay.slice(edit.splice_start+edit.removed.length);versions.set(i+1,replay);
   }
   assert.equal(replay,final,'log must reconstruct full current document');
   const snapshots=(await query('SELECT version,source FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows;
   assert.ok(snapshots.length>0);for(const snapshot of snapshots)assert.equal(snapshot.source,versions.get(snapshot.version),'archive must contain its exact old version');
   if(mode==='current_jsx_edit')assert.equal(snapshots.length,1,'inline snapshot coalescing must not archive each concurrent writer');
   const identities=(await query('SELECT source_id,retired_version FROM artifact_source_ids WHERE artifact_id=$1',[row.id])).rows;
   assert.equal(identities.length,paragraphs+1);assert.ok(identities.every(x=>x.retired_version==null));
   const checked=await publishJsx({},final);assert.ok(!(checked instanceof Response));assert.equal(checked.source,final);assert.equal(checked.meta.compiledCss,head.meta.compiledCss);
   if(jsonbApp){
    const sizes=(await pool.query('SELECT octet_length(source::text) ast_json_bytes,octet_length(bench_canonical_source) canonical_cache_bytes FROM artifacts WHERE id=$1',[row.id])).rows[0];
    Object.assign(result,{actualStorage:sizes});
   }
   result.verified=['49 edit records replay exactly','every archive matches its old version','inline archives coalesce','node identity preserved','final publish and CSS agree'];
   if(jsonbApp&&certified){
    const changeText=async(who,current,i,oldMarker,nextMarker)=>{
     if(!readFree)return applyEditScoped(who,row.id,{baseEditId:current.edit_id,change:{oldString:oldMarker,newString:nextMarker}});
     const path=['roots','0','children',String(i),'children','0','value'];
     const oldText=path.reduce((value,key)=>value[key],encodeSource(current.source));
     const changed=await readFreeWriter(who,row.id,{path,oldText,newText:oldText.replace(oldMarker,nextMarker),baseVersion:current.version,epoch:current.bench_epoch,sharingRevision:current.sharing_revision??0});
     return changed?{applied:true,row:changed}:null;
    };
    const foreign=await mintToken('mxmx_test_foreign');
    assert.equal(await changeText({tokenId:foreign.id,userId:null},head,0,marker(0,3),marker(0,4)),null);
    const collision=await Promise.all(['A','B'].map(suffix=>changeText(actor,head,0,marker(0,3),marker(0,3).slice(0,-1)+suffix)));
    assert.equal(collision.filter(x=>x?.applied===true).length,1);
    const latest=await getArtifactById(row.id);
    const structural=await applyEditScoped(actor,row.id,{baseEditId:latest.edit_id,change:{oldString:'</section>',newString:'<p id="added">Inserted</p></section>'}});
    assert.ok(structural?.applied,'structural edits must retain full-validator fallback');
    assert.ok(storageCounts.general>0);
    const after=await getArtifactById(row.id);assert.ok(!(await publishJsx({},after.source) instanceof Response));
    if(readFree){
     assert.equal(await changeText(actor,latest,1,marker(1,3),marker(1,4)),null,'structural change must invalidate the old certificate');
     const path=['roots','0','children','1','children','0','value'];
     const oldText=path.reduce((value,key)=>value[key],encodeSource(after.source));
     const request={path,oldText,newText:oldText.replace(marker(1,3),marker(1,4)),baseVersion:after.version,epoch:after.bench_epoch,sharingRevision:after.sharing_revision??0};
     for(const newText of ['className="bg-red-500"','\0',oldText+'longer'])await assert.rejects(readFreeWriter(actor,row.id,{...request,newText}));
     for(const override of [{baseVersion:after.version+100},{sharingRevision:request.sharingRevision+1},{path:['roots','99','value']}])assert.equal(await readFreeWriter(actor,row.id,{...request,...override}),null);
     assert.equal((await getArtifactById(row.id)).version,after.version);
     for(const [column,key,old] of [['meta','cssCompileVersion',after.meta.cssCompileVersion],['bench_capabilities','__policy',after.bench_capabilities.__policy]]){
      await pool.query(`UPDATE artifacts SET ${column}=jsonb_set(${column},ARRAY[$2::text],'"stale"'::jsonb) WHERE id=$1`,[row.id,key]);
      assert.equal(await readFreeWriter(actor,row.id,request),null,'stale compiler or capability policy must refuse the fast path');
      await pool.query(`UPDATE artifacts SET ${column}=jsonb_set(${column},ARRAY[$2::text],to_jsonb($3::text)) WHERE id=$1`,[row.id,key,old]);
     }
     result.verified.push('read-free admission rejects scanner syntax, malformed text, width changes, unknown paths, future bases and stale sharing revisions');
     result.verified.push('stale CSS compiler and capability policies reject the fast path');
    }
    const refused=await applyEditScoped(actor,row.id,{baseEditId:after.edit_id,change:{oldString:'<p id="added">',newString:'<p id="added" onClick="alert(1)">'}});
    assert.ok(refused instanceof Response);assert.equal(refused.status,400);assert.equal((await getArtifactById(row.id)).version,after.version);
    await pool.query("UPDATE artifacts SET bench_archived_at=now()-interval '3 minutes' WHERE id=$1",[row.id]);
    const archivesBefore=(await query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0].n;
    const archivedRace=await Promise.all([1,2].map(i=>changeText(actor,after,i,marker(i,3),marker(i,4))));
    assert.ok(archivedRace.every(x=>x?.applied));
    const archivesAfter=(await query('SELECT version,source FROM artifact_versions WHERE artifact_id=$1 ORDER BY version',[row.id])).rows;
    assert.equal(archivesAfter.length,archivesBefore+1);assert.equal(archivesAfter.at(-1).version,after.version);assert.equal(archivesAfter.at(-1).source,after.source);
    result.verified.push('foreign writer rejected','same-node race has one winner','structural fallback accepted and revalidated','invalid attribute refused without a write','expired archive window preserves one exact preimage under concurrent edits');
    const notifications=[];const listener=await pool.connect();const channel='artifact_'+row.id.toLowerCase();assert.match(channel,/^[a-z0-9_]+$/);
    listener.on('notification',message=>{if(message.channel===channel)notifications.push(message.payload);});
    await listener.query(`LISTEN "${channel}"`);
    try{
     const current=await getArtifactById(row.id);const notified=await changeText(actor,current,3,marker(3,3),marker(3,4));assert.ok(notified?.applied);
     for(let i=0;!notifications.includes(notified.row.edit_id);i++){assert.ok(i<100,'commit must notify the live channel');await new Promise(resolve=>setTimeout(resolve,10));}
     result.verified.push('committed edit delivered on the existing live notification channel');
    }finally{await listener.query(`UNLISTEN "${channel}"`);listener.release();}
    if(readFree){
     const base=await getArtifactById(row.id);let current=base,previous=marker(6,3);
     for(let i=10;i<33;i++){const next=marker(6,i);const changed=await changeText(actor,current,6,previous,next);assert.ok(changed?.applied);current=changed.row;previous=next;}
     assert.ok((await changeText(actor,base,7,marker(7,3),marker(7,4)))?.applied,'independent edit must survive a 23-version lag');
     const aba=await getArtifactById(row.id);const first=await changeText(actor,aba,8,marker(8,3),marker(8,4));assert.ok(first?.applied);
     const second=await changeText(actor,first.row,8,marker(8,4),marker(8,3));assert.ok(second?.applied);
     assert.equal(await changeText(actor,aba,8,marker(8,3),marker(8,5)),null,'ABA cannot revive an old operation');
     const locked=await pool.connect();let pending;
     try{
      const before=await getArtifactById(row.id);await locked.query('BEGIN');
      await locked.query('UPDATE artifacts SET bench_epoch=bench_epoch+1 WHERE id=$1',[row.id]);
      pending=changeText(actor,before,9,marker(9,3),marker(9,4));
      for(let i=0;;i++){
       const waiting=(await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'WITH updated AS (%'")).rows[0].n;
       if(waiting)break;assert.ok(i<100,'read-free operation must wait on held row lock');await new Promise(resolve=>setTimeout(resolve,10));
      }
      await locked.query('COMMIT');assert.equal(await pending,null);
     }finally{await locked.query('ROLLBACK');locked.release();if(pending)await pending;}
     result.verified.push('actual read-free writer accepts 23-version lag, rejects ABA, and rechecks epoch after a forced row-lock wait');
     await pool.query("UPDATE artifacts SET bench_archived_at=now()-interval '3 minutes' WHERE id=$1",[row.id]);
     const before=await getArtifactById(row.id);
     const replacement=await publishJsx({},before.source.replace('id="p10"','id="p10" className="font-bold"'));assert.ok(!(replacement instanceof Response));
     const replaced=await replaceArtifactFor(actor,row.id,{...replacement,title:before.title},{expectedVersion:before.version});assert.ok(replaced&&!(replaced instanceof Response)&&!replaced.conflict);
     assert.equal(await changeText(actor,before,12,marker(12,3),marker(12,4)),null,'whole replacement invalidates old paths');
     const count=(await query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0].n;
     const subsequent=await changeText(actor,replaced,12,marker(12,3),marker(12,4));assert.ok(subsequent?.applied);
     assert.equal((await query('SELECT count(*)::int n FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0].n,count,'a full replacement must refresh the archive coalescing marker');
     const restored=await revertArtifactFor(actor,row.id,before.version,{expectedVersion:subsequent.row.version});assert.ok(restored&&'source'in restored);
     assert.equal(restored.source,before.source);assert.equal(restored.version,subsequent.row.version+1);
     assert.ok((await changeText(actor,restored,13,marker(13,3),marker(13,4)))?.applied);
     result.verified.push('whole replacement and restore preserve validity, invalidate old certificates and keep history coalescing');
    }
   }
  }
  results.sustained.push(result);console.error(JSON.stringify(result));
 }
}
const output=readFree?'/tmp/artifact-jsonb-read-free-results.json':jsonbApp?(certified?'/tmp/artifact-jsonb-certified-app-results.json':'/tmp/artifact-jsonb-app-results.json'):sustainedOnly?'/tmp/artifact-single-row-sustained-results.json':validatedOnly?'/tmp/artifact-single-row-validated-results.json':'/tmp/artifact-single-row-results.json';
writeFileSync(output,JSON.stringify(results,null,2));
console.log(`Saved ${output}`);
}finally{await resetDb();}
