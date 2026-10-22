import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileChartPlan } from "../../../src/migration/conversion/compiled/charts/plan.ts";
import { chartRendererSources } from "../../../src/migration/conversion/compiled/charts/renderer-source.ts";
import { safeInlineModule } from "../../../src/migration/conversion/compiled/module-safety.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline native Vega renders query changes using only the interpreter and releases the view",
  { skip: !root },
  async () => {
    const { parse } = await import(
      pathToFileURL(path.join(root!, "node_modules/vega/build/vega.module.js"))
        .href
    );
    const spec = {
      width: 300,
      height: 200,
      data: [{ name: "main" }],
      scales: [
        {
          name: "x",
          type: "band",
          domain: { data: "main", field: "label" },
          range: "width",
        },
        { name: "y", type: "linear", domain: [0, 10], range: "height" },
      ],
      marks: [
        {
          type: "rect",
          from: { data: "main" },
          encode: {
            update: {
              x: { scale: "x", field: "label" },
              width: { scale: "x", band: 1 },
              y: { scale: "y", field: "amount" },
              y2: { scale: "y", value: 0 },
              fill: { value: "var(--cat-dynamic)" },
            },
          },
        },
      ],
    };
    const viz = { kind: "vega", spec };
    const envelope = { source: viz };
    const plan = compileChartPlan(
      {
        viz,
        columns: [],
        rows: [],
        width: 300,
        height: 200,
        colorMode: "light",
      },
      {
        envelope: () => envelope,
        resolve: () => ({ ok: true }),
        infer: () => [],
        plan: () => ({ vegaSpec: spec }),
        parse,
      },
    );
    const sources = await chartRendererSources(root!, [plan]);
    const out = await build({
      stdin: {
        contents:
          sources.entry +
          `\nconst controller=charts.mountChart({element:document.getElementById('chart'),envelope:${JSON.stringify(envelope)},rows:[{label:'A',amount:2}]});document.getElementById('change').addEventListener('click',()=>controller.update([{label:'A',amount:8}]));document.getElementById('remove').addEventListener('click',()=>controller.destroy());`,
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
    const included = Object.entries(
      Object.values(out.metafile!.outputs)[0]!.inputs,
    )
      .filter(([, value]) => value.bytesInOutput > 0)
      .map(([name]) => name);
    assert.equal(
      included.some((name) => /vega-lite|vega-parser|\/parser\.js$/.test(name)),
      false,
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      await page.setContent(
        `<div id="chart" style="--cat-dynamic:steelblue;width:300px;height:200px"></div><button id="change">Change</button><button id="remove">Remove</button><script type="module">${javascript}</script>`,
      );
      await page.locator('#chart[data-mx-chart-state="ready"]').waitFor();
      const mark = page.locator(".mark-rect.role-mark path");
      await mark.waitFor();
      assert.equal(await mark.getAttribute("fill"), "steelblue");
      const before = await mark.getAttribute("d");
      await page.locator("#change").click();
      await page.waitForFunction(
        (previous) =>
          document
            .querySelector(".mark-rect.role-mark path")
            ?.getAttribute("d") !== previous,
        before,
      );
      assert.notEqual(await mark.getAttribute("d"), before);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      await page.locator("#remove").click();
    } finally {
      await browser.close();
    }
  },
);

test(
  "resolved field and expression paints cannot load external SVG resources",
  { skip: !root },
  async () => {
    const { parse } = await import(
      pathToFileURL(path.join(root!, "node_modules/vega/build/vega.module.js"))
        .href
    );
    const browser = await chromium.launch({ headless: true });
    try {
      for (const fill of [
        { field: "paint" },
        { value: "var(--unsafe-paint)" },
        { signal: "'ur' + 'l(https://example.invalid/chart-probe.svg#paint)'" },
      ]) {
        const spec = {
          width: 100,
          height: 100,
          data: [{ name: "main" }],
          marks: [
            {
              type: "rect",
              from: { data: "main" },
              encode: {
                update: {
                  x: { value: 0 },
                  y: { value: 0 },
                  width: { value: 100 },
                  height: { value: 100 },
                  fill,
                },
              },
            },
          ],
        };
        const viz = { kind: "vega", spec };
        const envelope = { source: viz };
        const plan = compileChartPlan(
          {
            viz,
            columns: [],
            rows: [],
            width: 100,
            height: 100,
            colorMode: "light",
          },
          {
            envelope: () => envelope,
            resolve: () => ({ ok: true }),
            infer: () => [],
            plan: () => ({ vegaSpec: spec }),
            parse,
          },
        );
        const sources = await chartRendererSources(root!, [plan]);
        const out = await build({
          stdin: {
            contents:
              sources.entry +
              `\ncharts.mountChart({element:document.getElementById('chart'),envelope:${JSON.stringify(envelope)},rows:[{paint:'url(https://example.invalid/chart-probe.svg#paint)'}]});`,
            resolveDir: root,
          },
          plugins: [sources.plugin],
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          minify: true,
        });
        const page = await browser.newPage();
        const requests: string[] = [];
        const errors: string[] = [];
        await page.route("**/*", (route) => {
          requests.push(route.request().url());
          void route.abort();
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setContent(
          `<div id="chart" style="--unsafe-paint:url(https://example.invalid/chart-probe.svg#paint)"></div><script type="module">${out.outputFiles[0]!.text}</script>`,
        );
        await page.locator('#chart[data-mx-chart-state="error"]').waitFor();
        assert.match(
          await page.locator("#chart").innerText(),
          /Chart unavailable/,
        );
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "official archived grammar refuses control bindings, timers and document selectors",
  { skip: !root },
  async () => {
    const { parse } = await import(
      pathToFileURL(path.join(root!, "node_modules/vega/build/vega.module.js"))
        .href
    );
    const compile = (signal: Record<string, unknown>) => {
      const spec = { signals: [signal], data: [{ name: "main" }], marks: [] };
      const viz = { kind: "vega", spec };
      return compileChartPlan(
        {
          viz,
          columns: [],
          rows: [],
          width: 100,
          height: 100,
          colorMode: "light",
        },
        {
          envelope: () => ({ source: viz }),
          resolve: () => ({ ok: true }),
          infer: () => [],
          plan: () => ({ vegaSpec: spec }),
          parse,
        },
      );
    };
    for (const signal of [
      {
        name: "choice",
        value: 0,
        bind: {
          input: "text",
          onfocus: "document.body.setAttribute('data-injected','yes')",
        },
      },
      {
        name: "timer",
        value: 0,
        on: [{ events: { type: "timer", throttle: 10 }, update: "1" }],
      },
      {
        name: "selector",
        value: 0,
        on: [{ events: { source: "body", type: "click" }, update: "1" }],
      },
    ])
      assert.throws(() => compile(signal));
    assert.doesNotThrow(() =>
      compile({
        name: "local",
        value: 0,
        on: [{ events: { source: "view", type: "click" }, update: "1" }],
      }),
    );
  },
);
