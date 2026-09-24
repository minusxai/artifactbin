/** CI-only proof of the actual document service across independent PostgreSQL connections. */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {DocumentEdit,RichDocument} from '../services/contracts/src/document';
import {getDb} from '../services/app/lib/db';
import {editDocument} from '../services/app/lib/document/store';

const db=await getDb();
const actor={tokenId:'mdx-proof-owner',userId:null};
const document:RichDocument={schemaVersion:1,rootId:'root',nodes:{root:{type:'document',props:{},children:['a','b']},a:{type:'paragraph',props:{},content:[]},b:{type:'paragraph',props:{},content:[]}}};
let serial=0;
const request=(nodeId:string,baseVersion=1):DocumentEdit=>({baseVersion,operationId:`proof-${++serial}`,changedIds:[nodeId],ancestorIds:['root'],operations:[{kind:'set',nodeId,path:['props','className'],value:`edit-${serial}`}]});
async function seed(){await db.query("DELETE FROM artifacts WHERE id='mdxpg1'");await db.query("INSERT INTO artifacts(id,token_id,title,content,document) VALUES ('mdxpg1',$1,'MDX race proof','',$2::jsonb)",[actor.tokenId,JSON.stringify(document)]);}
/** Hold the target row until every edit has actually reached its blocking UPDATE. */
async function race(edits:DocumentEdit[],trash=false){
 let unlock!:()=>void,ready!:()=>void;const readyPromise=new Promise<void>(resolve=>{ready=resolve;}),release=new Promise<void>(resolve=>{unlock=resolve;});
 const lock=db.transaction(async tx=>{await tx.query(trash?"UPDATE artifacts SET deleted_at=now() WHERE id='mdxpg1'":"SELECT id FROM artifacts WHERE id='mdxpg1' FOR UPDATE");ready();await release;});
 await readyPromise;
 const pending=edits.map(edit=>editDocument(actor,'mdxpg1',edit));
 try{
  const deadline=Date.now()+5000;
  for(;;){
   const blocked=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE 'WITH observed AS MATERIALIZED%'")).rows[0]!.count;
   if(blocked>=edits.length)break;
   assert.ok(Date.now()<deadline,'All service edits must reach the row lock on independent connections');await delay(10);
  }
 }finally{unlock();await lock;}
 return Promise.all(pending);
}
try{
 assert.equal(db.raw().kind,'pg','Never substitute PGLite for concurrency evidence');
 await seed();const independent=await race([request('a'),request('b')]);assert.ok(independent.every(result=>result.updated));
 assert.equal((await db.query<{version:number}>("SELECT version FROM artifacts WHERE id='mdxpg1'")).rows[0]!.version,3);
 await seed();const overlap=await race([request('a'),request('a')]);assert.equal(overlap.filter(result=>result.updated).length,1);assert.ok(overlap.some(result=>!result.updated&&result.reason==='conflict'));
 await seed();const edit=request('a');const duplicate=await race([edit,edit]);assert.equal(duplicate.filter(result=>result.updated).length,1);assert.ok(duplicate.some(result=>!result.updated&&result.reason==='duplicate'));
 await seed();const trashed=await race([request('a')],true);assert.deepEqual(trashed,[{updated:false,reason:'not_found'}]);
 assert.equal((await db.query<{count:number}>("SELECT count(*)::int AS count FROM artifact_versions WHERE artifact_id='mdxpg1'")).rows[0]!.count,0);
 console.log(JSON.stringify({passed:true,independentEdits:true,overlapRefused:true,duplicateDeduplicated:true,trashRaceRefused:true}));
}finally{await db.query("DELETE FROM artifacts WHERE id='mdxpg1'");await db.close();}
