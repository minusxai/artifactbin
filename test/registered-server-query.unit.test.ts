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
  pageVersion: 7,
  sourceSha256: "a".repeat(64),
};
const { subject: _subject, ...registration } = context;
const plan: RegisteredServerQueryPlan = {
  registration,
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
test("registry identity must match the exact saved page, backend, version and source before any capability runs", async () => {
  for (const changed of [
    { backendId: "other" },
    { backendVersion: "other" },
    { pageId: "other" },
    { pageVersion: 8 },
    { sourceSha256: "b".repeat(64) },
  ]) {
    const s = setup();
    let authorityCalls = 0;
    s.ports.registry = async () => ({
      ...plan,
      registration: { ...registration, ...changed },
    });
    s.ports.authorize = async () => {
      authorityCalls++;
      return true;
    };
    await assert.rejects(
      createRegisteredServerQueryService(s.ports).execute(context, {
        values: {},
        only: ["answer"],
      }),
      /invalid_query_registry/,
    );
    assert.equal(authorityCalls, 0);
    assert.equal(s.calls.length, 0);
  }
});
test("an invocation snapshots context, request and registration before asynchronous host work", async () => {
  const s = setup();
  const callerContext = { ...context };
  const input = { values: { minimum: 2 }, only: ["answer"] };
  let release!: (value: RegisteredServerQueryPlan) => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  s.ports.registry = async (c) => {
    assert.equal(Object.isFrozen(c), true);
    entered();
    return new Promise((r) => {
      release = r;
    });
  };
  s.ports.authorize = async (c, identity) => {
    assert.deepEqual(c, context);
    assert.deepEqual(identity, registration);
    assert.equal(Object.isFrozen(identity), true);
    return true;
  };
  const work = createRegisteredServerQueryService(s.ports).execute(
    callerContext,
    input,
  );
  await started;
  callerContext.subject = "other";
  callerContext.sourceSha256 = "b".repeat(64);
  input.values.minimum = 99;
  input.only.splice(0, 1, "unknown");
  release(plan);
  await work;
  const job = s.calls[2] as { input: { params: { minimum: number } } };
  assert.equal(job.input.params.minimum, 2);
});
test("deadline and caller cancellation reach registry, initial/final authorization and platform ports without starting later work", async () => {
  for (const stage of [
    "registry",
    "authorize",
    "platform",
    "final_authorize",
  ] as const) {
    for (const mode of ["deadline", "caller"] as const) {
      const s = setup();
      let entered!: () => void;
      const started = new Promise<void>((r) => {
        entered = r;
      });
      let supplied: AbortSignal | undefined;
      let count = 0;
      const hold = async (signal: AbortSignal) => {
        supplied = signal;
        entered();
        return new Promise<never>(() => {});
      };
      if (stage === "registry") s.ports.registry = (_c, signal) => hold(signal);
      if (stage === "platform") s.ports.platform = (_c, signal) => hold(signal);
      if (stage === "authorize" || stage === "final_authorize")
        s.ports.authorize = async (_c, _identity, signal) => {
          if (stage === "authorize" || ++count === 2) return hold(signal);
          return true;
        };
      let expire!: () => void;
      let cancelled = false;
      const controller = new AbortController();
      const service = createRegisteredServerQueryService(s.ports, {
        scheduleDeadline(ms, callback) {
          assert.equal(ms, 20000);
          expire = callback;
          return () => {
            cancelled = true;
          };
        },
      });
      const work = service.execute(
        context,
        { values: {}, only: ["answer"] },
        controller.signal,
      );
      await started;
      if (mode === "deadline") expire();
      else controller.abort(Error("caller_cancelled"));
      await assert.rejects(
        work,
        mode === "deadline" ? /query_deadline/ : /caller_cancelled/,
      );
      assert.equal(supplied?.aborted, true);
      assert.equal(cancelled, true);
      if (stage !== "final_authorize") assert.equal(s.calls.length, 0);
    }
  }
});
test("source or saved version changes during object and SQL I/O discard the result under the original registration", async () => {
  for (const stage of ["read", "sql"] as const) {
    for (const changed of [
      { backendVersion: "new-deployment" },
      { pageVersion: 8 },
      { sourceSha256: "b".repeat(64) },
    ]) {
      const s = setup();
      let current = { ...registration };
      s.ports.authorize = async (_context, expected) => {
        assert.deepEqual(expected, registration);
        return Object.entries(expected).every(
          ([key, value]) => current[key as keyof typeof current] === value,
        );
      };
      if (stage === "read") {
        const read = s.ports.reads.read;
        s.ports.reads.read = async (...args) => {
          const value = await read(...args);
          current = { ...current, ...changed };
          return value;
        };
      } else {
        const execute = s.ports.execute;
        s.ports.execute = async (...args) => {
          const value = await execute(...args);
          current = { ...current, ...changed };
          return value;
        };
      }
      await assert.rejects(
        createRegisteredServerQueryService(s.ports).execute(context, {
          values: {},
          only: ["answer"],
        }),
        /denied/,
      );
    }
  }
});
