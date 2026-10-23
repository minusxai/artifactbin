import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build } from "esbuild";
import { createHistoricalDatasetReplay } from "../src/datasets/history.ts";

test("historical dataset snapshot displays escaped archived rows in the existing inert saved-view frame", async () => {
  const html = await createHistoricalDatasetReplay({
    resolve: async () => ({
      kind: "ready",
      context: {
        pageId: "Page01",
        backendId: "Back01",
        backendVersion: "b",
        subject: null,
      },
      binding: "data",
      version: 1,
      tables: [{ schema: "main", name: "items" }],
    }),
    read: async () => ({
      version: 1,
      generation: 1,
      schema: "main",
      table: "items",
      columns: [{ name: "name", type: "string" }],
      rows: [{ name: "Archived row <img src=x onerror=alert(1)>" }],
      offset: 0,
      nextOffset: 1,
      totalRows: 105,
    }),
  }).render("Page01", 1, null);
  const bundle = await build({
    stdin: {
      contents:
        'import {createDocumentView} from "./src/browser/document-view.ts";import {assembleStaticReplay,mountStaticReplay} from "./src/browser/replay.ts";globalThis.historyTest={createDocumentView,assembleStaticReplay,mountStaticReplay};',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let requests = 0;
    page.on("request", () => requests++);
    await page.addScriptTag({
      content:
        "globalThis.__name=(value)=>value;" + bundle.outputFiles[0]!.text,
    });
    await page.evaluate((rendered) => {
      const api = (globalThis as any).historyTest;
      const source =
        '<p>Loading data…</p><script>fetch("https://example.test/write",{method:"POST"})</script>';
      const view = api.createDocumentView({
        source,
        revision: "saved",
        contextOnly: true,
        snapshot: {
          schema: 0,
          sourceRevision: "saved",
          state: {},
          view: { x: 0, y: 0 },
          rendered,
        },
        contexts: {
          cached: () => ({}),
          comment: async () => null,
          viewer: async () => null,
        },
        surface: {
          mount: (
            _source: string,
            snapshot: any,
            _revision: string,
            historical: boolean,
          ) => {
            if (!historical) throw Error("must remain historical");
            const frame = api.mountStaticReplay(
              document.body,
              api.assembleStaticReplay(snapshot.rendered, null, source),
            );
            frame.id = "pg-history";
          },
          suspend: () => {},
        },
        activity: { suspend: () => {}, resume: () => {} },
        changed: () => {},
      });
      view.start();
    }, html);
    const frame = page.frameLocator("#pg-history");
    await frame.locator("tbody tr").waitFor();
    assert.equal(await frame.locator("tbody tr").count(), 1);
    assert.match(
      await frame.locator("body").innerText(),
      /Archived row <img src=x onerror=alert\(1\)>/,
    );
    assert.match(
      await frame.locator("body").innerText(),
      /Showing 1 of 105 rows/,
    );
    assert.equal(await page.locator("#pg-history").getAttribute("sandbox"), "");
    assert.equal(await frame.locator("script,img,button,form,link").count(), 0);
    assert.equal(requests, 0);
  } finally {
    await browser.close();
  }
});
