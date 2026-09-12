/**
 * Account-scoped resources through the REAL handlers: the profile, typed deletes over a mixed
 * workspace, remote sessions, dataset governance and what a reader may address.
 */

import { it, expect, afterEach } from 'vitest';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useAppHarness, request } from './harness';
import { cliWorkspace } from './cli-harness';
import { mintToken } from '@/lib/tokens';
import { createUser, claimToken } from '@/lib/users';
import { createArtifact, getArtifactById, getSharingFor, updateSharingFor } from '@/lib/artifacts';
import { ownedArtifactState } from '@/lib/trash';
import { has } from '@/lib/relations';
import { GET, PATCH } from '@/app/api/account/profile/route';
import { POST as createArtifactRoute, POST as create, GET as list } from '@/app/api/artifacts/route';
import { GET as readArtifact, DELETE as removeArtifact, GET as read, PUT as replace } from '@/app/api/artifacts/[id]/route';
import { tracking, readRecord } from '../../cli/test/tracking';
import { remoteSessions } from '@/lib/remote/registry';
import { GET as listRoute } from '@/app/api/sessions/route';
import { GET as readRoute, DELETE as terminateRoute } from '@/app/api/sessions/[id]/route';
import { State } from '../../cli/src/state';
import { artifactState } from '@/lib/artifact-state';
import { getDb } from '@/lib/db';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';

useAppHarness();

describe('cli-account-resources', () => {
  it('profile settings and personal relationship lists commit together and reject stale proposals',async()=>{
   const user=await createUser({email:'mxmx_test_account_profile@example.com'}),other=await createUser({email:'mxmx_test_account_follow@example.com'});
   const token=await mintToken('mxmx_test_account_profile');await claimToken(user.id,token.token);
   const artifact=await createArtifact(token.id,user.id,{format:'markup',source:'<p>Like</p>',content:'',meta:{},visibility:'private'});
   const read=await GET(request('/api/account/profile',{token:token.token}));expect(read.status).toBe(200);const profile=await read.json();expect(profile.type).toBe('profile');
   const body={...profile,username:'mxmx_test_profile_new',liked:[artifact.id],following:[other.id]};
   const updated=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:body}));expect(updated.status).toBe(200);expect(await has(user.id,'like',artifact.id)).toBe(true);expect(await has(user.id,'follow',other.id)).toBe(true);
   const stale=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...body,following:[]}}));expect(stale.status).toBe(409);expect(await has(user.id,'follow',other.id)).toBe(true);
   const invalid=await PATCH(request('/api/account/profile',{method:'PATCH',token:token.token,json:{...await updated.json(),username:'@invalid',following:[]}}));expect(invalid.status).toBe(400);expect(await has(user.id,'follow',other.id)).toBe(true);
  });

  /** The real typed delete and the real mixed workspace, through the real CLI. */
  function resourceTransport(calls:string[]):typeof fetch{
   return async(input,init)=>{
    const message=new Request(input,init);const path=new URL(message.url).pathname;calls.push(`${message.method} ${path}`);
    if(path==='/api/artifacts')return createArtifactRoute(message);
    if(path==='/api/account/profile')return message.method==='PATCH'?PATCH(message):GET(message);
    const match=path.match(/^\/api\/artifacts\/([^/]+)$/);
    if(!match)throw new Error(`Unexpected route ${message.method} ${path}`);
    const context={params:Promise.resolve({id:match[1]})};
    return message.method==='DELETE'?removeArtifact(message,context):readArtifact(message,context);
   };
  }

  it('typed delete takes several targets, reports every identity the server removed and keeps local files',async()=>{
   const cli=await cliWorkspace('handler-typed-delete');const root=cli.root;const calls:string[]=[];
   const invoke=(args:string[])=>cli.run(args,resourceTransport(calls));
   try{
    const token=await mintToken('mxmx_test_cli_typed_delete');
    await cli.useToken(token.token);
    const post=async(json:Record<string,unknown>)=>(await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json}))).json();
    const folder=await post({format:'folder',title:'Reports'});
    const child=await post({markup:'<p>Filed</p>',parent_id:folder.id});
    const document=await post({markup:'<p>Separate</p>'});

    expect((await invoke(['pull',document.id,'--output','doc.jsx'])).code).toBe(0);
    const bytes=await readFile(join(root,'doc.jsx'));

    // A selected --type that disagrees with the stored kind refuses rather than
    // deleting the wrong resource; the folder is still there afterwards.
    const conflict=await invoke(['delete','--type','dataset',folder.id]);
    expect(conflict.code).not.toBe(0);
    expect(conflict.result.error.code).toBe('type_conflict');
    expect((await getArtifactById(folder.id))?.deleted_at??null).toBeNull();

    const deleted=await invoke(['delete','--type','folder',folder.id,'doc.jsx']);
    expect(deleted.code,JSON.stringify(deleted.result)).toBe(0);
    expect(deleted.result.results.map((entry:{ref:string})=>entry.ref)).toEqual([folder.id,'doc.jsx']);
    // A folder takes its subtree, and the batch reports each identity it removed.
    expect(new Set(deleted.result.results[0].result.deleted_ids)).toEqual(new Set([folder.id,child.id]));
    expect(deleted.result.results[1].result.deleted_ids).toEqual([document.id]);
    expect(deleted.result.results.map((entry:{result:{type:string}})=>entry.result.type)).toEqual(['folder','artifact']);

    // getArtifactById reads through the live gate, so ownership is read past it.
    for(const id of [folder.id,child.id,document.id])expect(await ownedArtifactState({tokenId:token.id,userId:null},id),id).toEqual({deleted:true});
    // Local bytes survive a remote deletion; only the tracking entry goes.
    expect(await readFile(join(root,'doc.jsx'))).toEqual(bytes);
    expect((await tracking(root,root)).files).toEqual({});
   }finally{await cli.cleanup();}
  });

  it('a workspace tracking artifacts and a profile reports both families and pushes neither when nothing changed',async()=>{
   const cli=await cliWorkspace('handler-mixed');const calls:string[]=[];
   const invoke=(args:string[],fetchImpl=resourceTransport(calls))=>cli.run(args,fetchImpl);
   try{
    const user=await createUser({email:'mxmx_test_cli_mixed@example.com'});
    const token=await mintToken('mxmx_test_cli_mixed');await claimToken(user.id,token.token);
    await cli.useToken(token.token);
    const document=await(await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Both families</p>'}}))).json();
    expect((await invoke(['pull',document.id,'--output','doc.jsx'])).code).toBe(0);
    expect((await invoke(['pull','--type','profile'])).code).toBe(0);

    const offline:typeof fetch=async()=>{throw new Error('a local summary must not reach the network');};
    const status=await invoke(['status'],offline);
    expect(status.code,JSON.stringify(status.result)).toBe(0);
    expect(status.result.files.map((file:{path:string;type:string;status:string})=>[file.path,file.type,file.status]))
     .toEqual([['doc.jsx','artifact','unchanged'],['profile.yaml','profile','unchanged']]);

    const diff=await invoke(['diff'],offline);
    expect(diff.code,JSON.stringify(diff.result)).toBe(0);
    expect(diff.result.diffs).toEqual([]);

    const pushed=await invoke(['push'],offline);
    expect(pushed.code,JSON.stringify(pushed.result)).toBe(0);
    expect(pushed.result.operations).toEqual([{path:'doc.jsx',status:'skipped',reason:'no_local_changes'},{path:'profile.yaml',status:'unchanged'}]);
   }finally{await cli.cleanup();}
  });
});

describe('cli-sessions', () => {
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
   const cli=await cliWorkspace('handler-sessions');const root=cli.root;const calls:string[]=[];
   const invoke=(args:string[])=>cli.run(args,transport(calls));
   try{
    const user=await createUser({email:'mxmx_test_cli_sessions@example.com'});
    const token=await mintToken('mxmx_test_cli_sessions');await claimToken(user.id,token.token);
    await cli.useToken(token.token);
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
   }finally{await cli.cleanup();}
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
   const cli=await cliWorkspace('handler-terminate-recovery');const root=cli.root;const calls:string[]=[];
   let dropReply=true;
   // The first DELETE reaches the relay and removes the session; only the reply is lost.
   const lossy:typeof fetch=async(input,init)=>{
    const message=new Request(input,init);
    if(message.method==='DELETE'&&dropReply){dropReply=false;await transport(calls)(message);throw new Error('terminated, but the reply was lost');}
    return transport(calls)(message);
   };
   const invoke=(args:string[])=>cli.run(args,lossy);
   const journal=()=>readRecord<{path:string;body:unknown}>(root,root,'pending-operation','current');
   try{
    const user=await createUser({email:'mxmx_test_terminate_recovery@example.com'});
    const token=await mintToken('mxmx_test_terminate_recovery');await claimToken(user.id,token.token);
    await cli.useToken(token.token);
    const session=remoteSessions.create(user.id,registration);

    const interrupted=await invoke(['delete','--type','session',session.id]);
    expect(interrupted.code).not.toBe(0);
    expect(remoteSessions.list(user.id)).toEqual([]);
    expect(JSON.stringify(await journal())).toContain(session.id);

    // The session is a tombstone now, so the terminate's own pre-read would answer
    // 410. Repeating the command has to finish the journalled operation instead.
    const recovered=await invoke(['delete','--type','session',session.id]);
    expect(recovered.code,JSON.stringify(recovered.result)).toBe(0);
    expect(recovered.result.operations).toEqual([{id:session.id,status:'terminated',operation:expect.any(String)}]);
    expect(await journal()).toBeNull();
    expect(calls.filter(call=>call.startsWith('DELETE'))).toHaveLength(2);
   }finally{await cli.cleanup();}
  });
});

describe('cli-governance', () => {
  it('publishes content and explicit sharing in one creation and returns an editable governance snapshot',async()=>{
   const token=await mintToken('mxmx_test_cli_sharing');
   const shares=[{email:'mxmx_test_reader@example.com',role:'viewer'}];
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Shared</p>',shares}}));
   expect(response.status).toBe(201);const created=await response.json();
   expect((await getSharingFor({tokenId:token.id,userId:null},created.id))?.shares).toEqual(shares);
   expect(created.shares).toEqual(shares);
   const snapshot=await read(request(`/api/artifacts/${created.id}`,{token:token.token}),{params:Promise.resolve({id:created.id})});
   expect((await snapshot.json()).shares).toEqual(shares);
  });

  it('invalid sharing refuses content creation rather than silently ignoring the grant',async()=>{
   const token=await mintToken('mxmx_test_cli_invalid_sharing');
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Invalid sharing</p>',shares:[{email:'invalid',role:'owner'}]}}));
   expect(response.status).toBe(400);
  });

  it('concurrent invitation changes invalidate observed-state writes without publishing stale content',async()=>{
   const token=await mintToken('mxmx_test_cli_share_race');const actor={tokenId:token.id,userId:null};
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>'}}));
   const {id}=await response.json();const base=(await getArtifactById(id))!;
   const shares=[{email:'mxmx_test_reader@example.com',role:'viewer' as const}];
   await updateSharingFor(actor,id,{shares});
   const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:'<p>Stale write</p>',shares:[],expectedVersion:base.version,expectedState:artifactState(base)}}),{params:Promise.resolve({id})});
   expect(result.status).toBe(409);
   expect((await getArtifactById(id))?.source).toContain('Original');expect((await getSharingFor(actor,id))?.shares).toEqual(shares);
  });

  it('a conditional replacement commits content and invitation removal together',async()=>{
   const token=await mintToken('mxmx_test_cli_share_replace');const actor={tokenId:token.id,userId:null};
   const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>'}}));const {id}=await response.json();
   await updateSharingFor(actor,id,{shares:[{email:'mxmx_test_reader@example.com',role:'viewer'}]});
   const base=(await getArtifactById(id))!;
   const result=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:'<p>Updated</p>',shares:[],expectedVersion:base.version,expectedState:artifactState(base)}}),{params:Promise.resolve({id})});
   expect(result.status).toBe(200);expect((await result.json()).shares).toEqual([]);
   expect((await getArtifactById(id))?.source).toContain('Updated');expect((await getSharingFor(actor,id))?.shares).toEqual([]);
  });
});

describe('cli-readable', () => {
  it('viewer CLI reads follow the same private sharing ACL without exposing invitations or gaining write access',async()=>{
   const owner=await mintToken('mxmx_test_owner'),reader=await mintToken('mxmx_test_reader'),stranger=await mintToken('mxmx_test_stranger');
   const ownerUser=await createUser({email:'mxmx_test_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_reader@example.com'});
   await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Private content</p>',visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));
   expect(created.status).toBe(201);const doc=await created.json();const path=`/api/artifacts/${doc.id}`,params={params:Promise.resolve({id:doc.id})};
   const response=await read(request(path,{token:reader.token}),params);expect(response.status).toBe(200);
   const snapshot=await response.json();expect(snapshot.markup).toContain('Private content');expect(snapshot).not.toHaveProperty('shares');expect(snapshot.capabilities).toMatchObject({read:true,edit:false,sharing:false});
   expect((await read(request(path,{token:stranger.token}),params)).status).toBe(404);
   expect((await content(request(path+'/content',{token:reader.token}),params)).status).toBe(200);
   expect((await content(request(path+'/content',{token:stranger.token}),params)).status).toBe(404);
   expect((await replace(request(path,{method:'PUT',token:reader.token,json:{markup:'<p>Denied</p>',expectedState:doc.state,expectedVersion:doc.version}}),params)).status).toBe(404);
  });

  it('public dataset snapshots expose rows but hide the source definition, policy and internal catalog from viewers',async()=>{
   const owner=await mintToken('mxmx_test_owner'),reader=await mintToken('mxmx_test_reader');
   const created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{score:42}],visibility:'public'}}));
   expect(created.status).toBe(201);const doc=await created.json();
   const response=await read(request(`/api/artifacts/${doc.id}`,{token:reader.token}),{params:Promise.resolve({id:doc.id})});expect(response.status).toBe(200);
   const snapshot=await response.json();expect(snapshot.rows).toEqual([{score:42}]);expect(snapshot.markup).toBeNull();expect(snapshot).not.toHaveProperty('dataset_policy');expect(snapshot).not.toHaveProperty('shares');expect(JSON.stringify(snapshot.meta)).not.toContain('objectKey');
  });

  it('editing another invitation preserves an existing grant bound to an account after its email changes',async()=>{
   const owner=await mintToken('mxmx_test_sticky_owner'),reader=await mintToken('mxmx_test_sticky_reader');
   const ownerUser=await createUser({email:'mxmx_test_sticky_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_old_address@example.com'});
   await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const initial=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Account bound</p>',visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));const doc=await initial.json();const context={params:Promise.resolve({id:doc.id})},path=`/api/artifacts/${doc.id}`;
   expect((await read(request(path,{token:reader.token}),context)).status).toBe(200);
   await (await getDb()).query('UPDATE users SET email=$2 WHERE id=$1',[readerUser.id,'mxmx_test_new_address@example.com']);
   const head=await (await read(request(path,{token:owner.token}),context)).json();
   const changed=await replace(request(path,{method:'PUT',token:owner.token,json:{markup:head.markup,expectedState:head.state,expectedVersion:head.version,shares:[{email:readerUser.email,role:'viewer'},{email:'mxmx_test_another@example.com',role:'viewer'}]}}),context);expect(changed.status).toBe(200);
   expect((await read(request(path,{token:reader.token}),context)).status).toBe(200);
   const newcomer=await createUser({email:readerUser.email}),token=await mintToken('mxmx_test_reused_email');await claimToken(newcomer.id,token.token);
   expect((await read(request(path,{token:token.token}),context)).status).toBe(404);
  });

  it('native collections include explicit viewer shares and filter before paging without listing unrelated public resources',async()=>{
   const owner=await mintToken('mxmx_test_collection_owner'),reader=await mintToken('mxmx_test_collection_reader');
   const ownerUser=await createUser({email:'mxmx_test_collection_owner@example.com'}),readerUser=await createUser({email:'mxmx_test_collection_reader@example.com'});
   await claimToken(ownerUser.id,owner.token);await claimToken(readerUser.id,reader.token);
   const shared=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],title:'Quarterly Sales',visibility:'private',shares:[{email:readerUser.email,role:'viewer'}]}}));expect(shared.status).toBe(201);const sharedId=(await shared.json()).id;
   await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{markup:'<p>Unrelated public</p>',visibility:'public'}}));
   await create(request('/api/artifacts',{method:'POST',token:reader.token,json:{markup:'<p>Owned</p>',title:'Owned'}}));
   const filtered=await list(request('/api/artifacts?type=dataset&relationship=shared&search=sales&limit=1',{token:reader.token}));expect(filtered.status).toBe(200);expect((await filtered.json()).artifacts.map((r:{id:string})=>r.id)).toEqual([sharedId]);
   const all=await list(request('/api/artifacts',{token:reader.token}));expect((await all.json()).artifacts).toHaveLength(2);
   const invalid=await list(request('/api/artifacts?relationship=everyone',{token:reader.token}));expect(invalid.status).toBe(400);
  });
});
