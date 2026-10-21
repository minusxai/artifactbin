import test from "node:test";
import assert from "node:assert/strict";
import { workspaceNavigation } from "../src/library-client/workspace-navigation.ts";
test("workspace navigation is available only for authenticated library and account views", () => {
  assert.deepEqual(workspaceNavigation("library"), {
    visible: true,
    active: "artifacts",
  });
  assert.deepEqual(workspaceNavigation("account"), {
    visible: true,
    active: "account",
  });
  for (const screen of ["welcome", "loading", "error"])
    assert.equal(workspaceNavigation(screen).visible, false);
});
