import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
/** The deployed app cwd owns skill/source paths, including after server relocation.
 * Production inputs are immutable. Development cache keys cover the local export
 * and canonical recovery graph; dependency installations require a process restart.
 * Output has no installed package or repository imports. */
let cached:{source:string;output:Promise<string>}|undefined;
/** The parser-backed toolbox functions, served from the archive's preview-html.mjs so toolbox-platform.mjs shares its copy. */
const PARSER_SHARED_EXPORTS=`
export {inspectPublicationBundle,authoringHtml} from '../../../lib/html-publication-bundle/plan.ts';
export {recoverPortableSource} from '../../../lib/html-runtime/portable-source.ts';
`;
const PARSER_SHARED=/\/lib\/(?:html-publication-bundle\/plan|html-runtime\/portable-source)\.ts$/;
export async function buildPreviewParser(source:string):Promise<string>{
 const scripts=path.resolve('skills/artifactbin/scripts');
 const graph=await Promise.all(['lib/html-publication-bundle/runtime-module-imports.ts','lib/html-publication-bundle/plan.ts','lib/libraries/index.ts','lib/html-components/hosted.json','lib/html-autofix/index.ts','lib/html-page/index.ts','lib/html-page/html-source.ts','skills/artifactbin/scripts/preview-export.mjs','lib/html-runtime/portable-source.ts','lib/html-runtime/portable.ts','lib/html-runtime/apollo/storable.ts','../utils/src/sha256.ts'].map(file=>readFile(path.resolve(file),'utf8')));
 const cacheKey=JSON.stringify([source,...graph]);
 if(cached?.source===cacheKey)return cached.output;
 const output=build({stdin:{contents:source+PARSER_SHARED_EXPORTS,resolveDir:scripts,loader:'js'},bundle:true,write:false,minify:true,legalComments:'none',format:'esm',platform:'node',target:'node22'}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview parser build was empty');return text;
 }).catch(error=>{if(cached?.output===output)cached=undefined;throw error;});
 cached={source:cacheKey,output};return output;
}

let datasets:Promise<string>|undefined;
/** Same immutable-source lifetime as buildHtmlAssets; no account/platform server entry. It also carries the GraphQL
 * functions toolbox-platform.mjs re-exports, so the archive holds one copy of graphql. */
export function buildPreviewDatasets():Promise<string>{
 const entry=fileURLToPath(new URL('../dataset-graphql/local-preview.ts',import.meta.url));
 return datasets??=build({stdin:{contents:`export * from ${JSON.stringify(entry)};export {parse,getOperationAST,validate,buildSchema} from 'graphql';`,resolveDir:path.dirname(entry),loader:'ts'},bundle:true,write:false,minify:true,legalComments:'none',format:'esm',platform:'node',target:'node22',
  // graphql's ESM build tree-shakes to what local datasets and validation use (~170 KB, against ~250 KB for its CommonJS main).
  mainFields:['module','main']}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview dataset build was empty');return text;
 }).catch(error=>{datasets=undefined;throw error;});
}

/** Native toolbox shares platform credentials, publication planning and GraphQL parsing; installs need only Node.
 * Its HTML parsing (./preview-html.mjs) and GraphQL (./preview-datasets.mjs, which bundles graphql) stay sibling imports. */
export async function buildToolboxPlatform():Promise<string>{
 const siblings={name:'archive-siblings',setup(builder:import('esbuild').PluginBuild){
  builder.onResolve({filter:/^(?:\.\/preview-html\.mjs|graphql)$/},args=>({path:args.path==='graphql'?'./preview-datasets.mjs':args.path,external:true}));
  builder.onResolve({filter:PARSER_SHARED},args=>args.importer.endsWith('toolbox-platform.mjs')?{path:'./preview-html.mjs',external:true}:undefined);
 }};
 const result=await build({entryPoints:[path.resolve('skills/artifactbin/scripts/toolbox-platform.mjs')],bundle:true,write:false,minify:true,legalComments:'none',format:'esm',platform:'node',target:'node22',plugins:[siblings]});
 const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Toolbox platform build was empty');return text;
}
