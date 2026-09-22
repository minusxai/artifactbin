/** Research probe, not a product test suite. Run on Windows CI; emits observations. */
import {copyFile, mkdtemp, mkdir, writeFile, readFile, chmod, stat, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, win32} from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
const output = resolve(process.argv[2] || '.agent/windows-evidence');
await mkdir(output, {recursive:true});
const directory = await mkdtemp(join(tmpdir(), 'afbin windows é '));
const observations = [];
async function observe(name, action) {
  try {observations.push({name, result:await action()});}
  catch(error) {observations.push({name, error:{code:error.code, message:error.message}});}
}
const require = createRequire(join(output, 'package.json'));
await observe('mode-roundtrip', async()=>{
  const file=join(directory,'private.txt');
  await writeFile(file,'disposable research data',{mode:0o600}); await chmod(file,0o600);
  const mode=(await stat(file)).mode&0o777;
  return {requested:'600',actual:mode.toString(8),currentCacheCheckAccepts:mode===0o600};
});
await observe('ordinary-file-replacement',async()=>{
  const file=join(directory,'old.txt'), staged=join(directory,'new.txt');
  await writeFile(file,'old');await writeFile(staged,'new');await rename(staged,file);
  return {bytes:await readFile(file,'utf8')};
});
await observe('running-executable-replacement',async()=>{
  const exe=join(directory,process.platform==='win32'?'running.exe':'running');
  const staged=join(directory,process.platform==='win32'?'staged.exe':'staged');
  await copyFile(process.execPath,exe);await chmod(exe,0o700);await copyFile(process.execPath,staged);
  const child=spawn(exe,['-e','console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  try {
    await Promise.race([once(child.stdout,'data'),once(child,'error').then(([e])=>{throw e;}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('child readiness timed out')),10000);t.unref();})]);
    try {await rename(staged,exe);return {replacement:'succeeded while running'};}
    catch(error){return {replacement:'blocked while running',code:error.code};}
  } finally {child.kill();await exited;}
});
await observe('windows-path-shapes',async()=>({
  sqlPluginMatches:/sql\/src\/engine\.ts$/.test('C:\\repo\\services\\sql\\src\\engine.ts'),
  ptyPluginMatches:/src\/pty\.ts$/.test('C:\\repo\\services\\cli\\src\\pty.ts'),
  relative:win32.relative('C:\\cache','C:\\cache\\node_modules\\runtime'),
  currentLinkCheckAccepts:win32.relative('C:\\cache','C:\\cache\\node_modules\\runtime').startsWith('node_modules/'),
  binaryFilename:'afbin-win32-x64.exe',currentManifestFilename:'afbin-win32-x64'
}));
await observe('duckdb-query',async()=>{
  const {DuckDBInstance}=require('@duckdb/node-api');
  const instance=await DuckDBInstance.create(':memory:'); const connection=await instance.connect();
  try {const result=await connection.runAndReadAll('select 42::INTEGER as answer');return result.getRowObjects();}
  finally {connection.closeSync();instance.closeSync();}
});
await observe('sharp-png',async()=>{
  const sharp=require('sharp');const png=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer();
  return {bytes:png.length,format:(await sharp(png).metadata()).format};
});
await observe('pty-smoke',async()=>{
  const pty=require('node-pty');
  return await new Promise((resolveProbe,reject)=>{
    const shell=process.platform==='win32'?'cmd.exe':'/bin/sh';
    const args=process.platform==='win32'?['/d','/s','/c','echo AFBIN_PTY_OK']:['-c','echo AFBIN_PTY_OK'];
    const child=pty.spawn(shell,args,{name:'xterm',cols:80,rows:24,cwd:directory,env:process.env});let data='';
    const timeout=setTimeout(()=>{child.kill();reject(Error('PTY timeout'));},10000);
    child.onData(chunk=>{data+=chunk;});child.onExit(({exitCode})=>{clearTimeout(timeout);resolveProbe({exitCode,marker:data.includes('AFBIN_PTY_OK')});});
  });
});
await observe('playwright-chromium',async()=>{
  const {chromium}=require('playwright');const browser=await chromium.launch({headless:true});
  try {const page=await browser.newPage();await page.setContent('<h1>Windows probe</h1>');return {heading:await page.locator('h1').innerText(),executable:chromium.executablePath()};}
  finally {await browser.close();}
});
await observe('installed-dependency-versions',async()=>Object.fromEntries(['node-pty','@duckdb/node-api','sharp','playwright','postject'].map(name=>[name,require(name+'/package.json').version])));
const report={platform:process.platform,arch:process.arch,node:process.version,kind:'research observations; not full CLI validation',observations};
await writeFile(join(output,'observations.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});
