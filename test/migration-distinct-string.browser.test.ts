// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
import { normalizeLegacySourceOperations } from "../src/migration/conversion/source-operations.ts";
const legacyRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "admitted distinct string grouping renders and recomputes after a local table mutation",
  { skip: !legacyRoot },
  async () => {
    const sql =
      "select r.group_id,string_agg(distinct r.label,' | ') labels from entries r where r.enabled=1 group by r.group_id";
    const entries = [
      { group_id: "one", label: "a,b", enabled: 1 },
      { group_id: "one", label: "a,b", enabled: 1 },
      { group_id: "one", label: "c | d", enabled: 1 },
      { group_id: "two", label: null, enabled: 1 },
    ];
    const original =
      '<Helmet><Value name="entries" type="table" value={' +
      JSON.stringify(entries) +
      '}/><Query name="summary">{`' +
      sql +
      '`}</Query><Mutation name="add">{`insert into entries(group_id,label,enabled) values(\'one\',\'later, value\',1)`}</Mutation></Helmet><Button id="add" run="$add">Add</Button><DataTable id="summary" data="$summary"/>';
    const normalized = normalizeLegacySourceOperations(
      original,
      [],
      [
        {
          version: "duckdb-distinct-string-v1",
          sqlSha256: createHash("sha256").update(sql).digest("hex"),
          listExpressions: [],
          numericExpressions: [],
        },
      ],
    );
    const result = await compileArchivedLocal(
      { source: normalized.source, coreUrl: "/af/v1/core.js" },
      { legacyRoot: legacyRoot!, sourceAdmission: "offline-prototype" },
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
      })
    ).outputFiles[0]!.text;
    const server = createServer((req, res) =>
      res
        .writeHead(200, {
          "content-type":
            req.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
        })
        .end(req.url === "/af/v1/core.js" ? core : result.html),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        "http://127.0.0.1:" + (server.address() as any).port + "/proof",
      );
      await page.waitForFunction(() =>
        document
          .querySelector("#summary")
          ?.textContent?.includes("a,b | c | d"),
      );
      assert.equal(
        await page
          .locator("#summary")
          .textContent()
          .then((t) => (t?.match(/a,b/g) ?? []).length),
        1,
      );
      await page
        .locator("#add")
        .click({ timeout: 5000 })
        .catch(async () => {
          throw Error(
            JSON.stringify({
              errors,
              body: await page.locator("body").innerText(),
            }),
          );
        });
      await page.waitForFunction(() =>
        document
          .querySelector("#summary")
          ?.textContent?.includes("a,b | c | d | later, value"),
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
