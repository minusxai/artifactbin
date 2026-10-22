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
      optionsQuery: "choices",
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
test("offline compiled column inference must agree with every registered cell value type", async () => {
  const { validateCompiledCellWriteContexts } = await import(
    "../../../src/migration/conversion/compiled/cell-write-context.ts"
  );
  const flow = {
    queries: [
      {
        name: "rows",
        columns: [
          { name: "id", type: "string" as const },
          { name: "title", type: "string" as const },
          { name: "tags", type: "string" as const },
        ],
      },
    ],
    values: [],
  };
  const bindings = ["save", "tags"].map((name) => ({
    name,
    backendNamespace: "legacyData",
    recoveryScope: "a".repeat(64),
    paramTypes: {},
    valueParam: { param: "cell__value", type: "string" as const },
  }));
  assert.doesNotThrow(() =>
    validateCompiledCellWriteContexts(source, flow, bindings),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts(
      source,
      {
        ...flow,
        queries: [
          {
            name: "rows",
            columns: flow.queries[0]!.columns.map((c) => ({
              ...c,
              type: null,
            })),
          },
        ],
      },
      bindings,
    ),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts(
      source,
      flow,
      bindings.map((b) => ({
        ...b,
        valueParam: { ...b.valueParam, type: "number" as const },
      })),
    ),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts("<p>None</p>", flow, bindings),
  );
});
test("explicit cell option source port never adds an ambient user listing", async () => {
  const { archivedExplicitCellOptionsSource } = await import(
    "../../../src/migration/conversion/compiled/cell-kit-source.ts"
  );
  const source =
    "const [userOptions, setUserOptions] = createSignal(store?.getState().userOptions);\nif (store && !isServer) onCleanup(store.subscribe(() => setUserOptions(() => store.getState().userOptions)));";
  const output = archivedExplicitCellOptionsSource(source);
  assert.doesNotMatch(output, /getState|store.subscribe/);
  assert.match(output, /createSignal\(undefined\)/);
  assert.throws(() => archivedExplicitCellOptionsSource("changed source"));
});

test("unrelated read-only dynamic tables do not acquire editing scope restrictions", () => {
  assert.deepEqual(
    readLegacyCellWriteSites(
      "<DataTable data={chooseRows()}><Column col={chooseColumn()}/></DataTable>" +
        source,
    ),
    readLegacyCellWriteSites(source),
  );
});
test("editing Selects retain finite authored option validation and do not drop authored children", () => {
  for (const options of ["[{}]", JSON.stringify(Array(10001).fill("a"))])
    assert.throws(() =>
      readLegacyCellWriteSites(
        source.replace('options="$choices"', "options={" + options + "}"),
      ),
    );
  assert.throws(() =>
    readLegacyCellWriteSites(
      source.replace(
        'type="text"/>',
        'type="text"><span>Hidden</span></input>',
      ),
    ),
  );
});
test("checkbox editing remains explicit unsupported because archived native cells emit text rather than checked state", () => {
  assert.throws(() =>
    readLegacyCellWriteSites(source.replace('type="text"', 'type="checkbox"')),
  );
});
