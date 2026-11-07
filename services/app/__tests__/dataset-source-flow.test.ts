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
    return body.data;
  };
  return { id, page, owner, publish, run };
}
it("page SQL reads complete stored inputs beyond display windows and bounds paginated output", async () => {
  const f = await fixture(
    Array.from({ length: 10005 }, (_, i) => ({ n: i + 1 })),
  );
  const result = await f.run(
    '{_sql(sql:"select count(*) as count, sum(n) as total from data"){rows} data(limit:2){_id}}',
  );
  expect(result._sql.rows).toEqual([{ count: 10005, total: 50055015 }]);
  expect(result.data).toHaveLength(2);
  const filtered = await f.run(
    'query($p:JSON){_sql(sql:"select sum(n) as total from data where n > $minimum", params:$p){rows}}',
    { p: { minimum: 10000 } },
  );
  expect(filtered._sql.rows).toEqual([{ total: 50015 }]);
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
  // A multi-table link's roots are <link>_<table>.
  const read = await f.run("{data_orders{total} data_tickets{_id}}");
  expect(read.data_orders).toHaveLength(2);
  const write = await f.run(
    "mutation($row:ID!){update_data_tickets_by_pk(pk_columns:{_id:$row},_set:{total:11}){total}}",
    { row: read.data_tickets[0]._id },
  );
  expect(write.update_data_tickets_by_pk).toEqual({ total: 11 });
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
