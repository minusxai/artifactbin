import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateDirectory} from '../src/private-directory';

vi.mock('node:child_process',()=>({execFile:vi.fn()}));
const spawn=vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
const saved={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE};
const windows=()=>Object.defineProperty(process,'platform',{...platform,value:'win32'});
/** The directory each PowerShell launch protected, decoded from its script. */
const protectedPaths=()=>spawn.mock.calls.filter(call=>call[0]==='powershell.exe').map(call=>{
 const script=Buffer.from(call[1][3] as string,'base64').toString('utf16le');
 return script.match(/\$path='((?:[^']|'')*)'/)![1]!.replace(/''/g,"'");
});
let root:string,home:string,keyDirectory:string,keyFile:string;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'private-directory-'));home=join(root,'profile');await mkdir(home);
 process.env.HOME=home;process.env.USERPROFILE=home;
 keyDirectory=join(home,'AppData','Local','artifactbin');keyFile=join(keyDirectory,'private-directory.key');
 spawn.mockReset().mockImplementation((...args:unknown[])=>{(args.at(-1) as (error:Error|null,value:unknown)=>void)(null,{stdout:'',stderr:''});});
});
afterEach(async()=>{
 Object.defineProperty(process,'platform',platform);
 for(const [name,value] of Object.entries(saved))if(value===undefined)delete process.env[name];else process.env[name]=value;
 await rm(root,{recursive:true,force:true});
});

it('protects a fresh Windows directory exactly once and never respawns for the protected directory',async()=>{
 windows();const path=join(root,'state');
 await privateDirectory(path);
 expect(protectedPaths()).toEqual([keyDirectory,path]);
 const script=Buffer.from(spawn.mock.calls[1]![1][3] as string,'base64').toString('utf16le');
 expect(script).toContain('SetAccessRuleProtection($true,$false)');expect(script).toContain("S-1-5-18");
 await privateDirectory(path);await privateDirectory(path);
 expect(protectedPaths()).toEqual([keyDirectory,path]);
});
it('creates the per-user key once, in its own protected directory, for every private directory',async()=>{
 windows();
 await privateDirectory(join(root,'first'));const key=await readFile(keyFile);
 await privateDirectory(join(root,'second'));await privateDirectory(join(root,'third'));
 expect(key).toHaveLength(32);expect(await readFile(keyFile)).toEqual(key);
 expect(protectedPaths()).toEqual([keyDirectory,join(root,'first'),join(root,'second'),join(root,'third')]);
});
it('protects an existing unprotected Windows directory once, then trusts its protection',async()=>{
 windows();await privateDirectory(join(root,'warm'));const path=join(root,'existing');await mkdir(path);
 await privateDirectory(path);await privateDirectory(path);
 expect(protectedPaths().filter(entry=>entry===path)).toHaveLength(1);
});
it('re-protects a directory whose planted record looks valid but was not signed with this user\'s key',async()=>{
 windows();await privateDirectory(join(root,'warm'));const path=join(root,'planted');await mkdir(path);
 const info=await stat(path,{bigint:true});
 for(const body of[`${info.dev}:${info.ino}:${info.birthtimeNs}\n`,'0'.repeat(64)+'\n','a'.repeat(64)+'\n']){
  await writeFile(join(path,'.private-directory'),body);
  const before=protectedPaths().length;await privateDirectory(path);
  expect(protectedPaths().slice(before)).toEqual([path]);
  expect(await readFile(join(path,'.private-directory'),'utf8')).not.toBe(body);
 }
 const before=protectedPaths().length;await privateDirectory(path);expect(protectedPaths()).toHaveLength(before);
});
it('regenerates a missing key, re-protects its directory, and re-protects directories signed with the old key',async()=>{
 windows();const path=join(root,'state');
 await privateDirectory(path);const old=await readFile(keyFile);
 await rm(keyFile);
 await privateDirectory(path);
 expect(protectedPaths()).toEqual([keyDirectory,path,keyDirectory,path]);
 expect(await readFile(keyFile)).not.toEqual(old);
 await privateDirectory(path);expect(protectedPaths()).toHaveLength(4);
});
it('keeps the protection error, records nothing, and retries on the next call',async()=>{
 windows();await privateDirectory(join(root,'warm'));const path=join(root,'denied');const failure=new Error('Access to the path is denied.');
 spawn.mockImplementationOnce((...args:unknown[])=>{(args.at(-1) as (error:Error)=>void)(failure);});
 await expect(privateDirectory(path)).rejects.toBe(failure);
 expect(await readdir(path)).toEqual([]);
 await privateDirectory(path);
 expect(protectedPaths().filter(entry=>entry===path)).toHaveLength(2);
});
it('re-protects a directory whose record belongs to another directory',async()=>{
 windows();const first=join(root,'first'),second=join(root,'second');
 await privateDirectory(first);await mkdir(second);
 for(const name of await readdir(first))await copyFile(join(first,name),join(second,name));
 await privateDirectory(second);
 expect(protectedPaths()).toEqual([keyDirectory,first,second]);
});
it('re-protects a directory recreated at the same path',async()=>{
 windows();const path=join(root,'recreated');
 await privateDirectory(path);const kept=await readdir(path);
 const saved=join(root,'saved');await mkdir(saved);for(const name of kept)await copyFile(join(path,name),join(saved,name));
 await rm(path,{recursive:true});await mkdir(path);for(const name of kept)await copyFile(join(saved,name),join(path,name));
 await privateDirectory(path);
 expect(protectedPaths()).toEqual([keyDirectory,path,path]);
});
it('refuses a Windows symbolic link without spawning',async()=>{
 windows();const target=join(root,'target'),link=join(root,'link');await mkdir(target);await symlink(target,link);
 await expect(privateDirectory(link)).rejects.toThrow(`Expected a private directory: ${link}`);
 expect(protectedPaths()).toEqual([]);
});
it.skipIf(process.platform==='win32')('keeps Unix directories at 0700 with no spawn, no record and no key',async()=>{
 const path=join(root,'unix');await mkdir(path,{mode:0o755});
 await privateDirectory(path);
 expect((await stat(path)).mode&0o777).toBe(0o700);expect(protectedPaths()).toEqual([]);expect(await readdir(path)).toEqual([]);
 expect(await readdir(home)).toEqual([]);
});
