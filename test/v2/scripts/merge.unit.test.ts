import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3, unifiedDiff } from "../../../src/af-script/merge.ts";
import { mergePages, stripIdentity } from "../../../src/af-script/page-merge.ts";

const lines = (...items: string[]) => items.map((item) => item + "\n").join("");

test("changes to different lines merge; the same change on both sides merges once", () => {
  const base = lines("a", "b", "c", "d", "e");
  const merged = merge3(base, lines("a", "B", "c", "d", "e"), lines("a", "b", "c", "D", "e", "f"));
  assert.deepEqual(merged, { clean: true, text: lines("a", "B", "c", "D", "e", "f"), conflicts: [] });
  const same = merge3(base, lines("a", "x", "c", "d", "e"), lines("a", "x", "c", "d", "e"));
  assert.equal(same.clean, true);
  assert.equal(same.text, lines("a", "x", "c", "d", "e"));
  assert.equal(merge3(base, base, lines("z")).text, lines("z"), "one side only");
});

test("different changes to the same lines, and two insertions at one point, conflict", () => {
  const base = lines("a", "b", "c");
  const overlap = merge3(base, lines("a", "mine", "c"), lines("a", "theirs", "c"));
  assert.equal(overlap.clean, false);
  assert.deepEqual(overlap.conflicts, [{ base: [2, 2], local: [2, 2], remote: [2, 2] }]);
  const inserted = merge3(base, lines("a", "b", "mine", "c"), lines("a", "b", "theirs", "c"));
  assert.equal(inserted.clean, false);
  assert.deepEqual(inserted.conflicts, [{ base: [3, 2], local: [3, 3], remote: [3, 3] }]);
});

test("a large file with repeated lines diffs exactly around the change", () => {
  const body = Array.from({ length: 3000 }, (_, index) => (index % 10 ? `<li>item</li>` : `<li>row ${index}</li>`));
  const base = lines(...body);
  const ours = lines(...body.slice(0, 100), "<li>new</li>", ...body.slice(100));
  const theirs = lines(...body.slice(0, 2900), ...body.slice(2901));
  const merged = merge3(base, ours, theirs);
  assert.equal(merged.clean, true);
  assert.equal(merged.text, lines(...body.slice(0, 100), "<li>new</li>", ...body.slice(100, 2900), ...body.slice(2901)));
});

test("unified diff has standard hunks with three lines of context", () => {
  const before = lines("1", "2", "3", "4", "5", "6", "7", "8", "9", "10");
  const after = lines("1", "2", "3", "4", "five", "6", "7", "8", "9", "10", "11");
  assert.equal(
    unifiedDiff(before, after, "base", "local"),
    "--- base\n+++ local\n@@ -2,9 +2,10 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n 9\n 10\n+11\n",
  );
  assert.equal(unifiedDiff(before, before, "a", "b"), "");
  assert.equal(unifiedDiff("x", "y", "a", "b"), "--- a\n+++ b\n@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file\n");
});

test("page merges ignore the platform's meta members and keep node IDs", () => {
  const head = (meta: string, body: string) =>
    `<html><head>\n<script type="application/json" data-af="meta">${meta}</script>\n</head><body>\n${body}\n</body></html>\n`;
  const base = head('{ "name": "Plan", "id": "Pg4mQ2", "version": 1, "nextNodeId": 3 }', '<p data-af-id="n1">a</p>\n<p data-af-id="n2">b</p>');
  const ours = head('{ "name": "My plan", "id": "Pg4mQ2", "version": 1, "nextNodeId": 3 }', '<p data-af-id="n1">a</p>\n<p data-af-id="n2">b</p>');
  const theirs = head('{ "name": "Plan", "id": "Pg4mQ2", "version": 2, "nextNodeId": 4 }', '<p data-af-id="n1">a</p>\n<p data-af-id="n2">B</p>\n<p data-af-id="n3">c</p>');
  const merged = mergePages(base, ours, theirs);
  assert.equal(merged.clean, true);
  assert.equal(
    merged.text,
    head('{ "name": "My plan", "id": "Pg4mQ2", "version": 2, "nextNodeId": 4 }', '<p data-af-id="n1">a</p>\n<p data-af-id="n2">B</p>\n<p data-af-id="n3">c</p>'),
  );
  assert.equal(
    stripIdentity(theirs),
    head('{ "name": "Plan" }', '<p data-af-id="n1">a</p>\n<p data-af-id="n2">B</p>\n<p data-af-id="n3">c</p>'),
  );
});
