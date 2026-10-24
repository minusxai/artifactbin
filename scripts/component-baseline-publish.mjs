/** Run against an isolated gate server built from the explicitly named source.
 * No production host or credential is accepted. Produces a URL manifest only. */
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {publishBaselineFixtures} from './fixtures/component-baseline/publication.mjs';
export async function publishReaderManifest({implementation,base,source,output}) {
const url=new URL(base);
if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me'))throw Error('Only isolated local gate servers are allowed');
const sourceRevision=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {connectAgent}=await import(pathToFileURL(path.join(source,'scripts/gates/lib/cli-connection.mjs')));
const {token}=await connectAgent(base);
const publish=async body=>{
  const response=await fetch(`${base}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({visibility:'unlisted',...body})});
  if(!response.ok)throw Error(`Fixture publication failed (${response.status}): ${await response.text()}`);
  return response.json();
};
const {nativeSystemCss}=await import('../design-systems/lib/html-skill.mjs');
const entries=await publishBaselineFixtures({implementation,publish,repo:source,themeCss:()=>nativeSystemCss('modernist')});
await writeFile(output,JSON.stringify({implementation,sourceRevision,output:path.join(path.dirname(output),implementation+'-evidence'),entries:entries.map(({fixture,theme,id})=>({fixture,theme,url:`${base}/a/${id}/raw`}))},null,2));
console.log(`Published ${entries.length} disposable local fixture readers; manifest written.`);

}
