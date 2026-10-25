import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
/** The deployed app cwd owns skill/source paths, including after server relocation.
 * Production inputs are immutable. Development cache keys cover the local export
 * and canonical recovery graph; dependency installations require a process restart.
 * Output has no installed package or repository imports. */
let cached:{source:string;output:Promise<string>}|undefined;
export async function buildPreviewParser(source:string):Promise<string>{
 const scripts=path.resolve('skills/artifactbin/scripts');
 const graph=await Promise.all(['lib/html-publication-bundle/runtime-module-imports.ts','skills/artifactbin/scripts/preview-export.mjs','lib/html-runtime/portable-source.ts','lib/html-runtime/portable.ts','lib/html-runtime/apollo/storable.ts','../utils/src/sha256.ts'].map(file=>readFile(path.resolve(file),'utf8')));
 const cacheKey=JSON.stringify([source,...graph]);
 if(cached?.source===cacheKey)return cached.output;
 const output=build({stdin:{contents:source,resolveDir:scripts,loader:'js'},bundle:true,write:false,minify:true,format:'esm',platform:'node',target:'node22'}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview parser build was empty');return text;
 }).catch(error=>{if(cached?.output===output)cached=undefined;throw error;});
 cached={source:cacheKey,output};return output;
}

let datasets:Promise<string>|undefined;
/** Same immutable-source lifetime as buildHtmlAssets; no account/platform server entry. */
export function buildPreviewDatasets():Promise<string>{
 return datasets??=build({entryPoints:[fileURLToPath(new URL('../dataset-graphql/local-preview.ts',import.meta.url))],bundle:true,write:false,minify:true,format:'esm',platform:'node',target:'node22'}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview dataset build was empty');return text;
 }).catch(error=>{datasets=undefined;throw error;});
}
