import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { webkit } from "playwright";

test("a profile refresh during a pointer gesture preserves the viewer snapshot action", async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { createPlatformChrome } from './src/browser/platform-chrome.ts';
        window.calls = [];
        window.state = {
          actor: 'bob', profiles: { ann: { name: 'Ann' } },
          viewers: [{ actor: 'ann', sessionId: 'ann-session', sourceRevision: '1', shareView: true, cursor: null, selection: null }],
          sessionId: 'bob-session', remote: true, connected: true, canComment: true,
          preferences: { visible: true, shareCursor: true, shareView: true, showCursors: true, shareSelection: true, showSelections: true },
        };
        window.chromeUI = createPlatformChrome({ read: () => state, act: action => calls.push(action), error: message => { throw Error(message); } });
        document.body.append(chromeUI.bar);
        chromeUI.renderPeople();
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Viewer controls</title>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const viewer = page.getByRole("button", {
      name: "View ann's snapshot",
      exact: true,
    });
    const box = await viewer.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // The real runtime applies asynchronously loaded profiles through this
    // projection. Hold the pointer across that update without simulating click.
    await page.evaluate(() => {
      state.profiles.ann = { name: "Ann Updated" };
      chromeUI.renderPeople();
    });
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => calls),
      [{ kind: "view-person", sessionId: "ann-session" }],
      "an async profile refresh must not drop or duplicate the in-progress snapshot click",
    );
    await page.evaluate(() => chromeUI.dispose());
  } finally {
    await browser.close();
  }
});
