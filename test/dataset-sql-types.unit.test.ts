// Behavioral cases adapted from the Apache-2.0 SQL engine tests; see src/datasets/sql/engine/LICENSE and NOTICE.
import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetMutationEngine } from "../src/datasets/sql/engine.ts";
import type {
  DatasetMutationPolicy,
  MutationInput,
  MutationOutcome,
} from "../src/datasets/sql/engine/sql-contracts.ts";
const engine = await createDatasetMutationEngine();
const table = {
  schema: "public",
  name: "rows",
  columns: [
    { name: "id", type: "number" as const },
    { name: "body", type: "string" as const },
    { name: "due", type: "date" as const },
    { name: "instant", type: "timestamp" as const },
    { name: "enabled", type: "boolean" as const },
  ],
  rows: [
    {
      id: 1,
      body: "one",
      due: "2026-01-01",
      instant: "2026-01-01T00:00:00.000Z",
      enabled: true,
    },
  ],
};
const policy: DatasetMutationPolicy = {
  role: "viewer",
  session: {},
  operations: ["insert", "update", "delete"],
  table: {
    table: { schema: "public", name: "rows" },
    insert_permissions: [
      { role: "viewer", permission: { columns: "*", check: {} } },
    ],
    update_permissions: [
      { role: "viewer", permission: { columns: "*", filter: {}, check: {} } },
    ],
    delete_permissions: [{ role: "viewer", permission: { filter: {} } }],
  },
};
function success(out: MutationOutcome) {
  assert.ok(!("error" in out), "error" in out ? out.error : "");
  return out;
}
function mutate(
  sql: string,
  params: MutationInput["params"] = {},
  paramTypes: MutationInput["paramTypes"] = {},
  selected = policy,
) {
  return engine.mutate({ table, sql, params, paramTypes, policy: selected });
}
test("typed scalar bindings normalize instants, preserve booleans and use supplied time with null date fallback", () => {
  const out = success(
    mutate(
      "update public.rows set due=coalesce($due,$_now),instant=$instant,enabled=$enabled,body=$body where id=$id",
      {
        due: null,
        _now: "2026-09-01",
        instant: "2026-09-30T10:00:00+05:30",
        enabled: false,
        body: "changed",
        id: 1,
      },
      {
        due: "date",
        _now: "date",
        instant: "timestamp",
        enabled: "boolean",
        body: "string",
        id: "number",
      },
    ),
  );
  assert.equal(out.affected, 1);
  assert.deepEqual(out.rows, [
    {
      id: 1,
      body: "changed",
      due: "2026-09-01",
      instant: "2026-09-30T04:30:00.000Z",
      enabled: false,
    },
  ]);
  const inferred = success(
    mutate("update public.rows set body=$body", { body: "inferred" }),
  );
  assert.equal(inferred.rows[0]!.body, "inferred");
  assert.deepEqual(table.rows[0], {
    id: 1,
    body: "one",
    due: "2026-01-01",
    instant: "2026-01-01T00:00:00.000Z",
    enabled: true,
  });
});
test("typed invalid values and incompatible writes refuse the entire mutation", () => {
  for (const [name, type, value] of [
    ["due", "date", "the 1st of May"],
    ["instant", "timestamp", "not an instant"],
    ["id", "number", "text"],
  ] as const) {
    const out = mutate(
      `update public.rows set ${name}=$value`,
      { value },
      { value: type },
    );
    assert.ok("error" in out);
    assert.match(
      out.error,
      type === "number"
        ? /cannot store TEXT value in REAL column rows.id/
        : /parameter \$value/,
    );
  }
  const out = mutate(
    "insert into public.rows(id,body,due) select coalesce($n,'x'),'two','2026-09-01'",
    { n: null },
    { n: "string" },
  );
  assert.ok("error" in out);
  assert.match(out.error, /cannot store TEXT value in REAL column/);
  // A refused statement cannot contaminate a subsequent database or its source rows.
  assert.equal(success(mutate("update public.rows set id=2")).rows[0]!.id, 2);
  assert.equal(table.rows[0]!.id, 1);
});
test("policies still see functions over typed parameters and SQL-null checks deny effects", () => {
  const denied = {
    ...policy,
    execution: { functions: { deny: ["coalesce"] } },
  };
  const out = mutate(
    "update public.rows set due=coalesce($due,$_now)",
    { due: "2026-09-01", _now: "2026-01-01" },
    { due: "date", _now: "date" },
    denied,
  );
  assert.ok("error" in out);
  assert.equal(out.code, "policy_denied");
  assert.match(out.error, /coalesce/);
  const checked: DatasetMutationPolicy = {
    ...policy,
    table: {
      ...policy.table,
      update_permissions: [
        {
          role: "viewer",
          permission: {
            columns: "*",
            filter: {},
            check: { due: { _eq: "2026-09-01" } },
          },
        },
      ],
    },
  };
  const bad = mutate("update public.rows set due=null", {}, {}, checked);
  assert.ok("error" in bad);
  assert.equal(bad.code, "policy_denied");
});
test("predicate boolean combinations filter effects and presets are checked after assignment", () => {
  const scoped: DatasetMutationPolicy = {
    ...policy,
    session: { "x-hasura-user-id": "reader" },
    table: {
      ...policy.table,
      update_permissions: [
        {
          role: "viewer",
          permission: {
            columns: ["due"],
            filter: {
              _and: [
                { id: { _in: [1, 2] } },
                { _not: { body: { _eq: "excluded" } } },
              ],
            },
            set: { body: "x-hasura-user-id" },
            check: { _or: [{ body: { _eq: "reader" } }, { id: { _eq: 99 } }] },
          },
        },
      ],
    },
  };
  const out = success(
    mutate(
      "update public.rows set due=$due",
      { due: "2026-09-01" },
      { due: "date" },
      scoped,
    ),
  );
  assert.equal(out.affected, 1);
  assert.equal(out.rows[0]!.body, "reader");
  const skipped = success(
    mutate(
      "update public.rows set due=$due where id=2",
      { due: "2026-09-01" },
      { due: "date" },
      scoped,
    ),
  );
  assert.equal(skipped.affected, 0);
  assert.deepEqual(skipped.rows, table.rows);
});
