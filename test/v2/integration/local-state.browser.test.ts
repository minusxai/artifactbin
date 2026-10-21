/**
 * Local state belongs to the viewer, against the real server in three
 * engines: two viewers keep different state that survives reloads; one can
 * view what another sees, read-only, and return to their own state unchanged;
 * a comment keeps the commenter's own state; `#af-state=` on the address
 * loads state for one viewer only; and a download from the hosted view
 * carries the downloading viewer's state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit, type Browser, type BrowserType, type FrameLocator, type Page } from "playwright";
import type { CommentsResponse, ContextResponse, PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { readStateFragment, stateUrl } from "../../../src/apollo/state-url.ts";
import { page as pageSource, startServer, type TestServer } from "../support/server.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

/** A filter and an unsent draft: the kind of per-viewer state a page keeps. */
const SOURCE = pageSource(
  `<h1>Errands</h1>
<p id="shown"></p>
<button id="done" type="button">Show done</button>
<input id="text" aria-label="Draft">
<script type="module">
  import { gql, client } from '@afbin/apollo';
  const shown = document.querySelector('#shown');
  const text = document.querySelector('#text');
  client.watchQuery({ query: gql\`{ filter draft }\` }).subscribe(({ data }) => {
    shown.textContent = 'filter: ' + (data.filter ?? 'none') + ' · draft: ' + (data.draft ?? '');
    if (text.value !== (data.draft ?? '')) text.value = data.draft ?? '';
  });
  document.querySelector('#done').onclick = () => client.updateQuery({ query: gql\`{ filter }\` }, () => ({ filter: 'done' }));
  text.oninput = () => client.updateQuery({ query: gql\`{ draft }\` }, () => ({ draft: text.value }));
</script>`,
  `  <script type="application/json" data-af="state">{ "filter": "all" }</script>\n`,
);

async function viewer(browser: Browser, server: TestServer, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(server.origin + "/");
  const status = await page.evaluate(async (address) => {
    const response = await fetch("/api/auth/test-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address, browserSession: true }),
    });
    return response.status;
  }, email);
  assert.equal(status, 200);
  return page;
}
async function open(page: Page, url: string): Promise<FrameLocator> {
  await page.goto(url);
  await page.waitForSelector("html[data-pagegi-startup=ready]", { state: "attached" });
  const frame = page.frameLocator("#pg-frame");
  await frame.locator("#shown").filter({ hasText: "filter:" }).waitFor();
  return frame;
}
const shows = (frame: FrameLocator, text: string) => frame.locator("#shown", { hasText: text }).waitFor();

for (const [name, engine] of engines) {
  test(`${name}: each viewer keeps their own local state; others can view it read-only`, async () => {
    const server = await startServer();
    const browser = await engine.launch();
    try {
      const token = await server.token("ann@example.test");
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: { source: SOURCE, requestId: "local-state-" + name, visibility: "unlisted", linkRole: "commenter" },
        })
      ).json()) as PublishResponse;
      const ann = await viewer(browser, server, "ann@example.test");
      const bob = await viewer(browser, server, "bob@example.test");
      const errors: string[] = [];
      for (const page of [ann, bob])
        page.on("pageerror", (error) => {
          // WebKit reports a platform request cut off by this test's own reloads this way.
          if (!/due to access control checks/.test(error.message)) errors.push(error.message);
        });

      // Two viewers, two states, each starting from the page's seed.
      let a = await open(ann, published.url);
      await shows(a, "filter: all · draft: ");
      await a.locator("#done").click();
      await a.locator("#text").fill("Milk");
      await shows(a, "filter: done · draft: Milk");
      let b = await open(bob, published.url);
      await shows(b, "filter: all · draft: ");
      await b.locator("#text").fill("Bread");
      await shows(b, "filter: all · draft: Bread");
      await ann.waitForTimeout(500);
      await shows(a, "filter: done · draft: Milk");

      // Both persist across reloads.
      a = await open(ann, published.url);
      b = await open(bob, published.url);
      await shows(a, "filter: done · draft: Milk");
      await shows(b, "filter: all · draft: Bread");

      // Bob views what Ann sees: her state, read-only, then returns to his own, unchanged.
      // Preserve the server's answer if a failed capture leaves history hidden.
      // This distinguishes an undelivered click from an expired/not-ready view.
      const captures: number[] = [];
      bob.on("response", (response) => {
        if (response.url().endsWith("/capture"))
          captures.push(response.status());
      });
      await bob.getByRole("button", { name: "View ann@example.test's snapshot" }).click();
      const history = bob.locator("#pg-history");
      await history.waitFor({ state: "visible" }).catch(async error => {
        console.error("Snapshot history did not open", {
          captures,
          status: await bob.locator("#pg-status").textContent(),
          viewers: await bob.locator("#pg-people button").evaluateAll(buttons => buttons.map(button => ({
            label: button.getAttribute("aria-label"),
            sharing: button.getAttribute("aria-description"),
          }))),
        });
        throw error;
      });
      const seen = bob.frameLocator("#pg-history");
      await seen.getByText("filter: done · draft: Milk").waitFor();
      assert.equal(await seen.locator("script").count(), 0, "the view is inert");
      await bob.getByRole("button", { name: "Return", exact: true }).click();
      await history.waitFor({ state: "hidden" });
      b = bob.frameLocator("#pg-frame");
      await shows(b, "filter: all · draft: Bread");
      await shows(a, "filter: done · draft: Milk");

      // Ann's comment keeps her own state, and its context opens exactly that.
      await a.locator("#shown").click({ button: "right" });
      await ann.getByRole("menuitem", { name: "Add comment", exact: true }).click();
      await ann.getByRole("textbox", { name: "Comment text" }).fill("Is this right?");
      await ann.getByRole("button", { name: "Post comment", exact: true }).click();
      await ann.locator('.pg-message[data-sync="saved"]').waitFor();
      const { comments } = (await (await server.request(`/api/files/${published.id}/comments`, { token })).json()) as CommentsResponse;
      const context = (await (
        await server.request(`/api/files/${published.id}/context/${comments[0]!.id}`, { token })
      ).json()) as ContextResponse;
      assert.deepEqual(context.state, { filter: "done", draft: "Milk" });
      assert.deepEqual(readStateFragment(new URL(context.url).hash).state, { filter: "done", draft: "Milk" });

      // State in the address loads for Bob only, leaves the address bar, and stays after a reload.
      b = await open(bob, stateUrl(published.url, { filter: "open", draft: "Eggs" }));
      await shows(b, "filter: open · draft: Eggs");
      assert.equal(new URL(bob.url()).hash, "", "the fragment is removed from the address");
      b = await open(bob, published.url);
      await shows(b, "filter: open · draft: Eggs");
      a = await open(ann, published.url);
      await shows(a, "filter: done · draft: Milk");

      // A download from the hosted view carries the downloading viewer's state.
      await bob.getByRole("button", { name: "Page settings", exact: true }).click();
      const downloading = bob.waitForEvent("download");
      await bob.getByRole("button", { name: "Download HTML" }).click();
      const file = await (await downloading).path();
      const html = readFileSync(file!, "utf8");
      const state = JSON.parse(/data-af="state">([^<]*)</.exec(html)![1]!);
      assert.deepEqual(state, { filter: "open", draft: "Eggs" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
}
