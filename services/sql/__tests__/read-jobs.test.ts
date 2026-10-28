import { it, expect } from "vitest";
import { createReadJobs } from "../src/read-jobs";
import type { SqlReadExecution } from "@artifactbin/contracts";
const input = {
  tables: {},
  params: {},
  queries: [{ name: "q", sql: "select 1 as n" }],
};
const key = { id: "test_job_0123456789", deadline: 1000, serverId: "server" };
function held() {
  let resolve!: (value: any) => void, release!: () => void;
  const execution: SqlReadExecution = {
    result: new Promise((r) => {
      resolve = r;
    }),
    cancelAndDrain: () =>
      new Promise((r) => {
        release = () => {
          resolve({ q: { error: "cancelled" } });
          r();
        };
      }),
  };
  return {
    execution,
    finish: () => resolve({ q: { columns: [], rows: [] } }),
    release: () => release(),
  };
}
it("retries submission idempotently, rejects changed input, and publishes terminal only after release", async () => {
  const job = held();
  let calls = 0;
  const jobs = createReadJobs(
    () => {
      calls++;
      return job.execution;
    },
    { serverId: "server", now: () => 0 },
  );
  expect((await jobs.submit({ ...key, input })).state).toBe("running");
  await jobs.submit({ ...key, input });
  expect(calls).toBe(1);
  await expect(
    jobs.submit({ ...key, input: { ...input, params: { other: 1 } } }),
  ).rejects.toThrow("sql_job_conflict");
  let done = false;
  const cancel = jobs.cancel(key).then((x) => {
    done = true;
    return x;
  });
  await Promise.resolve();
  expect((await jobs.status(key)).drained).toBe(false);
  expect(done).toBe(false);
  job.release();
  expect(await cancel).toMatchObject({ state: "cancelled", drained: true });
  expect(await jobs.submit({ ...key, input })).toMatchObject({
    state: "cancelled",
    drained: true,
  });
  expect(calls).toBe(1);
});
it("cancellation before ambiguous admission installs a tombstone; no late execution", async () => {
  let starts = 0;
  const jobs = createReadJobs(
    () => {
      starts++;
      return held().execution;
    },
    { serverId: "server", now: () => 0 },
  );
  expect(await jobs.cancel(key)).toMatchObject({
    state: "cancelled",
    drained: true,
  });
  expect(await jobs.submit({ ...key, input })).toMatchObject({
    state: "cancelled",
  });
  expect(starts).toBe(0);
});
it("bounds active capacity and never evicts a live job to admit another", async () => {
  const first = held();
  const jobs = createReadJobs(() => first.execution, {
    serverId: "server",
    now: () => 0,
    maxActive: 1,
  });
  await jobs.submit({ ...key, input });
  expect(
    await jobs.submit({ ...key, id: "another_job_01234567", input }),
  ).toMatchObject({ state: "rejected", drained: true, code: "sql_job_busy" });
  first.finish();
  await Promise.resolve();
  expect((await jobs.status(key)).drained).toBe(true);
});
it("lease expiry cancels and drains disconnected work; stale submissions never restart it", async () => {
  let expire!: () => void,
    time = 0;
  const job = held();
  const jobs = createReadJobs(() => job.execution, {
    serverId: "server",
    now: () => time,
    schedule: (_ms, callback) => {
      expire = callback;
      return () => {};
    },
  });
  await jobs.submit({ ...key, input });
  time = 1001;
  expire();
  await Promise.resolve();
  expect((await jobs.status(key)).drained).toBe(false);
  job.release();
  await Promise.resolve();
  await Promise.resolve();
  expect(await jobs.status(key)).toMatchObject({
    state: "cancelled",
    drained: true,
  });
});

it("never mistakes another server incarnation for a terminal drain receipt", async () => {
  const jobs = createReadJobs(() => held().execution, {
    serverId: "replacement",
    now: () => 0,
  });
  expect(await jobs.cancel(key)).toMatchObject({
    state: "unknown",
    drained: false,
  });
  expect(await jobs.submit({ ...key, input })).toMatchObject({
    state: "unknown",
    drained: false,
  });
});
it("bounds receipts without evicting live work or falsely acknowledging a rejected identifier", async () => {
  const job = held();
  const jobs = createReadJobs(() => job.execution, {
    serverId: "server",
    now: () => 0,
    maxEntries: 1,
  });
  await jobs.submit({ ...key, input });
  await expect(
    jobs.cancel({ ...key, id: "different_job_123456" }),
  ).rejects.toThrow("sql_job_capacity");
  expect((await jobs.status(key)).state).toBe("running");
  job.finish();
  await Promise.resolve();
  await jobs.close();
});

it("bounds retained output without weakening terminal receipts or silently truncating", async () => {
  const jobs = createReadJobs(
    () => ({
      result: Promise.resolve({
        q: {
          columns: [],
          rows: [{ payload: "synthetic output past small test budget" }],
        },
      }),
      cancelAndDrain: async () => {},
    }),
    { serverId: "server", now: () => 0, maxResultBytes: 16 },
  );
  await jobs.submit({ ...key, input });
  await Promise.resolve();
  expect(await jobs.status(key)).toMatchObject({
    state: "failed",
    drained: true,
    code: "sql_job_output_limit",
  });
});
it("never restarts an expired identifier after terminal retention is reclaimed", async () => {
  let time = 0,
    starts = 0;
  const jobs = createReadJobs(
    () => {
      starts++;
      return {
        result: Promise.resolve({ q: { columns: [], rows: [] } }),
        cancelAndDrain: async () => {},
      };
    },
    { serverId: "server", now: () => time, retentionMs: 1 },
  );
  await jobs.submit({ ...key, input });
  await Promise.resolve();
  time = 2000;
  expect(await jobs.status(key)).toMatchObject({
    state: "unknown",
    drained: false,
  });
  expect(await jobs.submit({ ...key, input })).toMatchObject({
    state: "rejected",
    drained: true,
  });
  expect(starts).toBe(1);
});
it("releases answered results, oldest first, so new reads complete under the retained budget", async () => {
  const output = { q: { columns: [], rows: [{ payload: "retained result" }] } };
  const size = Buffer.byteLength(JSON.stringify(output));
  const jobs = createReadJobs(
    () => ({ result: Promise.resolve(structuredClone(output)), cancelAndDrain: async () => {} }),
    { serverId: "server", now: () => 0, maxRetainedBytes: size * 2 },
  );
  const job = (n: number) => ({ ...key, id: `retained_job_${n}_0123456789` });
  const settle = async (n: number) => {
    await jobs.submit({ ...job(n), input });
    await Promise.resolve();
  };
  await settle(1);
  expect(await jobs.status(job(1))).toMatchObject({ state: "completed", results: output });
  await settle(2);
  // The budget is full: the answered result is released for the new one; the unanswered one is kept.
  await settle(3);
  expect(await jobs.status(job(3))).toMatchObject({ state: "completed", drained: true, results: output });
  expect(await jobs.status(job(2))).toMatchObject({ state: "completed", drained: true, results: output });
  expect(await jobs.status(job(1))).toMatchObject({ state: "failed", drained: true, code: "sql_job_result_released" });
  // Every retained result is answered now, so the next read releases the oldest of them and completes too.
  await settle(4);
  expect(await jobs.status(job(4))).toMatchObject({ state: "completed", results: output });
  expect(await jobs.status(job(2))).toMatchObject({ state: "failed", code: "sql_job_result_released" });
  expect(await jobs.status(job(3))).toMatchObject({ state: "completed", results: output });
});
it("still refuses a result when only unanswered results hold the retained budget", async () => {
  const output = { q: { columns: [], rows: [{ payload: "retained result" }] } };
  const size = Buffer.byteLength(JSON.stringify(output));
  const jobs = createReadJobs(
    () => ({ result: Promise.resolve(structuredClone(output)), cancelAndDrain: async () => {} }),
    { serverId: "server", now: () => 0, maxRetainedBytes: size },
  );
  const job = (n: number) => ({ ...key, id: `unanswered_job_${n}_0123456789` });
  await jobs.submit({ ...job(1), input });
  await Promise.resolve();
  await jobs.submit({ ...job(2), input });
  await Promise.resolve();
  expect(await jobs.status(job(2))).toMatchObject({ state: "failed", drained: true, code: "sql_job_output_limit" });
  expect(await jobs.status(job(1))).toMatchObject({ state: "completed", results: output });
});
