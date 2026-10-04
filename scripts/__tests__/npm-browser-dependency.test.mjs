import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname,delimiter} from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

function npmDriver(){
 const candidates=[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
 for(const directory of (process.env.PATH??'').split(delimiter)){
  if(!directory)continue;
  const command=join(directory,process.platform==='win32'?'npm.cmd':'npm');
  if(!existsSync(command))continue;
  candidates.push(process.platform==='win32'?join(dirname(realpathSync(command)),'node_modules/npm/bin/npm-cli.js'):realpathSync(command));
 }
 const driver=candidates.find(candidate=>existsSync(candidate));
 if(!driver)throw new Error('Cannot locate npm CLI from the active Node installation or PATH.');
 return driver;
}

it('the npm browser engine retains Chromium API and lazy install without a native watcher',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../services/cli/package.json',import.meta.url),'utf8'));
 const lock=JSON.parse(await readFile(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8'));
 expect(lock.packages['node_modules/fsevents']).toBeUndefined();
 const root=await mkdtemp(join(tmpdir(),'afbin-browser-core-'));
 try{
  await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{playwright:manifest.dependencies.playwright}}));
  // CI invokes Vitest directly: prove this consumer without npm lifecycle variables.
  const env={...process.env};delete env.npm_execpath;
  const installed=spawnSync(process.execPath,[npmDriver(),'install','--offline','--foreground-scripts','--no-audit','--no-fund'],{cwd:root,env,encoding:'utf8',timeout:15000});
  expect(installed.status,installed.stderr).toBe(0);
  expect(installed.stdout+installed.stderr).not.toMatch(/gyp info|gyp ERR/);
  const require=createRequire(join(root,'package.json'));
  const engine=require('playwright');expect(typeof engine.chromium.launch).toBe('function');expect(engine.chromium.executablePath()).toContain('chromium');
  const pkg=require('playwright/package.json');expect(pkg.name).toBe('playwright-core');
  const browsers=join(root,'browsers');
  const dry=spawnSync(process.execPath,[join(dirname(require.resolve('playwright/package.json')),'cli.js'),'install','--dry-run','chromium'],{cwd:root,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers},encoding:'utf8',timeout:10000});
  expect(dry.status,dry.stderr).toBe(0);expect(dry.stdout).toContain('Download url:');expect(dry.stdout).toContain(browsers);
  await expect(readFile(join(root,'node_modules/fsevents/package.json'))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
