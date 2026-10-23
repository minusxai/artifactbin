/** Native HTML live-data gate. Retains separate readers, dataset invalidation,
 * private viewer state, sharing/policy revocation and saved HTML delivery.
 * Retired: JSX island morph/chart identity, in-app editor and injected themes.
 * Native source updates replace complete documents; shared-data updates do not.
 */
import { fixtureFetch as fetch } from "./lib/fixture-http.mjs";
import { launchChromium } from "./lib/browser.mjs";
import { documentFrame } from "./lib/page-facts.mjs";
import { createChecker } from "./lib/assert.mjs";
import { lane } from "./lib/lane.mjs";
import { startDocument, becomeOwner } from "../lib/start-doc.mjs";
import { datasetPageHtml } from "./lib/native-dataset-page.mjs";
import { pageHtml } from "../fixtures/page-speed/native.mjs";
const BASE = process.argv[2] ?? "http://localhost:3030";
const check = createChecker("live");
const browser = await launchChromium();
const until = async (read, want) => {
  let value;
  const end = Date.now() + 15e3;
  do {
    value = await read();
    if (want(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < end);
  return value;
};
const api = async (token, path, body, method = "POST") => {
  const response = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
};
const put = (owner, html) => api(owner.token, `/api/artifacts/${owner.id}`, { html }, "PUT");
const contexts = [];
async function open(id, owner) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  if (owner) await becomeOwner(page, BASE, owner.token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: "domcontentloaded" });
  const frame = await documentFrame(page);
  try {
    await frame.locator('html[data-af-ready="yes"]').waitFor();
  } catch (error) {
    throw Error(error.message + " page status: " + await frame.locator("#receipt").textContent().catch(() => "unavailable"));
  }
  return { page, frame };
}
const rows = (frame) => frame.locator("#total").textContent();
try {
  await lane(check, "live votes, separate viewers and revocation").run(async () => {
    const owner = await startDocument(BASE);
    const ds = await api(owner.token, "/api/artifacts", { title: "Lunch votes", dataset: [{ choice: "ramen" }], columns: [{ name: "choice", type: "string" }], access: "read", visibility: "unlisted" });
    const sharingContext = await browser.newContext();
    contexts.push(sharingContext);
    const sharingPage = await sharingContext.newPage();
    await becomeOwner(sharingPage, BASE, owner.token);
    await sharingPage.goto(`${BASE}/a/${ds.id}`, { waitUntil: "domcontentloaded" });
    await sharingPage.getByRole("tab", { name: "Sharing", exact: true }).click();
    const writeToggle = sharingPage.getByLabel("Make read & write");
    await writeToggle.waitFor({ state: "visible" });
    check(true, "dataset owner sees sharing write control");
    const sharingResponse = sharingPage.waitForResponse((r) => r.url().includes("/sharing") && r.request().method() === "PUT");
    await writeToggle.click();
    check((await sharingResponse).ok(), "sharing UI opens dataset writes");
    await put(owner, datasetPageHtml(ds.id));
    const dashboard = await startDocument(BASE);
    await put(dashboard, datasetPageHtml(ds.id, { title: "Independent dashboard", writable: false }));
    const voter = await open(owner.id, owner);
    check(voter.frame !== voter.page.mainFrame(), "owner HTML runs inside its isolated frame");
    check(new URL(voter.frame.url()).origin !== new URL(BASE).origin, "page code has a separate origin from account credentials");
    const watcher = await open(owner.id);
    const dash = await open(dashboard.id);
    check(await rows(watcher.frame) === "rows: 1", "watcher starts from shared row");
    check(await rows(dash.frame) === "rows: 1", "different document starts from same dataset");
    await watcher.frame.locator("#choice").selectOption("tacos");
    for (const { frame } of [watcher, dash]) await frame.evaluate(() => {
      window.__gateNoReload = true;
    });
    await voter.frame.locator("#vote").click();
    const receipt = await until(() => voter.frame.locator("#receipt").textContent(), (v) => Boolean(v));
    if (receipt !== "committed") throw Error("Vote outcome: " + receipt);
    check(await until(() => rows(voter.frame), (v) => v === "rows: 2") === "rows: 2", "committed writer redraws");
    check(await until(() => rows(watcher.frame), (v) => v === "rows: 2") === "rows: 2", "same-page watcher follows shared invalidation");
    check(await until(() => rows(dash.frame), (v) => v === "rows: 2") === "rows: 2", "different document follows the same dataset");
    for (const [name, { frame }] of [["watcher", watcher], ["dashboard", dash]]) check(await frame.evaluate(() => window.__gateNoReload === true), `${name} follows without a frame reload`);
    check(await watcher.frame.locator("#choice").inputValue() === "tacos", "another viewer write preserves private selection");
    check(await voter.frame.locator("#choice").inputValue() === "ramen", "viewers do not share local state");
    await watcher.frame.locator("#vote").click();
    const denied = await until(() => watcher.frame.locator("#receipt").textContent(), Boolean);
    check(/rejected|refused/i.test(denied), "page readability and readwrite access do not confer dataset write authority");
    await api(owner.token, `/api/artifacts/${ds.id}/policy`, {expectedPolicyRevision: 0, policy: {version: 1, enforcement: 'enabled', tables: [{table: {schema: 'public', name: 'rows'}, insert_permissions: [{role: 'viewer', permission: {columns: ['choice'], check: {}}}]}]}}, 'PUT');
    await watcher.frame.locator("#refresh").click();
    await watcher.frame.locator("#vote").click();
    const publicReceipt = await until(() => watcher.frame.locator("#receipt").textContent(), Boolean);
    check(publicReceipt === "committed", `anonymous viewer can write with an explicit insert grant (${publicReceipt})`);
    check(await until(() => rows(dash.frame), (v) => v === "rows: 3") === "rows: 3", "different document follows explicitly authorized anonymous writer too");
    await watcher.page.reload({ waitUntil: "domcontentloaded" });
    watcher.frame = await documentFrame(watcher.page);
    await watcher.frame.locator('html[data-af-ready="yes"]').waitFor();
    check(await watcher.frame.locator("#choice").inputValue() === "tacos", "viewer choice survives reload");
    await api(owner.token, `/api/artifacts/${ds.id}/policy`, {expectedPolicyRevision: 1, policy: {version: 1, enforcement: 'enabled', tables: [{table: {schema: 'public', name: 'rows'}, insert_permissions: []}]}}, 'PUT');
    await voter.frame.locator("#refresh").click();
    await voter.frame.locator("#vote").click();
    const refusal = await until(() => voter.frame.locator("#receipt").textContent(), (v) => Boolean(v) && v !== "committed");
    check(typeof refusal === "string" && /refused|rejected/i.test(refusal), "revoked dataset refuses an already-open writer");
  });
  await lane(check, "published HTML and private local state").run(async () => {
    const owner = await startDocument(BASE);
    const html = (label) => pageHtml(label, `<h1>${label}</h1><button id="inc">Increment</button><output id="count"></output>`, `const query=gql\`{count}\`;const draw=async()=>document.querySelector('#count').textContent=(await client.query({query})).data.count;document.querySelector('#inc').onclick=async()=>{await client.updateQuery({query},({count})=>({count:count+1}));await draw()};await draw();document.documentElement.dataset.afReady='yes';`, { count: 0 });
    await put(owner, html("Original"));
    const reader = await open(owner.id);
    await reader.frame.locator("#inc").click();
    check(await reader.frame.locator("#count").textContent() === "1", "ordinary HTML controls update Apollo state");
    await put(owner, html("Replacement"));
    const latest = await until(async () => {
      try {
        return await (await documentFrame(reader.page, { timeout: 1e3 })).locator("h1").textContent({ timeout: 1e3 });
      } catch {
        return "";
      }
    }, (v) => v === "Replacement");
    check(latest === "Replacement", "open reader receives the newly published HTML");
    await reader.page.reload({ waitUntil: "domcontentloaded" });
    const frame = await documentFrame(reader.page);
    await frame.locator('html[data-af-ready="yes"]').waitFor();
    check(await frame.locator("h1").textContent() === "Replacement", "reload serves latest saved version");
    check(await frame.locator("#count").textContent() === "1", "replacement preserves viewer-local state");
  });
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
}
check.done();
