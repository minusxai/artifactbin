import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { normalizeLegacyDuckSql } from "../src/migration/conversion/duck-sql.ts";
import { normalizeLegacySourceOperations } from "../src/migration/conversion/source-operations.ts";
import { SqliteDatabase } from "../src/datasets/sql/engine/database.ts";
import { loadSqliteModule } from "../src/datasets/sql/engine/wasm.ts";
const admission = (sql: string) => [
  {
    version: "duckdb-distinct-string-v1" as const,
    sqlSha256: createHash("sha256").update(sql).digest("hex"),
    listExpressions: [],
    numericExpressions: [],
  },
];
const sql =
  "select r.group_id,string_agg(distinct case when r.label='alternate' then 'a,b' else r.label end,' | ') labels from entries r where r.enabled=1 group by r.group_id";
test("admitted grouped distinct string aggregation preserves separators, duplicates, nulls and groups", async () => {
  const db = new SqliteDatabase(await loadSqliteModule());
  try {
    const table = {
      schema: "main",
      table: "entries",
      columns: [
        { name: "group_id", type: "string" as const },
        { name: "label", type: "string" as const },
        { name: "enabled", type: "number" as const },
      ],
    };
    db.createTable(table);
    db.insertRows(table, [
      { group_id: "one", label: "a,b", enabled: 1 },
      { group_id: "one", label: "alternate", enabled: 1 },
      { group_id: "one", label: "c | d", enabled: 1 },
      { group_id: "one", label: null, enabled: 1 },
      { group_id: "one", label: "hidden", enabled: 0 },
      { group_id: "two", label: null, enabled: 1 },
      { group_id: null, label: "null group", enabled: 1 },
    ]);
    const lowered = normalizeLegacyDuckSql(sql, admission(sql));
    assert.equal(lowered.changed, true);
    const stmt = db.prepare(lowered.sql, "read");
    const rows = stmt.bind({}).rows(100, 1000).rows;
    stmt.finalize();
    assert.deepEqual(rows, [
      { group_id: null, labels: "null group" },
      { group_id: "one", labels: "a,b | c | d" },
      { group_id: "two", labels: null },
    ]);
    for (const separator of ["''", "'a,b'", "'it''s | '"]) {
      const variant=sql.replace("' | '",separator);
      const prepared=db.prepare(normalizeLegacyDuckSql(variant,admission(variant)).sql,"read");
      const values=prepared.bind({}).rows(100,1000).rows;prepared.finalize();
      assert.equal(values.find(row=>row.group_id==="one")?.labels,"a,b"+separator.slice(1,-1).replaceAll("''","'")+"c | d");
    }
    const empty=sql.replace("r.enabled=1","r.enabled=2");
    const emptyStatement=db.prepare(normalizeLegacyDuckSql(empty,admission(empty)).sql,"read");
    assert.deepEqual(emptyStatement.bind({}).rows(100,1000).rows,[]);emptyStatement.finalize();
    assert.throws(() => normalizeLegacyDuckSql(sql));
    assert.throws(() => normalizeLegacyDuckSql(sql + " ", admission(sql)));
  } finally {
    db.close();
  }
});
test("aggregate admission refuses unsupported shape rather than broadening the audited SQL", () => {
  for (const value of [
    sql.replace("group by r.group_id", "group by r.label"),
    sql + " order by r.group_id",
    sql.replace("' | '", "$separator"),
    sql.replace("' | '", "null"),
    sql.replace(" labels ", " group_id "),
    sql.replace(
      "case when r.label='alternate' then 'a,b' else r.label end",
      "random()",
    ),
    sql.replace("select r.group_id,", "select r.group_id,r.enabled,"),
  ])
    assert.throws(() => normalizeLegacyDuckSql(value, admission(value)));
});
test("an admitted read query lowers even when the original uses Import instead of source-qualified operations", () => {
  const source =
    '<Helmet><Import name="data" src="ref:Abcd12"/><Query name="summary">{`' +
    sql +
    '`}</Query></Helmet><DataTable data="$summary"/>';
  const result = normalizeLegacySourceOperations(
    source,
    ["ref:Abcd12"],
    admission(sql),
  );
  assert.notEqual(result.source, source);
  assert.ok(result.source.includes("group_concat"));
  assert.ok(result.source.includes('Import name="data"'));
});
