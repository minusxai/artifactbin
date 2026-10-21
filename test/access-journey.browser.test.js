// Real PostgreSQL, email auth, live transport and browser frames; no mocked API responses.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";
const target = process.env.PAGEGI_TEST_ORIGIN;
const identities = target
  ? JSON.parse(readFileSync(process.env.PAGEGI_TEST_ACCOUNTS, "utf8"))
  : null;
if (target)
  assert.ok(
    identities?.length >= 2 &&
      identities
        .slice(0, 2)
        .every(
          (identity) => identity.username?.includes("@") && identity.token,
        ),
    "production fixture requires two email accounts with tokens",
  );
const db = target ? null : await testDatabase();
const codes = new Map();
let service;
if (!target) {
  service = createService({
    ...db,
    allowPasswordLogin: false,
    sendCode: async ({ to, code }) => codes.set(to, code),
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
}
const origin = target || `http://127.0.0.1:${service.server.address().port}`;
const browser = await chromium.launch({
  ...(target && process.env.PAGEGI_TEST_ADDRESS
    ? {
        args: [
          `--host-resolver-rules=MAP ${new URL(origin).hostname} ${process.env.PAGEGI_TEST_ADDRESS}`,
        ],
      }
    : {}),
});
const ownerEmail = identities?.[0].username || "mxmx_test_owner@example.com",
  readerEmail = identities?.[1].username || "mxmx_test_reader@example.com";
async function signIn(page, email) {
  if (target) {
    const identity = identities.find((identity) => identity.username === email);
    await page.context().addCookies([
      {
        name: "pagegi_account",
        value: identity.token,
        url: origin,
        httpOnly: true,
        secure: new URL(origin).protocol === "https:",
        sameSite: "Strict",
      },
    ]);
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Artifacts", exact: true })
      .waitFor();
    return;
  }
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Sign in with your email", exact: true })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByRole("button", { name: "Log in with email", exact: true })
    .click();
  await page.getByLabel("Email code").waitFor();
  assert.ok(codes.get(email), "real email delivery adapter received OTP");
  await page.getByLabel("Email code").fill(codes.get(email));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await page.getByRole("heading", { name: "Artifacts", exact: true }).waitFor();
}
async function menu(page, name) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function mutation(page, action) {
  const response = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/sharing"),
  );
  await action();
  const result = await response;
  assert.equal(result.status(), 200);
  return result.json();
}
try {
  mkdirSync("test-output", { recursive: true });
  const ownerContext = await browser.newContext(),
    readerContext = await browser.newContext(),
    guestContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    reader = await readerContext.newPage(),
    guest = await guestContext.newPage();
  for (const page of [owner, reader, guest]) page.setDefaultTimeout(15000);
  await signIn(owner, ownerEmail);
  await signIn(reader, readerEmail);
  const filename = `access-browser-${randomUUID()}.html`;
  await owner.locator("#upload").setInputFiles({
    name: filename,
    mimeType: "text/html",
    buffer: readFileSync(new URL("./fixtures/counter.html", import.meta.url)),
  });
  await owner.waitForURL("**/a/**");
  const documentURL = owner.url();
  const documentPath = new URL(documentURL).pathname;
  assert.match(documentPath, /^\/a\/[A-Za-z0-9]{6}$/);
  const app = owner.frameLocator("#pg-frame");
  await app.getByRole("button", { name: "Count: 0", exact: true }).click();
  await menu(owner, "Account & profile");
  const account = owner.frameLocator('iframe[title="Account settings"]');
  await account.getByLabel("Display name", { exact: true }).waitFor();
  await account
    .getByLabel("Display name", { exact: true })
    .fill("Draft account name");
  assert.equal(owner.url(), documentURL);
  await owner.screenshot({
    path: "test-output/access-account.png",
    fullPage: true,
  });
  await owner
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await app.getByRole("button", { name: "Count: 1", exact: true }).waitFor();
  await menu(owner, "Account & profile");
  assert.equal(
    await account.getByLabel("Display name", { exact: true }).inputValue(),
    "Draft account name",
  );
  await owner
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await owner.getByText("Presence & cursors", { exact: true }).click();
  await owner.getByLabel("Share my cursor", { exact: true }).waitFor();
  await owner.screenshot({
    path: "test-output/access-page-settings.png",
    fullPage: true,
  });
  await owner.getByRole("button", { name: "Dark mode", exact: true }).click();
  await owner
    .getByRole("button", { name: "Share / Manage access", exact: true })
    .click();
  assert.equal(
    await owner
      .getByRole("button", { name: "Page settings", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  const sharing = owner.frameLocator('iframe[title="Sharing settings"]');
  await mutation(owner, () =>
    sharing.getByRole("button", { name: "Unlisted", exact: true }).click(),
  );
  assert.equal(
    owner.url(),
    documentURL,
    "sharing changes preserve the permanent document URL",
  );
  await reader.goto(documentURL);
  await reader
    .frameLocator("#pg-frame")
    .getByRole("button", { name: /^Count: \d+$/ })
    .waitFor();
  assert.equal(
    reader.url(),
    documentURL,
    "another account opens the same permanent identity",
  );
  await guest.goto(documentURL);
  await guest
    .frameLocator("#pg-frame")
    .getByRole("button", { name: /^Count: \d+$/ })
    .waitFor();
  assert.equal(
    guest.url(),
    documentURL,
    "anonymous unlisted access retains the same identity",
  );
  await guest.goto(origin);
  assert.equal(
    await guest.locator(`#public-files a[href="${documentPath}"]`).count(),
    0,
  );
  await mutation(owner, () =>
    sharing.getByRole("button", { name: "Private", exact: true }).click(),
  );
  const privateGuest = await guest.goto(documentURL);
  assert.ok(
    privateGuest.status() === 200 &&
      new URL(guest.url()).searchParams.has("next"),
    "private document sends anonymous reader to sign in",
  );
  assert.equal(await guest.locator("#pg-frame").count(), 0);
  const privateReader = await reader.goto(documentURL);
  assert.equal(
    privateReader.status(),
    404,
    "an unrelated signed-in account cannot open a private page address, which reveals nothing (404)",
  );
  assert.equal(await reader.locator("#pg-frame").count(), 0);
  await sharing.getByLabel("Invite email").fill(readerEmail);
  await mutation(owner, () =>
    sharing.getByRole("button", { name: "Add email", exact: true }).click(),
  );
  await sharing.getByLabel(`Role for ${readerEmail}`).waitFor();
  assert.equal(
    await sharing.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await owner.screenshot({
    path: "test-output/access-sharing-desktop.png",
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "sharing fits mobile viewport",
  );
  await owner.screenshot({
    path: "test-output/access-sharing-mobile.png",
    fullPage: true,
  });
  await owner
    .getByRole("button", { name: "Close sharing", exact: true })
    .click();
  assert.equal(
    await owner
      .getByRole("button", { name: "Page settings", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await owner
    .getByRole("button", { name: "Page settings", exact: true })
    .click();
  await owner.getByRole("button", { name: "Light mode", exact: true }).click();
  await owner
    .getByRole("button", { name: "Share / Manage access", exact: true })
    .click();
  await sharing.getByLabel(`Role for ${readerEmail}`).waitFor();
  assert.equal(
    await sharing.locator("html").getAttribute("data-theme"),
    "light",
  );
  await owner.screenshot({
    path: "test-output/access-sharing-mobile-light.png",
    fullPage: true,
  });
  await owner.setViewportSize({ width: 1280, height: 720 });
  await reader.goto(origin);
  await reader
    .getByRole("heading", { name: "Shared with you", exact: true })
    .waitFor();
  await reader.locator(`#shared-files a[href="${documentPath}"]`).click();
  // Local state belongs to each viewer: the owner's count stays the owner's.
  await reader
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .waitFor();
  await reader
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .click({ button: "right" });
  await reader.getByRole("menu").waitFor();
  assert.equal(
    await reader
      .getByRole("menuitem", { name: "Add comment", exact: true })
      .count(),
    0,
    "viewer cannot create hosted comments",
  );
  assert.equal(
    await reader
      .getByRole("menuitem", { name: "View-only access" })
      .isDisabled(),
    true,
  );
  await mutation(owner, () =>
    sharing.getByLabel(`Role for ${readerEmail}`).selectOption("commenter"),
  );
  await mutation(owner, () =>
    sharing.getByLabel(`Role for ${readerEmail}`).selectOption("editor"),
  );
  await mutation(owner, () =>
    sharing.getByLabel(`Role for ${readerEmail}`).selectOption("commenter"),
  );
  await reader.reload();
  await reader
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .click({ button: "right" });
  await reader
    .getByRole("menuitem", { name: "Add comment", exact: true })
    .click();
  await reader
    .getByRole("textbox", { name: "Comment text" })
    .fill("A newly permitted comment");
  await reader
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await reader.locator('.pg-message[data-sync="saved"]').waitFor();
  const revokedURL = reader.url();
  let closed = false;
  reader.on("websocket", (socket) =>
    socket.on("close", () => {
      closed = true;
    }),
  );
  // Reload once so the observer sees the authenticated live connection being revoked.
  await reader.reload();
  await reader
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .waitFor();
  await mutation(owner, () =>
    sharing
      .getByRole("button", { name: `Remove ${readerEmail}`, exact: true })
      .click(),
  );
  await assertEventually(
    () => closed,
    "revocation closes reader live connection",
  );
  const denied = await reader.goto(revokedURL);
  assert.ok(
    [401, 403, 404].includes(denied.status()),
    "removed reader cannot reload private document",
  );
  await mutation(owner, () =>
    sharing.getByRole("button", { name: "Public", exact: true }).click(),
  );
  await guest.goto(origin);
  await guest
    .getByRole("heading", { name: "Public documents", exact: true })
    .waitFor();
  await guest.locator(`#public-files a[href="${documentPath}"]`).click();
  await guest
    .frameLocator("#pg-frame")
    .getByRole("button", { name: "Count: 0", exact: true })
    .waitFor();
  assert.equal(
    (await guestContext.cookies()).some((c) => c.name === "pagegi_account"),
    false,
    "public guest requires no account session",
  );
  // Leave the disposable fixture private after checking public discovery.
  await mutation(owner, () =>
    sharing.getByRole("button", { name: "Private", exact: true }).click(),
  );
  console.log(
    "Access browser passed: account draft/state, private viewer invitation, promotion/comment, live revocation, public guest",
  );
} finally {
  await browser.close();
  if (service) {
    await service.close();
    await new Promise((resolve) => service.server.close(resolve));
    await db.cleanup();
  }
}
async function assertEventually(predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
