/** Native editable dataset journey. Real typed writes, revision conflicts,
 * persistent viewer drafts, pagination and original dataset authorization.
 * JSX DataTable/Select/For virtualization, portals and generated roadmap
 * components retire; native author controls retain the underlying behaviors. */
import { fixtureFetch as fetch } from "./lib/fixture-http.mjs";
import sharp from "sharp";
import { pageHtml } from "../fixtures/page-speed/native.mjs";
import { readDataset } from "./lib/native-dataset-page.mjs";
import { launchChromium, PAGES_HOST } from "./lib/browser.mjs";
import { documentFrame } from "./lib/page-facts.mjs";
import { createChecker } from "./lib/assert.mjs";
import { lane } from "./lib/lane.mjs";
import { startDocument, becomeOwner } from "../lib/start-doc.mjs";
import { connectAgent, connectionBrowserCookie } from "./lib/cli-connection.mjs";
import { editableDatasetPageHtml } from "./lib/native-editable-dataset-page.mjs";
const BASE = process.argv[2] ?? "http://localhost:3030";
const check = createChecker("datasets-in-documents");
const browser = await launchChromium();
const contexts = [];
const api = async (token, path, body, method = "POST") => {
  const response = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 500)}`);
  return response.json();
};
const share = async (owner, id, body) => {
  const response = await fetch(`${BASE}/api/my/artifacts/${id}/sharing`, { method: "PUT", headers: { "content-type": "application/json", origin: new URL(BASE).origin, cookie: connectionBrowserCookie(BASE, owner.token) }, body: JSON.stringify(body) });
  if (!response.ok) throw Error("Sharing: " + response.status);
  return response.json();
};
const open = async (id, owner, viewport = { width: 1400, height: 900 }) => {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const page = await context.newPage();
  if (owner) await becomeOwner(page, BASE, owner.token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: "domcontentloaded" });
  const frame = await documentFrame(page);
  await frame.locator('html[data-af-ready="yes"]').waitFor();
  return { page, frame };
};
const outcome = async (frame) => {
  await frame.locator("#receipt").filter({ hasText: /./ }).waitFor();
  return frame.locator("#receipt").textContent();
};
const imageHtml = (datasetId, initial, tall = false) => pageHtml("Row images", `<link rel="af-dataset" data-af-name="data" href="ref:${datasetId}"><h1>Row images</h1><label>Rows <input id="take" type="number" value="2"></label><label>Reverse <input id="reverse" type="checkbox"></label><label>Selected book <input id="selected" value="0"></label><section aria-label="Selected"></section><section aria-label="Gallery">${initial.map((row) => `<article style="min-height:${tall ? 384 : 90}px"><img src="${row.image}" alt="${row.title}" loading="lazy" width="48" height="64"><h2>${row.title}</h2></article>`).join("")}</section><output id="error"></output>`, `const readDataset=${readDataset.toString()};const query=async(text,variables)=>{const result=await client.query({query:gql(Object.assign([text],{raw:[text]})),variables});if(result.errors?.length)throw Error(result.errors.map(error=>error.message).join('; '));return result.data};
const loaded=await readDataset(query);const cell=value=>value?.[{STRING:'string',NUMBER:'number',BOOLEAN:'boolean',JSON:'json'}[value?.type]];const rows=loaded.rows.map(row=>Object.fromEntries(loaded.table.columns.map(column=>[column.label,cell(row.cells.find(c=>c.columnId===column.id)?.value)]))).sort((a,b)=>Number(a.id)-Number(b.id));
const state=gql\`{take reverse selected}\`;function article(row){const node=document.createElement('article');node.style.minHeight='${tall ? 384 : 90}px';node.dataset.afId='book-'+row.id;const image=document.createElement('img');image.src=row.image;image.alt=row.title;image.loading='lazy';image.width=48;image.height=64;const title=document.createElement('h2');title.textContent=row.title;node.append(image,title);return node}
client.watchQuery({query:state}).subscribe(({data})=>{document.querySelector('#take').value=data.take;document.querySelector('#reverse').checked=data.reverse;document.querySelector('#selected').value=data.selected;const ordered=data.reverse?[...rows].reverse():rows;document.querySelector('[aria-label="Gallery"]').replaceChildren(...ordered.slice(0,data.take).map(article));const selected=rows.find(row=>String(row.id)===data.selected);document.querySelector('[aria-label="Selected"]').replaceChildren(...(selected?[article(selected)]:[]))});
for(const id of ['take','reverse','selected'])document.querySelector('#'+id).oninput=event=>client.updateQuery({query:state},data=>({...data,[id]:id==='take'?Number(event.target.value):id==='reverse'?event.target.checked:event.target.value}));document.documentElement.dataset.afReady='yes';`, { take: tall ? 32 : 2, reverse: false, selected: "0" });
try {
  await lane(check, "typed edits and conflicts").run(async () => {
    const owner = await startDocument(BASE);
    const dataset = await api(owner.token, "/api/artifacts", { dataset: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, item: `Task ${i + 1}`, hours: 2, done: false, tags: '["feature"]' })), visibility: "unlisted", access: "readwrite" });
    await api(owner.token, `/api/artifacts/${owner.id}`, { html: editableDatasetPageHtml(dataset.id) }, "PUT");
    const a = await open(owner.id, owner);
    const b = await open(owner.id, owner);
    check(await a.frame.locator("tbody tr").count() === 500, "500 rows load through complete GraphQL pagination");
    const bMutations = [];
    b.page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/graphql")) {
        try {
          if (/mutation/.test(request.postDataJSON().query)) bMutations.push(request);
        } catch {
        }
      }
    });
    await b.frame.getByLabel("item 1", { exact: true }).fill("My pending draft");
    await a.frame.getByLabel("item 1", { exact: true }).fill("Winner");
    await a.frame.getByRole("button", { name: "Save 1", exact: true }).click();
    check(await outcome(a.frame) === "committed", "owner cell edit commits real dataset row");
    await b.frame.getByRole("button", { name: "Save 1", exact: true }).click();
    check(await outcome(b.frame) === "rejected", "stale reader update reports revision conflict");
    check(await b.frame.getByLabel("item 1", { exact: true }).inputValue() === "My pending draft", "conflict preserves viewer intent");
    check(bMutations.length === 1, "conflicting mutation is sent once without automatic retry");
    await b.page.reload({ waitUntil: "domcontentloaded" });
    b.frame = await documentFrame(b.page);
    await b.frame.locator('html[data-af-ready="yes"]').waitFor();
    check(await b.frame.getByLabel("item 1", { exact: true }).inputValue() === "My pending draft", "unresolved draft survives viewer reload");
    await b.frame.locator("#discard").click();
    await b.frame.waitForFunction(() => document.querySelector('[aria-label="item 1"]')?.value === "Winner");
    check(await b.frame.getByLabel("item 1", { exact: true }).inputValue() === "Winner", "explicit discard reads committed winner");
    await b.frame.getByLabel("hours 1", { exact: true }).fill("12.5");
    await b.frame.getByLabel("tags 1", { exact: true }).fill('["feature","design,ux"]');
    await b.frame.getByLabel("done 1", { exact: true }).check();
    await b.frame.getByRole("button", { name: "Save 1", exact: true }).click();
    check(await outcome(b.frame) === "committed", "number, boolean and serialized JSON selection commit atomically");
    await a.frame.getByLabel("hours 1", { exact: true }).filter({ visible: true }).waitFor();
    await a.frame.waitForFunction(() => document.querySelector('[aria-label="hours 1"]')?.value === "12.5");
    check(await a.frame.getByLabel("done 1", { exact: true }).isChecked(), "other reader sees committed boolean");
    check(JSON.parse(await a.frame.getByLabel("tags 1", { exact: true }).inputValue()).includes("design,ux"), "JSON selection preserves embedded comma");
    await b.frame.getByLabel("item 500", { exact: true }).fill("Last remote row");
    await b.frame.getByRole("button", { name: "Save 500", exact: true }).click();
    check(await outcome(b.frame) === "committed", "last paginated row remains editable");
    await a.frame.waitForFunction(() => document.querySelector('[aria-label="item 500"]')?.value === "Last remote row");
    check(true, "last-row update reaches another open reader");
    const guest = await open(owner.id);
    await guest.frame.getByLabel("item 2", { exact: true }).fill("Forbidden");
    await guest.frame.getByRole("button", { name: "Save 2", exact: true }).click();
    check(/rejected|refused/i.test(await outcome(guest.frame)), "anonymous page reader does not inherit dataset write authority");
    const email = `mxmx_test_cell_editor_${Date.now()}@example.com`;
    const editor = await connectAgent(BASE, { email });
    await share(owner, dataset.id, { shares: [{ email, role: "editor" }] });
    const session = await fetch(`${BASE}/api/page/session`, { headers: { cookie: connectionBrowserCookie(BASE, editor.token) } }).then((response) => response.json());
    await api(owner.token, `/api/artifacts/${dataset.id}/policy`, { expectedPolicyRevision: 0, policy: { version: 2, allow: [{ actions: ["read"], from: { user: "*" } }, { actions: ["update"], from: { user: "$owner" } }, { actions: ["update"], from: { user: session.user.id } }] } }, "PUT");
    const invited = await open(owner.id, editor);
    await invited.frame.getByLabel("item 2", { exact: true }).fill("Editor update");
    await invited.frame.getByRole("button", { name: "Save 2", exact: true }).click();
    check(await outcome(invited.frame) === "committed", "explicit named-user grant authorizes invited account write");
    await api(owner.token, `/api/artifacts/${dataset.id}/policy`, { expectedPolicyRevision: 1, policy: { version: 2, allow: [{ actions: ["read"], from: { user: "*" } }, { actions: ["update"], from: { user: "$owner" } }] } }, "PUT");
    await invited.frame.getByLabel("item 2", { exact: true }).fill("After revoke");
    await invited.frame.getByRole("button", { name: "Save 2", exact: true }).click();
    check(/rejected|refused/i.test(await outcome(invited.frame)), "revoked named grant stops already-open editor");
    await invited.page.setViewportSize({ width: 390, height: 844 });
    check(await invited.frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "native editable table scrolls internally at phone width");
  });
  await lane(check, "row images and lazy bytes").run(async () => {
    const owner = await startDocument(BASE);
    const assets = new URL(BASE);
    assets.hostname = "assets." + PAGES_HOST;
    const image = async (color) => {
      const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: color } }).png().toBuffer();
      const result = await api(owner.token, "/api/artifacts", { image: "data:image/png;base64," + bytes.toString("base64"), visibility: "unlisted" });
      return new URL("/assets/ref/" + result.id, assets).href;
    };
    const urls = await Promise.all(["red", "blue"].map(image));
    const rows = Array.from({ length: 1e3 }, (_, i) => ({ id: String(i), title: i % 2 ? "Blue book" : "Red book", image: urls[i % 2] }));
    const ds = await api(owner.token, "/api/artifacts", { dataset: rows, visibility: "unlisted" });
    await api(owner.token, `/api/artifacts/${owner.id}`, { html: imageHtml(ds.id, rows.slice(0, 2)) }, "PUT");
    const opened = await open(owner.id, owner);
    const gallery = opened.frame.getByLabel("Gallery");
    await opened.frame.waitForFunction(() => [...document.querySelectorAll('[aria-label="Gallery"] img')].every((image2) => image2.naturalWidth > 0));
    check(await gallery.locator("img").count() === 2, "row images decode for initial selected rows");
    await opened.frame.getByLabel("Selected book", { exact: true }).fill("1");
    await opened.frame.getByLabel("Selected").locator('img[alt="Blue book"]').waitFor();
    check(await opened.frame.getByLabel("Selected").locator("img").getAttribute("src") === urls[1], "selection updates matching detail image");
    for (const count of [24, 48, 1e3]) {
      await opened.frame.getByLabel("Rows", { exact: true }).fill(String(count));
      await opened.frame.waitForFunction((count2) => document.querySelectorAll('[aria-label="Gallery"] article').length === count2, count);
      check(true, `native data selection renders ${count} paired rows`);
    }
    const pairs = await gallery.locator("article").evaluateAll((nodes) => nodes.map((node) => ({ title: node.querySelector("h2").textContent, alt: node.querySelector("img").alt, src: node.querySelector("img").getAttribute("src"), lazy: node.querySelector("img").loading })));
    check(pairs.every((pair, i) => pair.title === rows[i].title && pair.alt === pair.title && pair.src === rows[i].image && pair.lazy === "lazy"), "1000 row titles, images and lazy attributes remain paired");
    await opened.frame.getByLabel("Reverse", { exact: true }).check();
    await gallery.locator("img").first().waitFor();
    await opened.frame.waitForFunction(() => document.querySelector('[aria-label="Gallery"] img')?.alt === "Blue book");
    check(true, "reordering preserves row/image identity");
    const guest = await open(owner.id);
    await guest.frame.waitForFunction(() => document.querySelector('[aria-label="Gallery"] img')?.naturalWidth > 0);
    check(true, "signed-out reader decodes permitted row images");
    const captureContext = await browser.newContext();
    contexts.push(captureContext);
    const capture = await captureContext.newPage();
    await capture.goto(`${BASE}/a/${owner.id}/raw?chrome=0`, { waitUntil: "domcontentloaded" });
    await capture.waitForFunction(() => {
      const images = [...document.querySelectorAll('[aria-label="Gallery"] img')];
      return images.length === 2 && images.every((image2) => image2.naturalWidth > 0);
    });
    check(true, "standalone authored HTML retains its public initial image preview without a shared-data connection");
    const distinct = await Promise.all(Array.from({ length: 32 }, async (_, i) => ({ id: String(i), title: "Cover " + i, image: await image({ r: i * 7, g: 32, b: 180 }) })));
    const lazyData = await api(owner.token, "/api/artifacts", { dataset: distinct, visibility: "unlisted" });
    const lazyOwner = await startDocument(BASE);
    await api(lazyOwner.token, `/api/artifacts/${lazyOwner.id}`, { html: imageHtml(lazyData.id, distinct.slice(0, 2), true) }, "PUT");
    const context = await browser.newContext({ viewport: { width: 1e3, height: 700 } });
    contexts.push(context);
    const page = await context.newPage();
    const fetched = /* @__PURE__ */ new Set();
    page.on("request", (request) => {
      if (request.resourceType() === "image" && request.url().includes("/assets/ref/")) fetched.add(request.url());
    });
    await page.goto(`${BASE}/a/${lazyOwner.id}`, { waitUntil: "domcontentloaded" });
    const frame = await documentFrame(page);
    await frame.locator('html[data-af-ready="yes"]').waitFor();
    await frame.waitForFunction(() => document.querySelector('[aria-label="Gallery"] img')?.naturalWidth > 0);
    const initial = fetched.size;
    check.note("Lazy geometry " + JSON.stringify(await frame.evaluate(() => ({ viewport: innerHeight, height: document.documentElement.scrollHeight, last: document.querySelector('[aria-label="Gallery"] article:last-child')?.getBoundingClientRect().top }))));
    check(initial > 0 && initial < 32, `lazy gallery fetches only nearby bytes (${initial}/32)`);
    await frame.getByLabel("Gallery").locator("article").last().scrollIntoViewIfNeeded();
    await frame.waitForFunction(() => [...document.querySelectorAll('[aria-label="Gallery"] img')].at(-1)?.naturalWidth > 0);
    check(fetched.size > initial, "scrolling loads additional image bytes");
  });
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
check.done();
