// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../../../src/migration/conversion/compiled/local.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "compiled native Dialog form validates and closes only after durable mutation receipt",
  { skip: !archivedRoot },
  async () => {
    const columns = [{name:'title',type:'string'}];
    const source = '<Helmet><Import name="items" src="ref:Abcd12"/><Value name="title" type="string" default=""/><Value name="dialogOpen" type="boolean" default={false}/><Query name="rows">{`select title from items.rows`}</Query><Mutation name="save">{`insert into items.rows(title) values($title)`}</Mutation></Helmet><Dialog id="d" open="$dialogOpen"><DialogTrigger id="open">Open</DialogTrigger><DialogContent id="content" run="$save" args={{title:"$title"}}><input id="title" aria-label="Title" value="$title" required={true}/><button id="save" type="submit">Save</button></DialogContent></Dialog>';
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
        datasetMutations:[{name:'save',backendNamespace:'legacyData',recoveryScope:'a'.repeat(64),paramTypes:{title:'string'}}],
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
    const row: Record<string, string | null> = {title:'Initial'};
    let generation = 1;
    let canAttempt = true;
    const writes: any[] = [];
    let unknownOnce=false;
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
          row.title = request.variables.params.title;
          generation++;
          if(unknownOnce){unknownOnce=false;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:{legacyData:{mutate:null}},errors:[{message:'Outcome unknown',path:['legacyData','mutate']}],extensions:{outcomes:{'legacyData.mutate':'unknown'}}}));return;}
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
      page.on("console", message=>{if(message.type()==="error" && message.text().includes("[islands]"))errors.push(message.text());});
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
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mx-ready'));
      await page.locator('#open').click();
      await page.locator('#title').waitFor().catch(e=>{throw Error(JSON.stringify(errors)+' '+String(e));});
      await page.waitForFunction(() => !(document.querySelector('#save') as HTMLButtonElement)?.disabled);
      await page.locator('#save').click();
      assert.equal(writes.length,0);
      assert.equal(await page.locator('#content').isVisible(),true);
      await page.locator('#title').fill('Saved title');
      await page.locator('#save').click();
      await page.locator('#content').waitFor({state:'hidden'}).catch(async e=>{throw Error(JSON.stringify({writes,errors,text:await page.locator('body').innerText()})+' '+String(e));});
      assert.equal(writes.length,1);
      assert.equal(writes[0].params.title,'Saved title');
      unknownOnce=true;
      await page.locator('#open').click();
      await page.locator('#title').fill('Unknown title');
      await page.locator('#save').click();
      const reconcile=page.locator('#content').getByRole('button',{name:'Reconcile save'});
      await reconcile.waitFor().catch(async e=>{throw Error(JSON.stringify({writes,errors,text:await page.locator('body').innerText()})+' '+String(e));});
      assert.equal(await page.locator('#content').isVisible(),true);
      assert.equal(writes.length,2);
      await reconcile.click();
      await page.locator('#content').waitFor({state:'hidden'});
      assert.equal(writes.length,3);
      assert.deepEqual(writes[2],writes[1]);
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
