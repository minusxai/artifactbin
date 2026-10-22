import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AF_ORIGIN, KNOWN_AF_ORIGINS } from "../../../src/af-contracts.ts";
import type { PageModelModule } from "../../../src/page/page-contracts.ts";
import { load } from "../support/load.ts";
import { skillExample, skillFile } from "../support/skill.ts";

const model = () => load<PageModelModule>("src/page/page-model.ts");
const ORIGIN = "http://127.0.0.1:8799";
const save = { id: "Pg4mQ2", version: 1, origin: ORIGIN, knownOrigins: KNOWN_AF_ORIGINS };

function html(body: string, head = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
${head}</head>
<body>
${body}
</body>
</html>
`;
}
const withoutIds = (source: string) => source.replace(/ data-af-id="n\d+"/g, "");
const bodyOf = (source: string) => source.slice(source.indexOf("<body"));

test("the skill's metadata example is read from the data-af=meta block", async () => {
  const { parsePage } = await model();
  const example = skillExample("SKILL.md", '"version": 5').code;
  const parsed = parsePage(example);
  assert.deepEqual(parsed.meta, { version: 5, name: "My Page", id: "Pg4mQ2" });
  assert.deepEqual(parsed.core, {
    present: true,
    first: true,
    inline: false,
    src: `${DEFAULT_AF_ORIGIN}/af/v1/core.js`,
  });
});

test("data-af-id is only a node ID: the old meta marker is not metadata and check names it", async () => {
  const { parsePage, checkPage } = await model();
  const legacy = html("<p>x</p>", '  <script type="application/json" data-af-id="meta">{"name":"Old"}</script>\n');
  assert.equal(parsePage(legacy).meta, null);
  const problems = checkPage(legacy);
  assert.deepEqual(problems.map((p) => [p.code, p.line]), [["meta-legacy-marker", 5]]);
});

test("every element inside body gets an ID except script, style and template content", async () => {
  const { assignNodeIds, parsePage } = await model();
  const input = html(`<h1>Hi</h1>
<ul><li>a</li><li>b</li></ul>
<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>
<style>p{}</style>
<script>void 0</script>
<template><p>later</p></template>`);
  const result = assignNodeIds(input);
  assert.deepEqual(
    result.changes.map((c) => [c.tag, c.id]),
    [["h1", "n1"], ["ul", "n2"], ["li", "n3"], ["li", "n4"], ["svg", "n5"], ["rect", "n6"]],
  );
  assert.equal(result.nextNodeId, 7);
  assert.equal(parsePage(result.source).meta?.nextNodeId, 7);
  assert.deepEqual(parsePage(result.source).nodeIds, ["n1", "n2", "n3", "n4", "n5", "n6"]);
  assert.equal(result.changes[0]!.line, 7);
});

test("assigning keeps the author's bytes and is idempotent", async () => {
  const { assignNodeIds } = await model();
  const input = html(`<main class='x'   data-role=main>
  <p>One &amp; two<br>three</p>
</main>`);
  const first = assignNodeIds(input);
  assert.equal(withoutIds(bodyOf(first.source)), bodyOf(input));
  const second = assignNodeIds(first.source);
  assert.deepEqual(second.changes, []);
  assert.equal(second.source, first.source);
});

test("existing and reserved IDs are never reassigned and the counter only grows", async () => {
  const { assignNodeIds } = await model();
  const input = html(
    `<p data-af-id="n2">kept</p><p>new</p><p>newer</p>`,
    '  <script type="application/json" data-af="meta">{"name":"P","nextNodeId":1}</script>\n',
  );
  const result = assignNodeIds(input, { reserved: new Set(["n1", "n4"]) });
  assert.deepEqual(result.changes.map((c) => c.id), ["n3", "n5"]);
  assert.match(result.source, /<p data-af-id="n2">kept<\/p>/);
  assert.equal(result.nextNodeId, 6);
  const later = assignNodeIds(
    html(`<p>only</p>`, '  <script type="application/json" data-af="meta">{"nextNodeId":40}</script>\n'),
  );
  assert.deepEqual(later.changes.map((c) => c.id), ["n40"]);
});

test("a duplicated ID stays on its first element; later copies get new IDs", async () => {
  const { assignNodeIds, parsePage } = await model();
  const result = assignNodeIds(html(`<p data-af-id="a">1</p><p data-af-id="a">2</p>`));
  assert.deepEqual(parsePage(result.source).nodeIds, ["a", "n1"]);
});

test("check reports each mistake with its line", async () => {
  const { checkPage } = await model();
  const source = `<!DOCTYPE html>
<html>
<head>
  <script>window.early = 1</script>
  <script src="https://artifactbin.dev/af/v1/core.js"></script>
  <script type="application/json" data-af="meta">{ "name": </script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk7Qa2">
  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Cr4mZ9" data-af-name="crm">
  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Dd5nX1" data-af-name="crm">
  <link rel="af-backend" href="https://example.com/backend.ts" data-af-name="other">
  <link rel="stylesheet" href="https://artifactbin.dev/af/v1/design-systems/volta.css" data-af="design-system">
</head>
<body>
  <p data-af-id="same">a</p>
  <p data-af-id="same">b</p>
</body>
</html>
`;
  assert.deepEqual(
    checkPage(source).map((p) => [p.line, p.code]),
    [
      [5, "core-not-first"],
      [6, "meta-invalid-json"],
      [7, "unpinned-cdn"],
      [8, "unpinned-cdn"],
      [11, "backend-name-missing"],
      [13, "backend-name-duplicate"],
      [14, "backend-href-invalid"],
      [15, "design-system-link"],
      [19, "duplicate-node-id"],
    ],
  );
  for (const problem of checkPage(source)) assert.ok(problem.message.length > 0);
  assert.deepEqual(
    checkPage("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>").map((p) => p.code),
    ["core-missing"],
  );
});

test("the skill's todo example passes check before and after IDs are assigned", async () => {
  const { checkPage, assignNodeIds } = await model();
  const todo = skillFile("examples/todo.html");
  assert.deepEqual(checkPage(todo), []);
  assert.deepEqual(checkPage(assignNodeIds(todo).source), []);
});

test("backend links come from the skill's link example", async () => {
  const { parsePage } = await model();
  const links = skillExample("SKILL.md", 'rel="af-backend"').code;
  assert.deepEqual(
    parsePage(html("", links)).backends.map(({ name, id }) => ({ name, id })),
    [
      { name: "billing", id: "Bk7Qa2" },
      { name: "contacts", id: "Cr4mZ9" },
    ],
  );
});

test("host rewriting touches only /af/v1/ addresses on known hosts", async () => {
  const { rewriteHosts } = await model();
  const input = html(
    `<a href="https://artifactbin.dev/about">about https://artifactbin.dev/af/v1/core.js</a>
<img src="https://artifactbin.dev/af/v1/ids/Im4ge0">`,
    '  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk7Qa2" data-af-name="billing">\n',
  );
  const output = rewriteHosts(input, KNOWN_AF_ORIGINS, ORIGIN);
  assert.equal(
    output,
    input
      .replace('src="https://artifactbin.dev/af/v1/core.js"', `src="${ORIGIN}/af/v1/core.js"`)
      .replace('href="https://artifactbin.dev/af/v1/ids/Bk7Qa2"', `href="${ORIGIN}/af/v1/ids/Bk7Qa2"`)
      .replace('src="https://artifactbin.dev/af/v1/ids/Im4ge0"', `src="${ORIGIN}/af/v1/ids/Im4ge0"`),
  );
});

test("the core is added first in head when missing, and moved there when not first", async () => {
  const { ensureCore, parsePage } = await model();
  const missing = "<!DOCTYPE html><html><head><title>t</title><script>1</script></head><body></body></html>";
  const added = parsePage(ensureCore(missing, ORIGIN));
  assert.deepEqual(added.core, { present: true, first: true, inline: false, src: `${ORIGIN}/af/v1/core.js` });
  const late = `<!DOCTYPE html><html><head><script>1</script><script src="${ORIGIN}/af/v1/core.js"></script></head><body></body></html>`;
  const moved = ensureCore(late, ORIGIN);
  assert.equal(parsePage(moved).core.first, true);
  assert.equal(moved.match(/core\.js/g)?.length, 1);
});

test("saving fills the meta block and IDs, rewrites hosts and drops platform-owned markup", async () => {
  const { prepareForSave, parsePage } = await model();
  const input = html(
    `<h1>Title</h1><p>Text</p>`,
    `  <script type="application/json" data-af="meta">{ "name": "Kept", "id": "Wrong1", "version": 99, "extra": [1] }</script>
  <link rel="stylesheet" href="https://artifactbin.dev/af/v1/design-systems/volta.css" data-af="design-system">
  <script type="application/json" data-af="state">{"todos":[{"id":"1"}]}</script>
`,
  ).replace("<html>", '<html data-af-dark="true" data-af-design-system="dossier">');
  const saved = prepareForSave(input, { ...save, version: 3 });
  assert.deepEqual(saved.meta, { name: "Kept", id: "Pg4mQ2", version: 3, extra: [1], nextNodeId: 3 });
  assert.deepEqual(saved.state, { todos: [{ id: "1" }] });
  const parsed = parsePage(saved.source);
  assert.deepEqual(parsed.meta, saved.meta);
  assert.equal(parsed.core.src, `${ORIGIN}/af/v1/core.js`);
  assert.equal(parsed.designSystem, "dossier");
  assert.deepEqual(parsed.nodeIds, ["n1", "n2"]);
  assert.doesNotMatch(saved.source, /data-af-dark|data-af="design-system"|data-af="state"|artifactbin\.dev/);
  assert.equal(prepareForSave(saved.source, { ...save, version: 3 }).source, saved.source);
});

test("saving never reuses IDs from earlier versions", async () => {
  const { prepareForSave } = await model();
  const saved = prepareForSave(html(`<p>a</p>`), {
    ...save,
    previousNextNodeId: 50,
    reserved: new Set(["n50"]),
  });
  assert.deepEqual(saved.nodeIds, ["n51"]);
  assert.equal(saved.meta.nextNodeId, 52);
});

test("saving rejects backend links the page cannot be published with", async () => {
  const { prepareForSave } = await model();
  for (const [links, code] of [
    ['<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk7Qa2">', "backend-name-missing"],
    ['<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk7Qa2" data-af-name="a b">', "backend-name-invalid"],
    [
      '<link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Bk7Qa2" data-af-name="x"><link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/Cr4mZ9" data-af-name="x">',
      "backend-name-duplicate",
    ],
  ] as const)
    assert.throws(() => prepareForSave(html("", links), save), { name: "PageError", code });
});

test("a downloaded copy inlines the core, the design system and the state, and saves back to the linked form", async () => {
  const { toPortable, prepareForSave, parsePage } = await model();
  const saved = prepareForSave(html(`<p>x</p>`), save).source;
  const css = ":root { --background: #fff; }";
  const portable = toPortable(saved, {
    core: "window.__core = 1;",
    designSystem: "riso",
    designSystemCss: css,
    state: { count: 2 },
    server: ORIGIN,
    revision: "digest-of-version-1",
  });
  const parsed = parsePage(portable);
  assert.deepEqual(parsed.core, { present: true, first: true, inline: true, src: null });
  assert.equal(parsed.designSystem, "riso");
  // The file knows its server and version, so a browser that can reach the server can reconnect it.
  assert.match(
    portable,
    new RegExp(`<script data-af="core" data-af-server="${ORIGIN}" data-af-revision="digest-of-version-1">window\\.__core = 1;</script>`),
  );
  assert.match(
    toPortable(saved, { core: "1", designSystem: "riso", designSystemCss: css, state: null }),
    /<script data-af="core">1<\/script>/,
  );
  const link = /<link rel="stylesheet" data-af="design-system" href="data:text\/css;base64,([^"]+)">/.exec(portable);
  assert.ok(link, "design-system link with a data: URL");
  assert.equal(Buffer.from(link[1]!, "base64").toString("utf8"), css);
  const back = prepareForSave(portable, save);
  assert.deepEqual(back.state, { count: 2 });
  assert.equal(parsePage(back.source).core.src, `${ORIGIN}/af/v1/core.js`);
  assert.doesNotMatch(back.source, /window\.__core|data:text\/css|data-af-server|data-af-revision/);
});

 test("saving resolves root-relative core URLs for an isolated runner without changing other scripts", async () => {
  const { prepareForSave, parsePage } = await model();
  for (const prefix of ["", "<script>1</script>"]) {
    const input = `<!doctype html><html><head>${prefix}<script src="/af/v1/core.js" defer></script><script src="/custom.js"></script></head><body><p>Saved</p></body></html>`;
    const saved = prepareForSave(input, save).source;
    assert.equal(parsePage(saved).core.src, `${ORIGIN}/af/v1/core.js`);
    assert.match(saved, /src="\/custom.js"/);
    assert.equal(prepareForSave(saved, save).source, saved);
  }
 });
