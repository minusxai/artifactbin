import { test } from "node:test";
import assert from "node:assert/strict";
import { readLegacyPersonValueNames } from "../../../src/migration/conversion/compiled/person-source.ts";
test("person browser projection follows exact User bound references without selecting other values", () => {
  assert.deepEqual(
    readLegacyPersonValueNames(
      '<User userId="$owner"/><User userId={"$reviewer"}/><User userId="$owner"/><Select value="$unrelated"/>',
    ),
    ["owner", "reviewer"],
  );
  for (const source of [
    '<p>User userId="$owner"</p>',
    '<User userId="usr_literal"/>',
    "<User userId={dynamic}/>",
    '<UserHandle userId="$owner"/>',
    '<User userId="$constructor"/>',
    "<User",
  ])
    assert.deepEqual(readLegacyPersonValueNames(source), []);
});
