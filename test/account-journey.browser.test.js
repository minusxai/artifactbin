import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
  await page.route("https://account.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>localStorage.setItem('pagegi-theme','light');${readFileSync(new URL("../src/theme.js", import.meta.url), "utf8")}</script><input aria-label="Draft" value="unchanged"><script>addEventListener('message',e=>{if(e.source===parent)window.lastTheme=e.data});</script>`,
    }),
  );
  await page.setContent(
    '<html data-theme="dark"><body><button id="open">Account</button><textarea id="draft">My document draft</textarea></body></html>',
  );
  const source = readFileSync(
    new URL("../src/browser/account.js", import.meta.url),
    "utf8",
  );
  await page.evaluate(async (source) => {
    const mod = await import(
      URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    );
    window.changed = 0;
    window.themes = [];
    addEventListener("pagegi-theme", (e) => window.themes.push(e.detail));
    window.openAccount = () =>
      mod.openAccount("https://account.example", () => window.changed++);
    document.querySelector("#open").onclick = window.openAccount;
  }, source);
  await page.locator("#open").click();
  assert.equal(
    new URL(await page.locator("iframe").getAttribute("src")).searchParams.get(
      "theme",
    ),
    "dark",
  );
  const dialog = page.getByRole("dialog", { name: "Account" });
  await dialog.waitFor();
  const frame = page.frameLocator('iframe[title="Account settings"]');
  assert.deepEqual(
    await frame
      .getByLabel("Draft")
      .evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        embedded: document.documentElement.classList.contains("pg-embedded"),
      })),
    { theme: "dark", embedded: true },
  );
  await frame.getByLabel("Draft").fill("Keep account draft");
  await page.evaluate(() => {
    dispatchEvent(
      new MessageEvent("message", {
        origin: "https://account.example",
        source: window,
        data: { type: "pagegi-account", event: "profile-changed" },
      }),
    );
    dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        source: document.querySelector("iframe").contentWindow,
        data: { type: "pagegi-account", event: "close" },
      }),
    );
  });
  await page.evaluate(() => {
    for (const [origin, source, theme] of [
      ["https://account.example", window, "dark"],
      [
        "https://evil.example",
        document.querySelector("iframe").contentWindow,
        "dark",
      ],
      [
        "https://account.example",
        document.querySelector("iframe").contentWindow,
        "invalid",
      ],
    ])
      dispatchEvent(
        new MessageEvent("message", {
          origin,
          source,
          data: { type: "pagegi-account", event: "theme-changed", theme },
        }),
      );
  });
  assert.deepEqual(await page.evaluate(() => window.themes), []);
  await frame
    .getByLabel("Draft")
    .evaluate(() =>
      parent.postMessage(
        { type: "pagegi-account", event: "theme-changed", theme: "light" },
        "*",
      ),
    );
  await page.waitForFunction(() => window.themes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.themes), ["light"]);
  assert.equal(await page.evaluate(() => window.changed), 0);
  assert.equal(await dialog.isVisible(), true);
  await frame
    .getByLabel("Draft")
    .evaluate(() =>
      parent.postMessage(
        { type: "pagegi-account", event: "profile-changed" },
        "*",
      ),
    );
  await page.waitForFunction(() => window.changed === 1);
  await page.getByRole("button", { name: "Close account" }).click();
  assert.equal(await dialog.isVisible(), false);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.locator("#open").click();
  await frame.getByLabel("Draft").evaluate(
    () =>
      new Promise((resolve) => {
        const check = () =>
          window.lastTheme?.theme === "light"
            ? resolve()
            : requestAnimationFrame(check);
        check();
      }),
  );
  assert.equal(
    await frame.getByLabel("Draft").inputValue(),
    "Keep account draft",
  );
  assert.equal(await page.locator("#draft").inputValue(), "My document draft");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(
    await page.locator("#open").evaluate((el) => el === document.activeElement),
    true,
  );
  console.log("Account modal browser behavior passed");
} finally {
  await browser.close();
}
