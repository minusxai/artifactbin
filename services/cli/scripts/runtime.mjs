/** Ordinary CLI builds consume reviewed runtime pins; they never compile Node. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {downloadRuntime} from './runtime-package.mjs';
export function runtimePin(lock,platform,arch){
 const key=`${platform}-${arch}`,entry=lock.platforms?.[key];
 if(lock.schema!==1||!/^cli-node-v\d+\.\d+\.\d+-r\d+$/.test(lock.release)||!entry)throw new Error(`No pinned prebuilt runtime for ${key}. Run the dedicated CLI runtime workflow and update runtime-lock.json.`);
 if(entry.recipe?.platform!==platform||entry.recipe?.arch!==arch||entry.recipe?.version!==lock.version||entry.recipe?.intl!==(platform==='win32'?'full-icu':'small-icu'))throw new Error('Prebuilt runtime recipe does not match its pin.');
 if(platform==='win32'){if(arch!=='x64'||entry.format!=='raw'||entry.url!==`https://nodejs.org/download/release/v${lock.version}/win-x64/node.exe`)throw new Error('Invalid official Windows runtime pin.');return entry;}
 return {...entry,url:`https://github.com/minusxai/artifactbin/releases/download/${lock.release}/afbin-node-${key}.gz`};
}
export async function provisionRuntime(){
 const lock=JSON.parse(await readFile(new URL('../runtime-lock.json',import.meta.url),'utf8'));
 const pin=runtimePin(lock,process.platform,process.arch);
 return downloadRuntime(pin,{root:fileURLToPath(new URL('../../../node_modules/.cache/cli-prebuilt-node',import.meta.url))});
}
