/** Preserve existing evidence on both successful and failed capture runs. */
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const BEGIN='COMPONENT_BASELINE_EVIDENCE_V2_BEGIN ',CHUNK='COMPONENT_BASELINE_EVIDENCE_V2_CHUNK ',END='COMPONENT_BASELINE_EVIDENCE_V2_END ',LEGACY='COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 ';
const writeLine=line=>new Promise((resolve,reject)=>process.stdout.write(line+'\n',error=>error?reject(error):resolve()));
/** An awaited write callback drains the pipe before an immediate failing exit.
 * Frames cap each write and include an independently checked completion receipt. */
export async function withComponentBaselineEvidence({output,run,emit=writeLine,report=console.error}){
  let failure;
  try{return await run();}
  catch(error){failure=error;throw error;}
  finally{
    try{
      const names=await readdir(output).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      const files=await Promise.all(names.filter(name=>name.endsWith('.png')||name.endsWith('-captures.json')||name.endsWith('-failure.json')||name==='capture-status.json'||name==='component-assets.json').sort().map(async name=>({name,base64:(await readFile(path.join(output,name))).toString('base64')})));
      const compressed=gzipSync(Buffer.from(JSON.stringify({format:'component-baseline-files-v1',files}))),base64=compressed.toString('base64');
      const chunks=base64.match(/.{1,32768}/g)||[],sha256=digest(compressed),metadata={sha256,bytes:compressed.length,chunks:chunks.length,files:files.length};
      await emit(BEGIN+JSON.stringify(metadata));
      for(const [index,chunk]of chunks.entries())await emit(CHUNK+`${sha256} ${index}/${chunks.length} ${chunk}`);
      await emit(END+JSON.stringify(metadata));
    }catch(error){if(failure){try{await report(`Could not archive component evidence: ${error.message}`);}catch{ /* Keep the original capture failure. */ }}else throw error;}
  }
}
const base64Bytes=value=>{
  if(typeof value!=='string'||value.length%4!==0)throw Error('Invalid evidence base64');
  let padding=0;
  if(value.endsWith('='))padding++;
  if(value.endsWith('=='))padding++;
  const dataLength=value.length-padding;
  for(let index=0;index<dataLength;index++){
    const code=value.charCodeAt(index);
    if(!(code>=65&&code<=90||code>=97&&code<=122||code>=48&&code<=57||code===43||code===47))throw Error('Invalid evidence base64');
  }
  for(let index=dataLength;index<value.length;index++)if(value.charCodeAt(index)!==61)throw Error('Invalid evidence base64');
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value)throw Error('Invalid evidence base64');
  return bytes;
};
/** Decode only the latest attempted archive. Never substitute an earlier complete
 * capture for a truncated new run. Legacy single-line gzip remains readable. */
export function decodeComponentBaselineEvidence(log){
  const lines=log.split(/\r?\n/),start=lines.findLastIndex(line=>line.startsWith(BEGIN)),legacy=lines.findLastIndex(line=>line.startsWith(LEGACY));
  let compressed,expectedFiles;
  if(start>legacy){
    const metadata=JSON.parse(lines[start].slice(BEGIN.length));
    if(!/^[a-f0-9]{64}$/.test(metadata.sha256)||!['bytes','chunks','files'].every(key=>Number.isSafeInteger(metadata[key])&&metadata[key]>=0))throw Error('Invalid evidence metadata');
    const chunks=[];let complete=false;
    for(const line of lines.slice(start+1)){
      if(line.startsWith(CHUNK)){
        const match=/^([a-f0-9]{64}) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)$/.exec(line.slice(CHUNK.length));
        if(!match||match[1]!==metadata.sha256||Number(match[2])!==chunks.length||Number(match[3])!==metadata.chunks)throw Error('Invalid or missing evidence chunk');
        chunks.push(match[4]);
      }else if(line.startsWith(END)){
        const end=JSON.parse(line.slice(END.length));if(JSON.stringify(end)!==JSON.stringify(metadata))throw Error('Evidence completion receipt mismatch');complete=true;break;
      }
    }
    if(!complete||chunks.length!==metadata.chunks)throw Error('Incomplete component evidence archive');
    compressed=base64Bytes(chunks.join(''));
    if(compressed.length!==metadata.bytes||digest(compressed)!==metadata.sha256)throw Error('Evidence byte count or digest mismatch');
    expectedFiles=metadata.files;
  }else if(legacy>=0)compressed=base64Bytes(lines[legacy].slice(LEGACY.length));
  else throw Error('No component evidence archive');
  const archive=JSON.parse(gunzipSync(compressed));
  if(archive.format!=='component-baseline-files-v1'||!Array.isArray(archive.files)||expectedFiles!==undefined&&archive.files.length!==expectedFiles)throw Error('Invalid evidence file count or format');
  const names=new Set();for(const file of archive.files){if(typeof file.name!=='string'||path.basename(file.name)!==file.name||['.','..'].includes(file.name)||names.has(file.name))throw Error('Invalid evidence filename');names.add(file.name);base64Bytes(file.base64);}
  return archive;
}
