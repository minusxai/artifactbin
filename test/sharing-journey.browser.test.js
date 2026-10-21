import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
let policy = {
  visibility: "unlisted",
  linkRole: "viewer",
  shares: { "reader@example.test": "viewer" },
  version: 1,
};
let manage = true,
  stale = false;
const patches = [];
let expectedAuthorization;
const assets = new Map([
  ["/sharing.js", ["src/browser/sharing.js", "text/javascript"]],
  ["/chrome.css", ["src/browser/chrome.css", "text/css"]],
  ["/sharing.css", ["src/browser/sharing.css", "text/css"]],
]);
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    assert.equal(req.headers["x-pagegi-home"], "1");
    if (req.headers.authorization !== expectedAuthorization) {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const patch = JSON.parse(body);
      patches.push(patch);
      assert.equal(req.headers["if-match"], String(policy.version));
      if (stale) {
        stale = false;
        policy.version++;
        res.writeHead(412);
        res.end("{}");
        return;
      }
      if ("email" in patch) {
        if (patch.role === null) delete policy.shares[patch.email];
        else policy.shares[patch.email] = patch.role;
      } else Object.assign(policy, patch);
      policy.version++;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        policy,
        permissions: { manage },
        url: "/f/example?space=public-space",
        owner: "owner@example.test",
      }),
    );
    return;
  }
  const asset = assets.get(req.url);
  if (asset) {
    res.setHeader("Content-Type", asset[1]);
    res.end(await readFile(asset[0]));
    return;
  }
  if (req.url !== "/" && !req.url.startsWith("/?")) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<link rel="stylesheet" href="/chrome.css"><link rel="stylesheet" href="/sharing.css"><main></main><script type="module">import {renderSharing,openSharing} from "/sharing.js";window.openSharing=openSharing;renderSharing(document.querySelector("main"),"file",{token:()=>new URL(location.href).searchParams.has("authenticated")?"test-frame-token":undefined});</script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  // Use raw request paths: fetch/URL would normalize dot segments before sending.
  for (const path of [
    "/../home.css",
    "/../",
    "/sharing.js?unknown=1",
    "/%2e%2e/home.css",
    "/unknown.css",
    "/missing",
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(origin, { path }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 404, `Unmapped asset ${path} must not be served`);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          window.copiedLink = value;
        },
      },
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Public", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-pressed="true"]')?.textContent === "Public",
  );
  await page.getByLabel("Link role", { exact: true }).selectOption("commenter");
  await page.getByLabel("Invite email").fill("new@example.test");
  await page.getByLabel("Invite role").selectOption("editor");
  stale = true;
  await page.getByRole("button", { name: "Add email" }).click();
  await page.getByRole("alert").filter({ hasText: "changed" }).waitFor();
  assert.equal(
    await page.getByLabel("Invite email").inputValue(),
    "new@example.test",
  );
  assert.equal(await page.getByLabel("Invite role").inputValue(), "editor");
  await page.getByRole("button", { name: "Add email" }).click();
  await page.getByLabel("Role for new@example.test", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Remove new@example.test", exact: true })
    .click();
  await page
    .getByLabel("Role for new@example.test", { exact: true })
    .waitFor({ state: "detached" });
  assert.deepEqual(patches[0], { visibility: "public" });
  assert.deepEqual(patches[1], { linkRole: "commenter" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  expectedAuthorization = "Bearer test-frame-token";
  await page.goto(origin + "/?authenticated=1");
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-pressed="true"]')?.textContent ===
      "Private",
  );
  await page
    .getByText("Access changes cannot revoke previously downloaded copies.", {
      exact: true,
    })
    .waitFor();
  expectedAuthorization = undefined;
  manage = false;
  await page.goto(origin);
  await page.getByRole("button", { name: "Copy link", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Invite email").count(), 0);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Link copied" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.copiedLink),
    origin + "/f/example?space=public-space",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.evaluate((origin) => window.openSharing(origin, "file"), origin);
  await page.getByRole("dialog", { name: "Share", exact: true }).waitFor();
  assert.equal(
    new URL(
      await page
        .locator('iframe[title="Sharing settings"]')
        .getAttribute("src"),
    ).searchParams.get("theme"),
    "dark",
  );
  await page.evaluate(() =>
    dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        data: { type: "pagegi-sharing", event: "close" },
      }),
    ),
  );
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  await page
    .getByRole("button", { name: "Close sharing", exact: true })
    .click();
  console.log(
    "Sharing: roles, grants, removal, stale drafts, reader permissions, mobile and message isolation passed",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
