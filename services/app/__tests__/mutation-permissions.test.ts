import {expect,it,vi} from 'vitest';
import {getDb} from '@/lib/db';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as anonymousQuery,POST as query} from '@/app/a/[id]/query/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {APP_CSP,createAppServer} from '@/server/app';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {agentCookie,request,useAppHarness} from './harness';
import {PATCH as patchArtifact} from '@/app/api/artifacts/[id]/route';
import {observedRequest} from '@/__tests__/conditional-request';
import {viewersWritePolicy} from '@artifactbin/utils';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function fixture(){
 const owner=await mintToken('owner');const friend=await mintToken('friend');
 const user=await createUser({email:'mxmx_test_dataset_friend@example.com'});await claimToken(user.id,friend.token);
 const publish=async(body:object)=>{const r=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(r.status,await r.clone().text()).toBe(201);return (await r.json()).id as string;};
 const ds=await publish({dataset:[{n:1}],access:'readwrite'});
 const doc=await publish({markup:`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button><DataTable data="$rows" />`});
 const cookie=await agentCookie([friend.id]);
 const write=(auth?:string)=>mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:auth,json:{mutation:'add'}}),ctx(doc));
 const permissions=async(auth?:string)=>{const r=auth?await query(request(`/a/${doc}/query`,{method:'POST',cookie:auth,json:{}}),ctx(doc)):await anonymousQuery(request(`/a/${doc}/query?q=%7B%7D`),ctx(doc));expect(r.status).toBe(200);return r.json();};
 const share=(id:string,role:'viewer'|'editor')=>updateSharingFor({tokenId:owner.id,userId:null},id,{shares:[{email:user.email,role}]});
 // What `afbin push … --policy viewers-write` sends, byte for byte.
 const grant=async()=>{const head=await getArtifactById(ds);const r=await patchArtifact(await observedRequest(`/api/artifacts/${ds}`,{method:'PATCH',token:owner.token,json:{policy:viewersWritePolicy(),expectedPolicyRevision:head!.policy_revision??0}}),ctx(ds));expect(r.status,await r.clone().text()).toBe(200);return r.json();};
 return {owner,friend,ds,doc,cookie,write,permissions,share,grant};
}
it('denies anonymous writes and exposes read-only capability without suppressing live query rows',async()=>{
 const f=await fixture();expect((await f.write()).status).toBe(403);
 expect((await getArtifactById(f.ds))?.version).toBe(1);
 const result=await f.permissions();expect(result.mutationAccess.add).toBeTruthy();expect(result.tables.rows.rows).toEqual([{n:1}]);
});
it('uses dataset roles independently of the document role and rechecks revocation',async()=>{
 const f=await fixture();await f.share(f.doc,'editor');
 expect((await f.write(f.cookie)).status).toBe(403);
 await f.share(f.ds,'editor');expect((await f.permissions(f.cookie)).mutationAccess.add).toBe(null);
 expect((await f.write(f.cookie)).status).toBe(200);
 await f.share(f.ds,'viewer');expect((await f.write(f.cookie)).status).toBe(403);
 expect((await f.permissions(f.cookie)).mutationAccess.add).toBeTruthy();
 expect((await f.permissions()).tables.rows.rows).toEqual([{n:1},{n:2}]);
});
it('gives a dataset editor the session relay even when they only view the document',async()=>{
 const f=await fixture();await f.share(f.ds,'editor');
 const app=createAppServer({indexHtml:async()=>'<html><head></head><body><div id="root"></div></body></html>'});
 expect((await app.request(request(`/a/${f.doc}`,{cookie:f.cookie}))).headers.get('content-security-policy')).toBe(APP_CSP);
 expect((await f.write(f.cookie)).status).toBe(200);
 await updateSharingFor({tokenId:f.owner.id,userId:null},f.ds,{access:'read'});
 expect((await f.write(f.cookie)).status).toBe(403);
 expect((await f.permissions(f.cookie)).mutationAccess.add).toBeTruthy();
});
it('refuses a save when the share is revoked while its SQL is running',async()=>{
 const f=await fixture();await f.share(f.ds,'editor');
 const db=await getDb();const original=db.query.bind(db);let revoked=false;
 const spy=vi.spyOn(db,'query').mockImplementation(async(sql:string,values?:unknown[])=>{
   if(!revoked && sql.includes('WITH updated AS') && sql.includes('actor_user_id = $13')){
     revoked=true;await original('DELETE FROM artifact_shares WHERE artifact_id = $1',[f.ds]);
   }
   return original(sql,values);
 });
 try {expect((await f.write(f.cookie)).status).toBe(403);expect((await getArtifactById(f.ds))?.version).toBe(1);}
 finally {spy.mockRestore();}
});

/*
 * The tracker's requirement, end to end: a page "anyone opening the link" can update needs the
 * `viewers-write` grant the CLI now publishes in one command. Without it a dataset VIEWER is
 * refused; with it the same viewer — and an anonymous reader of an unlisted dataset — writes.
 */
it('the viewers-write shorthand is what lets a viewer, and the link audience, write',async()=>{
 const f=await fixture();await f.share(f.ds,'viewer');
 expect((await f.write(f.cookie)).status,'no policy: only editors write').toBe(403);
 expect((await f.write()).status).toBe(403);
 const saved=await f.grant();
 expect(saved.dataset_policy).toEqual(viewersWritePolicy());
 expect(saved.policy_revision).toBe(1);
 expect((await f.write(f.cookie)).status,'the shared viewer now writes').toBe(200);
 expect((await f.write()).status,'and so does the link audience').toBe(200);
 expect((await getArtifactById(f.ds))?.version).toBe(3);
});
