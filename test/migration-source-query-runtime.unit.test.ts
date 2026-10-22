import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompiledSourceQueryEngine } from "../src/migration/conversion/compiled/source-query-runtime.ts";
import type { CompiledSourceQueryBinding } from "../src/migration/conversion/compiled/source-query-contracts.ts";
const binding: CompiledSourceQueryBinding = {
  name: "rows",
  sourceRef: "ref:Abcd12",
  backendNamespace: "legacyData",
  backendHref: "/af/v1/ids/Bk1234",
  sqlSha256: "a".repeat(64),
  params: { choice: "string", _now: "timestamp" },
  columns: [{ name: "label", type: "string" }],
};
const evaluation = {
  values: { choice: "one", ignored: "private" },
  localTables: {},
  userId: "forged-client-principal",
  now: "forged-client-clock",
  tz: "UTC" as const,
};
const table = {
  columns: binding.columns,
  rows: [{ label: "One" }],
  totalRows: 1,
};
test("named source reads send only declared author values and validated paging, never platform inputs", async () => {
  const requests: any[] = [];
  const engine = createCompiledSourceQueryEngine([binding], {
    read: async (_b, r) => {
      requests.push(r);
      return JSON.stringify({ ...table, totalRows: r.offset + 1 });
    },
  });
  assert.equal(engine.ready(), true);
  assert.deepEqual(
    (await engine.run(null, ["rows"], evaluation)).tables.rows,
    table,
  );
  assert.deepEqual(JSON.parse(requests[0].valuesJson), { choice: "one" });
  assert.equal(requests[0].name, "rows");
  assert.equal(requests[0].offset, 0);
  await engine.page(
    null,
    "rows",
    { offset: 10, limit: 20, sort: { col: "label", dir: "desc" } },
    evaluation,
  );
  assert.deepEqual(requests[1], {
    name: "rows",
    valuesJson: '{"choice":"one"}',
    offset: 10,
    limit: 20,
    sortJson: '{"col":"label","dir":"desc"}',
  });
  await assert.rejects(
    engine.page(null, "other", { offset: 0, limit: 1 }, evaluation),
  );
  await assert.rejects(
    engine.page(
      null,
      "rows",
      { offset: 0, limit: 1, sort: { col: "other", dir: "asc" } },
      evaluation,
    ),
  );
});
test("source query responses reject extra schema, invalid types, truncation ambiguity and backend errors", async () => {
  for (const response of [
    null,
    "invalid",
    { ...table, columns: [{ name: "other", type: "string" }] },
    { ...table, rows: [{ label: "One", extra: "hidden" }] },
    { ...table, rows: [{ label: 2 }] },
    { ...table, totalRows: 0 },
    { ...table, truncated: true },
  ]) {
    const engine = createCompiledSourceQueryEngine([binding], {
      read: async () => response,
    });
    assert.deepEqual((await engine.run(null, ["rows"], evaluation)).errors, {
      rows: "Source query unavailable",
    });
  }
  const denied = createCompiledSourceQueryEngine([binding], {
    read: async () => {
      throw Error("denied");
    },
  });
  await assert.rejects(
    denied.page(null, "rows", { offset: 0, limit: 10 }, evaluation),
  );
});

test("source query fanout stays bounded while independent queries can progress", async () => {
  let active = 0,
    peak = 0;
  const engine = createCompiledSourceQueryEngine(
    Array.from({ length: 9 }, (_, i) => ({ ...binding, name: "q" + i })),
    {
      read: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setImmediate(r));
        active--;
        return JSON.stringify(table);
      },
    },
  );
  const answer = await engine.run(
    null,
    Array.from({ length: 9 }, (_, i) => "q" + i),
    evaluation,
  );
  assert.equal(Object.keys(answer.tables).length, 9);
  assert.equal(peak, 4);
});
test("authored timestamp parameters retain the local scalar timestamp contract", async () => {
  const requests: any[] = [];
  const b = { ...binding, params: { at: "timestamp" as const } };
  const engine = createCompiledSourceQueryEngine([b], {
    read: async (_b, r) => {
      requests.push(r);
      return JSON.stringify(table);
    },
  });
  assert.deepEqual(
    (await engine.run(null, ["rows"], { ...evaluation, values: { at: 0 } }))
      .errors,
    {},
  );
  assert.deepEqual(JSON.parse(requests[0].valuesJson), {
    at: "1970-01-01T00:00:00.000Z",
  });
});
