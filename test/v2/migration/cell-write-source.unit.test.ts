import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readLegacyCellWriteSites,
  typeLegacyCellWriteSites,
} from "../../../src/migration/conversion/compiled/cell-write-source.ts";
const source =
  '<DataTable data="$rows" rowKey="id"><Column col="title"><input value="$_row.title" run="$save" type="text"/></Column><Column col="tags"><Select value="$_row.tags" run="$tags" options="$choices" multiple={true} valueFormat="json" allowCreate={true}/></Column></DataTable>';
test("editing-cell sites bind exact authored table, column, key and immutable scalar type", () => {
  const sites = readLegacyCellWriteSites(source);
  assert.deepEqual(sites, [
    {
      mutationName: "save",
      dataName: "rows",
      column: "title",
      rowKey: "id",
      tag: "input",
    },
    {
      mutationName: "tags",
      dataName: "rows",
      column: "tags",
      rowKey: "id",
      tag: "Select",
    },
  ]);
  assert.deepEqual(
    typeLegacyCellWriteSites(sites, {
      rows: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "tags", type: "string" },
      ],
    }).map((s) => s.type),
    ["string", "string"],
  );
  assert.throws(() =>
    typeLegacyCellWriteSites(sites, { rows: [{ name: "id", type: "string" }] }),
  );
});
test("editing cells refuse missing row identity, mismatched fields, ambient user options and conflicting types", () => {
  for (const input of [
    source.replace(' rowKey="id"', ""),
    source.replace("$_row.title", "$_row.other"),
    source.replace(' options="$choices"', ""),
    '<input value="$_row.title" run="$save"/>',
  ])
    assert.throws(() => readLegacyCellWriteSites(input));
  const sites = readLegacyCellWriteSites(source);
  assert.throws(() =>
    typeLegacyCellWriteSites(
      sites.map((s) => ({ ...s, mutationName: "same" })),
      {
        rows: [
          { name: "id", type: "string" },
          { name: "title", type: "number" },
          { name: "tags", type: "string" },
        ],
      },
    ),
  );
});
