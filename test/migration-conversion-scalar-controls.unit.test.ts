import { test } from "node:test";
import assert from "node:assert/strict";
import { admitScalarControl } from "../src/migration/conversion/compiled/scalar-controls.ts";
test("viewer scalar controls require exact bindings and supported static props", () => {
  assert.deepEqual(
    admitScalarControl("Segmented", { value: "$mode", options: ["a", "b"] }),
    {
      tag: "Segmented",
      binding: "mode",
      valueType: "string",
      options: { kind: "select", value: "mode", options: ["a", "b"] },
    },
  );
  assert.deepEqual(
    admitScalarControl("Switch", { checked: "$enabled", disabled: false }),
    { tag: "Switch", binding: "enabled", valueType: "boolean" },
  );
  assert.deepEqual(
    admitScalarControl("Slider", {
      value: "$amount",
      min: 0,
      max: 10,
      step: 0.5,
      format: ".1f",
      suffix: " units",
    }),
    { tag: "Slider", binding: "amount", valueType: "number" },
  );
  for (const [tag, attrs] of [
    ["Switch", { value: "$enabled" }],
    ["Slider", { value: "$amount", min: 5, max: 2 }],
    ["Slider", { value: "$amount", step: 0 }],
    ["Slider", { value: "$amount", min: "0" }],
    ["Segmented", { value: "$mode", options: ["a"], run: "$save" }],
    ["Switch", { checked: "$constructor" }],
    ["Slider", { value: "$amount", onInput: "code" }],
  ] as const)
    assert.throws(() => admitScalarControl(tag, { ...attrs }));
  assert.throws(() =>
    admitScalarControl("Switch", { checked: "$enabled" }, true),
  );
});
