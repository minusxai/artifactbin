import {spawnSync} from 'node:child_process';
import {test,expect} from 'vitest';
import {mkdtemp,mkdir,rm,cp,readdir} from 'node:fs/promises';
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
  expect((await readdir(local)).sort()).toEqual(['agent.ts.txt','runner-worker.mjs']);
  await copyRunnerAssets(remote,{remoteRunner:true});
  expect(await readdir(remote)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
