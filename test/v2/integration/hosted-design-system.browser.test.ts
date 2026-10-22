/**
 * A hosted page paints styled from the start: the server sends the page's own
 * design system's CSS with the page, the runner puts it inline before the
 * core, and the core fetches no stylesheet for it. Picking another design
 * system still loads that one from the platform, and the loading screen
 * (dark for a dark viewer) stays until it has loaded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit, type BrowserType, type Page } from "playwright";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
import { page as pageSource, startServer } from "../support/server.ts";

const engines: [string, BrowserType][] = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const stylesheetRequests = (urls: string[], system: string) =>
  urls.filter((url) => new URL(url).pathname === `/af/v1/design-systems/${system}.css`);

/** What the page's own document shows about its design system. */
const appearance = (page: Page) =>
  page
    .frameLocator("#pg-frame")
    .locator("html")
    .evaluate((root) => {
      const links = [...root.ownerDocument.querySelectorAll('link[data-af="design-system"]')];
      const core = root.ownerDocument.querySelector('script[src$="/af/v1/core.js"]');
      return {
        designSystem: root.getAttribute("data-af-design-system"),
        links: links.length,
        href: links[0]?.getAttribute("href") ?? null,
        inline: (links[0]?.getAttribute("href") ?? "").startsWith("data:text/css;base64,"),
        beforeCore: !!core && !!links[0] && (links[0].compareDocumentPosition(core) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        background: getComputedStyle(root).getPropertyValue("--background").trim(),
      };
    });

for (const [name, engine] of engines) {
  test(`${name}: a hosted page is styled on first paint without a stylesheet request, and can still switch design systems`, async () => {
    const server = await startServer();
    const browser = await engine.launch();
    try {
      const token = await server.token();
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: {
            source: pageSource("<h1>Styled</h1>").replace("<html>", '<html data-af-design-system="dossier">'),
            requestId: "hosted-design-system-" + name,
          },
        })
      ).json()) as PublishResponse;
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      page.setDefaultTimeout(15000);
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(published.url);
      await page.waitForSelector("html[data-pagegi-startup=ready]", { state: "attached" });
      const frame = page.frameLocator("#pg-frame");
      // The inline stylesheet's load lifts the loading screen, well before the bridge's 5 s fallback.
      assert.ok((await frame.locator("html").evaluate(() => performance.now())) < 4000, "shown without waiting out the fallback");
      await frame.getByRole("heading", { name: "Styled" }).waitFor();

      const first = await appearance(page);
      assert.equal(first.designSystem, "dossier");
      assert.equal(first.links, 1, "one design-system link, not a second one from the core");
      assert.ok(first.inline, `the CSS is inline: ${first.href?.slice(0, 40)}`);
      assert.ok(first.beforeCore, "the inline CSS precedes the core, so it is there when the core runs");
      assert.notEqual(first.background, "", "the design system's variables apply");
      assert.deepEqual(stylesheetRequests(requests, "dossier"), [], "nothing was fetched for the page's own design system");
      assert.ok(!requests.some((url) => url.includes("/af/v1/design-systems/")), "no design-system stylesheet was requested at all");

      // The viewer picks another system: that one is loaded from the platform.
      await page.locator("#pg-settings").click();
      await page.getByLabel("Design system").selectOption("volta");
      await frame.locator('link[data-af="design-system"][href$="/af/v1/design-systems/volta.css"]').waitFor({ state: "attached" });
      await frame.locator('html[data-af-design-system="volta"]').waitFor({ state: "attached" });
      let switched = await appearance(page);
      for (const deadline = Date.now() + 10000; switched.background === first.background && Date.now() < deadline; )
        switched = await appearance(page);
      assert.equal(switched.links, 1, "the same link changes its href");
      assert.equal(switched.href, `${server.origin}/af/v1/design-systems/volta.css`);
      assert.equal(stylesheetRequests(requests, "volta").length, 1, "the other system is fetched once");
      assert.deepEqual(stylesheetRequests(requests, "dossier"), []);
      assert.notEqual(switched.background, first.background, "the other system's variables apply");
    } finally {
      await browser.close();
      await server.close();
    }
  });
}

for (const [name, engine] of engines) {
  test(`${name}: the loading screen stays until a viewer's other design system has loaded, and is dark for a dark viewer`, async () => {
    const server = await startServer();
    const browser = await engine.launch();
    try {
      const token = await server.token();
      const published = (await (
        await server.request("/api/publish", {
          token,
          body: {
            source: pageSource("<h1>Styled</h1>").replace("<html>", '<html data-af-design-system="dossier">'),
            requestId: "hosted-design-system-wait-" + name,
          },
        })
      ).json()) as PublishResponse;
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, colorScheme: "dark" });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      // The viewer picked volta earlier; its stylesheet is held back.
      await page.goto(server.origin + "/");
      await page.evaluate(() => localStorage.setItem("pagegi-design-system", "volta"));
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let requested!: () => void;
      const asked = new Promise<void>((resolve) => (requested = resolve));
      await page.route("**/af/v1/design-systems/volta.css", async (route) => {
        requested();
        await held;
        await route.continue();
      });
      await page.goto(published.url, { waitUntil: "commit" });

      // A dark viewer (the system's scheme, no pick of their own) gets a dark loading screen.
      const startup = page.locator("#pg-startup");
      await startup.waitFor({ state: "visible" });
      const overlay = await startup.evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.notEqual(overlay, "rgb(247, 247, 245)", "not the light loading screen");
      const channels = overlay.match(/\d+/g)!.slice(0, 3).map(Number);
      assert.ok(channels.every((value) => value < 80), `dark loading screen: ${overlay}`);

      await asked;
      const frame = page.frameLocator("#pg-frame");
      await frame.getByRole("heading", { name: "Styled" }).waitFor({ state: "attached" });
      // Checkpoint: everything but the held stylesheet has happened. The page's document is parsed and
      // its design-system link points at volta with no sheet of that href yet (Chromium and WebKit keep
      // the page's inline sheet on the link until the new one arrives), so a ready page here would be
      // ready without its CSS.
      const documentFrame = await (await page.$("#pg-frame"))?.contentFrame();
      assert.ok(documentFrame, "the page's document frame");
      const pendingVolta = () => {
        const link = document.querySelector('link[data-af="design-system"]') as HTMLLinkElement | null;
        return (
          document.readyState !== "loading" &&
          !!link &&
          /\/volta\.css$/.test(link.href) &&
          !(link.sheet && link.sheet.href === link.href)
        );
      };
      await documentFrame.waitForFunction(pendingVolta);
      // From here on record every startup change, so showing the page before the release is caught in
      // order, not by a timer.
      await page.evaluate(() => {
        const order: string[] = ((window as any).startupOrder = []);
        new MutationObserver(() => {
          if (document.documentElement.getAttribute("data-pagegi-startup") === "ready") order.push("ready");
        }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-pagegi-startup"] });
      });
      assert.notEqual(
        await page.locator("html").getAttribute("data-pagegi-startup"),
        "ready",
        "the page is not shown while its design system's CSS is still loading",
      );
      assert.equal(await documentFrame.evaluate(pendingVolta), true, "the design system's CSS is still pending at the release");
      await page.evaluate(() => (window as any).startupOrder.push("released"));
      const released = Date.now();
      release();
      await page.waitForSelector("html[data-pagegi-startup=ready]", { state: "attached" });
      assert.deepEqual(
        await page.evaluate(() => (window as any).startupOrder),
        ["released", "ready"],
        "the page is shown only after its design system's CSS arrived",
      );
      // The stylesheet's load lifts the loading screen, not the bridge's 5 s fallback.
      assert.ok(Date.now() - released < 2000, `shown ${Date.now() - released} ms after the stylesheet arrived`);
      // At the moment the page shows, volta's CSS applies.
      const shown = await appearance(page);
      assert.equal(shown.designSystem, "volta");
      assert.equal(shown.href, `${server.origin}/af/v1/design-systems/volta.css`);
      assert.notEqual(shown.background, "");
      assert.equal(
        await frame.locator('link[data-af="design-system"]').evaluate((link) => !!(link as HTMLLinkElement).sheet),
        true,
      );

      // A saved light pick wins over the system's dark scheme on the loading screen.
      await page.evaluate(() => localStorage.setItem("pagegi-theme", "light"));
      await page.unroute("**/af/v1/design-systems/volta.css");
      await page.route("**/runtime.js", async () => {});
      await page.reload({ waitUntil: "commit" });
      await startup.waitFor({ state: "visible" });
      assert.equal(await startup.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(247, 247, 245)");
      await context.close();
    } finally {
      await browser.close();
      await server.close();
    }
  });
}
