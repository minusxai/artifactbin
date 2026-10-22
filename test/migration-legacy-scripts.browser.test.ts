// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { createMigrationConverter } from "../src/migration/convert.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "historical managed frame runs scoped DOM behavior after source-only normalization",
  { skip: !root },
  async () => {
    const source =
      '<Helmet><title>Frame migration</title></Helmet><p id="outside" class="label">Outside</p><Iframe id="frame"><style>{`body { color: rgb(10, 20, 30); } .label { font-weight: 700; }`}</style><button id="trigger">Change</button><p id="inside" class="label">Inside</p><script id="frame-script">{`document.querySelector("button").addEventListener("click", () => { document.querySelector(".label").textContent = "Changed"; });`}</script></Iframe>';
    const input = {
        source,
        coreUrl: "/af/v1/core.js",
        meta: { title: "Original" },
        document: { retained: source },
      },
      before = JSON.stringify(input);
    const strict = await createMigrationConverter({
      strategy: "archived-functional",
      legacyRoot: root!,
    })(input);
    assert.equal(strict.classification, "manual-blocked");
    assert.equal(strict.sourceNormalization, undefined);
    const result = await createMigrationConverter({
      strategy: "archived-functional",
      sourceAdmission: "offline-prototype",
      legacyRoot: root!,
    })(input);
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.sourceNormalization);
    assert.equal(JSON.stringify(input), before);
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
    const server = createServer((req, res) => {
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
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as any).port}/frame`,
      );
      await page.waitForFunction(
        () =>
          !document.querySelector(
            "[data-migration-author-status]:not([hidden])",
          ),
      );
      for (const id of ["outside", "frame", "trigger", "inside"])
        assert.equal(await page.locator("#" + id).count(), 1);
      await page.locator("#trigger").click();
      await page.waitForFunction(
        () => document.querySelector("#inside")?.textContent === "Changed",
      );
      assert.equal(await page.locator("#outside").textContent(), "Outside");
      assert.equal(
        await page
          .locator("#inside")
          .evaluate((el) => getComputedStyle(el).fontWeight),
        "700",
      );
      assert.notEqual(
        await page
          .locator("#outside")
          .evaluate((el) => getComputedStyle(el).fontWeight),
        "700",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
