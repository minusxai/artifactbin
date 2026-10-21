import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageModelModule } from "../../../src/page/page-contracts.ts";
import { load } from "../support/load.ts";

const model = () => load<PageModelModule>("src/page/page-model.ts");
const ORIGIN = "http://127.0.0.1:8799";
const save = { id: "Pg4mQ2", version: 1, origin: ORIGIN, knownOrigins: ["https://artifactbin.dev"] };

test("a saved page survives download and re-save byte for byte", async () => {
  const { prepareForSave, toPortable } = await model();
  const saved = prepareForSave(
    `<!DOCTYPE html>
<html data-af-design-system="riso">
<head>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
  <title>T</title>
</head>
<body>
  <p>x</p>
</body>
</html>
`,
    save,
  ).source;
  const portable = toPortable(saved, { core: "a('</script>')", designSystem: "riso", designSystemCss: "p { content: 'é' }", state: { a: "<b>" } });
  assert.doesNotMatch(portable.slice(portable.indexOf('data-af="core">')), /^[^\n]*<\/script>[^\n]*<\/script>/);
  const back = prepareForSave(portable, save);
  assert.equal(back.source, saved);
  assert.deepEqual(back.state, { a: "<b>" });
});

test("metadata keeps the author's formatting and unknown keys when the platform writes to it", async () => {
  const { prepareForSave } = await model();
  const source = `<!DOCTYPE html>
<html>
<head>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
  <script type="application/json" data-af="meta">
  {
    "name": "My Page",
    "custom": { "nested": [1, 2] }
  }
  </script>
</head>
<body></body>
</html>
`;
  const saved = prepareForSave(source, { ...save, version: 4 }).source;
  assert.match(
    saved,
    /\{\n {4}"name": "My Page",\n {4}"custom": \{ "nested": \[1, 2\] \},\n {4}"id": "Pg4mQ2",\n {4}"version": 4,\n {4}"nextNodeId": 1\n {2}\}/,
  );
});

test("an inline core already first is turned back into the src form in place", async () => {
  const { ensureCore } = await model();
  const source = `<html><head><script data-af="core">x()</script><title>t</title></head><body></body></html>`;
  assert.equal(
    ensureCore(source, ORIGIN),
    `<html><head><script src="${ORIGIN}/af/v1/core.js"></script><title>t</title></head><body></body></html>`,
  );
});

test("pinned CDN URLs pass and loose ones are reported", async () => {
  const { checkPage } = await model();
  const page = (tags: string) =>
    `<!DOCTYPE html><html><head><script src="https://artifactbin.dev/af/v1/core.js"></script>\n${tags}</head><body></body></html>`;
  const pinned = [
    '<script src="https://esm.sh/react@18.3.1"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/dist/plot.umd.min.js"></script>',
    '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">',
    '<script src="https://example.com/lib.js"></script>',
  ];
  assert.deepEqual(checkPage(page(pinned.join("\n"))), []);
  const loose = [
    '<script src="https://esm.sh/react"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/@observablehq/plot/dist/plot.umd.min.js"></script>',
    '<link rel="stylesheet" href="https://unpkg.com/leaflet@latest/dist/leaflet.css">',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7/d3.min.js"></script>',
  ];
  assert.deepEqual(checkPage(page(loose.join("\n"))).map((p) => [p.line, p.code]), [
    [2, "unpinned-cdn"],
    [3, "unpinned-cdn"],
    [4, "unpinned-cdn"],
    [5, "unpinned-cdn"],
  ]);
});

test("elements the parser implies get no ID, and invalid metadata stops assignment", async () => {
  const { assignNodeIds } = await model();
  const result = assignNodeIds("<!DOCTYPE html><html><head></head><body><table><tr><td>1</td></tr></table></body></html>");
  assert.deepEqual(result.changes.map((c) => c.tag), ["table", "tr", "td"]);
  assert.throws(
    () => assignNodeIds('<html><head><script type="application/json" data-af="meta">{</script></head><body><p>x</p></body></html>'),
    { name: "PageError", code: "meta-invalid-json" },
  );
});

test("the node ID counter never falls below the IDs already in the page", async () => {
  const { prepareForSave, assignNodeIds } = await model();
  // A fork strips nextNodeId but keeps n1..n5; the counter must land above them.
  const forked = `<!DOCTYPE html><html><head><script src="https://artifactbin.dev/af/v1/core.js"></script><title>T</title></head><body><p data-af-id="n5">a</p><p data-af-id="n2">b</p><p>new</p></body></html>`;
  const saved = prepareForSave(forked, save);
  assert.equal(saved.meta.nextNodeId, 7, "n6 went to the new element; the counter is past it");
  assert.match(saved.source, /<p data-af-id="n6">new<\/p>/);
  // On save, IDs reserved by earlier revisions raise the counter too, so a removed ID is never handed out again.
  const stale = `<!DOCTYPE html><html><head><script src="https://artifactbin.dev/af/v1/core.js"></script><script type="application/json" data-af="meta">{"nextNodeId":1}</script></head><body><p data-af-id="n3">a</p><p>new</p></body></html>`;
  const result = prepareForSave(stale, { ...save, reserved: new Set(["n9"]) });
  assert.match(result.source, /<p data-af-id="n10">new<\/p>/);
  assert.equal(result.meta.nextNodeId, 11);
  // Without a save in between, local assignment keeps filling gaps below the counter, as the contract says.
  assert.deepEqual(assignNodeIds(stale).changes.map((c) => c.id), ["n1"]);
});
