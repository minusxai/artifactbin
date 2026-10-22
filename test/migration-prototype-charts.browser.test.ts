// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "prototype archived chart controller preserves facet, image and ambient interaction behavior",
  { skip: !root },
  async () => {
    const image =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
      );
    const specs = [
      {
        kind: "vega-lite",
        spec: {
          facet: { column: { field: "group", type: "nominal" } },
          spec: {
            mark: "bar",
            encoding: {
              x: { field: "label", type: "nominal" },
              y: { field: "amount", type: "quantitative" },
            },
          },
        },
      },
      {
        kind: "vega-lite",
        spec: { mark: "image", encoding: { url: { value: image } } },
      },
      {
        kind: "vega",
        spec: {
          width: 200,
          height: 120,
          signals: [
            {
              name: "tracking",
              value: 0,
              on: [{ events: "window:click", update: "tracking+1" }],
            },
          ],
          data: [{ name: "main" }],
          marks: [
            {
              type: "rect",
              encode: {
                update: {
                  x: { value: 0 },
                  y: { value: 0 },
                  width: { value: 100 },
                  height: { value: 100 },
                  fill: { signal: "tracking>0?'red':'blue'" },
                },
              },
            },
          ],
        },
      },
    ];
    const source =
      '<Helmet><Value name="rows" type="table" value={[{label:"A",group:"One",amount:2},{label:"B",group:"Two",amount:4}]}/></Helmet><button id="interact">Interact</button>' +
      specs
        .map(
          (spec, i) =>
            '<Question id="chart' +
            i +
            '" data="$rows" height={240} viz={' +
            JSON.stringify(spec) +
            "}/>",
        )
        .join("");
    const result = await compileArchivedLocal(
      { source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: root!, sourceAdmission: "offline-prototype" },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    const core = await readFile(
      new URL("../dist/core.js", import.meta.url),
      "utf8",
    );
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
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (
          ["http:", "https:"].includes(u.protocol) &&
          u.hostname !== "127.0.0.1"
        )
          external.push(u.protocol);
      });
      await page.goto(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/proof`,
      );
      for (let i = 0; i < 3; i++)
        await page
          .locator("#chart" + i + ' [data-mx-chart-state="ready"] svg')
          .waitFor();
      assert.ok(await page.locator("#chart0 svg .role-mark").count());
      assert.ok(await page.locator("#chart1 svg image").count());
      assert.equal(
        await page
          .locator("#chart2 svg .mark-rect.role-mark path")
          .getAttribute("fill"),
        "blue",
      );
      await page.getByRole("button", { name: "Interact", exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#chart2 svg .mark-rect.role-mark path")
            ?.getAttribute("fill") === "red",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
