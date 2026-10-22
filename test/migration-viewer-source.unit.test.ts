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

test("viewer SQL scalar detection prepares canonical dotted parameters through clock query dependencies", async () => {
  const source =
    '<Helmet><Query name="clock">{`select $_now as instant, $_tz as zone`}</Query><Query name="reader">{`select $_me.id as id, instant from clock`}</Query></Helmet><p>Reader</p>';
  assert.equal(await readsLegacyViewer(source), true);
  const query = (sql: string) =>
    '<Helmet><Query name="reader">{`' +
    sql +
    "`}</Query></Helmet><p>Reader</p>";
  for (const sql of [
    "select '$_me.id' as id",
    'select 1 as "$_me.id"',
    "select 1 /* $_me.id */",
    "select 1 -- $_me.id",
    "select $_me__id as id",
    "select $_me.idExtra as id",
    "select $_me.email as id",
  ])
    assert.equal(await readsLegacyViewer(query(sql)), false, sql);
  assert.equal(
    await readsLegacyViewer(query("select $_now as instant, $_me.id as id")),
    true,
  );
  assert.equal(
    await readsLegacyViewer(query("select $_me.id as id where 0")),
    true,
  );
});
