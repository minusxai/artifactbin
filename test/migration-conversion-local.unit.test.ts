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
    '<Query name="rows">select 1</Query>',
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
    "client",
    "gql",
    "hydrateIsland",
    "createSignal",
    source + ";return boot;",
  )(
    client,
    () => ({}),
    (_: any, _tree: any, c: any) => {
      context = c;
      hydrationValues.push(c.value("count"));
    },
    createSignal,
  );
  boot({ TREE: () => null });
  assert.deepEqual(hydrationValues, [0]);
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
