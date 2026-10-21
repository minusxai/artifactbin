import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createPlatformAssets } from "../src/server/assets.ts";
import { INSTALLER_ARCHIVE_PATH } from "../src/server/installer-archive-contracts.ts";

test("the public npm installer tarball is served through GET and HEAD only", () => {
 const assets = createPlatformAssets();
 const url = new URL(INSTALLER_ARCHIVE_PATH, "https://example.invalid");
 const result = assets.resolve("GET", url, {signedIn:false});
 assert.ok(result);
 assert.equal(result.headers["Content-Type"], "application/gzip");
 const tar = gunzipSync(result.body as Uint8Array).toString();
 assert.match(tar, /package\/package.json/);
 assert.match(tar, /package\/install.mjs/);
 assert.match(tar, /"artefactbin-skill"/);
 assert.equal(assets.resolve("HEAD", url)?.headers["Content-Type"], "application/gzip");
 assert.equal(assets.resolve("POST", url), null);
});
