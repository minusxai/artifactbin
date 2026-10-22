import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileChartPlan,
  isKitQuestionView,
  chartEnvelopeKey,
} from "../../../src/migration/conversion/compiled/charts/plan.ts";
import type {
  ChartCompilerPorts,
  ChartCompilationInput,
} from "../../../src/migration/conversion/compiled/charts/contracts.ts";
const input: ChartCompilationInput = {
  viz: { kind: "vega-lite", spec: { mark: "bar" } },
  columns: [],
  rows: [],
  width: 640,
  height: 300,
  colorMode: "light",
};
const ports: ChartCompilerPorts = {
  envelope: (viz) => ({ source: viz }),
  resolve: () => ({ ok: true }),
  infer: () => [],
  plan: () => ({ vegaSpec: { marks: [] } }),
  parse: () => ({ operators: [] }),
};
test("offline chart plan carries the exact envelope and AST runtime, without executing expressions", () => {
  const plan = compileChartPlan(input, ports);
  assert.equal(plan.key, chartEnvelopeKey({ source: input.viz }));
  assert.deepEqual(plan.runtime, {
    operators: [],
    eventConfig: { bind: "none", window: false, timer: false, selector: false },
  });
});
test("chart migration refuses external resources, templated specs and unsupported visualizations", () => {
  for (const viz of [
    { kind: "recharts" },
    {
      kind: "vega",
      spec: {
        signals: [
          {
            name: "choice",
            value: "x",
            bind: { input: "text", onfocus: "alert(1)" },
          },
        ],
      },
    },
    {
      kind: "vega",
      spec: {
        signals: [
          {
            name: "time",
            on: [{ events: { type: "timer", throttle: 10 }, update: "1" }],
          },
        ],
      },
    },
    {
      kind: "vega",
      spec: {
        marks: [
          {
            type: "rect",
            encode: {
              update: {
                fill: { value: "url(https://example.invalid/paint.svg#x)" },
              },
            },
          },
        ],
      },
    },
    {
      kind: "vega",
      spec: { data: [{ name: "main", transform: [{ type: "crossfilter" }] }] },
    },
    {
      kind: "vega-lite",
      spec: { data: { url: "https://example.invalid/data" } },
    },
    { kind: "vega-lite", spec: { title: "{$choice}" } },
    { kind: "vega", spec: { marks: [{ type: "image" }] } },
  ])
    assert.throws(() => compileChartPlan({ ...input, viz }, ports));
});
test("chart plans refuse assets, oversized runtime and ambient event streams", () => {
  assert.throws(() =>
    compileChartPlan(input, {
      ...ports,
      resolve: () => ({ ok: true, assets: { geo: "boundary" } }),
    }),
  );
  assert.throws(() =>
    compileChartPlan(input, {
      ...ports,
      parse: () => ({ value: "x".repeat(600000) }),
    }),
  );
  assert.throws(() =>
    compileChartPlan(
      {
        ...input,
        viz: {
          kind: "vega",
          spec: {
            signals: [{ on: [{ events: "window:click", update: "1" }] }],
          },
        },
      },
      ports,
    ),
  );
});

test("Question tables and single values retain the kit's reactive renderer", () => {
  assert.equal(isKitQuestionView({ kind: "table" }), true);
  assert.equal(
    isKitQuestionView({ kind: "single_value", yCols: ["amount"] }),
    true,
  );
  assert.equal(isKitQuestionView({ kind: "bar" }), false);
  assert.equal(isKitQuestionView({ kind: "vega-lite" }), false);
});

test("compiled runtime refuses selector and timer streams and binding controls", () => {
  for (const runtime of [
    { streams: [{ source: "body", type: "click" }] },
    { streams: [{ source: "timer", type: 10 }] },
    { bindings: [{ input: "text" }] },
  ])
    assert.throws(() =>
      compileChartPlan(input, { ...ports, parse: () => runtime }),
    );
  assert.doesNotThrow(() =>
    compileChartPlan(input, {
      ...ports,
      parse: () => ({ streams: [{ source: "view", type: "click" }] }),
    }),
  );
});
