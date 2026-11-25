import {expect,it} from 'vitest';
import {ensureEventsSchema} from '@artifactbin/events/local';
import {EVENTS_SCHEMA} from '@/lib/platform';
import {link,unlink} from '@/lib/social';
import {ownerHostSqlRead,type SiteFilesScope} from '@/lib/page-doors';
import {catchUpLoggedViews,request,useAppHarness} from './harness';
import {fixture,publish,sql} from './page-sql-door-fixture';
import {seedArtifacts,setArtifact} from './rows';

const harness=useAppHarness();
it('joins the public subtree with guest-visible dataset rows and counts live likes and daily visitors',async()=>{
 const f=await fixture(),db=await harness.db();
 const scope:SiteFilesScope={owner:{kind:'user' as const,id:f.owner.userId!,handle:'publisher'},folderId:'sitefolder',origin:'https://example.org',sitePath:({id}:{id:string})=>'/'+id};
 const read=async(statement:string,page=f.page,holds=async()=>true,site=scope)=>{
  const response=await ownerHostSqlRead(request('/sql',{method:'POST',json:{sql:statement,revision:'1'}}),page,holds,site);
  return {status:response.status,...await response.json()};
 };
 const row=(id:string,format:string,ancestor_ids:string[],visibility='public',user_id=f.owner.userId!)=>({id,format,title:id,ancestor_ids,visibility,user_id});
 await seedArtifacts(db,row('sitefolder','folder',[]),row('nested','folder',['sitefolder']),row('article','html',['sitefolder','nested']),
  row('hidden','folder',['sitefolder'],'unlisted'),row('concealed','html',['sitefolder','hidden']),row('foreign','html',['sitefolder'],'public',f.other.userId!),
  row('outside','html',[]),row('assetfile','file',['sitefolder']));
 await link(f.owner.userId!,'like','article');await link(f.other.userId!,'like','article');await unlink(f.other.userId!,'like','article');
 await ensureEventsSchema(db,EVENTS_SCHEMA);
 await db.query(`INSERT INTO ${EVENTS_SCHEMA}.events (id,at,source,verb,object_kind,object_id,subject_kind,subject_id)
 SELECT 'event'||n,'2026-01-01'::timestamptz,'app','viewed','artifact','article','visitor',v FROM (VALUES (1,'a'),(2,'a'),(3,'b')) x(n,v)`);
 await catchUpLoggedViews();
 expect((await read('select id,parent_id,likes,views,url,note from _files cross join notes order by id')).rows).toEqual([
  {id:'article',parent_id:'nested',likes:1,views:2,url:'https://example.org/article',note:'hello'},
  {id:'assetfile',parent_id:null,likes:0,views:0,url:expect.stringMatching(/\/@publisher\/assetfile/),note:'hello'},
  {id:'nested',parent_id:null,likes:0,views:0,url:'https://example.org/nested',note:'hello'}]);
 expect((await read('delete from _files')).error).toBe('permission_denied');
 expect((await sql(f.page,null,'select * from _files')).body.error).toBeTruthy();
 const standalone=await publish(f.owner,{html:'<html><body>Site</body></html>'});
 expect((await read('select count(*) as n from _files',standalone.body.id)).rows).toEqual([{n:3}]);
 const collision=await publish(f.owner,{html:`<html><head><link rel="af-dataset" data-af-name="_FILES" href="ref:${f.notes}"></head></html>`});
 expect((await read('select note from _files',collision.body.id)).rows).toEqual([{note:'hello'}]);
 const ids='select id,parent_id from _files order by id';
 expect((await read(ids,f.page,undefined,{...scope,folderId:null})).rows).toEqual([
  {id:'article',parent_id:'nested'},{id:'assetfile',parent_id:'sitefolder'},{id:'nested',parent_id:'sitefolder'},
  {id:'outside',parent_id:null},{id:'sitefolder',parent_id:null}]);
 await setArtifact(db,'nested',{group_id:f.other.userId!});
 expect((await read(ids)).rows).toEqual([{id:'assetfile',parent_id:null}]);
 await setArtifact(db,['sitefolder','article'],{group_id:f.other.userId!});
 const group={...scope,owner:{...scope.owner,kind:'group' as const,id:f.other.userId!}};
 expect((await read(ids,f.page,undefined,group)).rows).toEqual([{id:'article',parent_id:'nested'},{id:'nested',parent_id:null}]);
 await setArtifact(db,'nested',{deleted_at:new Date()});
 expect((await read(ids,f.page,undefined,group)).rows).toEqual([]);
 await setArtifact(db,['sitefolder','nested','article'],{group_id:null,deleted_at:null});
 let checks=0;
 const raced=await read('select title from _files',f.page,async()=>{
  if(++checks===3)await setArtifact(db,'sitefolder',{visibility:'private'});
  return true;
 });
 expect(raced.status).toBeGreaterThanOrEqual(400);
 expect(JSON.stringify(raced)).not.toContain('article');
});
