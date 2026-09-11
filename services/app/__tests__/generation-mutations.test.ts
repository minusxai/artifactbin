import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GenerationRequest } from "@artifactbin/contracts";
import { POST as create } from "@/app/api/artifacts/route";
import { POST as mutate } from "@/app/a/[id]/mutate/route";
import { GET as query } from "@/app/a/[id]/query/route";
import { getArtifactById } from "@/lib/artifacts";
import { getDb } from "@/lib/db";
import { services, setServices } from "@/lib/services";
import { mintToken } from "@/lib/tokens";
import { agentCookie, request, useAppHarness } from "./harness";
useAppHarness();
const original = services();
const generate = vi.fn(async (_request: GenerationRequest) => ({
  json: '{"title":"A new path","score":6}',
  usage: { input: 20, output: 10 },
}));
beforeEach(() => {
  generate.mockClear();
  setServices({ generation: { generate } });
});
afterEach(() => {
  setServices(original);
  vi.restoreAllMocks();
});
const schema = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 10 },
  },
  required: ["title", "score"],
  additionalProperties: false,
});
async function fixture() {
  const owner = await mintToken("generation owner");
  const publish = async (body: object) => {
    const r = await create(
      request("/api/artifacts", {
        method: "POST",
        token: owner.token,
        json: body,
      }),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    return (await r.json()).id as string;
  };
  const ds = await publish({
    dataset: [{ result: "seed" }],
    access: "readwrite",
  });
  const doc = await publish({
    markup: `<Helmet><Value name="move" default="Go left" /><Query name="nodes" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="step" source="ref:${ds}">{\`insert into public.rows select llm($move, 'Narrate.', '${JSON.stringify({ model: "default", schema: JSON.parse(schema) })}')\`}</Mutation></Helmet><Button run="$step">Do it</Button><DataTable data="$nodes" />`,
  });
  const cookie = await agentCookie([owner.id]);
  const write = (auth: string | undefined = cookie) =>
    mutate(
      request(`/a/${doc}/mutate`, {
        method: "POST",
        cookie: auth,
        json: { mutation: "step", values: { move: "Go right" } },
      }),
      { params: Promise.resolve({ id: doc }) },
    );
  const read = async () => {
    const r = await query(request(`/a/${doc}/query?q=%7B%7D`), {
      params: Promise.resolve({ id: doc }),
    });
    return (await r.json()).tables.nodes.rows;
  };
  return { ds, doc, write, read };
}

it("publishes without spending, then an authorized mutation generates and saves reactive rows", async () => {
  const f = await fixture();
  expect(generate).not.toHaveBeenCalled();
  const response = await f.write();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0]).toMatchObject({
    model: "default",
    text: "Go right",
    system: "Narrate.",
  });
  expect(await f.read()).toEqual([
    { result: "seed" },
    { result: '{"title":"A new path","score":6}' },
  ]);
});
it("never calls a model for an anonymous visitor", async () => {
  const f = await fixture();
  expect((await f.write("")).status).toBe(403);
  expect(generate).not.toHaveBeenCalled();
});
it("refuses invalid output without changing rows or version", async () => {
  const f = await fixture();
  generate.mockResolvedValueOnce({
    json: '{"score":99}',
    usage: { input: 20, output: 10 },
  });
  expect((await f.write()).status).toBe(400);
  expect((await getArtifactById(f.ds))?.version).toBe(1);
  expect(await f.read()).toEqual([{ result: "seed" }]);
});
it("reuses generation on a real compare-and-swap retry", async () => {
  const f = await fixture();
  const db = await getDb();
  const originalQuery = db.query.bind(db);
  let raced = false;
  vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
    if (
      !raced &&
      sql.includes("WITH updated AS") &&
      sql.includes("actor_user_id = $13")
    ) {
      raced = true;
      await originalQuery(
        "update artifacts set edit_id='competing-edit' where id=$1",
        [f.ds],
      );
    }
    return originalQuery(sql, params);
  });
  const response = await f.write();
  expect(response.status, await response.clone().text()).toBe(200);
  expect(raced).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await f.read()).toHaveLength(2);
});
it("rechecks permission when access changes during generation", async () => {
  const f = await fixture();
  const db = await getDb();
  generate.mockImplementationOnce(async () => {
    await db.query("update artifacts set access='read' where id=$1", [f.ds]);
    return {
      json: '{"title":"A new path","score":6}',
      usage: { input: 20, output: 10 },
    };
  });
  expect((await f.write()).status).toBe(403);
  expect(await f.read()).toEqual([{ result: "seed" }]);
});
