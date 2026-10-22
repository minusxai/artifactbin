import test from "node:test";
import assert from "node:assert/strict";
import {
  namespaceLibraryPath,
  namespaceNavigation,
} from "../src/library-client/namespace.ts";
test("namespace navigation preserves owner only on namespace operations and folder locators", () => {
  assert.equal(
    namespaceLibraryPath("/api/library", "group:fixture"),
    "/api/library?owner=group%3Afixture",
  );
  assert.equal(
    namespaceLibraryPath("/api/library/profile", "group:fixture"),
    "/api/library/profile",
  );
  assert.equal(
    namespaceLibraryPath("/api/trash/folders", "group:fixture"),
    "/api/trash/folders?owner=group%3Afixture",
  );
  assert.equal(
    namespaceLibraryPath("/api/trash?owner=group%3Afixture", "group:fixture"),
    "/api/trash?owner=group%3Afixture",
  );
  const viewer = namespaceNavigation(
    {
      owner: "group:fixture",
      kind: "group",
      name: "Fixture",
      handle: null,
      role: "viewer",
    },
    "/folder",
  );
  assert.equal(viewer.manage, false);
  assert.equal(viewer.create, false);
  assert.match(viewer.url, /owner=group%3Afixture/);
  assert.match(viewer.url, /folder=%2Ffolder/);
  assert.equal(
    namespaceNavigation({
      owner: "group:fixture",
      kind: "group",
      name: "Fixture",
      handle: null,
      role: "editor",
    }).manage,
    true,
  );
  assert.equal(namespaceNavigation(undefined).create, true);
});
