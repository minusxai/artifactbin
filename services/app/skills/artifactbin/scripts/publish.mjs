/** Optional author-skill helper. Credentials never enter a page or saved publication request. */
import {realpathSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
function serverOrigin(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Select an HTTP server origin without a path or credentials.');return url.origin;}
export async function prepareSample(name,server,datasetId){
 const origin=serverOrigin(server);
 let body;
 if(name==='repairs-data')body={dataset:await readFile(path.join(root,'examples/repairs.csv'),'utf8'),title:'Repair bench sample',visibility:'unlisted',access:'readwrite'};
 else {
  if(!['report','csv-dashboard','shared-app'].includes(name))throw Error('Unknown sample. Choose report, repairs-data, csv-dashboard or shared-app.');
  let html=await readFile(path.join(root,`examples/${name}.html`),'utf8');
  if(name==='csv-dashboard'){
   if(!/^[A-Za-z0-9]{6,}$/.test(datasetId??''))throw Error('The CSV dashboard requires the real returned dataset ID.');
   html=html.replace('ref:DATASET_ID',`ref:${datasetId}`);
  }
  const {prepareBundle}=await import('./publication-bundle.mjs');
  const snapshot=await prepareBundle({root,entry:`examples/${name}.html`,server:origin,entryHtml:html});
  body={...snapshot.body,title:{report:'A cooler walk home','csv-dashboard':'Repair bench capacity','shared-app':'Saturday garden jobs'}[name],visibility:'unlisted'};
  if(name==='shared-app'){
   const backend=snapshot.body.publicationBundle.files.find(file=>file.path==='examples/garden.ts');
   if(!backend)throw Error('Sample backend is missing from its publication snapshot.');
   body.backendSources={garden:Buffer.from(backend.base64,'base64').toString('utf8')};
  }
 }
 return {server:origin,method:'POST',idempotencyKey:randomUUID(),body};
}
export async function sendPublication(saved,env=process.env,fetcher=fetch){
 const origin=serverOrigin(saved.server);
 if(env.ARTIFACTBIN_URL!==origin||!env.ARTIFACTBIN_TOKEN)throw Error('Supply origin-matched ARTIFACTBIN_URL and ARTIFACTBIN_TOKEN outside the saved request.');
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(saved.idempotencyKey??''))throw Error('A durable idempotency key is required.');
 if(!['POST','PUT'].includes(saved.method)||!saved.body||typeof saved.body!=='object')throw Error('Invalid saved publication request.');
 const id=saved.artifactId;
 if(saved.method==='PUT'&&!/^[A-Za-z0-9]{6,}$/.test(id??''))throw Error('An update requires the existing artifact ID.');
 if(saved.method==='PUT'&&(!Number.isInteger(saved.body.expectedVersion)||typeof saved.body.expectedState!=='string'))throw Error('An update requires observed expectedVersion and expectedState.');
 const response=await fetcher(origin+'/api/artifacts'+(saved.method==='PUT'?'/'+id:''),{method:saved.method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.ARTIFACTBIN_TOKEN,'Idempotency-Key':saved.idempotencyKey},body:JSON.stringify(saved.body),redirect:'error'});
 const receipt=await response.json();
 if(!response.ok){const error=Error(`Publication refused (HTTP ${response.status}): ${typeof receipt.error==='string'?receipt.error:'read the server recovery instructions'}`);error.receipt=receipt;throw error;}
 return receipt;
}
async function main(args){
 if(args.length===1&&args[0]==='--help'){console.log('Usage: node publish.mjs --prepare SAMPLE --server ORIGIN --output REQUEST.json [--dataset-id ID]\n       node publish.mjs --send REQUEST.json\nSAMPLE: report, repairs-data, csv-dashboard, shared-app. Send requires origin-matched ARTIFACTBIN_URL and ARTIFACTBIN_TOKEN. Prefer publication-bundle.mjs --send to save dependency receipts.');return;}
 const options={};for(let index=0;index<args.length;index+=2){const flag=args[index];if(!['--prepare','--server','--output','--dataset-id','--send'].includes(flag)||!args[index+1]||Object.hasOwn(options,flag))throw Error('Use --prepare SAMPLE --server ORIGIN --output REQUEST.json, or --send REQUEST.json.');options[flag]=args[index+1];}
 if(options['--prepare']){
  if(options['--send']||!options['--server']||!options['--output'])throw Error('Preparation requires server and output, without send.');
  const saved=await prepareSample(options['--prepare'],options['--server'],options['--dataset-id']);
  await writeFile(options['--output'],JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write('Saved publication request. Reuse this file and its key after an uncertain result.\n');
 }else if(options['--send']){
  if(Object.keys(options).length!==1)throw Error('Send uses only the saved request; do not override its origin or payload.');
  const saved=JSON.parse(await readFile(options['--send'],'utf8'));
  const receipt=await sendPublication(saved);process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
 }else throw Error('Choose prepare or send.');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
