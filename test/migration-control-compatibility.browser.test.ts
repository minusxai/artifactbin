// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "archived Select JSON multi-select persists and ignored run/title/width/pair choices keep frozen behavior",
  { skip: !root },
  async () => {
    const source =
      '<Helmet><Value name="choice" type="string" default="[]"/><Value name="pair" type="string"/><Value name="rows" type="table" value={[{id:1,score:7}]}/></Helmet><h1 id="outside">Control proof</h1><Select id="multi" value="$choice" options={["a","b"]} multiple allowCreate valueFormat="json" run="$neverCalled"/><p id="chosen">{$choice}</p><Select id="pair" value="$pair" options={[["x","Label X"],["y","Label Y"]]}/><DataTable id="grid" data="$rows" rowKey="id" title="Ignored title"><Column id="score" col="score" width="160px"/></DataTable>';
    const result = await compileArchivedLocal(
      { source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert(result.html);
    assert.deepEqual(
      new Set(result.provenance?.compatibility),
      new Set([
        "ignored-select-run",
        "ignored-select-value-format",
        "ignored-select-allow-create",
        "empty-select-pair-options",
        "ignored-column-width",
        "ignored-table-title",
      ]),
    );
    const core = await readFile(new URL("../dist/core.js", import.meta.url));
    const server = createServer((req, res) =>
      res
        .writeHead(200, {
          "content-type":
            req.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
        })
        .end(req.url === "/af/v1/core.js" ? core : result.html),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const origin = "http://127.0.0.1:" + (server.address() as any).port;
      await page.route("**/*", (route) => {
        if (
          route.request().url().startsWith(origin) ||
          route.request().url().startsWith("data:")
        )
          return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin);
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute("data-mx-ready"),
      );
      await page.locator('#multi button[aria-haspopup="listbox"]').click();
      await page.getByRole("option", { name: "a", exact: true }).click();
      await page.getByRole("option", { name: "b", exact: true }).click();
      await page.getByRole("searchbox").fill("custom");
      await page.getByText("No matches", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("option", { name: "Create custom", exact: true })
          .count(),
        0,
      );
      await page.locator("#outside").click();
      await page.waitForFunction(
        () => document.querySelector("#chosen")?.textContent === '["a","b"]',
      );
      await page.reload();
      await page.waitForFunction(
        () => document.querySelector("#chosen")?.textContent === '["a","b"]',
      );
      await page.locator('#pair button[aria-haspopup="listbox"]').click();
      assert.equal(await page.getByRole("option").count(), 2);
      assert.deepEqual(await page.getByRole("option").allTextContents(), [
        "",
        "",
      ]);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#grid").getAttribute("title"), null);
      assert.equal(
        await page
          .locator("#score")
          .evaluate((el) => (el as HTMLElement).style.width),
        "",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
