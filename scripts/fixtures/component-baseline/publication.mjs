/** Build real API payloads. publish(body) is the owning revision's existing gate
 * authentication/API helper; this module never sends credentials or contacts hosts. */
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import { browserParityFixtures, parityThemes } from './index.mjs';
/** @typedef {{idempotencyKey?:string}} PublicationRequestOptions */
/** @typedef {{path:string,kind:"asset"|"dataset",id:string,revision:string,sha256:string,state?:string}} DependencyReceipt */
/** @typedef {(body:object, options?:PublicationRequestOptions)=>Promise<{id:string,dependencyReceipts?:DependencyReceipt[]}>} PublishFixture */
/** Hosted components load by their `@afbin/<name>` import-map name; the legacy wrappers have none and load by URL. */
const LEGACY_COMPONENTS=new Set(['deck-gl','mermaid']);
export const componentImport=name=>`import "${LEGACY_COMPONENTS.has(name)?`/af/components/${name}.js`:`@afbin/${name}`}";`;
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
/** Validate the whole actual HTTP archive before installing selected members.
 * Production keeps stored ZIPs for installed updater compatibility; standard raw
 * DEFLATE is also understood here, with both declared and actual output bounded. */
export function installedFiles(archive){
  const limit=128*1024*1024,memberLimit=32*1024*1024;
  if(!(archive instanceof Uint8Array)||archive.byteLength>limit)throw Error('Candidate requires a bounded actual HTTP skill archive');
  const bytes=Buffer.from(archive),files=new Map(),entries=[];let offset=0,total=0;
  while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    const method=bytes.readUInt16LE(offset+8),flags=bytes.readUInt16LE(offset+6);
    if(files.size>=4000||![0,8].includes(method)||(flags&~0x800)!==0)throw Error('Unsupported skill ZIP member');
    const size=bytes.readUInt32LE(offset+18),plain=bytes.readUInt32LE(offset+22),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra,end=start+size;
    if(end>bytes.length||plain>memberLimit||total+plain>limit||(method===0&&size!==plain))throw Error('Truncated or oversized skill ZIP member');
    const name=bytes.subarray(offset+30,offset+30+length).toString('utf8');
    if(!/^artifactbin\/[A-Za-z0-9._/-]+$/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe skill ZIP member');
    const relative=name.slice('artifactbin/'.length);if(files.has(relative))throw Error('Duplicate skill ZIP member');
    const payload=bytes.subarray(start,end);let data;
    try{if(method===0)data=payload;else{const inflated=inflateRawSync(payload,{maxOutputLength:Math.max(1,plain),info:true});if(inflated.engine.bytesWritten!==size)throw Error('Trailing compressed bytes');data=inflated.buffer;}}catch(error){throw Error('Invalid compressed skill ZIP member',{cause:error});}
    if(data.length!==plain)throw Error('Invalid skill ZIP member size');
    let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    if(crc!==bytes.readUInt32LE(offset+14))throw Error('Corrupt skill ZIP member');
    entries.push({offset,name,size,plain,crc,method,flags});files.set(relative,data);total+=data.length;offset=end;
  }
  const central=offset;
  for(const entry of entries){
    if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid skill ZIP directory');
    const length=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),end=offset+46+length+extra+comment;
    if(end>bytes.length||bytes.readUInt16LE(offset+8)!==entry.flags||bytes.readUInt16LE(offset+10)!==entry.method||bytes.readUInt32LE(offset+16)!==entry.crc||bytes.readUInt32LE(offset+20)!==entry.size||bytes.readUInt32LE(offset+24)!==entry.plain||bytes.readUInt16LE(offset+34)!==0||bytes.readUInt32LE(offset+42)!==entry.offset||bytes.subarray(offset+46,offset+46+length).toString('utf8')!==entry.name)throw Error('Invalid skill ZIP directory entry');
    offset=end;
  }
  if(!files.size||offset+22>bytes.length||bytes.readUInt32LE(offset)!==0x06054b50||offset+22+bytes.readUInt16LE(offset+20)!==bytes.length||bytes.readUInt16LE(offset+4)!==0||bytes.readUInt16LE(offset+6)!==0||bytes.readUInt16LE(offset+8)!==entries.length||bytes.readUInt16LE(offset+10)!==entries.length||bytes.readUInt32LE(offset+12)!==offset-central||bytes.readUInt32LE(offset+16)!==central)throw Error('Invalid skill ZIP end');
  for(const name of ['scripts/toolbox-publication-bundle.mjs','scripts/preview-html.mjs','design-systems/almanac.css'])if(!files.has(name))throw Error('Installed skill archive is missing '+name);
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
/** Candidate snapshots use the installed agent helper; components are platform-hosted, so pages import them and upload none. */
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
    for(const [name,bytes]of files)if(/^(?:scripts|design-systems)\//.test(name)){const target=path.join(staging,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
    ({prepareBundle}=await import(pathToFileURL(path.join(staging,'scripts/toolbox-publication-bundle.mjs')).href));
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
      const source=fixture.modules.map(componentImport).join('\n')+'\n'+substitute(fixture.setup||'')+'\ndocument.documentElement.dataset.baselineReady="yes";';
      const code=source.replace(/<\/script/gi,'<\\/script');
      // A root SlideDeck owns the page column beside its rail; don't wrap the
      // whole host in the generic page inset that ordinary HTML fixtures get.
      const bodyPadding=htmlBodyPadding(fixture);
      // The platform owns the design system: the page names it, the served page links the platform stylesheet and the
      // core sets <html data-af-design-system/data-af-dark>; the viewer's mode comes from ?mx-mode= (gate-component-baseline).
      const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="artifactbin:design-system" content="almanac"><style>body{margin:0;padding:${bodyPadding}}</style><script src="/af/core.js" data-af="core"></script></head><body>${substitute(fixture.newHtml)}<script type="module">${code}</script></body></html>`;
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
