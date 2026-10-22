import test from "node:test";
import assert from "node:assert/strict";
import {
  validDatasetMutationParameterMap,
  validDatasetMutationRowParameters,
  matchesDatasetMutationScalar,
} from "../src/datasets/mutation/parameter-scalars.ts";
test("registered row metadata is one-to-one, exact typed and cannot bind trusted system parameters", () => {
  const flat = { row__id: null, ordinary: "string" as const };
  assert.equal(validDatasetMutationParameterMap(flat), true);
  assert.equal(
    validDatasetMutationRowParameters(
      { id: { param: "row__id", type: null } },
      flat,
    ),
    true,
  );
  for (const row of [
    { id: { param: "row__id", type: "string" } },
    { id: { param: "missing", type: null } },
    {
      id: { param: "row__id", type: null },
      other: { param: "row__id", type: null },
    },
    { id: { param: "_me__userId", type: null } },
  ])
    assert.equal(
      validDatasetMutationRowParameters(row, { ...flat, _me__userId: null }),
      false,
    );
  assert.equal(validDatasetMutationParameterMap({ id: "object" }), false);
  for (const value of [
    undefined,
    NaN,
    Infinity,
    {},
    [],
    () => 1,
    "x".repeat(65537),
  ])
    assert.equal(matchesDatasetMutationScalar(null, value), false);
});
