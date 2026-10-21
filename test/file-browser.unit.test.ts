import test from "node:test";
import assert from "node:assert/strict";
import {
  selectPaths,
  movePaths,
  canMoveTo,
  childPath,
} from "../src/file-browser.js";
test("selection toggles and extends a visible range from its anchor", () => {
  const visible = ["/a", "/b", "/c"];
  let state = selectPaths({ paths: [], anchor: null }, { path: "/a", visible });
  state = selectPaths(state, { path: "/c", visible, range: true });
  assert.deepEqual(state.paths, visible);
  assert.deepEqual(
    selectPaths(state, { path: "/b", visible, toggle: true }).paths,
    ["/a", "/c"],
  );
});
test("batch moves omit selected descendants and block self or descendant targets", () => {
  assert.deepEqual(movePaths(["/a/b", "/a", "/c", "/a"]), ["/a", "/c"]);
  assert.equal(canMoveTo(["/a"], "/a/b"), false);
  assert.equal(canMoveTo(["/a"], "/ab"), true);
  assert.equal(canMoveTo(["/a/b"], "/a"), false);
});
test("new folder names stay within the current directory", () => {
  assert.equal(childPath("/work", " Drafts "), "/work/Drafts");
  assert.throws(() => childPath("/work", "../private"));
  assert.throws(() => childPath("/", ".."));
  // Characters the server's paths refuse are named in plain words.
  assert.throws(() => childPath("/", "draft #2.html"), /can’t contain “#”/);
  assert.throws(() => childPath("/", "100%.html"), /can’t contain “%”/);
  assert.throws(() => childPath("/", "x".repeat(121)), /120 characters/);
});
