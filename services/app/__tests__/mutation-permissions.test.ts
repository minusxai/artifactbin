import {expect,it,vi} from 'vitest';
import {getDb} from '@/lib/db';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {GET as anonymousQuery,POST as query} from '@/app/a/[id]/query/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/story/dataset-store';
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
 const grantFor=async(id:string)=>{const head=await getArtifactById(id);const r=await patchArtifact(await observedRequest(`/api/artifacts/${id}`,{method:'PATCH',token:owner.token,json:{policy:viewersWritePolicy(),expectedPolicyRevision:head!.policy_revision??0}}),ctx(id));expect(r.status,await r.clone().text()).toBe(200);return r.json();};
 const grant=()=>grantFor(ds);
 return {owner,friend,ds,doc,cookie,write,permissions,share,grant,grantFor,publish};
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

/*
 * THE TRACKER'S OWN SHAPE: a row button, whose statement is bound to `$_row`.
 * The policy is read off the statement's PLAN, and a `$_row.id` cannot be
 * planned unbound — so this whole feature (a viewer completing their row)
 * answered 403 "statement cannot be safely analyzed" while the plain mutation
 * above answered 200.
 */
it('a viewer completes their own row through a $_row row action',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,status:'open'},{id:2,status:'open'}],access:'readwrite'});
 const doc=await f.publish({markup:`<Helmet><Query name="tasks" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="complete" source="ref:${ds}">{\`update public.rows set status = 'done' where id = $_row.id\`}</Mutation></Helmet><For each={$tasks} keyBy="id"><Button run="$complete">Complete</Button></For>`});
 const click=(auth?:string,row:Record<string,unknown>={id:1,status:'open'})=>mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:auth,json:{mutation:'complete',row}}),ctx(doc));
 const tasks=async()=>{const r=await anonymousQuery(request(`/a/${doc}/query?q=%7B%7D`),ctx(doc));expect(r.status).toBe(200);return (await r.json()).tables.tasks.rows;};
 await f.share(ds,'viewer');
 expect((await click(f.cookie)).status,'no policy: only editors write').toBe(403);
 await f.grantFor(ds);
 const ran=await click(f.cookie);
 expect(ran.status,await ran.clone().text()).toBe(200);
 expect(await ran.json()).toMatchObject({affected:1});
 expect(await tasks()).toEqual([{id:1,status:'done'},{id:2,status:'open'}]);
 // The capability the page reads before it draws the button agrees: the same
 // analysis, with a placeholder row, is what enables the control.
 const capability=await query(request(`/a/${doc}/query`,{method:'POST',cookie:f.cookie,json:{}}),ctx(doc));
 expect((await capability.json()).mutationAccess.complete).toBe(null);
});

/*
 * DECLARED TYPES ON THE WRITE PATH. A `<Value type="date">` travels as the
 * string '2026-09-01', so the policy analysis used to plan it as VARCHAR and
 * refuse `coalesce($d, current_date)` for every reader who picked a date —
 * while publish, which binds NULLs, stayed green. The plan now follows the
 * DECLARED type, so this commits, and the mistyped twin below fails the push.
 */
it('a declared date Value is planned as a date, so a viewer writes one through a policed insert',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,due:'2026-01-01'}],access:'readwrite'});
 const doc=await f.publish({markup:`<Helmet><Value name="d" type="date" /><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows (id, due) select 2, coalesce($d, current_date)\`}</Mutation></Helmet><Button run="$add">Add</Button><DataTable data="$rows" />`});
 await f.share(ds,'viewer');
 await f.grantFor(ds);
 const r=await mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:f.cookie,json:{mutation:'add',values:{d:'2026-09-01'}}}),ctx(doc));
 expect(r.status,await r.clone().text()).toBe(200);
 const rows=await anonymousQuery(request(`/a/${doc}/query?q=%7B%7D`),ctx(doc));
 expect((await rows.json()).tables.rows.rows).toEqual([{id:1,due:'2026-01-01'},{id:2,due:'2026-09-01'}]);
});

it('a string Value used where a date is required fails the push, naming the mutation',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,due:'2026-01-01'}],access:'readwrite'});
 await f.grantFor(ds);
 const r=await create(request('/api/artifacts',{method:'POST',token:f.owner.token,json:{markup:`<Helmet><Value name="d" type="string" /><Mutation name="add" source="ref:${ds}">{\`insert into public.rows (id, due) select 2, coalesce($d, current_date)\`}</Mutation></Helmet><Button run="$add">Add</Button>`}}));
 expect(r.status,await r.clone().text()).toBe(400);
 const body=await r.json();
 expect(body.error).toBe('invalid_sql');
 expect(body.details.join(' ')).toMatch(/<Mutation name="add">/);
});

it('refuses a value whose type is not the one it was declared with, naming the parameter',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,amount:1.5}],access:'readwrite'});
 const doc=await f.publish({markup:`<Helmet><Value name="n" type="number" default={0} /><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows (id, amount) select 2, $n\`}</Mutation></Helmet><Button run="$add">Add</Button><DataTable data="$rows" />`});
 await f.share(ds,'viewer');
 await f.grantFor(ds);
 const send=(n:unknown)=>mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:f.cookie,json:{mutation:'add',values:{n}}}),ctx(doc));
 const bad=await send('12.5');
 expect(bad.status).toBe(400);
 expect((await bad.json()).detail).toMatch(/\$n/);
 expect((await send(12.5)).status,'the same value, correctly typed, writes').toBe(200);
});

/*
 * Found by rerunning the original prompt with a fresh agent: it cleared a date the way every
 * command line does, `--param spent_on=`, and the typed door refused the empty string. The
 * browser already reads an empty input as "no value" (coerceScalarInput); the door agrees.
 */
it('reads an empty string for a number, date or boolean Value as no value, and keeps it for a string',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,due:'2026-01-01',note:'x'}],access:'readwrite'});
 const doc=await f.publish({markup:`<Helmet><Value name="d" type="date" /><Value name="note" type="string" /><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows (id, due, note) select 2, coalesce($d, date '2026-02-02'), $note\`}</Mutation></Helmet><DataTable data="$rows" />`});
 await f.share(ds,'viewer');
 await f.grantFor(ds);
 const res=await mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:f.cookie,json:{mutation:'add',values:{d:'',note:''}}}),ctx(doc));
 expect(res.status,await res.clone().text()).toBe(200);
 const rows=(await loadDatasetRows((await getArtifactById(ds))!)) as Array<Record<string,unknown>>;
 expect(rows.find(r=>r.id===2)).toMatchObject({due:'2026-02-02',note:''});
});

/*
 * A row action declared before it is placed beside a row has one problem, and the publish door
 * names it. It used to go on to analyze the statement with no row to bind, and appended the
 * engine's own crash text ("Attempted to dereference unique_ptr that is NULL!") to the answer.
 */
it('names an unplaced row action once, without the engine\'s internal error beside it',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,note:'x'}],access:'readwrite'});
 await f.grantFor(ds);
 const res=await create(request('/api/artifacts',{method:'POST',token:f.owner.token,json:{markup:`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="unpay" source="ref:${ds}" expectedAffected={1}>{\`delete from public.rows where id = $_row.id\`}</Mutation></Helmet><DataTable data="$rows" />`}}));
 expect(res.status).toBe(400);
 const text=JSON.stringify(await res.json());
 expect(text).toMatch(/must be invoked inside a DataTable Column or keyed For/);
 expect(text).not.toMatch(/unique_ptr|dereference|cannot be safely analyzed/);
});

/*
 * THE LAST UNTYPED PARAMETER. A cell editor's `$_value` was still planned from the JavaScript
 * value: a date column's edit travels as text, so `greatest($_value, due)` was refused for every
 * viewer while publish, binding NULLs, saw nothing. The editor's Column names the column; that
 * column's declared type is `_value`'s type, at publish and at the click.
 */
it('types $_value from the column its editor sits in, at publish and at the click',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,due:'2026-01-01'}],access:'readwrite'});
 const page=(sql:string)=>`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="set_due" source="ref:${ds}" expectedAffected={1}>{\`${sql}\`}</Mutation></Helmet><DataTable data="$rows" rowKey="id"><Column col="id" /><Column col="due"><input type="text" value="$_row.due" run="$set_due" /></Column></DataTable>`;
 const doc=await f.publish({markup:page('update public.rows set due = greatest($_value, due) where id = $_row.id')});
 await f.share(ds,'viewer');
 await f.grantFor(ds);
 const edit=(value:unknown)=>mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:f.cookie,json:{mutation:'set_due',values:{_value:value},row:{id:1,due:'2026-01-01'}}}),ctx(doc));
 const later=await edit('2026-03-03');
 expect(later.status,await later.clone().text()).toBe(200);
 expect((await loadDatasetRows((await getArtifactById(ds))!))[0]).toMatchObject({due:'2026-03-03'});
 // A value the column cannot hold is refused by name, before any statement runs.
 const bad=await edit('not a date');
 expect(bad.status).toBe(400);
 expect(JSON.stringify(await bad.json())).toMatch(/_value/);
 // And a statement that uses a date cell's value as text fails the PUSH, naming the mutation.
 const text=await create(request('/api/artifacts',{method:'POST',token:f.owner.token,json:{markup:page('update public.rows set due = trim($_value) where id = $_row.id')}}));
 expect(text.status).toBe(400);
 expect(JSON.stringify(await text.json())).toMatch(/set_due/);
});

/* `$_me` is the caller. A value sent under that name is not a Value the document declares, so it is ignored. */
it('never lets a caller choose who $_me is',async()=>{
 const f=await fixture();
 const ds=await f.publish({dataset:[{id:1,who:'seed'}],access:'readwrite'});
 const doc=await f.publish({markup:`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows order by id\`}</Query><Mutation name="sign" source="ref:${ds}">{\`insert into public.rows (id, who) select 2, $_me\`}</Mutation></Helmet><DataTable data="$rows" />`});
 await f.share(ds,'viewer');
 await f.grantFor(ds);
 const res=await mutate(request(`/a/${doc}/mutate`,{method:'POST',cookie:f.cookie,json:{mutation:'sign',values:{_me:'usr_someone_else'}}}),ctx(doc));
 expect(res.status,await res.clone().text()).toBe(200);
 const rows=(await loadDatasetRows((await getArtifactById(ds))!)) as Array<Record<string,unknown>>;
 expect(rows.find(r=>r.id===2)!.who).not.toBe('usr_someone_else');
 expect(String(rows.find(r=>r.id===2)!.who)).toMatch(/^usr_/);
});

/*
 * A GUEST'S WRITE SAYS WHAT TO DO.
 *
 * A statement that binds `$_me` needs a person, and until now a guest learned
 * that by pressing the button and reading "$_me requires a logged-in user" —
 * a sentence about a parameter binding. The capability the page draws from and
 * the refusal a direct call gets now both carry `sign_in_required`, so the
 * page can offer the door instead. The status and `error` are unchanged.
 */
it('answers a guest with sign_in_required for a $_me write, in the capability and in the refusal',async()=>{
 const f=await fixture();
 const markup='<Helmet>'
  +'<Value name="rows" type="table" value={[{"id":1,"who":"nobody"}]} />'
  +'<Query name="current">{`select * from rows`}</Query>'
  +'<Mutation name="claim">{`update rows set who=$_me where id=1`}</Mutation>'
  +'</Helmet><Button run="$claim">Claim it</Button><DataTable data="$current" />';
 const doc=await f.publish({markup});
 const capability=await anonymousQuery(request(`/a/${doc}/query?q=%7B%7D`),ctx(doc));
 expect(capability.status,await capability.clone().text()).toBe(200);
 expect((await capability.json()).mutationAccess.claim).toBe('sign_in_required');
 const refused=await mutate(request(`/a/${doc}/mutate`,{method:'POST',json:{mutation:'claim'}}),ctx(doc));
 expect(refused.status).toBe(403);
 expect(await refused.json()).toMatchObject({error:'policy_denied',code:'sign_in_required'});
 // A signed-in reader is told nothing of the sort: the write is simply theirs.
 const signedIn=await query(request(`/a/${doc}/query`,{method:'POST',cookie:f.cookie,json:{}}),ctx(doc));
 expect((await signedIn.json()).mutationAccess.claim).toBe(null);
 // Every other refusal keeps its own words.
 const dataset=await anonymousQuery(request(`/a/${f.doc}/query?q=%7B%7D`),ctx(f.doc));
 expect((await dataset.json()).mutationAccess.add).not.toBe('sign_in_required');
});
