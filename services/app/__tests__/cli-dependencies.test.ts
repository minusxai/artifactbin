/**
 * Local dependencies through the REAL handlers: the CLI describes an image by hash, the server
 * answers whether this account already owns those bytes, and only misses are uploaded. Nothing
 * is written into the workspace; tracking lives in the CLI's state store.
 */
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
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
import {State} from '../../cli/src/state';

useAppHarness();
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

function transportFor(calls:Array<{method:string;path:string;body:any}>):typeof fetch{
 return async(input,init)=>{
  const request=new Request(input,init);const path=new URL(request.url).pathname;
  const raw=init?.body?String(init.body):'';calls.push({method:request.method,path,body:raw?JSON.parse(raw):null});
  if(path==='/api/artifacts')return create(request);
  if(path==='/api/artifacts/preflight')return preflight(request);
  const match=path.match(/^\/api\/artifacts\/([^/]+)(\/edits)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
  const context={params:Promise.resolve({id:match[1]})};
  return match[2]?edit(request,context):request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
 };
}

it('publishes a local image by hash once, reuses it across documents, and keeps every byte out of the workspace',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-handler-deps-'));const home=join(base,'home');const work=join(base,'work');await mkdir(home);await mkdir(work);
 const calls:Array<{method:string;path:string;body:any}>=[];const transport=transportFor(calls);
 const invoke=async(args:string[])=>{
  const output:string[]=[];
  const code=await runCli([...args,'--json'],{cwd:work,home,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});
  const result=JSON.parse(output.join(''));expect(code,JSON.stringify(result)).toBe(0);return result;
 };
 try{
  const user=await createUser({email:'deps@minusx.ai'});
  const token=await mintToken('real-cli-deps',user.id);await saveConnection({server:'http://localhost:3000',token:token.token},home);
  await writeFile(join(work,'photo.png'),PNG);
  await writeFile(join(work,'one.jsx'),'<p>One</p>\n<img src="./photo.png" alt="one" />');

  // First push: preflight carries the hash, never the bytes; the image is created, then the document.
  const first=await invoke(['push','one.jsx']);
  const flight=calls.find(call=>call.path==='/api/artifacts/preflight');expect(flight).toBeTruthy();
  expect(flight!.body.dependencies).toEqual([{id:'local000001',sha256:sha256(PNG),size:PNG.length,filename:'photo.png'}]);
  expect(JSON.stringify(flight!.body)).not.toContain(PNG.toString('base64'));
  const creates=calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts');
  expect(creates.map(call=>Object.keys(call.body)[0])).toEqual(['image','markup']);
  const image=first.operations.find((operation:any)=>operation.path==='photo.png');expect(image.status).toBe('published');
  const imageRow=await getArtifactById(image.id);expect((imageRow!.meta as {sha256?:string}).sha256).toBe(sha256(PNG));
  const doc=first.operations.find((operation:any)=>operation.path==='one.jsx');
  expect((await getArtifactById(doc.id))!.source).toContain(`ref:${image.id}`);
  expect(await readFile(join(work,'one.jsx'),'utf8')).toContain('./photo.png');

  // A second document referencing the same bytes: the server reports the owned id and nothing is uploaded.
  calls.length=0;
  await writeFile(join(work,'two.jsx'),'<p>Two</p>\n<img src="./photo.png" alt="two" />');
  const second=await invoke(['push','two.jsx']);
  expect(second.operations.find((operation:any)=>operation.path==='photo.png')).toMatchObject({status:'reused',id:image.id});
  expect(calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts').map(call=>Object.keys(call.body)[0])).toEqual(['markup']);

  // An unchanged document with an unchanged asset makes no request at all.
  calls.length=0;
  const third=await invoke(['push','one.jsx']);
  expect(third.operations[0]).toMatchObject({path:'one.jsx',status:'skipped'});
  expect(calls).toEqual([]);

  // Changed bytes are a new artifact, never an in-place replacement of the one two.jsx still uses.
  await writeFile(join(work,'photo.png'),Buffer.concat([PNG,Buffer.from([0])]));
  const fourth=await invoke(['push','one.jsx']);
  const republished=fourth.operations.find((operation:any)=>operation.path==='photo.png');
  expect(republished.status).toBe('published');expect(republished.id).not.toBe(image.id);
  expect((await getArtifactById(image.id))!.deleted_at).toBeNull();

  // Nothing but the user's files in the workspace; tracking lives in the store with hashes, not bytes.
  expect((await readdir(work)).sort()).toEqual(['one.jsx','photo.png','two.jsx']);
  const state=await State.open(home);
  try{
   const tracked=state.list<{file:string;snapshot:{markup?:string}}>(await realpath(work),'tracked');
   expect(tracked.map(record=>record.key).sort()).toEqual(['one.jsx','photo.png','two.jsx']);
   for(const record of tracked){expect(record.value.file).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(record.value)).not.toContain(PNG.toString('base64'));}
   expect(parseDocument(await readFile(join(work,'one.jsx'),'utf8')).metadata.id).toBe(doc.id);
  }finally{state.close();}
 }finally{await rm(base,{recursive:true,force:true});}
});
