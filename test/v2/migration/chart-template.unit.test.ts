import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareChartTextTemplate,
  bindChartTextPlan,
} from "../../../src/migration/conversion/compiled/charts/text-template-compiler.ts";
import { chartEnvelopeKey } from "../../../src/migration/conversion/compiled/charts/plan.ts";
import { chartTextObject } from "../../../src/migration/conversion/compiled/charts/text-object.ts";

test("only whole query-cell title and axis-format holes become fixed offline signal slots", () => {
  const prepared = prepareChartTextTemplate({
    kind: "vega-lite",
    spec: {
      encoding: {
        x: {
          field: "amount",
          title: "{$labels.title}",
          axis: { format: "{$labels.format}" },
        },
      },
    },
  });
  assert.equal(prepared.bindings.length, 2);
  assert.equal(JSON.stringify(prepared.viz).includes("{$"), false);
  assert.throws(() =>
    prepareChartTextTemplate({
      kind: "vega-lite",
      spec: { mark: "{$labels.mark}" },
    }),
  );
  assert.throws(() =>
    prepareChartTextTemplate({
      kind: "vega-lite",
      spec: { encoding: { x: { title: "prefix {$labels.title}" } } },
    }),
  );
});

test("template matching preserves fixed grammar and treats injection-looking text only as data", () => {
  const prepared = prepareChartTextTemplate({
    kind: "vega-lite",
    spec: { mark: "bar", encoding: { x: { title: "{$labels.title}" } } },
  });
  const plan = {
    key: chartEnvelopeKey({ source: prepared.viz }),
    runtime: {},
    width: 300,
    height: 200,
    textBindings: prepared.bindings,
  };
  const envelope = (title: unknown, mark = "bar") => ({
    source: { kind: "vega-lite", spec: { mark, encoding: { x: { title } } } },
  });
  const attack =
    "</script><img src=https://example.invalid/probe onerror=alert(1)>";
  assert.deepEqual(matchChartTextPlan(plan, envelope(attack)), [
    { signal: prepared.bindings[0]!.signal, value: attack },
  ]);
  assert.equal(matchChartTextPlan(plan, envelope({ signal: "evil()" })), null);
  assert.equal(matchChartTextPlan(plan, envelope("title", "image")), null);
  assert.equal(matchChartTextPlan(plan, envelope("x".repeat(4097))), null);
});

test("Vega axes get trusted signal refs while ambiguous or dropped compilation refuses", () => {
  const prepared = prepareChartTextTemplate({
    kind: "vega-lite",
    spec: { encoding: { x: { title: "{$labels.title}" } } },
  });
  const marker = prepared.bindings[0]!.marker;
  const spec = { axes: [{ title: marker }] };
  bindChartTextPlan(spec, prepared.bindings);
  assert.deepEqual(spec.axes, [
    { title: { signal: prepared.bindings[0]!.signal } },
  ]);
  assert.throws(() => bindChartTextPlan({ axes: [] }, prepared.bindings));
  assert.throws(() =>
    bindChartTextPlan(
      { axes: [{ title: marker }, { title: marker }] },
      prepared.bindings,
    ),
  );
});

test("generated tooltip object expressions use bounded own properties, including prototype-looking titles", () => {
  const prepared = prepareChartTextTemplate({
    kind: "vega-lite",
    spec: { encoding: { x: { title: "{$labels.title}" } } },
  });
  const marker = prepared.bindings[0]!.marker;
  const spec = {
    axes: [{ title: marker }],
    marks: [
      {
        encode: {
          update: {
            tooltip: { signal: `({${JSON.stringify(marker)}: datum.value})` },
          },
        },
      },
    ],
  };
  bindChartTextPlan(spec, prepared.bindings);
  assert.match(
    spec.marks[0]!.encode.update.tooltip.signal,
    /migration_chart_text_object/,
  );
  assert.equal(
    spec.marks[0]!.encode.update.tooltip.signal.includes(marker),
    false,
  );
  const object = chartTextObject(["__proto__"], ["safe"]);
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.equal(Object.hasOwn(object, "__proto__"), true);
  assert.throws(() => chartTextObject([{}], [1]));
  assert.throws(() =>
    chartTextObject(Array(65).fill("title"), Array(65).fill(1)),
  );
});

import { matchChartTextPlan } from "../../../src/migration/conversion/compiled/charts/text-template.ts";
