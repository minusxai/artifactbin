/** Equal publication-kernel comparison. Deliberately distinct from the existing app service
 * benchmark: both kernels perform owner check, validation admission, size check, coalesced
 * preimage archive, per-edit log, notification and full source+parsed-metadata response.
 * Existing source-ID ledger and annotation mutations are no-ops in this workload. No HTTP.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {publishJsx} from '../../services/app/lib/story/jsx-tier.ts';
import {finalizeArtifactMetadata} from '../../services/app/lib/story/parsed-artifact-metadata.ts';
import {createKernel,renderState,planStructure,planProse} from './semantic-kernel.mjs';
const db=await getDb();assert.equal(db.raw().kind,'pg');const pool=db.raw().pool;
const owner='mxmx_test_semantic';let referenceLoads=0;const context={loadRef:async id=>{referenceLoads++;return id==='external'?{id,format:'image'}:null;}};
const modes=['whole_text_replace','text_read_validate_retry','jsonb_semantic_operations'];
const marker=(i,round)=>`agent_${i}_${String(round).padStart(6,'0')}`;
const value=(i,round)=>`${marker(i,round)} ${createHash('sha256').update('a'+i).digest('hex')} ${createHash('sha256').update('b'+i).digest('hex')}${round?' 🎉 '+('variable length '.repeat(round)):''}`;
const sourceFor=n=>'<section id="root" className="prose">'+Array.from({length:n},(_,i)=>`<p id="p${i}">${value(i,0)}</p>`).join('')+'</section>';
const percentile=(xs,p)=>{xs=[...xs].sort((a,b)=>a-b);return xs[Math.ceil(xs.length*p)-1];};
const results={method:'native PG; equal publication kernels, NOT a substitute for the application-service benchmark',responsibilities:['owner check on locked row','complete publisher on semantic context; certified inert prose operation otherwise','2 MB source byte cap','120s coalesced preimage archive','one log per accepted edit','pg_notify','full JSX serialization and parsedArtifact metadata in every response'],limits:['No HTTP','No source-ID or annotation changes in measured workloads','Existing app service benchmark remains separately labelled','General semantic edits use a conservative shared epoch and can conflict even on separate nodes'],runs:[]};
const countArg=Number(process.argv.find(x=>x.startsWith('--paragraphs='))?.split('=')[1]??1000);
const repeats=Number(process.argv.find(x=>x.startsWith('--repeats='))?.split('=')[1]??3);
const concurrency=Number(process.argv.find(x=>x.startsWith('--agents='))?.split('=')[1]??16);
const rounds=Number(process.argv.find(x=>x.startsWith('--rounds='))?.split('=')[1]??3);
const mixed=process.argv.includes('--mixed'),contextual=process.argv.includes('--contextual');
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9)??'/tmp/artifact-semantic-benchmark.json';
let counts={queries:0,selects:0},seq=0;
const counted={query:async(sql,params)=>{counts.queries++;if(/^SELECT/i.test(sql.trim()))counts.selects++;return pool.query(sql,params);}};
try{
 results.settings=(await pool.query("SELECT version(),current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes")).rows[0];
 const kernel=await createKernel(counted,context,{actorId:owner});
 await pool.query(`CREATE TABLE semantic_text_documents(id text PRIMARY KEY,owner_id text,version int,source text,meta jsonb,archived_at timestamptz);
 CREATE TABLE semantic_text_history(id text,version int,source text,meta jsonb,PRIMARY KEY(id,version));
 CREATE TABLE semantic_text_edits(id text,version int,operation jsonb,PRIMARY KEY(id,version));`);
 const readText=async id=>(await counted.query('SELECT * FROM semantic_text_documents WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];
 const respond=row=>{
  const source=row.source??renderState(row.document),meta=finalizeArtifactMetadata('markup',source,row.meta);
  // Full result assembly/serialization is timed in BOTH modes, including JSONB-to-JSX.
  JSON.stringify({version:row.version,source,meta});return {...row,source};
 };
 for(let run=0;run<repeats;run++)for(const mode of [...modes.slice(run%modes.length),...modes.slice(0,run%modes.length)]){
  const id='bench'+(++seq),source=sourceFor(countArg)+(contextual?'<img id="asset" src="ref:external" />':'');let initial;
  if(mode==='jsonb_semantic_operations')initial=await kernel.create(id,source);
  else{
   const published=await publishJsx({},source,context);assert.ok(!(published instanceof Response));
   initial=(await counted.query('INSERT INTO semantic_text_documents VALUES($1,$2,1,$3,$4::jsonb,NULL) RETURNING *',[id,owner,published.source,JSON.stringify(finalizeArtifactMetadata('markup',published.source,published.meta))])).rows[0];
  }
  assert.ok(!(initial instanceof Response));
  const sourceBytes=Buffer.byteLength(source),samples=[];counts={queries:0,selects:0};referenceLoads=0;
  const started=performance.now();
  await Promise.all(Array.from({length:concurrency},(_,i)=>(async()=>{
   let snapshot=initial;
   for(let round=1;round<=rounds;round++){
    const start=performance.now();let retries=0;const structural=mixed&&i%4===3;
    for(;;){
     assert.ok(retries<256,'bounded retry count');let row;
     if(mode==='jsonb_semantic_operations'){
      if(structural){
       const plan=await planStructure(snapshot,[{kind:'setAttribute',path:['roots','0','children',String(i)],name:'className',value:`p-${round}`}],context);assert.ok(!(plan instanceof Response));
       row=await kernel.commit(id,plan);
      }else{
       const slot=snapshot.document.tree.roots[0].children[i].children[0].slot;
       const input={slot,oldText:snapshot.document.prose[slot].value,newText:value(i,round)};
       if(snapshot.context_required){const plan=await planProse(snapshot,input,context);assert.ok(!(plan instanceof Response));row=await kernel.preparedText(id,plan);}
       else row=await kernel.text(id,{base:snapshot.version,epoch:snapshot.epoch,...input});
      }
      if(!row){retries++;snapshot=await kernel.read(id);continue;}
     }else{
      if(mode==='text_read_validate_retry'||retries)snapshot=await readText(id);
      const p=new RegExp(`(<p id="p${i}"(?: className="[^"]*")?>)([^<]*)(</p>)`);
      const match=snapshot.source.match(p);assert.ok(match);
      const before=structural?match[1]:match[2],after=structural?`<p id="p${i}" className="p-${round}">`:value(i,round);
      const candidate=snapshot.source.replace(before,after),published=await publishJsx({},candidate,context);assert.ok(!(published instanceof Response));
      const metadata=finalizeArtifactMetadata('markup',published.source,published.meta);
      row=(await counted.query(`WITH updated AS (
       UPDATE semantic_text_documents SET source=$4,meta=$5::jsonb,version=version+1,
        archived_at=CASE WHEN archived_at IS NULL OR archived_at<=now()-interval '120 seconds' THEN now() ELSE archived_at END
       WHERE id=$1 AND owner_id=$2 AND version=$3 AND octet_length($4::text)<=2000000
       RETURNING WITH (OLD AS o,NEW AS n) n.*,o.source old_source,o.meta old_meta,o.version old_version,o.archived_at old_archived_at
      ), archived AS (INSERT INTO semantic_text_history SELECT id,old_version,old_source,old_meta FROM updated WHERE old_archived_at IS NULL OR old_archived_at<=now()-interval '120 seconds'), logged AS (
       INSERT INTO semantic_text_edits SELECT id,version,$6::jsonb FROM updated RETURNING pg_notify('semantic_'||id,version::text)
      ) SELECT id,owner_id,version,source,meta,archived_at FROM updated WHERE EXISTS(SELECT 1 FROM logged)`,[id,owner,snapshot.version,published.source,JSON.stringify(metadata),JSON.stringify({before,after})])).rows[0];
      if(!row){retries++;continue;}
     }
     // TEXT metadata is already built before commit; JSONB builds it on the returned AST.
     if(mode==='jsonb_semantic_operations')snapshot=respond(row);else{JSON.stringify({version:row.version,source:row.source,meta:row.meta});snapshot=row;}
     break;
    }
    samples.push({ms:performance.now()-start,retries,kind:structural?'structural':'prose'});
   }
  })()));
  const elapsed=performance.now()-started,observedCounts={...counts,referenceLoads};
  const final=mode==='jsonb_semantic_operations'?await kernel.read(id):await readText(id),finalSource=final.source??renderState(final.document);
  for(let i=0;i<concurrency;i++)if(mixed&&i%4===3)assert.ok(finalSource.includes(`<p id="p${i}" className="p-${rounds}">`));else assert.ok(finalSource.includes(value(i,rounds)));
  const accepted=await publishJsx({},finalSource,context);assert.ok(!(accepted instanceof Response));assert.equal(accepted.source,finalSource);
  assert.equal(final.version,1+concurrency*rounds);
  const prefix=mode==='jsonb_semantic_operations'?'semantic':'semantic_text';
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${prefix}_edits WHERE id=$1`,[id])).rows[0].n,concurrency*rounds);
  assert.ok((await pool.query(`SELECT count(*)::int n FROM ${prefix}_history WHERE id=$1`,[id])).rows[0].n>=1);
  const entry={run:run+1,mode,workload:mixed?'75% prose, 25% class changes':contextual?'Unicode prose with reference revalidation':'variable-length Unicode prose',sourceBytes,concurrency,accepted:samples.length,elapsedMs:elapsed,acceptedPerSecond:samples.length/elapsed*1000,p50Ms:percentile(samples.map(x=>x.ms),.5),p95Ms:percentile(samples.map(x=>x.ms),.95),retries:samples.reduce((sum,x)=>sum+x.retries,0),...observedCounts};
  results.runs.push(entry);console.error(JSON.stringify(entry));writeFileSync(output,JSON.stringify(results,null,2));
 }
}finally{await resetDb();}
