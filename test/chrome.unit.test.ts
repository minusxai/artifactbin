import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileInput,
  railLayout,
  otherViewers,
  commentTransition,
  commentHighlights,
  markedThreads,
} from "../src/chrome-model.ts";
test("profile accepts bounded raster photos, rejects active/remote content and ignores identity claims", () => {
  assert.deepEqual(
    profileInput({ name: " Alice ", image: null, ...{ actor: "bob" } }),
    { name: "Alice", image: null },
  );
  for (const image of [
    "https://tracker.example/a.png",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64,broken",
    "x".repeat(150001),
  ])
    assert.throws(() => profileInput({ name: "Alice", image }));
  assert.throws(() => profileInput({ name: "x".repeat(81), image: null }));
});
test("comment rail has stable nonoverlapping positions, including many coincident targets", () => {
  const result = railLayout(
    Array.from({ length: 20 }, (_, i) => ({ id: String(i), top: 100 })),
    60,
  );
  assert.equal(result.length, 20);
  assert.equal(result[0]!.top, 100);
  for (let i = 1; i < result.length; i++)
    assert.ok(result[i]!.top - result[i - 1]!.top >= 44);
  assert.deepEqual(
    railLayout(
      [
        { id: "a", top: -100 },
        { id: "b", top: NaN },
      ],
      60,
    ),
    [
      { id: "a", top: 60 },
      { id: "b", top: 104 },
    ],
  );
});

test("only rendered nodes and the whole page get rail markers; a saved view keeps only page-level ones", () => {
  const rect = (width: number, height: number) => ({ x: 0, y: 40, width, height });
  const threads = [
    { id: "shown", nodeId: "n1" },
    { id: "hidden-tab", nodeId: "n2" },
    { id: "page", nodeId: null },
    { id: "gone", nodeId: "n9" },
  ];
  const targets = [
    { id: "n1", rect: rect(200, 20) },
    { id: "n2", rect: rect(0, 0) },
  ];
  assert.deepEqual(
    markedThreads(threads, targets, true).map((t) => t.id),
    ["shown", "page", "gone"],
  );
  assert.deepEqual(
    markedThreads(threads, [], false).map((t) => t.id),
    ["page"],
  );
});
test("viewers exclude my other tabs and collapse multiple sessions for each other person", () => {
  const v = (actor: string, sessionId: string) => ({
    actor,
    sessionId,
    sourceRevision: "r",
    cursor: null,
    shareView: true,
  });
  assert.deepEqual(
    otherViewers(
      [v("me", "one"), v("me", "two"), v("other", "three"), v("other", "four")],
      "me",
      "one",
    ).map((v) => v.sessionId),
    ["three"],
  );
});
test("hover previews dismiss, pinned replies keep drafts when closed and reopening restores them", () => {
  let s: import("../src/contracts.ts").CommentInteraction = {
    active: null,
    pinned: false,
    expanded: false,
    drafts: {},
  };
  s = commentTransition(s, { kind: "hover", id: "a" });
  assert.equal(s.active, "a");
  s = commentTransition(s, { kind: "leave" });
  assert.equal(s.active, null);
  s = commentTransition(s, { kind: "open", id: "a" });
  s = commentTransition(s, { kind: "draft", id: "a", body: "My reply" });
  s = commentTransition(s, { kind: "hover", id: "b" });
  assert.equal(s.active, "a");
  s = commentTransition(s, { kind: "close" });
  assert.equal(s.active, null);
  assert.equal(s.drafts.a, "My reply");
  s = commentTransition(s, { kind: "open", id: "a" });
  assert.equal(s.drafts.a, "My reply");
  s = commentTransition(s, { kind: "sent", id: "a" });
  assert.equal(s.drafts.a, undefined);
  assert.equal(s.active, "a");
});

test("comment hover is compact, expanding pins the thread and preserves the reply after escape", () => {
  let s: import("../src/contracts.ts").CommentInteraction = {
    active: null,
    pinned: false,
    expanded: false,
    drafts: {},
  };
  s = commentTransition(s, { kind: "hover", id: "a" });
  assert.equal(s.expanded, false);
  s = commentTransition(s, { kind: "expand", id: "a" });
  assert.equal(s.expanded, true);
  assert.equal(s.pinned, true);
  s = commentTransition(s, { kind: "leave" });
  assert.equal(s.active, "a");
  s = commentTransition(s, { kind: "draft", id: "a", body: "Keep me" });
  s = commentTransition(s, { kind: "close" });
  assert.equal(s.expanded, false);
  s = commentTransition(s, { kind: "hover", id: "a" });
  assert.equal(s.expanded, true);
  assert.equal(s.drafts.a, "Keep me");
});

test("comment highlights follow live geometry, clear active emphasis on close, and omit missing targets", () => {
  const targets = [
    { id: "node", rect: { x: 20, y: 40, width: 100, height: 30 } },
  ];
  const comments = [{ nodeId: "node" }, { nodeId: "gone" }, { nodeId: "node" }];
  assert.deepEqual(commentHighlights(comments, targets, "node"), [
    { nodeId: "node", rect: targets[0]!.rect, emphasis: "active" },
  ]);
  assert.equal(
    commentHighlights(comments, targets, null)[0]!.emphasis,
    "quiet",
  );
  targets[0]!.rect.y = -20;
  assert.equal(commentHighlights(comments, targets, "node")[0]!.rect.y, -20);
  assert.deepEqual(commentHighlights(comments, [], "node"), []);
  targets[0]!.rect.width = NaN;
  assert.deepEqual(commentHighlights(comments, targets, "node"), []);
});
