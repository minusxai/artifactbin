import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {withComponentBaselineEvidence} from '../lib/component-baseline-evidence.mjs';
it('archives existing partial captures and the failed case while preserving rejection',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'baseline-evidence-'));const emitted=[];
  const failure=Error('table/dark/390/loaded-end: timed out');
  try{
    await expect(withComponentBaselineEvidence({output,emit:line=>emitted.push(line),run:async()=>{
      await writeFile(path.join(output,'completed.png'),'image');await writeFile(path.join(output,'html-partial-captures.json'),'[{"state":"completed"}]');await writeFile(path.join(output,'loaded-end-failure.json'),'{"state":"loaded-end"}');await writeFile(path.join(output,'capture-status.json'),'{"complete":false}');await writeFile(path.join(output,'readers.json'),'private publication URLs');throw failure;
    }})).rejects.toBe(failure);
    expect(emitted).toHaveLength(1);const archive=JSON.parse(gunzipSync(Buffer.from(emitted[0].split(' ')[1],'base64')));
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
