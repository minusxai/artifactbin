/** Decode verified local gate evidence; never writes a partial/unverified archive. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodeComponentBaselineEvidence} from './lib/component-baseline-evidence.mjs';
export async function decodeComponentBaselineLog(log,output){
  const archive=decodeComponentBaselineEvidence(await readFile(log,'utf8'));
  await mkdir(output,{recursive:true});
  for(const file of archive.files)await writeFile(path.join(output,file.name),Buffer.from(file.base64,'base64'));
  return archive.files.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [log,output]=process.argv.slice(2);
  if(!log||!output)throw Error('Usage: node scripts/component-baseline-decode.mjs LOG OUTPUT_DIRECTORY');
  console.log(`Decoded ${await decodeComponentBaselineLog(log,output)} verified component evidence files.`);
}
