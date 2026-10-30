import {it,expect} from 'vitest';
import {skillRelease} from '../package';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
it('validates release contents without evaluating scripts and rejects corruption',async()=>{
 const {decodeRelease}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs'));
 const release=skillRelease({'SKILL.md':'hello','scripts/read.mjs':'throw Error("never execute")'},'https://example.test');
 expect(decodeRelease(Buffer.from(release.bytes),release.manifest)['SKILL.md']).toBe('hello');
 const broken=Buffer.from(release.bytes);broken[40]^=1;
 expect(()=>decodeRelease(broken,release.manifest)).toThrow();
 const traversal=Buffer.from(Buffer.from(release.bytes).toString('latin1').replaceAll('scripts/read.mjs','../evil/xxxx.mjs'),'latin1');
 expect(()=>decodeRelease(traversal,{...release.manifest,sha256:createHash('sha256').update(traversal).digest('hex')})).toThrow();
 expect(()=>decodeRelease(Buffer.alloc(32*1024*1024+1),release.manifest)).toThrow();
});

import {mkdtemp,writeFile,readFile,access,rm,cp,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
it('updates isolated installs once, preserves data and symlinks, and returns promptly with a stalled endpoint',async()=>{
 const {update}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs'));
 const root=await mkdtemp(path.join(tmpdir(),'skill-update-'));
 let stalled=false;
 let release:ReturnType<typeof skillRelease>;
 const server=createServer((req,res)=>{if(stalled)return;res.end(req.url?.endsWith('latest.json')?JSON.stringify(release.manifest):Buffer.from(release.bytes));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No address');
 const origin=`http://127.0.0.1:${address.port}`;
 const scripts=path.join(root,'scripts');
 await cp(path.dirname(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs')),scripts,{recursive:true});
 const probe=`import {beforeCommand} from './toolbox-update.mjs'; if(!await beforeCommand(import.meta.url,process.argv.slice(2))) console.log(JSON.stringify(process.argv.slice(2).filter(a=>a!=='--no-update')));`;
 await writeFile(path.join(scripts,'probe.mjs'),probe);
 await writeFile(path.join(root,'release.json'),JSON.stringify({schemaVersion:1,origin,version:'0'.repeat(64)}));
 await writeFile(path.join(root,'personal.txt'),'retain');await symlink(root,root+'-link');
 release=skillRelease({'SKILL.md':'new skill','scripts/probe.mjs':probe,'scripts/toolbox-update.mjs':await readFile(path.join(scripts,'toolbox-update.mjs'),'utf8')},origin);
 const run=(args:string[],env={})=>new Promise<{out:string,err:string,code:number|null}>(resolve=>{const child=spawn(process.execPath,[path.join(root+'-link','scripts/probe.mjs'),...args],{env:{...process.env,...env}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({out,err,code}));});
 try{
  await run(['--no-update']);await run([],{ARTIFACTBIN__NO_UPDATE:'1'});await run(['--help']);
  await expect(access(path.join(root,'.artifactbin-updates'))).rejects.toThrow();
  expect((await update(root)).status).toBe('staged');
  expect((await update(root)).status).toBe('current');
  const results=await Promise.all([run(['a b','--literal']),run(['second'])]);
  expect(results[0].out.trim()).toBe('["a b","--literal"]');expect(results.every(r=>r.code===0)).toBe(true);
  expect(await readFile(path.join(root,'personal.txt'),'utf8')).toBe('retain');
  expect((await run(['--no-update'])).err).toBe('');
  expect((await run([],{ARTIFACTBIN__NO_UPDATE:'1'})).err).toBe('');
  stalled=true;const start=performance.now();expect((await run(['foreground'])).code).toBe(0);
  const duration=performance.now()-start;console.log('stalled endpoint foreground ms:',duration);expect(duration).toBeLessThan(1500);
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  await expect(update(root)).rejects.toThrow();
  expect((await run(['offline'])).code).toBe(0);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});await rm(root+'-link',{force:true});}
});
