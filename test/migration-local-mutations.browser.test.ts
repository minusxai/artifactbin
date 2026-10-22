// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "native local SQL mutations update viewer tables and queries without backend requests",
  { skip: !root },
  async () => {
    const source =
      '<Helmet><Value name="counter" type="table" value={[{n:0}]}/><Query name="rows">{`select n from counter`}</Query><Mutation name="increment">{`update counter set n=n+1`}</Mutation></Helmet><Button id="increment" run="$increment">Increment</Button><DataTable id="result" data="$rows"><Column col="n"/></DataTable>';
    const result = await compileArchivedLocal(
      { source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: root!, sourceAdmission: "offline-prototype" },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    const strict = await compileArchivedLocal(
      { source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: root! },
    );
    assert.equal(strict.classification, "manual-blocked");
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    let posts = 0;
    const server = createServer((req, res) => {
      if (req.method === "POST") posts++;
      res.setHeader(
        "content-type",
        req.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
      );
      res.end(req.url === "/af/v1/core.js" ? core : result.html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        other = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const url = `http://127.0.0.1:${(server.address() as any).port}/local-proof`;
      await page.goto(url);
      await page.locator("#increment").click();
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("1"),
      );
      await page.locator("#increment").click();
      await page.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("2"),
      );
      await other.goto(url);
      await other.waitForFunction(() =>
        document.querySelector("#result")?.textContent?.includes("0"),
      );
      assert.equal(posts, 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
