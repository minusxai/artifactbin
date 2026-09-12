import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace,PATCH as metadata} from '@/app/api/artifacts/[id]/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
import {POST as secrets} from '@/app/api/my/secrets/route';
import {resolveDatasetConnection} from '@/lib/datasets/secrets';
import {DatasetError} from '@/lib/datasets/errors';
import {runCli} from '../../cli/src/dispatch';
import {readRecord} from '../../cli/test/tracking';
import {saveConnection} from '../../cli/src/config';
import {parseResourceFile} from '../../cli/src/resource-file';
useAppHarness();

const transportFor=(calls:string[]):typeof fetch=>async(input,init)=>{
 const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push(`${request.method} ${path}`);
 if(path==='/api/artifacts')return create(request);
 if(path==='/api/artifacts/preflight')return preflight(request);
 if(path==='/api/secrets')return secrets(request);
 const match=path.match(/^\/api\/artifacts\/([^/]+)(\/content)?$/);if(!match)throw new Error(`Unexpected route ${path}`);
 const context={params:Promise.resolve({id:match[1]})};
 if(match[2])return content(request,context);
 return request.method==='GET'?read(request,context):request.method==='PATCH'?metadata(request,context):replace(request,context);
};
const definition=[
 '<Dataset kind="stored" defaultSchema="public">',
 '  <Table schema="public" name="rows" columns={["n"]} rows={[{"n":1}]} />',
 '  <Table schema="public" name="more" columns={["m"]} rows={[{"m":2}]} />',
 '</Dataset>',
].join('\n')+'\n';

it('publishes a multi-table dataset from its definition and pulls that definition back unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-definition-push-'));
 const elsewhere=await mkdtemp(join(tmpdir(),'afbin-definition-pull-'));
 const calls:string[]=[];const transport=transportFor(calls);
 const invoke=async(cwd:string,args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd,home:cwd,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});const result=JSON.parse(output.join(''));expect(code,JSON.stringify(result)).toBe(0);return result;};
 try{
  const token=await mintToken('definition-owner');
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await saveConnection({server:'http://localhost:3000',token:token.token},elsewhere);
  await writeFile(join(root,'orders.jsx'),definition);
  await writeFile(join(root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\nvisibility: unlisted\n');
  const published=await invoke(root,['push','orders.yaml']);
  const id=published.operations[0].id as string;expect(id).toBeTruthy();
  expect(parseResourceFile(await readFile(join(root,'orders.yaml'),'utf8')).id).toBe(id);

  // The server's own canonical definition is what a pull writes beside the YAML.
  const canonical=await(await content(new Request(`http://localhost:3000/api/artifacts/${id}/content`,{headers:{authorization:`Bearer ${token.token}`}}),{params:Promise.resolve({id})})).text();
  expect(canonical).toContain('<Dataset kind="stored"');expect(canonical).toContain('name="more"');
  await invoke(elsewhere,['pull',id,'--type','dataset','--output','orders.yaml']);
  const pulledYaml=parseResourceFile(await readFile(join(elsewhere,'orders.yaml'),'utf8'));
  expect(pulledYaml.type).toBe('dataset');expect(pulledYaml.type==='dataset'&&pulledYaml.source).toBe('orders.jsx');
  expect(await readFile(join(elsewhere,'orders.jsx'),'utf8')).toBe(canonical.endsWith('\n')?canonical:canonical+'\n');
  // Round trip: the pulled copy proposes nothing back.
  expect((await invoke(elsewhere,['push'])).operations.every((operation:{status:string})=>operation.status==='skipped')).toBe(true);

  // A reader may read the relations, never the stored rows or connection internals.
  const other=await mintToken('definition-reader');
  const reader=await content(new Request(`http://localhost:3000/api/artifacts/${id}/content`,{headers:{authorization:`Bearer ${other.token}`}}),{params:Promise.resolve({id})});
  expect(reader.status).toBe(200);const readable=await reader.text();
  expect(readable).toContain('name="more"');expect(readable).not.toContain('rows=');expect(readable).not.toContain('<Connection');
 }finally{await rm(root,{recursive:true,force:true});await rm(elsewhere,{recursive:true,force:true});}
});

it('binds a connection password from the environment and writes only its secret id anywhere',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-definition-secret-'));
 const calls:string[]=[];const transport=transportFor(calls);const output:string[]=[];
 const connected='<Dataset kind="postgres" defaultSchema="models">\n  <Connection host="db.example.com" port={5432} database="commerce" username="reader" ssl={true} />\n</Dataset>\n';
 try{
  const token=await mintToken('definition-secret');
  await saveConnection({server:'http://localhost:3000',token:token.token},root);
  await writeFile(join(root,'orders.jsx'),connected);
  await writeFile(join(root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\n');
  // Publication needs a reachable server; the binding that precedes it is what this checks.
  await runCli(['push','orders.yaml','--secret-env','PGPASSWORD','--json'],{cwd:root,home:root,env:{PGPASSWORD:'hunter2'},interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});
  expect(calls[0]).toBe('POST /api/secrets');
  const written=await readFile(join(root,'orders.jsx'),'utf8');
  const secretId=written.match(/passwordSecretId="([^"]+)"/)?.[1];expect(secretId).toMatch(/^sec_[0-9a-f]{24}$/);
  for(const file of ['orders.jsx','orders.yaml'])expect(await readFile(join(root,file),'utf8')).not.toContain('hunter2');
  expect(output.join('')).not.toContain('hunter2');
  const journal=JSON.stringify(await readRecord(root,root,'pending-request','current')??'');
  const operation=JSON.stringify(await readRecord(root,root,'pending-operation','current')??'');
  expect(journal+operation).not.toContain('hunter2');

  // The secret resolves for its creator against that exact target, and nothing else.
  const actor={tokenId:token.id,userId:null};
  const target={host:'db.example.com',port:5432,database:'commerce',username:'reader',ssl:true};
  expect((await resolveDatasetConnection({...target,passwordSecretId:secretId!},actor)).password).toBe('hunter2');
  await expect(resolveDatasetConnection({...target,database:'other',passwordSecretId:secretId!},actor)).rejects.toBeInstanceOf(DatasetError);
  const other=await mintToken('definition-secret-other');
  await expect(resolveDatasetConnection({...target,passwordSecretId:secretId!},{tokenId:other.id,userId:null})).rejects.toBeInstanceOf(DatasetError);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a reader pulls a flat dataset as rows, because the served representation decides, not the stripped catalog',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-definition-reader-'));
 const calls:string[]=[];const transport=transportFor(calls);
 try{
  const owner=await mintToken('definition-rows-owner');
  const made=await create(new Request('http://localhost:3000/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${owner.token}`,'content-type':'application/json'},body:JSON.stringify({dataset:[{n:1},{n:2}],visibility:'unlisted'})}));
  expect(made.status).toBe(201);const doc=await made.json();
  // A reader's catalog has no objectKey: only the response representation can tell rows from a definition.
  const reader=await mintToken('definition-rows-reader');
  const head=await(await read(new Request(`http://localhost:3000/api/artifacts/${doc.id}`,{headers:{authorization:`Bearer ${reader.token}`}}),{params:Promise.resolve({id:doc.id})})).json();
  expect(head.capabilities.edit).toBe(false);expect(head.meta.catalog.tables[0].objectKey).toBeUndefined();
  await saveConnection({server:'http://localhost:3000',token:reader.token},root);
  const output:string[]=[];
  const code=await runCli(['pull',doc.id,'--format','yaml','--output','sales.yaml','--json'],{cwd:root,home:root,interactive:false,fetch:transport,stdout:s=>output.push(s),stderr:()=>{}});
  expect(code,output.join('')).toBe(0);
  const pulled=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));
  expect(pulled.type==='dataset'&&pulled.source).toBe('sales.json');
  expect(JSON.parse(await readFile(join(root,'sales.json'),'utf8'))).toEqual([{n:1},{n:2}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
