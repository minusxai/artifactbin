/**
 * A downloaded page used on its own, with its server gone: opened from disk
 * it keeps its state across reloads, saves itself again with the current
 * state from its one control, carries no credentials, and its backend calls
 * settle offline. (With the server reachable it shows the platform bar
 * instead; see local-connect.browser.test.ts.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type BrowserType, type Page } from "playwright";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { compileOnlyHost, publishTodo } from "../support/todo.ts";
import { startServer } from "../support/server.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
/** A backend mutation called once on load, added to the downloaded file. */
const withMutation = (html: string) =>
  html.replace(
    "</head>",
    `  <script type="module">
    import { gql, client } from '@afbin/apollo';
    const result = await client.mutate({ mutation: gql\`mutation { team { add(text: "x") { id } } }\` });
    document.documentElement.dataset.outcome = result.extensions?.outcomes?.['team.add'] ?? 'none';
  </script>
</head>`,
);

const items = (page: Page) => page.locator("#list li span").allTextContents();
/** Legacy local mirrors may still be in older downloads; they never substitute for shared backend results. */
const STALE_LOCAL_ROWS = [
  { id: "1", text: "Milk", done: false },
  { id: "2", text: "Bread", done: true },
];

for (const [name, engine] of engines) {
  test(`${name}: a downloaded page keeps its state across reloads and saves itself again`, async () => {
    const server = await startServer({ backendHost: compileOnlyHost() });
    const browser = await engine.launch();
    const dir = mkdtempSync(join(tmpdir(), "af-download-"));
    try {
      const token = await server.token("owner@example.test");
      const published: PublishResponse = await publishTodo(server, token, { requestId: "download-" + name });
      const download = await server.request(`/af/v1/ids/${published.id}?download=1`, { token });
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
      const html = await download.text();
      assert.ok(!html.includes(token), "the account token never enters the file");
      const file = join(dir, "todo.html");
      // A legacy download has stale mirrored rows alongside the viewer's actual draft and filter.
      writeFileSync(
        file,
        withMutation(html).replace(/data-af="state">[^<]*</, `data-af="state">${JSON.stringify({ todos: STALE_LOCAL_ROWS, filter: "done", draft: "Unsent draft" })}<`),
      );
      // The file names its server; from here on that server is unreachable.
      assert.match(html, new RegExp(`data-af-server="${server.origin}"`));
      await server.close();

      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(file).href);
      await page.locator("html[data-outcome]").waitFor({ state: "attached" });
      assert.equal(await page.locator("html").getAttribute("data-outcome"), "offline", "backend calls settle offline");
      await page.getByText("Shared list unavailable. Connect or check your access.").waitFor();
      assert.deepEqual(await items(page), [], "offline downloads cannot present stale local mirrors as shared data");
      await page.locator('#filters button[data-filter="done"][aria-pressed="true"]').waitFor();
      assert.equal(await page.inputValue("#text"), "Unsent draft");
      await page.click('#filters button[data-filter="open"]');
      await page.fill("#text", "Eggs");
      await page.reload();
      await page.locator('#filters button[data-filter="open"][aria-pressed="true"]').waitFor();
      await page.getByText("Shared list unavailable. Connect or check your access.").waitFor();
      assert.deepEqual(await items(page), [], "a reload keeps shared data unavailable");
      assert.equal(await page.inputValue("#text"), "Eggs");

      // The one control saves the page with its current state.
      const control = page.getByRole("button", { name: "Download page" });
      const saved = page.waitForEvent("download");
      await control.click();
      const savedFile = join(dir, "saved.html");
      await (await saved).saveAs(savedFile);
      const again = readFileSync(savedFile, "utf8");
      assert.match(again, /^<!DOCTYPE html>/i);
      const savedState = JSON.parse(/data-af="state">([^<]*)</.exec(again)![1]!);
      assert.deepEqual(savedState, { todos: STALE_LOCAL_ROWS, filter: "open", draft: "Eggs" });
      assert.equal((again.match(/<script type="importmap"/g) ?? []).length, 0, "the core's import map is not saved");
      assert.equal((again.match(/data-af="core"/g) ?? []).length, 1);
      assert.ok(!again.includes("<af-download"), "the control is not part of the page");

      // Opened fresh (no browser storage), the saved file starts from its saved state.
      const fresh = await browser.newContext();
      const reopened = await fresh.newPage();
      await reopened.goto(pathToFileURL(savedFile).href);
      await reopened.locator('#filters button[data-filter="open"][aria-pressed="true"]').waitFor();
      await reopened.getByText("Shared list unavailable. Connect or check your access.").waitFor();
      assert.deepEqual(await items(reopened), [], "reopening cannot expose stale local mirrors");
      assert.equal(await reopened.inputValue("#text"), "Eggs");
      await fresh.close();
      await context.close();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
