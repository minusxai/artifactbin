import test from "node:test";
import assert from "node:assert/strict";
import {
  admitDataControl,
  completeControlOptions,
} from "../src/migration/conversion/compiled/data-controls.ts";
test("query-backed and finite static Select options preserve scalar binding while unsupported writes refuse", () => {
  assert.deepEqual(
    admitDataControl("Select", {
      value: "$choice",
      options: "$options",
      placeholder: "All",
    }),
    { kind: "select", value: "choice", options: "options" },
  );
  assert.equal(
    admitDataControl("Select", {
      value: "$choice",
      options: [{ value: 1, label: "One" }, 2],
    }).kind,
    "select",
  );
  for (const props of [
    { run: "$save" },
    { multiple: true },
    { allowCreate: true },
    { value: "literal" },
    { options: [{ value: 1, run: "save" }] },
  ])
    assert.throws(() =>
      admitDataControl("Select", {
        value: "$choice",
        options: "$options",
        ...props,
      }),
    );
});
test("DataTable admits read-only layout and formatting and refuses templates, image resources and row writes", () => {
  assert.deepEqual(
    admitDataControl("DataTable", {
      data: "$rows",
      rowKey: "id",
      height: "420px",
      columns: [{ col: "amount", fmt: ".2f", bar: true }],
      sort: { col: "amount", dir: "desc" },
    }),
    { kind: "table", data: "rows" },
  );
  for (const props of [
    { templates: [] },
    { columns: [{ col: "image", kind: "image" }] },
    { run: "$save" },
    { height: "50vh" },
    { sort: { col: "id", dir: "sideways" } },
  ])
    assert.throws(() =>
      admitDataControl("DataTable", { data: "$rows", ...props }),
    );
  assert.throws(() => admitDataControl("DataTable", { data: "$rows" }, true));
});
test("Select options collect complete SQL pages under explicit limits and refuse partial/mixed results", async () => {
  const initial = {
    columns: [{ name: "id", type: "number" }],
    rows: [{ id: 1 }],
    truncated: true,
    totalRows: 3,
  };
  const pages: number[] = [];
  const full = await completeControlOptions(initial, async (offset) => {
    pages.push(offset);
    return { ...initial, rows: [{ id: offset + 1 }], truncated: true };
  });
  assert.deepEqual(full.rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(full.truncated, false);
  await assert.rejects(
    completeControlOptions(initial, async () => ({ ...initial, rows: [] })),
  );
  await assert.rejects(
    completeControlOptions(initial, async () => ({ ...initial, totalRows: 4 })),
  );
  await assert.rejects(
    completeControlOptions(initial, async () => initial, { maxRows: 1 }),
  );
});
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
test("source admission sends immutable Select and readonly DataTable plans to the compiler", async () => {
  let seen: any;
  await compileArchivedLocal(
    {
      source:
        '<Helmet><Value name="choice" type="string" default="a"/><Value name="rows" type="table" value={[{id:"a",label:"A"}]}/></Helmet><Select value="$choice" options="$rows"/><DataTable data="$rows" columns={[{col:"label"}]}/>',
      coreUrl: "/af/v1/core.js",
    },
    {
      compiler: {
        compile: async (input) => {
          seen = input;
          throw Error("probe");
        },
      },
    },
  );
  assert.deepEqual(seen?.dataControls, [
    { kind: "select", value: "choice", options: "rows" },
    { kind: "table", data: "rows" },
  ]);
});
import { controlPageRequest } from "../src/migration/conversion/compiled/data-controls.ts";
test("table paging preserves typed sort and bounds requests before engine execution", () => {
  assert.deepEqual(
    controlPageRequest(
      { offset: 500, limit: 500, sort: { col: "id", dir: "desc" } },
      [{ name: "id" }],
    ),
    { offset: 500, limit: 500, sort: { col: "id", dir: "desc" } },
  );
  for (const page of [
    { offset: -1, limit: 1 },
    { offset: 0, limit: 501 },
    { offset: 0, limit: 1, sort: { col: "missing", dir: "asc" } },
    { offset: 0, limit: 1, sort: { col: "id", dir: "DROP" } },
  ])
    assert.throws(() => controlPageRequest(page, [{ name: "id" }]));
});
test("read-only comparison preserves authored metrics and rejects silently ignored or dynamic fields", () => {
  assert.deepEqual(
    admitDataControl("DataTable", {
      data: "$rows",
      transpose: true,
      header: "name",
      edge: true,
      metrics: [
        {
          col: "score",
          title: "Score",
          fmt: ".1f",
          better: "high",
          rank: "ranking",
          sub: "range",
        },
      ],
    }),
    { kind: "table", data: "rows", comparison: true },
  );
  for (const patch of [
    { metrics: [{ col: "score", run: "save" }] },
    { metrics: [{ col: "score", better: "fast" }] },
    { transpose: false, metrics: [] },
    { transpose: true, columns: [] },
  ])
    assert.throws(() =>
      admitDataControl("DataTable", {
        data: "$rows",
        transpose: true,
        ...patch,
      }),
    );
});
test("named readonly Column specs preserve table scopes and refuse ambiguous or writable templates", () => {
  const columns = [
    { id: "name-column", col: "name", hasContent: true },
    {
      id: "score-column",
      col: "score",
      fmt: ".1f",
      bar: true,
      hasContent: false,
    },
  ];
  assert.equal(
    admitDataControl(
      "DataTable",
      { id: "table", data: "$rows", rowKey: "key" },
      true,
      columns,
    ).kind,
    "table",
  );
  for (const attrs of [
    { data: "$rows" },
    { id: "table", data: "$rows" },
    { id: "table", data: "$rows", rowKey: "key", transpose: true },
  ])
    assert.throws(() => admitDataControl("DataTable", attrs, true, columns));
  assert.throws(() =>
    admitDataControl(
      "DataTable",
      { id: "table", data: "$rows", rowKey: "key" },
      true,
      [...columns, columns[0]],
    ),
  );
  assert.throws(() =>
    admitDataControl(
      "DataTable",
      { id: "table", data: "$rows", rowKey: "key" },
      true,
      [{ ...columns[0], run: "save" }] as any,
    ),
  );
});
