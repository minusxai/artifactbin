import test from "node:test";
import assert from "node:assert/strict";
import {
  planFolderTitles,
  changeFolderLocations,
} from "../src/migration/folder-title-plan.ts";
import type {
  RetainedFolderDescriptor,
  RetainedFolderLocation,
} from "../src/migration/folder-title-contracts.ts";
const folder = (
  legacyId: string,
  title: string,
  expectedPath: string,
  ancestorIds: string[] = [],
): RetainedFolderDescriptor => ({
  namespace: "fixture",
  legacyId,
  owner: "owner",
  title,
  expectedPath,
  ancestorIds,
  sourceRevision: "revision",
  deleted: false,
});

test("readable nested paths preserve files and exact imported IDs without changing input", () => {
  const rows = [
    folder("parent", "Research", "/imported/a"),
    folder("child", "Notes", "/imported/a/b", ["parent"]),
  ];
  const paths = {
    owner: [
      { path: "/imported", fileId: null },
      { path: "/imported/a", fileId: null },
      { path: "/imported/a/b", fileId: null },
      { path: "/imported/a/b/page.html", fileId: "page" },
    ],
  };
  const original = structuredClone(paths);
  const plan = planFolderTitles(rows, paths);
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.deepEqual(paths, original);
  assert.ok(
    plan.result.owner!.some(
      (p) =>
        p.path === "/imported/Research/Notes/page.html" && p.fileId === "page",
    ),
  );
  assert.deepEqual(
    plan.locations.map((l) => (l.state === "live" ? [l.legacyId, l.path] : [])),
    [
      ["parent", "/imported/Research"],
      ["child", "/imported/Research/Notes"],
    ],
  );
  assert.deepEqual(plan.expected, paths);
});

test("title collisions are stable across input order and never overwrite unrelated paths", () => {
  const rows = [
    folder("a", "Same", "/imported/a"),
    folder("b", "Same", "/imported/b"),
  ];
  const paths = {
    owner: [
      { path: "/imported/a", fileId: null },
      { path: "/imported/b", fileId: null },
      { path: "/imported/Same", fileId: "existing" },
    ],
  };
  const first = planFolderTitles(rows, paths),
    second = planFolderTitles([...rows].reverse(), paths);
  assert.deepEqual(first, second);
  assert.equal(first.kind, "ready");
  if (first.kind !== "ready") return;
  assert.ok(
    first.result.owner!.some(
      (p) => p.fileId === "existing" && p.path === "/imported/Same",
    ),
  );
  assert.equal(
    new Set(
      first.locations.filter((l) => l.state === "live").map((l) => l.path),
    ).size,
    2,
  );
});

test("missing parents, cycles, cross-owner ancestry and changed source locations fail closed", () => {
  const row = folder("a", "Title", "/imported/a");
  assert.deepEqual(planFolderTitles([row], { owner: [] }), {
    kind: "conflict",
    reason: "stale-location",
  });
  for (const rows of [
    [{ ...row, ancestorIds: ["missing"] }],
    [{ ...row, ancestorIds: ["a"] }],
    [row, { ...folder("b", "Child", "/imported/a/b", ["a"]), owner: "other" }],
  ]) {
    assert.deepEqual(planFolderTitles(rows, {}), {
      kind: "conflict",
      reason: "invalid-inventory",
    });
  }
});

test("deleted records stay tombstones; unsafe title characters become a normal bounded path", () => {
  const plan = planFolderTitles(
    [
      {
        ...folder("deleted", "Old", "/imported/old"),
        deleted: true,
        expectedPath: null,
      },
      folder("live", " A/B? # ", "/imported/live"),
    ],
    { owner: [{ path: "/imported/live", fileId: null }] },
  );
  assert.equal(plan.kind, "ready");
  if (plan.kind !== "ready") return;
  assert.ok(
    plan.locations.some(
      (l) => l.legacyId === "deleted" && l.state === "deleted",
    ),
  );
  assert.ok(
    plan.locations.some(
      (l) => l.state === "live" && l.path === "/imported/A-B",
    ),
  );
});

test("stable locations follow prefix moves and exact trash receipt restoration, without changing other owners", () => {
  const initial: RetainedFolderLocation[] = [
    {
      namespace: "fixture",
      legacyId: "a",
      owner: "owner",
      sourceRevision: "r",
      state: "live",
      path: "/A/Child",
    },
    {
      namespace: "fixture",
      legacyId: "other",
      owner: "other",
      sourceRevision: "r",
      state: "live",
      path: "/A/Child",
    },
  ];
  const moved = changeFolderLocations(initial, {
    kind: "move",
    owner: "owner",
    from: "/A",
    path: "/B",
  });
  assert.equal(moved[0]!.state === "live" && moved[0]!.path, "/B/Child");
  assert.deepEqual(moved[1], initial[1]);
  const trashed = changeFolderLocations(moved, {
    kind: "trash",
    owner: "owner",
    path: "/B",
    trashId: "receipt",
  });
  assert.equal(trashed[0]!.state, "trash");
  assert.deepEqual(
    changeFolderLocations(trashed, {
      kind: "restore",
      owner: "owner",
      trashId: "wrong",
      from: "/B",
      path: "/C",
    }),
    trashed,
  );
  const restored = changeFolderLocations(trashed, {
    kind: "restore",
    owner: "owner",
    trashId: "receipt",
    from: "/B",
    path: "/C",
  });
  assert.equal(restored[0]!.state === "live" && restored[0]!.path, "/C/Child");
  assert.equal(initial[0]!.state === "live" && initial[0]!.path, "/A/Child");
});

test("renaming preserves unrelated viewer moves and rejects overlong destinations atomically", () => {
  const row = folder("a", "Readable", "/imported/a");
  const paths = {
    owner: [
      { path: "/imported/a", fileId: null },
      { path: "/Elsewhere/moved.html", fileId: "moved" },
    ],
  };
  const plan = planFolderTitles([row], paths);
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready")
    assert.ok(
      plan.result.owner!.some(
        (entry) =>
          entry.path === "/Elsewhere/moved.html" && entry.fileId === "moved",
      ),
    );
  const longRoot =
    "/" + Array.from({ length: 5 }, () => "x".repeat(90)).join("/");
  const from = longRoot + "/a";
  assert.equal(
    planFolderTitles([folder("long", "z".repeat(80), from)], {
      owner: [{ path: from, fileId: null }],
    }).kind,
    "conflict",
  );
});

test("location moves respect segment boundaries and never revive deleted or unrelated trash aliases", () => {
  const base = { namespace: "fixture", owner: "owner", sourceRevision: "r" };
  const locations: RetainedFolderLocation[] = [
    { ...base, legacyId: "live", state: "live", path: "/AB" },
    { ...base, legacyId: "gone", state: "deleted" },
    {
      ...base,
      legacyId: "trash",
      state: "trash",
      path: "/A/Child",
      trashId: "receipt",
    },
  ];
  assert.deepEqual(
    changeFolderLocations(locations, {
      kind: "move",
      owner: "owner",
      from: "/A",
      path: "/C",
    }),
    locations,
  );
  assert.deepEqual(
    changeFolderLocations(locations, {
      kind: "trash",
      owner: "owner",
      path: "/A",
      trashId: "other",
    }),
    locations,
  );
});

test("title paths retain readable spaces and canonical Unicode", () => {
  const result = planFolderTitles(
    [folder("a", "Cafe\u0301 notes", "/imported/a")],
    { owner: [{ path: "/imported/a", fileId: null }] },
  );
  assert.equal(result.kind, "ready");
  if (result.kind === "ready")
    assert.ok(
      result.locations.some(
        (row) => row.state === "live" && row.path === "/imported/Café notes",
      ),
    );
});

test("owner names that match object properties remain explicit isolated snapshot keys", () => {
  const descriptor = { ...folder("a", "Readable", "/old"), owner: "__proto__" };
  const paths = Object.fromEntries([
    ["__proto__", [{ path: "/old", fileId: null }]],
  ]);
  const plan = planFolderTitles([descriptor], paths);
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready")
    assert.deepEqual(Object.keys(plan.expected), ["__proto__"]);
  assert.equal(
    planFolderTitles([{ ...descriptor, owner: "toString" }], {}).kind,
    "conflict",
  );
});
