import { expect, it } from "vitest";
import { readDataset } from "../gates/lib/native-dataset-page.mjs";
const schema = { data: { schema: { revision: "7", tables: [{ id: "opaque-table", label: "rows", columns: [] }] } } };
const page = (revision, rows, cursor) => ({ data: { rows: { revision, rows, source: { truncated: false, totalRows: 3, storedRows: 3 }, pageInfo: { hasNextPage: !!cursor, endCursor: cursor } } } });
it("discovers opaque table identity and follows every page before returning a complete total", async () => {
  const calls = [];
  const replies = [schema, page("7", [{ id: "a" }, { id: "b" }], "next"), page("7", [{ id: "c" }], null)];
  const result = await readDataset(async (text, variables) => {
    calls.push(variables);
    return replies.shift();
  });
  expect(result.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  expect(calls.slice(1)).toEqual([{ table: "opaque-table", after: null }, { table: "opaque-table", after: "next" }]);
});
it("refuses mixed revision pages instead of silently producing a wrong chart total", async () => {
  const replies = [schema, page("7", [{ id: "a" }], "next"), page("8", [{ id: "b" }], null)];
  await expect(readDataset(async () => replies.shift())).rejects.toThrow("changed while reading");
});
it("refuses a broken repeated cursor rather than hanging the gate", async () => {
  const replies = [schema, page("7", [], "next"), page("7", [], "next")];
  await expect(readDataset(async () => replies.shift())).rejects.toThrow("cursor did not advance");
});
