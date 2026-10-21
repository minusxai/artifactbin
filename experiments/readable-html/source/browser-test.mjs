import { build } from "esbuild";
import { encodeRuntime } from "./packaging.mjs";
import { chromium, firefox, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./test.mjs";
import { decode, save } from "./codec.mjs";
const out = await build({
  entryPoints: [new URL("./runtime.mjs", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  platform: "browser",
});
const runtime = encodeRuntime(out.outputFiles[0].text);
const materialize = (s) =>
  s.replace(
    /<script data-pagegi-runtime="2">[\s\S]*?<\/script>/,
    () =>
      '<script data-pagegi-runtime="2">' +
      runtime.replaceAll("</script", "<\\/script") +
      "</script>",
  );
const dir = await mkdtemp(join(tmpdir(), "readable-source-"));
const results = [];
try {
  for (const [engine, driver] of Object.entries({
    chromium,
    firefox,
    webkit,
  })) {
    const browser = await driver.launch();
    try {
      const context = await browser.newContext();
      await context.route(/^https?:/, (r) => r.abort());
      const page = await context.newPage();
      page.on("pageerror", (e) => console.error(engine, e.message));
      for (const [name, html] of [
        ["unicode-entities", fixture],
        [
          "responsive-css",
          fixture.replace(
            "</head>",
            "<style>@media (max-width:600px){p{color:red}}@supports(display:grid){p{display:grid}}@keyframes fade{from{opacity:0}to{opacity:1}}</style></head>",
          ),
        ],
        ["document-comments", "<!--before-->" + fixture + "<!--after-->"],
        [
          "legacy-doctype",
          fixture.replace(
            "<!doctype html>",
            '<!DOCTYPE html SYSTEM "about:legacy-compat">',
          ),
        ],
        ["repair-closing-tag", fixture.replace("</h1>", "</h2>")],
        [
          "attribute-normalization",
          fixture.replace(
            'data-pagegi-id="title"',
            "class='x' data-pagegi-id=title title='&quot; &amp; < >'",
          ),
        ],
        [
          "raw-text",
          fixture
            .replace(
              "</head>",
              '<style>h1::after { content: "<>&"; }</style></head>',
            )
            .replace(
              "document.querySelector",
              "/* &amp; <tag> 🐚 */ document.querySelector",
            ),
        ],
        [
          "json-scriptlike",
          save((await decode(fixture)).source, {
            format: 2,
            app: { text: "</script> &amp; 🪴\u2028\u2029", count: 0 },
            comments: [],
          }),
        ],
        [
          "svg-math",
          fixture.replace(
            "</body>",
            '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg><math><mi>x</mi><mo>&lt;</mo><mn>2</mn></math></body>',
          ),
        ],
        [
          "external-link",
          fixture.replace(
            "</body>",
            '<a href="https://example.invalid/docs">Docs</a></body>',
          ),
        ],
        ["crlf", fixture.replaceAll("><", ">\r\n<")],
      ]) {
        const server = await decode(html);
        const filename = join(dir, engine + ".html");
        await writeFile(filename, materialize(html));
        await page.goto("file://" + filename);
        await page.waitForFunction(
          () => window.candidate?.ready || window.candidate?.error,
        );
        const got = await page.evaluate(() => ({
          error: window.candidate.error,
          source: window.candidate.source,
          revision: window.candidate.revision,
          rendered: document.querySelector("h1").textContent,
          saved: window.candidate.save?.(),
          state: window.candidate.state,
        }));
        assert.equal(got.error, undefined, engine + name);
        assert.equal(got.revision, server.revision, engine + name);
        assert.equal(got.source, server.source);
        assert.equal(got.rendered, "rendered");
        assert.ok(!got.saved.includes(">rendered<"));
        got.state.app = { count: 17, text: "</script> 💐 &" };
        const changed = await page.evaluate((s) => {
          window.candidate.state.app = s.app;
          return window.candidate.save();
        }, got.state);
        assert.equal(
          (
            await decode(changed, {
              runtime: runtime.replaceAll("</script", "<\\/script"),
            })
          ).revision,
          server.revision,
        );
        await writeFile(filename, changed);
        await page.reload();
        await page.waitForFunction(
          () => window.candidate?.ready || window.candidate?.error,
        );
        const reopened = await page.evaluate(() => ({
          state: window.candidate.state,
          saved: window.candidate.save?.(),
          revision: window.candidate.revision,
          error: window.candidate.error,
        }));
        assert.equal(reopened.error, undefined);
        assert.deepEqual(reopened.state, got.state);
        assert.equal(reopened.saved, changed);
        assert.equal(reopened.revision, server.revision);
        results.push({
          engine,
          fixture: name,
          crossRuntimeHash: true,
          sourcePreserved: true,
          renderedExcluded: true,
          stateRestored: true,
          idempotent: true,
        });
      }
      // A manually modified unsupported script is rejected as managed even if the browser ran it.
      await writeFile(
        join(dir, engine + ".html"),
        materialize(
          fixture.replace(
            "<body>",
            "<body><script>window.unmanagedRan=true</script>",
          ),
        ),
      );
      await page.reload();
      await page.waitForFunction(() => window.candidate?.error);
      assert.match(
        await page.evaluate(() => window.candidate.error),
        /Unmanaged/,
      );
      results.push({
        engine,
        fixture: "unmanaged-script",
        managedCaptureRejected: true,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    JSON.stringify({ runtimeBytes: runtime.length, results }, null, 2),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
