import {currentStoryCss} from '../../services/app/lib/data/story/story-css.server.ts';
/** Application-service comparison. Run this identical worker in the TEXT baseline
 * checkout and the JSONB checkout. Each mode validates, archives, logs, returns
 * full source/metadata, and verifies no accepted edit is lost. No HTTP measured.
 */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {createArtifact,getArtifactById,getVersionFor,applyEditScoped,replaceArtifactFor} from '../../services/app/lib/artifacts.ts';
import {mintToken} from '../../services/app/lib/tokens.ts';
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const workload=arg('workload','prose');assert.ok(['prose','mixed'].includes(workload));
const mode=arg('mode','jsonb'),paragraphs=Number(arg('paragraphs','1000')),rounds=Number(arg('rounds','3')),concurrency=Number(arg('concurrency','16')),repeats=Number(arg('repeats','1')),output=arg('output',`/tmp/jsonb-benchmark-${mode}-${paragraphs}.json`);
assert.ok(['jsonb','text','whole','trusted'].includes(mode));
const trusted=mode==='trusted'?await import('../../services/app/lib/story/document-update-client.ts'):null;
const graphModel=mode==='trusted'?await import('../../services/app/lib/story/document-graph-patch.ts'):null;
const graphCodec=mode==='trusted'?await import('../../services/app/lib/story/document-graph.ts'):null;
const db=await getDb();assert.equal(db.raw().kind,'pg');
let statementCounts={},statementMs={},explained=false;const query=db.query.bind(db);
db.query=async(sql,params)=>{const label=(sql.includes('WITH RECURSIVE observed')||sql.includes('WITH observed')||sql.includes('WITH reference_witnesses'))?'atomic':sql.includes('WITH updated')?'general':sql.trim().split(/\s+/)[0];const start=performance.now();
 if(process.argv.includes('--explain')&&label==='atomic'&&!explained){explained=true;const c=await db.raw().pool.connect();try{await c.query('BEGIN');const plan=await c.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params);writeFileSync('/tmp/jsonb-operation-plan.json',JSON.stringify(plan.rows,null,2));await c.query('ROLLBACK');}finally{c.release();}}
 const result=await query(sql,params);statementCounts[label]=(statementCounts[label]??0)+1;statementMs[label]=(statementMs[label]??0)+performance.now()-start;return result;};
const value=(i,r)=>`agent_${i}_${String(r).padStart(6,'0')} ${createHash('sha256').update('a'+i).digest('hex')} ${createHash('sha256').update('b'+i).digest('hex')}${r?' 🎉 '+('variable length '.repeat(r)):''}`;
const paragraph=(i,r)=>`<p id="p${i}"${workload==='mixed'&&r?` title="agent_${i}_round_${r}"`:''}>${value(i,r)}</p>`;
const results={mode,workload,paragraphs,concurrency,rounds,repeats,scope:'three synchronized rounds of concurrent application-service writes; includes server validation, history, logs and complete protocol serialization; client JSONB preparation is measured separately before each batch; excludes HTTP; query counters exclude transaction handles',runs:[]};
try{
 const token=await mintToken('mxmx_test_jsonb_benchmark'),actor={tokenId:token.id,userId:null};
 results.postgres=(await db.query("SELECT version(),current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes")).rows[0];
 for(let run=0;run<repeats;run++){
  const published=await publishJsx({},'<section id="root" className="prose">'+Array.from({length:paragraphs},(_,i)=>paragraph(i,0)).join('')+'</section>');assert.ok(!(published instanceof Response));
  const initial=await createArtifact(token.id,null,{...published,title:'mxmx_test_benchmark',visibility:'unlisted'});
  statementCounts={};statementMs={};const samples=[];let elapsedMs=0,clientPreparationMs=0;
  const heads=Array.from({length:concurrency},()=>initial);
  for(let round=1;round<=rounds;round++){
   const preparedAt=performance.now();
   const prepared=mode==='trusted'?heads.map((head,i)=>trusted.prepareClientDocumentUpdate(head,{operations:[{kind:'setText',path:[0,i,0],value:value(i,round)},...(workload==='mixed'?[{kind:'setAttribute',path:[0,i],name:'title',value:`agent_${i}_round_${round}`}]:[])]})):null;
   clientPreparationMs+=performance.now()-preparedAt;
   const batchStart=performance.now();
   await Promise.all(heads.map((observed,i)=>(async()=>{
    let head=observed;const started=performance.now();let retries=0;
    for(;;){assert.ok(retries<128);let row;
     if(mode==='trusted'){
      const result=await applyEditScoped(actor,initial.id,{baseEditId:head.edit_id,documentUpdate:prepared[i]});if(result?.applied)row=result.row;
     }else if(mode==='whole'){
      const candidate=await publishJsx({},head.source.replace(paragraph(i,round-1),paragraph(i,round)));assert.ok(!(candidate instanceof Response));
      const result=await replaceArtifactFor(actor,initial.id,{...candidate,title:initial.title},{expectedVersion:head.version});assert.ok(!(result instanceof Response));if(result&&!result.conflict)row=result;
     }else{
      const change=mode==='jsonb'&&workload==='mixed'?{operations:[{kind:'setText',path:[0,i,0],value:value(i,round)},{kind:'setAttribute',path:[0,i],name:'title',value:`agent_${i}_round_${round}`}]}:mode==='jsonb'?{text:{path:['roots','0','children',String(i),'children','0','value'],oldText:value(i,round-1),newText:value(i,round)}}:{change:{oldString:workload==='mixed'?paragraph(i,round-1):value(i,round-1),newString:workload==='mixed'?paragraph(i,round):value(i,round)}};
      const result=await applyEditScoped(actor,initial.id,{baseEditId:head.edit_id,...change});assert.ok(!(result instanceof Response),result instanceof Response?await result.text():'');if(result?.applied)row=result.row;
     }
     if(row){JSON.stringify({id:row.id,version:row.version,edit_id:row.edit_id,source:row.source,document:row.document,meta:row.meta,shares:row.shares});heads[i]=row;break;}
     retries++;assert.notEqual(mode,'trusted','Independent prepared operations must not need retries');head=await getArtifactById(initial.id);
    }
    samples.push({ms:performance.now()-started,retries});
   })()));
   elapsedMs+=performance.now()-batchStart;
  }
  const counts={...statementCounts},times={...statementMs};const head=await getArtifactById(initial.id);assert.equal(head.version,1+rounds*concurrency);
  for(let i=0;i<concurrency;i++)assert.ok(head.source.includes(value(i,rounds)));
  const logs=(await db.query('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq',[initial.id])).rows;let source='',graph=initial.document;const versions=new Map();
  for(const e of logs){if(e.document_state?.kind==='operations'){graph=graphModel.applyGraphPatch(graph,versions.size,e.document_state.forward);assert.ok(graph);source=graphCodec.graphSource(graph);versions.set(versions.size+1,source);continue;}assert.equal(source.slice(e.splice_start,e.splice_start+e.removed.length),e.removed);source=source.slice(0,e.splice_start)+e.inserted+source.slice(e.splice_start+e.removed.length);versions.set(versions.size+1,source);}
  assert.equal(source,head.source);
  for(const v of (await db.query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[initial.id])).rows)assert.equal((await getVersionFor(actor,initial.id,v.version)).source,versions.get(v.version));
  const validated=await publishJsx({},head.source);assert.ok(!(validated instanceof Response));assert.equal(validated.source,head.source);assert.equal(validated.meta.compiledCss,await currentStoryCss(head.meta,head.source));
  const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b),entry={run:run+1,sourceBytes:Buffer.byteLength(published.source),accepted:samples.length,elapsedMs,clientPreparationMs,editsPerSecond:samples.length/elapsedMs*1000,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],directQueryCounts:counts,directQueryMs:times,clientRetries:samples.reduce((n,s)=>n+s.retries,0)};
  results.runs.push(entry);writeFileSync(output,JSON.stringify(results,null,2));console.log(JSON.stringify(entry));
 }
}finally{await resetDb();}
