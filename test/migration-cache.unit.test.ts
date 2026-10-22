import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {cachedMigrationConverter} from '../src/migration/cache.ts';
test('private conversion cache varies full inputs/compiler, retries corrupt and failed records',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'migration-cache-'));let calls=0;const underlying=()=>{calls++;return {classification:'renderable' as const,html:'<p>ok</p>',issues:[],identities:{}};};
 try{const a=cachedMigrationConverter(underlying,{directory,compilerIdentity:'build-a',strategy:'static'});const input={source:'fixture',coreUrl:'/af/v1/core.js',meta:{theme:'one'}};
 await a.convert(input);await a.convert(input);assert.equal(calls,1);assert.equal(a.stats.hits,1);
 const path=join(directory,(await readdir(directory))[0]!);const record=JSON.parse(await readFile(path,'utf8'));record.result.html='<p>tampered</p>';await writeFile(path,JSON.stringify(record));await a.convert(input);assert.equal(calls,2);assert.equal(a.stats.invalid,1);
 await a.convert({...input,meta:{theme:'two'}});assert.equal(calls,3);
 await cachedMigrationConverter(underlying,{directory,compilerIdentity:'build-b',strategy:'static'}).convert(input);assert.equal(calls,4);
 let attempts=0;const flaky=cachedMigrationConverter(()=>{if(++attempts===1)throw new Error('retry');return underlying();},{directory,compilerIdentity:'flaky',strategy:'static'});await assert.rejects(async()=>flaky.convert(input));await flaky.convert(input);assert.equal(attempts,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
