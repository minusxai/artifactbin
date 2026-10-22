import test from "node:test";
import assert from "node:assert/strict";
import { STABLE_NODE_ID_MAX_BYTES } from "../src/domain/stable-node-id-contracts.ts";
import { isStableNodeId } from "../src/domain/stable-node-id.ts";
import { validateSelection } from "../src/domain/selection-presence.ts";
import { presenceUpdate } from "../src/model.ts";
import { acceptLoadedComment } from "../src/comment-model.ts";
const range = (nodeId: unknown) => ({
  nodeId,
  start: 0,
  end: 2,
  length: 3,
  fingerprint: "12345678",
});
const draft = (nodeId: string) => ({
  id: "c",
  nodeId,
  body: "Comment",
  quote: "Text",
  sourceRevision: "r",
  parentId: null,
});
const loaded = {
  sourceExists: true,
  parentExists: false,
  existing: null,
  sequence: 0,
};
const options = { digest: (value: string) => value, now: 0 };
const scoped =
  "mx-instance-" +
  encodeURIComponent(
    JSON.stringify([
      ["table", "持".repeat(256), "string", "鍵".repeat(256), "列".repeat(256)],
      "源".repeat(256),
    ]),
  );
test("stable node IDs preserve encoded scoped identities and exact UTF-8 boundaries", () => {
  assert.ok(scoped.length > 4096);
  for (const id of [
    "n1",
    " ",
    "__proto__",
    "prototype",
    "constructor",
    "toString",
    "節点🙂",
    "e\u0301",
    "é",
    scoped,
    "a".repeat(STABLE_NODE_ID_MAX_BYTES),
    "🙂".repeat(STABLE_NODE_ID_MAX_BYTES / 4),
  ])
    assert.equal(isStableNodeId(id), true);
  for (const id of [
    "a".repeat(STABLE_NODE_ID_MAX_BYTES + 1),
    "🙂".repeat(STABLE_NODE_ID_MAX_BYTES / 4) + "a",
  ])
    assert.equal(isStableNodeId(id), false);
});
test("stable node IDs reject malformed and prototype inputs without coercing them", () => {
  for (const id of [
    null,
    undefined,
    0,
    {},
    [],
    new String("n1"),
    "",
    "a\0b",
    "a\nb",
    "a\u007fb",
    "a\u0085b",
    "\ud800",
    "\udfff",
    Object.create({ nodeId: "n1" }),
  ])
    assert.equal(isStableNodeId(id), false);
});
test("comment, selection and cursor consumers retain long scoped identities verbatim", () => {
  const id = scoped;
  assert.equal(
    acceptLoadedComment(loaded, "actor", draft(id), null, options).comment
      .nodeId,
    id,
  );
  assert.deepEqual(validateSelection({ ranges: [range(id)] }), {
    ranges: [range(id)],
  });
  const presence = presenceUpdate(
    {},
    "actor",
    {
      sessionId: "s",
      sourceRevision: "r",
      cursor: { nodeId: id, x: 0.2, y: 0.3 },
      selection: { ranges: [range(id) as any] },
    },
    { now: 0, generation: 1 },
  );
  assert.equal(presence.s!.cursor!.nodeId, id);
  assert.equal(presence.s!.selection!.ranges[0]!.nodeId, id);
});
test("all wire consumers enforce the same byte and malformed-text boundaries", () => {
  for (const id of [
    "a".repeat(STABLE_NODE_ID_MAX_BYTES + 1),
    "\ud800",
    "a\0b",
    "",
  ]) {
    assert.throws(
      () => acceptLoadedComment(loaded, "actor", draft(id), null, options),
      /anchor/,
    );
    assert.equal(validateSelection({ ranges: [range(id)] }), null);
    assert.throws(
      () =>
        presenceUpdate(
          {},
          "actor",
          {
            sessionId: "s",
            sourceRevision: "r",
            cursor: { nodeId: id, x: 0, y: 0 },
          },
          { now: 0, generation: 1 },
        ),
      /cursor/,
    );
  }
});

test("prototype-looking IDs remain opaque own anchors without changing object prototypes", async () => {
  const { localComment } = await import("../src/model.ts");
  const { initialState } = await import("../src/document.js");
  for (const id of ["__proto__", "constructor", "prototype", "toString"]) {
    const state = initialState("<p>Text</p>");
    const next = localComment(
      state,
      { ...draft(id), sourceRevision: state.sourceRevision },
      null,
      null,
      0,
    );
    assert.equal(Object.getPrototypeOf(next.anchors), Object.prototype);
    assert.equal(Object.hasOwn(next.anchors, id), true);
    assert.equal(next.anchors[id]!.quote, "Text");
    assert.equal(next.comments[0]!.nodeId, id);
  }
});
test("maximum eight-range selection remains within the live transport budget even with JSON escaping", async () => {
  const { LIVE_QUEUE_LIMITS } = await import("../src/live-contracts.ts");
  const id = '"'.repeat(STABLE_NODE_ID_MAX_BYTES);
  const selection = { ranges: Array.from({ length: 8 }, () => range(id)) };
  assert.deepEqual(validateSelection(selection), selection);
  const message = {
    type: "cursor",
    cursor: { nodeId: id, x: 0, y: 0 },
    selection,
  };
  assert.ok(
    new TextEncoder().encode(JSON.stringify(message)).byteLength <
      LIVE_QUEUE_LIMITS.pendingBytes,
  );
});
