/** Run against an isolated gate server built from the explicitly named source.
 * No production host or credential is accepted. Produces a URL manifest only. */
import {randomUUID} from 'node:crypto';
import {baselineLocalOrigin,validateBaselineAccount} from './lib/component-baseline-session.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyComponentAssetArchive} from './lib/component-asset-proof.mjs';
import {installedFiles} from './fixtures/component-baseline/publication.mjs';
import {publishBaselineFixtures} from './fixtures/component-baseline/publication.mjs';
export async function publishReaderManifest({implementation,base,source,output,sourceRevision: suppliedRevision, authenticated=false, account: suppliedAccount}) {
baselineLocalOrigin(base);
const account=authenticated||suppliedAccount?validateBaselineAccount(suppliedAccount||{email:`mxmx_test_baseline_${randomUUID()}@example.com`}):undefined;
const sourceRevision=suppliedRevision || execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {connectAgent}=await import(pathToFileURL(path.join(source,'scripts/gates/lib/cli-connection.mjs')));
const {token}=await connectAgent(base,account||{});
const publish=async(body,options={})=>{
  const response=await fetch(`${base}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(options.idempotencyKey?{'Idempotency-Key':options.idempotencyKey}:{})},body:JSON.stringify({visibility:'unlisted',...body})});
  if(!response.ok)throw Error(`Fixture publication failed (${response.status}): ${await response.text()}`);
  return response.json();
};
let skillArchive,componentAssets;
if(implementation==='html'){
  const response=await fetch(`${base}/skills/artifactbin.zip`);if(!response.ok)throw Error(`Candidate skill archive unavailable (${response.status})`);
  skillArchive=new Uint8Array(await response.arrayBuffer());if(skillArchive.byteLength>128*1024*1024)throw Error('Candidate skill archive limit exceeded');
  componentAssets=await verifyComponentAssetArchive({root:source,files:installedFiles(skillArchive)});
}
const entries=await publishBaselineFixtures({implementation,publish,serverOrigin:base,skillArchive});
const manifest={implementation,sourceRevision,...(account?{account}:{}),...(componentAssets?{componentAssets}:{}),output:path.join(path.dirname(output),implementation+'-evidence'),entries:entries.map(({fixture,theme,id})=>({fixture,theme,url:`${base}/a/${id}/raw`}))};
await writeFile(output,JSON.stringify(manifest,null,2));
return manifest;

}
