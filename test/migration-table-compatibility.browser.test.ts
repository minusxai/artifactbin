// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled tables retain frozen ignored column props and default height while preserving live sorting",
  { skip: !root },
  async () => {
    const source =
      '<Helmet><Value name="rows" type="table" value={[{id:1,name:"Alpha",score:2},{id:2,name:"Beta",score:1}]}/></Helmet><DataTable id="normal" data="$rows" height="auto" columns={[{col:"name",title:"Name",width:"25%"},{col:"score",title:"Score"}]}/><DataTable id="alias" data="$rows" height="100%" columns={[{key:"name",label:"Renamed"}]}/><DataTable id="strings" data="$rows" columns={["name","score"]}/><DataTable id="templated" data="$rows"><Column id="template-name" col="name" title="Template name" width="25%"/></DataTable>';
    const result = await compileArchivedLocal(
      { source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.deepEqual(result.provenance?.compatibility, [
      "default-table-height",
      "ignored-column-width",
      "ignored-column-entry",
    ]);
    const core = await readFile(new URL("../dist/core.js", import.meta.url));
    const server = createServer((req, res) => {
      if (req.url === "/af/v1/core.js")
        res.writeHead(200, { "content-type": "text/javascript" }).end(core);
      else if (req.url === "/")
        res.writeHead(200, { "content-type": "text/html" }).end(result.html);
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (
          ["http:", "https:"].includes(u.protocol) &&
          u.hostname !== "127.0.0.1"
        )
          external.push(u.origin);
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
      );
      await page.locator("html[data-mx-ready]").waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll("#normal tbody tr").length === 2,
      );
      assert.deepEqual(await page.locator("#normal th").allTextContents(), [
        "Name",
        "Score",
      ]);
      assert.equal(
        await page
          .locator("#normal th")
          .first()
          .evaluate((e) => (e as HTMLElement).style.width),
        "",
      );
      assert.equal(
        await page
          .locator('#normal [style*="max-height"]')
          .evaluate((e) => getComputedStyle(e).maxHeight),
        "420px",
      );
      assert.equal(
        await page
          .locator('#alias [style*="max-height"]')
          .evaluate((e) => getComputedStyle(e).maxHeight),
        "420px",
      );
      assert.equal(await page.locator("#alias th").count(), 0);
      assert.equal(await page.locator("#strings th").count(), 0);
      assert.equal(
        await page.locator("#template-name").getAttribute("data-af-id"),
        "template-name",
      );
      assert.equal(
        await page
          .locator("#template-name")
          .evaluate((e) => (e as HTMLElement).style.width),
        "",
      );
      assert.equal(
        await page
          .locator("#normal tbody tr")
          .first()
          .locator("td")
          .first()
          .textContent(),
        "Alpha",
      );
      await page.getByRole("columnheader", { name: "Sort by Score" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#normal tbody tr td")?.textContent === "Beta",
      );
      assert.equal(
        await page
          .getByRole("columnheader", { name: "Sort by Score" })
          .getAttribute("aria-sort"),
        "ascending",
      );
      await page.reload();
      await page.locator("html[data-mx-ready]").waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll("#normal tbody tr").length === 2,
      );
      assert.equal(await page.locator("#alias th").count(), 0);
      assert.equal(
        await page.locator("#normal").getAttribute("data-af-id"),
        "normal",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
