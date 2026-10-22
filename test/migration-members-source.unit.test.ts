import test from "node:test";
import assert from "node:assert/strict";
import { readsLegacyMembers } from "../src/migration/conversion/compiled/members-source.ts";
const page = (sql: string) =>
  '<Helmet><Query name="options">{' +
  JSON.stringify(sql) +
  "}</Query></Helmet><p>Members</p>";
test("membership registration follows the physical SQL relation, including quoted reads and no Imports", async () => {
  for (const sql of [
    "select user_id,joined_at from _members",
    'select user_id from main."_members"',
    "select count(*) as n from [_members]",
  ])
    assert.equal(await readsLegacyMembers(page(sql)), true);
  for (const sql of [
    "select '_members' as text",
    "select 1 as _members /* from _members */",
    "with _members(user_id) as (values(1)) select user_id from _members",
  ])
    assert.equal(await readsLegacyMembers(page(sql)), false);
  assert.equal(
    await readsLegacyMembers(
      '<p>_members</p><script>const x="_members"</script>',
    ),
    false,
  );
});
test("member declaration discovery uses canonical Helmet Query declarations and never executes SQL", async () => {
  assert.equal(
    await readsLegacyMembers(
      '<Query name="outside">{`select * from _members`}</Query>',
    ),
    false,
  );
  assert.equal(await readsLegacyMembers(page("delete from _members")), false);
  assert.equal(
    await readsLegacyMembers(
      '<Helmet><Query name="dynamic">{runQuery()}</Query></Helmet>',
    ),
    false,
  );
  assert.equal(
    await readsLegacyMembers(
      page("select '_members' as text") +
        '<Helmet><Query name="unresolved">{`select * from missing`}</Query></Helmet>',
    ),
    false,
  );
});
