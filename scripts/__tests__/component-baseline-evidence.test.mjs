import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runGateProcess} from '../gates.process.mjs';
import {withComponentBaselineEvidence,decodeComponentBaselineEvidence} from '../lib/component-baseline-evidence.mjs';
it('archives existing partial captures and the failed case while preserving rejection',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'baseline-evidence-'));const emitted=[];
  const failure=Error('table/dark/390/loaded-end: timed out');
  try{
    await expect(withComponentBaselineEvidence({output,emit:line=>emitted.push(line),run:async()=>{
      await writeFile(path.join(output,'completed.png'),'image');await writeFile(path.join(output,'html-partial-captures.json'),'[{"state":"completed"}]');await writeFile(path.join(output,'loaded-end-failure.json'),'{"state":"loaded-end"}');await writeFile(path.join(output,'capture-status.json'),'{"complete":false}');await writeFile(path.join(output,'readers.json'),'private publication URLs');throw failure;
    }})).rejects.toBe(failure);
    const archive=decodeComponentBaselineEvidence(emitted.join('\n'));
    expect(archive.files.map(file=>file.name)).toEqual(['capture-status.json','completed.png','html-partial-captures.json','loaded-end-failure.json']);
    expect(Buffer.from(archive.files[2].base64,'base64').toString()).toContain('completed');
  }finally{await rm(output,{recursive:true,force:true});}
});
it('never masks the initial capture error when archiving or reporting fails',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'baseline-evidence-')),failure=Error('original capture error');
  try{await expect(withComponentBaselineEvidence({output,run:async()=>{throw failure;},emit:()=>{throw Error('archive failed');},report:()=>{throw Error('report failed');}})).rejects.toBe(failure);}
  finally{await rm(output,{recursive:true,force:true});}
});
it('fails a successful run if its evidence cannot be emitted',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'baseline-evidence-'));
  try{await expect(withComponentBaselineEvidence({output,run:async()=>[],emit:()=>{throw Error('archive failed');}})).rejects.toThrow('archive failed');}
  finally{await rm(output,{recursive:true,force:true});}
});

it('fully transports a large failed-gate archive before immediate child exit',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'baseline-evidence-')),bytes=randomBytes(512*1024);
 try{
  await writeFile(path.join(output,'partial.png'),bytes);
  const module=pathToFileURL(path.resolve(import.meta.dirname,'../lib/component-baseline-evidence.mjs')).href;
  const script=`import {withComponentBaselineEvidence} from ${JSON.stringify(module)};try{await withComponentBaselineEvidence({output:${JSON.stringify(output)},run:async()=>{throw Error('capture failed');}});}catch{process.exit(1);}`;
  const result=await runGateProcess(process.execPath,['--input-type=module','-e',script],{timeoutMs:5000});
  expect(result.ok).toBe(false);
  const archive=decodeComponentBaselineEvidence(result.output);expect(Buffer.from(archive.files[0].base64,'base64')).toEqual(bytes);
  const lines=result.output.trimEnd().split('\n');
  expect(()=>decodeComponentBaselineEvidence(lines.slice(0,-1).join('\n'))).toThrow(/incomplete/i);
  const missing=lines.filter(line=>!line.includes('CHUNK ')||!line.includes(' 0/'));
  expect(()=>decodeComponentBaselineEvidence(missing.join('\n'))).toThrow(/chunk|incomplete/i);
  const corrupted=result.output.replace(/(CHUNK [a-f0-9]+ 0\/\d+ )([A-Za-z0-9+/])/,(_,prefix,char)=>prefix+(char==='A'?'B':'A'));
  expect(()=>decodeComponentBaselineEvidence(corrupted)).toThrow(/digest/i);
 }finally{await rm(output,{recursive:true,force:true});}
});
it('accepts complete legacy archives but rejects truncated gzip',()=>{
 const archive={format:'component-baseline-files-v1',files:[]},compressed=gzipSync(JSON.stringify(archive));
 expect(decodeComponentBaselineEvidence('COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+compressed.toString('base64'))).toEqual(archive);
 expect(()=>decodeComponentBaselineEvidence('COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+compressed.subarray(0,-5).toString('base64'))).toThrow();
});
it('decodes realistic multi-megabyte evidence without recursive regex backtracking',()=>{
 const bytes=randomBytes(3*1024*1024),archive={format:'component-baseline-files-v1',files:[{name:'capture.png',base64:bytes.toString('base64')}]};
 const encoded=gzipSync(JSON.stringify(archive)).toString('base64');
 expect(encoded.length).toBeGreaterThan(4*1024*1024);
 const decoded=decodeComponentBaselineEvidence('COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+encoded);
 expect(Buffer.from(decoded.files[0].base64,'base64')).toEqual(bytes);
});
it('writes decoded files only after the complete archive verifies',async()=>{
 const {decodeComponentBaselineLog}=await import('../component-baseline-decode.mjs');
 const {readFile,access}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(tmpdir(),'baseline-decode-')),log=path.join(root,'gate.log'),output=path.join(root,'decoded');
 try{
  await writeFile(log,'COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 incomplete');
  await expect(decodeComponentBaselineLog(log,output)).rejects.toThrow();await expect(access(output)).rejects.toMatchObject({code:'ENOENT'});
  const bytes=Buffer.from('partial capture'),archive={format:'component-baseline-files-v1',files:[{name:'partial.png',base64:bytes.toString('base64')}]};
  await writeFile(log,'COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+gzipSync(JSON.stringify(archive)).toString('base64'));
  expect(await decodeComponentBaselineLog(log,output)).toBe(1);expect(await readFile(path.join(output,'partial.png'))).toEqual(bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});
