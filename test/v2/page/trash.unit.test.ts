import test from "node:test";
import assert from "node:assert/strict";
import { restorePaths } from "../../../src/trash/model.ts";
test("restore preserves paths while a parent exists and falls back to root otherwise", () => {
  const item = { id: "Ab1234", path: "folder/page", kind: "page" as const };
  assert.equal(restorePaths([item], item, ["folder"])[0]?.path, "folder/page");
  assert.equal(restorePaths([item], item, [])[0]?.path, "page");
});
test("restore refuses collision instead of overwriting a newer live file", () => {
  const item = { id: "Ab1234", path: "folder/page", kind: "page" as const };
  assert.throws(() => restorePaths([item], item, ["page"]), /restore path/);
});

test("restore maps a complete folder subtree and keeps leading slashes at root", () => {
  const root = { id: "folder", path: "/gone/sub", kind: "folder" as const };
  const child = {
    id: "page",
    path: "/gone/sub/deep/file.html",
    kind: "page" as const,
  };
  assert.deepEqual(
    restorePaths([root, child], root, []).map((e) => e.path),
    ["/sub", "/sub/deep/file.html"],
  );
  assert.throws(
    () => restorePaths([root, child], root, ["/sub/deep/file.html"]),
    /restore path/,
  );
});

test('a former parent replaced by a page is not a restore destination', () => {
 const item = {id:'page',path:'/parent/child.html',kind:'page' as const};
 assert.equal(restorePaths([item],item,['/parent'],[])[0]?.path,'/child.html');
});
