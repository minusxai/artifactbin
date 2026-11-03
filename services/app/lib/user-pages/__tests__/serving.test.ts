import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {getArtifactById} from '@/lib/artifacts';
import {urlHash} from '@/lib/document';
import {publicHomeFiles,servesEmbeddedArtifact,servesWebAsset,type UserPagesOwner} from '..';
useAppHarness();
it('keeps embedded bytes and copied web images owner-scoped with 200 eligible posts',async()=>{
 const actor=await mintAccountToken('mxmx_test_host_assets'),db=await getDb();
 const user:UserPagesOwner={kind:'user',id:actor.userId!,handle:'asset_owner'};
 const group:UserPagesOwner={kind:'group',id:'grp_assets',handle:'asset_team'};
 await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES($1,$2,'Assets','',$3)",[group.id,group.handle,user.id]);
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,source) VALUES('asset01',$1,$2,'image','unlisted',NULL)",[actor.id,user.id]);
 const row=(await getArtifactById('asset01'))!;
 // The copied image itself: a hash with no web_assets row is refused before any page is read.
 await db.query('INSERT INTO web_assets(url_hash,url,object_key,content_type,bytes) VALUES($1,$2,$3,$4,1)',[urlHash('https://images.example.test/last.png'),'https://images.example.test/last.png','webasset/last','image/png']);
 await db.query(`INSERT INTO artifacts(id,token_id,user_id,format,visibility,source,meta)
 SELECT 'post'||lpad(n::text,4,'0'),$1,$2,'html',CASE WHEN n=200 THEN 'unlisted' ELSE 'public' END,
 CASE WHEN n=200 THEN '<img src="https://images.example.test/last.png">' ELSE '<h1>Post</h1>' END,
 CASE WHEN n=200 THEN '{"refs":[{"id":"asset01"}]}'::jsonb ELSE '{}'::jsonb END FROM generate_series(1,200) n`,[actor.id,user.id]);
 const started=performance.now();
 expect(await servesEmbeddedArtifact(user,row)).toBe(true);
 expect(await servesWebAsset(user,urlHash('https://images.example.test/last.png'))).toBe(true);
 expect(await servesEmbeddedArtifact(group,row)).toBe(false);
 expect(await servesWebAsset(group,urlHash('https://images.example.test/last.png'))).toBe(false);
 expect(await publicHomeFiles(user)).toHaveLength(199);
 // A regression bound, not a claimed production latency: measured in this real DB fixture.
 expect(performance.now()-started).toBeLessThan(2000);
 await db.query("UPDATE artifacts SET group_id=$1 WHERE id='post0200'",[group.id]);
 expect(await servesEmbeddedArtifact(user,row)).toBe(false);expect(await servesEmbeddedArtifact(group,row)).toBe(true);
 await db.query("UPDATE artifacts SET visibility='private' WHERE id='post0200'");
 expect(await servesEmbeddedArtifact(group,row)).toBe(false);expect(await servesWebAsset(group,urlHash('https://images.example.test/last.png'))).toBe(false);
});
