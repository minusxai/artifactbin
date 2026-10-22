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
    // Keyed controls retain focus and pointer nodes while their presentation
    // and selected live session change, then remove departed viewers.
    const projection = await page.evaluate(() => {
      const button = document.querySelector(
        '[aria-label="View ann\'s snapshot"]',
      );
      const face = button.querySelector(".pg-face");
      const image = face.querySelector("img");
      button.focus();
      state.profiles.ann = {
        name: "Zoe",
        image: "https://tracker.invalid/photo.png",
      };
      state.viewers[0].sessionId = "new-ann-session";
      state.viewers[0].shareView = false;
      chromeUI.renderPeople();
      return {
        sameButton:
          button ===
          document.querySelector('[aria-label="View ann\'s snapshot"]'),
        sameFace: face === button.querySelector(".pg-face"),
        sameImage: image === face.querySelector("img"),
        focusKept: document.activeElement === button,
        initial: face.firstChild.nodeValue,
        imageHidden: image.hidden && !image.hasAttribute("src"),
        sharing: button.getAttribute("aria-description"),
      };
    });
    assert.deepEqual(projection, {
      sameButton: true,
      sameFace: true,
      sameImage: true,
      focusKept: true,
      initial: "Z",
      imageHidden: true,
      sharing: "View sharing is off",
    });
    await viewer.press("Enter");
    assert.deepEqual(await page.evaluate(() => calls.at(-1)), {
      kind: "view-person",
      sessionId: "new-ann-session",
    });
    await page.evaluate(() => {
      state.viewers = [];
      chromeUI.renderPeople();
    });
    assert.equal(
      await page.getByRole("button", { name: "View ann's snapshot" }).count(),
      0,
    );
    assert.equal(await page.locator("#pg-people").isHidden(), true);
    await page.evaluate(() => {
      chromeUI.dispose();
      state.viewers = [
        { actor: "ann", sessionId: "later-session", shareView: true },
      ];
      chromeUI.renderPeople();
    });
    assert.equal(await page.locator("#pg-people").count(), 0);
  } finally {
    await browser.close();
  }
});
