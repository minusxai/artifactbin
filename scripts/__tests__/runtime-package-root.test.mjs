import {spawnSync} from 'node:child_process';
import {test,expect} from 'vitest';
import {mkdtemp,mkdir,rm,cp,readdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
const require=createRequire(import.meta.url);
test('the complete npm PGLite package supports fresh persistence, rollback and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pglite-runtime-'));
 try{
  const directory=dirname(dirname(require.resolve('@electric-sql/pglite')));
  const target=join(root,'pglite');
  await cp(directory,target,{recursive:true});
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {PGlite} from ${JSON.stringify(join(target,'dist/index.js'))};import assert from 'node:assert/strict';let db=new PGlite(${JSON.stringify(join(root,'db'))});await db.exec('create table proof(id int primary key, value int); insert into proof values(1,42)');await assert.rejects(db.transaction(async tx=>{await tx.exec('insert into proof values(2,7)');throw Error('rollback');}));await db.close();db=new PGlite(${JSON.stringify(join(root,'db'))});assert.deepEqual((await db.query('select * from proof')).rows,[{id:1,value:42}]);await db.close();`],{encoding:'utf8',timeout:30000});
  expect(result.stderr).toBe('');expect(result.status).toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('CLI runtime omits execution-only packages while retaining server externals',async()=>{
 const {EXTERNALS,CLI_RUNTIME_EXTERNALS}=await import('../build/runtime-externals.mjs');
 for(const name of ['isolated-vm','@earendil-works/pi-agent-core','@earendil-works/pi-ai','abort-controller','fast-text-encoding','core-js','vite']){
  expect(EXTERNALS).toContain(name);expect(CLI_RUNTIME_EXTERNALS).not.toContain(name);
 }
 for(const name of ['esbuild','pg','@electric-sql/pglite','playwright','playwright-core','@sqlite.org/sqlite-wasm','vega','vega-lite','vega-interpreter','harfbuzzjs','wawoff2','nunjucks'])expect(CLI_RUNTIME_EXTERNALS).toContain(name);
});


test('remote-runner host assets exclude local execution workers while app hosts retain them',async()=>{
 const {copyRunnerAssets}=await import('../build/copy-runner-assets.mjs');
 const root=await mkdtemp(join(tmpdir(),'afbin-runner-assets-'));
 try{
  const local=join(root,'local'),remote=join(root,'remote');await mkdir(local);await mkdir(remote);
  await copyRunnerAssets(local);
  expect((await readdir(local)).sort()).toEqual(['runner-worker.mjs']);
  await copyRunnerAssets(remote,{remoteRunner:true});
  expect(await readdir(remote)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('CLI public assembly includes its complete current reader and other public assets',async()=>{
 const {copyRuntimePublic}=await import('../../services/cli/scripts/build-host.mjs');
 const root=await mkdtemp(join(tmpdir(),'afbin-public-assembly-'));
 try{
  const source=join(root,'source'),destination=join(root,'destination');await mkdir(join(source,'islands'),{recursive:true});await mkdir(join(source,'fonts'));
  const urls={entry:'/islands/rt-1111111111111111.js',dep:'/islands/chunk-2222222222222222.js',lazy:'/islands/chart-3333333333333333.js',ssr:'/islands/ssr-4444444444444444.js',offline:'/islands/offline-5555555555555555.json.gzip',wasm:'/islands/sqlite3-6666666666666666.wasm'};
  const manifest={build:'aaaaaaaaaaaaaaaa',manifest:{'@mx/rt':urls.entry},files:{[urls.entry]:{imports:[urls.dep]},[urls.dep]:{imports:[]},[urls.lazy]:{imports:[]},[urls.wasm]:{imports:[]}},ssr:{url:urls.ssr,exports:{}},offline:urls.offline,sqliteWasm:urls.wasm};
  await writeFile(join(source,'islands/manifest.json'),JSON.stringify(manifest));
  for(const url of Object.values(urls))await writeFile(join(source,url.slice(1)),url);
  for(const suffix of ['.gz','.br']){await writeFile(join(source,urls.entry.slice(1)+suffix),'compressed entry');await writeFile(join(source,'islands/manifest.json'+suffix),'compressed manifest');}
  await writeFile(join(source,'fonts/fixture.woff2'),'font');await writeFile(join(source,'robots.txt'),'public metadata');
  const old='islands/offline-bbbbbbbbbbbbbbbb.json.gzip';await writeFile(join(source,old),'old reader');
  const oldJs='islands/ssr-cccccccccccccccc.js';for(const suffix of ['','.gz','.br'])await writeFile(join(source,oldJs+suffix),'old ssr');
  await copyRuntimePublic(source,destination);
  await expect(readFile(join(destination,old))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(source,old),'utf8')).toBe('old reader');
  for(const suffix of ['','.gz','.br']){await expect(readFile(join(destination,oldJs+suffix))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(source,oldJs+suffix),'utf8')).toBe('old ssr');}
  for(const url of Object.values(urls))expect(await readFile(join(destination,url.slice(1)),'utf8')).toBe(url);
  for(const suffix of ['.gz','.br'])expect(await readFile(join(destination,urls.entry.slice(1)+suffix),'utf8')).toBe('compressed entry');
  expect(JSON.parse(await readFile(join(destination,'islands/manifest.json'),'utf8'))).toEqual(manifest);
  expect(await readFile(join(destination,'fonts/fixture.woff2'),'utf8')).toBe('font');expect(await readFile(join(destination,'robots.txt'),'utf8')).toBe('public metadata');
  for(const suffix of ['.gz','.br'])expect(await readFile(join(destination,'islands/manifest.json'+suffix),'utf8')).toBe('compressed manifest');
  // A missing graph edge or asset must stop packaging, never silently omit it.
  manifest.files[urls.entry].imports=['/islands/missing-7777777777777777.js'];
  await writeFile(join(source,'islands/manifest.json'),JSON.stringify(manifest));
  await expect(copyRuntimePublic(source,join(root,'broken-edge'))).rejects.toThrow(/import is missing/);
  manifest.files[urls.entry].imports=[urls.dep];delete manifest.files[urls.entry];
  await writeFile(join(source,'islands/manifest.json'),JSON.stringify(manifest));
  await expect(copyRuntimePublic(source,join(root,'broken-entry'))).rejects.toThrow(/entry is missing/);
  manifest.files[urls.entry]={imports:[urls.dep]};await writeFile(join(source,'islands/manifest.json'),JSON.stringify(manifest));
  await rm(join(source,urls.ssr.slice(1)));
  await expect(copyRuntimePublic(source,join(root,'broken-ssr'))).rejects.toThrow(/asset is missing/);
  await writeFile(join(source,urls.ssr.slice(1)),urls.ssr);manifest.offline='/islands/../outside.json.gzip';await writeFile(join(source,'islands/manifest.json'),JSON.stringify(manifest));
  await expect(copyRuntimePublic(source,join(root,'broken-path'))).rejects.toThrow(/Invalid CLI reader asset path/);

 }finally{await rm(root,{recursive:true,force:true});}
});
