import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";

test("logging out of a group folder resets namespace before another account signs in", async () => {
  const db = await testDatabase();
  let code = "";
  const service = createService({
    ...db,
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
    const post = async (path: string, body: unknown) => {
      const response = await fetch(origin + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.ok, true);
      return response.json();
    };
    await post("/api/auth/email/request", { email: "first@example.test" });
    const auth = await post("/api/auth/email/verify", {
      email: "first@example.test",
      code,
    });
    await db.pool.query(
      "INSERT INTO accounts(actor,principal_kind,name) VALUES('group:fixture','group','Fixture team'); INSERT INTO groups(owner) VALUES('group:fixture'); INSERT INTO group_memberships(owner,actor,role) VALUES('group:fixture','first@example.test','editor'); INSERT INTO folders(owner,path) VALUES('group:fixture','/Team folder')",
    );
    const context = await browser.newContext();
    await context.addCookies([
      { name: "pagegi_account", value: auth.token, url: origin },
    ]);
    const page = await context.newPage();
    const listings: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/library" && request.method() === "GET")
        listings.push(url.search);
    });
    await page.goto(origin + "/?owner=group%3Afixture&folder=%2FTeam+folder");
    await page.locator("#namespace-select").waitFor();
    await page.locator("#account-menu").click();
    await page.locator("#menu-sign-out").click();
    await page.waitForURL(origin + "/");
    await page.locator("#welcome-sign-in").waitFor();
    listings.length = 0;
    await page.locator("#welcome-sign-in").click();
    await page
      .locator('#login-form [name="email"]')
      .fill("second@example.test");
    await page
      .getByRole("button", { name: "Log in with email", exact: true })
      .click();
    await page.locator('#login-form [name="code"]').waitFor();
    await page.locator('#login-form [name="code"]').fill(code);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.locator("#library").waitFor();
    assert.equal(
      await page.locator("#namespace-select").inputValue(),
      "",
    );
    assert.equal(await page.locator("#namespace-select option").count(), 1);
    assert.equal(await page.locator("#folder-missing").isVisible(), false);
    assert.ok(listings.length > 0);
    assert.ok(
      listings.every((query) => !new URLSearchParams(query).has("owner")),
    );
    const denied = await page.evaluate(
      async () => (await fetch("/api/library?owner=group%3Afixture")).status,
    );
    assert.equal(denied, 403);
  } finally {
    await browser.close();
    await service.close();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await db.cleanup();
  }
});
