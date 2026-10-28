import {createRequire} from 'node:module';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
/** Browser preparation is outside render deadlines; npm and Playwright own distribution. */
export async function prepareChromium(options:{executable:string;install:()=>Promise<unknown>}):Promise<string>{
 try{await access(options.executable,constants.X_OK);}catch{
  await options.install();
  await access(options.executable,constants.X_OK);
 }
 return options.executable;
}
let ready:Promise<string>|undefined;
export function chromiumExecutable():Promise<string>{
 return ready??=loadChromium().catch(error=>{ready=undefined;throw error;});
}
async function loadChromium():Promise<string>{
 // Engine-selection boundary: the npm alias uses Playwright Core without its optional native watcher.
 // Retain the playwright module name for shared host code; load it only when a browser is requested.
 const require=createRequire(import.meta.url);
 const executable=(require('playwright') as typeof import('playwright')).chromium.executablePath();
 return prepareChromium({executable,install:()=>promisify(execFile)(process.execPath,[join(dirname(require.resolve('playwright/package.json')),'cli.js'),'install','chromium'])});
}
