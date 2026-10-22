import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresStreamArchive} from '../src/migration/stream-postgres.ts';
import type {SqlReader} from '../src/migration/contracts.ts';
test('stream archive bounds batches and preserves JSON values and global ordinals',async()=>{
 const batches:any[][]=[];const starts:number[]=[];const commands:string[]=[];
 const db={async query(sql:string,values?:unknown[]){commands.push(sql);if(sql.includes('jsonb_array_elements')){batches.push(JSON.parse(String(values?.[3])));starts.push(Number(values?.[2]));}return {rows:[]};}} as SqlReader;
 const archive=new PostgresStreamArchive(db,'fixture',true,{batchRows:2,batchBytes:10000});
 async function* rows(){for(let i=0;i<5;i++)yield {i,text:'quote " unicode λ',nested:{a:null}};}
 await archive.archivePart('fixture',{table:'records',path:'part',rows:5,bytes:1,sha256:'digest'},rows());
 assert.deepEqual(batches.map(b=>b.length),[2,2,1]);assert.deepEqual(batches.flat().map(r=>r.i),[0,1,2,3,4]);
 assert.deepEqual(starts,[0,2,4]);assert.equal(commands.at(-1),'COMMIT');
});
test('stream archive rolls back row mismatch and source interruption',async()=>{
 const commands:string[]=[];const db={async query(sql:string){commands.push(sql);return {rows:[]};}} as SqlReader;
 const archive=new PostgresStreamArchive(db,'fixture',true,{batchRows:1});
 async function* rows(){yield {x:1};throw Error('interrupted');}
 await assert.rejects(archive.archivePart('fixture',{table:'records',path:'part',rows:2,bytes:1,sha256:'digest'},rows()),/interrupted/);
 assert.equal(commands.at(-1),'ROLLBACK');assert.ok(!commands.some(s=>s.includes('INSERT INTO')&&s.includes('stream_parts')));
});

test('wire byte bound flushes before a multi-row batch becomes oversized',async()=>{
 const sizes:number[]=[];const db={async query(sql:string,values?:unknown[]){if(sql.includes('jsonb_array_elements'))sizes.push(Buffer.byteLength(String(values?.[3])));return {rows:[]};}} as SqlReader;
 const archive=new PostgresStreamArchive(db,'fixture',true,{batchRows:100,batchBytes:40});
 async function* rows(){yield {text:'λ'.repeat(8)};yield {text:'λ'.repeat(8)};yield {text:'x'.repeat(100)};}
 await archive.archivePart('fixture',{table:'records',path:'part',rows:3,bytes:1,sha256:'digest'},rows());
 assert.equal(sizes.length,3);assert.ok(sizes[0]!<=40&&sizes[1]!<=40&&sizes[2]!>40);
});
