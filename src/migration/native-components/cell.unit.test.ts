import test from "node:test";
import assert from "node:assert/strict";
import { formatNativeLiveCell, buildNativeCellAdapter } from "./cell-build.ts";
import { formatNativeCell } from "./lower.ts";
test("live Cell uses viewer runtime default locale, exact aggregation/text/affix and d3 grammar", async () => {
  const resolved = new Intl.NumberFormat().resolvedOptions();
  const cases = [
    { rows: [{ n: 12345.678 }], col: "n" },
    {
      rows: [{ n: "words" }],
      col: "n",
      prefix: "[",
      suffix: "]",
      format: ".2f",
    },
    {
      rows: [{ n: 4 }, { n: 8 }],
      col: "n",
      agg: "avg" as const,
      format: ".1f",
    },
    { rows: [], col: "n", agg: "sum" as const },
    { rows: [{ n: 0.25 }], col: "n", format: ".1%" },
    { rows: [{ n: 1.25 }], col: "n", format: ",0" },
    { rows: null, prefix: "ignored" },
  ];
  for (const input of cases) {
    const expected = formatNativeCell({
      ...input,
      localeReceipt: {
        locale: resolved.locale,
        numberingSystem: resolved.numberingSystem,
        sourceRuntimeSha256: "a".repeat(64),
      },
    });
    assert.equal(expected.status, "formatted");
    if (expected.status === "formatted")
      assert.equal(formatNativeLiveCell(input.rows, input), expected.text);
  }
  const bundled = await buildNativeCellAdapter();
  assert.equal(bundled.files.length, 1);
  assert.equal(bundled.adapter.specifier, "./components/native-cell.js");
  const module = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundled.files[0]!.bytes).toString("base64")
  );
  assert.equal(
    module.formatNativeLiveCell([{ n: 12345.678 }], { col: "n" }),
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
      12345.678,
    ),
  );
});
