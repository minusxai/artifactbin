import test from "node:test";
import assert from "node:assert/strict";
import { validCompiledBrowserImports as valid } from "../src/migration/conversion/compiled/browser-imports.ts";
test("prototype preserves external HTTPS module dependencies while strict and platform bare imports remain closed", () => {
  const apollo = { external: true, path: "@afbin/apollo" },
    remote = { external: true, path: "https://example.invalid/module.js" };
  assert.equal(valid([apollo], false), true);
  assert.equal(valid([apollo, remote], false), false);
  assert.equal(valid([apollo, remote], true), true);
  for (const path of [
    "@mx/boot",
    "/api/private",
    "http://example.invalid/module.js",
    "file:///tmp/module.js",
    "javascript:alert(1)",
  ])
    assert.equal(valid([{ external: true, path }], true), false);
  assert.equal(valid([{ ...remote, external: false }], true), false);
});
