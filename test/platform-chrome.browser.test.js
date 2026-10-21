import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
test("platform chrome projects capabilities and emits semantic actions without owning document state", async () => {
  const bundle = await build({
    stdin: {
      contents: `
    import {createPlatformChrome} from './src/browser/platform-chrome.ts';
    window.calls=[]; window.errors=[];
    window.state={actor:null,profiles:{},viewers:[],sessionId:'own',remote:false,connected:false,canComment:false,preferences:{visible:true,shareCursor:true,shareView:true,showCursors:true}};
    window.chromeUI=createPlatformChrome({read:()=>state,act:a=>calls.push(a),error:e=>errors.push(e)});
    document.body.append(chromeUI.bar); chromeUI.renderIdentity(); chromeUI.renderPeople();
  `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="outside">Outside</button>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Account menu" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Share", exact: true }).count(),
      0,
    );
    await page.evaluate(() => chromeUI.close());
    await page.evaluate(() => {
      state.remote = true;
      state.connected = true;
      state.actor = "alice";
      chromeUI.renderIdentity();
    });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.waitForFunction(() =>
      calls.some((c) => c.kind === "disconnect"),
    );
    assert.equal(
      await page.evaluate(() => state.connected),
      true,
      "UI does not mutate connection",
    );
    await page
      .getByRole("button", { name: "Page settings", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Use latest shared state" })
        .count(),
      0,
      "local state is per viewer: there is no shared state to recover",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Request backend access" })
        .count(),
      0,
      "backends run for every viewer who can open the page: nothing to approve",
    );
    await page.getByRole("button", { name: "Dark mode" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Dark mode" })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await page.evaluate(() => chromeUI.theme), "dark");
    await page.getByText("Presence & cursors", { exact: true }).click();
    await page.getByLabel("Share my cursor", { exact: true }).uncheck();
    await page.waitForFunction(() =>
      calls.some((c) => c.kind === "preference"),
    );
    assert.equal(
      await page.evaluate(() => state.preferences.shareCursor),
      true,
      "preference changes go through action",
    );
    await page.getByRole("button", { name: "Dismiss page settings" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Page settings", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.evaluate(() => chromeUI.promptConnection());
    await page.getByLabel("Server URL").fill("https://example.test");
    await page.getByRole("button", { name: "Publish and connect" }).click();
    await page.waitForFunction(() => calls.some((c) => c.kind === "connect"));
    assert.equal(
      await page.evaluate(() => calls.find((c) => c.kind === "connect").origin),
      "https://example.test",
    );
    await page.evaluate(() => {
      chromeUI.close();
      state.actor = null;
      chromeUI.context({ nodeId: "a", quote: "", snapshot: null }, 10, 20);
    });
    await page.getByRole("menuitem", { name: "Sign in to comment" }).click();
    await page.waitForFunction(() =>
      calls.some((c) => c.kind === "comment-context"),
    );
    await page.evaluate(() => {
      state.actor = "alice";
      chromeUI.context({ nodeId: "a", quote: "", snapshot: null }, 10, 20);
    });
    assert.equal(
      await page
        .getByRole("menuitem", { name: "View-only access" })
        .isDisabled(),
      true,
    );
    await page.evaluate(() => {
      chromeUI.hideContext();
      chromeUI.setStatus("<b>safe</b>");
    });
    assert.equal(await page.locator("#pg-status").textContent(), "<b>safe</b>");
    assert.equal(await page.locator("#pg-status b").count(), 0);
    await page.evaluate(() => {
      state.viewers = [
        { actor: "alice", sessionId: "other-self", shareView: true },
        { actor: "bob", sessionId: "bob", shareView: false },
        { actor: "bob", sessionId: "duplicate", shareView: true },
      ];
      chromeUI.renderPeople();
      chromeUI.showApproval("https://example.test/approve");
    });
    assert.equal(await page.locator("#pg-people button").count(), 1);
    await page.getByRole("button", { name: "View bob's snapshot" }).click();
    await page.waitForFunction(() =>
      calls.some((c) => c.kind === "view-person"),
    );
    assert.equal(
      await page.evaluate(
        () => calls.find((c) => c.kind === "view-person").sessionId,
      ),
      "bob",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Sign in to connect" })
        .getAttribute("rel"),
      "noopener",
    );
    await page.evaluate(() =>
      dispatchEvent(new CustomEvent("pagegi-theme", { detail: "invalid" })),
    );
    assert.equal(await page.evaluate(() => chromeUI.theme), "dark");
    await page.evaluate(() =>
      dispatchEvent(new CustomEvent("pagegi-theme", { detail: "light" })),
    );
    assert.equal(await page.evaluate(() => chromeUI.theme), "light");
    await page.evaluate(() => chromeUI.dispose());
    assert.equal(await page.locator("#pg-bar").count(), 0);
    assert.equal(await page.locator("#pg-popover").count(), 0);
    assert.equal(await page.locator(".pg-scrim").count(), 0);
    await page.evaluate(() => {
      chromeUI.promptConnection();
      dispatchEvent(new CustomEvent("pagegi-theme", { detail: "dark" }));
    });
    assert.equal(await page.evaluate(() => chromeUI.theme), "light");
    assert.equal(await page.locator("#pg-popover").count(), 0);
  } finally {
    await browser.close();
  }
});
