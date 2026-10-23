/** Native data journey: original catalog UI, typed CSV cells, complete remote
 * pagination, private ACLs, local drafts/dialogs and offline booking latency.
 * JSX queries/local SQLite, injected bindings and source-editor chart checks
 * retired. Shared write/policy/live checks remain in gate-live; native dataset
 * cell editing/conflicts/row images remain in gate-datasets-in-documents. */
import { fixtureFetch as fetch } from "./lib/fixture-http.mjs";
import { launchChromium } from "./lib/browser.mjs";
import { documentFrame } from "./lib/page-facts.mjs";
import { createChecker } from "./lib/assert.mjs";
import { lane } from "./lib/lane.mjs";
import { startDocument, becomeOwner } from "../lib/start-doc.mjs";
import { connectAgent, connectionBrowserCookie } from "./lib/cli-connection.mjs";
import { datasetPageHtml } from "./lib/native-dataset-page.mjs";
import { localStatePageHtml } from "./lib/native-local-state-page.mjs";
const BASE = process.argv[2] ?? "http://localhost:3030";
const check = createChecker("data-journey");
const browser = await launchChromium();
const contexts = [];
const api = async (token, path, body, method = "POST") => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
  if (!res.ok) throw Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const sharing = async (owner, id, body) => {
  const response = await fetch(`${BASE}/api/my/artifacts/${id}/sharing`, { method: "PUT", headers: { "content-type": "application/json", origin: new URL(BASE).origin, cookie: connectionBrowserCookie(BASE, owner.token) }, body: JSON.stringify(body) });
  if (!response.ok) throw Error("Sharing update refused: " + response.status);
  return response.json();
};
const create = (owner, body) => api(owner.token, "/api/artifacts", { visibility: "unlisted", ...body });
const put = (owner, html) => api(owner.token, `/api/artifacts/${owner.id}`, { html }, "PUT");
const open = async (id, owner, viewport) => {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const page = await context.newPage();
  if (owner) await becomeOwner(page, BASE, owner.token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: "domcontentloaded" });
  return { context, page };
};
const framed = async (page) => {
  const frame = await documentFrame(page);
  await frame.locator('html[data-af-ready="yes"]').waitFor();
  return frame;
};
try {
  await lane(check, "CSV, catalog and GraphQL pagination").run(async () => {
    const owner = await startDocument(BASE);
    const csv = 'month,revenue,zip,note\n2026-01,120,01234,ok\n2026-02,,09876,\n2026-03,190,01234,""';
    const ds = await create(owner, { title: "Q3 Revenue", dataset: csv, columns: [{ name: "zip", type: "string" }] });
    check(Boolean(ds.id) && ds.ref === `ref:${ds.id}`, "dataset publication returns usable ref");
    const { page } = await open(ds.id, owner, { width: 390, height: 844 });
    await page.locator("table tbody tr").nth(2).waitFor();
    check(await page.locator("table tbody tr").count() === 3, "catalog shows all CSV rows");
    const text = await page.locator("table").innerText();
    check(text.includes("01234") && text.includes("09876"), "catalog preserves lexical leading zeros");
    check(text.includes("—"), "catalog renders missing cell distinctly");
    check((await page.getByLabel("Dataset summary").textContent()).includes("3 rows"), "catalog summary reports real row count");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "catalog fits phone width");
    await put(owner, datasetPageHtml(ds.id, { writable: false }));
    await page.goto(`${BASE}/a/${owner.id}`, { waitUntil: "domcontentloaded" });
    let frame = await framed(page);
    check(await frame.locator("#total").textContent() === "rows: 3", "Apollo namespace reads CSV rows");
    const cells = await frame.locator("tbody tr").filter({ hasText: "2026-02" }).locator("td").allTextContents();
    check(cells.includes("09876") && cells.includes("NULL"), "GraphQL preserves typed null and lexical identifier");
    check((await frame.locator("tbody tr").filter({ hasText: "2026-03" }).locator("td").allTextContents()).includes(""), "quoted empty string remains different from typed null");
    const bars = await frame.locator("#chart rect").evaluateAll((nodes) => nodes.map((node) => ({ value: Number(node.dataset.value), height: Number(node.getAttribute("height")) })));
    check(bars.length === 3 && bars.find((b) => b.value === 190)?.height === 180 && bars.find((b) => b.value === 120)?.height > 0, "uploaded numeric values render proportional SVG marks rather than table fallback");
    check((await frame.locator("#chart text").textContent()).includes("190"), "chart labels its quantitative maximum");
    const large = await create(owner, { dataset: Array.from({ length: 205 }, (_, i) => ({ item: `Task ${i + 1}`, amount: i + 1 })) });
    await put(owner, datasetPageHtml(large.id, { writable: false }));
    await page.frameLocator("iframe[data-mx-document-frame]").locator("#total").filter({ hasText: "rows: 205" }).waitFor();
    frame = await framed(page);
    check(await frame.locator("tbody tr").count() === 205, "native page follows every GraphQL cursor beyond 100 rows");
    check(await frame.locator("#source").textContent() === "Complete: 205", "complete count is distinguished from a stored sample");
    check(await frame.locator("tbody tr").filter({ hasText: "Task 205" }).count() === 1, "last remote page reaches the UI");
  });
  await lane(check, "private page and dataset authority").run(async () => {
    const owner = await startDocument(BASE);
    const ds = await create(owner, { dataset: [{ secret: "Owner-only row" }], visibility: "private" });
    await put(owner, datasetPageHtml(ds.id, { writable: false }));
    await sharing(owner, owner.id, { visibility: "private" });
    const stranger = await connectAgent(BASE);
    const anonymous = await fetch(`${BASE}/api/artifacts/${owner.id}`, { headers: { Authorization: `Bearer ${stranger.token}` } });
    check(anonymous.status === 404, "private page uniformly refuses an unrelated authenticated API caller");
    const anonymousSchema = await fetch(`${BASE}/api/artifacts/${owner.id}/graphql`);
    check(anonymousSchema.status === 404, "private GraphQL schema does not leak to anonymous caller");
    const { page } = await open(owner.id, owner);
    const frame = await framed(page);
    check((await frame.locator("tbody").innerText()).includes("Owner-only row"), "original account session reads private page and dataset through isolated frame");
    const email = `mxmx_test_native_reader_${Date.now()}@example.com`;
    const reader = await connectAgent(BASE, { email });
    for (const id of [owner.id, ds.id]) await sharing(owner, id, { shares: [{ email, role: "viewer" }] });
    const shared = await open(owner.id, reader);
    const sharedFrame = await framed(shared.page);
    check((await sharedFrame.locator("tbody").innerText()).includes("Owner-only row"), "invited account reads both explicitly shared private objects");
    await sharing(owner, ds.id, { shares: [] });
    await sharedFrame.locator("#refresh").click();
    try {
      await sharedFrame.locator("#receipt").filter({ hasText: /./ }).waitFor({ timeout: 5e3 });
      check(true, "dataset revocation is rechecked inside an already-open page");
    } catch {
      const result = await shared.page.evaluate(async (id) => {
        const response = await fetch("/api/my/artifacts/" + id);
        return { status: response.status };
      }, ds.id);
      throw Error("Revoked dataset refresh still readable; direct browser status " + result.status);
    }
    ;
  });
  await lane(check, "retained dataset policy editor").run(async () => {
    const owner = await startDocument(BASE);
    const ds = await create(owner, { dataset: [{ choice: "ramen" }], access: "readwrite" });
    await api(owner.token, `/api/artifacts/${ds.id}/policy`, { expectedPolicyRevision: 0, policy: { version: 1, enforcement: "enabled", tables: [{ table: { schema: "public", name: "rows" }, insert_permissions: [] }] } }, "PUT");
    await put(owner, datasetPageHtml(ds.id));
    const email = `mxmx_test_policy_editor_${Date.now()}@example.com`;
    const editor = await connectAgent(BASE, { email });
    await sharing(owner, ds.id, { shares: [{ email, role: "editor" }] });
    const opened = await open(ds.id, editor);
    await opened.page.goto(`${BASE}/a/${ds.id}/edit`, { waitUntil: "domcontentloaded" });
    await opened.page.getByRole("tab", { name: "Data actions", exact: true }).click();
    await opened.page.getByLabel("Allow insert", { exact: true }).check();
    await opened.page.getByLabel("Add insert check condition", { exact: true }).click();
    await opened.page.getByLabel("insert check.1.1 value", { exact: true }).fill('"blocked"');
    await opened.page.getByLabel("Add insert check condition", { exact: true }).click();
    await opened.page.getByLabel("insert check.2.1 operator", { exact: true }).click();
    await opened.page.getByRole("option", { name: "does not equal", exact: true }).click();
    await opened.page.getByLabel("insert check.2.1 value", { exact: true }).fill('"blocked"');
    await opened.page.getByLabel("Remove insert check.1.1 condition", { exact: true }).click();
    check((await opened.page.getByLabel("insert check.1.1 operator", { exact: true }).innerText()).includes("does not equal"), "invited editor can add/remove and renumber real policy conditions");
    await opened.page.getByRole("button", { name: "Save access policies", exact: true }).click();
    await opened.page.getByText("Access policies saved.", { exact: true }).waitFor();
    check(true, "policy editor persists its rules");
    const guest = await open(owner.id);
    const frame = await framed(guest.page);
    await frame.locator("#vote").click();
    await frame.locator("#receipt").filter({ hasText: "committed" }).waitFor();
    check(true, "saved viewer insert policy authorizes the native page mutation");
    await opened.page.getByLabel("Allow insert", { exact: true }).uncheck();
    await opened.page.getByRole("button", { name: "Save access policies", exact: true }).click();
    await opened.page.getByText("Access policies saved.", { exact: true }).waitFor();
    await frame.locator("#vote").click();
    await frame.locator("#receipt").filter({ hasText: /rejected|refused/i }).waitFor();
    check(true, "policy editor revocation stops an already-open anonymous writer");
    await opened.page.reload({ waitUntil: "domcontentloaded" });
    await opened.page.getByRole("tab", { name: "Source & models", exact: true }).click();
    await opened.page.getByLabel("Dataset title", { exact: true }).fill("Updated policy dataset");
    await opened.page.getByLabel("Save dataset", { exact: true }).click();
    await opened.page.getByRole("link", { name: "Edit dataset", exact: true }).waitFor();
    check(!new URL(opened.page.url()).pathname.endsWith("/edit"), "dataset metadata saves through retained editor and returns to reader");
  });
  await lane(check, "local drafts, dialog and booking").run(async () => {
    const owner = await startDocument(BASE);
    await put(owner, localStatePageHtml());
    const first = await open(owner.id);
    const frame = await framed(first.page);
    const second = await open(owner.id);
    const other = await framed(second.page);
    check(await frame.locator("#rows").textContent() === "1", "local draft seed renders");
    await frame.locator("#choice").selectOption("b");
    await frame.locator("#branch").filter({ hasText: "bee" }).waitFor();
    check(true, "Apollo choice drives native conditional UI");
    await frame.locator("#open").click();
    await frame.locator("dialog[open]").waitFor();
    check(await frame.locator("#note").evaluate((el) => el === document.activeElement), "native dialog gives note input focus");
    await frame.locator("#note").fill("Local draft");
    await frame.locator("#save").click();
    await frame.locator("dialog[open]").waitFor({ state: "detached" });
    await frame.locator("#rows").filter({ hasText: "2" }).waitFor();
    check((await frame.locator("#drafts").textContent()).includes("Local draft"), "dialog save appends intended local draft");
    check(await other.locator("#rows").textContent() === "1" && await other.locator("#choice").inputValue() === "a", "another viewer receives neither local edit nor selection");
    await first.page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = await framed(first.page);
    check(await reloaded.locator("#rows").textContent() === "2" && await reloaded.locator("#choice").inputValue() === "b", "viewer drafts and selection survive reload");
    const requests = [];
    first.page.on("request", (request) => requests.push(request.url()));
    await first.context.setOffline(true);
    const latencies = await reloaded.evaluate(async () => {
      const samples = [];
      for (let i = 2; i <= 9; i++) {
        const before = performance.now();
        document.querySelector(`[data-day="Day ${i}"]`).click();
        while (document.querySelector("#day").textContent !== `Day ${i}`) await new Promise((resolve) => requestAnimationFrame(resolve));
        if (i > 3) samples.push(performance.now() - before);
      }
      return samples;
    });
    check(Math.max(...latencies) < 50, `offline day clicks stay below 50ms (${latencies.map(Math.round).join(",")}ms)`);
    check(requests.length === 0, "local booking interactions send no network requests");
    check(await reloaded.locator("#day").textContent() === "Day 9", "local booking remains interactive offline");
    await first.context.setOffline(false);
  });
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
check.done();
