import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from '../src/files';
import {stageFiles,recoverFiles,confinedPath} from '../src/journal';

async function fixture(run:(root:string)=>Promise<void>) {
 const root=await mkdtemp(join(tmpdir(),'afbin-journal-'));
 try {await run(root);} finally {await rm(root,{recursive:true,force:true});}
}
test('rejects external symlinks and traversal, but resolves internal symlinks',()=>fixture(async root=>{
 await writeFile(join(root,'real'),'old');
 await symlink('real',join(root,'inside'));
 assert.equal(await confinedPath(root,'inside'),await confinedPath(root,'real'));
 await symlink(tmpdir(),join(root,'outside'));
 await assert.rejects(confinedPath(root,'outside/escape'),/outside/);
 await assert.rejects(confinedPath(root,'../escape'),/outside/);
}));
test('checks all expected hashes before writing and preserves a later local edit',()=>fixture(async root=>{
 await writeFile(join(root,'one'),'old');await writeFile(join(root,'two'),'old');
 await stageFiles(root,[{path:'one',before:digest('old'),data:Buffer.from('new')},{path:'two',before:digest('old'),data:Buffer.from('new')}]);
 await writeFile(join(root,'two'),'user edit');
 await assert.rejects(recoverFiles(root),/changed/);
 assert.equal(await readFile(join(root,'one'),'utf8'),'old');
 assert.equal(await readFile(join(root,'two'),'utf8'),'user edit');
}));
for(const after of [0,1,2])test(`recovers a real process death after ${after} replacements`,()=>fixture(async root=>{
 await writeFile(join(root,'binary'),Buffer.from([0,255,1]));
 await writeFile(join(root,'skill'),'old skill');
 const changes=[{path:'binary',before:digest(Buffer.from([0,255,1])),data:Buffer.from([0,254,2]),mode:0o700},{path:'skill',before:digest('old skill'),data:Buffer.from('new skill')}];
 await stageFiles(root,changes);
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {recoverFiles} from ${JSON.stringify(new URL('../src/journal.ts',import.meta.url).href)}; await recoverFiles(${JSON.stringify(root)}, {onProgress:n=>{if(n===${after})process.kill(process.pid,'SIGKILL')}});`],{stdio:'pipe'});
 assert.equal(child.signal,'SIGKILL',child.stderr.toString());
 assert.equal(await recoverFiles(root),'recovered');
 assert.deepEqual(await readFile(join(root,'binary')),Buffer.from([0,254,2]));
 assert.equal(await readFile(join(root,'skill'),'utf8'),'new skill');
 assert.equal(await recoverFiles(root),'clean');
}));
test('staging is exclusive and corrupt payloads cannot be applied',()=>fixture(async root=>{
 await stageFiles(root,[{path:'doc',before:null,data:Buffer.from('new')}]);
 await assert.rejects(stageFiles(root,[{path:'other',before:null,data:Buffer.from('other')}]),/pending/);
 const path=join(root,'.artifactbin','pending-files.json');
 const journal=JSON.parse(await readFile(path,'utf8'));journal.files[0].data=Buffer.from('tampered').toString('base64');await writeFile(path,JSON.stringify(journal));
 await assert.rejects(recoverFiles(root),/checksum/);
 await assert.rejects(readFile(join(root,'doc')),{code:'ENOENT'});
}));
test('file operations cannot overwrite their recovery journal or process lock',()=>fixture(async root=>{
 for(const path of ['.artifactbin/pending-files.json','.artifactbin/process-lock.sqlite','.artifactbin/pending-request.json']){
  await assert.rejects(stageFiles(root,[{path,before:null,data:Buffer.from('corrupt')}]),/reserved/);
 }
}));
