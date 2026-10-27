/** Build real API payloads. publish(body) is the owning revision's existing gate
 * authentication/API helper; this module never sends credentials or contacts hosts. */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import { browserParityFixtures, parityThemes } from './index.mjs';
/** @typedef {{idempotencyKey?:string}} PublicationRequestOptions */
/** @typedef {{path:string,kind:"asset"|"dataset",id:string,revision:string,sha256:string,state?:string}} DependencyReceipt */
/** @typedef {(body:object, options?:PublicationRequestOptions)=>Promise<{id:string,dependencyReceipts?:DependencyReceipt[]}>} PublishFixture */
const pascal=name=>name==='deck-gl'?'DeckGL':name.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
export const htmlBodyPadding=fixture=>fixture.bareRoot?'0px':'24px';
/** Select whole fixture definitions without rewriting their states or hashes.
 * @template {{id:string}} T
 * @param {T[]} fixtures
 * @param {import('./contract').BrowserParitySelection['fixtureIds']} [fixtureIds]
 */
export function selectBaselineFixtures(fixtures,fixtureIds){
 if(fixtureIds===undefined)return fixtures;
 if(!Array.isArray(fixtureIds)||!fixtureIds.length||fixtureIds.some(id=>typeof id!=='string')||new Set(fixtureIds).size!==fixtureIds.length||fixtureIds.some(id=>!fixtures.some(fixture=>fixture.id===id)))throw Error('Invalid fixture selection: require unique known fixture IDs');
 return fixtures.filter(fixture=>fixtureIds.includes(fixture.id));
}
/** Stored UTF-8 ZIP is the product's normal public skill format. Validate the
 * complete immutable archive before writing any selected package member. */
export function installedFiles(archive){
  if(!(archive instanceof Uint8Array)||archive.byteLength>128*1024*1024)throw Error('Candidate requires a bounded actual HTTP skill archive');
  const bytes=Buffer.from(archive),files=new Map();let offset=0;
  while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    if(files.size>=4000||bytes.readUInt16LE(offset+8)!==0||(bytes.readUInt16LE(offset+6)&~0x800)!==0)throw Error('Unsupported skill ZIP member');
    const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra,end=start+size;
    if(size!==bytes.readUInt32LE(offset+22)||end>bytes.length)throw Error('Truncated skill ZIP member');
    const name=bytes.subarray(offset+30,offset+30+length).toString('utf8');
    if(!/^artifactbin\/[A-Za-z0-9._/-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe skill ZIP member');
    const relative=name.slice('artifactbin/'.length);if(files.has(relative))throw Error('Duplicate skill ZIP member');files.set(relative,bytes.subarray(start,end));offset=end;
  }
  if(!files.size||offset+4>bytes.length||![0x02014b50,0x06054b50].includes(bytes.readUInt32LE(offset)))throw Error('Invalid stored skill ZIP');
  for(const name of ['scripts/publication-bundle.mjs','scripts/preview-html.mjs','design-systems/almanac.css'])if(!files.has(name))throw Error('Installed skill archive is missing '+name);
  if(![...files.keys()].some(name=>/^fonts\/[^/]+\.woff2$/.test(name)))throw Error('Installed skill archive has no packaged fonts');
  return files;
}
/** Reuse only successful receipts for identical local bytes and their entire
 * dependency closure. Each request carries only mappings reachable in its snapshot. */
export function dependencyReceiptCache(localReferences){
  const saved=new Map();
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  function signatures(bundle){
    const files=new Map(bundle.files.map(file=>[file.path,file]));
    const children=new Map();
    for(const file of files.values()){
      const refs=/^(?:text\/css|(?:text|application)\/javascript)$/.test(file.contentType)?localReferences(Buffer.from(file.base64,'base64').toString('utf8'),file.contentType):[];
      children.set(file.path,refs.filter(url=>url&&!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)).map(url=>path.posix.normalize(path.posix.join(path.posix.dirname(file.path),decodeURIComponent(url.split(/[?#]/)[0])))));
    }
    return new Map([...files].map(([name,file])=>{
      const closure=new Set();function visit(current){if(closure.has(current))return;if(!files.has(current))throw Error('Incomplete dependency snapshot: '+current);closure.add(current);for(const child of children.get(current))visit(child);}visit(name);
      const fingerprint=sha(JSON.stringify([...closure].sort().map(current=>{const item=files.get(current);return [current,item.contentType,item.base64];})));
      return [name,{fingerprint,sha256:sha(Buffer.from(file.base64,'base64'))}];
    }));
  }
  return {
    mappings(bundle){return Object.fromEntries([...signatures(bundle)].flatMap(([name,signature])=>{const prior=saved.get(name);return prior?.fingerprint===signature.fingerprint?[[name,prior.mapping]]:[];}));},
    record(bundle,response){
      const current=signatures(bundle);
      for(const receipt of response.dependencyReceipts??[]){
        const signature=current.get(receipt.path);
        if(!signature||receipt.sha256!==signature.sha256||!['asset','dataset'].includes(receipt.kind)||typeof receipt.id!=='string'||typeof receipt.revision!=='string')continue;
        const {kind,id,revision,sha256,state}=receipt;saved.set(receipt.path,{fingerprint:signature.fingerprint,mapping:{kind,id,revision,sha256,...(typeof state==='string'?{state}:{})}});
      }
    }
  };
}
/** Candidate snapshots use the installed component bytes and normal agent helper. */
export async function publishBaselineFixtures({implementation,publish,serverOrigin,skillArchive,fixtures=browserParityFixtures,fixtureIds,substitutions={}}) {
  fixtures=selectBaselineFixtures(fixtures,fixtureIds);
  const entries=[];
  const substitute=value=>Object.entries(substitutions).reduce((source,[name,replacement])=>source.replaceAll('{{'+name+'}}',replacement),value);
  let uploadDataset,staging,prepareBundle,reuse;
  try{
  if(implementation==='html'){
    // Original JSX checkouts have no candidate source or archive. Only this
    // branch installs and executes the selected candidate's normal Node helper.
    const files=installedFiles(skillArchive);staging=await mkdtemp(path.join(tmpdir(),'component-publication-'));
    for(const [name,bytes]of files)if(/^(?:scripts|components|design-systems|fonts)\//.test(name)){const target=path.join(staging,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
    ({prepareBundle}=await import(pathToFileURL(path.join(staging,'scripts/publication-bundle.mjs')).href));
    const {publicationLocalReferences}=await import(pathToFileURL(path.join(staging,'scripts/preview-html.mjs')).href);reuse=dependencyReceiptCache(publicationLocalReferences);
  }
  for(const fixture of fixtures)for(const theme of parityThemes){
    const started=performance.now();let body,request;
    try{
    if(implementation==='jsx'){
      if(fixture.oldJsx.includes('{{uploadDataset}}')&&!uploadDataset)uploadDataset=(await publish({title:'Upload baseline backing data',dataset:[{fixture:'upload-baseline'}]})).id;
      const oldJsx=substitute(fixture.oldJsx).replaceAll('{{uploadDataset}}',uploadDataset||'');
      const helmet=oldJsx.match(/<Helmet>[\s\S]*?<\/Helmet>/)?.[0]||'';
      const content=oldJsx.replace(helmet,'');
      body={title:`Component baseline ${fixture.id}`,theme:'almanac',colorMode:theme,markup:`${helmet}<div data-design="tw" className="p-6">${content}</div>`};
    }else if(implementation==='html'){
      const source=fixture.modules.map(name=>`import {register${pascal(name)}} from "./components/${name}.js";register${pascal(name)}();`).join('\n')+'\n'+substitute(fixture.setup||'')+'\ndocument.documentElement.dataset.baselineReady="yes";';
      const code=source.replace(/<\/script/gi,'<\\/script');
      // A root SlideDeck owns the page column beside its rail; don't wrap the
      // whole host in the generic page inset that ordinary HTML fixtures get.
      const bodyPadding=htmlBodyPadding(fixture);
      // The platform owns the design system: the page names it, the served page links the platform stylesheet and the
      // core sets <html data-af-design-system/data-af-dark>; the viewer's mode comes from ?mx-mode= (gate-component-baseline).
      const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="artifactbin:design-system" content="almanac"><style>body{margin:0;padding:${bodyPadding}}</style><script src="/af/v1/core.js" data-af="core"></script></head><body>${substitute(fixture.newHtml)}<script type="module">${code}</script></body></html>`;
      await writeFile(path.join(staging,'index.html'),html);
      const prepared=await prepareBundle({root:staging,entry:'index.html',server:serverOrigin});body=prepared.body;body.publicationBundle.mappings=reuse.mappings(body.publicationBundle);request={idempotencyKey:prepared.idempotencyKey};
    }else throw Error('Unknown implementation');
    const snapshotMs=Math.round(performance.now()-started),publishing=performance.now();
    const document=await publish(body,request);
    if(!document.id)throw Error('Publication returned no document id');
    if(implementation==='html')reuse.record(body.publicationBundle,document);
    entries.push({fixture:fixture.id,theme,id:document.id});
    console.log(`Component fixture ${entries.length}/${fixtures.length*parityThemes.length} ${fixture.id} ${theme}: snapshot ${snapshotMs}ms, publish ${Math.round(performance.now()-publishing)}ms`);
    }catch(error){throw Error(`Component fixture ${fixture.id} ${theme} failed: ${error.message}`,{cause:error});}
  }
  return entries;
  }finally{if(staging)await rm(staging,{recursive:true,force:true});}
}
