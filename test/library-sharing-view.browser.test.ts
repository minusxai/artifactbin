import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";

test("real email sign-in survives sharing failure and retries without changing account; logout hides late sharing", async () => {
  const db = await testDatabase();
  let code = "";
  const service = createService({
    ...db,
    allowPasswordLogin: false,
    sendCode: async (message) => {
      code = message.code;
    },
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin =
    "http://127.0.0.1:" + (service.server.address() as { port: number }).port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Sign in with your email", exact: true })
      .click();
    await page.getByLabel("Email address").fill("view-review@example.com");
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await page.getByLabel("Email code").waitFor();
    await page.getByLabel("Email code").fill(code);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your documents", exact: true })
      .waitFor();
    const published = await page.evaluate(async () => {
      const response = await fetch("/api/library/example", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pagegi-Home": "1" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    });
    let fail = true;
    const sharingURL = `**/api/library/${published.id}/sharing`;
    await page.route(sharingURL, (route) =>
      fail
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"error":"unavailable"}',
          })
        : route.continue(),
    );
    await page.goto(origin + "/?sharing=" + published.id);
    await page
      .getByRole("alert")
      .filter({ hasText: "Could not load sharing." })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Account menu", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(await page.locator("#welcome").isVisible(), false);
    assert.equal(await page.locator("#load-error").isVisible(), false);
    fail = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page
      .getByRole("button", { name: "Copy link", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !(document.querySelector(".pg-sharing-copy") as HTMLButtonElement)
          .disabled,
    );
    await page.unroute(sharingURL);
    const previousSharing = await page.evaluate(
      async (id) =>
        (
          await fetch(`/api/library/${id}/sharing`, {
            headers: { "X-Pagegi-Home": "1" },
          })
        ).json(),
      published.id,
    );
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await page.route(sharingURL, async (route) => {
      entered();
      await held;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(previousSharing),
        })
        .catch(() => {});
    });
    await page.reload();
    await started;
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign in with your email", exact: true })
      .waitFor();
    release();
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#sharing-page").isVisible(), false);
    assert.equal(await page.locator("#sharing-page").textContent(), "");
  } finally {
    await browser.close();
    await service.close();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await db.cleanup();
  }
});
