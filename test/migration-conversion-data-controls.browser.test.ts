// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "migrated Select completes query options beyond the display window and persists its choice",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        source: `<Helmet><Value name="choice" type="number" default={0}/><Value name="items" type="table" value={${JSON.stringify(Array.from({ length: 1201 }, (_, i) => ({ id: i, label: `Option ${i}` })))}}/><Query name="rows">{\`select * from items\`}</Query><Query name="gridRows">{\`select * from items\`}</Query></Helmet><Select id="pick" value="$choice" options="$rows"/><DataTable id="grid" data="$gridRows" height={240}/><p id="selected">{$choice}</p>`,
        coreUrl: "/af/v1/core.js",
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
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1"
        )
          external.push(request.url());
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page.waitForFunction(
        () =>
          document.querySelector("[data-migration-control-status]")
            ?.textContent === "",
      );
      await page.locator('#pick button[aria-haspopup="listbox"]').click();
      await page
        .getByRole("option", { name: "Option 1200", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("#selected")?.textContent?.trim() === "1200",
      );
      await page.waitForFunction(
        () =>
          document.querySelector("[data-migration-control-status]")
            ?.textContent === "",
      );
      await page
        .locator("#grid")
        .getByRole("button", { name: "Load more rows", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('#grid [aria-label="Row count"]')
            ?.textContent === "1,201 of 1,201 rows",
      );
      await page.locator('#grid [aria-label="Sort by id"]').click();
      await page.locator('#grid [aria-label="Sort by id"]').click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#grid tbody tr td")
            ?.textContent?.trim()
            .replaceAll(",", "") === "1200",
      );
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#selected")?.textContent?.trim() === "1200",
      );
      assert.match(await page.locator("#grid").innerText(), /Option/);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
