import {afterEach,expect,it,vi} from 'vitest';
import {useAppHarness,request,mintAccountToken} from './harness';
import {createUser} from '@/lib/accounts';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {getDb} from '@/lib/platform/db';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as transfer} from '@/app/api/artifacts/[id]/transfer/route';
import {effectiveRole,ownsArtifact,canWriteDataset} from '@/lib/artifacts/access';
import {getArtifactById,getOwnedArtifactFor} from '@/lib/artifacts/store';
import {accountWorkspaceCoreFor} from '@/lib/workspace/dashboard';
import {subscribeToArtifact} from '@/lib/publish/realtime/live';
import {datasetGrantAllows,defaultDatasetGrants} from '@artifactbin/utils';
import {selectChildren} from '@/lib/artifacts/placement';
import {canReadArtifact} from '@/lib/artifacts/access';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {trashArtifactFor,restoreArtifactFor} from '@/lib/workspace/trash';
useAppHarness();
afterEach(()=>resetConfigOverrides());
async function fixture(){
 const creator=await createUser({email:'mxmx_test_group_creator@example.com'}),editor=await createUser({email:'mxmx_test_group_editor@example.com'}),viewer=await createUser({email:'mxmx_test_group_viewer@example.com'});
 const a=await mintAccountToken('group creator',creator.id),b=await mintAccountToken('group editor',editor.id),c=await mintAccountToken('group viewer',viewer.id);
 const db=await getDb();await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES('grp_ownership','ownership','Ownership','',$1)",[creator.id]);
 for(const [user,role] of [[creator,'editor'],[editor,'editor'],[viewer,'viewer']] as const)await db.query('INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)',['grp_ownership',user.id,role]);
 const make=async(body:object)=>{const response=await create(request('/api/artifacts',{method:'POST',token:a.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
 const move=(id:string,destination:object,bearer=a.token)=>transfer(request(`/api/artifacts/${id}/transfer`,{method:'POST',token:bearer,json:{destination}}),{params:Promise.resolve({id})});
 return {creator,editor,viewer,a,b,c,db,make,move};
}
it('echoes canonical ownership and immutable creator metadata from personal and group publication',async()=>{
 const f=await fixture();
 for(const destination of [{type:'personal'},{type:'group',id:'grp_ownership'}]){
  const response=await create(request('/api/artifacts',{method:'POST',token:f.b.token,json:{markup:'<p>Ownership echo</p>',destination}}));
  expect(response.status,await response.clone().text()).toBe(201);
  const wire=await response.json();
  expect(wire).toMatchObject({owner:destination,group_id:destination.type==='group'?'grp_ownership':null,creator_user_id:f.editor.id});
  expect(await getArtifactById(wire.id)).toMatchObject({group_id:wire.group_id,creator_user_id:wire.creator_user_id});
 }
});
it('transfers ownership, revokes creator and token fallback, and reflects live membership roles',async()=>{
 const f=await fixture();const id=await f.make({markup:'<p id="hello">Hello</p>',visibility:'private'});
 const moved=await f.move(id,{type:'group',id:'grp_ownership'});expect(moved.status,await moved.clone().text()).toBe(200);
 await f.db.query('DELETE FROM group_members WHERE user_id=$1',[f.creator.id]);
 const row=(await getArtifactById(id))!;expect(row).toMatchObject({user_id:null,group_id:'grp_ownership',creator_user_id:f.creator.id});
 expect(ownsArtifact(row,{tokenId:f.a.id,userId:f.creator.id})).toBe(false);
 expect(await getOwnedArtifactFor({tokenId:f.a.id,userId:f.creator.id},id)).toBeNull();
 expect(await canReadArtifact(row,{userId:f.creator.id,email:f.creator.email!})).toBe(false);
 const copied=await fork(request(`/api/artifacts/${id}/fork`,{method:'POST',token:f.a.token,json:{}}),{params:Promise.resolve({id})});expect(copied.status).toBe(404);
 expect(await effectiveRole(row,{userId:f.editor.id,tokenId:f.b.id})).toBe('owner');
 expect(await effectiveRole(row,{userId:f.viewer.id,tokenId:f.c.id})).toBe('viewer');
 await f.db.query("INSERT INTO artifact_shares(artifact_id,email,user_id,role) VALUES($1,$2,$3,'editor')",[id,f.viewer.email,f.viewer.id]);
 expect(await effectiveRole(row,{userId:f.viewer.id,tokenId:f.c.id})).toBe('editor');
 await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1',[id]);
 expect((await accountWorkspaceCoreFor(f.viewer.id,null,'grp_ownership'))?.artifacts.map(r=>r.id)).toContain(id);
 await f.db.query('DELETE FROM group_members WHERE user_id=$1',[f.viewer.id]);
 expect(await effectiveRole(row,{userId:f.viewer.id,tokenId:f.c.id})).toBe('none');
 expect(await accountWorkspaceCoreFor(f.viewer.id,null,'grp_ownership')).toBeNull();
 expect((await f.move(id,{type:'personal'},f.b.token)).status).toBe(200);
 expect((await getArtifactById(id))?.user_id).toBe(f.editor.id);
 expect((await getArtifactById(id))?.creator_user_id).toBe(f.creator.id);
 expect(ownsArtifact((await getArtifactById(id))!,{userId:null,tokenId:f.a.id})).toBe(false);
});
it('moves entire folders including trash and rejects unsafe dependencies without changing any row',async()=>{
 const f=await fixture();const folder=await f.make({format:'folder',title:'Reports'}),child=await f.make({markup:'<p>Child</p>',parent_id:folder});
 await trashArtifactFor({userId:f.creator.id,tokenId:f.a.id},child);
 expect((await f.move(folder,{type:'group',id:'grp_ownership'})).status).toBe(200);
 const state=(await f.db.query<{group_id:string;deleted_at:string|null}>('SELECT group_id,deleted_at FROM artifacts WHERE id=$1',[child])).rows[0];expect(state.group_id).toBe('grp_ownership');expect(state.deleted_at).not.toBeNull();
 expect(await restoreArtifactFor({userId:f.editor.id,tokenId:f.b.id},child)).not.toBeNull();
 const shelf=await selectChildren((await getArtifactById(folder))!,{userId:f.viewer.id,tokenId:f.c.id,email:f.viewer.email!});expect(shelf.children.map(r=>r.id)).toContain(child);expect(shelf.numbers).toBe(false);
 const dataset=await f.make({dataset:[{n:1}]});const report=await f.make({markup:`<Helmet><Import name="data" src="ref:${dataset}" /></Helmet><p>Report</p>`});
 expect((await f.move(dataset,{type:'group',id:'grp_ownership'})).status).toBe(409);
 expect((await getArtifactById(dataset))?.user_id).toBe(f.creator.id);expect((await getArtifactById(report))?.user_id).toBe(f.creator.id);
});
it('explicit creation destination beats preferences and group viewers cannot write dataset owner grants',async()=>{
 const f=await fixture();
 const made=await create(request('/api/artifacts',{method:'POST',token:f.b.token,json:{dataset:[{n:1}],destination:{type:'group',id:'grp_ownership'}}}));expect(made.status,await made.clone().text()).toBe(201);
 const row=(await getArtifactById((await made.json()).id))!;expect(row.group_id).toBe('grp_ownership');
 expect(await canWriteDataset(row,{userId:f.viewer.id,tokenId:f.c.id})).toBe('dataset_read_only');
 await f.db.query("UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1",[row.id,JSON.stringify({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{user:'$owner'}}]})]);
 const writable=(await getArtifactById(row.id))!;
 expect(await canWriteDataset(writable,{userId:f.editor.id,tokenId:f.b.id})).toBeNull();
 expect(await canWriteDataset(writable,{userId:f.viewer.id,tokenId:f.c.id})).toBe('dataset_read_only');
 await f.db.query('DELETE FROM group_members WHERE user_id=$1',[f.editor.id]);
 expect(await canWriteDataset(writable,{userId:f.editor.id,tokenId:f.b.id})).toBe('dataset_read_only');
});

it('consults unavailable deployment defaults only after explicit, parent and preference destinations',async()=>{
 const f=await fixture();overrideConfig({}, {APP__DEPLOYMENT_MODE:'company',APP__DEPLOYMENT_OWNER_EMAIL:f.creator.email!});
 // Admission is a separate fence: this existing account was already admitted.
 await f.db.query('INSERT INTO deployment_members(user_id) VALUES($1)',[f.creator.id]);
 const make=(destination?:object)=>create(request('/api/artifacts',{method:'POST',token:f.a.token,json:{markup:'<p>Default</p>',...(destination?{destination}:{})}}));
 expect((await make()).status).toBe(409);
 expect((await make({type:'personal'})).status).toBe(201);
 await f.db.query('INSERT INTO account_preferences(user_id,default_destination) VALUES($1,$2::jsonb)',[f.creator.id,JSON.stringify({type:'group',id:'grp_ownership'})]);
 expect((await make()).status).toBe(201);
});

it('preserves unlisted link reading while refusing former owner data writes and inaccessible destinations',async()=>{
 const f=await fixture();const id=await f.make({dataset:[{n:1}],visibility:'unlisted'});
 expect((await f.move(id,{type:'group',id:'grp_ownership'},f.c.token)).status).toBe(404);
 expect((await f.move(id,{type:'group',id:'grp_ownership'})).status).toBe(200);
 await f.db.query('DELETE FROM group_members WHERE user_id=$1',[f.creator.id]);
 const row=(await getArtifactById(id))!;expect(await canReadArtifact(row,null)).toBe(true);
 expect(await canWriteDataset(row,{userId:f.creator.id,tokenId:f.a.id})).toBe('dataset_read_only');
 expect((await create(request('/api/artifacts',{method:'POST',token:f.c.token,json:{markup:'<p>Refused</p>',destination:{type:'group',id:'grp_ownership'}}}))).status).toBe(403);
});

it('resolves group publication refs as the saved group owner and refuses creator private dependencies',async()=>{
 const f=await fixture();const make=async(body:object)=>create(request('/api/artifacts',{method:'POST',token:f.b.token,json:{...body,destination:{type:'group',id:'grp_ownership'}}}));
 const dataset=await make({dataset:[{n:1}],visibility:'private'});expect(dataset.status).toBe(201);const {id}=await dataset.json();
 const doc=await make({markup:`<Helmet><Import name="data" src="ref:${id}" /><Query name="rows">{\`select * from data.rows\`}</Query></Helmet><p>Group data</p>`});expect(doc.status,await doc.clone().text()).toBe(201);
 const personal=await create(request('/api/artifacts',{method:'POST',token:f.b.token,json:{dataset:[{n:2}],visibility:'private',destination:{type:'personal'}}}));expect(personal.status).toBe(201);const own=(await personal.json()).id;
 const broken=await make({markup:`<Helmet><Import name="data" src="ref:${own}" /></Helmet><p>Personal data</p>`});expect(broken.status).toBe(400);
});

it('compares dataset and published artifact group principals without treating a group as a user',()=>{
 const policy=defaultDatasetGrants(),caller={userId:'viewer_account',tokenId:null},owner={groupId:'grp_ownership',userId:null,tokenId:null};
 expect(datasetGrantAllows(policy,'insert',{caller,owner,artifact:{id:'doc123',owner:{...owner}}})).toBe(true);
 expect(datasetGrantAllows(policy,'insert',{caller,owner,artifact:{id:'doc123',owner:{groupId:'other_group',userId:null,tokenId:null}}})).toBe(false);
 expect(datasetGrantAllows(policy,'insert',{caller,owner})).toBe(false);
});

it('wakes existing artifact ACL subscribers only after transferred ownership is committed',async()=>{
 const f=await fixture(),id=await f.make({markup:'<p>Private</p>',visibility:'private'});
 expect((await f.move(id,{type:'group',id:'grp_ownership'})).status).toBe(200);
 let observed:string|null|undefined;
 const stop=await subscribeToArtifact(id,()=>{void getArtifactById(id).then(row=>{observed=row?.user_id;});});
 try{expect((await f.move(id,{type:'personal'},f.b.token)).status).toBe(200);await vi.waitFor(()=>expect(observed).toBe(f.editor.id));}
 finally{await stop();}
});

it('supports a verified browser account transfer without a bearer or token ID and preserves CSRF',async()=>{
 const f=await fixture(),id=await f.make({markup:'<p>Browser</p>'});
 const actor={credential:'session' as const,userId:f.creator.id,email:f.creator.email!,emailVerified:true};
 const body={destination:{type:'group',id:'grp_ownership'}};
 const response=await transfer(request(`/api/artifacts/${id}/transfer`,{method:'POST',actor,origin:'same',json:body}),{params:Promise.resolve({id})});expect(response.status,await response.clone().text()).toBe(200);
 const denied=await transfer(request(`/api/artifacts/${id}/transfer`,{method:'POST',actor,origin:'https://other.example',json:{destination:{type:'personal'}}}),{params:Promise.resolve({id})});expect(denied.status).toBe(403);
 expect((await getArtifactById(id))?.group_id).toBe('grp_ownership');
});

it('uses nonblocking transfer locks and rolls back busy artifact or group ownership changes',async()=>{
 const f=await fixture(),id=await f.make({markup:'<p>Busy ownership</p>'});
 const original=f.db.transaction.bind(f.db);const statements:string[][]=[];
 for(const busy of ['artifacts','groups']){
  const spy=vi.spyOn(f.db,'transaction').mockImplementation(fn=>original(tx=>{
   const queries:string[]=[];statements.push(queries);
   return fn({query:async(sql,values)=>{
    queries.push(sql);
    if((busy==='artifacts'&&sql.startsWith('LOCK TABLE artifacts'))||(busy==='groups'&&sql.includes('FROM groups')&&sql.includes('FOR UPDATE')))throw Object.assign(new Error('could not obtain lock'),{code:'55P03'});
    return tx.query(sql,values);
   }});
  }));
  try{
   const response=await f.move(id,{type:'group',id:'grp_ownership'});
   expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'transfer_refused',details:['Work is changing; retry ownership transfer']});
  }finally{spy.mockRestore();}
  expect(await getArtifactById(id)).toMatchObject({user_id:f.creator.id,group_id:null});
  expect((await f.db.query('SELECT id FROM ownership_transfers WHERE artifact_id=$1',[id])).rows).toHaveLength(0);
 }
 const spy=vi.spyOn(f.db,'transaction').mockImplementation(fn=>original(tx=>{
  const queries:string[]=[];statements.push(queries);
  return fn({query:async(sql,values)=>{queries.push(sql);return tx.query(sql,values);}});
 }));
 try{expect((await f.move(id,{type:'group',id:'grp_ownership'})).status).toBe(200);}finally{spy.mockRestore();}
 for(const queries of statements){
  expect(queries[0]).toBe('LOCK TABLE artifacts IN EXCLUSIVE MODE NOWAIT');
  for(const sql of queries.filter(sql=>/FOR (UPDATE|SHARE)/.test(sql)))expect(sql).toContain('NOWAIT');
 }
});
