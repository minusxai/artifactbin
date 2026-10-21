import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  defaultPath,
  addDocument,
  changePaths,
  documentUrl,
} from "../src/path-model.ts";
test("paths normalize Unicode and encode each URL segment without permitting traversal or ambiguous URLs", () => {
  assert.equal(normalizePath("research/Notes.html"), "/research/Notes.html");
  assert.equal(normalizePath("/cafe\u0301/a.html"), "/café/a.html");
  assert.equal(
    documentUrl("/研究/notes 1.html"),
    "/f/%E7%A0%94%E7%A9%B6/notes%201.html",
  );
  for (const p of [
    "/a/../b",
    "/a/./b",
    "/a//b",
    "/a\\b",
    "/a%2fb",
    "/a?b",
    "/a#b",
    "/a\u0000b",
    "/",
    "/a/",
  ])
    assert.throws(() => normalizePath(p), p);
  assert.equal(normalizePath("/", true), "/");
});
test("new documents create parents and collisions never overwrite files or folders", () => {
  const entries = addDocument([], "/research/notes.html", "a");
  assert.deepEqual(entries, [
    { path: "/research", fileId: null },
    { path: "/research/notes.html", fileId: "a" },
  ]);
  assert.throws(() => addDocument(entries, "/research", "b"));
  assert.throws(() =>
    addDocument(entries, "/research/notes.html/sub.html", "b"),
  );
  assert.equal(defaultPath("Notes", entries), "/notes.html");
  assert.equal(
    defaultPath("Notes", [{ path: "/notes.html", fileId: "a" }]),
    "/notes-2.html",
  );
  assert.equal(
    defaultPath("Team todo list", entries, "/Projects"),
    "/Projects/team-todo-list.html",
  );
  assert.equal(
    defaultPath(
      "Team todo list",
      [{ path: "/Projects/team-todo-list.html", fileId: "a" }],
      "/Projects",
    ),
    "/Projects/team-todo-list-2.html",
  );
});
test("folder moves are atomic, preserve IDs, reject cycles/conflicts and remove only empty folders", () => {
  const before = addDocument([], "/research/nested/notes.html", "a");
  const moved = changePaths(before, {
    kind: "move",
    from: "/research",
    path: "/archive",
  });
  assert.equal(
    moved.find((x) => x.fileId === "a")?.path,
    "/archive/nested/notes.html",
  );
  assert.equal(
    before.find((x) => x.fileId === "a")?.path,
    "/research/nested/notes.html",
  );
  assert.throws(() =>
    changePaths(before, {
      kind: "move",
      from: "/research",
      path: "/research/nested/new",
    }),
  );
  assert.throws(() =>
    changePaths(before, { kind: "remove-folder", path: "/research" }),
  );
  const extra = changePaths(before, { kind: "folder", path: "/empty" });
  assert.equal(
    changePaths(extra, { kind: "remove-folder", path: "/empty" }).length,
    before.length,
  );
  assert.throws(() =>
    changePaths(extra, { kind: "move", from: "/research", path: "/empty" }),
  );
  assert.throws(() =>
    changePaths(before, { kind: "move", from: "/missing", path: "/new" }),
  );
});
test("batch moves preserve identities, deduplicate nested selections and never partially move", () => {
  const before = [
    ...addDocument([], "/work/nested/a.html", "a"),
    { path: "/b.html", fileId: "b" },
    { path: "/archive", fileId: null },
  ];
  const after = changePaths(before, {
    kind: "move-many",
    paths: ["/work", "/work/nested/a.html", "/b.html", "/work"],
    destination: "/archive",
  });
  assert.equal(
    after.find((x) => x.fileId === "a")?.path,
    "/archive/work/nested/a.html",
  );
  assert.equal(after.find((x) => x.fileId === "b")?.path, "/archive/b.html");
  assert.equal(before.find((x) => x.fileId === "b")?.path, "/b.html");
  assert.deepEqual(
    changePaths(before, {
      kind: "move-many",
      paths: ["/work", "/b.html"],
      destination: "/",
    }),
    before,
  );
  for (const change of [
    { paths: ["/work"], destination: "/work/nested" },
    { paths: ["/work"], destination: "/work" },
    { paths: ["/missing", "/b.html"], destination: "/archive" },
    { paths: [], destination: "/archive" },
    { paths: ["/b.html"], destination: "/absent" },
    { paths: ["/work"], destination: "/b.html" },
  ])
    assert.throws(() => changePaths(before, { kind: "move-many", ...change }));
  const conflict = [...before, { path: "/archive/b.html", fileId: "c" }];
  assert.throws(
    () =>
      changePaths(conflict, {
        kind: "move-many",
        paths: ["/work", "/b.html"],
        destination: "/archive",
      }),
    { status: 409 },
  );
  assert.equal(
    conflict.find((x) => x.fileId === "a")?.path,
    "/work/nested/a.html",
  );
});
test("batch moves reject colliding selected basenames and normalize destination", () => {
  const before = [
    ...addDocument([], "/a/report.html", "a"),
    ...addDocument([], "/b/report.html", "b"),
    { path: "/café", fileId: null },
  ];
  assert.throws(
    () =>
      changePaths(before, {
        kind: "move-many",
        paths: ["/a/report.html", "/b/report.html"],
        destination: "/café",
      }),
    { status: 409 },
  );
  assert.equal(
    changePaths(before, {
      kind: "move-many",
      paths: ["/a/report.html"],
      destination: "/cafe\u0301",
    }).find((x) => x.fileId === "a")?.path,
    "/café/report.html",
  );
});

test("canonical document addresses retain nested Unicode paths and owner identity", () => {
  assert.equal(
    documentUrl("/研究/notes 1.html", "owner space"),
    "/f/%E7%A0%94%E7%A9%B6/notes%201.html?space=owner%20space",
  );
});
