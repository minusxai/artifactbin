import{test}from'node:test';import assert from'node:assert/strict';
import{readsLegacyViewer,readsLegacyViewerMarkup}from'../src/migration/conversion/compiled/viewer-source.ts';
test('viewer registration derives exact reader markup fields without substring authority',()=>{
 assert.equal(readsLegacyViewerMarkup('{$_me.id ? <p>Reader</p>:<p>Guest</p>}'),true);
 for(const source of ['<p>$_me.id</p>','<p title="$_me.id"/>','{$_me["id"]}','{$_other.id}','{$_me.email}','<script>{`const label="$_me.id"`}</script>'])assert.equal(readsLegacyViewerMarkup(source),false,source);
});
test('viewer SQL detection recognizes physical reader table but not comments aliases or shadowing CTEs',async()=>{
 const query=(sql:string)=>'<Helmet><Query name="reader">{`'+sql+'`}</Query></Helmet><p>Reader</p>';
 assert.equal(await readsLegacyViewer(query('select id from _me')),true);
 for(const sql of ["select '_me' as id",'select 1 as _me','select 1 -- _me','with _me as (select 1 as id) select id from _me'])assert.equal(await readsLegacyViewer(query(sql)),false,sql);
});
