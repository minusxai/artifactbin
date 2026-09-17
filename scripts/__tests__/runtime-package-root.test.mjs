import {spawnSync} from 'node:child_process';
import {runtimePackageFile} from '../../services/cli/scripts/runtime-package-files.mjs';
import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath,cp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packageRoot} from '../../services/cli/scripts/package-root.mjs';
test('runtime packaging locates native packages whose exports hide package.json and root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-package-root-'));
 try{
  const directory=join(root,'node_modules/@img/native');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'@img/native',version:'1.0.0',exports:{'./binding':'./binding.node'}}));
  expect(await packageRoot('@img/native',root)).toEqual({directory:await realpath(directory),pkg:{name:'@img/native',version:'1.0.0',exports:{'./binding':'./binding.node'}}});
  await expect(packageRoot('missing-package',root)).rejects.toMatchObject({code:'MODULE_NOT_FOUND'});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('trimmed PGLite supports fresh persistence, rollback and restart without extensions or maps',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pglite-runtime-'));
 try{
  const {directory}=await packageRoot('@electric-sql/pglite',process.cwd());
  const target=join(root,'pglite');
  await cp(directory,target,{recursive:true,filter:file=>runtimePackageFile('@electric-sql/pglite',file.slice(directory.length).replace(/^\//,''))});
  const dist=await readdir(join(target,'dist'));
  expect(dist).not.toContain('pgcrypto.tar.gz');expect(dist.some(name=>name.endsWith('.map')||name.endsWith('.cjs'))).toBe(false);
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {PGlite} from ${JSON.stringify(join(target,'dist/index.js'))};import assert from 'node:assert/strict';let db=new PGlite(${JSON.stringify(join(root,'db'))});await db.exec('create table proof(id int primary key, value int); insert into proof values(1,42)');await assert.rejects(db.transaction(async tx=>{await tx.exec('insert into proof values(2,7)');throw Error('rollback');}));await db.close();db=new PGlite(${JSON.stringify(join(root,'db'))});assert.deepEqual((await db.query('select * from proof')).rows,[{id:1,value:42}]);await db.close();`],{encoding:'utf8',timeout:30000});
  expect(result.stderr).toBe('');expect(result.status).toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
