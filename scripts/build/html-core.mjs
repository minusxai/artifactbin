import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
/** Build the source-relative browser runtime before the server becomes one relocated file. */
function compileCore(root){
 const entry=pathToFileURL(path.resolve(root,'services/app/lib/html-runtime/build.server.ts')).href;
 return execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`const {buildHtmlCore}=await import(${JSON.stringify(entry)});process.stdout.write(await buildHtmlCore());`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
}
export function prebuiltHtmlCore(root,compile=()=>compileCore(root)){
 const entry=realpathSync(path.resolve(root,'services/app/lib/html-runtime/build.server.ts'));let source;
 return {name:'prebuilt-html-core',setup(builder){builder.onLoad({filter:/html-runtime[/\\]build\.server\.ts$/},args=>{
  if(args.path!==entry)return;
  source??=compile();if(!source.trim())throw Error('HTML core is empty');
  return {contents:`export async function buildHtmlCore(){return ${JSON.stringify(source)}}`,loader:'js'};
 });}};
}
