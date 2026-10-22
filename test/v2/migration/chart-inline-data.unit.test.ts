import { test } from "node:test";
import assert from "node:assert/strict";
import { readChartInlineData } from "../../../src/migration/conversion/compiled/charts/inline-data.ts";
test("default inline chart JSON preserves values without invoking a resource loader", () => {
  const rows = [
    {},
    { value: 2, label: "Example", missing: null, active: true },
  ];
  assert.equal(readChartInlineData(rows), rows);
  assert.equal(readChartInlineData(rows, {}), rows);
  assert.deepEqual(
    readChartInlineData(rows, { type: "json", copy: true }),
    rows,
  );
  assert.notEqual(readChartInlineData(rows, { copy: true }), rows);
});
test("inline JSON refuses arbitrary formats, getters and unbounded structures", () => {
  for (const format of [
    { type: "csv" },
    { parse: "auto" },
    { property: "constructor" },
    { url: "https://example.invalid" },
    { copy: 1 },
  ])
    assert.throws(() => readChartInlineData([{}], format as any));
  let read = false;
  assert.throws(() =>
    readChartInlineData([
      {
        get value() {
          read = true;
          return 1;
        },
      },
    ]),
  );
  assert.equal(read, false);
  assert.throws(() => readChartInlineData(Array(10001).fill({})));
  assert.throws(() => readChartInlineData([{ text: "x".repeat(2000001) }]));
  const loop: any = {};
  loop.loop = loop;
  assert.throws(() => readChartInlineData([loop]));
  for (const data of ["[]", {}, [{ value: Infinity }], [() => 0], [new Date()]])
    assert.throws(() => readChartInlineData(data));
});

test("inline chart copy never invokes inherited JSON hooks or symbol formats", () => {
  let called = false;
  const rows: any = [];
  Object.setPrototypeOf(rows, {
    toJSON() {
      called = true;
      return [];
    },
  });
  assert.throws(() => readChartInlineData(rows, { copy: true }));
  assert.equal(called, false);
  assert.throws(() =>
    readChartInlineData([{}], { [Symbol("hidden")]: true } as any),
  );
  assert.throws(() => readChartInlineData([{ [Symbol("hidden")]: 1 }]));
});
