import test from "node:test";
import assert from "node:assert/strict";
import { createRegisteredServerQueryService } from "../src/datasets/query/service.ts";
import type {
  RegisteredServerQueryPlan,
  RegisteredServerQueryPorts,
} from "../src/datasets/query/contracts.ts";
const context = {
  backendId: "backend",
  backendVersion: "saved",
  pageId: "page",
  subject: "viewer",
};
const plan: RegisteredServerQueryPlan = {
  scalars: { minimum: { type: "number", default: 1 } },
  tables: [],
  imports: [
    {
      schema: "bookings",
      table: "rows",
      read: { binding: "registered", schema: "main", table: "rows" },
    },
  ],
  queries: [
    {
      name: "base",
      sql: "select * from bookings.rows where n >= $minimum",
      dependencies: [],
    },
    {
      name: "answer",
      sql: "select count(*) as n from base",
      dependencies: ["base"],
    },
  ],
};
function setup() {
  const calls: unknown[] = [];
  let authorized = true;
  const ports: RegisteredServerQueryPorts = {
    async registry(c) {
      assert.deepEqual(c, context);
      return plan;
    },
    async authorize() {
      return authorized;
    },
    async platform() {
      return { userId: "reader", now: "2026-01-01T00:00:00.000Z", tz: "UTC" };
    },
    reads: {
      async read(c, r) {
        assert.deepEqual(c, context);
        calls.push(r);
        const request = r as { offset: number };
        return {
          version: 2,
          generation: 3,
          schema: "main",
          table: "rows",
          columns: [{ name: "n", type: "number" }],
          rows: [{ n: request.offset + 1 }],
          offset: request.offset,
          nextOffset: request.offset === 0 ? 1 : null,
          totalRows: 2,
        };
      },
    },
    async execute(job) {
      calls.push(job);
      return {
        tables: {
          base: { rows: [], columns: [] },
          answer: {
            rows: [{ n: 2 }],
            columns: [{ name: "n", type: "number" }],
          },
        },
        errors: {},
      };
    },
  };
  return {
    ports,
    calls,
    revoke() {
      authorized = false;
    },
  };
}
test("registered reads preserve source SQL/dependency order, defaults, pinned windows and fresh final access", async () => {
  const s = setup();
  const result = await createRegisteredServerQueryService(s.ports).execute(
    context,
    { values: {}, only: ["answer"] },
  );
  assert.deepEqual(result.tables.answer?.rows, [{ n: 2 }]);
  const job = s.calls[2] as {
    input: { queries: unknown; params: unknown; tables: { rows: unknown[] }[] };
  };
  assert.deepEqual(
    job.input.queries,
    plan.queries.map(({ name, sql }) => ({ name, sql })),
  );
  assert.deepEqual(
    { ...(job.input.params as object) },
    {
      minimum: 1,
      _me__id: "reader",
      _now: "2026-01-01T00:00:00.000Z",
      _tz: "UTC",
    },
  );
  assert.equal(job.input.tables[1]?.rows.length, 2);
  assert.deepEqual(s.calls[1], {
    ...plan.imports[0]!.read,
    offset: 1,
    limit: 500,
    expectedVersion: 2,
    expectedGeneration: 3,
  });
  assert.deepEqual(s.calls[3], {
    ...plan.imports[0]!.read,
    offset: 0,
    limit: 1,
    expectedVersion: 2,
    expectedGeneration: 3,
  });
});
test("caller cannot supply SQL, unknown query names, local tables or incorrectly typed scalar values", async () => {
  for (const request of [
    { values: {}, only: ["answer"], sql: "select 1" },
    { values: {}, only: ["unknown"] },
    { values: { minimum: "2" }, only: ["answer"] },
    { values: { other: 2 }, only: ["answer"] },
    { values: {}, only: ["answer"], localTables: {} },
  ]) {
    const s = setup();
    await assert.rejects(
      createRegisteredServerQueryService(s.ports).execute(context, request),
    );
    assert.equal(s.calls.length, 0);
  }
});
test("revocation during SQL discards the answer even for source-only queries", async () => {
  const s = setup();
  s.ports.registry = async () => ({ ...plan, imports: [] });
  s.ports.execute = async () => {
    s.revoke();
    return { tables: {}, errors: { base: "refused", answer: "refused" } };
  };
  await assert.rejects(
    createRegisteredServerQueryService(s.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
    /denied/,
  );
});
test("changed input generations, failed final authorization, cycles and preaborted calls fail closed", async () => {
  const s = setup();
  let calls = 0;
  const read = s.ports.reads.read;
  s.ports.reads.read = async (...args) => {
    const r = await read(...args);
    return { ...r, generation: ++calls === 1 ? 3 : 4 };
  };
  await assert.rejects(
    createRegisteredServerQueryService(s.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
    /dataset_changed/,
  );
  const cycle = setup();
  cycle.ports.registry = async () => ({
    ...plan,
    queries: [{ name: "answer", sql: "select 1", dependencies: ["answer"] }],
  });
  await assert.rejects(
    createRegisteredServerQueryService(cycle.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
  );
  const abort = AbortSignal.abort();
  await assert.rejects(
    createRegisteredServerQueryService(setup().ports).execute(
      context,
      { values: {}, only: ["answer"] },
      abort,
    ),
  );
});
test("abort propagates to an in-flight read and prevents SQL execution", async () => {
  const s = setup();
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let supplied: AbortSignal | undefined;
  s.ports.reads.read = async (_c, _r, signal) => {
    supplied = signal;
    started();
    return new Promise(() => {});
  };
  s.ports.execute = async () => {
    throw Error("must_not_execute");
  };
  const work = createRegisteredServerQueryService(s.ports).execute(
    context,
    { values: {}, only: ["answer"] },
    controller.signal,
  );
  await reading;
  controller.abort(Error("caller_cancelled"));
  await assert.rejects(work, /caller_cancelled/);
  assert.equal(supplied?.aborted, true);
});
test("aggregate input budget and changed post-execution generation discard results", async () => {
  const s = setup();
  const read = s.ports.reads.read;
  let call = 0;
  s.ports.reads.read = async (...args) => {
    const r = await read(...args);
    if (++call === 3) r.generation = 4;
    return r;
  };
  await assert.rejects(
    createRegisteredServerQueryService(s.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
    /dataset_changed/,
  );
  const large = setup();
  large.ports.registry = async () => ({
    ...plan,
    imports: [],
    tables: [
      {
        schema: "main",
        table: "large",
        columns: [{ name: "n", type: "number" }],
        rows: Array.from({ length: 10001 }, () => ({ n: 1 })),
      },
    ],
  });
  await assert.rejects(
    createRegisteredServerQueryService(large.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
    /invalid_query_job/,
  );
});
test("platform identity/time/zone are trusted typed bindings and cannot be caller overrides", async () => {
  const s = setup();
  for (const key of ["_me__id", "_now", "_tz"])
    await assert.rejects(
      createRegisteredServerQueryService(s.ports).execute(context, {
        values: { [key]: "forged" },
        only: ["answer"],
      }),
      /invalid_query_request/,
    );
  s.ports.platform = async () => ({
    userId: "reader",
    now: "2026-01-01T00:00:00.000Z",
    tz: "invalid/zone",
  });
  await assert.rejects(
    createRegisteredServerQueryService(s.ports).execute(context, {
      values: {},
      only: ["answer"],
    }),
    /invalid_query_platform/,
  );
});
