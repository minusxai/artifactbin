import test from "node:test";
import assert from "node:assert/strict";
import { extractLegacyMutations } from "../src/migration/conversion/mutations.ts";
const catalogs = [
  {
    name: "data",
    datasetLegacyId: "ABC123",
    tables: [
      {
        schema: "public",
        name: "rows",
        columns: [
          { name: "id", type: "number" as const },
          { name: "title", type: "string" as const },
          { name: "who", type: "user" as const },
        ],
      },
    ],
  },
];
function source(
  sql = "update data.rows set title=$_value where id=$_row.id",
  column = "title",
  query = "select id,title,who from data.rows",
  extra = "",
) {
  return `<Helmet><Import name="data" src="ref:ABC123"/><Query name="base">{\`${query}\`}</Query><Query name="visible">{\`select * from base\`}</Query><Mutation name="save" expectedAffected={1}>{\`${sql}\`}</Mutation>${extra}</Helmet><DataTable data="$visible" rowKey="id"><Column col="${column}"><input value="$_row.${column}" run="$save"/></Column></DataTable>`;
}
test("cell builtin derives immutable projected type through prepared query dependencies and retains row cardinality", async () => {
  const r = await extractLegacyMutations(source(), catalogs);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.mutations[0]?.valueParam, {
    param: "cell__value",
    type: "string",
  });
  assert.deepEqual(r.mutations[0]?.paramTypes, {
    cell__value: "string",
    row__id: null,
  });
  assert.equal(
    r.mutations[0]?.sql,
    "update data.rows set title=$cell__value where id=$row__id",
  );
  assert.equal(r.mutations[0]?.expectedAffected, 1);
  const user = await extractLegacyMutations(
    source("update data.rows set who=$_value where id=$_row.id", "who"),
    catalogs,
  );
  assert.equal(user.mutations[0]?.valueParam?.type, "user");
});
test("cell type follows query alias not mutation target, and computed values never acquire guessed types", async () => {
  const alias = await extractLegacyMutations(
    source(undefined, "label", "select id,who as label from data.rows"),
    catalogs,
  );
  assert.equal(alias.mutations[0]?.valueParam?.type, "user");
  for (const q of [
    "select id,upper(title) as title from data.rows",
    "select id,42 as title from data.rows",
  ]) {
    const r = await extractLegacyMutations(
      source(undefined, "title", q),
      catalogs,
    );
    assert.ok(r.issues.length);
    assert.deepEqual(r.mutations, []);
  }
});
test("cell builtin refuses collisions, unscoped usage and inconsistent operation site types", async () => {
  const inputs = [
    source("update data.rows set title=$_value where id=$cell__value"),
    source(
      undefined,
      "title",
      undefined,
      '<Value name="cell__value" type="string"/>',
    ),
    source().replace(/<DataTable[\s\S]*/, ""),
    source() +
      '<DataTable data="$visible" rowKey="id"><Column col="id"><input value="$_row.id" run="$save"/></Column></DataTable>',
  ];
  for (const s of inputs) {
    const r = await extractLegacyMutations(s, catalogs);
    assert.ok(r.issues.length);
    assert.deepEqual(r.mutations, []);
  }
});
test("quoted and commented cell lookalikes are untouched and never require a cell type", async () => {
  const sql =
    "update data.rows set title='$_value' where id=1 /* $_value $cell__value */ -- $_value\n";
  const r = await extractLegacyMutations(
    `<Helmet><Import name="data" src="ref:ABC123"/><Mutation name="save">{\`${sql}\`}</Mutation></Helmet>`,
    catalogs,
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.mutations[0]?.sql, sql);
  assert.equal(r.mutations[0]?.valueParam, undefined);
});
test("computed column types remain unknown through dependent aliases and arbitrary query SQL is never executed", async () => {
  for (const query of [
    "select id,upper(title) as title from data.rows",
    "delete from data.rows",
  ]) {
    const r = await extractLegacyMutations(
      source(undefined, "title", query),
      catalogs,
    );
    assert.ok(r.issues.length);
    assert.deepEqual(r.mutations, []);
  }
  // Independent computed columns do not taint a directly typed editable projection.
  const r = await extractLegacyMutations(
    source(
      undefined,
      "title",
      "select id,title,upper(title) as presentation from data.rows",
    ),
    catalogs,
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.mutations[0]?.valueParam?.type, "string");
});

test("publication records only the sole SQLite authorizer write action and exact update columns",async()=>{
 for (const [sql,analysis] of [
  ["/* insert delete */ update data.rows set title=$_value where id=$_row.id",{operation:"update",columns:["title"]}],
  ["insert into data.rows(id,title) values(1,$_value)",{operation:"insert",columns:[]}],
  ["delete from data.rows where title=$_value",{operation:"delete",columns:[]}],
 ] as const) {
  const r=await extractLegacyMutations(source(sql),catalogs);
  assert.deepEqual(r.issues,[]);assert.deepEqual(r.mutations[0]?.analysis,analysis);
 }
});
test('prototype presentation attributes do not change verified publication descriptors',async()=>{
 const plain=await extractLegacyMutations(source(),catalogs);
 const decorated=source().replace('<input ','<input style={{width:"12rem"}} title="Edit" placeholder={$hint} ');
 assert.ok((await extractLegacyMutations(decorated,catalogs)).issues.length);
 const result=await extractLegacyMutations(decorated,catalogs,[],'offline-prototype');assert.deepEqual(result,plain);
 for(const invalid of [decorated.replace('data.rows set title','missing.rows set title'),decorated.replace('value="$_row.title"','value="$_row.other"'),decorated.replace('rowKey="id"','')])assert.ok((await extractLegacyMutations(invalid,catalogs,[],'offline-prototype')).issues.length);
});
