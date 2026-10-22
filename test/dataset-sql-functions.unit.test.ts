// Behavioral cases adapted from the Apache-2.0 SQL engine tests; see src/datasets/sql/engine/LICENSE and NOTICE.
import test from "node:test";
import assert from "node:assert/strict";
import { createDatasetMutationEngine } from "../src/datasets/sql/engine.ts";
import { SQL_FUNCTIONS } from "../src/datasets/sql/engine/function-specs.ts";
import type { Scalar } from "../src/datasets/sql/engine/sql-contracts.ts";
const engine = await createDatasetMutationEngine();
const table = {
  schema: "main",
  name: "result",
  columns: [{ name: "payload", type: "string" as const }],
  rows: [],
};
function result(expression: string, params: Record<string, Scalar> = {}) {
  return engine.mutate({
    table,
    sql: "insert into result select json_array(" + expression + ")",
    params,
  });
}
function value(
  expression: string,
  params: Record<string, Scalar> = {},
): unknown {
  const out = result(expression, params);
  if ("error" in out) throw Error(out.error);
  return JSON.parse(String(out.rows[0]!.payload))[0];
}
function failure(expression: string): string {
  const out = result(expression);
  assert.ok("error" in out, expression);
  return out.error;
}
test("SQL dates preserve calendar boundaries, ISO weeks, explicit instants and fixed time zones", () => {
  assert.equal(value("date_add('2026-01-31', 1, 'month')"), "2026-02-28");
  assert.equal(value("date_add('2024-01-31', 1, 'month')"), "2024-02-29");
  assert.equal(value("date_add('2024-02-29', 1, 'year')"), "2025-02-28");
  assert.equal(
    value("date_add('2026-12-31T23:30:00Z', 45, 'minute')"),
    "2027-01-01T00:15:00.000Z",
  );
  assert.equal(value("date_trunc('week', '2026-01-01')"), "2025-12-29");
  assert.equal(value("date_part('week', '2021-01-03')"), 53);
  assert.equal(
    value(
      "date_format('2026-09-30T23:30:00Z', '%Y-%m-%d %H:%M', 'Asia/Kolkata')",
    ),
    "2026-10-01 05:00",
  );
  assert.equal(
    value("date_format('2026-03-08T07:30:00Z', '%H:%M', 'America/New_York')"),
    "03:30",
  );
  assert.equal(
    value("date_parse('05/09/2026 14:30', '%d/%m/%Y %H:%M')"),
    "2026-09-05T14:30:00.000Z",
  );
  assert.equal(value("date_parse('31/02/2026', '%d/%m/%Y')"), null);
  assert.equal(
    value("date_series('2026-12-30', '2027-01-02')"),
    '["2026-12-30","2026-12-31","2027-01-01","2027-01-02"]',
  );
  assert.match(failure("date_add('2026-09-30', 1, 'hour')"), /timestamp/);
  assert.match(failure("date_part('fortnight', '2026-09-30')"), /fortnight/);
});
test("scalar null propagation and list exceptions survive SQL registration", () => {
  for (const spec of SQL_FUNCTIONS) {
    const arity = spec.arity.find((n) => n > 0);
    if (
      arity === undefined ||
      spec.name === "list_value" ||
      spec.kind === "aggregate"
    )
      continue;
    assert.equal(
      value(
        spec.name +
          "(" +
          Array.from({ length: arity }, () => "null").join(",") +
          ")",
      ),
      null,
      spec.name,
    );
  }
  assert.equal(value("list_value(1, 'a', null)"), '[1,"a",null]');
  assert.equal(value("list_contains('[1,2,3]', 2)"), 1);
  assert.equal(value("list_has_any('[1,2]', '[3,2]')"), 1);
  assert.match(failure("list_contains('not a list', 1)"), /list/);
});
test("text, numeric casts and regular expressions preserve published scalar semantics", () => {
  assert.equal(value("string_split('a,b,,c', ',')"), '["a","b","","c"]');
  assert.equal(value("split_part('a/b/c', '/', -1)"), "c");
  assert.equal(value("to_number('1e3')"), 1000);
  assert.equal(value("to_number('0x1F')"), null);
  assert.equal(value("round(13.975, 2)"), 13.98);
  assert.equal(value("round(-2.5)"), -3);
  assert.equal(value("typeof(round(2.5))"), "real");
  assert.equal(value("regexp_replace('a1b22c', '[0-9]+', '#')"), "a#b#c");
  assert.equal(value("regexp_extract('id=42;n=7', 'n=([0-9]+)', 1)"), "7");
  assert.equal(value("regexp_extract('none', '[0-9]+')"), null);
  assert.match(
    failure("regexp_matches('x', '(')"),
    /regular expression|Invalid/i,
  );
  assert.equal(value("try_to_date('2026-02-30')"), null);
  assert.match(failure("to_date('2026-02-30')"), /not a date/);
});
test("custom aggregates ignore nulls and maintain independent moving window frames", () => {
  const source =
    "(select 1 as x union all select 2 union all select 4 union all select 10 union all select null)";
  assert.equal(value(`(select median(x) from ${source})`), 3);
  assert.equal(value(`(select quantile(x, 0.25) from ${source})`), 1.75);
  assert.ok(
    Math.abs(Number(value(`(select stddev(x) from ${source})`)) - 4.031128874) <
      0.000001,
  );
  assert.equal(value("(select median(x) from (select 1 as x where 0))"), null);
  const windows = `(select json_group_array(json_array(x,med,q)) from (select x, median(x) over w as med, quantile(x,0.5) over w as q from ${source} where x is not null window w as (order by x rows between 1 preceding and current row)))`;
  assert.deepEqual(value(windows), [
    [1, 1, 1],
    [2, 1.5, 1.5],
    [4, 3, 3],
    [10, 7, 7],
  ]);
  // A second database must not retain any aggregate state from the previous mutation.
  assert.equal(value("(select median(x) from (select 100 as x))"), 100);
});
