import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { build } from "esbuild";
for (const engine of [chromium, firefox, webkit])
  test(`${engine.name()}: selection marks and labels remain inside nested scroll clipping axes`, async () => {
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
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 600 },
      });
      await page.setContent(
        '<style>body{margin:30px}#vertical{height:32px;width:450px;overflow-y:auto;border:3px solid;margin-top:50px}#horizontal{width:170px;overflow-x:hidden}p{font:24px/30px sans-serif;margin:0;width:500px;white-space:nowrap}</style><div id="vertical"><div id="horizontal"><p data-af-id="text">A very long visible first line<br>Second line that must be clipped<br>Third hidden line<br>Fourth hidden line</p></div></div><p>Unrelated content below the scroll panel</p><div id="overlay" data-pagegi-ui style="position:fixed;inset:0;pointer-events:none;user-select:none" aria-hidden="true"></div>',
      );
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const read = () =>
        page.evaluate(() => {
          const clip = document.querySelector("#vertical")! as HTMLElement;
          const inner = document.querySelector("#horizontal")! as HTMLElement;
          const vertical = clip.getBoundingClientRect(),
            horizontal = inner.getBoundingClientRect();
          const bounds = {
            left: Math.max(
              vertical.left + clip.clientLeft,
              horizontal.left + inner.clientLeft,
            ),
            right: Math.min(
              vertical.left + clip.clientLeft + clip.clientWidth,
              horizontal.left + inner.clientLeft + inner.clientWidth,
            ),
            top: vertical.top + clip.clientTop,
            bottom: vertical.top + clip.clientTop + clip.clientHeight,
          };
          return {
            bounds,
            marks: [
              ...document.querySelectorAll(".pg-selection,.pg-selection-label"),
            ].map((el) => {
              const r = el.getBoundingClientRect();
              return {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                pointer: getComputedStyle(el).pointerEvents,
                select:
                  getComputedStyle(el).userSelect ||
                  getComputedStyle(el).getPropertyValue("-webkit-user-select"),
              };
            }),
            selection: getSelection()!.toString(),
          };
        });
      const payload = await page.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector("p")!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return (globalThis as any).selectionAPI.captureSelection(document);
      });
      const paint = () =>
        page.evaluate(
          (payload) =>
            (globalThis as any).selectionAPI.paintSelections(
              document.querySelector("#overlay"),
              [
                {
                  actor: "A very long collaborator name that must stay clipped",
                  selection: payload,
                },
              ],
            ),
          payload,
        );
      await paint();
      await page.screenshot({
        path: `/tmp/pagegi-selection-${engine.name()}-clipping-fixed.png`,
      });
      const original = await read();
      assert.equal(await page.locator(".pg-selection-label").count(), 0);
      assert.ok(original.marks.length);
      for (const mark of original.marks) {
        assert.ok(
          mark.left >= original.bounds.left &&
            mark.right <= original.bounds.right + 0.1,
          JSON.stringify({ mark, bounds: original.bounds }),
        );
        assert.ok(
          mark.top >= original.bounds.top &&
            mark.bottom <= original.bounds.bottom + 0.1,
          JSON.stringify({ mark, bounds: original.bounds }),
        );
        assert.equal(mark.pointer, "none");
        assert.equal(mark.select, "none");
      }
      await page.evaluate(() => {
        document.querySelector("#vertical")!.scrollTop = 60;
        document.querySelector("#horizontal")!.scrollLeft = 100;
      });
      await paint();
      const scrolled = await read();
      assert.equal(scrolled.selection, original.selection);
      assert.ok(scrolled.marks.length);
      for (const mark of scrolled.marks) {
        assert.ok(
          mark.left >= scrolled.bounds.left &&
            mark.right <= scrolled.bounds.right + 0.1,
        );
        assert.ok(
          mark.top >= scrolled.bounds.top &&
            mark.bottom <= scrolled.bounds.bottom + 0.1,
        );
      }
      await page.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector("body>p")!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        document.querySelector("#vertical")!.scrollTop = 1000;
      });
      // A selected first line entirely hidden by scrolling has neither marks nor labels.
      const firstLine = await page.evaluate(() => {
        const api = (globalThis as any).selectionAPI;
        const r = document.createRange();
        r.selectNodeContents(
          document.querySelector("[data-af-id]")!.firstChild!,
        );
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return api.captureSelection(document);
      });
      await page.evaluate(
        (value) =>
          (globalThis as any).selectionAPI.paintSelections(
            document.querySelector("#overlay"),
            [{ actor: "Other reader", selection: value }],
          ),
        firstLine,
      );
      assert.equal(
        await page.locator(".pg-selection,.pg-selection-label").count(),
        0,
      );
    } finally {
      await browser.close();
    }
  });
