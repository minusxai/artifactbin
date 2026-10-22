import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";

test("library visibility filters and folder papers render from listing metadata", async () => {
  const db = await testDatabase();
  const service = createService({ ...db, allowPasswordLogin: false });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin =
    "http://127.0.0.1:" + (service.server.address() as { port: number }).port;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "pagegi_account", value: "fixture", url: origin },
    ]);
    const page = await context.newPage();
    await page.route("**/api/library", (route) =>
      route.fulfill({
        json: {
          username: "reader@example.test",
          files: [
            {
              path: "/Report",
              title: "Report",
              fileId: "Report",
              url: "/a/Report",
              commentCount: 0,
              visibility: "private",
            },
            {
              path: "/work/Plan",
              title: "Plan",
              fileId: "Plan12",
              url: "/a/Plan12",
              commentCount: 0,
              visibility: "public",
            },
          ],
          folders: ["/work"],
        },
      }),
    );
    await page.route("**/api/library/profile", (route) =>
      route.fulfill({ json: { name: "Reader", image: null } }),
    );
    await page.goto(origin);
    await page.locator('[aria-label="Report is private"]').waitFor();
    assert.equal(await page.locator(".folder-cover-paper").count(), 1);
    assert.equal(
      await page.locator(".folder-cover-tab").textContent(),
      "1 artifact",
    );
    const cover = await page.locator(".folder-cover").boundingBox();
    const paper = await page.locator(".folder-cover-paper").boundingBox();
    assert.ok(
      cover && paper && paper.y + paper.height <= cover.y + cover.height,
      "folder papers stay within the decorative cover",
    );
    await page.getByRole("link", { name: "work", exact: true }).click();
    await page.waitForURL("**/?folder=%2Fwork");
    await page.goto(origin);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.getByRole("link", { name: "work", exact: true }).click();
    await page.waitForURL("**/?folder=%2Fwork");
    await page.goto(origin);
    await page.getByLabel("Filter by visibility").selectOption("public");
    assert.equal(await page.locator('#files [data-path="/Report"]').count(), 0);
    assert.equal(await page.locator('#files [data-path="/work"]').count(), 1);
    await page.getByLabel("Filter by visibility").selectOption("private");
    await page.route("**/api/library/Report/download", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Report</title>",
      }),
    );
    await page.getByLabel("Actions for Report").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    assert.equal((await download).suggestedFilename(), "Report.html");
  } finally {
    await browser.close();
    await service.close();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await db.cleanup();
  }
});
