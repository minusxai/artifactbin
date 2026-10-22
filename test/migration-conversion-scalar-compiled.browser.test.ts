// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled numeric segmented, switch and slider controls preserve typed viewer state on reload",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        source:
          '<Helmet><Value name="mode" type="string" default="a"/><Value name="enabled" type="boolean" default={false}/><Value name="amount" type="number" default={2}/><Value name="optional" type="number" default={null}/><Query name="rows">{`select $amount as amount`}</Query></Helmet><Segmented id="segments" value="$mode" options={["a","b"]}/><Switch id="switch" checked="$enabled" label="Enabled"/><Segmented id="numeric" value="$amount" options={[{value:2,label:"Two"},{value:5,label:"Five"}]}/><Segmented id="nullable" value="$optional" options={[{value:3,label:"Three"}]}/><p id="optional">{$optional}</p><Slider id="slider" value="$amount" min={0} max={10} step={1} label="Amount"/><p id="selected">{$mode}</p><p id="amount">{$amount}</p>',
        coreUrl: "/af/v1/core.js",
      },
      { legacyRoot: root!, sourceAdmission: "offline-prototype" },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.html);
    const core = (
      await build({
        entryPoints: ["src/browser/core/core.ts"],
        bundle: true,
        write: false,
        format: "iife",
        target: "es2022",
        minify: true,
        legalComments: "none",
      })
    ).outputFiles[0]!.text;
    const server = createServer((request, response) => {
      if (request.url === "/af/v1/core.js")
        response
          .writeHead(200, { "content-type": "text/javascript" })
          .end(core);
      else
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (
          ["http:", "https:"].includes(u.protocol) &&
          u.hostname !== "127.0.0.1"
        )
          external.push(r.url());
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      await page
        .locator("#segments")
        .getByRole("button", { name: "b", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#selected")?.textContent === "b",
      );
      await page
        .locator("#numeric")
        .getByRole("button", { name: "Five", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#amount")?.textContent === "5",
        undefined,
        { timeout: 2000 },
      );
      await page
        .locator("#nullable")
        .getByRole("button", { name: "Three", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#optional")?.textContent === "3",
      );
      await page
        .locator("#nullable")
        .getByRole("button", { name: "All", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#optional")?.textContent === "",
      );
      await page.getByRole("switch", { name: "Enabled" }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked") === "true",
      );
      await page
        .getByRole("slider", { name: "Amount" })
        .evaluate((input: HTMLInputElement) => {
          input.value = "7";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await page.waitForFunction(
        () => document.querySelector("#amount")?.textContent === "7",
      );
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#selected")?.textContent === "b" &&
          document.querySelector("#amount")?.textContent === "7" &&
          document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked") === "true",
      );
      assert.equal(
        await page.getByRole("slider", { name: "Amount" }).inputValue(),
        "7",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
