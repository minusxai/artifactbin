/** Build real API payloads. publish(body) is the owning revision's existing gate
 * authentication/API helper; this module never sends credentials or contacts hosts. */
import path from 'node:path';
import {copyFile,mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { browserParityFixtures, parityThemes } from './index.mjs';
/** @typedef {{idempotencyKey?:string}} PublicationRequestOptions */
/** @typedef {(body:object, options?:PublicationRequestOptions)=>Promise<{id:string}>} PublishFixture */
const pascal=name=>name==='deck-gl'?'DeckGL':name.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
/** Candidate snapshots use the installed component bytes and normal agent helper. */
export async function publishBaselineFixtures({implementation,publish,repo,themeCss,serverOrigin}) {
  const entries=[];
  let uploadDataset,staging,prepareBundle;
  try{
  if(implementation==='html'){
    // Intentional engine boundary: pinned original JSX checkouts do not contain
    // the candidate HTML helper and must publish without importing its source.
    ({prepareBundle}=await import('../../../services/app/skills/artifactbin/scripts/publication-bundle.mjs'));
    staging=await mkdtemp(path.join(tmpdir(),'component-publication-'));await mkdir(path.join(staging,'components'));await mkdir(path.join(staging,'design-systems'));await mkdir(path.join(staging,'fonts'));
    const installed=path.join(repo,'services/app/skills/artifactbin/components');
    for(const name of await readdir(installed))if(name.endsWith('.js'))await copyFile(path.join(installed,name),path.join(staging,'components',name));
    const fonts=path.join(repo,'services/app/skills/artifactbin/fonts');
    for(const name of await readdir(fonts).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))if(name.endsWith('.woff2'))await copyFile(path.join(fonts,name),path.join(staging,'fonts',name));
  }
  for(const fixture of browserParityFixtures)for(const theme of parityThemes){
    const started=performance.now();let body,request;
    try{
    if(implementation==='jsx'){
      if(fixture.oldJsx.includes('{{uploadDataset}}')&&!uploadDataset)uploadDataset=(await publish({title:'Upload baseline backing data',dataset:[{fixture:'upload-baseline'}]})).id;
      const oldJsx=fixture.oldJsx.replaceAll('{{uploadDataset}}',uploadDataset||'');
      const helmet=oldJsx.match(/<Helmet>[\s\S]*?<\/Helmet>/)?.[0]||'';
      const content=oldJsx.replace(helmet,'');
      body={title:`Component baseline ${fixture.id}`,theme:'almanac',colorMode:theme,markup:`${helmet}<div data-design="tw" className="p-6">${content}</div>`};
    }else if(implementation==='html'){
      if(typeof themeCss!=='function')throw Error('Candidate must supply the same actual almanac theme CSS as the original reader');
      const source=fixture.modules.map(name=>`import {register${pascal(name)}} from "./components/${name}.js";register${pascal(name)}();`).join('\n')+'\n'+(fixture.setup||'')+'\ndocument.documentElement.dataset.baselineReady="yes";';
      await writeFile(path.join(staging,'design-systems/almanac.css'),await themeCss(theme));
      const code=source.replace(/<\/script/gi,'<\\/script');
      const html=`<!doctype html><html data-af-design-system="almanac" data-af-dark="${theme==='dark'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./design-systems/almanac.css"><style>body{margin:0;padding:24px}</style><script src="/af/v1/core.js" data-af="core"></script></head><body>${fixture.newHtml}<script type="module">${code}</script></body></html>`;
      await writeFile(path.join(staging,'index.html'),html);
      const prepared=await prepareBundle({root:staging,entry:'index.html',server:serverOrigin});body=prepared.body;request={idempotencyKey:prepared.idempotencyKey};
    }else throw Error('Unknown implementation');
    const snapshotMs=Math.round(performance.now()-started),publishing=performance.now();
    const document=await publish(body,request);
    if(!document.id)throw Error('Publication returned no document id');
    entries.push({fixture:fixture.id,theme,id:document.id});
    console.log(`Component fixture ${entries.length}/${browserParityFixtures.length*parityThemes.length} ${fixture.id} ${theme}: snapshot ${snapshotMs}ms, publish ${Math.round(performance.now()-publishing)}ms`);
    }catch(error){throw Error(`Component fixture ${fixture.id} ${theme} failed: ${error.message}`,{cause:error});}
  }
  return entries;
  }finally{if(staging)await rm(staging,{recursive:true,force:true});}
}
