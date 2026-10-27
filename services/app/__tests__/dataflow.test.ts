/** Native pages bind dataset namespaces; typed requests validate at execution, never at JSX compile time. */
import { expect, it } from "vitest";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { request, useAppHarness, mintAccountToken } from "./harness";
import { nativeHtml } from "./native-html-fixture";
import { POST as create } from "@/app/api/artifacts/route";
import { POST as preview } from "@/app/api/preview/route";
import { GET as raw } from "@/app/a/[id]/raw/route";
import {
  GET as discover,
  POST as graphql,
} from "@/app/api/artifacts/[id]/graphql/route";
import { GET as get, PUT as replace } from "@/app/api/artifacts/[id]/route";
import { getDb } from "@/lib/platform";
useAppHarness();
const SOURCE_ONLY_SENTINEL =
  "dataset-source-only-7e34d9a1-not-authored-page-state";
function pagePayloads(content: string) {
  const payloads: Record<string, unknown> = {};
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if (
      "attrs" in node &&
      node.nodeName === "script" &&
      node.attrs.some(
        (attr) => attr.name === "type" && attr.value === "application/json",
      )
    ) {
      const name = node.attrs.find((attr) => attr.name === "data-af")?.value;
      if (name)
        payloads[name] = JSON.parse(
          node.childNodes
            .filter((child) => child.nodeName === "#text")
            .map((child) => (child as DefaultTreeAdapterMap["textNode"]).value)
            .join(""),
        );
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(content));
  return payloads;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function fixture() {
  const owner = await mintAccountToken("native dataflow");
  const publish = async (
    json: Record<string, unknown>,
    token = owner.token,
  ) => {
    const response = await create(
      request("/api/artifacts", { method: "POST", token, json }),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).id as string;
  };
  const dataset = await publish({
    dataset: [
      { region: "EU", revenue: 837, sourceOnly: SOURCE_ONLY_SENTINEL },
      { region: "NA", revenue: 1200 },
    ],
    visibility: "public",
  });
  const html = nativeHtml(
    `<link rel="af-dataset" data-af-name="sales" href="ref:${dataset}"><h1>Sales</h1><script type="application/json" data-af="state">{"region":"EU"}</script><script src="/af/core.js" data-af="core"></script>`,
  );
  const id = await publish({ html, visibility: "public" });
  const run = async (
    query: string,
    variables: Record<string, unknown> = {},
    token: string | undefined = owner.token,
  ) => {
    const response = await graphql(
      request(`/api/artifacts/${id}/graphql`, {
        method: "POST",
        token,
        json: { revision: "1", query, variables },
      }),
      ctx(id),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  const schema = await run("{sales{schema{tables{id columns{id label}}}}}");
  const table = schema.data.sales.schema.tables[0] as {
    id: string;
    columns: { id: string; label: string }[];
  };
  return { id, dataset, html, owner, publish, run, table };
}
it("publishes namespace bindings and exposes typed schema without inlining source rows", async () => {
  const f = await fixture();
  const response = await discover(
    request(`/api/artifacts/${f.id}/graphql`),
    ctx(f.id),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).sdl).toContain("sales__Query");
  const saved = await (
    await get(
      request(`/api/artifacts/${f.id}`, { token: f.owner.token }),
      ctx(f.id),
    )
  ).json();
  expect(saved.html).toContain(`href="ref:${f.dataset}"`);
  const content = await (
    await raw(request(`/a/${f.id}/raw`), ctx(f.id))
  ).text();
  const payloads = pagePayloads(content);
  expect(payloads.state).toEqual({ region: "EU" });
  expect(payloads.runtime).toMatchObject({ initialState: { region: "EU" } });
  expect((payloads.runtime as { initialState: unknown }).initialState).toEqual({
    region: "EU",
  });
  // Runtime code and hashes may contain any digits; this value exists only in source rows.
  expect(content).not.toContain(SOURCE_ONLY_SENTINEL);
  const read = await f.run(
    "query($table:ID!){sales{rows(tableId:$table,first:2){rows{cells{value{string number}}}}}}",
    { table: f.table.id },
    undefined,
  );
  expect(read.errors).toBeUndefined();
  expect(read.data.sales.rows.rows).toHaveLength(2);
  const cells = read.data.sales.rows.rows.flatMap(
    (row: {
      cells: { value: { string: string | null; number: number | null } }[];
    }) => row.cells,
  );
  expect(
    cells.map(
      (cell: { value: { string: string | null } }) => cell.value.string,
    ),
  ).toContain(SOURCE_ONLY_SENTINEL);
  expect(
    cells
      .map((cell: { value: { number: number | null } }) => cell.value.number)
      .filter((value: unknown) => typeof value === "number")
      .sort((a: number, b: number) => a - b),
  ).toEqual([837, 1200]);
});
it("validates typed queries and named parameters against discovered columns", async () => {
  const f = await fixture(),
    amount = f.table.columns.find((column) => column.label === "revenue")!;
  const query =
    'query($table:ID!,$column:ID!){sales{query(tableId:$table,first:2,filters:[{columnId:$column,operator:GT,parameter:"minimum"}],parameters:[{name:"minimum",value:{type:NUMBER,number:1000}}]){rows{cells{value{number}}}}}}';
  const result = await f.run(query, { table: f.table.id, column: amount.id });
  expect(result.errors).toBeUndefined();
  expect(result.data.sales.query.rows).toHaveLength(1);
  const invalid = await f.run(query, { table: f.table.id, column: "missing" });
  expect(invalid.errors).toHaveLength(1);
  const missing = await f.run(
    'query($table:ID!,$column:ID!){sales{query(tableId:$table,filters:[{columnId:$column,operator:GT,parameter:"missing"}]){rows{id}}}}',
    { table: f.table.id, column: amount.id },
  );
  expect(missing.errors).toHaveLength(1);
  const cycle = await f.run('{sales{query(sql:"delete from rows"){rows{id}}}}');
  expect(cycle.errors.length).toBeGreaterThan(0);
  expect(cycle.data ?? null).toBeNull();
});
it("enforces revoked dataset ACL independently of the public page", async () => {
  const f = await fixture();
  const db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [
    f.dataset,
  ]);
  const outsider = await mintAccountToken("reader");
  const response = await f.run(
    "query($table:ID!){sales{rows(tableId:$table){rows{id}}}}",
    { table: f.table.id },
    outsider.token,
  );
  expect(response.errors).toHaveLength(1);
  expect(response.data?.sales?.rows ?? null).toBeNull();
  await db.query("UPDATE artifacts SET deleted_at=now() WHERE id=$1", [
    f.dataset,
  ]);
  const deleted = await f.run(
    "query($table:ID!){sales{rows(tableId:$table){rows{id}}}}",
    { table: f.table.id },
  );
  expect(deleted.errors).toHaveLength(1);
});
it("refuses inaccessible and non-dataset bindings before publication", async () => {
  const f = await fixture();
  const stranger = await mintAccountToken("other");
  await (
    await getDb()
  ).query("UPDATE artifacts SET visibility='private' WHERE id=$1", [f.dataset]);
  for (const ref of [f.dataset, f.id]) {
    const response = await create(
      request("/api/artifacts", {
        method: "POST",
        token: stranger.token,
        json: {
          html: nativeHtml(
            `<link rel="af-dataset" data-af-name="sales" href="ref:${ref}"><p>Data</p>`,
          ),
        },
      }),
    );
    expect(response.status).toBe(400);
  }
});
it("applies the same binding validation to full HTML replacements", async () => {
  const f = await fixture();
  const head = await (
    await get(
      request(`/api/artifacts/${f.id}`, { token: f.owner.token }),
      ctx(f.id),
    )
  ).json();
  const response = await replace(
    request(`/api/artifacts/${f.id}`, {
      method: "PUT",
      token: f.owner.token,
      json: {
        expectedVersion: head.version,
        expectedState: head.state,
        html: nativeHtml(
          '<link rel="af-dataset" data-af-name="sales" href="ref:missing"><p>Invalid</p>',
        ),
      },
    }),
    ctx(f.id),
  );
  expect(response.status).toBe(400);
  const unchanged = await (
    await get(
      request(`/api/artifacts/${f.id}`, { token: f.owner.token }),
      ctx(f.id),
    )
  ).json();
  expect(unchanged.version).toBe(head.version);
  expect(unchanged.html).toBe(head.html);
});
it("accepts ordinary author state and prose without executable declarations or SQL", async () => {
  const owner = await mintAccountToken("plain page"),
    html = nativeHtml(
      '<h1>Words</h1><script type="application/json" data-af="state">{"rows":[],"filter":""}</script>',
    );
  const response = await create(
    request("/api/artifacts", {
      method: "POST",
      token: owner.token,
      json: { html, visibility: "public" },
    }),
  );
  expect(response.status).toBe(201);
  const id = (await response.json()).id;
  const served = await (await raw(request(`/a/${id}/raw`), ctx(id))).text();
  expect(served).toContain("<h1");
  expect(served).toContain("Words");
  expect(served).not.toContain("data-mx-island-data");
});
it("refuses retired JSX dataflow on both create and preview", async () => {
  const owner = await mintAccountToken("retired syntax");
  for (const route of [create, preview]) {
    const response = await route(
      request("/api/artifacts", {
        method: "POST",
        token: owner.token,
        json: {
          markup:
            '<Helmet><Value name="v" default="x" /><Query name="q">{`select 1`}</Query></Helmet><DataTable data="$q" />',
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "native_html_required",
    });
  }
});
