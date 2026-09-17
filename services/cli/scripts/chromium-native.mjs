/** CI-only distribution build: package the complete Playwright-pinned Chromium tree. */
import {createRequire} from 'node:module';
import {dirname,basename,join,resolve,relative} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {archiveDirectory} from './runtime-archive.mjs';
const require=createRequire(import.meta.url);
export async function chromiumNative(){
 const playwright=require('playwright');
 execFileSync(process.execPath,[join(dirname(require.resolve('playwright/package.json')),'cli.js'),'install','chromium'],{stdio:'inherit'});
 const executable=playwright.chromium.executablePath();
 // Chromium on macOS lives inside an app bundle; retain its frameworks and relative links.
 let root=dirname(executable);
 while(!/^chromium-\d+$/.test(basename(root))){const parent=dirname(root);if(parent===root)throw new Error('Unexpected Playwright Chromium layout');root=parent;}
 const version=JSON.parse(await readFile('package.json','utf8')).version;
 const file=`afbin-chromium-${process.platform}-${process.arch}.gz`;
 const spec=await archiveDirectory(root,{prefix:'node_modules/chromium',cache:resolve('.cache/chromium-archive'),out:resolve('dist',file),url:`https://github.com/minusxai/artifactbin/releases/download/afbin-v${version}/${file}`});
 const manifest={...spec,executable:'node_modules/chromium/'+relative(root,executable).split('\\').join('/'),version:basename(root)};
 const asset=resolve('dist/chromium.manifest.json');await writeFile(asset,JSON.stringify(manifest)+'\n');return {asset,file};
}
