import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { build } from "esbuild";
for (const engine of [chromium, firefox, webkit])
  test(`${engine.name()}: native select-all excludes collaborator marks and labels`, async () => {
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
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<style>body{padding-top:40px}</style><p data-af-id="p">Reader authored text</p><div id="overlay" data-pagegi-ui aria-hidden="true" style="position:fixed;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none"></div>',
      );
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      await page.evaluate(() => {
        const api = (globalThis as any).selectionAPI;
        const r = document.createRange();
        r.selectNodeContents(document.querySelector("p")!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        const selection = api.captureSelection(document);
        getSelection()!.removeAllRanges();
        api.paintSelections(document.querySelector("#overlay"), [
          { actor: "OTHER READER LABEL", selection },
        ]);
      });
      assert.equal(await page.locator(".pg-selection-label").count(), 1);
      const label = await page.locator(".pg-selection-label").boundingBox();
      const mark = await page.locator(".pg-selection").first().boundingBox();
      assert.ok(label && mark && label.y + label.height <= mark.y);
      if (engine === webkit && process.platform === "linux") {
        // Linux WebKit automation does not select even bare document text with
        // the keyboard shortcut; exercise its native editing command instead.
        assert.equal(
          await page.evaluate(() => document.execCommand("selectAll")),
          true,
        );
      } else {
        await page.keyboard.press("ControlOrMeta+A");
      }
      const selected = await page.evaluate(() => getSelection()!.toString());
      assert.ok(selected.includes("Reader authored text"));
      assert.equal(selected.includes("OTHER READER LABEL"), false);
      assert.equal(
        (
          await page.evaluate(() =>
            (globalThis as any).selectionAPI.captureRenderedDocument(document),
          )
        ).includes("OTHER READER LABEL"),
        false,
      );
      await page.screenshot({
        path: `/tmp/pagegi-selection-${engine.name()}-fixed.png`,
      });
    } finally {
      await browser.close();
    }
  });
