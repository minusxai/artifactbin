import test from "node:test";
import assert from "node:assert/strict";
import { readHistoricalRemoteMutationNames as read } from "../src/migration/conversion/compiled/historical-mutations.ts";
test("historical remote mutation names require exact source-backed Helmet declarations", () => {
  assert.deepEqual(
    read(
      '<Helmet><Mutation name="save" source="ref:Abcd12" expectedAffected={1}>{`insert into items values(1)`}</Mutation></Helmet><Button run="$save">Save</Button>',
    ),
    ["save"],
  );
  assert.deepEqual(
    read(
      '<Helmet><Mutation name="local">{`update rows set x=1`}</Mutation></Helmet>',
    ),
    [],
  );
  assert.throws(() =>
    read(
      '<Helmet><Mutation name="save" source="ref:Abcd12"/><Mutation name="save" source="ref:Abcd12"/></Helmet>',
    ),
  );
  for (const source of [
    '<Mutation name="save" source="ref:Abcd12"/>',
    '<Helmet><Mutation name="save" source="bad"/></Helmet>',
    '<Helmet><Mutation name="save" source={resource}/></Helmet>',
  ])
    assert.throws(() => read(source));
});
