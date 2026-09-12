import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as metadata} from '@/app/api/artifacts/[id]/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {runCli} from '../../cli/src/dispatch';
import {tracking} from '../../cli/test/tracking';
import {saveConnection} from '../../cli/src/config';
import {parseDocument,writeDocument} from '../../cli/src/document';
useAppHarness();
it('runs the real CLI through publication handlers: create, no-op, body edit, metadata and pull',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-sync-'));const calls:string[]=[];
 const transport:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push(`${request.method} ${path}`);
  if(path==='/api/artifacts')return create(request);
  if(path==='/api/artifacts/preflight')return preflight(request);
  const match=path.match(/^\/api\/artifacts\/([^/]+)(\/edits)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
  const context={params:Promise.resolve({id:match[1]})};
  return match[2]?edit(request,context):request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
 };
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});const result=JSON.parse(output.join(''));expect(code,JSON.stringify(result)).toBe(0);return result;};
 try{
  const token=await mintToken('real-cli-sync');await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'doc.jsx'),'<p>Initial</p>');
  await invoke(['push','doc.jsx']);expect(calls).toEqual(['POST /api/artifacts']);
  const first=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(first.metadata.id).toBeTruthy();expect(first.body).toMatch(/id=/);
  await invoke(['push']);expect(calls).toHaveLength(1);
  await writeFile(join(root,'doc.jsx'),writeDocument({...first,body:first.body.replace('Initial','Updated')}));
  await invoke(['push']);expect(calls.at(-1)).toBe(`POST /api/artifacts/${first.metadata.id}/edits`);expect(calls).toHaveLength(2);
  const updated=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(updated.metadata.head_version).toBe(2);
  updated.metadata.title='Changed title';await writeFile(join(root,'doc.jsx'),writeDocument(updated));
  await invoke(['push']);expect(calls.at(-1)).toBe(`PATCH /api/artifacts/${first.metadata.id}`);expect(calls.slice(-2)).toEqual([`GET /api/artifacts/${first.metadata.id}`,`PATCH /api/artifacts/${first.metadata.id}`]);expect(calls).toHaveLength(4);
  const renamed=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));expect(renamed.metadata.title).toBe('Changed title');expect(renamed.metadata.head_version).toBe(2);
  await invoke(['pull']);expect(calls.at(-1)).toBe(`GET /api/artifacts/${first.metadata.id}`);
  await invoke(['push']);expect(calls).toHaveLength(5);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('bare push publishes changed composed dependencies under new identities before replacing their document refs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-handler-deps-'));const calls:string[]=[];
 const transport:typeof fetch=async(input,init)=>{
  const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push(`${request.method} ${path}`);
  if(path==='/api/artifacts')return create(request);
  if(path==='/api/artifacts/preflight')return preflight(request);
  const match=path.match(/^\/api\/artifacts\/([^/]+)(\/edits)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
  const context={params:Promise.resolve({id:match[1]})};
  return match[2]?edit(request,context):request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
 };
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});const result=JSON.parse(output.join(''));expect(code,JSON.stringify(result)).toBe(0);return result;};
 try{
  const token=await mintToken('real-cli-deps');await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'sales.csv'),'region,total\nEast,12\n');
  await writeFile(join(root,'doc.jsx'),'<Helmet><Query name="sales" source="./sales.csv">{`select * from public.rows`}</Query></Helmet><Table data="$sales" />');
  await writeFile(join(root,'other.jsx'),await readFile(join(root,'doc.jsx')));
  await invoke(['push','doc.jsx','other.jsx']);
  expect(calls.filter(call=>call==='POST /api/artifacts')).toHaveLength(3);
  const oldAsset=(await tracking(root,root)).files['sales.csv'].id;
  calls.length=0;await writeFile(join(root,'sales.csv'),'region,total\nEast,24\n');await invoke(['push']);
  expect(calls.some(call=>call===`PUT /api/artifacts/${oldAsset}`)).toBe(false);
  expect(calls.filter(call=>call==='POST /api/artifacts')).toHaveLength(1);
  expect((await tracking(root,root)).files['sales.csv'].id).not.toBe(oldAsset);
  expect(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).body).toContain('source="./sales.csv"');
  const old=await read(new Request(`http://localhost:3000/api/artifacts/${oldAsset}`,{headers:{Authorization:`Bearer ${token.token}`}}),{params:Promise.resolve({id:oldAsset})});expect((await old.json()).version).toBe(1);
  const titled=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));titled.metadata.title='Sales';await writeFile(join(root,'doc.jsx'),writeDocument(titled));
  calls.length=0;await invoke(['push','doc.jsx']);expect(calls).toEqual([`GET /api/artifacts/${titled.metadata.id}`,`PATCH /api/artifacts/${titled.metadata.id}`]);
 }finally{await rm(root,{recursive:true,force:true});}
});
