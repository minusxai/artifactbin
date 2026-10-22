import { test } from "node:test";
import assert from "node:assert/strict";
import {
  admitDataControl,
  admitDataColumn,
} from "../src/migration/conversion/compiled/data-controls.ts";
import { readLegacyTablePresentation } from "../src/migration/conversion/compiled/table-presentation.ts";
import { admitLocalSource } from "../src/migration/conversion/compiled/source-admission.ts";
test("table compatibility preserves ignored legacy entries/percentage widths and the audited 420px default without inventing aliases", () => {
  const source = {
    height: "auto",
    columns: [
      { col: "score", title: "Score", width: "25%" },
      { key: "name", label: "Name" },
      "name",
    ],
  };
  const before = structuredClone(source);
  assert.deepEqual(readLegacyTablePresentation(source), {
    height: 420,
    columns: [{ col: "score", title: "Score" }],
    compatibility: [
      "default-table-height",
      "ignored-column-width",
      "ignored-column-entry",
    ],
  });
  assert.deepEqual(source, before);
  assert.deepEqual(
    admitDataControl("DataTable", { data: "$rows", ...source }),
    {
      kind: "table",
      data: "rows",
      compatibility: [
        "default-table-height",
        "ignored-column-width",
        "ignored-column-entry",
      ],
    },
  );
  assert.deepEqual(
    admitDataControl("DataTable", { data: "$rows", height: "100%" }),
    { kind: "table", data: "rows", compatibility: ["default-table-height"] },
  );
  assert.equal(admitDataColumn({ col: "score", width: "25%" }).width, "25%");
});
test("compatibility does not silently drop arbitrary attributes, resources, expressions, malformed widths or ambiguous aliases", () => {
  for (const columns of [
    [{ key: "x", label: "X", run: "save" }],
    [{ col: "x", key: "y" }],
    [{ col: "x", width: "calc(100% - 1px)" }],
    [{ col: "x", width: "101%" }],
    [{ col: "x", width: "-1%" }],
    [{ col: "x", image: "https://example.test/x" }],
    [() => 1],
    [null],
  ])
    assert.throws(() =>
      admitDataControl("DataTable", { data: "$rows", columns }),
    );
  assert.throws(() =>
    admitDataControl("DataTable", {
      data: "$rows",
      columns: Array(257).fill("ignored"),
    }),
  );
  for (const height of ["50vh", "var(--height)", "calc(100% - 2px)"])
    assert.throws(() =>
      admitDataControl("DataTable", { data: "$rows", height }),
    );
});
test("source admission records compatibility while retaining exact authored source; repeats still require an explicit durable row key", () => {
  const source =
    '<Helmet><Value name="rows" type="table" value={[{id:1,score:2}]}/></Helmet><DataTable id="table" data="$rows" height="auto" columns={[{col:"score",width:"25%"}]}/>';
  const admitted = admitLocalSource({ source, coreUrl: "/af/v1/core.js" });
  assert.equal(admitted.ok, true);
  if (admitted.ok) {
    assert.equal(admitted.plan.input.source, source);
    assert.deepEqual(admitted.plan.input.dataControls?.[0], {
      kind: "table",
      data: "rows",
      compatibility: ["default-table-height", "ignored-column-width"],
    });
  }
  const keyless =
    '<Helmet><Value name="rows" type="table" value={[{id:1,name:"A"}]}/></Helmet><For id="repeat" each={$rows}><p id="row">{$_row.name}</p></For>';
  assert.equal(
    admitLocalSource({ source: keyless, coreUrl: "/af/v1/core.js" }).ok,
    false,
  );
});
