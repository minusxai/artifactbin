import test from "node:test";
import assert from "node:assert/strict";
import { readCompiledDataset } from "../src/migration/conversion/compiled/dataset-reader.ts";
const binding = {
  name: "tasks",
  legacyRef: "ref:Dataset001",
  backendNamespace: "legacyData",
  backendHref: "/af/v1/ids/Abcd12",
  mode: "pinned" as const,
  version: 1,
  tables: [
    {
      schema: "public",
      table: "rows",
      columns: [{ name: "owner", type: "user" }],
    },
  ],
};
test("protected user columns preserve string identities and null without numeric coercion", async () => {
  const response = (value: unknown) => ({
    version: 1,
    generation: 0,
    schema: "public",
    table: "rows",
    columns: [{ name: "owner", type: "user" }],
    rows: [{ owner: value }],
    offset: 0,
    nextOffset: null,
    totalRows: 1,
  });
  for (const value of ["001", null])
    assert.deepEqual(
      (await readCompiledDataset(binding, async () => response(value) as any))
        .rows!.rows,
      [{ owner: value }],
    );
  for (const value of [1, {}, []])
    await assert.rejects(
      readCompiledDataset(binding, async () => response(value) as any),
    );
});
