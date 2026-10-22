import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompiledCharts } from "../../../src/migration/conversion/compiled/charts/runtime.ts";
import { chartEnvelopeKey } from "../../../src/migration/conversion/compiled/charts/plan.ts";
import type { ChartView } from "../../../src/migration/conversion/compiled/charts/contracts.ts";
test("compiled chart feeds changing query rows, reports readiness and releases observers", async () => {
  const attributes = new Map();
  const element = {
    clientWidth: 600,
    clientHeight: 300,
    setAttribute: (k: string, v: string) => attributes.set(k, v),
    removeAttribute: (k: string) => attributes.delete(k),
  } as unknown as HTMLElement;
  let rows: unknown;
  let finalized = 0;
  let disconnected = 0;
  const view = {
    data: (_name: string, value: unknown) => {
      rows = value;
      return view;
    },
    width: () => view,
    height: () => view,
    resize: () => view,
    runAsync: async () => {},
    finalize: () => finalized++,
  } as ChartView;
  const envelope = { source: { kind: "vega-lite" } };
  const module = createCompiledCharts(
    [{ key: chartEnvelopeKey(envelope), runtime: {}, width: 640, height: 300 }],
    {
      create: () => view,
      observe: () => () => {
        disconnected++;
      },
    },
  );
  const original = [{ amount: 4 }];
  const controller = module.mountChart({ element, envelope, rows: original });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rows, original);
  assert.notEqual(rows, original);
  assert.equal(attributes.get("data-mx-chart-state"), "ready");
  controller.update([{ amount: 9 }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rows, [{ amount: 9 }]);
  controller.destroy();
  controller.destroy();
  assert.equal(finalized, 1);
  assert.equal(disconnected, 1);
  assert.throws(() => controller.update([]), /disposed/);
  assert.throws(
    () =>
      module.mountChart({
        element,
        envelope: { source: { kind: "unknown" } },
        rows: [],
      }),
    /compiled/,
  );
});
