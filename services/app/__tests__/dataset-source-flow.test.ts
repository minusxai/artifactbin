/** Native dataset namespaces replace JSX Import/Query chains; direct catalog SQL remains separate. */
import { expect, it } from "vitest";
import { request, useAppHarness, mintAccountToken } from "./harness";
import { nativeHtml } from "./native-html-fixture";
import { POST as create } from "@/app/api/artifacts/route";
import { POST as graphql } from "@/app/api/artifacts/[id]/graphql/route";
import { POST as tableQuery } from "@/app/a/[id]/tables/route";
import { POST as mutateRows } from "@/app/api/artifacts/[id]/mutate/route";
useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function fixture(dataset: unknown) {
  const owner = await mintAccountToken("dataset source");
  const publish = async (json: Record<string, unknown>) => {
    const response = await create(
      request("/api/artifacts", { method: "POST", token: owner.token, json }),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).id as string;
  };
  const id = await publish({
    dataset,
    access: "readwrite",
    visibility: "public",
  });
  const page = await publish({
    html: nativeHtml(
      `<link rel="af-dataset" data-af-name="data" href="ref:${id}"><h1>Dataset</h1>`,
    ),
    visibility: "public",
  });
  const run = async (
    query: string,
    variables: Record<string, unknown> = {},
  ) => {
    const response = await graphql(
      request(`/api/artifacts/${page}/graphql`, {
        method: "POST",
        token: owner.token,
        json: { revision: "1", query, variables },
      }),
      ctx(page),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.errors).toBeUndefined();
    return body.data.data;
  };
  const schema = await run(
    "{data{schema{tables{id label columns{id label}}}}}",
  );
  return {
    id,
    page,
    owner,
    publish,
    run,
    tables: schema.schema.tables as {
      id: string;
      label: string;
      columns: { id: string; label: string }[];
    }[],
  };
}
it("aggregates complete stored inputs beyond display windows and bounds paginated output", async () => {
  const f = await fixture(
      Array.from({ length: 10005 }, (_, i) => ({ n: i + 1 })),
    ),
    table = f.tables[0]!,
    column = table.columns[0]!;
  const result = await f.run(
    'query($table:ID!,$column:ID!){data{query(tableId:$table,first:1,aggregates:[{id:"count",operation:COUNT},{id:"total",operation:SUM,columnId:$column}]){source{truncated totalRows storedRows} rows{cells{value{number}}}} rows(tableId:$table,first:2){rows{id} pageInfo{hasNextPage endCursor}}}}',
    { table: table.id, column: column.id },
  );
  expect(
    result.query.rows[0].cells.map(
      (c: { value: { number: number } }) => c.value.number,
    ),
  ).toEqual([10005, 50055015]);
  expect(result.query).toMatchObject({
    source: { truncated: false, totalRows: 10005 },
  });
  expect(result.rows.rows).toHaveLength(2);
  expect(result.rows.pageInfo.hasNextPage).toBe(true);
  const filtered = await f.run(
    'query($table:ID!,$column:ID!){data{query(tableId:$table,first:1,filters:[{columnId:$column,operator:GT,parameter:"minimum"}],parameters:[{name:"minimum",value:{type:NUMBER,number:10000}}],aggregates:[{id:"tail",operation:SUM,columnId:$column}]){rows{cells{value{number}}}}}}',
    { table: table.id, column: column.id },
  );
  expect(filtered.query.rows[0].cells[0].value.number).toBe(50015);
});
it("discovers multi-schema tables and changes only the explicitly selected stable table", async () => {
  const f = await fixture({
    kind: "stored",
    defaultSchema: "sales",
    tables: [
      { schema: "sales", name: "orders", rows: [{ total: 12 }, { total: 8 }] },
      { schema: "support", name: "tickets", rows: [{ total: 10 }] },
    ],
  });
  expect(f.tables.map((t) => t.label).sort()).toEqual(["orders", "tickets"]);
  const table = f.tables.find((t) => t.label === "tickets")!,
    column = table.columns[0]!;
  const read = await f.run(
    "query($table:ID!){data{rows(tableId:$table,first:2){revision rows{id}}}}",
    { table: table.id },
  );
  const write = await f.run(
    'mutation($table:ID!,$column:ID!,$row:ID!,$revision:String!){data{writeRows(tableId:$table,expectedRevision:$revision,requestId:"table-isolation",changes:[{kind:UPDATE,rowId:$row,cells:[{columnId:$column,value:{type:NUMBER,number:11}}]}]){outcome}}}',
    {
      table: table.id,
      column: column.id,
      row: read.rows.rows[0].id,
      revision: read.rows.revision,
    },
  );
  expect(write.writeRows.outcome).toBe("committed");
  const response = await tableQuery(
    request(`/a/${f.id}/tables`, {
      method: "POST",
      json: { sql: "select total from sales.orders order by total" },
    }),
    ctx(f.id),
  );
  expect((await response.json()).rows).toEqual([{ total: 8 }, { total: 12 }]);
  const changed = await tableQuery(
    request(`/a/${f.id}/tables`, {
      method: "POST",
      json: { sql: "select total from support.tickets" },
    }),
    ctx(f.id),
  );
  expect((await changed.json()).rows).toEqual([{ total: 11 }]);
});
it("does not admit folder projections as dataset namespaces", async () => {
  const f = await fixture([{ n: 1 }]);
  const folder = await f.publish({
    format: "folder",
    title: "Reports",
    visibility: "public",
  });
  // Folder listing behavior belongs to the retained folder API; JSX SQL-import publication is retired.
  const response = await create(
    request("/api/artifacts", {
      method: "POST",
      token: f.owner.token,
      json: {
        html: nativeHtml(
          `<link rel="af-dataset" data-af-name="children" href="ref:${folder}"><p>Folder</p>`,
        ),
      },
    }),
  );
  expect(response.status).toBe(400);
});
it("keeps direct writes catalog-scoped and refuses retired implicit SQL aliases", async () => {
  const f = await fixture([{ n: 1 }]);
  const valid = await mutateRows(
    request(`/api/artifacts/${f.id}/mutate`, {
      method: "POST",
      token: f.owner.token,
      json: { sql: "update public.rows set n=2" },
    }),
    ctx(f.id),
  );
  expect(valid.status, await valid.clone().text()).toBe(200);
  const retired = await mutateRows(
    request(`/api/artifacts/${f.id}/mutate`, {
      method: "POST",
      token: f.owner.token,
      json: { sql: `update ref_${f.id} set n=3` },
    }),
    ctx(f.id),
  );
  expect(retired.status).toBe(400);
  const rows = await tableQuery(
    request(`/a/${f.id}/tables`, {
      method: "POST",
      json: { sql: "select n from public.rows" },
    }),
    ctx(f.id),
  );
  expect((await rows.json()).rows).toEqual([{ n: 2 }]);
  const invalid = await tableQuery(
    request(`/a/${f.id}/tables`, {
      method: "POST",
      json: { sql: "select n::double from public.rows" },
    }),
    ctx(f.id),
  );
  expect(invalid.status).toBe(400);
});
