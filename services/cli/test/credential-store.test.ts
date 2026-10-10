import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readlink,symlink,stat,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadConnection,saveConnection,hostDirectory,observeCredentialAccount,observedCredentialAccount} from '../src/config';
import {readCredentials,refreshCredentials,credentialPaths,saveCredentials,credentialRequest,observeCredentialAccount as observe} from '@artifactbin/utils/node/credentials';
import {withLock,HOME_SCOPE} from '../src/state';

const origin='https://example.com';
const connection={server:origin,token:'mxmx_test_access',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client',expiresAt:1900000000000};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,16);
test('readable origin projection preserves the legacy physical store, profile and atomic legacy writers',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mxmx_test_credentials-'));const root=join(home,'.artifactbin');
 try{
  const legacy=join(root,'hosts',hash(origin));await mkdir(legacy,{recursive:true});
  await writeFile(join(legacy,'credentials.env'),`ARTIFACTBIN_URL=${origin}\nARTIFACTBIN_TOKEN=mxmx_test_legacy\n`);
  await writeFile(join(legacy,'profile.json'),JSON.stringify({url:origin,alias:'work'}));
  assert.equal((await loadConnection(origin,home,{}))?.token,'mxmx_test_legacy');
  await saveConnection(connection,home,{});
  assert.equal(await readlink(hostDirectory(origin,home,{})),hash(origin));
  assert.equal((await readCredentials(origin,root))?.token,connection.token);
  await observeCredentialAccount(connection,'mxmx_test_account',home,{});
  assert.equal((await observedCredentialAccount(connection,home,{}))?.account,'mxmx_test_account');
  assert.equal(JSON.parse(await readFile(join(legacy,'profile.json'),'utf8')).alias,'work');
  // Emulate the released CLI's atomic replacement of the original hashed file.
  await writeFile(join(legacy,'replacement'),`ARTIFACTBIN_URL=${origin}\nARTIFACTBIN_TOKEN=mxmx_test_old_writer\n`,{mode:0o600});
  await rename(join(legacy,'replacement'),join(legacy,'credentials.env'));
  assert.equal((await readCredentials(origin,root))?.token,'mxmx_test_old_writer');
  assert.equal((await stat(join(legacy,'credentials.env'))).mode&0o777,0o600);
  await saveCredentials(connection,root);
  assert.equal((await stat(join(legacy,'credentials.env'))).mode&0o777,0o600);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('refuses an origin projection redirected outside its expected legacy store',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mxmx_test_redirect-'));
 try{await mkdir(join(root,'hosts'));await symlink(tmpdir(),credentialPaths(origin,root).directory,'dir');await assert.rejects(saveCredentials(connection,root),/projection/);}finally{await rm(root,{recursive:true,force:true});}
});
test('CLI and HTTP helper serialize rotating grants on the same home lock and reread the winner',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mxmx_test_rotation-'));const root=join(home,'.artifactbin');
 try{
  await saveConnection(connection,home,{});let grants=0;
  const transport=(async()=>{grants++;await new Promise(resolve=>setTimeout(resolve,30));return Response.json({access_token:'mxmx_test_next',refresh_token:'mxmx_test_next_refresh',expires_in:300});}) as typeof fetch;
  const [a,b]=await Promise.all([
   withLock(home,HOME_SCOPE,()=>refreshCredentials(connection,root,{fetch:transport}),{},{}),
   refreshCredentials(connection,root,{fetch:transport}),
  ]);
  assert.equal(grants,1);assert.equal(a.token,b.token);assert.equal((await loadConnection(origin,home,{}))?.token,a.token);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a legacy process rotates once under its original SQLite lock; the HTTP helper rereads it',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mxmx_test_old_rotation-')),root=join(home,'.artifactbin');
 let child:import('node:child_process').ChildProcess|undefined;
 try{
  await saveConnection(connection,home,{});
  const file=join(root,'locks',`${hash('home')}.sqlite`);await mkdir(join(root,'locks'),{recursive:true});
  const backing=credentialPaths(origin,root).backingPath;
  child=spawn(process.execPath,['--input-type=module','-e',`
   import {DatabaseSync} from 'node:sqlite';import {writeFile,rename} from 'node:fs/promises';
   const db=new DatabaseSync(${JSON.stringify(file)});db.exec('BEGIN EXCLUSIVE');process.stdout.write('locked');
   await new Promise(resolve=>setTimeout(resolve,150));
   await writeFile(${JSON.stringify(backing+'.old.tmp')},${JSON.stringify(`ARTIFACTBIN_URL=${origin}\nARTIFACTBIN_TOKEN=mxmx_test_legacy_rotated\nARTIFACTBIN_REFRESH_TOKEN=mxmx_test_legacy_next\nARTIFACTBIN_CLIENT_ID=${connection.clientId}\n`)},{mode:0o600});
   await rename(${JSON.stringify(backing+'.old.tmp')},${JSON.stringify(backing)});db.exec('ROLLBACK');db.close();
  `],{stdio:['ignore','pipe','pipe']});
  await once(child.stdout!,'data');let grants=0;
  const updated=await refreshCredentials(connection,root,{fetch:(async()=>{grants++;throw new Error('must reread old writer');}) as typeof fetch});
  assert.equal(grants,0);assert.equal(updated.token,'mxmx_test_legacy_rotated');assert.equal((await loadConnection(origin,home,{}))?.refreshToken,'mxmx_test_legacy_next');
  if(child.exitCode===null)await once(child,'exit');assert.equal(child.exitCode,0);
 }finally{child?.kill();await rm(home,{recursive:true,force:true});}
});
test('an interrupted readable projection is repaired without copying credentials or losing the profile',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mxmx_test_projection_crash-'));
 try{
  await saveCredentials(connection,root);const paths=credentialPaths(origin,root);await rm(paths.directory);
  assert.equal((await readCredentials(origin,root))?.token,connection.token);
  await saveCredentials(connection,root);assert.equal(await readlink(paths.directory),hash(origin));
  assert.equal((await stat(paths.backingDirectory)).mode&0o777,0o700);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('HTTP fallback enforces persisted account and origin binding without transmitting to another origin',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mxmx_test_http_binding-'));
 try{
  await saveCredentials(connection,root);await observe(connection,'mxmx_test_account',root);let calls=0;
  const transport=(async(_input:unknown,init?:RequestInit)=>{calls++;assert.equal(new Headers(init?.headers).get('X-Artifactbin-Account'),'mxmx_test_account');return Response.json({ok:true},{headers:{'X-Artifactbin-Account':'mxmx_test_other'}});}) as typeof fetch;
  await assert.rejects(credentialRequest(origin,root,'/api/artifacts',{fetch:transport}),/account_mismatch/);assert.equal(calls,1);
  await assert.rejects(credentialRequest(origin,root,'/api/artifacts',{fetch:transport,account:'mxmx_test_other'}),/account_mismatch/);assert.equal(calls,1);
  await assert.rejects(credentialRequest(origin,root,'https://evil.test/api/artifacts',{fetch:transport}),/path/);assert.equal(calls,1);
  await assert.rejects(credentialRequest('https://another.test',root,'/api/artifacts',{fetch:transport}),/auth_required/);assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('refuses a redirected hashed backing directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mxmx_test_backing_redirect-'));
 try{await mkdir(join(root,'hosts'));await symlink(tmpdir(),credentialPaths(origin,root).backingDirectory,'dir');await assert.rejects(readCredentials(origin,root),/backing directory/);}finally{await rm(root,{recursive:true,force:true});}
});

test('parallel refreshes within one outer home-lock owner still rotate once',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mxmx_test_nested_rotation-')),root=join(home,'.artifactbin');
 try{await saveConnection(connection,home,{});let grants=0;
 const transport=(async()=>{grants++;await new Promise(resolve=>setTimeout(resolve,20));return Response.json({access_token:'mxmx_test_nested_next',refresh_token:'mxmx_test_nested_refresh',expires_in:300});}) as typeof fetch;
 const results=await withLock(home,HOME_SCOPE,()=>Promise.all([refreshCredentials(connection,root,{fetch:transport}),refreshCredentials(connection,root,{fetch:transport})]),{},{});
 assert.equal(grants,1);assert.equal(results[0]?.token,results[1]?.token);
 }finally{await rm(home,{recursive:true,force:true});}
});
