import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
/** Source-keyed cache: deployed source is immutable, development edits invalidate
 * the generated parser. Output has no installed package or repository imports. */
let cached:{source:string;output:Promise<string>}|undefined;
export function buildPreviewParser(source:string):Promise<string>{
 if(cached?.source===source)return cached.output;
 const output=build({stdin:{contents:source,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,minify:true,format:'esm',platform:'node',target:'node22'}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview parser build was empty');return text;
 }).catch(error=>{if(cached?.output===output)cached=undefined;throw error;});
 cached={source,output};return output;
}

let datasets:Promise<string>|undefined;
/** Same immutable-source lifetime as buildHtmlAssets; no account/platform server entry. */
export function buildPreviewDatasets():Promise<string>{
 return datasets??=build({entryPoints:[fileURLToPath(new URL('../dataset-graphql/local-preview.ts',import.meta.url))],bundle:true,write:false,minify:true,format:'esm',platform:'node',target:'node22'}).then(result=>{
  const text=result.outputFiles?.[0]?.text;if(!text)throw Error('Preview dataset build was empty');return text;
 }).catch(error=>{datasets=undefined;throw error;});
}
