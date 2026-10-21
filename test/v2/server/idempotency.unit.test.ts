import { test } from "node:test";
import assert from "node:assert/strict";
import { IDEMPOTENCY_TTL_MS } from "../../../src/server/af-api-contracts.ts";
import {
  decideIdempotency,
  decodeCursor,
  encodeCursor,
  idempotencyKey,
  type StoredResponse,
} from "../../../src/server/idempotency.ts";

const status = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return undefined;
};
const stored: StoredResponse = { fingerprint: "a", status: 200, body: { version: 2 }, createdAt: 1_000 };

test("a request without a stored response runs as new", () => {
  assert.deepEqual(decideIdempotency(null, "a", 5_000), { kind: "fresh" });
});

test("the same key and body replays the stored status and body", () => {
  assert.deepEqual(decideIdempotency(stored, "a", 1_000 + IDEMPOTENCY_TTL_MS), {
    kind: "replay",
    status: 200,
    body: { version: 2 },
  });
});

test("the same key with another body is 422", () => {
  assert.equal(status(() => decideIdempotency(stored, "b", 2_000)), 422);
});

test("a key is kept for at least 24 hours and is new again after it expires", () => {
  assert.ok(IDEMPOTENCY_TTL_MS >= 24 * 60 * 60 * 1000);
  assert.equal(decideIdempotency(stored, "a", 1_000 + IDEMPOTENCY_TTL_MS).kind, "replay");
  assert.deepEqual(decideIdempotency(stored, "b", 1_001 + IDEMPOTENCY_TTL_MS), { kind: "fresh" });
});

test("the header is optional and must be printable text of at most 200 characters", () => {
  assert.equal(idempotencyKey(undefined), null);
  assert.equal(idempotencyKey("save-1 retry"), "save-1 retry");
  assert.equal(idempotencyKey(["first", "second"]), "first");
  assert.equal(idempotencyKey("k".repeat(200)), "k".repeat(200));
  for (const bad of ["", " padded", "k".repeat(201), "tab\there", "naïve"])
    assert.equal(status(() => idempotencyKey(bad)), 400, JSON.stringify(bad));
});

test("cursors round-trip and anything else is 400", () => {
  for (const n of [0, 1, 35, 36, 123456789]) assert.equal(decodeCursor(encodeCursor(n)), n);
  assert.equal(decodeCursor(undefined), null);
  assert.equal(decodeCursor(null), null);
  assert.notEqual(encodeCursor(5), "5", "cursors are opaque, not bare counters");
  for (const bad of ["", "5", "c1.", "c1.-1", "c1.01", "c2.5", "c1.zzzzzzzzzzz"])
    assert.equal(status(() => decodeCursor(bad)), 400, JSON.stringify(bad));
});
