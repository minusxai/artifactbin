import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationConverter } from "../src/migration/convert.ts";
const input = {
  source: '<Card id="card"><CardTitle>Fixture</CardTitle></Card>',
  coreUrl: "/af/v1/core.js",
};
test("strict strategy never silently invokes archived compiler", async () => {
  let calls = 0;
  const convert = createMigrationConverter({
    strategy: "strict",
    compiler: {
      compile: async () => {
        calls++;
        throw new Error("not permitted");
      },
    },
  });
  const result = await convert(input);
  assert.equal(result.strategy, "strict");
  assert.equal(result.classification, "manual-blocked");
  assert.equal(calls, 0);
});
test("archived-static strategy requires explicit compiler and preserves static-only provenance/CSS", async () => {
  assert.throws(
    () => createMigrationConverter({ strategy: "archived-static" }),
    /explicit archived compiler root/,
  );
  const convert = createMigrationConverter({
    strategy: "archived-static",
    compiler: {
      compile: async () => ({
        html: '<div id="card">Fixture</div>',
        css: ".fixture{color:red}",
        title: "Fixture",
        build: "fixture-build",
        rootAttributes: { class: "fixture" },
        capabilities: [],
      }),
    },
  });
  const result = await convert(input);
  assert.equal(result.classification, "renderable");
  assert.equal(result.strategy, "archived-static");
  assert.equal(result.provenance?.mode, "static-only");
  assert.ok(result.html?.includes(".fixture{color:red}"));
});
test("archived-static strategy does not call compiler for unsupported data or author behavior", async () => {
  let calls = 0;
  const convert = createMigrationConverter({
    strategy: "archived-static",
    compiler: {
      compile: async () => {
        calls++;
        throw new Error("not permitted");
      },
    },
  });
  const result = await convert({
    ...input,
    source: '<Query source="ref:abc123">SELECT * FROM data</Query>',
  });
  assert.equal(result.classification, "manual-blocked");
  assert.equal(result.html, null);
  assert.equal(calls, 0);
});

test("archived-static unsupported document codecs are explicitly blocked rather than planner errors", async () => {
  const convert = createMigrationConverter({
    strategy: "archived-static",
    compiler: {
      compile: async () => {
        throw new Error("must not compile");
      },
    },
  });
  const result = await convert({
    source: "",
    document: { schema: 999 },
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(result.classification, "manual-blocked");
  assert.equal(result.html, null);
});
test("explicit archived-functional admits bounded local state and preserves both refusal routes", async () => {
  const local = {
    html: '<button id="go">Go</button><p id="count">0</p>',
    css: ".fixture{}",
    title: "Fixture",
    build: "fixture",
    rootAttributes: {},
    capabilities: [],
    javascript: 'console.log("fixture")',
    declarations: [{ name: "count", type: "number" as const, default: 0 }],
    modules: ["rt.js", "kit-basic.js", "solid.js"],
  };
  let calls = 0;
  const convert = createMigrationConverter({
    strategy: "archived-functional",
    localCompiler: {
      compile: async () => {
        calls++;
        return local;
      },
    },
  });
  const result = await convert({
    source:
      '<Value name="count" type="number" default={0}/><Button id="go" set={{count:1}}>Go</Button><p id="count">{$count}</p>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(result.classification, "functional");
  assert.equal(result.provenance?.compiler, "archived-local");
  assert.equal(result.strategy, "archived-functional");
  assert.equal(calls, 1);
  const blocked = await convert({
    ...input,
    source: '<Import name="rows" ref="missing" />',
  });
  assert.equal(blocked.classification, "manual-blocked");
  assert.ok(
    blocked.issues.some(
      (i) => (i as { route?: string }).route === "archived-static",
    ),
  );
  assert.ok(
    blocked.issues.some(
      (i) => (i as { route?: string }).route === "archived-local",
    ),
  );
});

test("archived-functional explicitly selects admitted authored components", async () => {
  const convert = createMigrationConverter({
    strategy: "archived-functional",
    localCompiler: {
      compile: async (input) => {
        assert.ok(input.authorPlan);
        return {
          html: '<div id="mount" data-migration-author-component="Example"></div>',
          css: "",
          title: "Fixture",
          build: "fixture",
          rootAttributes: {},
          capabilities: [],
          javascript: "void 0",
          declarations: [],
          modules: [],
          authorExports: ["Example"],
        };
      },
    },
  });
  const result = await convert({
    source:
      '<Helmet><script>{`export function Example(){return <button>Go</button>}`}</script></Helmet><Example id="mount"/>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(result.classification, "functional");
  assert.equal(result.provenance?.compiler, "archived-author");
});

test("archived strategy preserves explicit structural corruption instead of producing an empty page", async () => {
  let compilations = 0;
  const convert = createMigrationConverter({
    strategy: "archived-functional",
    compiler: {
      compile: async () => {
        compilations++;
        throw Error("Cannot compile corrupt source");
      },
    },
  });
  for (const [nodes, message] of [
    [
      {
        $root: { parts: ["<main>"], children: ["child"] },
        child: { parts: ["Retained"], children: [] },
      },
      "Invalid canonical source boundaries",
    ],
    [
      { $root: { parts: ["<main>", "</main>"], children: ["missing"] } },
      "Canonical graph references a missing child",
    ],
  ] as const) {
    const result = await convert({
      source: "",
      document: { kind: "graph", schema: 3, nodes },
      coreUrl: "/af/v1/core.js",
    });
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
    assert.equal((result.issues[0] as { message: string }).message, message);
  }
  assert.equal(compilations, 0);
});
