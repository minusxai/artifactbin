/** Deprecated executable and export adapter. Canonical snapshots live in
 * toolbox-publication-bundle.mjs; saved-request sends retain their receipt-file contract. */
import {beforeCommand} from './toolbox-update.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {prepareBundle} from './toolbox-publication-bundle.mjs';
import {sendPublication} from './toolbox-publish-legacy.mjs';
import {fileURLToPath} from 'node:url';
export {prepareBundle,prepareBundleUpdate} from './toolbox-publication-bundle.mjs';
export async function sendBundleFile(requestFile,env=process.env,fetcher=fetch){
 const saved=JSON.parse(await readFile(requestFile,'utf8'));
 const saveReceipt=receipt=>writeFile(requestFile+'.receipt.json',JSON.stringify({receipt,
  mappings:Object.fromEntries((receipt.dependencyReceipts??[]).map(({path,...mapping})=>[path,mapping]))
 },null,2)+'\n',{mode:0o600});
 let receipt;
 try{receipt=await sendPublication(saved,env,fetcher);}
 catch(error){if(error.receipt)await saveReceipt(error.receipt);throw error;}
 await saveReceipt(receipt);return receipt;
}

const help=
  `Usage: node publication-bundle.mjs PROJECT_ROOT ENTRY.html SERVER_ORIGIN REQUEST.json `+
  `[MANIFEST.json]
       node publication-bundle.mjs --send REQUEST.json
       node publication-bundle.mjs --help
MANIFEST.json: {manifest:[paths],mappings:{path:receipt}}.
Send uses origin-matched ARTIFACTBIN_URL and ARTIFACTBIN_TOKEN; saves REQUEST.json.receipt.json.
Reuse unchanged REQUEST.json and key on uncertain outcomes. A new update gets a new key. Never `+
  `run from stdin.`;
async function main(args){
 if(args.length===1&&args[0]==='--help'){console.log(help);return;}
if(args[0]==='--send'){if(args.length!==2)throw Error(help);console.log(JSON.stringify(
   await sendBundleFile(args[1]),null,2));return;}
 const [root,entry,server,output,manifestFile]=args;
 if(args.length<4||args.length>5||!root||root.startsWith('--'))throw Error(help);
 const extra=manifestFile?JSON.parse(await readFile(manifestFile,'utf8')):{};
 // Manifest input cannot replace the selected project, server or observed page head.
if(!extra||typeof extra!=='object'||Object.keys(extra).some(key=>!['manifest','mappings'].includes(
   key)))throw Error('Manifest supports only manifest and mappings.');
 const options={root,entry,server,...extra};
 const prepared=await prepareBundle(options);
 await writeFile(output,JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(
   'Saved immutable publication request. Send with publication-bundle.mjs --send; preserve its '+
   'receipt mappings for updates.');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  if(await beforeCommand(import.meta.url,process.argv.slice(2)))process.exit(process.exitCode??0);
  console.error('Deprecated publication-bundle.mjs; prefer publish.mjs FILE.');
  main(process.argv.slice(2).filter(arg=>arg!=='--no-update')).catch(
  error=>{console.error(error.message);process.exitCode=1;});}
