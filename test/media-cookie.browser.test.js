import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createTlsServer } from "node:https";
import { request as proxyRequest } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { createService } from "../src/server.js";
import { mediaAddress } from "../src/media/address.ts";
import { testDatabase } from "./postgres.js";

test("private raster loads from a same-site sibling runner using the real account cookie, without CORS access", async () => {
  const db = await testDatabase(),
    root = await mkdtemp(join(tmpdir(), "media-cookie-")),
    codes = new Map();
  // An ephemeral test TLS certificate gives the real Secure/SameSite cookie path its production semantics.
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=app.example.test",
    ],
    { stdio: "ignore" },
  );
  let service, backendPort, platform;
  const mediaResponses = [];
  const proxy = createTlsServer(
    {
      key: await readFile(join(root, "key.pem")),
      cert: await readFile(join(root, "cert.pem")),
    },
    (req, res) => {
      if (req.headers.host?.startsWith("evil.example.invalid")) {
        res.setHeader("Content-Type", "text/html");
        return res.end(
          `<!doctype html><img id="private" src="${platform + mediaAddress({ pageId: "AST001", revision: "1", variant: "original", sha256 })}">`,
        );
      }
      const target = proxyRequest(
        {
          host: "127.0.0.1",
          port: backendPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          if (req.url.includes("/assets/"))
            mediaResponses.push({
              path: req.url,
              status: response.statusCode,
              cookiePresent: !!req.headers.cookie,
            });
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      target.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(target);
    },
  );
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = proxy.address().port;
  platform = `https://app.example.test:${port}`;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/wAAAABJRU5ErkJggg==",
    "base64",
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  service = createService({
    ...db,
    platformOrigin: platform,
    runnerOrigin: `https://{document}.pages.example.test:${port}`,
    mediaDirectory: root,
    sendCode: async ({ to, code }) => codes.set(to, code),
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  backendPort = service.server.address().port;
  const browser = await chromium.launch({
    args: [
      "--host-resolver-rules=MAP *.example.test 127.0.0.1, MAP *.example.invalid 127.0.0.1",
      "--no-proxy-server",
    ],
  });
  try {
    // Trust only the ephemeral fixture certificate; no production origins or credentials are involved.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(platform + "/health");
    assert.equal(
      await page.evaluate(
        async () =>
          (
            await fetch("/api/auth/email/request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: "owner@example.test" }),
            })
          ).status,
      ),
      200,
    );
    const code = codes.get("owner@example.test");
    assert.ok(code);
    const signedIn = await page.evaluate(async (code) => {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.test",
          code,
          browserSession: true,
        }),
      });
      return { status: response.status, body: await response.json() };
    }, code);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.token, undefined);
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === "pagegi_account",
    );
    assert.ok(cookie.httpOnly && cookie.secure);
    assert.equal(cookie.sameSite, "Strict");
    assert.equal(cookie.domain, "app.example.test");
    const url = (id) =>
      platform +
      mediaAddress({ pageId: id, revision: "1", variant: "original", sha256 });
    for (const [id, visibility, isAsset, target] of [
      ["AST001", "private", true, null],
      ["IMG002", "unlisted", true, null],
      ["WRP001", "private", false, "AST001"],
      ["GUE001", "unlisted", false, "IMG002"],
    ]) {
      await db.pool.query(
        "INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES($1,'owner@example.test','page',true,0)",
        [id],
      );
      await db.pool.query(
        "INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES($1,'owner@example.test','unused',1,'1',$2::jsonb)",
        [
          id,
          JSON.stringify({
            visibility,
            linkRole: "viewer",
            shares: {},
            version: 1,
          }),
        ],
      );
      const html = `<!doctype html><html><head><script data-af="meta" type="application/json">${JSON.stringify({ id, version: 1 })}</script><script data-af="core" src="${platform}/af/v1/core.js"></script><title>Media fixture</title></head><body><img id="preview" data-af-id="preview" src="${url(target || id)}"></body></html>`;
      await db.pool.query(
        "INSERT INTO sources(file_id,revision,content) VALUES($1,'1',$2)",
        [id, html],
      );
      if (isAsset)
        await db.pool.query(
          "INSERT INTO page_assets(page_id,revision,variant,sha256,content_type,filename,byte_length,storage_key) VALUES($1,'1','original',$2,'image/png','sample.png',$3,$2)",
          [id, sha256, bytes.length],
        );
    }
    await writeFile(join(root, sha256), bytes, { mode: 0o600 });
    const imageResponse = page.waitForResponse(
      (response) => response.url() === url("AST001"),
    );
    await page.goto(platform + "/a/WRP001");
    const response = await imageResponse;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["access-control-allow-origin"], undefined);
    const frame = page.frameLocator("#pg-frame");
    await frame.locator("#preview").waitFor();
    assert.equal(
      await frame.locator("#preview").evaluate((image) => image.naturalWidth),
      1,
    );
    const runner = page
      .frames()
      .find((frame) => frame.url().includes(".pages.example.test"));
    assert.ok(runner);
    assert.notEqual(new URL(runner.url()).origin, platform);
    assert.equal(
      await runner.evaluate(async (url) => {
        try {
          await fetch(url, { credentials: "include" });
          return true;
        } catch {
          return false;
        }
      }, url("AST001")),
      false,
      "sibling author code cannot CORS-read private bytes",
    );
    assert.equal(
      await runner.evaluate(() => document.cookie),
      "",
      "account cookie never belongs to the runner",
    );
    const guest = await browser.newContext({ ignoreHTTPSErrors: true });
    const guestPage = await guest.newPage();
    guestPage.setDefaultTimeout(10000);
    await guestPage.goto(platform + "/a/GUE001");
    await guestPage.frameLocator("#pg-frame").locator("#preview").waitFor();
    assert.equal(
      await guestPage
        .frameLocator("#pg-frame")
        .locator("#preview")
        .evaluate((image) => image.naturalWidth),
      1,
    );
    const denied = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url() === url("AST001"),
    });
    await page.goto(`https://evil.example.invalid:${port}/`);
    assert.match((await denied).failure().errorText, /ERR_BLOCKED_BY_RESPONSE/);
    assert.equal(mediaResponses.at(-1).status, 404);
    assert.equal(mediaResponses.at(-1).cookiePresent, false);
    await page.waitForFunction(
      () => document.querySelector("#private")?.complete,
    );
    assert.equal(
      await page.locator("#private").evaluate((image) => image.naturalWidth),
      0,
    );
    await guest.close();
    await context.close();
  } finally {
    await browser.close();
    service.server.closeAllConnections();
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
    await db.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
