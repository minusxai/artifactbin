/**
 * Fork through the REAL handlers: the CLI makes the copy locally and offline, and the first
 * push is an ordinary create that carries `forked_from`. What is proved here is the half a
 * unit test cannot reach — that the server stores the lineage, and only when the claiming
 * actor can actually read the named source.
 */
import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {createUser} from '@/lib/users';
import {getArtifactById} from '@/lib/artifacts';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as metadata} from '@/app/api/artifacts/[id]/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {runCli} from '../../cli/src/dispatch';
import {saveConnection} from '../../cli/src/config';
import {parseDocument} from '../../cli/src/document';

useAppHarness();

function transportFor(calls:string[]):typeof fetch{
 return async(input,init)=>{
  const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push(`${request.method} ${path}`);
  if(path==='/api/artifacts')return create(request);
  if(path==='/api/artifacts/preflight')return preflight(request);
  const match=path.match(/^\/api\/artifacts\/([^/]+)(\/edits)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
  const context={params:Promise.resolve({id:match[1]})};
  return match[2]?edit(request,context):request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
 };
}

it('forks a published document offline and stores lineage on the first push',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-fork-'));const calls:string[]=[];
 const transport=transportFor(calls);
 const invoke=async(args:string[],fetchImpl:typeof fetch=transport)=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:fetchImpl,stdout:s=>output.push(s),stderr:()=>{}});
  const result=JSON.parse(output.join(''));expect(code,JSON.stringify(result)).toBe(0);return result;
 };
 try{
  const user=await createUser({email:'forker@minusx.ai'});
  const token=await mintToken('real-cli-fork',user.id);await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'report.jsx'),'<p>Original</p>');
  await invoke(['push','report.jsx']);
  const source=parseDocument(await readFile(join(root,'report.jsx'),'utf8'));
  expect(source.metadata.id).toBeTruthy();
  // Sharing is permission state, so the fork must not carry it even when the source has it.
  await invoke(['push','report.jsx']);
  calls.length=0;

  // A local source never reaches the network: an unexpected request fails the test.
  const forked=await invoke(['fork','report.jsx','--output','copy.jsx'],async()=>{throw new Error('fork of a local source made a request');});
  expect(calls).toEqual([]);
  expect(forked.operations[0].forked_from).toBe(source.metadata.id);
  const copy=parseDocument(await readFile(join(root,'copy.jsx'),'utf8'));
  expect(copy.metadata.id).toBeUndefined();
  expect(copy.metadata.edit_id).toBeUndefined();
  expect(copy.metadata.forked_from).toBe(source.metadata.id);
  expect(copy.metadata.visibility).toBe('private');
  expect(copy.body).toBe(source.body);

  const published=await invoke(['push','copy.jsx']);
  expect(calls.filter(call=>call==='POST /api/artifacts')).toHaveLength(1);
  const copyId=published.operations.at(-1).id as string;
  expect(copyId).not.toBe(source.metadata.id);
  const stored=await getArtifactById(copyId);
  expect(stored?.forked_from).toBe(source.metadata.id);
  expect(stored?.visibility).toBe('private');
  // Lineage is written once: the fence no longer carries it, so a later push cannot rewrite it.
  expect(parseDocument(await readFile(join(root,'copy.jsx'),'utf8')).metadata.forked_from).toBeUndefined();
  // The source is untouched by the whole exchange.
  expect(parseDocument(await readFile(join(root,'report.jsx'),'utf8')).metadata.id).toBe(source.metadata.id);
  expect((await getArtifactById(String(source.metadata.id)))?.forked_from).toBeNull();
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses lineage naming a source the pushing account cannot read, and never overwrites a destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-fork-acl-'));
 const other=await mkdtemp(join(tmpdir(),'afbin-handler-fork-owner-'));
 const calls:string[]=[];const transport=transportFor(calls);
 const run=async(home:string,args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:home,home,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});
  return {code,result:JSON.parse(output.join(''))};
 };
 try{
  const ownerUser=await createUser({email:'fork-owner@minusx.ai'});
  const owner=await mintToken('real-cli-fork-owner',ownerUser.id);await saveConnection({server:'http://localhost:3000',token:owner.token},other);
  await writeFile(join(other,'private.jsx'),'---\nvisibility: private\n---\n<p>Secret</p>');
  const publishedPrivate=await run(other,['push','private.jsx']);
  expect(publishedPrivate.code,JSON.stringify(publishedPrivate.result)).toBe(0);
  const secretId=publishedPrivate.result.operations[0].id as string;

  const strangerUser=await createUser({email:'fork-stranger@minusx.ai'});
  const stranger=await mintToken('real-cli-fork-stranger',strangerUser.id);await saveConnection({server:'http://localhost:3000',token:stranger.token},root);
  await writeFile(join(root,'claim.jsx'),`---\nforked_from: ${secretId}\nvisibility: private\n---\n<p>Claimed</p>`);
  const refused=await run(root,['push','claim.jsx']);
  expect(refused.code).not.toBe(0);
  expect(refused.result.error.code).toBe('not_found');
  // Nothing was created under the false claim: the draft is still unpublished.
  expect(parseDocument(await readFile(join(root,'claim.jsx'),'utf8')).metadata.id).toBeUndefined();

  // A readable source is accepted: the stranger's own artifact.
  await writeFile(join(root,'mine.jsx'),'<p>Mine</p>');
  const mine=await run(root,['push','mine.jsx']);expect(mine.code,JSON.stringify(mine.result)).toBe(0);
  const forked=await run(root,['fork','mine.jsx','--output','mine-copy.jsx']);
  expect(forked.code,JSON.stringify(forked.result)).toBe(0);
  const publishedCopy=await run(root,['push','mine-copy.jsx']);
  expect(publishedCopy.code,JSON.stringify(publishedCopy.result)).toBe(0);
  expect((await getArtifactById(publishedCopy.result.operations[0].id as string))?.forked_from).toBe(mine.result.operations[0].id);

  // A second fork to the same destination refuses rather than replacing the draft.
  const again=await run(root,['fork','mine.jsx','--output','mine-copy.jsx']);
  expect(again.code).not.toBe(0);
  expect(again.result.error.code).toBe('output_exists');

  // A folder is not forkable, and the refusal costs no local file.
  await writeFile(join(root,'shelf.yaml'),'type: folder\ntitle: Shelf\n');
  const folder=await run(root,['push','shelf.yaml']);expect(folder.code,JSON.stringify(folder.result)).toBe(0);
  const refusedFolder=await run(root,['fork','shelf.yaml']);
  expect(refusedFolder.code).not.toBe(0);
  expect(refusedFolder.result.error.code).toBe('not_forkable');
  await expect(stat(join(root,'shelf-fork.yaml'))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
