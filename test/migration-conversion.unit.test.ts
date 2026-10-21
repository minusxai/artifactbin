import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLegacyJsx } from "../src/migration/conversion/index.ts";
test("converts parsed static JSX, escaped literals, identity and styles to independent HTML", () => {
  const result = convertLegacyJsx({
    source:
      '<><Helmet><title>Example</title><style>{`p { color: red }`}</style></Helmet><p id="Ab12" className="body">Hello &amp; {"<world>"}</p></>',
    coreUrl: "/af/v1/core.js",
    designSystem: "dossier",
  });
  assert.equal(result.classification, "renderable");
  assert.match(result.html!, /data-af-id="Ab12"/);
  assert.match(result.html!, /class="body"/);
  assert.match(result.html!, /Hello &amp; &lt;world&gt;/);
  assert.match(result.html!, /p \{ color: red \}/);
  assert.match(result.html!, /data-af-design-system="dossier"/);
  assert.doesNotMatch(result.html!, /@mx|__mx|Helmet|afbin-code/);
});
test("unknown behavior and shared actions block instead of emitting inert controls", () => {
  for (const source of [
    '<Chart source="$sales" />',
    '<Helmet><Query name="sales">{`select 1`}</Query></Helmet>',
    '<Button run="save">Save</Button>',
    "<script>window.x=1</script>",
  ]) {
    const result = convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" });
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
    assert.ok(result.issues.length);
  }
});
test("local state kit adapter uses Apollo for persistent viewer state", () => {
  const result = convertLegacyJsx({
    source:
      '<><Helmet><Value name="count" type="number" default={0}/></Helmet><Button set="count" value={1}>One</Button><p>{$count}</p></>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(result.classification, "functional");
  assert.match(result.html!, /@afbin\/apollo/);
  assert.match(result.html!, /client.updateQuery/);
  assert.match(result.html!, /client.watchQuery/);
  assert.match(result.html!, /data-af="state"/);
  assert.doesNotMatch(result.html!, /@mx|from ['"]page['"]|__mx/);
});
test("parse errors and executable expressions are refused without evaluating code", () => {
  for (const source of [
    "<p>",
    "<p>{process.exit()}</p>",
    "<p onClick={()=>1}>x</p>",
  ]) {
    assert.equal(
      convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" }).classification,
      "manual-blocked",
    );
  }
});
test("generated local adapter subscribes, updates through Apollo and renders subsequent state", async () => {
  const result = convertLegacyJsx({
    source:
      '<Helmet><Value name="count" type="number" default={0}/></Helmet><Button id="btn1" set="count" value={1}>One</Button><p>{$count}</p>',
    coreUrl: "/af/v1/core.js",
  });
  const script = result.html!.match(
    /<script type="module">([\s\S]*?)<\/script>/,
  )![1]!;
  let subscriber: (value: { data: Record<string, unknown> }) => void = () => {};
  let state: Record<string, unknown> = { count: 0 };
  let click: () => void = () => {};
  const text = { textContent: "" };
  const document = {
    getElementById: (selector: string) =>
      selector.includes("btn1")
        ? {
            addEventListener: (_event: string, callback: () => void) => {
              click = callback;
            },
          }
        : text,
  };
  const client = {
    watchQuery: () => ({
      subscribe: (fn: typeof subscriber) => {
        subscriber = fn;
        fn({ data: state });
      },
    }),
    updateQuery: (
      _options: unknown,
      fn: (data: typeof state) => typeof state,
    ) => {
      state = fn(state);
      subscriber({ data: state });
    },
  };
  const code = script.replace("import {client,gql} from '@afbin/apollo';", "");
  new Function("client", "gql", "document", code)(
    client,
    (s: TemplateStringsArray) => s.join(""),
    document,
  );
  assert.equal(text.textContent, "0");
  click();
  assert.deepEqual(state, { count: 1 });
  assert.equal(text.textContent, "1");
});
test("rejects malformed trailing syntax and unknown bindings", () => {
  for (const source of ["<p>x</p></>", "<p>{$unknown}</p>"])
    assert.equal(
      convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" }).classification,
      "manual-blocked",
    );
});

test("canonical stored graph with null source reconstructs nested source without flattening literals", async () => {
  const { convertLegacyDocument } = await import(
    "../src/migration/conversion/index.ts"
  );
  const document = {
    kind: "graph",
    schema: 3,
    nodes: {
      $root: { parts: ["", ""], children: ["head"] },
      head: {
        parts: [
          '<><Helmet><style>{`p { color: red; }`}</style></Helmet><p id="Ab12" title="a &amp; b">',
          "</p></>",
        ],
        children: ["text"],
      },
      text: { parts: ['{"<hello>"}'], children: [] },
    },
  };
  const converted = convertLegacyDocument(document, {
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(converted.classification, "renderable");
  assert.match(converted.html!, /title="a &amp; b"/);
  assert.match(converted.html!, /&lt;hello&gt;/);
  assert.match(converted.html!, /data-af-id="Ab12"/);
  assert.match(converted.html!, /p \{ color: red; \}/);
});
test("canonical graph preserves adapter state and rejects corrupted boundaries or cycles", async () => {
  const { convertLegacyDocument } = await import(
    "../src/migration/conversion/index.ts"
  );
  const graph = {
    kind: "graph",
    schema: 3,
    nodes: {
      $root: {
        parts: [
          '<Helmet><Value name="count" type="number" default={0}/></Helmet><Button set="count" value={1}>One</Button><p>{$count}</p>',
        ],
        children: [],
      },
    },
  };
  assert.equal(
    convertLegacyDocument(graph, { coreUrl: "/af/v1/core.js" }).classification,
    "functional",
  );
  for (const bad of [
    null,
    {},
    { ...graph, schema: 2 },
    { ...graph, nodes: { $root: { parts: [""], children: ["$root"] } } },
    { ...graph, nodes: { $root: { parts: ["", ""], children: ["missing"] } } },
  ]) {
    const converted = convertLegacyDocument(bad, { coreUrl: "/af/v1/core.js" });
    assert.equal(converted.classification, "manual-blocked");
    assert.equal(converted.html, null);
    assert.equal(converted.issues[0]?.code, "document-codec");
  }
});

test("native JSX object styles and static attributes preserve browser semantics", () => {
  const converted = convertLegacyJsx({
    source:
      '<label htmlFor="a" style={{fontSize: 14, lineHeight: 1.5, "--x": "2px"}}>X<input id="a" disabled={false} checked={true} data-n={3}/></label>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(converted.classification, "renderable");
  assert.match(converted.html!, /for="a"/);
  assert.match(
    converted.html!,
    /style="font-size:14px;line-height:1.5;--x:2px"/,
  );
  assert.match(converted.html!, / checked/);
  assert.doesNotMatch(converted.html!, / disabled/);
});
test("conversion refuses partial parse tails and active attributes regardless of case", () => {
  for (const source of [
    "<p>kept</p></>;globalThis.x=1;//",
    '<p ONCLICK="alert(1)">x</p>',
    '<p oNclick="alert(1)">x</p>',
    '<iframe srcDoc="<script>alert(1)</script>"/>',
  ])
    assert.equal(
      convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" }).classification,
      "manual-blocked",
      source,
    );
});
test("local adapter refuses reserved state keys and inherited bindings", () => {
  for (const source of [
    "<p>{$constructor}</p>",
    '<Helmet><Value name="__proto__" type="string" default="x"/></Helmet>',
    '<Button set="constructor" value="x">x</Button>',
  ])
    assert.equal(
      convertLegacyJsx({ source, coreUrl: "/af/v1/core.js" }).classification,
      "manual-blocked",
      source,
    );
});
test("adapter binding ids cannot collide with authored ids and authored unusual ids are safe", () => {
  const converted = convertLegacyJsx({
    source:
      '<Helmet><Value name="n" type="number" default={0}/></Helmet><i id="migration-binding-1"/><Button id={"a\\\"b"} set="n" value={1}>Set</Button><p>{$n}</p>',
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(converted.classification, "functional");
  const ids = [...converted.html!.matchAll(/<[^>]*data-af-id="([^"]+)"/g)].map(
    (x) => x[1],
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(converted.html!, /querySelector\(/);
});
