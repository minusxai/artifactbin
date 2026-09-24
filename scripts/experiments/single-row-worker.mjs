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
import {createArtifact,applyEditScoped,replaceArtifactFor,getArtifactById} from '../../services/app/lib/artifacts.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';

const db=await getDb();assert.equal(db.raw().kind,'pg');
const pool=db.raw().pool;
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
 const published=await publishJsx({},makeSource(1000));assert.ok(!(published instanceof Response));
 const initial=normalize(published.source);results.sustained=[];
 for(const mode of ['whole_jsx_replace','current_jsx_edit','jsonb_validated_text_operation','jsonb_text_operation']){
  const row=await createArtifact(token.id,null,{...published,title:'mxmx_test_sustained',visibility:'unlisted'});
  await query('INSERT INTO bench_json VALUES($1,$2,1,$3::jsonb)',[row.id,token.id,JSON.stringify(initial.document)]);
  const t=performance.now();const samples=[];
  await Promise.all(Array.from({length:16},(_,i)=>contexts.run({commitAttempts:0,casMisses:0},async()=>{
   for(let op=1;op<=3;op++){
    const start=performance.now();const ctx=contexts.getStore();ctx.commitAttempts=0;ctx.casMisses=0;
    let retries=0;
    for(;;){
     assert.ok(retries<128,'bounded client retry budget');
     const next=marker(i,op),key=initial.textKeys[`p${i}`];let ok=false;
     if(mode.startsWith('jsonb_')){
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
  const elapsed=performance.now()-t;const result={mode,concurrency:16,jsxBytes:Buffer.byteLength(published.source),jsonBytes:Buffer.byteLength(JSON.stringify(initial.document)),...stats(samples,elapsed),clientRetries:samples.reduce((n,x)=>n+x.clientRetries,0)};
  const head=mode.startsWith('jsonb_')?(await query('SELECT * FROM bench_json WHERE id=$1',[row.id])).rows[0]:await getArtifactById(row.id);
  const final=mode.startsWith('jsonb_')?restore(head.document):head.source;assert.equal(head.version,49);for(let i=0;i<16;i++)assert.ok(final.includes(marker(i,3)));
  results.sustained.push(result);console.error(JSON.stringify(result));
 }
}
const output=sustainedOnly?'/tmp/artifact-single-row-sustained-results.json':validatedOnly?'/tmp/artifact-single-row-validated-results.json':'/tmp/artifact-single-row-results.json';
writeFileSync(output,JSON.stringify(results,null,2));
console.log(`Saved ${output}`);
}finally{await resetDb();}
