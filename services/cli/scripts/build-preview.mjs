/** The preview ships the production editor and its actual app stylesheet. No replacement chrome. */
import {build} from 'esbuild';
import {compile,optimize} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..'),app=resolve(cli,'../app');
export async function buildPreview(outdir=join(cli,'dist/runtime/preview')){
 await mkdir(outdir,{recursive:true});
 const compiler=await compile(await readFile(join(app,'app/globals.css'),'utf8'),{base:join(app,'app'),onDependency:()=>{}});
 const scanner=new Scanner({sources:compiler.sources});
 await writeFile(join(outdir,'chrome.css'),optimize(compiler.build(scanner.scan()),{minify:true}).code);
 await build({entryPoints:[join(cli,'src/preview/client.tsx')],bundle:true,minify:true,format:'esm',splitting:true,outdir,platform:'browser',target:'es2022',jsx:'automatic',alias:{'@':app},define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'dataurl','.css':'empty'},plugins:[{
  // The same offline-capable production pane, without a second JSX framework's mount adapter.
  name:'preview-source-pane',setup(b){b.onResolve({filter:/\/components\/SolidSourceEditorPane$/},()=>({path:join(app,'components/SourceEditorPane.tsx')}));},
 }]});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildPreview();
