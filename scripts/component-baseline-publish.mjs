/** Run against an isolated gate server built from the explicitly named source.
 * No production host or credential is accepted. Produces a URL manifest only. */
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {publishBaselineFixtures} from './fixtures/component-baseline/publication.mjs';
export async function publishReaderManifest({implementation,base,source,output,sourceRevision: suppliedRevision}) {
const url=new URL(base);
if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me'))throw Error('Only isolated local gate servers are allowed');
const sourceRevision=suppliedRevision || execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {connectAgent}=await import(pathToFileURL(path.join(source,'scripts/gates/lib/cli-connection.mjs')));
const {token}=await connectAgent(base);
const publish=async(body,options={})=>{
  const response=await fetch(`${base}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(options.idempotencyKey?{'Idempotency-Key':options.idempotencyKey}:{})},body:JSON.stringify({visibility:'unlisted',...body})});
  if(!response.ok)throw Error(`Fixture publication failed (${response.status}): ${await response.text()}`);
  return response.json();
};
let skillArchive;
if(implementation==='html'){
  const response=await fetch(`${base}/skills/artifactbin.zip`);if(!response.ok)throw Error(`Candidate skill archive unavailable (${response.status})`);
  skillArchive=new Uint8Array(await response.arrayBuffer());if(skillArchive.byteLength>128*1024*1024)throw Error('Candidate skill archive limit exceeded');
}
const entries=await publishBaselineFixtures({implementation,publish,serverOrigin:base,skillArchive});
const manifest={implementation,sourceRevision,output:path.join(path.dirname(output),implementation+'-evidence'),entries:entries.map(({fixture,theme,id})=>({fixture,theme,url:`${base}/a/${id}/raw`}))};
await writeFile(output,JSON.stringify(manifest,null,2));
return manifest;

}
