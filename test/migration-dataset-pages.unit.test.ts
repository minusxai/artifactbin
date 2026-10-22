import { convertStandaloneDatasetPage } from "../src/migration/dataset-pages/convert.ts";
import { checkPage } from "../src/page/page-model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { planStandaloneDatasetPage } from "../src/migration/dataset-pages/plan.ts";
import { createDatasetPageReader } from "../src/migration/dataset-pages/reader.ts";
import { renderStandaloneDatasetPage } from "../src/migration/dataset-pages/render.ts";
import type { StandaloneDatasetPageInput } from "../src/migration/dataset-pages/contracts.ts";
import type {
  CompiledDatasetBinding,
  DatasetReadWindow,
} from "../src/migration/conversion/compiled/dataset-contracts.ts";
const binding = (): CompiledDatasetBinding => ({
  name: "dataset",
  legacyRef: "ref:fixture",
  backendNamespace: "legacyData",
  backendHref: "/af/v1/ids/ABC123",
  mode: "live",
  version: 1,
  tables: [
    {
      schema: "public",
      table: "rows",
      columns: [{ name: "label", type: "string" }],
    },
  ],
});
const input = (): StandaloneDatasetPageInput => ({
  title: "Dataset",
  coreUrl: "/af/v1/core.js",
  source: { kind: "stored", binding: binding() },
});
const window = (offset = 0): DatasetReadWindow => ({
  version: 1,
  generation: 1,
  schema: "public",
  table: "rows",
  columns: [{ name: "label", type: "string" }],
  rows: offset ? [{ label: "last" }] : [{ label: "first" }],
  offset,
  nextOffset: offset ? null : 1,
  totalRows: 2,
});
test("standalone dataset planner rejects malformed and duplicate columns", () => {
  for (const column of [
    { name: "label", type: "javascript" },
    { name: "", type: "string" },
  ]) {
    const i = input();
    if (i.source.kind === "stored")
      i.source.binding.tables[0]!.columns = [column];
    assert.throws(() => planStandaloneDatasetPage(i));
  }
  const i = input();
  if (i.source.kind === "stored")
    i.source.binding.tables[0]!.columns = [
      { name: "label", type: "string" },
      { name: "label", type: "string" },
    ];
  assert.throws(() => planStandaloneDatasetPage(i));
});
test("external datasets have an explicit unavailable page until exact registration exists", () => {
  const plan = planStandaloneDatasetPage({
    title: "External",
    coreUrl: "/af/v1/core.js",
    source: { kind: "external", registered: false },
  });
  assert.equal(plan.kind, "unavailable");
  const html = renderStandaloneDatasetPage(plan);
  assert.match(html, /connection has not been registered/);
  assert.doesNotMatch(html, /af-backend|client.query/);
});
test("window reader sends bounded exact scope and generation on continuation", async () => {
  const calls: unknown[] = [];
  const reader = createDatasetPageReader(
    binding(),
    async (namespace, args) => {
      calls.push({ namespace, args });
      return window(args.offset);
    },
    { pageSize: 1 },
  );
  const first = await reader.read(0);
  await reader.read(0, 1, first);
  assert.deepEqual(calls, [
    {
      namespace: "legacyData",
      args: {
        binding: "dataset",
        schema: "public",
        table: "rows",
        offset: 0,
        limit: 1,
      },
    },
    {
      namespace: "legacyData",
      args: {
        binding: "dataset",
        schema: "public",
        table: "rows",
        offset: 1,
        limit: 1,
        expectedVersion: 1,
        expectedGeneration: 1,
      },
    },
  ]);
});
test("empty tables render as empty rather than unavailable", async () => {
  const reader = createDatasetPageReader(binding(), async () => ({
    ...window(),
    rows: [],
    totalRows: 0,
    nextOffset: null,
  }));
  assert.equal((await reader.read(0)).rows.length, 0);
});
test("reader rejects denied, oversized, stale and malformed windows without exposing errors", async () => {
  for (const port of [
    async () => {
      throw Error("private detail");
    },
    async () => ({ ...window(), rows: [{ label: "x".repeat(2000) }] }),
    async () => ({ ...window(), columns: [{ name: "other", type: "string" }] }),
    async () => ({ ...window(), rows: [{ label: 42 }] }),
    async () => ({ ...window(), nextOffset: 0 }),
  ]) {
    const reader = createDatasetPageReader(binding(), port as any, {
      maxBytes: 1024,
    });
    await assert.rejects(reader.read(0), /^Error: Dataset read unavailable$/);
  }
  const reader = createDatasetPageReader(binding(), async () => ({
    ...window(1),
    generation: 2,
  }));
  await assert.rejects(reader.read(0, 1, window()), /Dataset read unavailable/);
});
test("continuation requires a previous window and table switches cannot reuse it", async () => {
  const b = binding();
  b.tables = [
    ...b.tables,
    { schema: "public", table: "other", columns: b.tables[0]!.columns },
  ];
  const reader = createDatasetPageReader(b, async () => window());
  await assert.rejects(reader.read(0, 1));
  await assert.rejects(reader.read(1, 1, window()));
});
test("HTML uses one core, exact read-only backend, escapes text and keeps rows out of source", () => {
  const i = input();
  i.title = "<img src=x onerror=alert(1)>";
  const html = renderStandaloneDatasetPage(planStandaloneDatasetPage(i));
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/data-af="core"/g) || []).length, 1);
  assert.match(html, /data-af-name="legacyData"/);
  assert.doesNotMatch(
    html,
    /mutation |caps\.|objectKey|policyRevision|<img src=x/,
  );
  assert.match(html, /textContent/);
  assert.match(html, /Next/);
});

test("reader rejects limits above the fixed browsing budget before reading", () => {
  for (const options of [
    { pageSize: 1001 },
    { maxBytes: 1024 * 1024 + 1 },
    { timeoutMs: 10001 },
    { pageSize: 0 },
  ])
    assert.throws(
      () => createDatasetPageReader(binding(), async () => window(), options),
      /Invalid dataset page limits/,
    );
});

test("browser projection omits original identities and extra server catalog properties", () => {
  const i = input();
  if (i.source.kind !== "stored") throw Error();
  Object.assign(i.source.binding, {
    sql: "SENSITIVE_SQL",
    policy: { secret: "SENSITIVE_POLICY" },
  });
  Object.assign(i.source.binding.tables[0]!, {
    objectKey: "SENSITIVE_STORAGE",
  });
  const html = renderStandaloneDatasetPage(planStandaloneDatasetPage(i));
  assert.doesNotMatch(html, /SENSITIVE_|ref:fixture|legacyRef/);
});

test("adapter emits a valid ordinary page and reports external unavailability", () => {
  const ready = convertStandaloneDatasetPage(input());
  assert.equal(ready.classification, "functional");
  assert.deepEqual(checkPage(ready.html!), []);
  const external = convertStandaloneDatasetPage({
    title: "External",
    coreUrl: "/af/v1/core.js",
    source: { kind: "external", registered: false },
  });
  assert.equal(external.classification, "renderable");
  assert.deepEqual(external.issues, [
    { code: "external-registration-required" },
  ]);
  assert.deepEqual(checkPage(external.html!), []);
});
