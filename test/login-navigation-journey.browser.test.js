import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";

// Real email-code login, session cookie and private permanent document route.
const db = await testDatabase();
let now = Date.now();
const delivered = new Map();
const service = createService({ ...db, now: () => now, allowPasswordLogin: false, sendCode: async ({ to, code }) => delivered.set(to, code) });
await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${service.server.address().port}`;
const email = "navigation-fixture@example.com";
async function post(path, body, token) {
  const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
try {
  await post("/api/auth/email/request", { email });
  const account = await post("/api/auth/email/verify", { email, code: delivered.get(email) });
  const publication = await post("/api/publish", { source: '<!doctype html><html><head><script src="https://artifactbin.dev/af/v1/core.js"></script><title>Private navigation fixture</title></head><body><h1 id="destination">Private document destination</h1></body></html>', requestId: crypto.randomUUID(), visibility: "private", linkRole: "viewer" }, account.token);
  const path = new URL(publication.url).pathname;
  assert.match(path, /^\/a\/[A-Za-z0-9]{6}$/, "a published page has a permanent address");
  const engines = process.argv[2] ? { [process.argv[2]]: { chromium, firefox, webkit }[process.argv[2]] } : { chromium, firefox, webkit };
  for (const [name, engine] of Object.entries(engines)) {
    now += 61_000;
    delivered.delete(email);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(origin + path);
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(new URL(page.url()).searchParams.get("next"), path);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email address").fill(email);
      await dialog.getByRole("button", { name: "Send code", exact: true }).click();
      await dialog.getByLabel("Email code").waitFor();
      assert.match(delivered.get(email) ?? "", /^\d{6}$/);
      await dialog.getByLabel("Email code").fill(delivered.get(email));
      await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(origin + path);
      await page.frameLocator("#pg-frame").locator("#destination").waitFor();
      assert.equal(await page.frameLocator("#pg-frame").locator("#destination").textContent(), "Private document destination");
      assert.ok((await page.context().cookies()).some((cookie) => cookie.name === "pagegi_account" && cookie.httpOnly));
      for (const rejected of ["//external.example/af/v1/ids/abcdef", "/af/v1/ids/%2e%2e/account", "/d/abcdef"]) {
        await page.goto(origin + "/?next=" + encodeURIComponent(rejected));
        await page.getByRole("heading", { name: "Your documents", exact: true }).waitFor();
        assert.equal(new URL(page.url()).origin, origin);
        assert.equal(new URL(page.url()).pathname, "/");
      }
      console.log(`${name}: private page address email-modal return and unsafe destination rejection passed`);
    } finally { await browser.close(); }
  }
} finally {
  await service.close();
  service.server.closeAllConnections();
  await new Promise((resolve) => service.server.close(resolve));
  await db.cleanup();
}
