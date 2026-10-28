import {it,expect} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {createSqliteSql} from '@artifactbin/sql/sqlite';
import {readRegisteredQueryMembers} from '../members';
import {createRegisteredPageQueries} from '../service';
import type {QueryPlan,QueryPorts,QueryContext} from '../contracts';
useAppHarness();
const context:QueryContext={pageId:'members_page',pageVersion:1,backendId:'backend',backendVersion:'one',sourceSha256:'a'.repeat(64),subject:null};
const plan:QueryPlan={registration:context,builtins:['members'],scalars:{},imports:[],queries:[{name:'members',sql:'select user_id,joined_at from _members order by joined_at,user_id',dependencies:[]}]};
async function fixture(){const db=await getDb();
 for(const [id,status,at]of [['second','accepted','2026-01-02T00:00:00.123456Z'],['first','accepted','2026-01-01T00:00:00.123456Z'],['pending','pending',null],['left','left','2025-01-01T00:00:00Z']])await db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at) VALUES('user',$1,'join','artifact',$2,$3,'request',$1,$4)",[id,context.pageId,status,at]);
 let readable=true,after:(()=>Promise<void>)|undefined;const sql=createSqliteSql();
 const ports:QueryPorts={registry:async()=>plan,authorize:async()=>readable,platform:async()=>({userId:null,now:'2026-01-01T00:00:00Z',tz:'UTC'}),source:async()=>{throw Error('unexpected');},members:async()=>{const rows=await readRegisteredQueryMembers(db,context.pageId,10001),pin=JSON.stringify(rows);return {rows,verify:async()=>{if(!readable)throw Error('denied');if(JSON.stringify(await readRegisteredQueryMembers(db,context.pageId,10001))!==pin)throw Error('query_members_changed');}};},execute:input=>({result:(async()=>{const result=await sql.run(input);await after?.();return result;})(),cancelAndDrain:async()=>{}})};
 return {db,ports,run:(request:unknown={values:{},only:['members']})=>createRegisteredPageQueries(ports).execute(context,request),revoke:()=>{readable=false;},after:(fn:()=>Promise<void>)=>{after=fn;}};
}
it('reads only current accepted artifact joins in exact source order and preserves microsecond timestamps',async()=>{const f=await fixture(),rows=await readRegisteredQueryMembers(f.db,context.pageId,10001);expect(rows.map(r=>r.user_id)).toEqual(['first','second']);expect(rows[0]!.joined_at).toContain('.123456');expect((await f.run()).members).toMatchObject({rows:[{user_id:'first'},{user_id:'second'}]});});
it('rejects page arguments overriding members and refuses unavailable authority',async()=>{const f=await fixture();await expect(f.run({values:{_members:'forged'},only:['members']})).rejects.toThrow('invalid_query_request');delete f.ports.members;await expect(f.run()).rejects.toThrow('query_members_unavailable');});
it('drops results when membership changes or access is revoked while SQL runs',async()=>{const f=await fixture();f.after(async()=>{await f.db.query("UPDATE relations SET status='left' WHERE subject_id='first' AND object_id=$1",[context.pageId]);});await expect(f.run()).rejects.toThrow('query_members_changed');f.after(async()=>f.revoke());await expect(f.run()).rejects.toThrow('denied');});
it('retained adapter binds the saved page and rechecks live members and document access after SQL',async()=>{
 const {mintAccountToken,request}=await import('@/__tests__/harness'),{POST}=await import('@/app/api/artifacts/route'),{requestOrSessionActor,ANONYMOUS_ACTOR}=await import('@/lib/accounts'),{readHtmlPage}=await import('@/lib/html-publication'),{prepareRegisteredQueryBackend,commitRegisteredQueryBackend,registeredPlan}=await import('../registry'),{getHtmlBackendVersion}=await import('@/lib/html-backends'),{createRetainedRegisteredQueries}=await import('@/lib/page-graphql/registered-queries');
 const owner=await mintAccountToken('members_fixture'),actor=await requestOrSessionActor(request('/api/artifacts',{token:owner.token})),response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:'<html><body><p>Members</p></body></html>',visibility:'public'}}));expect(response.status).toBe(201);
 const created=await response.json(),original=await readHtmlPage(actor,created.id),page={...original,version:original.version+1,revision:String(original.version+1)},registration=prepareRegisteredQueryBackend('queries','members_fixture_backend',page,{builtins:['members'],scalars:{},imports:[],queries:plan.queries},{compilerSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),sqlEngineSha256:'c'.repeat(64)});page.links=[registration.link];const db=await getDb();await db.transaction(async tx=>{await tx.query("UPDATE artifacts SET version=$2,meta=jsonb_set(meta,'{htmlLinks}',$3::jsonb) WHERE id=$1",[page.pageId,page.version,JSON.stringify(page.links)]);await tx.query('INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1',[page.pageId]);await commitRegisteredQueryBackend(tx,page,owner.userId!,registration);});
 const saved=registeredPlan(page,registration.link,(await getHtmlBackendVersion(registration.link.backendId,registration.link.version))!)!,sql=createSqliteSql();let after=async()=>{},fence:(()=>Promise<void>)|undefined;
 const run=()=>createRetainedRegisteredQueries(ANONYMOUS_ACTOR,page,{execute:async input=>{const answer=await sql.run(input);await after();return answer;},retainReadFence:verify=>{fence=verify;}}).execute({...saved.registration,subject:null},{values:{},only:['members']},new AbortController().signal);
 expect((await run()).members).toMatchObject({rows:[{user_id:owner.userId}]});await fence!();
 after=async()=>{await db.query("UPDATE relations SET status='left' WHERE object_id=$1 AND subject_id=$2",[page.pageId,owner.userId]);};await expect(run()).rejects.toThrow('query_members_changed');
 after=async()=>{await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[page.pageId]);};await expect(run()).rejects.toThrow();
});
it('bounds the live table and refuses unrecognized saved builtin declarations',async()=>{
 const f=await fixture();f.ports.members=async()=>({rows:Array.from({length:10001},()=>({user_id:'member',joined_at:null})),verify:async()=>{}});await expect(f.run()).rejects.toThrow('query_input_limit');
 f.ports.registry=async()=>({...plan,builtins:['members','members']});await expect(f.run()).rejects.toThrow('invalid_query_registry');
});
