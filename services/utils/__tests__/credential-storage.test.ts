import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {chmod,mkdtemp,rename,rm,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {credentialPaths,readCredentials,refreshCredentials,saveCredentials} from '../src/credentials';
import {withStateLock} from '../src/state-lock';
let root:string;
const grant={server:'https://example.test',token:'old_access',refreshToken:'old_refresh',clientId:'client_one'};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'credential-storage-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const rotated=()=>Response.json({access_token:'new_access',refresh_token:'new_refresh',expires_in:3600});
it('does not recreate a grant removed by logout before stale refresh acquires the home lock',async()=>{
 await saveCredentials(grant,root);const stale=(await readCredentials(grant.server,root))!;
 await withStateLock(root,'home',()=>rm(credentialPaths(grant.server,root).backingPath));
 const transport=vi.fn(async()=>rotated());
 await expect(refreshCredentials(stale,root,{fetch:transport})).rejects.toThrow('auth_required');
 expect(transport).not.toHaveBeenCalled();expect(await readCredentials(grant.server,root)).toBeNull();
});
it('preserves a replacement login with a different client identity without network',async()=>{
 await saveCredentials(grant,root);const replacement={...grant,token:'replacement_access',refreshToken:'replacement_refresh',clientId:'client_two'};
 await saveCredentials(replacement,root);const transport=vi.fn(async()=>rotated());
 await expect(refreshCredentials(grant,root,{fetch:transport})).rejects.toThrow('auth_required');
 expect(transport).not.toHaveBeenCalled();expect(await readCredentials(grant.server,root)).toEqual(replacement);
});
it('reuses the single same-lineage rotation winner for simultaneous refreshers',async()=>{
 await saveCredentials(grant,root);const transport=vi.fn(async()=>rotated());
 const results=await Promise.all([refreshCredentials(grant,root,{fetch:transport}),refreshCredentials(grant,root,{fetch:transport})]);
 expect(transport).toHaveBeenCalledTimes(1);expect(results[0]).toEqual(results[1]);
 expect(await readCredentials(grant.server,root)).toEqual(results[0]);
});
it.each(['network','429','503','malformed','rejected'])('retains the saved grant after %s without leaking response secrets',async(kind)=>{
 await saveCredentials(grant,root);
 const transport=vi.fn(async()=>{if(kind==='network')throw new Error('old_refresh');if(kind==='malformed')return new Response('old_refresh');return Response.json({error:kind==='rejected'?'invalid_grant':'old_refresh',error_description:'old_refresh'},{status:kind==='rejected'?400:Number(kind)});});
 const error=await refreshCredentials(grant,root,{fetch:transport}).catch(error=>error);
 expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain('old_refresh');
 expect(error.message).toContain(kind==='rejected'?'auth_required':'refresh_unavailable');
 expect(await readCredentials(grant.server,root)).toEqual(grant);
});
it.skipIf(process.platform==='win32').each(['root','hosts','backing','file'])('refuses unsafe POSIX %s permissions without repairing them',async(target)=>{
 await saveCredentials(grant,root);const paths=credentialPaths(grant.server,root);
 const path={root,hosts:join(root,'hosts'),backing:paths.backingDirectory,file:paths.backingPath}[target]!;
 const mode=target==='file'?0o644:0o755;await chmod(path,mode);
 await expect(readCredentials(grant.server,root)).rejects.toThrow(/privacy.*permissions/i);
 expect((await stat(path)).mode&0o777).toBe(mode);
});
it.skipIf(process.platform==='win32')('reads a read-only private grant through normalized origins and one projection',async()=>{
 await saveCredentials(grant,root);const paths=credentialPaths(grant.server,root);await chmod(paths.backingPath,0o400);
 expect(await readCredentials('https://EXAMPLE.test:443/',root)).toEqual(grant);
 expect((await stat(paths.path)).ino).toBe((await stat(paths.backingPath)).ino);
 expect((await stat(paths.backingPath)).mode&0o777).toBe(0o400);
});

it('reuses a saved rotation even when only the refresh token changed',async()=>{
 await saveCredentials({...grant,refreshToken:'winner_refresh'},root);const transport=vi.fn(async()=>rotated());
 expect(await refreshCredentials(grant,root,{fetch:transport})).toEqual({...grant,refreshToken:'winner_refresh'});
 expect(transport).not.toHaveBeenCalled();
});
it.skipIf(process.platform==='win32')('rejects an unexpected POSIX owner before reading a grant',async()=>{
 await saveCredentials(grant,root);const uid=process.getuid!();const owner=vi.spyOn(process,'getuid').mockReturnValue(uid+1);
 try{await expect(readCredentials(grant.server,root)).rejects.toThrow(/privacy.*owner/i);}finally{owner.mockRestore();}
});
it.skipIf(process.platform==='win32').each(['hosts','backing','file'])('rejects a substituted %s symlink',async(target)=>{
 await saveCredentials(grant,root);const paths=credentialPaths(grant.server,root);
 const path={hosts:join(root,'hosts'),backing:paths.backingDirectory,file:paths.backingPath}[target]!;
 const moved=path+'.moved';await rename(path,moved);await symlink(moved,path);
 await expect(readCredentials(grant.server,root)).rejects.toThrow(/privacy/i);
});
// Real Windows integration: no platform/PowerShell mocks. Run this same selected test file on a Windows runner.
it.skipIf(process.platform!=='win32').each(['root','file'])('rejects a real broadened Windows %s ACL without repairing it',async(target)=>{
 await saveCredentials(grant,root);expect(await readCredentials(grant.server,root)).toEqual(grant);
 const path=target==='root'?root:credentialPaths(grant.server,root).backingPath;
 const literal="'"+path.replace(/'/g,"''")+"'";
 const run=promisify(execFile);
 const script=`$ErrorActionPreference='Stop'; $path=${literal}; $acl=Get-Acl -LiteralPath $path; $sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0'); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $path -AclObject $acl; (Get-Acl -LiteralPath $path).Sddl`;
 const args=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
 const before=await run('powershell.exe',args,{windowsHide:true});
 await expect(readCredentials(grant.server,root)).rejects.toThrow(/privacy.*Windows/i);
 const inspect=`(Get-Acl -LiteralPath ${literal}).Sddl`;
 const after=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(inspect,'utf16le').toString('base64')],{windowsHide:true});
 expect(after.stdout.trim()).toBe(before.stdout.trim());
});
