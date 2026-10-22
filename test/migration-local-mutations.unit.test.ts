import test from "node:test";
import assert from "node:assert/strict";
import { createCompiledLocalMutations } from "../src/migration/conversion/compiled/local-mutations.ts";
test("viewer mutations serialize snapshots and invalidate queries around each publication", async () => {
  let rows = [0],
    invalidations = 0;
  const seen: number[] = [];
  const adapter = createCompiledLocalMutations(["add"], {
    read: () => ({ values: {}, tables: { rows } }),
    execute: async (_n, _a, _r, s) => {
      const n = (s.tables.rows as number[])[0]!;
      seen.push(n);
      await Promise.resolve();
      return { target: "rows", rows: [n + 1] };
    },
    commit: (_s, r) => {
      rows = r.rows as number[];
    },
    invalidate: () => invalidations++,
    changed: () => {},
  });
  await Promise.all([adapter.mutate("add"), adapter.mutate("add")]);
  assert.deepEqual(seen, [0, 1]);
  assert.deepEqual(rows, [2]);
  assert.equal(invalidations, 4);
  await assert.rejects(adapter.mutate("shared"));
});
test("page disposal prevents a late local engine result from publishing", async () => {
  let release!: () => void,
    commits = 0;
  const gate = new Promise<void>((r) => (release = r));
  const adapter = createCompiledLocalMutations(["add"], {
    read: () => ({ values: {}, tables: {} }),
    execute: async () => {
      await gate;
      return { target: "rows", rows: [] };
    },
    commit: () => {
      commits++;
    },
    invalidate: () => {},
    changed: () => {},
  });
  const pending = adapter.mutate("add");
  await Promise.resolve();
  adapter.dispose();
  release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(commits, 0);
});

test("table snapshot conflicts reject and scalar reset preserves concurrent edits", async () => {
  const { applyCompiledLocalMutation: apply } = await import(
    "../src/migration/conversion/compiled/local-mutations.ts"
  );
  const declarations = [
    {
      name: "rows",
      type: "table" as const,
      default: [{ n: 0 }],
      columns: [{ name: "n", type: "number" as const }],
    },
    { name: "title", type: "string" as const, default: "" },
  ];
  const snapshot = {
    values: { title: "submitted" },
    tables: { rows: [{ n: 0 }] },
  };
  assert.throws(
    () =>
      apply(snapshot, { rows: [{ n: 9 }], title: "submitted" }, declarations, {
        target: "rows",
        rows: [{ n: 1 }],
      }),
    /changed/,
  );
  assert.throws(
    () =>
      apply(snapshot, { rows: [{ n: 0 }], title: "submitted" }, declarations, {
        target: "rows",
        rows: [{ n: "invalid" }],
      }),
    /Invalid/,
  );
  assert.deepEqual(
    apply(
      snapshot,
      { rows: [{ n: 0 }], title: "edited while saving" },
      declarations,
      { target: "rows", rows: [{ n: 1 }], reset: ["title"] },
    ),
    { rows: [{ n: 1 }], title: "edited while saving" },
  );
  assert.deepEqual(
    apply(snapshot, { rows: [{ n: 0 }], title: "submitted" }, declarations, {
      target: "rows",
      rows: [{ n: 1 }],
      reset: ["title"],
    }),
    { rows: [{ n: 1 }], title: "" },
  );
});
test("failed serialized mutation does not poison the next write and disposal cancels queued writes", async () => {
  let executions = 0,
    commits = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const adapter = createCompiledLocalMutations(["save"], {
    read: () => ({ values: {}, tables: {} }),
    execute: async () => {
      executions++;
      if (executions === 1) throw Error("rejected");
      return { target: "rows", rows: [] };
    },
    commit: () => {
      commits++;
    },
    invalidate: () => {},
    changed: () => {},
  });
  const first = adapter.mutate("save"),
    second = adapter.mutate("save");
  await assert.rejects(first, /rejected/);
  await second;
  assert.equal(commits, 1);
  const stopped = createCompiledLocalMutations(["save"], {
    read: () => ({ values: {}, tables: {} }),
    execute: async () => {
      await gate;
      return { target: "rows", rows: [] };
    },
    commit: () => {
      commits++;
    },
    invalidate: () => {},
    changed: () => {},
  });
  const active = stopped.mutate("save"),
    queued = stopped.mutate("save");
  await Promise.resolve();
  stopped.dispose();
  release();
  await assert.rejects(active, /cancelled/);
  await assert.rejects(queued, /cancelled/);
  assert.equal(commits, 1);
});
