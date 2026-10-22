import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitDataControl,
  admitDataColumn,
} from "../src/migration/conversion/compiled/data-controls.ts";
import { readLegacyTablePresentation } from "../src/migration/conversion/compiled/table-presentation.ts";
test("frozen table compatibility ignores literal CSS widths and table titles without inventing layout", () => {
  for (const width of ["160", "160px", "12rem", "24ch", "auto"]) {
    const columns = [{ col: "score", width }];
    assert.deepEqual(readLegacyTablePresentation({ columns }).columns, [
      { col: "score" },
    ]);
    assert.equal(admitDataColumn({ col: "score", width }).width, width);
  }
  assert.deepEqual(
    admitDataControl("DataTable", { data: "$rows", title: "Summary" }),
    { kind: "table", data: "rows", compatibility: ["ignored-table-title"] },
  );
});
test("Select retains bounded pair arrays as frozen empty choices and explicitly records ignored props", () => {
  const options = [
    ["a", "Alpha"],
    ["b", "Beta"],
  ];
  const attrs = {
    value: "$choice",
    options,
    multiple: true,
    valueFormat: "json",
    allowCreate: true,
    run: "$save",
  };
  const before = structuredClone(attrs);
  assert.deepEqual(admitDataControl("Select", attrs), {
    kind: "select",
    value: "choice",
    options,
    compatibility: [
      "empty-select-pair-options",
      "ignored-select-run",
      "ignored-select-value-format",
      "ignored-select-allow-create",
    ],
  });
  assert.deepEqual(attrs, before);
  for (const extra of [
    { multiple: "yes" },
    { allowCreate: "yes" },
    { valueFormat: "csv" },
    { run: () => {} },
    { options: [[1, 2, 3]] },
    { options: [[{ nested: true }, 2]] },
    { onChange: "alert(1)" },
  ])
    assert.throws(() =>
      admitDataControl("Select", {
        value: "$choice",
        options: ["a"],
        ...extra,
      }),
    );
});

test("source admission retains exact no-op Select run and active JSON multiple props", async () => {
  const { admitLocalSource } = await import(
    "../src/migration/conversion/compiled/source-admission.ts"
  );
  const source =
    '<Helmet><Value name="choice" type="string" default="[]"/></Helmet><Select id="pick" value="$choice" options={["a","b"]} multiple valueFormat="json" allowCreate run="$neverCalled"/>';
  const result = admitLocalSource({ source, coreUrl: "/af/v1/core.js" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.input.source, source);
    assert.deepEqual(result.plan.input.dataControls?.[0]?.compatibility, [
      "ignored-select-run",
      "ignored-select-value-format",
      "ignored-select-allow-create",
    ]);
  }
});
