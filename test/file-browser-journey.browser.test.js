import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
const target = process.env.PAGEGI_TEST_ORIGIN;
const identity = target
  ? JSON.parse(readFileSync(process.env.PAGEGI_TEST_ACCOUNTS, "utf8"))[0]
  : null;
const db = target ? null : await testDatabase();
let code, service;
if (!target) {
  service = createService({
    ...db,
    allowPasswordLogin: false,
    sendCode: async (m) => {
      code = m.code;
    },
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
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
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (identity) {
    await context.addCookies([
      {
        name: "pagegi_account",
        value: identity.token,
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
    ]);
    await page.goto(origin);
  } else {
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Sign in with your email", exact: true })
      .click();
    await page.getByLabel("Email address").fill("mxmx_test_files@example.com");
    await page
      .getByRole("button", { name: "Log in with email", exact: true })
      .click();
    await page.getByLabel("Email code").waitFor();
    await page.getByLabel("Email code").fill(code);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Log in", exact: true })
      .click();
  }
  await page.locator("#library").waitFor();
  // Keep API setup on the browser origin so the optional address resolver and
  // the fixture cookie apply identically to setup and user interactions.
  const browserRequest = async (url, options = {}) => {
    const result = await page.evaluate(
      async ({ url, data }) => {
        const response = await fetch(url, {
          method: data ? "POST" : "GET",
          headers: { "X-Pagegi-Home": "1", "Content-Type": "application/json" },
          ...(data ? { body: JSON.stringify(data) } : {}),
        });
        return { status: response.status, body: await response.json() };
      },
      { url, data: options.data },
    );
    return { status: () => result.status, json: async () => result.body };
  };
  const api = async (body) => {
    const r = await browserRequest(origin + "/api/library/paths", {
      headers: { "X-Pagegi-Home": "1", Origin: origin },
      data: body,
    });
    return { status: r.status(), body: await r.json() };
  };
  for (const path of ["/Work", "/Work/Archive", "/Projects"])
    assert.equal((await api({ kind: "folder", path })).status, 200);
  for (const name of ["brief.html", "notes.html"]) {
    const r = await browserRequest(origin + "/api/library", {
      headers: { "X-Pagegi-Home": "1", Origin: origin },
      data: {
        path: "/" + name,
        html:
          "<!doctype html><title>" +
          name +
          '</title><h1 data-pagegi-id="title">Notes</h1>',
        requestId: crypto.randomUUID(),
      },
    });
    assert.equal(r.status(), 201);
  }
  await page.reload();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  assert.equal(
    await page.locator("#files").getAttribute("data-layout"),
    "list",
  );
  await page.getByRole("button", { name: "Gallery view", exact: true }).click();
  assert.equal(
    await page.locator("#files").getAttribute("data-layout"),
    "gallery",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Gallery view", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByLabel("Select brief.html", { exact: true }).check();
  await page.getByLabel("Select notes.html", { exact: true }).check();
  assert.equal(
    await page.locator("#selection-count").textContent(),
    "2 selected",
  );
  await page.getByRole("button", { name: "Move to…", exact: true }).click();
  await page.getByRole("treeitem", { name: "▱ Work", exact: true }).click();
  await page.getByRole("button", { name: "Move here", exact: true }).click();
  await page.locator("#move-dialog").waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("Drafts");
  await page.getByLabel("Folder name", { exact: true }).press("Enter");
  await page.getByRole("link", { name: "Drafts", exact: true }).waitFor();
  await page
    .locator('[data-path="/Work/brief.html"]')
    .dragTo(page.locator('[data-path="/Work/Archive"]'));
  await page
    .locator('[data-path="/Work/brief.html"]')
    .waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await page
    .locator('[data-path="/Work/Archive/brief.html"]')
    .dragTo(page.locator("#breadcrumbs a").first());
  await page
    .locator('[data-path="/Work/Archive/brief.html"]')
    .waitFor({ state: "hidden" });
  await page.goto(origin);
  await page.locator('[data-path="/Work"] summary').click();
  await page.getByRole("button", { name: "Move to…", exact: true }).click();
  assert.equal(
    await page
      .getByRole("treeitem", { name: "▱ Archive", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Close folder picker", exact: true })
    .click();
  await page.getByLabel("Select brief.html", { exact: true }).check();
  await page.getByRole("button", { name: "Move to…", exact: true }).click();
  await page.getByText("Enter a path", { exact: true }).click();
  await page.getByLabel("Destination path").fill("/Projects");
  await page.getByRole("button", { name: "Move here", exact: true }).click();
  await page.locator("#move-dialog").waitFor({ state: "hidden" });
  assert.equal(
    (
      await api({
        kind: "move-many",
        paths: ["/Work", "/Projects"],
        destination: "/Work/Archive",
      })
    ).status,
    409,
  );
  const listing = await browserRequest(origin + "/api/library", {
    headers: { "X-Pagegi-Home": "1" },
  });
  assert.ok((await listing.json()).folders.includes("/Projects"));
  await browserRequest(origin + "/api/library", {
    headers: { "X-Pagegi-Home": "1", Origin: origin },
    data: {
      path: "/Projects/notes.html",
      html: '<!doctype html><title>Existing notes</title><h1 data-pagegi-id="title">Existing</h1>',
      requestId: crypto.randomUUID(),
    },
  });
  assert.equal(
    (
      await api({
        kind: "move-many",
        paths: ["/Work/Drafts", "/Work/notes.html"],
        destination: "/Projects",
      })
    ).status,
    409,
  );
  const afterCollision = await browserRequest(origin + "/api/library", {
    headers: { "X-Pagegi-Home": "1" },
  });
  const preserved = await afterCollision.json();
  assert.ok(preserved.folders.includes("/Work/Drafts"));
  assert.ok(preserved.files.some((file) => file.path === "/Work/notes.html"));
  await page.goto(origin + "/?folder=%2FWork");
  await page.getByRole("link", { name: "notes.html", exact: true }).waitFor();
  mkdirSync("test-output", { recursive: true });
  for (const width of [1280, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((theme) => {
        localStorage.setItem("pagegi-theme", theme);
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.screenshot({
        path: `test-output/file-browser-${width}-${theme}.png`,
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
  assert.deepEqual(errors, []);
  console.log(
    "File browser: selection, folder naming, picker path, folder/breadcrumb drag, blocked descendants, atomic rejection, desktop/mobile themes passed",
  );
} finally {
  await browser.close();
  if (service) {
    await service.close();
    await new Promise((r) => service.server.close(r));
    await db.cleanup();
  }
}
