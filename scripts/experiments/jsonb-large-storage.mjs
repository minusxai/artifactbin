/** Storage-only scaling beyond the application's 2 MB publication cap. This is
 * NOT the validated application-service benchmark. Both columns hold one logical
 * document; compare a complete TEXT assignment with a single JSONB leaf update.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {getDb,resetDb} from '../../services/app/lib/db.ts';
import {encodeDocument,decodeDocument} from '../../services/app/lib/story/document-codec.ts';
const db=await getDb();assert.equal(db.raw().kind,'pg');const results=[];
try{
 await db.query('CREATE TABLE scaling_probe(id int primary key,source text,document jsonb)');
 for(const target of [100_000,1_000_000,10_000_000]){
  const payload=randomBytes(Math.ceil(target/2)).toString('hex').slice(0,target),before=`<section><p>Old</p><p>${payload}</p></section>`,after=before.replace('>Old<','>New<');
  await db.query('INSERT INTO scaling_probe VALUES($1,$2,$3::jsonb)',[target,before,JSON.stringify(encodeDocument(before))]);
  const entry={sourceBytes:Buffer.byteLength(before),scope:'native PostgreSQL storage only; high-entropy payload; 3 serial updates per mode; no publisher or response serialization'};
  for(const mode of ['wholeText','jsonbLeaf']){
   const samples=[];
   for(let i=0;i<3;i++){
    const start=performance.now();
    if(mode==='wholeText')await db.query('UPDATE scaling_probe SET source=$2 WHERE id=$1',[target,i%2?before:after]);
    else await db.query("UPDATE scaling_probe SET document=jsonb_set(document,'{roots,0,children,0,children,0,value}',to_jsonb($2::text),false) WHERE id=$1",[target,i%2?'Old':'New']);
    samples.push(performance.now()-start);
   }
   entry[mode]={medianMs:[...samples].sort((a,b)=>a-b)[1],samples};
  }
  const row=(await db.query('SELECT source,document FROM scaling_probe WHERE id=$1',[target])).rows[0];assert.equal(row.source,after);assert.equal(decodeDocument(row.document),after);
  results.push(entry);console.log(JSON.stringify(entry));
 }
 writeFileSync('/tmp/jsonb-large-storage-results.json',JSON.stringify(results,null,2));
}finally{await resetDb();}
