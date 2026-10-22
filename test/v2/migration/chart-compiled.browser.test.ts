// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../../../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
for (const templated of [false, true])
  test(
    `whole migrated HTML ${templated ? "templated" : "static"} charts follow a scalar SQL query through core and survive reload`,
    { skip: !root },
    async () => {
      let source = `<Helmet><Value name="amount" type="number" default={2}/><Query name="rows">{\`select $amount as amount, 'Item' as label\`}</Query></Helmet><Button id="change" set={{amount:7}}>Change</Button><Question id="chart" data="$rows" height={240} viz={{kind:"vega-lite",spec:{mark:"bar",encoding:{x:{field:"label",type:"nominal"},y:{field:"amount",type:"quantitative",scale:{domainMin:0,domainMax:10}}}}}}/>`;
      if (templated)
        source = source
          .replace(
            "</Helmet>",
            `<Query name="labels">{\`select case when $amount=2 then 'Initial title' else 'Updated title' end as title, case when $amount=2 then '.0f' else '.2f' end as format\`}</Query></Helmet>`,
          )
          .replace(
            'x:{field:"label",type:"nominal"},y:{field:"amount",type:"quantitative",scale:{domainMin:0,domainMax:10}}',
            'x:{field:"amount",type:"quantitative",title:"{$labels.title}",axis:{format:"{$labels.format}"},scale:{domainMin:0,domainMax:10}},y:{field:"label",type:"nominal"}',
          );
      const result = await compileArchivedLocal(
        {
          source,
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
      assert.ok(result.capabilities.includes("compiled-charts"));
      const core = await readFile(
        new URL("../../../dist/core.js", import.meta.url),
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
        await page
          .locator('#chart [data-mx-chart-state="ready"] svg')
          .waitFor();
        const mark = page.locator("#chart .mark-rect.role-mark path");
        const before = await mark.getAttribute("d");
        if (templated)
          assert.match(
            (await page.locator("#chart svg").textContent()) ?? "",
            /Initial title/,
          );
        await page.getByRole("button", { name: "Change", exact: true }).click();
        await page.waitForFunction(
          (previous) =>
            document
              .querySelector("#chart .mark-rect.role-mark path")
              ?.getAttribute("d") !== previous,
          before,
        );
        if (templated)
          await page.waitForFunction(() =>
            document
              .querySelector("#chart svg")
              ?.textContent?.includes("Updated title"),
          );
        const after = await mark.getAttribute("d");
        assert.notEqual(after, before);
        await page.reload();
        await page
          .locator('#chart [data-mx-chart-state="ready"] svg')
          .waitFor();
        await page.waitForFunction(
          (expected) =>
            document
              .querySelector("#chart .mark-rect.role-mark path")
              ?.getAttribute("d") === expected,
          after,
        );
        assert.equal(
          await page.locator('[data-mx-chart-state="error"]').count(),
          0,
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
