import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode } from "./source/codec.mjs";
import { encodeRuntime } from "./source/packaging.mjs";
const bundle = await build({
  entryPoints: ["experiments/readable-html/integration-runtime.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
});
const runtime = encodeRuntime(bundle.outputFiles[0].text);
const html =
  '<!doctype html><!-- before-html --><html><head><meta charset="utf-8"><script data-pagegi-runtime="2">' +
  runtime +
  '</script><script id="pagegi-state" type="application/json">{"format":2,"app":{"count":0},"comments":[]}</script></head><body><h1 data-pagegi-id="title">Author source</h1><af-markdown data-pagegi-id="markdown"><script type="application/json" data-af-source>"# Saved Markdown\\n\\n**Readable**"</script></af-markdown><script type="application/pagegi">document.querySelector("h1").textContent="Live rendered view";</script></body></html><!-- after-html -->';
const dir = await mkdtemp(join(tmpdir(), "composed-proof-"));
try {
  for (const [name, driver] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await driver.launch();
    try {
      const context = await browser.newContext();
      await context.route(/^https?:/, (r) => r.abort());
      const file = join(dir, name + ".html");
      await writeFile(file, html);
      const page = await context.newPage();
      await page.goto("file://" + file);
      await page.waitForFunction(
        () => window.composed?.ready || window.composed?.error,
      );
      assert.equal(await page.evaluate(() => window.composed.error), undefined);
      assert.equal(
        await page.locator("af-markdown [data-af-output] h1").textContent(),
        "Saved Markdown",
      );
      const sourceBefore = await page.evaluate(() => window.composed.source);
      const expected = await decode(html, { runtime });
      assert.equal(sourceBefore, expected.source);
      const saved = await page.evaluate(() => {
        window.composed.setState({ count: 7 });
        return window.composed.exportFile();
      });
      assert.ok(saved.includes(">Author source<"));
      assert.ok(!saved.includes(">Live rendered view<"));
      assert.ok(!saved.includes("<div data-af-output"));
      const replay = await page.evaluate(() => window.composed.enterHistory());
      assert.equal(replay.fidelity, "captured-dom");
      assert.ok(replay.html.includes("Saved Markdown"));
      assert.equal(
        await page.evaluate(() => window.composed.publishDuringHistory()),
        false,
      );
      assert.equal(
        await page.evaluate(() => {
          try {
            window.composed.setState({ count: 99 });
            return false;
          } catch {
            return true;
          }
        }),
        true,
      );
      assert.deepEqual(
        await page.evaluate(() => window.composed.leaveHistory()),
        { count: 7 },
      );
      const returnedExport = await page.evaluate(() => window.composed.exportFile());
      assert.equal(returnedExport, saved, "History cannot leak into export");
      await writeFile(file, returnedExport);
      await page.reload();
      await page.waitForFunction(
        () => window.composed?.ready || window.composed?.error,
      );
      assert.equal(await page.evaluate(() => window.composed.error), undefined);
      assert.equal(
        await page.evaluate(() => window.composed.revision),
        expected.revision,
      );
      assert.deepEqual(
        await page.evaluate(() => window.composed.leaveHistory()),
        { count: 7 },
      );
      assert.equal(
        await page.evaluate(() => window.composed.exportFile()),
        saved,
      );
      console.log(
        name +
          ": source capture → Markdown hydration → static history → own return → direct offline export/reopen passed",
      );
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
