import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSelection } from "../src/browser/selection-presence.ts";
test("selection wire format accepts bounded offsets and strips unrelated data", () => {
  assert.deepEqual(
    validateSelection({
      ranges: [
        {
          nodeId: "a",
          fingerprint: "12345678",
          start: 1,
          end: 4,
          length: 9,
          text: "private",
        },
      ],
    }),
    {
      ranges: [
        { nodeId: "a", fingerprint: "12345678", start: 1, end: 4, length: 9 },
      ],
    },
  );
});
test("selection wire format rejects malformed, oversized and collapsed ranges", () => {
  for (const value of [
    { ranges: [] },
    {
      ranges: [
        { nodeId: "a", fingerprint: "12345678", start: 0, end: 10, length: 9 },
      ],
    },
    {
      ranges: [
        { nodeId: "a", fingerprint: "12345678", start: 1, end: 1, length: 9 },
      ],
    },
    {
      ranges: [
        {
          nodeId: "a",
          fingerprint: "12345678",
          start: 0,
          end: 1,
          length: Infinity,
        },
      ],
    },
    {
      ranges: Array(9).fill({
        nodeId: "a",
        fingerprint: "12345678",
        start: 0,
        end: 1,
        length: 2,
      }),
    },
  ])
    assert.equal(validateSelection(value), null);
});
import { presenceUpdate, visiblePresence } from "../src/model.ts";
test("selection privacy, clearing, expiry and revision stay ephemeral in presence", () => {
  const selection = {
    ranges: [
      { nodeId: "a", fingerprint: "12345678", start: 0, end: 2, length: 3 },
    ],
  };
  let entries = presenceUpdate(
    {},
    "alice",
    { sessionId: "s", sourceRevision: "v1", selection },
    { now: 0, generation: 1 },
  );
  assert.deepEqual(
    visiblePresence(entries, { now: 1, generation: 1 })[0]!.selection,
    selection,
  );
  entries = presenceUpdate(
    entries,
    "alice",
    { sessionId: "s", sourceRevision: "v1", selection, shareSelection: false },
    { now: 2, generation: 1 },
  );
  assert.equal(
    visiblePresence(entries, { now: 3, generation: 1 })[0]!.selection,
    null,
  );
  entries = presenceUpdate(
    entries,
    "alice",
    { sessionId: "s", sourceRevision: "v2", selection: null },
    { now: 4, generation: 1 },
  );
  assert.equal(
    visiblePresence(entries, { now: 5, generation: 1 })[0]!.selection,
    null,
  );
  assert.deepEqual(visiblePresence(entries, { now: 30005, generation: 1 }), []);
  assert.deepEqual(visiblePresence(entries, { now: 5, generation: 2 }), []);
});
