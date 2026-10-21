import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForCodeQLUpload } from "../scripts/ci/codeql-polling.ts";
import type {
  CodeQLUploadExpectation,
  CodeQLUploadPollingOperations,
} from "../scripts/ci/contracts.ts";
const expected: CodeQLUploadExpectation = {
  sarifId: "upload",
  sha: "merge-sha",
  ref: "refs/pull/1/merge",
  category: "security",
  rules: 2,
};
const pending = { processing_status: "pending" };
const complete = { processing_status: "complete", errors: null };
const valid = {
  sarif_id: expected.sarifId,
  commit_sha: expected.sha,
  ref: expected.ref,
  category: expected.category,
  error: "",
  rules_count: 2,
  results_count: 0,
  tool: { name: "CodeQL" },
};
function fixture(
  statuses: unknown[],
  records: unknown[] = [[valid]],
  latency = 0,
) {
  let time = 0,
    reads = 0,
    recordReads = 0;
  const sleeps: number[] = [],
    budgets: number[] = [];
  const operations: CodeQLUploadPollingOperations = {
    now: () => time,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      time += milliseconds;
    },
    status: async (budget) => {
      budgets.push(budget);
      time += latency;
      return statuses[Math.min(reads++, statuses.length - 1)];
    },
    analyses: async (budget) => {
      budgets.push(budget);
      time += latency;
      return records[Math.min(recordReads++, records.length - 1)];
    },
  };
  return {
    operations,
    sleeps,
    budgets,
    reads: () => reads,
    recordReads: () => recordReads,
  };
}
const options = { intervalMs: 5, timeoutMs: 30 };
test("pending processing and temporarily missing records are polled until exact valid acceptance", async () => {
  const f = fixture([pending, complete, complete], [[], [valid]]);
  assert.deepEqual(await waitForCodeQLUpload(expected, f.operations, options), {
    polls: 3,
    elapsedMs: 10,
  });
  assert.deepEqual(f.sleeps, [5, 5]);
  assert.equal(f.recordReads(), 2);
});
test("known processing errors and malformed states fail immediately without optimism", async () => {
  for (const state of [
    null,
    {},
    { processing_status: "failed" },
    { processing_status: "unknown" },
    { ...complete, errors: ["provider error"] },
  ]) {
    const f = fixture([state]);
    await assert.rejects(waitForCodeQLUpload(expected, f.operations, options));
    assert.deepEqual(f.sleeps, []);
    assert.equal(f.recordReads(), 0);
  }
});
test("errored, duplicate, wrong-identity and incomplete-rule stored records never become accepted", async () => {
  for (const record of [
    null,
    {},
    [valid, valid],
    [{ ...valid, error: "Unknown Error", rules_count: 0 }],
    [{ ...valid, sarif_id: "other" }],
    [{ ...valid, commit_sha: "other" }],
    [{ ...valid, category: "other" }],
    [{ ...valid, ref: "other" }],
    [{ ...valid, rules_count: 1 }],
  ]) {
    const f = fixture([complete], [record]);
    await assert.rejects(waitForCodeQLUpload(expected, f.operations, options));
    assert.deepEqual(f.sleeps, []);
  }
});
test("the deadline includes API elapsed time and bounds sleeps and each request budget", async () => {
  const pendingForever = fixture([pending], [], 3);
  await assert.rejects(
    waitForCodeQLUpload(expected, pendingForever.operations, {
      intervalMs: 5,
      timeoutMs: 10,
    }),
    /deadline/,
  );
  assert.deepEqual(pendingForever.sleeps, [5]);
  assert.deepEqual(pendingForever.budgets, [10, 2]);
  const lateAcceptance = fixture([complete], [[valid]], 6);
  await assert.rejects(
    waitForCodeQLUpload(expected, lateAcceptance.operations, {
      intervalMs: 5,
      timeoutMs: 10,
    }),
    /deadline/,
  );
  assert.deepEqual(lateAcceptance.budgets, [10, 4]);
  const missingForever = fixture([complete], [[]]);
  await assert.rejects(
    waitForCodeQLUpload(expected, missingForever.operations, {
      intervalMs: 6,
      timeoutMs: 10,
    }),
    /deadline/,
  );
  assert.deepEqual(missingForever.sleeps, [6, 4]);
});
test("transport failures fail closed without swallowing API errors or retrying indefinitely", async () => {
  for (const endpoint of ["status", "analyses"] as const) {
    const f = fixture([complete]);
    f.operations[endpoint] = async () => {
      throw Error("transport unavailable");
    };
    await assert.rejects(
      waitForCodeQLUpload(expected, f.operations, options),
      /transport unavailable/,
    );
    assert.deepEqual(f.sleeps, []);
  }
});

test("default processing policy polls every five seconds with a three-minute overall budget", async () => {
  const f = fixture([pending, complete]);
  assert.deepEqual(await waitForCodeQLUpload(expected, f.operations), {
    polls: 2,
    elapsedMs: 5_000,
  });
  assert.deepEqual(f.sleeps, [5_000]);
  assert.deepEqual(f.budgets, [180_000, 175_000, 175_000]);
  for (const limits of [
    { timeoutMs: 0 },
    { intervalMs: 0 },
    { timeoutMs: Infinity },
    { intervalMs: 0.5 },
  ]) {
    const invalid = fixture([complete]);
    await assert.rejects(
      waitForCodeQLUpload(expected, invalid.operations, limits),
      /limits/,
    );
    assert.equal(invalid.reads(), 0);
  }
});
