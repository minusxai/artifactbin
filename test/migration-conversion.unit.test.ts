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
    querySelector: (selector: string) =>
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
