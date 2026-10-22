import { test } from "node:test";
import assert from "node:assert/strict";
import { assertChartPaints } from "../../../src/migration/conversion/compiled/charts/paint.ts";
const policy = {
  isColor: (color: string) =>
    ["red", "blue", "currentColor", "rgb(1, 2, 3)"].includes(color),
};
test("scene paint boundary inspects nested marks and gradient stops before DOM writes", () => {
  assert.doesNotThrow(() =>
    assertChartPaints(
      {
        items: [
          { fill: "red", stroke: "none" },
          {
            fill: {
              gradient: "linear",
              stops: [
                { offset: 0, color: "blue" },
                { offset: 1, color: "red" },
              ],
            },
          },
        ],
      },
      policy,
    ),
  );
  for (const fill of [
    "url(https://example.invalid/paint.svg)",
    "var(--paint)",
    "inherit",
    "u\\72l(https://example.invalid/paint.svg)",
    {
      gradient: "linear",
      stops: [{ offset: 0, color: "url(https://example.invalid/paint.svg)" }],
    },
  ])
    assert.throws(() =>
      assertChartPaints({ items: [{ items: [{ fill }] }] }, policy),
    );
});
