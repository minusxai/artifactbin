/** Build real API payloads. publish(body) is the owning revision's existing gate
 * authentication/API helper; this module never sends credentials or contacts hosts. */
import path from 'node:path';
import { build } from 'esbuild';
import { browserParityFixtures, parityThemes } from './index.mjs';
const pascal=name=>name==='deck-gl'?'DeckGL':name.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('');
/** Candidate inline module comes from actual implementation, never a mock. */
export async function publishBaselineFixtures({implementation,publish,repo,themeCss}) {
  const entries=[];
  let uploadDataset;
  for(const fixture of browserParityFixtures)for(const theme of parityThemes){
    let body;
    if(implementation==='jsx'){
      if(fixture.oldJsx.includes('{{uploadDataset}}')&&!uploadDataset)uploadDataset=(await publish({title:'Upload baseline backing data',dataset:[{fixture:'upload-baseline'}]})).id;
      const oldJsx=fixture.oldJsx.replaceAll('{{uploadDataset}}',uploadDataset||'');
      const helmet=oldJsx.match(/<Helmet>[\s\S]*?<\/Helmet>/)?.[0]||'';
      const content=oldJsx.replace(helmet,'');
      body={title:`Component baseline ${fixture.id}`,theme:'almanac',colorMode:theme,markup:`${helmet}<div data-design="tw" className="p-6">${content}</div>`};
    }else if(implementation==='html'){
      if(typeof themeCss!=='function')throw Error('Candidate must supply the same actual almanac theme CSS as the original reader');
      const source=fixture.modules.map(name=>`import {register${pascal(name)}} from ${JSON.stringify(path.join(repo,'services/app/lib/html-components',name+'.ts'))};register${pascal(name)}();`).join('\n')+'\n'+(fixture.setup||'')+'\ndocument.documentElement.dataset.baselineReady="yes";';
      const bundle=await build({stdin:{contents:source,resolveDir:repo,sourcefile:'component-baseline.ts'},bundle:true,write:false,format:'esm',minify:true,platform:'browser',alias:{'@':path.join(repo,'services/app')},target:'es2022'});
      const code=bundle.outputFiles[0].text.replaceAll('</script','<\\/script');
      body={html:`<!doctype html><html data-af-design-system="almanac" data-af-dark="${theme==='dark'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await themeCss(theme)}\nbody{margin:0;padding:24px}</style><script src="/af/v1/core.js" data-af="core"></script></head><body>${fixture.newHtml}<script type="module">${code}</script></body></html>`};
    }else throw Error('Unknown implementation');
    const document=await publish(body);
    if(!document.id)throw Error('Publication returned no document id');
    entries.push({fixture:fixture.id,theme,id:document.id});
  }
  return entries;
}
