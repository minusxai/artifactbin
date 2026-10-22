import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileArchivedLocal } from "../../../src/migration/conversion/compiled/local.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "whole compiled bound User displays fresh cards through core and clears denied or deselected people",
  { skip: !root },
  async () => {
    const result = await compileArchivedLocal(
      {
        coreUrl: "https://platform.example/af/v1/core.js",
        source:
          '<Helmet><Import name="items" src="ref:Abcd12"/><Value name="person" source="ref:Abcd12" column="owner"/><Query name="options">{`select owner as value from items.rows`}</Query></Helmet><Button id="select" set={{person:"usr_selected"}}>Select</Button><Button id="clear" set={{person:null}}>Clear</Button><User id="person" userId="$person" fallback="Choose"/>',
        datasetBindings: [
          {
            name: "items",
            legacyRef: "ref:Abcd12",
            backendNamespace: "legacyData",
            backendHref: "/af/v1/ids/Ab1234",
            mode: "live",
            version: 1,
            tables: [
              {
                schema: "public",
                table: "rows",
                columns: [{ name: "owner", type: "user" }],
              },
            ],
          },
        ],
        boundValueColumns: [
          {
            valueName: "person",
            sourceRef: "ref:Abcd12",
            version: 1,
            bindingName: "items",
            schema: "public",
            table: "rows",
            column: "owner",
            type: "user",
          },
        ],
        personBindings: [
          { valueName: "person", backendNamespace: "legacyData" },
        ],
      },
      { legacyRoot: root! },
    );
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert(result.html);
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
    let denied = false;
    const personRequests: any[] = [];
    const server = createServer(async (req, res) => {
      if (req.url === "/proof")
        return void res
          .writeHead(200, { "content-type": "text/html" })
          .end(result.html);
      if (req.url === "/af/v1/core.js")
        return void res
          .writeHead(200, { "content-type": "text/javascript" })
          .end(core);
      if (req.url === "/deny") {
        denied = true;
        return void res.end("ok");
      }
      if (req.url === "/allow") {
        denied = false;
        return void res.end("ok");
      }
      if (req.url === "/backend") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const request = JSON.parse(body);
        let answer: any;
        if (request.query.includes("person(")) {
          personRequests.push(request.variables);
          answer = denied
            ? { data: { legacyData: null }, errors: [{ message: "Forbidden" }] }
            : {
                data: {
                  legacyData: {
                    person: {
                      name: "Example Person",
                      handle: "alice",
                      image:
                        "/af/v1/ids/Page01/person-images/person/" +
                        "a".repeat(64),
                    },
                  },
                },
              };
        } else
          answer = {
            data: {
              legacyData: {
                read: {
                  version: 1,
                  generation: 0,
                  schema: "public",
                  table: "rows",
                  columns: [{ name: "owner", type: "user" }],
                  rows: [{ owner: "usr_selected" }],
                  offset: 0,
                  nextOffset: null,
                  totalRows: 1,
                },
              },
            },
          };
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(answer));
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route("https://platform.example/af/v1/core.js", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: core,
        }),
      );
      await page.route(
        "https://platform.example/af/v1/design-systems/meridian.css",
        (route) =>
          route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );
      const errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const url = new URL(r.url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          url.hostname !== "127.0.0.1" &&
          r.url() !== "https://platform.example/af/v1/core.js" &&
          r.url() !==
            "https://platform.example/af/v1/design-systems/meridian.css"
        )
          external.push(r.url());
      });
      await page.addInitScript(
        `const __name=f=>f;(${function () {
          Object.defineProperty(globalThis, Symbol.for("afbin.host"), {
            value: {
              viewer: () => ({}),
              subscribeViewer: () => () => {},
              state: (seed: any) => {
                let data =
                  JSON.parse(localStorage.getItem("person-state") || "null") ||
                  seed;
                const listeners = new Set<any>();
                return {
                  read: () => structuredClone(data),
                  subscribe: (f: any) => {
                    listeners.add(f);
                    return () => listeners.delete(f);
                  },
                  write: async (change: any) => {
                    data = { ...data, ...change.next };
                    localStorage.setItem("person-state", JSON.stringify(data));
                    for (const f of listeners) f(data);
                    return {
                      status: "committed",
                      document: data,
                      durable: true,
                    };
                  },
                };
              },
              image: async (_address: string, signal: AbortSignal) => {
                if (signal.aborted) throw Error("Aborted");
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 1;
                return new Promise<Blob>((r) =>
                  canvas.toBlob((blob) => r(blob!), "image/webp"),
                );
              },
              remote: () => ({
                authorizationContext: () => "isolated-person-test",
                online: () => true,
                subscribe: (f: any) => {
                  window.addEventListener("testRemoteChanged", f);
                  return () =>
                    window.removeEventListener("testRemoteChanged", f);
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
      await page.getByText("Choose", { exact: true }).waitFor();
      assert.equal(personRequests.length, 0);
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByText("@alice", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: "@alice", exact: true })
          .getAttribute("href"),
        "https://platform.example/@alice",
      );
      await page.waitForFunction(() =>
        document
          .querySelector('[data-slot="avatar-image"]')
          ?.getAttribute("src")
          ?.startsWith("blob:"),
      );
      await page.reload();
      await page.getByText("@alice", { exact: true }).waitFor();
      await page.evaluate(async () => {
        await fetch("/deny");
        window.dispatchEvent(new Event("testRemoteChanged"));
      });
      await page.getByText("Unknown person", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-slot="avatar-image"]').count(), 0);
      await page.evaluate(async () => {
        await fetch("/allow");
        window.dispatchEvent(new Event("testRemoteChanged"));
      });
      await page.getByText("@alice", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.getByText("Choose", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-slot="avatar-image"]').count(), 0);
      assert(personRequests.length >= 3);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
