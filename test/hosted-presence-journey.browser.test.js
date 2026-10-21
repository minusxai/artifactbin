// Hosted shell, isolated app runner, real database, and authenticated live sockets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService, addAccount } from "../src/server.js";
const db = await testDatabase();
const service = createService(db);
await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${service.server.address().port}`;
const browser = await chromium.launch();
async function ready(page) {
  await page.locator("#pg-startup").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("html").getAttribute("data-pagegi-startup"),
    "ready",
  );
}
try {
  const identities = [];
  for (const username of ["hosted-alice", "hosted-bob"]) {
    await addAccount(db, username, "fixture password");
    const response = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "fixture password" }),
    });
    assert.equal(response.status, 200);
    identities.push({ username, ...(await response.json()) });
  }
  const response = await fetch(origin + "/api/publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + identities[0].token,
    },
    body: JSON.stringify({
      source: readFileSync("test/fixtures/counter.html", "utf8"),
      requestId: crypto.randomUUID(),
      visibility: "unlisted",
      linkRole: "editor",
    }),
  });
  assert.equal(response.status, 201);
  const published = await response.json();
  const pages = [];
  let idleBob;
  for (const identity of identities) {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "pagegi_account",
        value: identity.token,
        url: origin,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    if (identity === identities[1]) {
      idleBob = await context.newPage();
      await idleBob.goto(new URL(published.url, origin).href);
      await ready(idleBob);
      await pages[0]
        .getByRole("button", { name: `View ${identity.username}'s snapshot` })
        .waitFor();
    }
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      console.error("Browser error:", error.message),
    );
    page.setDefaultTimeout(15000);
    await page.goto(new URL(published.url, origin).href);
    await page
      .frameLocator("#pg-frame")
      .getByRole("button", { name: "Count: 0", exact: true })
      .waitFor();
    await ready(page);
    pages.push(page);
  }
  const [alice, bob] = pages;
  for (const [i, page] of pages.entries()) {
    await page
      .getByRole("button", {
        name: `View ${identities[1 - i].username}'s snapshot`,
      })
      .waitFor();
  }
  await bob
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .hover();
  await alice
    .locator(".pg-cursor")
    .filter({ hasText: identities[1].username })
    .waitFor();
  await alice
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await alice.getByText("Presence & cursors", { exact: true }).click();
  await alice.getByLabel("Show other cursors").uncheck();
  assert.equal(await alice.locator(".pg-cursor").count(), 0);
  await alice.getByLabel("Show other cursors").check();
  await alice
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await bob
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .hover({ position: { x: 8, y: 8 } });
  await alice
    .locator(".pg-cursor")
    .filter({ hasText: identities[1].username })
    .waitFor();
  await idleBob.close();
  // Native selections travel independently of cursor display and use receiver layout.
  await alice.setViewportSize({ width: 760, height: 620 });
  await bob.setViewportSize({ width: 1100, height: 800 });
  const appFrame = (page) =>
    page.frames().find((frame) => frame.url().includes("/runner")) ||
    page.frames()[1];
  async function select(page, clear = false) {
    await appFrame(page).evaluate((clear) => {
      const selection = getSelection();
      selection.removeAllRanges();
      if (clear) return;
      const element = [...document.querySelectorAll("[data-af-id]")].find(
        (el) =>
          el.textContent.trim() &&
          !el.querySelector("script,style,input,textarea,[contenteditable]"),
      );
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.addRange(range);
    }, clear);
  }
  await select(bob);
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor();
  await select(alice);
  await bob
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor();
  const ownSelection = await appFrame(alice).evaluate(() =>
    getSelection().toString(),
  );
  await alice
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await alice.getByText("Presence & cursors", { exact: true }).click();
  await alice.getByLabel("Show other selections").uncheck();
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor({ state: "detached" });
  assert.ok(await alice.locator(".pg-cursor").count());
  assert.equal(
    await appFrame(alice).evaluate(() => getSelection().toString()),
    ownSelection,
  );
  await alice.getByLabel("Show other selections").check();
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor();
  await alice
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await bob.getByRole("button", { name: "Page settings", exact: true }).click();
  await bob.getByText("Presence & cursors", { exact: true }).click();
  await bob.getByLabel("Share my selections").uncheck();
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor({ state: "detached" });
  await bob.getByLabel("Share my selections").check();
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor();
  await select(bob, true);
  await alice
    .frameLocator("#pg-frame")
    .locator(".pg-selection")
    .first()
    .waitFor({ state: "detached" });
  await bob.getByRole("button", { name: "Page settings", exact: true }).click();
  const guest = await browser.newPage();
  await guest.goto(new URL(published.url, origin).href);
  await ready(guest);
  await guest
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .waitFor();
  await guest
    .getByRole("button", { name: `View ${identities[0].username}'s snapshot` })
    .waitFor();
  await guest
    .getByRole("button", { name: `View ${identities[1].username}'s snapshot` })
    .waitFor();
  await bob.getByRole("button", { name: "Page settings", exact: true }).click();
  await bob.getByText("Presence & cursors", { exact: true }).click();
  await bob.getByLabel("Show that I am here").uncheck();
  await alice
    .getByRole("button", { name: `View ${identities[1].username}'s snapshot` })
    .waitFor({ state: "detached" });
  console.log(
    "Hosted presence: two accounts, isolated-runner cursor, display preferences, anonymous observer, and visibility preference passed",
  );
} finally {
  await browser.close();
  service.server.closeAllConnections();
  await new Promise((r) => service.server.close(r));
  await service.close();
  await db.cleanup();
}
