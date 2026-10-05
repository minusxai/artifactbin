/** The preview's own browser bundle: Solid only, over the compiled document the server already sent. */
import {documentUiFontCss} from '../../app/lib/serving/app-font-face-css.mjs';
import {build, transform} from 'esbuild';
import {transformAsync} from '@babel/core';
// @ts-expect-error babel-preset-solid ships no types; it is a Babel preset function.
import solidPreset from 'babel-preset-solid';
import {compile,optimize} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..'),app=resolve(cli,'../app');

/**
 * esbuild plugin: Solid's JSX transform over every `.tsx` this bundle reaches (TypeScript and JSX
 * pragmas stripped by esbuild first — which also elides a type-only React type import,
 * so it never reaches the check below — then Babel's Solid preset, exactly as build-islands.mjs runs
 * it over lib/islands). A `.tsx` that still imports React VALUES after that refuses the build: this
 * bundle carries no react/react-dom (services/cli/test/preview.test.ts asserts it on the built file too).
 */
function solidPreviewPlugin(){
 return {name:'preview-solid',setup(b){
  b.onLoad({filter:/\.tsx$/},async args=>{
   if(args.path.includes('/node_modules/'))return undefined;
   const source=await readFile(args.path,'utf8');
   const stripped=(await transform(source,{loader:'tsx',jsx:'preserve',sourcefile:args.path})).code;
   if(/\bfrom\s*['"]react(?:-dom(?:\/client)?)?['"]/.test(stripped))throw new Error(`preview bundle: ${args.path} imports react`);
   const out=await transformAsync(stripped,{
    filename:args.path,babelrc:false,configFile:false,sourceType:'module',compact:false,
    presets:[[solidPreset,{generate:'dom',hydratable:false}]],
   });
   if(!out?.code)throw new Error(`preview bundle: the Solid transform produced nothing for ${args.path}`);
   return {contents:out.code,loader:'js',resolveDir:dirname(args.path)};
  });
 }};
}

export async function buildPreview(outdir=join(cli,'dist/runtime/preview')){
 await mkdir(outdir,{recursive:true});
 const compiler=await compile(await readFile(join(app,'app/globals.css'),'utf8'),{base:join(app,'app'),onDependency:()=>{}});
 const scanner=new Scanner({sources:compiler.sources});
 await writeFile(join(outdir,'fonts.css'),documentUiFontCss(JSON.parse(await readFile(join(app,'lib/data/story/story-font-manifest.json'),'utf8')).app));
 await writeFile(join(outdir,'chrome.css'),optimize(compiler.build(scanner.scan()),{minify:true}).code);
 await build({
  entryPoints:[join(cli,'src/preview/client.tsx'),join(cli,'src/preview/connect.tsx')],bundle:true,minify:true,format:'esm',splitting:true,outdir,
  platform:'browser',target:'es2022',alias:{'@':app},define:{'process.env.NODE_ENV':'"production"'},
  loader:{'.png':'dataurl','.woff2':'dataurl','.css':'empty'},plugins:[solidPreviewPlugin()],
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildPreview();
