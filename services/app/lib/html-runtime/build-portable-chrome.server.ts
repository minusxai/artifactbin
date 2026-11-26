import {build,transform,type Plugin} from 'esbuild';
import {transformAsync} from '@babel/core';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {slimEntities} from './slim-entities.server';
/**
 * The app's own UI compiled for use OUTSIDE the app's Vite build: the Solid trees a page or another shell mounts in a
 * trusted shadow root (lib/ui-runtime/trusted-overlay-host), and the app's Tailwind sheet they carry. Two modules:
 *  - the offline chrome (`@afbin/chrome`, solid/document/browser-portable-chrome): a portable copy's bar, fonts inlined;
 *  - the host comments (solid/document/browser-host-comments): the reader's discussion for a shell on the app's origin
 *    that mounts a document with /af/host.js (lib/html-reader/host-shell), loaded by it only when the shell asks.
 * No private page or session is an input to either.
 */
const app=fileURLToPath(new URL('../../',import.meta.url));
let sheet:Promise<string>|undefined;
/** The app's Tailwind sheet (app/globals.css over its sources), compiled once per process for both modules. */
function appStylesheet():Promise<string>{
 return sheet??=(async()=>{
  const input=await readFile(path.join(app,'app/globals.css'),'utf8');
  const compiler=await compile(input,{base:path.join(app,'web'),onDependency:()=>{}});
  return compiler.build(new Scanner({sources:compiler.sources}).scan());
 })().catch(error=>{sheet=undefined;throw error;});
}
const solid:Plugin={name:'trusted-solid',setup(builder){builder.onLoad({filter:/\.[jt]sx$/},async args=>{
 const source=await readFile(args.path,'utf8');
 const stripped=await transform(source,{loader:args.path.endsWith('.tsx')?'tsx':'jsx',jsx:'preserve',sourcefile:args.path});
 const output=await transformAsync(stripped.code,{filename:args.path,babelrc:false,configFile:false,presets:[['babel-preset-solid',{generate:'dom',hydratable:false}]]});
 if(!output?.code)throw Error('Trusted UI transform failed');
 return {contents:output.code,loader:'js',resolveDir:path.dirname(args.path)};
});}};
/** One ES module: `entry`'s exports and `stylesheet`, the sheet its trusted roots adopt. */
async function buildTrustedModule(entry:string,exports:string,stylesheet:string,plugins:Plugin[]=[]):Promise<string>{
 const file=fileURLToPath(entry);
 const result=await build({bundle:true,minify:true,write:false,platform:'browser',conditions:['browser'],target:'es2022',format:'esm',loader:{'.png':'dataurl'},plugins:[solid,slimEntities,...plugins],stdin:{contents:`export {${exports}} from ${JSON.stringify(file)};export const stylesheet=${JSON.stringify(stylesheet)};`,resolveDir:process.cwd(),loader:'ts'}});
 if(!result.outputFiles?.[0])throw Error(`Trusted UI build of ${path.basename(file)} is empty`);
 return result.outputFiles[0].text;
}
/** Compile the actual shared chrome/styles once; no private page or session is an input. */
export async function buildPortableChrome():Promise<string>{
 let stylesheet=await appStylesheet();
 const manifest=JSON.parse(await readFile(path.join(app,'lib/html-systems/font-manifest.json'),'utf8')) as {app:{family:string;url:string;weight:string;style:string;format:string;unicodeRange?:string}[]};
 for(const font of manifest.app.filter(font=>['JetBrains Mono Variable','IBM Plex Sans'].includes(font.family)&&/^U\+0+(?:-|,|$)/i.test(font.unicodeRange??''))){
  // `/af/fonts/<file>` is public/fonts/<file> (server/public-files).
  const bytes=await readFile(path.join(app,'public/fonts',path.basename(font.url)));
  stylesheet+=`@font-face{font-family:${JSON.stringify(font.family)};font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format(${JSON.stringify(font.format)});}`;
 }
 return buildTrustedModule(new URL('../../solid/document/browser-portable-chrome.tsx',import.meta.url).href,'mountPortableChrome',stylesheet);
}
/**
 * lib/markdown's Prism grammars as none: code renders as plain `<pre><code>` and the editor decorates nothing. The host
 * comments module is one file (no lazy chunk can stay out of it), and with lib/markdown's parser and serializer, which
 * comments read and write through, Prism (about 9 KB gzipped) no longer fits its budget (build.test.ts). The app's own
 * comments keep highlighting: there Prism is a lazy chunk.
 */
const noCodeGrammars:Plugin={name:'no-code-grammars',setup(builder){
 builder.onResolve({filter:/^\.\/prism-grammars$/},({importer})=>/[\\/]lib[\\/]markdown[\\/]/.test(importer)?{path:'prism-grammars',namespace:'no-code-grammars'}:undefined);
 builder.onLoad({filter:/.*/,namespace:'no-code-grammars'},()=>({contents:'export default {languages:{},tokenize:()=>[]};',loader:'js'}));
}};
/**
 * The host comments module: the app's sheet without fonts (a shell on the app's origin loads `/af/fonts` faces itself,
 * and a shell that sets the theme tokens names its own families), and no code highlighting (noCodeGrammars above).
 */
export async function buildHostComments():Promise<string>{
 return buildTrustedModule(new URL('../../solid/document/browser-host-comments.tsx',import.meta.url).href,'mountHostComments',await appStylesheet(),[noCodeGrammars]);
}
