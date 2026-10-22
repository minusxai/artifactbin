import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompiledCellValue } from "../../../src/migration/conversion/compiled/cell-write-value.ts";
test("cell scalar snapshots preserve archived null, empty string and primitive semantics", () => {
  assert.equal(
    normalizeCompiledCellValue({ param: "cell__value", type: "string" }, ""),
    "",
  );
  for (const type of [
    "number",
    "boolean",
    "date",
    "timestamp",
    "user",
  ] as const)
    assert.equal(
      normalizeCompiledCellValue({ param: "cell__value", type }, ""),
      null,
    );
  for (const type of [
    "number",
    "boolean",
    "date",
    "timestamp",
    "user",
    "string",
  ] as const)
    assert.equal(
      normalizeCompiledCellValue({ param: "cell__value", type }, null),
      null,
    );
  assert.equal(
    normalizeCompiledCellValue({ param: "cell__value", type: "number" }, 2),
    2,
  );
  assert.equal(
    normalizeCompiledCellValue(
      { param: "cell__value", type: "boolean" },
      false,
    ),
    false,
  );
  assert.equal(
    normalizeCompiledCellValue(
      { param: "cell__value", type: "user" },
      "usr_example",
    ),
    "usr_example",
  );
  assert.equal(
    normalizeCompiledCellValue(
      { param: "cell__value", type: "string" },
      '["red","blue"]',
    ),
    '["red","blue"]',
  );
});
test("cell scalars refuse missing, nonfinite or structurally different values without coercion", () => {
  for (const [type, value] of [
    ["number", "2"],
    ["boolean", "false"],
    ["user", 2],
    ["string", []],
    ["string", {}],
    ["number", Infinity],
    ["string", undefined],
  ])
    assert.throws(() =>
      normalizeCompiledCellValue(
        { param: "cell__value", type: type as any },
        value,
      ),
    );
});

test("cell generated-slot metadata is exact and cannot alias ordinary or system parameters", async () => {
  const { validDatasetMutationValueParameter } = await import(
    "../../../src/datasets/mutation/parameter-scalars.ts"
  );
  assert.equal(
    validDatasetMutationValueParameter(
      { param: "cell__value", type: "string" },
      { cell__value: "string" },
    ),
    true,
  );
  for (const descriptor of [
    { param: "cell__value", type: null },
    { param: "_now", type: "timestamp" },
    { param: "other", type: "string" },
    { param: "cell__value", type: "string", extra: 1 },
  ])
    assert.equal(
      validDatasetMutationValueParameter(descriptor, { cell__value: "string" }),
      false,
    );
  assert.equal(
    validDatasetMutationValueParameter(
      { param: "cell__value", type: "number" },
      { cell__value: "string" },
    ),
    false,
  );
});
