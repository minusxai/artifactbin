/** Reuse the actual imported-reader camera for reviewed, source-bound pairs. */
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {runNativeMigrationPilot,compareNativeMigrationPilot} from './native-migration-pilot.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Each private recipe supplies {format,base,paths}, where paths is NativeMigrationPilotPaths.
 * Browser lifecycle remains owned by the existing gate; this adapter creates no browser lane. */
export function createNativeMigrationCamera({browser,connectAgent}){
 return async function captureAndCompare(context){
  const recipes=await Promise.all([context.baselineRecipePath,context.candidateRecipePath].map(async file=>JSON.parse(await readFile(file,'utf8'))));
  const inputs=await Promise.all(recipes.map(async recipe=>{if(recipe.format!=='native-migration-camera-recipe-v1')throw Error('native-camera-recipe');return JSON.parse(await readFile(recipe.paths.input,'utf8'));}));
  for(const [index,input] of inputs.entries()){
   if(input.implementation!==(index?'html':'jsx')||!input.preparedStore||!input.probe||!isDeepStrictEqual(input.key,context.revision.key)||!isDeepStrictEqual(input.key,context.assembly.key)||context.imported.assemblySha256!==context.assembly.sha256||input.bundleFiles?.find(file=>file.path==='index.html')?.sha256!==context.assembly.result.htmlSha256)throw Error('native-camera-source-binding');
  }
  // runNativeMigrationPilot checks canonical/recovery/bundle/probe/store proofs and normal account login.
  await runNativeMigrationPilot({...recipes[0],browser,connectAgent});
  await runNativeMigrationPilot({...recipes[1],browser,connectAgent});
  const output=path.join(context.outputDirectory,'comparison');
  await mkdir(output,{recursive:true,mode:0o700});
  const report=await compareNativeMigrationPilot({baselineDirectory:recipes[0].paths.output,candidateDirectory:recipes[1].paths.output,output});
  const comparisonPath=path.join(output,'migration-pilot-comparison.json');
  return {key:context.revision.key,assemblySha256:context.assembly.sha256,status:report.passed?'verified':'difference',comparisonPath,comparisonSha256:sha(await readFile(comparisonPath)),baselineEvidencePath:path.join(recipes[0].paths.output,'migration-pilot.json'),candidateEvidencePath:path.join(recipes[1].paths.output,'migration-pilot.json')};
 };
}
