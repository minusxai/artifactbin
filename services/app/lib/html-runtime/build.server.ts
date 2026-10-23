import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
/** Build once per source revision; callers may cache this immutable core. */
export async function buildHtmlCore(): Promise<string> {
  const module = await build({ entryPoints: [fileURLToPath(new URL('./browser-client.ts', import.meta.url))], bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const source = module.outputFiles?.[0]?.text;
  if (!source) throw new Error('HTML runtime build produced no module');
  const entry = `import { installHtmlReaderCommands } from ${JSON.stringify(fileURLToPath(new URL('../html-bridge/reader.ts', import.meta.url)))};
import { openFrameDoor } from ${JSON.stringify(fileURLToPath(new URL('../islands/frame-door.ts', import.meta.url)))};
const config=JSON.parse(document.querySelector('[data-af="runtime"]').textContent);
if(!config.initialState){try{config.initialState=JSON.parse(document.querySelector('[data-af="state"]')?.textContent||'{}')}catch{config.initialState={}}}
const url=URL.createObjectURL(new Blob([${JSON.stringify(source)}.replaceAll('__AF_RUNTIME_CONFIG__',JSON.stringify(config))],{type:'text/javascript'}));
const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports:{'@afbin/apollo':url}});document.currentScript.after(map);
const runtime=import(url);
if(config.appOrigin&&!config.offline&&window.parent!==window){installHtmlReaderCommands(window,config.appOrigin);openFrameDoor(window,config.appOrigin,()=>runtime);}`;
  const core = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
  return core.outputFiles?.[0]?.text ?? '';
}
