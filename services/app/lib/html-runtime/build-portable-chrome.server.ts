import {build,transform,type Plugin} from 'esbuild';
import {transformAsync} from '@babel/core';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
/** Compile the actual shared chrome/styles once; no private page or session is an input. */
export async function buildPortableChrome():Promise<string>{
 const app=fileURLToPath(new URL('../../',import.meta.url));
 const input=await readFile(path.join(app,'app/globals.css'),'utf8');
 const compiler=await compile(input,{base:path.join(app,'web'),onDependency:()=>{}});
 let stylesheet=compiler.build(new Scanner({sources:compiler.sources}).scan());
 const manifest=JSON.parse(await readFile(path.join(app,'lib/story-design/story-font-manifest.json'),'utf8')) as {app:{family:string;url:string;weight:string;style:string;format:string;unicodeRange?:string}[]};
 for(const font of manifest.app.filter(font=>['JetBrains Mono Variable','IBM Plex Sans'].includes(font.family)&&/^U\+0+(?:-|,|$)/i.test(font.unicodeRange??''))){
  const bytes=await readFile(path.join(app,'public',font.url));
  stylesheet+=`@font-face{font-family:${JSON.stringify(font.family)};font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format(${JSON.stringify(font.format)});}`;
 }
 const solid:Plugin={name:'portable-solid',setup(builder){builder.onLoad({filter:/\.[jt]sx$/},async args=>{
  const source=await readFile(args.path,'utf8');
  const stripped=await transform(source,{loader:args.path.endsWith('.tsx')?'tsx':'jsx',jsx:'preserve',sourcefile:args.path});
  const output=await transformAsync(stripped.code,{filename:args.path,babelrc:false,configFile:false,presets:[['babel-preset-solid',{generate:'dom',hydratable:false}]]});
  if(!output?.code)throw Error('Portable chrome transform failed');
  return {contents:output.code,loader:'js',resolveDir:path.dirname(args.path)};
 });}};
 const entry=fileURLToPath(new URL('../../solid/document/browser-portable-chrome.tsx',import.meta.url));
 const result=await build({bundle:true,minify:true,write:false,platform:'browser',conditions:['browser'],target:'es2022',format:'esm',loader:{'.png':'dataurl'},plugins:[solid],stdin:{contents:`export {mountPortableChrome} from ${JSON.stringify(entry)};export const stylesheet=${JSON.stringify(stylesheet)};`,resolveDir:process.cwd(),loader:'ts'}});
 if(!result.outputFiles?.[0])throw Error('Portable chrome build is empty');
 return result.outputFiles[0].text;
}
