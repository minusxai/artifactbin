import {getAsset,isSea} from 'node:sea';
import {createRequire} from 'node:module';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {configDir,servicePackageUrl} from './config';
import {ensureNativePackage,type NativePackage} from './native-package';
export interface ChromiumPackage extends NativePackage {executable:string;version:string}
/** Composition-level preparation is outside render deadlines; normal hosts keep their installed browser. */
export async function prepareChromium(options:{manifest:ChromiumPackage;root:string;fetch?:typeof fetch}):Promise<string>{
 const {manifest}=options;
 const file=manifest.files.find(file=>file.path===manifest.executable);
 if(!file||file.link!==undefined||file.mode!==0o700||!/^chromium-\d+$/.test(manifest.version))throw new Error('Invalid Chromium executable manifest.');
 const root=await ensureNativePackage(manifest,{root:join(options.root,manifest.version),kind:'chromium',fetch:options.fetch});
 return join(root,manifest.executable);
}
let ready:Promise<string>|undefined;
export function chromiumExecutable():Promise<string>{
 return ready??=loadChromium().catch(error=>{ready=undefined;throw error;});
}
async function loadChromium():Promise<string>{
 if(isSea()){
  const manifest=JSON.parse(Buffer.from(getAsset('chromium-manifest')).toString()) as ChromiumPackage;
  return prepareChromium({manifest:{...manifest,url:servicePackageUrl(manifest.url)},root:join(configDir(),'services/chromium')});
 }
 // npm owns platform-native dependencies; Playwright owns its pinned browser distribution.
 const require=createRequire(import.meta.url);
 const executable=(require('playwright') as typeof import('playwright')).chromium.executablePath();
 try{await access(executable,constants.X_OK);}catch{await promisify(execFile)(process.execPath,[join(dirname(require.resolve('playwright/package.json')),'cli.js'),'install','chromium']);}
 return executable;
}
