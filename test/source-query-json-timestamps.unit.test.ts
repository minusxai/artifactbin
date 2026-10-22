import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceTimestamp as normalize } from "../src/datasets/source-query/timestamps.ts";
test("JSON timestamp normalization preserves native UTC and exceptional-value contracts", () => {
  assert.equal(
    normalize("2026-10-15T00:00:00", 1114),
    "2026-10-15T00:00:00.000Z",
  );
  assert.equal(
    normalize("2026-03-08T02:30:00.123456", 1114),
    "2026-03-08T02:30:00.123Z",
  );
  assert.equal(
    normalize("2026-10-15T00:00:00+05:30", 1184),
    "2026-10-14T18:30:00.000Z",
  );
  assert.equal(
    normalize("2026-10-15T00:00:00-04:00", 1184),
    "2026-10-15T04:00:00.000Z",
  );
  for (const oid of [1114, 1184] as const)
    assert.equal(normalize(null, oid), null);
  for (const value of ["invalid", "infinity", "-infinity"]) {
    assert.equal(normalize(value, 1114), value);
    assert.equal(normalize(value, 1184), null);
  }
});
