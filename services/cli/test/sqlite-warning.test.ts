import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('loading the SQLite store concurrently is quiet, restores warning handling, and preserves other warnings', async () => {
 const root=await mkdtemp(join(tmpdir(),'afbin-lock-warnings-'));
 const module=new URL('../src/state.ts',import.meta.url).href;
 try{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`
   import {State} from ${JSON.stringify(module)};
   const original=process.emitWarning;
   const stores=await Promise.all([State.open(${JSON.stringify(root)},{}),State.open(${JSON.stringify(root)}, {})]);
   for(const store of stores)store.close();
   process.stdout.write('opened');
   if(process.emitWarning!==original)throw new Error('warning handler was not restored');
   process.emitWarning('Another experimental subsystem','ExperimentalWarning');
   process.emitWarning('A real diagnostic');
  `],{stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',data=>{out+=data;});child.stderr.on('data',data=>{err+=data;});
  const [code]=await once(child,'exit');
  assert.equal(code,0,err);assert.equal(out,'opened');
  assert.doesNotMatch(err,/SQLite is an experimental feature/);
  assert.match(err,/ExperimentalWarning: Another experimental subsystem/);
  assert.match(err,/Warning: A real diagnostic/);
 }finally{await rm(root,{recursive:true,force:true});}
});

