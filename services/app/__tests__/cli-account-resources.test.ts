import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser,claimToken} from '@/lib/users';
import {createArtifact,getArtifactById} from '@/lib/artifacts';
import {ownedArtifactState} from '@/lib/trash';
import {has} from '@/lib/relations';
import {GET,PATCH} from '@/app/api/account/profile/route';
import {POST as createArtifactRoute} from '@/app/api/artifacts/route';
import {GET as readArtifact,DELETE as removeArtifact} from '@/app/api/artifacts/[id]/route';
import {runCli} from '../../cli/src/dispatch';
import {tracking} from '../../cli/test/tracking';
import {saveConnection} from '../../cli/src/config';
useAppHarness();
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
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-typed-delete-'));const calls:string[]=[];
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:resourceTransport(calls),stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const token=await mintToken('mxmx_test_cli_typed_delete');
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
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
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a workspace tracking artifacts and a profile reports both families and pushes neither when nothing changed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-mixed-'));const calls:string[]=[];
 const invoke=async(args:string[],fetchImpl=resourceTransport(calls))=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:fetchImpl,stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const user=await createUser({email:'mxmx_test_cli_mixed@example.com'});
  const token=await mintToken('mxmx_test_cli_mixed');await claimToken(user.id,token.token);
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
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
 }finally{await rm(root,{recursive:true,force:true});}
});
