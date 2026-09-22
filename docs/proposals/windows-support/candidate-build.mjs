/** CI-only core-authoring candidate. Optional host/SQL/Chromium distributions are deliberately not packaged. */
import {build} from 'esbuild';
import {inject} from 'postject';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
if(process.platform!=='win32')throw Error('This candidate build runs only in Windows CI.');
const out=resolve('.agent/windows-candidate');await mkdir(out,{recursive:true});
const files={},ptyRoot=dirname(require.resolve('node-pty/package.json'));
async function collect(relative=''){
 for(const entry of await readdir(join(ptyRoot,relative),{withFileTypes:true})){
  if(entry.name==='node_modules')continue;
  const file=join(relative,entry.name);
  if(entry.isDirectory())await collect(file);else files[file]=(await readFile(join(ptyRoot,file))).toString('base64');
 }
}
await collect();await writeFile(join(out,'pty.gz'),gzipSync(JSON.stringify(files)));
const productionBuild=await readFile('services/cli/scripts/binary.mjs','utf8');
const loader=productionBuild.match(/const loader = `([\s\S]*?)`;/)?.[1];if(!loader)throw Error('Production PTY loader changed.');
const browserSource=await readFile('services/cli/src/browser-auth.ts','utf8');
const old="execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {timeout:10000},";
if(!browserSource.includes(old))throw Error('Browser launcher changed.');
const browserCandidate=browserSource.replace(old,"execFile('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(\"Start-Process -FilePath '\"+url.replace(/'/g,\"''\")+\"'\",'utf16le').toString('base64')], {timeout:10000},");
await build({entryPoints:['services/cli/src/main.ts'],outfile:join(out,'core.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['@duckdb/node-api'],plugins:[{name:'windows-research-candidate',setup(b){
 b.onLoad({filter:/src[\\/]pty\.ts$/},()=>({contents:loader,loader:'js'}));
 b.onLoad({filter:/src[\\/]browser-auth\.ts$/},args=>({contents:browserCandidate,loader:'ts',resolveDir:dirname(args.path)}));
}}]});
const config=join(out,'sea.json'),blob=join(out,'sea.blob'),exe=join(out,'afbin-win32-x64.exe');
await writeFile(config,JSON.stringify({main:join(out,'core.cjs'),output:blob,disableExperimentalSEAWarning:true,useCodeCache:false,useSnapshot:false,assets:{pty:join(out,'pty.gz')}}));
execFileSync(process.execPath,['--experimental-sea-config',config],{stdio:'inherit'});
await copyFile(process.execPath,exe);await inject(exe,'NODE_SEA_BLOB',await readFile(blob),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
execFileSync(exe,['--version','--json'],{stdio:'inherit'});
await writeFile(join(out,'SHA256SUMS'),createHash('sha256').update(await readFile(exe)).digest('hex')+'  afbin-win32-x64.exe\n');
await writeFile(join(out,'scope.json'),JSON.stringify({scope:'core artifact authoring research candidate',entry:'services/cli/src/main.ts',changes:['portable PTY plugin path','PowerShell browser launcher'],omitted:['local SQL service package','local Chromium service package','preview/serve host distribution'],notAProductionRelease:true},null,2));
