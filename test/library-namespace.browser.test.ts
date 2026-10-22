import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";
test("group namespace selector preserves folder scope, role controls and fresh revocation", async () => {
  const db = await testDatabase();
  let code = "";
  const service = createService({
    ...db,
    sendCode: async (m) => {
      code = m.code;
    },
  });
  await new Promise<void>((r) => service.server.listen(0, "127.0.0.1", r));
  const origin =
    "http://127.0.0.1:" + (service.server.address() as { port: number }).port;
  const browser = await chromium.launch();
  try {
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.ok, true);
      return r.json();
    };
    await call("/api/auth/email/request", { email: "namespace@example.test" });
    const auth = await call("/api/auth/email/verify", {
      email: "namespace@example.test",
      code,
    });
    await db.pool.query(
      "INSERT INTO accounts(actor,principal_kind,name) VALUES('group:fixture','group','Fixture team'); INSERT INTO groups(owner) VALUES('group:fixture'); INSERT INTO group_memberships(owner,actor,role) VALUES('group:fixture','namespace@example.test','viewer'); INSERT INTO folders(owner,path) VALUES('group:fixture','/Team folder')",
    );
    const context = await browser.newContext();
    await context.addCookies([
      { name: "pagegi_account", value: auth.token, url: origin },
    ]);
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Library namespace").waitFor();
    await page.getByLabel("Library namespace").selectOption("group:fixture");
    await page.waitForURL(/owner=group%3Afixture/);
    await page
      .getByRole("link", { name: "Team folder", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator("#new-folder")
        .evaluate((el) => (el as HTMLButtonElement).hidden),
      true,
    );
    assert.equal(await page.locator("#publish").isVisible(), false);
    const refusedPublication = await page.evaluate(
      async () =>
        (
          await fetch("/api/library?owner=group%3Afixture", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Pagegi-Home": "1",
            },
            body: JSON.stringify({
              html: "<title>Refused</title>",
              path: "/refused.html",
              requestId: "group-refused",
            }),
          })
        ).status,
    );
    assert.equal(refusedPublication, 403);
    await page.getByRole("link", { name: "Team folder", exact: true }).click();
    await page.waitForURL(/folder=%2FTeam\+folder/);
    assert.ok(page.url().includes("owner=group%3Afixture"));
    const denied = await page.evaluate(async () => {
      const r = await fetch("/api/library/paths?owner=group%3Afixture", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pagegi-Home": "1" },
        body: JSON.stringify({ kind: "folder", path: "/Denied" }),
      });
      return r.status;
    });
    assert.equal(denied, 403);
    await db.pool.query(
      "UPDATE group_memberships SET role='editor' WHERE owner='group:fixture'",
    );
    await page.reload();
    await page.locator("#workspace-folder").waitFor();
    await page.locator("#workspace-folder").click();
    await page.locator("#path-input").fill("Added");
    await page.locator("#path-submit").click();
    await page.getByRole("link", { name: "Added", exact: true }).waitFor();
    const stored = await db.pool.query(
      "SELECT owner FROM folders WHERE path='/Team folder/Added'",
    );
    assert.equal(stored.rows[0]?.owner, "group:fixture");
    assert.equal(await page.locator("#publish").isVisible(), false);
    await db.pool.query(
      "DELETE FROM group_memberships WHERE owner='group:fixture'",
    );
    await page.reload();
    await page
      .getByText("You do not have access to this owner namespace", {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator("#library").isVisible(), false);
  } finally {
    await browser.close();
    await service.close();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await db.cleanup();
  }
});
