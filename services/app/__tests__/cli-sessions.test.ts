import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
import {remoteSessions} from '@/lib/remote/registry';
import {GET as listRoute} from '@/app/api/sessions/route';
import {GET as readRoute,DELETE as terminateRoute} from '@/app/api/sessions/[id]/route';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';
import {State} from '../../cli/src/state';

useAppHarness();
afterEach(()=>remoteSessions.clear());

const registration={name:'Dashboard',harness:'claude',cwd:'/project',machine:'laptop',cols:80,rows:24};
const params=(id:string)=>({params:Promise.resolve({id})});

/** The real session routes behind the real CLI; an unexpected path fails the test. */
function transport(calls:string[]):typeof fetch{
 return async(input,init)=>{
  const message=new Request(input,init);const path=new URL(message.url).pathname;calls.push(`${message.method} ${path}`);
  if(path==='/api/sessions')return listRoute(message);
  const match=path.match(/^\/api\/sessions\/([^/]+)$/);
  if(!match)throw new Error(`Unexpected route ${message.method} ${path}`);
  return message.method==='DELETE'?terminateRoute(message,params(match[1])):readRoute(message,params(match[1]));
 };
}

it('the real CLI lists sessions, pulls one as read-only YAML, refuses to push it and terminates it once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-sessions-'));const calls:string[]=[];
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:transport(calls),stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const user=await createUser({email:'mxmx_test_cli_sessions@example.com'});
  const token=await mintToken('mxmx_test_cli_sessions');await claimToken(user.id,token.token);
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  const session=remoteSessions.create(user.id,registration);

  const listed=await invoke(['list','--type','session']);
  expect(listed.code,JSON.stringify(listed.result)).toBe(0);
  expect(listed.result.sessions).toEqual([{type:'session',id:session.id,name:'Dashboard',harness:'claude',machine:'laptop',cwd:'/project',status:'online',cols:80,rows:24,controller:'local',created_at:session.createdAt}]);

  const pulled=await invoke(['pull','--type','session',session.id,'--output','session.yaml']);
  expect(pulled.code,JSON.stringify(pulled.result)).toBe(0);
  expect(pulled.result.operations).toEqual([{path:'session.yaml',id:session.id,type:'session',status:'pulled'}]);
  const yaml=await readFile(join(root,'session.yaml'),'utf8');
  expect(yaml).toMatch(/type: session/);expect(yaml).toContain(`id: ${session.id}`);
  // Tracked like every other account resource, so status and diff can report it: an `account`
  // record in the state store under the `workspace` record that binds this root to one server.
  const scope=await realpath(root);const state=await State.open(root);
  try{
   expect(state.list(scope,'account').map(record=>record.key)).toEqual(['session.yaml']);
   expect((state.get(scope,'workspace',scope)?.value as {server:string}|undefined)?.server).toBe('http://localhost:3000');
  }finally{state.close();}

  const status=await invoke(['status','--type','session']);
  expect(status.code,JSON.stringify(status.result)).toBe(0);
  expect(status.result.files).toEqual([{path:'session.yaml',id:session.id,status:'unchanged',type:'session'}]);

  // A session is observed state: editing its file publishes nothing, and the
  // refusal happens before any request leaves the machine.
  const before=calls.length;
  await writeFile(join(root,'session.yaml'),yaml.replace('name: Dashboard','name: Renamed'));
  const pushed=await invoke(['push','session.yaml']);
  expect(pushed.code).not.toBe(0);
  expect(pushed.result.error.code).toBe('readonly_resource');
  expect(calls).toHaveLength(before);

  const terminated=await invoke(['delete','--type','session',session.id]);
  expect(terminated.code,JSON.stringify(terminated.result)).toBe(0);
  expect(terminated.result.operations).toEqual([{id:session.id,name:'Dashboard',status:'terminated',operation:expect.any(String)}]);
  expect(calls.filter(call=>call.startsWith('DELETE'))).toEqual([`DELETE /api/sessions/${session.id}`]);
  expect(remoteSessions.list(user.id)).toEqual([]);
  // The local file is the author's; terminating the session never removes it.
  expect(await readFile(join(root,'session.yaml'),'utf8')).toContain('name: Renamed');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a retried terminate under the same operation identity ends one session, while an unkeyed retry is a 410',async()=>{
 const user=await createUser({email:'mxmx_test_session_retry@example.com'});
 const token=await mintToken('mxmx_test_session_retry');await claimToken(user.id,token.token);
 const first=remoteSessions.create(user.id,registration);
 const key='session-terminate-0000001';
 const terminate=(id:string,headers?:Record<string,string>)=>terminateRoute(request(`/api/sessions/${id}`,{method:'DELETE',token:token.token,headers}),params(id));

 const done=await terminate(first.id,{'Idempotency-Key':key});
 expect(done.status).toBe(200);
 expect(await done.json()).toEqual({ok:true,id:first.id,status:'terminated'});
 expect(done.headers.get('X-Artifactbin-Mutation-Receipt')).toBe(key);

 // A second session exists by now; the retry must answer the first receipt and
 // leave it alone rather than terminating whatever is current.
 const second=remoteSessions.create(user.id,{...registration,name:'Second'});
 const retried=await terminate(first.id,{'Idempotency-Key':key});
 expect(retried.status).toBe(200);
 expect(await retried.json()).toEqual({ok:true,id:first.id,status:'terminated'});
 expect(remoteSessions.list(user.id).map(s=>s.id)).toEqual([second.id]);

 // Without the operation identity the same call is simply a second act, and the
 // relay says the session is gone. That contrast is what the receipt is for.
 expect((await terminate(first.id)).status).toBe(410);
});

it('sessions are owner scoped: another account and an unclaimed token can neither read nor terminate one',async()=>{
 const owner=await createUser({email:'mxmx_test_session_owner@example.com'});
 const ownerToken=await mintToken('mxmx_test_session_owner');await claimToken(owner.id,ownerToken.token);
 const stranger=await createUser({email:'mxmx_test_session_stranger@example.com'});
 const strangerToken=await mintToken('mxmx_test_session_stranger');await claimToken(stranger.id,strangerToken.token);
 const unclaimed=await mintToken('mxmx_test_session_unclaimed');
 const session=remoteSessions.create(owner.id,registration);

 expect((await listRoute(request('/api/sessions',{token:unclaimed.token}))).status).toBe(403);
 expect(await(await listRoute(request('/api/sessions',{token:strangerToken.token}))).json()).toEqual({sessions:[]});
 expect((await readRoute(request(`/api/sessions/${session.id}`,{token:strangerToken.token}),params(session.id))).status).toBe(404);
 expect((await terminateRoute(request(`/api/sessions/${session.id}`,{method:'DELETE',token:strangerToken.token}),params(session.id))).status).toBe(404);
 // The pre-check refuses before any receipt is claimed, so the stranger cannot
 // occupy an operation key either — the owner's own retry still works.
 const key='session-stranger-000000001';
 expect((await terminateRoute(request(`/api/sessions/${session.id}`,{method:'DELETE',token:strangerToken.token,headers:{'Idempotency-Key':key}}),params(session.id))).status).toBe(404);
 expect(remoteSessions.list(owner.id).map(s=>s.id)).toEqual([session.id]);
 const owned=await terminateRoute(request(`/api/sessions/${session.id}`,{method:'DELETE',token:ownerToken.token,headers:{'Idempotency-Key':key}}),params(session.id));
 expect(owned.status).toBe(200);
 expect(remoteSessions.list(owner.id)).toEqual([]);
});

it('a terminate whose reply is lost completes on the repeated command instead of stranding its journal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-terminate-recovery-'));const calls:string[]=[];
 let dropReply=true;
 // The first DELETE reaches the relay and removes the session; only the reply is lost.
 const lossy:typeof fetch=async(input,init)=>{
  const message=new Request(input,init);
  if(message.method==='DELETE'&&dropReply){dropReply=false;await transport(calls)(message);throw new Error('terminated, but the reply was lost');}
  return transport(calls)(message);
 };
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:lossy,stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 const journal=join(root,'.artifactbin','pending-operation.json');
 try{
  const user=await createUser({email:'mxmx_test_terminate_recovery@example.com'});
  const token=await mintToken('mxmx_test_terminate_recovery');await claimToken(user.id,token.token);
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  const session=remoteSessions.create(user.id,registration);

  const interrupted=await invoke(['delete','--type','session',session.id]);
  expect(interrupted.code).not.toBe(0);
  expect(remoteSessions.list(user.id)).toEqual([]);
  expect(await readFile(journal,'utf8')).toContain(session.id);

  // The session is a tombstone now, so the terminate's own pre-read would answer
  // 410. Repeating the command has to finish the journalled operation instead.
  const recovered=await invoke(['delete','--type','session',session.id]);
  expect(recovered.code,JSON.stringify(recovered.result)).toBe(0);
  expect(recovered.result.operations).toEqual([{id:session.id,status:'terminated',operation:expect.any(String)}]);
  await expect(readFile(journal,'utf8')).rejects.toThrow();
  expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
