import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled tabs use roving keyboard focus and controlled dialogs persist through Apollo",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        coreUrl: "/af/v1/core.js",
        source: `<Helmet><Value name="settingsOpen" type="boolean" default={false}/></Helmet>
  <Tabs id="tabs" defaultValue="first"><TabsList id="tabs-list" variant="line"><TabsTrigger id="first-tab" value="first">First</TabsTrigger><TabsTrigger id="disabled-tab" value="disabled" disabled>Unavailable</TabsTrigger><TabsTrigger id="last-tab" value="last">Last</TabsTrigger></TabsList><TabsContent id="first-panel" value="first"><p id="first-text">First panel</p></TabsContent><TabsContent id="disabled-panel" value="disabled">Unavailable panel</TabsContent><TabsContent id="last-panel" value="last"><p id="last-text">Last panel</p></TabsContent></Tabs>
  <Tabs id="vertical-tabs" defaultValue="top" orientation="vertical"><TabsList id="vertical-list"><TabsTrigger id="top-tab" value="top">Top</TabsTrigger><TabsTrigger id="bottom-tab" value="bottom">Bottom</TabsTrigger></TabsList><TabsContent id="top-panel" value="top">Top panel</TabsContent><TabsContent id="bottom-panel" value="bottom">Bottom panel</TabsContent></Tabs>
  <Dialog id="dialog" open="$settingsOpen"><DialogTrigger id="dialog-trigger">Open settings</DialogTrigger><DialogContent id="dialog-content" aria-labelledby="dialog-title"><h2 id="dialog-title">Settings</h2><input id="name" aria-label="Name"/><DialogClose id="dialog-close">Done</DialogClose></DialogContent></Dialog>`,
      },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.html);
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((request, response) => {
      if (request.url === "/af/v1/core.js")
        response
          .writeHead(200, { "content-type": "text/javascript" })
          .end(core);
      else if (request.url === "/proof")
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1"
        )
          external.push(url.origin);
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page.locator("html[data-mx-ready]").waitFor();
      assert.equal(await page.locator("#first-panel").isVisible(), true);
      assert.equal(await page.locator("#last-panel").isVisible(), false);
      assert.equal(await page.locator("#last-text").count(), 1);
      await page.locator("#first-tab").focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        () =>
          document.activeElement?.id === "last-tab" &&
          document.querySelector("#last-tab")?.getAttribute("aria-selected") ===
            "true",
      );
      assert.equal(await page.locator("#last-panel").isVisible(), true);
      assert.equal(await page.locator("#first-panel").isVisible(), false);
      assert.equal(
        await page.locator("#last-tab").getAttribute("aria-controls"),
        "last-panel",
      );
      assert.equal(
        await page.locator("#last-panel").getAttribute("aria-labelledby"),
        "last-tab",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .locator("#first-tab")
          .evaluate((node) => document.activeElement === node),
        true,
      );
      await page.keyboard.press("End");
      assert.equal(
        await page
          .locator("#last-tab")
          .evaluate((node) => document.activeElement === node),
        true,
      );
      await page.keyboard.press("Home");
      assert.equal(
        await page
          .locator("#first-tab")
          .evaluate((node) => document.activeElement === node),
        true,
      );
      assert.equal(
        await page.locator("#disabled-tab").getAttribute("aria-selected"),
        "false",
      );
      await page.locator("#top-tab").focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () =>
          document.activeElement?.id === "bottom-tab" &&
          document
            .querySelector("#bottom-tab")
            ?.getAttribute("aria-selected") === "true",
      );
      assert.equal(await page.locator("#bottom-panel").isVisible(), true);
      await page.keyboard.press("ArrowUp");
      assert.equal(
        await page
          .locator("#top-tab")
          .evaluate((node) => document.activeElement === node),
        true,
      );
      assert.equal(
        await page.locator("#vertical-list").getAttribute("aria-orientation"),
        "vertical",
      );
      const savedOpen = () =>
        page.evaluate(async () => {
          const { client, gql } = await import(String("@afbin/apollo"));
          const result = await client.query({
            query: gql`
              {
                compiledPage
              }
            `,
          });
          return (result.data.compiledPage as { settingsOpen: boolean })
            .settingsOpen;
        });
      await page.locator("#dialog-trigger").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
            true && document.activeElement?.id === "name",
      );
      assert.equal(await savedOpen(), true);
      await page.locator("#dialog-close").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
            false && document.activeElement?.id === "dialog-trigger",
      );
      assert.equal(await savedOpen(), false);
      await page.evaluate(async () => {
        const { client, gql } = await import(String("@afbin/apollo"));
        await client.updateQuery(
          {
            query: gql`
              {
                compiledPage
              }
            `,
          },
          (data: Record<string, any>) => ({
            ...data,
            compiledPage: { ...data.compiledPage, settingsOpen: true },
          }),
        );
      });
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
          true,
      );
      await page.reload();
      await page.locator("html[data-mx-ready]").waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
            true && document.activeElement?.id === "name",
      );
      assert.equal(await savedOpen(), true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLDialogElement>("#dialog-content")?.open ===
          false,
      );
      assert.equal(await savedOpen(), false);
      await page.reload();
      await page.locator("html[data-mx-ready]").waitFor();
      assert.equal(
        await page
          .locator("#dialog-content")
          .evaluate((node) => (node as HTMLDialogElement).open),
        false,
      );
      assert.equal(await savedOpen(), false);
      for (const id of [
        "tabs",
        "tabs-list",
        "first-tab",
        "last-tab",
        "first-panel",
        "last-panel",
        "dialog",
        "dialog-content",
      ])
        assert.equal(
          await page.locator(`#${id}`).getAttribute("data-af-id"),
          id,
        );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
