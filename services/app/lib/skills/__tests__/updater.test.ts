import {it,expect} from 'vitest';
import {skillRelease} from '../package';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
it('validates release contents without evaluating scripts and rejects corruption',async()=>{
 const {decodeRelease}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs'));
 const release=skillRelease({'SKILL.md':'hello','scripts/read.mjs':'throw Error("never execute")'},'https://example.test');
 expect(decodeRelease(Buffer.from(release.bytes),release.manifest)['SKILL.md']).toBe('hello');
 const broken=Buffer.from(release.bytes);broken[40]^=1;
 expect(()=>decodeRelease(broken,release.manifest)).toThrow();
 const traversal=Buffer.from(Buffer.from(release.bytes).toString('latin1').replaceAll('scripts/read.mjs','../evil/xxxx.mjs'),'latin1');
 expect(()=>decodeRelease(traversal,{...release.manifest,sha256:createHash('sha256').update(traversal).digest('hex')})).toThrow();
 expect(()=>decodeRelease(Buffer.alloc(32*1024*1024+1),release.manifest)).toThrow();
});

import {mkdtemp,writeFile,readFile,access,rm,cp,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {withHttpServer} from '@artifactbin/test-support/net';
import {spawn} from 'node:child_process';
it('updates isolated installs once, preserves data and symlinks, and returns promptly with a stalled endpoint',async()=>{
 const {update,disabled}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs'));
 const base=await mkdtemp(path.join(tmpdir(),'skill-update-'));
 expect(disabled([])).toBe(false);
 const root=path.join(base,'.artifactbin-releases','initial','artifactbin');await mkdir(root,{recursive:true});await symlink(root,path.join(base,'artifactbin'));
 let stalled=false;
 let release:ReturnType<typeof skillRelease>;
 const server=await withHttpServer((req,res)=>{if(stalled)return;res.end(req.url?.endsWith('latest.json')?JSON.stringify(release.manifest):Buffer.from(release.bytes));});
 const origin=server.base;
 const scripts=path.join(root,'scripts');
 await cp(path.dirname(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs')),scripts,{recursive:true});
 const updaterFiles=Object.fromEntries(await Promise.all(['toolbox-update.mjs','toolbox-update-state.mjs','toolbox-update-archive.mjs'].map(async name=>['scripts/'+name,await readFile(path.join(scripts,name),'utf8')])));
 const probe=`import {beforeCommand} from './toolbox-update.mjs'; if(!await beforeCommand(import.meta.url,process.argv.slice(2))) {if(process.argv.includes('fail'))process.exit(7);console.log(JSON.stringify(process.argv.slice(2).filter(a=>a!=='--no-update')));}`;
 await writeFile(path.join(scripts,'probe.mjs'),probe);
 await writeFile(path.join(root,'release.json'),JSON.stringify({schemaVersion:1,origin,version:'0'.repeat(64)}));
 await writeFile(path.join(root,'personal.txt'),'retain');await symlink(path.join(base,'artifactbin'),root+'-link');
 release=skillRelease({'SKILL.md':'new skill','scripts/probe.mjs':probe,...updaterFiles},origin);
 const run=(args:string[],env={},old=false)=>new Promise<{out:string,err:string,code:number|null}>(resolve=>{const child=spawn(process.execPath,[path.join(old?root:root+'-link','scripts/probe.mjs'),...args],{env:{...process.env,...env}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({out,err,code}));});
 try{
  await run(['--no-update']);await run([],{ARTIFACTBIN__NO_UPDATE:'1'});await run(['--help']);
  await expect(access(path.join(root,'.artifactbin-updates'))).rejects.toThrow();
  expect((await update(root)).status).toBe('activated');
  expect((await update(root)).status).toBe('current');
  expect(await readFile(path.join(base,'artifactbin','SKILL.md'),'utf8')).toBe('new skill');
  const results=await Promise.all([run(['a b','--literal']),run(['second'])]);
  expect(results[0].out.trim()).toBe('["a b","--literal"]');expect(results.every(r=>r.code===0)).toBe(true);
  expect(await readFile(path.join(root,'personal.txt'),'utf8')).toBe('retain');
  expect((await run(['--no-update'])).err).toBe('');
  expect((await run([],{ARTIFACTBIN__NO_UPDATE:'1'})).err).toBe('');
  expect((await run(['fail'],{},true)).code).toBe(7);
  expect((await run(['--no-update'],{},true)).code).toBe(0);
  expect((await run(['--server','https://other.example'],{},true)).code).toBe(0);
  const firstVersion=release.manifest.version;
  release=skillRelease({'SKILL.md':'second skill','scripts/probe.mjs':probe+'\n// second release',...updaterFiles},origin);
  expect((await update(root,{background:true})).status).toBe('staged');
  await run(['--server','https://other.example']);
  await run(['--no-update']);
  expect(await readFile(path.join(base,'artifactbin','SKILL.md'),'utf8')).toBe('new skill');
  const simultaneous=await Promise.all([update(root),update(root)]);
  expect(simultaneous.map(r=>r.status).sort()).toEqual(['activated','current']);
  expect(await readFile(path.join(base,'artifactbin','SKILL.md'),'utf8')).toBe('second skill');
  expect(await readFile(path.join(base,'artifactbin','scripts/probe.mjs'),'utf8')).toContain('// second release');
  expect(await readFile(path.join(scripts,'probe.mjs'),'utf8')).toBe(probe);
  expect((await update(root,{rollback:true})).status).toBe('rolled-back');
  expect(JSON.parse(await readFile(path.join(base,'artifactbin','release.json'),'utf8')).version).toBe(firstVersion);
  await writeFile(path.join(base,'.artifactbin-releases','pending.json'),'{broken');
  expect((await run(['recovery'])).code).toBe(0);
  await writeFile(path.join(base,'.artifactbin-releases','pending.json'),JSON.stringify({directory:'release-missing'}));
  expect((await run(['missing'])).code).toBe(0);
  await mkdir(path.join(base,'.artifactbin-releases','stage-deadbeef'));
  await mkdir(path.join(base,'.artifactbin-releases','release-superseded',"artifactbin"),{recursive:true});
  await symlink('2147483647',path.join(base,'.artifactbin-releases','lock'));
  expect((await update(root)).status).toBe('activated');
  await expect(access(path.join(base,'.artifactbin-releases','stage-deadbeef'))).rejects.toThrow();
  // Releases other than the active, rollback and pending ones are removed, so updates never fill the cache.
  await expect(access(path.join(base,'.artifactbin-releases','release-superseded'))).rejects.toThrow();
  const kept=JSON.parse(await readFile(path.join(base,'.artifactbin-releases','previous.json'),'utf8')).directory;
  await access(path.join(base,'.artifactbin-releases',kept,'artifactbin','SKILL.md'));
  expect((await update(root,{rollback:true})).status).toBe('rolled-back');
  expect((await update(root)).status).toBe('activated');
  expect((await run(['--no-update'])).code).toBe(0);
  stalled=true;const start=performance.now();expect((await run(['foreground'])).code).toBe(0);
  const duration=performance.now()-start;console.log('stalled endpoint foreground ms:',duration);expect(duration).toBeLessThan(1500);
  await server.close();
  await expect(update(root)).rejects.toThrow();
  expect((await run(['offline'])).code).toBe(0);
 }finally{await server.close();await rm(base,{recursive:true,force:true});}
});

it('keeps standalone help offline, rejects unknown flags, and parses boolean opt-outs',async()=>{
 const script=require.resolve('../../../skills/artifactbin/scripts/update.mjs');
 const run=(args:string[],value='false')=>new Promise<{code:number|null,out:string}>(resolve=>{
  const child=spawn(process.execPath,[script,...args],{env:{...process.env,ARTIFACTBIN__NO_UPDATE:value}});let out='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('exit',code=>resolve({code,out}));
 });
 expect((await run(['--help'])).code).toBe(0);
 expect((await run(['--unknown'])).code).toBe(2);
 expect((await run([],'true')).code).toBe(0);
 expect((await run([],'0')).code).toBe(1);
 expect((await run([],'false')).out).toContain('Reinstall');
});

it('does not wait for the background updater lock before running a command',async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'skill-busy-'));
 const root=path.join(base,'.artifactbin-releases','initial','artifactbin');
 await mkdir(path.join(root,'scripts'),{recursive:true});await symlink(root,path.join(base,'artifactbin'));
 await writeFile(path.join(root,'release.json'),JSON.stringify({schemaVersion:1,origin:'http://127.0.0.1:1',version:'0'.repeat(64)}));
 await cp(path.dirname(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs')),path.join(root,'scripts'),{recursive:true});
 await writeFile(path.join(root,'scripts/probe.mjs'),`import {beforeCommand} from './toolbox-update.mjs';if(!await beforeCommand(import.meta.url,[]))console.log('ran');`);
 await symlink(String(process.pid),path.join(base,'.artifactbin-releases','lock'));
 try{
  const start=performance.now();
  const result=await new Promise<{code:number|null,out:string}>(resolve=>{const child=spawn(process.execPath,[path.join(root,'scripts/probe.mjs')]);let out='';child.stdout.on('data',b=>out+=b);child.on('exit',code=>resolve({code,out}));});
  expect(result).toEqual({code:0,out:'ran\n'});expect(performance.now()-start).toBeLessThan(1000);
 }finally{await rm(base,{recursive:true,force:true});}
},20000);

/** A stored release built without the server packager, whose member list is step 2's switch (it still refuses resolvers/). */
function storedRelease(files:Record<string,string>,origin:string){
 const version=createHash('sha256').update(JSON.stringify([origin,Object.entries(files).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
 const all={...files,'release.json':JSON.stringify({schemaVersion:1,origin,version})+'\n'};
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [relative,content] of Object.entries(all).sort(([a],[b])=>a.localeCompare(b))){
  const name=Buffer.from('artifactbin/'+relative),data=Buffer.from(content);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(0x800,6);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
  local.push(head,name,data);central.push(entry,name);offset+=30+name.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...local,index,end]);
 return {bytes,manifest:{schemaVersion:1,origin,version,url:origin+'/skills/artifactbin.zip',sha256:createHash('sha256').update(bytes).digest('hex')}};
}

it('verifies and installs the resolvers/ library folder and still refuses unknown folders',async()=>{
 const {decodeRelease}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update-archive.mjs'));
 const {update}=await import(require.resolve('../../../skills/artifactbin/scripts/toolbox-update.mjs'));
 const resolver='export const resolvers = {};\n';
 const sample=storedRelease({'SKILL.md':'library','resolvers/ab.ts':resolver},'https://example.test');
 expect(decodeRelease(sample.bytes,sample.manifest)['resolvers/ab.ts']).toBe(resolver);
 for(const name of ['pluginsxx/ab.ts','resolvers/a.mjs','resolvers/a/b.ts']){
  const bad=storedRelease({'SKILL.md':'library',[name]:resolver},'https://example.test');
  expect(()=>decodeRelease(bad.bytes,bad.manifest)).toThrow('Unsafe archive member');
 }
 const base=await mkdtemp(path.join(tmpdir(),'skill-resolvers-'));
 const root=path.join(base,'.artifactbin-releases','initial','artifactbin');await mkdir(root,{recursive:true});await symlink(root,path.join(base,'artifactbin'));
 let release:ReturnType<typeof storedRelease>;
 const server=await withHttpServer((req,res)=>{res.end(req.url?.endsWith('latest.json')?JSON.stringify(release.manifest):release.bytes);});
 try{
  await writeFile(path.join(root,'release.json'),JSON.stringify({schemaVersion:1,origin:server.base,version:'0'.repeat(64)}));
  release=storedRelease({'SKILL.md':'first','resolvers/ab.ts':resolver},server.base);
  expect((await update(root)).status).toBe('activated');
  expect(await readFile(path.join(base,'artifactbin','resolvers/ab.ts'),'utf8')).toBe(resolver);
  release=storedRelease({'SKILL.md':'second','resolvers/ab.ts':resolver+'// second\n'},server.base);
  expect((await update(root)).status).toBe('activated');
  // Rollback re-verifies the previous release's installed tree, resolvers/ included.
  expect((await update(root,{rollback:true})).status).toBe('rolled-back');
  expect(await readFile(path.join(base,'artifactbin','SKILL.md'),'utf8')).toBe('first');
 }finally{await server.close();await rm(base,{recursive:true,force:true});}
});
