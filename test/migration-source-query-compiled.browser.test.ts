// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
import { readLegacySourceQuerySites } from "../src/migration/conversion/compiled/source-query-source.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled remote query derives display and re-evaluates local scalar inputs through a named backend",
  { skip: !root },
  async () => {
    const source =
      '<Helmet><Value name="choice" type="string" default="one"/><Query name="rows" source="ref:Abcd12">{`select $choice::text as label`}</Query></Helmet><p id="label">{$rows.label}</p><Button id="change" set={{choice:"two"}}>Change</Button>';
    const site = readLegacySourceQuerySites(source)[0]!,
      columns = [{ name: "label", type: "string" as const }];
    const result = await compileArchivedLocal(
      {
        source,
        coreUrl: "/af/v1/core.js",
        sourceQueries: [
          {
            name: site.name,
            sourceRef: site.sourceRef,
            sqlSha256: site.sqlSha256,
            params: { choice: "string" },
            columns,
            backendNamespace: "legacyData",
            backendHref: "/af/v1/ids/Bk1234",
          },
        ],
      },
      { legacyRoot: root!, sourceAdmission: "offline-prototype" },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
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
    const server = createServer((q, s) =>
      s
        .writeHead(200, {
          "content-type":
            q.url === "/af/v1/core.js" ? "text/javascript" : "text/html",
        })
        .end(q.url === "/af/v1/core.js" ? core : result.html),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        (globalThis as any).__name = (f: any) => f;
        (globalThis as any).__requests = [];
        let allowed = true;
        const listeners = new Set<() => void>();
        (globalThis as any).__revoke = () => {
          allowed = false;
          for (const f of listeners) f();
        };
        (globalThis as any).__allow = () => {
          allowed = true;
          for (const f of listeners) f();
        };
        (globalThis as any)[Symbol.for("afbin.host")] = {
          viewer: () => ({}),
          subscribeViewer: () => () => {},
          state: () => null,
          remote: () => ({
            online: () => true,
            authorizationContext: () => (allowed ? "reader-a" : "denied"),
            subscribe: (f: () => void) => {
              listeners.add(f);
              return () => listeners.delete(f);
            },
            execute: async (r: any) => {
              if (r.query.includes("SourceQueryAvailability"))
                return {
                  data: { legacyData: { sourceQueryAvailability: allowed } },
                };
              if (!allowed)
                return { data: null, errors: [{ message: "denied" }] };
              (globalThis as any).__requests.push(r.variables);
              const values = JSON.parse(r.variables.valuesJson);
              return {
                data: {
                  legacyData: {
                    sourceQuery: JSON.stringify({
                      columns: [{ name: "label", type: "string" }],
                      rows: [{ label: values.choice }],
                      totalRows: 1,
                    }),
                  },
                },
              };
            },
          }),
        };
      });
      await page.goto(
        "http://127.0.0.1:" + (server.address() as any).port + "/proof",
      );
      await page.waitForFunction(
        () => document.querySelector("#label")?.textContent === "one",
      );
      await page.locator("#change").click();
      await page.waitForFunction(
        () => document.querySelector("#label")?.textContent === "two",
      );
      const requests = await page.evaluate(
        () => (globalThis as any).__requests,
      );
      assert.ok(requests.length >= 2);
      assert.deepEqual(JSON.parse(requests.at(-1).valuesJson), {
        choice: "two",
      });
      await page.evaluate(() => {
        (globalThis as any).__revoke();
        if (document.querySelector("#label")?.textContent)
          throw Error("Stale source result after revoke");
      });
      await page.waitForFunction(
        () => document.querySelector("#label")?.textContent === "",
      );
      await page.evaluate(() => (globalThis as any).__allow());
      await page.waitForFunction(
        () => document.querySelector("#label")?.textContent === "two",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
