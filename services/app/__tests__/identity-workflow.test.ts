import {it,expect,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create,GET as list} from '@/app/api/artifacts/route';
import {GET as read,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {reserveIds} from '@/lib/artifact-identities';
import {writeFile,readFile,rename,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {cliWorkspace,artifactTransport} from './cli-harness';
import {startPreview} from '../../cli/src/preview/session';
import {createUser} from '@/lib/users';
import * as identifiers from '@/lib/ids';
import {POST as reserve} from '@/app/api/artifacts/reservations/route';
import {addFiles,moveFile,localIdentities} from '../../cli/src/identities';
import {loadWorkspace} from '../../cli/src/workspace';
import {HttpClient} from '../../cli/src/http';
import {stateFor} from '../../cli/src/state-access';
import {HOME_SCOPE} from '../../cli/src/state';
import {getDb} from '@/lib/db';
useAppHarness();
it('reserves an invisible batch and publishes the exact identity with durable replay',async()=>{
 const token=await mintToken('mxmx_test_reservations');const actor={tokenId:token.id,userId:null};
 const ids=await reserveIds(actor,'batch_000000000001');expect(ids).toHaveLength(100);expect(new Set(ids).size).toBe(100);
 expect(await reserveIds(actor,'batch_000000000001')).toEqual(ids);
 const id=ids[0];const ctx={params:Promise.resolve({id})};expect((await read(request('/api/artifacts/'+id,{token:token.token}),ctx)).status).toBe(404);
 const req=()=>request('/api/artifacts',{method:'POST',token:token.token,headers:{'Idempotency-Key':'create_000000000001'},json:{reserved_id:id,markup:'<p>Reserved document</p>'}});
 const first=await create(req());expect(first.status).toBe(201);const published=await first.json();expect(published.id).toBe(id);expect(published.version).toBe(1);
 const replay=await create(req());expect(replay.status).toBe(201);expect((await replay.json()).id).toBe(id);
 expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toHaveLength(1);
 await remove(request('/api/artifacts/'+id,{method:'DELETE',token:token.token}),ctx);
 expect((await create(req())).status).toBe(410);
 const fresh=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'Idempotency-Key':'create_000000000002'},json:{reserved_id:id,markup:'<p>Resurrect</p>'}}));expect(fresh.status).toBe(409);
});
it('rejects foreign reservations and racing creates; invalid content does not consume an identity',async()=>{
 const token=await mintToken('mxmx_test_reservation_owner'),other=await mintToken('mxmx_test_reservation_other');
 const [id]=await reserveIds({tokenId:token.id,userId:null},'batch_000000000002');
 const post=(credential:string,markup:string,key:string)=>create(request('/api/artifacts',{method:'POST',token:credential,headers:{'Idempotency-Key':key},json:{reserved_id:id,markup}}));
 expect((await post(other.token,'<p>Steal</p>','create_000000000003')).status).toBe(403);
 expect((await post(token.token,'<UnknownWidget />','create_000000000004')).status).toBe(400);
 const results=await Promise.all([post(token.token,'<p>A</p>','create_000000000005'),post(token.token,'<p>B</p>','create_000000000006')]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
});
it('keeps dataset reference ids unchanged and refuses unuploaded data dependencies',async()=>{
 const token=await mintToken('mxmx_test_reserved_graph');const ids=await reserveIds({tokenId:token.id,userId:null},'batch_000000000003');
 const markup=`<Helmet><Query name="sales" source="ref:${ids[0]}">{\`select * from public.rows\`}</Query></Helmet><p>Sales</p>`;
 const post=(body:Record<string,unknown>)=>create(request('/api/artifacts',{method:'POST',token:token.token,json:body}));
 expect((await post({reserved_id:ids[1],markup})).status).not.toBe(201);
 const data=await post({reserved_id:ids[0],dataset:[{amount:42}]});expect(data.status).toBe(201);expect((await data.json()).id).toBe(ids[0]);
 const doc=await post({reserved_id:ids[1],markup});expect(doc.status).toBe(201);expect((await doc.json()).markup).toContain(`ref:${ids[0]}`);
});

it('real CLI recovers a lost create response without changing the reserved document ID',async()=>{
 let lost=false;const transport=artifactTransport();
 const cli=await cliWorkspace('reserved-cli',{fetch:async(input,init)=>{
  const response=await transport(input,init);
  if(!lost&&init?.method==='POST'&&new URL(String(input)).pathname==='/api/artifacts'){lost=true;throw Error('Lost committed response');}
  return response;
 }});
 try{
  await cli.connect('mxmx_test_reserved_cli');
  await writeFile(join(cli.root,'report.jsx'),'<p>Draft</p>');const id=(await cli.invoke(['add','report.jsx']))['report.jsx'];
  expect((await cli.run(['push','report.jsx'])).code).not.toBe(0);expect(lost).toBe(true);
  await cli.invoke(['push','report.jsx']);expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toContain(`id: ${id}`);
  expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id}]);
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Draft','Updated'));
  await cli.invoke(['push','report.jsx']);expect((await(await getDb()).query('SELECT id,version FROM artifacts')).rows).toEqual([{id,version:2}]);
 }finally{await cli.cleanup();}
});
it('previews unpublished document and dataset IDs locally with no server reads',async()=>{
 const cli=await cliWorkspace('reserved-preview');let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const token=await cli.connect('mxmx_test_reserved_preview');const [report,data,appendix,picture]=await reserveIds({tokenId:token.id,userId:null},'batch_000000000005');
  await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');await writeFile(join(cli.root,'picture.png'),Buffer.from([1,2,3]));
  const source=`---\nid: ${report}\n---\n<Helmet><Query name="sales" source="ref:${data}">{\`select sum(amount) as total from public.rows\`}</Query></Helmet><a href="/a/${appendix}">Appendix</a><img src="ref:${picture}" alt="Picture" />`;
  await writeFile(join(cli.root,'report.jsx'),source);await writeFile(join(cli.root,'appendix.jsx'),`---\nid: ${appendix}\n---\n<p>Appendix</p>`);
  session=await startPreview({root:cli.root,home:cli.home,files:['report.jsx'],localFiles:{[report]:'report.jsx',[data]:'sales.csv',[appendix]:'appendix.jsx',[picture]:'picture.png'},dataset:async()=>{throw Error('Unexpected server read');}});
  const result=await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})});
  expect((await result.json()).tables?.sales?.rows).toEqual([{total:42}]);
  const link=await fetch(session.url+'/a/'+appendix,{redirect:'manual'});expect(link.status).toBe(302);expect(link.headers.get('location')).toBe('/workspace/appendix.jsx');
  const pictureResponse=await fetch(session.url+'/remote/'+picture);expect(pictureResponse.status).toBe(200);expect(Buffer.from(await pictureResponse.arrayBuffer())).toEqual(Buffer.from([1,2,3]));
  expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(source);
 }finally{await session?.close();await cli.cleanup();}
});

it('HTTP reservations require an account and survive token rotation without crossing accounts',async()=>{
 const user=await createUser({email:'mxmx_test_ids@example.test'}),otherUser=await createUser({email:'mxmx_test_other_ids@example.test'});
 const first=await mintToken('first',user.id),rotated=await mintToken('rotated',user.id),other=await mintToken('other',otherUser.id),anonymous=await mintToken('anonymous');
 const call=(token?:string)=>reserve(request('/api/artifacts/reservations',{method:'POST',token,headers:{'Idempotency-Key':'batch_account_000001'}}));
 expect((await call()).status).toBe(401);expect((await call(anonymous.token)).status).toBe(403);
 const response=await call(first.token);expect(response.status).toBe(200);const batch=await response.json();
 expect(batch.ids).toHaveLength(100);expect(await(await call(rotated.token)).json()).toEqual(batch);
 const foreign=await(await call(other.token)).json();expect(foreign.ids.some((id:string)=>batch.ids.includes(id))).toBe(false);
 const publish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:batch.ids[0],markup:'<p>Same account</p>'}}));
 expect((await publish(other.token)).status).toBe(403);expect((await publish(rotated.token)).status).toBe(201);
});
it('ordinary creates skip reserved identities and reservation allocation skips existing artifacts',async()=>{
 const token=await mintToken('mxmx_test_id_collision'),actor={tokenId:token.id,userId:null};
 const ids=await reserveIds(actor,'batch_collision_0001');
 const spy=vi.spyOn(identifiers,'generateFileId');
 try{
  spy.mockReturnValueOnce(ids[0]!);
  const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Ordinary</p>'}}));
  expect(response.status).toBe(201);const ordinary=await response.json();expect(ids).not.toContain(ordinary.id);
  spy.mockReturnValueOnce(ordinary.id).mockReturnValueOnce(ids[1]!);
  const next=await reserveIds(actor,'batch_collision_0002');expect(next).toHaveLength(100);expect(next).not.toContain(ordinary.id);expect(next.some(id=>ids.includes(id))).toBe(false);
 }finally{spy.mockRestore();}
});

it('registers idempotently, uses its offline pool, preserves moves and rejects duplicate JSX identities',async()=>{
 const cli=await cliWorkspace('registration');
 try{
  const user=await createUser({email:'mxmx_test_registration@example.test'});const token=await cli.connect('registration',user.id);
  let batches=0,offline=false;
  const client=new HttpClient({connection:{server:'http://localhost:3000',token:token.token},account:user.id,home:cli.home,fetch:artifactTransport([],async(req,url)=>{
   if(offline)throw Error('offline');if(url.pathname==='/api/artifacts/reservations'){batches++;return reserve(req);}
  })});
  await writeFile(join(cli.root,'report.jsx'),'<p>Draft</p>');await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');
  const workspace=await loadWorkspace(cli.root,cli.home);
  const ids=await addFiles(workspace,['report.jsx','sales.csv'],client);expect(Object.keys(ids)).toEqual(['report.jsx','sales.csv']);expect(batches).toBe(1);
  offline=true;expect(await addFiles(await loadWorkspace(cli.root,cli.home),['report.jsx','sales.csv'],client)).toEqual(ids);
  await writeFile(join(cli.root,'appendix.jsx'),'<p>Appendix</p>');expect((await addFiles(await loadWorkspace(cli.root,cli.home),['appendix.jsx'],client))['appendix.jsx']).not.toBe(ids['report.jsx']);expect(batches).toBe(1);
  await moveFile(workspace,'sales.csv','renamed.csv');expect((await localIdentities(workspace))[ids['sales.csv']!]).toBe('renamed.csv');
  await rename(join(cli.root,'report.jsx'),join(cli.root,'moved.jsx'));
  expect((await addFiles(await loadWorkspace(cli.root,cli.home),['moved.jsx'],client))['moved.jsx']).toBe(ids['report.jsx']);
  await copyFile(join(cli.root,'moved.jsx'),join(cli.root,'duplicate.jsx'));
  await expect(addFiles(await loadWorkspace(cli.root,cli.home),['duplicate.jsx'],client)).rejects.toThrow(/duplicate/i);
  const foreign=new HttpClient({connection:client.connection,account:'different-account',home:cli.home,fetch:async()=>{throw Error('No network expected');}});
  await expect(addFiles(await loadWorkspace(cli.root,cli.home),['renamed.csv'],foreign)).rejects.toThrow(/account/i);
  expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toHaveLength(0);
 }finally{await cli.cleanup();}
});

it('CLI add, preview mapping and push preserve a registered dependency graph through publication',async()=>{
 const transport=artifactTransport([],async(req,url)=>url.pathname==='/api/artifacts/reservations'?reserve(req):url.pathname==='/api/artifacts'&&req.method==='GET'?list(req):undefined);
 const cli=await cliWorkspace('registered-graph',{fetch:transport});
 try{
  const user=await createUser({email:'mxmx_test_graph@example.test'});await cli.connect('graph',user.id);
  await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');await writeFile(join(cli.root,'report.jsx'),'<p>Draft</p>');
  const ids=await cli.invoke(['add','sales.csv','report.jsx']);
  expect(ids['sales.csv']).toMatch(/^[A-Za-z0-9]{6}$/);expect(await cli.invoke(['add','sales.csv','report.jsx'])).toEqual(ids);
  const source=(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('<p>Draft</p>',`<Helmet><Query name="sales" source="ref:${ids['sales.csv']}">{\`select * from public.rows\`}</Query></Helmet><p>Sales</p>`);
  await writeFile(join(cli.root,'report.jsx'),source);
  await cli.invoke(['push','report.jsx']);
  expect((await(await getDb()).query('SELECT id FROM artifacts ORDER BY id')).rows.map(row=>row.id)).toEqual(Object.values(ids).sort());
  expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toContain('ref:'+ids['sales.csv']);
  await writeFile(join(cli.root,'bare.jsx'),'<p>Registered draft</p>');
  const bare=await cli.invoke(['add','bare.jsx']);
  const pushed=await cli.invoke(['push']);expect(pushed.operations.some((op:{id?:string})=>op.id===bare['bare.jsx'])).toBe(true);
  await cli.invoke(['mv','sales.csv','renamed.csv']);
  expect((await localIdentities(await loadWorkspace(cli.root,cli.home)))[ids['sales.csv']]).toBe('renamed.csv');
 }finally{await cli.cleanup();}
});

it('replays a lost reservation response and refuses offline exhaustion without reusing identities',async()=>{
 const cli=await cliWorkspace('pool-recovery');
 try{
  const user=await createUser({email:'mxmx_test_pool@example.test'}),token=await cli.connect('pool',user.id);
  let lost=false,offline=false;const keys:string[]=[];
  const client=new HttpClient({connection:{server:'http://localhost:3000',token:token.token},account:user.id,home:cli.home,fetch:artifactTransport([],async(req,url)=>{
   if(url.pathname!=='/api/artifacts/reservations')return;
   if(offline)throw Error('offline');keys.push(req.headers.get('Idempotency-Key')!);const response=await reserve(req);
   if(!lost){lost=true;throw Error('lost response');}return response;
  })});
  await writeFile(join(cli.root,'data.csv'),'value\n1\n');const workspace=await loadWorkspace(cli.root,cli.home);
  await expect(addFiles(workspace,['data.csv'],client)).rejects.toThrow();
  const ids=await addFiles(workspace,['data.csv'],client);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  expect((await(await getDb()).query('SELECT id FROM artifact_id_registry')).rows).toHaveLength(100);
  offline=true;const state=await stateFor(cli.home),key=JSON.stringify([client.connection.server,user.id]);
  const pool=state.get<{ids:string[]}>(HOME_SCOPE,'identity-pool',key)!.value;expect(pool.ids).toHaveLength(99);
  state.put(HOME_SCOPE,'identity-pool',key,{ids:[]});
  await writeFile(join(cli.root,'next.csv'),'value\n2\n');await expect(addFiles(await loadWorkspace(cli.root,cli.home),['next.csv'],client)).rejects.toThrow();
  expect((await localIdentities(workspace))[ids['data.csv']!]).toBe('data.csv');expect(Object.keys(await localIdentities(workspace))).toHaveLength(1);
 }finally{await cli.cleanup();}
});

it('publishes mutually linked draft documents without rewriting or duplicating their IDs',async()=>{
 const cli=await cliWorkspace('navigation-cycle',{fetch:artifactTransport([],async(req,url)=>url.pathname==='/api/artifacts/reservations'?reserve(req):url.pathname==='/api/artifacts'&&req.method==='GET'?list(req):undefined)});
 try{
  const user=await createUser({email:'mxmx_test_navigation@example.test'});await cli.connect('navigation',user.id);
  await writeFile(join(cli.root,'a.jsx'),'<p>A</p>');await writeFile(join(cli.root,'b.jsx'),'<p>B</p>');const ids=await cli.invoke(['add','a.jsx','b.jsx']);
  for(const [file,other] of [['a.jsx','b.jsx'],['b.jsx','a.jsx']])await writeFile(join(cli.root,file!), (await readFile(join(cli.root,file!),'utf8'))+`<a href="/a/${ids[other!]}">Other</a>`);
  await cli.invoke(['push','a.jsx']);expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toHaveLength(2);
  await cli.invoke(['push','a.jsx']);expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toHaveLength(2);
 }finally{await cli.cleanup();}
});
