import {spawnSync} from 'node:child_process';
import {test,expect,onTestFinished} from 'vitest';
import {cp} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {tempDir} from '../../services/test-support/src/temp-dir.ts';
const require=createRequire(import.meta.url);
test('the complete npm PGLite package supports fresh persistence, rollback and restart',async()=>{
 const root=await tempDir('afbin-pglite-runtime-',onTestFinished);
  const directory=dirname(dirname(require.resolve('@electric-sql/pglite')));
  const target=join(root,'pglite');
  await cp(directory,target,{recursive:true});
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {PGlite} from ${JSON.stringify(join(target,'dist/index.js'))};import assert from 'node:assert/strict';let db=new PGlite(${JSON.stringify(join(root,'db'))});await db.exec('create table proof(id int primary key, value int); insert into proof values(1,42)');await assert.rejects(db.transaction(async tx=>{await tx.exec('insert into proof values(2,7)');throw Error('rollback');}));await db.close();db=new PGlite(${JSON.stringify(join(root,'db'))});assert.deepEqual((await db.query('select * from proof')).rows,[{id:1,value:42}]);await db.close();`],{encoding:'utf8',timeout:30000});
  expect(result.stderr).toBe('');expect(result.status).toBe(0);
});

