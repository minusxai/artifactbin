import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileChartPlan } from "../../../src/migration/conversion/compiled/charts/plan.ts";
import {
  prepareChartTextTemplate,
  bindChartTextPlan,
} from "../../../src/migration/conversion/compiled/charts/text-template-compiler.ts";
import { chartRendererSources } from "../../../src/migration/conversion/compiled/charts/renderer-source.ts";
import { safeInlineModule } from "../../../src/migration/conversion/compiled/module-safety.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline query-cell axis titles and formatting update without compiling text or loading resources",
  { skip: !root },
  async () => {
    const { parse, expressionFunction } = await import(
      pathToFileURL(path.join(root!, "node_modules/vega/build/vega.module.js"))
        .href
    );
    const { compile } = await import(
      pathToFileURL(path.join(root!, "node_modules/vega-lite/build/index.js"))
        .href
    );
    expressionFunction("migration_chart_text_object", chartTextObject);
    const parserFunctions = await import(
      pathToFileURL(
        createRequire(
          path.join(root!, "node_modules/vega-parser/package.json"),
        ).resolve("vega-functions"),
      ).href
    );
    parserFunctions.expressionFunction(
      "migration_chart_text_object",
      chartTextObject,
    );
    const authored = {
      kind: "vega-lite",
      spec: {
        mark: { type: "bar", tooltip: true },
        encoding: {
          x: {
            field: "amount",
            type: "quantitative",
            title: "{$labels.title}",
            axis: { format: "{$labels.format}" },
          },
          y: { field: "label", type: "nominal" },
        },
      },
    };
    const prepared = prepareChartTextTemplate(authored);
    const plan = compileChartPlan(
      {
        viz: prepared.viz,
        columns: [],
        rows: [],
        width: 400,
        height: 240,
        colorMode: "light",
      },
      {
        envelope: (viz) => ({ source: viz }),
        resolve: () => ({ ok: true }),
        infer: () => [],
        plan: () => {
          const spec = compile({
            ...(prepared.viz.spec as object),
            data: { name: "main" },
          }).spec;
          bindChartTextPlan(spec, prepared.bindings);
          return { vegaSpec: spec };
        },
        parse,
      },
    );
    plan.textBindings = prepared.bindings;
    const sources = await chartRendererSources(root!, [plan]);
    const out = await build({
      stdin: {
        contents:
          sources.entry +
          `
let controller;
function mount(title,format){if(controller)controller.destroy();controller=charts.mountChart({element:document.getElementById('chart'),envelope:{source:{kind:'vega-lite',spec:${JSON.stringify(authored.spec)} }},rows:[{label:'Item',amount:0.5}]});}
`.replace(
            JSON.stringify(authored.spec),
            JSON.stringify(authored.spec)
              .replace('"{$labels.title}"', "title")
              .replace('"{$labels.format}"', "format"),
          ) +
          `
mount('Initial title','.0%');document.getElementById('change').onclick=()=>mount('<img src=https://example.invalid/probe onerror=alert(1)>','.2f');`,
        resolveDir: root,
      },
      plugins: [sources.plugin],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      minify: true,
      metafile: true,
    });
    const javascript = out.outputFiles[0]!.text;
    assert.equal(safeInlineModule(javascript), true);
    assert.doesNotMatch(javascript, /new Function|\bFunction\(|\beval\s*\(/);
    const emitted = Object.entries(
      Object.values(out.metafile!.outputs)[0]!.inputs,
    )
      .filter(([, v]) => v.bytesInOutput > 0)
      .map(([name]) => name);
    assert.equal(
      emitted.some(
        (name) =>
          name.includes("acorn") || name.includes("text-template-compiler"),
      ),
      false,
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(r.url()));
      await page.setContent(
        `<div id="chart" style="width:400px;height:240px"></div><button id="change">Change</button><script type="module">${javascript}</script>`,
      );
      await page.locator('#chart[data-mx-chart-state="ready"]').waitFor();
      assert.match(
        (await page.locator("#chart svg").textContent()) ?? "",
        /Initial title/,
      );
      assert.match(
        (await page.locator("#chart svg").textContent()) ?? "",
        /50%/,
      );
      await page.locator("#change").click();
      await page.waitForFunction(() =>
        document
          .querySelector('#chart[data-mx-chart-state="ready"] svg')
          ?.textContent?.includes("<img src="),
      );
      assert.match(
        (await page.locator("#chart svg").textContent()) ?? "",
        /0\.50/,
      );
      assert.equal(await page.locator("#chart img").count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    } finally {
      await browser.close();
    }
  },
);

import { chartTextObject } from "../../../src/migration/conversion/compiled/charts/text-object.ts";

import { createRequire } from "node:module";
