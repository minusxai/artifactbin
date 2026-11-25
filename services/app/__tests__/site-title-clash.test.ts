import {expect,it} from 'vitest';
import {publicHomeFiles,siteDestination,siteFilePath,type UserPagesOwner} from '@/lib/user-pages';
import {ensureTable} from '@artifactbin/utils';
import {TABLES} from '@/lib/platform';
import {useAppHarness} from './harness';
import {seedArtifacts} from './rows';

const harness=useAppHarness();
const owners:UserPagesOwner[]=[{kind:'user',id:'siteowner',handle:'siteowner'},{kind:'group',id:'sitegroup',handle:'sitegroup'}];
for(const owner of owners)it(`gives clashing public siblings of a ${owner.kind}-owned site their id address, ignoring private twins`,async()=>{
 const db=await harness.db(),p=owner.kind;
 const row=(id:string,format:string,title:string,ancestor_ids:string[],visibility='public')=>
  ({id:p+id,format,title,ancestor_ids:ancestor_ids.map(a=>p+a),visibility,user_id:owner.kind==='user'?owner.id:'sitemember',group_id:owner.kind==='group'?owner.id:null});
 await seedArtifacts(db,row('docs','folder','Docs',[]),row('newsone','html','Team News',['docs']),row('newstwo','html','team  news!',['docs']),
  row('about','html','About Us',['docs']),row('aboutdraft','html','About Us',['docs'],'private'),row('rootnews','html','Team News',[]));
 const files=Object.fromEntries((await publicHomeFiles(owner)).map(f=>[f.id.slice(p.length),{title_path:f.title_path,address:siteFilePath(f)}]));
 expect(files).toEqual({
  newsone:{title_path:null,address:`/${p}newsone-team-news`},newstwo:{title_path:null,address:`/${p}newstwo-team-news`},
  about:{title_path:'/docs/about-us',address:'/docs/about-us'},rootnews:{title_path:'/team-news',address:'/team-news'}});
 expect(await siteDestination(owner,'/docs/team-news')).toBeNull();
 expect(await siteDestination(owner,'/docs/about-us')).toEqual({kind:'page',id:p+'about',unlisted:false});
 expect(await siteDestination(owner,'/team-news')).toEqual({kind:'page',id:p+'rootnews',unlisted:false});
});
it('adds the public-sibling index to a database booted before it existed',async()=>{
 const db=await harness.db(),named=`SELECT indexdef FROM pg_indexes WHERE indexname='idx_artifacts_site_siblings'`;
 await db.query('DROP INDEX idx_artifacts_site_siblings');
 expect((await db.query(named)).rows).toEqual([]);
 await ensureTable(db,TABLES);
 expect((await db.query(named)).rows).toHaveLength(1);
});
