import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistoricalDatasetReplay } from "../src/datasets/history.ts";
import type { HistoricalDatasetReplayPorts } from "../src/datasets/history-contracts.ts";
const selection = {
  kind: "ready" as const,
  context: {
    pageId: "Page01",
    backendId: "Back01",
    backendVersion: "b",
    subject: null,
  },
  binding: "data",
  version: 1,
  tables: [{ schema: "main", name: "items" }],
};
const result = {
  version: 1,
  generation: 2,
  schema: "main",
  table: "items",
  columns: [
    { name: "name", type: "string" as const },
    { name: "count", type: "number" as const },
  ],
  rows: [
    { name: "<script>old</script>", count: 0 },
    { name: null, count: 3 },
  ],
  offset: 0,
  nextOffset: null,
  totalRows: 2,
};
const ports = (
  overrides: Partial<HistoricalDatasetReplayPorts> = {},
): HistoricalDatasetReplayPorts => ({
  resolve: async () => selection,
  read: async () => result,
  ...overrides,
});
test("historical data uses exact archived version and escapes cells while retaining null and number values", async () => {
  const html = await createHistoricalDatasetReplay(ports()).render(
    "Page01",
    1,
    null,
  );
  assert.match(html!, /Archived dataset version 1/);
  assert.match(html!, /&lt;script&gt;old&lt;\/script&gt;/);
  assert.match(html!, /<td>0<\/td>/);
  assert.match(html!, /<td><\/td><td>3<\/td>/);
  assert.doesNotMatch(html!, /<script|<link|<button|Loading data/);
});
test("ordinary pages remain unchanged; missing or revoked archived data never falls back to current rows", async () => {
  assert.equal(
    await createHistoricalDatasetReplay(
      ports({ resolve: async () => null }),
    ).render("Page01", 1, null),
    null,
  );
  for (const read of [
    async () => {
      throw Error("revoked");
    },
    async () => ({ ...result, version: 411 }),
  ]) {
    const html = await createHistoricalDatasetReplay(ports({ read })).render(
      "Page01",
      1,
      null,
    );
    assert.match(html!, /Archived dataset rows are unavailable/);
    assert.doesNotMatch(html!, /old|Loading data/);
  }
});
test("empty tables and bounded previews state honest totals", async () => {
  const html = await createHistoricalDatasetReplay(
    ports({ read: async () => ({ ...result, rows: [], totalRows: 0 }) }),
  ).render("Page01", 1, null);
  assert.match(html!, /No rows/);
  const preview = await createHistoricalDatasetReplay(
    ports({ read: async () => ({ ...result, totalRows: 105, nextOffset: 2 }) }),
  ).render("Page01", 1, null);
  assert.match(preview!, /Showing 2 of 105 rows/);
});
test("table count and oversized cells fail closed instead of amplifying host response", async () => {
  const html = await createHistoricalDatasetReplay(
    ports({
      read: async () => ({
        ...result,
        rows: [{ name: "a".repeat(210000), count: 1 }],
      }),
    }),
  ).render("Page01", 1, null);
  assert.match(html!, /unavailable/);
});
