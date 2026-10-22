import test from "node:test";
import assert from "node:assert/strict";
import { createCompiledQueryController } from "../src/migration/conversion/compiled/query-controller.ts";
import type {
  CompiledQueryPorts,
  CompiledQueryPublication,
  CompiledQueryAnswer,
} from "../src/migration/conversion/compiled/query-controller-contracts.ts";
const table = {
  columns: [{ name: "label", type: "string" }],
  rows: [{ label: "first" }],
  totalRows: 1,
};
const answer = (): CompiledQueryAnswer => ({
  tables: { rows: { ...table } },
  errors: {},
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function setup(
  overrides: Partial<CompiledQueryPorts> = {},
  options: readonly string[] = [],
) {
  const publications: CompiledQueryPublication[] = [];
  let clock = 0;
  const ports: CompiledQueryPorts = {
    engine: {
      prepare() {},
      ready: () => true,
      run: async () => answer(),
      page: async () => table,
    },
    evaluation: async () => ({
      values: {},
      localTables: {},
      userId: null,
      now: String(clock),
      tz: "UTC",
    }),
    availability: () => "ready",
    publish: (value) => publications.push(value),
    clock: {
      now: () => clock,
      schedule: () => () => {},
      sleep: async (ms) => {
        clock += ms;
      },
    },
    ...overrides,
  };
  return {
    ports,
    publications,
    controller: createCompiledQueryController(
      { queries: ["rows"], optionQueries: options, deadlineMs: 20 },
      ports,
    ),
  };
}
test("overlapping refresh and invalidation never publish stale results or stale completion status", async () => {
  const first = deferred<CompiledQueryAnswer>();
  let calls = 0;
  const { controller, publications } = setup({
    engine: {
      prepare() {},
      ready: () => true,
      run: () => (++calls === 1 ? first.promise : Promise.resolve(answer())),
      page: async () => table,
    },
  });
  const a = controller.refresh();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await controller.refresh(), true);
  const settled = publications.filter((p) => p.state === "settled").length;
  first.resolve(answer());
  assert.equal(await a, false);
  assert.equal(
    publications.filter((p) => p.state === "settled").length,
    settled,
  );
  controller.invalidate();
  assert.equal(publications.at(-1)?.state, "cleared");
});
test("one evaluation is reused for every option completion, next refresh gets a fresh snapshot", async () => {
  const evaluations: unknown[] = [];
  let count = 0;
  const { controller } = setup(
    {
      evaluation: async () => ({
        values: { n: ++count },
        localTables: {},
        userId: null,
        now: String(count),
        tz: "UTC",
      }),
      engine: {
        prepare() {},
        ready: () => true,
        run: async (e) => {
          evaluations.push(e);
          return { tables: { rows: { ...table, totalRows: 3 } }, errors: {} };
        },
        page: async (_n, p, e) => {
          evaluations.push(e);
          return {
            ...table,
            rows: [{ label: String(p.offset) }],
            totalRows: 3,
          };
        },
      },
    },
    ["rows"],
  );
  assert.equal(await controller.refresh(), true);
  assert.equal(evaluations.length, 3);
  assert.ok(evaluations.every((e) => e === evaluations[0]));
  await controller.refresh();
  assert.notEqual(evaluations[3], evaluations[0]);
});
test("deadline and engine failure clear tables, recover, and disposal is terminal", async () => {
  let ready = false;
  const { controller, publications } = setup({
    engine: {
      prepare() {},
      ready: () => ready,
      run: async () => answer(),
      page: async () => table,
    },
  });
  assert.equal(await controller.refresh(), false);
  assert.equal(publications.at(-1)?.state, "failed");
  ready = true;
  assert.equal(await controller.refresh(), true);
  controller.dispose();
  const count = publications.length;
  assert.equal(await controller.refresh(), false);
  assert.equal(publications.length, count);
  await assert.rejects(
    controller.fetchPage("rows", { offset: 0, limit: 1 }, table.columns),
  );
});
test("table windows validate declared names/order and reject results after principal invalidation", async () => {
  const page = deferred<typeof table>();
  let reads = 0;
  const { controller } = setup({
    engine: {
      prepare() {},
      ready: () => true,
      run: async () => answer(),
      page: () => {
        reads++;
        return page.promise;
      },
    },
  });
  await assert.rejects(
    controller.fetchPage("unknown", { offset: 0, limit: 1 }, table.columns),
  );
  await assert.rejects(
    controller.fetchPage(
      "rows",
      { offset: 0, limit: 1, sort: { col: "secret", dir: "asc" } },
      table.columns,
    ),
  );
  assert.equal(reads, 0);
  const result = controller.fetchPage(
    "rows",
    { offset: 0, limit: 1 },
    table.columns,
  );
  await Promise.resolve();
  controller.invalidate();
  page.resolve(table);
  await assert.rejects(result, /snapshot|cancel/i);
});
test("blocked or failed authorization never evaluates, late captured identity cannot start engine", async () => {
  const evaluation =
    deferred<Awaited<ReturnType<CompiledQueryPorts["evaluation"]>>>();
  let availability: "ready" | "blocked" | "failed" = "blocked",
    runs = 0;
  const { controller, publications } = setup({
    availability: () => availability,
    evaluation: () => evaluation.promise,
    engine: {
      prepare() {},
      ready: () => true,
      run: async () => {
        runs++;
        return answer();
      },
      page: async () => table,
    },
  });
  assert.equal(await controller.refresh(), false);
  assert.equal(publications.length, 0);
  availability = "ready";
  const pending = controller.refresh();
  availability = "failed";
  controller.invalidate();
  evaluation.resolve({
    values: {},
    localTables: {},
    userId: "old",
    now: "0",
    tz: "UTC",
  });
  assert.equal(await pending, false);
  assert.equal(runs, 0);
});

test("query errors are settled data, while missing option snapshots fail closed and can recover", async () => {
  let mode = "query-error";
  const { controller, publications } = setup({
    engine: {
      prepare() {},
      ready: () => true,
      run: async () =>
        mode === "query-error"
          ? { tables: { rows: table }, errors: { rows: "Denied" } }
          : mode === "missing"
            ? { tables: {}, errors: {} }
            : answer(),
      page: async () => table,
    },
  });
  assert.equal(await controller.refresh(), false);
  assert.equal(publications.at(-1)?.state, "settled");
  const options = setup(
    {
      engine: {
        prepare() {},
        ready: () => true,
        run: async () =>
          mode === "missing" ? { tables: {}, errors: {} } : answer(),
        page: async () => table,
      },
    },
    ["rows"],
  );
  mode = "missing";
  assert.equal(await options.controller.refresh(), false);
  assert.equal(options.publications.at(-1)?.state, "failed");
  mode = "ok";
  assert.equal(await options.controller.refresh(), true);
  assert.equal(options.publications.at(-1)?.state, "settled");
});
test("late failures after replacement cannot overwrite the successful latest query", async () => {
  let rejectFirst!: (reason: Error) => void,
    calls = 0;
  const first = new Promise<CompiledQueryAnswer>(
    (_resolve, reject) => (rejectFirst = reject),
  );
  const { controller, publications } = setup({
    engine: {
      prepare() {},
      ready: () => true,
      run: () => (++calls === 1 ? first : Promise.resolve(answer())),
      page: async () => table,
    },
  });
  const old = controller.refresh();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(await controller.refresh(), true);
  const snapshot = [...publications];
  rejectFirst(Error("late denied"));
  assert.equal(await old, false);
  await Promise.resolve();
  assert.deepEqual(publications, snapshot);
});
test("invalidation releases a hung ready wait and dispose clears exactly once", async () => {
  const sleeps: AbortSignal[] = [];
  const { controller, publications } = setup({
    engine: {
      prepare() {},
      ready: () => false,
      run: async () => answer(),
      page: async () => table,
    },
    clock: {
      now: () => 0,
      sleep: async (_ms, signal) => {
        sleeps.push(signal);
        await new Promise(() => {});
      },
      schedule: () => () => {},
    },
  });
  const pending = controller.refresh();
  assert.equal(sleeps.length, 1);
  controller.invalidate();
  assert.equal(sleeps[0]!.aborted, true);
  assert.equal(await pending, false);
  controller.dispose();
  const count = publications.length;
  controller.dispose();
  controller.invalidate();
  assert.equal(publications.length, count);
});

function injectedClock() {
  let now = 0;
  const timers = new Map<() => void, number>();
  const schedule = (callback: () => void, ms: number) => {
    timers.set(callback, now + ms);
    return () => {
      timers.delete(callback);
    };
  };
  return {
    timers,
    elapse(ms: number) {
      now += ms;
    },
    advance(ms: number) {
      now += ms;
      for (const [callback, at] of [...timers])
        if (at <= now) {
          timers.delete(callback);
          callback();
        }
    },
    port: {
      now: () => now,
      schedule,
      sleep: (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          const abort = () => {
            stop();
            signal.removeEventListener("abort", abort);
            reject(Error("cancelled"));
          };
          const stop = schedule(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, ms);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
for (const phase of ["evaluation", "run", "option-page", "table-page"] as const)
  test(`total deadline releases hung ${phase}, clears timers and ignores late result`, async () => {
    const clock = injectedClock();
    const evaluation =
        deferred<Awaited<ReturnType<CompiledQueryPorts["evaluation"]>>>(),
      run = deferred<CompiledQueryAnswer>(),
      page = deferred<typeof table>();
    const { controller, publications } = setup(
      {
        clock: clock.port,
        evaluation:
          phase === "evaluation"
            ? () => evaluation.promise
            : async () => ({
                values: {},
                localTables: {},
                userId: null,
                now: "0",
                tz: "UTC",
              }),
        engine: {
          prepare() {},
          ready: () => true,
          run:
            phase === "run"
              ? () => run.promise
              : async () => ({
                  tables: {
                    rows: {
                      ...table,
                      totalRows: phase === "option-page" ? 2 : 1,
                    },
                  },
                  errors: {},
                }),
          page: () => page.promise,
        },
      },
      phase === "option-page" ? ["rows"] : [],
    );
    const pending =
      phase === "table-page"
        ? controller.fetchPage("rows", { offset: 0, limit: 1 }, table.columns)
        : controller.refresh();
    await flush();
    clock.advance(20);
    await flush();
    if (phase === "table-page") await assert.rejects(pending, /timed out/);
    else {
      assert.equal(await pending, false);
      assert.equal(publications.at(-1)?.state, "failed");
    }
    assert.equal(clock.timers.size, 0);
    const count = publications.length;
    evaluation.resolve({
      values: {},
      localTables: {},
      userId: "old",
      now: "0",
      tz: "UTC",
    });
    run.resolve(answer());
    page.resolve(table);
    await flush();
    assert.equal(publications.length, count);
  });
test("evaluation and engine execution share one deadline instead of restarting the budget at each await", async () => {
  const clock = injectedClock(),
    evaluation =
      deferred<Awaited<ReturnType<CompiledQueryPorts["evaluation"]>>>(),
    run = deferred<CompiledQueryAnswer>();
  const { controller, publications } = setup({
    clock: clock.port,
    evaluation: () => evaluation.promise,
    engine: {
      prepare() {},
      ready: () => true,
      run: () => run.promise,
      page: async () => table,
    },
  });
  const pending = controller.refresh();
  clock.advance(12);
  evaluation.resolve({
    values: {},
    localTables: {},
    userId: null,
    now: "0",
    tz: "UTC",
  });
  await flush();
  clock.advance(8);
  await flush();
  assert.equal(await pending, false);
  assert.equal(publications.at(-1)?.state, "failed");
  assert.equal(clock.timers.size, 0);
});

test("late promise completion cannot beat a due deadline whose timer has not yet run", async () => {
  const clock = injectedClock(),
    run = deferred<CompiledQueryAnswer>();
  const { controller, publications } = setup({
    clock: clock.port,
    engine: {
      prepare() {},
      ready: () => true,
      run: () => run.promise,
      page: async () => table,
    },
  });
  const pending = controller.refresh();
  await flush();
  clock.elapse(20);
  run.resolve(answer());
  assert.equal(await pending, false);
  assert.equal(publications.at(-1)?.state, "failed");
  assert.equal(clock.timers.size, 0);
});

test("expired synchronous preparation does not dispatch evaluation or engine execution", async () => {
  const clock = injectedClock();
  let evaluations = 0,
    runs = 0;
  const { controller } = setup({
    clock: clock.port,
    evaluation: async () => {
      evaluations++;
      return { values: {}, localTables: {}, userId: null, now: "0", tz: "UTC" };
    },
    engine: {
      prepare: () => clock.elapse(20),
      ready: () => true,
      run: async () => {
        runs++;
        return answer();
      },
      page: async () => table,
    },
  });
  assert.equal(await controller.refresh(), false);
  assert.equal(evaluations, 0);
  assert.equal(runs, 0);
  assert.equal(clock.timers.size, 0);
});

for (const action of ["supersede", "dispose"] as const)
  test(`${action} releases a hung engine deadline and suppresses its late result`, async () => {
    const clock = injectedClock(),
      first = deferred<CompiledQueryAnswer>();
    let calls = 0;
    const { controller, publications } = setup({
      clock: clock.port,
      engine: {
        prepare() {},
        ready: () => true,
        run: () => (++calls === 1 ? first.promise : Promise.resolve(answer())),
        page: async () => table,
      },
    });
    const pending = controller.refresh();
    await flush();
    assert.equal(clock.timers.size, 1);
    if (action === "supersede") assert.equal(await controller.refresh(), true);
    else controller.dispose();
    assert.equal(await pending, false);
    assert.equal(clock.timers.size, 0);
    const count = publications.length;
    first.resolve(answer());
    clock.advance(20);
    await flush();
    assert.equal(publications.length, count);
  });
