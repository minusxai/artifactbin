/** Host-only migration boundary. Product adapters retain transaction and camera ownership. */
import {createHash} from 'node:crypto';
import {readFile,realpath,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,file)=>file!==root&&!path.relative(root,file).startsWith('..')&&!path.isAbsolute(path.relative(root,file));
const names=['sourceHead','compiledHtml','datasetCatalog','identity','authSchemaCapability','membership','comments'];
const fail=code=>{throw Error('native-host-'+code);};
async function admitted(context){
 const root=await realpath(context.receiptRoot),recipePath=await realpath(context.authorityRecipePath);
 if(!inside(root,recipePath))fail('recipe-path');
 const recipe=JSON.parse(await readFile(recipePath,'utf8'));
 if(recipe.format!=='native-migration-host-v1'||recipe.revisionScope!=='latest'||!hash(recipe.assemblySha256)||![recipe.sourceRevision,recipe.targetRevision].every(v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v))||!recipe.key?.sourceNamespace||!recipe.key?.sourceId||!Number.isSafeInteger(recipe.key.version)||recipe.key.version<1)fail('recipe');
 if(!isDeepStrictEqual(recipe.key,context.revision?.key)||!isDeepStrictEqual(recipe.key,context.assembly?.key)||recipe.assemblySha256!==context.assembly?.sha256)fail('binding');
 const authority=recipe.authority;
 if(!authority||![authority.appSchema,authority.authSchema].every(v=>typeof v==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(v))||authority.appSchema===authority.authSchema||!Array.isArray(authority.capabilities)||!authority.capabilities.length||authority.capabilities.some(v=>typeof v!=='string'||!v))fail('authority');
 const files={};
 for(const name of names){const file=recipe.inputs?.[name];if(!file||!hash(file.sha256)||typeof file.path!=='string'||path.isAbsolute(file.path))fail('input');const target=await realpath(path.resolve(root,file.path));if(!inside(root,target))fail('input-path');const bytes=await readFile(target);if(sha(bytes)!==file.sha256)fail('input-digest');files[name]=bytes;}
 if(!hash(context.assembly.result?.htmlSha256)||sha(files.compiledHtml)!==context.assembly.result.htmlSha256)fail('compiled-html-binding');
 return {recipe,files,context};
}
/** @param {{ports:import('./native-migration-host-contract').NativeMigrationHostPorts<any,any>}} options */
export function createNativeMigrationHost({ports}){
 return {
  async importAndPrepare(context){
   const input=await admitted(context),staged=await ports.stage(input);
   const result=await ports.transaction(input.recipe.authority,async tx=>{const imported=await ports.importHistory(tx,staged);if(!hash(imported?.historyProjectionSha256))fail('import-proof');await ports.verify(tx,staged);return imported;});
   await mkdir(context.outputDirectory,{recursive:true,mode:0o700});
   const snapshot=await ports.snapshot(staged,context),output=await realpath(context.outputDirectory);
   for(const name of ['preparedStorePath','pilotInputPath','canonicalPath','recoveryPath','bundleDirectory']){if(typeof snapshot[name]!=='string'||!inside(output,await realpath(snapshot[name])))fail('snapshot-path');}
   return {...snapshot,key:input.recipe.key,assemblySha256:input.recipe.assemblySha256,stage:'imported',historyProjectionSha256:result.historyProjectionSha256};
  },
  async captureAndCompare(context){
   const {recipe}=await admitted(context),imported=context.imported;
   if(imported?.stage!=='imported'||!hash(imported.historyProjectionSha256)||!isDeepStrictEqual(imported.key,recipe.key)||imported.assemblySha256!==recipe.assemblySha256)fail('binding');
   if(!context.baselineRecipePath||!context.candidateRecipePath)fail('capture-recipes');
   const result=await ports.captureAndCompare(context);
   if(!isDeepStrictEqual(result?.key,recipe.key)||result.assemblySha256!==recipe.assemblySha256||!['verified','difference','environment-blocked'].includes(result.status)||!hash(result.comparisonSha256))fail('comparison');
   let report;try{const bytes=await readFile(result.comparisonPath);if(sha(bytes)!==result.comparisonSha256)fail('comparison-digest');report=JSON.parse(bytes);}catch{fail('comparison');}
   if(result.status==='verified'&&(report.format!=='native-migration-pilot-comparison-v1'||report.passed!==true||!(report.pairedStates>0)||report.issues?.length!==0||report.control?.detected!==true))fail('comparison');
   if(!result.baselineEvidencePath||!result.candidateEvidencePath)fail('comparison');
   await Promise.all([readFile(result.baselineEvidencePath),readFile(result.candidateEvidencePath)]);
   return result;
  },
 };
}
