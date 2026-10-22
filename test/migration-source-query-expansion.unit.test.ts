import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSourceQuery } from "../src/migration/conversion/compiled/source-query-expansion.ts";
test("catalog expansion preserves positional identity and quoted parameter-like text", () => {
  const result = expandSourceQuery(
    "authored",
    {
      day: { type: "string", default: "same" },
      other: { type: "string", default: "same" },
    },
    {
      compile(_sql, values) {
        const first = values.other,
          second = values.day;
        return {
          sql: `select $1::text as a,$2::text as b,'$1' as literal,"$2" as quoted`,
          values: [first, second],
        };
      },
    },
  );
  assert.equal(
    result.executionSql,
    `select $other::text as a,$day::text as b,'$1' as literal,"$2" as quoted`,
  );
  assert.deepEqual({ ...result.params }, { other: "string", day: "string" });
  assert.match(result.executionSqlSha256, /^[a-f0-9]{64}$/);
});
test("catalog expansion refuses untracked positional values and mismatched parameter slots", () => {
  for (const sql of ["select $0", "select $2"])
    assert.throws(() =>
      expandSourceQuery(
        "authored",
        { x: { type: "string", default: "one" } },
        {
          compile(_s, v) {
            return { sql, values: [v.x] };
          },
        },
      ),
    );
  assert.throws(() =>
    expandSourceQuery(
      "authored",
      {},
      {
        compile() {
          return { sql: "select $1", values: ["hidden"] };
        },
      },
    ),
  );
});
