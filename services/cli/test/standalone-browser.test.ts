import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {digest} from '../src/files';
import {prepareChromium} from '../src/standalone-browser';

test('Chromium downloads once, preserves executable permission and reuses its verified offline cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-chromium-'));const bytes=Buffer.from('fixture executable'),compressed=gzipSync(bytes);let downloads=0;
 const manifest={url:'https://example.com/browser.gz',sha256:digest(compressed),version:'chromium-123',executable:'node_modules/chromium/chrome',files:[{path:'node_modules/chromium/chrome',size:bytes.length,sha256:digest(bytes),mode:0o700 as const}]};
 try{
  const path=await prepareChromium({manifest,root,fetch:async()=>{downloads++;return new Response(compressed);}});
  assert.deepEqual(await readFile(path),bytes);assert.equal((await stat(path)).mode&0o777,0o700);
  assert.equal(await prepareChromium({manifest,root,fetch:async()=>{throw new Error('offline');}}),path);assert.equal(downloads,1);
  await assert.rejects(prepareChromium({manifest:{...manifest,executable:'../../outside'},root}));
 }finally{await rm(root,{recursive:true,force:true});}
});
