import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateDirectories,privateDirectory,verifyPrivatePaths} from '../src/private-directory';
import {lockDirectory,privateStateDirectory,withStateLock} from '../src/state-lock';
import {credentialPaths,privateCredentialStore,readCredentials,saveCredentials} from '../src/credentials';

vi.mock('node:child_process',()=>({execFile:vi.fn()}));
const spawn=vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
const saved={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE};
const windows=()=>Object.defineProperty(process,'platform',{...platform,value:'win32'});
/** The directories each PowerShell launch protected, decoded from its script. */
const launches=()=>spawn.mock.calls.filter(call=>call[0]==='powershell.exe'&&Buffer.from(call[1][3] as string,'base64').toString('utf16le').includes('SetAccessControl')).map(call=>{
 const script=Buffer.from(call[1][3] as string,'base64').toString('utf16le');
 return [...script.match(/\$paths=@\(((?:'(?:[^']|'')*',?)*)\)/)![1]!.matchAll(/'((?:[^']|'')*)'/g)].map(match=>match[1]!.replace(/''/g,"'"));
});
const protectedPaths=()=>launches().flat();
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
 expect(launches()).toEqual([[keyDirectory,path]]);
 const script=Buffer.from(spawn.mock.calls[0]![1][3] as string,'base64').toString('utf16le');
 expect(script).toContain('SetAccessRuleProtection($true,$false)');expect(script).toContain("S-1-5-18");
 // A persisted DirectorySecurity clears its modified flags and writes nothing to a second path: one per path.
 expect(script).toMatch(/foreach\(\$path in \$paths\) \{ \$acl=New-Object Security\.AccessControl\.DirectorySecurity;[^}]*SetAccessRuleProtection\(\$true,\$false\);.*\[IO\.Directory\]::SetAccessControl\(\$path,\$acl\) \}$/);
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
it('protects a fresh Windows state tree, its lock directory and the new key\'s directory in one launch, then never again',async()=>{
 windows();const store=join(root,'workspace','.artifactbin'),locks=join(store,'locks');
 // `afbin add` on a fresh home: the workspace store, its State, then the workspace lock.
 await privateStateDirectory(store);await privateDirectory(store);
 await withStateLock(store,'workspace',async()=>{});
 expect(lockDirectory(store)).toBe(locks);
 expect(launches()).toEqual([[keyDirectory,store,locks]]);
 const key=await readFile(keyFile);
 for(const path of[store,locks]){
  const info=await stat(path,{bigint:true});
  expect(await readFile(join(path,'.private-directory'),'utf8')).toBe(createHmac('sha256',key).update(`${info.dev}:${info.ino}:${info.birthtimeNs}`).digest('hex')+'\n');
 }
 await privateStateDirectory(store);await withStateLock(store,'workspace',async()=>{});
 expect(launches()).toHaveLength(1);
});
it('protects in one launch only the batch\'s directories without a record signed for them',async()=>{
 windows();const kept=join(root,'kept'),existing=join(root,'existing'),fresh=join(root,'fresh');
 await privateDirectory(kept);await mkdir(existing);
 await privateDirectories([kept,existing,fresh]);
 expect(launches()).toEqual([[keyDirectory,kept],[existing,fresh]]);
 await privateDirectories([fresh,existing,kept]);expect(launches()).toHaveLength(2);
});
it('keeps a failed batch\'s error, writes no key or record, and protects the whole batch on retry',async()=>{
 windows();const store=join(root,'store'),locks=join(store,'locks');const failure=new Error('Access to the path is denied.');
 spawn.mockImplementationOnce((...args:unknown[])=>{(args.at(-1) as (error:Error)=>void)(failure);});
 await expect(privateStateDirectory(store)).rejects.toBe(failure);
 await expect(readFile(keyFile)).rejects.toMatchObject({code:'ENOENT'});
 expect(await readdir(store)).toEqual(['locks']);expect(await readdir(locks)).toEqual([]);
 await privateStateDirectory(store);
 expect(launches()).toEqual([[keyDirectory,store,locks],[keyDirectory,store,locks]]);
 await privateStateDirectory(store);expect(launches()).toHaveLength(2);
});
it.skipIf(process.platform==='win32')('keeps every Unix directory of a batch at 0700 with no spawn',async()=>{
 const store=join(root,'unix-store');await mkdir(store,{mode:0o755});
 await privateStateDirectory(store);
 for(const path of[store,join(store,'locks')])expect((await stat(path)).mode&0o777).toBe(0o700);
 expect(launches()).toEqual([]);
});
it('saves a first credential on a fresh Windows home with one launch: store, locks, hosts and backing directory together',async()=>{
 windows();const store=join(root,'home-store'),server='https://example.test',connection={server,token:'first_token'};
 await saveCredentials(connection,store);
 const {backingDirectory}=credentialPaths(server,store);
 expect(launches()).toEqual([[keyDirectory,store,lockDirectory(store),join(store,'hosts'),backingDirectory]]);
 expect(await readCredentials(server,store)).toEqual(connection);
 await saveCredentials({...connection,token:'second_token'},store);expect(launches()).toHaveLength(1);
});
it('keeps a first sign-in to one launch when the store is prepared before its first write',async()=>{
 windows();const store=join(root,'sign-in'),server='http://127.0.0.1:5020',connection={server,token:'signed_in'};
 // The CLI's order: the server identity cache write (credential directories first, then the State), the auth
 // lock, the pairing file's directory, then the credential save.
 await privateCredentialStore(server,store);await privateStateDirectory(store);
 await withStateLock(store,`auth:${server}`,async()=>{await privateDirectory(store);await saveCredentials(connection,store);});
 expect(launches()).toHaveLength(1);
 expect(await readCredentials(server,store)).toEqual(connection);
 await privateCredentialStore(server,store);await withStateLock(store,`auth:${server}`,async()=>{await saveCredentials(connection,store);});
 expect(launches()).toHaveLength(1);
});

it('checks current Windows ACLs on reads without trusting a protection record or repairing ACLs',async()=>{
 windows();const path=join(root,'acl-check');await privateDirectory(path);
 await verifyPrivatePaths([path],join(path,'missing.env'));
 const script=Buffer.from(spawn.mock.calls.at(-1)![1][3] as string,'base64').toString('utf16le');
 expect(script).toContain('Get-Acl -LiteralPath');expect(script).toContain('GetOwner');expect(script).toContain('GetAccessRules');
 expect(script).not.toContain('SetAccessControl');
 spawn.mockImplementationOnce((...args:unknown[])=>{(args.at(-1) as (error:Error)=>void)(new Error('sensitive provider output'));});
 await expect(verifyPrivatePaths([path],join(path,'missing.env'))).rejects.toThrow('Credential privacy: Windows owner or ACL permissions could not be verified');
 expect(launches()).toHaveLength(1);
});
