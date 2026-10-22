import test from "node:test";
import assert from "node:assert/strict";
import { planStandaloneDatasetPage } from "../src/migration/dataset-pages/plan.ts";
import { convertStandaloneDatasetPage } from "../src/migration/dataset-pages/convert.ts";
import { createExternalDatasetPageReader } from "../src/migration/dataset-pages/external-reader.ts";
import { checkPage } from "../src/page/page-model.ts";
import type { RegisteredExternalDatasetPageSource } from "../src/migration/dataset-pages/contracts.ts";
const source = (): RegisteredExternalDatasetPageSource => ({
  kind: "external",
  registered: true,
  backendHref: "/af/v1/ids/ABC123",
  backendNamespace: "legacyData",
  tables: [
    {
      schema: "models",
      table: "rows",
      queryName: "datasetTable0",
      columns: [{ name: "label", type: "string" }],
    },
  ],
});
const result = (truncated = false) => ({
  columns: [{ name: "label", type: "string" }],
  rows: [{ label: "safe" }],
  ...(truncated ? { truncated: true } : {}),
});
test("registered external input validates exact names, columns and relative backend before rendering", () => {
  for (const mutate of [
    (s: any) => (s.backendHref = "https://example.com/backend"),
    (s: any) => (s.backendNamespace = "other"),
    (s: any) => (s.tables[0].queryName = "bad-name"),
    (s: any) => s.tables[0].columns.push(s.tables[0].columns[0]),
    (s: any) => (s.tables[0].columns[0].type = "javascript"),
    (s: any) => (s.tables = []),
  ]) {
    const s = source();
    mutate(s);
    assert.throws(() =>
      planStandaloneDatasetPage({
        title: "Data",
        coreUrl: "/af/v1/core.js",
        source: s,
      }),
    );
  }
});
test("external reader uses only registered names and empty values with bounded windows", async () => {
  const calls: unknown[] = [];
  const reader = createExternalDatasetPageReader(
    source(),
    async (args) => {
      calls.push(args);
      return result(args.offset === 0);
    },
    { pageSize: 1 },
  );
  const first = await reader.read(0);
  assert.equal(first.nextOffset, 1);
  const last = await reader.read(0, first.nextOffset!);
  assert.equal(last.nextOffset, null);
  assert.deepEqual(calls, [
    { name: "datasetTable0", valuesJson: "{}", offset: 0, limit: 1 },
    { name: "datasetTable0", valuesJson: "{}", offset: 1, limit: 1 },
  ]);
  assert.equal("generation" in first, false);
  assert.equal("totalRows" in first, false);
});
test("external reader preserves empty success and rejects malformed denied or over-budget output", async () => {
  const empty = createExternalDatasetPageReader(source(), async () => ({
    ...result(),
    rows: [],
  }));
  assert.equal((await empty.read(0)).rows.length, 0);
  for (const port of [
    async () => {
      throw Error("private-detail");
    },
    async () => ({ ...result(), rows: [{ label: 42 }] }),
    async () => ({ ...result(), columns: [{ name: "other", type: "string" }] }),
    async () => ({ ...result(), truncated: "yes" }),
    async () => ({ ...result(), rows: [], truncated: true }),
    async () => ({ ...result(), rows: [{ label: "x".repeat(2000) }] }),
  ]) {
    await assert.rejects(
      createExternalDatasetPageReader(source(), port, { maxBytes: 1024 }).read(
        0,
      ),
      /^Error: Dataset read unavailable$/,
    );
  }
});
test("external offset and budgets are checked without issuing requests", async () => {
  let calls = 0;
  const port = async () => {
    calls++;
    return result();
  };
  const reader = createExternalDatasetPageReader(source(), port);
  await assert.rejects(reader.read(0, 1000001));
  await assert.rejects(reader.read(1));
  assert.equal(calls, 0);
  assert.throws(() =>
    createExternalDatasetPageReader(source(), port, { pageSize: 1001 }),
  );
});
test("external HTML has a fixed sourceQuery operation and leaks no source SQL resources or fabricated totals", () => {
  const s = source();
  Object.assign(s, { sql: "SENSITIVE_SQL", resource: "SENSITIVE_RESOURCE" });
  Object.assign(s.tables[0]!, { modelCellId: "SENSITIVE_MODEL" });
  const converted = convertStandaloneDatasetPage({
    title: "<unsafe>",
    coreUrl: "/af/v1/core.js",
    source: s,
  });
  assert.equal(converted.classification, "functional");
  assert.deepEqual(checkPage(converted.html!), []);
  assert.match(converted.html!, /sourceQuery\(name:/);
  assert.doesNotMatch(
    converted.html!,
    /SENSITIVE_|totalRows|generation|expectedVersion|mutation /,
  );
  assert.match(converted.html!, /textContent/);
  assert.match(converted.html!, /&lt;unsafe&gt;/);
});

test("rendered metadata round-trips hostile schema table and column names without creating scripts", () => {
  const schema = "<schema>",
    table = "</script><script>danger()</script>",
    column = "<column>";
  const external = source();
  external.tables = [
    {
      schema,
      table,
      queryName: "datasetTable0",
      columns: [{ name: column, type: "string" }],
    },
  ];
  const stored = {
    name: "dataset",
    legacyRef: "ref:fixture",
    backendHref: "/af/v1/ids/ABC123",
    backendNamespace: "legacyData",
    mode: "live" as const,
    version: 1,
    tables: [{ schema, table, columns: [{ name: column, type: "string" }] }],
  };
  for (const inputSource of [
    external,
    { kind: "stored" as const, binding: stored },
  ]) {
    const html = convertStandaloneDatasetPage({
      title: "Data",
      coreUrl: "/af/v1/core.js",
      source: inputSource,
    }).html!;
    const literal = /const (?:source|binding)=(.*),makeReader=/.exec(html)?.[1];
    assert.ok(literal);
    const metadata = JSON.parse(literal);
    assert.equal(metadata.tables[0].schema, schema);
    assert.equal(metadata.tables[0].table, table);
    assert.equal(metadata.tables[0].columns[0].name, column);
    assert.equal((html.match(/<script\b/g) || []).length, 2);
    assert.deepEqual(checkPage(html), []);
  }
});
