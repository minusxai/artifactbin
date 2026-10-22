import {createCompiledQueryController,compiledQueryClock} from "../src/migration/conversion/compiled/query-controller.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
const input = {
  source:
    '<Helmet><Value name="count" type="number" default={0}/></Helmet><Button id="go" set={{count:1}}>Go</Button><p id="count">{$count}</p>',
  coreUrl: "/af/v1/core.js",
};
const output = {
  html: '<main data-hk="d-0"><button id="go">Go</button><p id="count">0</p></main>',
  css: ".card{}",
  title: "Example",
  build: "test-build",
  rootAttributes: { class: "light" },
  capabilities: [],
  javascript: 'console.log("ordinary compiled JS")',
  declarations: [{ name: "count", type: "number" as const, default: 0 }],
  modules: ["rt.js", "kit-basic.js", "solid.js"],
};
test("local compiler declares Apollo state and separate provenance without legacy boot", async () => {
  const result = await compileArchivedLocal(input, {
    compiler: { compile: async () => output },
  });
  assert.equal(result.classification, "functional");
  assert.equal(result.provenance?.mode, "local-scalars");
  assert.match(result.html!, /data-af="state"/);
  assert.match(result.html!, /"compiledPage":\{"count":0\}/);
  assert.match(result.html!, /data-af-id="go"/);
  assert.ok(
    result.html!.indexOf('data-af="core"') <
      result.html!.indexOf('type="module"'),
  );
});
test("local route refuses author execution and all data adapters before invoking compiler", async () => {
  let calls = 0;
  for (const source of [
    "<script>alert(1)</script>",
    '<Import name="rows" ref="missing"/>',
    '<Button run="$save">Save</Button>',
    '<Select value="$region"/>',
    "<SlideDeck><div>one</div></SlideDeck>",
    "<p>{globalThis.x=1}</p>",
    "<Button set={{count:globalThis.x()}}>Run</Button>",
    '<Input value="$missing"/>',
    "<Button set={{missing:1}}>Run</Button>",
    "<Card><script>bad()</script></Card>",
    '<Card ONCLICK="bad()"/>',
    '<Card href="javascript:bad()"/>',
  ]) {
    const result = await compileArchivedLocal(
      { ...input, source },
      {
        compiler: {
          compile: async () => {
            calls++;
            return output;
          },
        },
      },
    );
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
  }
  assert.equal(calls, 0);
});
test("local output rejects legacy transports, unresolved assets and executable HTML", async () => {
  for (const change of [
    { modules: ["page-store/transport.js"] },
    { javascript: 'fetch("/api/story")' },
    { javascript: "parseJsx(source)" },
    { javascript: "new Function(source)" },
    { html: "<script>bad()</script>" },
    { html: '<img src="/legacy.png">' },
  ]) {
    const result = await compileArchivedLocal(input, {
      compiler: { compile: async () => ({ ...output, ...change }) },
    });
    assert.equal(result.classification, "manual-blocked");
  }
});

test("Apollo boot applies atomic scalar writes and reprojects persisted state after hydration", async () => {
  const { localBootSource } = await import(
    "../src/migration/conversion/compiled/local-boot.ts"
  );
  let saved: any = { compiledPage: { count: 7, label: "saved" } };
  let observer: any;
  let context: any;
  const hydrationValues: any[] = [];
  const readyValues: unknown[] = [];
  const client = {
    watchQuery: () => ({
      subscribe: (fn: any) => {
        observer = fn;
        fn({ data: saved });
      },
    }),
    updateQuery: (_: any, update: any) => {
      saved = update(saved);
      observer({ data: saved });
    },
  };
  const createSignal = (initial: any) => {
    let value = initial;
    return [
      () => value,
      (next: any) => {
        value = next;
      },
    ];
  };
  const source = localBootSource([
    { name: "count", type: "number", default: 0 },
    { name: "label", type: "string", default: "" },
  ])
    .replace(/^import .*;$/gm, "")
    .replace("export function boot", "function boot");
  const boot = Function(
    "window",
    "client",
    "gql",
    "hydrateIsland",
    "markCompiledReady",
    "createSignal",
    source + ";return boot;",
  )(
    {addEventListener(){}},
    client,
    () => ({}),
    (_: any, _tree: any, c: any) => {
      context = c;
      hydrationValues.push(c.value("count"));
    },
    () => readyValues.push(context.value("count")),
    createSignal,
  );
  boot({ TREE: () => null });
  assert.deepEqual(hydrationValues, [0]);
  assert.deepEqual(readyValues, [7]);
  assert.equal(context.value("count"), 7);
  context.store().setValues({ count: 9, label: "clicked" });
  assert.deepEqual(saved.compiledPage, { count: 9, label: "clicked" });
  context.setValue("label", "typed");
  assert.deepEqual(saved.compiledPage, { count: 9, label: "typed" });
  assert.throws(
    () => context.setValue("missing", 1),
    /Invalid local scalar write/,
  );
  assert.throws(
    () => context.setValue("count", "wrong"),
    /Invalid local scalar write/,
  );
  boot({ TREE: () => null });
  assert.equal(context.value("count"), 9);
  assert.equal(context.value("label"), "typed");
});

test("local SQL declarations require an explicit offline query engine plan", async () => {
  const source =
    '<Helmet><Value name="n" type="number" default={2}/><Query name="total">{`select $n * 2 as total`}</Query></Helmet><Number id="total" data="$total"/>';
  let calls = 0;
  const result = await compileArchivedLocal(
    { ...input, source },
    {
      compiler: {
        compile: async () => {
          calls++;
          return {
            ...output,
            declarations: [{ name: "n", type: "number", default: 2 }],
            html: '<div id="total">4</div>',
            queryNames: ["total"],
          };
        },
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.classification, "functional");
  assert.ok(result.capabilities.includes("local-sql-queries"));
});

test("local query projection ignores stale runs after later Apollo state changes", async () => {
  const { localBootSource } = await import(
    "../src/migration/conversion/compiled/local-boot.ts"
  );
  let saved: any = { compiledPage: { n: 2 } },
    observer: any,
    context: any;
  const runs: Array<(answer: any) => void> = [];
  const client = {
    watchQuery: () => ({
      subscribe: (fn: any) => {
        observer = fn;
        fn({ data: saved });
      },
    }),
    updateQuery: (_: any, update: any) => {
      saved = update(saved);
      observer({ data: saved });
    },
  };
  const createSignal = (initial: any) => {
    let value = initial;
    return [
      () => value,
      (next: any) => {
        value = next;
      },
    ];
  };
  const source = localBootSource([{ name: "n", type: "number", default: 2 }], {
    flow: { queries: [{ name: "total" }] },
    wasmBase64: "",
    tables: { total: { rows: [{ total: 4 }], columns: [] } },
  })
    .replace(/^import .*;$/gm, "")
    .replace("export function boot", "function boot");
  const engine = {
    prepare: () => {},
    ready: () => true,
    run: () => new Promise((resolve) => runs.push(resolve)),
  };
  const boot = Function(
    "window",
    "client",
    "gql",
    "hydrateIsland",
    "markCompiledReady",
    "createSignal",
    "pageEngine",
    "createCompiledQueryController",
    "compiledQueryClock",
    source + ";return boot;",
  )(
    {addEventListener(){}},
    client,
    () => ({}),
    (_: any, _tree: any, c: any) => {
      context = c;
    },
    () => {},
    createSignal,
    () => engine,
    createCompiledQueryController,compiledQueryClock,
  );
  boot({ TREE: () => null });
  for(let i=0;i<12;i++)await Promise.resolve();
  context.setValue("n", 3);
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(runs.length, 2);
  runs[1]!({ tables: { total: { rows: [{ total: 6 }] } }, errors: {} });
  for(let i=0;i<12;i++)await Promise.resolve();
  runs[0]!({ tables: { total: { rows: [{ total: 4 }] } }, errors: {} });
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(context.table("total").rows[0].total, 6);
  assert.equal(context.pending(), false);
});

test("local HTML that exceeds the existing platform page source limit remains blocked", async () => {
  const result = await compileArchivedLocal(input, {
    compiler: {
      compile: async () => ({ ...output, css: "é".repeat(3_000_000) }),
    },
  });
  assert.equal(result.classification, "manual-blocked");
  assert.equal(result.issues[0]?.code, "compiled-page-limit");
});

test("inline tables retain declared rows and schema as Apollo viewer state", async () => {
  const result = await compileArchivedLocal(
    {
      ...input,
      source:
        '<Helmet><Value name="rows" type="table" value={[{amount:2}]}/><Query name="total">{`select sum(amount) as total from rows`}</Query></Helmet><Number data="$total"/>',
    },
    {
      compiler: {
        compile: async () => ({
          ...output,
          queryNames: ["total"],
          declarations: [
            {
              name: "rows",
              type: "table",
              default: [{ amount: 2 }],
              columns: [{ name: "amount", type: "number" }],
            },
          ],
        }),
      },
    },
  );
  assert.equal(result.classification, "functional");
  assert.match(result.html!, /"rows":\[\{"amount":2\}\]/);
});

test("table viewer state validates schema, reloads saved rows, and keeps scalar queries separate", async () => {
  const { localBootSource } = await import(
    "../src/migration/conversion/compiled/local-boot.ts"
  );
  let data: any = { compiledPage: { rows: [{ amount: 7 }], n: 3 } },
    context: any,
    observe: any;
  const client = {
    watchQuery: () => ({
      subscribe: (fn: any) => {
        observe = fn;
        fn({ data });
      },
    }),
    updateQuery: (_: any, fn: any) => {
      data = fn(data);
      observe({ data });
    },
  };
  const signal = (v: any) => [
    () => v,
    (next: any) => {
      v = next;
    },
  ];
  const source = localBootSource([
    {
      name: "rows",
      type: "table",
      default: [{ amount: 2 }],
      columns: [{ name: "amount", type: "number" }],
    },
    { name: "n", type: "number", default: 1 },
  ])
    .replace(/^import .*;$/gm, "")
    .replace("export function boot", "function boot");
  const boot = Function(
    "window",
    "client",
    "gql",
    "hydrateIsland",
    "markCompiledReady",
    "createSignal",
    source + ";return boot;",
  )(
    {addEventListener(){}},
    client,
    () => ({}),
    (_: any, __: any, c: any) => {
      context = c;
    },
    () => {},
    signal,
  );
  boot({ TREE: () => null });
  assert.deepEqual(context.values(), { n: 3 });
  assert.deepEqual(context.table("rows"), {
    rows: [{ amount: 7 }],
    columns: [{ name: "amount", type: "number" }],
  });
  context.setValue("rows", [{ amount: 9 }]);
  assert.deepEqual(data.compiledPage.rows, [{ amount: 9 }]);
  assert.throws(
    () => context.setValue("rows", [{ amount: "bad" }]),
    /Invalid local scalar write/,
  );
  assert.throws(
    () => context.setValue("rows", [{ amount: 1, extra: 2 }]),
    /Invalid local scalar write/,
  );
  boot({ TREE: () => null });
  assert.deepEqual(context.table("rows").rows, [{ amount: 9 }]);
});

test("dataset Imports require exact manifest bindings and emit no fetched rows", async () => {
  const source =
    '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="total">{`select sum(amount) as total from items.rows`}</Query></Helmet><Number data="$total"/>';
  const binding = {
    name: "items",
    legacyRef: "ref:Abcd12",
    backendNamespace: "legacyDatasets",
    backendHref: "/af/v1/ids/Bac123",
    version: 3,
    mode: "pinned" as const,
    tables: [
      {
        schema: "main",
        table: "rows",
        columns: [{ name: "amount", type: "number" }],
      },
    ],
  };
  let calls = 0;
  const compiler = {
    compile: async () => {
      calls++;
      return {
        ...output,
        declarations: [],
        queryNames: ["total"],
        datasetNames: ["items"],
      };
    },
  };
  const result = await compileArchivedLocal(
    { ...input, source, datasetBindings: [binding] },
    { compiler },
  );
  assert.equal(result.classification, "functional");
  assert.equal(calls, 1);
  assert.match(result.html!, /rel="af-backend"/);
  assert.match(result.html!, /data-af-name="legacyDatasets"/);
  assert.match(result.html!, /Loading protected data/);
  assert.match(result.html!, /"compiledPage":\{\}/);
  for (const datasetBindings of [
    [],
    [{ ...binding, legacyRef: "ref:Other1" }],
    [binding, binding],
  ]) {
    const bad = await compileArchivedLocal(
      { ...input, source, datasetBindings },
      { compiler },
    );
    assert.equal(bad.classification, "manual-blocked");
  }
  assert.equal(calls, 1);
});

test("explicit historical unavailability retains readable page without a backend or query runtime", async () => {
  const source =
    '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="total">{`select sum(amount) as total from items.rows`}</Query></Helmet><p id="history-note">Saved layout</p><Number data="$total"/>';
  const result = await compileArchivedLocal(
    {
      ...input,
      source,
      datasetUnavailable: { reason: "historical-binding-unavailable" },
    },
    {
      compiler: {
        compile: async () => ({
          ...output,
          declarations: [],
          queryNames: ["total"],
          datasetNames: ["items"],
          html: '<p id="history-note">Saved layout</p>',
        }),
      },
    },
  );
  assert.equal(result.classification, "renderable");
  assert.match(result.html!, /Saved layout/);
  assert.match(result.html!, /Historical data is unavailable/);
  assert.doesNotMatch(result.html!, /rel="af-backend"/);
  assert.ok(result.capabilities.includes("historical-data-unavailable"));
  assert.ok(!result.capabilities.includes("protected-dataset-reads"));
  assert.ok(!result.capabilities.includes("local-sql-queries"));
  const { localBootSource } = await import(
    "../src/migration/conversion/compiled/local-boot.ts"
  );
  const boot = localBootSource([], undefined, undefined, ["total"]);
  assert.doesNotMatch(boot, /readCompiledDataset|pageEngine|client.query/);
  assert.match(boot, /Historical data is unavailable/);
});

test("charts require an explicit offline chart plan and declared data source", async () => {
  const source =
    '<Helmet><Query name="rows">{`select 1 as amount`}</Query></Helmet><Question data="$rows" viz={{kind:"vega-lite",spec:{mark:"bar",encoding:{x:{scale:{domain:[0,10]}}}}}}/>';
  let calls = 0;
  const compiler = {
    compile: async () => {
      calls++;
      return {
        ...output,
        declarations: [],
        queryNames: ["rows"],
        chartPlans: 1,
      };
    },
  };
  const result = await compileArchivedLocal({ ...input, source }, { compiler });
  assert.equal(result.classification, "functional");
  assert.ok(result.capabilities.includes("compiled-charts"));
  assert.equal(calls, 1);
  const missing = await compileArchivedLocal(
    { ...input, source },
    {
      compiler: {
        compile: async () => ({
          ...output,
          declarations: [],
          queryNames: ["rows"],
        }),
      },
    },
  );
  assert.equal(missing.classification, "manual-blocked");
  const bad = await compileArchivedLocal(
    {
      ...input,
      source: source.replace(
        ' viz={{kind:"vega-lite",spec:{mark:"bar",encoding:{x:{scale:{domain:[0,10]}}}}}}',
        "",
      ),
    },
    { compiler },
  );
  assert.equal(bad.classification, "manual-blocked");
});

test("persistent mutation controls require exact registered routing metadata", async () => {
  const source =
    '<Helmet><Import name="items" src="ref:Abcd12"/><Value name="amount" type="number" default={2}/><Query name="total">{`select sum(amount) as total from items.rows`}</Query><Mutation name="save" reset="amount">{`insert into items.rows(amount) values($amount)`}</Mutation></Helmet><Button run="$save" args={{amount:"$amount"}}>Save</Button>';
  const binding = {
    name: "items",
    legacyRef: "ref:Abcd12",
    backendNamespace: "legacyDatasets",
    backendHref: "/af/v1/ids/Bac123",
    version: 3,
    mode: "live" as const,
    tables: [
      {
        schema: "main",
        table: "rows",
        columns: [{ name: "amount", type: "number" }],
      },
    ],
  };
  const compiler = {
    compile: async () => ({
      ...output,
      declarations: [{ name: "amount", type: "number" as const, default: 2 }],
      queryNames: ["total"],
      datasetNames: ["items"],
      mutationNames: ["save"],
    }),
  };
  const base = { ...input, source, datasetBindings: [binding] };
  const metadata = {
    name: "save",
    backendNamespace: "legacyDatasets",
    recoveryScope: "a".repeat(64),
    paramTypes: { amount: "number" as const },
    reset: ["amount"],
  };
  const good = await compileArchivedLocal(
    { ...base, datasetMutations: [metadata] },
    { compiler },
  );
  assert.equal(good.classification, "functional");
  assert.ok(good.capabilities.includes("registered-dataset-mutations"));
  for (const datasetMutations of [
    undefined,
    [],
    [{ ...metadata, name: "different" }],
    [{ ...metadata, backendNamespace: "unknown" }],
  ]) {
    assert.equal(
      (await compileArchivedLocal({ ...base, datasetMutations }, { compiler }))
        .classification,
      "manual-blocked",
    );
  }
});

test("historical mutation declarations render read-only with no executable write metadata", async () => {
  const source =
    '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="total">{`select count(*) as total from items.rows`}</Query><Mutation name="save">{`insert into items.rows(amount) values(1)`}</Mutation></Helmet><Button run="$save">Save</Button>';
  const result = await compileArchivedLocal(
    {
      ...input,
      source,
      datasetUnavailable: { reason: "historical-binding-unavailable" },
    },
    {
      compiler: {
        compile: async () => ({
          ...output,
          declarations: [],
          queryNames: ["total"],
          datasetNames: ["items"],
          mutationNames: ["save"],
        }),
      },
    },
  );
  assert.equal(result.classification, "renderable");
  assert.match(result.html!, /or perform shared data writes/);
  assert.doesNotMatch(result.html!, /rel="af-backend"/);
  assert.ok(!result.capabilities.includes("registered-dataset-mutations"));
  const { localBootSource } = await import(
    "../src/migration/conversion/compiled/local-boot.ts"
  );
  const boot = localBootSource([], undefined, undefined, ["total"]);
  assert.match(boot, /Historical shared data writes are unavailable/);
  assert.doesNotMatch(boot, /createCompiledDatasetMutations|client.mutate/);
});
