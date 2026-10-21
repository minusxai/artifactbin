import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { chromeCSS } from "../src/chrome-assets.js";

test("mobile documents remain reachable and page settings exposes commenting", async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createPlatformChrome} from './src/browser/platform-chrome.ts';
      window.calls=[];
      const ui=createPlatformChrome({read:()=>({actor:'reviewer',profiles:{},viewers:[],sessionId:'own',remote:true,connected:true,canComment:true,sharedStatus:null,preferences:{visible:true,shareCursor:true,shareView:true,showCursors:true}}),act:a=>calls.push(a),error:e=>{throw Error(e)}});
      document.body.append(ui.bar);ui.renderIdentity();document.querySelector('#pg-library').hidden=false;`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.setContent("<main>Document content</main>");
    await page.addStyleTag({
      content: chromeCSS + (await readFile("src/browser/style.css", "utf8")),
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.equal(
      await page
        .getByRole("button", { name: "Artifacts", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "Page settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await page.waitForFunction(() =>
      calls.some((c) => c.kind === "add-comment"),
    );
  } finally {
    await browser.close();
  }
});
