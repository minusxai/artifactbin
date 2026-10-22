import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { page as source, startServer } from "../support/server.ts";
import type { PublishResponse } from "../../../src/server/af-api-contracts.ts";
test("library Trash restores a retained page", async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const token = await server.token();
    const published = (await (
      await server.request("/api/publish", {
        token,
        body: { source: source("<h1>Restore me</h1>"), requestId: "ui-trash" },
      })
    ).json()) as PublishResponse;
    await server.request(`/api/files/${published.id}`, {
      token,
      method: "DELETE",
    });
    const context = await browser.newContext();
    await context.addCookies([
      { name: "pagegi_account", value: token, url: server.origin },
    ]);
    const page = await context.newPage();
    await page.goto(server.origin);
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Trash", exact: true });
    await dialog.getByRole("button", { name: "Restore", exact: true }).click();
    await dialog.getByText("Trash is empty.", { exact: true }).waitFor();
    assert.equal(
      (await server.request(`/api/files/${published.id}/source`, { token }))
        .status,
      200,
    );
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.getByLabel('Actions for test-page.html',{exact:true}).click();
    await page.getByRole('button',{name:'Move to trash',exact:true}).click();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.getByLabel('Actions for test-page.html',{exact:true}).waitFor({state:'detached'});
    assert.equal((await server.request(`/api/files/${published.id}/source`,{token})).status,404);
  } finally {
    await browser.close();
    await server.close();
  }
});
