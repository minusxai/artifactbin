/** Preserve existing evidence on both successful and failed capture runs. */
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
export async function withComponentBaselineEvidence({output,run,emit=console.log,report=console.error}){
  let failure;
  try{return await run();}
  catch(error){failure=error;throw error;}
  finally{
    try{
      const names=await readdir(output).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      const files=await Promise.all(names.filter(name=>name.endsWith('.png')||name.endsWith('-captures.json')||name.endsWith('-failure.json')||name==='capture-status.json').sort().map(async name=>({name,base64:(await readFile(path.join(output,name))).toString('base64')})));
      emit('COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+gzipSync(Buffer.from(JSON.stringify({format:'component-baseline-files-v1',files}))).toString('base64'));
    }catch(error){if(failure){try{report(`Could not archive component evidence: ${error.message}`);}catch{ /* Keep the original capture failure. */ }}else throw error;}
  }
}
