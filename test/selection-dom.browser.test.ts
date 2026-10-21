import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { build } from "esbuild";
test("native DOM selection overlays preserve selection across layouts, scrolling, stale content and mobile", async () => {
  const bundle = await build({
    stdin: {
      contents:
        'import {captureSelection,paintSelections} from "./src/browser/selection-presence.ts";import {captureRenderedDocument} from "./src/browser/replay.ts";globalThis.selectionAPI={captureSelection,paintSelections,captureRenderedDocument};',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({
      viewport: { width: 1100, height: 700 },
    });
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 640 },
      isMobile: true,
      hasTouch: true,
    });
    const pages = await Promise.all([desktop.newPage(), mobile.newPage()]);
    for (const page of pages) {
      await page.setContent(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>article{max-width:600px;font:24px sans-serif}#space{height:900px}</style><article data-af-id="article"><p data-af-id="p">One <b>bold phrase</b> followed by <em>more words</em> and a final sentence that wraps on smaller screens.</p><ul><li>First item</li><li>Second item</li></ul><table><tr><td>Table cell</td></tr></table></article><div id="space"></div><div data-af-id="private"><input type="password" value="secret">private field</div><div id="overlay" data-pagegi-ui aria-hidden="true" style="position:fixed;inset:0;pointer-events:none;user-select:none"></div>',
      );
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    }
    const [sender, reader] = pages;
    const payload = await sender.evaluate(() => {
      const p = document.querySelector("p")!;
      const r = document.createRange();
      r.setStart(p, 1);
      r.setEnd(p, 4);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return (globalThis as any).selectionAPI.captureSelection(document);
    });
    assert.ok(payload);
    assert.equal(JSON.stringify(payload).includes("bold"), false);
    await sender.evaluate(
      (payload) =>
        (globalThis as any).selectionAPI.paintSelections(
          document.querySelector("#overlay"),
          [{ actor: "Other reader", selection: payload }],
        ),
      payload,
    );
    const paragraph = await sender.locator("p").boundingBox();
    assert.ok(paragraph);
    await sender.mouse.move(paragraph.x + 2, paragraph.y + 12);
    await sender.mouse.down();
    await sender.mouse.move(paragraph.x + 200, paragraph.y + 12, { steps: 12 });
    await sender.mouse.up();
    assert.ok(
      (await sender.evaluate(() => getSelection()!.toString())).length > 0,
    );
    assert.ok(await sender.locator(".pg-selection").count());
    const paint = async (value: unknown) =>
      reader.evaluate((value) => {
        const api = (globalThis as any).selectionAPI;
        api.paintSelections(document.querySelector("#overlay"), [
          { actor: "Reader", selection: value },
        ]);
        return document.querySelectorAll(".pg-selection").length;
      }, value);
    await reader.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("li")!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    const own = await reader.evaluate(() => getSelection()!.toString());
    const marks = await paint(payload);
    assert.ok(marks > 0);
    assert.equal(
      await paint({ ranges: [...payload.ranges, ...payload.ranges] }),
      marks,
    );

    assert.equal(await reader.evaluate(() => getSelection()!.toString()), own);
    assert.equal(
      await reader
        .locator(".pg-selection")
        .first()
        .evaluate((el) => getComputedStyle(el).pointerEvents),
      "none",
    );
    const rendered = await reader.evaluate(() =>
      (globalThis as any).selectionAPI.captureRenderedDocument(document),
    );
    assert.equal(rendered?.includes("pg-selection"), false);
    assert.equal(rendered?.includes("Reader"), false);
    assert.equal(
      await reader.locator("#overlay").getAttribute("aria-hidden"),
      "true",
    );
    const spanning = await sender.evaluate(() => {
      const r = document.createRange();
      r.setStart(document.querySelector("p")!.firstChild!, 1);
      r.setEnd(document.querySelector("td")!.firstChild!, 5);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      return (globalThis as any).selectionAPI.captureSelection(document);
    });
    assert.equal(spanning.ranges[0].nodeId, "article");
    assert.ok((await paint(spanning)) > 0);
    assert.equal(await reader.evaluate(() => getSelection()!.toString()), own);
    await reader.evaluate(() => scrollTo(0, 800));
    assert.equal(await paint(payload), 0);
    await reader.evaluate(() => scrollTo(0, 0));
    assert.ok((await paint(payload)) > 0);
    await reader.evaluate(
      () => (document.querySelector("b")!.textContent = "other words"),
    );
    assert.equal(await paint(payload), 0);
    await reader.evaluate(
      () => (document.querySelector("b")!.textContent = "bold phrase"),
    );
    assert.ok((await paint(payload)) > 0);
    await reader.evaluate(() =>
      document.body.append(document.querySelector("p")!.cloneNode(true)),
    );
    assert.equal(await paint(payload), 0);
    await sender.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector("[data-af-id=private]")!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    assert.equal(
      await sender.evaluate(() =>
        (globalThis as any).selectionAPI.captureSelection(document),
      ),
      null,
    );
    assert.equal(await paint(null), 0);
  } finally {
    await browser.close();
  }
});

test("ordinary sibling paragraphs split native selections across stable anchors without including private fields", async () => {
  const bundle = await build({
    stdin: {
      contents:
        'import {captureSelection,paintSelections} from "./src/browser/selection-presence.ts";globalThis.selectionAPI={captureSelection,paintSelections};',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<p data-af-id="first">First <strong>paragraph</strong></p>\n<p data-af-id="second">Second paragraph</p><div id="overlay" data-pagegi-ui></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const capture = () =>
      page.evaluate(() => {
        const r = document.createRange();
        r.setStart(document.querySelector("p")!.firstChild!, 2);
        r.setEnd(document.querySelectorAll("p")[1]!.firstChild!, 6);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return (globalThis as any).selectionAPI.captureSelection(document);
      });
    const selection = await capture();
    assert.deepEqual(
      selection?.ranges.map((r: any) => r.nodeId),
      ["first", "second"],
    );
    assert.deepEqual(
      selection.ranges.map((r: any) => [r.start, r.end]),
      [
        [2, 15],
        [0, 6],
      ],
    );
    await page.evaluate(
      (value) =>
        (globalThis as any).selectionAPI.paintSelections(
          document.querySelector("#overlay"),
          [{ actor: "Other reader", selection: value }],
        ),
      selection,
    );
    assert.ok(await page.locator(".pg-selection").count());
    const entirePage = await page.evaluate(() => {
      document
        .querySelector("#overlay")!
        .append(document.createTextNode("PLATFORM LABEL"));
      const r = document.createRange();
      r.selectNodeContents(document.body);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      return (globalThis as any).selectionAPI.captureSelection(document);
    });
    assert.deepEqual(
      entirePage.ranges.map((range: any) => range.nodeId),
      ["first", "second"],
    );
    await page.evaluate(() =>
      document
        .querySelector("p")!
        .insertAdjacentHTML(
          "afterend",
          '<input type="password" value="secret">',
        ),
    );
    assert.equal(await capture(), null);
  } finally {
    await browser.close();
  }
});
