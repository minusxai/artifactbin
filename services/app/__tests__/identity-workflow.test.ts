import {it,expect,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import { createGuestOwner, mergeGuestUsers } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as create,GET as list} from '@/app/api/artifacts/route';
import {GET as read,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {GET as readVersion} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {GET as readRaw} from '@/app/a/[id]/raw/route';
import {reserveIds} from '@/lib/artifacts';
import {writeFile,readFile,rename,copyFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {cliWorkspace,artifactTransport,CLI_SERVER,type CliCall} from './cli-harness';
import {digest} from '../../cli/src/files';
import {startPreview} from '../../cli/src/preview/session';
import {createUser} from '@/lib/accounts';
import * as identifiers from '@/lib/platform/ids';
import {POST as reserve} from '@/app/api/artifacts/reservations/route';
import {addFiles,moveFile,localIdentities} from '../../cli/src/identities';
import {loadWorkspace} from '../../cli/src/workspace';
import {HttpClient} from '../../cli/src/http';
import {stateFor} from '../../cli/src/state-access';
import {HOME_SCOPE} from '../../cli/src/state';
import {getDb} from '@/lib/platform';
useAppHarness();
async function publication(root:string):Promise<{ids:Record<string,string>}>{
 return JSON.parse(await readFile(join(root,'.artifactbin','publications',digest(CLI_SERVER).slice(0,24),'manifest.json'),'utf8'));
}
it('reserves an invisible batch and publishes the exact identity with durable replay',async()=>{
 const token=await mintToken('mxmx_test_reservations');const actor={tokenId:token.id,userId:token.userId};
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
 const [id]=await reserveIds({tokenId:token.id,userId:token.userId},'batch_000000000002');
 const post=(credential:string,markup:string,key:string)=>create(request('/api/artifacts',{method:'POST',token:credential,headers:{'Idempotency-Key':key},json:{reserved_id:id,markup}}));
 expect((await post(other.token,'<p>Steal</p>','create_000000000003')).status).toBe(403);
 expect((await post(token.token,'<UnknownWidget />','create_000000000004')).status).toBe(400);
 const results=await Promise.all([post(token.token,'<p>A</p>','create_000000000005'),post(token.token,'<p>B</p>','create_000000000006')]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
});
it('keeps dataset reference ids unchanged and refuses unuploaded data dependencies',async()=>{
 const token=await mintToken('mxmx_test_reserved_graph');const ids=await reserveIds({tokenId:token.id,userId:token.userId},'batch_000000000003');
 const markup=`<Helmet><Import name="sales_data" src="ref:${ids[0]}" /><Query name="sales">{\`select * from sales_data.rows\`}</Query></Helmet><p>Sales</p>`;
 const post=(body:Record<string,unknown>)=>create(request('/api/artifacts',{method:'POST',token:token.token,json:body}));
 expect((await post({reserved_id:ids[1],markup})).status).not.toBe(201);
 const data=await post({reserved_id:ids[0],dataset:[{amount:42}]});expect(data.status).toBe(201);expect((await data.json()).id).toBe(ids[0]);
 const doc=await post({reserved_id:ids[1],markup});expect(doc.status).toBe(201);expect((await doc.json()).markup).toContain(`ref:${ids[0]}`);
});

it('real CLI recovers a lost create response preserving local identity and reserved remote identity',async()=>{
 let lost=false;const calls:CliCall[]=[];const transport=artifactTransport(calls);
 const cli=await cliWorkspace('reserved-cli',{fetch:async(input,init)=>{
  const response=await transport(input,init);
  if(!lost&&init?.method==='POST'&&new URL(String(input)).pathname==='/api/artifacts'){lost=true;throw Error('Lost committed response');}
  return response;
 }});
 try{
  await cli.connect('mxmx_test_reserved_cli');
  await writeFile(join(cli.root,'report.jsx'),'<p>Draft</p>');const id=(await cli.invoke(['add','report.jsx']))['report.jsx'];
  expect((await cli.run(['push','report.jsx'])).code).not.toBe(0);expect(lost).toBe(true);
  const remoteId=(await publication(cli.root)).ids[id];expect(remoteId).toBeTruthy();expect(remoteId).not.toBe(id);
  const original=await readFile(join(cli.root,'report.jsx'),'utf8');
  const recovered=await cli.invoke(['push','report.jsx']);expect(recovered.operations).toEqual([{path:'report.jsx',status:'skipped',reason:'no_remote_changes'}]);expect((await publication(cli.root)).ids[id]).toBe(remoteId);
  expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(original);
  expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id:remoteId}]);
  expect(calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts').map(call=>(call.body as {reserved_id:string}).reserved_id)).toEqual([remoteId,remoteId]);
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Draft','Updated'));
  await cli.invoke(['push','report.jsx']);expect((await(await getDb()).query('SELECT id,version FROM artifacts')).rows).toEqual([{id:remoteId,version:2}]);expect((await publication(cli.root)).ids[id]).toBe(remoteId);expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toContain(`id: ${id}`);
 }finally{await cli.cleanup();}
});
it('previews unpublished document and dataset IDs locally with no server reads',async()=>{
 const cli=await cliWorkspace('reserved-preview');let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  const token=await cli.connect('mxmx_test_reserved_preview');const [report,data,appendix,picture]=await reserveIds({tokenId:token.id,userId:token.userId},'batch_000000000005');
  await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');await writeFile(join(cli.root,'picture.png'),Buffer.from([1,2,3]));
  const source=`---\nid: ${report}\n---\n<Helmet><Import name="sales_data" src="ref:${data}" /><Query name="sales">{\`select sum(amount) as total from sales_data.rows\`}</Query></Helmet><a href="/a/${appendix}">Appendix</a><img src="ref:${picture}" alt="Picture" />`;
  await writeFile(join(cli.root,'report.jsx'),source);await writeFile(join(cli.root,'appendix.jsx'),`---\nid: ${appendix}\n---\n<p>Appendix</p>`);
  session=await startPreview({root:cli.root,home:cli.home,files:['report.jsx'],localFiles:{[report]:'report.jsx',[data]:'sales.csv',[appendix]:'appendix.jsx',[picture]:'picture.png'},dataset:async()=>{throw Error('Unexpected server read');}});
  const result=await fetch(session.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',values:{}})});
  expect((await result.json()).tables?.sales?.rows).toEqual([{total:42}]);
  const link=await fetch(session.url+'/a/'+appendix,{redirect:'manual'});expect(link.status).toBe(302);expect(link.headers.get('location')).toBe('/workspace/appendix.jsx');
  const pictureResponse=await fetch(session.url+'/remote/'+picture);expect(pictureResponse.status).toBe(200);expect(Buffer.from(await pictureResponse.arrayBuffer())).toEqual(Buffer.from([1,2,3]));
  expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(source);
 }finally{await session?.close();await cli.cleanup();}
});

it('authenticated reservations survive account token rotation and isolate guest token namespaces',async()=>{
 const user=await createUser({email:'mxmx_test_ids@example.test'}),otherUser=await createUser({email:'mxmx_test_other_ids@example.test'});
 const first=await mintToken('first',user.id),rotated=await mintToken('rotated',user.id),other=await mintToken('other',otherUser.id),anonymous=await mintToken('anonymous'),otherGuest=await mintToken('other-guest');
 const call=(token?:string)=>reserve(request('/api/artifacts/reservations',{method:'POST',token,headers:{'Idempotency-Key':'batch_account_000001'}}));
 expect((await call()).status).toBe(401);
 const guest=await call(anonymous.token);expect(guest.status).toBe(200);const guestBatch=await guest.json();expect(guestBatch.ids).toHaveLength(100);expect(await(await call(anonymous.token)).json()).toEqual(guestBatch);
 const secondGuest=await(await call(otherGuest.token)).json();expect(secondGuest.ids.some((id:string)=>guestBatch.ids.includes(id))).toBe(false);
 const response=await call(first.token);expect(response.status).toBe(200);const batch=await response.json();
 expect(batch.ids).toHaveLength(100);expect(await(await call(rotated.token)).json()).toEqual(batch);expect(guestBatch.ids.some((id:string)=>batch.ids.includes(id))).toBe(false);
 const foreign=await(await call(other.token)).json();expect(foreign.ids.some((id:string)=>batch.ids.includes(id))).toBe(false);
 const publish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:batch.ids[0],markup:'<p>Same account</p>'}}));
 expect((await publish(other.token)).status).toBe(403);expect((await publish(anonymous.token)).status).toBe(403);expect((await publish(rotated.token)).status).toBe(201);
 const guestPublish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:guestBatch.ids[0],markup:'<p>Guest namespace</p>',visibility:'unlisted'}}));
 expect((await guestPublish(otherGuest.token)).status).toBe(403);expect((await guestPublish(anonymous.token)).status).toBe(201);
});
it('ordinary creates skip reserved identities and reservation allocation skips existing artifacts',async()=>{
 const token=await mintToken('mxmx_test_id_collision'),actor={tokenId:token.id,userId:token.userId};
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
  const user=await createUser({email:'mxmx_test_graph@example.test'});const token=await cli.connect('graph',user.id);
  await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');await writeFile(join(cli.root,'report.jsx'),'<p>Draft</p>');
  const ids=await cli.invoke(['add','sales.csv','report.jsx']);
  expect(ids['sales.csv']).toMatch(/^[A-Za-z0-9]{6}$/);expect(await cli.invoke(['add','sales.csv','report.jsx'])).toEqual(ids);
  const source=(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('<p>Draft</p>',`<Helmet><Import name="sales_data" src="ref:${ids['sales.csv']}" /><Query name="sales">{\`select * from sales_data.rows\`}</Query></Helmet><p>Sales</p>`);
  await writeFile(join(cli.root,'report.jsx'),source);
  await cli.invoke(['push','report.jsx']);
  const mapping=(await publication(cli.root)).ids;
  expect((await(await getDb()).query('SELECT id FROM artifacts ORDER BY id')).rows.map(row=>row.id)).toEqual(Object.values(mapping).sort());
  const remote=await(await read(request('/api/artifacts/'+mapping[ids['report.jsx']],{token:token.token}),{params:Promise.resolve({id:mapping[ids['report.jsx']]})})).json();
  expect(remote.markup).toContain('ref:'+mapping[ids['sales.csv']]);expect(remote.markup).not.toContain('ref:'+ids['sales.csv']);
  expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(source);
  await writeFile(join(cli.root,'bare.jsx'),'<p>Registered draft</p>');
  const bare=await cli.invoke(['add','bare.jsx']);
  const pushed=await cli.invoke(['push']);const bareRemote=(await publication(cli.root)).ids[bare['bare.jsx']];expect(pushed.operations.some((op:{id?:string})=>op.id===bareRemote)).toBe(true);expect(bareRemote).not.toBe(bare['bare.jsx']);
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

it('publishes mutually linked local documents with stable mapped IDs through a lost response and ordered SQL dependencies',async()=>{
 const calls:CliCall[]=[];const transport=artifactTransport(calls);let lost=false;
 const cli=await cliWorkspace('navigation-cycle',{fetch:async(input,init)=>{
  if(init?.method==='POST'&&new URL(String(input)).pathname==='/api/artifacts'){
   const mapped=(await publication(cli.root)).ids;
   expect(Object.values(mapped)).toHaveLength(3);
   expect(Object.values(mapped)).toContain(JSON.parse(String(init.body)).reserved_id);
  }
  const response=await transport(input,init);
  if(!lost&&init?.method==='POST'&&new URL(String(input)).pathname==='/api/artifacts'&&String(JSON.parse(String(init.body)).markup).includes('<Import')){lost=true;throw Error('Lost linked document response');}
  return response;
 }});
 try{
  const user=await createUser({email:'mxmx_test_navigation@example.test'});const token=await cli.connect('navigation',user.id);
  await writeFile(join(cli.root,'a.jsx'),'<p>A</p>');await writeFile(join(cli.root,'b.jsx'),'<p>B</p>');await writeFile(join(cli.root,'sales.csv'),'amount\n42\n');const ids=await cli.invoke(['add','a.jsx','b.jsx','sales.csv']);
  for(const [file,other] of [['a.jsx','b.jsx'],['b.jsx','a.jsx']])await writeFile(join(cli.root,file!), (await readFile(join(cli.root,file!),'utf8'))+`<a href="/a/${ids[other!]}">Other</a>`);
  await writeFile(join(cli.root,'b.jsx'),(await readFile(join(cli.root,'b.jsx'),'utf8'))+`<Helmet><Import name="data" src="ref:${ids['sales.csv']}" /><Query name="q">{\`select * from data.rows\`}</Query></Helmet>`);
  const originals=await Promise.all(['a.jsx','b.jsx','sales.csv'].map(file=>readFile(join(cli.root,file),'utf8')));
  expect((await cli.run(['push','a.jsx'])).code).not.toBe(0);expect(lost).toBe(true);
  const mapped=(await publication(cli.root)).ids;
  await cli.invoke(['push','a.jsx']);
  expect((await(await getDb()).query('SELECT id,version FROM artifacts ORDER BY id')).rows).toEqual(Object.values(mapped).sort().map(id=>({id,version:1})));
  for(const [file,other] of [['a.jsx','b.jsx'],['b.jsx','a.jsx']]){
   const id=mapped[ids[file!]];const head=await(await read(request('/api/artifacts/'+id,{token:token.token}),{params:Promise.resolve({id})})).json();expect(head.markup).toContain(`/a/${mapped[ids[other!]]}`);expect(head.markup).not.toContain(`/a/${ids[other!]}`);
  }
  const creates=calls.filter(call=>call.method==='POST'&&call.path==='/api/artifacts').map(call=>(call.body as {reserved_id:string}).reserved_id);
  expect(creates.indexOf(mapped[ids['sales.csv']])).toBeLessThan(creates.indexOf(mapped[ids['b.jsx']]));expect(creates.filter(id=>id===mapped[ids['b.jsx']])).toHaveLength(2);expect(new Set(creates).size).toBe(3);
  const count=calls.length;await cli.invoke(['push','a.jsx']);expect(calls.slice(count).map(call=>`${call.method} ${call.path}`)).toEqual(['GET /api/artifacts']);expect((await publication(cli.root)).ids).toEqual(mapped);
  expect(await Promise.all(['a.jsx','b.jsx','sales.csv'].map(file=>readFile(join(cli.root,file),'utf8')))).toEqual(originals);
 }finally{await cli.cleanup();}
});
it('refuses cyclic dataset dependencies before reserving or publishing and preserves local files',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('dataset-cycle',{fetch:artifactTransport(calls)});
 try{
  await cli.connect('mxmx_test_dataset_cycle');await writeFile(join(cli.root,'a.csv'),'link\nplaceholder\n');await writeFile(join(cli.root,'b.csv'),'link\nplaceholder\n');const ids=await cli.invoke(['add','a.csv','b.csv']);
  await writeFile(join(cli.root,'a.csv'),`link\nref:${ids['b.csv']}\n`);await writeFile(join(cli.root,'b.csv'),`link\nref:${ids['a.csv']}\n`);
  const original=await readFile(join(cli.root,'a.csv'),'utf8');calls.length=0;
  const result=await cli.run(['push','a.csv']);expect(result.code).not.toBe(0);expect(result.result.error.code).toBe('dependency_cycle');expect(calls.every(call=>call.path==='/api/server'&&call.method==='GET')).toBe(true);expect(await readFile(join(cli.root,'a.csv'),'utf8')).toBe(original);
 }finally{await cli.cleanup();}
});

it('CLI browser guest credentials publish local public and unlisted documents without an email account',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('guest-publication',{fetch:artifactTransport(calls)});
 try{
  const token=await cli.connect('mxmx_test_guest_publication',null);
  for(const visibility of ['public','unlisted'])await writeFile(join(cli.root,visibility+'.jsx'),`---\nvisibility: ${visibility}\n---\n<p>Guest ${visibility}</p>`);
  const ids=await cli.invoke(['add','public.jsx','unlisted.jsx']);const originals=await Promise.all(['public.jsx','unlisted.jsx'].map(file=>readFile(join(cli.root,file),'utf8')));
  const pushed=await cli.invoke(['push','public.jsx','unlisted.jsx']);expect(pushed.local_source_preserved).toBe(true);
  const mapped=(await publication(cli.root)).ids;
  expect((await(await getDb()).query('SELECT user_id FROM tokens WHERE id=$1',[token.id])).rows).toEqual([{user_id:null}]);
  for(const visibility of ['public','unlisted']){
   const localId=ids[visibility+'.jsx'],id=mapped[localId];expect(id).toBeTruthy();expect(id).not.toBe(localId);
   const response=await read(request('/api/artifacts/'+id,{token:token.token}),{params:Promise.resolve({id})});expect(response.status).toBe(200);expect((await response.json()).visibility).toBe(visibility);
  }
  expect(calls.some(call=>call.path==='/api/artifacts/reservations')).toBe(true);expect(calls.filter(call=>call.path==='/api/artifacts'&&call.method==='POST')).toHaveLength(2);
  expect(await Promise.all(['public.jsx','unlisted.jsx'].map(file=>readFile(join(cli.root,file),'utf8')))).toEqual(originals);
 }finally{await cli.cleanup();}
});

it('an adopted browser guest workspace continues with a new account token while another actor is refused before writes',async()=>{
 const calls:CliCall[]=[];const accounts:string[]=[];const transport=artifactTransport(calls);
 const cli=await cliWorkspace('guest-claim-publication',{fetch:async(input,init)=>{accounts.push(new Headers(init?.headers).get('X-Artifactbin-Account')??'');return transport(input,init);}});
 try{
  const guest=await createGuestOwner({name:'mxmx_test_claim_guest'}),guestCli=await mintToken('mxmx_test_guest_cli',guest.userId);await cli.useToken(guestCli.token);await writeFile(join(cli.root,'report.jsx'),'---\nvisibility: unlisted\n---\n<p>Guest draft</p>');
  const ids=await cli.invoke(['add','report.jsx']);await cli.invoke(['push','report.jsx']);
  const initial=await publication(cli.root),localId=ids['report.jsx'],remoteId=initial.ids[localId];
  const user=await createUser({email:'mxmx_test_claimed_publication@example.test'});await mergeGuestUsers(user.id,[guest.tokenId]);expect((await(await getDb()).query('SELECT kind,merged_into_user_id FROM users WHERE id=$1',[guest.userId])).rows).toEqual([{kind:'guest',merged_into_user_id:user.id}]);
  const account=await mintToken('mxmx_test_claimed_token',user.id);await cli.useToken(account.token);
  const source=(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Guest draft','Claimed account edit');await writeFile(join(cli.root,'report.jsx'),source);
  calls.length=0;accounts.length=0;await cli.invoke(['push','report.jsx']);
  expect(calls[0]).toMatchObject({method:'GET',path:'/api/artifacts'});expect(accounts[0]).toBe(guest.userId);
  expect(calls.filter(call=>call.method==='POST').map(call=>call.path)).toEqual([`/api/artifacts/${remoteId}/edits`]);
  expect(await publication(cli.root)).toMatchObject({account:guest.userId,ids:initial.ids});expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(source);
  expect((await(await getDb()).query('SELECT id,version,user_id FROM artifacts')).rows).toEqual([{id:remoteId,version:2,user_id:user.id}]);
  await writeFile(join(cli.root,'next.jsx'),'<p>New after sign-in</p>');const nextIds=await cli.invoke(['add','next.jsx']);const nextSource=await readFile(join(cli.root,'next.jsx'),'utf8');
  await cli.invoke(['push','next.jsx']);const nextRemote=(await publication(cli.root)).ids[nextIds['next.jsx']];
  expect(nextRemote).not.toBe(remoteId);expect(await readFile(join(cli.root,'next.jsx'),'utf8')).toBe(nextSource);
  expect((await(await getDb()).query('SELECT user_id,version FROM artifacts WHERE id=$1',[nextRemote])).rows).toEqual([{user_id:user.id,version:1}]);
  const unrelated=await createUser({email:'mxmx_test_foreign_claimed_publication@example.test'}),foreign=await mintToken('mxmx_test_foreign_claim_token',unrelated.id);await cli.useToken(foreign.token);
  const refusedSource=source.replace('Claimed account edit','Foreign proposal');await writeFile(join(cli.root,'report.jsx'),refusedSource);calls.length=0;
  const result=await cli.run(['push','report.jsx']);expect(result.code).not.toBe(0);expect(result.result.error.code).toBe('workspace_account_mismatch');expect(calls.map(call=>`${call.method} ${call.path}`)).toEqual(['GET /api/artifacts']);
  expect(await publication(cli.root)).toMatchObject({account:guest.userId,ids:initial.ids});expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toBe(refusedSource);
  expect((await(await getDb()).query('SELECT id,version FROM artifacts ORDER BY id')).rows).toEqual([{id:remoteId,version:2},{id:nextRemote,version:1}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
 }finally{await cli.cleanup();}
});

it('guest adoption preserves reservation replay and unused IDs despite an account batch with the same nonce',async()=>{
 const guest=await createGuestOwner({name:'mxmx_test_reserved_adoption'}),guestToken=await mintToken('guest-reserved',guest.userId);
 const account=await createUser({email:'mxmx_test_reserved_adopted@example.test'}),accountToken=await mintToken('account-reserved',account.id),other=await mintToken('foreign-reserved',(await createUser({email:'mxmx_test_reserved_foreign@example.test'})).id);
 const batch='batch_shared_adoption_001';
 const allocate=(token:string,pin?:string)=>reserve(request('/api/artifacts/reservations',{method:'POST',token,headers:{'Idempotency-Key':batch,...(pin?{'X-Artifactbin-Account':pin}:{})}}));
 const guestIds=(await(await allocate(guestToken.token)).json()).ids,accountIds=(await(await allocate(accountToken.token)).json()).ids;
 expect(guestIds.some((id:string)=>accountIds.includes(id))).toBe(false);
 await mergeGuestUsers(account.id,[guest.tokenId]);
 expect((await(await allocate(accountToken.token,guest.userId)).json()).ids).toEqual(guestIds);
 expect((await(await allocate(accountToken.token)).json()).ids).toEqual(accountIds);
 const publish=(token:string)=>create(request('/api/artifacts',{method:'POST',token,json:{reserved_id:guestIds[0],markup:'<p>After adoption</p>'}}));
 expect((await publish(other.token)).status).toBe(403);expect((await publish(accountToken.token)).status).toBe(201);expect((await publish(accountToken.token)).status).toBe(409);
 expect((await(await allocate(accountToken.token,guest.userId)).json()).ids).toEqual(guestIds);
});

it('marked pull edits the original, finalizes both stores, and keeps offline account ownership visible after credential replacement',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('bound-pull-rebind',{fetch:artifactTransport(calls),separateHome:true});
 try{
  const owner=await createUser({email:'mxmx_test_bound_owner@example.test'}),first=await cli.connect('mxmx_test_bound_token',owner.id);
  const made=await create(request('/api/artifacts',{method:'POST',token:first.token,json:{markup:'<p id="words">Original</p>',visibility:'unlisted'}}));expect(made.status).toBe(201);const head=await made.json();
  await writeFile(join(cli.root,'note.csv'),'value\n1\n');await cli.invoke(['add','note.csv']);await cli.invoke(['pull',head.id,'--output','report.jsx']);
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Original','Updated'));calls.length=0;
  await cli.invoke(['push','report.jsx']);expect(calls.filter(call=>call.method==='POST').map(call=>call.path)).toEqual([`/api/artifacts/${head.id}/edits`]);
  const status=await cli.invoke(['status']);expect(status.files.find((file:any)=>file.path==='report.jsx')).toMatchObject({id:head.id,status:'unchanged',version:2});expect(status.accounts).toMatchObject({observation:'last_observed',workspace:{account:owner.id}});
  calls.length=0;await cli.invoke(['push','report.jsx']);expect(calls).toEqual([]);
  const other=await createUser({email:'mxmx_test_bound_other@example.test'}),second=await mintToken('mxmx_test_bound_other_token',other.id);await cli.useToken(second.token);
  const unverified=await cli.invoke(['status'],async()=>{throw Error('offline status made HTTP');});expect(unverified.accounts.credential).toBeNull();
  await cli.invoke(['auth']);const offline=await cli.invoke(['status'],async()=>{throw Error('offline status made HTTP');});expect(offline.accounts).toMatchObject({workspace:{account:owner.id},credential:{account:other.id},publications:[{account:owner.id}]});
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Updated','Foreign'));const refused=await cli.run(['push','report.jsx']);expect(refused.code).toBe(3);expect(refused.result.error).toMatchObject({code:'workspace_account_mismatch',details:{http_status:409,expected_account:owner.id,actual_account:other.id,workspace_root:await realpath(cli.root)}});
  calls.length=0;const rebound=await cli.invoke(['workspace','rebind','--account','current']);expect(rebound.status).toBe('rebound');expect(calls.every(call=>call.method==='GET')).toBe(true);
  const denied=await cli.run(['push','report.jsx']);expect(denied.code).not.toBe(0);expect(denied.result.error.code).toBe('edit_required');expect((await(await getDb()).query('SELECT id,version,user_id FROM artifacts')).rows).toEqual([{id:head.id,version:2,user_id:owner.id}]);
  await writeFile(join(cli.root,'new.jsx'),'<p>New account draft</p>');await cli.invoke(['add','new.jsx']);await cli.invoke(['push','new.jsx']);expect((await(await getDb()).query('SELECT user_id FROM artifacts WHERE id<>$1',[head.id])).rows).toEqual([{user_id:other.id}]);
 }finally{await cli.cleanup();}
});

it('marked source-backed dataset YAML preserves source identity and updates existing content without another artifact',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('bound-dataset-yaml',{fetch:artifactTransport(calls),separateHome:true});
 try{
  const token=await cli.connect('mxmx_test_bound_dataset');const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{value:1}],visibility:'unlisted'}}));expect(made.status).toBe(201);const head=await made.json();
  await writeFile(join(cli.root,'note.csv'),'value\n1\n');await cli.invoke(['add','note.csv']);await cli.invoke(['pull',head.id,'--output','data.yaml']);
  const pulled=await readFile(join(cli.root,'data.yaml'),'utf8');expect(pulled).toContain('source:');const workspace=await loadWorkspace(cli.root,cli.home),source=workspace.tracking!.files['data.yaml']!.source!;
  await writeFile(join(cli.root,source.path),'[\n  {"value": 2}\n]\n');calls.length=0;
  await cli.invoke(['push','data.yaml']);expect(calls.some(call=>call.path==='/api/artifacts/reservations'||call.method==='POST'&&call.path==='/api/artifacts')).toBe(false);expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id:head.id}]);
  const current=await loadWorkspace(cli.root,cli.home);expect(current.tracking!.files['data.yaml']!.source!.path).toBe(source.path);expect(current.tracking!.files['data.yaml']!.source!.bytes).toBe((await readFile(join(cli.root,source.path))).toString('base64'));
  expect((await cli.invoke(['status'])).files.find((file:any)=>file.path==='data.yaml').status).toBe('unchanged');calls.length=0;await cli.invoke(['push','data.yaml']);expect(calls).toEqual([]);
  const sourceBytes=await readFile(join(cli.root,source.path));await writeFile(join(cli.root,'data.yaml'),(await readFile(join(cli.root,'data.yaml'),'utf8')).replace(/title:.*\n/,'title: Settings only\n'));calls.length=0;await cli.invoke(['push','data.yaml']);expect(calls.filter(call=>call.method==='PATCH').map(call=>call.path)).toEqual(['/api/artifacts/'+head.id]);expect(await readFile(join(cli.root,source.path))).toEqual(sourceBytes);expect((await cli.invoke(['status'])).files.find((file:any)=>file.path==='data.yaml').status).toBe('unchanged');
  await cli.invoke(['add',source.path]);calls.length=0;await cli.invoke(['push','data.yaml',source.path]);expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id:head.id}]);expect(calls.some(call=>call.path==='/api/artifacts/reservations'||call.path==='/api/artifacts'&&call.method==='POST')).toBe(false);
 }finally{await cli.cleanup();}
});

it('marked historical restore retains the current head guard and publishes into the same identity',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('bound-history',{fetch:artifactTransport(calls,async(req,url)=>{
  const match=/^\/api\/artifacts\/([^/]+)\/versions\/(\d+)$/.exec(url.pathname);return match?readVersion(req,{params:Promise.resolve({id:match[1]!,version:match[2]!})}):undefined;
 }),separateHome:true});
 try{
  const token=await cli.connect('mxmx_test_bound_history');const head=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="text">Version one</p>'}}))).json();
  await cli.invoke(['pull',head.id,'--output','report.jsx']);await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Version one','Version two'));await cli.invoke(['push','report.jsx']);
  await writeFile(join(cli.root,'note.csv'),'value\n1\n');await cli.invoke(['add','note.csv']);await cli.invoke(['pull',head.id+'@1','--output','report.jsx','--force']);
  const selected=(await loadWorkspace(cli.root,cli.home)).tracking!.files['report.jsx']!;expect(selected.selected?.version).toBe(1);expect(selected.snapshot.version).toBe(2);calls.length=0;
  await cli.invoke(['push','report.jsx']);expect(calls.some(call=>call.path==='/api/artifacts/reservations'||call.path==='/api/artifacts'&&call.method==='POST')).toBe(false);
  const actual=await(await read(request('/api/artifacts/'+head.id,{token:token.token}),{params:Promise.resolve({id:head.id})})).json();expect(actual.version).toBe(3);expect(actual.markup).toContain('Version one');
  expect((await cli.invoke(['status'])).files.find((file:any)=>file.path==='report.jsx').status).toBe('unchanged');
 }finally{await cli.cleanup();}
});

it('marked native binary publication preserves invalid UTF8 bytes and source identity',async()=>{
 const calls:CliCall[]=[];const cli=await cliWorkspace('bound-binary',{fetch:artifactTransport(calls,async(req,url)=>{const match=/^\/a\/([^/]+)\/raw$/.exec(url.pathname);return match?readRaw(req,{params:Promise.resolve({id:match[1]!})}):undefined;}),separateHome:true});
 try{
  const token=await cli.connect('mxmx_test_bound_binary');const made=await create(new Request(CLI_SERVER+'/api/artifacts?format=file&filename=scene.glb',{method:'POST',headers:{Authorization:'Bearer '+token.token,'Content-Type':'model/gltf-binary'},body:new Uint8Array([103,108,84,70,255])}));expect(made.status).toBe(201);const head=await made.json();
  await writeFile(join(cli.root,'note.csv'),'value\n1\n');await cli.invoke(['add','note.csv']);await cli.invoke(['pull',head.id,'--output','asset.yaml']);
  const source=(await loadWorkspace(cli.root,cli.home)).tracking!.files['asset.yaml']!.source!;const bytes=Buffer.from([103,108,84,70,254,0,255]);await writeFile(join(cli.root,source.path),bytes);calls.length=0;await cli.invoke(['push','asset.yaml']);
  expect(calls.some(call=>call.path==='/api/artifacts/reservations'||call.path==='/api/artifacts'&&call.method==='POST')).toBe(false);expect(await readFile(join(cli.root,source.path))).toEqual(bytes);expect((await cli.invoke(['status'])).files.find((file:any)=>file.path==='asset.yaml').status).toBe('unchanged');calls.length=0;await cli.invoke(['push','asset.yaml']);expect(calls).toEqual([]);
 }finally{await cli.cleanup();}
});

it('a committed marked edit with a lost reply recovers once before delivering newer typing',async()=>{
 const calls:CliCall[]=[];const transport=artifactTransport(calls);let lose=false;const cli=await cliWorkspace('bound-uncertain',{fetch:async(input,init)=>{const response=await transport(input,init);if(lose&&new URL(String(input)).pathname.endsWith('/edits')){lose=false;throw Error('reply lost after commit');}return response;},separateHome:true});
 try{
  const token=await cli.connect('mxmx_test_bound_uncertain');const head=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="text">Original</p>'}}))).json();await writeFile(join(cli.root,'note.csv'),'value\n1\n');await cli.invoke(['add','note.csv']);await cli.invoke(['pull',head.id,'--output','report.jsx']);
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('Original','First edit'));lose=true;const failed=await cli.run(['push','report.jsx']);expect(failed.code).not.toBe(0);expect((await(await getDb()).query('SELECT version FROM artifacts WHERE id=$1',[head.id])).rows).toEqual([{version:2}]);
  await writeFile(join(cli.root,'report.jsx'),(await readFile(join(cli.root,'report.jsx'),'utf8')).replace('First edit','New typing'));await cli.invoke(['push','report.jsx']);expect(calls.filter(call=>call.path==='/api/artifacts/'+head.id+'/edits')).toHaveLength(2);expect((await(await getDb()).query('SELECT version FROM artifacts WHERE id=$1',[head.id])).rows).toEqual([{version:3}]);expect(await readFile(join(cli.root,'report.jsx'),'utf8')).toContain('New typing');
 }finally{await cli.cleanup();}
});


it('unbound offline draft status reports verified selected-host credential account without HTTP',async()=>{
 const cli=await cliWorkspace('unbound-account-status',{fetch:artifactTransport(),separateHome:true});
 try{const owner=await createUser({email:'mxmx_test_offline_unbound@example.test'});await cli.connect('mxmx_test_offline_unbound_token',owner.id);await cli.invoke(['auth']);await writeFile(join(cli.root,'draft.jsx'),'<p>Offline</p>');await cli.invoke(['add','draft.jsx']);const status=await cli.invoke(['status'],async()=>{throw Error('offline status made HTTP');});expect(status.accounts).toMatchObject({workspace:null,credential:{account:owner.id,server:CLI_SERVER},observation:'last_observed'});}
 finally{await cli.cleanup();}
});
