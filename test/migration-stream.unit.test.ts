import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportLegacyStream,readPartRows,readStreamManifest} from '../src/migration/stream.ts';
test('stream export bounds cursor fetches and parts, preserves every row and verifies digests',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'migration-stream-'));let fetch=0;const queries:string[]=[];
 try{const manifest=await exportLegacyStream({query:async(sql)=>{queries.push(sql);if(sql.startsWith('FETCH')){fetch++;return {rows:fetch===1?[{id:'a',value:'x'.repeat(200)},{id:'b',value:'y'.repeat(200)}]:[]}}return {rows:[]}}},{schema:'legacy',sourceNamespace:'fixture',directory,batchRows:2,partBytes:100,now:()=>new Date(0)},['artifacts']);
 assert.ok(queries.includes('FETCH FORWARD 2 FROM migration_export'));assert.equal(manifest.parts.length,2);assert.equal(manifest.parts.reduce((n,p)=>n+p.rows,0),2);
 const parsed=await readStreamManifest(directory);const rows=[];for(const part of parsed.parts)for await(const row of readPartRows(directory,part))rows.push(row);assert.equal(rows.length,2);
 assert.equal((await readFile(join(directory,'manifest.json'),'utf8')).includes('value'),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('aborted snapshots roll back and leave no completed manifest',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'migration-stream-'));const controller=new AbortController();const queries:string[]=[];
 try{await assert.rejects(exportLegacyStream({query:async(sql)=>{queries.push(sql);if(sql.startsWith('FETCH'))controller.abort();return {rows:[]}}},{schema:'legacy',sourceNamespace:'fixture',directory,signal:controller.signal,now:()=>new Date(0)},['artifacts']),/abort/i);assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!(await readdir(directory)).includes('manifest.json'));}finally{await rm(directory,{recursive:true,force:true});}
});

test('index reads one artifact history and leaves prunable edits out of active conversion',async()=>{
 const {indexStreamArchive,readIndexedArtifact,indexedArtifactIds}=await import('../src/migration/stream-index.ts');
 const source=await mkdtemp(join(tmpdir(),'migration-source-'));const index=await mkdtemp(join(tmpdir(),'migration-index-'));
 try{const counts=new Map<string,number>();let current='';const manifest=await exportLegacyStream({query:async(sql)=>{if(sql.startsWith('DECLARE'))current=sql.includes('artifact_versions')?'artifact_versions':sql.includes('artifact_edits')?'artifact_edits':'artifacts';if(sql.startsWith('FETCH')){const n=counts.get(current)??0;counts.set(current,n+1);return {rows:n?[]:current==='artifacts'?[{id:'abcdef',format:'markup',source:'head'}]:[{artifact_id:'abcdef',version:1,source:'old'}]};}return {rows:[]}}},{schema:'legacy',sourceNamespace:'fixture',directory:source,now:()=>new Date(0)},['artifacts','artifact_versions','artifact_edits']);
 await indexStreamArchive(source,index,manifest);const ids=[];for await(const id of indexedArtifactIds(index))ids.push(id);assert.deepEqual(ids,['abcdef']);const artifact=await readIndexedArtifact(index,manifest,'abcdef');assert.equal(artifact.artifacts[0]?.source,'head');assert.equal(artifact.tables.artifact_versions?.length,1);assert.equal(artifact.tables.artifact_edits,undefined);
 }finally{await rm(source,{recursive:true,force:true});await rm(index,{recursive:true,force:true});}
});
