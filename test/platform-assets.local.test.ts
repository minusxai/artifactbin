import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformAssets } from "../src/server/assets.ts";
test("platform assets allowlist paths and keep credential frame and account framing policies separate", () => {
  const assets = createPlatformAssets();
  const get = (path: string) =>
    assets.resolve("GET", new URL(path, "https://example.test"));
  assert.equal(assets.resolve("POST", new URL("https://example.test/")), null);
  assert.equal(
    assets.resolve("HEAD", new URL("https://example.test/"))?.headers["Content-Type"],
    "text/html; charset=utf-8",
    "HEAD answers like GET",
  );
  assert.equal(get("/package.json"), null);
  assert.equal(get("/../server.js"), null);
  assert.match(
    get("/")!.headers["Content-Security-Policy"]!,
    /frame-ancestors 'none'/,
  );
  assert.match(
    get("/?embed")!.headers["Content-Security-Policy"]!,
    /127.0.0.1/,
  );
  assert.doesNotMatch(
    get("/platform-frame")!.headers["Content-Security-Policy"]!,
    /frame-ancestors/,
  );
  // The approval window a downloaded file opens to connect: its own script, nothing inline, never framed.
  const approval = get("/connect?code=expired")!;
  assert.match(approval.headers["Content-Security-Policy"]!, /script-src 'self'/);
  assert.match(approval.headers["Content-Security-Policy"]!, /frame-ancestors 'none'/);
  assert.match(String(approval.body), /<title>Connect · Artifactbin<\/title>/);
  assert.match(String(approval.body), /<h1>Connect to Artifactbin<\/h1>/);
  assert.match(String(approval.body), /<script src="\/connect\.js"/);
  assert.doesNotMatch(String(approval.body), /<script>/);
  assert.ok(get("/connect.js"), "the approval window's script is served");
  // A home page requested without the account cookie says so, and only then.
  const signedOut = assets.resolve("GET", new URL("https://example.test/"), { signedIn: false })!;
  assert.match(String(signedOut.body), /<meta name="pagegi-session" content="none">/);
  assert.doesNotMatch(String(get("/")!.body), /pagegi-session/);
});
