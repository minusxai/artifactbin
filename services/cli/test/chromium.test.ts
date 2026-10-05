import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareChromium} from '../src/chromium';

test('npm Chromium preparation reuses an executable without running the installer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-chromium-')),executable=join(root,'chrome');
 try{
  await writeFile(executable,'fixture executable',{mode:0o755});
  assert.equal(await prepareChromium({executable,install:async()=>assert.fail('offline reuse must not install')}),executable);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('npm Chromium preparation installs only when absent and verifies the resulting executable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-chromium-')),executable=join(root,'chrome');let installs=0;
 try{
  const install=async()=>{installs++;await writeFile(executable,'fixture executable',{mode:0o755});};
  assert.equal(await prepareChromium({executable,install}),executable);
  assert.equal(await prepareChromium({executable,install:async()=>assert.fail('repeat must not install')}),executable);
  assert.equal(installs,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('npm Chromium preparation reports installation failure or missing output and allows retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-chromium-')),executable=join(root,'chrome');
 try{
  await assert.rejects(prepareChromium({executable,install:async()=>{throw Error('browser unavailable');}}),/browser unavailable/);
  await assert.rejects(prepareChromium({executable,install:async()=>{}}),/ENOENT/);
  assert.equal(await prepareChromium({executable,install:async()=>{await writeFile(executable,'fixture executable',{mode:0o755});}}),executable);
 }finally{await rm(root,{recursive:true,force:true});}
});
