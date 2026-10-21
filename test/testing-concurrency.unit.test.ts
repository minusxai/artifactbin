import assert from "node:assert/strict";
import test from "node:test";
import { testConcurrency } from "../scripts/testing/concurrency.ts";
import { classifyTests } from "../scripts/testing/inventory.ts";

test("pure unit runs use available local processors with a bounded process count", () => {
  const tests = classifyTests(["test/example.unit.test.ts"]);
  assert.equal(
    testConcurrency(tests, { availableParallelism: 6, ci: false }),
    6,
  );
  assert.equal(
    testConcurrency(tests, { availableParallelism: 64, ci: false }),
    8,
  );
  assert.equal(
    testConcurrency(tests, { availableParallelism: 1, ci: false }),
    1,
  );
});

test("CI and resource-dependent selections retain at most two processes", () => {
  const unit = classifyTests(["test/example.unit.test.ts"]);
  assert.equal(
    testConcurrency(unit, { availableParallelism: 32, ci: true }),
    2,
  );
  for (const capability of ["local", "database", "browser", "isolate"]) {
    const tests = classifyTests([
      "test/example.unit.test.ts",
      `test/example.${capability}.test.ts`,
    ]);
    assert.equal(
      testConcurrency(tests, { availableParallelism: 32, ci: false }),
      2,
    );
    assert.equal(
      testConcurrency(tests, { availableParallelism: 1, ci: false }),
      1,
    );
  }
});
