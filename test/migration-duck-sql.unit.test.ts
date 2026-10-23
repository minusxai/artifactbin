import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyDuckSql } from "../src/migration/conversion/duck-sql.ts";
import { SqliteDatabase } from "../src/datasets/sql/engine/database.ts";
import { loadSqliteModule } from "../src/datasets/sql/engine/wasm.ts";
const audit = (sql: string) => [
  {
    version: "duckdb-list-v1" as const,
    sqlSha256: createHash("sha256").update(sql).digest("hex"),
    listExpressions: ["people"],
    numericExpressions: [],
  },
];
const normalizeAllocation = (sql: string) =>
  normalizeLegacyDuckSql(sql, audit(sql));
const db = async () => new SqliteDatabase(await loadSqliteModule());
test("legacy list expressions preserve quotes, nulls, empty lists, string casts and order", async () => {
  const engine = await db();
  try {
    for (const [expr, expected] of [
      [
        "array_to_string(cast('[\"a\",null,\"b\"]' as varchar[]), ', ')",
        "a, b",
      ],
      ["array_to_string(cast('[]' as varchar[]), ', ')", ""],
      ["array_to_string(cast('[null]' as varchar[]), ', ')", null],
      ["array_to_string(cast(null as varchar[]), ', ')", null],
      ['cast(\'[1,null,"a\\"b"]\' as varchar[])', '["1",null,"a\\"b"]'],
      ["to_json(['a',null,'b'])", '["a",null,"b"]'],
      ["len(cast('[]' as varchar[]))", 0],
      ["cast('[true,false,null]' as varchar[])", '["true","false",null]'],
      ["least(null,3,2)", 2],
      ["greatest(null,3,2)", 3],
      ["least(null,null)", null],
      [
        "'least(a,b) public.rows varchar[]'",
        "least(a,b) public.rows varchar[]",
      ],
    ] as const) {
      const sql = normalizeLegacyDuckSql("select " + expr + " as result").sql;
      assert.equal(
        engine.prepare(sql, "any").bind({}).rows(100, 1000).rows[0]?.result,
        expected,
        sql,
      );
    }
  } finally {
    engine.close();
  }
});
test("unnest preserves row order, null members and per-member division", async () => {
  const engine = await db();
  try {
    const sql = normalizeAllocation(
      `with ex as (select 'x' id, 9 amount, '["z",null,"a"]' people) select id, unnest(people) as person, amount / len(people) as share from ex where len(people) > 0`,
    ).sql;
    assert.deepEqual(engine.prepare(sql, "any").bind({}).rows(100, 1000).rows, [
      { id: "x", person: "z", share: 3 },
      { id: "x", person: null, share: 3 },
      { id: "x", person: "a", share: 3 },
    ]);
    for (const people of ["[]", null]) {
      const literal = people === null ? "null" : "'[]'";
      assert.deepEqual(
        engine
          .prepare(
            normalizeAllocation(
              `with ex as (select 'x' id, 9 amount, ${literal} people) select id, unnest(people) as person, amount / len(people) as share from ex where len(people) > 0`,
            ).sql,
            "any",
          )
          .bind({})
          .rows(100, 1000).rows,
        [],
      );
    }
  } finally {
    engine.close();
  }
});
test("unsupported set-returning shapes refuse instead of approximating", () => {
  assert.throws(() =>
    normalizeLegacyDuckSql("select unnest(items) from source"),
  );
  assert.throws(() => normalizeLegacyDuckSql("select least('2',3)"));
});
test("dependent list queries preserve allocation totals before and after a JSON-list mutation", async () => {
  const engine = await db();
  const query = (sql: string) => {
    const prepared = engine.prepare(
      normalizeLegacyDuckSql(sql, audit(sql)).sql,
      "read",
    );
    try {
      return prepared.bind({}).rows(100, 1000).rows;
    } finally {
      prepared.finalize();
    }
  };
  try {
    engine.load({
      schema: "main",
      table: "entities",
      columns: [{ name: "name", type: "string" }],
      rows: [{ name: "a" }, { name: "b" }],
    });
    engine.load({
      schema: "main",
      table: "events",
      columns: [
        { name: "id", type: "string" },
        { name: "amount", type: "number" },
        { name: "people", type: "string" },
      ],
      rows: [{ id: "first", amount: 9, people: '["a","b"]' }],
    });
    const allocation = `with ex as (select id, amount, case when people='[]' then (select list(name) from entities) else cast(people as varchar[]) end as people from events) select id, unnest(people) as person, amount / len(people) as share from ex where len(people)>0`;
    assert.deepEqual(query(allocation), [
      { id: "first", person: "a", share: 4.5 },
      { id: "first", person: "b", share: 4.5 },
    ]);
    const write = engine.prepare(
      normalizeLegacyDuckSql(
        "insert into events(id,amount,people) values ('second',3,cast(to_json([$person]) as varchar))",
      ).sql,
      "write",
    );
    try {
      write.bind({ person: "a" }).run(1000);
    } finally {
      write.finalize();
    }
    assert.deepEqual(query(allocation), [
      { id: "first", person: "a", share: 4.5 },
      { id: "first", person: "b", share: 4.5 },
      { id: "second", person: "a", share: 3 },
    ]);
    assert.deepEqual(
      query("select list(name) as names from entities where 0"),
      [{ names: null }],
    );
    assert.deepEqual(query("select list(name) as names from entities"), [
      { names: '["a","b"]' },
    ]);
  } finally {
    engine.close();
  }
});

test("ambiguous scalar types refuse without exact versioned statement evidence", () => {
  assert.throws(
    () => normalizeLegacyDuckSql("select len(name) from rows"),
    /list type/,
  );
  assert.throws(
    () => normalizeLegacyDuckSql("select least(a,b) from rows"),
    /minimum/,
  );
  const sql = "select len(people) from rows";
  assert.throws(
    () => normalizeLegacyDuckSql(sql, audit(sql + " ")),
    /list type/,
  );
  assert.throws(() => normalizeLegacyDuckSql("select least('2',3)"));
  assert.equal(
    normalizeLegacyDuckSql("select length('abc'), 'len(name)' /* len(name) */")
      .changed,
    false,
  );
});
