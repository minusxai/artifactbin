/** Native pages bind dataset namespaces; typed requests validate at execution, never at JSX compile time. */
import { expect, it } from "vitest";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { request, useAppHarness, mintAccountToken } from "./harness";
import { nativeHtml } from "./native-html-fixture";
import { POST as create } from "@/app/api/artifacts/route";
import { POST as preview } from "@/app/api/preview/route";
import { GET as raw } from "@/app/a/[id]/raw/route";
import { POST as sqlDoor } from "@/app/api/artifacts/[id]/sql/route";
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
    const response = await sqlDoor(
      request(`/api/artifacts/${id}/sql`, {
        method: "POST",
        token,
        json: { revision: "1", sql: query, params: variables },
      }),
      ctx(id),
    );
    return response.json();
  };
  return { id, dataset, html, owner, publish, run };
}
it("publishes namespace bindings and exposes typed schema without inlining source rows", async () => {
  const f = await fixture();
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
    'select region, revenue, sourceOnly from sales order by revenue limit 2',
    {},
    undefined,
  );
  expect(read.error).toBeUndefined();
  expect(read.rows).toEqual([
    { region: "EU", revenue: 837, sourceOnly: SOURCE_ONLY_SENTINEL },
    { region: "NA", revenue: 1200, sourceOnly: null },
  ]);
});
it("validates typed queries and variables against the generated columns", async () => {
  const f = await fixture();
  const query = "select revenue from sales where revenue > $minimum";
  const result = await f.run(query, { minimum: 1000 });
  expect(result.error).toBeUndefined();
  expect(result.rows).toEqual([{ revenue: 1200 }]);
  const invalid = await f.run("select revenue from sales where missing > 1");
  expect(invalid.error).toBeTruthy();

});
it("enforces revoked dataset ACL independently of the public page", async () => {
  const f = await fixture();
  const db = await getDb();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [
    f.dataset,
  ]);
  const outsider = await mintAccountToken("reader");
  const response = await f.run("select _id from sales", {}, outsider.token);
  expect(response.error).toBeTruthy();
  expect(response.rows).toBeUndefined();
  await db.query("UPDATE artifacts SET deleted_at=now() WHERE id=$1", [
    f.dataset,
  ]);
  const deleted = await f.run("select _id from sales");
  expect(deleted.error).toBeTruthy();
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
