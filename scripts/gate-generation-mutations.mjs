import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startDocument, becomeOwner } from "./lib/start-doc.mjs";

const base = process.argv[2] ?? "http://localhost:3030";
const fixture = process.env.GENERATION_FIXTURE_URL;
assert(
  fixture,
  "Run through scripts/gates.mjs so a deterministic generation fixture is configured.",
);
const count = async () =>
  (await (await fetch(`${fixture}/stats`)).json()).calls;
const before = await count();
const seed = await startDocument(base);
const publish = async (body) => {
  const response = await fetch(`${base}/api/artifacts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${seed.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
};
const dataset = await publish({
  dataset: [{ result: "seed" }],
  access: "readwrite",
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
const markup = `<Helmet><Value name="move" default="slow path" />
<Query name="nodes" source="ref:${dataset.id}">{\`select * from public.rows\`}</Query>
<Mutation name="step" source="ref:${dataset.id}">{\`insert into public.rows
with narration as materialized (select llm($move, 'Narrate the next moment.', '${JSON.stringify({model:'default',schema:JSON.parse(schema),temperature:0.9})}') as result)
select case when (result::json->>'score')::double > 8 then llm('Judge decisive outcome: ' || result, 'Judge the outcome.', '${JSON.stringify({model:'default',schema:JSON.parse(schema),temperature:0.3})}') else result end from narration\`}</Mutation></Helmet>
<h1>Counterfactual mutation probe</h1>
<Iframe title="Branch composer" height={180}>
<style>{\`body {font:16px system-ui;padding:20px} button,input{font:inherit;padding:8px} #status{margin-top:12px}\`}</style>
<input id="move" aria-label="Next move" value="slow path" /><button id="go">Do it</button><p id="status" role="status"></p>
<script>{\`document.getElementById('go').onclick=async()=>{
const button=document.getElementById('go'),status=document.getElementById('status');button.disabled=true;status.textContent='Narrating…';
try{await mx.mutate('step',{move:document.getElementById('move').value});status.textContent='Saved';}
catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};\`}</script></Iframe><DataTable data="$nodes" />`;
const doc = await publish({ markup });
assert.equal(await count(), before, "publish must not call the provider");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await becomeOwner(page, base, seed.token);
  await page.goto(doc.url);
  let inner;
  for (let i = 0; i < 100; i++) {
    inner = page.frames().find((frame) => frame.name() === "Branch composer");
    if (!inner)
      for (const frame of page.frames())
        if (
          await frame
            .getByRole("button", { name: "Do it", exact: true })
            .count()
        ) {
          inner = frame;
          break;
        }
    if (inner) break;
    await page.waitForTimeout(100);
  }
  assert(inner, "managed composer frame mounted");
  await inner.waitForFunction(() => window.mx.canMutate('step'), null, {timeout: 15000}).catch(async error => { throw new Error(`${error.message}; capability: ${await inner.evaluate(() => window.mx.mutationReason('step'))}`); });
  await inner.getByRole("button", { name: "Do it", exact: true }).click();
  await inner.getByText("Saved", { exact: true }).waitFor({ timeout: 40_000 }).catch(async error => { throw new Error(`${error.message}; composer status: ${await inner.locator("#status").textContent()}`); });
  assert.equal(await count(), before + 1, "slow narration should run once");
  const read = async () => {
    const r = await page.request.post(`${base}/a/${doc.id}/query`, {
      data: {},
    });
    assert.equal(r.status(), 200);
    return (await r.json()).tables.nodes.rows;
  };
  assert.equal((await read()).length, 2);
  await inner.getByLabel("Next move", { exact: true }).fill("decisive path");
  await inner.getByRole("button", { name: "Do it", exact: true }).click();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 100 && (await count()) < before + 3; i++)
    await page.waitForTimeout(100);
  await inner.getByText("Saved", { exact: true }).waitFor();
  assert.equal(await count(), before + 3, "decisive narration calls one judge");
  assert.equal((await read()).length, 3);
  await inner.getByLabel("Next move", { exact: true }).fill("invalid output");
  const refused = page.waitForResponse((response) =>
    response.url().endsWith(`/a/${doc.id}/mutate`),
  );
  await inner.getByRole("button", { name: "Do it", exact: true }).click();
  const refusal = await refused;
  assert.equal(refusal.status(), 400);
  assert.equal((await refusal.json()).detail, "Model output is not valid JSON");
  await inner
    .getByText("Script operation failed or permission denied", { exact: true })
    .waitFor()
    .catch(async (error) => {
      throw new Error(
        `Invalid-output status: ${await inner.locator("#status").innerText()}`,
        { cause: error },
      );
    });
  assert.equal((await read()).length, 3, "invalid output must not save");
  await page.reload();
  assert.equal((await read()).length, 3, "saved rows survive reload");
  assert.equal(await count(), before + 4, "reload must not generate");
  const guest = await browser.newPage();
  const response = await guest.request.post(`${base}/a/${doc.id}/mutate`, {
    data: { mutation: "step", values: { move: "forged" } },
  });
  assert.equal(response.status(), 403);
  assert.equal(await count(), before + 4);
  console.log(
    "all good: zero-call publish, slow iframe mutation, conditional judge, saved rows, invalid output and anonymous refusal",
  );
} finally {
  await browser.close();
}
