// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../../../src/migration/conversion/compiled/local.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "whole compiled native cells preserve typed drafts, query option pages and durable saves through core",
  { skip: !archivedRoot },
  async () => {
    const columns = ["id", "title", "note", "tags"].map((name) => ({
      name,
      type: "string",
    }));
    columns.push({name:"amount",type:"number"});
    const source = `<Helmet><Import name="items" src="ref:Abcd12"/><Value name="optionRows" type="table" value={${JSON.stringify(Array.from({ length: 350 }, (_, i) => ({ label: "Choice " + i })))}}/><Query name="choices">{\`select label from optionRows order by label\`}</Query><Query name="rows">{\`select id,title,note,tags,amount from items.rows\`}</Query>${["title", "note", "tags", "amount"].map((field) => `<Mutation name="save_${field}" expectedAffected={1}>{\`update items.rows set ${field} = $_value where id = $_row.id\`}</Mutation>`).join("")}</Helmet><DataTable id="table" data="$rows" rowKey="id"><Column col="title"><input id="title" aria-label="Title" type="text" value="$_row.title" run="$save_title"/></Column><Column col="note"><textarea id="note" aria-label="Note" value="$_row.note" run="$save_note"/></Column><Column col="tags"><Select id="tags" label="Tags" value="$_row.tags" run="$save_tags" options="$choices" multiple={true} valueFormat="json" allowCreate={true}/></Column><Column col="amount"><input id="amount" aria-label="Amount" type="number" min={0} max={100} step={1} value="$_row.amount" run="$save_amount"/></Column></DataTable>`;
    const result = await compileArchivedLocal(
      {
        source,
        coreUrl: "/af/v1/core.js",
        datasetBindings: [
          {
            name: "items",
            legacyRef: "ref:Abcd12",
            backendNamespace: "legacyData",
            backendHref: "/af/v1/ids/Bac123",
            mode: "live",
            version: 1,
            tables: [{ schema: "main", table: "rows", columns }],
          },
        ],
        datasetMutations: ["title", "note", "tags", "amount"].map((field) => ({
          name: "save_" + field,
          backendNamespace: "legacyData",
          recoveryScope: "a".repeat(64),
          paramTypes: {},
          rowParams: { id: { param: "row__id", type: "string" } },
          valueParam: { param: "cell__value", type: field==="amount"?"number":"string" },
        })),
      },
      { legacyRoot: archivedRoot! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.ok(result.html);
    const core = (
      await build({
        entryPoints: [
          new URL("../../../src/browser/core/core.ts", import.meta.url)
            .pathname,
        ],
        bundle: true,
        write: false,
        format: "iife",
        target: "es2022",
        minify: true,
      })
    ).outputFiles[0]!.text;
    const row: Record<string, string | number | null> = {
      id: "row-a",
      amount: 1,
      title: "Initial",
      note: "Initial note",
      tags: '["Choice 0"]',
    };
    let generation = 1;
    let canAttempt = true;
    const writes: any[] = [];
    const server = createServer(async (req, res) => {
      if (req.url === "/proof") {
        res.writeHead(200, { "content-type": "text/html" }).end(result.html);
        return;
      }
      if (req.url === "/af/v1/core.js") {
        res.writeHead(200, { "content-type": "text/javascript" }).end(core);
        return;
      }
      if (req.url === "/backend") {
        let text = "";
        for await (const part of req) text += part;
        const request = JSON.parse(text);
        let answer: any;
        if (request.operation === "mutation") {
          writes.push(request.variables);
          const field = request.variables.operation.slice(5);
          row[field] = request.variables.params.cell__value;
          generation++;
          answer = {
            data: {
              legacyData: {
                mutate: { affected: 1, rowCount: 1, version: 1, generation },
              },
            },
            extensions: { outcomes: { "legacyData.mutate": "committed" } },
          };
        } else if (request.query.includes("mutationAvailability"))
          answer = {
            data: {
              legacyData: { mutationAvailability: { canAttempt } },
            },
          };
        else
          answer = {
            data: {
              legacyData: {
                read: {
                  version: 1,
                  generation,
                  schema: "main",
                  table: "rows",
                  columns,
                  rows: [row],
                  offset: 0,
                  nextOffset: null,
                  totalRows: 1,
                },
              },
            },
          };
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(answer));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(20000);
      const errors: string[] = [];
      const external: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1"
        )
          external.push(url.origin);
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(
        `const __name=f=>f;(${function () {
          Object.defineProperty(globalThis, Symbol.for("afbin.host"), {
            value: {
              viewer: () => ({}),
              subscribeViewer: () => () => {},
              state: (seed: any) => {
                let data =
                  JSON.parse(localStorage.getItem("cell-state") || "null") ||
                  seed;
                const listeners = new Set<any>();
                return {
                  read: () => structuredClone(data),
                  subscribe: (f: any) => {
                    listeners.add(f);
                    return () => listeners.delete(f);
                  },
                  write: async (change: any) => {
                    if (
                      Object.entries(change.expected).some(
                        ([k, v]) =>
                          JSON.stringify(data[k]) !== JSON.stringify(v),
                      )
                    )
                      return { status: "conflict", document: data };
                    data = { ...data, ...change.next };
                    localStorage.setItem("cell-state", JSON.stringify(data));
                    for (const f of listeners) f(data);
                    return {
                      status: "committed",
                      document: data,
                      durable: true,
                    };
                  },
                };
              },
              remote: () => ({
                authorizationContext: () => "fixture-owner",
                online: () => true,
                subscribe: (listener: any) => {
                  window.addEventListener("fixture-invalidate", listener);
                  return () =>
                    window.removeEventListener("fixture-invalidate", listener);
                },
                execute: async (request: any) =>
                  fetch("/backend", {
                    method: "POST",
                    body: JSON.stringify(request),
                  }).then((r) => r.json()),
              }),
            },
          });
        }.toString()})()`,
      );
      await page.goto(
        `http://127.0.0.1:${(server.address() as any).port}/proof`,
      );
      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await title.waitFor();
      await page.waitForFunction(
        () =>
          !(
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.disabled,
      );
      await title.fill("Changed");
      await title.press("Enter");
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.value === "Changed" &&
          !(
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.disabled,
      );
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].params, {
        row__id: "row-a",
        cell__value: "Changed",
      });
      const note = page.getByRole("textbox", { name: "Note", exact: true });
      await note.fill("Changed note");
      await note.press("Enter");
      await page.waitForFunction(
        () =>
          !(
            document.querySelector(
              'textarea[aria-label="Note"]',
            ) as HTMLTextAreaElement
          )?.disabled,
      );
      assert.equal(writes.length, 2);
      assert.equal(writes[1].params.cell__value, "Changed note");
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "Search Tags", exact: true })
        .fill("Choice 349");
      await page
        .getByRole("option", { name: "Choice 349", exact: true })
        .click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('button[aria-label="Tags"]')
          ?.textContent?.includes("Choice 349"),
      );
      assert.equal(writes.length, 3);
      assert.deepEqual(JSON.parse(writes[2].params.cell__value), [
        "Choice 0",
        "Choice 349",
      ]);
      await page.reload();
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.value === "Changed",
      );
      await title.fill("Unsaved draft");
      canAttempt = false;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("fixture-invalidate")),
      );
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.disabled,
      );
      assert.equal(await title.inputValue(), "Unsaved draft");
      assert.equal(writes.length, 3);
      canAttempt = true;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("fixture-invalidate")),
      );
      await page.waitForFunction(
        () =>
          !(
            document.querySelector(
              'input[aria-label="Title"]',
            ) as HTMLInputElement
          )?.disabled,
      );
      assert.equal(await title.inputValue(), "Unsaved draft");
      await title.press("Escape");
      assert.equal(await title.inputValue(), "Changed");
      assert.equal(writes.length, 3);
      const amount=page.getByRole("spinbutton",{name:"Amount",exact:true});
      assert.equal(await amount.getAttribute("min"),"0");assert.equal(await amount.getAttribute("max"),"100");assert.equal(await amount.getAttribute("step"),"1");
      await amount.fill("-1");await amount.press("Enter");
      assert.equal(await amount.evaluate((input:HTMLInputElement)=>input.validity.rangeUnderflow),true);assert.equal(writes.length,3);
      await amount.fill("6");await amount.press("Enter");
      await page.waitForFunction(()=>!(document.querySelector('input[aria-label="Amount"]') as HTMLInputElement)?.disabled);
      assert.equal(writes.length,4);assert.equal(writes[3].params.cell__value,6);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
