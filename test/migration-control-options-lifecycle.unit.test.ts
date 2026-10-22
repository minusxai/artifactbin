import test from "node:test";
import assert from "node:assert/strict";
import { createControlOptionsLifecycle } from "../src/migration/conversion/compiled/control-options-lifecycle.ts";
import { completeControlOptions } from "../src/migration/conversion/compiled/control-options.ts";
test("superseding aborts a hung completion and late failure stays observed", async () => {
  const lifecycle = createControlOptionsLifecycle();
  const first = lifecycle.begin()!;
  let rejectLate!: (error: Error) => void;
  let readSignal: AbortSignal | undefined;
  const initial = { columns: [], rows: [{}], totalRows: 2 };
  const pending = completeControlOptions(
    initial,
    (_offset, _limit, signal) => {
      readSignal = signal;
      return new Promise((_resolve, reject) => {
        rejectLate = reject;
      });
    },
    {},
    { signal: first.signal },
  );
  const refused = assert.rejects(pending, /cancelled/);
  const second = lifecycle.begin()!;
  assert.equal(first.signal.aborted, true);
  assert.equal(readSignal?.aborted, true);
  await refused;
  first.finish();
  assert.equal(second.signal.aborted, false);
  lifecycle.dispose();
  assert.equal(second.signal.aborted, true);
  assert.equal(lifecycle.begin(), null);
  rejectLate(Error("late failure"));
  await Promise.resolve();
});
test("completed attempts release ownership and disposal is idempotent", () => {
  const lifecycle = createControlOptionsLifecycle();
  const attempt = lifecycle.begin()!;
  attempt.finish();
  lifecycle.dispose();
  lifecycle.dispose();
  assert.equal(attempt.signal.aborted, false);
  assert.equal(lifecycle.begin(), null);
});
