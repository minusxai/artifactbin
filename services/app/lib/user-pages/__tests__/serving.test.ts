import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {getArtifactById} from '@/lib/artifacts';
import {urlHash} from '@/lib/document';
const LAST=urlHash('https://images.example.test/last.png');
import {publicHomeFiles,servesEmbeddedArtifact,servesWebAsset,type UserPagesOwner} from '..';
import { seedArtifacts, setArtifact } from '@/__tests__/rows';
useAppHarness();
it('keeps embedded bytes and copied web images owner-scoped with 200 eligible posts',async()=>{
 const actor=await mintAccountToken('mxmx_test_host_assets'),db=await getDb();
 const user:UserPagesOwner={kind:'user',id:actor.userId!,handle:'asset_owner'};
 const group:UserPagesOwner={kind:'group',id:'grp_assets',handle:'asset_team'};
 await db.query("INSERT INTO groups(id,handle,name,description,created_by) VALUES($1,$2,'Assets','',$3)",[group.id,group.handle,user.id]);
 await seedArtifacts(db, { id: 'asset01', token_id: actor.id, user_id: user.id, format: 'image', visibility: 'unlisted', source: null });
 const row=(await getArtifactById('asset01'))!;
 // The copied image itself: a hash with no web_assets row is refused before any page is read.
 await db.query('INSERT INTO web_assets(url_hash,url,object_key,content_type,bytes) VALUES($1,$2,$3,$4,1)',[urlHash('https://images.example.test/last.png'),'https://images.example.test/last.png','webasset/last','image/png']);
 await db.query(`INSERT INTO artifacts(id,token_id,user_id,format,visibility,source,meta)
 SELECT 'post'||lpad(n::text,4,'0'),$1,$2,'html',CASE WHEN n=200 THEN 'unlisted' ELSE 'public' END,
 CASE WHEN n=200 THEN '<img src="https://images.example.test/last.png">' ELSE '<h1>Post</h1>' END,
 CASE WHEN n=200 THEN jsonb_build_object('refs',jsonb_build_array(jsonb_build_object('id','asset01')),'webAssets',jsonb_build_array($3::text)) ELSE '{"webAssets":[]}'::jsonb END FROM generate_series(1,200) n`,[actor.id,user.id,LAST]);
 const started=performance.now();
 expect(await servesEmbeddedArtifact(user,row)).toBe(true);
 expect(await servesWebAsset(user,urlHash('https://images.example.test/last.png'))).toBe(true);
 expect(await servesEmbeddedArtifact(group,row)).toBe(false);
 expect(await servesWebAsset(group,urlHash('https://images.example.test/last.png'))).toBe(false);
 expect(await publicHomeFiles(user)).toHaveLength(199);
 // A regression bound, not a claimed production latency: measured in this real DB fixture.
 expect(performance.now()-started).toBeLessThan(2000); // wall-clock-ok: the stated regression bound for 200 rows of one owner
 await setArtifact(db, 'post0200', { group_id: group.id });
 expect(await servesEmbeddedArtifact(user,row)).toBe(false);expect(await servesEmbeddedArtifact(group,row)).toBe(true);
 await setArtifact(db, 'post0200', { visibility: 'private' });
 expect(await servesEmbeddedArtifact(group,row)).toBe(false);expect(await servesWebAsset(group,urlHash('https://images.example.test/last.png'))).toBe(false);
});

it('requires both embedded bytes and their referring page to belong to the configured site', async()=>{
 const actor=await mintAccountToken('mxmx_test_mapped_assets'),db=await getDb();
 const site:UserPagesOwner={kind:'user',id:actor.userId!,handle:'mapped',folderId:'folder1'};
 await seedArtifacts(db,{id:'folder1',user_id:site.id,format:'folder',visibility:'public'});
 await seedArtifacts(db,{id:'image01',user_id:site.id,format:'image',visibility:'public',ancestor_ids:[]});
 await seedArtifacts(db,{id:'page001',user_id:site.id,format:'html',visibility:'public',ancestor_ids:['folder1'],meta:JSON.stringify({refs:[{id:'image01'}],webAssets:[LAST]})});
 await db.query("INSERT INTO web_assets(url_hash,url,object_key,content_type,bytes) VALUES($1,'https://images.example.test/last.png','test','image/png',1)",[LAST]);
 const embedded=async()=>servesEmbeddedArtifact(site,(await getArtifactById('image01'))!);
 expect(await embedded()).toBe(false);expect(await servesWebAsset(site,LAST)).toBe(true);
 await setArtifact(db,'image01',{ancestor_ids:['folder1']});expect(await embedded()).toBe(true);
 await setArtifact(db,'page001',{ancestor_ids:[]});expect(await embedded()).toBe(false);expect(await servesWebAsset(site,LAST)).toBe(false);
});
