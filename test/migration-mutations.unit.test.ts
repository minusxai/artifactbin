import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLegacyMutations } from "../src/migration/conversion/mutations.ts";
const catalogs = [
  {
    name: "bookings",
    datasetLegacyId: "ABC123",
    tables: [
      {
        schema: "public",
        name: "rows",
        columns: [
          { name: "id", type: "number" as const },
          { name: "who", type: "user" as const },
        ],
      },
    ],
  },
];
const wrap = (sql: string, attrs = 'name="book"') =>
  `<Helmet><Import name="bookings" src="ref:ABC123"/><Value name="id" type="number"/><Mutation ${attrs}>{\`${sql}\`}</Mutation></Helmet>`;
test("literal mutation is analyzed without executing, with canonical target and exact Import alias", async () => {
  const result = await extractLegacyMutations(
    wrap("update bookings.rows set who=$_me.id where id=$id"),
    catalogs,
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.mutations, [
    {
      name: "book",
      bindingName: "bookings",
      datasetLegacyId: "ABC123",
      target: { schema: "public", table: "rows" },
      sqlSchema: "bookings",
      sql: "update bookings.rows set who=$_me__id where id=$id",
      paramTypes: { id: "number" },
      conflictMode: "refuse",
    },
  ]);
});
test("SQLite analysis rejects extra statements, unknown tables, cross-import reads and undeclared parameters", async () => {
  for (const sql of [
    "delete from bookings.rows; delete from bookings.rows",
    "update bookings.missing set id=1",
    "update bookings.rows set id=$unknown",
    "update bookings.rows set id=(select id from other.rows limit 1)",
    "select * from bookings.rows",
  ]) {
    const result = await extractLegacyMutations(wrap(sql), [
      ...catalogs,
      { ...catalogs[0]!, name: "other", datasetLegacyId: "DEF456" },
    ]);
    assert.equal(result.mutations.length, 0, sql);
    assert.ok(result.issues.length, sql);
  }
});
test("dynamic or ambiguous declarations never produce partial operations", async () => {
  for (const source of [
    wrap("delete from bookings.rows", "name={operation}"),
    wrap("delete from bookings.rows") + wrap("delete from bookings.rows"),
    wrap("delete from bookings.rows", 'name="book" expectedAffected={-1}'),
    '<Helmet><Mutation name="x">{sql}</Mutation></Helmet>',
  ]) {
    const result = await extractLegacyMutations(source, catalogs);
    assert.equal(result.mutations.length, 0);
    assert.ok(result.issues.length);
  }
});
test("quoted and commented builtin lookalikes remain untouched", async () => {
  const sql =
    "update bookings.rows set who='$_me.id' where id=$id /* $_me.email */";
  const result = await extractLegacyMutations(wrap(sql), catalogs);
  assert.deepEqual(result.issues, []);
  assert.equal(result.mutations[0]?.sql, sql);
});

test("legacy clock semantics refuse ambient now while preserving server-bound clock and literal data", async () => {
  const rejected = await extractLegacyMutations(
    wrap("update bookings.rows set who=datetime('now')"),
    catalogs,
  );
  assert.ok(rejected.issues.length);
  assert.deepEqual(rejected.mutations, []);
  const accepted = await extractLegacyMutations(
    wrap("update bookings.rows set who=$_now"),
    catalogs,
  );
  assert.deepEqual(accepted.issues, []);
  assert.deepEqual(accepted.mutations[0]?.paramTypes, {});
});

test("local SQLite namespaces cannot masquerade as persistent Import targets", async () => {
  for (const alias of ["main", "temp"]) {
    const result = await extractLegacyMutations(
      `<Helmet><Import name="${alias}" src="ref:ABC123"/><Mutation name="erase">{\`delete from ${alias}.rows\`}</Mutation></Helmet>`,
      [{ ...catalogs[0]!, name: alias }],
    );
    assert.deepEqual(result.mutations, []);
    assert.ok(result.issues.length);
  }
});

test("read-only documents retain admission independent of mutation-only parameter constraints", async () => {
  const result = await extractLegacyMutations(
    '<Helmet><Import name="bookings" src="ref:ABC123"/><Value name="filter" default="all"/></Helmet>',
    catalogs,
  );
  assert.deepEqual(result, { mutations: [], issues: [] });
});
test("literal reset preserves only declared scalar names and rejects dynamic/table/missing targets", async () => {
  const good = await extractLegacyMutations(
    wrap("delete from bookings.rows where id=$id", 'name="book" reset="id"'),
    catalogs,
  );
  assert.deepEqual(good.issues, []);
  assert.deepEqual(good.mutations[0]?.reset, ["id"]);
  for (const attr of ["reset={unknown}", 'reset="missing"']) {
    const bad = await extractLegacyMutations(
      wrap("delete from bookings.rows", `name="book" ${attr}`),
      catalogs,
    );
    assert.ok(bad.issues.length);
    assert.deepEqual(bad.mutations, []);
  }
});
