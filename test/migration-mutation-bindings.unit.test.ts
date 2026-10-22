import test from "node:test";
import assert from "node:assert/strict";
import { admitCompiledDatasetMutationBindings } from "../src/migration/conversion/compiled/dataset-mutation-bindings.ts";
const binding = () => ({
  name: "save",
  backendNamespace: "data",
  recoveryScope: "a".repeat(64),
  paramTypes: { value: "number" as const },
  rowParams: { id: { param: "row__id", type: null } },
  reset: ["value"],
});
test("binding admission owns an immutable public snapshot with exact combined scalar types", () => {
  const source = binding(),
    admitted = admitCompiledDatasetMutationBindings([source]);
  assert.deepEqual(admitted[0]!.flatParamTypes, {
    value: "number",
    row__id: null,
  });
  source.paramTypes.value = "string" as any;
  source.rowParams.id.param = "replacement";
  source.reset.push("other");
  assert.deepEqual(admitted[0]!.paramTypes, { value: "number" });
  assert.equal(admitted[0]!.rowParams!.id!.param, "row__id");
  assert.deepEqual(admitted[0]!.reset, ["value"]);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted[0]!.rowParams!.id), true);
});
test("invalid and ambiguous metadata refuses without any runtime or authored side effects", () => {
  for (const bindings of [
    null,
    {},
    [binding(), binding()],
    [{ ...binding(), recoveryScope: "bad" }],
    [{ ...binding(), paramTypes: { value: "object" } }],
    [{ ...binding(), rowParams: { id: { param: "value", type: "number" } } }],
    [
      {
        ...binding(),
        rowParams: {
          id: { param: "row__id", type: null },
          other: { param: "row__id", type: null },
        },
      },
    ],
    [{ ...binding(), reset: ["constructor"] }],
    Array.from({ length: 65 }, (_, i) => ({ ...binding(), name: "save" + i })),
  ])
    assert.throws(() => admitCompiledDatasetMutationBindings(bindings));
  let accessed = false;
  const access = Object.defineProperty(binding(), "name", {
    get() {
      accessed = true;
      throw Error();
    },
  });
  assert.throws(() => admitCompiledDatasetMutationBindings([access]));
  assert.equal(accessed, false);
});
