import { it, expect, vi } from "vitest";
import { serveSql, sqlClient } from "@artifactbin/sql";
import { createSql } from "@artifactbin/sql/local";
import { SQL_READ_JOB_ROUTES, type SqlReadJobs } from "@artifactbin/contracts";
import { sqlReadExecution } from "../../utils/src/sql-read-jobs";
const input = {
  tables: {},
  params: { value: 4 },
  queries: [{ name: "q", sql: "select $value as n" }],
};
const endless = {
  tables: {},
  params: {},
  queries: [
    {
      name: "q",
      sql: "with recursive c(n) as (select 1 union all select n+1 from c) select count(*) from c",
    },
  ],
};
it("real authenticated remote worker execution and cancellation return only after completion/release", async () => {
  const pool = createSql({ timeoutMs: 10000 }, { workers: 1 }),
    server = serveSql(pool, { serviceSecret: "test-service-secret" }),
    { url } = server.listen(0);
  try {
    const client = sqlClient(url, { serviceSecret: "test-service-secret" });
    expect(await client.startRead!(input).result).toMatchObject({
      q: { rows: [{ n: 4 }] },
    });
    const job = client.startRead!(endless);
    await job.cancelAndDrain();
    await expect(job.result).rejects.toThrow("sql_read_cancelled");
    expect(await client.startRead!(input).result).toMatchObject({
      q: { rows: [{ n: 4 }] },
    });
    const unauthorized = await fetch(url + SQL_READ_JOB_ROUTES.open, {
      method: "POST",
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
  } finally {
    await server.close();
    await pool.close();
  }
});
it("recovers a lost submit response through the same immutable job key without double execution", async () => {
  let submissions = 0,
    statuses = 0;
  let saved: any;
  const jobs: SqlReadJobs = {
    open: async () => ({ serverId: "server", now: Date.now() }),
    submit: async (request) => {
      submissions++;
      saved = request;
      throw Error("response_lost");
    },
    status: async (key) => {
      statuses++;
      return {
        ...key,
        state: "completed",
        drained: true,
        results: {
          q: {
            columns: [{ name: "n", type: "number" }],
            rows: [{ n: saved.input.params.value }],
          },
        },
      };
    },
    cancel: async (key) => ({
      ...key,
      state: "cancelled",
      drained: true,
      code: "cancelled",
    }),
  };
  const job = sqlReadExecution(jobs, input, { pollMs: 0 });
  expect(await job.result).toMatchObject({ q: { rows: [{ n: 4 }] } });
  expect(submissions).toBe(1);
  expect(statuses).toBe(1);
});
it("disconnected submitters leave server-owned leases that cancel real workers and permit the next read", async () => {
  const pool = createSql({ timeoutMs: 10000 }, { workers: 1 }),
    server = serveSql(pool),
    { url } = server.listen(0);
  const post = async (path: string, body: unknown) =>
    (
      await fetch(url + path, { method: "POST", body: JSON.stringify(body) })
    ).json();
  try {
    const { serverId } = await post(SQL_READ_JOB_ROUTES.open, {}),
      key = {
        id: "disconnected_read_12345",
        deadline: Date.now() + 100,
        serverId,
      };
    expect(
      await post(SQL_READ_JOB_ROUTES.submit, { ...key, input: endless }),
    ).toMatchObject({ state: "running", drained: false });
    let receipt: any;
    await vi.waitFor(
      async () => {
        receipt = await post(SQL_READ_JOB_ROUTES.status, key);
        expect(receipt).toMatchObject({ state: "cancelled", drained: true });
      },
      { timeout: 2500, interval: 20 },
    );
    expect(await sqlClient(url).startRead!(input).result).toMatchObject({
      q: { rows: [{ n: 4 }] },
    });
  } finally {
    await server.close();
    await pool.close();
  }
});
it("does not disclose malformed SQL input or thrown details in SQL shell logs", async () => {
  const pool = createSql(),
    server = serveSql(pool),
    { url } = server.listen(0),
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await fetch(url + SQL_READ_JOB_ROUTES.submit, {
      method: "POST",
      body: '{"sql":"select private_fixture" BROKEN',
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private_fixture");
    expect(JSON.stringify(log.mock.calls)).toContain("request_failed");
  } finally {
    log.mockRestore();
    await server.close();
    await pool.close();
  }
});

it("fails closed without a terminal receipt after a server incarnation disappears", async () => {
  let clock = 0;
  const jobs: SqlReadJobs = {
    open: async () => ({ serverId: "old", now: 0 }),
    submit: async (key) => {
      clock++;
      return { ...key, state: "unknown", drained: false };
    },
    status: async (key) => {
      clock++;
      return { ...key, state: "unknown", drained: false };
    },
    cancel: async (key) => {
      clock++;
      return { ...key, state: "unknown", drained: false };
    },
  };
  const handle = sqlReadExecution(jobs, input, {
    now: () => clock,
    leaseMs: 2,
    drainMs: 2,
    pollMs: 0,
  });
  await expect(handle.result).rejects.toThrow("sql_read_drain_unconfirmed");
  await expect(handle.cancelAndDrain()).rejects.toThrow(
    "sql_read_drain_unconfirmed",
  );
});
