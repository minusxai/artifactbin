import test from "node:test";
import assert from "node:assert/strict";
import { cursorPositions } from "../src/browser/cursor-layer.ts";
import type { Viewer } from "../src/contracts.ts";
const viewer = (
  actor: string,
  id: string,
  revision = "r",
  nodeId = "a",
): Viewer => ({
  shareView: false,
  actor,
  sessionId: id,
  sourceRevision: revision,
  cursor: { nodeId, x: 0.5, y: 0.5 },
});
test("cursor geometry excludes own actor/session, wrong revisions, missing targets and repeated actors", () => {
  const people = [
    viewer("me", "x"),
    viewer("other", "mine"),
    viewer("old", "old", "old"),
    viewer("missing", "missing", "r", "b"),
    viewer("alice", "a"),
    viewer("alice", "b"),
  ];
  assert.deepEqual(
    cursorPositions({
      viewers: people,
      actor: "me",
      sessionId: "mine",
      sourceRevision: "r",
      targets: [
        { id: "a", quote: "", rect: { x: 10, y: 20, width: 40, height: 80 } },
      ],
      width: 900,
      inset: 44,
    }),
    [{ actor: "alice", x: 30, y: 104 }],
  );
});
test("cursor geometry clamps horizontally and below platform chrome", () => {
  assert.deepEqual(
    cursorPositions({
      viewers: [viewer("alice", "a")],
      actor: null,
      sessionId: "mine",
      sourceRevision: "r",
      targets: [
        {
          id: "a",
          quote: "",
          rect: { x: 100, y: -200, width: 40, height: 80 },
        },
      ],
      width: 40,
      inset: 44,
    }),
    [{ actor: "alice", x: 0, y: 44 }],
  );
});

test("idle, stale and missing-target sessions cannot mask an eligible cursor from the same actor", () => {
  const active = viewer("alice", "active");
  const idle = { ...viewer("alice", "idle"), cursor: null };
  const stale = viewer("alice", "stale", "old");
  const missing = viewer("alice", "missing", "r", "absent");
  for (const first of [idle, stale, missing]) {
    for (const viewers of [
      [first, active],
      [active, first],
    ]) {
      assert.deepEqual(
        cursorPositions({
          viewers,
          actor: "reader",
          sessionId: "reader-session",
          sourceRevision: "r",
          targets: [
            {
              id: "a",
              quote: "",
              rect: { x: 10, y: 20, width: 40, height: 80 },
            },
          ],
          width: 900,
          inset: 44,
        }),
        [{ actor: "alice", x: 30, y: 104 }],
      );
    }
  }
});
