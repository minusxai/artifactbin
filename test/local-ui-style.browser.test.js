import assert from "node:assert/strict";
import { browserEngines } from "./browser-engines.js";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { chromeCSS } from "../src/chrome-assets.js";
import { localChromeCSS } from "../src/browser/ui-style.js";
const css = chromeCSS + (await readFile("src/browser/style.css", "utf8"));
const bundle = await build({
  stdin: {
    contents:
      'import {installLocalLayout} from "./src/browser/local-layout.ts"; window.installLocalLayout=installLocalLayout;',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
});
const author = `<style>html{padding-top:7px}body{margin:64px auto;padding:16px;max-width:704px;font:18px/1.5 system-ui}button{margin:4px;padding:10px 16px;border:3px dashed red;background:pink}body button{box-shadow:1px 1px red}body .button{margin:8px}nav{line-height:3}button::before{content:'author'}@media(max-width:500px){html{padding-top:11px}body{padding:24px}}</style><h1 id="heading">Author content</h1><button id="author">Author button</button>`;
const ui =
  '<nav id="pg-bar" class="pg-bar" data-pagegi-ui><span class="pg-brand">artifactbin</span><span id="pg-status"></span><button id="pg-connect">Connect</button><button id="pg-settings" class="pg-bar-action" aria-label="Page settings">⚙</button><button id="pg-return" hidden>Return</button></nav>';
for (const [name, engine] of Object.entries(browserEngines)) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    await page.setContent(author);
    const metrics = () =>
      page.evaluate(() => {
        const h = document.querySelector("#heading").getBoundingClientRect(),
          s = getComputedStyle(document.body),
          a = getComputedStyle(document.querySelector("#author"));
        return {
          x: h.x,
          y: h.y,
          width: h.width,
          padding: s.padding,
          margin: s.margin,
          buttonPadding: a.padding,
          buttonMargin: a.margin,
          buttonBorder: a.border,
          buttonBackground: a.backgroundColor,
        };
      });
    const before = await metrics();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(
      () =>
        (window.layout = window.installLocalLayout({ document, inset: 44 })),
    );
    await page.evaluate(
      (ui) => document.body.insertAdjacentHTML("beforeend", ui),
      ui,
    );
    await page.addStyleTag({ content: localChromeCSS(css) });
    const toolbar = () =>
      page
        .locator("#pg-bar")
        .evaluate((el) => ({
          position: getComputedStyle(el).position,
          y: el.getBoundingClientRect().y,
          height: el.getBoundingClientRect().height,
          width: el.getBoundingClientRect().width,
        }));
    assert.deepEqual(
      await toolbar(),
      { position: "fixed", y: 0, height: 44, width: 900 },
      "toolbar stays out of author flow at viewport top",
    );
    await page.evaluate(() => {
      document.body.style.minHeight = "1500px";
      scrollTo(0, 200);
    });
    assert.deepEqual(
      await toolbar(),
      { position: "fixed", y: 0, height: 44, width: 900 },
      "toolbar remains fixed while author content scrolls",
    );
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.body.style.minHeight = "";
    });
    const after = await metrics();
    assert.equal(after.y, before.y + 44);
    assert.deepEqual(
      { ...after, y: before.y },
      before,
      "author body and controls retain their own styles",
    );
    const local = await page.locator("#pg-settings").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        margin: s.margin,
        border: s.border,
        background: s.backgroundColor,
        padding: s.padding,
        width: s.width,
        height: s.height,
        shadow: s.boxShadow,
        before: getComputedStyle(el, "::before").content,
      };
    });
    const host = await browser.newPage();
    await host.setContent(ui);
    await host.addStyleTag({ content: css });
    const expected = await host.locator("#pg-settings").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        margin: s.margin,
        border: s.border,
        background: s.backgroundColor,
        padding: s.padding,
        width: s.width,
        height: s.height,
        shadow: s.boxShadow,
        before: getComputedStyle(el, "::before").content,
      };
    });
    assert.deepEqual(
      local,
      expected,
      "ordinary author CSS cannot restyle toolbar controls",
    );
    assert.equal(await page.locator("#pg-return").isVisible(), false);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.evaluate(() => window.layout.refresh());
    const narrow = await metrics();
    assert.equal(narrow.padding, "24px");
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).paddingTop,
      ),
      "55px",
    );
    await page.evaluate(() => window.layout.dispose());
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).paddingTop,
      ),
      "11px",
    );
    await host.close();
    console.log(
      name +
        ": local chrome reset, authored geometry, responsive inset and disposal passed",
    );
  } finally {
    await browser.close();
  }
}
